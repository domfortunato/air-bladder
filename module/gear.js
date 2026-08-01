/**
 * Shared gear resolution for Air Bladder.
 *
 * Gear is the single editable source of truth: it lives in Item compendia that a
 * Warden can unlock and edit. Character generation (2e AND Barebones), hireling
 * loadouts, bonds, and the marketplace all reference an item BY NAME and resolve
 * it here — so editing a pack item once flows everywhere it is granted.
 *
 * This is the resolve-time half. The author-time half (turning an inline
 * {name, tags, uses, ...} record into an item's type/system fields) is
 * `buildGearItem`, kept here too so the two halves stay in one place; the
 * tools/import/gear-2e.mjs authoring script carries a byte-identical copy of that
 * inference (Node can't import this browser module across the ESM/CJS boundary,
 * so the copies are kept in sync by hand — see the note there).
 *
 * Nothing here touches Foundry globals at module load; `game`/`foundry` are read
 * only inside resolveGearItem's body.
 */

import { iconForItem, SPELLSCROLL_ICON } from "./icons.js";

// Packs searched to resolve a gear name, in precedence order — an earlier pack
// wins a name collision. Spellbook packs are separate (spell grants route there).
//
// `market-goods` is last and is still a full member: it holds real gear that only
// the shop happened to stock (a Sedative, a Sewing Kit), and a background that
// grants one must resolve it. Leaving it out silently split the pool in two — the
// importer saw those items and skipped authoring them, while this list could not
// reach them, so the grant resolved to nothing. Any pack an importer counts as
// "already in the pool" MUST be listed here.
export const CANONICAL_GEAR_PACKS = [
  "air-bladder.expeditionary-gear",
  "air-bladder.tools",
  // Holds Lodestone, moved here 2026-07-29 when the one-item `extra` pack was
  // retired -- so the three backgrounds that grant it by name still resolve.
  "air-bladder.trinkets",
  "air-bladder.weapons",
  "air-bladder.armor",
  "air-bladder.market-goods",
  // The distinctive one-off items each background grants (Alchemical Sigils,
  // Catring, …), consolidated out of the type packs by tools/import/background-items.mjs.
  // Last in precedence: every name here is unique, so ordering is belt-and-braces.
  "air-bladder.background-items",
];

export const SPELL_PACKS = ["air-bladder.spellbooks", "air-bladder.more-spellbooks"];

// Genuine spelling variants — NOT mere casing (the resolver is already
// case-insensitive). Key: lowercased grant spelling → canonical pack item name.
export const GEAR_ALIASES = new Map([
  ["lockpick", "Lockpicks"],
  ["hand drill", "Hand-Drill"],
  ["torches", "Torch"],
  ["rope (25ft)", "Rope"],
  ["chain (10ft)", "Chain, 10ft"],
  ["chains (10ft)", "Chain, 10ft"],
  ["chains", "Chain, 10ft"],
  ["chain", "Chain, 10ft"],
  ["pole (10ft)", "Pole, 10ft"],
  ["pole", "Pole, 10ft"],
  ["plate", "Plate Mail"],
  // The pack item carries the SRD shop's plural spelling, pairing it with
  // "Complex Instruments (Bagpipes, Fiddle, etc.)"; Jongleur grants the singular.
  ["simple instrument (pipes, lute, etc.)", "Simple Instruments (Pipes, Lute, etc.)"],
  ["boltcutters", "Bolt Cutters"],
  // The shop's tent IS the pool's tent: the barebones item is already bulky
  // with "fits 2" as its description. Without this the shop cannot see it and
  // authors a second, identical tent as a market-only good.
  ["tent (fits 2)", "Tent"],
]);

/**
 * A grant may name a spell as "Spellbook (X)", "Scroll (X)", or "X Spellbook".
 * Return the bare spell name X (to resolve against SPELL_PACKS), else null.
 */
export const spellNameFromGrant = (name) => {
  const s = String(name).trim();
  const m =
    s.match(/^spellbook\s*\((.+)\)$/i) ||
    s.match(/^scroll\s*\((.+)\)$/i) ||
    s.match(/^(.+?)\s+spellbook$/i);
  return m ? m[1].trim() : null;
};

/**
 * True when a grant names a SCROLL specifically ("Scroll (X)") rather than a book
 * ("Spellbook (X)", "X Spellbook"). Both route to the same spell in the spellbook
 * packs, but a scroll must resolve to a single-use petty item, a book to the
 * slot-taking spellbook — spellNameFromGrant deliberately erases that difference,
 * so resolveGearItem consults this to decide which to build.
 */
export const isScrollGrant = (name) => /^scroll\s*\(.+\)$/i.test(String(name).trim());

/**
 * A single-use petty scroll built from a resolved spellbook document: the SAME
 * spellbook type with `scroll` ticked, the spell's own text as its description, and
 * stored under the bare spell name — the inventory row adds the "Spellscroll — "
 * prefix at display time, exactly as it does for a book. THE one definition of
 * "what a scroll is", shared by named scroll grants (resolveGearItem) and the
 * random-scroll path (character-generator.js randomScrollItem) so the two cannot
 * drift.
 *
 * This used to emit `type: "item"` under the name "Spellscroll — X", which made a
 * generated scroll a THIRD representation no Warden could author or recognise: not
 * a spellbook, not flagged, identifiable only by a word in its name (which is what
 * `iconForItem` keys the scroll art off). `CairnItem._preUpdate` re-pins petty and
 * the use count on every write, so the values below are the initial state rather
 * than the only thing holding the invariant.
 */
export const spellScrollItem = (book, { quantity = 1, uses } = {}) => ({
  name: book.name,
  type: "spellbook",
  img: SPELLSCROLL_ICON,
  system: {
    // toObject() rather than deepClone — see resolveGearItem. The spread saved
    // this one from mutating the pack, but it also copied prepared/derived
    // fields off the live model into stored data.
    ...book.system.toObject(),
    scroll: true,
    weightless: true,
    equipped: false,
    quantity,
    uses: { value: uses ?? 1, max: 1 },
  },
});

/**
 * Author-time inference: map an inline {name, tags, uses/charges, description,
 * cost} record to an item's {type, system}. The one place tag→field inference
 * lives. Rules:
 *   - a whole-string dice tag (d6, d8, d6+d6, 2d6) → weapon + damageFormula
 *   - an "N Armor" tag                             → armor + system.armor = N
 *   - "petty" → weightless, "bulky" → bulky, "blast" → blast (weapons)
 *   - uses / charges / maxCharges → uses{value,max}; else lift "N use(s)" from prose
 * Weapon wins over armor when a record carries both (e.g. a bow tagged 1 Armor).
 */
export const buildGearItem = (g) => {
  const tags = g.tags ?? [];
  const lower = tags.map((t) => String(t).toLowerCase());
  const damageTag = tags.find((t) => /^\s*\d*d\d+(\s*\+\s*\d*d\d+)*\s*$/i.test(String(t)));
  const armorTag = tags.find((t) => /armor/i.test(String(t)));

  // "charges" is the relabelled "uses" field (relic-style items); fold either
  // spelling into uses. A structured count always beats a prose one.
  let usesMax = g.uses ?? g.maxCharges ?? g.charges ?? 0;
  let usesValue = g.uses ?? g.charges ?? usesMax;
  if (!usesMax) {
    const m = String(g.description ?? "").match(/\b(\d+)\s+uses?\b/i);
    if (m) { usesMax = Number(m[1]); usesValue = usesMax; }
  }

  const system = {
    description: g.description ?? "",
    weightless: lower.includes("petty"),
    bulky: lower.includes("bulky"),
    equipped: false,
    cost: g.cost ?? 0,
    quantity: 1,
    uses: { value: usesValue, max: usesMax },
  };

  let type = "item";
  if (damageTag) {
    type = "weapon";
    system.damageFormula = String(damageTag).trim();
    system.criticalDamage = "";
    system.blast = lower.includes("blast");
  } else if (armorTag) {
    type = "armor";
    const n = parseInt(String(armorTag), 10);
    system.armor = Number.isNaN(n) ? 1 : n;
  }
  return { name: g.name, type, img: iconForItem(type, g.name), system };
};

/**
 * Resolve-time: find a gear item by name across the canonical packs
 * (case-insensitive, honouring aliases and spell routing) and return a fresh
 * owned-item payload — a deep clone, so the pack document is never mutated — with
 * per-grant quantity/uses overrides applied. Returns null on a miss (and warns);
 * generation should degrade gracefully rather than throw.
 *
 * Still not cached: the match is found in the pack INDEX (names only, kept in
 * memory and updated live when a document changes), then that one document is
 * materialized with `getDocument`. So an in-session edit to an item is reflected
 * on the next resolve — the whole point of the editable-compendium model (edit →
 * regenerate → change appears) — without loading every document in eight packs.
 *
 * This runs once per gear name, and `getDocuments()` was walking ~1,000 documents
 * across eight packs each time to read one name off each. Measured on the dev
 * world (Foundry 14.365): twenty names went 34.5s -> 5.2s, and the six a typical
 * Kettlewright character carries cost 1.8s cold (building the indexes, once per
 * session) and 0ms warm, against ~1.7s PER NAME before.
 */
export const resolveGearItem = async (name, { quantity = 1, uses } = {}) => {
  const spell = spellNameFromGrant(name);
  const targetName = spell ?? GEAR_ALIASES.get(String(name).trim().toLowerCase()) ?? name;
  const packs = spell ? SPELL_PACKS : CANONICAL_GEAR_PACKS;
  const lower = String(targetName).toLowerCase();

  let found = null;
  for (const key of packs) {
    const pack = game.packs.get(key);
    if (!pack) continue;
    const entry = (await pack.getIndex()).find((e) => e.name.toLowerCase() === lower);
    if (!entry) continue;
    const doc = await pack.getDocument(entry._id);
    if (doc) { found = doc; break; }
  }
  if (!found) {
    console.warn(`resolveGearItem: no item named "${name}" in the canonical packs`);
    return null;
  }

  // A "Scroll (X)" grant is the spell as a single-use petty scroll, not the
  // slot-taking book. Without this a background handing out a scroll silently
  // grants a full spellbook (and the sheet even labels it "Spellbook — X").
  if (found.type === "spellbook" && isScrollGrant(name)) {
    return spellScrollItem(found, { quantity, uses });
  }

  const item = {
    name: found.name,
    type: found.type,
    img: found.img,
    // toObject(), NOT deepClone. `found.system` is a TypeDataModel, and
    // foundry.utils.deepClone returns any non-plain object UNCHANGED — by
    // reference (common/utils/helpers.mjs:280-282, "Unsupported advanced
    // objects"). So this used to hand back the compendium document's own
    // system, and the two writes below mutated the pack in place: every item
    // resolved in a session aliased one object per pack entry, last write wins.
    // It was invisible until a grant asked for `uses`, because everything else
    // was writing the same value back.
    system: found.system.toObject(),
  };
  item.system.quantity = quantity;
  if (uses != null) item.system.uses = { value: uses, max: uses };
  return item;
};

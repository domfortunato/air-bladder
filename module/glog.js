/**
 * GLOG Magic (the official Cairn hack, cairnrpg.com/hacks/glog-magic/) — the
 * OVERRIDING half. When `enable-glog-magic` is on, only GLOG and custom spells
 * are used (user ruling 2026-08-05): generation's spell grants resolve against
 * the GLOG pack and the custom set with canon excluded, every granted spell
 * lands as a SPELLSCROLL ("found magic is a scroll you copy into your
 * grimoire"), and — the total-conversion ruling — FLIPPING THE SETTING ON
 * SWEEPS THE WORLD: every canon spellbook becomes a GLOG spellscroll, every
 * canon scroll's text swaps to the GLOG wording, everywhere. The invariant
 * afterwards, which the probe asserts: no canon spell text exists anywhere in
 * the world. Flipping OFF converts nothing back, accepted at ruling time —
 * generation reverts to canon and existing GLOG scrolls simply remain.
 *
 * The grimoire itself (the npc role, the cast flow) lives elsewhere; this file
 * is only the setting's reach into CONTENT.
 */
import { SETTINGS_NS } from "./settings.js";

export const GLOG_PACK = "air-bladder.spellbooks-glog";

/**
 * The spell packs in force under GLOG: the GLOG wordings plus the custom set,
 * canon deliberately absent. "Custom" is the pack as it exists today — its
 * disposition is the user's open decision and nothing here presumes it.
 */
export const GLOG_SPELL_PACKS = [GLOG_PACK, "air-bladder.more-spellbooks"];

export const glogEnabled = () => {
  try {
    return !!game.settings.get(SETTINGS_NS, "enable-glog-magic");
  } catch {
    return false;   // settings not registered yet (early init)
  }
};

/**
 * The GLOG page's 100 is NOT name-for-name the canon 100 — four entries
 * diverge, in two different ways (verified against the live page 2026-08-05):
 *
 *   RENAMED, same spell — these two alias, so a canon book still swaps to its
 *   GLOG wording as the ruling requires ("the GLOG version, not the canon
 *   version"). Lowercased canon name → lowercased GLOG name, the GEAR_ALIASES
 *   pattern:
 *     Marble Craze   → Marble Madness  (same marbles-refill spell)
 *     Missile Shield → Shield          (same touch-protection spell)
 *
 *   DIFFERENT SPELL, deliberately NOT aliased — canon "Snail Knight" and
 *   "Primal Surge" have no GLOG version at all (the page has "Snuff" and
 *   "Primeval Surge" in their slots, unrelated effects), so they convert in
 *   FORM only and keep their own words, per the no-counterpart rule.
 */
export const GLOG_NAME_ALIASES = new Map([
  ["marble craze", "marble madness"],
  ["missile shield", "shield"],
]);

/**
 * name (lowercased) → the GLOG wording's description, for the whole GLOG pack
 * in ONE full load. The sweep resolves every spell in the world against this,
 * so per-name getDocument round trips would multiply by the world's inventory;
 * one getDocuments() here is the cheap direction for a bulk pass (the random
 * DRAW stays index-first — one winner — in character-generator.js).
 * @returns {Promise<Map<string, string>>}
 */
export const glogTextByName = async () => {
  const map = new Map();
  const pack = game.packs.get(GLOG_PACK);
  if (!pack) return map;
  for (const doc of await pack.getDocuments()) {
    if (doc.type === "spellbook") map.set(doc.name.toLowerCase(), doc.system.description ?? "");
  }
  // The renamed pair resolve under their canon names too, so the sweep swaps
  // their text instead of treating a rename as a missing counterpart.
  for (const [from, to] of GLOG_NAME_ALIASES) {
    if (map.has(to) && !map.has(from)) map.set(from, map.get(to));
  }
  return map;
};

/**
 * The update that converts ONE owned/world spellbook item under the ruling:
 * books become scrolls (the document's own _preUpdate pins petty + one unspent
 * use on the flip — the same machinery the sheet checkbox uses, so every path
 * agrees); an existing scroll keeps its uses untouched, spent staying spent.
 * Where a GLOG counterpart exists (by NAME) the text swaps and `glog` is set;
 * a spell with no counterpart converts in FORM and keeps its own words — its
 * `glog` flag stays false, because the flag marks the wording, not the rules
 * in force. Returns null when the item needs nothing (already conforming).
 */
export const glogConversionDiff = (item, glogText) => {
  const sys = item.system ?? {};
  const diff = {};
  if (!sys.scroll) diff["system.scroll"] = true;
  const swap = glogText.get(String(item.name).toLowerCase());
  if (swap !== undefined && sys.description !== swap) diff["system.description"] = swap;
  if (swap !== undefined && !sys.glog) diff["system.glog"] = true;
  return Object.keys(diff).length ? diff : null;
};

/**
 * The world sweep. Runs on the ACTIVE GM's client only (the enforceSourceFloor
 * precedent — every client hears the onChange; one is allowed to write), and is
 * idempotent by construction: after one pass no canon book remains and every
 * counterpart text already matches, so a second pass builds zero diffs — which
 * is what makes the two-open-tabs quirk harmless.
 *
 * Coverage is the house migration list, all of it: world Items, every actor's
 * owned items, UNLINKED scene tokens (their synthetic actors are not in
 * game.actors — the trap that bit twice), and world compendium Item packs
 * (unlocked for the write and restored after). Prototype tokens carry no items,
 * so actor coverage is their coverage.
 */
export const runGlogConversion = async () => {
  if (game.users.activeGM !== game.user) return;
  const glogText = await glogTextByName();
  if (!glogText.size) {
    console.warn("air-bladder | GLOG conversion: spellbooks-glog pack missing or empty — nothing swapped");
  }
  let converted = 0;

  const convertCollection = async (parent, items) => {
    const updates = [];
    for (const it of items) {
      if (it.type !== "spellbook") continue;
      const diff = glogConversionDiff(it, glogText);
      if (diff) updates.push({ _id: it.id, ...diff });
    }
    if (!updates.length) return;
    converted += updates.length;
    if (parent) await parent.updateEmbeddedDocuments("Item", updates);
    else await Item.updateDocuments(updates);
  };

  // World items, then every world actor's inventory.
  await convertCollection(null, game.items);
  for (const actor of game.actors) await convertCollection(actor, actor.items);

  // Unlinked tokens: each carries a synthetic actor holding REAL deltas.
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actorLink || !token.actor) continue;
      await convertCollection(token.actor, token.actor.items);
    }
  }

  // World compendium Item packs — a Warden's own spell collections. System
  // packs are excluded: shipped content is replaced wholesale on update and is
  // not the world's to rewrite (canon stays canon on disk; the POOL excludes it).
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== "world" || pack.metadata.type !== "Item") continue;
    const wasLocked = pack.locked;
    let docs;
    try {
      docs = await pack.getDocuments();
    } catch {
      continue;
    }
    const updates = [];
    for (const it of docs) {
      if (it.type !== "spellbook") continue;
      const diff = glogConversionDiff(it, glogText);
      if (diff) updates.push({ _id: it.id, ...diff });
    }
    if (!updates.length) continue;
    if (wasLocked) await pack.configure({ locked: false });
    try {
      converted += updates.length;
      await Item.updateDocuments(updates, { pack: pack.collection });
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
    }
  }

  if (converted) {
    ui.notifications.info(game.i18n.format("CAIRN.Notify.GlogConverted", { count: converted }));
  }
};

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
 * The sweep converts what EXISTS at flip time; what ARRIVES afterwards is
 * converted by CairnItem._preCreate calling glogConversionDiff (2026-08-09
 * ruling: there are no spellbooks in GLOG — only Grimoires, their pages, and
 * spellscrolls). Before that seam, a compendium drag landed exactly as
 * stored, which is how a post-flip drop of Haste stayed a book.
 *
 * The Grimoire itself (the flag-marked item, the cast flow) lives in
 * grimoire.js and item.js; this file is only the setting's reach into CONTENT.
 *
 * GRIMOIRES ARE OPTIONAL since 2026-11-20 (user ask: "If GLoG magic is
 * selected, Grimoires should not be enabled by default and all spell books
 * should not automatically convert [to] spell scrolls. They should instead stay
 * spell books but use the GloG magic dice"). Everything above about SCROLLS —
 * the sweep's form change, the create seam's, generation's — is now
 * `glog-grimoires`' (`grimoiresEnabled`), off by default and meaningless
 * without GLOG. GLOG alone swaps the WORDING (every canon spell anywhere wears
 * its GLOG text) and keeps a book a book; the book casts from its own row
 * (grimoire.js `castSpellbook`). A world that already had GLOG on when the
 * option arrived keeps Grimoires (`seedGlogGrimoires`).
 */
import { SETTINGS_NS } from "./settings.js";
import { formatCount } from "./utils.js";

export const GLOG_PACK = "air-bladder.spellbooks-glog";

/**
 * The spell packs a by-NAME grant resolves against under GLOG: the GLOG
 * wordings, then background-items for the class backgrounds' Shield (which
 * has no GLOG counterpart and converts in form only). Canon deliberately
 * absent. The RANDOM pool is not this list any more — it is the declared
 * `Spells — GLOG` table (config.js characterGenerator2e.spells.glog).
 *
 * Until 2026-09-14 this also named the More Spellbooks pack, "the custom set",
 * whose disposition was left open — and that made 217 spells with no GLOG
 * wording at all (no `glog` flag, no [dice], no [sum]) two thirds of the GLOG
 * random pool: a scroll that costs Magic Dice and Mishap risk to cast and does
 * exactly what it says regardless. The user removed the pack from the repo
 * ("including it was a mistake").
 */
export const GLOG_SPELL_PACKS = [GLOG_PACK, "air-bladder.background-items"];

export const glogEnabled = () => {
  try {
    return !!game.settings.get(SETTINGS_NS, "enable-glog-magic");
  } catch {
    return false;   // settings not registered yet (early init)
  }
};

/**
 * Grimoires in force: GLOG on AND its "Use Grimoires" option (2026-11-20). The
 * option is greyed while GLOG is off, but its STORED value survives that, so
 * every reader asks this, never the option alone — the failed career's rule.
 * In force: spellbooks become scrolls (the sweep, the create seam, generation),
 * a Grimoire casts and binds pages. Not: books stay books and cast themselves.
 * @returns {Boolean}
 */
export const grimoiresEnabled = () => {
  if (!glogEnabled()) return false;
  try {
    // Until the active Warden's first load seeds it (seedGlogGrimoires), a
    // world that already plays GLoG reads Grimoires ON, the value the seed
    // will write (review #35): players who joined first found their Grimoire
    // dead and a granted spellbook landing as a book.
    if (!game.settings.get(SETTINGS_NS, "glog-grimoires-seeded")) return true;
    return !!game.settings.get(SETTINGS_NS, "glog-grimoires");
  } catch {
    return false;
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
 * with Grimoires in force (`form`, default `grimoiresEnabled()`), books become
 * scrolls (the document's own _preUpdate pins petty + one unspent use on the
 * flip — the same machinery the sheet checkbox uses, so every path agrees);
 * without them a book stays a book and only its wording changes. An existing
 * scroll keeps its uses untouched, spent staying spent.
 * Where a GLOG counterpart exists (by NAME) the text swaps and `glog` is set;
 * a spell with no counterpart converts in FORM and keeps its own words — its
 * `glog` flag stays false, because the flag marks the wording, not the rules
 * in force. Returns null when the item needs nothing (already conforming).
 */
export const glogConversionDiff = (item, glogText, { form = grimoiresEnabled() } = {}) => {
  const sys = item.system ?? {};
  // A bound Grimoire page is not found magic — it is already INSIDE the book,
  // past the scroll stage. Converting it would set `scroll` while `bound`
  // stays on, which PAGE_PINNED exists to make impossible. This function
  // predates pages (it shipped with the flip sweep; pages came with the item
  // Grimoire), so without this line a flip in a world with an existing
  // Grimoire would turn every page back into a scroll.
  if (sys.bound) return null;
  const diff = {};
  if (form && !sys.scroll) diff["system.scroll"] = true;
  const swap = glogText.get(String(item.name).toLowerCase());
  if (swap !== undefined && sys.description !== swap) diff["system.description"] = swap;
  if (swap !== undefined && !sys.glog) diff["system.glog"] = true;
  return Object.keys(diff).length ? diff : null;
};

/**
 * The swap map for the CREATE seam (CairnItem._preCreate), cached at module
 * level: the sweep runs once per flip and loads the pack fresh, but the seam
 * runs on every spellbook creation, and `pack.getDocuments()` is a full round
 * trip per call — uncached, every compendium drag would re-download the pack.
 * The pack is a locked system pack, so the text is static for a session; the
 * setting's onChange clears the cache anyway, out of caution rather than need.
 */
let glogTextCache = null;
export const glogTextCached = async () => (glogTextCache ??= await glogTextByName());
export const clearGlogTextCache = () => { glogTextCache = null; };

/**
 * The world sweep. Runs on the ACTIVE GM's client only (the enforceSourceFloor
 * precedent — every client hears the onChange; one is allowed to write), and is
 * idempotent by construction: after one pass no canon book remains and every
 * counterpart text already matches, so a second pass builds zero diffs — which
 * is what makes the two-open-tabs quirk harmless.
 *
 * Coverage is the house migration list, all of it: world Items, every actor's
 * owned items, UNLINKED scene tokens (their synthetic actors are not in
 * game.actors — the trap that bit twice), world compendium Item packs, and the
 * owned items of every actor in a world compendium ACTOR pack (packs unlocked
 * for the write and restored after). Prototype tokens carry no items, so actor
 * coverage is their coverage.
 *
 * The Actor packs were missing until review #34 finding 96: a
 * table keeping pregenerated characters or NPC casters in a world Actor pack
 * flipped the hack and kept canon books there, and importing one afterwards
 * landed a canon book — the arrival seam (`CairnItem._preCreate`) never sees
 * items nested inside an Actor create.
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
    // abNoStatusCard: this sweep is a migration in all but name — without the
    // flag, flipping the toggle on a live world greeted every converted book's
    // owners (and the Warden) with one whispered ledger card per spellbook,
    // "By: Gamemaster", because setting `scroll` pins a one-shot `uses`
    // counter into the same write (CairnItem._preUpdate) and `uses` is a
    // ledgered field. The spellscroll migration passes the flag for exactly
    // this (cairn.js); the sweep predates the item ledger and never learned
    // (review #17). Embedded items only — the ledger posts for nothing else.
    if (parent) await parent.updateEmbeddedDocuments("Item", updates, { abNoStatusCard: true });
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

  // World compendium ACTOR packs: every actor's owned spellbooks, written as
  // embedded updates inside the pack.
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== "world" || pack.metadata.type !== "Actor") continue;
    let docs;
    try {
      docs = await pack.getDocuments();
    } catch {
      continue;
    }
    const pending = docs.filter((a) => a.items.some((it) => it.type === "spellbook"
      && glogConversionDiff(it, glogText)));
    if (!pending.length) continue;
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });
    try {
      for (const actor of pending) await convertCollection(actor, actor.items);
    } finally {
      if (wasLocked) await pack.configure({ locked: true });
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
    ui.notifications.info(formatCount("CAIRN.Notify.GlogConverted", converted, { count: converted }));
  }
};

/**
 * The GLOG world conversion WITH its completion marker (review #34 finding
 * 219) — the one way the sweep is run. From the setting's onChange (`force`,
 * since a Warden turning GLOG back on asks for it whatever the marker says)
 * and from the active Warden's ready hook (only while GLOG is on and
 * `glog-converted` is unset), so a sweep cut off by the hacks menu's reload
 * prompt is resumed rather than lost. The marker is set only once the sweep
 * returns: a failed run must retry, never record itself done — the hireling
 * split's rule. Failures are caught and surfaced here, for both callers.
 * @param {{force?: Boolean}} [opts]
 * @returns {Promise<void>}
 */
let sweeping = null;
let sweepAgain = false;
export const resumeGlogConversion = async ({ force = false } = {}) => {
  if (game.users.activeGM !== game.user) return;
  if (!game.settings.get(SETTINGS_NS, "enable-glog-magic")) return;
  if (!force && game.settings.get(SETTINGS_NS, "glog-converted")) return;
  // ONE sweep at a time (review #35): ticking GLoG and Grimoires in one Save
  // fired two forced sweeps over the same documents at once. A call made
  // while one runs is folded into one more pass after it, which reads the
  // settings as they then stand.
  if (sweeping) {
    sweepAgain = true;
    return sweeping;
  }
  sweeping = (async () => {
    try {
      do {
        sweepAgain = false;
        await runGlogConversion();
      } while (sweepAgain);
      await game.settings.set(SETTINGS_NS, "glog-converted", true);
    } catch (err) {
      console.error("air-bladder | GLOG world conversion failed:", err);
      ui.notifications.error(game.i18n.localize("CAIRN.Notify.GlogConversionFailed"));
    } finally {
      sweeping = null;
    }
  })();
  return sweeping;
};

/**
 * Grimoires for a world that ALREADY played GLOG when the option arrived
 * (2026-11-20, the user's pick: "Keep Grimoires on there"). Its spellbooks
 * were converted to scrolls and its players may hold a Grimoire; an update
 * switching that off would change what the table sees, the rule every new
 * option here keeps. So once, on the active Warden's ready: GLOG already on
 * means Grimoires on. A marker (`glog-grimoires-seeded`) makes it a one-shot,
 * set either way, so a Warden who later turns Grimoires off is never
 * overruled, and a new world, which starts with GLOG off, starts with
 * Grimoires off too.
 *
 * Runs BEFORE the ready hook's GLOG resume phase, so a resumed sweep in a
 * seeded world converts with Grimoires already in force.
 * @returns {Promise<void>}
 */
export const seedGlogGrimoires = async () => {
  if (game.users.activeGM !== game.user) return;
  if (game.settings.get(SETTINGS_NS, "glog-grimoires-seeded")) return;
  if (game.settings.get(SETTINGS_NS, "enable-glog-magic")
      && !game.settings.get(SETTINGS_NS, "glog-grimoires")) {
    await game.settings.set(SETTINGS_NS, "glog-grimoires", true);
  }
  await game.settings.set(SETTINGS_NS, "glog-grimoires-seeded", true);
};

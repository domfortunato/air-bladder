/**
 * Content-localization overlay for Air Bladder — DISPLAY-ONLY.
 *
 * UI strings go through Foundry i18n (lang/*.json, merged over English). Compendium
 * CONTENT — item / background / table / monster names and descriptions — does not:
 * it lives in editable packs whose canonical language is ENGLISH. This is a small,
 * in-system equivalent of the Babele module (a system cannot *require* a module, so
 * content Spanish must be intrinsic to the system).
 *
 * DESIGN: translate ONLY at display / emit time; NEVER mutate a stored document and
 * NEVER bake a translated string onto an actor. Consequences that make this the
 * safe choice, and why there is no "slug refactor":
 *   - Every pack doc and every actor item keeps its English name, so all
 *     name-matching stays English<->English: pack resolution (module/gear.js),
 *     table lookups, and the background-swap identity match in
 *     character-generator.js (untagged mundane gear matched by name) are untouched.
 *   - A world that switches language re-localizes for free — nothing was baked.
 *
 * KEYING is by (namespace, normalized English source) — gettext-style, immune to
 * the importer-regenerated _ids — and a miss returns the English source unchanged,
 * so a partial overlay degrades per-string to English and never blanks or throws.
 * The translatable-field taxonomy is defined by tools/i18n/extract-content.mjs;
 * keep the two in step.
 */

// Kept in sync BY HAND with normalizeKey in tools/i18n/lib.mjs (Node vs browser
// module boundary — the same reason buildGearItem is duplicated in the importer).
const normalizeKey = (s) => String(s).replace(/\s+/g, " ").trim();

// { [namespace]: { [normalizedEnglish]: spanish } }, or null in an English world /
// when no overlay ships — in which case every lookup falls back to English.
let OVERLAY = null;

/**
 * Load the content overlay for Foundry's active language. English is canonical, so
 * "en" (or a missing file) leaves the overlay null and every string English. Safe
 * to call more than once; a fetch failure degrades to English, never throws.
 */
export const loadContentOverlay = async () => {
  OVERLAY = null;
  const lang = game.i18n?.lang ?? "en";
  if (lang === "en") return;
  const url = `systems/${game.system.id}/lang/content/${lang}.json`;
  try {
    const data = foundry.utils?.fetchJsonWithTimeout
      ? await foundry.utils.fetchJsonWithTimeout(url)
      : await (await fetch(url)).json();
    if (data && typeof data === "object") OVERLAY = data;
  } catch (_) {
    OVERLAY = null; // no overlay for this language yet — English everywhere
  }
  // A LATE load must not leave already-rendered content in English. This runs on
  // the i18nInit hook, which core fires synchronously and does not await (Hooks
  // .callAll discards the promise), so the fetch above can resolve AFTER a sheet
  // has already rendered — one auto-opened at `ready`, a compendium tab restored
  // from the sidebar. Re-render open document sheets now that the overlay is in,
  // so those correct themselves. A no-op when nothing is open yet (the common
  // case, since i18nInit is early) or when the overlay failed to load.
  refreshLocalizedApps();
};

/**
 * Re-render open document sheets so a late overlay load corrects any content
 * names already drawn in English. Guarded: `foundry.applications.instances` may
 * not exist at i18nInit, and only rendered document sheets are touched.
 */
const refreshLocalizedApps = () => {
  const apps = foundry?.applications?.instances;
  if (!apps) return;
  for (const app of apps.values()) {
    if (app?.document && app.rendered) app.render(false);
  }
};

/** True when a content overlay is loaded (i.e. worth attempting translation). */
export const contentLocalized = () => OVERLAY !== null;

/**
 * Translate one source string within a namespace. Returns the English source on
 * ANY miss (no overlay, unknown namespace, unknown string, or null input). The
 * load-bearing invariant: a miss is the English source verbatim — never blank,
 * never a throw. This is the guarantee the whole design rests on.
 */
export const t = (ns, en) => {
  if (OVERLAY === null || en == null) return en;
  const table = OVERLAY[ns];
  if (!table) return en;
  const hit = table[normalizeKey(en)];
  return hit == null ? en : hit;
};

/**
 * Raw overlay lookup: the translation, or `undefined` on ANY miss — unlike t(), it
 * does NOT fall back to the English source. Use where the written value must be
 * provably from the overlay (e.g. assigning innerHTML): callers get overlay-or-nothing,
 * never the source string, so DOM-read text can never round-trip back out as markup.
 */
export const translationOf = (ns, en) => {
  if (OVERLAY === null || en == null) return undefined;
  const table = OVERLAY[ns];
  if (!table) return undefined;
  const hit = table[normalizeKey(en)];
  return hit == null ? undefined : hit;
};

/**
 * The INVERSE of t(): map a displayed translation back to its English source.
 * Returns the input unchanged on any miss — including when it already IS the
 * English source, or free text the overlay has never seen.
 *
 * Exists for the display/value split on free-text INPUTS (career, Kind): the
 * field SHOWS t(ns, stored) but must STORE canonical English, so the submit
 * path routes what the user left in the box through here. A linear scan per
 * submit over one namespace (~20 careers, ~400 items) — not worth an index
 * that would have to be rebuilt on every overlay load.
 *
 * Deliberately normalized-compare on BOTH sides, same rule as t()'s keying:
 * a translator's trailing space must not fork "Herrero" into a career the
 * catalogue does not know.
 */
export const sourceOf = (ns, display) => {
  if (OVERLAY === null || display == null) return display;
  const table = OVERLAY[ns];
  if (!table) return display;
  const wanted = normalizeKey(display);
  if (wanted === "") return display;
  for (const [en, tr] of Object.entries(table)) {
    if (normalizeKey(tr) === wanted) return en;
  }
  return display;
};

/**
 * The DISPLAY name for an actor under the settled naming ruling (2026-08-04):
 * a character's name is player-authored and NEVER localized — the round-5
 * control caught an ungated lookup renaming a PC that happened to share a
 * creature's name — while every other actor type reads through monster.name,
 * the namespace the extractor files all non-character actor names under.
 * One helper so no call site re-decides the gate.
 */
export const actorDisplayName = (a) =>
  a?.type === "character" ? (a?.name ?? "") : t("monster.name", a?.name ?? "");

/**
 * The same ruling applied to a TOKEN. The token's OWN name is what everyone sees
 * on the canvas and it is not always the actor's — a Warden renaming a token
 * "Goblin A" means the card must say "Goblin A", not "Goblin". A hand-renamed
 * token simply misses the overlay and `t` hands it straight back, so this needs
 * no separate case; only the character gate has to be preserved.
 */
export const tokenDisplayName = (tok) =>
  tok?.actor?.type === "character" ? (tok?.name ?? "") : t("monster.name", tok?.name ?? "");

/**
 * Return a shallow copy of an item-like object ({ name, system: { description } })
 * with its display name/description translated under the given namespaces. The
 * original is NEVER mutated — callers hand this to a template, never back to a
 * document. Defaults to the Item namespaces; pass bg.* / monster.* for those kinds.
 * Returns the input unchanged when nothing translates (no overlay, or all misses).
 */
export const localizeNameDesc = (obj, { nameNs = "item.name", descNs = "item.desc" } = {}) => {
  if (OVERLAY === null || !obj) return obj;
  const name = t(nameNs, obj.name);
  const description = t(descNs, obj.system?.description);
  if (name === obj.name && description === obj.system?.description) return obj;
  return { ...obj, name, system: { ...obj.system, description } };
};

/**
 * Test / probe hook: install an overlay object directly, bypassing the fetch.
 * Used by offline unit checks and by the dev "partial overlay" fallback test.
 * Not part of the runtime path.
 */
export const _setOverlay = (data) => { OVERLAY = data; };

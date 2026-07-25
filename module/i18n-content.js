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

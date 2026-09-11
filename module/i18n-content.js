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
 * The world sidebar tabs whose entry names this system rewrites: the hook that
 * localizes each, and the `ui` key that reaches the same application.
 *
 * ONE list, read twice — `cairn.js` registers the render hooks from it, and
 * `refreshLocalizedApps` below re-renders from it. Two lists is how a fifth
 * directory gets a hook and no late-load refresh, which stays invisible until
 * somebody's overlay fetch is slow.
 */
export const LOCALIZED_DIRECTORIES = [
  { hook: "ActorDirectory", ui: "actors" },
  { hook: "ItemDirectory", ui: "items" },
  { hook: "JournalDirectory", ui: "journal" },
  { hook: "RollTableDirectory", ui: "tables" },
];

/**
 * Re-render what a late overlay load left in English.
 *
 * It used to touch ONLY `app.document && app.rendered`, and the comment above
 * its one caller named "a compendium tab restored from the sidebar" as the case
 * it existed for — which that test excludes, because a Compendium window carries
 * `.collection` and never `.document` (verified 14.365). So did every other
 * surface this system localizes: all four world directory tabs, the compendium
 * sidebar and the combat tracker are applications without a `.document` too.
 * Review #16.
 *
 * The sidebar tabs are NAMED rather than swept by `.collection`, because that
 * property does not separate them from the tabs that must be left alone —
 * `ChatLog` carries one as well, and re-rendering a long chat log to correct a
 * directory row is not a trade worth making. The compendium SIDEBAR carries
 * neither property, so no sweep could have found it at all.
 *
 * Guarded throughout: this runs at i18nInit, where `foundry.applications` and
 * `ui` may not be populated, and it is a no-op when nothing is open — the
 * common case, since i18nInit is early.
 */
export const refreshLocalizedApps = () => {
  for (const app of foundry?.applications?.instances?.values() ?? []) {
    if (!app?.rendered) continue;
    // A document sheet, or an open compendium BROWSER. `metadata.packageName`
    // is what tells a CompendiumCollection from the other collections a
    // sidebar tab can be holding.
    if (app.document || app.collection?.metadata?.packageName) app.render(false);
  }
  for (const key of [...LOCALIZED_DIRECTORIES.map((d) => d.ui), "compendium", "combat"]) {
    const app = globalThis.ui?.[key];
    if (app?.rendered) app.render(false);
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
 * A chat message SPEAKER's name as THIS viewer's card header shows it
 * (cairn.js `localizeSpeakerName`, review #19): the token's where the message
 * was spoken as one, the world actor's otherwise, and the stored alias when
 * nothing resolves or the alias was not the actor's own name (a Warden's
 * "Goblin A" stays "Goblin A"; a PC never localizes — the two helpers above
 * carry that gate). One resolver, shared by every flavor that is rebuilt per
 * viewer (GLOG cast cards, initiative save cards), so a card's flavor and its
 * header can never disagree about a name.
 * @param {ChatMessage} message
 * @param {String} alias  the alias the card was composed with
 * @return {String}
 */
export const speakerDisplayName = (message, alias) => {
  const speaker = message?.speaker ?? {};
  const token = speaker.scene && speaker.token
    ? game.scenes?.get(speaker.scene)?.tokens?.get(speaker.token) : null;
  if (token) return tokenDisplayName(token) || alias;
  const actor = speaker.actor ? game.actors?.get(speaker.actor) : null;
  if (!actor || actor.name !== alias) return alias;
  return actorDisplayName(actor) || alias;
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
 * Block-level tags a journal page is translated at, ONE lookup per element.
 * MUST stay identical to BLOCK_TAGS in tools/i18n/content-strings.mjs: the
 * extractor emits `node.innerHTML` for exactly these and the overlay is keyed on
 * it, so a tag in one list and not the other is a key nothing ever asks for.
 * `npm run dev:journal-i18n` is what holds the two honest — it collects the real
 * rendered DOM's keys and checks the extractor emits every one.
 *
 * IT LIVES HERE, beside `translationOf`, because two surfaces render journal
 * prose now: the journal sheet (`cairn.js`) and the Vald calendar's festival
 * panel. It moved out of `cairn.js` on 2026-09-10 so the "must stay identical
 * to the extractor" contract has ONE home rather than one per reader.
 */
export const JOURNAL_BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption";

/**
 * Translate a rendered page's prose, paragraph by paragraph.
 *
 * PARAGRAPH-level, ruled 2026-08-14: a page here is one `text.content` string of
 * up to 14,000 characters, so keying the overlay on the whole page would hand a
 * translator a rulebook page in one cell and orphan all of it on any English
 * edit. Split this way an edit costs only the sentences it touched.
 *
 * Nested blocks are skipped so only the INNERMOST block owns its text — a `<li>`
 * wrapping a nested list yields the inner items, never the outer's concatenation
 * of them, which would otherwise be keyed on a string that is also its own
 * children and fight them at render.
 *
 * `translationOf`, never `t`: the value written to innerHTML is then provably
 * from our own overlay JSON and DOM text can never round-trip back out as
 * markup — the same rule `swapResultNode` in `cairn.js` is written to.
 */
export const localizeJournalBlocks = (root) => {
  if (!root) return;
  for (const node of root.querySelectorAll(JOURNAL_BLOCKS)) {
    if (node.querySelector(JOURNAL_BLOCKS)) continue;
    const en = node.innerHTML.trim();
    if (!en) continue;
    const es = translationOf("journal.block", en);
    if (es !== undefined && es !== en) node.innerHTML = es;
  }
};

/**
 * Test / probe hook: install an overlay object directly, bypassing the fetch.
 * Used by offline unit checks and by the dev "partial overlay" fallback test.
 * Not part of the runtime path.
 */
export const _setOverlay = (data) => { OVERLAY = data; };

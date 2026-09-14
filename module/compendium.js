
/**
 * @param {String} compendiumString
 * @returns {Array.<String>}
 */
export const compendiumInfoFromString = (compendiumString) => compendiumString.split(";");

/**
 * Find one document in a pack by exact name.
 *
 * Matches in the pack INDEX (names only, kept in memory and updated live when a
 * document changes), then materializes just that document with `getDocument` —
 * which returns the already-loaded instance when there is one. `getDocuments()`
 * here loaded and constructed EVERY document in the pack to read one name off
 * each, and this is called once per lookup: opening the marketplace resolves ~77
 * compendium results, so it re-read whole packs 77 times.
 *
 * This is the same mistake `gear.js` `resolveGearItem` already documents fixing
 * ("twenty names went 34.5s -> 5.2s"); the fix is deliberately the same shape.
 *
 * Still not cached, for the same reason it is not cached there: an in-session
 * edit to a compendium item must show up on the next lookup — that is the point
 * of the editable-compendium model.
 *
 * @param {String} compendiumName
 * @param {String} itemName
 * @returns {Promise.<Item|RollTable|undefined>}
 */
export const findCompendiumItem = async (compendiumName, itemName) => {
  const compendium = game.packs.get(compendiumName);
  if (!compendium) {
    console.warn(`findCompendiumItem: Could not find compendium (${compendiumName})`);
    return undefined;
  }
  const entry = (await compendium.getIndex()).find((e) => e.name === itemName);
  if (!entry) {
    console.warn(`findCompendiumItem: Could not find item (${itemName}) in compendium (${compendiumName})`);
    return undefined;
  }
  // getDocument resolves to null (not undefined) if the index is stale; normalize,
  // because every caller tests falsy and the JSDoc has always promised undefined.
  return (await compendium.getDocument(entry._id)) ?? undefined;
};

/**
 * Find a RollTable by exact name — WORLD FIRST, then every RollTable pack.
 *
 * By name rather than by uuid, deliberately: a uuid pointing into one world's
 * pack is dead the moment the content is shared. The world collection is
 * looked at FIRST because that is the easiest thing for a Warden to make —
 * Tables tab, New Table — so a Warden's own copy always wins and their edits
 * survive a system update, which would overwrite any edit made inside a
 * shipped pack. (Generalized from character-generator.js's module-private
 * findBondsTableByName, which this replaces; the bonds path and the Faction
 * die both resolve through here.)
 * @param {String} name
 * @returns {Promise<RollTable|null>}
 */
export const findTableByName = async (name) => {
  const wanted = String(name).trim();
  const world = game.tables?.find((t) => t.name === wanted);
  if (world) return world;
  for (const pack of game.packs) {
    if (pack.metadata.type !== "RollTable") continue;
    const entry = (await pack.getIndex()).find((e) => e.name === wanted);
    if (entry) return pack.getDocument(entry._id);
  }
  return null;
};

/**
 * A DECLARED table — `"pack;Name"` as `module/config.js` writes them, or a bare
 * `"Name"` — resolved WORLD FIRST (2026-09-13).
 *
 * A world RollTable of the same name wins; otherwise the declared pack is
 * read, and a bare name hunts every RollTable pack (`findTableByName`). So the
 * pack half of a declaration is the FALLBACK, never a lock: it says where the
 * shipped copy lives, precisely, which is why declarations keep it rather than
 * going bare like `Warden: NPC - Faction` did.
 *
 * Until this existed, twenty-two of this system's tables answered TWO WAYS
 * depending on the button. The Warden's Dashboard resolves every table
 * world-first (`findTableByName`), while the generators read the pack copy
 * behind the prefix — so a Warden's own `Warden: NPC - Quirk` came up on the
 * Dashboard button and never in a generated NPC. And the pack copy is the one
 * a Warden cannot keep: Foundry's installer deletes a package's whole
 * directory before extracting an update (`dist/packages/installer.mjs`), so
 * an edit made inside a shipped compendium is gone at the next version. One
 * resolver, and the two routes agree.
 * @param {String} decl
 * @returns {Promise<RollTable|undefined>}
 */
export const findDeclaredTable = async (decl) => {
  const [packName, tableName] = compendiumInfoFromString(String(decl ?? ""));
  const bare = tableName === undefined;
  const name = (bare ? packName : tableName)?.trim() ?? "";
  if (!name) return undefined;
  const world = game.tables?.find((t) => t.name === name);
  if (world) return world;
  if (bare) return (await findTableByName(name)) ?? undefined;
  return findCompendiumItem(packName, name);
};

/**
 * Roll a declared table. `roll()`, NEVER `draw()`, and the difference is one
 * write: `draw` marks the rows it lands on `drawn: true` on any table that is
 * neither `replacement` nor in a pack (client/documents/roll-table.mjs:109),
 * and now that a declaration can resolve to a WORLD table, that is a write into
 * a table the Warden browses and rolls by hand. These are the Warden's tables
 * and their drawn state stays clean — the invariant `module/config.js` states
 * and the monster generator and `rollNameFromTable` already kept; this was the
 * one reader still on `draw`, for eight biography tables and five NPC ones.
 *
 * TWO THINGS `roll()` STILL DOES, recorded because this line said "writes
 * nothing" for a day (review #30). It READS the drawn state — rows a Warden's
 * own hand draws marked on a no-replacement world table are skipped
 * (roll-table.mjs:280,342), so such a table narrows generation until
 * `TABLE.NoAvailableResults` and an empty string, which is core's own
 * semantics for the choice the Warden made and is left alone here. And a
 * world table whose STORED formula is blank is normalized and SAVED on the
 * first roll (roll-table.mjs:270-274): ranges re-sequenced by weight, in row
 * order, `1dN` written — harmless for a generator's table, and the reason the
 * marketplace's re-sort writes `1dN` itself (marketplace.js). The scar roll
 * takes neither path: its roll is a constant, and `damage.js` selects the row
 * by range directly.
 *
 * Resolves to undefined on a missing table — `findDeclaredTable` only warns —
 * so a generator degrades instead of throwing "Cannot read properties of
 * undefined" mid-generation with no mention of which table was missing. The
 * guard in damage.js `_rollScarsTable` says the same thing.
 * @param {String} decl  "pack;Name" or "Name"
 * @param {Object} [options]
 * @param {Roll} [options.roll]  an existing Roll to select the row with
 * @returns {Promise.<{roll: Roll, results: TableResult[]}|undefined>}
 */
export const rollTable = async (decl, { roll } = {}) => {
  const table = await findDeclaredTable(decl);
  if (!table) return undefined;
  return table.roll(roll ? { roll } : {});
};

/**
 * A rolled result's narrative text.
 *
 * `TableResult#text` is DEPRECATED — `{since: 13, until: 15}`, one major sooner than
 * the AppV1 sheets — and survives only as a shim that logs a compatibility warning on
 * every read (common/documents/table-result.mjs:89-94). This is what it did: a text row
 * keeps its prose in `description`, and any other row type (a document reference) is
 * identified by `name`.
 *
 * It lives HERE, next to the other table readers, and not in character-generator.js
 * where it was written. It was applied at exactly one of its call sites for three
 * months — the sheet, the importer, the shop and the generator itself each kept
 * reading `.text` — and a helper nobody can find in the module they are editing is
 * how that happens.
 *
 * @param {TableResult} result
 * @returns {String}
 */
export const resultText = (result) =>
  (result?.type === "text" ? result.description : result?.name) ?? "";

/**
 * A rolled result rendered the way it would appear in chat: prose for a text row,
 * a content link for a document row.
 *
 * Replaces `TableResult#getChatText()`, deprecated `{since: 13, until: 15}`
 * (client/documents/table-result.mjs:120-124). The body is core's own expression
 * from that method, so the output is byte-identical to what shipped.
 *
 * `getHTML()` is core's nominated successor and is NOT a drop-in here. It is async,
 * it enriches to real HTML, and it wraps the result in a template — whereas this
 * value is stored on the actor as one of the eight 2e trait strings and rendered as
 * plain text. Swapping it in would put markup into `system.traits.*` on every
 * generated character, and the content-translation overlay keys on the English
 * source string, so every trait would also lose its translation.
 *
 * @param {TableResult} result
 * @returns {String}
 */
export const resultChatText = (result) =>
  (result?.type === CONST.TABLE_RESULT_TYPES.DOCUMENT
    ? `@UUID[${result.documentUuid}]{${result.name}}`
    : result?.description) ?? "";

/**
 * One rolled result's chat text off a declared table.
 * @param {String} decl  "pack;Name" or "Name"
 * @returns {Promise.<String>}  the result's chat text, or "" if the table is
 *                              missing or empty (generation must degrade, not throw)
 */
export const rollTableText = async (decl) => {
  const rolled = await rollTable(decl);
  return resultChatText(rolled?.results?.[0]);
};

/**
 * One rolled result as PLAIN TEXT off a declared table — a document row's name,
 * a text row's prose, trimmed — for a reader that composes the value into a
 * NAME rather than storing it as chat text.
 *
 * The monster generator's reader (review #30). Its private copy returned
 * `resultText(...).trim()`; the shared `rollTableText` above it was folded
 * into returns `resultChatText`, which renders a DOCUMENT row as
 * `@UUID[...]{name}` — right for a 2e trait string that chat enriches, wrong
 * in a monster's name, where it read as the literal `@UUID[Item.xxxx]{Rusty
 * Blade}` and matched nothing in `ARMORED_FEATURES`. Reachable only since
 * the declarations went world-first: a Warden's own table can hold a dragged
 * document row where the shipped ones hold text.
 * @param {String} decl  "pack;Name" or "Name"
 * @returns {Promise.<String>}  the row's plain text, or "" on a missing table
 */
export const rollTablePlainText = async (decl) => {
  const rolled = await rollTable(decl);
  return resultText(rolled?.results?.[0]).trim();
};

/**
 * The documents a table's results point at.
 *
 * Resolves each row by its `documentUuid`, which is the only non-deprecated way to
 * do it: `documentCollection` (common/documents/table-result.mjs:115-123) and
 * `documentId` (:102-107) both go in v15, and `TABLE_RESULT_TYPES.COMPENDIUM` with
 * them (common/constants.mjs:954-964) — v13 merged the "compendium" row type into
 * "document".
 *
 * That merge is why a row dragged in from the ITEMS SIDEBAR is silently missing
 * from the shop today. The type check is not what drops it: the deprecated
 * `COMPENDIUM` getter returns `"document"`, so a world row matches. It dies one line
 * later, in `findCompendiumItem(result.documentCollection, …)` — for a world
 * document that getter returns the document NAME ("Item"), which is not a pack id,
 * so the lookup warns and returns undefined. `fromUuid` resolves both kinds.
 *
 * Resolving by uuid also means resolving by ID, so renaming an item in a pack no
 * longer breaks every table that points at it. All 198 shipped document rows carry
 * a `documentUuid`; there is no row this cannot resolve that the name lookup could.
 *
 * A row that resolves to nothing is warned about rather than skipped in silence —
 * that is a broken content reference, and `findCompendiumItem` used to say so.
 *
 * @param {TableResult[]} results
 * @returns {Promise.<Document[]>}
 */
export const findTableItems = async (results) => {
  const items = [];
  for (const result of results) {
    if (result.type !== CONST.TABLE_RESULT_TYPES.DOCUMENT) continue;
    const doc = await fromUuid(result.documentUuid);
    if (doc) items.push(doc);
    else console.warn(`findTableItems: unresolvable result uuid (${result.documentUuid})`);
  }
  return items;
};

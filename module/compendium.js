
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
 * @param {String} compendiumName
 * @param {String} tableName
 * @param {Object} options
 * @returns {Promise.<RollTableDraw|undefined>}
 */
export const drawTable = async (compendiumName, tableName, options = {}) => {
  // findCompendiumItem resolves to undefined on a miss (it only warns), so this
  // used to throw "Cannot read properties of undefined" from wherever the draw
  // was requested — mid-generation, with no mention of the missing table. The
  // guard in damage.js `_rollScarsTable` says the same thing; this is the other
  // call site it did not cover.
  const table = await findCompendiumItem(compendiumName, tableName);
  if (!table) return undefined;
  return table.draw({ displayChat: false, ...options });
};

/**
 * @param {String} compendium
 * @param {String} table
 * @returns {Promise.<String>}  the drawn result's chat text, or "" if the table
 *                              is missing or empty (generation must degrade, not throw)
 */
export const drawTableText = async (compendium, table) => {
  const draw = await drawTable(compendium, table);
  return draw?.results?.[0]?.getChatText() ?? "";
};

/**
 * @param {String} compendium
 * @param {String} table
 * @returns {Promise.<Item[]>}
 */
export const drawTableItem = async (compendium, table) => {
  const draw = await drawTable(compendium, table);
  return findTableItems(draw?.results ?? []);
};

/**
 * @param {TableResult[]} results
 * @returns {Promise.<Item[]>}
 */
export const findTableItems = async (results) => {
  const items = [];
  let item = null;
  for (const result of results) {
    if (result.type === CONST.TABLE_RESULT_TYPES.COMPENDIUM) {
      item = await findCompendiumItem(result.documentCollection, result.text);
      if (item) {
        items.push(item);
      }
    }
  }
  return items;
};

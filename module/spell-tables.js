/**
 * The Warden's spell-table reseed (ruling 2026-08-05: ship maintained tables +
 * a reseed action).
 *
 * The shipped "Spells — Canon (1d100)" table is a SNAPSHOT — Foundry has no
 * dynamic pack-backed table, so a table a Warden imports into the world and a
 * pack they then edit drift apart. This closes the loop: rebuild a WORLD
 * table's rows from a chosen Item compendium's index, UPDATE-IN-PLACE — the
 * TableResults are replaced and the formula rewritten, but the table's id,
 * name, folder and ownership survive, so every `@UUID` link pointing at the
 * table keeps working. (Deleting and re-creating the table was the obvious
 * shape and is exactly wrong for that reason.)
 *
 * Only spellbook-type entries seed rows — an unlocked pack accepts any item,
 * and a Dagger dropped into a spell pack must not become a rollable spell.
 * A source with NO spellbooks refuses outright instead of emptying the table:
 * an empty result is never what "reseed" meant, and the refusal is the
 * probe's negative control.
 *
 * Rows come out alphabetical by name, the same order the shipped importer
 * (tools/import/spell-tables.mjs) writes, so a reseeded world copy and the
 * shipped table agree row-for-row over identical content.
 */

/**
 * Rebuild `table`'s rows from `pack`'s index. Returns the number of rows
 * written, or 0 if the pack held no spellbooks (the table is left untouched).
 * @param {RollTable} table
 * @param {CompendiumCollection} pack
 * @returns {Promise<number>}
 */
export const reseedTableFromPack = async (table, pack) => {
  const index = await pack.getIndex();
  const entries = index.filter((e) => e.type === "spellbook")
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.EmptySpellSource", { pack: pack.title }));
    return 0;
  }
  const rows = entries.map((e, i) => ({
    type: CONST.TABLE_RESULT_TYPES.DOCUMENT,
    name: e.name,
    img: e.img,
    documentUuid: e.uuid,
    weight: 1,
    range: [i + 1, i + 1],
    drawn: false,
  }));
  // Replace the EMBEDDED documents, never the table: delete → create → formula.
  await table.deleteEmbeddedDocuments("TableResult", table.results.map((r) => r.id));
  await table.createEmbeddedDocuments("TableResult", rows);
  await table.update({ formula: `1d${rows.length}` });
  ui.notifications.info(game.i18n.format("CAIRN.Notify.TableReseeded", {
    name: table.name, count: rows.length, pack: pack.title,
  }));
  return rows.length;
};

/**
 * The directory-button flow: pick a world table and a source compendium,
 * then reseed. Warden-only — RollTable writes are GM-gated anyway; checking
 * here turns a silent permission failure into a message.
 * @returns {Promise<number|null>} rows written, 0 on refusal, null on cancel
 */
export const reseedSpellTable = async () => {
  if (!game.user.isGM) return null;
  const L = (k) => game.i18n.localize(k);
  const tables = [...game.tables].sort((a, b) => a.name.localeCompare(b.name));
  if (!tables.length) {
    ui.notifications.warn(L("CAIRN.Notify.NoWorldTables"));
    return null;
  }
  const esc = foundry.utils.escapeHTML;
  const packs = game.packs.filter((p) => p.metadata.type === "Item");
  const content = `
    <div class="form-group">
      <label>${L("CAIRN.ReseedTablePick")}</label>
      <select name="table">
        ${tables.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}
      </select>
    </div>
    <div class="form-group">
      <label>${L("CAIRN.ReseedSourcePack")}</label>
      <select name="pack">
        ${packs.map((p) => `<option value="${esc(p.collection)}"${p.collection === "air-bladder.spellbooks" ? " selected" : ""}>${esc(p.title)}</option>`).join("")}
      </select>
    </div>`;
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: L("CAIRN.ReseedSpellTable"), icon: "fas fa-arrows-rotate" },
    position: { width: 420 },
    content,
    buttons: [
      {
        action: "reseed",
        label: L("CAIRN.Reseed"),
        icon: "fas fa-arrows-rotate",
        default: true,
        // Read here, not from a form submit — DialogV2 hands the button its
        // own form element (the kettlewright-import options precedent).
        callback: (_ev, button) => ({
          tableId: button.form?.elements?.table?.value,
          packId: button.form?.elements?.pack?.value,
        }),
      },
      { action: "cancel", label: L("CAIRN.Cancel"), callback: () => null },
    ],
    rejectClose: false,
  });
  if (!picked?.tableId || !picked?.packId) return null;   // ✕ or Cancel: touch nothing
  const table = game.tables.get(picked.tableId);
  const pack = game.packs.get(picked.packId);
  if (!table || !pack) return null;
  return reseedTableFromPack(table, pack);
};

/**
 * Build the `documentUuid` a RollTable result needs, for the importers that
 * generate tables (marketplace, transports, barebones).
 *
 * Foundry v13 replaced a result's `documentCollection` + `documentId` pair with a
 * single `documentUuid`, and the old fields are shims removed in v15
 * (common/documents/table-result.mjs:102-123). The importers were still emitting
 * the pair — and `type: pack`, which v13 merged into `type: document`
 * (common/constants.mjs:954-964) — so every table they generated arrived in a
 * shape that only loads because `BaseTableResult.migrateData` rewrites it.
 *
 * The document type is read from `system.json` rather than guessed, because
 * Barebones tables reference BOTH items and other RollTables and the uuid differs
 * ("…air-bladder.weapons.Item.xyz" vs "…air-bladder.tables-barebones.RollTable.xyz").
 * Guessing "Item" produced a uuid that resolves to nothing, which is a broken gear
 * grant with no error attached to it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { packs } = JSON.parse(fs.readFileSync(path.join(root, "system.json"), "utf8"));
const DOC_TYPE = new Map(packs.map((p) => [`air-bladder.${p.name}`, p.type]));

/**
 * @param {String} packRef  a full pack id, e.g. "air-bladder.weapons"
 * @param {String} id       the document's _id within that pack
 * @returns {String}        "Compendium.<pack>.<DocumentName>.<id>"
 * @throws if the pack is not declared in system.json, or the id is empty — both
 *         would otherwise emit a uuid that silently resolves to nothing.
 */
export const packUuid = (packRef, id) => {
  const type = DOC_TYPE.get(packRef);
  if (!type) throw new Error(`packUuid: "${packRef}" is not a pack declared in system.json`);
  if (!id) throw new Error(`packUuid: no document id given for ${packRef}`);
  return `Compendium.${packRef}.${type}.${id}`;
};

/**
 * Probe: the editable custom-background authoring sheet.
 * Verifies the editor renders, its class-managed handlers persist array edits,
 * drag-to-snapshot lands onto gear AND a table option, and generation resolves a
 * snapshot that lives in NO canonical pack.
 *
 *   node tools/dev/probe-bg-author.mjs
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

const result = await page.evaluate(async () => {
  const out = {};
  const SWORD = "Probe Snapshot Blade ZZ";

  // AppV1's `element` is a jQuery object; ApplicationV2's is the HTMLElement.
  // Works either way so this probe survives the sheet migration.
  const sheetRoot = (app) => (app.element instanceof HTMLElement ? app.element : app.element?.[0]);

  // A source item that exists in NO canonical pack, so if it resolves at
  // generation it can only have come from the snapshot.
  const src = await Item.create({
    name: SWORD, type: "weapon",
    system: { damageFormula: "d8", bulky: true },
  });

  const bg = await Item.create({
    name: "Probe Background ZZ", type: "background",
    system: { source: "2e", archetype: "Fighter", names: [], startingGear: [], tables: [] },
  });

  const sheet = bg.sheet;
  await sheet.render(true);
  for (let i = 0; i < 30 && !sheet.element; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const root = sheetRoot(sheet);
  if (!root) { out.error = "sheet element never rendered"; return out; }

  out.hasEditor = !!root.querySelector(".background-editor");
  // Source is deliberately NOT a pick-list: a GM must not be able to make their
  // background undiscoverable by choosing another source. It renders as fixed text.
  out.sourceVal = root.querySelector(".bg-source-fixed")?.textContent.trim();
  out.archetypeVal = root.querySelector('select[name="system.archetype"]')?.value;
  out.tableCount = root.querySelectorAll(".bg-edit-table").length;
  out.optionCount = root.querySelectorAll(".bg-edit-option").length;
  out.optionDropZones = root.querySelectorAll('[data-drop="option"]').length;

  // Handler: add an example name via a real click. Under ApplicationV2 this is a
  // declarative `data-action`, so a native click is what exercises the wiring —
  // there is no handler bound to the element to trigger directly any more.
  root.querySelector(".bg-name-add")?.click();
  await new Promise((r) => setTimeout(r, 400));
  out.namesAfterAdd = (bg.system.names ?? []).length;

  // Drop the sword onto the starting-gear zone.
  const drop = async (selector) => {
    const target = root.querySelector(selector);
    const ev = {
      target,
      preventDefault() {}, stopPropagation() {},
      dataTransfer: { getData: () => JSON.stringify({ type: "Item", uuid: src.uuid }) },
    };
    await sheet._onDrop(ev);
    await new Promise((r) => setTimeout(r, 200));
  };
  await drop('[data-drop="gear"]');
  const gear0 = (bg.system.startingGear ?? [])[0];
  out.gearSnapshot = { name: gear0?.name, hasItemData: !!gear0?.itemData, type: gear0?.itemData?.type, bulky: gear0?.itemData?.system?.bulky };

  // Drop the sword onto table 0, option 0.
  await drop('[data-drop="option"][data-t="0"][data-o="0"]');
  const optItem = bg.system.tables?.[0]?.options?.[0]?.items?.[0];
  out.optionSnapshot = { name: optItem?.name, hasItemData: !!optItem?.itemData };

  // Give option 0 the ONLY nonempty description + a gold grant so the d6 roll,
  // whatever it lands on, has a defined answer; then force-generate from this bg.
  const tables = foundry.utils.deepClone(bg.system.tables);
  for (const o of tables[0].options) { o.description = "You found it."; o.bonusGold = 5; }
  for (const o of tables[1].options) { o.description = "So it goes."; }
  await bg.update({ "system.tables": tables });

  // Generation must resolve the snapshot even though SWORD is in no pack. Starting
  // gear is folded into `items`, tagged grantSource "background"; the question's
  // rolled option tags its grant "question:0".
  const cd = await game.cairn.characterGenerator.generate2eCharacter(bg);
  const gs = (g) => g.flags?.["air-bladder"]?.grantSource;
  out.genItemNames = (cd?.items ?? []).map((g) => g.name);
  out.genHasSnapshotGear = (cd?.items ?? []).some((g) => g.name === SWORD && gs(g) === "background");
  out.genQuestionGrantedSnapshot = (cd?.items ?? []).filter((g) => g.name === SWORD && String(gs(g)).startsWith("question:")).length;

  // Bonds: one by default, two once the author ticks "Grants two bonds". Asserted in
  // BOTH directions in one pass, so the check is its own negative control — a field
  // the generator ignored would give 1 and 1. This background's description says
  // nothing about bonds, so the prose path (`mentionsSecondBond`) is not in play.
  out.hasSecondBondBox = !!root.querySelector('input[name="system.secondBond"]');
  out.bondsDefault = (cd?.bonds ?? []).length;
  out.bondsDefaultFrom2e = (cd?.bonds ?? []).every((b) => (b.description ?? "").length > 0);
  await bg.update({ "system.secondBond": true });
  const cd2 = await game.cairn.characterGenerator.generate2eCharacter(bg);
  out.bondsWithFlag = (cd2?.bonds ?? []).length;

  // A bonds table of the author's own: a plain world RollTable, named on the
  // background. One row, so the drawn text is knowable, and NO flags — which is the
  // point: a hand-made table cannot carry the gold/gear payload the 2e rows do, so the
  // bond must come back with the text and zero gold rather than fabricating either.
  out.hasBondsTableField = !!root.querySelector('input[name="system.bondsTable"]');
  const BOND_TEXT = "You owe the ferryman a debt he will collect.";
  const customTable = await getDocumentClass("RollTable").create({
    name: "ZZ Probe Bonds",
    formula: "1d1",
    results: [{ type: "text", description: BOND_TEXT, range: [1, 1] }],
  });
  await bg.update({ "system.bondsTable": "ZZ Probe Bonds", "system.secondBond": false });
  const cd3 = await game.cairn.characterGenerator.generate2eCharacter(bg);
  out.customBond = {
    count: (cd3?.bonds ?? []).length,
    description: cd3?.bonds?.[0]?.description ?? null,
    gold: cd3?.bonds?.[0]?.gold ?? null,
  };

  // A name that resolves to nothing must fall back to the 2e table, not to no bond.
  await bg.update({ "system.bondsTable": "ZZ No Such Table" });
  const cd4 = await game.cairn.characterGenerator.generate2eCharacter(bg);
  out.missingTableFallback = {
    count: (cd4?.bonds ?? []).length,
    isCustom: (cd4?.bonds?.[0]?.description ?? "") === BOND_TEXT,
  };
  await customTable.delete();
  await bg.update({ "system.bondsTable": "" });

  // A LOCKED shipped background must still render the read-only view (that path
  // was refactored alongside the editor).
  const roPack = game.packs.get("air-bladder.backgrounds-2e");
  const roDocs = await roPack.getDocuments();
  const roBg = roDocs.find((d) => d.name === "Jongleur") ?? roDocs[0];
  const roSheet = roBg.sheet;
  await roSheet.render(true);
  for (let i = 0; i < 30 && !roSheet.element; i++) await new Promise((r) => setTimeout(r, 100));
  const roRoot = sheetRoot(roSheet);
  out.readOnly = {
    locked: roPack.locked,
    hasReadOnly: !!roRoot.querySelector(".background-details"),
    hasEditor: !!roRoot.querySelector(".background-editor"),
    gearListed: roRoot.querySelectorAll(".background-gear li").length,
    tables: roRoot.querySelectorAll(".background-table").length,
  };
  await roSheet.close();

  await bg.delete();
  await src.delete();
  return out;
});

await browser.close();

const checks = [
  ["editor renders", result.hasEditor === true],
  ["source shown as fixed text", result.sourceVal === "Cairn 2e"],
  ["archetype = Fighter", result.archetypeVal === "Fighter"],
  ["2 tables padded", result.tableCount === 2],
  ["12 options padded", result.optionCount === 12],
  ["12 option drop zones", result.optionDropZones === 12],
  ["name-add handler persists", result.namesAfterAdd === 1],
  ["gear drop → snapshot w/ itemData", result.gearSnapshot.hasItemData === true && result.gearSnapshot.name === "Probe Snapshot Blade ZZ"],
  ["gear snapshot kept type+bulky", result.gearSnapshot.type === "weapon" && result.gearSnapshot.bulky === true],
  ["option drop → snapshot w/ itemData", result.optionSnapshot.hasItemData === true],
  ["generation resolved snapshot gear (not in any pack)", result.genHasSnapshotGear === true],
  ["\"Grants two bonds\" box on the authoring form", result.hasSecondBondBox === true],
  ["one bond by default, two with the box ticked", result.bondsDefault === 1 && result.bondsWithFlag === 2],
  ["default bonds carry text (the 2e table resolved)", result.bondsDefaultFrom2e === true],
  ["\"Bonds table\" field on the authoring form", result.hasBondsTableField === true],
  ["a named world table supplies the bond text", result.customBond?.count === 1 && result.customBond?.description === "You owe the ferryman a debt he will collect."],
  ["a hand-made row grants no gold (narrative only)", result.customBond?.gold === 0],
  ["an unresolvable table name falls back to 2e, not to nothing", result.missingTableFallback?.count === 1 && result.missingTableFallback?.isCustom === false],
  ["locked shipped bg → read-only view", result.readOnly?.hasReadOnly === true && result.readOnly?.hasEditor === false],
  ["read-only view lists gear + 2 tables", result.readOnly?.gearListed > 0 && result.readOnly?.tables === 2],
];

console.log(`\n${FOUNDRY_URL}\n`);
let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
console.log("\n", JSON.stringify(result, null, 2));
if (errors.length) { ok = false; console.log("\nConsole errors:\n" + errors.join("\n")); }
console.log(ok ? "\nprobe passed\n" : "\nprobe FAILED\n");
process.exit(ok ? 0 : 1);

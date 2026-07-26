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
  await sheet._render(true);
  for (let i = 0; i < 30 && !(sheet.element && sheet.element[0]); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const root = sheet.element[0];
  if (!root) { out.error = "sheet element never rendered"; return out; }

  out.hasEditor = !!root.querySelector(".background-editor");
  out.sourceVal = root.querySelector('select[name="system.source"]')?.value;
  out.archetypeVal = root.querySelector('select[name="system.archetype"]')?.value;
  out.tableCount = root.querySelectorAll(".bg-edit-table").length;
  out.optionCount = root.querySelectorAll(".bg-edit-option").length;
  out.optionDropZones = root.querySelectorAll('[data-drop="option"]').length;

  // Handler: add an example name via the real click handler.
  sheet.element.find(".bg-name-add").trigger("click");
  await new Promise((r) => setTimeout(r, 200));
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

  // A LOCKED shipped background must still render the read-only view (that path
  // was refactored alongside the editor).
  const roPack = game.packs.get("air-bladder.backgrounds-2e");
  const roDocs = await roPack.getDocuments();
  const roBg = roDocs.find((d) => d.name === "Jongleur") ?? roDocs[0];
  const roSheet = roBg.sheet;
  await roSheet._render(true);
  for (let i = 0; i < 30 && !(roSheet.element && roSheet.element[0]); i++) await new Promise((r) => setTimeout(r, 100));
  const roRoot = roSheet.element[0];
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
  ["source = 2e", result.sourceVal === "2e"],
  ["archetype = Fighter", result.archetypeVal === "Fighter"],
  ["2 tables padded", result.tableCount === 2],
  ["12 options padded", result.optionCount === 12],
  ["12 option drop zones", result.optionDropZones === 12],
  ["name-add handler persists", result.namesAfterAdd === 1],
  ["gear drop → snapshot w/ itemData", result.gearSnapshot.hasItemData === true && result.gearSnapshot.name === "Probe Snapshot Blade ZZ"],
  ["gear snapshot kept type+bulky", result.gearSnapshot.type === "weapon" && result.gearSnapshot.bulky === true],
  ["option drop → snapshot w/ itemData", result.optionSnapshot.hasItemData === true],
  ["generation resolved snapshot gear (not in any pack)", result.genHasSnapshotGear === true],
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

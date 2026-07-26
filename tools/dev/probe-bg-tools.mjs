/**
 * Probe: the authoring follow-ups — "Test ×10" preview/linter and "Duplicate into
 * my backgrounds". Verifies the linter flags an unresolvable grant, classifies
 * resolvable ones, samples the option/gold spread, and that Duplicate lands a
 * source-2e copy in an editable world pack (created on first use).
 *
 *   node tools/dev/probe-bg-tools.mjs
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

const result = await page.evaluate(async () => {
  const out = {};
  const CG = game.cairn.characterGenerator;

  // --- Preview / linter ------------------------------------------------------
  const snap = { name: "Ghost Widget", type: "item", img: "icons/svg/item-bag.svg", system: { description: "", bulky: false } };
  const bg = await Item.create({
    name: "Linter Probe ZZ", type: "background",
    system: {
      source: "2e", archetype: "Fighter", names: ["Ade"],
      startingGear: [
        { name: "Rations" },                      // resolves by name (shipped)
        { name: "Ghost Widget", itemData: snap }, // snapshot
        { name: "Nonexistent Doohickey QQ" },     // MISSING -> should be an error
      ],
      tables: [
        { question: "Q1?", options: [
          { description: "Take the Ghost Widget.", items: [{ name: "Ghost Widget", itemData: snap }], bonusGold: 10 },
          { description: "Take a Missing Thing WW.", items: [{ name: "Missing Thing WW" }] }, // MISSING option item
          {}, {}, {}, {}, // four empty options -> "empty option" warnings
        ] },
        { question: "Q2?", options: [{ description: "So it goes.", bonusGold: 3 }] },
      ],
    },
  });

  const report = await CG.previewBackground(bg, 10);
  out.gearKinds = report.gear.map((g) => g.kind);
  out.problemLevels = report.problems.map((p) => p.level);
  out.errorCount = report.problems.filter((p) => p.level === "error").length;
  out.hasMissingGearError = report.problems.some((p) => p.level === "error" && /Nonexistent Doohickey QQ/.test(p.msg));
  out.hasMissingOptionError = report.problems.some((p) => p.level === "error" && /Missing Thing WW/.test(p.msg));
  out.emptyOptionWarnings = report.problems.filter((p) => /empty/i.test(p.msg)).length;
  out.firedSumsToN = report.tables.map((t) => t.fired.reduce((a, b) => a + b, 0));
  out.sampling = report.sampling;

  await bg.delete();

  // --- Duplicate into my backgrounds -----------------------------------------
  // Clean slate: if a prior run left the pack, remove it first.
  const pre = game.packs.get("world.custom-backgrounds");
  if (pre) await pre.deleteCompendium();

  const shipped = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())[0];
  const copy = await CG.duplicateBackgroundToWorld(shipped);
  out.copyName = copy?.name;
  out.copySource = copy?.system?.source;
  out.copyPack = copy?.pack;
  out.copyInWorldPack = copy?.pack === "world.custom-backgrounds";
  out.copyGearCount = (copy?.system?.startingGear ?? []).length;
  out.copyTablesCount = (copy?.system?.tables ?? []).length;
  out.discovered = (await CG.getBackgroundsFor?.("2e")) ? true : "n/a"; // getBackgroundsFor may be gated by settings

  // Cleanup: drop the whole world pack we created.
  const created = game.packs.get("world.custom-backgrounds");
  if (created) await created.deleteCompendium();
  out.packRemoved = !game.packs.get("world.custom-backgrounds");

  return out;
});

await browser.close();

const checks = [
  ["gear classified [name, snapshot, missing]", JSON.stringify(result.gearKinds) === JSON.stringify(["name", "snapshot", "missing"])],
  ["exactly 2 resolution errors", result.errorCount === 2],
  ["missing starting-gear flagged", result.hasMissingGearError === true],
  ["missing option item flagged", result.hasMissingOptionError === true],
  ["empty options warned (>=4)", result.emptyOptionWarnings >= 4],
  ["table 1 fired sums to 10", result.firedSumsToN[0] === 10],
  ["table 2 fired sums to 10", result.firedSumsToN[1] === 10],
  ["sampling reports gold", typeof result.sampling.goldAvg === "number"],
  ["duplicate → source 2e", result.copySource === "2e"],
  ["duplicate → world pack", result.copyInWorldPack === true],
  ["duplicate name suffixed", /\(Copy\)$/.test(result.copyName ?? "")],
  ["duplicate carried gear + tables", result.copyGearCount > 0 && result.copyTablesCount > 0],
  ["world pack cleaned up", result.packRemoved === true],
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

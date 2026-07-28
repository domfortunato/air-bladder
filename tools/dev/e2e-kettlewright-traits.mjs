#!/usr/bin/env node
/**
 * End-to-end check that a real Kettlewright export's traits sentence lands in the
 * eight typed slots plus system.age — the bug where an imported character arrived
 * with empty trait dropdowns and no age, and the whole sentence sitting in Notes.
 *
 *   npm run dev:kw-traits           (dev world on :30000, which runs the working tree)
 *
 * Uses the actual export the bug was reported from
 * (tools/dev/fixtures/kettlewright-solene.json), driven through the real importer
 * in a real Foundry — tools/dev/trait-parse-check.mjs already covers the parser in
 * isolation, so what this adds is the Foundry half: the table lookup that tells
 * virtue from vice, and the values actually reaching the actor.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIEWPORT, joinAsGM, watchErrors, confirmImportOptions } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = path.join(ROOT, "tools", "dev", "fixtures", "kettlewright-solene.json");

const EXPECTED = {
  physique: "Stout", skin: "Birthmarked", hair: "Long", face: "Pale",
  speech: "Precise", clothing: "Rancid", virtue: "Honorable", vice: "Craven",
};
const EXPECTED_AGE = "36";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

// A Solene left over from an aborted run would satisfy every wait below without
// this run importing anything at all. Start from nothing.
await page.evaluate(async () => {
  for (const a of game.actors.filter((a) => a.name === "Solene")) await a.delete();
});
await page.evaluate(() => ui.sidebar.changeTab?.("actors", "primary") ?? ui.sidebar.activateTab?.("actors"));
await page.waitForTimeout(600);

page.on("filechooser", (fc) => fc.setFiles(fixture).catch(() => {}));
await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());
await confirmImportOptions(page);
// Generous, because resolveGearItem re-reads the gear packs per item: the first
// import after a pack rebuild or server restart takes ~25s cold, ~3s warm.
await page.waitForFunction(() => !!game.actors.getName("Solene"), null, { timeout: 60000 }).catch(() => {});
// Both windows must be on screen before z-order can be judged: the sheet renders
// asynchronously after create() resolves, so measuring too early reads a missing
// sheet as z-index 0 and the assertion passes vacuously.
await page.waitForFunction(
  () => !!document.querySelector(".application.dialog") && !!document.querySelector(".app.window-app.sheet"),
  null, { timeout: 15000 },
).catch(() => {});
await page.waitForTimeout(1200); // let the deferred bringToFront land

const out = await page.evaluate(() => {
  const a = game.actors.getName("Solene");
  const dlg = document.querySelector(".dialog-v2, .application.dialog, dialog.application");
  return {
    created: !!a,
    traits: a?.system?.traits ?? null,
    age: a?.system?.age ?? "",
    // The sentence must NOT also be dumped into Notes once it parsed.
    notesHasTraitBlob: /Physique/i.test(a?.system?.notes ?? ""),
    questions: a?.system?.questions ?? [],
    notes: a?.system?.notes ?? "",
    // This fixture carries no usable portrait URL, so the import must fall back to
    // a random shipped portrait + its paired token rather than the blank default.
    img: a?.img ?? "",
    tokenImg: a?.prototypeToken?.texture?.src ?? "",
    summary: dlg?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    // The summary must sit ABOVE the auto-rendered sheet. The sheet renders after
    // create() resolves and would otherwise bury it — see showImportSummary.
    zDialog: Number(getComputedStyle(dlg ?? document.body).zIndex) || 0,
    zSheet: Number(getComputedStyle(document.querySelector(".app.window-app.sheet") ?? document.body).zIndex) || 0,
  };
});

const dlg = await page.$(".dialog-v2, .application.dialog, dialog.application");
if (dlg) await dlg.screenshot({ path: "tools/dev/out/kw-traits-summary.png" });
await page.evaluate(() => game.actors.getName("Solene")?.delete());
await browser.close();

let bad = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(10)} ${JSON.stringify(got)}${ok ? "" : `  expected ${JSON.stringify(want)}`}`);
};

if (!out.created) { console.log("FAIL: no actor was created"); process.exit(1); }
for (const [k, v] of Object.entries(EXPECTED)) check(k, out.traits?.[k] ?? "", v);
check("age", String(out.age), EXPECTED_AGE);
if (out.notesHasTraitBlob) { bad++; console.log("  FAIL  the trait sentence was ALSO duplicated into Notes"); }

// Background questions: the Mountebank prompts, matched to the player's answers.
console.log("");
check("questions", out.questions.length, 2);
check("q0", out.questions[0]?.question ?? "", "How was your fraud exposed?");
check("q1", out.questions[1]?.question ?? "", "What keepsake could always identify you?");
const a0 = out.questions[0]?.answer ?? "";
const a1 = out.questions[1]?.answer ?? "";
check("a0 starts", a0.slice(0, 34), "You were cursed by a hedgewitch fo");
check("a1 starts", a1.slice(0, 34), "Surgeon's Soap: A lye and ash bloc");
// An answer must not swallow the question that follows it.
if (/keepsake/i.test(a0)) { bad++; console.log("  FAIL  answer 0 ran on into question 1"); }
// And the question text must not be left behind in Notes as well.
if (/fraud exposed/i.test(out.notes)) { bad++; console.log("  FAIL  questions were ALSO left in Notes"); }

// A portrait must have been assigned: this export has no absolute image URL, so the
// importer draws one at random exactly as generation does.
console.log("");
const base = (p) => String(p).split("/").pop();
if (!out.img || /mystery-man|\/svg\//i.test(out.img)) {
  bad++;
  console.log(`  FAIL  portrait   no random portrait assigned (img ${JSON.stringify(out.img)})`);
} else if (base(out.img) !== base(out.tokenImg)) {
  bad++;
  console.log(`  FAIL  portrait   token does not pair with the portrait (${base(out.img)} vs ${base(out.tokenImg)})`);
} else {
  console.log(`  ok    portrait   ${out.img} with paired token`);
}

// The summary must open in FRONT of the character sheet, not behind it.
console.log("");
if (!out.zSheet) {
  bad++;
  console.log("  FAIL  z-order    no character sheet on screen — the check would pass vacuously");
} else if (out.zDialog > out.zSheet) {
  console.log(`  ok    z-order    summary ${out.zDialog} > sheet ${out.zSheet}`);
} else {
  bad++;
  console.log(`  FAIL  z-order    summary ${out.zDialog} is behind sheet ${out.zSheet}`);
}

if (errors.length) { bad++; console.log("Console errors:\n" + errors.join("\n")); }

console.log(`\nsummary dialog: ${out.summary.slice(0, 200)}`);
console.log(bad === 0 ? "\ne2e passed — all 8 traits + age imported" : `\ne2e FAILED — ${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);

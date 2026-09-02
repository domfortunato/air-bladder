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
 *
 * Also holds the summary's question line to its two branches (2026-09-03): a
 * fully-matched run says "matched to their answers." and never mentions Notes,
 * while a second import with one question's wording drifted past the tolerant
 * matcher takes the warn branch ("1 of 2 … kept as text in Notes").
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
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
//
// The sheet selector is `.application.cairn.sheet`, not AppV1's `.app.window-app`
// -- and it is qualified with `.cairn` on purpose, since `.application.sheet`
// alone would also match a core sheet that happened to be open.
await page.waitForFunction(
  () => !!document.querySelector(".application.dialog") && !!document.querySelector(".application.cairn.sheet"),
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
    zSheet: Number(getComputedStyle(document.querySelector(".application.cairn.sheet") ?? document.body).zIndex) || 0,
  };
});

const dlg = await page.$(".dialog-v2, .application.dialog, dialog.application");
if (dlg) await dlg.screenshot({ path: "tools/dev/out/kw-traits-summary.png" });

// Shortfall run (2026-09-03): the same export with ONE question's wording
// drifted past the tolerant matcher ("keepsake" -> "memento" in the notes
// blob, a WORD change — spacing and punctuation are forgiven, words are not).
// The summary must then take the warn branch and point at Notes, which the
// fully-matched run above must NOT mention. Driven through the exported
// performKettlewrightImport + showImportSummary pair rather than a second
// file-chooser dance — same code the button path runs after the file is read.
const fixtureJson = JSON.parse(readFileSync(fixture, "utf8"));
const short = await page.evaluate(async (json) => {
  const mod = await import("/systems/air-bladder/module/kettlewright-import.js");
  const mutated = { ...json, name: "Solene Shortfall", notes: String(json.notes).replaceAll("keepsake", "memento") };
  const { actor, report } = await mod.performKettlewrightImport(mutated);
  if (!actor) return { error: "shortfall import created no actor" };
  await mod.showImportSummary(actor, report);
  await new Promise((r) => setTimeout(r, 400));
  const summary = [...document.querySelectorAll(".kwi-summary")].pop();
  const qs = actor.system.questions ?? [];
  return {
    report: { questions: report.questions, questionsTotal: report.questionsTotal },
    warnTexts: [...(summary?.querySelectorAll("p.kwi-warn") ?? [])].map((p) => p.textContent.replace(/\s+/g, " ").trim()),
    okTexts: [...(summary?.querySelectorAll("p.kwi-ok") ?? [])].map((p) => p.textContent.replace(/\s+/g, " ").trim()),
    qCount: qs.length,
    a0: qs[0]?.answer ?? "",
    a1: qs[1]?.answer ?? "",
  };
}, fixtureJson);

await page.evaluate(async () => {
  for (const a of game.actors.filter((a) => a.name.startsWith("Solene"))) await a.delete();
});
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

// Summary wording (2026-09-03): the fully-matched run says so and stops — the
// Notes mention belongs to the shortfall branch alone.
console.log("");
if (!out.summary.includes("Background questions: 2 matched to their answers.")) {
  bad++; console.log(`  FAIL  matched summary line wrong or missing (summary: …${out.summary.slice(0, 180)})`);
} else if (out.summary.includes("Notes tab")) {
  bad++; console.log("  FAIL  the matched summary still points at the Notes tab");
} else {
  console.log('  ok    matched run: "2 matched to their answers." and no Notes mention');
}

// Shortfall run: 1 of 2 matched -> the warn line points at Notes, the ok line
// stays away, and the matched half still landed structured while the drifted
// question claimed no answer.
if (short.error) {
  bad++; console.log(`  FAIL  ${short.error}`);
} else {
  const warn = short.warnTexts.find((t) => t.includes("Background questions"));
  if (warn && warn.includes("1 of 2 matched to their answers") && warn.includes("kept as text in Notes")) {
    console.log(`  ok    shortfall run warns: ${warn}`);
  } else {
    bad++; console.log(`  FAIL  shortfall warn line: ${JSON.stringify(short.warnTexts)}`);
  }
  if (short.okTexts.some((t) => t.includes("Background questions"))) {
    bad++; console.log("  FAIL  the shortfall run ALSO renders an ok questions line");
  }
  check("sf found", `${short.report.questions}/${short.report.questionsTotal}`, "1/2");
  if (!(short.qCount === 2 && short.a0 && !short.a1)) {
    bad++; console.log(`  FAIL  shortfall structure: qCount=${short.qCount} a0=${Boolean(short.a0)} a1=${JSON.stringify(short.a1)}`);
  }
}

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

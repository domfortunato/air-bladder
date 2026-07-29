#!/usr/bin/env node
/**
 * What an import does regardless of what the export says:
 *
 *   1. Gate ON (the default): a background that matches nothing is refused
 *      outright — no half-imported character, no Actor left behind, and an error
 *      that both names the background and says how to get past it.
 *   2. Gate OFF: the same file imports, background kept as plain text, no
 *      questions — and the summary says what that cost.
 *   3. The Warden's "min-age" floor applies to imported characters too.
 *      Generation enforces it in rollAge; an import goes nowhere near that, so
 *      without this a Kettlewright character walks in younger than allowed.
 *
 *   npm run dev:kw-guards        (dev world on :30000, which runs the working tree)
 *
 * All three go through the real button — including the options dialog that now
 * precedes the file picker — because the rules live in the flow, not the mapping.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, confirmImportOptions, withSettings } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = path.join(ROOT, "tools", "dev", "fixtures", "kettlewright-solene.json");
const base = JSON.parse(fs.readFileSync(fixture, "utf8"));
const FIXTURE_AGE = 36; // as written in the export's traits sentence
const FLOOR = FIXTURE_AGE + 4;

// A background no world can have. Derived from the real export so everything else
// about it stays valid — only the one field under test changes.
const bogus = path.join(os.tmpdir(), "kw-guard-bogus.json");
fs.writeFileSync(bogus, JSON.stringify({ ...base, name: "Guardrail", background: "Cheesemonger" }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

// Leftovers from an aborted run would satisfy the waits below without this run
// importing anything.
await page.evaluate(async () => {
  for (const a of game.actors.filter((a) => ["Solene", "Guardrail"].includes(a.name))) await a.delete();
});
await page.evaluate(() => ui.sidebar.changeTab?.("actors", "primary") ?? ui.sidebar.activateTab?.("actors"));
await page.waitForTimeout(600);

let file = bogus;
page.on("filechooser", (fc) => fc.setFiles(file).catch((e) => console.log("setFiles failed:", e.message)));

// The button now opens an options dialog before the file picker. Answer it the way
// a Warden would: tick or untick the gate, then press the import button.
const importAndWait = async (expectName, { requireBackground = true } = {}) => {
  await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());
  await confirmImportOptions(page, { requireBackground });
  // ~25s cold (resolveGearItem re-reads the gear packs per item), ~3s warm.
  return page
    .waitForFunction((n) => !!game.actors.getName(n), expectName, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
};

/* 1. Gate ON: an unmatched background is refused ----------------------------- */
const madeBogus = await importAndWait("Guardrail");
const refusal = await page.evaluate(() => ({
  actors: game.actors.filter((a) => a.name === "Guardrail").length,
  // The message must name the background, or the GM cannot act on it.
  error: [...document.querySelectorAll("#notifications .notification.error, .notification.error")]
    .map((n) => n.textContent.trim()).join(" | "),
}));

/* 2. Gate OFF: the same file imports, as plain text -------------------------- */
const madeUngated = await importAndWait("Guardrail", { requireBackground: false });
const ungated = await page.evaluate(() => {
  const a = game.actors.getName("Guardrail");
  return {
    background: a?.system?.background ?? "",
    uuid: a?.system?.backgroundUuid ?? "",
    questions: (a?.system?.questions ?? []).length,
    // The LAST one: summaries from earlier steps are still on screen, and
    // querySelector would keep returning the first for the rest of the run.
    summary: [...document.querySelectorAll(".kwi-summary")].pop()?.textContent ?? "",
  };
});
await page.evaluate(async () => {
  for (const a of game.actors.filter((a) => a.name === "Guardrail")) await a.delete();
});

/* 3. min-age floor -----------------------------------------------------------
 * Wrapped in withSettings because this drives `min-age` and this file is
 * top-level statements with no enclosing try: a throw anywhere between the set
 * and the restore below would abort the script and leave the floor raised in the
 * world. That exact leak, from a different probe, had every character generated
 * afterwards come out aged 99 with a dead-looking age re-roll. The restore has to
 * run in Node to survive a throw inside page.evaluate. */
let madeSolene, aged;
await withSettings(page, async () => {
  file = fixture;
  await page.evaluate((f) => game.settings.set("air-bladder", "min-age", f), FLOOR);
  madeSolene = await importAndWait("Solene");
  aged = await page.evaluate(() => {
    const a = game.actors.getName("Solene");
    return { age: a?.system?.age ?? "", summary: [...document.querySelectorAll(".kwi-summary")].pop()?.textContent ?? "" };
  });
});
await page.evaluate(async () => {
  await game.actors.getName("Solene")?.delete();
  for (const a of game.actors.filter((a) => a.name === "Guardrail")) await a.delete();
});
await browser.close();
fs.rmSync(bogus, { force: true });

let bad = 0;
const check = (label, ok, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(16)} ${detail}`);
};

console.log("unmatched background, gate ON");
check("no actor", !madeBogus && refusal.actors === 0, `created=${refusal.actors}`);
check("error shown", /cheesemonger/i.test(refusal.error), JSON.stringify(refusal.error.slice(0, 90)));
// The refusal is only actionable if it says how to get past it.
check("names escape", /untick/i.test(refusal.error), "message points at the checkbox");

console.log("\nunmatched background, gate OFF");
check("imported", madeUngated, `background=${JSON.stringify(ungated.background)}`);
check("kept as text", ungated.background === "Cheesemonger" && !ungated.uuid, `uuid=${JSON.stringify(ungated.uuid)}`);
// No background means no question list to split the answers against.
check("no questions", ungated.questions === 0, `questions=${ungated.questions}`);
check("summary warns", /re-rolled|plain text/i.test(ungated.summary), ungated.summary ? "warning rendered" : "no summary");

console.log("\nmin-age floor");
check("imported", madeSolene, `floor=${FLOOR}, export says ${FIXTURE_AGE}`);
check("age raised", aged.age === String(FLOOR), `age=${JSON.stringify(aged.age)}`);
check("summary says so", /\b36\b[\s\S]*\b40\b|raised/i.test(aged.summary), aged.summary ? "summary rendered" : "no summary");

// The refusal itself is an ui.notifications.error, which Foundry also writes to the
// console — that one is the feature working, not a fault.
const unexpected = errors.filter((e) => !/no Cairn 2e background matches/i.test(e));
if (unexpected.length) { bad++; console.log("Console errors:\n" + unexpected.join("\n")); }
console.log(bad === 0 ? "\nguards e2e passed" : `\nguards e2e FAILED — ${bad}`);
process.exit(bad === 0 ? 0 : 1);

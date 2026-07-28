#!/usr/bin/env node
/**
 * The two rules an import must obey regardless of what the export says:
 *
 *   1. A background that matches nothing is refused outright — no half-imported
 *      character, an error the GM cannot miss, and no Actor left behind.
 *   2. The Warden's "min-age" floor applies to imported characters too. Generation
 *      enforces it in rollAge; an import goes nowhere near that, so without this
 *      a Kettlewright character walks in younger than the setting allows.
 *
 *   npm run dev:kw-guards        (dev world on :30000, which runs the working tree)
 *
 * Both go through the real button, not the mapping function, because both rules
 * live in the flow around it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

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

const importAndWait = async (expectName) => {
  await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());
  // ~25s cold (resolveGearItem re-reads the gear packs per item), ~3s warm.
  return page
    .waitForFunction((n) => !!game.actors.getName(n), expectName, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
};

/* 1. Unmatched background --------------------------------------------------- */
const madeBogus = await importAndWait("Guardrail");
const refusal = await page.evaluate(() => ({
  actors: game.actors.filter((a) => a.name === "Guardrail").length,
  // The message must name the background, or the GM cannot act on it.
  error: [...document.querySelectorAll("#notifications .notification.error, .notification.error")]
    .map((n) => n.textContent.trim()).join(" | "),
}));

/* 2. min-age floor ---------------------------------------------------------- */
file = fixture;
const before = await page.evaluate((f) => {
  const b = game.settings.get("air-bladder", "min-age");
  return game.settings.set("air-bladder", "min-age", f).then(() => b);
}, FLOOR);
const madeSolene = await importAndWait("Solene");
const aged = await page.evaluate(() => {
  const a = game.actors.getName("Solene");
  return { age: a?.system?.age ?? "", summary: document.querySelector(".kwi-summary")?.textContent ?? "" };
});
await page.evaluate(async (b) => {
  await game.settings.set("air-bladder", "min-age", b);
  await game.actors.getName("Solene")?.delete();
  for (const a of game.actors.filter((a) => a.name === "Guardrail")) await a.delete();
}, before);
await browser.close();
fs.rmSync(bogus, { force: true });

let bad = 0;
const check = (label, ok, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(16)} ${detail}`);
};

console.log("unmatched background");
check("no actor", !madeBogus && refusal.actors === 0, `created=${refusal.actors}`);
check("error shown", /cheesemonger/i.test(refusal.error), JSON.stringify(refusal.error.slice(0, 90)));

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

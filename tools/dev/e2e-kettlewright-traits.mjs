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
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

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

await page.evaluate(() => ui.sidebar.changeTab?.("actors", "primary") ?? ui.sidebar.activateTab?.("actors"));
await page.waitForTimeout(600);

page.on("filechooser", (fc) => fc.setFiles(fixture).catch(() => {}));
await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());
await page.waitForFunction(() => !!game.actors.getName("Solene"), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);

const out = await page.evaluate(() => {
  const a = game.actors.getName("Solene");
  const dlg = document.querySelector(".dialog-v2, .application.dialog, dialog.application");
  return {
    created: !!a,
    traits: a?.system?.traits ?? null,
    age: a?.system?.age ?? "",
    // The sentence must NOT also be dumped into Notes once it parsed.
    notesHasTraitBlob: /Physique/i.test(a?.system?.notes ?? ""),
    summary: dlg?.textContent?.replace(/\s+/g, " ").trim() ?? "",
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
if (errors.length) { bad++; console.log("Console errors:\n" + errors.join("\n")); }

console.log(`\nsummary dialog: ${out.summary.slice(0, 200)}`);
console.log(bad === 0 ? "\ne2e passed — all 8 traits + age imported" : `\ne2e FAILED — ${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);

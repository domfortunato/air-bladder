#!/usr/bin/env node
/**
 * What an import does regardless of what the export says:
 *
 *   1. A background that matches nothing still imports — kept as plain text,
 *      no questions — and the summary says what that cost. (The "Require a
 *      matching background" gate RETIRED 2026-09-01, user ruling: the import
 *      always proceeds, and the options dialog + summary warn instead. Its
 *      refusal leg retired with it.)
 *   2. An imported age is VERBATIM (2026-08-21). The min-age floor and the
 *      max-age ceiling are RETIRED with the age-formula setting: the formula
 *      governs the DICE, and an imported age was never rolled — it joins the
 *      hand-typed age under "nobody's business but the player's". The old
 *      bounds are SHADOWED at their old keys in-page (a read shadow, never a
 *      write), so this leg witnesses the retirement both ways: red while any
 *      bound still clamps, green when the parse lands untouched.
 *
 *   npm run dev:kw-guards        (dev world on :30000, which runs the working tree)
 *
 * All of it goes through the real button — including the options dialog that
 * precedes the file picker — because the rules live in the flow, not the mapping.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, confirmImportOptions } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = path.join(ROOT, "tools", "dev", "fixtures", "kettlewright-solene.json");
const base = JSON.parse(fs.readFileSync(fixture, "utf8"));
const FIXTURE_AGE = 36; // as written in the export's traits sentence
// Shadow values for the RETIRED bounds — both would bind if any bound still
// applied. Derived from the fixture rather than written as literals, so a
// fixture whose age changes keeps them binding instead of silently not.
const FLOOR = FIXTURE_AGE + 4;
const CEILING = FIXTURE_AGE - 4;

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

/* 0. Cancel is a refusal (review #9 finding 13) ------------------------------
 * DialogV2 resolves a button as `(await callback(...)) ?? button.action`
 * (dialog.mjs:273), so a Cancel with no callback fell through to the string
 * "cancel" — truthy at the call site — and the Cancel BUTTON proceeded to the
 * file picker with the safety gate silently off. The observable is the picker:
 * this runs BEFORE the answering filechooser listener below is registered, so
 * a wrongly-opened picker is detected, not fed. Fail-witness (run 2026-08-06):
 * with `callback: () => false` removed, chooserOpened=true and this leg is the
 * only red in the run. */
let chooserOpened = false;
const detectChooser = () => { chooserOpened = true; };
page.on("filechooser", detectChooser);
await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());
await page.waitForSelector(".kwi-options", { timeout: 15000 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".dialog-v2 button, .application.dialog button, dialog.application button")]
    .find((b) => b.dataset.action === "cancel");
  btn?.click();
});
await page.waitForTimeout(2500);
const cancelState = await page.evaluate(() => ({
  dialogGone: !document.querySelector(".kwi-options"),
  actors: game.actors.filter((a) => ["Solene", "Guardrail"].includes(a.name)).length,
}));
page.off("filechooser", detectChooser);

let file = bogus;
page.on("filechooser", (fc) => fc.setFiles(file).catch((e) => console.log("setFiles failed:", e.message)));

// The button opens an options dialog before the file picker. Answer it the way
// a Warden would: press the import button (informational since the gate retired).
const importAndWait = async (expectName) => {
  await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());
  await confirmImportOptions(page);
  // ~25s cold (resolveGearItem re-reads the gear packs per item), ~3s warm.
  return page
    .waitForFunction((n) => !!game.actors.getName(n), expectName, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
};

/* 1. An unmatched background imports anyway, as plain text ------------------- */
const madeUngated = await importAndWait("Guardrail");
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

/* 2. an imported age is VERBATIM (2026-08-21) ---------------------------------
 * A read SHADOW at the retired keys, never a write: the retired settings are no
 * longer registered, so game.settings.set on them would throw — and a shadow is
 * how a probe defeats a fix in-page anyway. Pre-retirement code read min-age /
 * max-age here and would clamp the fixture's 36 to the 40 floor; the fixed
 * importer reads neither, so the age lands as exported and the summary carries
 * no raised/lowered line. Restored in a Node-level finally-equivalent below the
 * read, so a throw inside the import cannot leave the page's settings.get
 * wrapped. */
let madeSolene, aged;
file = fixture;
await page.evaluate(({ floor, ceiling }) => {
  const orig = game.settings.get;
  window.__kwAgeShadow = orig;
  game.settings.get = function (ns, key) {
    if (ns === "air-bladder" && key === "min-age") return floor;
    if (ns === "air-bladder" && key === "max-age") return ceiling;
    return orig.call(this, ns, key);
  };
}, { floor: FLOOR, ceiling: CEILING });
try {
  madeSolene = await importAndWait("Solene");
  aged = await page.evaluate(() => {
    const a = game.actors.getName("Solene");
    return { age: a?.system?.age ?? "", summary: [...document.querySelectorAll(".kwi-summary")].pop()?.textContent ?? "" };
  });
} finally {
  await page.evaluate(() => {
    if (window.__kwAgeShadow) { game.settings.get = window.__kwAgeShadow; delete window.__kwAgeShadow; }
  });
}

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

console.log("Cancel on the options dialog");
check("dialog closed", cancelState.dialogGone, "the options dialog is gone");
check("no file picker", !chooserOpened, `chooserOpened=${chooserOpened}`);
check("nothing created", cancelState.actors === 0, `actors=${cancelState.actors}`);

console.log("\nunmatched background imports anyway");
check("imported", madeUngated, `background=${JSON.stringify(ungated.background)}`);
check("kept as text", ungated.background === "Cheesemonger" && !ungated.uuid, `uuid=${JSON.stringify(ungated.uuid)}`);
// No background means no question list to split the answers against.
check("no questions", ungated.questions === 0, `questions=${ungated.questions}`);
check("summary warns", /re-rolled|plain text/i.test(ungated.summary), ungated.summary ? "warning rendered" : "no summary");

console.log("\nimported age is verbatim (the bounds are retired)");
check("imported", madeSolene, `export says ${FIXTURE_AGE}; retired bounds shadowed at ${FLOOR}/${CEILING}`);
check("age verbatim", aged.age === String(FIXTURE_AGE), `age=${JSON.stringify(aged.age)}`);
check("no bound line", !/raised|lowered/i.test(aged.summary) && !!aged.summary,
  aged.summary ? "summary carries no age warning" : "no summary");

// No expected console errors remain: the gate refusal that used to log one
// retired with the gate.
if (errors.length) { bad++; console.log("Console errors:\n" + errors.join("\n")); }
console.log(bad === 0 ? "\nguards e2e passed" : `\nguards e2e FAILED — ${bad}`);
process.exit(bad === 0 ? 0 : 1);

/**
 * Sheet DOM-id isolation e2e.
 *
 * Templates hardcoded the field path as the DOM id (`id="system.bulky"`), so every
 * open sheet of a type carried the SAME ids. HTML resolves `label[for]` against the
 * FIRST match in tree order, so with two item sheets open a click on the second
 * sheet's "Bulky" label toggled the FIRST item's checkbox — and AppV1's
 * `submitOnChange` wrote it. Silent, and it edits a document the user is not
 * looking at.
 *
 * This drives a REAL label click through Playwright (not a programmatic
 * `checkbox.click()`), because the whole defect lives in how the browser resolves
 * `for` → `id`. Anything that bypasses that resolution cannot see the bug.
 *
 * Usage: npm run dev:sheet-ids
 */

import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, watchErrors } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(30)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(30)} ${detail}`); failures++; };
let failures = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/* -------------------------------------------- */

console.log("\ntwo item sheets open at once");

const setup = await page.evaluate(async () => {
  const a = await Item.create({ name: "ZZ Probe One", type: "item" });
  const b = await Item.create({ name: "ZZ Probe Two", type: "item" });
  await a.sheet.render(true);
  await b.sheet.render(true);
  await new Promise((r) => setTimeout(r, 900));
  // Framework-neutral root selector. AppV1 tags its window with `data-appid` and
  // its element id comes from `options.id`, which is shared by every sheet of a
  // type — the very collision this probe exists for. ApplicationV2 has no
  // `data-appid` and gives each window a unique element id instead.
  const sel = (app) =>
    app.appId !== undefined ? `[data-appid="${app.appId}"]` : `#${CSS.escape(app.id)}`;
  return {
    aId: a.id, bId: b.id,
    aApp: sel(a.sheet), bApp: sel(b.sheet),
    aBulky: a.system.bulky, bBulky: b.system.bulky,
  };
});

// Ids must differ between the two windows — that is the fix, stated directly.
const forVals = await page.evaluate(({ aApp, bApp }) => {
  const f = (root) => document.querySelector(`${root} label[for$="system.bulky"]`)?.getAttribute("for");
  return { a: f(aApp), b: f(bApp) };
}, setup);

forVals.a && forVals.b && forVals.a !== forVals.b
  ? ok("label[for] differs per window", `${forVals.a} vs ${forVals.b}`)
  : fail("label[for] differs per window", JSON.stringify(forVals));

// The real gesture: click the SECOND sheet's Bulky label.
await page.locator(`${setup.bApp} label[for$="system.bulky"]`).click();
await page.waitForTimeout(900);

const after = await page.evaluate(({ aId, bId }) => ({
  a: game.items.get(aId).system.bulky,
  b: game.items.get(bId).system.bulky,
}), setup);

after.b === !setup.bBulky
  ? ok("clicked sheet's item changed", `bulky ${setup.bBulky} -> ${after.b}`)
  : fail("clicked sheet's item changed", `bulky is ${after.b}, expected ${!setup.bBulky}`);

after.a === setup.aBulky
  ? ok("other item untouched", `bulky still ${after.a}`)
  : fail("other item untouched", `THE WRONG DOCUMENT WAS EDITED: bulky ${setup.aBulky} -> ${after.a}`);

/* -------------------------------------------- */

console.log("\ntwo character sheets open at once");

const chars = await page.evaluate(async () => {
  const gen = game.cairn.characterGenerator;
  const a = await gen.createActorWithCharacter(await gen.generate2eCharacter());
  const b = await gen.createActorWithCharacter(await gen.generate2eCharacter());
  await a.sheet.render(true);
  await b.sheet.render(true);
  await new Promise((r) => setTimeout(r, 1200));
  const sel = (app) =>
    app.appId !== undefined ? `[data-appid="${app.appId}"]` : `#${CSS.escape(app.id)}`;
  const f = (root) => document.querySelector(`${root} label[for$="system.hp.value"]`)?.getAttribute("for");
  return { aFor: f(sel(a.sheet)), bFor: f(sel(b.sheet)), aId: a.id, bId: b.id, bApp: sel(b.sheet) };
});

chars.aFor && chars.bFor && chars.aFor !== chars.bFor
  ? ok("HP label differs per window", `${chars.aFor} vs ${chars.bFor}`)
  : fail("HP label differs per window", JSON.stringify(chars));

// Clicking an HP label must focus THIS sheet's input, not the other one's.
await page.locator(`${chars.bApp} label[for$="system.hp.value"]`).click();
await page.waitForTimeout(400);
const focused = await page.evaluate((bApp) => {
  const root = document.querySelector(bApp);
  return !!(document.activeElement && root?.contains(document.activeElement));
}, chars.bApp);

focused
  ? ok("focus stays in its own sheet", "")
  : fail("focus stays in its own sheet", "focus landed outside the clicked sheet");

await page.evaluate(async ({ aId, bId }) => {
  for (const id of [aId, bId]) await game.actors.get(id)?.delete().catch(() => {});
}, chars);
await page.evaluate(async ({ aId, bId }) => {
  for (const id of [aId, bId]) await game.items.get(id)?.delete().catch(() => {});
}, setup);

/* -------------------------------------------- */

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
if (errors.length) failures++;

await browser.close();
console.log(failures ? `\nFAILED (${failures})` : "\nPASSED");
process.exit(failures ? 1 : 0);

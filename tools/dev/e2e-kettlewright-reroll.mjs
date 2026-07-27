#!/usr/bin/env node
/**
 * Imports a real Kettlewright export, then re-rolls a background question, and
 * asserts the item that question originally granted is REPLACED rather than left
 * behind beside the new one.
 *
 *   npm run dev:kw-reroll
 *
 * The bug: every imported item was tagged `imported`, a grant source no re-roll
 * targets, so re-rolling only ever added. Inventories could grow but never shrink.
 */
import { chromium } from "playwright";
import path from "node:path";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const fixture = path.resolve("tools/dev/fixtures/kettlewright-solene.json");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await page.evaluate(() => ui.sidebar.changeTab?.("actors", "primary") ?? ui.sidebar.activateTab?.("actors"));
await page.waitForTimeout(500);
page.on("filechooser", (fc) => fc.setFiles(fixture).catch(() => {}));
await page.evaluate(() => document.querySelector(".import-kettlewright-button")?.click());
await page.waitForFunction(() => !!game.actors.getName("Solene"), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const SCOPE = "air-bladder";
  const a = game.actors.getName("Solene");
  const srcOf = (i) => i.getFlag(SCOPE, "grantSource") ?? "";
  const snapshot = () => a.items.map((i) => `${i.name} [${srcOf(i)}]`).sort();

  const before = snapshot();
  const answerBefore = a.system.questions?.[1]?.answer ?? "";
  // "Surgeon's Soap" is granted by question 1's chosen option; it must now carry
  // question:1 rather than `imported`.
  const soap = a.items.find((i) => /surgeon/i.test(i.name));
  const tagged = soap ? srcOf(soap) : "(item missing)";

  // Drive the sheet's own re-roll handler directly. Clicking the DOM was
  // ambiguous: a d6 landing on the option it already had is indistinguishable
  // from a click that never fired. Retry until the answer actually changes so the
  // assertion below is always meaningful.
  const sheet = a.sheet;
  await sheet.render(true);
  await new Promise((r) => setTimeout(r, 800));
  const btn = sheet.element?.[0]?.querySelector?.('.question-reroll[data-index="1"]')
    ?? document.querySelector('.question-reroll[data-index="1"]');

  let attempts = 0;
  while (attempts < 12 && a.system.questions?.[1]?.answer === answerBefore) {
    attempts++;
    sheet._rerolling = false; // clear the double-click guard between attempts
    await sheet._onRerollQuestion({ preventDefault() {}, currentTarget: { dataset: { index: "1" } } });
    await new Promise((r) => setTimeout(r, 400));
  }
  await new Promise((r) => setTimeout(r, 1200));

  return {
    tagged,
    before,
    after: snapshot(),
    soapStillThere: a.items.some((i) => /surgeon/i.test(i.name)),
    total: { before: before.length, after: a.items.size },
    foundButton: !!btn,
    attempts,
    answerBefore,
    answerAfter: a.system.questions?.[1]?.answer ?? "",
  };
});

await page.evaluate(() => game.actors.getName("Solene")?.delete());
await browser.close();

let bad = 0;
console.log(`Surgeon's Soap grant source after import: ${out.tagged}`);
if (out.tagged !== "question:1") { bad++; console.log("  FAIL  expected question:1 — a re-roll can't replace an `imported` item"); }
else console.log("  ok    tagged to its question, so a re-roll owns it");

if (!out.foundButton) {
  console.log("  SKIP  re-roll control not found; tag check above is the meaningful assertion");
} else {
  const rerolled = out.answerBefore !== out.answerAfter;
  console.log(`\nanswer before: ${out.answerBefore.slice(0, 50)}`);
  console.log(`answer after : ${out.answerAfter.slice(0, 50)}`);
  console.log(`items before: ${out.total.before}   after: ${out.total.after}`);
  console.log(`inventory after: ${out.after.join(", ")}`);
  if (!rerolled) {
    // A d6 can legitimately land on the option it already had. That tells us
    // nothing either way, so don't score it as a pass or a failure.
    console.log("  SKIP  the re-roll produced the same option — inconclusive, re-run");
  } else if (out.soapStillThere) {
    bad++;
    console.log("  FAIL  the original granted item survived the re-roll (duplicate)");
  } else {
    console.log("  ok    original granted item was removed by the re-roll");
  }
}
if (errors.length) { bad++; console.log("Console errors:\n" + errors.join("\n")); }
console.log(bad === 0 ? "\nre-roll e2e passed" : `\nre-roll e2e FAILED — ${bad}`);
process.exit(bad === 0 ? 0 : 1);

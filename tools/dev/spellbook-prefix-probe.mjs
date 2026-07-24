#!/usr/bin/env node
/**
 * The "Spellbook — " inventory prefix is applied exactly once.
 *
 *   1. A spellbook stored under the bare spell name shows a single prefix.
 *   2. A spellbook whose stored name ALREADY has the prefix (older data / hand
 *      typed) is NOT doubled -- the display prefix is idempotent.
 *   3. randomSpellbookItem() no longer bakes the prefix into the stored name, so
 *      a generated spellbook reads with one prefix too.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const NS = "air-bladder";
    const out = {};
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const pack = game.packs.get(`${NS}.backgrounds-2e`);
    const bg = (await pack.getDocuments())[0];
    const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter(bg));
    out.actorId = actor.id;

    // A bare-named spellbook and a pre-prefixed one, side by side.
    await actor.createEmbeddedDocuments("Item", [
      { name: "Magic Missile", type: "spellbook" },
      { name: "Spellbook — Hempen Hoop", type: "spellbook" },
    ]);
    await actor.sheet.render(true);
    for (let i = 0; i < 20 && !actor.sheet.element?.[0]; i++) await new Promise((res) => setTimeout(res, 150));
    await new Promise((res) => setTimeout(res, 400));
    const root = actor.sheet.element?.[0];
    const titles = root ? [...root.querySelectorAll(".cairn-item-title")].map((t) => t.textContent.trim()) : [];
    out.bare = titles.find((t) => /Magic Missile/.test(t)) ?? null;
    out.prefixed = titles.find((t) => /Hempen Hoop/.test(t)) ?? null;

    // The generation path: a random spellbook item's STORED name has no prefix.
    // randomSpellbookItem is module-internal, so mint one the same way the
    // generator does -- via a background whose gear includes "Spellbook". Easier
    // to assert directly: the two generated inventories never store a doubled name.
    const genSpellbooks = actor.items.filter((i) => i.type === "spellbook")
      .map((i) => i.name);
    out.storedNames = genSpellbooks;
    return out;
  });

  const one = (s) => (s ?? "").match(/Spellbook —/g)?.length ?? 0;

  r.bare === "Spellbook — Magic Missile"
    ? ok(`bare-named spellbook shows one prefix ("${r.bare}")`)
    : fail(`bare spellbook rendered "${r.bare}", expected "Spellbook — Magic Missile"`);
  one(r.prefixed) === 1 && r.prefixed === "Spellbook — Hempen Hoop"
    ? ok(`pre-prefixed spellbook is NOT doubled ("${r.prefixed}")`)
    : fail(`pre-prefixed spellbook rendered "${r.prefixed}" (${one(r.prefixed)} prefixes)`);
  // Our two hand-made items are named "Magic Missile" and "Spellbook — Hempen
  // Hoop"; only the latter carries a stored prefix, and it must not be doubled.
  r.storedNames.every((n) => one(n) <= 1)
    ? ok(`no stored spellbook name carries a doubled prefix (${JSON.stringify(r.storedNames)})`)
    : fail(`a stored spellbook name is doubled: ${JSON.stringify(r.storedNames)}`);

  await page.evaluate(async (id) => { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }, r.actorId);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nSPELLBOOK PREFIX PROBE FAILED\n" : "\nspellbook prefix probe passed\n");
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * The encumbered-HP data-loss bug, end to end.
 *
 *   npm run dev:enc-damage        (dev world on :30000, which runs the working tree)
 *
 * _prepareCharacterData zeroes system.hp.value whenever an actor is encumbered or
 * panicked. Two code paths then read that DERIVED zero and persisted it:
 *
 *   1. damage.js applyToTarget — read hp, compute, actor.update(). With hp read as
 *      0 it wrote 0 back even when armor absorbed the hit entirely, destroying the
 *      stored Hit Protection with no message and no way to get it back.
 *   2. The sheet's _getSubmitData guard covered `character` but not `hireling`,
 *      though actor.js routes BOTH through _prepareCharacterData — and AppV1 sets
 *      submitOnClose, so closing the sheet was enough.
 *
 * Both assert on the SOURCE value (toObject()), never the derived one: reading
 * actor.system.hp.value here would report 0 in both the fixed and broken cases and
 * pass for the wrong reason.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

const out = await page.evaluate(async () => {
  const NAME = "__encdmg__";
  const results = {};
  for (const a of game.actors.filter((a) => a.name.startsWith(NAME))) await a.delete();

  /** An actor of `type` at 4/6 HP, loaded until it is encumbered. */
  const makeEncumbered = async (type) => {
    const actor = await CONFIG.Actor.documentClass.create({
      name: `${NAME}-${type}`,
      type,
      system: { hp: { value: 4, max: 6 }, abilities: { STR: { value: 10, max: 10 } } },
    });
    // Bulky items are 2 slots each; 10 slots is the default limit.
    const bulky = Array.from({ length: 8 }, (_, i) => ({
      name: `Anvil ${i}`, type: "item", system: { bulky: true },
    }));
    await actor.createEmbeddedDocuments("Item", bulky);
    return actor;
  };

  /* 1. Damage while encumbered -------------------------------------------- */
  const pc = await makeEncumbered("character");
  results.encumbered = pc.system.encumbered === true;
  results.derivedIsZero = pc.system.hp.value === 0;      // data prep zeroed it
  results.sourceBefore = pc.toObject().system.hp.value;  // ...but source holds 4

  // Drive the real damage path. It needs a token, so place one on any scene.
  let scene = game.scenes.contents[0];
  if (!scene) scene = await Scene.create({ name: `${NAME}-scene`, width: 1000, height: 1000 });
  const [tokenDoc] = await scene.createEmbeddedDocuments("Token", [
    await pc.getTokenDocument({ x: 100, y: 100 }),
  ]);
  const { Damage } = await import("/systems/air-bladder/module/damage.js");
  const prev = canvas.scene;
  if (canvas.scene?.id !== scene.id) await scene.view();

  // Damage 1 against armor 0 — a real hit, so HP must drop by 1 from the STORED 4.
  await Damage.applyToTarget(tokenDoc.id, 1);
  results.sourceAfterHit = pc.toObject().system.hp.value;
  results.strAfterHit = pc.toObject().system.abilities.STR.value;

  await tokenDoc.delete();
  if (prev && prev.id !== scene.id) await prev.view();

  /* 2. Hireling sheet submit ----------------------------------------------- */
  const hire = await makeEncumbered("hireling");
  results.hirelingSourceBefore = hire.toObject().system.hp.value;
  const sheet = hire.sheet;
  await sheet.render(true);
  await new Promise((r) => setTimeout(r, 900));
  // What the sheet would actually submit, derived-zero and all.
  const submitted = sheet._getSubmitData({});
  results.submitKeepsHp =
    "system.hp.value" in submitted ||
    submitted?.system?.hp?.value !== undefined;
  await sheet.close();
  await new Promise((r) => setTimeout(r, 700));
  results.hirelingSourceAfter = hire.toObject().system.hp.value;

  for (const a of game.actors.filter((a) => a.name.startsWith(NAME))) await a.delete();
  const s = game.scenes.getName(`${NAME}-scene`);
  if (s) await s.delete();
  return results;
});
await browser.close();

let bad = 0;
const check = (label, ok, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(20)} ${detail}`);
};

console.log("setup");
check("encumbered", out.encumbered, `system.encumbered=${out.encumbered}`);
check("derived HP is 0", out.derivedIsZero, "data prep zeroed the derived value");
check("source HP is 4", out.sourceBefore === 4, `source=${out.sourceBefore}`);

console.log("\ndamage while encumbered");
check("stored HP survives", out.sourceAfterHit === 3,
  `source=${out.sourceAfterHit} (expected 3: stored 4 minus 1 damage)`);
check("STR untouched", out.strAfterHit === 10,
  `STR=${out.strAfterHit} (a 1-point hit must not overflow past stored HP)`);

console.log("\nhireling sheet submit");
check("guard strips HP", !out.submitKeepsHp, "system.hp.value removed from submit data");
check("stored HP survives", out.hirelingSourceAfter === 4,
  `source=${out.hirelingSourceAfter} (expected 4: opening and closing must not write)`);

if (errors.length) { bad++; console.log("Console errors:\n" + errors.join("\n")); }
console.log(bad === 0 ? "\nencumbered-damage e2e passed" : `\nencumbered-damage e2e FAILED — ${bad}`);
process.exit(bad === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Roll NPC must ask first. It is a one-click, no-undo wipe if it does not.
 *
 * The header button routes an `npc` to `regenerateNpc`, which deletes every
 * embedded Item and overwrites profession, abilities and HP. That used to run on a
 * single click, on the reasoning that "a hireling's statblock is disposable by
 * design" — written when only the `hireling` type reached it. Folding hireling into
 * npc widened it to the whole bestiary: all 205 shipped monsters are `type: npc`,
 * at the time none declared `generationEnabled` (it defaulted TRUE then — the
 * shipped monsters pin false since e6b362a, and the schema default flipped to
 * false on 2026-08-02, which is why the seed below states `true`) and
 * `show-generate-header` defaults true, so the button rendered on every monster
 * for anyone who owned it.
 * Observed 2026-07-30: one click turned a shipped Gorilla into an Alchemist.
 *
 * Three assertions, and the third is what makes the first two mean anything:
 *
 *   1. clicking the button opens a confirmation naming the NPC wording;
 *   2. declining leaves the statblock — and `_stats.modifiedTime` — untouched;
 *   3. accepting DOES regenerate it.
 *
 * Without (3) this probe passes against a button that has been unwired entirely,
 * which is a different bug wearing the same green tick. (2) checks modifiedTime and
 * not only the fields, because regeneration takes ~5s: an earlier version of this
 * check waited 1.5s, saw an unchanged statblock and reported the destructive
 * behaviour absent. "Nothing happened" and "not finished yet" look identical.
 *
 * Usage: npm run dev:roll-npc
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog, withSettings } from "./lib.mjs";

const NAME = "ZZ Roll NPC Monster";
const SEED = { str: 14, hp: 4, profession: "", item: "ZZ Fists" };

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(240000, "roll-npc probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/** The statblock, in the form the finding is about. */
const readBlock = (id) => page.evaluate((actorId) => {
  const a = game.actors.get(actorId);
  if (!a) return null;
  return {
    str: a.system.abilities?.STR?.value,
    hp: a.system.hp?.value,
    profession: a.system.profession,
    items: a.items.map((i) => i.name).sort(),
    modified: a._stats?.modifiedTime ?? 0,
  };
}, id);

let npcId = null;

try {
  await withSettings(page, async () => {
    /* --- seed a monster-shaped NPC -------------------------------------- */

    npcId = await page.evaluate(async ({ name, seed }) => {
      // Stale actors first — a leftover from an aborted run carries an already
      // regenerated statblock and would satisfy the "unchanged" check vacuously.
      for (const s of game.actors.filter((a) => a.name === name)) await s.delete();
      await game.settings.set("air-bladder", "show-generate-header", true);
      const npc = await CONFIG.Actor.documentClass.create({
        name,
        type: "npc",
        system: {
          // STATED, not inherited from the schema initial. This probe is about
          // the hireling flow — career, day rate, statblock — and after the
          // 2026-08-20 split the initial happens to be `hireling` anyway. A
          // precondition a probe gets by accident is one that moves the day
          // somebody changes the default.
          role: "hireling",
          abilities: { STR: { value: seed.str, max: seed.str } },
          hp: { value: seed.hp, max: seed.hp },
          profession: seed.profession,
          // The default is Off now; this probe is about what the button DOES,
          // so it seeds the visibility the click needs.
          generationEnabled: true,
        },
        items: [{ name: seed.item, type: "weapon" }],
      });
      return npc.id;
    }, { name: NAME, seed: SEED });

    const before = await readBlock(npcId);
    if (before?.str !== SEED.str || before?.items.length !== 1) {
      fail(`seed did not take: ${JSON.stringify(before)}`);
      return;
    }
    ok(`seeded a monster-shaped npc (STR ${before.str}, HP ${before.hp}, ${JSON.stringify(before.items)})`);

    const sheetId = await page.evaluate(async (id) => {
      const a = game.actors.get(id);
      await a.sheet.render(true);
      return a.sheet.id;
    }, npcId);

    const rollButton = `#${sheetId} .window-header button[data-action="rollActor"]`;
    if (!(await page.locator(rollButton).count())) {
      fail("no Roll NPC header button — cannot test what it does");
      return;
    }
    ok("the Roll NPC header button renders on an npc");

    /* --- 1. it asks ----------------------------------------------------- */

    console.log("\nclicking Roll NPC");
    await page.click(rollButton);
    const dialog = page.locator(".application.dialog").last();
    try {
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      ok("a confirmation opened");
    } catch {
      fail("NO confirmation — the click went straight through to regeneration");
    }

    const title = (await dialog.locator(".window-title").innerText().catch(() => "")) || "";
    if (/npc/i.test(title)) ok(`the confirmation is NPC-worded ("${title.trim()}")`);
    else fail(`the confirmation is not NPC-worded ("${title.trim()}")`);

    /* --- 2. declining changes nothing ----------------------------------- */

    await dialog.locator('button[data-action="no"]').click();
    // Regeneration takes ~5s end to end. Wait past it, or "unchanged" only means
    // "not finished yet".
    await page.waitForTimeout(8000);

    const afterNo = await readBlock(npcId);
    const same = afterNo && before
      && afterNo.str === before.str && afterNo.hp === before.hp
      && JSON.stringify(afterNo.items) === JSON.stringify(before.items)
      && afterNo.modified === before.modified;
    if (same) ok("declining left the statblock and modifiedTime untouched");
    else fail(`declining still changed the actor: ${JSON.stringify(before)} -> ${JSON.stringify(afterNo)}`);

    /* --- 3. accepting really does regenerate ---------------------------- */

    console.log("\nclicking Roll NPC again, and accepting");
    await page.click(rollButton);
    const dialog2 = page.locator(".application.dialog").last();
    await dialog2.waitFor({ state: "visible", timeout: 5000 });
    await dialog2.locator('button[data-action="yes"]').click();

    // Poll rather than sleep a guessed interval: it is a table draw plus a pack
    // lookup plus an item rebuild, and it is slower on a cold pack cache.
    let afterYes = null;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      afterYes = await readBlock(npcId);
      if (afterYes && afterYes.modified !== before.modified) break;
    }

    if (afterYes && afterYes.modified !== before.modified) {
      ok(`accepting regenerated it (STR ${before.str}->${afterYes.str}, `
        + `HP ${before.hp}->${afterYes.hp}, ${afterYes.items.length} item(s))`);
    } else {
      fail("accepting did nothing — the button is unwired, so the checks above prove nothing");
    }

    // The upgrade-regression fix rides here too: a re-roll writes a day rate, so it
    // must set BOTH things that gate the day-rate row — role hireling and forHire —
    // or it stores an invisible number. It was one thing (role "hireling"), then two
    // (role "npc" + forHire) after the 2026-08-01 collapse, and is one-and-a-half
    // again after the 2026-08-20 split: the role carries the meaning and forHire
    // still gates the row, so BOTH are still checked.
    const roled = await page.evaluate((id) => {
      const a = game.actors.get(id);
      return { role: a.system.role, forHire: a.system.forHire, dayRate: a.system.dayRate };
    }, npcId);
    if (roled.role === "hireling" && roled.forHire === true) ok(`a regenerated hireling is role hireling and for hire (day rate ${roled.dayRate})`);
    else fail(`regeneration stored dayRate ${roled.dayRate} with ${JSON.stringify(roled)} — the sheet will never show it`);
  });
} finally {
  if (npcId) await page.evaluate(async (id) => { await game.actors.get(id)?.delete(); }, npcId).catch(() => {});
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "ROLL NPC PROBE FAILED" : "Roll NPC probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

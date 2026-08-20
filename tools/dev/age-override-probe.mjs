#!/usr/bin/env node
/**
 * The minimum-age floor + the settings-tab reorder.
 *
 *   1. Settings sections render General → Character Generation → Inventory.
 *      (Item 2 here was the Features toggle's relabel; the setting was removed
 *      with the Features UI, 2026-08-09, and the leg went with it.)
 *   3. The single min-age setting sits under the Character Generation header
 *      (no on/off toggle).
 *   4. rollAge() ALWAYS floors the roll at min-age — both generation and the sheet
 *      re-roll go through it — and a floor below 12 never binds (the off switch).
 *   5. rollAge() also CEILINGS the roll at max-age (issue #21), with the same
 *      off-by-an-unreachable-value shape: 50 is the highest 2d20 + 10 can give, so
 *      the shipped default never binds and adding it aged nobody's characters.
 *      And the RULING: a ceiling set BELOW the floor loses — the age comes out at
 *      the floor, never beneath the minimum the same Warden set.
 *
 * This probe drives `min-age` to 99 and MUST put it back. It once did not: it
 * threw between the two (`sheet._onRollAge` had gone in the AppV2 port) and its
 * in-page restore never ran, so the dev world kept a floor of 99 and every
 * character generated afterwards was aged 99, with the age re-roll appearing dead
 * because it floored to 99 too. Hence `withSettings`, whose restore runs in Node
 * and therefore survives a throw inside `page.evaluate`. Do not move the restore
 * back inside the evaluate.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await withSettings(page, () => page.evaluate(async () => {
    const NS = "air-bladder";
    const out = {};

    // --- 4. rollAge always floors; a floor below 12 is the off switch --------
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const prevMin = game.settings.get(NS, "min-age");
    const prevMax = game.settings.get(NS, "max-age");
    out.hasEnabledSetting = game.settings.settings.has(`${NS}.min-age-enabled`);
    out.hasMaxAge = game.settings.settings.has(`${NS}.max-age`);
    out.maxDefault = game.settings.settings.get(`${NS}.max-age`)?.default ?? null;

    // ESTABLISH the ceiling OFF before testing the FLOOR, and off means 0 — a
    // blank Number field, which `|| 0` in clampAge reads as "no ceiling".
    //
    // Not merely because a world carrying a low max-age would cap the 99-floor
    // rolls and red them for a reason that has nothing to do with the floor
    // (the allow-player-generate lesson, one setting along). Also because 50
    // would make these legs pass only BY the floor-wins ruling — with min 99 and
    // a ceiling of 50 the age is 99 solely because the ceiling is raised to meet
    // the floor. That coupling was real and a negative control found it: breaking
    // the ruling redded a FLOOR leg. A leg should fail for its own reason, so
    // the floor is tested with no ceiling at all and the ruling has its own leg.
    await game.settings.set(NS, "max-age", 0);

    // A floor below the lowest 2d20 + 10 roll (12) never binds -> natural spread.
    await game.settings.set(NS, "min-age", 5);
    const off = [];
    for (let i = 0; i < 40; i++) off.push(await gen.rollAge("2d20 + 10"));
    out.offMin = Math.min(...off);
    out.offMax = Math.max(...off);

    await game.settings.set(NS, "min-age", 99);
    const on = [];
    for (let i = 0; i < 40; i++) on.push(await gen.rollAge("2d20 + 10"));
    out.onMin = Math.min(...on);

    // The sheet's age re-roll must obey it too — generate a character, then
    // exercise the sheet handler and read the persisted age.
    const pack = game.packs.get(`${NS}.backgrounds-2e`);
    const bg = (await pack.getDocuments())[0];
    const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter(bg));
    out.actorId = actor.id;
    // Generated actors land with Randomization OFF (2026-08-02); the rollAge
    // die below is what the flag hides, so switch it on first.
    await actor.update({ "system.generationEnabled": true });
    out.genAge = Number(actor.system.age);          // 2. generation obeyed it
    // 4. The SHEET's re-roll obeys it too. ApplicationV2 keeps its handlers in
    //    private static methods reachable only through the `actions` map, so a
    //    probe drives them the way a user does — by clicking the element that
    //    carries the data-action. (This used to call `sheet._onRollAge` direct,
    //    which stopped existing at the AppV2 port and threw.)
    await actor.sheet.render(true);
    for (let i = 0; i < 30 && !(actor.sheet.element instanceof HTMLElement); i++) {
      await new Promise((res) => setTimeout(res, 100));
    }
    await new Promise((res) => setTimeout(res, 300));
    const ageBtn = actor.sheet.element?.querySelector?.('[data-action="rollAge"]');
    out.ageBtnFound = !!ageBtn;
    ageBtn?.click();
    for (let i = 0; i < 30 && Number(actor.system.age) === out.genAge; i++) {
      await new Promise((res) => setTimeout(res, 100));
    }
    out.sheetAge = Number(actor.system.age);

    // --- 5. the ceiling (issue #21) ---------------------------------------
    // Floor switched off first: these legs are about max-age alone.
    await game.settings.set(NS, "min-age", 5);

    // 50 is the top of 2d20 + 10, so it never binds. This is the shipped
    // default, and the leg is the proof that adding a ceiling aged nobody.
    await game.settings.set(NS, "max-age", 50);
    const ceilOff = [];
    for (let i = 0; i < 40; i++) ceilOff.push(await gen.rollAge("2d20 + 10"));
    out.ceilOffMin = Math.min(...ceilOff);
    out.ceilOffMax = Math.max(...ceilOff);

    await game.settings.set(NS, "max-age", 15);
    const ceilOn = [];
    for (let i = 0; i < 40; i++) ceilOn.push(await gen.rollAge("2d20 + 10"));
    out.ceilOnMax = Math.max(...ceilOn);
    out.ceilOnMin = Math.min(...ceilOn);

    // THE RULING: a ceiling under the floor loses, exactly.
    await game.settings.set(NS, "min-age", 30);
    await game.settings.set(NS, "max-age", 20);
    const conflict = [];
    for (let i = 0; i < 40; i++) conflict.push(await gen.rollAge("2d20 + 10"));
    out.conflictMin = Math.min(...conflict);
    out.conflictMax = Math.max(...conflict);

    // The SHEET re-roll obeys the ceiling too, driven by the same real click on
    // the rendered control rather than by calling the handler.
    await game.settings.set(NS, "min-age", 5);
    await game.settings.set(NS, "max-age", 14);
    const beforeCeil = Number(actor.system.age);
    const ageBtn2 = actor.sheet.element?.querySelector?.('[data-action="rollAge"]');
    out.ageBtn2Found = !!ageBtn2;
    ageBtn2?.click();
    for (let i = 0; i < 30 && Number(actor.system.age) === beforeCeil; i++) {
      await new Promise((res) => setTimeout(res, 100));
    }
    out.sheetCeilAge = Number(actor.system.age);

    await game.settings.set(NS, "min-age", prevMin);
    await game.settings.set(NS, "max-age", prevMax);

    // --- 1/2/3. render the settings config and read the air-bladder section ---
    const SC = foundry.applications?.settings?.SettingsConfig ?? globalThis.SettingsConfig;
    const app = new SC();
    await app.render(true);
    for (let i = 0; i < 25; i++) {
      if ((app.element instanceof HTMLElement ? app.element : app.element?.[0])) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    await new Promise((res) => setTimeout(res, 400));
    const root = app.element instanceof HTMLElement ? app.element : app.element?.[0];

    out.headerOrder = [...root.querySelectorAll("h3.cairn-settings-header")].map((h) => h.textContent.trim());

    // Which header each of our settings sits under: walk backwards to the
    // nearest preceding cairn-settings-header.
    const groupOf = (key) => {
      let el = root.querySelector(`[name="${NS}.${key}"]`)?.closest(".form-group");
      while (el) {
        if (el.previousElementSibling?.classList?.contains?.("cairn-settings-header"))
          return el.previousElementSibling.textContent.trim();
        el = el.previousElementSibling;
      }
      return null;
    };
    out.minAgeGroup = groupOf("min-age");
    out.maxAgeGroup = groupOf("max-age");
    const maxInput = root.querySelector(`[name="${NS}.max-age"]`);
    out.maxAgeInputType = maxInput?.getAttribute("type") ?? maxInput?.tagName?.toLowerCase() ?? null;
    // The min-age number field really is a number input defaulting to 21.
    const minInput = root.querySelector(`[name="${NS}.min-age"]`);
    out.minAgeInputType = minInput?.getAttribute("type") ?? minInput?.tagName?.toLowerCase() ?? null;

    await app.close();
    return out;
  }));

  // 1. section order
  const wanted = ["General Settings", "Character Generation", "Inventory & Encumbrance"];
  JSON.stringify(r.headerOrder) === JSON.stringify(wanted)
    ? ok(`settings sections in order: ${r.headerOrder.join(" → ")}`)
    : fail(`section order is ${JSON.stringify(r.headerOrder)}, expected ${JSON.stringify(wanted)}`);

  // 3. single age setting under Character Generation, no on/off toggle.
  //    It sat under General until 2026-07-28; it is a parameter of the character
  //    being generated, and settings grouping is positional, so it moved.
  !r.hasEnabledSetting
    ? ok("no separate min-age on/off toggle exists (the value is the only control)")
    : fail("a min-age-enabled toggle is still registered");
  r.minAgeGroup === "Character Generation"
    ? ok("the minimum-age setting sits under Character Generation")
    : fail(`min-age group placement: ${r.minAgeGroup}`);
  r.minAgeInputType === "number"
    ? ok("the minimum-age value is a number field")
    : fail(`min-age field type is "${r.minAgeInputType}", expected number`);

  // 4. floor behaviour
  r.offMin >= 12 && r.offMax <= 50 && r.offMax > r.offMin
    ? ok(`floor below 12 never binds: ages spread naturally across 12..50 (saw ${r.offMin}..${r.offMax})`)
    : fail(`floor of 5 produced ${r.offMin}..${r.offMax}, expected a 12..50 spread`);
  r.onMin >= 99
    ? ok(`floor 99: every rolled age >= 99 (lowest ${r.onMin})`)
    : fail(`floor 99 let an age of ${r.onMin} through`);
  r.genAge >= 99
    ? ok(`generation obeyed the override (generated age ${r.genAge})`)
    : fail(`a generated character came out age ${r.genAge}, below the 99 floor`);
  // Assert the control EXISTS before trusting what it produced. Generation also
  // obeys the floor, so if the click silently did nothing, sheetAge would still
  // be >= 99 and the check below would pass green having exercised nothing —
  // which is exactly how this probe rotted unnoticed.
  r.ageBtnFound
    ? ok("the sheet exposes a [data-action=rollAge] control")
    : fail("no [data-action=rollAge] control on the rendered sheet — the re-roll check below proves nothing");
  r.sheetAge >= 99
    ? ok(`the sheet's age re-roll obeyed the override (re-rolled to ${r.sheetAge})`)
    : fail(`the sheet re-roll produced ${r.sheetAge}, below the 99 floor`);

  // 5. the ceiling (issue #21)
  r.hasMaxAge
    ? ok("a max-age setting is registered")
    : fail("no max-age setting is registered — every ceiling leg below is vacuous");
  r.maxDefault === 50
    ? ok("max-age ships at 50, the top of 2d20 + 10, so it cannot bind on upgrade")
    : fail(`max-age default is ${r.maxDefault}, expected 50 — a binding default re-ages existing worlds`);
  r.maxAgeGroup === "Character Generation"
    ? ok("the maximum-age setting sits under Character Generation, beside the floor")
    : fail(`max-age group placement: ${r.maxAgeGroup}`);
  r.maxAgeInputType === "number"
    ? ok("the maximum-age value is a number field")
    : fail(`max-age field type is "${r.maxAgeInputType}", expected number`);
  r.ceilOffMax > 40 && r.ceilOffMin >= 12
    ? ok(`ceiling 50 never binds: ages still reach the top (saw ${r.ceilOffMin}..${r.ceilOffMax})`)
    : fail(`ceiling 50 produced ${r.ceilOffMin}..${r.ceilOffMax} — it is clamping when it must not`);
  r.ceilOnMax <= 15
    ? ok(`ceiling 15: every rolled age <= 15 (highest ${r.ceilOnMax})`)
    : fail(`ceiling 15 let an age of ${r.ceilOnMax} through`);
  // Not vacuous, and the leg above says why: with the ceiling off the same 40
  // rolls reached past 40, so a ceiling doing nothing would show that spread here.
  r.ceilOnMin >= 12
    ? ok(`...and it did not drag ages below the die's own floor (lowest ${r.ceilOnMin})`)
    : fail(`ceiling 15 produced ${r.ceilOnMin}, below the lowest roll 2d20 + 10 can give`);
  r.conflictMin === 30 && r.conflictMax === 30
    ? ok("THE RULING: max 20 under min 30 yields exactly 30 — the floor wins")
    : fail(`min 30 / max 20 produced ${r.conflictMin}..${r.conflictMax}, expected a flat 30`);
  r.ageBtn2Found
    ? ok("the sheet control is still present for the ceiling leg")
    : fail("no [data-action=rollAge] control — the ceiling re-roll check proves nothing");
  r.sheetCeilAge <= 14
    ? ok(`the sheet's age re-roll obeyed the ceiling (re-rolled to ${r.sheetCeilAge})`)
    : fail(`the sheet re-roll produced ${r.sheetCeilAge}, above the 14 ceiling`);

  await page.evaluate(async (id) => { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }, r.actorId);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nAGE OVERRIDE PROBE FAILED\n" : "\nage override probe passed\n");
process.exit(failed ? 1 : 0);

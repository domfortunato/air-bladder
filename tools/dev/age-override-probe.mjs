#!/usr/bin/env node
/**
 * The minimum-age floor + the settings-tab reorder.
 *
 *   1. Settings sections render General → Character Generation → Inventory.
 *   2. The Features toggle reads "Show Features List on character's Description tab".
 *   3. The single min-age setting sits under the General header (no on/off toggle).
 *   4. rollAge() ALWAYS floors the roll at min-age — both generation and the sheet
 *      re-roll go through it — and a floor below 12 never binds (the off switch).
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

    // --- 4. rollAge always floors; a floor below 12 is the off switch --------
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const prevMin = game.settings.get(NS, "min-age");
    out.hasEnabledSetting = game.settings.settings.has(`${NS}.min-age-enabled`);

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
    out.genAge = Number(actor.system.age);          // 2. generation obeyed it
    await actor.sheet._onRollAge(new Event("x"));    // 4. sheet re-roll obeys it
    out.sheetAge = Number(actor.system.age);

    await game.settings.set(NS, "min-age", prevMin);

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
    out.featuresLabel = root.querySelector(`[name="${NS}.show-features-section"]`)
      ?.closest(".form-group")?.querySelector("label")?.textContent.trim() ?? null;
    // The min-age number field really is a number input defaulting to 21.
    const minInput = root.querySelector(`[name="${NS}.min-age"]`);
    out.minAgeInputType = minInput?.getAttribute("type") ?? minInput?.tagName?.toLowerCase() ?? null;

    await app.close();
    return out;
  });

  // 1. section order
  const wanted = ["General Settings", "Character Generation", "Inventory & Encumbrance"];
  JSON.stringify(r.headerOrder) === JSON.stringify(wanted)
    ? ok(`settings sections in order: ${r.headerOrder.join(" → ")}`)
    : fail(`section order is ${JSON.stringify(r.headerOrder)}, expected ${JSON.stringify(wanted)}`);

  // 2. relabelled Features setting
  r.featuresLabel === "Show Features List on character's Description tab"
    ? ok(`Features toggle relabelled ("${r.featuresLabel}")`)
    : fail(`Features label is "${r.featuresLabel}"`);

  // 3. single age setting under General, no on/off toggle
  !r.hasEnabledSetting
    ? ok("no separate min-age on/off toggle exists (the value is the only control)")
    : fail("a min-age-enabled toggle is still registered");
  r.minAgeGroup === "General Settings"
    ? ok("the minimum-age setting sits under General Settings")
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
  r.sheetAge >= 99
    ? ok(`the sheet's age re-roll obeyed the override (re-rolled to ${r.sheetAge})`)
    : fail(`the sheet re-roll produced ${r.sheetAge}, below the 99 floor`);

  await page.evaluate(async (id) => { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }, r.actorId);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nAGE OVERRIDE PROBE FAILED\n" : "\nage override probe passed\n");
process.exit(failed ? 1 : 0);

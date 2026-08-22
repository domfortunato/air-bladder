#!/usr/bin/env node
/**
 * The Warden's age FORMULA + the settings-tab reorder.
 *
 * min-age (in since the first commit, default 21 and BINDING) and max-age
 * (2026-08-19, issue #21) are RETIRED (2026-08-21, user ruling on Malecho's
 * follow-up report): clamping a bell curve piles ages onto the bound — with a
 * ceiling of 30, ~57% of 2d20+10 rolls came out exactly 30, which a Warden
 * reads as "every character is the same age". The cap worked as coded; the
 * DESIGN was the defect. One `age-formula` setting replaces both: the Warden
 * edits the dice, so a chosen range is a DISTRIBUTION, not a spike at a clamp.
 *
 *   1. Settings sections render General → Character Generation → Inventory.
 *   2. `age-formula` is registered (String, under Character Generation, a
 *      text field) and `min-age` / `max-age` are NOT — neither in the
 *      registry nor on the rendered form.
 *   3. The DEFAULT `{2d20 + 10, 21}kh` preserves released behavior exactly:
 *      it is max(2d20 + 10, 21), so dice pinned to minimum give 21 (the old
 *      floor, now IN the formula) and pinned to maximum give 50. The pool
 *      form survives both dice-notation dialects — its "+"-separated pieces
 *      are not bare dice, so the keep-highest rewrite never claims it.
 *   4. The setting GOVERNS the roll everywhere rollAge reaches: a constant
 *      formula lands every age on it — generation and the sheet's REAL
 *      age-die click included — and a range formula's pinned extremes are its
 *      own bounds, nobody clamping anything.
 *   5. A formula that does not parse falls back to the caller's default and
 *      WARNS, naming the rejected text, so a Warden's typo is heard about. A
 *      BLANK field falls back silently — blank is "reset", not a mistake.
 *
 * Dice are pinned via CONFIG.Dice.randomUniform (INVERTED: ceil((1-u)*faces),
 * so u near 1 pins every die to 1 and u near 0 to its maximum) and restored
 * in-page; settings writes ride withSettings so the restore runs in Node —
 * the min-age-99 leak lesson (2026-07-29) stands whatever the key is called.
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
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    // What every real call site passes: the config formula, as the fallback.
    const FALLBACK = CONFIG.Cairn?.characterGenerator2e?.biography?.age ?? "{2d20 + 10, 21}kh";

    out.hasAgeFormula = game.settings.settings.has(`${NS}.age-formula`);
    out.hasMinAge = game.settings.settings.has(`${NS}.min-age`);
    out.hasMaxAge = game.settings.settings.has(`${NS}.max-age`);
    out.formulaDefault = game.settings.settings.get(`${NS}.age-formula`)?.default ?? null;

    // --- 1/2. render the settings config; section order + our fields ---------
    const SC = foundry.applications?.settings?.SettingsConfig ?? globalThis.SettingsConfig;
    const app = new SC();
    await app.render(true);
    for (let i = 0; i < 25; i++) {
      if (app.element instanceof HTMLElement) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    await new Promise((res) => setTimeout(res, 400));
    const root = app.element instanceof HTMLElement ? app.element : app.element?.[0];
    out.headerOrder = [...root.querySelectorAll("h3.cairn-settings-header")].map((h) => h.textContent.trim());
    const groupOf = (key) => {
      let el = root.querySelector(`[name="${NS}.${key}"]`)?.closest(".form-group");
      while (el) {
        if (el.previousElementSibling?.classList?.contains?.("cairn-settings-header"))
          return el.previousElementSibling.textContent.trim();
        el = el.previousElementSibling;
      }
      return null;
    };
    out.formulaGroup = groupOf("age-formula");
    const input = root.querySelector(`[name="${NS}.age-formula"]`);
    out.formulaInputType = input?.getAttribute("type") ?? input?.tagName?.toLowerCase() ?? null;
    out.minAgeOnForm = !!root.querySelector(`[name="${NS}.min-age"]`);
    out.maxAgeOnForm = !!root.querySelector(`[name="${NS}.max-age"]`);
    await app.close();

    // Everything past here SETS the new setting; against a build without it,
    // game.settings.set throws and one absence would red every leg. Return
    // instead, and let each Node-side leg fail for its own reason.
    if (!out.hasAgeFormula) return out;

    const pinned = async (u, formula) => {
      const orig = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => u;
      try { return await gen.rollAge(formula); } finally { CONFIG.Dice.randomUniform = orig; }
    };

    // --- 3. the default preserves the released 21..50 ------------------------
    await game.settings.set(NS, "age-formula", out.formulaDefault);
    out.defLow = await pinned(0.9999, FALLBACK);   // every die -> 1: 2d20+10 = 12, kh keeps 21
    out.defHigh = await pinned(0.0001, FALLBACK);  // every die -> max: 50
    const spread = [];
    for (let i = 0; i < 40; i++) spread.push(await gen.rollAge(FALLBACK));
    out.defMin = Math.min(...spread);
    out.defMax = Math.max(...spread);

    // --- 4. the setting governs --------------------------------------------
    await game.settings.set(NS, "age-formula", "7");
    const sevens = [];
    for (let i = 0; i < 3; i++) sevens.push(await gen.rollAge(FALLBACK));
    out.constAges = sevens;

    await game.settings.set(NS, "age-formula", "2d6 + 18");
    out.rangeLow = await pinned(0.9999, FALLBACK);   // 2 + 18
    out.rangeHigh = await pinned(0.0001, FALLBACK);  // 12 + 18
    const range = [];
    for (let i = 0; i < 40; i++) range.push(await gen.rollAge(FALLBACK));
    out.rangeMin = Math.min(...range);
    out.rangeMax = Math.max(...range);

    // Generation obeys it: a constant formula, a generated character.
    await game.settings.set(NS, "age-formula", "7");
    const pack = game.packs.get(`${NS}.backgrounds-2e`);
    const bg = (await pack.getDocuments())[0];
    const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter(bg));
    out.actorId = actor.id;
    out.genAge = Number(actor.system.age);
    // Generated actors land with Randomization OFF (2026-08-02); the rollAge
    // die below is what the flag hides, so switch it on first.
    await actor.update({ "system.generationEnabled": true });

    // The SHEET's re-roll obeys it too — the real click on the rendered die
    // (AppV2 keeps handlers behind the actions map, so a probe drives the
    // element the way a user does). A DIFFERENT constant than generation's,
    // so the change is observable: 7 -> 9.
    await game.settings.set(NS, "age-formula", "9");
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

    // --- 5. invalid falls back with a warning; blank falls back silently ----
    const warns = [];
    const origWarn = ui.notifications.warn;
    ui.notifications.warn = function (m, ...rest) { warns.push(String(m)); return origWarn.call(this, m, ...rest); };
    try {
      await game.settings.set(NS, "age-formula", "not dice");
      out.invalidAge = await pinned(0.9999, FALLBACK);  // the fallback's floor case
      out.warnsAfterInvalid = warns.length;
      out.warnText = warns[0] ?? "";
      await game.settings.set(NS, "age-formula", "");
      out.blankAge = await pinned(0.9999, FALLBACK);
      out.warnsAfterBlank = warns.length;
    } finally {
      ui.notifications.warn = origWarn;
    }
    return out;
  }));

  // 1. section order
  const wanted = ["General Settings", "Character Generation", "Inventory & Encumbrance"];
  JSON.stringify(r.headerOrder) === JSON.stringify(wanted)
    ? ok(`settings sections in order: ${r.headerOrder.join(" → ")}`)
    : fail(`section order is ${JSON.stringify(r.headerOrder)}, expected ${JSON.stringify(wanted)}`);

  // 2. one formula setting, two retired bounds
  r.hasAgeFormula
    ? ok("an age-formula setting is registered")
    : fail("no age-formula setting is registered — every roll leg below is vacuous");
  !r.hasMinAge && !r.hasMaxAge
    ? ok("min-age and max-age are RETIRED — neither is registered")
    : fail(`retired bounds still registered: min-age=${r.hasMinAge}, max-age=${r.hasMaxAge}`);
  !r.minAgeOnForm && !r.maxAgeOnForm
    ? ok("...and neither renders on the settings form")
    : fail(`retired bounds still on the form: min-age=${r.minAgeOnForm}, max-age=${r.maxAgeOnForm}`);
  r.formulaDefault === "{2d20 + 10, 21}kh"
    ? ok("the default is {2d20 + 10, 21}kh — max(2d20+10, 21), the released 21-floor behavior")
    : fail(`age-formula default is ${JSON.stringify(r.formulaDefault)}, expected "{2d20 + 10, 21}kh"`);
  r.formulaGroup === "Character Generation"
    ? ok("the age-formula setting sits under Character Generation")
    : fail(`age-formula group placement: ${r.formulaGroup}`);
  r.formulaInputType === "text"
    ? ok("the formula is a text field")
    : fail(`age-formula field type is "${r.formulaInputType}", expected text`);

  // 3. the default's behavior
  r.defLow === 21
    ? ok("default, dice pinned low: exactly 21 — the floor lives in the formula now")
    : fail(`pinned-low default gave ${r.defLow}, expected 21`);
  r.defHigh === 50
    ? ok("default, dice pinned high: exactly 50")
    : fail(`pinned-high default gave ${r.defHigh}, expected 50`);
  r.defMin >= 21 && r.defMax <= 50
    ? ok(`40 natural default rolls stay in 21..50 (saw ${r.defMin}..${r.defMax})`)
    : fail(`default rolls strayed to ${r.defMin}..${r.defMax}`);

  // 4. the setting governs
  JSON.stringify(r.constAges) === JSON.stringify([7, 7, 7])
    ? ok("a constant formula lands every age on it (7, 7, 7)")
    : fail(`constant formula "7" produced ${JSON.stringify(r.constAges)}`);
  r.rangeLow === 20 && r.rangeHigh === 30
    ? ok("2d6 + 18 pinned extremes are 20 and 30 — the range is the dice's own")
    : fail(`2d6+18 pinned extremes were ${r.rangeLow}/${r.rangeHigh}, expected 20/30`);
  r.rangeMin >= 20 && r.rangeMax <= 30
    ? ok(`40 natural 2d6+18 rolls stay in 20..30 (saw ${r.rangeMin}..${r.rangeMax})`)
    : fail(`2d6+18 rolls strayed to ${r.rangeMin}..${r.rangeMax}`);
  r.genAge === 7
    ? ok("generation obeyed the setting (generated age 7)")
    : fail(`a generated character came out age ${r.genAge}, expected 7`);
  // Assert the control EXISTS before trusting what it produced — the lesson
  // from this probe's own rot (the AppV2 casualty).
  r.ageBtnFound
    ? ok("the sheet exposes a [data-action=rollAge] control")
    : fail("no [data-action=rollAge] control on the rendered sheet — the re-roll check below proves nothing");
  r.sheetAge === 9
    ? ok("the sheet's real age-die click obeyed the setting (7 -> 9)")
    : fail(`the sheet re-roll produced ${r.sheetAge}, expected 9`);

  // 5. invalid vs blank
  r.invalidAge === 21 && r.warnsAfterInvalid >= 1
    ? ok("an invalid formula falls back to the default AND warns")
    : fail(`invalid formula: age ${r.invalidAge} (expected 21), warns ${r.warnsAfterInvalid}`);
  (r.warnText ?? "").includes("not dice")
    ? ok("the warning names the rejected formula")
    : fail(`warning text does not name the formula: ${JSON.stringify(r.warnText)}`);
  r.blankAge === 21 && r.warnsAfterBlank === r.warnsAfterInvalid
    ? ok("a blank formula falls back silently — blank is reset, not a mistake")
    : fail(`blank formula: age ${r.blankAge} (expected 21), warns went ${r.warnsAfterInvalid} -> ${r.warnsAfterBlank}`);

  if (r.actorId) {
    await page.evaluate(async (id) => { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }, r.actorId);
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nAGE OVERRIDE PROBE FAILED\n" : "\nage override probe passed\n");
process.exit(failed ? 1 : 0);

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
 *   3. The DEFAULT is RAW Cairn: `2d20 + 10` (user ruling, 2026-08-21 —
 *      rules as written win over preserving the old min-age 21 default,
 *      which was an override, not the game). Dice pinned to minimum give
 *      12, pinned to maximum 50. A Warden who wants the old floor writes
 *      the pool form `{2d20 + 10, 21}kh` themselves — max(roll, 21), the
 *      hint's own example.
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
    const FALLBACK = CONFIG.Cairn?.characterGenerator2e?.biography?.age ?? "2d20 + 10";

    out.hasAgeFormula = game.settings.settings.has(`${NS}.age-formula`);
    out.hasMinAge = game.settings.settings.has(`${NS}.min-age`);
    out.hasMaxAge = game.settings.settings.has(`${NS}.max-age`);
    out.formulaDefault = game.settings.settings.get(`${NS}.age-formula`)?.default ?? null;

    // --- 1/2. the settings window, then the Character Generation submenu ----
    // Since 2026-08-22 every Warden-facing setting lives behind one of three
    // registerMenu submenus (settings-menus.js): the main window shows three
    // buttons and no air-bladder rows, and the age formula is a row of the
    // Character Generation app. Hints render beneath every row there — core's
    // own formGroup layout — so the compact-row/tooltip split this probe used
    // to hold went with the flat list.
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const SC = foundry.applications?.settings?.SettingsConfig ?? globalThis.SettingsConfig;
    const cfgApp = new SC();
    await cfgApp.render(true);
    for (let i = 0; i < 25; i++) {
      if (cfgApp.element instanceof HTMLElement) break;
      await sleep(200);
    }
    await sleep(400);
    const cfgRoot = cfgApp.element;
    const mod = await import("/systems/air-bladder/module/settings.js");
    out.declaredMenus = mod.SETTING_GROUPS.map((g) => g.id);
    out.menuOrder = [...cfgRoot.querySelectorAll(`button[data-action="openSubmenu"][data-key^="${NS}."]`)]
      .map((b) => b.dataset.key.slice(NS.length + 1));
    out.minAgeOnForm = !!cfgRoot.querySelector(`[name="${NS}.min-age"]`);
    out.maxAgeOnForm = !!cfgRoot.querySelector(`[name="${NS}.max-age"]`);
    out.formulaOnFlatList = !!cfgRoot.querySelector(`[name="${NS}.age-formula"]`);
    await cfgApp.close();

    const menu = game.settings.menus.get(`${NS}.generation`);
    out.generationMenu = !!menu;
    const app = menu ? new menu.type() : null;
    if (app) { await app.render(true); await sleep(600); }
    const root = app?.element;
    const input = root?.querySelector(`[name="${NS}.age-formula"]`);
    out.formulaInApp = !!input;
    out.formulaInputType = input?.getAttribute("type") ?? input?.tagName?.toLowerCase() ?? null;
    out.minAgeInApp = !!root?.querySelector(`[name="${NS}.min-age"]`);
    out.maxAgeInApp = !!root?.querySelector(`[name="${NS}.max-age"]`);

    // Hint surfacing: computed display is read off the hint element itself,
    // so a hidden ancestor cannot fake the state (the lesson of 2026-08-21,
    // when it turned out no air-bladder hint had EVER rendered).
    const hintOf = (key) => root?.querySelector(`[name="${NS}.${key}"]`)?.closest(".form-group")?.querySelector(".hint");
    const display = (el) => (el ? getComputedStyle(el).display : "missing");
    out.ageHintDisplay = display(hintOf("age-formula"));
    out.ageHintText = hintOf("age-formula")?.textContent ?? "";
    out.folderHintDisplay = display(hintOf("custom-portrait-folder"));
    // A CHECKBOX row too: the old compact rows hid theirs and carried the
    // text as a hover tooltip instead. In the submenu every row shows its
    // hint and nothing carries data-tooltip-text.
    out.checkboxHintDisplay = display(hintOf("show-generation-rolls"));
    out.checkboxHintText = hintOf("show-generation-rolls")?.textContent?.trim() ?? "";
    out.checkboxHintExpected = game.i18n.localize(game.settings.settings.get(`${NS}.show-generation-rolls`)?.hint ?? "");
    out.tooltipTextCount = root ? root.querySelectorAll("[data-tooltip-text]").length : -1;
    if (app) await app.close();

    // Everything past here SETS the new setting; against a build without it,
    // game.settings.set throws and one absence would red every leg. Return
    // instead, and let each Node-side leg fail for its own reason.
    if (!out.hasAgeFormula) return out;

    const pinned = async (u, formula) => {
      const orig = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => u;
      try { return await gen.rollAge(formula); } finally { CONFIG.Dice.randomUniform = orig; }
    };

    // --- 3. the default is RAW 2d20 + 10 -------------------------------------
    await game.settings.set(NS, "age-formula", out.formulaDefault);
    out.defLow = await pinned(0.9999, FALLBACK);   // every die -> 1: 2d20+10 = 12
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

      // --- @-references (review #17): the validator LIES about this class --
      // CONTROL first: Roll.validate still ACCEPTS the formula the guard
      // refuses — it stubs every @ref to "1" before evaluating
      // (dice/roll.mjs:772-790), while real evaluation resolves them
      // {missing: "0"}. If this control ever goes false, core fixed the stub
      // and the rollAge guard may be retirable. Pre-fix, "@bonus + 3" passed
      // the gate and made every age exactly 3, with no warning anywhere.
      out.atStillValidates = Roll.validate("@bonus + 3");
      await game.settings.set(NS, "age-formula", "@bonus + 3");
      out.atAge = await pinned(0.9999, FALLBACK);   // fallback's floor: 12
      out.warnsAfterAt = warns.length;
      out.atWarnText = warns[warns.length - 1] ?? "";
    } finally {
      ui.notifications.warn = origWarn;
    }
    return out;
  }));

  // 1. the submenu buttons, in declared order; the formula is behind one
  JSON.stringify(r.menuOrder) === JSON.stringify(r.declaredMenus)
    ? ok(`settings submenus in order: ${r.menuOrder.join(" → ")}`)
    : fail(`submenu order is ${JSON.stringify(r.menuOrder)}, expected ${JSON.stringify(r.declaredMenus)}`);
  !r.formulaOnFlatList
    ? ok("the age formula is not a loose row on the main settings window (it lives in a submenu)")
    : fail("age-formula renders on the flat list — it should be config:false behind the Generation submenu");

  // 2. one formula setting, two retired bounds
  r.hasAgeFormula
    ? ok("an age-formula setting is registered")
    : fail("no age-formula setting is registered — every roll leg below is vacuous");
  !r.hasMinAge && !r.hasMaxAge
    ? ok("min-age and max-age are RETIRED — neither is registered")
    : fail(`retired bounds still registered: min-age=${r.hasMinAge}, max-age=${r.hasMaxAge}`);
  !r.minAgeOnForm && !r.maxAgeOnForm && !r.minAgeInApp && !r.maxAgeInApp
    ? ok("...and neither renders on the settings window nor in the Generation submenu")
    : fail(`retired bounds still on a form: window min=${r.minAgeOnForm}/max=${r.maxAgeOnForm}, submenu min=${r.minAgeInApp}/max=${r.maxAgeInApp}`);
  r.formulaDefault === "2d20 + 10"
    ? ok("the default is RAW Cairn 2d20 + 10 (the 21 floor was an override, not the game)")
    : fail(`age-formula default is ${JSON.stringify(r.formulaDefault)}, expected "2d20 + 10"`);
  r.generationMenu && r.formulaInApp
    ? ok("the age-formula setting sits in the Character Generation submenu")
    : fail(`age-formula placement: generation menu registered=${r.generationMenu}, formula rendered in it=${r.formulaInApp}`);
  r.formulaInputType === "text"
    ? ok("the formula is a text field")
    : fail(`age-formula field type is "${r.formulaInputType}", expected text`);
  r.ageHintDisplay !== "none" && r.ageHintDisplay !== "missing" && r.ageHintText.includes("Dice Formulas")
    ? ok("the Age formula row SHOWS its hint, naming the Dice Formulas guide")
    : fail(`age hint: display=${r.ageHintDisplay}, text=${JSON.stringify((r.ageHintText || "").slice(0, 60))}`);
  r.folderHintDisplay !== "none" && r.folderHintDisplay !== "missing"
    ? ok("the portrait-folder row (the other text setting) shows its hint too")
    : fail(`folder hint display: ${r.folderHintDisplay}`);
  r.checkboxHintDisplay !== "none" && r.checkboxHintDisplay !== "missing" && r.checkboxHintText === r.checkboxHintExpected
    ? ok("a checkbox row shows its hint beneath too — every submenu row does; the compact-row tooltip split is gone")
    : fail(`checkbox row hint: display=${r.checkboxHintDisplay}, text=${JSON.stringify((r.checkboxHintText || "").slice(0, 40))}`);
  r.tooltipTextCount === 0
    ? ok("...and nothing in the submenu carries data-tooltip-text any more")
    : fail(`${r.tooltipTextCount} element(s) in the Generation submenu still carry data-tooltip-text`);

  // 3. the default's behavior
  r.defLow === 12
    ? ok("default, dice pinned low: exactly 12 — RAW, no floor")
    : fail(`pinned-low default gave ${r.defLow}, expected 12`);
  r.defHigh === 50
    ? ok("default, dice pinned high: exactly 50")
    : fail(`pinned-high default gave ${r.defHigh}, expected 50`);
  r.defMin >= 12 && r.defMax <= 50
    ? ok(`40 natural default rolls stay in 12..50 (saw ${r.defMin}..${r.defMax})`)
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
  r.invalidAge === 12 && r.warnsAfterInvalid >= 1
    ? ok("an invalid formula falls back to the default AND warns")
    : fail(`invalid formula: age ${r.invalidAge} (expected 12), warns ${r.warnsAfterInvalid}`);
  (r.warnText ?? "").includes("not dice")
    ? ok("the warning names the rejected formula")
    : fail(`warning text does not name the formula: ${JSON.stringify(r.warnText)}`);
  r.blankAge === 12 && r.warnsAfterBlank === r.warnsAfterInvalid
    ? ok("a blank formula falls back silently — blank is reset, not a mistake")
    : fail(`blank formula: age ${r.blankAge} (expected 12), warns went ${r.warnsAfterInvalid} -> ${r.warnsAfterBlank}`);
  r.atStillValidates
    ? ok('CONTROL: Roll.validate still accepts "@bonus + 3" — the trap the @ guard refuses is live')
    : fail("Roll.validate now refuses @-references — core changed under us; the rollAge @ guard may be retirable");
  r.atAge === 12 && r.warnsAfterAt === r.warnsAfterBlank + 1
    ? ok("an @-reference formula falls back to the default AND warns (pre-fix it rolled with the ref zeroed: every age 3)")
    : fail(`@ formula: age ${r.atAge} (expected 12, and 3 means the ref was silently zeroed), warns ${r.warnsAfterBlank} -> ${r.warnsAfterAt}`);
  (r.atWarnText ?? "").includes("@bonus")
    ? ok("the @ warning names the rejected formula")
    : fail(`@ warning does not name the formula: ${JSON.stringify(r.atWarnText)}`);

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

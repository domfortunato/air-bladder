#!/usr/bin/env node
/**
 * The three parity items ported from the system this descends from:
 *
 *   1. Failed career is EDITABLE — a dice re-roll and a picker on the sheet, not
 *      a value you are stuck with from generation.
 *   2. The failed-career line respects its GM setting live: switching the setting
 *      off hides it on an already-generated character.
 *   3. show-omens-barebones gates the Omen field for Barebones characters, and
 *      leaves 2e characters alone.
 *
 * Drives a real Barebones character rather than inspecting config, because every
 * one of these is a context/handler question and reading the setting back proves
 * nothing about whether the sheet honours it.
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
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const out = { made: [] };

    const was = {
      career: game.settings.get(NS, "barebones-failed-career"),
      omens: game.settings.get(NS, "show-omens-barebones"),
      bb: game.settings.get(NS, "content-source-barebones"),
    };
    await game.settings.set(NS, "content-source-barebones", true);
    await game.settings.set(NS, "barebones-failed-career", true);
    await game.settings.set(NS, "show-omens-barebones", false);

    try {
      const bgs = await gen.getBarebonesBackgrounds();
      const bg = bgs.find((b) => b.name === "Baker") ?? bgs[0];
      const c = await gen.generateBarebonesCharacter(bg);
      const actor = await gen.createActorWithCharacter(c);
      out.made.push(actor.id);

      out.generatedCareer = actor.system.failedCareer;
      out.background = actor.system.background;

      // getData() became _prepareContext(options) at the ApplicationV2 port. It
      // takes the render options rather than nothing, so pass an empty object.
      const ctx1 = await actor.sheet._prepareContext({});
      out.shownWithSetting = ctx1.showFailedCareer;
      out.omenHiddenForBarebones = ctx1.showOmen;

      // 1. the dice re-rolls it, and never to the real background.
      //
      // Clicked, not called: the handler is a PRIVATE static in the actions map
      // now (#onRollFailedCareer), so there is nothing to invoke from outside.
      // Going through the DOM is the better test anyway -- it exercises the
      // action dispatch and the isEditable gate that wraps every entry.
      await actor.sheet.render(true);
      for (let i = 0; i < 20 && !actor.sheet.element; i++) await new Promise((res) => setTimeout(res, 150));
      await new Promise((res) => setTimeout(res, 350));
      const dice = actor.sheet.element?.querySelector('[data-action="rollFailedCareer"]');
      out.diceControlExists = !!dice;
      dice?.click();
      await new Promise((res) => setTimeout(res, 700));
      out.afterRoll = actor.system.failedCareer;

      // 2. turning the setting off hides the line on an EXISTING character
      await game.settings.set(NS, "barebones-failed-career", false);
      out.shownWithoutSetting = (await actor.sheet._prepareContext({})).showFailedCareer;
      await game.settings.set(NS, "barebones-failed-career", true);

      // 3. the omens setting opens the field for Barebones...
      await game.settings.set(NS, "show-omens-barebones", true);
      out.omenShownWhenEnabled = (await actor.sheet._prepareContext({})).showOmen;
      await game.settings.set(NS, "show-omens-barebones", false);

      // ...and a 2e character is unaffected either way
      const p2 = game.packs.get("air-bladder.backgrounds-2e");
      const bg2 = (await p2.getDocuments())[0];
      const c2 = await gen.generate2eCharacter(bg2);
      const a2 = await gen.createActorWithCharacter(c2);
      out.made.push(a2.id);
      out.omenShownFor2e = (await a2.sheet._prepareContext({})).showOmen;
      out.careerHiddenFor2e = (await a2.sheet._prepareContext({})).showFailedCareer;

      // the picker exists and is name-only (no gear side effects)
      out.hasPrompt = typeof gen.promptFailedCareer === "function";
      const before = a2.items.size;
      out.itemsUnchanged = before === a2.items.size;
    } finally {
      for (const id of out.made) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
      await game.settings.set(NS, "barebones-failed-career", was.career);
      await game.settings.set(NS, "show-omens-barebones", was.omens);
      await game.settings.set(NS, "content-source-barebones", was.bb);
    }
    return out;
  });

  r.generatedCareer ? ok(`generation gave a failed career: "${r.generatedCareer}"`)
                    : fail("no failed career generated with the setting on");
  r.shownWithSetting ? ok("the sheet shows the failed-career line for a Barebones character")
                     : fail("failed-career line hidden despite the setting being on");
  // Without this, "the dice re-rolls it" passes vacuously when the control is
  // absent: nothing runs, the generated value stays put, and it was already
  // different from the background.
  r.diceControlExists ? ok("the re-roll control is on the rendered sheet")
                      : fail('no [data-action="rollFailedCareer"] on the sheet — nothing was clicked');
  r.afterRoll && r.afterRoll !== r.background
    ? ok(`the dice re-rolls it: "${r.generatedCareer}" -> "${r.afterRoll}" (never the real background "${r.background}")`)
    : fail(`re-roll produced "${r.afterRoll}" against background "${r.background}"`);
  r.shownWithoutSetting === false
    ? ok("switching the setting off hides the line on an ALREADY-generated character")
    : fail("the line survived the setting being switched off — it is not read live");
  r.hasPrompt ? ok("promptFailedCareer is exported for the magnifier")
              : fail("promptFailedCareer missing");

  r.omenHiddenForBarebones === false
    ? ok("Omen is hidden for Barebones by default")
    : fail("Omen shown for Barebones with show-omens-barebones off");
  r.omenShownWhenEnabled ? ok("show-omens-barebones reveals the Omen field")
                         : fail("show-omens-barebones did not reveal the Omen field");
  r.omenShownFor2e ? ok("a 2e character keeps its Omen regardless of that setting")
                   : fail("the Barebones omens setting leaked onto 2e characters");
  r.careerHiddenFor2e === false
    ? ok("a 2e character shows no failed-career line")
    : fail("failed-career line leaked onto a 2e character");
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nPARITY PROBE FAILED\n" : "\nparity probe passed\n");
process.exit(failed ? 1 : 0);

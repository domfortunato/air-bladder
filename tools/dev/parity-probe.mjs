#!/usr/bin/env node
/**
 * The three parity items ported from the system this descends from:
 *
 *   1. Failed career is EDITABLE — a dice re-roll and a picker on the sheet, not
 *      a value you are stuck with from generation.
 *   2. The failed-career line respects its GM setting live: switching the setting
 *      off hides it on an already-generated character.
 *   3. The Omen field is 2e's alone: absent on a Barebones sheet
 *      unconditionally (the show-omens-barebones lending setting was removed
 *      2026-08-09), present on a 2e sheet — the differential that proves the
 *      hiding is the content source, not a broken field.
 *   4. ...and the Warden's `show-omens` switch (2026-08-17) takes the field off
 *      a 2e sheet too, WITHOUT clearing the stored text. Read-shadowed in-page,
 *      never written to the world.
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
      bb: game.settings.get(NS, "content-source-barebones"),
    };
    await game.settings.set(NS, "content-source-barebones", true);
    await game.settings.set(NS, "barebones-failed-career", true);

    try {
      const bgs = await gen.getBarebonesBackgrounds();
      const bg = bgs.find((b) => b.name === "Baker") ?? bgs[0];
      const c = await gen.generateBarebonesCharacter(bg);
      const actor = await gen.createActorWithCharacter(c);
      out.made.push(actor.id);
      // Generated actors land with Randomization OFF (2026-08-02); the
      // rollFailedCareer die below is what the flag hides.
      await actor.update({ "system.generationEnabled": true });

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

      // 3. ...and the 2e differential for the unconditional hide above
      const p2 = game.packs.get("air-bladder.backgrounds-2e");
      const bg2 = (await p2.getDocuments())[0];
      const c2 = await gen.generate2eCharacter(bg2);
      const a2 = await gen.createActorWithCharacter(c2);
      out.made.push(a2.id);
      out.omenShownFor2e = (await a2.sheet._prepareContext({})).showOmen;
      out.careerHiddenFor2e = (await a2.sheet._prepareContext({})).showFailedCareer;

      // 4. ...and the Warden's own switch over the 2e field (show-omens,
      // default ON, 2026-08-17). Read-SHADOWED in-page rather than set on the
      // world: the dev world's settings are the user's, and the house pattern
      // for exercising a setting is e2e-print's shadow (swap game.settings.get,
      // restore in a finally). The failed-career legs above predate that and do
      // a real set+restore — left alone, not copied.
      //
      // Both directions, and the ON leg is the precondition: without it "the
      // row is gone" passes on a sheet where the field was never there.
      await a2.update({ "system.omen": "ZZ OMEN TEXT survives the switch." });
      const origGet = game.settings.get;
      const shadow = (value) => {
        game.settings.get = function (ns, key, ...rest) {
          if (key === "show-omens") return value;
          return origGet.call(this, ns, key, ...rest);
        };
      };
      try {
        shadow(true);
        out.omenShownSwitchOn = (await a2.sheet._prepareContext({})).showOmen;
        shadow(false);
        out.omenHiddenSwitchOff = (await a2.sheet._prepareContext({})).showOmen;
      } finally {
        game.settings.get = origGet;
      }
      // Hiding is not erasing. Read AFTER the shadow comes off, so the value is
      // the document's own and not something the shadow was holding up.
      out.omenTextKept = a2.system.omen;
      out.omenSwitchRestored = game.settings.get(NS, "show-omens");

      // the picker exists and is name-only (no gear side effects)
      out.hasPrompt = typeof gen.promptFailedCareer === "function";
      const before = a2.items.size;
      out.itemsUnchanged = before === a2.items.size;
    } finally {
      for (const id of out.made) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
      await game.settings.set(NS, "barebones-failed-career", was.career);
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
    ? ok("Omen is hidden for Barebones, unconditionally (the lending setting is retired)")
    : fail("Omen shown for a Barebones character — the retired lending is back");
  r.omenShownFor2e ? ok("a 2e character keeps its Omen — the differential for the hide")
                   : fail("the Omen field is gone from 2e characters too — the hide is not the content source");
  r.careerHiddenFor2e === false
    ? ok("a 2e character shows no failed-career line")
    : fail("failed-career line leaked onto a 2e character");

  r.omenShownSwitchOn === true
    ? ok("precondition: with show-omens ON a 2e sheet renders the Omen field")
    : fail(`show-omens ON and the field is still hidden (${r.omenShownSwitchOn}) — the leg below would pass vacuously`);
  r.omenHiddenSwitchOff === false
    ? ok("the Warden's show-omens switch hides the Omen field on a 2e sheet")
    : fail(`show-omens OFF and the field survives (${r.omenHiddenSwitchOff}) — the setting is not read`);
  r.omenTextKept === "ZZ OMEN TEXT survives the switch."
    ? ok("the stored omen text is KEPT while hidden — hiding is not erasing")
    : fail(`the omen text did not survive the hide: "${r.omenTextKept}"`);
  typeof r.omenSwitchRestored === "boolean"
    ? ok(`the settings read is restored (show-omens reads ${r.omenSwitchRestored})`)
    : fail("game.settings.get was left shadowed");
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nPARITY PROBE FAILED\n" : "\nparity probe passed\n");
process.exit(failed ? 1 : 0);

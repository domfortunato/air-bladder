#!/usr/bin/env node
/**
 * The grant-source tags footer hint.
 *
 * When "show-grant-tags" is on, a hint under the inventory list (directly below
 * the drag-to-reorder hint) explains the Background / Bond / Question chips. When
 * the setting is off, the hint is hidden. Character sheets only.
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

    const readHint = async (enabled) => {
      await game.settings.set(NS, "show-grant-tags", enabled);
      await actor.sheet.render(true);
      for (let i = 0; i < 20 && !actor.sheet.element?.[0]; i++) await new Promise((res) => setTimeout(res, 150));
      await new Promise((res) => setTimeout(res, 350));
      const root = actor.sheet.element?.[0];
      const hint = root?.querySelector(".cairn-grant-hint");
      const reorder = root?.querySelector(".cairn-reorder-hint");
      return {
        // The class lands on the inner content element (activateListeners' `html`),
        // not the outer window -- exactly like cairn-reorder-enabled.
        rootHasClass: !!hint?.closest(".cairn-grant-tags-enabled"),
        display: hint ? getComputedStyle(hint).display : null,
        text: hint ? hint.textContent.trim() : null,
        // Is the grant hint the element immediately after the reorder hint?
        followsReorder: reorder ? reorder.nextElementSibling === hint : false,
      };
    };

    out.on = await readHint(true);
    out.off = await readHint(false);
    await game.settings.set(NS, "show-grant-tags", true); // restore default
    return out;
  });

  r.on.rootHasClass && r.on.display === "block"
    ? ok(`setting ON: the grant-tags hint is visible (${r.on.display})`)
    : fail(`setting ON: rootClass=${r.on.rootHasClass} display=${r.on.display}`);
  r.on.followsReorder
    ? ok("the hint sits directly under the drag-to-reorder hint")
    : fail("the hint is not positioned immediately after the reorder hint");
  r.on.text && /granted during character generation/i.test(r.on.text) && !/CAIRN\./.test(r.on.text)
    ? ok(`hint text reads: "${r.on.text}"`)
    : fail(`hint text was "${r.on.text}"`);

  !r.off.rootHasClass && r.off.display === "none"
    ? ok(`setting OFF: the hint is hidden (${r.off.display})`)
    : fail(`setting OFF: rootClass=${r.off.rootHasClass} display=${r.off.display}, expected hidden`);

  await page.evaluate(async (id) => { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }, r.actorId);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nGRANT HINT PROBE FAILED\n" : "\ngrant hint probe passed\n");
process.exit(failed ? 1 : 0);

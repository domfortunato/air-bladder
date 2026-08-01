#!/usr/bin/env node
/**
 * Actor-directory presentation:
 *   1. The "Generate PC" button uses the d6 icon.
 *   2. Container/transport actor thumbnails are grayscale; characters are not.
 *
 * This probe used to cover two more things. Both were removed on purpose, and
 * neither should come back:
 *
 * - **Chat/dice re-skinned as the black-and-white sheet.** `f00e72c` deliberately
 *   reverted every NON-SHEET surface to Foundry's own colours and fonts so they
 *   become theme-aware for free. Asserting Alegreya + #f5f5f5 + a black header on
 *   a chat card now asserts a bug. The probe kept failing green-field for weeks
 *   because nothing ran it.
 * - **The "Spellbook — " inventory prefix.** It read the sheet root as
 *   `actor.sheet.element?.[0]`, an ApplicationV1 (jQuery) idiom. On
 *   ApplicationV2 the root is a <form>, and HTMLFormElement is indexed by its
 *   own controls — so that expression quietly returned the first <input>, whose
 *   querySelector matches nothing. The assertion read `null` forever and never
 *   errored. The prefix is covered properly by `npm run dev:i18n-render`, which
 *   drives it in both language directions.
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

    // 1. Generate-character button icon (rendered into the actor directory).
    const genBtnIcon = document.querySelector(".create-character-generator-button i");
    out.genBtnIconClass = genBtnIcon ? genBtnIcon.className : null;

    // A character to serve as the "not greyed" control in the directory.
    const pack = game.packs.get("air-bladder.backgrounds-2e");
    const bg = (await pack.getDocuments())[0];
    const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter(bg));
    out.made.push(actor.id);

    // 2. A container (transport) actor, checked in the directory. Role, not
    //    type: `container` is retired, and the directory's grayscale/hide rules
    //    read the ROLE now (cairn.js) — this row is what proves that.
    const wagon = await Actor.create({
      name: "Probe Wagon", type: "npc",
      img: "icons/environment/settlement/wagon.webp",
      system: { role: "transport", containerClass: "wagon" },
    });
    out.made.push(wagon.id);
    const priorShow = game.settings.get(NS, "show-container-actors");
    await game.settings.set(NS, "show-container-actors", true);
    out.priorShow = priorShow;
    const dir = ui.actors ?? ui.sidebar?.tabs?.actors;
    await dir?.render(true);
    await new Promise((res) => setTimeout(res, 900));
    const row = document.querySelector(`.actor[data-entry-id="${wagon.id}"]`);
    out.wagonRowFound = !!row;
    out.wagonHasGrayClass = row?.classList.contains("cairn-grayscale-portrait") ?? false;
    const img = row?.querySelector("img");
    out.wagonImgFilter = img ? getComputedStyle(img).filter : null;
    // A character row must NOT be greyed.
    const charRow = document.querySelector(`.actor[data-entry-id="${actor.id}"]`);
    out.charImgFilter = charRow?.querySelector("img")
      ? getComputedStyle(charRow.querySelector("img")).filter : null;

    return out;
  });

  await page.screenshot({ path: "tools/dev/out/ui-batch-directory.png" });

  r.genBtnIconClass?.includes("fa-dice-d6")
    ? ok(`Generate-character button uses the d6 icon (${r.genBtnIconClass})`)
    : fail(`Generate-character icon is "${r.genBtnIconClass}", expected fa-dice-d6`);

  r.wagonRowFound
    ? ok("the container actor appears in the directory")
    : fail("the container actor row was not found in the directory");
  r.wagonHasGrayClass
    ? ok("the container actor row is tagged for grayscale")
    : fail("the container actor row has no grayscale class");
  /grayscale\(1\)|grayscale\(100%\)/.test(r.wagonImgFilter ?? "")
    ? ok(`the container thumbnail is grayscale (${r.wagonImgFilter})`)
    : fail(`container thumbnail filter is "${r.wagonImgFilter}", expected grayscale(1)`);
  !/grayscale/.test(r.charImgFilter ?? "") || r.charImgFilter === "none"
    ? ok(`a character thumbnail is left in colour (${r.charImgFilter})`)
    : fail(`a character thumbnail was greyed too: ${r.charImgFilter}`);

  // Restore the setting this probe changed, so a later run against the same
  // world starts from the same place (the stale-precondition trap).
  await page.evaluate(async ({ ids, priorShow }) => {
    for (const id of ids) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
    await game.settings.set("air-bladder", "show-container-actors", priorShow);
  }, { ids: r.made, priorShow: r.priorShow });
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nUI BATCH PROBE FAILED\n" : "\nui batch probe passed\n");
process.exit(failed ? 1 : 0);

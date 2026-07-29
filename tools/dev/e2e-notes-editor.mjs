#!/usr/bin/env node
/**
 * The Notes editor: directly editable, and it actually saves.
 *
 * This exists because the AppV2 port shipped `<prose-mirror toggled>`, and a
 * TOGGLED editor is opened by a pencil button that Foundry styles
 * `display: none` until you hover it (foundry2.css:13565 / :13577). Every
 * assertion you would naturally write still passed: the element was present,
 * upgraded, not disabled, and carried the right value. It simply could not be
 * typed into without discovering an invisible button, which is what "the editor
 * doesn't work" turned out to mean.
 *
 * So this probe does the one thing that catches it: it types, the way a player
 * does, without touching any button — and then asserts the document changed.
 *
 *   npm run dev:notes-editor
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(38)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(38)} ${d}`); failures++; };

const TYPED = "Probe typed this.";

try {
  await joinAsGM(page);
  await dismissChrome(page);

  for (const type of ["character", "hireling", "npc", "container"]) {
    console.log(`\n${type}`);
    const field = type === "container" ? "system.biography" : "system.notes";

    const setup = await page.evaluate(async ({ type, field }) => {
      for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Notes"))) await a.delete();
      const actor = await Actor.create({ name: `ZZ Notes ${type}`, type });
      await actor.update({ [field]: "" });
      await actor.sheet.render(true);
      for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      const el = actor.sheet.element;
      const tab = type === "container" ? "description" : "notes";
      el.querySelector(`.tabs .item[data-tab="${tab}"]`)?.click();
      await new Promise((r) => setTimeout(r, 400));
      const pm = el.querySelector(`prose-mirror[name="${field}"]`);
      const content = pm?.querySelector(".editor-content");
      return {
        id: actor.id,
        sheetId: el.id,
        found: !!pm,
        // An always-active editor is contenteditable with no button to press.
        editable: content?.getAttribute("contenteditable"),
        placeholder: pm?.getAttribute("data-placeholder") ?? null,
        placeholderShown: pm?.classList.contains("cairn-editor-empty") ?? null,
      };
    }, { type, field });

    if (!setup.found) { fail("editor present", `no prose-mirror[name="${field}"]`); continue; }
    ok("editor present", field);

    setup.editable === "true"
      ? ok("directly editable, no button needed", 'contenteditable="true"')
      : fail("directly editable, no button needed",
          `contenteditable=${setup.editable} — a toggled editor hides behind a hover-only pencil`);

    if (setup.placeholder) {
      setup.placeholderShown
        ? ok("empty editor shows its placeholder", `"${setup.placeholder}"`)
        : fail("empty editor shows its placeholder", "the cairn-editor-empty class is absent");
    }

    // Type like a player: click the content and use the keyboard.
    const sel = `#${setup.sheetId} prose-mirror[name="${field}"] .editor-content`;
    try {
      await page.locator(sel).click({ timeout: 8000 });
      await page.keyboard.type(TYPED);
      await page.waitForTimeout(300);
    } catch (e) {
      fail("can click into the editor", e.message.split("\n")[0]);
      continue;
    }

    const after = await page.evaluate(async ({ id, field, sheetId }) => {
      const actor = game.actors.get(id);
      const pm = document.querySelector(`#${sheetId} prose-mirror[name="${field}"]`);
      const placeholderGone = !pm.classList.contains("cairn-editor-empty");
      // Click-away is what commits, so click the sheet outside the editor.
      actor.sheet.element.querySelector(".window-content")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1200));
      const stored = foundry.utils.getProperty(actor, field) ?? "";
      await actor.delete();
      return { placeholderGone, stored };
    }, { id: setup.id, field, sheetId: setup.sheetId });

    if (setup.placeholder) {
      after.placeholderGone
        ? ok("placeholder clears once typing starts")
        : fail("placeholder clears once typing starts", "still marked empty");
    }
    after.stored.includes(TYPED)
      ? ok("click-away saved what was typed", JSON.stringify(after.stored.slice(0, 60)))
      : fail("click-away saved what was typed", `stored ${JSON.stringify(after.stored.slice(0, 80))}`);
  }
} catch (e) {
  fail("probe threw", `${e.name}: ${e.message}`);
} finally {
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nFAILED (${failures})\n` : "\nnotes editor probe passed\n");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * The Notes editor: it opens, it takes typing, and the typing survives.
 *
 * This exists because the AppV2 port shipped `<prose-mirror toggled>`, and a
 * TOGGLED editor is opened by a pencil button that Foundry styles
 * `display: none` until you hover it (foundry2.css:13565 / :13577). Every
 * assertion you would naturally write still passed: the element was present,
 * upgraded, not disabled, and carried the right value. It simply could not be
 * typed into without discovering an invisible button, which is what "the editor
 * doesn't work" turned out to mean.
 *
 * The answer was always-active editors, and on 2026-08-02 the user reversed it:
 * a permanent toolbar over an empty box is clutter. So `toggled` is back on
 * purpose, and what this probe now asserts is the thing that made it safe to
 * come back — a VISIBLE empty-state hint in the display half, a pencil that
 * really opens the editor, and a document that holds what was typed after a
 * click-away and a re-open. "Typed and it vanished" is still the failure being
 * hunted; only the route to the caret changed.
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

  /* ------------------------------------------------ */
  /*  Actor sheets — the Notes editor is TOGGLED now   */
  /* ------------------------------------------------ */

  // `container` was a fourth type here, whose editor was on its Description tab
  // rather than a Notes tab it never had. The type is retired (2026-07-31) and
  // the npc that replaced it has the same four tabs as everything else, so the
  // per-type field/tab split went with it.
  //
  // Every actor sheet's Notes editor is TOGGLED since 2026-08-02 (user ask — a
  // permanent toolbar over an empty box reads as clutter), the npc sheet first
  // and the character sheet later the same day, so the always-active section
  // that used to gate the character is gone. Same shape as the Description
  // editor: a display half in the light DOM and the real editor behind core's
  // pencil. The empty-state hint is a REAL ELEMENT in the display half
  // (.cairn-editor-placeholder) because the ::before mechanism this file used to
  // assert on anchors to .editor-container, which a toggled editor only grows on
  // activation. Wording follows the ROLE: "this monster" on a monster, "this
  // character" otherwise — a distinct key, not a _wording() variant. Commit is
  // CLICK-AWAY (bindEditorClickAwaySave covers active toggled editors), then a
  // re-open proves the display half serves the prose instead of the hint.
  for (const { label, type, system, expectHint } of [
    { label: "character (toggled since 2026-08-02)", type: "character", system: {}, expectHint: "Put notes about this character here." },
    { label: "hireling (npc sheet, person)", type: "hireling", system: {}, expectHint: "Put notes about this character here." },
    { label: "npc, role monster", type: "npc", system: { role: "monster" }, expectHint: "Put notes about this monster here." },
  ]) {
    console.log(`\n${label}`);
    const field = "system.notes";

    const setup = await page.evaluate(async ({ type, system, field }) => {
      for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Notes"))) await a.delete();
      const actor = await CONFIG.Actor.documentClass.create({ name: `ZZ Notes ${type}`, type, system });
      await actor.update({ [field]: "" });
      await actor.sheet.render(true);
      for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      const el = actor.sheet.element;
      el.querySelector('.tabs .item[data-tab="notes"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
      const pm = el.querySelector(`prose-mirror[name="${field}"]`);
      const hint = pm?.querySelector(".cairn-editor-placeholder");
      const out = {
        id: actor.id,
        sheetId: el.id,
        found: !!pm,
        toggled: pm?.hasAttribute("toggled") ?? false,
        hintText: hint?.textContent?.trim() ?? null,
        hintVisible: hint ? hint.getBoundingClientRect().height > 0 : false,
      };
      // Open it the way the item legs below do — the pencil is hover-hidden,
      // so a real click is unreliable; what matters here is typing and saving.
      pm?.querySelector("button")?.click();
      await new Promise((r) => setTimeout(r, 500));
      out.opened = pm?.querySelector(".editor-content")?.getAttribute("contenteditable") === "true";
      return out;
    }, { type, system, field });

    if (!setup.found) { fail("editor present", `no prose-mirror[name="${field}"]`); continue; }
    ok("editor present", field);
    setup.toggled
      ? ok("the editor is toggled", "display half + pencil, like the Description")
      : fail("the editor is toggled", "no `toggled` attribute — still always-active");
    setup.hintText === expectHint && setup.hintVisible
      ? ok("the display half carries the empty-state hint", JSON.stringify(setup.hintText))
      : fail("the display half carries the empty-state hint",
          `text=${JSON.stringify(setup.hintText)} visible=${setup.hintVisible} (wanted ${JSON.stringify(expectHint)})`);
    setup.opened ? ok("the pencil opens it for typing") : fail("the pencil opens it for typing", "not contenteditable after toggle");
    if (!setup.opened) continue;

    try {
      await page.locator(`#${setup.sheetId} prose-mirror[name="${field}"] .editor-content`).click({ timeout: 8000 });
      await page.keyboard.type(TYPED);
      await page.waitForTimeout(300);
    } catch (e) {
      fail("can click into the editor", e.message.split("\n")[0]);
      continue;
    }

    const after = await page.evaluate(async ({ id, field, typed }) => {
      const actor = game.actors.get(id);
      // Click-away commits (the same mechanism as the character leg).
      actor.sheet.element.querySelector(".window-content")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1200));
      const stored = foundry.utils.getProperty(actor, field) ?? "";
      // Re-open fresh: the display half must now serve the prose, not the hint.
      await actor.sheet.close();
      await actor.sheet.render(true);
      for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      actor.sheet.element.querySelector('.tabs .item[data-tab="notes"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
      const pm = actor.sheet.element.querySelector(`prose-mirror[name="${field}"]`);
      const res = {
        stored,
        hintGone: !pm?.querySelector(".cairn-editor-placeholder"),
        displayShows: pm?.textContent?.includes(typed) ?? false,
      };
      await actor.sheet.close();
      await actor.delete();
      return res;
    }, { id: setup.id, field, typed: TYPED });

    after.stored.includes(TYPED)
      ? ok("click-away saved what was typed", JSON.stringify(after.stored.slice(0, 60)))
      : fail("click-away saved what was typed", `stored ${JSON.stringify(after.stored.slice(0, 80))}`);
    after.hintGone && after.displayShows
      ? ok("re-opened: the display half serves the prose", "hint gone")
      : fail("re-opened: the display half serves the prose", JSON.stringify({ hintGone: after.hintGone, displayShows: after.displayShows }));
  }

  /* -------------------------------------------- */
  /*  Item sheets — closing must not eat the text  */
  /* -------------------------------------------- */

  // The actor loop above never touched an item sheet, which is how the same class
  // of data loss shipped there unnoticed. Item templates use `<prose-mirror
  // toggled>`: a toggled editor commits ONLY through its own save button, typing
  // fires no `change`, ApplicationV2 has no `submitOnClose`, and the element's own
  // disconnectedCallback save runs from an already-detached node. So the player
  // types a description, hits the X, and it is gone — silently.
  //
  // Closing is the assertion. Click-away is checked too, but it is the weaker of
  // the two: the X and Esc are not mousedowns inside the sheet.
  for (const type of ["item", "weapon", "spellbook"]) {
    console.log(`\n${type} (item sheet)`);
    const field = "system.description";

    const setup = await page.evaluate(async ({ type, field }) => {
      for (const i of game.items.filter((i) => i.name.startsWith("ZZ Notes"))) await i.delete();
      const item = await CONFIG.Item.documentClass.create({ name: `ZZ Notes ${type}`, type });
      await item.update({ [field]: "" });
      await item.sheet.render(true);
      for (let i = 0; i < 40 && !item.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      const el = item.sheet.element;
      const pm = el.querySelector(`prose-mirror[name="${field}"]`);
      // Toggled editors open via a pencil button that Foundry keeps display:none
      // until hover, so a real click is unreliable here — press it directly. The
      // point of this probe is what happens on CLOSE, not how the toggle looks.
      pm?.querySelector("button")?.click();
      await new Promise((r) => setTimeout(r, 500));
      return {
        id: item.id,
        sheetId: el.id,
        found: !!pm,
        opened: pm?.querySelector(".editor-content")?.getAttribute("contenteditable") === "true",
      };
    }, { type, field });

    if (!setup.found) { fail("editor present", `no prose-mirror[name="${field}"]`); continue; }
    ok("editor present", field);
    setup.opened ? ok("editor opens for typing") : fail("editor opens for typing", "not contenteditable after toggle");
    if (!setup.opened) continue;

    try {
      await page.locator(`#${setup.sheetId} prose-mirror[name="${field}"] .editor-content`).click({ timeout: 8000 });
      await page.keyboard.type(TYPED);
      await page.waitForTimeout(300);
    } catch (e) {
      fail("can click into the editor", e.message.split("\n")[0]);
      continue;
    }

    const closed = await page.evaluate(async ({ id, field }) => {
      const item = game.items.get(id);
      await item.sheet.close();
      await new Promise((r) => setTimeout(r, 1200));
      const stored = foundry.utils.getProperty(item, field) ?? "";
      await item.delete();
      return { stored };
    }, { id: setup.id, field });

    closed.stored.includes(TYPED)
      ? ok("closing the sheet saved the text", JSON.stringify(closed.stored.slice(0, 60)))
      : fail("closing the sheet saved the text",
          `stored ${JSON.stringify(closed.stored.slice(0, 80))} — the description was discarded`);
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

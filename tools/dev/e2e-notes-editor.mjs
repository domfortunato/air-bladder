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

  // `container` was a fourth type here, whose editor was on its Description tab
  // rather than a Notes tab it never had. The type is retired (2026-07-31) and
  // the npc that replaced it has the same four tabs as everything else, so the
  // per-type field/tab split went with it.
  //
  // CHARACTER ONLY since 2026-08-02: the npc sheet's Notes editor is TOGGLED
  // now (user ask — the always-active toolbar over an empty box read as
  // clutter on a monster sheet), so hireling/npc moved to their own section
  // below, modeled on the item-sheet legs. The character keeps the recorded
  // always-active decision, and this loop is its gate.
  for (const type of ["character"]) {
    console.log(`\n${type}`);
    const field = "system.notes";

    const setup = await page.evaluate(async ({ type, field }) => {
      for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Notes"))) await a.delete();
      const actor = await Actor.create({ name: `ZZ Notes ${type}`, type });
      await actor.update({ [field]: "" });
      await actor.sheet.render(true);
      for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      const el = actor.sheet.element;
      const tab = "notes";
      el.querySelector(`.tabs .item[data-tab="${tab}"]`)?.click();
      await new Promise((r) => setTimeout(r, 400));
      const pm = el.querySelector(`prose-mirror[name="${field}"]`);
      const content = pm?.querySelector(".editor-content");

      // WHERE the placeholder lands, not just whether it is switched on. A
      // pseudo-element has no getBoundingClientRect, so find whichever element
      // carries the ::before, then place it from that host's box plus the
      // pseudo's own offsets. The bug this exists for drew the hint over the
      // toolbar: the class was set, the text was right, and it was unreadable.
      const placed = (() => {
        if (!pm) return null;
        const hosts = [pm, ...pm.querySelectorAll(".editor-container, .editor-content")];
        const host = hosts.find((h) => {
          const c = getComputedStyle(h, "::before").content;
          return c && c !== "none" && c !== "normal" && c !== '""';
        });
        if (!host) return { drawn: false };
        const s = getComputedStyle(host, "::before");
        const hb = host.getBoundingClientRect();
        const box = (n) => { const b = n?.getBoundingClientRect(); return b && { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        return {
          drawn: true,
          host: host === pm ? "prose-mirror" : host.className,
          text: s.content,
          at: { top: hb.top + parseFloat(s.top || 0), left: hb.left + parseFloat(s.left || 0) },
          menu: box(pm.querySelector(".menu-container")),
          content: box(pm.querySelector(".editor-content")),
        };
      })();

      return {
        id: actor.id,
        sheetId: el.id,
        found: !!pm,
        // An always-active editor is contenteditable with no button to press.
        editable: content?.getAttribute("contenteditable"),
        placeholder: pm?.getAttribute("data-placeholder") ?? null,
        placeholderShown: pm?.classList.contains("cairn-editor-empty") ?? null,
        placed,
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

      const p = setup.placed;
      if (!p?.drawn) {
        fail("the placeholder is actually drawn", "no ::before with content on the editor");
      } else if (!p.text.includes(setup.placeholder)) {
        // Reaching this means the class is on and the box is right and the
        // prompt still says nothing -- e.g. attr() reading an element that
        // does not carry the attribute.
        fail("the placeholder is actually drawn", `::before content is ${p.text}`);
      } else if (!p.content) {
        fail("placeholder sits in the editable area", "no .editor-content to compare against");
      } else if (p.menu && p.at.top < p.menu.bottom) {
        fail("placeholder clears the toolbar",
          `drawn at y=${Math.round(p.at.top)} on ${p.host}, but the menu bar runs to y=${Math.round(p.menu.bottom)}`);
      } else if (p.at.top < p.content.top || p.at.top > p.content.bottom
              || p.at.left < p.content.left || p.at.left > p.content.right) {
        fail("placeholder sits in the editable area",
          `drawn at ${Math.round(p.at.left)},${Math.round(p.at.top)}; content box is `
          + `${Math.round(p.content.left)},${Math.round(p.content.top)}-`
          + `${Math.round(p.content.right)},${Math.round(p.content.bottom)}`);
      } else {
        ok("placeholder sits in the editable area", `on ${p.host}`);
      }
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

  /* -------------------------------------------- */
  /*  npc sheet — the Notes editor is TOGGLED now  */
  /* -------------------------------------------- */

  // Same shape as the Description editor above it (2026-08-02, user ask): a
  // display half in the light DOM and the real editor behind core's pencil.
  // The empty-state hint is a REAL ELEMENT in the display half
  // (.cairn-editor-placeholder) because the ::before mechanism the character
  // sheet uses anchors to .editor-container, which a toggled editor only
  // grows on activation. Wording follows the ROLE: "this monster" on a
  // monster, "this character" otherwise — a distinct key, not a _wording()
  // variant. Commit is CLICK-AWAY (bindEditorClickAwaySave covers active
  // toggled editors), then a re-open proves the display half serves the
  // prose instead of the hint.
  for (const { label, type, system, expectHint } of [
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

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
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();

// The fleet's hang guard (review #34 finding 25): without it a hang runs to

// the runner's 65-minute cap, skips every restore, and the box is never

// marked suspect. A bound on a hang, not a timing claim.

watchdog(600000, "notes-editor probe", () => browser.close());
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
  // The DESCRIPTION editor is the fourth case (2026-08-20). Same toggled shape,
  // different tab, and it never had the hint — so an NPC with no prose showed a
  // Description tab with nothing on it that looked like a field. The user's
  // words: it "does not show up until you hover over it". Its hint takes ONE
  // key for all six roles, because four of them are a crate, a cart, a mount
  // and a monster and any wording naming the subject is wrong for most of them.
  for (const { label, type, system, field, tab, expectHint } of [
    { label: "character (toggled since 2026-08-02)", type: "character", system: {}, field: "system.notes", tab: "notes", expectHint: "Click here to add notes about this character." },
    { label: "hireling (npc sheet, person)", type: "hireling", system: {}, field: "system.notes", tab: "notes", expectHint: "Click here to add notes about this character." },
    { label: "npc, role monster", type: "npc", system: { role: "monster" }, field: "system.notes", tab: "notes", expectHint: "Click here to add notes about this monster." },
    { label: "npc description tab (2026-08-20)", type: "npc", system: { role: "npc" }, field: "system.description", tab: "description", expectHint: "Click here to add a description." },
  ]) {
    console.log(`\n${label}`);

    const setup = await page.evaluate(async ({ type, system, field, tab }) => {
      for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Notes"))) await a.delete();
      const actor = await CONFIG.Actor.documentClass.create({ name: `ZZ Notes ${type}`, type, system });
      await actor.update({ [field]: "" });
      await actor.sheet.render(true);
      for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      const el = actor.sheet.element;
      el.querySelector(`.tabs .item[data-tab="${tab}"]`)?.click();
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
    }, { type, system, field, tab });

    if (!setup.found) { fail("editor present", `no prose-mirror[name="${field}"]`); continue; }
    ok("editor present", field);
    setup.toggled
      ? ok("the editor is toggled", "display half + pencil")
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

    const after = await page.evaluate(async ({ id, field, tab, typed }) => {
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
      actor.sheet.element.querySelector(`.tabs .item[data-tab="${tab}"]`)?.click();
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
    }, { id: setup.id, field, tab, typed: TYPED });

    after.stored.includes(TYPED)
      ? ok("click-away saved what was typed", JSON.stringify(after.stored.slice(0, 60)))
      : fail("click-away saved what was typed", `stored ${JSON.stringify(after.stored.slice(0, 80))}`);
    after.hintGone && after.displayShows
      ? ok("re-opened: the display half serves the prose", "hint gone")
      : fail("re-opened: the display half serves the prose", JSON.stringify({ hintGone: after.hintGone, displayShows: after.displayShows }));
  }

  /* ---------------------------------------------------- */
  /*  A character's own Description (review #34 F55)       */
  /* ---------------------------------------------------- */

  // The Kettlewright importer writes a character's description into
  // `system.description` (kettlewright-import.js, `String(json.description)`,
  // plain text) and the printed sheet prints it, but the character sheet had no
  // editor for it after 2026-07-29 — so imported text was on paper and nowhere
  // on screen. The user's ruling (2026-10-31): the Description tab shows it,
  // editable, under a Description heading, ONLY while the field holds prose, so
  // a character made in Foundry still has no second notes box (the reason the
  // editor went). "Holds prose" is ONE test for the sheet and the paper: an
  // editor its player emptied saves `<p></p>`, not "", and that must neither
  // keep an empty box on the sheet nor print an empty Description heading.
  // Fixtures stamped and swept by flag, from a finally (probe rule 6).
  const DESC_FIXTURE = "notes-editor-description";
  const IMPORTED = "ZZ imported description, the Kettlewright shape: plain text.";
  const sweepDesc = () => page.evaluate(async (fixture) => {
    for (const a of game.actors.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) {
      await a.sheet?.close();
      await a.delete();
    }
  }, DESC_FIXTURE);
  const descCase = (description) => page.evaluate(async ({ description, fixture, imported }) => {
    const actor = await CONFIG.Actor.documentClass.create({
      name: "ZZ Notes description", type: "character",
      system: { description },
      flags: { "air-bladder": { probeFixture: fixture } },
    });
    await actor.sheet.render(true);
    for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 700));
    const el = actor.sheet.element;
    el.querySelector('.tabs .item[data-tab="description"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const pm = el.querySelector('.tab[data-tab="description"] prose-mirror[name="system.description"]');
    const heading = pm?.closest(".character-description")?.querySelector(".character-description-heading");
    // The paper, captured the way e2e-print does: wrap window.open before the
    // click and stub the popup's print() so nothing reaches a printer.
    const origOpen = window.open;
    let popup = null;
    const calls = [];
    window.open = (...a) => {
      popup = origOpen.apply(window, a);
      Object.defineProperty(popup, "print", { configurable: true, value: () => calls.push(1) });
      return popup;
    };
    try {
      el.querySelector('[data-action="printSheet"]')?.click();
      for (let i = 0; i < 60 && !calls.length; i++) await new Promise((r) => setTimeout(r, 150));
    } finally { window.open = origOpen; }
    const printed = calls.length === 1;
    const h2s = [...(popup?.document?.querySelectorAll("h2") ?? [])].map((h) => h.textContent.trim());
    popup?.close();
    return {
      id: actor.id,
      sheetId: el.id,
      editor: !!pm,
      toggled: pm?.hasAttribute("toggled") ?? false,
      shows: pm?.textContent?.includes(imported) ?? false,
      heading: heading?.textContent?.trim() ?? null,
      want: game.i18n.localize("CAIRN.Description"),
      printed,
      printsHeading: h2s.includes(game.i18n.localize("CAIRN.Description")),
    };
  }, { description, fixture: DESC_FIXTURE, imported: IMPORTED });

  console.log("\ncharacter description (review #34 finding 55)");
  try {
    await sweepDesc();

    const imported = await descCase(IMPORTED);
    imported.editor && imported.toggled && imported.shows
      ? ok("imported prose: the Description tab shows it", "toggled editor, display half serves it")
      : fail("imported prose: the Description tab shows it",
          JSON.stringify({ editor: imported.editor, toggled: imported.toggled, shows: imported.shows }));
    imported.heading === imported.want
      ? ok("...under a Description heading", JSON.stringify(imported.heading))
      : fail("...under a Description heading", `got ${JSON.stringify(imported.heading)}, wanted ${JSON.stringify(imported.want)}`);
    imported.printed && imported.printsHeading
      ? ok("...and the paper prints it, as before")
      : fail("...and the paper prints it, as before", JSON.stringify({ printed: imported.printed, heading: imported.printsHeading }));

    // Editable: the pencil opens it, typing and a click-away land on the doc.
    if (imported.editor) {
      const opened = await page.evaluate(async (id) => {
        const pm = game.actors.get(id).sheet.element
          .querySelector('.tab[data-tab="description"] prose-mirror[name="system.description"]');
        pm?.querySelector("button")?.click();
        await new Promise((r) => setTimeout(r, 500));
        return pm?.querySelector(".editor-content")?.getAttribute("contenteditable") === "true";
      }, imported.id);
      let typed = false;
      if (opened) {
        try {
          await page.locator(`#${imported.sheetId} prose-mirror[name="system.description"] .editor-content`).click({ timeout: 8000 });
          await page.keyboard.press("End");
          await page.keyboard.type(` ${TYPED}`);
          await page.waitForTimeout(300);
          typed = true;
        } catch (e) {
          fail("...and it takes typing", e.message.split("\n")[0]);
        }
      } else fail("...and it takes typing", "the pencil did not open it");
      if (typed) {
        const stored = await page.evaluate(async (id) => {
          const actor = game.actors.get(id);
          actor.sheet.element.querySelector(".window-content")
            ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          await new Promise((r) => setTimeout(r, 1200));
          return actor.system.description ?? "";
        }, imported.id);
        stored.includes(TYPED) && stored.includes(IMPORTED)
          ? ok("...and it takes typing", JSON.stringify(stored.slice(0, 70)))
          : fail("...and it takes typing", `stored ${JSON.stringify(stored.slice(0, 90))}`);
      }
    }

    // A character made in Foundry: no second notes box, the reason the editor
    // went on 2026-07-29. Passes on the old code too — it guards the ruling.
    const blank = await descCase("");
    !blank.editor && !blank.printsHeading
      ? ok("empty: no description editor, no printed heading")
      : fail("empty: no description editor, no printed heading", JSON.stringify({ editor: blank.editor, printsHeading: blank.printsHeading }));

    // What a player's emptied editor actually saves (prosemirror-editor.mjs
    // _getValue serialises the one empty paragraph). Same answer as "".
    const emptied = await descCase("<p></p>");
    !emptied.editor && !emptied.printsHeading
      ? ok("emptied to <p></p>: the box goes, and so does the printed heading")
      : fail("emptied to <p></p>: the box goes, and so does the printed heading",
          JSON.stringify({ editor: emptied.editor, printsHeading: emptied.printsHeading }));

    // The leg above passes on the old print code by accident: `cleanDescription`
    // unwraps the FIRST paragraph, so a lone `<p></p>` cleaned to "". An editor
    // emptied after an Enter keeps two, the unwrap leaves `<p></p>`, and the
    // old truthiness test printed an empty Description heading. This is the
    // leg that holds the print half of the fix (measured red, 2026-10-31).
    const twoEmpty = await descCase("<p></p><p></p>");
    !twoEmpty.editor && !twoEmpty.printsHeading
      ? ok("emptied to two empty paragraphs: no box, no printed heading")
      : fail("emptied to two empty paragraphs: no box, no printed heading",
          JSON.stringify({ editor: twoEmpty.editor, printsHeading: twoEmpty.printsHeading }));
  } finally {
    await sweepDesc().catch((e) => fail("description fixtures swept", e.message));
  }

  /* ---------------------------------------------------- */
  /*  Discoverability (2026-08-08): field look, pencil,    */
  /*  click-to-edit on the EMPTY area only                 */
  /* ---------------------------------------------------- */

  // Players did not notice the editor: an inactive toggled editor reads as
  // static text, and core's pencil is display:none until the editor is
  // HOVERED. So the empty state now reads as a field (border + wash), the
  // pencil shows unhovered in palette colours, and a click on the empty
  // display area activates the editor — but with CONTENT present, clicks stay
  // inert so text selection and links keep working, and the pencil is the way
  // in. Colour is compared against the token the page itself resolves, so the
  // legs are scheme-agnostic.
  // Run against BOTH editors since 2026-08-20: the npc Description editor shares
  // the treatment by SELECTOR LIST rather than by a copied CSS block, and a
  // shared rule is exactly the thing that gets narrowed by someone tidying the
  // selector they recognise. Character notes and npc description, same five legs.
  const discoOf = ({ type, system, field, tab }) => page.evaluate(async ({ type, system, field, tab }) => {
    for (const a of game.actors.filter((a) => a.name.startsWith("ZZ Notes"))) await a.delete();
    const actor = await CONFIG.Actor.documentClass.create({ name: "ZZ Notes disco", type, system });
    await actor.update({ [field]: "" });
    const hexToRgb = (h) => {
      const m = h.trim().match(/^#?([0-9a-f]{6})$/i);
      if (!m) return h.trim();
      const n = parseInt(m[1], 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    const openOn = async () => {
      await actor.sheet.render(true);
      for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      actor.sheet.element.querySelector(`.tabs .item[data-tab="${tab}"]`)?.click();
      await new Promise((r) => setTimeout(r, 400));
      return actor.sheet.element.querySelector(`prose-mirror[name="${field}"]`);
    };
    const out = {};

    // Empty state: field look + unhovered pencil.
    let pm = await openOn();
    const cs = getComputedStyle(pm);
    out.field = { borderStyle: cs.borderStyle, background: cs.backgroundColor };
    const btn = pm.querySelector("button.toggle");
    const bcs = btn ? getComputedStyle(btn) : null;
    out.pencil = btn
      ? { display: bcs.display, color: bcs.color, muted: hexToRgb(bcs.getPropertyValue("--ab-muted")) }
      : null;

    // Click-to-edit: a click on the placeholder (empty display area, not the
    // pencil) must activate the editor.
    pm.querySelector(".cairn-editor-placeholder")?.click();
    out.clickActivates = false;
    for (let i = 0; i < 30 && !out.clickActivates; i++) {
      await new Promise((r) => setTimeout(r, 100));
      out.clickActivates = pm.classList.contains("active");
    }

    // Content boundary: with notes present, a click ON the text stays inert;
    // the pencil still opens it. Fresh render so the editor starts inactive.
    await actor.sheet.close();
    await actor.update({ [field]: "<p>Existing prose the player may want to select.</p>" });
    pm = await openOn();
    pm.querySelector(".editor-content")?.click();
    await new Promise((r) => setTimeout(r, 800));
    out.contentClickInert = pm.classList.contains("inactive");
    pm.querySelector("button.toggle")?.click();
    out.pencilOpens = false;
    for (let i = 0; i < 30 && !out.pencilOpens; i++) {
      await new Promise((r) => setTimeout(r, 100));
      out.pencilOpens = pm.classList.contains("active");
    }

    await actor.sheet.close();
    await actor.delete();
    return out;
  }, { type, system, field, tab });

  for (const c of [
    { label: "character notes tab", type: "character", system: {}, field: "system.notes", tab: "notes" },
    { label: "npc description tab", type: "npc", system: { role: "npc" }, field: "system.description", tab: "description" },
  ]) {
    console.log(`\ndiscoverability (${c.label})`);
    const disco = await discoOf(c);
    disco.field.borderStyle !== "none" && disco.field.background !== "rgba(0, 0, 0, 0)"
      ? ok("the empty editor reads as a field", `border ${disco.field.borderStyle}, bg ${disco.field.background}`)
      : fail("the empty editor reads as a field", JSON.stringify(disco.field));
    disco.pencil && disco.pencil.display === "block" && disco.pencil.color === disco.pencil.muted
      ? ok("the pencil is visible UNHOVERED, in the palette colour", disco.pencil.color)
      : fail("the pencil is visible UNHOVERED, in the palette colour", JSON.stringify(disco.pencil));
    disco.clickActivates
      ? ok("a click on the empty display area activates the editor")
      : fail("a click on the empty display area activates the editor", "still inactive after the click");
    disco.contentClickInert
      ? ok("with content present, a click on the text stays inert", "selection and links keep working")
      : fail("with content present, a click on the text stays inert", "the click activated the editor");
    disco.pencilOpens
      ? ok("...and the pencil still opens it")
      : fail("...and the pencil still opens it", "pencil click did not activate");
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
  //
  // 2026-08-30: the way IN is asserted too, because an empty toggled editor on an
  // item sheet had no way in a user could find (the Tupshead Crown report): no
  // placeholder, no field look, a hover-only pencil, and a click on the blank
  // display did nothing — the whole empty-state treatment was actor-sheet-only.
  // So each leg now (1) asserts the placeholder element and its text, (2) opens
  // the editor by CLICKING the display half — the click-to-edit binding, not the
  // pencil pressed programmatically — and only then types and closes. The legs
  // cover every empty field a compendium import actually lands with: description
  // (97 shipped gear items are empty), criticalDamage (all 468 are), and recharge
  // (29 of 46 relics) — the last two on armor as well, which learned the damage
  // field group the same day.
  for (const { type, field, tab, system, hintKey } of [
    { type: "item", field: "system.description", tab: "description", system: {}, hintKey: "CAIRN.DescriptionPlaceholder" },
    { type: "weapon", field: "system.description", tab: "description", system: {}, hintKey: "CAIRN.DescriptionPlaceholder" },
    { type: "spellbook", field: "system.description", tab: "description", system: {}, hintKey: "CAIRN.DescriptionPlaceholder" },
    { type: "weapon", field: "system.criticalDamage", tab: "crit-dmg", system: {}, hintKey: "CAIRN.CriticalDamagePlaceholder" },
    { type: "armor", field: "system.criticalDamage", tab: "crit-dmg", system: {}, hintKey: "CAIRN.CriticalDamagePlaceholder" },
    { type: "item", field: "system.recharge", tab: "recharge", system: { relic: true }, hintKey: "CAIRN.RechargePlaceholder" },
    { type: "armor", field: "system.recharge", tab: "recharge", system: { relic: true }, hintKey: "CAIRN.RechargePlaceholder" },
  ]) {
    console.log(`\n${type} ${tab} (item sheet)`);

    const setup = await page.evaluate(async ({ type, field, tab, system }) => {
      for (const i of game.items.filter((i) => i.name.startsWith("ZZ Notes"))) await i.delete();
      const item = await CONFIG.Item.documentClass.create({ name: `ZZ Notes ${type} ${tab}`, type, system });
      await item.update({ [field]: "" });
      await item.sheet.render(true);
      for (let i = 0; i < 40 && !item.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 700));
      const el = item.sheet.element;
      el.querySelector(`nav.tabs [data-tab="${tab}"]`)?.click();
      for (let i = 0; i < 40 && !el.querySelector(`.tab[data-tab="${tab}"]`)?.classList.contains("active"); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const pm = el.querySelector(`.tab[data-tab="${tab}"] prose-mirror[name="${field}"]`);
      const hint = pm?.querySelector(".cairn-editor-placeholder");
      return {
        id: item.id,
        sheetId: el.id,
        found: !!pm,
        tabActive: !!el.querySelector(`.tab[data-tab="${tab}"].active`),
        hintText: hint?.textContent ?? null,
      };
    }, { type, field, tab, system });

    if (!setup.tabActive) { fail("tab reachable", `the ${tab} tab never activated`); continue; }
    if (!setup.found) { fail("editor present", `no prose-mirror[name="${field}"] on the ${tab} tab`); continue; }
    ok("editor present", field);

    const expected = await page.evaluate((k) => game.i18n.localize(k), hintKey);
    setup.hintText === expected
      ? ok("empty editor shows its placeholder", JSON.stringify(expected.slice(0, 40)))
      : fail("empty editor shows its placeholder", `got ${JSON.stringify(setup.hintText)}`);

    try {
      // The user's path: click the blank display half. The click-to-edit binding
      // routes it through core's toggle button; without the binding this times out.
      await page.locator(`#${setup.sheetId} prose-mirror[name="${field}"]`).click({ timeout: 8000 });
      await page.waitForSelector(`#${setup.sheetId} prose-mirror[name="${field}"] .editor-content[contenteditable="true"]`, { timeout: 8000 });
      ok("clicking the empty display opens the editor");
    } catch (e) {
      fail("clicking the empty display opens the editor", e.message.split("\n")[0]);
      await page.evaluate(async (id) => { const i = game.items.get(id); await i?.sheet?.close(); await i?.delete(); }, setup.id);
      continue;
    }

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

/**
 * Characterisation probe: the sheet behaviours nothing else asserts, and that
 * an ApplicationV2 port is most likely to break SILENTLY.
 *
 * Written against the AppV1 sheets deliberately, so it is green BEFORE the port
 * and the port is what turns it red. Per docs/release-testing.md, a test that
 * cannot fail is worse than none.
 *
 * 1. FORM PERSISTENCE WITHOUT A SAVE BUTTON. The whole sheet UX is "edit a
 *    field and it sticks" -- that is AppV1's `submitOnChange: true`, which its
 *    ActorSheet/ItemSheet set by default. DocumentSheetV2 defaults it to FALSE
 *    (applications/api/document-sheet.mjs:65-68) and has no `submitOnClose` at
 *    all. Forget to re-declare it and every field stops saving, with no error
 *    anywhere. dnd5e shipped this class of bug in 5.0.0 (#5572) and caught it
 *    six days later, in a release.
 *
 *    Four input types are exercised, because they travel different paths
 *    through FormDataExtended: text, number, <select>, and <textarea>.
 *
 * 2. TAB SWITCHING. Nothing in Foundry's JS hides an inactive tab body -- it is
 *    one CSS rule, `.tab[data-tab]:not(.active) { display: none }`
 *    (foundry2.css:5781). Any `display: grid`/`flex` on a tab's PARENT beats it
 *    and every tab renders at once. So this asserts computed visibility, not
 *    just the class. It also clicks the tab LABEL text, because AppV2's
 *    `_onClickTab` reads `event.target` directly rather than `.closest()`
 *    (application.mjs:1974-1981) -- a click on a child element only works
 *    because of `nav.tabs [data-tab] > * { pointer-events: none }`.
 *
 * Selectors are framework-neutral on purpose: `.cairn.sheet.actor` is on the
 * outer element under both AppV1 (`app-window.html` renders `{{classes}}`) and
 * AppV2 (`DEFAULT_OPTIONS.classes`), and `nav.tabs [data-tab]` / `.tab[data-tab]`
 * hold for both. The probe should survive the migration it exists to guard.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, watchErrors } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(36)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(36)} ${d}`); failures++; };

const SHEET = ".cairn.sheet.actor";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await page.goto(FOUNDRY_URL);
await joinAsGM(page);
await dismissChrome(page);

// A throwaway actor with Omen enabled, so the textarea is rendered.
const actorId = await page.evaluate(async () => {
  const a = await Actor.create({ name: "ZZ Sheet Basics Probe", type: "character" });
  await a.update({ "system.omenEnabled": true });
  a.sheet.render(true);
  return a.id;
});
await page.waitForSelector(SHEET, { timeout: 10000 });
await page.waitForTimeout(1500);

const read = (id, path) =>
  page.evaluate(([i, p]) => foundry.utils.getProperty(game.actors.get(i), p), [id, path]);

console.log("\nform persistence — no save button, change alone must commit");

/* ---------------------------------------------------------------- text ---- */
// Pronouns lives on the Description tab, so switch first.
await page.locator(`${SHEET} nav.tabs [data-tab="description"]`).click();
await page.waitForTimeout(500);

await page.fill(`${SHEET} input[name="system.pronouns"]`, "they/them");
await page.locator(`${SHEET} input[name="system.pronouns"]`).blur();
await page.waitForTimeout(1200);
await read(actorId, "system.pronouns") === "they/them"
  ? ok("text input persisted", "system.pronouns")
  : fail("text input persisted", `got "${await read(actorId, "system.pronouns")}"`);

/* -------------------------------------------------------------- select ---- */
// The trait pick-lists render only when the section is expanded -- the sheet
// defaults `_traitsCollapsed` to true and re-renders by hand on toggle. Expand
// first, which incidentally exercises that transient-state-plus-manual-render
// pattern (AppV2's `details[data-sync]` is what would replace it).
const expanded = await page.evaluate((sel) =>
  !!document.querySelector(`${sel} select[name^="system.traits."]`), SHEET);
if (!expanded) {
  await page.locator(`${SHEET} .trait-toggle`).click();
  await page.waitForTimeout(900);
}
await page.waitForSelector(`${SHEET} select[name^="system.traits."]`, { timeout: 5000 })
  .then(() => ok("traits section expands", "pick-lists rendered"))
  .catch(() => fail("traits section expands", "no select after clicking .trait-toggle"));

// v14 hides <select> behind a custom element, so Playwright's selectOption sees
// an invisible node and times out. Set .value and dispatch a bubbling change
// instead — the same workaround as `joinAs` in lib.mjs and the two in
// e2e-dialogs.mjs.
const traitPicked = await page.evaluate((sel) => {
  const s = document.querySelector(`${sel} select[name^="system.traits."]`);
  if (!s) return null;
  const opt = Array.from(s.options).find((o) => o.value);
  if (!opt) return null;
  s.value = opt.value;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  return { name: s.name, value: opt.value };
}, SHEET);
await page.waitForTimeout(1200);
if (!traitPicked) {
  fail("select persisted", "no trait <select> on the sheet");
} else {
  const stored = await read(actorId, traitPicked.name);
  stored === traitPicked.value
    ? ok("select persisted", `${traitPicked.name} = "${stored}"`)
    : fail("select persisted", `expected "${traitPicked.value}", stored "${stored}"`);
}

/* ------------------------------------------------------------ textarea ---- */
await page.fill(`${SHEET} textarea[name="system.omen"]`, "A probe omen.");
await page.locator(`${SHEET} textarea[name="system.omen"]`).blur();
await page.waitForTimeout(1200);
await read(actorId, "system.omen") === "A probe omen."
  ? ok("textarea persisted", "system.omen")
  : fail("textarea persisted", `got "${await read(actorId, "system.omen")}"`);

/* -------------------------------------------------------------- number ---- */
// Coins is on the header, visible from any tab.
await page.fill(`${SHEET} input[name="system.gold"]`, "42");
await page.locator(`${SHEET} input[name="system.gold"]`).blur();
await page.waitForTimeout(1200);
Number(await read(actorId, "system.gold")) === 42
  ? ok("number input persisted", "system.gold = 42")
  : fail("number input persisted", `got ${await read(actorId, "system.gold")}`);

/* ------------------------------------------------ one submit, not two ----- */
// dnd5e #5709 shipped a double submit after their conversion. Count updates
// across a single field change.
const updates = await page.evaluate(async ({ id, sel }) => {
  let n = 0;
  const hook = Hooks.on("updateActor", (doc) => { if (doc.id === id) n++; });
  const el = document.querySelector(`${sel} input[name="system.pronouns"]`);
  el.value = "she/her";
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1500));
  Hooks.off("updateActor", hook);
  return n;
}, { id: actorId, sel: SHEET });
updates === 1
  ? ok("one update per change", `${updates}`)
  : fail("one update per change", `${updates} updateActor calls`);

console.log("\ntab switching — exactly one panel visible, and it is the right one");

const tabIds = await page.evaluate((sel) =>
  Array.from(document.querySelectorAll(`${sel} nav.tabs [data-tab]`)).map((a) => a.dataset.tab), SHEET);
tabIds.length >= 2
  ? ok("tabs present", tabIds.join(", "))
  : fail("tabs present", `found ${tabIds.length}`);

for (const id of tabIds) {
  // Click the LABEL text, not the anchor, so pointer-events handling is exercised.
  const label = page.locator(`${SHEET} nav.tabs [data-tab="${id}"]`);
  await label.click();
  await page.waitForTimeout(400);

  const state = await page.evaluate(([sel, want]) => {
    const panels = Array.from(document.querySelectorAll(`${sel} .tab[data-tab]`));
    const visible = panels
      .filter((p) => getComputedStyle(p).display !== "none")
      .map((p) => p.dataset.tab);
    return { visible, total: panels.length };
  }, [SHEET, id]);

  state.visible.length === 1 && state.visible[0] === id
    ? ok(`tab "${id}" shows only itself`, `1 of ${state.total} visible`)
    : fail(`tab "${id}" shows only itself`, `visible: [${state.visible.join(", ")}] of ${state.total}`);
}

console.log("\nActiveEffect drops are refused (review #9 finding 16)");

// The system renders no effects UI and no data model consumes them, so core's
// default acceptance created an INVISIBLE stat modifier — applied through the
// preparation pass, absent from every sheet, removable only via token HUD or
// console. The control deletes the override so core's handler answers, and the
// effect MUST appear — proving the "nothing created" half above is measuring
// the override rather than a drop that never worked.
const aeLeg = await page.evaluate(async (id) => {
  const a = game.actors.get(id);
  const sheet = a.sheet;
  const proto = sheet.constructor.prototype;
  const eff = new CONFIG.ActiveEffect.documentClass({ name: "ZZ Temp Effect" });
  const warns = [];
  const orig = ui.notifications.warn.bind(ui.notifications);
  ui.notifications.warn = (m, ...rest) => { warns.push(String(m)); return orig(m, ...rest); };
  const out = { key: "CAIRN.Notify.EffectsUnsupported" };
  try {
    out.result = await sheet._onDropActiveEffect(new DragEvent("drop"), eff);
    out.warn = warns.at(-1) ?? null;
    out.effectsAfterRefusal = a.effects.size;
    out.want = game.i18n.localize(out.key);
    const saved = Object.getOwnPropertyDescriptor(proto, "_onDropActiveEffect");
    try {
      delete proto._onDropActiveEffect;
      await sheet._onDropActiveEffect(new DragEvent("drop"), eff);
      out.effectsUnderCore = a.effects.size;
    } finally {
      if (saved) Object.defineProperty(proto, "_onDropActiveEffect", saved);
      for (const e of [...a.effects]) await e.delete();
    }
  } finally {
    ui.notifications.warn = orig;
  }
  return out;
}, actorId);

aeLeg.result === null && aeLeg.effectsAfterRefusal === 0
  ? ok("AE drop refused, nothing created", "returns null")
  : fail("AE drop refused, nothing created", JSON.stringify(aeLeg));
// warn !== the raw key: localize falls back to the key when it is missing from
// en.json, and key === key would pass that exact regression.
aeLeg.warn && aeLeg.warn === aeLeg.want && aeLeg.warn !== aeLeg.key
  ? ok("the refusal is told to the user", `"${aeLeg.warn}"`)
  : fail("the refusal is told to the user", `warn=${JSON.stringify(aeLeg.warn)} want=${JSON.stringify(aeLeg.want)}`);
aeLeg.effectsUnderCore === 1
  ? ok("control: core alone creates the invisible effect", "the override is what refuses")
  : fail("control: core alone creates the invisible effect", `effects=${aeLeg.effectsUnderCore} — the leg is not measuring the override`);

console.log("\nopening an item's sheet is a READ — the wall is for writes (review #14)");

// The pencil and the row title are the same affordance on the same row, and
// `itemEdit` is deliberately un-`owned()` with the reason written beside it:
// opening the item's own sheet writes nothing, and that sheet enforces its own
// edit permission. The double-click was below `if (!this.isEditable) return;`,
// so a viewer of a locked or limited-permission actor got the pencil and a
// dead double-click — one read with two answers, the silent one being the
// undocumented gesture.
//
// `isEditable` is SHADOWED on the instance, never written to the world: it is a
// prototype getter, so an own property on the sheet overrides it for this render
// and `delete` puts it straight back.
const dbl = await page.evaluate(async (id) => {
  const a = game.actors.get(id);
  // The description is not decoration: the expanded-row legs below compare the
  // panel TEXT across a re-render, and an item with no description makes that
  // comparison "" === "" — a leg that passes on an empty div appended by
  // anything at all.
  await a.createEmbeddedDocuments("Item", [{
    name: "ZZ Readable Rope", type: "item",
    system: { description: "ZZ PROBE DESCRIPTION TEXT" },
  }, {
    // For the recharge-line legs below (issue #22): a relic's Recharge
    // condition joins the expanded panel with the critical-damage treatment —
    // an icon and italics. The Rope above is the absence control: no recharge,
    // no line.
    name: "ZZ Relic Wand", type: "item",
    system: { description: "ZZ WAND DESC", recharge: "ZZ RECHARGE CONDITION", uses: { value: 1, max: 1 } },
  }]);
  const sheet = a.sheet;
  Object.defineProperty(sheet, "isEditable", { get: () => false, configurable: true });
  try {
    await sheet.render(true);
    await new Promise((r) => setTimeout(r, 600));
    const el = sheet.element;
    const out = { editable: sheet.isEditable };

    // The precondition's own control: a listener that IS below the wall must be
    // absent, or "not editable" would be a claim rather than a state. The stat
    // input clamps to 0-18 on change; unclamped means _onRender returned early.
    const stat = el.querySelector(".stat-input");
    if (stat) {
      stat.value = "99";
      stat.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      out.walled = stat.value === "99";
    }

    const item = a.items.find((i) => i.name === "ZZ Readable Rope");
    const row = el.querySelector(`.cairn-items-list-row[data-item-id="${item.id}"] .cairn-item-title`);
    out.rowFound = !!row;
    row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    for (let n = 0; n < 30 && !item.sheet.rendered; n++) await new Promise((r) => setTimeout(r, 100));
    out.opened = item.sheet.rendered;
    await item.sheet.close();
    return out;
  } finally {
    delete sheet.isEditable;
    await sheet.close();
  }
}, actorId);

dbl.editable === false && dbl.walled === true
  ? ok("precondition: the sheet renders un-editable", "stat-input clamp never bound")
  : fail("precondition: the sheet renders un-editable", `editable=${dbl.editable} walled=${dbl.walled} — the leg below proves nothing`);
dbl.rowFound && dbl.opened
  ? ok("double-click still opens the item sheet", "same answer as the pencil beside it")
  : fail("double-click still opens the item sheet", `row=${dbl.rowFound} opened=${dbl.opened}`);

/* ------------------------------------------- 3. expanded descriptions ---- */
// The third silent one, and the one the port actually broke (review #16).
// `submitOnChange` re-runs `_prepareContext` on every committed keystroke, and
// an expanded description panel lived only in the DOM — so opening a
// description to read it and then editing ANY field on the sheet closed it
// again. No error, nothing in the console, and it looks like a mis-click.
//
// Driven the way a player drives it: a real form commit, not `actor.update`.
// Both directions are asserted, because "restore what was open" and "leave
// alone what was closed" are separate bugs — a restore that re-expanded
// everything would pass a one-direction leg.
console.log("\nan expanded description survives a re-render");

const expand = await page.evaluate(async (id) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const a = game.actors.get(id);
  const sheet = a.sheet;
  const out = {};
  await sheet.render(true);
  await sleep(500);
  const item = a.items.find((i) => i.name === "ZZ Readable Rope");
  out.itemFound = !!item;
  if (!item) return out;

  // Re-queried every time: a render REPLACES these nodes, so a handle taken
  // before the commit points at a detached row and would report "still open"
  // about DOM nobody can see.
  const row = () => sheet.element?.querySelector(`.cairn-items-list-row[data-item-id="${item.id}"]`);
  const panels = () => row()?.querySelectorAll(".item-description") ?? [];
  const commit = async (value) => {
    const input = sheet.element?.querySelector('input[name="system.pronouns"]');
    if (!input) return false;
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(1400);
    return a.system.pronouns === value;
  };

  row()?.querySelector('[data-action="itemDescription"]')?.click();
  await sleep(500);
  out.opened = panels().length === 1;
  out.textBefore = panels()[0]?.textContent.trim() ?? null;

  out.committed = await commit("probe/one");
  out.stillOpen = panels().length === 1;
  out.textAfter = panels()[0]?.textContent.trim() ?? null;
  out.classAfter = !!row()?.classList.contains("expanded");
  out.panelCount = panels().length;

  row()?.querySelector('[data-action="itemDescription"]')?.click();
  await sleep(600);
  out.closed = panels().length === 0;
  out.committedAgain = await commit("probe/two");
  out.stayedClosed = panels().length === 0;

  // The relic's Recharge condition in the expanded panel (issue #22, user ask
  // 2026-08-21): the critical-damage treatment — an icon and italics. The text
  // must sit inside an <i> that is NOT the icon, or "italic" would pass on the
  // icon element alone; the Rope's panel is the absence control.
  const wand = a.items.find((i) => i.name === "ZZ Relic Wand");
  const wandRow = sheet.element?.querySelector(`.cairn-items-list-row[data-item-id="${wand?.id}"]`);
  wandRow?.querySelector('[data-action="itemDescription"]')?.click();
  await sleep(500);
  const wpanel = wandRow?.querySelector(":scope > .item-description");
  const line = wpanel?.querySelector("i.fa-arrows-rotate")?.closest("div");
  out.recharge = {
    icon: !!line,
    italic: [...(line?.querySelectorAll("i") ?? [])]
      .find((el) => !el.classList.contains("fa-arrows-rotate"))?.textContent.trim() ?? null,
  };
  row()?.querySelector('[data-action="itemDescription"]')?.click();
  await sleep(500);
  out.recharge.ropeIcon = !!row()?.querySelector(":scope > .item-description .fa-arrows-rotate");
  return out;
}, actorId);

if (!expand.itemFound) fail("precondition: the readable item is on the sheet", "no ZZ Readable Rope");
else if (!expand.opened) fail("precondition: clicking the title opens one panel", JSON.stringify(expand));
else if (!expand.textBefore) fail("precondition: the panel has text to compare", "an empty panel makes the text leg vacuous");
else if (!expand.committed) fail("precondition: a form change commits", "submitOnChange did not fire — the re-render under test never happened");
else {
  expand.stillOpen && expand.classAfter
    ? ok("still open after a committed edit", `"${expand.textAfter}"`)
    : fail("still open after a committed edit", `open=${expand.stillOpen} class=${expand.classAfter}`);
  expand.textAfter === expand.textBefore
    ? ok("and it says the same thing", "rebuilt from the same builder as the click")
    : fail("and it says the same thing", `"${expand.textBefore}" -> "${expand.textAfter}"`);
  expand.panelCount === 1
    ? ok("exactly one panel, not two", "the restore appends nothing to a row already open")
    : fail("exactly one panel, not two", `${expand.panelCount} panels`);
  expand.closed && expand.committedAgain && expand.stayedClosed
    ? ok("a closed row stays closed", "the other direction, which a re-expand-everything bug would pass")
    : fail("a closed row stays closed", `closed=${expand.closed} committed=${expand.committedAgain} stayed=${expand.stayedClosed}`);
  expand.recharge?.icon && expand.recharge?.italic === "ZZ RECHARGE CONDITION"
    ? ok("a relic's Recharge line: icon and italics (issue #22)", `"${expand.recharge.italic}"`)
    : fail("a relic's Recharge line: icon and italics (issue #22)", JSON.stringify(expand.recharge));
  expand.recharge?.ropeIcon === false
    ? ok("no recharge, no line", "the Rope's panel carries no arrows-rotate icon")
    : fail("no recharge, no line", `ropeIcon=${expand.recharge?.ropeIcon}`);
}

console.log("\nConfigure Sheet names the system, not the class (review #14)");

// Without a `label`, core falls back to the registration id
// (document-sheet-config.mjs:443, `else label = id`) and the Warden's dropdown
// reads "cairn.CairnActorSheet" — the deliberately frozen scope spelled at them.
const labels = await page.evaluate(() => ({
  actor: CONFIG.Actor.sheetClasses?.character?.["cairn.CairnActorSheet"]?.label ?? null,
  item: CONFIG.Item.sheetClasses?.item?.["cairn.CairnItemSheet"]?.label ?? null,
}));
labels.actor === "Air Bladder" && labels.item === "Air Bladder"
  ? ok("both sheets register a label", `"${labels.actor}" / "${labels.item}"`)
  : fail("both sheets register a label", `actor="${labels.actor}" item="${labels.item}"`);

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async (id) => { await game.actors.get(id)?.delete(); }, actorId);

errors.length === 0 ? ok("zero console errors") : fail("zero console errors", errors.join(" | "));

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nsheet basics probe passed");
process.exit(failures ? 1 : 0);

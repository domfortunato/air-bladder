#!/usr/bin/env node
/**
 * Removing a document-dependent tab must not leave the sheet standing on it.
 *
 * The Recharge tab is keyed on `item.system.relic`, not on the item's type — that
 * is the whole point of `relic` being a flag rather than a document type. So the
 * tab can VANISH under a sheet that is currently showing it, which no type-keyed
 * tab can ever do.
 *
 * `ApplicationV2._prepareTabs` sets the active group with `??=`
 * (client/applications/api/application.mjs:706) and then marks a tab active by
 * identity. A `tabGroups.primary` of "recharge" therefore survives the tab's
 * removal, nothing matches it, no panel receives `.active`, and core's
 * `.tab[data-tab]:not(.active) { display: none }` hides EVERY panel. The sheet
 * renders, persists, and logs nothing — it is simply empty below the header.
 * `submitOnChange` means it happens on the untick itself, with no second action.
 *
 * The actor sheet has carried the guard for this since containers gained a tab
 * that comes and goes (`actor-sheet.js` `_getTabsConfig`); the item sheet did not
 * get it when it gained its first document-dependent tab.
 *
 * Asserts, driving the real checkbox so `submitOnChange` runs the way it does for
 * a user rather than a document update standing in for one:
 *   1. a relic's sheet offers Recharge, and switching to it activates that panel,
 *   2. unticking Relic leaves exactly one visible panel and moves the group to a
 *      tab that still exists,
 *   3. the same for an ARMOR relic — a second template with its own tab block, so
 *      a fix that lived in one template would show up here.
 *
 * NEGATIVE CONTROL, in-page: `_getTabsConfig` is wrapped on the prototype to
 * restore `tabGroups` after the guard runs, which is precisely the pre-fix
 * behaviour and nothing else. The same sequence must then blank the sheet. Run
 * this way rather than by editing the source and re-running (which the dev server
 * serves live, and which cannot tell a fix from a reload).
 *
 * Usage: npm run dev:relic-tab
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(180000, "relic tab probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/**
 * Take a relic sheet to the Recharge tab, untick Relic through the checkbox, and
 * report what is left. `control` re-creates the pre-fix behaviour first.
 */
const run = async (type, control) => page.evaluate(async ({ type, control }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 4000) => {
    for (let i = 0; i < ms / 50; i++) { if (fn()) return true; await sleep(50); }
    return false;
  };

  const name = `zz-relic-tab-${type}${control ? "-control" : ""}`;
  // A fresh document every run: an assertion that can be satisfied by an item a
  // previous run left behind is not an assertion.
  for (const stale of game.items.filter((i) => i.name === name)) await stale.delete();
  const it = await getDocumentClass("Item").create({ name, type, system: { relic: true } });

  const sheet = it.sheet;
  let restore = null;
  if (control) {
    const proto = Object.getPrototypeOf(sheet);
    const saved = proto._getTabsConfig;
    // The guard's ONLY effect is resetting tabGroups when the active tab is gone.
    // Putting the previous value back after it runs reproduces the pre-fix code
    // exactly, without a second copy of the method to drift.
    proto._getTabsConfig = function (group) {
      const before = this.tabGroups[group];
      const config = saved.call(this, group);
      this.tabGroups[group] = before;
      return config;
    };
    restore = () => { proto._getTabsConfig = saved; };
  }

  const out = { name, type };
  try {
    await sheet.render(true);
    await until(() => sheet.element?.querySelector('nav.tabs [data-tab="recharge"]'));
    const root = sheet.element;
    out.offersRecharge = !!root?.querySelector('nav.tabs [data-tab="recharge"]');

    root.querySelector('nav.tabs [data-tab="recharge"]').click();
    await until(() => root.querySelector('.tab[data-tab="recharge"]')?.classList.contains("active"));
    out.rechargeActive = !!root.querySelector('.tab[data-tab="recharge"].active');

    // Untick through the control itself, so submitOnChange is what commits it.
    const box = root.querySelector('input[name="system.relic"]');
    out.foundCheckbox = !!box;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));

    await until(() => it.system.relic === false);
    await until(() => !sheet.element?.querySelector('nav.tabs [data-tab="recharge"]'));
    await sleep(150); // let the re-render settle before measuring

    const after = sheet.element;
    const panels = [...after.querySelectorAll('.tab[data-group="primary"]')];
    out.visiblePanels = panels
      .filter((p) => getComputedStyle(p).display !== "none")
      .map((p) => p.dataset.tab);
    out.activeGroup = sheet.tabGroups.primary;
    out.renderedTabs = panels.map((p) => p.dataset.tab);
  } finally {
    restore?.();
    await sheet.close();
    await it.delete();
  }
  return out;
}, { type, control });

/* --- 1/3. the fix, on both templates that carry a relic block --------------- */

console.log("\nunticking Relic while standing on Recharge");
for (const type of ["item", "armor"]) {
  const r = await run(type, false);
  if (r.offersRecharge && r.rechargeActive) ok(`${type}: Recharge is offered and activates`);
  else fail(`${type}: could not reach the Recharge tab (offered=${r.offersRecharge}, active=${r.rechargeActive})`);

  if (r.visiblePanels.length === 1) {
    ok(`${type}: one visible panel after the untick ("${r.visiblePanels[0]}")`);
  } else {
    fail(`${type}: ${r.visiblePanels.length} visible panels after the untick `
      + `(rendered ${JSON.stringify(r.renderedTabs)}) — a blank sheet body`);
  }

  if (r.renderedTabs.includes(r.activeGroup)) ok(`${type}: the group points at a tab that exists ("${r.activeGroup}")`);
  else fail(`${type}: tabGroups.primary is "${r.activeGroup}", which is not among ${JSON.stringify(r.renderedTabs)}`);
}

/* --- negative control ------------------------------------------------------ */

console.log("\nnegative control: the same sequence without the guard");
const c = await run("item", true);
if (c.visiblePanels.length === 0 && c.activeGroup === "recharge") {
  ok(`without the guard the sheet body is empty (group still "recharge", 0 visible panels)`);
} else {
  fail("the control did NOT reproduce the bug — the guard cannot be shown to be "
    + `load-bearing (visible=${JSON.stringify(c.visiblePanels)}, group="${c.activeGroup}")`);
}

if (errors.length) {
  for (const e of errors) fail(`console error: ${e}`);
} else {
  ok("no console errors");
}

await browser.close();
console.log(`\n${failed ? "RELIC TAB PROBE FAILED" : "Relic tab probe passed."}`);
process.exit(failed ? 1 : 0);

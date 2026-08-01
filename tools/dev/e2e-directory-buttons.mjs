#!/usr/bin/env node
/**
 * The Actor Directory's Generate / Hireling / Monster / Import buttons, in BOTH
 * instances.
 *
 * Foundry renders a second, independent ActorDirectory when the sidebar tab is
 * popped out. The injection hook guarded on a document-wide
 * `getElementById('cairn-character-gen-button')`, which the docked directory had
 * already satisfied — so the popped-out window silently got no buttons at all
 * and a Warden who works from a popout had no entry point to character
 * generation, hirelings or the Kettlewright import.
 *
 * Checked in the popout because that is where it broke; the docked case is
 * asserted alongside it so a fix that scopes the query too tightly (and breaks
 * the common case) cannot pass either.
 *
 * Usage: npm run dev:directory-buttons
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const r = await page.evaluate(async () => {
  const out = {};
  const btns = (root) =>
    [...(root?.querySelectorAll(".character-generator button") ?? [])].map((b) => b.textContent.trim());

  await ui.actors.render(true);
  await new Promise((res) => setTimeout(res, 500));
  const dockedEl = document.getElementById("actors");
  out.docked = btns(dockedEl);

  const pop = await ui.actors.renderPopout();
  await new Promise((res) => setTimeout(res, 800));
  const popEl = pop?.element instanceof HTMLElement ? pop.element : pop?.element?.[0];
  out.popped = btns(popEl);
  // Guard against a false pass: if the popout resolved to the docked element,
  // the assertion below would be testing the same DOM twice.
  out.popIsSeparate = popEl && dockedEl ? popEl !== dockedEl : null;
  try { await pop.close(); } catch { /* already gone */ }
  return out;
});

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

/* Cancelling the content-source picker must create NOTHING.
 *
 * The picker only appears when more than one source is enabled, so the probe
 * turns both on and restores them afterwards. Dismissing used to fall through to
 * "2e" under the rule that the Generate button never does nothing — which is
 * right for a Warden who has switched every source off (a configuration gap) and
 * wrong for a ✕ (an instruction). It left a stray actor behind every time.
 * Reported as issue #6. */
const cancel = await page.evaluate(async () => {
  const NS = "air-bladder";
  const prior = {
    twoE: game.settings.get(NS, "content-source-2e"),
    bare: game.settings.get(NS, "content-source-barebones"),
  };
  await game.settings.set(NS, "content-source-2e", true);
  await game.settings.set(NS, "content-source-barebones", true);
  await ui.sidebar.changeTab?.("actors", "primary");
  await new Promise((res) => setTimeout(res, 600));

  const before = game.actors.size;

  // Assert on what generateCharacter RESOLVES, not on an actor count after a
  // fixed sleep. Generating a 2e character rolls tables, resolves gear from
  // packs and can mint container Actors — comfortably longer than any sleep
  // worth writing. A count read too early shows "nothing was created" whether
  // the fix works or not, and the negative control proved exactly that: with
  // the fix reverted the probe still passed.
  const CG = game.cairn.characterGenerator;
  const pending = CG.generateCharacter();
  await new Promise((res) => setTimeout(res, 1200));
  const dlg = [...document.querySelectorAll(".application.dialog, dialog.application")].pop();
  const closeBtn = dlg?.querySelector('[data-action="close"]');
  const shown = !!dlg && !!closeBtn;
  closeBtn?.click();
  const resolved = await pending;

  // Belt and braces: the wired-up button must not create one either. Poll for a
  // new actor rather than sleeping once.
  document.querySelector(".create-character-generator-button")?.click();
  await new Promise((res) => setTimeout(res, 1000));
  const dlg2 = [...document.querySelectorAll(".application.dialog, dialog.application")].pop();
  dlg2?.querySelector('[data-action="close"]')?.click();
  let after = game.actors.size;
  for (let i = 0; i < 100 && after === before; i++) {
    await new Promise((res) => setTimeout(res, 100));
    after = game.actors.size;
  }

  await game.settings.set(NS, "content-source-2e", prior.twoE);
  await game.settings.set(NS, "content-source-barebones", prior.bare);
  return { shown, before, after, resolvedNull: resolved === null, resolved: resolved === null ? null : typeof resolved };
});

cancel.shown
  ? ok("the content-source picker opens with a dismiss control")
  : fail("no content-source picker with a [data-action=close] appeared — the cancel check below proves nothing");
cancel.resolvedNull
  ? ok("dismissing the picker resolves generateCharacter() to null")
  : fail(`dismissing the picker resolved to ${cancel.resolved}, not null — a character was generated`);
cancel.after === cancel.before
  ? ok(`dismissing the picker created no actor (${cancel.before} before and after)`)
  : fail(`dismissing the picker created ${cancel.after - cancel.before} actor(s)`);

r.docked.length === 4
  ? ok(`docked directory has its 4 buttons (${r.docked.join(", ")})`)
  : fail(`docked directory buttons: ${JSON.stringify(r.docked)}`);
r.popIsSeparate
  ? ok("the popout is a separate element from the docked directory")
  : fail("popout and docked resolved to the same element — the test below is meaningless");
r.popped.length === 4
  ? ok(`popped-out directory has its 4 buttons (${r.popped.join(", ")})`)
  : fail(`popped-out directory buttons: ${JSON.stringify(r.popped)}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
if (errors.length) failed = true;
await browser.close();
console.log(failed ? "\nDIRECTORY BUTTONS PROBE FAILED" : "\ndirectory buttons probe passed");
process.exit(failed ? 1 : 0);

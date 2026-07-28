#!/usr/bin/env node
/**
 * The Actor Directory's Generate / Hireling / Import buttons, in BOTH instances.
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

r.docked.length === 3
  ? ok(`docked directory has its 3 buttons (${r.docked.join(", ")})`)
  : fail(`docked directory buttons: ${JSON.stringify(r.docked)}`);
r.popIsSeparate
  ? ok("the popout is a separate element from the docked directory")
  : fail("popout and docked resolved to the same element — the test below is meaningless");
r.popped.length === 3
  ? ok(`popped-out directory has its 3 buttons (${r.popped.join(", ")})`)
  : fail(`popped-out directory buttons: ${JSON.stringify(r.popped)}`);

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
if (errors.length) failed = true;
await browser.close();
console.log(failed ? "\nDIRECTORY BUTTONS PROBE FAILED" : "\ndirectory buttons probe passed");
process.exit(failed ? 1 : 0);

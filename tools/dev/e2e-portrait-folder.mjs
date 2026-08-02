/**
 * custom-portrait-folder live-effect e2e — review finding 14.
 *
 * The setting declared `requiresReload: false` with no `onChange`, and both
 * functions that act on it ran only in the `ready` hook and from the gallery's GM
 * refresh button. So changing the folder did nothing: no reload prompt, the new
 * folder was never created, and the cached `custom-portrait-list` still held the
 * OLD folder's files — every character generated afterwards silently drew from the
 * old folder, and if it had been moved the img paths 404'd on sheet and token.
 *
 * Asserts, WITHOUT reloading the page:
 *   1. setting a new folder creates it and empties the stale cache,
 *   2. a file dropped in it is picked up on the next change,
 *   3. clearing the setting clears the cache.
 *
 * Every read POLLS for its transition rather than sleeping at it (2026-08-02).
 * The onChange's work — browse, maybe createDirectory, rescan, then the list
 * write's own server round-trip — measures 850-1700ms per cycle on this
 * machine, and the fixed 800/1200ms sleeps this probe used sat exactly on
 * that edge: one slow evening and every read saw the PREVIOUS transition,
 * two different failure patterns from one unchanged code path. The traced
 * timeline (writes at t=1126/3388/5374 vs reads at t=2254/3672/5657) is in
 * the review #6 batch-2 commit.
 */

import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, watchErrors } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(34)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(34)} ${detail}`); failures++; };
let failures = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/* -------------------------------------------- */

console.log("\nchanging the folder takes effect without a reload");

const res = await page.evaluate(async () => {
  const NS = "air-bladder";
  const FP = foundry.applications.apps?.FilePicker?.implementation
    ?? foundry.applications.apps?.FilePicker ?? globalThis.FilePicker;
  const prior = game.settings.get(NS, "custom-portrait-folder");
  const DIR = "zz-portrait-probe";
  const out = {};

  // Poll the cached list until `test` accepts it (or ~10s passes), then hand
  // back whatever is there — the assertion still runs on the returned value,
  // so a transition that never lands still fails, it just fails on the truth
  // instead of on a photograph of the previous state.
  const settled = async (test) => {
    const deadline = Date.now() + 10000;
    for (;;) {
      const list = game.settings.get(NS, "custom-portrait-list");
      if (test(list) || Date.now() > deadline) return list;
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  // A stale cache standing in for "the old folder's files".
  await game.settings.set(NS, "custom-portrait-list", ["stale/one.png", "stale/two.png"]);
  out.staleBefore = game.settings.get(NS, "custom-portrait-list").length;

  // 1. Point the setting at a folder that does not exist yet. Deliberately NOT
  //    pre-created: creating it is part of what onChange is supposed to do, so
  //    pre-creating would make the assertion below a tautology.
  out.existedFirst = await FP.browse("data", DIR).then(() => true).catch(() => false);
  await game.settings.set(NS, "custom-portrait-folder", DIR);
  out.afterSwitch = await settled((l) => !l.some((f) => f.startsWith("stale/")));
  out.folderExists = await FP.browse("data", DIR).then(() => true).catch(() => false);

  // 2. Put an image in it, then re-trigger by setting the value again.
  //    (A 1x1 transparent PNG — enough for the extension filter.)
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bin], "probe-portrait.png", { type: "image/png" });
  try { await FP.upload("data", DIR, file, {}, { notify: false }); } catch (e) { out.uploadError = String(e); }

  await game.settings.set(NS, "custom-portrait-folder", "");
  out.afterClear = await settled((l) => l.length === 0);

  await game.settings.set(NS, "custom-portrait-folder", DIR);
  out.afterRescan = await settled((l) => l.some((f) => f.includes("probe-portrait.png")));

  // Restore — and WAIT for the restore's own rescan to land, or its late write
  // clobbers whatever the next probe seeds into the list.
  await game.settings.set(NS, "custom-portrait-folder", prior);
  await settled((l) => !l.some((f) => f.startsWith(`${DIR}/`)));
  return out;
});

res.staleBefore === 2
  ? ok("stale cache seeded", "2 entries standing in for the old folder")
  : fail("stale cache seeded", `got ${res.staleBefore}`);

// Only meaningful on a first run; afterwards the folder is already there.
res.folderExists
  ? ok("folder created", res.existedFirst ? "(already existed from a prior run)" : "created without a reload")
  : fail("folder created", "the folder was never created");

// The point is that the OLD folder's entries are gone, not that the list is empty
// — a re-run finds the probe image this test uploaded last time, and a real scan
// returning the folder's actual contents is correct behaviour.
Array.isArray(res.afterSwitch) && !res.afterSwitch.some((f) => f.startsWith("stale/"))
  ? ok("stale cache dropped on switch", res.afterSwitch.length
      ? `rescanned to ${res.afterSwitch.length} real file(s)` : "emptied")
  : fail("stale cache dropped on switch", JSON.stringify(res.afterSwitch));

if (res.uploadError) {
  fail("uploaded a probe image", res.uploadError);
} else {
  res.afterRescan.some((f) => f.includes("probe-portrait.png"))
    ? ok("new file picked up", `${res.afterRescan.length} image(s) found`)
    : fail("new file picked up", JSON.stringify(res.afterRescan));
}

Array.isArray(res.afterClear) && res.afterClear.length === 0
  ? ok("clearing the setting empties it", "")
  : fail("clearing the setting empties it", JSON.stringify(res.afterClear));

/* -------------------------------------------- */

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
if (errors.length) failures++;

await browser.close();
console.log(failures ? `\nFAILED (${failures})` : "\nPASSED");
process.exit(failures ? 1 : 0);

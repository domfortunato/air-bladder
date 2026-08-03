#!/usr/bin/env node
/**
 * The "Warden" GM-account rename: reversible, scoped, and collision-safe.
 *
 * The account NAME is world data but the label is localized per CLIENT, so
 * whichever GM logs in first decides what every player sees. The original code
 * matched only the two default names ("Gamemaster" / "Game Master"), so the
 * instant it wrote, nothing matched again — a GM who switched language, or turned
 * the setting off, was stuck with no way back short of editing the user by hand.
 * It now records the replaced name in a `renamedFrom` flag.
 *
 * Everything here runs across real page RELOADS, because the rename runs once, on
 * `ready`. Three parts:
 *
 *   A. the cycle, on the account that was actually renamed: turning the setting
 *      off hands the old name back and clears the flag; turning it on re-applies.
 *   B. a deliberately-named GM is never touched, in either state.
 *   C. Foundry enforces UNIQUE user names. A second GM that cannot take the name
 *      must be skipped quietly — the first version of this threw out of the ready
 *      hook, aborting the loop mid-way. Found by this probe, not by review.
 *
 * Usage: npm run dev:warden-rename
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

const NS = "air-bladder";
const ORIGINAL = "Gamemaster";
const DELIBERATE = "Bilbo the Warden";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/**
 * Reload, and do not return until the rename hook has actually had its chance.
 *
 * `cairn.js:190` bails out when another GM is the active one -- deliberately, so a
 * two-GM world cannot half-apply a rename. Right after a reload the PREVIOUS session
 * is often still registered active, so the hook runs, sees a stranger, and silently
 * does nothing. Waiting on `game.ready` cannot help: ready fires AFTER the hook, so
 * by the time it is true the decision has already been made and lost.
 *
 * So read `activeGM` with no wait at all -- that is what the hook itself saw -- and
 * if it saw a stranger, let the stale session drop and reload AGAIN. The hook is
 * registered with `Hooks.once`, so a fresh page is the only way to give it another go.
 *
 * Found 2026-07-30: the off-direction won this race and the on-direction lost it, so
 * the probe reported "expected Warden, got Gamemaster" -- indistinguishable, from the
 * outside, from the feature being broken.
 */
const reload = async () => {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.reload({ waitUntil: "networkidle", timeout: 60000 });
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
    const sawUs = await page.evaluate(
      () => globalThis.game?.users?.activeGM?.id === globalThis.game.user.id,
    );
    if (sawUs) {
      await page.waitForTimeout(600);
      return;
    }
    console.log(`  ..    reload ${attempt}: another GM was still active; retrying`);
    await page.waitForFunction(
      () => globalThis.game?.users?.activeGM?.id === globalThis.game.user.id,
      null, { timeout: 20000 },
    ).catch(() => { /* fall through and reload anyway */ });
  }
  throw new Error("activeGM never settled on this session across 4 reloads");
};
const setSetting = (v) =>
  page.evaluate(({ v, NS }) => game.settings.set(NS, "use-warden-title", v), { v, NS });
const userState = (id) =>
  page.evaluate(({ id, NS }) => {
    const u = id ? game.users.get(id) : game.user;
    return u ? { id: u.id, name: u.name, from: u.getFlag(NS, "renamedFrom") ?? null } : null;
  }, { id, NS });

let gmId = null;
let extras = [];

try {
  const wanted = await page.evaluate(() => game.i18n.localize("CAIRN.Warden"));

  // --- A. the cycle, on the real GM ------------------------------------------
  // This world's GM was renamed by the ORIGINAL code, so it carries no flag.
  // Seed the flag the current code would have written, which is what a world
  // renamed by this version looks like, then drive the cycle.
  const seeded = await page.evaluate(async ({ NS, ORIGINAL }) => {
    await game.user.setFlag(NS, "renamedFrom", ORIGINAL);
    return game.user.id;
  }, { NS, ORIGINAL });
  gmId = seeded;

  await setSetting(false);
  await reload();
  let r = await userState(gmId);
  r?.name === ORIGINAL
    ? ok(`setting off restored the original name ("${ORIGINAL}")`)
    : fail(`after switching off, the name is "${r?.name}"`);
  r?.from === null
    ? ok("the flag was cleared, so the account is ours no longer")
    : fail(`renamedFrom survived: ${JSON.stringify(r?.from)}`);

  await setSetting(true);
  await reload();
  r = await userState(gmId);
  r?.name === wanted
    ? ok(`setting on renamed it back to "${wanted}"`)
    : fail(`expected "${wanted}", got "${r?.name}"`);
  r?.from === ORIGINAL
    ? ok(`the replaced name is remembered ("${r.from}")`)
    : fail(`renamedFrom is ${JSON.stringify(r?.from)}, expected "${ORIGINAL}"`);

  // --- B + C. a deliberate name, and a name that cannot be taken -------------
  extras = await page.evaluate(async ({ DELIBERATE, ORIGINAL }) => {
    const mk = async (name) => {
      const dupe = game.users.find((u) => u.name === name);
      if (dupe) await dupe.delete();
      return (await User.create({ name, role: CONST.USER_ROLES.GAMEMASTER })).id;
    };
    return [await mk(DELIBERATE), await mk(ORIGINAL)];
  }, { DELIBERATE, ORIGINAL });

  await reload();
  const [del, clash] = [await userState(extras[0]), await userState(extras[1])];
  del?.name === DELIBERATE && del?.from === null
    ? ok(`a deliberately-named GM is left alone ("${DELIBERATE}", no flag)`)
    : fail(`deliberate GM was touched: ${JSON.stringify(del)}`);
  clash?.name === ORIGINAL && clash?.from === null
    ? ok(`a second GM is skipped when "${wanted}" is already taken (unique-name rule)`)
    : fail(`collision not handled: ${JSON.stringify(clash)}`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  // Delete the probe users by id, and put the real GM back exactly as found:
  // named "Warden", with no flag (it was renamed by the old code, so it never
  // had one).
  await page.evaluate(async ({ extras, gmId, NS }) => {
    for (const id of extras ?? []) {
      const u = game.users.get(id);
      if (u && u.id !== game.user.id) { try { await u.delete(); } catch { /* gone */ } }
    }
    await game.settings.set(NS, "use-warden-title", true);
    const gm = gmId ? game.users.get(gmId) : null;
    if (gm) {
      const warden = game.i18n.localize("CAIRN.Warden");
      if (gm.name !== warden) { try { await gm.update({ name: warden }); } catch { /* taken */ } }
      try { await gm.unsetFlag(NS, "renamedFrom"); } catch { /* already clear */ }
    }
  }, { extras, gmId, NS }).catch(() => {});

  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
  if (errors.length) failed = true;
  await browser.close();
}

console.log(failed ? "\nWARDEN RENAME PROBE FAILED" : "\nwarden rename probe passed");
process.exit(failed ? 1 : 0);

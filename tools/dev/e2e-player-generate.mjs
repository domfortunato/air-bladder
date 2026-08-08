#!/usr/bin/env node
/**
 * Player-side Generate PC behaviour: the roll-confirm (and, since the same
 * round, the Warden's on/off switch for the button itself).
 *
 *   npm run dev:playergen     (needs Foundry running, world launched, and
 *                              Alice — `npm run dev:players` seeds her)
 *
 * Two clients drive this: a GM context (so `game.users.activeGM` exists —
 * without one the relay refuses before the code under test even runs) and
 * Alice, because every leg here is per-user and a GM passes every check, so a
 * GM-only probe can literally not see the thing being probed.
 *
 * The roll-confirm legs (2026-08-08): with ONE or ZERO content sources
 * enabled, clicking Generate PC used to roll instantly — an accidental click
 * minted a character. Now a PLAYER gets a Yes/No confirm first; the Warden
 * does not (user ruling), and with 2+ sources the existing source picker IS
 * the interrupt, so the confirm must NOT stack in front of it.
 *
 * The source count is forced by shadowing `game.settings.get` IN-PAGE on the
 * asserting client, never by writing the world settings: the probe's
 * precondition must not leak into the world (the 0.1.12 pre-tag batch lost a
 * diagnosis to exactly that), and `enforceSourceFloor` makes flipping the
 * real toggles order-sensitive besides. The shadow is exact — only the three
 * content-source keys are intercepted, everything else passes through.
 *
 * Cleanup is snapshot-diff: every Actor and ChatMessage that exists after a
 * leg but not before it is deleted by id from the GM client, and named in the
 * output — a Yes-leg character arrives with whatever its background granted
 * (a horse, a donkey), so deleting "the character" alone would orphan the
 * grant.
 *
 * Exits non-zero on any failed assertion or console error.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

const dog = watchdog(240000, "player-generate");
const browser = await chromium.launch();
const gmCtx = await browser.newContext({ viewport: VIEWPORT });
const alCtx = await browser.newContext({ viewport: VIEWPORT });
const gm = await gmCtx.newPage();
const alice = await alCtx.newPage();
const gmErrors = watchErrors(gm);
const alErrors = watchErrors(alice);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

/** Shadow the three content-source reads on one page. mode: "one" | "two". */
const shadowSources = (page, mode) => page.evaluate((mode) => {
  const NS = "air-bladder";
  const FORCED = mode === "one"
    ? { "content-source-2e": true, "content-source-custom": false, "content-source-barebones": false }
    : { "content-source-2e": true, "content-source-custom": false, "content-source-barebones": true };
  if (!game.settings._probeOrigGet) game.settings._probeOrigGet = game.settings.get.bind(game.settings);
  game.settings.get = (ns, key) =>
    ns === NS && key in FORCED ? FORCED[key] : game.settings._probeOrigGet(ns, key);
}, mode);

const unshadowSources = (page) => page.evaluate(() => {
  if (game.settings._probeOrigGet) {
    game.settings.get = game.settings._probeOrigGet;
    delete game.settings._probeOrigGet;
  }
});

/** The ids of every Actor and ChatMessage currently in the world (GM view). */
const snapshot = () => gm.evaluate(() => ({
  actors: game.actors.map((a) => a.id),
  messages: game.messages.map((m) => m.id),
}));

/** Delete (GM-side) everything that appeared since `before`; return names. */
const sweep = async (before) => gm.evaluate(async (before) => {
  const newActors = game.actors.filter((a) => !before.actors.includes(a.id));
  const named = newActors.map((a) => `${a.name} (${a.id})`);
  for (const a of newActors) await a.delete();
  const newMsgs = game.messages.filter((m) => !before.messages.includes(m.id));
  for (const m of newMsgs) await m.delete();
  return { named, messages: newMsgs.length };
}, before);

/** Poll the GM page until a NEW character (vs `before`) exists, or timeout. */
const gmPollNewCharacter = async (before, ms = 45000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const found = await gm.evaluate((before) =>
      game.actors.some((a) => a.type === "character" && !before.actors.includes(a.id)), before);
    if (found) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};

/** The visible DialogV2 window titles on a page. */
const dialogTitles = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".application.dialog .window-title")].map((t) => t.textContent.trim()));

/** Click Alice's Generate PC button (present on both directory variants). */
const clickGenerate = () => alice.evaluate(() => {
  const btn = document.querySelector("#cairn-character-gen-button .create-character-generator-button");
  if (!btn) throw new Error("no Generate PC button on Alice's directory");
  btn.click();
});

/** Wait for a dialog whose title matches, or report what IS there. */
const awaitDialog = async (page, title, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const titles = await dialogTitles(page);
    if (titles.includes(title)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

try {
  await joinAsGM(gm);
  await joinAs(alice, "Alice");

  const t = await alice.evaluate(() => ({
    confirm: game.i18n.localize("CAIRN.GeneratePcConfirmTitle"),
    picker: game.i18n.localize("CAIRN.ContentSourceTitle"),
    canCreate: game.user.can("ACTOR_CREATE"),
  }));
  console.log(`\n  Alice ${t.canCreate ? "holds" : "lacks"} ACTOR_CREATE — ${t.canCreate ? "direct" : "relay"} path\n`);

  // Spy Alice's socket emits for the whole run (installed once, read per leg).
  await alice.evaluate(() => {
    game._probeEmits = [];
    const orig = game.socket.emit.bind(game.socket);
    game.socket.emit = (ev, data, ...rest) => {
      if (ev === `system.${game.system.id}`) game._probeEmits.push(data?.action ?? "?");
      return orig(ev, data, ...rest);
    };
  });
  const emitsOf = (kind) => alice.evaluate((k) => game._probeEmits.filter((a) => a === k).length, kind);

  console.log("one source, a player clicks Generate PC");
  await shadowSources(alice, "one");

  // -- The confirm appears, and No creates nothing --------------------------
  let before = await snapshot();
  await clickGenerate();
  (await awaitDialog(alice, t.confirm))
    ? ok("the Yes/No confirm appears before anything rolls")
    : fail(`no confirm dialog (visible: ${JSON.stringify(await dialogTitles(alice))})`);
  await alice.evaluate(() => {
    [...document.querySelectorAll(".application.dialog button")]
      .find((b) => b.dataset.action === "no")?.click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  const afterNo = await snapshot();
  const emitsAfterNo = await emitsOf("generatePC");
  afterNo.actors.length === before.actors.length && emitsAfterNo === 0
    ? ok("No: nothing created, nothing emitted")
    : fail(`No leaked: ${afterNo.actors.length - before.actors.length} new actor(s), ${emitsAfterNo} generatePC emit(s)`);

  // -- ✕ is also a decline --------------------------------------------------
  await clickGenerate();
  await awaitDialog(alice, t.confirm);
  await alice.evaluate(() => {
    [...document.querySelectorAll(".application.dialog")].at(-1)
      ?.querySelector('[data-action="close"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  const afterX = await snapshot();
  const emitsAfterX = await emitsOf("generatePC");
  afterX.actors.length === before.actors.length && emitsAfterX === 0
    ? ok("✕: nothing created, nothing emitted")
    : fail(`✕ leaked: ${afterX.actors.length - before.actors.length} new actor(s), ${emitsAfterX} emit(s)`);

  // -- Yes proceeds all the way to a character ------------------------------
  before = await snapshot();
  await clickGenerate();
  await awaitDialog(alice, t.confirm);
  await alice.evaluate(() => {
    [...document.querySelectorAll(".application.dialog button")]
      .find((b) => b.dataset.action === "yes")?.click();
  });
  const made = await gmPollNewCharacter(before);
  made
    ? ok("Yes: a character was created")
    : fail("Yes: no character appeared within 45s");
  if (!t.canCreate) {
    (await emitsOf("generatePC")) === 1
      ? ok("   …via exactly one generatePC relay emit")
      : fail(`expected exactly 1 generatePC emit, saw ${await emitsOf("generatePC")}`);
  }
  const swept = await sweep(before);
  console.log(`  (cleaned up: ${swept.named.join(", ") || "nothing"}; ${swept.messages} chat message(s))`);

  // -- The Warden is never asked --------------------------------------------
  console.log("\none source, the Warden");
  await shadowSources(gm, "one");
  const gmResult = await gm.evaluate(async () => {
    const p = game.cairn.characterGenerator.promptContentSource();
    // If the confirm regressed onto the GM path this promise never settles —
    // race it against a beat long enough for any dialog to have rendered.
    const src = await Promise.race([p, new Promise((r) => setTimeout(() => r("HUNG"), 4000))]);
    const dialogOpen = !!document.querySelector(".application.dialog");
    return { src, dialogOpen };
  });
  gmResult.src === "2e" && !gmResult.dialogOpen
    ? ok("promptContentSource resolves '2e' instantly, no dialog")
    : fail(`GM path: resolved ${JSON.stringify(gmResult.src)}, dialog open: ${gmResult.dialogOpen}`);
  await unshadowSources(gm);

  // -- Two sources: the PICKER appears, not the confirm ---------------------
  console.log("\ntwo sources, a player");
  await shadowSources(alice, "two");
  before = await snapshot();
  await clickGenerate();
  const sawPicker = await awaitDialog(alice, t.picker);
  const titlesNow = await dialogTitles(alice);
  sawPicker && !titlesNow.includes(t.confirm)
    ? ok("the source picker appears, unstacked")
    : fail(`expected the picker alone, saw: ${JSON.stringify(titlesNow)}`);
  await alice.evaluate(() => {
    [...document.querySelectorAll(".application.dialog")].at(-1)
      ?.querySelector('[data-action="close"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 2000));
  const afterPickerX = await snapshot();
  afterPickerX.actors.length === before.actors.length
    ? ok("picker ✕ still creates nothing (issue #6 behaviour intact)")
    : fail("picker ✕ created something");
  await unshadowSources(alice);

  const errs = [...gmErrors, ...alErrors];
  errs.length === 0 ? ok("zero console errors across both clients") : fail(`console errors: ${errs.join(" | ")}`);
} finally {
  clearTimeout(dog);
  await browser.close();
}

if (failed) { console.error("\nPLAYER-GENERATE PROBE FAILED"); process.exit(1); }
console.log("\nplayer-generate probe passed");

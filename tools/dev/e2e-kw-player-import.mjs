#!/usr/bin/env node
/**
 * Player-side Kettlewright import — the relay for a player without
 * ACTOR_CREATE, and the walls around it.
 *
 *   npm run dev:kw-player-import   (needs Foundry running, world launched, and
 *                                   Alice — `npm run dev:players` seeds her)
 *
 * Two clients, like dev:playergen and for the same reason: every leg here is
 * per-user and a GM passes every check, so a GM-only probe can literally not
 * see the thing being probed. The GM context also IS the broker — the relay
 * refuses without an active GM before the code under test even runs.
 *
 * Legs:
 *  (a) allow-player-generate ON: Alice's directory row carries Import from
 *      Kettlewright; the click runs the real options dialog + file chooser,
 *      the relay mints the actor on the GM client with Alice stamped OWNER in
 *      the create data, the GM sees a toast, and Alice gets the summary
 *      dialog + her sheet.
 *  (b) switch OFF: the button is gone from Alice's row AND a hand-emitted
 *      importKW is refused on the answering GM client — the wall, not the
 *      affordance (the crafted-client rule every broker here follows).
 *  (c) switch ON, unmatched background: a JSON naming a background nobody
 *      has still imports through the relay — kept as plain text, no question
 *      list — and the summary's kept-as-text warning reaches Alice. (The
 *      requireBackground gate RETIRED 2026-09-01, user ruling; its refusal
 *      leg retired with it.)
 *  (d) the BYSTANDER (review #20 finding 1): Bob, a third client, listens on
 *      the system socket through leg (a) and must see NEITHER the importKW
 *      request NOR the kwImported answer — both are addressed {recipients},
 *      and a bare emit is a broadcast that would hand every player Alice's
 *      whole parsed export. At the end he must have seen no kwImported at
 *      all: refusal answers are addressed too. (His importKW sightings in
 *      legs b/c/e are expected — those requests are CRAFTED broadcasts.)
 *  (e) the rebuilt wall (review #20 finding 2): a 501-item payload is not a
 *      character, it is a grind aimed at the import loop —
 *      sanitizeKettlewrightExport refuses it, the refusal is ANSWERED, and
 *      nothing is minted.
 *
 * Cleanup is snapshot-diff from the GM client (the playergen pattern): every
 * Actor and ChatMessage that appeared during a leg is deleted by id and named.
 * The allow switch is restored in the Node-level finally. Bob is created if
 * the world lacks him (create-players' default pair) and stays — a test world
 * should always carry two players.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

const dog = watchdog(240000, "kw-player-import");
const browser = await chromium.launch();
const gmCtx = await browser.newContext({ viewport: VIEWPORT });
const alCtx = await browser.newContext({ viewport: VIEWPORT });
const bobCtx = await browser.newContext({ viewport: VIEWPORT });
const gm = await gmCtx.newPage();
const alice = await alCtx.newPage();
const bob = await bobCtx.newPage();
const gmErrors = watchErrors(gm);
const alErrors = watchErrors(alice);
const bobErrors = watchErrors(bob);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);
let priorSwitch = null;

const NS = "air-bladder";
const sampleJson = (patch = {}) => ({
  name: "ZZ KW Player E2E", background: "Kettlewright",
  strength: 10, strength_max: 10, dexterity: 8, dexterity_max: 8, willpower: 9, willpower_max: 9,
  hp: 4, hp_max: 4, gold: 12, deprived: false, panicked: false, armor: "0",
  description: "Relayed in by Alice.", traits: "", notes: "", bonds: "", scars: "", omens: "",
  custom_image: false, image_url: "portrait17.webp",
  items: [{ id: "a", name: "Rations", tags: ["uses"], uses: 3, location: 0, description: "-" }],
  containers: [{ id: 0, name: "Main", slots: 10 }],
  ...patch,
});
const tmp = path.join(process.env.TEMP || ".", "kw_player_e2e.json");
fs.writeFileSync(tmp, JSON.stringify(sampleJson()));

const snapshot = () => gm.evaluate(() => ({
  actors: game.actors.map((a) => a.id),
  messages: game.messages.map((m) => m.id),
}));
const sweep = async (before) => gm.evaluate(async (before) => {
  const newActors = game.actors.filter((a) => !before.actors.includes(a.id));
  const named = newActors.map((a) => `${a.name} (${a.id})`);
  for (const a of newActors) await a.delete();
  const newMsgs = game.messages.filter((m) => !before.messages.includes(m.id));
  for (const m of newMsgs) await m.delete();
  return { named, messages: newMsgs.length };
}, before);
const setSwitch = (v) => gm.evaluate((v) => game.settings.set("air-bladder", "allow-player-generate", v), v);
const notifTexts = (page) => page.evaluate(() =>
  [...document.querySelectorAll("#notifications .notification")].map((n) => n.textContent.trim()));
/** Poll a page until some notification text matches `re`. */
const awaitNotif = async (page, re, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const texts = await notifTexts(page);
    const hit = texts.find((t) => re.test(t));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};

try {
  await joinAsGM(gm);
  // Bob must EXIST before his join — established, never assumed (and he
  // stays: create-players' default pair is the intended world state).
  const madeBob = await gm.evaluate(async () => {
    if (game.users.getName("Bob")) return false;
    await User.create({ name: "Bob", role: CONST.USER_ROLES.PLAYER });
    return true;
  });
  if (madeBob) console.log("  note  created player Bob (create-players' default pair)");
  await joinAs(alice, "Alice");
  await joinAs(bob, "Bob");
  // The bystander's ear: every importKW/kwImported that reaches Bob's client
  // is recorded. Installed before any leg emits.
  await bob.evaluate(() => {
    window.__kwSeen = [];
    game.socket.on(`system.${game.system.id}`, (m) => {
      if (m?.action === "importKW" || m?.action === "kwImported") window.__kwSeen.push(m.action);
    });
  });

  // Preconditions asserted, never assumed: Alice exists as a PLAYER without
  // ACTOR_CREATE — with it, the "relay" leg would silently become the direct
  // path and pass while testing nothing.
  const pre = await alice.evaluate(() => ({
    name: game.user.name, isGM: game.user.isGM, canCreate: game.user.can("ACTOR_CREATE"),
  }));
  if (pre.isGM || pre.canCreate) {
    fail(`precondition: Alice must be a player without ACTOR_CREATE (isGM=${pre.isGM}, canCreate=${pre.canCreate})`);
    throw new Error("precondition failed");
  }
  ok(`precondition: ${pre.name} is a player without ACTOR_CREATE`);

  priorSwitch = await gm.evaluate(() => game.settings.get("air-bladder", "allow-player-generate"));

  /* ---- leg (a): the happy relay, through the real button ---------------- */
  await setSwitch(true);
  await alice.waitForTimeout(1200); // the setting's onChange re-renders directories live
  const before = await snapshot();

  const hasButton = await alice.evaluate(() =>
    !!document.querySelector("#cairn-character-gen-button .import-kettlewright-button"));
  hasButton
    ? ok("switch on: Alice's directory row carries Import from Kettlewright")
    : fail("switch on: no Import from Kettlewright button on Alice's directory row");

  if (hasButton) {
    alice.on("filechooser", (fc) => fc.setFiles(tmp).catch(() => {}));
    await alice.evaluate(() => document.querySelector("#cairn-character-gen-button .import-kettlewright-button").click());
    const gotOptions = await alice.waitForSelector('[data-action="import"]', { timeout: 10000 }).then(() => true).catch(() => false);
    gotOptions ? ok("Alice gets the same options dialog the GM sees") : fail("no options dialog on Alice's client");
    await alice.evaluate(() => document.querySelector('[data-action="import"]')?.click());

    // Cold imports take ~25s (resolveGearItem re-reads the packs) — be patient.
    let made = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      made = await gm.evaluate((before) => {
        const a = game.actors.find((x) => x.type === "character" && !before.actors.includes(x.id));
        return a ? { id: a.id, name: a.name, ownership: a.ownership, img: a.img } : null;
      }, before);
      if (made) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!made) fail("no actor appeared on the GM client after Alice's import");
    else {
      ok(`relayed actor created: ${made.name}`);
      const aliceId = await alice.evaluate(() => game.user.id);
      made.ownership?.[aliceId] === 3
        ? ok("Alice is stamped OWNER in the create data")
        : fail(`Alice is not OWNER of the imported actor (ownership=${JSON.stringify(made.ownership)})`);
      const gmToast = await awaitNotif(gm, /Kettlewright/i, 10000);
      gmToast ? ok(`the Warden is told: "${gmToast.slice(0, 80)}"`) : fail("no GM-side toast about the player import");
      const summary = await alice.waitForSelector(".kwi-summary", { timeout: 20000 }).then(() => true).catch(() => false);
      summary ? ok("the import summary renders on Alice's client") : fail("no summary dialog on Alice's client");
      // The sheet render is KICKED OFF before the summary but lands async —
      // the z-order dance in showImportSummary exists because the summary can
      // win that race. Poll the app state, don't snapshot the DOM once.
      let sheetOpen = false;
      for (let i = 0; i < 25 && !sheetOpen; i++) {
        sheetOpen = await alice.evaluate((id) => game.actors.get(id)?.sheet?.rendered === true, made.id);
        if (!sheetOpen) await new Promise((r) => setTimeout(r, 400));
      }
      sheetOpen ? ok("Alice's new sheet opened") : fail("the imported character's sheet did not open for Alice");
    }
    const swept = await sweep(before);
    if (swept.named.length) console.log(`  note  swept: ${swept.named.join(", ")} + ${swept.messages} message(s)`);

    /* ---- leg (d): the bystander saw nothing --------------------------- */
    // Both directions of the relay just ran. Addressed correctly, none of it
    // reaches Bob; a bare (broadcast) emit on either side turns this red.
    const bobSaw = await bob.evaluate(() => window.__kwSeen.splice(0));
    bobSaw.length === 0
      ? ok("bystander: none of the relay traffic reached Bob's client")
      : fail(`bystander: Bob's client received relay traffic it was no party to: ${bobSaw.join(", ")}`);
  }

  /* ---- leg (b): switch OFF — affordance gone AND the wall holds --------- */
  await setSwitch(false);
  await alice.waitForTimeout(1200);
  const beforeB = await snapshot();
  const buttonGone = await alice.evaluate(() =>
    !document.querySelector("#cairn-character-gen-button .import-kettlewright-button"));
  buttonGone ? ok("switch off: the button leaves Alice's directory") : fail("switch off: the button is still on Alice's directory");

  await alice.evaluate((json) => {
    game.socket.emit(`system.${game.system.id}`, { action: "importKW", json });
  }, sampleJson({ name: "ZZ KW Wall E2E" }));
  // Specific text, not a loose /Warden/ — leg (a)'s "Asked the Warden's
  // client…" toast can still be in the DOM, and a match on it is a vacuous
  // pass (this probe's first run made exactly that mistake).
  const refusedToast = await awaitNotif(alice, /has not enabled player character creation/i, 12000);
  refusedToast
    ? ok(`a hand-emitted request is refused on the answering side: "${refusedToast.slice(0, 70)}"`)
    : fail("no refusal reached Alice after a hand-emitted importKW with the switch off");
  await new Promise((r) => setTimeout(r, 2500));
  const wallHeld = await gm.evaluate((before) =>
    !game.actors.some((a) => !before.actors.includes(a.id)), beforeB);
  wallHeld ? ok("no actor was minted past the wall") : fail("a crafted emit minted an actor with the switch off");
  await sweep(beforeB);

  /* ---- leg (c): an unmatched background imports anyway, as text --------- */
  // The gate RETIRED (2026-09-01, user ruling): the import always proceeds,
  // background kept as plain text with no question list, and the summary —
  // on ALICE's screen, the requester's — carries the kept-as-text warning.
  await setSwitch(true);
  const beforeC = await snapshot();
  await alice.evaluate((json) => {
    game.socket.emit(`system.${game.system.id}`, { action: "importKW", json });
  }, sampleJson({ name: "ZZ KW BgText E2E", background: "ZZ No Such Background" }));
  let bgActor = null;
  const tC = Date.now();
  while (Date.now() - tC < 60000) {
    bgActor = await gm.evaluate((before) => {
      const a = game.actors.find((x) => x.name === "ZZ KW BgText E2E" && !before.actors.includes(x.id));
      return a ? {
        background: a.system.background,
        uuid: a.system.backgroundUuid,
        questions: (a.system.questions ?? []).length,
      } : null;
    }, beforeC);
    if (bgActor) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!bgActor) fail("an unmatched-background import minted nothing (the retired gate is back?)");
  else {
    ok("the unmatched background imported anyway");
    bgActor.background === "ZZ No Such Background" && !bgActor.uuid
      ? ok("background kept as plain text, no document matched")
      : fail(`background not kept as text (${JSON.stringify(bgActor)})`);
    bgActor.questions === 0
      ? ok("no question list without a matched background")
      : fail(`questions=${bgActor.questions}`);
    // The summary must NAME the background — leg (a)'s summary can still be
    // in Alice's DOM, so a bare .kwi-summary presence check would pass
    // vacuously (this probe family's four-times-paid lesson).
    const summaryC = await alice.waitForFunction(
      () => [...document.querySelectorAll(".kwi-summary")].some((el) => el.textContent.includes("ZZ No Such Background")),
      { timeout: 20000 },
    ).then(() => true).catch(() => false);
    summaryC
      ? ok("the summary's kept-as-text warning renders on Alice's client, naming the background")
      : fail("no kept-as-text summary reached Alice for the text import");
  }
  await sweep(beforeC);

  /* ---- leg (e): a payload that is not a character is refused, answered -- */
  // 501 items is a grind aimed at the sequential import loop, not a
  // character; the broker's rebuild (sanitizeKettlewrightExport) refuses it
  // before a single pack read, the refusal is ANSWERED so Alice is not left
  // waiting, and the GM console carries the warn her toast points at.
  const beforeE = await snapshot();
  await alice.evaluate((json) => {
    game.socket.emit(`system.${game.system.id}`, { action: "importKW", json });
  }, sampleJson({ name: "ZZ KW Flood E2E", items: Array.from({ length: 501 }, (_, i) => ({ name: `x${i}` })) }));
  const floodToast = await awaitNotif(alice, /failed on the Warden's client/i, 12000);
  floodToast
    ? ok("a 501-item payload is refused, and the refusal is answered")
    : fail("no failure answer reached Alice for the implausible payload");
  await new Promise((r) => setTimeout(r, 2000));
  const nothingE = await gm.evaluate((before) =>
    !game.actors.some((a) => !before.actors.includes(a.id)), beforeE);
  nothingE ? ok("the implausible payload minted nothing") : fail("the implausible payload minted an actor");
  await sweep(beforeE);

  /* ---- leg (d) coda: refusal answers are addressed too ------------------ */
  // Legs (b), (c) and (e) each drew an answer. Bob may have seen their
  // CRAFTED requests (Alice's hand-emits broadcast, as a hostile client's
  // would), but every kwImported answer was addressed to Alice alone.
  const bobAnswers = await bob.evaluate(() => window.__kwSeen.filter((a) => a === "kwImported"));
  bobAnswers.length === 0
    ? ok("bystander: no refusal answer reached Bob's client either")
    : fail(`bystander: ${bobAnswers.length} kwImported answer(s) leaked to Bob`);
} finally {
  try {
    if (priorSwitch !== null) {
      await setSwitch(priorSwitch);
      console.log(`  note  allow-player-generate restored to ${priorSwitch}`);
    }
  } catch (e) { console.error(`  note  could not restore the switch: ${e.message}`); }
  fs.rmSync(tmp, { force: true });
  await browser.close();
  dog.stop?.();
}

// No expected console errors: the BgNoMatch refusal toast that used to log
// one retired with the background gate (2026-09-01).
const errs = [...gmErrors, ...alErrors, ...bobErrors];
if (errs.length) { console.error("Console errors:\n" + errs.join("\n")); failed = true; }
console.log(failed ? "e2e FAILED" : "e2e passed");
process.exit(failed ? 1 : 0);

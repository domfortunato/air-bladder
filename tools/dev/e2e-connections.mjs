#!/usr/bin/env node
/**
 * The player-usable connection verb and its ownership automation (2026-08-01).
 *
 * Connect/break is the Warden's always, or the OWNER OF BOTH ENDS'. Ownership
 * FOLLOWS the edge: connected → {default: OBSERVER, keeper's players: OWNER},
 * broken → {default: LIMITED, connection-granted OWNER stripped} — but a
 * player's client is forbidden by the SERVER to write either shape
 * (sanitizeDocumentOwnershipField refuses non-GM ownership updates), so the
 * player folds `flags.air-bladder.ownershipSyncPending` into their own write
 * and the active GM's client answers, recomputing the shape from DOCUMENT
 * STATE. The flag is the authorization: only the child's owners can set it,
 * and nothing in the socket message is trusted at all.
 *
 * What this probe owns, and no other does:
 *   1. the relay END TO END as a real player: connect → flag → GM sync →
 *      exact shape → flag cleared;
 *   2. the one-end-foreign differential — the both-ends wall's fail-witness
 *      (Alice owns her PC and not the foreign sack; nothing else refuses);
 *   3. the break, and its designed COST: default LIMITED, her OWNER entry
 *      stripped, and her next write really failing (the positive control);
 *   4. the GM-ready SWEEP: a flag set while NO GM client existed is processed
 *      when one loads — the socket emit died unheard, the flag did not;
 *   5. the cap refusal from the player's side;
 *   6. hostile emits: a FLAGLESS uuid must change nothing (its ownership is
 *      the observable — a default 0 the broken shape would have raised),
 *      and embedded-Item / compendium uuids are refused as targets;
 *   7. `_preCreate`'s LIMITED default: a bare npc arrives {default: LIMITED},
 *      a monster keeps NONE, explicit creation data wins, the global-Actor
 *      path gets it too — with the in-page prototype-swap control making the
 *      default vanish, so the assertions demonstrably can fail.
 *
 * MUST run with a live GM client for the relay legs, and deliberately WITHOUT
 * one for the sweep leg — the GM context is closed and reopened mid-probe.
 *
 * Usage: npm run dev:connections   (establishes Alice itself)
 */
import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(46)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(46)} ${detail}`); failures++; };
let failures = 0;

const browser = await chromium.launch();
watchdog(420000, "dev:connections");

let gmContext = await browser.newContext({ viewport: VIEWPORT });
let gmPage = await gmContext.newPage();
let gmErrors = watchErrors(gmPage);
await joinAsGM(gmPage);
await dismissChrome(gmPage);

/* ---- GM seeds ------------------------------------------------------------ */

const scene = await gmPage.evaluate(async () => {
  const Cls = CONFIG.Actor.documentClass;
  // A prior aborted run must not satisfy (or trip) this one's assertions.
  for (const a of game.actors.filter((x) => x.name.startsWith("ZZ Conn"))) await a.delete();

  let alice = game.users.getName("Alice");
  if (!alice) alice = await User.create({ name: "Alice", role: CONST.USER_ROLES.PLAYER });
  if (alice.role !== CONST.USER_ROLES.PLAYER) return { error: `Alice is role ${alice.role}, not PLAYER` };
  const own = { default: 0, [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  const sackSys = { role: "container", containerClass: "sack", hp: { value: 0, max: 0 }, generationEnabled: false };

  const pc = await Cls.create({ name: "ZZ Conn PC", type: "character", ownership: own });
  const free = await Cls.create({ name: "ZZ Conn Free", type: "npc", ownership: own, system: sackSys });
  const sack = await Cls.create({
    name: "ZZ Conn Sack", type: "npc", ownership: own,
    system: { ...sackSys, connectedTo: pc.uuid },
  });
  const foreign = await Cls.create({ name: "ZZ Conn Foreign", type: "npc", ownership: { default: 0 }, system: sackSys });
  const sweep = await Cls.create({ name: "ZZ Conn Sweep", type: "npc", ownership: own, system: sackSys });
  // Explicit {default: 0} so _preCreate leaves it — the broken shape would
  // raise it to LIMITED, which is what makes "nothing happened" observable.
  const flagless = await Cls.create({ name: "ZZ Conn Flagless", type: "npc", ownership: { default: 0 }, system: sackSys });
  const [bait] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Conn Bait", type: "item" }]);

  // The cap pair: a PC of Alice's at the ceiling, and the extra she will try.
  const { maxConnections } = await import("/systems/air-bladder/module/connections.js");
  const capPc = await Cls.create({ name: "ZZ Conn Cap PC", type: "character", ownership: own });
  for (let i = 0; i < maxConnections(); i++) {
    await Cls.create({ name: `ZZ Conn Cap Kid ${i}`, type: "npc", system: { ...sackSys, connectedTo: capPc.uuid } });
  }
  const capExtra = await Cls.create({ name: "ZZ Conn Cap Extra", type: "npc", ownership: own, system: sackSys });

  // The crafted-connect pair: an npc Alice DOES own, and a PC she does not.
  // `connectActor` would refuse this on her client (both ends), so the leg
  // writes system.connectedTo raw -- which is exactly what a crafted client
  // does, and what `system.*` having no server wall permits.
  const crafted = await Cls.create({ name: "ZZ Conn Crafted", type: "npc", ownership: own, system: sackSys });
  const strangerPc = await Cls.create({ name: "ZZ Conn Stranger PC", type: "character", ownership: { default: 0 } });

  const packActor = game.packs.get("air-bladder.mounts-transports")?.index.contents[0];
  return {
    aliceId: alice.id,
    pcUuid: pc.uuid, freeUuid: free.uuid, sackUuid: sack.uuid, foreignUuid: foreign.uuid,
    sweepUuid: sweep.uuid, flaglessUuid: flagless.uuid, flaglessTime: flagless._stats.modifiedTime,
    baitUuid: bait.uuid, capPcUuid: capPc.uuid, capExtraUuid: capExtra.uuid,
    craftedUuid: crafted.uuid, strangerPcUuid: strangerPc.uuid,
    compendiumUuid: packActor?.uuid ?? null,
    max: maxConnections(),
  };
});
if (scene.error) {
  console.log(`  FAIL  setup: ${scene.error}`);
  await browser.close();
  process.exit(1);
}

/* ---- 7. _preCreate LIMITED default (GM page, independent) ----------------- */

console.log("\n_preCreate: an unconnected npc arrives LIMITED");
const pre = await gmPage.evaluate(async () => {
  const Cls = CONFIG.Actor.documentClass;
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const mk = async (data, cls = Cls) => {
    const a = await cls.create(data);
    const d = a.ownership.default;
    await a.delete();
    return d;
  };
  const npc = await mk({ name: "ZZ Conn Pre NPC", type: "npc" });
  const monster = await mk({ name: "ZZ Conn Pre Monster", type: "npc", system: { role: "monster" } });
  const explicit = await mk({ name: "ZZ Conn Pre Explicit", type: "npc", ownership: { default: L.OBSERVER } });
  // The importAll-shaped path: the global Actor is NOT CONFIG.Actor.documentClass,
  // but _preCreate is an instance method and must fire for it too.
  const viaGlobal = await mk({ name: "ZZ Conn Pre Global", type: "npc" }, Actor);
  // NEGATIVE CONTROL: swap the override off the prototype; the default must
  // vanish, or the three greens above hold for some other reason entirely.
  const proto = Cls.prototype;
  const original = proto._preCreate;
  proto._preCreate = Object.getPrototypeOf(proto)._preCreate;
  const control = await mk({ name: "ZZ Conn Pre Control", type: "npc" });
  proto._preCreate = original;
  return { npc, monster, explicit, viaGlobal, control, L: { NONE: L.NONE, LIMITED: L.LIMITED, OBSERVER: L.OBSERVER } };
});
pre.npc === pre.L.LIMITED
  ? ok("a bare npc defaults to LIMITED", "a stranger's silhouette")
  : fail("a bare npc defaults to LIMITED", `default=${pre.npc}`);
pre.monster === pre.L.NONE
  ? ok("a monster keeps NONE", "the automation never touches a monster")
  : fail("a monster keeps NONE", `default=${pre.monster}`);
pre.explicit === pre.L.OBSERVER
  ? ok("explicit creation data wins", "OBSERVER stays OBSERVER")
  : fail("explicit creation data wins", `default=${pre.explicit}`);
pre.viaGlobal === pre.L.LIMITED
  ? ok("the global-Actor path gets the default too", "the importAll-shaped case")
  : fail("the global-Actor path gets the default too", `default=${pre.viaGlobal}`);
pre.control === pre.L.NONE
  ? ok("   control: with _preCreate swapped off it vanishes", "the assertions can fail")
  : fail("   control: with _preCreate swapped off it vanishes", `default=${pre.control} — not load-bearing`);

/* ---- Alice joins ---------------------------------------------------------- */

const aliceContext = await browser.newContext({ viewport: VIEWPORT });
const alicePage = await aliceContext.newPage();
const aliceErrors = watchErrors(alicePage);
await joinAs(alicePage, "Alice");
await dismissChrome(alicePage);

/* ---- 1+2+3+5. the verb, both directions, and its walls ------------------- */

console.log("\nthe player verb, with a live GM client answering");
const verb = await alicePage.evaluate(async ({ aliceId, pcUuid, freeUuid, sackUuid, foreignUuid, capPcUuid, capExtraUuid }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const pc = await fromUuid(pcUuid);
  const free = await fromUuid(freeUuid);
  const sack = await fromUuid(sackUuid);
  const foreign = await fromUuid(foreignUuid);
  const capPc = await fromUuid(capPcUuid);
  const capExtra = await fromUuid(capExtraUuid);

  // 1. Connect, both ends owned: link + flag in ONE write, then the GM
  //    answers. Poll for the SETTLED state, never the first observable.
  const connectReturned = await pc.connectActor(free);
  const linkWritten = free.system.connectedTo === pc.uuid;
  let settled = false;
  for (let i = 0; i < 40 && !settled; i++) {
    await sleep(250);
    settled = free.ownership.default === L.OBSERVER
      && free.ownership[aliceId] === L.OWNER
      && free.getFlag("air-bladder", "ownershipSyncPending") === undefined;
  }
  const connectedShape = { ...free.ownership };
  const shapeClean = Object.keys(connectedShape).every((id) =>
    id === "default" || id === aliceId || game.users.get(id)?.isGM);

  // 2. One end foreign: refused, nothing written anywhere.
  const foreignReturned = await pc.connectActor(foreign);
  const foreignState = {
    link: foreign.system.connectedTo || "",
    dflt: foreign.ownership.default ?? 0,
    flag: foreign.getFlag("air-bladder", "ownershipSyncPending"),
  };

  // 5. The cap, from the player's side: she owns both ends, so only the
  //    ceiling refuses — and it does so without writing.
  const capReturned = await capPc.connectActor(capExtra);
  const capUntouched = !capExtra.system.connectedTo;

  // 3. Break: lands, and costs her OWNER — the designed outcome.
  const DialogV2 = foundry.applications.api.DialogV2;
  const origConfirm = DialogV2.confirm;
  DialogV2.confirm = async () => true;
  await pc.unlinkOwnedContainer(sack.uuid);
  DialogV2.confirm = origConfirm;
  const breakLanded = sack.system.connectedTo === "";
  let broke = false;
  for (let i = 0; i < 40 && !broke; i++) {
    await sleep(250);
    broke = sack.ownership.default === L.LIMITED && sack.ownership[aliceId] === undefined;
  }
  const brokenShape = { ...sack.ownership };
  // POSITIVE CONTROL for the loss: her next write must actually fail — not
  // merely read as forbidden. The rejection is caught; nothing is left
  // hanging.
  let writeRefused = false;
  try {
    await sack.update({ "system.slots": 9 });
  } catch {
    writeRefused = true;
  }
  const slotsUnchanged = sack.system.slots !== 9;

  return { connectReturned, linkWritten, settled, connectedShape, shapeClean,
    foreignReturned, foreignState, capReturned, capUntouched,
    breakLanded, broke, brokenShape, writeRefused, slotsUnchanged };
}, scene);

verb.connectReturned && verb.linkWritten
  ? ok("her connect lands", "one write: link + sync flag")
  : fail("her connect lands", JSON.stringify(verb));
verb.settled && verb.shapeClean
  ? ok("the GM answers with the EXACT shape, flag cleared", JSON.stringify(verb.connectedShape))
  : fail("the GM answers with the EXACT shape, flag cleared", JSON.stringify(verb.connectedShape));
!verb.foreignReturned && verb.foreignState.link === "" && verb.foreignState.dflt === 0
  && verb.foreignState.flag === undefined
  ? ok("one end foreign → refused, nothing written", "the both-ends wall's fail-witness")
  : fail("one end foreign → refused, nothing written", JSON.stringify(verb.foreignState));
verb.capReturned === false && verb.capUntouched
  ? ok(`the cap refuses her ${scene.max + 1}th connection`, "player-side, nothing written")
  : fail(`the cap refuses her ${scene.max + 1}th connection`, JSON.stringify(verb));
verb.breakLanded && verb.broke
  ? ok("her break lands and strips her OWNER", `default LIMITED — ${JSON.stringify(verb.brokenShape)}`)
  : fail("her break lands and strips her OWNER", JSON.stringify(verb.brokenShape));
verb.writeRefused && verb.slotsUnchanged
  ? ok("   control: her next write really fails", "the loss is enforced, not cosmetic")
  : fail("   control: her next write really fails", `refused=${verb.writeRefused} unchanged=${verb.slotsUnchanged}`);

/* ---- 6. hostile emits ------------------------------------------------------ */

console.log("\nhostile emits change nothing");
await alicePage.evaluate(async ({ flaglessUuid, baitUuid, compendiumUuid }) => {
  game.socket.emit(`system.${game.system.id}`, { action: "ownershipSync", childUuid: flaglessUuid });
  game.socket.emit(`system.${game.system.id}`, { action: "ownershipSync", childUuid: baitUuid });
  if (compendiumUuid) game.socket.emit(`system.${game.system.id}`, { action: "ownershipSync", childUuid: compendiumUuid });
}, scene);
await gmPage.waitForTimeout(3000);
const hostile = await gmPage.evaluate(async ({ flaglessUuid, flaglessTime, pcUuid, aliceId }) => {
  const flagless = await fromUuid(flaglessUuid);
  const pc = await fromUuid(pcUuid);
  return {
    // The observable with teeth: a default 0 the broken shape WOULD have
    // raised to LIMITED had the handler acted on a flagless doc.
    flaglessDefault: flagless.ownership.default,
    flaglessUntouched: flagless._stats.modifiedTime === flaglessTime,
    // The bait's parent must keep its seeded ownership — an embedded-Item
    // uuid resolves and delegates ownership, and must be refused as a target.
    pcDefault: pc.ownership.default,
    pcAliceOwner: pc.ownership[aliceId],
  };
}, scene);
hostile.flaglessDefault === 0 && hostile.flaglessUntouched
  ? ok("a flagless uuid is a no-op", "default still 0, modifiedTime unmoved")
  : fail("a flagless uuid is a no-op", JSON.stringify(hostile));
hostile.pcDefault === 0 && hostile.pcAliceOwner === 3
  ? ok("embedded/compendium uuids are refused as targets", "the bait's parent is untouched")
  : fail("embedded/compendium uuids are refused as targets", JSON.stringify(hostile));

/* ---- 6b. a CRAFTED connect to a stranger's PC ------------------------------ */

// The both-ends rule lives entirely in the client, and `system.*` has no server
// wall -- so Alice can point her own npc at a PC she does not own, raise the
// sync flag she IS allowed to set, and ask the Warden's client to sign the
// ownership shape for it. The flag alone cannot tell that apart from a
// legitimate connect; `senderId` can, and was simply unused (review #7 #15).
//
// Driven by CALLING syncPendingOwnership with a requester rather than by
// emitting, and that is deliberate: an emit is answered by whichever client
// holds activeGM, and in a world a human has open that can be a stale tab
// running pre-change code -- measured, on a stash differential, identically on
// HEAD. The relay's wiring is covered end-to-end by the legitimate legs above;
// what is new here is one argument, so it is asserted where the answer cannot
// come from somebody else's browser.
console.log("\na crafted connect to a stranger's PC is refused");
const crafted = await gmPage.evaluate(async ({ craftedUuid, strangerPcUuid, pcUuid, aliceId }) => {
  const conn = await import("/systems/air-bladder/module/connections.js");
  const c = await fromUuid(craftedUuid);
  const alice = game.users.get(aliceId);
  const arm = (link) => c.update({
    "system.connectedTo": link,
    "flags.air-bladder.ownershipSyncPending": true,
    ownership: foundry.data.operators.ForcedReplacement.create({
      default: 0, [aliceId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    }),
  });

  // 1. A stranger's PC as keeper: Alice owns the child and not the other end.
  await arm(strangerPcUuid);
  await conn.syncPendingOwnership(c, { requester: alice });
  const refused = {
    dflt: c.ownership.default,
    flag: c.getFlag("air-bladder", "ownershipSyncPending"),
    stillLinked: c.system.connectedTo,
  };

  // 2. THE CONTROL, same document and same requester, pointed at HER OWN PC:
  //    it must be signed. Without this "nothing happened" would pass on a
  //    check that refuses everything, which is the easiest way to be wrong here.
  await arm(pcUuid);
  await conn.syncPendingOwnership(c, { requester: alice });
  const signed = {
    dflt: c.ownership.default,
    aliceLevel: c.ownership[aliceId] ?? null,
    flag: c.getFlag("air-bladder", "ownershipSyncPending"),
  };
  return { refused, signed };
}, scene);
crafted.refused?.dflt === 0
  ? ok("the Warden refuses to sign it", "ownership default untouched")
  : fail("the Warden refuses to sign it", JSON.stringify(crafted.refused));
crafted.refused?.flag === undefined
  ? ok("   and the flag is cleared, so the ready sweep cannot re-apply it later")
  : fail("   the flag is still set — bypassable by waiting for a GM reload", JSON.stringify(crafted.refused));
crafted.signed?.dflt === 2 && crafted.signed?.aliceLevel === 3 && crafted.signed?.flag === undefined
  ? ok("   control: the same requester on HER OWN PC is signed", JSON.stringify(crafted.signed))
  : fail("   control: the same requester on her own PC", JSON.stringify(crafted.signed));

/* ---- 4. the GM-ready sweep -------------------------------------------------- */

// The flag must be processable with NO GM client alive when it was set: the
// socket emit dies unheard, and the sweep in the ready hook is what catches
// it on the next GM load. Close the GM context FIRST, then let Alice connect.
console.log("\nthe GM-ready sweep catches a flag set while no GM was online");
await gmContext.close();
await alicePage.waitForTimeout(1500);

const sweepSet = await alicePage.evaluate(async ({ pcUuid, sweepUuid }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pc = await fromUuid(pcUuid);
  const sweepChild = await fromUuid(sweepUuid);
  const returned = await pc.connectActor(sweepChild);
  // Give any straggler GM three seconds to (wrongly) exist and answer; the
  // flag surviving is the precondition the sweep leg stands on.
  await sleep(3000);
  return {
    returned,
    linked: sweepChild.system.connectedTo === pc.uuid,
    flagStillSet: sweepChild.getFlag("air-bladder", "ownershipSyncPending") === true,
    dflt: sweepChild.ownership.default,
  };
}, scene);
sweepSet.returned && sweepSet.linked && sweepSet.flagStillSet
  ? ok("with no GM online the flag WAITS", "link written, nobody answered")
  : fail("with no GM online the flag WAITS", JSON.stringify(sweepSet));

gmContext = await browser.newContext({ viewport: VIEWPORT });
gmPage = await gmContext.newPage();
const gmErrors2 = watchErrors(gmPage);
await joinAsGM(gmPage);
await dismissChrome(gmPage);

const swept = await gmPage.evaluate(async ({ sweepUuid, aliceId }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const child = await fromUuid(sweepUuid);
  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    await sleep(250);
    done = child.ownership.default === L.OBSERVER
      && child.ownership[aliceId] === L.OWNER
      && child.getFlag("air-bladder", "ownershipSyncPending") === undefined;
  }
  return { done, shape: { ...child.ownership } };
}, scene);
swept.done
  ? ok("the next GM load processes it", JSON.stringify(swept.shape))
  : fail("the next GM load processes it", JSON.stringify(swept.shape));

/* ---- cleanup ---------------------------------------------------------------- */

await gmPage.evaluate(async () => {
  for (const a of game.actors.filter((x) => x.name.startsWith("ZZ Conn"))) await a.delete();
});

/* One console error is EXPECTED and is the positive control's own evidence:
   after her break, Alice's attempted write must be refused by the server, and
   Foundry logs that refusal as a console error. So it is filtered here rather
   than in `watchErrors`' global ignore list — a system-wide "lacks permission"
   exemption would blind every other probe to exactly the failures they exist to
   catch. It is REQUIRED, not merely tolerated: if the message stops appearing,
   the write stopped being refused, and the assertion above is passing on a read
   of stale client state. */
const EXPECTED = /User Alice lacks permission to update Actor/i;
const expectedSeen = aliceErrors.some((e) => EXPECTED.test(e));
expectedSeen
  ? ok("   control: the server itself logged the refusal", "her write was refused server-side, not client-side")
  : fail("   control: the server itself logged the refusal", "no permission error — the refusal never reached the server");

const consoleErrors = [...gmErrors, ...gmErrors2, ...aliceErrors].filter((e) => !EXPECTED.test(e));
if (consoleErrors.length) {
  console.error("\nconsole errors:");
  consoleErrors.slice(0, 15).forEach((e) => console.error("  " + e));
  failures++;
}
await browser.close();

console.log(failures ? "\nCONNECTIONS PROBE FAILED\n" : "\nconnections probe passed\n");
process.exit(failures ? 1 : 0);

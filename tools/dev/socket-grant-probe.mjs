/**
 * Socket grant broker e2e — review #5, criticals 1 and 2.
 *
 * A player's character generation cannot mint the Actors a background grants
 * (ACTOR_CREATE is not theirs), so grantContainers emits on the system socket
 * and the Warden's client writes. Two ways that shipped broken, both invisible
 * from a GM session:
 *
 *   - `system.json` never declared `"socket": true`, so the server bound no
 *     handler and silently discarded every emit. No error anywhere; the horse
 *     simply never appeared. The POSITIVE path here is the gate for that line:
 *     it can only pass when the server actually relays.
 *   - The handler read the requester out of the attacker's own payload
 *     (`msg.userId`) instead of the server-authenticated second argument. Any
 *     player could pass a GM's public user id and testUserPermission would
 *     short-circuit to OWNER — the guard was a no-op. Attack 1 proves the
 *     forged id is now ignored; attack 2 proves an embedded-Item uuid (which
 *     resolves, and delegates ownership to the parent) is refused as a
 *     connection target.
 *
 * MUST run as a real PLAYER for the positive path (a GM never takes the socket
 * branch — the exact reason the defect shipped: every probe joined as GM), and
 * the server must have been RESTARTED since system.json gained "socket": true —
 * the server reads the manifest at startup only, so an un-restarted edit looks
 * exactly like no edit.
 *
 * NEGATIVE CONTROL, in-page: re-register the OLD handler's logic alongside the
 * fixed one and replay both attacks — the old code mints both actors, proving
 * the refusals above are load-bearing and the attacks well-formed, in seconds
 * rather than by reverting source. `game.socket.off` removes it afterwards.
 *
 * Usage: npm run dev:socket-grant   (needs Foundry running; establishes Alice
 * itself if dev:players has not run)
 */

import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, joinAs, watchErrors } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(40)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(40)} ${detail}`); failures++; };
let failures = 0;

const browser = await chromium.launch();

// Separate contexts: Foundry's session cookie is per origin, so two pages in
// one context would be the same user.
const gmPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
const gmErrors = watchErrors(gmPage);
await joinAsGM(gmPage);
await dismissChrome(gmPage);

/* ---- GM sets the scene --------------------------------------------------- */

const scene = await gmPage.evaluate(async () => {
  // A prior aborted run must not satisfy (or trip) this one's assertions.
  for (const a of game.actors.filter((x) => x.name.startsWith("ZZ PROBE SG"))) await a.delete();

  // The probe ESTABLISHES its precondition: Alice exists, role PLAYER.
  let alice = game.users.getName("Alice");
  if (!alice) alice = await User.create({ name: "Alice", role: CONST.USER_ROLES.PLAYER });
  if (alice.role !== CONST.USER_ROLES.PLAYER) return { error: `Alice is role ${alice.role}, not PLAYER` };
  if (alice.hasPermission("ACTOR_CREATE")) {
    return { error: "this world grants players ACTOR_CREATE — the socket path never runs; probe cannot assert it" };
  }

  // Alice's own character (the legitimate grant target), carrying one embedded
  // item whose uuid resolves AND delegates ownership to Alice — attack 2's bait.
  const pc = await CONFIG.Actor.documentClass.create({
    name: "ZZ PROBE SG Char", type: "character",
    ownership: { default: 0, [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
  });
  const [item] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ PROBE SG Bait", type: "item" }]);

  // A character Alice does NOT own — attack 1 tries to attach to it.
  const foreign = await CONFIG.Actor.documentClass.create({
    name: "ZZ PROBE SG Foreign", type: "character", ownership: { default: 0 },
  });

  return {
    gmId: game.user.id,
    pcUuid: pc.uuid,
    itemUuid: item.uuid,
    foreignUuid: foreign.uuid,
  };
});

if (scene.error) {
  console.log(`  FAIL  setup: ${scene.error}`);
  await browser.close();
  process.exit(1);
}

/* ---- Alice joins --------------------------------------------------------- */

const alicePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
const aliceErrors = watchErrors(alicePage);
await joinAs(alicePage, "Alice");
await dismissChrome(alicePage);

/* ---- positive path: the real player grant, end to end -------------------- */

const granted = await alicePage.evaluate(async ({ pcUuid }) => {
  const gen = await import("/systems/air-bladder/module/character-generator.js");
  const pc = await fromUuid(pcUuid);
  // The exact call a player's generation makes. Returns [] on this side; the
  // document appears when the Warden's client answers over the socket.
  const out = await gen.grantContainers(pc, [{ name: "Rivertooth", slots: 6, grantSource: "question:9" }]);
  // The broker CREATES, then copies ownership in a second write — so poll for
  // the settled state (horse exists AND Alice owns it), not for existence. The
  // first version stopped at the create broadcast and read ownership from the
  // gap between the two writes: a race in the probe, reported as a bug in the
  // code.
  const deadline = Date.now() + 10000;
  let horse = null;
  while (Date.now() < deadline) {
    horse = game.actors.find((a) => a.type === "npc" && a.name === "Rivertooth" && a.system.connectedTo === pcUuid);
    if (horse && horse.testUserPermission(game.user, "OWNER")) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!horse) return { minted: false, returned: out.length };
  return {
    minted: true,
    returned: out.length,
    connected: horse.system.connectedTo === pcUuid,
    // The stat block rode the payload: built player-side from the Actor pack,
    // surviving the broker's rebuild. 4 is Rivertooth's documented HP; 6 is
    // the schema default a dropped payload field would produce.
    hp: `${horse.system.hp.value}/${horse.system.hp.max}`,
    hpRight: horse.system.hp.value === 4 && horse.system.hp.max === 4,
    ownedByAlice: horse.testUserPermission(game.user, "OWNER"),
    flagged: horse.getFlag("air-bladder", "grantSource") === "question:9",
    capacity: horse.system.slotsMax,
  };
}, { pcUuid: scene.pcUuid });

granted.minted
  ? ok("the socket relays and the broker mints", "(\"socket\": true is live)")
  : fail("no horse arrived over the socket", "manifest line missing, or server not restarted since it was added?");
if (granted.minted) {
  granted.returned === 0 ? ok("player-side call returned [] (fire-and-forget)") : fail(`player call returned ${granted.returned} actors`);
  granted.connected ? ok("connected to the requesting character") : fail("connectedTo is wrong");
  granted.hpRight ? ok(`stat block survived the rebuild (hp ${granted.hp})`) : fail(`hp ${granted.hp}, expected 4/4`);
  granted.ownedByAlice ? ok("ownership copied — Alice owns her horse") : fail("Alice does not own the minted actor");
  granted.flagged ? ok("grantSource flag carried (regenerate can find it)") : fail("grantSource flag missing");
}

/* ---- attack 1: forged userId --------------------------------------------- */
/* ---- attack 2: embedded-Item uuid as the connection target --------------- */

await alicePage.evaluate(async ({ gmId, foreignUuid, itemUuid }) => {
  // What the pre-fix handler trusted: a payload naming a GM as the requester.
  // GM ids are public via game.users; testUserPermission(gm) is OWNER on
  // anything. The fixed handler must identify us by the server-authenticated
  // sender id instead and refuse — Alice does not own the foreign character.
  game.socket.emit(`system.${game.system.id}`, {
    action: "grantActors", ownerUuid: foreignUuid, userId: gmId,
    payloads: [{ name: "ZZ PROBE SG Forged", system: { slots: 4 } }],
  });
  // An embedded Item resolves via fromUuid and delegates getUserLevel to its
  // parent — so Alice IS its owner and the ownership check alone passes. The
  // world-Actor check must refuse it as a connection target.
  game.socket.emit(`system.${game.system.id}`, {
    action: "grantActors", ownerUuid: itemUuid, userId: gmId,
    payloads: [{ name: "ZZ PROBE SG ItemTarget", system: { slots: 4 } }],
  });
}, { gmId: scene.gmId, foreignUuid: scene.foreignUuid, itemUuid: scene.itemUuid });

// Give the GM client time to (not) act, then look from the GM side.
await gmPage.waitForTimeout(3000);
const attacks = await gmPage.evaluate(() => ({
  forged: !!game.actors.getName("ZZ PROBE SG Forged"),
  itemTarget: !!game.actors.getName("ZZ PROBE SG ItemTarget"),
}));
attacks.forged
  ? fail("FORGED userId was honoured", "a player attached an actor to a character they do not own")
  : ok("a forged userId is ignored", "(sender is the authenticated socket id)");
attacks.itemTarget
  ? fail("an embedded-Item uuid was accepted as owner", "connectedTo now points at an Item")
  : ok("a non-world-Actor connection target is refused");

/* ---- negative control: the OLD handler mints on both attacks ------------- */

await gmPage.evaluate(async () => {
  // The pre-fix logic, verbatim in the parts that matter: requester read from
  // the payload, no world-Actor check. Registered ALONGSIDE the fixed handler
  // (which goes on refusing) so the attacks' well-formedness is proven against
  // the code that shipped. Removed via game.socket.off below.
  globalThis.__probeOldHandler = async (msg) => {
    if (msg?.action !== "grantActors") return;
    if (game.users.activeGM !== game.user) return;
    const owner = await fromUuid(msg.ownerUuid);
    const user = game.users.get(msg.userId);          // ← the defect
    if (!owner || !user) return;
    if (!owner.testUserPermission(user, "OWNER")) return;
    const payloads = Array.isArray(msg.payloads) ? msg.payloads.slice(0, 8) : [];
    const clean = payloads.map((p) => ({
      type: "npc", name: String(p?.name ?? "").slice(0, 120),
      system: { connectedTo: owner.uuid, slots: Number(p?.system?.slots) || 0, generationEnabled: false },
    })).filter((p) => p.name);
    if (clean.length) await getDocumentClass("Actor").createDocuments(clean);
  };
  game.socket.on(`system.${game.system.id}`, globalThis.__probeOldHandler);
});

await alicePage.evaluate(async ({ gmId, foreignUuid, itemUuid }) => {
  game.socket.emit(`system.${game.system.id}`, {
    action: "grantActors", ownerUuid: foreignUuid, userId: gmId,
    payloads: [{ name: "ZZ PROBE SG Forged", system: { slots: 4 } }],
  });
  game.socket.emit(`system.${game.system.id}`, {
    action: "grantActors", ownerUuid: itemUuid, userId: gmId,
    payloads: [{ name: "ZZ PROBE SG ItemTarget", system: { slots: 4 } }],
  });
}, { gmId: scene.gmId, foreignUuid: scene.foreignUuid, itemUuid: scene.itemUuid });

await gmPage.waitForTimeout(3000);
const control = await gmPage.evaluate(async () => {
  game.socket.off(`system.${game.system.id}`, globalThis.__probeOldHandler);
  delete globalThis.__probeOldHandler;
  return {
    forged: !!game.actors.getName("ZZ PROBE SG Forged"),
    itemTarget: !!game.actors.getName("ZZ PROBE SG ItemTarget"),
  };
});
control.forged
  ? ok("NEGATIVE CONTROL: the old handler honours the forged id", "(attack 1 is well-formed)")
  : fail("negative control MISSED — attack 1 proves nothing", "old handler did not mint");
control.itemTarget
  ? ok("NEGATIVE CONTROL: the old handler accepts the Item uuid", "(attack 2 is well-formed)")
  : fail("negative control MISSED — attack 2 proves nothing", "old handler did not mint");

/* ---- cleanup ------------------------------------------------------------- */

await gmPage.evaluate(async (pcUuid) => {
  for (const a of game.actors.filter((x) =>
    x.name.startsWith("ZZ PROBE SG") || (x.name === "Rivertooth" && x.system?.connectedTo === pcUuid))) {
    await a.delete();
  }
}, scene.pcUuid);

const consoleErrors = [...gmErrors, ...aliceErrors];
if (consoleErrors.length) {
  console.error("\nconsole errors:");
  consoleErrors.slice(0, 15).forEach((e) => console.error("  " + e));
  failures++;
}
await browser.close();

console.log(failures ? "\nSOCKET GRANT PROBE FAILED\n" : "\nsocket grant probe passed\n");
process.exit(failures ? 1 : 0);

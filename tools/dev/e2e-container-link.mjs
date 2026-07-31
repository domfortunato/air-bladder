/**
 * Container-link permission e2e — review finding 13.
 *
 * Attaching a container is TWO writes: the keeper lists the container's uuid, and
 * the container's `keeper` points back. `createOwnedContainer` did them in order
 * with no permission check and no catch, so a player dropping a Warden-owned
 * container onto their own sheet got the first (they own their character) and a
 * refusal on the second — leaving the character listing a container with an empty
 * `keeper`: unopenable, and still claimable by anyone else.
 *
 * MUST run as a real PLAYER. A GM passes every ownership check, so a GM session
 * cannot reproduce this no matter what it drops.
 *
 * Also asserts the legitimate path still works: with ACTOR_CREATE granted, a
 * player buying a transport gets a fully linked container. That is the case a
 * careless permission guard would break, because `acquireTransport` copies
 * ownership onto the container only AFTER calling createOwnedContainer.
 *
 * Usage: npm run dev:container-link   (needs Alice — npm run dev:players)
 */

import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, joinAs, watchErrors } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(32)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(32)} ${detail}`); failures++; };
let failures = 0;

const browser = await chromium.launch();

// Separate contexts: Foundry's session cookie is per origin, so two pages in one
// context would be the same user.
const gmPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
const gmErrors = watchErrors(gmPage);
await joinAsGM(gmPage);
await dismissChrome(gmPage);

/* ---- GM sets the scene ---------------------- */

const scene = await gmPage.evaluate(async () => {
  const alice = game.users.getName("Alice");
  if (!alice) return { error: "no Alice — run npm run dev:players" };

  const gen = game.cairn.characterGenerator;
  const pc = await gen.createActorWithCharacter(await gen.generate2eCharacter());
  await pc.update({ name: "ZZ Alice PC", ownership: { default: 0, [alice.id]: 3 } });

  // A container only the Warden owns — the thing a player must not be able to claim.
  const mule = await Actor.create({ name: "ZZ Warden Mule", type: "container", system: { slots: 6 } });

  return { pcId: pc.id, pcUuid: pc.uuid, muleId: mule.id, muleUuid: mule.uuid };
});

if (scene.error) {
  console.log(`  FAIL  setup: ${scene.error}`);
  await browser.close();
  process.exit(1);
}

/* ---- Alice tries to claim the Warden's mule -- */

console.log("\nplayer drops a Warden-owned container");

const alicePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
const aliceErrors = watchErrors(alicePage);
await joinAs(alicePage, "Alice");

const claim = await alicePage.evaluate(async ({ pcId, muleUuid }) => {
  const pc = game.actors.get(pcId);
  const notices = [];
  const origWarn = ui.notifications.warn.bind(ui.notifications);
  ui.notifications.warn = (m, ...a) => { notices.push(String(m)); return origWarn(m, ...a); };
  try {
    await pc.sheet.render(true);
    await new Promise((r) => setTimeout(r, 1200));
    // Drive the WHOLE drop path, not one handler: a real DragEvent carrying the
    // drag payload, through `_onDrop`. This used to call `_onDropActor` with drop
    // DATA, which was ApplicationV1's signature — ApplicationV2 resolves the uuid
    // first and hands the handler a Document, so the old call silently fell out at
    // the type check and reported a "silent failure" that was the probe's own.
    // Going in via `_onDrop` means the resolution step is exercised too and the
    // probe stops caring which internal signature is current.
    //
    // Caught, not awaited bare: the PRE-FIX code rejects here ("User Alice lacks
    // permission to update Actor"), and an uncaught rejection would abort the run
    // instead of reporting which assertions failed. A throw is itself a finding —
    // a drop handler should not leave an unhandled rejection in a player's console.
    let threw = null;
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: muleUuid }));
      await pc.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt }));
    } catch (err) {
      threw = String(err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, 600));
    return {
      isOwnerOfMule: (await fromUuid(muleUuid))?.isOwner ?? null,
      containers: [...(pc.system.containers ?? [])],
      notices,
      threw,
    };
  } finally {
    ui.notifications.warn = origWarn;
  }
}, scene);

claim.isOwnerOfMule === false
  ? ok("Alice does not own the mule", "premise holds")
  : fail("Alice does not own the mule", `isOwner=${claim.isOwnerOfMule} — test proves nothing`);

!claim.containers.includes(scene.muleUuid)
  ? ok("no half-applied link", "character lists nothing")
  : fail("no half-applied link", "the character now lists a container it cannot open");

claim.notices.length
  ? ok("player is told why", `"${claim.notices[claim.notices.length - 1]}"`)
  : fail("player is told why", "silent failure");

!claim.threw
  ? ok("drop handler did not throw", "")
  : fail("drop handler did not throw", claim.threw);

// And the container is untouched, checked from the GM side (authoritative).
const muleState = await gmPage.evaluate((muleId) => ({
  keeper: game.actors.get(muleId)?.system.keeper ?? null,
}), scene.muleId);

muleState.keeper === ""
  ? ok("container keeper still empty", "still claimable by its owner")
  : fail("container keeper still empty", `keeper is "${muleState.keeper}"`);

/* ---- the legitimate path still works --------- */

console.log("\nplayer buys a transport (ACTOR_CREATE granted)");

await gmPage.evaluate(async () => {
  const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
  perms.ACTOR_CREATE = [...new Set([...(perms.ACTOR_CREATE ?? []), CONST.USER_ROLES.PLAYER])];
  await game.settings.set("core", "permissions", perms);
});
await alicePage.reload({ waitUntil: "networkidle" });
await alicePage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
await dismissChrome(alicePage);

const buy = await alicePage.evaluate(async (pcId) => {
  const pc = game.actors.get(pcId);
  await pc.update({ "system.gold": 500 });
  const mkt = await import("/systems/air-bladder/module/marketplace.js");
  const cat = await mkt.getMarketplaceCatalog();
  const transports = cat.categories.find((c) => c.name === "Transports & Containers")?.items ?? [];
  const doc = transports.find((d) => (d.system.cost ?? 0) <= 500);
  if (!doc) return { error: "no affordable transport in the catalogue" };
  const okBuy = await mkt.acquireTransport(pc, doc, true);
  await new Promise((r) => setTimeout(r, 600));
  // Read the DERIVED list, not the legacy array. A purchase connects the new
  // actor with a single `connectedTo` write; the owner's `system.containers` is
  // no longer written at all, so looking there reports a successful buy as a
  // failed link.
  pc.prepareData();
  const container = (pc.system.containerObjects ?? []).at(-1) ?? null;
  return {
    okBuy,
    name: doc.name,
    listed: !!container,
    keeper: container?.system.connectedTo ?? null,
    pcUuid: pc.uuid,
    containerId: container?.id ?? null,
    // Foundry makes the creating user an owner, which is why the GM-only
    // ownership copy is not needed for a player's own purchase.
    ownsIt: container?.isOwner ?? null,
    goldAfter: pc.system.gold,
    cost: doc.system.cost ?? 0,
  };
}, scene.pcId);

if (buy.error) fail("transport purchase", buy.error);
else {
  buy.okBuy && buy.listed
    ? ok("purchase succeeded", buy.name)
    : fail("purchase succeeded", `acquireTransport returned ${buy.okBuy}, listed=${buy.listed}`);
  buy.keeper === buy.pcUuid
    ? ok("link complete both ways", "keeper points back at the character")
    : fail("link complete both ways", `keeper="${buy.keeper}" expected "${buy.pcUuid}"`);
  buy.ownsIt
    ? ok("buyer owns the transport", "creating user is an owner")
    : fail("buyer owns the transport", "the player cannot open what they bought");
  buy.goldAfter === 500 - buy.cost
    ? ok("gold was actually deducted", `500 -> ${buy.goldAfter} (cost ${buy.cost})`)
    : fail("gold was actually deducted", `gold is ${buy.goldAfter}, expected ${500 - buy.cost}`);
}

/* ---- the Connected tab, derived from `connectedTo` ---- */

/* The list the tab renders is DERIVED from each connected actor's own
   `connectedTo` (CairnActor#connectedActors), not from the owner's
   `system.containers` array. That is the point: one place stores the fact, so it
   cannot disagree with itself, a deleted actor simply stops appearing, and there
   is no second write to lose. This asserts the new path works with the legacy
   array left EMPTY -- otherwise the union would be carrying it and the old
   two-way link would still be doing all the work unnoticed. */
console.log("\nconnected actors (derived, no legacy array)");
const connected = await gmPage.evaluate(async () => {
  const Cls = CONFIG.Actor.documentClass;
  const owner = await Cls.create({ name: "ZZ Connected Owner", type: "character" });
  const horse = await Cls.create({
    name: "ZZ Connected Horse", type: "npc",
    system: { connectedTo: owner.uuid, slots: 4 },
  });
  const stranger = await Cls.create({ name: "ZZ Unconnected", type: "npc" });
  owner.prepareData();
  const listed = (owner.system.containerObjects ?? []).map((a) => a.name);
  const arrayLen = (owner.system.containers ?? []).length;

  // Disconnecting must remove it with no second write anywhere.
  await horse.update({ "system.connectedTo": "" });
  owner.prepareData();
  const afterUnlink = (owner.system.containerObjects ?? []).map((a) => a.name);

  // And a DELETED actor must simply stop appearing -- the case that used to
  // leave a dangling uuid rendering as a blank row.
  await horse.update({ "system.connectedTo": owner.uuid });
  owner.prepareData();
  const beforeDelete = (owner.system.containerObjects ?? []).length;
  await horse.delete();
  owner.prepareData();
  const afterDelete = (owner.system.containerObjects ?? []).length;

  const ids = [owner.id, stranger.id];
  for (const id of ids) await game.actors.get(id)?.delete().catch(() => {});
  return { listed, arrayLen, afterUnlink, beforeDelete, afterDelete };
});

connected.listed.length === 1 && connected.listed[0] === "ZZ Connected Horse"
  ? ok("connectedTo alone puts it on the tab", `[${connected.listed.join(", ")}]`)
  : fail("connectedTo alone puts it on the tab", JSON.stringify(connected.listed));
connected.arrayLen === 0
  ? ok("with the legacy array empty", "so the union is not doing the work")
  : fail("with the legacy array empty", `system.containers has ${connected.arrayLen}`);
connected.afterUnlink.length === 0
  ? ok("clearing connectedTo removes it", "one write, no bookkeeping")
  : fail("clearing connectedTo removes it", JSON.stringify(connected.afterUnlink));
connected.beforeDelete === 1 && connected.afterDelete === 0
  ? ok("a deleted actor stops appearing", "no dangling uuid, no blank row")
  : fail("a deleted actor stops appearing", `${connected.beforeDelete} -> ${connected.afterDelete}`);

/* ---- cleanup -------------------------------- */

await gmPage.evaluate(async ({ pcId, muleId, containerId }) => {
  const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
  perms.ACTOR_CREATE = (perms.ACTOR_CREATE ?? []).filter((r) => r !== CONST.USER_ROLES.PLAYER);
  await game.settings.set("core", "permissions", perms);
  for (const id of [pcId, muleId, containerId]) {
    if (id) await game.actors.get(id)?.delete().catch(() => {});
  }
}, { ...scene, containerId: buy.containerId });

const errors = [...gmErrors, ...aliceErrors];
console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
if (errors.length) failures++;

await browser.close();
console.log(failures ? `\nFAILED (${failures})` : "\nPASSED");
process.exit(failures ? 1 : 0);

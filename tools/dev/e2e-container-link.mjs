/**
 * Container-link permission e2e — review finding 13.
 *
 * Attaching a container USED to be two writes: the keeper listed the container's
 * uuid and the container's `keeper` pointed back. `createOwnedContainer` did them
 * in order with no permission check and no catch, so a player dropping a
 * Warden-owned container onto their own sheet got the first (they own their
 * character) and a refusal on the second — leaving the character listing a
 * container with an empty `keeper`: unopenable, and still claimable by anyone
 * else. The link is ONE write on the child now, and the `container` type that
 * carried the other half is retired (2026-07-31), so the half-applied state is
 * structurally unreachable. The refusal itself still has to hold, and this still
 * asserts it — against an npc mule, which is what a Warden's mule is now.
 *
 * MUST run as a real PLAYER. A GM passes every ownership check AND every Warden
 * gate, so a GM session cannot reproduce this no matter what it drops.
 *
 * Also asserts the legitimate path still works: with ACTOR_CREATE granted, a
 * player buying a transport gets a fully linked container. That is the case a
 * careless permission guard would break, because `acquireTransport` copies
 * ownership onto the container only AFTER creating it.
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

  // A container only the Warden owns — the thing a player must not be able to
  // claim. An npc with role container, which is what a container IS now; a
  // `container`-typed document cannot be created at all any more.
  const mule = await Actor.create({
    name: "ZZ Warden Mule", type: "npc",
    system: { slots: 6, role: "container", containerClass: "mule" },
  });

  // A connected child she does NOT own, already on the tab before she buys
  // anything. This is not a hypothetical: generation GRANTS one — a rolled
  // Outrider background mints its named horse (Linden White, Destrier…) as a
  // connected npc, and the keeper's ownership is applied on the connect
  // TRANSITION, which has already happened by the time the GM hands the PC to
  // Alice above. So a real player's tab routinely holds a row she cannot
  // break, above the one she can.
  //
  // Planted rather than left to the dice, because the roll decided whether this
  // probe was testing anything: the edge-control assertions below used to take
  // the FIRST connected row, so they passed on most backgrounds and failed on
  // Outriders, reporting a missing control that was correctly absent from a row
  // the test was never about.
  const decoy = await Actor.create({
    name: "ZZ Warden Grant", type: "npc",
    system: { connectedTo: pc.uuid, slots: 2, role: "container", containerClass: "sack" },
    ownership: { default: 2 },
  });

  return {
    pcId: pc.id, pcUuid: pc.uuid, muleId: mule.id, muleUuid: mule.uuid,
    decoyId: decoy.id, decoyName: decoy.name,
  };
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
    pc.prepareData();
    return {
      isOwnerOfMule: (await fromUuid(muleUuid))?.isOwner ?? null,
      // The DERIVED list — there is no owner-side array to inspect any more.
      connected: (pc.system.containerObjects ?? []).map((a) => a.uuid),
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

!claim.connected.includes(scene.muleUuid)
  ? ok("no link was made", "character lists nothing")
  : fail("no link was made", "the character now lists a container it cannot open");

claim.notices.length
  ? ok("player is told why", `"${claim.notices[claim.notices.length - 1]}"`)
  : fail("player is told why", "silent failure");

!claim.threw
  ? ok("drop handler did not throw", "")
  : fail("drop handler did not throw", claim.threw);

// And the container is untouched, checked from the GM side (authoritative).
const muleState = await gmPage.evaluate((muleId) => ({
  connectedTo: game.actors.get(muleId)?.system.connectedTo ?? null,
}), scene.muleId);

muleState.connectedTo === ""
  ? ok("mule is still unconnected", "still claimable by its owner")
  : fail("mule is still unconnected", `connectedTo is "${muleState.connectedTo}"`);

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
  // Read the DERIVED list. A purchase connects the new actor with a single
  // `connectedTo` write and nothing is written to the owner at all, so the
  // tab's contents are computed, never stored.
  pc.prepareData();
  const container = (pc.system.containerObjects ?? []).at(-1) ?? null;
  // A PLAYER's purchase cannot write ownership (server wall), so it rides the
  // sync flag: the live GM client answers with the CONNECTED shape. Poll for
  // the settled state — default OBSERVER, Alice OWNER, flag gone — not the
  // first observable.
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  let shapeSettled = false;
  for (let i = 0; i < 40 && container && !shapeSettled; i++) {
    await new Promise((r) => setTimeout(r, 250));
    shapeSettled = container.ownership.default === L.OBSERVER
      && container.ownership[game.user.id] === L.OWNER
      && container.getFlag("air-bladder", "ownershipSyncPending") === undefined;
  }
  return {
    okBuy,
    name: doc.name,
    listed: !!container,
    keeper: container?.system.connectedTo ?? null,
    pcUuid: pc.uuid,
    containerId: container?.id ?? null,
    // Foundry makes the creating user an owner, which is what carries her
    // through the window before the GM's shape lands.
    ownsIt: container?.isOwner ?? null,
    shapeSettled,
    shape: container ? { ...container.ownership } : null,
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
  buy.shapeSettled
    ? ok("post-buy ownership is the CONNECTED shape", "default OBSERVER + buyer OWNER, via the GM relay")
    : fail("post-buy ownership is the CONNECTED shape", JSON.stringify(buy.shape));
  buy.goldAfter === 500 - buy.cost
    ? ok("gold was actually deducted", `500 -> ${buy.goldAfter} (cost ${buy.cost})`)
    : fail("gold was actually deducted", `gold is ${buy.goldAfter}, expected ${500 - buy.cost}`);
}

/* ---- the trash stays the Warden's; unlink is the owner's again ---- */

/* Actor deletion is role-gated (Assistant+) with NO player-grantable
   permission, so a player's trash on the Connected tab promised an action the
   server always refuses (review #5) — that half stands. UNLINK inverted on
   2026-08-01 with the one player-usable verb: Alice owns both ends of her
   purchased row (the connected shape made her OWNER of the mule), so her row
   offers unlink again — Round 2's Warden-only reading lasted exactly one day
   past the ownership automation that made it unnecessary.

   Same template, two users: the GM's trash is what keeps Alice's missing
   trash load-bearing rather than a row that renders no icons for everybody. */
console.log("\nthe Connected tab's edge controls");
const icons = await alicePage.evaluate(async ({ pcId, containerId }) => {
  const pc = game.actors.get(pcId);
  // CLOSE first, then render, then POLL — do not sleep a fixed interval on an
  // already-open sheet. Alice's sheet was opened earlier in this probe, BEFORE
  // the relay made her an owner of the mule, so its DOM holds a row with no
  // unlink; `render(true)` is asynchronous, and under load (this probe runs
  // after others in the sweep) a flat 1s wait read that stale row and reported
  // a missing control that the next, unloaded run rendered fine. That is the
  // race docs/release-testing.md refuses to let anyone re-run away.
  await pc.sheet.close();
  await new Promise((r) => setTimeout(r, 300));
  await pc.sheet.render(true);
  // The row SHE BOUGHT, by uuid — not the first connected row on the sheet.
  // This PC is randomly generated, and a rolled Outrider background GRANTS a
  // named horse (Linden White, Destrier…) as a connected NPC. So the tab can
  // hold two children, the grant sorts first, and Alice does not own the grant
  // — the keeper's ownership is applied on the connect TRANSITION and the GM
  // here makes her an owner of the PC only after generation has run. The
  // assertion then read a row it was never about and reported a missing
  // control that is correctly absent. Worse, it depended on the rolled
  // background, so it passed most runs and failed on Outriders.
  const sel = `.cairn-items-list-row[data-item-id="Actor.${containerId}"]`;
  let row = null;
  for (let i = 0; i < 40 && !row; i++) {
    await new Promise((r) => setTimeout(r, 250));
    row = pc.sheet.rendered ? pc.sheet.element?.querySelector(sel) : null;
  }
  // The INPUTS to canUnlink, not just its rendered effect: "her row offers no
  // break" names a symptom and no cause, and this assertion has two ends that
  // can independently be wrong (her ownership of the PC, and of the row's
  // actor) plus a relay that may not have settled.
  const kids = pc.connectedActors();
  const why = {
    lookedFor: sel,
    pcIsOwner: pc.isOwner,
    kids: kids.map((c) => ({ name: c.name, isOwner: c.isOwner, own: { ...c.ownership } })),
  };
  return row ? {
    rowFound: true,
    unlink: !!row.querySelector('[data-action="containerUnlink"]'),
    trash: !!row.querySelector('[data-action="itemDelete"]'),
    why,
  } : { rowFound: false, why };
}, { pcId: scene.pcId, containerId: buy.containerId });
const gmIcons = await gmPage.evaluate(async ({ pcId, containerId }) => {
  const pc = game.actors.get(pcId);
  await pc.sheet.render(true);
  await new Promise((r) => setTimeout(r, 1000));
  // Same row as Alice's, for the same reason — the two verdicts are only
  // comparable if they are about the same document.
  const row = pc.sheet.element?.querySelector(`.cairn-items-list-row[data-item-id="Actor.${containerId}"]`);
  const trash = !!row?.querySelector('[data-action="itemDelete"]');
  const unlink = !!row?.querySelector('[data-action="containerUnlink"]');
  await pc.sheet.close();
  return { rowFound: !!row, trash, unlink };
}, { pcId: scene.pcId, containerId: buy.containerId });

if (!icons.rowFound || !gmIcons.rowFound) {
  fail("connected row rendered for both users", JSON.stringify({ alice: icons.rowFound, gm: gmIcons.rowFound }));
} else {
  !icons.trash
    ? ok("no trash for a player", "the server would refuse it anyway")
    : fail("no trash for a player", "an affordance for an action players cannot take");
  icons.unlink
    ? ok("unlink renders for the owner of both ends", "one verb, player-usable (2026-08-01)")
    : fail("unlink renders for the owner of both ends",
      `her own purchased row offers no break — ${JSON.stringify(icons.why)}`);
  gmIcons.trash && gmIcons.unlink
    ? ok("the Warden gets both", "and the GM trash keeps the player's missing one load-bearing")
    : fail("the Warden gets both",
      `trash=${gmIcons.trash} unlink=${gmIcons.unlink} — if these vanished for everyone, the player assertions prove nothing`);
}

// Give ACTOR_CREATE back the moment the last leg needing it is done, not in
// the tail cleanup: a run that dies between here and the end used to leave
// PLAYER in core.permissions.ACTOR_CREATE, which made dev:socket-grant refuse
// to run at all ("this world grants players ACTOR_CREATE") — found as litter
// on 2026-08-01. The remaining legs run as the GM and need no grant.
// This await can die with Playwright's "Execution context was destroyed", and
// the tempting explanation is wrong: **`core.permissions` does NOT reload
// clients.** It is `config: false` with an `onChange` that only re-renders the
// controls, the sidebar and the canvas cursors — no `requiresReload` anywhere
// (`client/game.mjs:1152-1164`, checked against the shipped 14.365). A comment
// here said otherwise for one commit on 2026-08-07; the theory sounded right and
// this repo has already paid once for a confident comment sitting above code
// that contradicts it.
//
// The real cause is LOAD. A long serial batch degrades the server enough that a
// join is still settling when this runs (0.1.11: `Vended World data` 5,059 ms an
// hour into a batch versus 418 ms quiet), and the page loses its context to the
// harness, not to Foundry. Nothing here is a system defect, which is why the
// answer is tolerance rather than a fix to the write.
//
// Dying here would take the cleanup below with it, stranding the PC, the mule,
// the purchased container and the planted grant — and, expensively, leaving
// PLAYER holding ACTOR_CREATE, the exact litter this block exists to prevent and
// which has previously stopped dev:socket-grant running at all.
await gmPage.evaluate(() => {
  const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
  perms.ACTOR_CREATE = (perms.ACTOR_CREATE ?? []).filter((r) => r !== CONST.USER_ROLES.PLAYER);
  game.settings.set("core", "permissions", perms);
}).catch((e) => {
  if (!/Execution context was destroyed|Target closed|frame was detached/i.test(e.message)) throw e;
});
await gmPage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 })
  .catch(() => { throw new Error("the GM client did not come back after the permissions write"); });

/* ---- the Connected tab, derived from `connectedTo` ---- */

/* The list the tab renders is DERIVED from each connected actor's own
   `connectedTo` (CairnActor#connectedActors), never from an owner-side array.
   That is the point: one place stores the fact, so it cannot disagree with
   itself, a deleted actor simply stops appearing, and there is no second write
   to lose.

   This used to assert the derived path worked with the legacy `system.containers`
   array left EMPTY, because while the union existed an empty array was the only
   way to prove the union was not quietly doing the work. The array is gone with
   the `container` type, so the assertion becomes the stronger one: the FIELD
   does not exist. That fails if anyone re-adds it, where "is empty" would not. */
console.log("\nconnected actors (derived, no owner-side array)");
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
  // The SOURCE, not the prepared object: prepareData is free to hang anything
  // it likes on `system`, so only `_source` answers "is this in the schema".
  const legacyField = "containers" in (owner._source.system ?? {});

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
  return { listed, legacyField, afterUnlink, beforeDelete, afterDelete };
});

connected.listed.length === 1 && connected.listed[0] === "ZZ Connected Horse"
  ? ok("connectedTo alone puts it on the tab", `[${connected.listed.join(", ")}]`)
  : fail("connectedTo alone puts it on the tab", JSON.stringify(connected.listed));
connected.legacyField === false
  ? ok("no owner-side array exists", "system.containers is not in the schema")
  : fail("no owner-side array exists", "system.containers is back — the union can carry links again");
connected.afterUnlink.length === 0
  ? ok("clearing connectedTo removes it", "one write, no bookkeeping")
  : fail("clearing connectedTo removes it", JSON.stringify(connected.afterUnlink));
connected.beforeDelete === 1 && connected.afterDelete === 0
  ? ok("a deleted actor stops appearing", "no dangling uuid, no blank row")
  : fail("a deleted actor stops appearing", `${connected.beforeDelete} -> ${connected.afterDelete}`);

/* ---- cleanup -------------------------------- */

await gmPage.evaluate(async ({ pcId, muleId, containerId, decoyId }) => {
  // Belt over the mid-run restore above — filtering an already-clean list is
  // a no-op, and a future leg added between the two cannot re-leak the grant.
  const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
  perms.ACTOR_CREATE = (perms.ACTOR_CREATE ?? []).filter((r) => r !== CONST.USER_ROLES.PLAYER);
  await game.settings.set("core", "permissions", perms);
  // The PC's connected children FIRST, while the uuid that identifies them
  // still resolves. Generation grants some of them (an Outrider's named horse),
  // and deleting only the PC left those behind on every Outrider roll — an
  // actor whose keeper no longer exists, accumulating one per run in the dev
  // world and eventually turning up as somebody else's failing precondition.
  const pc = game.actors.get(pcId);
  if (pc) for (const kid of pc.connectedActors()) await kid.delete().catch(() => {});
  for (const id of [pcId, muleId, containerId, decoyId]) {
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

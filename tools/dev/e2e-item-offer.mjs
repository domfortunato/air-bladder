#!/usr/bin/env node
/**
 * Player-to-player item offers ("Give an item"), end to end.
 *
 *   node tools/dev/e2e-item-offer.mjs   (needs Foundry on :30000, world launched,
 *                                        Alice + Bob seeded — npm run dev:players)
 *
 * The feature (user ask 2026-09-06): a player OFFERS one item (one unit) from
 * their character to another player's character; the target's owner ACCEPTS or
 * DECLINES off a public chat card. Acceptance may push the recipient past the
 * slot limit — it is created anyway (the ignoreCapacity door) and simply
 * over-burdens them, behind a confirm that names the cost. Transport is pure
 * player-to-player over the system socket: the giver's client deletes its
 * half, the acceptor's creates its half; state lives in a message flag only
 * the AUTHOR (the giver) or a GM can write, which is what serializes racing
 * answers. If the giver is offline at accept time, the accept refuses and the
 * offer stays open.
 *
 * Three clients: GM (fixtures, bystander's ear, GM-path legs), Alice (giver),
 * Bob (acceptor). Every refusal leg asserts BOTH unchanged state AND specific
 * refusal evidence, so no wall can pass vacuously.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

watchdog(600000, "item-offer e2e");
const browser = await chromium.launch();
const gmCtx = await browser.newContext({ viewport: VIEWPORT });
let alCtx = await browser.newContext({ viewport: VIEWPORT });
const bobCtx = await browser.newContext({ viewport: VIEWPORT });
const gm = await gmCtx.newPage();
let alice = await alCtx.newPage();
const bob = await bobCtx.newPage();
const gmErrors = watchErrors(gm);
let alErrors = watchErrors(alice);
const bobErrors = watchErrors(bob);
let failures = 0;
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? ` ${d}` : ""}`); failures++; };
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? ` ${d}` : ""}`);
const check = (l, cond, d = "") => (cond ? ok(l, d) : fail(l, d));

const notifTexts = (page) => page.evaluate(() =>
  [...document.querySelectorAll("#notifications .notification")].map((n) => n.textContent.trim()));
const awaitNotif = async (page, re, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = (await notifTexts(page)).find((t) => re.test(t));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};
/** Poll an in-page condition until truthy or timeout; returns its last value. */
const poll = async (page, fn, arg, ms = 15000) => {
  const t0 = Date.now();
  let v = null;
  while (Date.now() - t0 < ms) {
    v = await page.evaluate(fn, arg);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return v;
};

/** The offer card's visible buttons on THIS client, for the given message id. */
const cardButtons = (page, msgId) => page.evaluate((msgId) => {
  const row = document.querySelector(`.chat-message[data-message-id="${msgId}"]`);
  if (!row) return null;
  return {
    accept: !!row.querySelector(".cairn-offer-accept"),
    decline: !!row.querySelector(".cairn-offer-decline"),
    cancel: !!row.querySelector(".cairn-offer-cancel"),
  };
}, msgId);
/** Click a card button on this client (scrolled into the log or not, the node exists). */
const clickCard = (page, msgId, cls) => page.evaluate(({ msgId, cls }) => {
  const btn = document.querySelector(`.chat-message[data-message-id="${msgId}"] .${cls}`);
  if (!btn) return false;
  btn.click();
  return true;
}, { msgId, cls });

/** Drive the give control + picker on Alice's client for one of the giver's items. */
const offerViaPicker = async (page, itemName, targetName) => page.evaluate(async ({ itemName, targetName }) => {
  const giver = game.actors.getName("ZZ Offer Giver");
  const item = giver?.items.find((i) => i.name === itemName);
  if (!item) return "no item";
  await giver.sheet.render(true);
  await new Promise((r) => setTimeout(r, 500));
  const root = giver.sheet.element;
  const row = root?.querySelector(`.cairn-items-list-row[data-item-id="${item.id}"]`);
  const btn = row?.querySelector('a[data-action="itemGive"]');
  if (!btn) return "no give control";
  btn.click();
  // The picker dialog: radio rows named offerTarget, value = actor uuid.
  let dlg = null;
  for (let i = 0; i < 40 && !dlg; i++) {
    dlg = document.querySelector(".cairn-offer-picker");
    if (!dlg) await new Promise((r) => setTimeout(r, 150));
  }
  if (!dlg) return "no picker";
  const target = game.actors.getName(targetName);
  const radio = dlg.querySelector(`input[name="offerTarget"][value="${target?.uuid}"]`);
  if (!radio) {
    // Close the picker on a miss, or the stale dialog is what every later
    // call finds first — one miss then cascades through the whole suite.
    dlg.closest(".application")?.querySelector('button[data-action="cancel"]')?.click();
    return "target not listed";
  }
  radio.click();
  const confirm = dlg.closest(".application")?.querySelector('button[data-action="offer"]');
  if (!confirm) return "no offer button";
  confirm.click();
  return "clicked";
}, { itemName, targetName });

try {
  await joinAsGM(gm);
  const madeBob = await gm.evaluate(async () => {
    if (game.users.getName("Bob")) return false;
    await User.create({ name: "Bob", role: CONST.USER_ROLES.PLAYER });
    return true;
  });
  if (madeBob) console.log("  note  created player Bob (create-players' default pair)");
  await joinAs(alice, "Alice");
  await joinAs(bob, "Bob");

  const before = await gm.evaluate(() => ({
    actors: game.actors.map((a) => a.id),
    messages: game.messages.map((m) => m.id),
  }));

  // The bystander's ear: every offer-protocol emit that reaches the GM client
  // is recorded. offerAccept/Release/Done are recipients-addressed between
  // Alice and Bob, so the GM must hear NONE of them in the player legs.
  await gm.evaluate(() => {
    window.__offerSeen = [];
    game.socket.on(`system.${game.system.id}`, (m) => {
      if (typeof m?.action === "string" && m.action.startsWith("offer")) window.__offerSeen.push(m.action);
    });
  });
  // Bob records the answers his client is sent (refused reasons).
  await bob.evaluate(() => {
    window.__offerAnswers = [];
    game.socket.on(`system.${game.system.id}`, (m) => {
      if (m?.action === "offerRefused") window.__offerAnswers.push(m.reason ?? "?");
    });
  });

  /* ---- fixtures (GM) ----------------------------------------------------- */
  const fix = await gm.evaluate(async () => {
    const aliceU = game.users.getName("Alice");
    const bobU = game.users.getName("Bob");
    const Cls = Actor.implementation;
    const giver = await Cls.create({
      name: "ZZ Offer Giver", type: "character",
      ownership: { default: 0, [aliceU.id]: 3 },
    });
    await giver.createEmbeddedDocuments("Item", [
      { name: "ZZ Brass Lantern", type: "item", system: { uses: { value: 2, max: 4 } } },
      // grantSource planted so the strip-on-transfer assertion has something to strip.
      { name: "ZZ Trail Rations", type: "item", system: { quantity: 3 },
        flags: { "air-bladder": { grantSource: "background" } } },
      { name: "ZZ Anvil", type: "item", system: { bulky: true } },
      { name: "Fatigue", type: "item" },
      { name: "ZZ Grimoire", type: "item", system: { grimoire: true } },
      { name: "ZZ Bound Page", type: "spellbook", system: { bound: true } },
    ]);
    // Default LIMITED, Bob OWNER: the picker lists only actors the giver can
    // SEE (the same rule as the actor directory), so a teammate's character
    // must be at least LIMITED for Alice to offer to it at all — the world
    // shape the feature is for. Bob's OWNER entry is what gates the answer.
    const target = await Cls.create({
      name: "ZZ Offer Target", type: "character",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED, [bobU.id]: 3 },
    });
    // LIMITED, not NONE: the picker lists only actors the giver can SEE
    // (core `visible` = LIMITED+, review #23 finding 6), and this one must
    // stay listable by Alice so the hostile-accept leg has a target she can
    // offer to and Bob cannot answer for.
    const bystander = await Cls.create({ name: "ZZ Offer Bystander", type: "character",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED } });
    // Ownership NONE — the doppelganger the Warden is hiding. Its NAME must
    // not leak into a player's picker.
    const doppel = await Cls.create({ name: "ZZ Offer Doppelganger", type: "character",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } });
    const npc = await Cls.create({ name: "ZZ Offer NPC", type: "npc" });
    await npc.createEmbeddedDocuments("Item", [{ name: "ZZ NPC Thing", type: "item" }]);
    return { giverId: giver.id, targetId: target.id, bystanderId: bystander.id, npcId: npc.id,
      targetUuid: target.uuid, bystanderUuid: bystander.uuid, doppelUuid: doppel.uuid };
  });

  /* ---- A. the give control appears exactly where it should --------------- */
  console.log("\nthe give control");
  const controls = await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    if (!giver) return { rows: -1, per: {}, err: "the giver has not reached this client" };

    // ESTABLISH THE PRECONDITION, then render. The fixtures are created on the
    // GM's client and reach this one over the socket, so the six items can
    // arrive AFTER the actor does. Rendering first and polling afterwards does
    // not help: the sheet settles with zero rows and nothing re-renders it, so
    // the poll watches a finished, empty window until it gives up. Intermittent
    // by nature — which makes it a race, not a flake.
    for (let i = 0; i < 100 && giver.items.size < 6; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await giver.sheet.render(true);
    // Now poll for the rows, re-rendering if the first pass raced anyway. A
    // fixed sleep here also made both legs below meaningless: an unrendered
    // sheet yields false for EVERY item, so "absent on Fatigue" was green
    // precisely when nothing worked at all.
    let root = null;
    for (let i = 0; i < 60; i++) {
      root = giver.sheet.element;
      if (root?.querySelectorAll(".cairn-items-list-row").length === giver.items.size) break;
      await new Promise((r) => setTimeout(r, 100));
      if (i === 20) await giver.sheet.render(true);
    }
    const per = {};
    for (const i of giver.items) {
      const row = root?.querySelector(`.cairn-items-list-row[data-item-id="${i.id}"]`);
      per[i.name] = !!row?.querySelector('a[data-action="itemGive"]');
    }
    return { rows: root?.querySelectorAll(".cairn-items-list-row").length ?? -1, per };
  });
  // The precondition, asserted rather than assumed: without this the two legs
  // below can both be satisfied by a sheet that never rendered.
  check("the giver's sheet renders every row for its owner",
    controls.rows === 6, JSON.stringify(controls));
  check("present on ordinary items",
    controls.per["ZZ Brass Lantern"] && controls.per["ZZ Trail Rations"] && controls.per["ZZ Anvil"],
    JSON.stringify(controls.per));
  check("absent on Fatigue, the Grimoire and a bound page",
    controls.per["Fatigue"] === false && controls.per["ZZ Grimoire"] === false
      && controls.per["ZZ Bound Page"] === false,
    JSON.stringify(controls.per));

  /* ---- B. an npc sheet the viewer does NOT own ---------------------------- */
  // THIS LEG INVERTED on 2026-09-10 and was rewritten rather than deleted. It
  // used to read "no give control on an npc sheet", which was the old
  // type-based gate stated as a test. The gate is OWNERSHIP now, so the
  // question is no longer what KIND of sheet it is — it is whose. Alice, who
  // does not own this npc, still gets nothing; the Warden does, and section P
  // below is the other half.
  const npcControls = await alice.evaluate(async () => {
    const npc = game.actors.getName("ZZ Offer NPC");
    if (!npc) return -2;
    await npc.sheet.render(true);
    await new Promise((r) => setTimeout(r, 600));
    const n = npc.sheet.element?.querySelectorAll('a[data-action="itemGive"]').length ?? -1;
    await npc.sheet.close();
    return n;
  });
  check("no give control on an npc a player does not own", npcControls === 0, `${npcControls} anchors`);

  /* ---- B2. the picker lists only actors the giver can SEE ----------------- */
  // Review #23 finding 6: an ownership-NONE character (a doppelganger the
  // Warden is hiding) must not leak its NAME into a player's picker. Core's
  // `visible` is LIMITED+, so the LIMITED bystander stays listed.
  const pickerRows = (page, itemName) => page.evaluate(async (itemName) => {
    const giver = game.actors.getName("ZZ Offer Giver");
    const item = giver?.items.find((i) => i.name === itemName);
    if (!item) return { err: "no item" };
    await giver.sheet.render(true);
    await new Promise((r) => setTimeout(r, 500));
    const btn = giver.sheet.element?.querySelector(
      `.cairn-items-list-row[data-item-id="${item.id}"] a[data-action="itemGive"]`);
    if (!btn) return { err: "no give control" };
    btn.click();
    let dlg = null;
    for (let i = 0; i < 40 && !dlg; i++) {
      dlg = document.querySelector(".cairn-offer-picker");
      if (!dlg) await new Promise((r) => setTimeout(r, 150));
    }
    if (!dlg) return { err: "no picker" };
    const rows = [...dlg.querySelectorAll('input[name="offerTarget"]')].map((i) => ({
      uuid: i.value, label: i.closest("label")?.textContent.trim() ?? "",
    }));
    dlg.closest(".application")?.querySelector('button[data-action="cancel"]')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return { rows };
  }, itemName);
  const aliceRows = await pickerRows(alice, "ZZ Brass Lantern");
  check("a player's picker omits an ownership-NONE character",
    aliceRows.rows && !aliceRows.rows.some((r) => r.uuid === fix.doppelUuid)
    && aliceRows.rows.some((r) => r.uuid === fix.bystanderUuid),
    JSON.stringify(aliceRows.rows?.map((r) => r.label) ?? aliceRows));
  const gmRows = await pickerRows(gm, "ZZ Brass Lantern");
  check("the Warden's picker still lists it, marked Warden only",
    gmRows.rows && gmRows.rows.some((r) => r.uuid === fix.doppelUuid && /Warden only/.test(r.label)),
    JSON.stringify(gmRows.rows?.map((r) => r.label) ?? gmRows));

  /* ---- C. picker happy path: offer, per-viewer buttons, accept ----------- */
  console.log("\noffer and accept (picker path)");
  const pickResult = await offerViaPicker(alice, "ZZ Trail Rations", "ZZ Offer Target");
  check("the picker flow drives to a click", pickResult === "clicked", pickResult);
  // The picker's listing rules are asserted on a fresh open below (leg G re-opens);
  // here the card is the subject. FRESH messages only, by name: the dev world
  // can hold offer cards from earlier live play, and a poll that latches a
  // stale one satisfies its precondition with state nobody planted — that
  // exact miss sent this leg chasing a bygone accepted card of Bob's.
  const offer1 = await poll(gm, (beforeIds) => {
    const msg = game.messages.contents.filter((m) => !beforeIds.includes(m.id)
      && m.getFlag("air-bladder", "itemOffer")?.item?.name === "ZZ Trail Rations").at(-1);
    return msg ? { id: msg.id, whisper: msg.whisper.length, author: msg.author?.name,
      state: msg.getFlag("air-bladder", "itemOffer")?.state } : null;
  }, before.messages);
  check("a public offer card posts, authored by the giver",
    offer1 && offer1.whisper === 0 && offer1.author === "Alice" && offer1.state === "open",
    JSON.stringify(offer1));

  if (offer1) {
    await new Promise((r) => setTimeout(r, 800));
    const [aBtns, bBtns, gBtns] = [
      await cardButtons(alice, offer1.id), await cardButtons(bob, offer1.id), await cardButtons(gm, offer1.id)];
    check("Bob sees Accept + Decline, no Cancel", bBtns?.accept && bBtns?.decline && !bBtns?.cancel, JSON.stringify(bBtns));
    check("Alice sees Cancel only", aBtns && !aBtns.accept && !aBtns.decline && aBtns.cancel, JSON.stringify(aBtns));
    check("the Warden sees all three", gBtns?.accept && gBtns?.decline && gBtns?.cancel, JSON.stringify(gBtns));

    await clickCard(bob, offer1.id, "cairn-offer-accept");
    const done1 = await poll(gm, () => {
      const target = game.actors.getName("ZZ Offer Target");
      const giver = game.actors.getName("ZZ Offer Giver");
      const got = target?.items.find((i) => i.name === "ZZ Trail Rations");
      const kept = giver?.items.find((i) => i.name === "ZZ Trail Rations");
      const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
      const f = msg?.getFlag("air-bladder", "itemOffer");
      if (!got || f?.state !== "accepted" || !f?.settled) return null;
      const maxOther = Math.max(...target.items.filter((i) => i !== got).map((i) => i.sort ?? 0), 0);
      return {
        gotQty: got.system.quantity, gotEquipped: got.system.equipped,
        gotGrant: got.getFlag("air-bladder", "grantSource") ?? null,
        appended: (got.sort ?? 0) > maxOther,
        keptQty: kept?.system.quantity ?? 0,
        state: f.state, settled: f.settled,
      };
    });
    check("acceptance creates ONE unit on the target — unequipped, grant tag stripped, appended",
      done1 && done1.gotQty === 1 && done1.gotEquipped === false && done1.gotGrant === null && done1.appended,
      JSON.stringify(done1));
    check("the giver's stack decrements 3 → 2", done1?.keptQty === 2, `kept=${done1?.keptQty}`);
    check("the flag reads accepted + settled", done1?.state === "accepted" && done1?.settled === true, JSON.stringify(done1));
    await new Promise((r) => setTimeout(r, 600));
    const gone = await bob.evaluate((id) => {
      const row = document.querySelector(`.chat-message[data-message-id="${id}"]`);
      return row && !row.querySelector(".cairn-offer-accept") && !row.querySelector(".cairn-offer-decline");
    }, offer1.id);
    check("the answered card's buttons are gone", gone === true, String(gone));
    const heard = await gm.evaluate(() => window.__offerSeen);
    check("the recipients discipline holds — the GM client heard no player-leg emits",
      Array.isArray(heard) && heard.length === 0, JSON.stringify(heard));
  }

  /* ---- D. a half-spent item travels at its current uses ------------------ */
  const pickD = await offerViaPicker(alice, "ZZ Brass Lantern", "ZZ Offer Target");
  check("lantern offer drives to a click", pickD === "clicked", pickD);
  // By name, or this poll latches leg C's card while it is still open.
  const offerD = await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === "ZZ Brass Lantern" ? { id: msg.id } : null;
  });
  if (offerD) {
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(bob, offerD.id, "cairn-offer-accept");
    // Settle on SETTLED, not on the create: the giver's delete rides the
    // offerDone round-trip and lands a beat after the target's item exists.
    const doneD = await poll(gm, (id) => {
      const target = game.actors.getName("ZZ Offer Target");
      const giver = game.actors.getName("ZZ Offer Giver");
      const got = target?.items.find((i) => i.name === "ZZ Brass Lantern");
      const f = game.messages.get(id)?.getFlag("air-bladder", "itemOffer");
      if (!got || !f?.settled) return null;
      return { uses: got.system.uses.value, max: got.system.uses.max,
        giverStill: !!giver?.items.find((i) => i.name === "ZZ Brass Lantern") };
    }, offerD.id);
    check("the lantern arrives at uses 2/4 and leaves the giver",
      doneD && doneD.uses === 2 && doneD.max === 4 && doneD.giverStill === false, JSON.stringify(doneD));
  } else fail("lantern offer never posted");

  /* ---- E. over-burden acceptance: confirm, then HP 0 --------------------- */
  console.log("\nover-burden acceptance");
  await gm.evaluate(async () => {
    const target = game.actors.getName("ZZ Offer Target");
    // Fill to the limit: default max 10; rations+lantern hold 2. Eight more.
    const filler = Array.from({ length: 8 }, (_, i) => ({ name: `ZZ Filler ${i}`, type: "item" }));
    await target.createEmbeddedDocuments("Item", filler, { render: false });
  });
  const pickE = await offerViaPicker(alice, "ZZ Anvil", "ZZ Offer Target");
  check("anvil offer drives to a click", pickE === "clicked", pickE);
  const offerE = await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === "ZZ Anvil" ? { id: msg.id } : null;
  });
  if (offerE) {
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(bob, offerE.id, "cairn-offer-accept");
    // The confirm names the cost; click its Yes on Bob's client.
    const confirmed = await poll(bob, () => {
      const yes = [...document.querySelectorAll(".application.dialog button")]
        .find((b) => b.dataset.action === "yes");
      if (!yes) return null;
      yes.click();
      return true;
    });
    check("acceptance past the limit raises the over-burden confirm", confirmed === true, String(confirmed));
    const doneE = await poll(bob, () => {
      const target = game.actors.getName("ZZ Offer Target");
      const got = target?.items.find((i) => i.name === "ZZ Anvil");
      if (!got) return null;
      return {
        encumbered: target.system.encumbered, hp: target.system.hp.value,
        sourceHp: target._source.system.hp.value,
        slots: `${target.system.slotsUsed}/${target.system.slotsMax}`,
      };
    });
    check("the anvil is created anyway and the target is over-burdened at derived HP 0",
      doneE && doneE.encumbered === true && doneE.hp === 0 && doneE.sourceHp > 0,
      JSON.stringify(doneE));
  } else fail("anvil offer never posted");

  /* ---- F. decline --------------------------------------------------------- */
  console.log("\ndecline, cancel, stale, offline");
  await gm.evaluate(async () => {
    // Clear the over-burden so later legs read cleanly.
    const target = game.actors.getName("ZZ Offer Target");
    const junk = target.items.filter((i) => /^ZZ Filler|^ZZ Anvil/.test(i.name)).map((i) => i.id);
    await target.deleteEmbeddedDocuments("Item", junk);
  });
  const pickF = await offerViaPicker(alice, "ZZ Trail Rations", "ZZ Offer Target");
  const offerF = pickF === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" ? { id: msg.id } : null;
  }) : null;
  if (offerF) {
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(bob, offerF.id, "cairn-offer-decline");
    const declined = await poll(gm, (id) => {
      const f = game.messages.get(id)?.getFlag("air-bladder", "itemOffer");
      return f?.state === "declined" ? f.state : null;
    }, offerF.id);
    const giverQty = await gm.evaluate(() =>
      game.actors.getName("ZZ Offer Giver")?.items.find((i) => i.name === "ZZ Trail Rations")?.system.quantity);
    check("a decline stamps the card and moves nothing", declined === "declined" && giverQty === 2,
      `state=${declined} giverQty=${giverQty}`);
  } else fail(`decline-leg offer never posted (${pickF})`);

  /* ---- G. cancel (giver, then Warden) ------------------------------------ */
  const pickG = await offerViaPicker(alice, "ZZ Trail Rations", "ZZ Offer Target");
  const offerG = pickG === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" ? { id: msg.id } : null;
  }) : null;
  if (offerG) {
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(alice, offerG.id, "cairn-offer-cancel");
    const cancelled = await poll(gm, (id) =>
      game.messages.get(id)?.getFlag("air-bladder", "itemOffer")?.state === "cancelled" || null, offerG.id);
    check("the giver can cancel an open offer", cancelled === true, "");
  } else fail(`cancel-leg offer never posted (${pickG})`);
  const pickG2 = await offerViaPicker(alice, "ZZ Trail Rations", "ZZ Offer Target");
  const offerG2 = pickG2 === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" ? { id: msg.id } : null;
  }) : null;
  if (offerG2) {
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(gm, offerG2.id, "cairn-offer-cancel");
    const cancelled2 = await poll(gm, (id) =>
      game.messages.get(id)?.getFlag("air-bladder", "itemOffer")?.state === "cancelled" || null, offerG2.id);
    check("the Warden can cancel any open offer", cancelled2 === true, "");
  } else fail(`gm-cancel-leg offer never posted (${pickG2})`);

  /* ---- H. a stale offer lapses ------------------------------------------- */
  const pickH = await offerViaPicker(alice, "ZZ Trail Rations", "ZZ Offer Target");
  const offerH = pickH === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" ? { id: msg.id } : null;
  }) : null;
  if (offerH) {
    // The item vanishes before the answer (Alice spends/deletes it herself).
    await alice.evaluate(async () => {
      const giver = game.actors.getName("ZZ Offer Giver");
      const it = giver.items.find((i) => i.name === "ZZ Trail Rations");
      await giver.deleteEmbeddedDocuments("Item", [it.id]);
    });
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(bob, offerH.id, "cairn-offer-accept");
    const lapsed = await poll(gm, (id) =>
      game.messages.get(id)?.getFlag("air-bladder", "itemOffer")?.state === "lapsed" || null, offerH.id);
    const targetQty = await gm.evaluate(() =>
      game.actors.getName("ZZ Offer Target")?.items.find((i) => i.name === "ZZ Trail Rations")?.system.quantity ?? 0);
    check("an offer whose item is gone lapses and creates nothing",
      lapsed === true && targetQty === 1,
      `lapsed=${lapsed} targetQty=${targetQty} (1 from leg C)`);
  } else fail(`stale-leg offer never posted (${pickH})`);

  /* ---- I. giver offline: refuse, stay open, complete after rejoin -------- */
  await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    await giver.createEmbeddedDocuments("Item", [{ name: "ZZ Keepsake", type: "item" }]);
  });
  const pickI = await offerViaPicker(alice, "ZZ Keepsake", "ZZ Offer Target");
  const offerI = pickI === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === "ZZ Keepsake" ? { id: msg.id } : null;
  }) : null;
  if (offerI) {
    await alCtx.close();
    await new Promise((r) => setTimeout(r, 2000));
    await clickCard(bob, offerI.id, "cairn-offer-accept");
    const toast = await awaitNotif(bob, /not connected|stays open/i);
    const stillOpen = await gm.evaluate((id) =>
      game.messages.get(id)?.getFlag("air-bladder", "itemOffer")?.state, offerI.id);
    const notMoved = await gm.evaluate(() =>
      !game.actors.getName("ZZ Offer Target")?.items.find((i) => i.name === "ZZ Keepsake"));
    check("with the giver offline the accept refuses with the toast and the offer stays open",
      !!toast && stillOpen === "open" && notMoved, `toast=${JSON.stringify(toast)} state=${stillOpen}`);

    alCtx = await browser.newContext({ viewport: VIEWPORT });
    alice = await alCtx.newPage();
    alErrors = watchErrors(alice);
    await joinAs(alice, "Alice");
    await new Promise((r) => setTimeout(r, 1500));
    await clickCard(bob, offerI.id, "cairn-offer-accept");
    const doneI = await poll(gm, () => {
      const got = game.actors.getName("ZZ Offer Target")?.items.find((i) => i.name === "ZZ Keepsake");
      const f = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1)
        ?.getFlag("air-bladder", "itemOffer");
      return got && f?.settled ? true : null;
    });
    check("after the giver rejoins, the same offer completes", doneI === true, "");
  } else fail(`offline-leg offer never posted (${pickI})`);

  /* ---- J. double-accept: exactly one create ------------------------------ */
  console.log("\nraces and hostile emits");
  await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    await giver.createEmbeddedDocuments("Item", [{ name: "ZZ Coin Purse", type: "item" }]);
  });
  const pickJ = await offerViaPicker(alice, "ZZ Coin Purse", "ZZ Offer Target");
  const offerJ = pickJ === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === "ZZ Coin Purse" ? { id: msg.id } : null;
  }) : null;
  if (offerJ) {
    await new Promise((r) => setTimeout(r, 600));
    // A real click (which arms Bob's pending-accept map) plus one raw
    // duplicate emit in the same breath — sharper than any double-click.
    await bob.evaluate((id) => {
      const btn = document.querySelector(`.chat-message[data-message-id="${id}"] .cairn-offer-accept`);
      btn?.click();
      const aliceU = game.users.getName("Alice");
      game.socket.emit(`system.${game.system.id}`, { action: "offerAccept", messageId: id },
        { recipients: [aliceU.id] });
    }, offerJ.id);
    await new Promise((r) => setTimeout(r, 4000));
    const countJ = await gm.evaluate(() =>
      game.actors.getName("ZZ Offer Target")?.items.filter((i) => i.name === "ZZ Coin Purse").length);
    const giverStill = await gm.evaluate(() =>
      !!game.actors.getName("ZZ Offer Giver")?.items.find((i) => i.name === "ZZ Coin Purse"));
    check("two racing accepts create exactly ONE item and decrement once",
      countJ === 1 && giverStill === false, `count=${countJ} giverStill=${giverStill}`);
  } else fail(`double-accept offer never posted (${pickJ})`);

  /* ---- K. hostile emits are refused, nothing written --------------------- */
  // K1: Bob accepts an offer whose target he does NOT own.
  await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    await giver.createEmbeddedDocuments("Item", [{ name: "ZZ Bait", type: "item" }]);
  });
  const pickK1 = await offerViaPicker(alice, "ZZ Bait", "ZZ Offer Bystander");
  const offerK1 = pickK1 === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === "ZZ Bait" ? { id: msg.id } : null;
  }) : null;
  if (offerK1) {
    await new Promise((r) => setTimeout(r, 600));
    await bob.evaluate((id) => {
      const aliceU = game.users.getName("Alice");
      game.socket.emit(`system.${game.system.id}`, { action: "offerAccept", messageId: id },
        { recipients: [aliceU.id] });
    }, offerK1.id);
    await new Promise((r) => setTimeout(r, 2500));
    const k1 = await gm.evaluate((id) => ({
      state: game.messages.get(id)?.getFlag("air-bladder", "itemOffer")?.state,
      bystanderItems: game.actors.getName("ZZ Offer Bystander")?.items.size ?? -1,
    }), offerK1.id);
    const k1Answer = await bob.evaluate(() => window.__offerAnswers.slice());
    check("accepting an offer you have no right to answer is refused",
      k1.state === "open" && k1.bystanderItems === 0 && k1Answer.some((r) => /notYours|refused/i.test(r)),
      `${JSON.stringify(k1)} answers=${JSON.stringify(k1Answer)}`);
  } else fail(`hostile-leg offer never posted (${pickK1})`);

  // K2: a forged offerRelease at Bob (no pending accept) must not create.
  const targetItemsBefore = await gm.evaluate(() => game.actors.getName("ZZ Offer Target")?.items.size);
  await gm.evaluate((targetUuid) => {
    const bobU = game.users.getName("Bob");
    game.socket.emit(`system.${game.system.id}`, {
      action: "offerRelease", messageId: "FORGEDFORGED1234",
      itemData: { name: "ZZ Forged Loot", type: "item", system: {} }, targetActorUuid: targetUuid,
    }, { recipients: [bobU.id] });
  }, fix.targetUuid);
  await new Promise((r) => setTimeout(r, 2000));
  const k2 = await gm.evaluate((n) => ({
    grew: (game.actors.getName("ZZ Offer Target")?.items.size ?? 0) > n,
    forged: !!game.actors.getName("ZZ Offer Target")?.items.find((i) => i.name === "ZZ Forged Loot"),
  }), targetItemsBefore);
  check("a forged offerRelease with no pending accept creates nothing", !k2.grew && !k2.forged, JSON.stringify(k2));

  // K3: a forged offerDone on an OPEN offer must not delete the giver's half.
  if (offerK1) {
    await gm.evaluate((id) => {
      const aliceU = game.users.getName("Alice");
      game.socket.emit(`system.${game.system.id}`, { action: "offerDone", messageId: id },
        { recipients: [aliceU.id] });
    }, offerK1.id);
    await new Promise((r) => setTimeout(r, 2000));
    const k3 = await gm.evaluate((id) => {
      const f = game.messages.get(id)?.getFlag("air-bladder", "itemOffer");
      const giver = game.actors.getName("ZZ Offer Giver");
      return { state: f?.state, itemStill: !!giver?.items.find((i) => i.id === f?.itemId) };
    }, offerK1.id);
    check("a forged offerDone on an open offer deletes nothing", k3.state === "open" && k3.itemStill,
      JSON.stringify(k3));
  }

  /* ---- M. a forged refusal cannot wedge an accept mid-flight -------------- */
  // Review #23 finding 1: offerRefused must authenticate BEFORE clearing the
  // pending-accept entry. The forged refusal (from the GM context — any
  // non-author sender) is emitted in the same breath as Bob's real click:
  // one hop, while the genuine release still waits on the author's flag
  // write, so it lands inside the accept window. Pre-fix it cleared the
  // entry and the release that followed was discarded as forged — accepted,
  // settled false, nothing moved, no way out.
  await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    await giver.createEmbeddedDocuments("Item", [{ name: "ZZ Locket", type: "item" }]);
  });
  const pickM = await offerViaPicker(alice, "ZZ Locket", "ZZ Offer Target");
  const offerM = pickM === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === "ZZ Locket" ? { id: msg.id } : null;
  }) : null;
  if (offerM) {
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(bob, offerM.id, "cairn-offer-accept");
    await gm.evaluate((id) => {
      const bobU = game.users.getName("Bob");
      game.socket.emit(`system.${game.system.id}`, { action: "offerRefused", messageId: id, reason: "busy" },
        { recipients: [bobU.id] });
    }, offerM.id);
    const doneM = await poll(gm, (id) =>
      game.messages.get(id)?.getFlag("air-bladder", "itemOffer")?.settled || null, offerM.id, 8000);
    const m = await gm.evaluate((id) => {
      const f = game.messages.get(id)?.getFlag("air-bladder", "itemOffer");
      const target = game.actors.getName("ZZ Offer Target");
      const giver = game.actors.getName("ZZ Offer Giver");
      return { state: f?.state, settled: f?.settled ?? false,
        got: target?.items.filter((i) => i.name === "ZZ Locket").length ?? 0,
        kept: !!giver?.items.find((i) => i.name === "ZZ Locket") };
    }, offerM.id);
    check("a forged refusal cannot wedge an accept mid-flight",
      doneM === true && m.state === "accepted" && m.settled === true && m.got === 1 && m.kept === false,
      JSON.stringify(m));
  } else fail(`forged-refusal offer never posted (${pickM})`);

  /* ---- N. settled is terminal: done/fail replays are refused -------------- */
  // Review #23 finding 2: the terminal guard read state + acceptor but never
  // `settled`, so the GENUINE acceptor could replay offerDone (one more
  // giver-stack decrement per emit) or offerFail (reopening a completed
  // offer for a second delivery).
  await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    await giver.createEmbeddedDocuments("Item", [{ name: "ZZ Heirloom", type: "item", system: { quantity: 3 } }]);
  });
  const pickN = await offerViaPicker(alice, "ZZ Heirloom", "ZZ Offer Target");
  const offerN = pickN === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === "ZZ Heirloom" ? { id: msg.id } : null;
  }) : null;
  if (offerN) {
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(bob, offerN.id, "cairn-offer-accept");
    const settledN = await poll(gm, (id) =>
      game.messages.get(id)?.getFlag("air-bladder", "itemOffer")?.settled || null, offerN.id);
    const qtyAfter = await gm.evaluate(() =>
      game.actors.getName("ZZ Offer Giver")?.items.find((i) => i.name === "ZZ Heirloom")?.system.quantity ?? 0);
    check("heirloom hand-off settles at giver 3 → 2 (precondition)", settledN === true && qtyAfter === 2,
      `settled=${settledN} giverQty=${qtyAfter}`);
    await bob.evaluate((id) => {
      const aliceU = game.users.getName("Alice");
      game.socket.emit(`system.${game.system.id}`, { action: "offerDone", messageId: id },
        { recipients: [aliceU.id] });
    }, offerN.id);
    await new Promise((r) => setTimeout(r, 2500));
    const qtyReplay = await gm.evaluate(() =>
      game.actors.getName("ZZ Offer Giver")?.items.find((i) => i.name === "ZZ Heirloom")?.system.quantity ?? 0);
    check("a replayed offerDone on a settled offer decrements nothing", qtyReplay === 2, `giverQty=${qtyReplay}`);
    await bob.evaluate((id) => {
      const aliceU = game.users.getName("Alice");
      game.socket.emit(`system.${game.system.id}`, { action: "offerFail", messageId: id },
        { recipients: [aliceU.id] });
    }, offerN.id);
    await new Promise((r) => setTimeout(r, 2500));
    const n2 = await gm.evaluate((id) => {
      const f = game.messages.get(id)?.getFlag("air-bladder", "itemOffer");
      return { state: f?.state, settled: f?.settled };
    }, offerN.id);
    check("a replayed offerFail cannot reopen a settled offer",
      n2.state === "accepted" && n2.settled === true, JSON.stringify(n2));
  } else fail(`replay-leg offer never posted (${pickN})`);

  /* ---- O. a compendium-context character cannot be an offer target -------- */
  // Review #23 finding 7: a drop on a COMPENDIUM character posted an offer
  // whose target resolves to a bare index entry — bindOfferCard's permission
  // test then throws for every non-GM viewer and the card wears no buttons,
  // not even the giver's Cancel. No shipped pack holds a character-type
  // actor, so the pack CONTEXT is synthesized on an unsaved doc against a
  // real pack id; the precondition is asserted so the leg cannot pass
  // vacuously if the context stops taking.
  const packDrop = await alice.evaluate(async () => {
    const { offerFromDrop } = await import("/systems/air-bladder/module/item-offer.js");
    const giver = game.actors.getName("ZZ Offer Giver");
    const item = giver.items.find((i) => i.name === "ZZ Heirloom")
      ?? giver.items.find((i) => !["Fatigue", "ZZ Grimoire", "ZZ Bound Page"].includes(i.name));
    if (!item) return { err: "no eligible item" };
    const ghost = new CONFIG.Actor.documentClass({ name: "ZZ Pack Ghost", type: "character" },
      { pack: "air-bladder.monsters" });
    if (!ghost.pack) return { err: "pack context did not take" };
    const msgs = game.messages.size;
    const DialogV2 = foundry.applications.api.DialogV2;
    const orig = DialogV2.confirm;
    DialogV2.confirm = async () => true; // if the confirm ever shows it says YES — only the wall can refuse
    try { await offerFromDrop(ghost, item); }
    finally { DialogV2.confirm = orig; }
    await new Promise((r) => setTimeout(r, 800));
    return { grew: game.messages.size > msgs };
  });
  check("a compendium-context character refuses the drop-offer", !packDrop.err && packDrop.grew === false,
    JSON.stringify(packDrop));

  /* ---- P. a background row travels too ------------------------------------ */
  // RULED 2026-09-07 (review #23 finding 3): admit at the wire. The give
  // affordance never gated on type, so the sanitizer's whitelist now covers
  // every registered type and the button a background row already wore leads
  // somewhere. Pre-fix the acceptor refused the delivery and the offer
  // looped failed -> reopen forever. Runs late so the delivered row cannot
  // disturb the over-burden leg's slot arithmetic.
  await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    await giver.createEmbeddedDocuments("Item", [{ name: "ZZ Old Life", type: "background" }]);
  });
  const pickP = await offerViaPicker(alice, "ZZ Old Life", "ZZ Offer Target");
  const offerP = pickP === "clicked" ? await poll(gm, () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === "ZZ Old Life" ? { id: msg.id } : null;
  }) : null;
  if (offerP) {
    await new Promise((r) => setTimeout(r, 600));
    await clickCard(bob, offerP.id, "cairn-offer-accept");
    const doneP = await poll(gm, (id) => {
      const target = game.actors.getName("ZZ Offer Target");
      const got = target?.items.find((i) => i.name === "ZZ Old Life");
      const f = game.messages.get(id)?.getFlag("air-bladder", "itemOffer");
      if (!got || !f?.settled) return null;
      return { type: got.type,
        giverStill: !!game.actors.getName("ZZ Offer Giver")?.items.find((i) => i.name === "ZZ Old Life") };
    }, offerP.id);
    check("a background-type item is delivered and settles",
      doneP && doneP.type === "background" && doneP.giverStill === false, JSON.stringify(doneP));
  } else fail(`background offer never posted (${pickP})`);

  /* ---- L. the drag route ------------------------------------------------- */
  console.log("\nthe drag route");
  await gm.evaluate(async (aliceName) => {
    const target = game.actors.getName("ZZ Offer Target");
    const aliceU = game.users.getName(aliceName);
    await target.update({ [`ownership.${aliceU.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER });
  }, "Alice");
  const dragged = await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    const target = game.actors.getName("ZZ Offer Target");
    const item = giver.items.find((i) => i.name === "ZZ Bait")
      ?? giver.items.find((i) => !["Fatigue", "ZZ Grimoire", "ZZ Bound Page"].includes(i.name));
    if (!item) return { err: "no draggable item" };
    await target.sheet.render(true);
    await new Promise((r) => setTimeout(r, 700));
    const DialogV2 = foundry.applications.api.DialogV2;
    const origConfirm = DialogV2.confirm;
    DialogV2.confirm = async () => true;
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
    let threw = null;
    try { await target.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); }
    catch (e) { threw = e.message; }
    finally { DialogV2.confirm = origConfirm; }
    await new Promise((r) => setTimeout(r, 1200));
    await target.sheet.close();
    return { threw, itemName: item.name, itemStill: !!giver.items.get(item.id) };
  });
  const dragOffer = await poll(gm, (name) => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    const f = msg?.getFlag("air-bladder", "itemOffer");
    return f?.state === "open" && f?.item?.name === name ? true : null;
  }, dragged.itemName);
  check("dropping on an unowned character sheet posts an OFFER and moves nothing",
    !dragged.err && !dragged.threw && dragOffer === true && dragged.itemStill,
    JSON.stringify(dragged));
  // REWRITTEN 2026-09-10. This leg used to assert "an npc sheet still refuses",
  // and that claim INVERTED when offers grew past player characters. It is not
  // deleted: the refusal role passes to a MONSTER, which is the one actor a
  // player still cannot offer to — and it is refused by VISIBILITY (ownership
  // NONE, which `CairnActor._preCreate` deliberately leaves monsters at) rather
  // than by any rule naming monsters in the code.
  const npcDrop = await alice.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    const npc = game.actors.getName("ZZ Offer NPC");
    const item = giver.items.find((i) => i.name === "ZZ Bait")
      ?? giver.items.find((i) => !["Fatigue", "ZZ Grimoire", "ZZ Bound Page"].includes(i.name));
    const msgs = game.messages.size;
    const DialogV2 = foundry.applications.api.DialogV2;
    const origConfirm = DialogV2.confirm;
    DialogV2.confirm = async () => true;
    try {
      await npc.sheet.render(true);
      await new Promise((r) => setTimeout(r, 700));
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
      await npc.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt }));
    } catch { /* a refusal by throw would show up as no card below */ }
    finally { DialogV2.confirm = origConfirm; }
    await new Promise((r) => setTimeout(r, 1200));
    await npc.sheet.close();
    return {
      grew: game.messages.size > msgs,
      // NOTHING may be created by the drop itself, on either route.
      npcGot: npc.items.filter((i) => i.name === item.name).length,
      giverStill: !!giver.items.get(item.id),
    };
  });
  // ASSERT THE CARD, not that a handler ran: before this change drag-drop never
  // BOUND on an unowned npc sheet at all (`_canDragDrop`), so no drop event was
  // ever dispatched and any "the handler refused" assertion would have been
  // testing nothing.
  check("dropping on an unowned NPC sheet posts an offer, and moves nothing",
    npcDrop.grew === true && npcDrop.npcGot === 0 && npcDrop.giverStill === true,
    JSON.stringify(npcDrop));

  /* ---- M. monsters, and the two-sided control ---------------------------- */
  console.log("\nmonsters: visibility is the only gate");
  await gm.evaluate(async () => {
    await Actor.create({
      name: "ZZ Offer Wolf", type: "npc", system: { role: "monster" },
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    });
  });
  await new Promise((r) => setTimeout(r, 600));

  const pickerNames = (p) => p.evaluate(async () => {
    const { promptOfferTarget } = await import("/systems/air-bladder/module/item-offer.js");
    const giver = game.actors.getName("ZZ Offer Giver");
    const item = giver.items.find((i) => !["Fatigue", "ZZ Grimoire", "ZZ Bound Page"].includes(i.name));
    const p = promptOfferTarget(giver, item);
    await new Promise((r) => setTimeout(r, 500));
    const dlg = [...foundry.applications.instances.values()]
      .find((a) => a.element?.querySelector?.(".cairn-offer-picker"));
    const rows = [...(dlg?.element.querySelectorAll(".bg-pick-name") ?? [])].map((n) => n.textContent.trim());
    const groups = [...(dlg?.element.querySelectorAll(".cairn-offer-group") ?? [])].map((n) => n.textContent.trim());
    dlg?.close();
    await p;
    return { rows, groups };
  });

  const hiddenWolf = await pickerNames(alice);
  check("a monster at ownership NONE never reaches a player's picker",
    !hiddenWolf.rows.some((r) => r.includes("Wolf")), JSON.stringify(hiddenWolf.rows));
  check("...and the picker is grouped, Characters first",
    hiddenWolf.groups[0] === "Characters" && hiddenWolf.groups.includes("People"),
    JSON.stringify(hiddenWolf.groups));

  // THE CONTROL, and it is the half that matters: raise the wolf to Limited and
  // it MUST appear. A hardcoded monster exclusion would pass the leg above and
  // fail this one, which is the only way to tell the two designs apart.
  await gm.evaluate(async () => {
    await game.actors.getName("ZZ Offer Wolf")
      .update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED });
  });
  await new Promise((r) => setTimeout(r, 700));
  const shownWolf = await pickerNames(alice);
  check("raising it to Limited makes it offerable — visibility is the only gate",
    shownWolf.rows.some((r) => r.includes("Wolf")) && shownWolf.groups.includes("Monsters"),
    JSON.stringify(shownWolf));

  await gm.evaluate(async () => {
    await game.actors.getName("ZZ Offer Wolf")
      .update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE });
  });
  await new Promise((r) => setTimeout(r, 700));
  const hiddenAgain = await pickerNames(alice);
  check("...and dropping it back to None hides it again",
    !hiddenAgain.rows.some((r) => r.includes("Wolf")), JSON.stringify(hiddenAgain.rows));

  /* ---- N. a thing is FULL, and both routes agree ------------------------- */
  console.log("\ncapacity: a crate is full, and nobody may buy past it");
  await gm.evaluate(async (aliceName) => {
    const aliceU = game.users.getName(aliceName);
    const crate = await Actor.create({
      name: "ZZ Offer Crate", type: "npc",
      system: { role: "container", slots: 2 },
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED, [aliceU.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    });
    await crate.createEmbeddedDocuments("Item", [
      { name: "ZZ Crate Filler A", type: "item" },
      { name: "ZZ Crate Filler B", type: "item" },
    ]);
  }, "Alice");
  await new Promise((r) => setTimeout(r, 700));

  const crateOffer = await alice.evaluate(async () => {
    const { createItemOffer } = await import("/systems/air-bladder/module/item-offer.js");
    const giver = game.actors.getName("ZZ Offer Giver");
    const crate = game.actors.getName("ZZ Offer Crate");
    const item = giver.items.find((i) => !["Fatigue", "ZZ Grimoire", "ZZ Bound Page"].includes(i.name));
    const before = crate.items.size;
    const msg = await createItemOffer(giver, item, crate);
    // WAIT FOR THE BUTTON, then assert it was really there. Clicking a card
    // that has not rendered yet is how "the crate refused" passes while
    // nothing was ever clicked — the shape of a check that cannot fail.
    let btn = null;
    for (let i = 0; i < 60 && !btn; i++) {
      btn = document.querySelector(`[data-message-id="${msg.id}"] .cairn-offer-accept`);
      if (!btn) await new Promise((r) => setTimeout(r, 100));
    }
    const DialogV2 = foundry.applications.api.DialogV2;
    const orig = DialogV2.confirm;
    let confirmSeen = false;
    DialogV2.confirm = async (...a) => { confirmSeen = true; return orig.call(DialogV2, ...a); };
    try {
      btn?.click();
      await new Promise((r) => setTimeout(r, 1400));
    } finally { DialogV2.confirm = orig; }
    return {
      clicked: !!btn,
      crateGrew: crate.items.size > before,
      giverStill: !!giver.items.get(item.id),
      state: msg.getFlag("air-bladder", "itemOffer")?.state,
      confirmSeen,
      slots: `${crate.system.slotsUsed}/${crate.system.slotsMax}`,
    };
  });
  check("an offer to a FULL container is refused, and the offer stays open",
    crateOffer.clicked === true && crateOffer.crateGrew === false
      && crateOffer.giverStill === true && crateOffer.state === "open"
      // No over-burden confirm: a crate has no Hit Protection to pay with, so
      // "full" is not a cost anyone may consent to.
      && crateOffer.confirmSeen === false,
    JSON.stringify(crateOffer));

  const crateDrop = await gm.evaluate(async () => {
    const giver = game.actors.getName("ZZ Offer Giver");
    const crate = game.actors.getName("ZZ Offer Crate");
    const item = giver.items.find((i) => !["Fatigue", "ZZ Grimoire", "ZZ Bound Page"].includes(i.name));
    const before = crate.items.size;
    await crate.sheet.render(true);
    await new Promise((r) => setTimeout(r, 700));
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
    try { await crate.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); } catch { /* refused */ }
    await new Promise((r) => setTimeout(r, 900));
    await crate.sheet.close();
    return { grew: crate.items.size > before };
  });
  // THE ROUTE-AGREEMENT LEG. Before the shared verdict, the offer path went
  // through `ignoreCapacity: true` unconditionally and the crate ended 4/2
  // while the very same drag was refused.
  check("...and a DRAG of the same item onto the same crate is refused too",
    crateDrop.grew === false, JSON.stringify(crateDrop));

  // THE COMPANION THAT KEEPS THE TWO ABOVE HONEST. Without it "the crate
  // refused" is also satisfied by offers to containers never working at all —
  // an assertion the surface can meet by being broken.
  await gm.evaluate(async () => {
    await game.actors.getName("ZZ Offer Crate").update({ "system.slots": 4 });
  });
  await new Promise((r) => setTimeout(r, 700));
  const crateRoom = await alice.evaluate(async () => {
    const { createItemOffer } = await import("/systems/air-bladder/module/item-offer.js");
    const giver = game.actors.getName("ZZ Offer Giver");
    const crate = game.actors.getName("ZZ Offer Crate");
    const item = giver.items.find((i) => !["Fatigue", "ZZ Grimoire", "ZZ Bound Page"].includes(i.name));
    const before = crate.items.size;
    const msg = await createItemOffer(giver, item, crate);
    let btn = null;
    for (let i = 0; i < 60 && !btn; i++) {
      btn = document.querySelector(`[data-message-id="${msg.id}"] .cairn-offer-accept`);
      if (!btn) await new Promise((r) => setTimeout(r, 100));
    }
    btn?.click();
    await new Promise((r) => setTimeout(r, 1600));
    return {
      clicked: !!btn,
      landed: crate.items.size === before + 1,
      state: msg.getFlag("air-bladder", "itemOffer")?.state,
      // A thing STOWS what it is given — the drop route's rule, reached here
      // through sanitizeDelivery rather than a second copy of it.
      equipped: crate.items.contents.at(-1)?.system?.equipped,
    };
  });
  check("...while the same crate WITH room accepts it, stowed",
    crateRoom.clicked === true && crateRoom.landed === true
      && crateRoom.state === "accepted" && crateRoom.equipped === false,
    JSON.stringify(crateRoom));

  /* ---- O. giving to something you already own settles in one click ------- */
  console.log("\nyour own container: one click, no waiting for yourself");
  // A FRESH item: by this point the earlier legs have given the giver's
  // original stock away, and "no item" would make this leg red for a reason
  // that has nothing to do with what it tests.
  await gm.evaluate(async () => {
    await game.actors.getName("ZZ Offer Giver")
      .createEmbeddedDocuments("Item", [{ name: "ZZ Stowable Rope", type: "item" }]);
  });
  await new Promise((r) => setTimeout(r, 700));
  const selfSettle = await (async () => {
    const drove = await offerViaPicker(alice, "ZZ Stowable Rope", "ZZ Offer Crate");
    await new Promise((r) => setTimeout(r, 1600));
    return {
      drove,
      ...(await alice.evaluate(() => {
        const crate = game.actors.getName("ZZ Offer Crate");
        const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
        const f = msg?.getFlag("air-bladder", "itemOffer");
        return {
          landed: crate.items.some((i) => i.name === "ZZ Stowable Rope"),
          state: f?.state,
          settled: f?.settled,
          // No Accept button should ever have been needed — the card is a
          // ledger line, not a question put to the person who asked it.
          acceptStillOffered: !!document
            .querySelector(`[data-message-id="${msg?.id}"] .cairn-offer-accept`),
        };
      })),
    };
  })();
  // ASSERT THE ITEM LANDED, not that a card posted: an early return inside the
  // accept would leave a perfectly good card and move nothing.
  check("the Give button settles at once on a container you own",
    selfSettle.drove === "clicked" && selfSettle.landed === true
      && selfSettle.state === "accepted" && selfSettle.settled === true
      && selfSettle.acceptStillOffered === false,
    JSON.stringify(selfSettle));


  /* ---- P. anything you own can GIVE -------------------------------------- */
  console.log("\nthe giver gate is ownership, not type");

  // The reversal (2026-09-10): "whoever owns the NPC should be able to open it
  // and give items without having to drag". The gate moved from
  // `type === "character"` to `isOwner` on both halves — the affordance on the
  // item and the enforcement in `canOfferItem`.
  await gm.evaluate(async () => {
    const npc = game.actors.getName("ZZ Offer NPC");
    // OBSERVER, not Limited: Alice has to SEE the item rows for "the control is
    // absent" to mean anything. On a Limited sheet there are no rows at all, so
    // the absence would be true of a feature that had never shipped.
    await npc.update({ [`ownership.${game.users.getName("Alice").id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER });
    await npc.createEmbeddedDocuments("Item", [
      { name: "ZZ NPC Sword", type: "weapon" },
      { name: "Fatigue", type: "item" },
    ]);
  });
  await new Promise((r) => setTimeout(r, 700));

  const npcGive = await gm.evaluate(async () => {
    const npc = game.actors.getName("ZZ Offer NPC");
    await npc.sheet.render(true);
    await new Promise((r) => setTimeout(r, 700));
    const root = npc.sheet.element;
    const rowOf = (name) => [...root.querySelectorAll(".cairn-items-list-row")]
      .find((r) => r.innerText.includes(name));
    const out = {
      sword: !!rowOf("ZZ NPC Sword")?.querySelector('a[data-action="itemGive"]'),
      fatigue: !!rowOf("Fatigue")?.querySelector('a[data-action="itemGive"]'),
    };
    await npc.sheet.close();
    return out;
  });

  check("the Warden's own npc sheet offers a Give control", npcGive.sword,
    npcGive.sword ? "" : "no itemGive anchor on the sword row");
  check("...and Fatigue on it still refuses", !npcGive.fatigue,
    npcGive.fatigue ? "Fatigue offered a Give control" : "");

  // THE OTHER HALF, and it is the half that makes the first one mean anything:
  // an absence alone also passes when the selector is wrong.
  const observerGive = await alice.evaluate(async () => {
    const npc = game.actors.getName("ZZ Offer NPC");
    if (!npc) return { seen: false };
    await npc.sheet.render(true);
    await new Promise((r) => setTimeout(r, 700));
    const root = npc.sheet.element;
    const row = [...root.querySelectorAll(".cairn-items-list-row")]
      .find((r) => r.innerText.includes("ZZ NPC Sword"));
    const out = {
      seen: true,
      isOwner: npc.isOwner,
      rowPresent: !!row,
      control: !!row?.querySelector('a[data-action="itemGive"]'),
    };
    await npc.sheet.close();
    return out;
  });

  check("a viewer who only OBSERVES the npc sees the row but no Give control",
    observerGive.seen && !observerGive.isOwner && observerGive.rowPresent && !observerGive.control,
    JSON.stringify(observerGive));

  // ...and the enforcement behind it, reached at the wire rather than through
  // the UI that is now absent.
  const observerRefused = await alice.evaluate(async () => {
    const { canOfferItem } = await import("/systems/air-bladder/module/item-offer.js");
    const npc = game.actors.getName("ZZ Offer NPC");
    const item = npc?.items.find((i) => i.name === "ZZ NPC Sword");
    return canOfferItem(item);
  });
  check("...and canOfferItem refuses it too", observerRefused?.ok === false,
    JSON.stringify(observerRefused));

  /* ---- Q. the Warden gives, and the PLAYER answers ----------------------- */
  console.log("\nthe Warden gives: one click only when nobody else could answer");

  // An unowned target first: nobody else has a say, so this settles at once.
  await gm.evaluate(async () => {
    const Cls = getDocumentClass("Actor");
    if (!game.actors.getName("ZZ Offer Innkeeper")) {
      await Cls.create({
        name: "ZZ Offer Innkeeper", type: "npc",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
      });
    }
  });
  await new Promise((r) => setTimeout(r, 600));

  const toUnowned = await gm.evaluate(async () => {
    const { createItemOffer, settleOwnOffer } = await import("/systems/air-bladder/module/item-offer.js");
    const npc = game.actors.getName("ZZ Offer NPC");
    const inn = game.actors.getName("ZZ Offer Innkeeper");
    const item = npc.items.find((i) => i.name === "ZZ NPC Sword");
    const message = await createItemOffer(npc, item, inn);
    await settleOwnOffer(message, inn);
    await new Promise((r) => setTimeout(r, 900));
    const f = message?.getFlag("air-bladder", "itemOffer");
    return {
      landed: inn.items.some((i) => i.name === "ZZ NPC Sword"),
      gone: !npc.items.some((i) => i.name === "ZZ NPC Sword"),
      settled: !!f?.settled,
      state: f?.state,
    };
  });

  check("the Warden gives to an unowned innkeeper in one click",
    toUnowned.landed && toUnowned.gone && toUnowned.settled && toUnowned.state === "accepted",
    JSON.stringify(toUnowned));

  // THE LEG THAT GUARDS THE RULING. A GM owns every actor, so the untightened
  // shortcut — `target.isOwner` alone — would deliver straight into a player's
  // pack with no card and no confirm, past the very dialog that exists to make
  // them consent to Hit Protection 0. Red under Part C's version of it.
  // BOB owns `ZZ Offer Target` in this suite, not Alice.
  await gm.evaluate(async () => {
    const npc = game.actors.getName("ZZ Offer NPC");
    await npc.createEmbeddedDocuments("Item", [{ name: "ZZ Warden Gift", type: "item" }]);
  });
  await new Promise((r) => setTimeout(r, 600));

  const toAlice = await gm.evaluate(async () => {
    const { createItemOffer, settleOwnOffer } = await import("/systems/air-bladder/module/item-offer.js");
    const npc = game.actors.getName("ZZ Offer NPC");
    const target = game.actors.getName("ZZ Offer Target");
    const item = npc.items.find((i) => i.name === "ZZ Warden Gift");
    const message = await createItemOffer(npc, item, target);
    await settleOwnOffer(message, target);
    await new Promise((r) => setTimeout(r, 900));
    const f = message?.getFlag("air-bladder", "itemOffer");
    return {
      id: message?.id,
      settled: !!f?.settled,
      state: f?.state,
      landedEarly: target.items.some((i) => i.name === "ZZ Warden Gift"),
      stillWithNpc: npc.items.some((i) => i.name === "ZZ Warden Gift"),
    };
  });

  check("giving to a PLAYER'S character waits for the player instead",
    !toAlice.settled && toAlice.state === "open" && !toAlice.landedEarly && toAlice.stillWithNpc,
    JSON.stringify(toAlice));

  // And the player's own click is what moves it. The card is rebuilt per
  // viewer, so the Accept button is theirs alone — the Warden's copy of the
  // same message offers Cancel.
  // POLLED. The card reaches her client over the socket and is rebuilt per
  // viewer at render, so a single read can land before either has happened —
  // and a leg that depends on winning a race is a race, not a leg.
  const bobSees = await poll(bob, (id) => {
    const row = document.querySelector(`.chat-message[data-message-id="${id}"]`);
    return row?.querySelector(".cairn-offer-accept") ? { accept: true } : null;
  }, toAlice.id);
  if (!bobSees?.accept) {
    const why = await bob.evaluate((id) => {
      const msg = game.messages.get(id);
      const f = msg?.getFlag("air-bladder", "itemOffer");
      const target = foundry.utils.fromUuidSync(f?.targetActorUuid ?? "");
      return {
        hasMsg: !!msg, state: f?.state, targetUuid: f?.targetActorUuid,
        resolved: !!target, owner: target?.testUserPermission?.(game.user, "OWNER"),
        rowInDom: !!document.querySelector(`.chat-message[data-message-id="${id}"]`),
      };
    }, toAlice.id);
    // Printed only on a miss. `owner:false` is the answer nine times in ten,
    // and it is invisible from the button state alone.
    console.log("  why   ", JSON.stringify(why));
  }
  check("...and the target's own player is the one offered Accept", !!bobSees?.accept,
    JSON.stringify(bobSees ?? (await cardButtons(bob, toAlice.id))));

  const clicked = await clickCard(bob, toAlice.id, "cairn-offer-accept");
  await new Promise((r) => setTimeout(r, 2000));
  const aliceAccepted = await gm.evaluate((id) => ({
    landed: game.actors.getName("ZZ Offer Target").items.some((i) => i.name === "ZZ Warden Gift"),
    state: game.messages.get(id)?.getFlag("air-bladder", "itemOffer")?.state,
  }), toAlice.id);

  check("...and their click is what moves it",
    clicked && aliceAccepted.landed && aliceAccepted.state === "accepted",
    JSON.stringify({ clicked, ...aliceAccepted }));

  /* ---- R. a card whose giver is gone reads "someone" --------------------- */
  // Monsters are unlinked by ruling, so an unlinked token giving is the
  // commonest case there is — and a synthetic actor's uuid resolves only while
  // its token exists, while the card is permanent and rebuilt per viewer FROM
  // that uuid. The mask is the same string a hidden target uses, so no name is
  // stored and no new player-authored field appears.
  const hiddenGiver = await gm.evaluate(async () => {
    const msg = game.messages.contents.filter((m) => m.getFlag("air-bladder", "itemOffer")).at(-1);
    if (!msg) return { skipped: "no offer card" };
    // Point the flag at a uuid that resolves to nothing, the way a deleted
    // token's does, and re-render the card the way a viewer would.
    const original = msg.getFlag("air-bladder", "itemOffer");
    await msg.setFlag("air-bladder", "itemOffer", {
      ...original, giverActorUuid: "Scene.zzzzzzzzzzzzzzzz.Token.zzzzzzzzzzzzzzzz.Actor.zzzzzzzzzzzzzzzz",
    });
    await new Promise((r) => setTimeout(r, 800));
    const el = document.querySelector(`[data-message-id="${msg.id}"]`);
    const text = el?.innerText ?? "";
    await msg.setFlag("air-bladder", "itemOffer", original);
    await new Promise((r) => setTimeout(r, 500));
    return { text, mask: game.i18n.localize("CAIRN.Offer.HiddenTarget") };
  });

  check("a card whose giver no longer resolves reads the mask, not a broken name",
    !hiddenGiver.skipped && hiddenGiver.text.includes(hiddenGiver.mask) && !hiddenGiver.text.includes("undefined"),
    JSON.stringify({ mask: hiddenGiver.mask, text: hiddenGiver.text?.slice(0, 120) }));

  /* ---- teardown ----------------------------------------------------------- */
  const swept = await gm.evaluate(async (before) => {
    const newActors = game.actors.filter((a) => !before.actors.includes(a.id));
    for (const a of newActors) await a.delete();
    const newMsgs = game.messages.filter((m) => !before.messages.includes(m.id));
    for (const m of newMsgs) await m.delete();
    return { actors: newActors.length, messages: newMsgs.length };
  }, before);
  console.log(`\n  note  swept ${swept.actors} actors, ${swept.messages} messages`);

  const allErrors = [...gmErrors, ...alErrors, ...bobErrors].filter((e) => !/ZZ /.test(e));
  check("zero console errors", allErrors.length === 0, allErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
console.log(failures ? `\nitem-offer e2e FAILED — ${failures}` : "\nitem-offer e2e passed");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * Transports acceptance probe: prove that transports are EDITABLE documents the
 * shop references (not an inlined price list), that buying one mints a
 * keeper-linked container Actor, and that the worn/mount slot distinction holds.
 *
 *   node tools/dev/transport-probe.mjs    (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. ONE pack: the shop's "Transports & Containers" table references the
 *      Mounts & Transports ACTOR pack for every row — 17 npc documents in 3
 *      folders (Containers / Mounts / Transports), the worn shapes included —
 *      and the legacy `transports` Item pack is asserted GONE. Capacity/cost
 *      are read off the referenced document.
 *   2. Buy a MOUNT (Mule): a connected NPC is created with the document's
 *      capacity, coins deducted, and the buyer's OWN slot usage is unchanged
 *      -- a mount carries its own pool.
 *   3. Buy a WORN container (Backpack): role container and hp 0/0 cross the till
 *      from its document. 3a: the till's LEGACY Item branch (old worlds'
 *      tables) still INFERS both from a synthesized transport-Item payload.
 *   3b. Buy a VEHICLE (Cart): role transport and hp 0/0 cross the till from the
 *      document -- the review-#5 stat-block guarantee.
 *   4. Edit the Mule ACTOR document's capacity in the pack, buy another, and
 *      assert the new NPC reflects the edit -- the reference guarantee.
 *   5. Buying refuses when the buyer cannot afford it.
 *   6. Everything bought is an npc now, so all of it is directory-visible.
 *   7. Revert the document and delete every actor the probe made.
 * Exits non-zero on any failed assertion or console error.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const mkt = await import("/systems/air-bladder/module/marketplace.js");
    const made = [];                      // actors to clean up

    // 1. ONE pack now: mounts-transports, npc Actors only. The legacy
    //    `transports` Item pack is dissolved — its worn shapes (Backpack,
    //    Sack) are Actor documents in a Containers folder, and every shop row
    //    references the Actor pack. Its continued absence is asserted: a
    //    resurrected Item pack would mean the dissolution regressed.
    const aPack = game.packs.get("air-bladder.mounts-transports");
    if (!aPack) return { error: "air-bladder.mounts-transports pack is not registered" };
    const aDocs = await aPack.getDocuments();
    const catalog = await mkt.getMarketplaceCatalog();
    const cat = (catalog.categories ?? []).find((c) => c.name === "Transports & Containers");
    if (!cat) return { error: "no 'Transports & Containers' category in the marketplace" };

    const mule = aDocs.find((d) => d.name === "Mule");
    const cartDoc = aDocs.find((d) => d.name === "Cart");
    const backpack = aDocs.find((d) => d.name === "Backpack");
    if (!mule || !cartDoc || !backpack) return { error: "Mule/Cart/Backpack missing from the mounts-transports pack" };

    const shopMule = cat.items.find((i) => i.name === "Mule");
    const setup = {
      legacyPackGone: !game.packs.get("air-bladder.transports"),
      actorCount: aDocs.filter((d) => d.documentName === "Actor" && d.type === "npc").length,
      // The pack holds two kinds: what the shop stocks, and the beasts a 2e
      // background rolls up. Both are editable documents; only the first kind
      // is for sale.
      stockedCount: aDocs.filter((d) => d.getFlag("air-bladder", "transportSource") === "2e").length,
      beastCount: aDocs.filter((d) => d.getFlag("air-bladder", "transportSource") === "background-2e").length,
      folderCount: aPack.folders.size,
      wornInContainers: ["Backpack", "Sack"].every((n) =>
        aDocs.find((d) => d.name === n)?.folder?.name === "Containers"),
      shopCount: cat.items.length,
      // THE review-#5 assertion: every shop row resolves to an Actor document.
      // `documentName` is what routes the buy.
      shopRowIsActor: shopMule?.documentName === "Actor",
      wornRowIsActor: cat.items.find((i) => i.name === "Backpack")?.documentName === "Actor",
      // The shop row must READ the document, not carry its own copy.
      shopReadsDoc: shopMule?.system.slots === mule.system.slots && shopMule?.system.cost === mule.system.cost,
      muleSlots: mule.system.slots,
      muleCost: mule.system.cost,
    };

    // A buyer with enough coins to shop.
    const buyer = await CONFIG.Actor.documentClass.create({
      name: "PROBE Buyer", type: "character", system: { gold: 500 },
    });
    made.push(buyer);
    const slotsBefore = buyer.system.slotsUsed;
    const goldBefore = buyer.system.gold;

    // 2. Buy the Mule (a mount). This is the exact call the shop's Buy button
    //    makes: acquireTransport(actor, <the payload that row was built from>, pay).
    if (!mkt.acquireTransport) return { error: "acquireTransport is not exported" };
    const buyThrough = (doc) =>
      mkt.acquireTransport(buyer, cat.items.find((i) => i.name === doc.name), true);
    await buyThrough(mule);

    // Buying now mints an NPC connected by `connectedTo` -- the same document kind
    // the Mounts & Transports pack ships, rather than a slots-only container.
    const muleActor = game.actors.find((a) => a.type === "npc" && a.name === "Mule" && a.system.connectedTo === buyer.uuid);
    if (muleActor) made.push(muleActor);
    const mount = {
      created: !!muleActor,
      capacity: muleActor?.system.slotsMax,
      capacityRight: muleActor?.system.slotsMax === mule.system.slots,
      kind: muleActor?.system.containerClass,
      // ONE link now, not two. The old model wrote the container's `keeper` AND
      // the buyer's `containers` array, and every container bug came from only
      // one of them landing. The owner's list is derived from `connectedTo`, so
      // "linked" and "listed" are the same fact read twice.
      keeperLinked: muleActor?.system.connectedTo === buyer.uuid,
      listedOnBuyer: (buyer.system.containerObjects ?? []).some((c) => c.id === muleActor?.id),
      paid: buyer.system.gold === goldBefore - mule.system.cost,
      // A mount carries its own pool: the buyer's own load must not change.
      buyerSlotsUnchanged: buyer.system.slotsUsed === slotsBefore,
    };

    // 3. Buy the Backpack (worn, an Actor row like everything else now): a worn
    //    container costs the carrier nothing and shows no inventory row -- it
    //    lives only on the Connections tab. Its document states role container
    //    and hp 0/0 outright, and both must cross the till. Literals on purpose
    //    -- an animate 6 HP Backpack is exactly what once shipped.
    const slotsBeforeWorn = buyer.system.slotsUsed;
    await buyThrough(backpack);
    const packActor = game.actors.find((a) => a.type === "npc" && a.name === "Backpack" && a.system.connectedTo === buyer.uuid);
    if (packActor) made.push(packActor);
    const worn = {
      created: !!packActor,
      slotsUnchanged: buyer.system.slotsUsed === slotsBeforeWorn,
      before: slotsBeforeWorn,
      got: buyer.system.slotsUsed,
      // No worn-container inventory row is produced any more.
      noRow: !(buyer.system.wornContainerRows ?? []).some((r) => r.name === "Backpack"),
      thing: packActor?.system.role === "container",
      hpZero: packActor?.system.hp.value === 0 && packActor?.system.hp.max === 0,
    };

    // 3a. The LEGACY Item branch of the till, kept for old worlds' tables. No
    //     shipped row exercises it any more, so a synthesized transport-Item
    //     payload does: it states neither `role` nor hp, and the till must
    //     INFER a worn thing at 0/0 rather than mint the phantom animate 6.
    await mkt.acquireTransport(buyer, {
      name: "PROBE Legacy Pack", documentName: "Item", type: "transport", img: null,
      system: { slots: 4, cost: 0, transportKind: "worn", description: "" },
    }, false);
    const legacyActor = game.actors.find((a) => a.type === "npc" && a.name === "PROBE Legacy Pack" && a.system.connectedTo === buyer.uuid);
    if (legacyActor) made.push(legacyActor);
    const legacy = {
      created: !!legacyActor,
      thing: legacyActor?.system.role === "container",
      hpZero: legacyActor?.system.hp.value === 0 && legacyActor?.system.hp.max === 0,
    };

    // 3b. Buy a Cart (vehicle, from the ACTOR pack): the stat block crosses the
    //     till. The Actor document states role transport and hp 0/0 outright;
    //     fed from the Item pack instead, the bought cart came out animate with
    //     the phantom 6 HP -- the shape review #5 caught.
    await buyThrough(cartDoc);
    const cartActor = game.actors.find((a) => a.type === "npc" && a.name === "Cart" && a.system.connectedTo === buyer.uuid);
    if (cartActor) made.push(cartActor);
    const vehicle = {
      created: !!cartActor,
      capacityRight: cartActor?.system.slotsMax === cartDoc.system.slots,
      thing: cartActor?.system.role === "transport",
      hpZero: cartActor?.system.hp.value === 0 && cartActor?.system.hp.max === 0,
      classCarried: cartActor?.system.containerClass === cartDoc.system.containerClass,
    };

    // 3c. Keeping is a TYPE privilege now (the flat graph, 2026-08-01): NOTHING
    //     npc-typed buys at this till any more. The mule refuses, the cart
    //     refuses, and the npc PERSON — a porter, who could buy until today —
    //     refuses too, which makes the porter the flat rule's fail-witness in
    //     the marketplace: he owns nothing else that would refuse him.
    const muleRow = cat.items.find((i) => i.name === "Mule");
    const nestKept = await mkt.acquireTransport(muleActor, muleRow, false);
    const nestThing = await mkt.acquireTransport(cartActor, muleRow, false);
    const porter = await CONFIG.Actor.documentClass.create({ name: "PROBE Porter", type: "npc" });
    made.push(porter);
    const porterRefused = await mkt.acquireTransport(porter, muleRow, false);
    const porterMule = game.actors.find((a) => a.name === "Mule" && a.system.connectedTo === porter.uuid);
    if (porterMule) made.push(porterMule);
    // In-page control: shadow the predicate open on the kept mule (an instance
    // property over the prototype getter; `delete` removes it) — the same buy
    // must then SUCCEED, proving the guard is what refused above rather than
    // some other wall (the cap wall sits behind it, and the mule keeps 0).
    Object.defineProperty(muleActor, "canKeepConnected", { value: true, configurable: true });
    const nestForced = await mkt.acquireTransport(muleActor, muleRow, false);
    delete muleActor.canKeepConnected;
    const nested = game.actors.find((a) => a.name === "Mule" && a.system.connectedTo === muleActor.uuid);
    if (nested) made.push(nested);
    const nesting = {
      keptRefused: nestKept === false,
      thingRefused: nestThing === false,
      personRefused: porterRefused === false && !porterMule,
      controlReproduced: nestForced === true && !!nested,
    };

    // 3d. The connection CEILING at the till: a buyer already keeping
    //     `maxConnections()` is refused BEFORE any gold moves. Seeded through
    //     creation data (connectActor would trip the same wall), witnessed
    //     below the cap: one child fewer and the SAME purchase lands.
    const { maxConnections } = await import("/systems/air-bladder/module/connections.js");
    const max = maxConnections();
    const capped = await CONFIG.Actor.documentClass.create({
      name: "PROBE Capped", type: "character", system: { gold: 500 },
    });
    made.push(capped);
    const capKids = [];
    for (let i = 0; i < max; i++) {
      capKids.push(await CONFIG.Actor.documentClass.create({
        name: `PROBE Cap Sack ${i}`, type: "npc",
        system: { role: "container", containerClass: "sack", connectedTo: capped.uuid, hp: { value: 0, max: 0 }, generationEnabled: false },
      }));
    }
    made.push(...capKids);
    const goldAtCap = capped.system.gold;
    const capRefused = await mkt.acquireTransport(capped, muleRow, true);
    const capMule = game.actors.find((a) => a.name === "Mule" && a.system.connectedTo === capped.uuid);
    // Read gold NOW — the witness purchase below is a real paid buy and
    // legitimately spends it.
    const goldAfterRefusal = capped.system.gold;
    await capKids[capKids.length - 1].delete();
    const capBelowLands = await mkt.acquireTransport(capped, muleRow, true);
    const belowMule = game.actors.find((a) => a.name === "Mule" && a.system.connectedTo === capped.uuid);
    if (belowMule) made.push(belowMule);
    const capLeg = {
      seeded: capKids.length === max,
      refused: capRefused === false && !capMule,
      goldIntact: goldAfterRefusal === goldAtCap,
      belowLands: capBelowLands === true && !!belowMule,
    };

    // 3e. THE NAMES IN THOSE TWO REFUSALS (review #16). Both toasts name the
    //     BUYER, and the buyer is a different kind of thing in each. The
    //     nesting wall answers a THING — a mule, a cart — whose name is
    //     overlay-translated like any creature's, and the toast has to agree
    //     with the sheet title it answers. The ceiling wall is reachable ONLY
    //     by a character (it sits BELOW canKeepConnected), so the name there is
    //     player-authored and must never be translated: the 2026-08-04 gate,
    //     which `actorDisplayName` is the one place to hold. Both sites read a
    //     bare t("monster.name") until now, so a PC named for a creature was
    //     renamed in a toast addressed to their own player.
    //
    //     The overlay is installed IN-PAGE (`_setOverlay`, the house pattern)
    //     with entries invented here — no world write, and no dependence on
    //     what the shipped Spanish pack happens to call a mule. Restored in a
    //     finally, or every leg after this one runs translated.
    const i18n = await import("/systems/air-bladder/module/i18n-content.js");
    const warns = [];
    const origWarn = ui.notifications.warn;
    ui.notifications.warn = (m, ...rest) => {
      warns.push(String(m));
      return origWarn.call(ui.notifications, m, ...rest);
    };
    // The token PC below is a WORLD actor with a token on a scene; both are
    // torn down, the scene first (deleting the actor under a live token leaves
    // the scene holding a dangling actorId).
    const tokenBase = await CONFIG.Actor.documentClass.create({
      name: "PROBE Token PC", type: "character",
    });
    made.push(tokenBase);
    let names;
    let tokenScene = null;
    try {
      i18n._setOverlay({ "monster.name": {
        "Mule": "PROBE Mula",
        "PROBE Capped": "PROBE Encajado",
        "PROBE Token PC": "PROBE Ficha",
      } });
      warns.length = 0;
      await mkt.acquireTransport(muleActor, muleRow, false);
      const nestToast = warns[warns.length - 1] ?? "";
      warns.length = 0;
      // TAKE, not buy: the gold wall sits ABOVE the ceiling wall, so a paid
      // attempt could be refused for the wrong reason and still read as a pass.
      // `capped` is back AT the cap here — 3d deleted one child and bought one.
      await mkt.acquireTransport(capped, muleRow, false);
      const capToast = warns[warns.length - 1] ?? "";
      warns.length = 0;
      // And a character can reach the NESTING toast after all: canKeepConnected
      // refuses an UNLINKED TOKEN outright (a synthetic actor is never a
      // keeper), so a token PC buying a mule is answered by the wall whose
      // buyer is "a thing" everywhere else. That is the branch the shared
      // helper exists for, and the only path in the marketplace that reaches
      // it — without this leg the nesting site's fix is untested.
      tokenScene = await CONFIG.Scene.documentClass.create({ name: "PROBE Token Scene" });
      const [tokDoc] = await tokenScene.createEmbeddedDocuments("Token", [
        { name: "PROBE Token PC", actorId: tokenBase.id, actorLink: false, x: 0, y: 0 },
      ]);
      const tokRefused = await mkt.acquireTransport(tokDoc.actor, muleRow, false);
      const tokToast = warns[warns.length - 1] ?? "";
      names = {
        overlayLive: i18n.contentLocalized(),
        // The token buy must actually have been REFUSED, or no toast fired and
        // the two assertions under it read an empty string as clean.
        tokenRefused: tokRefused === false,
        tokenEnglish: tokToast.includes("PROBE Token PC"),
        tokenNotTranslated: !tokToast.includes("PROBE Ficha"),
        tokToast,
        // The precondition, and it is the whole leg: if a THING's name does not
        // translate here, the overlay is not live and the PC assertion below
        // cannot fail no matter what the code does.
        thingTranslated: nestToast.includes("PROBE Mula"),
        pcEnglish: capToast.includes("PROBE Capped"),
        pcNotTranslated: !capToast.includes("PROBE Encajado"),
        nestToast,
        capToast,
      };
    } finally {
      i18n._setOverlay(null);
      ui.notifications.warn = origWarn;
      await tokenScene?.delete().catch(() => {});
    }

    // 4. Edit the Mule ACTOR document (the one the shop row references now);
    //    a newly bought one must reflect it -- the reference guarantee.
    const wasLocked = aPack.locked;
    if (wasLocked) await aPack.configure({ locked: false });
    const origSlots = mule.system.slots;
    await mule.update({ "system.slots": origSlots + 5 });
    const catalog2 = await mkt.getMarketplaceCatalog();
    const cat2 = catalog2.categories.find((c) => c.name === "Transports & Containers");
    await mkt.acquireTransport(buyer, cat2.items.find((i) => i.name === "Mule"), true);
    const mules = game.actors.filter((a) => a.type === "npc" && a.name === "Mule" && a.system.connectedTo === buyer.uuid);
    const newMule = mules[mules.length - 1];
    if (newMule && !made.includes(newMule)) made.push(newMule);
    const edit = {
      flowed: newMule?.system.slotsMax === origSlots + 5,
      got: newMule?.system.slotsMax,
      expected: origSlots + 5,
    };
    await mule.update({ "system.slots": origSlots });
    if (wasLocked) await aPack.configure({ locked: true });

    // 5. Affordability: a pauper cannot buy a Wagon.
    const pauper = await CONFIG.Actor.documentClass.create({
      name: "PROBE Pauper", type: "character", system: { gold: 1 },
    });
    made.push(pauper);
    const catalog3 = await mkt.getMarketplaceCatalog();
    const cat3 = catalog3.categories.find((c) => c.name === "Transports & Containers");
    const refused = await mkt.acquireTransport(pauper, cat3.items.find((i) => i.name === "Wagon"), true);
    const afford = {
      refused: refused === false,
      noActor: !game.actors.find((a) => a.system.connectedTo === pauper.uuid),
      goldIntact: pauper.system.gold === 1,
    };

    // 6. Directory visibility, driven through the REAL rendered sidebar.
    //
    //    INVERTED 2026-08-02: `show-container-actors` is REMOVED by ruling
    //    ("this feature should always be on and should never be disabled"), so
    //    the claim is now unconditional — a bought mount AND a bought worn
    //    pack are BOTH always listed, with no setting to write and no hidden
    //    class to earn. Red witness: pre-removal code hides the worn pack
    //    when the setting is off. The grayscale rule survives independently.
    const dirRow = (id) => document.querySelector(
      `#actors [data-entry-id="${id}"], #actors [data-document-id="${id}"]`);
    await (ui.actors ?? ui.sidebar?.tabs?.actors)?.render(true);
    await new Promise((r) => setTimeout(r, 900));
    const directory = {
      mount: dirRow(muleActor?.id)?.classList.contains("hidden") === false,
      worn: dirRow(packActor?.id)?.classList.contains("hidden") === false,
      // The thumbnail must be greyed to match the sheet, on the role.
      mountGrey: dirRow(muleActor?.id)?.classList.contains("cairn-grayscale-portrait") ?? false,
      settingGone: game.settings.settings.get("air-bladder.show-container-actors") === undefined,
    };

    for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
    return { setup, mount, worn, legacy, vehicle, nesting, capLeg, names, edit, afford, directory };
  });

  if (r.error) {
    fail(r.error);
  } else {
    console.log(`  pack: ${r.setup.actorCount} npc Actors; shop lists ${r.setup.shopCount}`);
    r.setup.legacyPackGone
      ? ok("the legacy transports Item pack is GONE", "dissolved into the Actor pack")
      : fail("the legacy transports Item pack is registered again", "the dissolution regressed");
    r.setup.actorCount === 17
      ? ok("17 npc Actors in mounts-transports", "13 mounts/vehicles + Backpack + Sack + Falcon + Raven")
      : fail(`expected 17 Actors in mounts-transports, got ${r.setup.actorCount}`);
    r.setup.folderCount === 3 && r.setup.wornInContainers
      ? ok("3 folders, worn shapes in Containers")
      : fail(`folders=${r.setup.folderCount}, wornInContainers=${r.setup.wornInContainers}`);
    r.setup.stockedCount === 7 && r.setup.shopCount === 7
      ? ok("7 stocked, and the shop lists all 7")
      : fail(`expected 7 stocked / 7 shop rows, got ${r.setup.stockedCount}/${r.setup.shopCount}`);
    // Covered in depth by tools/dev/bg-container-probe.mjs; asserted here so a
    // beast can never leak into the shop unnoticed.
    r.setup.beastCount === 10
      ? ok("10 background-granted beasts share the pack but not the shop", "incl. round 6's Falcon and Raven")
      : fail(`expected 10 beasts, got ${r.setup.beastCount}`);
    r.setup.shopRowIsActor ? ok("a mount's shop row resolves to the ACTOR document") : fail("the Mule shop row does not resolve to an Actor");
    r.setup.wornRowIsActor ? ok("a worn shape's row resolves to the ACTOR document too") : fail("the Backpack row does not resolve to the Actor pack");
    r.setup.shopReadsDoc ? ok(`shop reads the document (Mule +${r.setup.muleSlots}, ${r.setup.muleCost}gp)`) : fail("shop row does not match the document");

    r.mount.created ? ok("buying a mount minted a connected NPC") : fail("no connected NPC was created");
    r.mount.capacityRight ? ok(`mount capacity ${r.mount.capacity} matches the document`) : fail(`mount capacity ${r.mount.capacity} != document`);
    r.mount.keeperLinked && r.mount.listedOnBuyer ? ok("connected, and derived onto the buyer's tab") : fail("connectedTo is missing, or the buyer's list did not derive it");
    r.mount.paid ? ok("coins deducted") : fail("coins were not deducted correctly");
    r.mount.buyerSlotsUnchanged ? ok("a MOUNT costs the buyer no slots (carries its own pool)") : fail("buying a mount changed the buyer's slot usage");

    r.worn.created ? ok("buying a worn container minted a connected NPC") : fail("no worn container NPC created");
    r.worn.slotsUnchanged ? ok(`a worn container costs its carrier no slots (${r.worn.before} -> ${r.worn.got})`) : fail(`worn container charged the carrier: ${r.worn.before} -> ${r.worn.got}`);
    r.worn.noRow ? ok("a worn container shows no inventory row (reached via the Containers tab)") : fail("a worn container still shows an inventory row");
    r.worn.thing && r.worn.hpZero
      ? ok("a bought Backpack is role container with hp 0/0 (stated by its document)")
      : fail(`a bought Backpack came out wrong: thing=${r.worn.thing}, hpZero=${r.worn.hpZero}`);

    r.legacy.created && r.legacy.thing && r.legacy.hpZero
      ? ok("the LEGACY Item branch still infers: worn Item row -> container, hp 0/0")
      : fail(`legacy Item till-inference broken: ${JSON.stringify(r.legacy)}`);

    r.vehicle.created && r.vehicle.capacityRight ? ok("buying a Cart minted a connected NPC with the document's capacity") : fail(`Cart buy wrong: ${JSON.stringify(r.vehicle)}`);
    r.vehicle.thing && r.vehicle.hpZero
      ? ok("the Cart's stat block crossed the till: role transport, hp 0/0 (not the phantom 6)")
      : fail(`the Cart came out animate or with phantom HP: thing=${r.vehicle.thing}, hpZero=${r.vehicle.hpZero}`);
    r.vehicle.classCarried ? ok("containerClass carried from the document") : fail("containerClass was not carried");

    r.nesting.keptRefused ? ok("KEEPING IS TYPE-GATED: a mule refuses to buy a carrier") : fail("a mule bought a carrier — a mount can keep");
    r.nesting.thingRefused ? ok("KEEPING IS TYPE-GATED: a cart refuses too") : fail("a cart bought a carrier");
    r.nesting.personRefused
      ? ok("an npc PERSON is refused at the till now", "the flat graph's fail-witness in the marketplace")
      : fail("a porter bought a mule — the flat rule is not at the till");
    r.nesting.controlReproduced
      ? ok("NEGATIVE CONTROL: predicate forced open, the same buy succeeds")
      : fail("negative control MISSED — something other than the guard refused the nested buy");

    r.capLeg.seeded && r.capLeg.refused && r.capLeg.goldIntact
      ? ok("a buyer at the connection ceiling is refused, gold intact")
      : fail(`the cap did not hold at the till: ${JSON.stringify(r.capLeg)}`);
    r.capLeg.belowLands
      ? ok("   witness: one child fewer and the same purchase lands")
      : fail(`below the cap the buy still refused — the refusal was not the count: ${JSON.stringify(r.capLeg)}`);

    r.names.overlayLive && r.names.thingTranslated
      ? ok("   precondition: with the overlay live a THING's name DOES translate", `"${r.names.nestToast}"`)
      : fail(`the overlay is not reaching the nesting toast, so the PC leg below is vacuous: ${JSON.stringify(r.names)}`);
    r.names.pcEnglish && r.names.pcNotTranslated
      ? ok("   a PC's name is NEVER run through the monster overlay", "the ceiling toast is reachable by characters only")
      : fail(`the ceiling toast renamed the buyer: "${r.names.capToast}"`);
    r.names.tokenRefused
      ? ok("   precondition: an unlinked token PC IS refused at the nesting wall")
      : fail("an unlinked token PC bought a mule — no toast fired, the leg below is vacuous");
    r.names.tokenEnglish && r.names.tokenNotTranslated
      ? ok("   and the nesting toast leaves a token PC's name alone too")
      : fail(`the nesting toast renamed a token PC: "${r.names.tokToast}"`);

    r.edit.flowed ? ok(`EDIT FLOWS THROUGH: capacity ${r.edit.expected} on the next one bought`) : fail(`document edit did not flow through (got ${r.edit.got}, expected ${r.edit.expected})`);

    r.afford.refused && r.afford.noActor && r.afford.goldIntact ? ok("an unaffordable transport is refused, mints nothing, spends nothing") : fail("affordability check did not hold");

    r.directory.mount && r.directory.worn
      ? ok("mount AND worn pack are both always listed", "no hide setting exists any more")
      : fail("mount AND worn pack are both always listed", JSON.stringify(r.directory));
    r.directory.settingGone
      ? ok("show-container-actors is unregistered", "removed by ruling, 2026-08-02")
      : fail("show-container-actors is still registered", "the setting was supposed to be removed");
    r.directory.mountGrey
      ? ok("the carrier's thumbnail is greyed", "matches its sheet")
      : fail("the carrier's thumbnail is greyed", "directory reads colour where the sheet reads grey");
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nTRANSPORT PROBE FAILED\n" : "\ntransport probe passed\n");
process.exit(failed ? 1 : 0);

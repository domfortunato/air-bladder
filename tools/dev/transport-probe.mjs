#!/usr/bin/env node
/**
 * Transports acceptance probe: prove that transports are EDITABLE documents the
 * shop references (not an inlined price list), that buying one mints a
 * keeper-linked container Actor, and that the worn/mount slot distinction holds.
 *
 *   node tools/dev/transport-probe.mjs    (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. The shop's "Transports & Containers" table references the Mounts &
 *      Transports ACTOR pack for mounts/vehicles (13 npc documents) and the
 *      legacy `transports` Item pack for the worn shapes (Backpack, Sack),
 *      and reads capacity/cost off the referenced document either way.
 *   2. Buy a MOUNT (Mule): a connected NPC is created with the document's
 *      capacity, coins deducted, and the buyer's OWN slot usage is unchanged
 *      -- a mount carries its own pool.
 *   3. Buy a WORN container (Backpack, an Item row): inanimate with hp 0/0 is
 *      INFERRED at the till, because the Item states neither.
 *   3b. Buy a VEHICLE (Cart, an Actor row): inanimate and hp 0/0 cross the till
 *      from the document -- the review-#5 stat-block guarantee.
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

    // 1. The two packs + the shop table. Mount/vehicle rows reference the ACTOR
    //    pack now (that is where the stat block lives); only the worn shapes —
    //    Backpack, Sack — still reference the legacy Item pack, because they
    //    are CONTAINER_CLASSES rows with no Actor document on purpose.
    const pack = game.packs.get("air-bladder.transports");
    if (!pack) return { error: "air-bladder.transports pack is not registered" };
    const aPack = game.packs.get("air-bladder.mounts-transports");
    if (!aPack) return { error: "air-bladder.mounts-transports pack is not registered" };
    const docs = await pack.getDocuments();
    const aDocs = await aPack.getDocuments();
    const catalog = await mkt.getMarketplaceCatalog();
    const cat = (catalog.categories ?? []).find((c) => c.name === "Transports & Containers");
    if (!cat) return { error: "no 'Transports & Containers' category in the marketplace" };

    const mule = aDocs.find((d) => d.name === "Mule");
    const cartDoc = aDocs.find((d) => d.name === "Cart");
    const backpack = docs.find((d) => d.name === "Backpack");
    if (!mule || !cartDoc) return { error: "Mule/Cart missing from the mounts-transports pack" };
    if (!backpack) return { error: "Backpack missing from the transports pack" };

    const shopMule = cat.items.find((i) => i.name === "Mule");
    const setup = {
      packCount: docs.length,
      // The Item pack still holds two kinds (shop-stocked + background beasts),
      // as mounts.mjs's source material and for old worlds' tables.
      stockedCount: docs.filter((d) => d.getFlag("air-bladder", "transportSource") === "2e").length,
      beastCount: docs.filter((d) => d.getFlag("air-bladder", "transportSource") === "background-2e").length,
      allTransportType: docs.every((d) => d.type === "transport"),
      actorCount: aDocs.filter((d) => d.documentName === "Actor").length,
      shopCount: cat.items.length,
      // THE review-#5 assertion: a mount's shop row resolves to the Actor
      // document, not the legacy Item. `documentName` is what routes the buy.
      shopRowIsActor: shopMule?.documentName === "Actor",
      wornRowIsItem: cat.items.find((i) => i.name === "Backpack")?.documentName === "Item",
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
      kind: muleActor?.system.transportKind,
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

    // 3. Buy the Backpack (worn): a worn container costs the carrier nothing and
    //    shows no inventory row -- it lives only on the Containers tab.
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
      // The Item row carries no `inanimate` and no hp, so both are INFERRED at
      // the till: a worn pack is a thing, and a thing gets 0/0, not the schema's
      // default 6. Literals on purpose -- an animate 6 HP Backpack is exactly
      // what shipped before the inference existed.
      inanimate: packActor?.system.inanimate === true,
      hpZero: packActor?.system.hp.value === 0 && packActor?.system.hp.max === 0,
    };

    // 3b. Buy a Cart (vehicle, from the ACTOR pack): the stat block crosses the
    //     till. The Actor document states inanimate:true and hp 0/0 outright;
    //     fed from the Item pack instead, the bought cart came out animate with
    //     the phantom 6 HP -- the shape review #5 caught.
    await buyThrough(cartDoc);
    const cartActor = game.actors.find((a) => a.type === "npc" && a.name === "Cart" && a.system.connectedTo === buyer.uuid);
    if (cartActor) made.push(cartActor);
    const vehicle = {
      created: !!cartActor,
      capacityRight: cartActor?.system.slotsMax === cartDoc.system.slots,
      inanimate: cartActor?.system.inanimate === true,
      hpZero: cartActor?.system.hp.value === 0 && cartActor?.system.hp.max === 0,
      classCarried: cartActor?.system.containerClass === cartDoc.system.containerClass,
    };

    // 3c. NO NESTING, restated for a world without a container type: a thing
    //     that is KEPT cannot keep (the buyer's mule refuses a second mule,
    //     whatever it is), an INANIMATE thing cannot keep (the cart refuses),
    //     and a free-standing animate npc — a porter, a hireling — still can,
    //     exactly as a character can. The old guard tested type==="container"
    //     and matched none of these (review #5).
    const muleRow = cat.items.find((i) => i.name === "Mule");
    const nestKept = await mkt.acquireTransport(muleActor, muleRow, false);
    const nestThing = await mkt.acquireTransport(cartActor, muleRow, false);
    const porter = await CONFIG.Actor.documentClass.create({ name: "PROBE Porter", type: "npc" });
    made.push(porter);
    const porterCan = await mkt.acquireTransport(porter, muleRow, false);
    const porterMule = game.actors.find((a) => a.name === "Mule" && a.system.connectedTo === porter.uuid);
    if (porterMule) made.push(porterMule);
    // In-page control: shadow the predicate open on the kept mule (an instance
    // property over the prototype getter; `delete` removes it) — the same buy
    // must then SUCCEED, proving the guard is what refused above rather than
    // some other wall.
    Object.defineProperty(muleActor, "canKeepConnected", { value: true, configurable: true });
    const nestForced = await mkt.acquireTransport(muleActor, muleRow, false);
    delete muleActor.canKeepConnected;
    const nested = game.actors.find((a) => a.name === "Mule" && a.system.connectedTo === muleActor.uuid);
    if (nested) made.push(nested);
    const nesting = {
      keptRefused: nestKept === false,
      thingRefused: nestThing === false,
      personAllowed: porterCan === true && !!porterMule,
      controlReproduced: nestForced === true && !!nested,
    };

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

    // 6. Directory visibility. Bought carriers are npc documents now, so they
    //    appear in the Actors directory like any other NPC -- which is what the
    //    user asked for ("as long as I see it in the actors tab"). The old rule
    //    hid `container` actors unless their transportKind was mount/vehicle;
    //    there is nothing left for it to hide.
    const visible = (a) => a.type !== "container";
    const directory = {
      mountShown: muleActor ? visible(muleActor) : false,
      wornShown: packActor ? visible(packActor) : false,
    };

    for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
    return { setup, mount, worn, vehicle, nesting, edit, afford, directory };
  });

  if (r.error) {
    fail(r.error);
  } else {
    console.log(`  pack: ${r.setup.packCount} transports; shop lists ${r.setup.shopCount}`);
    r.setup.stockedCount === 7 && r.setup.shopCount === 7
      ? ok("7 transport documents shipped, and the shop stocks all 7")
      : fail(`expected 7 stocked transports in pack and shop, got ${r.setup.stockedCount}/${r.setup.shopCount}`);
    // Covered in depth by tools/dev/bg-container-probe.mjs; asserted here so a
    // beast can never leak into the shop unnoticed.
    r.setup.beastCount === 8 && r.setup.packCount === 15
      ? ok("8 background-granted beasts share the pack but not the shop")
      : fail(`expected 8 beasts / 15 docs, got ${r.setup.beastCount}/${r.setup.packCount}`);
    r.setup.allTransportType ? ok("all are the `transport` Item type") : fail("some pack docs are not type transport");
    r.setup.actorCount === 13 ? ok("13 npc Actors in mounts-transports") : fail(`expected 13 Actors in mounts-transports, got ${r.setup.actorCount}`);
    r.setup.shopRowIsActor ? ok("a mount's shop row resolves to the ACTOR document") : fail("the Mule shop row still resolves to the legacy Item");
    r.setup.wornRowIsItem ? ok("a worn shape's row stays on the Item pack (no Actor doc by design)") : fail("the Backpack row does not resolve to the Item pack");
    r.setup.shopReadsDoc ? ok(`shop reads the document (Mule +${r.setup.muleSlots}, ${r.setup.muleCost}gp)`) : fail("shop row does not match the document");

    r.mount.created ? ok("buying a mount minted a connected NPC") : fail("no connected NPC was created");
    r.mount.capacityRight ? ok(`mount capacity ${r.mount.capacity} matches the document`) : fail(`mount capacity ${r.mount.capacity} != document`);
    r.mount.keeperLinked && r.mount.listedOnBuyer ? ok("connected, and derived onto the buyer's tab") : fail("connectedTo is missing, or the buyer's list did not derive it");
    r.mount.paid ? ok("coins deducted") : fail("coins were not deducted correctly");
    r.mount.buyerSlotsUnchanged ? ok("a MOUNT costs the buyer no slots (carries its own pool)") : fail("buying a mount changed the buyer's slot usage");

    r.worn.created ? ok("buying a worn container minted a connected NPC") : fail("no worn container NPC created");
    r.worn.slotsUnchanged ? ok(`a worn container costs its carrier no slots (${r.worn.before} -> ${r.worn.got})`) : fail(`worn container charged the carrier: ${r.worn.before} -> ${r.worn.got}`);
    r.worn.noRow ? ok("a worn container shows no inventory row (reached via the Containers tab)") : fail("a worn container still shows an inventory row");
    r.worn.inanimate && r.worn.hpZero
      ? ok("a bought Backpack is inanimate with hp 0/0 (inferred at the till)")
      : fail(`a bought Backpack came out wrong: inanimate=${r.worn.inanimate}, hpZero=${r.worn.hpZero}`);

    r.vehicle.created && r.vehicle.capacityRight ? ok("buying a Cart minted a connected NPC with the document's capacity") : fail(`Cart buy wrong: ${JSON.stringify(r.vehicle)}`);
    r.vehicle.inanimate && r.vehicle.hpZero
      ? ok("the Cart's stat block crossed the till: inanimate, hp 0/0 (not the phantom 6)")
      : fail(`the Cart came out animate or with phantom HP: inanimate=${r.vehicle.inanimate}, hpZero=${r.vehicle.hpZero}`);
    r.vehicle.classCarried ? ok("containerClass carried from the document") : fail("containerClass was not carried");

    r.nesting.keptRefused ? ok("NO NESTING: a kept mule refuses to buy a carrier") : fail("a kept mule bought a carrier — chain nesting is open");
    r.nesting.thingRefused ? ok("NO NESTING: an inanimate cart refuses too") : fail("an inanimate cart bought a carrier");
    r.nesting.personAllowed ? ok("a free-standing npc person can still keep a mule") : fail("the nesting guard over-blocks: a porter cannot buy a mule");
    r.nesting.controlReproduced
      ? ok("NEGATIVE CONTROL: predicate forced open, the same buy succeeds")
      : fail("negative control MISSED — something other than the guard refused the nested buy");

    r.edit.flowed ? ok(`EDIT FLOWS THROUGH: capacity ${r.edit.expected} on the next one bought`) : fail(`document edit did not flow through (got ${r.edit.got}, expected ${r.edit.expected})`);

    r.afford.refused && r.afford.noActor && r.afford.goldIntact ? ok("an unaffordable transport is refused, mints nothing, spends nothing") : fail("affordability check did not hold");

    r.directory.mountShown ? ok("mounts are directory-visible") : fail("mount would be hidden from the directory");
    r.directory.wornShown ? ok("so are worn containers -- everything bought is an npc now") : fail("a bought container would be hidden");
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

#!/usr/bin/env node
/**
 * Transports acceptance probe: prove that transports are EDITABLE documents the
 * shop references (not an inlined price list), that buying one mints a
 * keeper-linked container Actor, and that the worn/mount slot distinction holds.
 *
 *   node tools/dev/transport-probe.mjs    (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. The `transports` pack holds the 7 documents; the shop's "Transports &
 *      Containers" table references them and reads capacity/cost off the doc.
 *   2. Buy a MOUNT (Mule): a container Actor is created with the document's
 *      capacity, keeper-linked to the buyer, coins deducted, and the buyer's
 *      OWN slot usage is unchanged -- a mount carries its own pool.
 *   3. Buy a WORN container (Backpack): the buyer's slot usage rises by `load`,
 *      and the sheet shows a worn-container row explaining the cost.
 *   4. Edit the Mule document's capacity in the pack, buy another, and assert the
 *      new container reflects the edit -- the reference guarantee.
 *   5. Buying refuses when the buyer cannot afford it.
 *   6. Mounts/vehicles are directory-visible; worn containers stay hidden.
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

    // 1. The pack + the shop table that references it.
    const pack = game.packs.get("air-bladder.transports");
    if (!pack) return { error: "air-bladder.transports pack is not registered" };
    const docs = await pack.getDocuments();
    const catalog = await mkt.getMarketplaceCatalog();
    const cat = (catalog.categories ?? []).find((c) => c.name === "Transports & Containers");
    if (!cat) return { error: "no 'Transports & Containers' category in the marketplace" };

    const mule = docs.find((d) => d.name === "Mule");
    const backpack = docs.find((d) => d.name === "Backpack");
    if (!mule || !backpack) return { error: "Mule/Backpack missing from the transports pack" };

    const shopMule = cat.items.find((i) => i.name === "Mule");
    const setup = {
      packCount: docs.length,
      // The pack holds two kinds: what the shop stocks, and the beasts a 2e
      // background rolls up (Outrider's horses, the Bonekeeper's burial wagon).
      // Both are editable documents; only the first kind is for sale.
      stockedCount: docs.filter((d) => d.getFlag("air-bladder", "transportSource") === "2e").length,
      beastCount: docs.filter((d) => d.getFlag("air-bladder", "transportSource") === "background-2e").length,
      allTransportType: docs.every((d) => d.type === "transport"),
      shopCount: cat.items.length,
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

    const muleActor = game.actors.find((a) => a.type === "container" && a.name === "Mule" && a.system.keeper === buyer.uuid);
    if (muleActor) made.push(muleActor);
    const mount = {
      created: !!muleActor,
      capacity: muleActor?.system.slotsMax,
      capacityRight: muleActor?.system.slotsMax === mule.system.slots,
      kind: muleActor?.system.transportKind,
      keeperLinked: muleActor?.system.keeper === buyer.uuid,
      listedOnBuyer: (buyer.system.containers ?? []).includes(muleActor?.uuid),
      paid: buyer.system.gold === goldBefore - mule.system.cost,
      // A mount carries its own pool: the buyer's own load must not change.
      buyerSlotsUnchanged: buyer.system.slotsUsed === slotsBefore,
    };

    // 3. Buy the Backpack (worn): a worn container costs the carrier nothing and
    //    shows no inventory row -- it lives only on the Containers tab.
    const slotsBeforeWorn = buyer.system.slotsUsed;
    await buyThrough(backpack);
    const packActor = game.actors.find((a) => a.type === "container" && a.name === "Backpack" && a.system.keeper === buyer.uuid);
    if (packActor) made.push(packActor);
    const worn = {
      created: !!packActor,
      slotsUnchanged: buyer.system.slotsUsed === slotsBeforeWorn,
      before: slotsBeforeWorn,
      got: buyer.system.slotsUsed,
      // No worn-container inventory row is produced any more.
      noRow: !(buyer.system.wornContainerRows ?? []).some((r) => r.name === "Backpack"),
    };

    // 4. Edit the Mule document; a newly bought one must reflect it.
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });
    const origSlots = mule.system.slots;
    await mule.update({ "system.slots": origSlots + 5 });
    const catalog2 = await mkt.getMarketplaceCatalog();
    const cat2 = catalog2.categories.find((c) => c.name === "Transports & Containers");
    await mkt.acquireTransport(buyer, cat2.items.find((i) => i.name === "Mule"), true);
    const mules = game.actors.filter((a) => a.type === "container" && a.name === "Mule" && a.system.keeper === buyer.uuid);
    const newMule = mules[mules.length - 1];
    if (newMule && !made.includes(newMule)) made.push(newMule);
    const edit = {
      flowed: newMule?.system.slotsMax === origSlots + 5,
      got: newMule?.system.slotsMax,
      expected: origSlots + 5,
    };
    await mule.update({ "system.slots": origSlots });
    if (wasLocked) await pack.configure({ locked: true });

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
      noActor: !game.actors.find((a) => a.type === "container" && a.system.keeper === pauper.uuid),
      goldIntact: pauper.system.gold === 1,
    };

    // 6. Directory visibility rule (the predicate cairn.js applies).
    const visible = (a) => {
      const kind = a.system?.transportKind;
      return !(a.type === "container" && !(kind === "mount" || kind === "vehicle"));
    };
    const directory = {
      mountShown: muleActor ? visible(muleActor) : false,
      wornHidden: packActor ? !visible(packActor) : false,
    };

    for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
    return { setup, mount, worn, edit, afford, directory };
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
    r.setup.shopReadsDoc ? ok(`shop reads the document (Mule +${r.setup.muleSlots}, ${r.setup.muleCost}gp)`) : fail("shop row does not match the document");

    r.mount.created ? ok("buying a mount minted a container Actor") : fail("no container Actor was created");
    r.mount.capacityRight ? ok(`mount capacity ${r.mount.capacity} matches the document`) : fail(`mount capacity ${r.mount.capacity} != document`);
    r.mount.keeperLinked && r.mount.listedOnBuyer ? ok("keeper-linked both ways (container.keeper + buyer.containers)") : fail("keeper link is one-sided or missing");
    r.mount.paid ? ok("coins deducted") : fail("coins were not deducted correctly");
    r.mount.buyerSlotsUnchanged ? ok("a MOUNT costs the buyer no slots (carries its own pool)") : fail("buying a mount changed the buyer's slot usage");

    r.worn.created ? ok("buying a worn container minted a container Actor") : fail("no worn container Actor created");
    r.worn.slotsUnchanged ? ok(`a worn container costs its carrier no slots (${r.worn.before} -> ${r.worn.got})`) : fail(`worn container charged the carrier: ${r.worn.before} -> ${r.worn.got}`);
    r.worn.noRow ? ok("a worn container shows no inventory row (reached via the Containers tab)") : fail("a worn container still shows an inventory row");

    r.edit.flowed ? ok(`EDIT FLOWS THROUGH: capacity ${r.edit.expected} on the next one bought`) : fail(`document edit did not flow through (got ${r.edit.got}, expected ${r.edit.expected})`);

    r.afford.refused && r.afford.noActor && r.afford.goldIntact ? ok("an unaffordable transport is refused, mints nothing, spends nothing") : fail("affordability check did not hold");

    r.directory.mountShown ? ok("mounts/vehicles are directory-visible") : fail("mount would be hidden from the directory");
    r.directory.wornHidden ? ok("worn containers stay hidden (reached via the Containers tab)") : fail("worn container would show in the directory");
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

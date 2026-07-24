#!/usr/bin/env node
/**
 * Phase 3 acceptance probe: the marketplace is a REFERENCE catalog over the
 * editable gear pool, so editing a pool item's cost/description updates the shop.
 *
 *   node tools/dev/marketplace-probe.mjs   (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. Read the shop via module/marketplace.js getMarketplaceCatalog(); assert the
 *      three categories resolve every reference (Weapons 15, Armor 6, Gear 49) and
 *      that prices are read off the items (Dagger 5, Plate Mail 60), plus a bundle
 *      with its rename nudge.
 *   2. Edit the pool Dagger in place (cost → 99, stamp a description marker) with
 *      the pack unlocked, re-read the catalog, assert the shop reflects BOTH edits.
 *      Revert.
 *   3. Buy flow: a temp character buys the Dagger (gold deducted, item added) and
 *      Takes a bundle for free (added, gold unchanged). Clean up.
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
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const poll = async (fn, tries = 60, ms = 50) => {
      for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(ms); }
      return false;
    };
    const catItems = (cat, name) => cat?.categories.find((c) => c.name === name)?.items ?? [];
    const find = (cat, name, itemName) => catItems(cat, name).find((i) => i.name === itemName);

    // 1. Read the shop.
    const cat = await mkt.getMarketplaceCatalog();
    const counts = Object.fromEntries((cat.categories ?? []).map((c) => [c.name, c.items.length]));
    const dagger = find(cat, "Weapons", "Dagger");
    const plate = find(cat, "Armor", "Plate Mail");
    const bundle = catItems(cat, "Gear").find((i) => /^Common Tools/.test(i.name));

    const listing = {
      categories: (cat.categories ?? []).map((c) => c.name),
      counts,
      daggerCost: dagger?.system.cost,
      plateCost: plate?.system.cost,
      bundleName: bundle?.name,
      bundleCost: bundle?.system.cost,
      bundleNudge: /rename this/i.test(bundle?.system.description ?? ""),
    };

    // 2. Edit the pool Dagger; re-read; assert the shop reflects it.
    const pack = game.packs.get("air-bladder.weapons");
    const poolDagger = (await pack.getDocuments()).find((d) => d.name === "Dagger");
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });
    const origCost = poolDagger.system.cost;
    const origDesc = poolDagger.system.description ?? "";
    const marker = "PROBE-MKT-MARKER-7";
    await poolDagger.update({ "system.cost": 99, "system.description": marker });

    const cat2 = await mkt.getMarketplaceCatalog();
    const dagger2 = find(cat2, "Weapons", "Dagger");
    const reflect = {
      cost: dagger2?.system.cost,
      reflectsCost: dagger2?.system.cost === 99,
      reflectsDesc: (dagger2?.system.description ?? "").includes(marker),
    };
    await poolDagger.update({ "system.cost": origCost, "system.description": origDesc });
    if (wasLocked) await pack.configure({ locked: true });

    // 3. Buy flow with a temp character.
    const actor = await Actor.create({ type: "character", name: "MKT Probe", system: { gold: 100 } });
    await mkt.openMarketplace(actor);
    await poll(() => document.querySelector(".marketplace .mkt-row"));

    // Buy is two async steps in acquire() — add the item, THEN deduct gold — so
    // wait for the gold update to settle before reading it, not just the item.
    const buyBtn = document.querySelector('.marketplace .mkt-row[data-name="dagger"] .mkt-buy');
    buyBtn?.click();
    const bought = await poll(() => !!actor.items.find((i) => i.name === "Dagger"));
    await poll(() => actor.system.gold === 100 - origCost);
    const goldAfterBuy = actor.system.gold;

    const takeBtn = document.querySelector('.marketplace .mkt-row[data-name="common tools (hammer, shovel, etc.)"] .mkt-take');
    takeBtn?.click();
    const took = await poll(() => actor.items.find((i) => /^Common Tools/.test(i.name)));
    await wait(150);   // let any (non-)gold update flush; Take must not change gold
    const goldAfterTake = actor.system.gold;

    const buy = {
      hadBuyButton: !!buyBtn,
      bought,
      goldAfterBuy,
      spent5: goldAfterBuy === 100 - origCost,   // origCost is the real Dagger price (5)
      hadTakeButton: !!takeBtn,
      took,
      goldAfterTake,
      takeWasFree: goldAfterTake === goldAfterBuy,
      daggerPrice: origCost,
    };

    // cleanup: close any open shop dialog(s), delete the temp actor.
    for (const app of Object.values(foundry.applications.instances ?? {})) {
      if (app?.element?.querySelector?.(".marketplace")) await app.close();
    }
    await actor.delete();

    return { listing, reflect, buy };
  });

  // ---- assertions ----
  const L = r.listing;
  // Transports & Containers joined the shop in Phase 4; it is covered in depth by
  // tools/dev/transport-probe.mjs, so this probe only checks it is in order here.
  JSON.stringify(L.categories) === JSON.stringify(["Weapons", "Armor", "Gear", "Transports & Containers"])
    ? ok(`shop has 4 categories in order: ${L.categories.join(", ")}`)
    : fail(`unexpected categories: ${JSON.stringify(L.categories)}`);
  L.counts.Weapons === 15 && L.counts.Armor === 6 && L.counts.Gear === 49
    ? ok(`every reference resolved (Weapons ${L.counts.Weapons}, Armor ${L.counts.Armor}, Gear ${L.counts.Gear})`)
    : fail(`reference counts off: ${JSON.stringify(L.counts)} (expected 15/6/49)`);
  L.daggerCost === 5 ? ok("price read off the item: Dagger = 5") : fail(`Dagger cost ${L.daggerCost}, expected 5`);
  L.plateCost === 60 ? ok("price read off the item: Plate Mail = 60") : fail(`Plate Mail cost ${L.plateCost}, expected 60`);
  L.bundleName && L.bundleCost === 10 ? ok(`bundle stocked: "${L.bundleName}" = 10`) : fail(`bundle missing/mispriced: ${L.bundleName} ${L.bundleCost}`);
  L.bundleNudge ? ok("bundle carries the rename nudge") : fail("bundle description missing the rename nudge");

  r.reflect.reflectsCost
    ? ok(`EDIT FLOWS THROUGH: shop Dagger price is now ${r.reflect.cost} after editing the pool item`)
    : fail(`cost edit did NOT reach the shop (got ${r.reflect.cost}, expected 99)`);
  r.reflect.reflectsDesc ? ok("EDIT FLOWS THROUGH: shop Dagger description shows the marker") : fail("description edit did NOT reach the shop");

  r.buy.hadBuyButton ? ok("shop rendered a Buy button for Dagger") : fail("no Buy button for Dagger");
  r.buy.bought ? ok("Buy added the Dagger to the character") : fail("Buy did not add the item");
  r.buy.spent5 ? ok(`Buy deducted ${r.buy.daggerPrice} gold (100 → ${r.buy.goldAfterBuy})`) : fail(`gold after buy ${r.buy.goldAfterBuy}, expected ${100 - r.buy.daggerPrice}`);
  r.buy.took ? ok("Take added the bundle to the character") : fail("Take did not add the bundle");
  r.buy.takeWasFree ? ok(`Take was free (gold unchanged at ${r.buy.goldAfterTake})`) : fail(`Take changed gold (${r.buy.goldAfterBuy} → ${r.buy.goldAfterTake})`);
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

console.log(failed ? "\nPHASE 3 PROBE FAILED\n" : "\nphase 3 probe passed\n");
process.exit(failed ? 1 : 0);

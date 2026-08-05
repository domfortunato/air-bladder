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
 *   4. A FULL PACK cannot shop (2026-08-05 ruling). Shopping is ordinary
 *      acquisition — overflow is owed to what generation grants and to Fatigue,
 *      never to a purchase — and this path was the last holdout: it created the
 *      item and warned afterwards, so buying was the one way past the limit. At
 *      exactly 10/10 both buttons are greyed, and forcing `disabled` back off
 *      and clicking is STILL refused: the greying is the affordance, `acquire`
 *      is the enforcement, and a dialog left open while the pack filled must not
 *      be a way through. Transports and petty items stay available (neither
 *      costs the buyer a slot). Control: free one slot and the buy lands again.
 *
 * Two traps this probe pays for, both of which made step 4 pass or fail for the
 * wrong reason before they were found:
 *   - `foundry.applications.instances` is a **Map**, so the `Object.values()`
 *     close loop was a silent no-op. Every dialog stayed open, and with two live
 *     shops `document.querySelector` answered from the stale one.
 *   - The buttons must be read only after `refresh()` has run. Polling for
 *     `.mkt-row` returns as soon as the dialog renders, and every button is then
 *     in its TEMPLATE state — enabled, whatever the pack holds. The header slot
 *     readout is rendered empty and filled by refresh(), so it is the signal.
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

    // 4. A FULL PACK refuses the shop (2026-08-05 ruling). Shopping is ordinary
    // acquisition: overflow is owed to what generation grants and to Fatigue,
    // never to a purchase. This path used to create the item and warn afterwards,
    // which made buying the one way a player could walk past their own limit.
    // Poll the DOM until the old shop is really GONE. Closing and re-opening
    // without this leaves the previous dialog standing, the next `poll` for a
    // row is satisfied by the stale one instantly, and every button reads the
    // state of the pack as it was one step ago.
    // `foundry.applications.instances` is a **Map**, so `Object.values()` on it
    // returns [] and the close loop this probe used to run was a silent no-op —
    // every dialog it opened stayed open. That is why the shop has to be counted
    // below: two live dialogs meant `document.querySelector` answered from the
    // stale one, and the buttons read the pack as it was one step ago.
    const shopApps = () => {
      const insts = foundry.applications.instances;
      const all = insts instanceof Map ? [...insts.values()] : Object.values(insts ?? {});
      return all.filter((a) => a?.element?.querySelector?.(".marketplace"));
    };
    const closeShop = async () => {
      for (const app of shopApps()) await app.close();
      return poll(() => !document.querySelector(".marketplace"), 100, 50);
    };
    // Wait for refresh(), not for the rows. The rows exist the moment the dialog
    // renders; the enable/disable pass runs at the tail of the render callback,
    // so a probe that polls for `.mkt-row` reads the buttons in their TEMPLATE
    // state — every one of them enabled, whatever the pack holds. The header's
    // slot readout is rendered EMPTY and filled by refresh(), which makes it the
    // signal that the pass has run, and comparing it to the actor's live value
    // makes it the signal that the pass ran against the CURRENT pack.
    const openShop = async () => {
      await mkt.openMarketplace(actor);
      await poll(() => document.querySelector(".marketplace .mkt-row"));
      return poll(() => document.querySelector(".marketplace .mkt-slotval")?.textContent
        === `${actor.system.slotsUsed}/${actor.system.slotsMax}`, 100, 50);
    };
    const sel = (name, which) =>
      document.querySelector(`.marketplace .mkt-row[data-name="${name.toLowerCase()}"] .mkt-${which}`);

    // To EXACTLY the limit, never past it: at 11/10 the buttons would be right
    // for a reason this probe is not testing.
    const filler = Array.from({ length: 10 - actor.system.slotsUsed }, (_, i) => ({
      name: `MKT Filler ${i}`, type: "item",
    }));
    if (filler.length) await actor.createEmbeddedDocuments("Item", filler);
    const atLimit = `${actor.system.slotsUsed}/${actor.system.slotsMax}`;

    // Re-open so refresh() runs against the full state. Both halves are recorded:
    // a close that quietly fails leaves a second dialog answering every query.
    const closedOk = await closeShop();
    const openedOk = await openShop();

    const carrier = (cat.categories.find((c) => c.name === "Transports & Containers")?.items ?? [])[0];
    const petty = catItems(cat, "Gear").find((i) => i.system?.weightless);
    const full = {
      atLimit,
      closedOk,
      openedOk,
      encumbered: actor.isEncumbered(),
      shopRoots: document.querySelectorAll(".marketplace").length,
      rowCount: document.querySelectorAll(".marketplace .mkt-row").length,
      daggerRowFound: !!document.querySelector('.marketplace .mkt-row[data-name="dagger"]'),
      buyRaw: String(sel("Dagger", "buy")?.disabled),
      buyDisabled: sel("Dagger", "buy")?.disabled === true,
      takeDisabled: sel("Dagger", "take")?.disabled === true,
      // Not everything is greyed: a transport is a connected Actor and never
      // counts against the buyer's slots — buying a mule is how you FIX being
      // full — and a petty item costs no slot at all.
      carrierName: carrier?.name ?? null,
      carrierStaysEnabled: carrier ? sel(carrier.name, "take")?.disabled === false : null,
      pettyName: petty?.name ?? null,
      pettyStaysEnabled: petty ? sel(petty.name, "take")?.disabled === false : null,
    };

    // ENFORCEMENT, not just the affordance. Force the disabled attribute off and
    // click anyway — a stale dialog left open while the pack filled is exactly
    // that, and it must not be a way through.
    const beforeForced = actor.items.size;
    const goldBeforeForced = actor.system.gold;
    const forcedBuy = sel("Dagger", "buy");
    if (forcedBuy) { forcedBuy.disabled = false; forcedBuy.click(); }
    await wait(1200);
    full.forcedBuyRefused = actor.items.size === beforeForced
      && actor.system.gold === goldBeforeForced;
    const forcedTake = sel("Dagger", "take");
    if (forcedTake) { forcedTake.disabled = false; forcedTake.click(); }
    await wait(1200);
    full.forcedTakeRefused = actor.items.size === beforeForced;

    // CONTROL, the other direction: free ONE slot and the same two buttons must
    // come back and the buy must land. Without this, "refused" passes on a shop
    // that was simply broken.
    const spare = actor.items.find((i) => /^MKT Filler/.test(i.name));
    if (spare) await spare.delete();
    await closeShop();
    await openShop();
    full.freedSlots = `${actor.system.slotsUsed}/${actor.system.slotsMax}`;
    full.buyEnabledAgain = sel("Dagger", "buy")?.disabled === false;
    const beforeFreed = actor.items.size;
    sel("Dagger", "buy")?.click();
    full.buyLandsAgain = await poll(() => actor.items.size === beforeFreed + 1, 60, 50);

    // cleanup: close any open shop dialog(s), delete the temp actor.
    full.cleanupClosed = await closeShop();
    await actor.delete();

    return { listing, reflect, buy, full };
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

  const F = r.full;
  F.encumbered && F.closedOk && F.openedOk && F.shopRoots === 1
    ? ok(`a full pack: ${F.atLimit}, no free slot, read from ONE freshly refreshed shop`)
    : fail(`the setup for every assertion below is not sound: at capacity=${F.encumbered} (${F.atLimit}), `
      + `old shop closed=${F.closedOk}, new shop refreshed=${F.openedOk}, live shop dialogs=${F.shopRoots} (want 1)`);
  F.buyDisabled && F.takeDisabled
    ? ok("Buy AND Take are greyed on a full pack — the shop does not offer what it will refuse")
    : fail(`at ${F.atLimit} the buttons are still live (buy disabled=${F.buyRaw}, take disabled=${F.takeDisabled}); `
      + `shop roots=${F.shopRoots}, rows=${F.rowCount}, dagger row found=${F.daggerRowFound}`);
  F.forcedBuyRefused && F.forcedTakeRefused
    ? ok("forcing the disabled attribute off and clicking is still refused — a stale dialog is not a way through")
    : fail(`ENFORCEMENT MISSING: a forced click went through (buy refused=${F.forcedBuyRefused}, take refused=${F.forcedTakeRefused}) — the greying is only an affordance`);
  F.carrierName === null
    ? console.log("  --    no transport stocked, so the not-everything-is-greyed leg is skipped")
    : F.carrierStaysEnabled
      ? ok(`a transport stays available at a full pack ("${F.carrierName}") — it costs the buyer no slots, and buying one is how you fix being full`)
      : fail(`"${F.carrierName}" was greyed, but a transport never counts against the buyer's slots`);
  F.pettyName === null
    ? console.log("  --    the shop stocks no petty item, so the weightless carve-out is not covered here")
    : F.pettyStaysEnabled
      ? ok(`a petty item stays available at a full pack ("${F.pettyName}") — it costs no slot`)
      : fail(`petty "${F.pettyName}" was greyed, but a weightless item costs no slot`);
  F.buyEnabledAgain && F.buyLandsAgain
    ? ok(`CONTROL: freeing one slot (${F.freedSlots}) re-enables Buy and the purchase lands — the refusals above can fail`)
    : fail(`CONTROL FAILED at ${F.freedSlots}: re-enabled=${F.buyEnabledAgain}, purchase landed=${F.buyLandsAgain}`);
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

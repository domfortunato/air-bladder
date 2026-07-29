#!/usr/bin/env node
/**
 * `module/compendium.js` — the shared name→document lookup that the marketplace,
 * generation, damage and the Kettlewright importer all sit on.
 *
 *   npm run dev:compendium     (needs Foundry running with a world launched)
 *
 * Two things it gates, neither of which any other probe can see:
 *
 * 1. **How the lookup finds a document.** `findCompendiumItem` used to call
 *    `pack.getDocuments()` — which ALWAYS round-trips the database and constructs
 *    every document in the pack (`compendium-collection.mjs:411`, no cache) — and
 *    then read one name off each. It runs once per lookup, so opening the shop,
 *    which resolves ~77 compendium results, loaded whole packs ~77 times. The fix
 *    matches in the pack INDEX and materializes one document.
 *
 *    Counting is the only honest way to assert this. The catalog was CORRECT
 *    before the fix and is correct after; the entire difference is how much work
 *    happened, so a functional assertion cannot fail either way. The counter
 *    discriminates on the query: `getDocuments()` with no query is a full pack
 *    load, while `getDocuments({_id})` is what `getDocument` issues for a single
 *    document — the cheap call, and the one we WANT to see.
 *
 * 2. **A missing table or item degrades instead of throwing.** `drawTable`
 *    dereferenced a lookup its own JSDoc documents as resolving to `undefined`,
 *    so a renamed or deleted table threw from wherever the draw was requested —
 *    mid-generation, with nothing naming the table. `damage.js` guards the
 *    identical call and says why; this covers the rest.
 *
 * Exits non-zero on any failed assertion or console error.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(40)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(40)} ${d}`); failures++; };

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);

try {
  await joinAsGM(page);

  /* ------------------------------------------------ 1. the shop's lookups ---- */
  const shop = await page.evaluate(async () => {
    const mkt = await import("/systems/air-bladder/module/marketplace.js");
    const Pack = foundry.documents.collections.CompendiumCollection;
    const original = Pack.prototype.getDocuments;

    // Warm the indexes first. Building an index for the first time is a real
    // round-trip too, and charging it to this measurement would make the result
    // depend on what an earlier probe happened to touch.
    for (const p of game.packs) await p.getIndex();

    let fullLoads = 0;
    let byId = 0;
    const packsFullyLoaded = new Set();
    Pack.prototype.getDocuments = function (query = {}) {
      if (Object.keys(query).length === 0) { fullLoads++; packsFullyLoaded.add(this.collection); }
      else byId++;
      return original.call(this, query);
    };

    let catalog;
    try {
      catalog = await mkt.getMarketplaceCatalog();
    } finally {
      Pack.prototype.getDocuments = original;
    }

    const cats = catalog.categories ?? [];
    const items = cats.reduce((n, c) => n + c.items.length, 0);
    const dagger = cats.find((c) => c.name === "Weapons")?.items.find((i) => i.name === "Dagger");
    return {
      fullLoads, byId, items,
      categories: cats.map((c) => c.name),
      packsFullyLoaded: [...packsFullyLoaded],
      daggerCost: dagger?.system?.cost ?? null,
    };
  });

  // The catalog must still be RIGHT — the counter above is meaningless if the
  // lookup stopped resolving anything.
  shop.items > 50 && shop.categories.length >= 3 && shop.daggerCost != null
    ? ok("catalog still resolves", `${shop.categories.length} categories, ${shop.items} items, Dagger ${shop.daggerCost}`)
    : fail("catalog still resolves", JSON.stringify(shop));

  // The marketplace pack itself is read with getDocuments() by design — it wants
  // every table in it — so one full load is expected. Every ITEM lookup on top of
  // that must be an index hit. Before the fix this was ~77.
  shop.fullLoads <= 1
    ? ok("no per-lookup full pack loads", `${shop.fullLoads} full load(s), ${shop.byId} by id`)
    : fail("no per-lookup full pack loads",
      `${shop.fullLoads} full pack loads for ${shop.items} items — packs: ${shop.packsFullyLoaded.join(", ")}`);

  /* ------------------------------------------------------- 2. the guards ---- */
  const guards = await page.evaluate(async () => {
    const c = await import("/systems/air-bladder/module/compendium.js");
    const out = {};
    const attempt = async (key, fn) => {
      try { out[key] = { value: await fn(), threw: false }; }
      catch (e) { out[key] = { value: null, threw: true, message: e.message }; }
    };
    await attempt("missingPack", () => c.findCompendiumItem("air-bladder.no-such-pack", "Anything"));
    await attempt("missingItem", () => c.findCompendiumItem("air-bladder.utils", "ZZ No Such Table"));
    await attempt("drawMissing", () => c.drawTable("air-bladder.utils", "ZZ No Such Table"));
    await attempt("textMissing", () => c.drawTableText("air-bladder.utils", "ZZ No Such Table"));
    // ...and the happy path still works, so "never throws" cannot pass by never working.
    await attempt("drawReal", async () => {
      const d = await c.drawTable("air-bladder.utils", "Scars");
      return d?.results?.length ?? 0;
    });
    return out;
  });

  const undef = (k) => guards[k] && !guards[k].threw && guards[k].value === undefined;
  undef("missingPack")
    ? ok("missing pack → undefined")
    : fail("missing pack → undefined", JSON.stringify(guards.missingPack));
  undef("missingItem")
    ? ok("missing item → undefined")
    : fail("missing item → undefined", JSON.stringify(guards.missingItem));
  undef("drawMissing")
    ? ok("drawTable on a missing table → undefined")
    : fail("drawTable on a missing table → undefined", JSON.stringify(guards.drawMissing));
  guards.textMissing && !guards.textMissing.threw && guards.textMissing.value === ""
    ? ok("drawTableText on a missing table → \"\"")
    : fail("drawTableText on a missing table → \"\"", JSON.stringify(guards.textMissing));
  guards.drawReal && !guards.drawReal.threw && guards.drawReal.value > 0
    ? ok("a real table still draws", `${guards.drawReal.value} result(s)`)
    : fail("a real table still draws", JSON.stringify(guards.drawReal));

  /* ------------------------------------------- 3. the sheet's pack cache ---- */
  // The character sheet memoizes tables-2e (traits, scars, omens) because
  // `_prepareContext` runs on every render and `submitOnChange` is on. The cache
  // is dropped on RollTable create/update/delete -- but adding a ROW to a table
  // fires only `createTableResult`, and the parent RollTable is not updated. So a
  // Warden who unlocked the pack and added a Scar kept seeing the stale list for
  // the rest of the session, with nothing to suggest the edit had not taken.
  const cache = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const MARK = "ZZ Probe Scar";
    const pack = game.packs.get("air-bladder.tables-2e");
    const wasLocked = pack.locked;

    // Always re-fetch the table before writing to it. A compendium document is
    // re-instantiated after an embedded write, so a handle taken before the
    // create is stale by the time the delete runs -- which fails with "id does
    // not exist in the EmbeddedCollection", leaving the probe row in the pack.
    const scars = async () => (await pack.getDocuments()).find((t) => t.name === "Scars");

    // Sweep leftovers from a run that died before its cleanup, in the pack AND in
    // the actor list. Otherwise `hadBefore` is true on the next run and the
    // assertion fails forever, looking exactly like a code bug.
    const sweep = async () => {
      const t = await scars();
      const junk = t.results.filter((r) => r.text === MARK).map((r) => r.id);
      if (junk.length) await t.deleteEmbeddedDocuments("TableResult", junk);
    };

    let actor;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      await sweep();
      for (const stale of game.actors.filter((a) => a.name === "ZZ Compendium Probe")) await stale.delete();

      actor = await Actor.create({ name: "ZZ Compendium Probe", type: "character" });
      const sheet = actor.sheet;
      await sheet.render(true);
      await wait(1500);
      const names = async () => ((await sheet._prepareContext({})).scarOptions ?? []).map((o) => o.name);
      const before = await names();

      await (await scars()).createEmbeddedDocuments("TableResult", [{ text: MARK, range: [99, 99] }]);
      await wait(600);
      const after = await names();

      await sheet.close();
      return { mark: MARK, hadBefore: before.includes(MARK), hasAfter: after.includes(MARK), count: before.length };
    } finally {
      // Put the world back exactly as found, whatever happened above.
      await sweep().catch(() => {});
      await actor?.delete().catch(() => {});
      if (wasLocked) await pack.configure({ locked: true }).catch(() => {});
    }
  });

  cache.count > 0
    ? ok("scar pick-list populated", `${cache.count} option(s)`)
    : fail("scar pick-list populated", "empty — the assertion below could not fail");
  !cache.hadBefore && cache.hasAfter
    ? ok("a new table ROW invalidates the cache", cache.mark)
    : fail("a new table ROW invalidates the cache",
      `before=${cache.hadBefore} after=${cache.hasAfter} — createTableResult did not clear the cache`);

  // The two warnings the misses log are the intended behaviour, not noise.
  const errs = errors.filter((e) => !/No Such Table|no-such-pack/.test(e));
  errs.length === 0 ? ok("zero console errors") : fail("zero console errors", errs.join(" | "));
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} failure(s)` : "\ncompendium lookup probe passed");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * The random-spell pool: canon-only, index-first, and never a full pack load.
 *
 *   npm run dev:spell-pool     (needs Foundry running, world launched)
 *
 * Two rulings this gates (2026-08-05):
 *
 *   1. Random spells and spellscrolls in generation draw from the CANON pack —
 *      `air-bladder.spellbooks` — and never from More Spellbooks. Stated by the
 *      user with "100% certainty"; the draw pool and the by-name grant list
 *      (SPELL_PACKS) are deliberately separate constants so widening one cannot
 *      silently widen the other.
 *
 *   2. The draw is INDEX-FIRST: read the (core-maintained, always-live) pack
 *      index, pick, fetch ONE document. The old shape memoized getDocuments()
 *      across both packs and never invalidated — a spell added to an unlocked
 *      pack mid-session was undrawable until reload, silently — and
 *      getDocuments() is a server round trip on EVERY call (~1.7s warm for 20
 *      docs), so the memo was also the only thing keeping it usable.
 *
 * The draw RESULT is correct under either implementation, so asserting on it
 * alone cannot fail. Leg 1 therefore asserts WORK DONE (full pack loads
 * observed while drawing — must be zero), with an in-page negative control: a
 * probe-local closure that reproduces the old load-everything shape and must
 * trip the same counter. Never a source edit.
 *
 * Leg 2's canon-only assertion needs More Spellbooks to be non-empty to mean
 * anything — with nothing outside the canon pack, "only canon came out" is
 * vacuous — so it asserts that precondition out loud instead of assuming it.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(120000, "spell-pool probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const CANON = "air-bladder.spellbooks";
    const out = {};

    // The generator's draw helpers are module-internal; drive them through the
    // Barebones instruction-row resolver, which is the real consumer.
    const CG = game.cairn.characterGenerator;

    // Warm the document cache with ONE bulk load per pool pack, OUTSIDE the
    // counter installed below. A cache-missing draw pays a single-document
    // server query, and those cost ~1s EACH against a long-lived server (the
    // pack-cost note's ~1.7s figure is per CALL, not per document) — so the
    // 200-draw leg's runtime scaled with a latency this probe does not
    // control, and on 2026-08-05 it timed out at 120s after passing at Stage 1
    // against a freshly restarted server. The claims are about the DRAW's work
    // — zero full loads, canon-only picks — not about the cache state, and the
    // negative control still proves the counter can fire.
    for (const key of [CANON, "air-bladder.more-spellbooks"]) {
      await game.packs.get(key)?.getDocuments();
    }

    // Count FULL pack loads while drawing. Two reads are deliberately NOT
    // counted: getIndex() (the cheap, live, intended read), and the id-filtered
    // form — CompendiumCollection#getDocument's cache-miss path is
    // `getDocuments({_id: id})` (compendium-collection.mjs:379), which fetches
    // exactly one document and is the intended cost of a draw. A first version
    // of this probe counted it and reported 79 "full loads" in 200 draws that
    // were really cache misses fetching one spell each.
    const proto = foundry.documents.collections.CompendiumCollection.prototype;
    const origGetDocs = proto.getDocuments;
    let fullLoads = 0;
    proto.getDocuments = function (query = {}, ...rest) {
      if (!("_id" in query) && !("_id__in" in query)) fullLoads++;
      return origGetDocs.call(this, query, ...rest);
    };

    // The dev world plays in GLOG mode, where randomSpellbookDoc DELIBERATELY
    // swaps the pool to the GLOG packs, canon excluded — so the canon-only leg
    // reds on the world's setting while both rulings hold. This probe's
    // subject is the 2e pool, so pin GLOG off with a read-shadow (never a
    // world write); the GLOG pool's own behaviour is dev:glog-magic's.
    const origGlogGet = game.settings.get;
    game.settings.get = function (scope, key, ...rest) {
      if (scope === game.system.id && key === "enable-glog-magic") return false;
      return origGlogGet.call(this, scope, key, ...rest);
    };

    try {
      const drawn = [];
      for (let i = 0; i < 5; i++) {
        const book = await CG.randomSpellbookItem();
        const scroll = await CG.randomScrollItem();
        if (book) drawn.push(book);
        if (scroll) drawn.push(scroll);
      }
      out.drawCount = drawn.length;
      out.fullLoads = fullLoads;
      out.scrollShapes = drawn.filter((d) => d.system?.scroll).every(
        (d) => d.system.weightless === true && d.system.uses?.max === 1
      );

      // Canon-only: 200 index-level draws, every winner's id must be canon's.
      const canonIds = new Set(game.packs.get(CANON).index.map((e) => e._id));
      const moreIds = new Set(
        (game.packs.get("air-bladder.more-spellbooks")?.index ?? []).map((e) => e._id)
      );
      out.morePackSize = moreIds.size;   // the non-vacuousness precondition
      fullLoads = 0;
      let inCanon = 0, outside = [];
      for (let i = 0; i < 200; i++) {
        const doc = await CG.randomSpellbookDoc();
        if (!doc) continue;
        if (canonIds.has(doc.id)) inCanon++;
        else outside.push(doc.name);
      }
      out.canonDraws = inCanon;
      out.outsideDraws = [...new Set(outside)].slice(0, 5);
      out.fullLoads200 = fullLoads;

      // NEGATIVE CONTROL, probe-local: the pre-fix shape — load EVERYTHING,
      // pick from the array — must trip the counter the legs above read. This
      // proves "zero full loads" can fail, without touching source.
      fullLoads = 0;
      const oldShape = async () => {
        const books = [];
        for (const key of [CANON, "air-bladder.more-spellbooks"]) {
          const pack = game.packs.get(key);
          if (pack) books.push(...(await pack.getDocuments()));
        }
        return books[Math.floor(Math.random() * books.length)];
      };
      const legacy = await oldShape();
      out.controlLoads = fullLoads;
      out.controlDrew = !!legacy;
    } finally {
      proto.getDocuments = origGetDocs;
      game.settings.get = origGlogGet;
    }
    return out;
  });

  r.drawCount === 10
    ? ok(`10 draws resolved (5 spellbooks + 5 scrolls)`)
    : fail(`only ${r.drawCount}/10 draws resolved`);
  r.fullLoads === 0
    ? ok("zero full pack loads across 10 draws — the pool is index-first")
    : fail(`${r.fullLoads} full pack load(s) during 10 draws — something is calling getDocuments()`);
  r.scrollShapes
    ? ok("every scroll draw came out petty and single-use (the spellScrollItem shape)")
    : fail("a scroll draw is missing the pinned scroll shape (weightless / uses 1)");

  r.morePackSize > 0
    ? ok(`precondition: More Spellbooks holds ${r.morePackSize} docs, so canon-only is a real claim`)
    : fail("More Spellbooks is EMPTY — the canon-only assertion below is vacuous and this probe needs rethinking");
  r.canonDraws === 200
    ? ok("200/200 random draws resolved inside the canon pack")
    : fail(`${r.canonDraws}/200 draws canon; escaped: ${JSON.stringify(r.outsideDraws)}`);
  r.fullLoads200 === 0
    ? ok("zero full pack loads across the 200 draws")
    : fail(`${r.fullLoads200} full loads during the 200-draw sweep`);

  r.controlLoads >= 1 && r.controlDrew
    ? ok(`NEGATIVE CONTROL: the old load-everything shape trips the counter (${r.controlLoads} loads) — the zero assertions above can fail`)
    : fail(`control did not register (loads=${r.controlLoads}, drew=${r.controlDrew}) — the counter is not measuring what it claims`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nSPELL POOL PROBE FAILED\n" : "\nspell pool probe passed\n");
process.exit(failed ? 1 : 0);

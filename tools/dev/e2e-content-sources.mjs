#!/usr/bin/env node
/**
 * The content-source toggles actually govern which backgrounds a character is
 * generated from.
 *
 *   npm run dev:content-sources     (needs Foundry running, world launched)
 *
 * The bug this exists for (issue #9): `generate2eCharacter` read the shipped pack
 * inline — `game.packs.get("air-bladder.backgrounds-2e")` — instead of going
 * through `getBackgroundsFor("2e")`. Only the picker and `changeBackground` used
 * the union, so RANDOM generation ignored both toggles: a Warden running a
 * homebrew-only game (shipped off, custom on) got shipped backgrounds and their
 * own were never rolled. Nothing errored, and the settings sheet showed exactly
 * what they had asked for, so it read as a settings bug rather than a generation
 * one.
 *
 * Note what a weaker probe would have missed. Asserting only the SIZE of the pool
 * passes in three of the four cases below whichever code is in place, and
 * asserting only that "a character was generated" passes in all four. The
 * assertion that bites is which background the generated character actually came
 * out with, in the custom-only case, with a real custom background present — so
 * this probe creates one in a world pack rather than assuming the world has any.
 * The dev world had none at all, which is why the first reproduction showed the
 * empty-pool fallback and hid the bigger defect underneath it.
 *
 * Restores every setting it touches and deletes the pack it makes.
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
    const NS = "air-bladder";
    const CG = game.cairn.characterGenerator;
    const CUSTOM = "ZZ Probe Homebrew Background";
    const prior = {
      two: game.settings.get(NS, "content-source-2e"),
      cust: game.settings.get(NS, "content-source-custom"),
      bare: game.settings.get(NS, "content-source-barebones"),
    };
    const set = async (two, cust) => {
      await game.settings.set(NS, "content-source-2e", two);
      await game.settings.set(NS, "content-source-custom", cust);
    };
    const out = { prior };
    let pack = null;

    try {
      // Pin Barebones ON while the 2e/custom combinations run: set() writes 2e
      // before custom, and with Barebones off that ordering passes through
      // all-three-off — which now FIRES THE FLOOR and flips 2e back on in the
      // middle of a leg. The floor gets its own deliberate leg below.
      await game.settings.set(NS, "content-source-barebones", true);
      // A real custom background, in a world pack, the way the feature intends.
      // Cloned from a shipped one so it is structurally valid without this probe
      // having to know the background schema.
      pack = game.packs.get("world.zz-probe-custom-bgs")
        ?? await CompendiumCollection.createCompendium({
          label: "ZZ Probe Custom Backgrounds", name: "zz-probe-custom-bgs",
          type: "Item", packageType: "world",
        });
      const shipped = await game.packs.get("air-bladder.backgrounds-2e").getDocuments();
      out.shippedCount = shipped.length;
      out.shippedNames = shipped.map((b) => b.name);

      // How many custom backgrounds this world ALREADY has. Authoring them is a
      // shipped feature, so any real world has some, and asserting "the pool is
      // exactly my one homebrew" made this gate go red in every world where the
      // feature had ever been used — blaming the toggles for the Warden's content.
      // Every count below is relative to this.
      await set(false, true);
      out.baseline = (await CG.getBackgroundsFor("2e")).map((b) => b.name);

      const data = shipped[0].toObject();
      delete data._id;
      data.name = CUSTOM;
      const custom = await Item.create(data, { pack: pack.collection });

      const sample = async () => {
        const pool = await CG.getBackgroundsFor("2e");
        const ch = await CG.generate2eCharacter();
        return { pool: pool.length, names: pool.map((b) => b.name), bg: ch?.background ?? null, made: !!ch };
      };

      await set(false, true);  out.customOnly = await sample();
      await set(true, false);  out.shippedOnly = await sample();
      await set(true, true);   out.both = await sample();
      await custom.delete();
      await set(false, true);  out.customOnlyEmpty = await sample();

      out.custom = CUSTOM;

      // THE FLOOR (option 2, ruled 2026-08-04): switching the LAST enabled
      // source off flips Cairn 2e back on with a toast, because generation
      // already refuses to be left with nothing and the settings window must
      // not claim otherwise. The write-back runs in the setting's onChange —
      // POLL for it, the round trip owes this probe no particular timing.
      await game.settings.set(NS, "content-source-barebones", false);
      await set(false, false);
      const t0 = Date.now();
      let reEnabled = false;
      while (Date.now() - t0 < 10000) {
        if (game.settings.get(NS, "content-source-2e")) { reEnabled = true; break; }
        await new Promise((res) => setTimeout(res, 100));
      }
      out.floor = {
        reEnabled,
        // the floor turns exactly ONE source back on — the other two stay off
        othersStayOff: !game.settings.get(NS, "content-source-custom")
          && !game.settings.get(NS, "content-source-barebones"),
      };
    } finally {
      try { await pack?.deleteCompendium(); } catch { /* already gone */ }
      // Floor-safe restore ORDER: barebones and custom first, 2e last — a
      // transient all-off here would fire the floor and overwrite the very
      // state being restored.
      await game.settings.set(NS, "content-source-barebones", prior.bare);
      await game.settings.set(NS, "content-source-custom", prior.cust);
      await game.settings.set(NS, "content-source-2e", prior.two);
    }
    return out;
  });

  const base = r.baseline ?? [];
  const shippedIn = (names) => names.filter((n) => r.shippedNames.includes(n));
  if (base.length) console.log(`  note  this world already has ${base.length} custom background(s); `
    + "every count below is relative to that");

  // 1. Homebrew-only: NO shipped background is in the pool, and generation draws
  //    from what is. That is what the bug failed — not the pool's exact size,
  //    which the Warden's own backgrounds legitimately change.
  !shippedIn(r.customOnly.names).length && r.customOnly.names.includes(r.custom)
    && r.customOnly.pool === base.length + 1
    ? ok(`custom-only: the pool is homebrew only (${r.customOnly.pool}, no shipped background in it)`)
    // Name which of the three conditions actually broke. Reporting only the shipped
    // leak once produced "contains 0 SHIPPED background(s): []" on a failing
    // assertion, which reads as a passing one.
    : fail(`custom-only pool is ${r.customOnly.pool} (expected ${base.length + 1}), contains `
      + `${shippedIn(r.customOnly.names).length} SHIPPED background(s) `
      + `${JSON.stringify(shippedIn(r.customOnly.names).slice(0, 3))}, and `
      + `${r.customOnly.names.includes(r.custom) ? "does" : "does NOT"} contain "${r.custom}"`);
  !r.shippedNames.includes(r.customOnly.bg)
    ? ok(`custom-only: generation drew from the homebrew pool ("${r.customOnly.bg}")`)
    : fail(`custom-only generated "${r.customOnly.bg}", which is SHIPPED — generation ignored the toggles`);

  // 2. Shipped-only: the custom background must NOT leak in.
  r.shippedOnly.pool === r.shippedCount && !r.shippedOnly.names.includes(r.custom)
    ? ok(`shipped-only: ${r.shippedOnly.pool} shipped backgrounds, no homebrew`)
    : fail(`shipped-only pool is ${r.shippedOnly.pool} and ${r.shippedOnly.names.includes(r.custom) ? "INCLUDES" : "excludes"} the homebrew`);

  // 3. Both on: the union, deduped.
  r.both.pool === r.shippedCount + base.length + 1 && r.both.names.includes(r.custom)
    ? ok(`both on: the union is ${r.both.pool} (${r.shippedCount} shipped + ${base.length + 1} homebrew)`)
    : fail(`both on: pool is ${r.both.pool}, expected ${r.shippedCount + base.length + 1} including the homebrew`);

  // 4. Homebrew-only with nothing authored must NOT quietly fall back to the
  //    shipped pack — the Warden switched it off on purpose. Generating nothing
  //    is recoverable and is reported; generating from disabled content is not.
  //
  // "Nothing authored" is a state a world with its own custom backgrounds cannot
  // be put into without deleting the Warden's content, which no probe may do. So
  // the pool count is still checkable (it must come back to the baseline, not to
  // 20), while the "generates nothing" half is SKIPPED and says so — a skip that
  // announces itself, rather than an assertion quietly satisfied by a pool that
  // was never empty.
  r.customOnlyEmpty.pool === base.length
    ? ok(`custom-only with the probe's background deleted: the pool is back to ${base.length}, `
      + "not silently refilled with shipped content")
    : fail(`custom-only fell back to ${r.customOnlyEmpty.pool} background(s), expected ${base.length}`);
  if (base.length) {
    console.log("  --    empty-pool case not checked: this world has its own custom backgrounds, "
      + "so the pool cannot be emptied without deleting the Warden's content");
  } else {
    r.customOnlyEmpty.made === false
      ? ok("custom-only with none authored: no character generated (the caller warns instead)")
      : fail(`custom-only with none authored still generated a character ("${r.customOnlyEmpty.bg}")`);
  }
  r.floor?.reEnabled && r.floor?.othersStayOff
    ? ok("THE FLOOR: switching the last source off flips Cairn 2e back on, and only 2e")
    : fail(`floor wrong: reEnabled=${r.floor?.reEnabled}, othersStayOff=${r.floor?.othersStayOff}`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nCONTENT SOURCES PROBE FAILED\n" : "\ncontent sources probe passed\n");
process.exit(failed ? 1 : 0);

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
    } finally {
      try { await pack?.deleteCompendium(); } catch { /* already gone */ }
      await set(prior.two, prior.cust);
      await game.settings.set(NS, "content-source-barebones", prior.bare);
    }
    return out;
  });

  // 1. Homebrew-only: the pool is the custom background ALONE, and generation
  //    actually draws from it. This is the assertion the bug failed.
  r.customOnly.pool === 1 && r.customOnly.names[0] === r.custom
    ? ok(`custom-only: the pool is the homebrew background alone (${r.customOnly.names.join(", ")})`)
    : fail(`custom-only pool is ${r.customOnly.pool} [${r.customOnly.names.slice(0, 3).join(", ")}], expected just "${r.custom}"`);
  r.customOnly.bg === r.custom
    ? ok(`custom-only: generation drew from it ("${r.customOnly.bg}")`)
    : fail(`custom-only generated "${r.customOnly.bg}" — generation ignored the toggles and used the shipped pack`);

  // 2. Shipped-only: the custom background must NOT leak in.
  r.shippedOnly.pool === r.shippedCount && !r.shippedOnly.names.includes(r.custom)
    ? ok(`shipped-only: ${r.shippedOnly.pool} shipped backgrounds, no homebrew`)
    : fail(`shipped-only pool is ${r.shippedOnly.pool} and ${r.shippedOnly.names.includes(r.custom) ? "INCLUDES" : "excludes"} the homebrew`);

  // 3. Both on: the union, deduped.
  r.both.pool === r.shippedCount + 1 && r.both.names.includes(r.custom)
    ? ok(`both on: the union is ${r.both.pool} (${r.shippedCount} shipped + 1 homebrew)`)
    : fail(`both on: pool is ${r.both.pool}, expected ${r.shippedCount + 1} including the homebrew`);

  // 4. Homebrew-only with nothing authored must NOT quietly fall back to the
  //    shipped pack — the Warden switched it off on purpose. Generating nothing
  //    is recoverable and is reported; generating from disabled content is not.
  r.customOnlyEmpty.pool === 0
    ? ok("custom-only with none authored: the pool is empty, not silently refilled with shipped content")
    : fail(`custom-only with none authored fell back to ${r.customOnlyEmpty.pool} shipped background(s)`);
  r.customOnlyEmpty.made === false
    ? ok("custom-only with none authored: no character generated (the caller warns instead)")
    : fail(`custom-only with none authored still generated a character ("${r.customOnlyEmpty.bg}")`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nCONTENT SOURCES PROBE FAILED\n" : "\ncontent sources probe passed\n");
process.exit(failed ? 1 : 0);

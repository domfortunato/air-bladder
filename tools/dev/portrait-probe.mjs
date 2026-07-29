#!/usr/bin/env node
/**
 * Portrait acceptance probe: prove that character generation assigns a random
 * shipped portrait AND its paired token, that a regenerate does not disturb
 * either, and that the picker's swap keeps the two in step.
 *
 *   node tools/dev/portrait-probe.mjs      (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. Fetch the shipped manifest; assert it lists paired basenames.
 *   2. Create a generated character; assert actor.img is one of the shipped
 *      portraits and prototypeToken.texture.src is its PAIRED token (same
 *      basename, token directory).
 *   3. Regenerate the same actor; assert BOTH survive unchanged -- the
 *      persistence is by omission (characterToActorData never sets them), which
 *      is easy to break by "helpfully" adding img to the shared data builder.
 *   4. Swap to a different portrait the way the picker does; assert the token
 *      follows.
 *   5. Set a portrait that is NOT shipped (a bare URL); assert the token falls
 *      back to that same image rather than staying on the old paired token.
 *   6. Delete the test actor.
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
    const CG = game.cairn.characterGenerator;

    // 1. The shipped manifest.
    const m = await CG.getPortraitManifest();
    if (!m?.names?.length) return { error: "portrait manifest is empty or unreachable" };
    const manifest = { count: m.names.length, portraitDir: m.portraitDir, tokenDir: m.tokenDir };

    // 2. Generate a character and inspect the assigned art.
    // Pass the source EXPLICITLY. A bare generateCharacter() falls through to
    // promptContentSource(), a DialogV2.wait() that blocks until a human
    // answers — inside page.evaluate that never returns, and the renderer is
    // eventually killed with "Target crashed" rather than anything naming a
    // dialog. Only bites when >1 content source is enabled, which is why it
    // looked like an intermittent hang.
    const actor = await CG.createActorWithCharacter(await CG.generateCharacter(null, "2e"));
    const img1 = actor.img;
    const tok1 = actor.prototypeToken.texture.src;
    const base1 = img1.split("/").pop();
    const gen = {
      imgFromPack: img1.startsWith(m.portraitDir + "/"),
      imgIsShipped: m.names.includes(base1),
      tokenPaired: tok1 === `${m.tokenDir}/${base1}`,
      img: img1,
      token: tok1,
    };

    // 3. Regenerate: art must survive (persistence by omission).
    await CG.regenerateActor(actor);
    const persist = {
      img: actor.img === img1,
      token: actor.prototypeToken.texture.src === tok1,
      after: actor.img,
    };

    // 4. Swap to a DIFFERENT shipped portrait the way the picker does, via the
    //    sheet's _setPortrait, and assert the paired token follows.
    const other = m.names.find((n) => n !== base1);
    const otherImg = `${m.portraitDir}/${other}`;
    await actor.sheet._setPortrait(otherImg);
    const swap = {
      img: actor.img === otherImg,
      token: actor.prototypeToken.texture.src === `${m.tokenDir}/${other}`,
      gotToken: actor.prototypeToken.texture.src,
    };

    // 5. A custom (non-shipped) image has no paired token: the token must fall
    //    back to the image itself, never linger on the previous pairing.
    const custom = "https://example.invalid/portrait.png";
    await actor.sheet._setPortrait(custom);
    const fallback = {
      img: actor.img === custom,
      tokenFollows: actor.prototypeToken.texture.src === custom,
      gotToken: actor.prototypeToken.texture.src,
    };

    await actor.delete();
    return { manifest, gen, persist, swap, fallback };
  });

  if (r.error) {
    fail(r.error);
  } else {
    console.log(`  manifest: ${r.manifest.count} paired images (${r.manifest.portraitDir} / ${r.manifest.tokenDir})`);
    r.gen.imgFromPack ? ok("generated portrait comes from the shipped folder") : fail(`portrait not from the shipped folder: ${r.gen.img}`);
    r.gen.imgIsShipped ? ok("generated portrait is one of the manifest images") : fail(`portrait not in the manifest: ${r.gen.img}`);
    r.gen.tokenPaired ? ok(`token is the paired art (${r.gen.token.split("/").pop()})`) : fail(`token not paired with portrait: ${r.gen.token}`);

    r.persist.img ? ok("REGENERATE PRESERVES the portrait") : fail(`regenerate changed the portrait to ${r.persist.after}`);
    r.persist.token ? ok("REGENERATE PRESERVES the paired token") : fail("regenerate changed the token");

    r.swap.img ? ok("picker swap sets the new portrait") : fail("picker swap did not set the portrait");
    r.swap.token ? ok("picker swap moves the token to the new pairing") : fail(`token did not follow the swap (${r.swap.gotToken})`);

    r.fallback.img ? ok("custom (non-shipped) portrait accepted") : fail("custom portrait not set");
    r.fallback.tokenFollows ? ok("unpaired portrait falls back to itself as the token") : fail(`stale token after custom portrait: ${r.fallback.gotToken}`);
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

console.log(failed ? "\nPORTRAIT PROBE FAILED\n" : "\nportrait probe passed\n");
process.exit(failed ? 1 : 0);

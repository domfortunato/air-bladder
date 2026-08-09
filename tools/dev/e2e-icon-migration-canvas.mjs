#!/usr/bin/env node
/**
 * What the canvas actually shows on the first boot after an icon migration.
 *
 * The ordering is not a race, it is guaranteed: Game#setupGame starts the canvas
 * (game.mjs:763), AWAITS it (:776), and only then fires `ready` (:779) — which is
 * where module/cairn.js runs migrateIconsToSvg(). So on the first boot after an
 * upgrade the canvas always draws scene tokens from paths the update deleted.
 *
 * Foundry is expected to absorb that: loadTexture falls back to mystery-man on a
 * 404 (loader.mjs:775-778), PlaceablesLayer._draw uses Promise.allSettled, and
 * Token#_onAnimationUpdate sets `redraw` on any texture.src change
 * (token.mjs:2420-2421) — which applyRenderFlags honours BEFORE its !drawn guard
 * (placeable-object.mjs:430-436), so even a placeable whose first draw failed
 * recovers. This probe is what turns that reading into evidence.
 *
 * Method: plant two tokens on a scene and make it ACTIVE — Game#initializeCanvas
 * reads game.scenes.current while canvas.ready is false, which resolves to the
 * ACTIVE scene, so a merely-viewed scene would not survive the reload.
 *
 *   subject — texture.src on a deleted .png, i.e. the pre-migration state
 *   control — texture.src on a shipped .svg
 *
 * The control is the reference. Software WebGL here runs at ~3-4 FPS, and without
 * a known-good token on the same scene a GPU hiccup is indistinguishable from the
 * defect. If the control fails to draw, the verdict is INCONCLUSIVE, not FAIL.
 *
 * Usage: npm run dev:icon-canvas
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

const OLD = "systems/air-bladder/icons/generic-item.png";   // deleted in 0.1.7
const GOOD = "systems/air-bladder/icons/generic-item.svg";  // its replacement
const SCENE = "zz-icon-canvas-probe";

let failed = false;
let inconclusive = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const note = (m) => console.log(`  --    ${m}`);

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);

// A 404 is a completed response, so Playwright's `requestfailed` never fires for one.
// Record statuses directly. Reported, not asserted: no fix under consideration stops
// the FIRST draw requesting the old path — only the end state is supposed to be right.
const pngRequests = [];
page.on("response", (r) => {
  if (/\/icons\/[a-z-]+\.png(\?|$)/.test(r.url())) pngRequests.push(`${r.status()} ${r.url().split("/").pop()}`);
});

await joinAsGM(page);
await dismissChrome(page);

// Declared outside the try so the finally block can restore whatever the plant changed,
// even if the plant itself is what threw.
let planted = null;

try {
  /* --- plant ---------------------------------------------------------------- */

  planted = await page.evaluate(async ({ OLD, GOOD, SCENE }) => {
    const previousActive = game.scenes.active?.id ?? null;

    const scene = await Scene.create({ name: SCENE, width: 1000, height: 1000 });
    const actor = await Actor.create({ name: `${SCENE}-actor`, type: "npc" });

    const mk = async (src, x) => (await actor.getTokenDocument({ x, y: 300, texture: { src } })).toObject();
    const docs = await scene.createEmbeddedDocuments("Token", [
      await mk(OLD, 300),
      await mk(GOOD, 600),
    ]);

    // ACTIVE, not merely viewed: Scenes#current falls back to `active` while the
    // canvas is still initialising, and `viewed` does not survive a reload.
    await scene.update({ active: true });

    // By POSITION, never by index: createEmbeddedDocuments' result arrives
    // ordered by the documents' random ids, not by input order — measured
    // 2026-08-09, when this probe's docs[0] assumption finally lost its coin
    // flip four runs straight and "plant failed" pointed at a migration that
    // was working. The x each token was planted at is the identity.
    const subjectDoc = docs.find((d) => d.x === 300);
    const controlDoc = docs.find((d) => d.x === 600);
    return {
      previousActive,
      sceneId: scene.id,
      actorId: actor.id,
      subject: { id: subjectDoc.id, src: subjectDoc.texture.src },
      control: { id: controlDoc.id, src: controlDoc.texture.src },
    };
  }, { OLD, GOOD, SCENE });

  planted.subject.src === OLD
    ? ok("planted a scene token still carrying the deleted .png path")
    : fail(`plant failed — subject token src is "${planted.subject.src}"`);

  /* --- the first boot after the migration ----------------------------------- */

  pngRequests.length = 0;
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await page.waitForFunction(() => globalThis.canvas?.ready === true, null, { timeout: 90000 })
    .catch(() => note("canvas.ready never became true within 90s"));
  // The migration writes on `ready`, and Foundry cross-fades a texture change over
  // ~1s (Token#_getAnimationDuration), so settle past both before reading.
  await page.waitForTimeout(2500);

  const after = await page.evaluate(({ sceneId, subject, control }) => {
    const read = (id) => {
      const doc = game.scenes.get(sceneId)?.tokens.get(id);
      const obj = doc?.object ?? canvas.tokens?.placeables.find((p) => p.document.id === id);
      const res = obj?.texture?.baseTexture?.resource;
      return {
        stored: doc?.texture?.src ?? null,
        placed: !!obj,
        drawn: obj?.texture?.baseTexture?.valid ?? false,
        loaded: res?.src ?? res?.url ?? null,
      };
    };
    return {
      canvasReady: canvas?.ready ?? false,
      viewedScene: canvas?.scene?.id ?? null,
      subject: read(subject.id),
      control: read(control.id),
    };
  }, planted);

  /* --- control first: is the environment even capable? ---------------------- */

  const controlOk = after.canvasReady && after.control.placed && after.control.drawn;
  if (!controlOk) {
    inconclusive = true;
    note(`CONTROL token did not draw (canvas.ready=${after.canvasReady}, placed=${after.control.placed}, drawn=${after.control.drawn})`);
    note("that is an environment failure, not the defect — headless WebGL here is software-rendered");
  } else {
    ok("control token drew — the canvas is working, so the subject's result means something");

    after.canvasReady
      ? ok("canvas.ready is true after the migration boot")
      : fail("canvas.ready is false — the scene draw did not complete");

    after.viewedScene === planted.sceneId
      ? ok("the probe scene is the one the canvas drew")
      : fail(`canvas drew a different scene (${after.viewedScene})`);

    after.subject.stored === GOOD
      ? ok(`migration rewrote the stored token path (${after.subject.stored})`)
      : fail(`stored token path is "${after.subject.stored}", expected "${GOOD}"`);

    after.subject.placed
      ? ok("subject token exists on the token layer")
      : fail("subject token is missing from the layer — the draw did not recover");

    const loaded = after.subject.loaded ?? "";
    if (!after.subject.drawn) fail("subject token's texture is not valid — it never resolved");
    else if (/mystery-man/.test(loaded)) fail(`subject is still showing the fallback silhouette (${loaded})`);
    else if (/\.png(\?|$)/.test(loaded)) fail(`subject is still on the deleted .png (${loaded})`);
    else ok(`subject ended on the migrated art (${loaded.split("/").pop() || "loaded"})`);
  }

  note(`.png requests during the boot: ${pngRequests.length}${pngRequests.length ? ` — ${[...new Set(pngRequests)].join(", ")}` : ""}`);
  note("  (reported, not asserted: the first draw necessarily precedes the ready-hook migration)");
} finally {
  /* --- restore: this probe changes the world's ACTIVE scene ------------------ */
  const restored = await page.evaluate(async ({ SCENE, previousActive }) => {
    try {
      // Re-activate first, then delete: deleting the active scene leaves the world
      // with none, which is a worse state to hand back than the one we borrowed.
      const prev = previousActive ? game.scenes.get(previousActive) : null;
      if (prev) await prev.update({ active: true });
      const scene = game.scenes.getName(SCENE);
      if (scene) await scene.delete();
      for (const a of game.actors.filter((x) => x.name === `${SCENE}-actor`)) await a.delete();
      return { ok: true, active: game.scenes.active?.name ?? null };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, { SCENE, previousActive: planted?.previousActive ?? null })
    .catch((e) => ({ ok: false, error: String(e) }));

  restored.ok
    ? note(`cleaned up (active scene now: ${restored.active ?? "none"})`)
    : fail(`CLEANUP FAILED — a stray active scene may break later probes: ${restored.error}`);

  const real = errors.filter((e) => !/generic-item\.png/.test(e) && !/Failed to load resource/.test(e));
  console.log(`\nconsole errors: ${errors.length} (${real.length} unrelated to the expected 404s)`);
  for (const e of real.slice(0, 8)) console.log(`  ${e}`);
  if (real.length) failed = true;

  await browser.close();
}

console.log(
  failed ? "\nICON CANVAS PROBE FAILED"
    : inconclusive ? "\nicon canvas probe INCONCLUSIVE — control did not draw"
      : "\nicon canvas probe passed",
);
process.exit(failed ? 1 : 0);

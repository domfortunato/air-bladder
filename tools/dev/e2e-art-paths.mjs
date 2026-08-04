#!/usr/bin/env node
/**
 * The art/ move reaches every kind of document that stores an image path.
 *
 * The four picker galleries moved under `art/` on 2026-08-04. That looks like a
 * folder rename and is not one: an image path is COPIED onto a document when it
 * is created and never re-read from the system, so every world made before the
 * move points at where its art used to be. `migrateArtPaths` in module/cairn.js
 * rewrites them on ready, by PREFIX, so hand-picked art moves too.
 *
 * The failure this exists for is a SURFACE THE MIGRATION FORGOT. A missed
 * collection is invisible in aggregate — the sheets look right, the compendiums
 * look right, and one Warden's own roll table quietly serves broken images
 * forever. So this plants an old path on EVERY surface the migration claims to
 * cover and checks each one independently:
 *
 *   1. a world Item's img
 *   2. an Actor's img
 *   3. that Actor's prototypeToken.texture.src   (a second field on one document)
 *   4. an owned Item on that Actor               (embedded, its own copy)
 *   5. an unlinked Scene token's texture.src     (embedded, holds its own texture)
 *   6. a RollTable result's img                  (a SNAPSHOT, not a live read —
 *      the surface the .png migration never needed and this one does)
 *
 * NEGATIVE CONTROL, in-page and in both directions. `icons/` deliberately did
 * NOT move, and an external URL must never be touched: both are planted too and
 * must come back BYTE-IDENTICAL. Without them "the migration rewrote everything"
 * is equally satisfied by a migration that rewrites indiscriminately, which
 * would break every class icon in the world it was meant to fix.
 *
 * Preconditions are established here, never inherited — every document is
 * created by this file and deleted in a Node-level finally, so a throw partway
 * through cannot leave `zz-art-path-*` litter behind for the next run to pass on.
 *
 * Usage: npm run dev:art-paths
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome } from "./lib.mjs";

// One planted path per surface. The right-hand side is what the migration must
// produce; writing both out rather than deriving the expectation means a broken
// ART_MOVES table cannot make this file agree with it.
const MOVES = [
  ["systems/air-bladder/character_portraits/dwarf_01.webp", "systems/air-bladder/art/jon-aspeheim/portraits/dwarf_01.webp"],
  ["systems/air-bladder/character_tokens/dwarf_01.webp", "systems/air-bladder/art/jon-aspeheim/tokens/dwarf_01.webp"],
  ["systems/air-bladder/tlomdev/beast/beast1.png", "systems/air-bladder/art/tlomdev/beast/beast1.png"],
  ["systems/air-bladder/game-icons/weapons/axe-swing.svg", "systems/air-bladder/art/game-icons/weapons/axe-swing.svg"],
  ["systems/air-bladder/lydia-comer/portraits/Dragon.jpg", "systems/air-bladder/art/lydia-comer/portraits/Dragon.jpg"],
];
// Must survive UNCHANGED. icons/ is stamped class art and stayed put; the URL is
// a Warden's own image and was never ours to rewrite.
const UNTOUCHED = [
  "systems/air-bladder/icons/generic-item.svg",
  "https://example.invalid/some/portrait.png",
];

let failed = false;
const ok = (m, d = "") => console.log(`  ok    ${m.padEnd(52)} ${d}`);
const fail = (m, d = "") => { console.error(`  FAIL  ${m.padEnd(52)} ${d}`); failed = true; };

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let planted = null;

try {
  await joinAsGM(page);
  await dismissChrome(page);

  /* --- plant one old path on every surface ------------------------------- */

  planted = await page.evaluate(async ({ MOVES, UNTOUCHED }) => {
    const old = MOVES.map(([from]) => from);
    const ActorCls = CONFIG.Actor.documentClass;
    const ItemCls = CONFIG.Item.documentClass;

    const item = await ItemCls.create({ name: "zz-art-path-item", type: "item", img: old[3] });

    const actor = await ActorCls.create({
      name: "zz-art-path-actor",
      type: "npc",
      system: { role: "monster" },
      img: old[0],
      prototypeToken: { texture: { src: old[1] } },
      items: [{ name: "zz-art-path-owned", type: "item", img: old[2] }],
    });
    const owned = actor.items.find((i) => i.name === "zz-art-path-owned");

    // A scene of our own, so no existing map is touched and the token is ours to
    // delete. actorLink false: an unlinked token carries its own texture, which
    // is the whole reason this surface needs covering separately.
    const scene = await Scene.create({ name: "zz-art-path-scene", width: 1000, height: 1000 });
    const [token] = await scene.createEmbeddedDocuments("Token", [{
      name: "zz-art-path-token", x: 100, y: 100, actorId: actor.id, actorLink: false,
      texture: { src: old[4] },
    }]);

    // Neither `type` nor a text field is set, deliberately. `CONST.TABLE_RESULT_TYPES`
    // is one of the five shims that go in v15 (see dev:table-results), and v13
    // split `TableResult#text` into two differently-named halves — this probe
    // cares about `img` alone, so it touches neither and cannot rot on either.
    const table = await RollTable.create({ name: "zz-art-path-table" });
    const [result] = await table.createEmbeddedDocuments("TableResult", [
      { img: old[0], range: [1, 1] },
    ]);

    // The control documents, planted the same way so they take the same path.
    const controls = [];
    for (const [i, src] of UNTOUCHED.entries()) {
      controls.push((await ItemCls.create({ name: `zz-art-path-control-${i}`, type: "item", img: src })).id);
    }

    return {
      itemId: item.id,
      actorId: actor.id,
      ownedId: owned?.id ?? null,
      sceneId: scene.id,
      tokenId: token.id,
      tableId: table.id,
      resultId: result.id,
      controlIds: controls,
      // What actually landed — Foundry can reject or normalise an img on create,
      // and a planted value that never stuck would make every later leg vacuous.
      seen: {
        item: item.img,
        actor: actor.img,
        proto: actor.prototypeToken?.texture?.src,
        owned: owned?.img,
        token: token.texture?.src,
        result: result.img,
        controls: controls.map((id) => game.items.get(id)?.img),
      },
    };
  }, { MOVES, UNTOUCHED });

  const wanted = {
    item: MOVES[3][0], actor: MOVES[0][0], proto: MOVES[1][0],
    owned: MOVES[2][0], token: MOVES[4][0], result: MOVES[0][0],
  };
  const badPlant = Object.entries(wanted).filter(([k, v]) => planted.seen[k] !== v);
  badPlant.length === 0 && UNTOUCHED.every((s, i) => planted.seen.controls[i] === s)
    ? ok("planted an old path on all six surfaces", "+ 2 controls")
    : fail("planted an old path on all six surfaces", JSON.stringify({ badPlant, controls: planted.seen.controls }));

  /* --- reload, and let the ready migration run --------------------------- */

  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });

  // POLL, never sleep. game.ready does not mean the migration finished —
  // Hooks.callAll does not await an async callback, and this phase runs after
  // two others that each make server round trips. A fixed wait here is a race
  // with a comfortable margin, which is what the icons probe learned the hard way.
  let waited = 0;
  const read = () => page.evaluate((p) => {
    const a = game.actors.get(p.actorId);
    const scene = game.scenes.get(p.sceneId);
    const table = game.tables.get(p.tableId);
    return {
      item: game.items.get(p.itemId)?.img ?? null,
      actor: a?.img ?? null,
      proto: a?.prototypeToken?.texture?.src ?? null,
      owned: a?.items.get(p.ownedId)?.img ?? null,
      token: scene?.tokens.get(p.tokenId)?.texture?.src ?? null,
      result: table?.results.get(p.resultId)?.img ?? null,
      controls: p.controlIds.map((id) => game.items.get(id)?.img ?? null),
    };
  }, planted);

  let after = await read();
  const done = (s) => Object.values(s).flat().every((v) => v === null || !/systems\/air-bladder\/(character_|tlomdev\/|game-icons\/|lydia-comer\/)/.test(v));
  for (; waited < 30000 && !done(after); waited += 250) {
    await page.waitForTimeout(250);
    after = await read();
  }

  /* --- one assertion per surface, so a miss names itself ----------------- */

  for (const [label, key, want] of [
    ["a world Item's img", "item", MOVES[3][1]],
    ["an Actor's img", "actor", MOVES[0][1]],
    ["that Actor's prototype token", "proto", MOVES[1][1]],
    ["an owned Item on that Actor", "owned", MOVES[2][1]],
    ["an unlinked Scene token", "token", MOVES[4][1]],
    ["a RollTable result's img snapshot", "result", MOVES[0][1]],
  ]) {
    after[key] === want
      ? ok(`migrated: ${label}`, want.replace("systems/air-bladder/art/", ""))
      : fail(`migrated: ${label}`, `got "${after[key]}", wanted "${want}"`);
  }
  console.log(`        (migration settled after ${waited}ms)`);

  const movedControls = UNTOUCHED.filter((s, i) => after.controls[i] !== s);
  movedControls.length === 0
    ? ok("control: icons/ and an external URL untouched", UNTOUCHED.length + " unchanged")
    : fail("control: icons/ and an external URL untouched", JSON.stringify(after.controls));

  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
  if (errors.length) failed = true;
} catch (err) {
  fail("probe threw", err.message);
} finally {
  // From NODE, off the ids the page returned, so a throw partway through still
  // tidies. Every delete is independent — one failure must not strand the rest.
  if (planted) {
    try {
      await page.evaluate(async (p) => {
        const drop = async (fn) => { try { await fn(); } catch { /* keep going */ } };
        await drop(() => game.items.get(p.itemId)?.delete());
        await drop(() => game.actors.get(p.actorId)?.delete());
        await drop(() => game.scenes.get(p.sceneId)?.delete());
        await drop(() => game.tables.get(p.tableId)?.delete());
        for (const id of p.controlIds) await drop(() => game.items.get(id)?.delete());
      }, planted);
    } catch { /* the browser may already be gone */ }
  }
  await browser.close();
}

console.log(failed ? "\nART PATH PROBE FAILED\n" : "\nart path probe passed\n");
process.exit(failed ? 1 : 0);

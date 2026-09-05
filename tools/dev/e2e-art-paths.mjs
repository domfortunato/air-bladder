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
 *   7. an img already under art/ in the OLD FORMAT (the re-encode rule, which
 *      the prefix table structurally cannot reach) — ONE PER RE-ENCODED
 *      GALLERY, since they are separate rules and one entry proves only itself
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
  // Chains too, since 2026-08-04 — tlomdev's categories became WebP the same
  // day Lydia's did. This line said `.png` on both sides for one commit, which
  // is the whole argument for writing the expectation out by hand: the entry
  // was correct when it described a move, and a change three files away turned
  // it into a claim that the migration must NOT finish its job.
  ["systems/air-bladder/tlomdev/beast/beast1.png", "systems/air-bladder/art/tlomdev/beast/beast1.webp"],
  ["systems/air-bladder/game-icons/weapons/axe-swing.svg", "systems/air-bladder/art/game-icons/weapons/axe-swing.svg"],
  // THREE migrations on ONE path, and the only leg that chains across
  // DIFFERENT extensions. A world last opened before the art/ restructure
  // holds Lydia's gallery at the old PREFIX *and* in the old FORMAT — she
  // shipped .jpg squares and .png circles until the grant was extended on
  // 2026-08-04 — and since 2026-09-05 (generation 2) her 17 monsters also
  // live in the -monsters folders, so the expectation lands there: the
  // filename-pinned move rule and the re-encode have to fire, in order, or
  // the result is a path that is wrong in a different way; and the migration
  // runs once, so there is no second pass. This leg is what caught the chain
  // being real: it was written expecting the prefix move alone and went red
  // the moment the re-encode rule landed.
  ["systems/air-bladder/lydia-comer/portraits/Dragon.jpg", "systems/air-bladder/art/lydia-comer/portraits-monsters/Dragon.webp"],
];
// Generation 2's own group (2026-09-05): the 17 monsters moved into
// portraits-monsters/ + tokens-monsters/ when the character batch took over
// the plain folders. This is the COMMON case — a generation-1 world holds
// them art/-era and .webp already, so no other rule touches the path and
// deleting the filename-pinned move rules fails exactly here. One leg per
// half, because the halves are separate generated rules.
const MOVED_MONSTERS = [
  ["systems/air-bladder/art/lydia-comer/portraits/Dragon.webp", "systems/air-bladder/art/lydia-comer/portraits-monsters/Dragon.webp"],
  ["systems/air-bladder/art/lydia-comer/tokens/Were-Rat.webp", "systems/air-bladder/art/lydia-comer/tokens-monsters/Were-Rat.webp"],
];
// Already under art/, wrong format only — a world made AFTER the restructure but
// BEFORE the WebP conversion. The prefix rule cannot see these at all, so this
// is the group that fails if ART_REENCODED is deleted while ART_MOVES survives.
//
// One entry per re-encoded gallery, because they are separate rules with
// separate `from` patterns and a single entry only ever proves its own. That is
// not hypothetical here: the window between the art/ restructure and the WebP
// conversion is the state of every world that has been tracking `dev`, and the
// two galleries converted in different commits.
const REENCODED = [
  // Since generation 2 the lydia leg chains a MOVE as well — a .png of one of
  // the 17 under the art/-era tokens/ folder is a monster, and lands in
  // tokens-monsters/. The tlomdev leg below is now the one that isolates
  // ART_REENCODED: right folder, wrong format, no move in play.
  ["systems/air-bladder/art/lydia-comer/tokens/Dragon.png", "systems/air-bladder/art/lydia-comer/tokens-monsters/Dragon.webp"],
  ["systems/air-bladder/art/tlomdev/beast/beast1.png", "systems/air-bladder/art/tlomdev/beast/beast1.webp"],
];
// The two tlomdev folders that lost their SPACES (2026-08-04). Each is a
// specific ART_MOVES rule that must win BEFORE the generic tlomdev rule —
// the loop takes the first match, so ordering is the thing under test:
// under the generic rule alone the first path lands on a spaced art/ folder
// that no longer exists. One leg per folder, each also exercising a chain —
// the KW leg crosses the old prefix, the npc leg adds the re-encode.
const RENAMED = [
  ["systems/air-bladder/tlomdev/Kettlewright Portraits/portrait17.webp",
    "systems/air-bladder/art/tlomdev/kettlewright-portraits/portrait17.webp"],
  ["systems/air-bladder/art/tlomdev/human npcs for itmod/npc1.png",
    "systems/air-bladder/art/tlomdev/human-npcs-for-itmod/npc1.webp"],
];
// Must survive UNCHANGED. icons/ is stamped class art and stayed put; the URL
// is a Warden's own image and was never ours to rewrite. The Femme path is
// generation 2's negative control: it sits in the very folder the 17 monsters
// left, so it is exactly what a folder-prefix move rule would wrongly drag
// into portraits-monsters/ — the monster moves are FILENAME-pinned, and a
// character picked into the vacated folder must stay put.
const UNTOUCHED = [
  "systems/air-bladder/icons/generic-item.svg",
  "https://example.invalid/some/portrait.png",
  "systems/air-bladder/art/lydia-comer/portraits/Femme00.webp",
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

  planted = await page.evaluate(async ({ MOVES, UNTOUCHED, REENCODED, RENAMED, MOVED_MONSTERS }) => {
    const old = MOVES.map(([from]) => from);
    const ActorCls = CONFIG.Actor.documentClass;
    const ItemCls = CONFIG.Item.documentClass;

    const item = await ItemCls.create({ name: "zz-art-path-item", type: "item", img: old[3] });

    // The surfaces the PREFIX table cannot reach: already under art/, wrong
    // FORMAT. A world made between the restructure and the WebP conversion
    // looks exactly like this. One document per re-encoded gallery.
    const reencs = [];
    for (const [i, [from]] of REENCODED.entries()) {
      reencs.push(await ItemCls.create({ name: `zz-art-path-reenc-${i}`, type: "item", img: from }));
    }
    const renamed = [];
    for (const [i, [from]] of RENAMED.entries()) {
      renamed.push(await ItemCls.create({ name: `zz-art-path-renamed-${i}`, type: "item", img: from }));
    }
    // The generation-2 surfaces: art/-era, right format, wrong FOLDER — only
    // the filename-pinned monster moves can touch these.
    const movedMon = [];
    for (const [i, [from]] of MOVED_MONSTERS.entries()) {
      movedMon.push(await ItemCls.create({ name: `zz-art-path-monster-${i}`, type: "item", img: from }));
    }

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

    // The token's ActorDELTA — a second copy of the art the scene-token loop
    // cannot reach (review 2026-08-04). Writing through the synthetic actor
    // routes to the delta: its sheet portrait and a delta-only item both held
    // stale paths while the canvas texture migrated, and both rendered blank.
    await token.actor.update({ img: old[0] });
    const [deltaItem] = await token.actor.createEmbeddedDocuments("Item", [
      { name: "zz-art-path-delta-item", type: "item", img: old[2] },
    ]);

    // A WORLD compendium pack, LOCKED — a Warden's curated compendium is the
    // copy-at-creation case with no second chance, and the lock must be
    // restored after the write. Swept first in case a prior aborted run left one.
    for (const p of game.packs.filter((p) => p.metadata.label === "zz-art-path-pack")) {
      await p.deleteCompendium().catch(() => {});
    }
    const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
      label: "zz-art-path-pack", type: "Actor",
    });
    const packActor = await ActorCls.create(
      { name: "zz-art-path-pack-actor", type: "npc", system: { role: "monster" }, img: old[0] },
      { pack: pack.collection },
    );
    await pack.configure({ locked: true });

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
      reencIds: reencs.map((d) => d.id),
      renamedIds: renamed.map((d) => d.id),
      movedMonIds: movedMon.map((d) => d.id),
      actorId: actor.id,
      ownedId: owned?.id ?? null,
      sceneId: scene.id,
      tokenId: token.id,
      deltaItemId: deltaItem?.id ?? null,
      packId: pack.collection,
      packActorId: packActor?.id ?? null,
      tableId: table.id,
      resultId: result.id,
      controlIds: controls,
      // What actually landed — Foundry can reject or normalise an img on create,
      // and a planted value that never stuck would make every later leg vacuous.
      seen: {
        item: item.img,
        reencs: reencs.map((d) => d.img),
        renamed: renamed.map((d) => d.img),
        movedMon: movedMon.map((d) => d.img),
        actor: actor.img,
        proto: actor.prototypeToken?.texture?.src,
        owned: owned?.img,
        token: token.texture?.src,
        deltaImg: token.actor?.img,
        deltaItem: deltaItem?.img,
        packActor: packActor?.img,
        packLocked: pack.locked,
        result: result.img,
        controls: controls.map((id) => game.items.get(id)?.img),
      },
    };
  }, { MOVES, UNTOUCHED, REENCODED, RENAMED, MOVED_MONSTERS });

  const wanted = {
    item: MOVES[3][0], actor: MOVES[0][0], proto: MOVES[1][0],
    owned: MOVES[2][0], token: MOVES[4][0], result: MOVES[0][0],
    deltaImg: MOVES[0][0], deltaItem: MOVES[2][0], packActor: MOVES[0][0],
  };
  // Seven KINDS of surface, more documents than that — the re-encode kind is
  // planted once per gallery, the moved-monster kind once per folder half.
  // Counting documents rather than kinds keeps the number honest the next
  // time a gallery is added.
  const docs = Object.keys(wanted).length + REENCODED.length + RENAMED.length + MOVED_MONSTERS.length;
  const badPlant = Object.entries(wanted).filter(([k, v]) => planted.seen[k] !== v)
    .concat(REENCODED.filter(([from], i) => planted.seen.reencs[i] !== from).map(([from]) => [`reenc:${from}`, from]))
    .concat(RENAMED.filter(([from], i) => planted.seen.renamed[i] !== from).map(([from]) => [`renamed:${from}`, from]))
    .concat(MOVED_MONSTERS.filter(([from], i) => planted.seen.movedMon[i] !== from).map(([from]) => [`monster:${from}`, from]));
  badPlant.length === 0 && UNTOUCHED.every((s, i) => planted.seen.controls[i] === s)
    ? ok("planted an old path on every surface", `${docs} documents + ${UNTOUCHED.length} controls`)
    : fail("planted an old path on every surface", JSON.stringify({ badPlant, controls: planted.seen.controls }));

  /* --- reload, and let the ready migration run --------------------------- */

  // The sweep is GENERATION-gated since review #17 (`art-migration-generation`
  // against cairn.js's ART_MIGRATION_GENERATION): a world that has stamped the
  // current generation skips it on every later load, planted documents
  // included — so this probe went red the day that gate landed (2026-08-21)
  // and nobody ran it until review #18. Re-open the gate for ONE load by
  // putting the marker back to 0; the migration re-stamps the generation after
  // its writes land, which the poll below waits for and the assertion after it
  // checks — the world ends exactly where it began.
  const gen = await page.evaluate(async () => {
    const NS = "air-bladder";
    const before = game.settings.get(NS, "art-migration-generation");
    await game.settings.set(NS, "art-migration-generation", 0);
    return { before };
  });

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
      reencs: p.reencIds.map((id) => game.items.get(id)?.img ?? null),
      renamed: p.renamedIds.map((id) => game.items.get(id)?.img ?? null),
      movedMon: p.movedMonIds.map((id) => game.items.get(id)?.img ?? null),
      actor: a?.img ?? null,
      proto: a?.prototypeToken?.texture?.src ?? null,
      owned: a?.items.get(p.ownedId)?.img ?? null,
      token: scene?.tokens.get(p.tokenId)?.texture?.src ?? null,
      deltaImg: scene?.tokens.get(p.tokenId)?.actor?.img ?? null,
      deltaItem: scene?.tokens.get(p.tokenId)?.actor?.items.get(p.deltaItemId)?.img ?? null,
      // Read the pack's INDEX img, not a cached document — the index is what
      // the compendium browser renders, so it is the user-visible surface.
      packActor: game.packs.get(p.packId)?.index.get(p.packActorId)?.img ?? null,
      packLocked: game.packs.get(p.packId)?.locked ?? null,
      result: table?.results.get(p.resultId)?.img ?? null,
      controls: p.controlIds.map((id) => game.items.get(id)?.img ?? null),
      // The generation marker: re-stamped only after the sweep's last write,
      // so it is the one "done" signal that cannot be read too early.
      generation: game.settings.get("air-bladder", "art-migration-generation"),
    };
  }, planted);

  let after = await read();
  // "Still stale" is TWO questions now. A path under an old prefix is the
  // original one; a `.jpg`/`.png` under art/lydia-comer/ — or a `.png` under
  // art/tlomdev/ — is a re-encode surface, which carries no old prefix at all
  // and so looked finished to the prefix test the instant it was planted -- a
  // poll that returns before the work it waits for has started.
  //
  // STALE_FORMAT has to name every re-encoded gallery for that reason. Leaving
  // tlomdev out would not fail anything; it would make the poll stop early and
  // the assertions below race the migration, which is the failure mode that
  // passes on a re-run and gets called a flake.
  const STALE_PREFIX = /systems\/air-bladder\/(character_|tlomdev\/|game-icons\/|lydia-comer\/)/;
  const STALE_FORMAT = /systems\/air-bladder\/art\/(lydia-comer\/.*\.(jpe?g|png)|tlomdev\/.*\.png)$/i;
  // The art/-era SPACED folder paths carry no old prefix and (for the KW half)
  // no stale extension either — a third stale shape, or the poll stops early.
  const STALE_SPACED = /systems\/air-bladder\/art\/tlomdev\/(human npcs for itmod|Kettlewright Portraits)\//;
  // Generation 2's own stale shape: one of the 17 moved monsters still in the
  // plain art/-era folders, right format and all. FILENAME-scoped, never the
  // folder prefix — those folders now hold the CHARACTER set, whose paths are
  // legitimate; a prefix test would read the Femme00 control as permanently
  // stale and this poll would never finish. Hand-written like every other
  // expectation here, so a broken LYDIA_MOVED_MONSTERS list in cairn.js
  // cannot make this file agree with it.
  const STALE_MONSTER = new RegExp("systems/air-bladder/art/lydia-comer/(portraits|tokens)/("
    + "Bad-Bunny|Bandit-Leader|Black-Pudding|Dire-Bear|Dire-Fish|Dire-Marsupial|Dire-Wolf"
    + "|Dragon-Turtle|Dragon|Estrie-Human|Fire-Elemental|Gnome-with-Cock|Shrieking-Gnoll"
    + "|Stork-Rider|Tentacles|Undead-Mouse|Were-Rat)\\.");
  // packLocked is part of "done": the migration re-locks the world pack in a
  // finally AFTER its last document write, as a settings round-trip. A poll
  // that stops when the PATHS are right reads the lock inside that window and
  // reports the re-lock missing — this probe's own trap, third appearance.
  const done = (s) => s.packLocked === true && s.generation >= 2 && Object.values(s).flat()
    .every((v) => v === null || v === true
      || (!STALE_PREFIX.test(String(v)) && !STALE_FORMAT.test(String(v))
        && !STALE_SPACED.test(String(v)) && !STALE_MONSTER.test(String(v))));
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
    ["that token's DELTA sheet portrait", "deltaImg", MOVES[0][1]],
    ["a delta-only Item on that token", "deltaItem", MOVES[2][1]],
    ["an Actor in a LOCKED world compendium", "packActor", MOVES[0][1]],
    ["a RollTable result's img snapshot", "result", MOVES[0][1]],
  ]) {
    after[key] === want
      ? ok(`migrated: ${label}`, want.replace("systems/air-bladder/art/", ""))
      : fail(`migrated: ${label}`, `got "${after[key]}", wanted "${want}"`);
  }
  // One per renamed folder — the ORDERING leg: the specific rule must beat the
  // generic one (first match wins), and each chains at least one more rewrite.
  for (const [i, [, want]] of RENAMED.entries()) {
    const folder = want.replace("systems/air-bladder/art/tlomdev/", "").split("/")[0];
    const label = `renamed: ${folder}, spaces gone, rule order held`;
    after.renamed[i] === want
      ? ok(`migrated: ${label}`, want.replace("systems/air-bladder/art/", ""))
      : fail(`migrated: ${label}`, `got "${after.renamed[i]}", wanted "${want}"`);
  }
  // One per re-encoded gallery, named by the gallery so a miss says which rule
  // is absent rather than "the re-encode leg".
  for (const [i, [from, want]] of REENCODED.entries()) {
    const gallery = from.replace("systems/air-bladder/art/", "").split("/")[0];
    const label = `re-encoded: ${gallery}, art/ already right, format was not`;
    after.reencs[i] === want
      ? ok(`migrated: ${label}`, want.replace("systems/air-bladder/art/", ""))
      : fail(`migrated: ${label}`, `got "${after.reencs[i]}", wanted "${want}"`);
  }
  // One per folder half — the generation-2 monster move on its own, with no
  // prefix or format rewrite to hide behind.
  for (const [i, [, want]] of MOVED_MONSTERS.entries()) {
    const half = want.includes("/tokens-monsters/") ? "tokens" : "portraits";
    const label = `moved monster: ${half} half, into -monsters`;
    after.movedMon[i] === want
      ? ok(`migrated: ${label}`, want.replace("systems/air-bladder/art/", ""))
      : fail(`migrated: ${label}`, `got "${after.movedMon[i]}", wanted "${want}"`);
  }
  console.log(`        (migration settled after ${waited}ms)`);

  // The migration unlocks a locked pack to write and must put the lock back —
  // a Warden locked that compendium on purpose, and a migration that leaves it
  // open has traded blank art for silent editability.
  after.packLocked === true
    ? ok("the world pack's LOCK was restored", "locked again after the write")
    : fail("the world pack's LOCK was restored", `locked=${after.packLocked}`);
  // The gate, re-closed by the sweep itself: the marker is back at the current
  // generation (the value it held before this probe re-opened it, or 2 on a
  // world that had never stamped one), so the world ends where it began.
  after.generation >= 2 && (gen.before === 0 || after.generation === gen.before)
    ? ok("the generation marker is re-stamped after the sweep", `was ${gen.before}, re-opened to 0, now ${after.generation}`)
    : fail("the generation marker is re-stamped after the sweep", `was ${gen.before}, now ${after.generation}`);

  const movedControls = UNTOUCHED.filter((s, i) => after.controls[i] !== s);
  movedControls.length === 0
    ? ok("control: icons/, an external URL, a character path untouched", UNTOUCHED.length + " unchanged")
    : fail("control: icons/, an external URL, a character path untouched", JSON.stringify(after.controls));

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
        for (const id of p.reencIds) await drop(() => game.items.get(id)?.delete());
        for (const id of p.renamedIds) await drop(() => game.items.get(id)?.delete());
        for (const id of p.movedMonIds) await drop(() => game.items.get(id)?.delete());
        // The world pack: unlock first or the delete is refused.
        await drop(async () => {
          const pk = game.packs.get(p.packId);
          if (!pk) return;
          if (pk.locked) await pk.configure({ locked: false });
          await pk.deleteCompendium();
        });
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

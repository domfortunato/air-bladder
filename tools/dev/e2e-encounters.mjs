#!/usr/bin/env node
/**
 * Encounter tables — the Warden-authorable convention and its one button
 * (module/encounters.js, 2026-08-09).
 *
 *   npm run dev:encounters      (dev world on :30000; needs Alice — npm run dev:players)
 *
 * Plants its OWN scene (viewed for the run, the previously-viewed scene
 * restored from Node in finally — the icon-canvas pattern), its own world
 * table, and a world actor whose prototype token is HOSTILE. Draws are
 * DETERMINISTIC: `table.draw({ roll: new Roll("2") })` — a constant formula —
 * lands on row 2 every time, so no leg's subject is dice-decided.
 *
 * Legs:
 *   1. A drawn goblin row's card carries the Warden's "Add to scene" button
 *      naming what it will do; the SAME message rendered on Alice's client
 *      carries none while the card itself renders (per-viewer injection).
 *   2. Clicking it places exactly 3 goblin tokens: NEUTRAL, unlinked,
 *      grid-clustered around the view centre, and exactly ONE world actor
 *      imported into the flag-marked "Encounters" folder.
 *   2b. The world-actor row: 2 tokens for a HOSTILE-prototype world actor come
 *      out NEUTRAL — the built-in witness that the disposition is FORCED, not
 *      inherited (drop the force and this leg reds on its own) — and no
 *      import happens for a world link.
 *   3. The stamp: after the click the card re-renders "Added" with the button
 *      spent, and driving spawnEncounterFromMessage directly a second time
 *      returns null and places nothing (the stamp, not the greying, refuses).
 *   4. A SECOND goblin draw reuses the imported world actor — still exactly
 *      one — while placing its own tokens (the 1d6 ogre row also runs here:
 *      1..6 tokens, one imported ogre).
 *   5. The plain-text row earns no button.
 *   6. The random-NPC row mints a fresh person NPC (portrait, statblock) in
 *      the Encounters folder with a token on the scene.
 *   7. Alice driving the export directly is refused: null return, no tokens,
 *      no stamp (the differential with leg 2 is the isGM witness).
 *   8. With canvas.scene shadowed to null IN-PAGE (a define/restore, never a
 *      world write), the spawn refuses before rolling: no quantity-roll
 *      message, no stamp.
 *   9. Row 6 carries TWO results on one number — the only shape that puts more
 *      than one spec on a button — and the button joins them through
 *      Intl.ListFormat, not a hardcoded ", " that would stay English in every
 *      language. Read, never clicked.
 *  10. A mid-spawn throw is CAUGHT and told (review #22): the handler was
 *      try/finally only behind a fire-and-forget onclick, so a failed token
 *      mint was pure silence. Planted in-page (Scene#createEmbeddedDocuments
 *      shadowed for Token writes, restored in finally): the real click yields
 *      the CAIRN.Notify.EncounterFailed toast, the card stays un-stamped, and
 *      a retry with the shadow lifted completes — the lock released.
 *  11. The injection seam (review #22): injectEncounterButton fires un-awaited
 *      from the render hook (recorded intent), and its rejection used to
 *      escape Hooks.#call's SYNCHRONOUS try/catch as an unhandled rejection
 *      naming nothing. A message whose spent-stamp read throws must land in
 *      the call site's catch, not as an unhandled rejection.
 *
 * Everything planted is swept from Node, names and ids printed. The
 * "Encounters" folder is deleted only when THIS run created it.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

const GOBLIN_UUID = "Compendium.air-bladder.monsters.Actor.S6lcn0jsoTeJgqst";
const OGRE_UUID = "Compendium.air-bladder.monsters.Actor.jgtycd2HoWTQEU5T";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(52)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(52)} ${d}`); failures++; };

watchdog(360000, "encounters probe");
const browser = await chromium.launch();
const gm = await browser.newPage({ viewport: VIEWPORT });
const gmErrors = watchErrors(gm);
await gm.goto(FOUNDRY_URL);
await joinAsGM(gm);
await dismissChrome(gm);

/** Poll in-page until fn() is truthy (or times out) — the button lands async. */
const until = async (page, fn, arg, ms = 8000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await page.evaluate(fn, arg);
    if (last) return last;
    await page.waitForTimeout(200);
  }
  return last;
};

const cleanup = { sceneId: null, tableId: null, actorIds: [], messageIds: [], folderId: null, prevSceneId: null, msgsAtStart: [] };
// The chat log before this run (review #34 finding 255): every real Add-to-scene
// quantity roll's flavor starts "Encounter: ", and the sweep took them all.
cleanup.msgsAtStart = await gm.evaluate(() => game.messages.map((m) => m.id));

try {
  /* ---------------------------------------------------------- fixtures ---- */
  const fx = await gm.evaluate(async ({ GOBLIN_UUID, OGRE_UUID }) => {
    // Sweep leftovers from a run that died midway, so a stale sack never
    // becomes a permanent failure.
    for (const a of game.actors.filter((x) => x.name?.startsWith("ZZ Enc"))) await a.delete();
    for (const s of game.scenes.filter((x) => x.name === "ZZ Encounter Scene")) await s.delete();
    for (const t of game.tables.filter((x) => x.name === "ZZ Encounter Table")) await t.delete();

    const out = { prevSceneId: game.scenes.viewed?.id ?? null };
    // The folder is found by flag; remember whether it predates this run.
    out.folderPreexisting = !!game.folders.find((f) => f.type === "Actor" && f.getFlag(game.system.id, "encounters"));
    // Baseline counts for the delta assertions — the dev world may already
    // hold user-imported copies of these monsters, and deleting those to
    // green a leg is exactly what the probe rules forbid.
    out.goblinsBefore = game.actors.filter((a) => a._stats?.compendiumSource === GOBLIN_UUID).map((a) => a.id);
    out.ogresBefore = game.actors.filter((a) => a._stats?.compendiumSource === OGRE_UUID).map((a) => a.id);
    out.msgsBefore = game.messages.size;

    const hostile = await CONFIG.Actor.documentClass.create({
      name: "ZZ Enc Hostile", type: "npc",
      system: { role: "monster", generationEnabled: false, hp: { value: 4, max: 4 } },
      prototypeToken: { disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE },
    });
    out.hostileId = hostile.id;

    const scene = await Scene.create({
      name: "ZZ Encounter Scene", width: 2000, height: 2000,
      grid: { type: CONST.GRID_TYPES.SQUARE, size: 100 },
      padding: 0.1, backgroundColor: "#222222",
    });
    out.sceneId = scene.id;
    await scene.view();

    const table = await RollTable.create({
      name: "ZZ Encounter Table", formula: "1d6", replacement: true, displayRoll: true,
      results: [
        { type: "text", description: `3 @UUID[${GOBLIN_UUID}]{Goblins} prowl the hall.`, range: [1, 1], weight: 1 },
        { type: "text", description: `1d6 @UUID[${OGRE_UUID}]{Ogres} argue over bones.`, range: [2, 2], weight: 1 },
        { type: "text", description: "All quiet — nothing stirs.", range: [3, 3], weight: 1 },
        { type: "text", description: "1 random NPC wanders through, lost.", range: [4, 4], weight: 1 },
        { type: "text", description: `2 @UUID[Actor.${hostile.id}]{Bandits} block the way.`, range: [5, 5], weight: 1 },
        // TWO rows on one number, which a Warden's table is free to have — and
        // the only shape that puts more than one spec on a button, where the
        // list SEPARATOR becomes visible. Row 6 is read, never clicked.
        { type: "text", description: `2 @UUID[${GOBLIN_UUID}]{Goblins} skulk in the dark.`, range: [6, 6], weight: 1 },
        { type: "text", description: `1 @UUID[${OGRE_UUID}]{Ogre} waits behind them.`, range: [6, 6], weight: 1 },
      ],
    });
    out.tableId = table.id;
    return out;
  }, { GOBLIN_UUID, OGRE_UUID });
  cleanup.sceneId = fx.sceneId;
  cleanup.tableId = fx.tableId;
  cleanup.prevSceneId = fx.prevSceneId;
  cleanup.actorIds.push(fx.hostileId);
  cleanup.folderPreexisting = fx.folderPreexisting;

  // Wait for the planted scene's canvas — spawning reads canvas.stage.pivot.
  await until(gm, () => canvas?.ready && canvas.scene?.name === "ZZ Encounter Scene");

  /** Draw row N deterministically; resolves to the created message id. */
  const draw = async (n) => {
    const id = await gm.evaluate(async ({ tableId, n }) => {
      const table = game.tables.get(tableId);
      const before = new Set(game.messages.keys());
      await table.draw({ roll: new Roll(String(n)) });
      return [...game.messages.keys()].find((k) => !before.has(k)) ?? null;
    }, { tableId: fx.tableId, n });
    if (id) cleanup.messageIds.push(id);
    return id;
  };

  const buttonState = (page, msgId) => until(page, (msgId) => {
    const el = document.querySelector(`[data-message-id="${msgId}"] .encounter-spawn`);
    return el ? { text: el.textContent, disabled: el.disabled } : null;
  }, msgId);

  /* --------------------------------------------- 1. the per-viewer button -- */
  const goblinMsg = await draw(1);
  const gmBtn = await buttonState(gm, goblinMsg);
  gmBtn && /Goblins/.test(gmBtn.text) && /3/.test(gmBtn.text)
    ? ok("the Warden's card grows the button, naming the work", `"${gmBtn.text}"`)
    : fail("the Warden's card grows the button, naming the work", JSON.stringify(gmBtn));

  const alice = await browser.newPage({ viewport: VIEWPORT });
  const aliceErrors = watchErrors(alice);
  await alice.goto(FOUNDRY_URL);
  await joinAs(alice, "Alice");
  await dismissChrome(alice);
  const aliceView = await until(alice, (msgId) => {
    const card = document.querySelector(`[data-message-id="${msgId}"] .table-draw`);
    return card ? { hasButton: !!card.querySelector(".encounter-spawn") } : null;
  }, goblinMsg);
  aliceView && aliceView.hasButton === false
    ? ok("the same card on Alice's client has no button", "injected per viewer, nothing to trim")
    : fail("the same card on Alice's client has no button", JSON.stringify(aliceView));

  /* -------------------------------------------------- 2. the goblin click -- */
  const spawn1 = await gm.evaluate(async ({ msgId, GOBLIN_UUID, goblinsBefore }) => {
    document.querySelector(`[data-message-id="${msgId}"] .encounter-spawn`)?.click();
    for (let i = 0; i < 50 && !game.messages.get(msgId)?.getFlag(game.system.id, "encounterSpawned"); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const scene = canvas.scene;
    const gs = scene.grid.size;
    const c = canvas.stage.pivot;
    const toks = scene.tokens.contents;
    const goblins = game.actors.filter((a) => a._stats?.compendiumSource === GOBLIN_UUID);
    const folder = game.folders.find((f) => f.type === "Actor" && f.getFlag(game.system.id, "encounters"));
    return {
      stamped: !!game.messages.get(msgId)?.getFlag(game.system.id, "encounterSpawned"),
      tokens: toks.length,
      neutral: toks.every((t) => t.disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL),
      unlinked: toks.every((t) => !t.actorLink),
      clustered: toks.every((t) => Math.abs(t.x - c.x) <= 4 * gs && Math.abs(t.y - c.y) <= 4 * gs),
      stacked: new Set(toks.map((t) => `${t.x},${t.y}`)).size === toks.length,
      goblinActors: goblins.map((a) => a.id),
      // The NEW goblin, in THE folder (review #34 finding 28): this accepted
      // any goblin with no folder at all, over every goblin in the world, so an
      // import that dropped `{folder}` stayed green. Read by id difference.
      goblinInFolder: goblins.filter((a) => !goblinsBefore.includes(a.id)).length > 0
        && goblins.filter((a) => !goblinsBefore.includes(a.id)).every((a) => !!folder && a.folder?.id === folder.id),
      folderId: folder?.id ?? null,
    };
  }, { msgId: goblinMsg, GOBLIN_UUID, goblinsBefore: fx.goblinsBefore });
  cleanup.folderId = spawn1.folderId;
  const newGoblins = spawn1.goblinActors.filter((id) => !fx.goblinsBefore.includes(id));
  cleanup.actorIds.push(...newGoblins);
  spawn1.stamped && spawn1.tokens === 3
    ? ok("three goblin tokens for the fixed '3' row", `${spawn1.tokens} placed, card stamped`)
    : fail("three goblin tokens for the fixed '3' row", JSON.stringify(spawn1));
  spawn1.neutral
    ? ok("every token NEUTRAL", "")
    : fail("every token NEUTRAL", "a placed token kept another disposition");
  spawn1.unlinked && spawn1.clustered && spawn1.stacked
    ? ok("unlinked, clustered at view centre, none stacked", "")
    : fail("unlinked, clustered at view centre, none stacked", JSON.stringify(spawn1));
  newGoblins.length === 1 && spawn1.goblinInFolder && spawn1.folderId
    ? ok("ONE goblin imported, into the flagged Encounters folder", newGoblins[0])
    : fail("ONE goblin imported, into the flagged Encounters folder", `new=${newGoblins.length} folder=${spawn1.folderId}`);

  // THE QUANTITY ROLL'S FLAVOR, PER VIEWER (review #27). "3 × Goblin" was
  // composed on the Warden's client — creature name through the overlay ON
  // THAT CLIENT — and stored on a public roll card, so a Spanish player read
  // the Warden's language. The flag carries the ENGLISH label; the line is
  // rebuilt per viewer. Measured with an overlay installed AFTER the card
  // exists and one re-render, the dashboard probe's method.
  const qtyViewer = await gm.evaluate(async () => {
    const i18n = await import("/systems/air-bladder/module/i18n-content.js");
    const msg = game.messages.contents.slice().reverse().find((m) => m.getFlag("air-bladder", "encounterQty"));
    if (!msg) return { error: "no quantity roll carries the encounterQty flag" };
    const f = msg.getFlag("air-bladder", "encounterQty");
    const ES = "ZZ-BESTIA";
    try {
      i18n._setOverlay({ "monster.name": { [f.label]: ES } });
      await ui.chat.updateMessage(msg);
      await new Promise((r) => setTimeout(r, 700));
      return {
        label: f.label,
        flavor: document.querySelector(`[data-message-id="${msg.id}"] .flavor-text`)?.textContent ?? "",
        stored: msg.flavor ?? "",
      };
    } finally {
      i18n._setOverlay(null);
      await ui.chat.updateMessage(msg);
    }
  });
  !qtyViewer.error && qtyViewer.flavor.includes("ZZ-BESTIA") && !qtyViewer.stored.includes("ZZ-BESTIA")
    ? ok("the quantity roll's flavor re-renders per viewer off its English label", qtyViewer.flavor)
    : fail("the quantity roll's flavor is the stored sentence", JSON.stringify(qtyViewer));

  /* ---------------------- 2b. world-actor row: the NEUTRAL force witnessed -- */
  const banditMsg = await draw(5);
  await buttonState(gm, banditMsg);
  const spawn2 = await gm.evaluate(async ({ msgId, hostileId }) => {
    const before = canvas.scene.tokens.size;
    document.querySelector(`[data-message-id="${msgId}"] .encounter-spawn`)?.click();
    for (let i = 0; i < 50 && !game.messages.get(msgId)?.getFlag(game.system.id, "encounterSpawned"); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const added = canvas.scene.tokens.contents.filter((t) => t.actorId === hostileId);
    return {
      delta: canvas.scene.tokens.size - before,
      added: added.length,
      neutral: added.every((t) => t.disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL),
      protoHostile: game.actors.get(hostileId)?.prototypeToken.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE,
      actorCount: game.actors.filter((a) => a.name === "ZZ Enc Hostile").length,
    };
  }, { msgId: banditMsg, hostileId: fx.hostileId });
  spawn2.added === 2 && spawn2.neutral && spawn2.protoHostile
    ? ok("a HOSTILE prototype comes out NEUTRAL", "the force, not the pass-through — the built-in witness")
    : fail("a HOSTILE prototype comes out NEUTRAL", JSON.stringify(spawn2));
  spawn2.actorCount === 1
    ? ok("a world-actor link imports nothing", "the actor is used as-is")
    : fail("a world-actor link imports nothing", `${spawn2.actorCount} copies exist`);

  /* --------------------------------------------------------- 3. the stamp -- */
  const second = await gm.evaluate(async ({ msgId }) => {
    const el = document.querySelector(`[data-message-id="${msgId}"] .encounter-spawn`);
    const enc = await import("/systems/air-bladder/module/encounters.js");
    const before = canvas.scene.tokens.size;
    const msgsBefore = game.messages.size;
    const r = await enc.spawnEncounterFromMessage(game.messages.get(msgId));
    return {
      spent: !!el && el.disabled && el.classList.contains("spent"),
      returned: r,
      tokensAdded: canvas.scene.tokens.size - before,
      messagesAdded: game.messages.size - msgsBefore,
    };
  }, { msgId: goblinMsg });
  second.spent
    ? ok("the card re-rendered Added, button spent", "")
    : fail("the card re-rendered Added, button spent", JSON.stringify(second));
  second.returned === null && second.tokensAdded === 0 && second.messagesAdded === 0
    ? ok("a second spawn refuses at the stamp", "null, no tokens, no quantity roll")
    : fail("a second spawn refuses at the stamp", JSON.stringify(second));

  /* ---------------------------------------- 4. reuse + the 1d6 ogre range -- */
  const goblin2Msg = await draw(1);
  await buttonState(gm, goblin2Msg);
  const ogreMsg = await draw(2);
  await buttonState(gm, ogreMsg);
  const reuse = await gm.evaluate(async ({ goblinMsg, ogreMsg, GOBLIN_UUID, OGRE_UUID }) => {
    const before = canvas.scene.tokens.size;
    document.querySelector(`[data-message-id="${goblinMsg}"] .encounter-spawn`)?.click();
    for (let i = 0; i < 50 && !game.messages.get(goblinMsg)?.getFlag(game.system.id, "encounterSpawned"); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const afterGoblin = canvas.scene.tokens.size;
    document.querySelector(`[data-message-id="${ogreMsg}"] .encounter-spawn`)?.click();
    for (let i = 0; i < 50 && !game.messages.get(ogreMsg)?.getFlag(game.system.id, "encounterSpawned"); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return {
      goblinTokens: afterGoblin - before,
      goblinActors: game.actors.filter((a) => a._stats?.compendiumSource === GOBLIN_UUID).map((a) => a.id),
      ogreTokens: canvas.scene.tokens.size - afterGoblin,
      ogreActors: game.actors.filter((a) => a._stats?.compendiumSource === OGRE_UUID).map((a) => a.id),
    };
  }, { goblinMsg: goblin2Msg, ogreMsg, GOBLIN_UUID, OGRE_UUID });
  const goblinsNow = reuse.goblinActors.filter((id) => !fx.goblinsBefore.includes(id));
  const ogresNow = reuse.ogreActors.filter((id) => !fx.ogresBefore.includes(id));
  cleanup.actorIds.push(...ogresNow.filter((id) => !cleanup.actorIds.includes(id)));
  reuse.goblinTokens === 3 && goblinsNow.length === 1
    ? ok("a second goblin encounter REUSES the import", "3 more tokens, still one actor")
    : fail("a second goblin encounter REUSES the import", JSON.stringify({ ...reuse, goblinsNow }));
  reuse.ogreTokens >= 1 && reuse.ogreTokens <= 6 && ogresNow.length === 1
    ? ok("the 1d6 row places 1..6, one ogre imported", `${reuse.ogreTokens} tokens`)
    : fail("the 1d6 row places 1..6, one ogre imported", JSON.stringify({ ...reuse, ogresNow }));

  /* --- 4b-4d. whose copy, how many copies, and who hears (review #34 ------
   * findings 122, 137, 127). Two shipped monsters with NO world copy yet are
   * picked off the pack, so the legs read this run's imports alone.
   *   4b (122) the "reuse the world copy" test was `_stats.compendiumSource`,
   *      which any owner can write: a PLAYER's actor wearing a monster's
   *      source was placed, and its tokens were theirs to move.
   *   4c (137) two cards for one un-imported monster pressed together each
   *      missed the find and imported it twice.
   *   4d (127) the quantity roll took the Warden's chat dropdown, so a card
   *      drawn privately was followed by a public "Encounter: …".
   * -------------------------------------------------------------------- */
  const fresh = await gm.evaluate(async ({ tableId }) => {
    const pack = game.packs.get("air-bladder.monsters");
    const index = await pack.getIndex();
    const stamped = new Set(game.actors.map((a) => a._stats?.compendiumSource).filter(Boolean));
    const free = index.contents.filter((e) => !stamped.has(e.uuid)).slice(0, 2);
    if (free.length < 2) return { error: "fewer than two shipped monsters lack a world copy" };
    const [a, b] = free;
    const aliceId = game.users.getName("Alice")?.id;
    const planted = await CONFIG.Actor.documentClass.create({
      name: "ZZ Enc Planted", type: "character",
      ownership: { default: 0, ...(aliceId ? { [aliceId]: 3 } : {}) },
      _stats: { compendiumSource: a.uuid },
    });
    await game.tables.get(tableId).createEmbeddedDocuments("TableResult", [
      { type: "text", description: `2 @UUID[${a.uuid}]{Planted} lurk.`, range: [7, 7], weight: 1 },
      { type: "text", description: `2 @UUID[${b.uuid}]{Twins} lurk.`, range: [8, 8], weight: 1 },
    ]);
    return { a: a.uuid, b: b.uuid, plantedId: planted.id,
      plantedStamped: planted._stats?.compendiumSource === a.uuid, aliceOwns: planted.hasPlayerOwner };
  }, { tableId: fx.tableId });
  if (fresh.error) {
    fail("the whose-copy legs found their monsters", fresh.error);
  } else {
    cleanup.actorIds.push(fresh.plantedId);
    const press = (ids) => gm.evaluate(async (ids) => {
      for (const id of ids) document.querySelector(`[data-message-id="${id}"] .encounter-spawn`)?.click();
      for (let i = 0; i < 60 && !ids.every((id) => game.messages.get(id)?.getFlag(game.system.id, "encounterSpawned")); i++) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }, ids);
    const copies = (uuid) => gm.evaluate((uuid) =>
      game.actors.filter((a) => a._stats?.compendiumSource === uuid).map((a) => a.id), uuid);

    // 4b
    const plantedMsg = await draw(7);
    await buttonState(gm, plantedMsg);
    const before4b = await gm.evaluate(() => canvas.scene.tokens.map((t) => t.id));
    await press([plantedMsg]);
    const r4b = await gm.evaluate(({ before, plantedId }) => {
      const added = canvas.scene.tokens.filter((t) => !before.includes(t.id));
      return { added: added.length, onPlanted: added.filter((t) => t.actorId === plantedId).length };
    }, { before: before4b, plantedId: fresh.plantedId });
    const aCopies = await copies(fresh.a);
    cleanup.actorIds.push(...aCopies.filter((id) => id !== fresh.plantedId && !cleanup.actorIds.includes(id)));
    fresh.plantedStamped && fresh.aliceOwns && r4b.added === 2 && r4b.onPlanted === 0
      ? ok("a player's actor wearing a monster's source is never the encounter's copy", "a Warden's copy was imported")
      : fail("a player's actor wearing a monster's source is never the encounter's copy", JSON.stringify({ ...fresh, ...r4b }));

    // 4c. THE WINDOW IS WIDENED IN-PAGE, or the leg measures luck: two clicks
    // a tick apart raced only when the second card's find landed inside the
    // first one's import round trip, and the first fleet run of this leg
    // passed on unfixed code. The import is held 600ms before it runs — the
    // real import, unchanged, just late — so both cards are inside it.
    const twinA = await draw(8);
    const twinB = await draw(8);
    await buttonState(gm, twinA);
    await buttonState(gm, twinB);
    const r4c = await gm.evaluate(async ({ ids }) => {
      const before = canvas.scene.tokens.map((t) => t.id);
      const real = game.actors.importFromCompendium;
      game.actors.importFromCompendium = async function (...a) {
        await new Promise((r) => setTimeout(r, 600));
        return real.apply(this, a);
      };
      try {
        const enc = await import("/systems/air-bladder/module/encounters.js");
        await Promise.all(ids.map((id) => enc.spawnEncounterFromMessage(game.messages.get(id))));
      } finally {
        game.actors.importFromCompendium = real;
      }
      return {
        stamped: ids.every((id) => game.messages.get(id)?.getFlag(game.system.id, "encounterSpawned")),
        tokens: canvas.scene.tokens.filter((t) => !before.includes(t.id)).length,
      };
    }, { ids: [twinA, twinB] });
    const bCopies = await copies(fresh.b);
    cleanup.actorIds.push(...bCopies.filter((id) => !cleanup.actorIds.includes(id)));
    const folders = await gm.evaluate(() =>
      game.folders.filter((f) => f.type === "Actor" && f.getFlag(game.system.id, "encounters")).length);
    r4c.stamped && r4c.tokens === 4 && bCopies.length === 1 && folders === 1
      ? ok("two cards for one monster spawned together import it ONCE", "4 tokens, one copy, one Encounters folder")
      : fail("two cards for one monster spawned together import it ONCE", JSON.stringify({ ...r4c, copies: bCopies.length, folders }));

    // 4d
    const privMsg = await gm.evaluate(async ({ tableId }) => {
      const before = new Set(game.messages.keys());
      await game.tables.get(tableId).draw({ roll: new Roll("1"), messageMode: "gm" });
      return [...game.messages.keys()].find((k) => !before.has(k)) ?? null;
    }, { tableId: fx.tableId });
    if (privMsg) cleanup.messageIds.push(privMsg);
    await buttonState(gm, privMsg);
    const qtyBefore = await gm.evaluate(() => game.messages.map((m) => m.id));
    // The Warden's own dropdown on PUBLIC for the press, so the leg cannot
    // pass on a dev client left on Private (a client setting; put back after).
    const modeWas = await gm.evaluate(async () => {
      const was = game.settings.get("core", "messageMode");
      await game.settings.set("core", "messageMode", "public");
      return was;
    });
    try { await press([privMsg]); } finally {
      await gm.evaluate((v) => game.settings.set("core", "messageMode", v), modeWas);
    }
    const r4d = await gm.evaluate(({ privMsg, qtyBefore }) => {
      const card = game.messages.get(privMsg);
      const qty = game.messages.filter((m) => !qtyBefore.includes(m.id) && m.getFlag("air-bladder", "encounterQty"));
      return { cardWhisper: card?.whisper?.length ?? 0, qty: qty.length,
        qtyWhispered: qty.every((m) => m.whisper.length > 0) };
    }, { privMsg, qtyBefore });
    r4d.cardWhisper > 0 && r4d.qty >= 1 && r4d.qtyWhispered
      ? ok("a privately drawn card's quantity roll stays private", `${r4d.qty} roll(s), whispered`)
      : fail("a privately drawn card's quantity roll stays private", JSON.stringify(r4d));
  }

  /* ------------------------------------------------- 5. plain text is inert */
  const quietMsg = await draw(3);
  await gm.waitForTimeout(1500);
  const quiet = await gm.evaluate((msgId) => {
    const card = document.querySelector(`[data-message-id="${msgId}"] .table-draw`);
    return { card: !!card, button: !!card?.querySelector(".encounter-spawn") };
  }, quietMsg);
  quiet.card && !quiet.button
    ? ok("the plain-text row earns no button", "parseability is the detection")
    : fail("the plain-text row earns no button", JSON.stringify(quiet));

  /* ----------------------------------------------------- 6. the random NPC */
  const npcMsg = await draw(4);
  await buttonState(gm, npcMsg);
  const npcLeg = await gm.evaluate(async ({ msgId, folderId }) => {
    const beforeActors = new Set(game.actors.keys());
    const beforeTokens = canvas.scene.tokens.size;
    document.querySelector(`[data-message-id="${msgId}"] .encounter-spawn`)?.click();
    for (let i = 0; i < 75 && !game.messages.get(msgId)?.getFlag(game.system.id, "encounterSpawned"); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const minted = game.actors.filter((a) => !beforeActors.has(a.id));
    const npc = minted[0];
    return {
      minted: minted.map((a) => ({ id: a.id, name: a.name })),
      tokensAdded: canvas.scene.tokens.size - beforeTokens,
      person: npc ? npc.type === "npc" && npc.npcRole === "npc" : false,
      inFolder: npc?.folder?.id === folderId,
      statted: npc ? npc.system.hp.max > 0 && npc.system.background !== "" : false, // role npc: a Background, never a Career
      hasFace: npc ? !npc.img?.includes("mystery-man") : false,
    };
  }, { msgId: npcMsg, folderId: cleanup.folderId });
  cleanup.actorIds.push(...npcLeg.minted.map((m) => m.id));
  npcLeg.minted.length === 1 && npcLeg.tokensAdded === 1 && npcLeg.person
    ? ok("the random-NPC row mints one fresh person with a token", npcLeg.minted[0]?.name ?? "")
    : fail("the random-NPC row mints one fresh person with a token", JSON.stringify(npcLeg));
  npcLeg.inFolder && npcLeg.statted && npcLeg.hasFace
    ? ok("generated, not blank: folder, statblock, portrait", "")
    : fail("generated, not blank: folder, statblock, portrait", JSON.stringify(npcLeg));

  /* -------------------------------------------------- 7. Alice is refused -- */
  const freshMsg = await draw(1);
  await gm.waitForTimeout(800);
  const tokensBeforeAlice = await gm.evaluate((sceneId) => game.scenes.get(sceneId).tokens.size, fx.sceneId);
  const aliceTry = await alice.evaluate(async (msgId) => {
    const enc = await import("/systems/air-bladder/module/encounters.js");
    const msg = game.messages.get(msgId);
    if (!msg) return { missing: true };
    const r = await enc.spawnEncounterFromMessage(msg);
    return {
      returned: r,
      stamped: !!msg.getFlag(game.system.id, "encounterSpawned"),
    };
  }, freshMsg);
  const tokensAfterAlice = await gm.evaluate((sceneId) => game.scenes.get(sceneId).tokens.size, fx.sceneId);
  aliceTry.returned === null && aliceTry.stamped === false && tokensAfterAlice === tokensBeforeAlice
    ? ok("Alice driving the export is refused", "null, unstamped, nothing placed — the isGM differential with leg 2")
    : fail("Alice driving the export is refused", JSON.stringify(aliceTry));

  /* -------------------------------------------- 8. the no-scene guard ------ */
  const noScene = await gm.evaluate(async (msgId) => {
    const enc = await import("/systems/air-bladder/module/encounters.js");
    const msg = game.messages.get(msgId);
    const msgsBefore = game.messages.size;
    // Shadow IN-PAGE, restore in finally — never a world write. The own
    // property masks the prototype getter; deleting it restores the real one.
    Object.defineProperty(canvas, "scene", { value: null, configurable: true });
    try {
      const r = await enc.spawnEncounterFromMessage(msg);
      return {
        returned: r,
        stamped: !!msg.getFlag(game.system.id, "encounterSpawned"),
        messagesAdded: game.messages.size - msgsBefore,
      };
    } finally {
      delete canvas.scene;
    }
  }, freshMsg);
  noScene.returned === null && !noScene.stamped && noScene.messagesAdded === 0
    ? ok("no viewed scene: refused before anything rolls", "no quantity message, no stamp")
    : fail("no viewed scene: refused before anything rolls", JSON.stringify(noScene));

  /* ------------------------------- 9. two specs, and a LOCALIZED join ------ */
  // The button's label is a translated sentence with a list inside it. A
  // hardcoded ", " leaves that one fragment in English no matter the client's
  // language — the same "one surface, two answers" tell the overlay rounds
  // chase. Read only: this row is never clicked, so nothing is placed.
  const pairMsg = await draw(6);
  const pairBtn = await buttonState(gm, pairMsg);
  const wantJoin = await gm.evaluate(() =>
    game.i18n.getListFormatter().format(["2 × Goblins", "1 × Ogre"]));
  pairBtn?.text?.includes(wantJoin)
    ? ok("two rows on one number join through Intl.ListFormat", `"${wantJoin}"`)
    : fail("two rows on one number join through Intl.ListFormat",
        `button read "${pairBtn?.text}", wanted it to contain "${wantJoin}"`);

  /* ---------------- 10. a mid-spawn throw is CAUGHT and said (review #22) -- */
  const failMsg = await draw(1);
  await buttonState(gm, failMsg);
  const caught = await gm.evaluate(async ({ msgId }) => {
    const out = { toasts: [], consoleCaught: 0 };
    const SceneCls = CONFIG.Scene.documentClass;
    const origCreate = SceneCls.prototype.createEmbeddedDocuments;
    const origError = console.error;
    const origToast = ui.notifications.error.bind(ui.notifications);
    SceneCls.prototype.createEmbeddedDocuments = async function (type, ...rest) {
      if (type === "Token") throw new Error("ZZ Enc planted token failure");
      return origCreate.call(this, type, ...rest);
    };
    // The planted failure's own console lines are swallowed (the catch's line
    // counted, the toast's echo — core logs an error notification to console
    // too — just dropped), so the zero-console-errors leg stays meaningful
    // for everything else.
    const wantText = game.i18n.localize("CAIRN.Notify.EncounterFailed");
    console.error = (...a) => {
      const s = String(a[0]);
      if (/encounter spawn failed/.test(s)) { out.consoleCaught++; return; }
      if (s.includes(wantText)) return;
      return origError(...a);
    };
    ui.notifications.error = (...a) => { out.toasts.push(String(a[0])); return origToast(...a); };
    try {
      document.querySelector(`[data-message-id="${msgId}"] .encounter-spawn`)?.click();
      for (let i = 0; i < 50 && !out.toasts.length; i++) await new Promise((r) => setTimeout(r, 200));
      // Core echoes a notification to console when it is DISPLAYED (`#fetch`),
      // not when it is raised: with MAX_ACTIVE toasts already showing it QUEUES,
      // and the echo landed after the filter below was taken down, red on the
      // zero-errors leg (fleet 20261031T043716Z). So the filter stays up until
      // the toast is on screen.
      const shown = () => [...document.querySelectorAll("#notifications .notification")]
        .some((n) => n.textContent.includes(wantText));
      for (let i = 0; i < 100 && out.toasts.length && !shown(); i++) await new Promise((r) => setTimeout(r, 200));
    } finally {
      SceneCls.prototype.createEmbeddedDocuments = origCreate;
      console.error = origError;
      ui.notifications.error = origToast;
    }
    out.want = game.i18n.localize("CAIRN.Notify.EncounterFailed");
    out.stamped = !!game.messages.get(msgId)?.getFlag(game.system.id, "encounterSpawned");
    return out;
  }, { msgId: failMsg });
  caught.toasts.length === 1 && caught.toasts[0] === caught.want && caught.consoleCaught === 1
    ? ok("a mid-spawn throw is caught and TOLD", `"${caught.want}"`)
    : fail("a mid-spawn throw is caught and TOLD", JSON.stringify(caught));
  caught.stamped === false
    ? ok("the failed card stays un-stamped — the button remains the retry", "")
    : fail("the failed card stays un-stamped — the button remains the retry", "stamped after a failure");

  const retry = await gm.evaluate(async ({ msgId }) => {
    const before = canvas.scene.tokens.size;
    document.querySelector(`[data-message-id="${msgId}"] .encounter-spawn`)?.click();
    for (let i = 0; i < 50 && !game.messages.get(msgId)?.getFlag(game.system.id, "encounterSpawned"); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return {
      stamped: !!game.messages.get(msgId)?.getFlag(game.system.id, "encounterSpawned"),
      tokensAdded: canvas.scene.tokens.size - before,
    };
  }, { msgId: failMsg });
  retry.stamped && retry.tokensAdded === 3
    ? ok("the retry lands: the lock released and the spawn completes", `${retry.tokensAdded} tokens`)
    : fail("the retry lands: the lock released and the spawn completes", JSON.stringify(retry));

  /* ----------- 11. the injection seam: a rejected inject is caught too ----- */
  const inj = await gm.evaluate(async ({ tableId }) => {
    const out = { caught: 0, unhandled: 0 };
    const onUn = (e) => {
      if (/ZZ Enc planted getFlag/.test(String(e.reason?.message ?? e.reason))) { out.unhandled++; e.preventDefault(); }
    };
    window.addEventListener("unhandledrejection", onUn);
    const origError = console.error;
    console.error = (...a) => {
      if (/encounter button injection failed/.test(String(a[0]))) { out.caught++; return; }
      return origError(...a);
    };
    const div = document.createElement("div");
    div.innerHTML = '<div class="table-draw"></div>';
    // Enough of a ChatMessage for every render-hook handler to walk past;
    // the one throwing read is the spent-stamp getFlag, which only the
    // encounter injection asks for — and only AFTER its specs resolved.
    const fake = {
      id: "zzencfake11",
      flags: { core: { RollTable: tableId } },
      rolls: [{ total: 1, dice: [] }],
      speaker: {},
      whisper: [],
      blind: false,
      content: "",
      author: game.user,
      isContentVisible: true,
      timestamp: Date.now(),
      getFlag: (_scope, key) => {
        if (key === "encounterSpawned") throw new Error("ZZ Enc planted getFlag");
        return undefined;
      },
    };
    try {
      Hooks.callAll("renderChatMessageHTML", fake, div, {});
      for (let i = 0; i < 25 && !out.caught && !out.unhandled; i++) await new Promise((r) => setTimeout(r, 200));
    } finally {
      console.error = origError;
      window.removeEventListener("unhandledrejection", onUn);
    }
    return out;
  }, { tableId: fx.tableId });
  inj.caught === 1 && inj.unhandled === 0
    ? ok("a rejected button injection is caught at the call site", "named in console, no unhandled rejection")
    : fail("a rejected button injection is caught at the call site", JSON.stringify(inj));

  /* --- 12. no-replacement draws, twenty tokens, and the VIEWED level ------- */
  // Review #34 findings 88, 89, 90, on the probe's own scene and a table of
  // its own (swept in this leg's finally):
  // - a table set to draw WITHOUT replacement marks the drawn row before the
  //   card renders, and the rows were re-derived through core's drawn filter,
  //   so the very row the card shows was lost and no button appeared;
  // - past sixteen tokens the cluster scaled the same sixteen offsets, so a
  //   row of twenty stacked tokens on sixteen cells;
  // - with no `level`, every token landed on the scene's INITIAL level, so
  //   viewing an upper level showed the toast and no tokens.
  // TWO TABLES, so each finding reads on its own: the no-replacement one is
  // asked only for its button, and an ordinary one (no row ever marked) is
  // drawn and spawned for the count and the level — the first draft spawned
  // from the no-replacement card, so a missing button failed all three.
  const big = await gm.evaluate(async ({ GOBLIN_UUID, sceneId }) => {
    const enc = await import("/systems/air-bladder/module/encounters.js");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const scene = game.scenes.get(sceneId);
    const out = {};
    let table = null, crowd = null, upper = null;
    try {
      [upper] = await scene.createEmbeddedDocuments("Level", [{ name: "ZZ Enc Upper", elevation: { bottom: 20, top: 40 } }]);
      await scene.view({ level: upper.id });
      for (let i = 0; i < 40 && canvas.level?.id !== upper.id; i++) await sleep(150);
      out.viewing = canvas.level?.id === upper.id;
      table = await RollTable.create({
        name: "ZZ Enc NoRepeat", formula: "1d1", replacement: false, displayRoll: true,
        results: [{ type: "text", description: `20 @UUID[${GOBLIN_UUID}]{Goblins} pour in.`, range: [1, 1], weight: 1 }],
      });
      const before = new Set(game.messages.map((m) => m.id));
      await table.draw();
      let msg = null;
      for (let i = 0; i < 40 && !msg; i++) {
        msg = game.messages.contents.find((m) => !before.has(m.id) && m.getFlag("core", "RollTable") === table.id);
        if (!msg) await sleep(150);
      }
      await sleep(600);
      out.rowDrawn = table.results.contents[0]?.drawn === true;
      out.button = !!document.querySelector(`[data-message-id="${msg?.id}"] .encounter-spawn`);

      crowd = await RollTable.create({
        name: "ZZ Enc Crowd", formula: "1d1", replacement: true, displayRoll: true,
        results: [{ type: "text", description: `20 @UUID[${GOBLIN_UUID}]{Goblins} pour in.`, range: [1, 1], weight: 1 }],
      });
      await crowd.draw();
      let crowdMsg = null;
      for (let i = 0; i < 40 && !crowdMsg; i++) {
        crowdMsg = game.messages.contents.find((m) => !before.has(m.id) && m.getFlag("core", "RollTable") === crowd.id);
        if (!crowdMsg) await sleep(150);
      }
      await sleep(600);
      out.crowdButton = !!document.querySelector(`[data-message-id="${crowdMsg?.id}"] .encounter-spawn`);
      const tokensBefore = new Set(scene.tokens.map((t) => t.id));
      if (crowdMsg) await enc.spawnEncounterFromMessage(crowdMsg);
      const mine = scene.tokens.contents.filter((t) => !tokensBefore.has(t.id));
      out.placed = mine.length;
      out.cells = new Set(mine.map((t) => `${t.x},${t.y}`)).size;
      out.onUpper = mine.length > 0 && mine.every((t) => t.level === upper.id);
      await scene.deleteEmbeddedDocuments("Token", mine.map((t) => t.id));
      for (const m of game.messages.filter((m) => !before.has(m.id))) await m.delete();
    } finally {
      if (table) await table.delete();
      if (crowd) await crowd.delete();
      if (upper) {
        await scene.view({ level: scene.initialLevel?.id ?? undefined });
        await scene.deleteEmbeddedDocuments("Level", [upper.id]);
      }
    }
    return out;
  }, { GOBLIN_UUID, sceneId: fx.sceneId });
  big.rowDrawn && big.button
    ? ok("a draw from a no-replacement table still offers Add to scene", JSON.stringify(big))
    : fail("a draw from a no-replacement table offers no Add to scene", JSON.stringify(big));
  big.crowdButton
    ? ok("precondition: the ordinary table's card offers Add to scene", "the two legs below spawn from it")
    : fail("precondition: the ordinary table's card offers Add to scene", JSON.stringify(big));
  big.placed === 20 && big.cells === 20
    ? ok("twenty tokens land on twenty cells, none stacked", JSON.stringify(big))
    : fail("tokens past sixteen stack on earlier cells", JSON.stringify(big));
  big.viewing && big.onUpper
    ? ok("encounter tokens land on the level being VIEWED", JSON.stringify(big))
    : fail("encounter tokens landed on another level", JSON.stringify(big));

  /* ------------------------------------------------------- console errors -- */
  const gmErrs = gmErrors.filter((e) => !/ZZ Enc/.test(e));
  gmErrs.length === 0 ? ok("zero GM console errors") : fail("zero GM console errors", gmErrs.slice(0, 5).join(" | "));
  aliceErrors.length === 0 ? ok("zero player console errors") : fail("zero player console errors", aliceErrors.slice(0, 5).join(" | "));
  await alice.close();
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  /* Sweep from NODE — a throw inside an evaluate must not leave the plant. */
  try {
    const swept = await gm.evaluate(async (c) => {
      const lines = [];
      // Restore the previously-viewed scene BEFORE deleting the planted one.
      if (c.prevSceneId && game.scenes.get(c.prevSceneId)) {
        await game.scenes.get(c.prevSceneId).view().catch(() => {});
      }
      for (const id of c.actorIds) {
        const a = game.actors.get(id);
        if (a) { lines.push(`actor ${a.name} (${id})`); await a.delete(); }
      }
      // Random-NPC mints and any strays the ids missed: everything left in
      // the probe's folder was created this run IF the folder is ours.
      if (c.folderId && !c.folderPreexisting) {
        const folder = game.folders.get(c.folderId);
        for (const a of [...(folder?.contents ?? [])]) {
          lines.push(`actor ${a.name} (${a.id})`); await a.delete();
        }
        if (folder) { lines.push(`folder ${folder.name} (${folder.id})`); await folder.delete(); }
      }
      const scene = game.scenes.get(c.sceneId);
      if (scene) { lines.push(`scene ${scene.name} (${scene.id})`); await scene.delete(); }
      const table = game.tables.get(c.tableId);
      if (table) { lines.push(`table ${table.name} (${table.id})`); await table.delete(); }
      // The draw cards and the quantity rolls they posted.
      const mine = game.messages.filter((m) =>
        c.messageIds.includes(m.id)
        || m.getFlag("core", "RollTable") && c.tableId && m.getFlag("core", "RollTable") === c.tableId
        || (!c.msgsAtStart.includes(m.id) && /^Encounter: /.test(m.flavor ?? "")));
      for (const m of mine) await m.delete();
      lines.push(`${mine.length} chat message(s)`);
      return lines;
    }, cleanup);
    for (const l of swept) console.log(`  swept ${l}`);
  } catch (e) {
    console.error(`  note  sweep failed: ${e.message}`);
  }
  await browser.close();
}
console.log(failures ? `\nENCOUNTERS PROBE FAILED — ${failures}\n` : "\nencounters probe passed\n");
process.exit(failures ? 1 : 0);

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

const cleanup = { sceneId: null, tableId: null, actorIds: [], messageIds: [], folderId: null, prevSceneId: null };

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
  const spawn1 = await gm.evaluate(async ({ msgId, GOBLIN_UUID }) => {
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
      goblinInFolder: goblins.every((a) => !a.folder || a.folder.id === folder?.id),
      folderId: folder?.id ?? null,
    };
  }, { msgId: goblinMsg, GOBLIN_UUID });
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
        || /^Encounter: /.test(m.flavor ?? ""));
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

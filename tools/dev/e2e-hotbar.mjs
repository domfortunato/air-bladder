/**
 * The hotbar drop hook (review #14, 2026-08-14).
 *
 * Three defects lived in one four-line hook, and all three were invisible from
 * the sheet because nothing here has a UI: the hook is the whole feature.
 *
 *   1. A text, URL or file dragged onto the bar THREW. `getDragEventData`
 *      returns `{}` for anything that is not JSON (text-editor.mjs:875-885),
 *      `getInfoFromDropData` initialises the resolved document to NULL, and the
 *      guard tested `!== undefined` — so null passed it and `.name` was read off
 *      null. The call was unawaited, so it surfaced as an unhandled rejection
 *      naming nothing.
 *   2. A RollTable got a macro that opens its SHEET. Core branches on RollTable
 *      and builds one that DRAWS (`Hotbar#_onDrop`); the system's catch-all
 *      swallowed that branch. This system ships encounter, spell and Scars
 *      tables.
 *   3. A LOCKED bar accepted the drop. Before 14.368 core tested the hook's
 *      return value BEFORE its own lock check and `assignHotbarMacro` never
 *      consults `locked`, so `return false` skipped the only enforcement there
 *      was. Core tests the lock first on every supported build (14.368 on,
 *      `Hotbar#_onDrop`), so a locked bar never reaches the hook and the
 *      system's own guard is gone (review #36). The REAL drop below now
 *      witnesses core's lock end to end: it has no system fix to defeat.
 *
 * **Driven by a REAL `drop` event on a real slot element**, never by calling
 * `createCairnMacro` directly. The private `#onDragDrop` is where the hook's
 * return value is interpreted, and every one of these defects is about that
 * interpretation — a probe that called the exported function would test the one
 * half that was never wrong. `Hooks.call(...) === false` and `if (this.locked)`
 * are lines in core, so the only way to witness them is to make core run them.
 *
 * The lock is SHADOWED as an own property on the `ui.hotbar` instance, not
 * written to the `core.hotbarLock` setting: the world's value is the user's.
 *
 * **The hotbar is USER CONTENT and this probe writes to it, so it takes the
 * slots it uses from what is actually EMPTY and puts the bar back exactly as it
 * found it.** The first draft assumed slots 3-7 were free and swept whatever it
 * found in them: it deleted the Warden's world copy of the shipped "Toggle
 * Change Log" macro out of slot 3 and cleared the slot. Recovered from the
 * macros pack by id, but the lesson is the rule — a teardown that removes "the
 * macro in the slot I used" removes somebody's macro the first time it guesses
 * wrong. What is swept is the id DIFFERENCE across the run, and nothing else.
 *
 * The dev world has NO actors; fixtures are created and removed.
 *
 * And the ROLL a weapon's button makes (review #35, user ruling 2026-11-20):
 * on a player character a Broken weapon is refused with "{name} is broken."
 * and a weapon Hands full blocks with the hack's own sentence; an intact one
 * with a hand free still rolls.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAs, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(52)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(52)} ${d}`); failures++; };
const check = (l, cond, d = "") => (cond ? ok(l, d) : fail(l, d));

const dog = watchdog(240000, "hotbar");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await page.goto(FOUNDRY_URL);
await joinAsGM(page);
await dismissChrome(page);

/* --------------------------------------------------------------- fixtures */
// Snapshot FIRST, and claim only empty slots. Both halves matter: the snapshot
// is what the bar is restored to, and the emptiness is what stops the run
// overwriting a macro somebody put there.
const world = await page.evaluate(() => {
  const hotbar = foundry.utils.deepClone(game.user.hotbar ?? {});
  const taken = new Set(Object.keys(hotbar));
  const free = [];
  for (let s = 1; s <= 50 && free.length < 6; s++) if (!taken.has(String(s))) free.push(s);
  return { hotbar, free, macroIds: game.macros.map((m) => m.id) };
});
check("precondition: six EMPTY hotbar slots to work in", world.free.length === 6,
  `free=${JSON.stringify(world.free)} of the 50 — the bar is the Warden's, and a probe that writes over an `
  + "occupied slot destroys their macro");
const [SLOT_TEXT, SLOT_TABLE, SLOT_LOCK, SLOT_WEAPON, SLOT_MACRO, SLOT_FOREIGN] = world.free;
console.log(`  note  using slots ${world.free.join(", ")}; ${world.macroIds.length} macros already in the world`);

// The bar is restored and this run's macros removed from the FINALLY (review
// #34 finding 26): the teardown sat at the end of the file, so a throw in any
// leg left the Warden's user hotbar holding this run's macros.
let fx = null;
// The unlinked-token leg's scene and actor (review #36), removed from the
// finally by the ids planted here.
let tokFx = null;
try {
  fx = await page.evaluate(async () => {
    const ActorImpl = CONFIG.Actor.documentClass;
    const actor = await ActorImpl.create({ name: "ZZ Hotbar PC", type: "character" });
    await actor.createEmbeddedDocuments("Item", [
      { name: "ZZ Hotbar Blade", type: "weapon", system: { damageFormula: "d6" } },
      { name: "ZZ Hotbar Planted", type: "weapon", system: { damageFormula: "d6" } },
    ]);
    const weapon = actor.items.find((i) => i.name === "ZZ Hotbar Blade");
    const planted = actor.items.find((i) => i.name === "ZZ Hotbar Planted");
    const player = game.users.find((u) => !u.isGM);
    const table = await getDocumentClass("RollTable").create({
      name: "ZZ Hotbar Table",
      formula: "1d1",
      results: [{ type: "text", description: "zz", range: [1, 1] }],
    });
    const macro = await getDocumentClass("Macro").create({
      name: "ZZ Hotbar Macro", type: "script", command: "console.log('zz');",
    });
    return {
      actorId: actor.id, weaponUuid: weapon.uuid,
      tableId: table.id, tableUuid: table.uuid,
      macroId: macro.id, macroUuid: macro.uuid,
      plantedUuid: planted.uuid, plantedName: planted.name,
      plantedCommand: `game.cairn.rollItemMacro("${actor.id}", "${planted.id}");`,
      playerName: player?.name ?? null,
    };
  });
  // A macro a PLAYER authored, matching the planted weapon's roll macro by name
  // and command exactly — what a player's own drag of that weapon mints, or
  // what a player can plant in advance (every id is in their world data). Made
  // FROM THE PLAYER'S OWN SESSION: core stamps the creating user as author in
  // Macro#_preCreate and the server refuses to change it afterwards, so a GM
  // cannot make one (measured on the fleet, 1f651d33: the plant came out the
  // Warden's, and the leg failed both before and after the fix). The macro is
  // inside the snapshot's id difference, so the teardown below removes it.
  fx.foreignId = null;
  if (fx.playerName) {
    const playerPage = await browser.newPage({ viewport: VIEWPORT });
    try {
      await joinAs(playerPage, fx.playerName);
      fx.foreignId = await playerPage.evaluate(async ({ name, command }) => (await getDocumentClass("Macro")
        .create({ name, type: "script", command }))?.id ?? null, { name: fx.plantedName, command: fx.plantedCommand });
    } finally {
      await playerPage.close();
    }
    // Let the Warden's client receive it before anything looks it up.
    await page.waitForFunction((id) => !!game.macros.get(id), fx.foreignId, { timeout: 10000 }).catch(() => {});
  }
  console.log(`  note  fixtures: actor ${fx.actorId}, table ${fx.tableId}, macro ${fx.macroId}`);

  /**
   * Dispatch a real `drop` on a real hotbar slot and wait for the bar to settle.
   *
   * `text` is put on the DataTransfer verbatim, so a caller can hand over
   * non-JSON and reproduce exactly what a text or file drag delivers. Returns
   * whatever macro the slot ends up holding, plus the macro count either side —
   * the count is what tells "nothing was created" apart from "something was
   * created and not assigned".
   */
  const drop = async (slot, text) => page.evaluate(async ({ slot, text }) => {
    const before = game.macros.size;
    const slotBefore = game.user.hotbar[slot] ?? null;
    const beforeSlot = slotBefore;
    await ui.hotbar.render(true);
    const el = ui.hotbar.element.querySelector(`.slot[data-slot="${slot}"]`);
    if (!el) return { error: "no slot element" };
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    // The handler is async and dispatch is not: settle by polling rather than by
    // a fixed sleep, or a slow create reads as "nothing happened".
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (game.macros.size !== before || (game.user.hotbar[slot] ?? null) !== beforeSlot) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 250));
    const id = game.user.hotbar[slot] ?? null;
    const m = id ? game.macros.get(id) : null;
    return {
      before, after: game.macros.size, slotBefore,
      slotId: id, unchanged: id === slotBefore,
      name: m?.name ?? null, command: m?.command ?? null,
    };
  }, { slot, text });

  /* -------------------------------------------------- 1. a non-document drag */
  console.log("\na drag that is not a document");
  const plain = await drop(SLOT_TEXT, "just some dragged text, not JSON at all");
  check("a text drag creates no macro", plain.after === plain.before && plain.unchanged,
    `macros ${plain.before} -> ${plain.after} slot ${plain.slotBefore} -> ${plain.slotId} — getDragEventData `
    + "hands the hook {} for anything non-JSON, which is every text, URL and file drag");
  const nullDeref = errors.filter((e) => /Cannot read properties of null|of null \(reading/.test(e));
  check("...and throws nothing", nullDeref.length === 0,
    nullDeref.join(" | ") || "the guard tested `!== undefined` and null passed it");

  /* --------------------------------------------------------- 2. a RollTable */
  console.log("\na RollTable dropped on the bar");
  const table = await drop(SLOT_TABLE, JSON.stringify({ type: "RollTable", uuid: fx.tableUuid }));
  check("a table drop makes a macro", !!table.slotId, `slot=${table.slotId} name=${JSON.stringify(table.name)}`);
  check("...that DRAWS from the table, not one that opens its sheet",
    /\.draw\(\)/.test(table.command ?? "") && !/toggleDocumentSheet/.test(table.command ?? ""),
    `command=${JSON.stringify(String(table.command).replace(/\n/g, " ").slice(0, 110))} — core branches on `
    + "RollTable (Hotbar#_onDrop); the system's catch-all swallowed the branch, and this system ships "
    + "encounter, spell and Scars tables");

  /* ------------------------------------------------------------ 3. the lock */
  console.log("\na LOCKED bar");
  // Shadowed as an own property on the instance — the `core.hotbarLock` SETTING
  // is the user's, and a probe that flips it is a real write to their world.
  await page.evaluate(() => {
    Object.defineProperty(ui.hotbar, "locked", { get: () => true, configurable: true });
  });
  const lockedDrop = await drop(SLOT_LOCK, JSON.stringify({ type: "Item", uuid: fx.weaponUuid }));
  const shadowOff = await page.evaluate(() => {
    delete ui.hotbar.locked;
    return ui.hotbar.locked === game.settings.get("core", "hotbarLock");
  });
  check("precondition: the lock shadow came back off", shadowOff,
    "everything below runs against the world's real setting");
  check("a locked bar takes nothing",
    lockedDrop.after === lockedDrop.before && lockedDrop.unchanged,
    `macros ${lockedDrop.before} -> ${lockedDrop.after} slot ${lockedDrop.slotBefore} -> ${lockedDrop.slotId} `
    + "— core tests the lock before it calls the hotbarDrop hook (Hotbar#_onDrop, 14.368 on), so the "
    + "system's hook should never have seen this drop; if this is red, core's order has moved again");

  /* ------------------------------------- 4. the positive controls still work */
  console.log("\nwhat must keep working");
  const weapon = await drop(SLOT_WEAPON, JSON.stringify({ type: "Item", uuid: fx.weaponUuid }));
  check("an owned weapon still makes its roll macro",
    /game\.cairn\.rollItemMacro/.test(weapon.command ?? ""),
    `command=${JSON.stringify(weapon.command)} — the leg that proves the three fixes above did not simply `
    + "disable the feature");
  /* ------------------------- 4b. never another user's macro (review #34 F154) */
  // SECURITY. createCairnMacro reused ANY world macro matching the weapon's name
  // and command, whoever wrote it, and put it on the dropping user's bar. A
  // player's own drag of a weapon mints such a macro under their authorship,
  // and its author may rewrite its command at will — so the Warden's drag of
  // the same weapon handed the Warden a slot whose script the player controls,
  // run with the Warden's privileges on the next click. Core never finds
  // another user's macro by lookup: its derived drops always create a fresh one
  // (Hotbar#_onDrop). The lookup now asks `isAuthor`, so this Warden drop must
  // create the Warden's own macro and leave the planted one off the bar.
  check("precondition: a player to author the planted macro", !!fx.foreignId,
    "the world needs one non-GM user; without one this leg proves nothing");
  if (fx.foreignId) {
    // THE WITNESS, in-page: with `isAuthor` forced true — the old lookup, which
    // never asked — the same drop must REUSE the planted macro. Without this the
    // leg below could pass because the plant never matched at all, which is how
    // its first version passed nothing and failed both ways. The getter is put
    // back from a finally; the slot it fills is the probe's own and is
    // overwritten by the real drop next.
    const witnessed = await page.evaluate(async ({ slot, uuid }) => {
      const proto = foundry.documents.Macro.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "isAuthor");
      Object.defineProperty(proto, "isAuthor", { get: () => true, configurable: true });
      try {
        await ui.hotbar.render(true);
        const el = ui.hotbar.element.querySelector(`.slot[data-slot="${slot}"]`);
        const dt = new DataTransfer();
        dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
        el?.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
        for (let i = 0; i < 40 && !game.user.hotbar[slot]; i++) await new Promise((r) => setTimeout(r, 100));
        return game.user.hotbar[slot] ?? null;
      } finally {
        if (desc) Object.defineProperty(proto, "isAuthor", desc);
        else delete proto.isAuthor;
      }
    }, { slot: SLOT_FOREIGN, uuid: fx.plantedUuid });
    check("witness: with authorship ignored, the drop reuses the planted macro", witnessed === fx.foreignId,
      `slot=${witnessed} planted=${fx.foreignId} — if this is not the planted macro, the leg below proves nothing`);

    const foreignDrop = await drop(SLOT_FOREIGN, JSON.stringify({ type: "Item", uuid: fx.plantedUuid }));
    const author = await page.evaluate((id) => game.macros.get(id)?.author?.name ?? null, foreignDrop.slotId);
    check("a weapon drop never reuses a macro another user authored",
      !!foreignDrop.slotId && foreignDrop.slotId !== fx.foreignId && author === (await page.evaluate(() => game.user.name)),
      `slot=${foreignDrop.slotId} planted=${fx.foreignId} author=${JSON.stringify(author)} — the planted macro is `
      + `${JSON.stringify(fx.playerName)}'s, and a script on the Warden's bar that a player can rewrite runs as the Warden`);
  }

  const macroDrop = await drop(SLOT_MACRO, JSON.stringify({ type: "Macro", uuid: fx.macroUuid }));
  check("an existing Macro is placed as ITSELF, not wrapped",
    macroDrop.slotId === fx.macroId && macroDrop.after === macroDrop.before,
    `slot=${macroDrop.slotId} expected=${fx.macroId} macros ${macroDrop.before} -> ${macroDrop.after} — `
    + "a wrapper here would open the macro's edit sheet instead of running it");

  /* ---- the macro's roll on a character: Broken and Hands full (review #35) */
  // rollItemMacro is the command a weapon's hotbar button runs. A Broken
  // weapon is refused with CAIRN.Macro.Broken, a weapon Hands full blocks
  // with CAIRN.HandsFullNote (the hack shadowed in page, never written); an
  // intact weapon still rolls. Warnings captured; the quality dialog is
  // answered by pressing its first button. Fixture actor stamped and deleted.
  const macroRolls = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const { rollItemMacro } = await import("/systems/air-bladder/module/macros.js");
    const pc = await getDocumentClass("Actor").create({
      name: "ZZ Hotbar PC", type: "character", flags: { "air-bladder": { probeFixture: "e2e-hotbar" } },
      items: [
        { name: "ZZ Hot Sword", type: "weapon", system: { damageFormula: "1d6", equipped: true } },
        { name: "ZZ Hot Axe", type: "weapon", system: { damageFormula: "1d8", equipped: true, broken: true } },
        { name: "ZZ Hot Shield", type: "armor", system: { armor: 1, shield: true, equipped: true } },
        { name: "Torch", type: "item", system: { equipped: true } },
      ],
    }, { abNoStatusCard: true });
    const id = (n) => pc.items.find((i) => i.name === n).id;
    const warns = [];
    const origWarn = ui.notifications.warn;
    ui.notifications.warn = function (msg, ...rest) { warns.push(rest[0]?.format ? game.i18n.format(String(msg), rest[0].format) : String(msg)); return origWarn.call(this, msg, ...rest); };
    const origGet = game.settings.get;
    let handsFull = false;
    game.settings.get = function (scope, key, ...rest) {
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === "air-bladder" && key === "hands-full") return handsFull;
      return origGet.call(this, scope, key, ...rest);
    };
    const run = async (itemId) => {
      warns.length = 0;
      const before = new Set(game.messages.map((m) => m.id));
      const stale = new Set(foundry.applications.instances.values());
      const pending = rollItemMacro(pc.id, itemId);
      for (let i = 0; i < 20; i++) {
        const d = [...foundry.applications.instances.values()].find((x) => !stale.has(x) && x instanceof foundry.applications.api.DialogV2);
        if (d) { d.element.querySelector("footer button")?.click(); break; }
        await sleep(100);
      }
      await Promise.race([pending, sleep(3000)]);
      await sleep(300);
      const made = game.messages.filter((m) => !before.has(m.id) && m.speaker?.actor === pc.id);
      for (const m of made) await m.delete();
      return { posted: made.length, warns: [...warns] };
    };
    try {
      const broken = await run(id("ZZ Hot Axe"));
      handsFull = true;
      const blocked = await run(id("ZZ Hot Sword"));
      handsFull = false;
      const intact = await run(id("ZZ Hot Sword"));
      return {
        broken, blocked, intact,
        wantBroken: game.i18n.format("CAIRN.Macro.Broken", { name: "ZZ Hot Axe" }),
        wantHands: game.i18n.localize("CAIRN.HandsFullNote"),
      };
    } finally {
      game.settings.get = origGet;
      ui.notifications.warn = origWarn;
      await pc.delete();
    }
  });
  check("the hotbar refuses a Broken weapon, saying so",
    macroRolls.broken.posted === 0 && macroRolls.broken.warns.includes(macroRolls.wantBroken)
    && macroRolls.wantBroken !== "CAIRN.Macro.Broken",
    JSON.stringify({ broken: macroRolls.broken, want: macroRolls.wantBroken }));
  check("the hotbar refuses a weapon Hands full blocks, with the hack's sentence",
    macroRolls.blocked.posted === 0 && macroRolls.blocked.warns.includes(macroRolls.wantHands),
    JSON.stringify({ blocked: macroRolls.blocked, want: macroRolls.wantHands }));
  check("...and still rolls an intact weapon with a hand free",
    macroRolls.intact.posted === 1 && macroRolls.intact.warns.length === 0, JSON.stringify(macroRolls.intact));

  /* ---------------- 5. an UNLINKED TOKEN's weapon rolls the token's own copy */
  // Review #36. A synthetic actor keeps its BASE actor's id and isn't in
  // game.actors, so a macro keyed by actor id and item id rolled the WORLD
  // actor's copy of the weapon — and said the item was gone when the weapon
  // had been added to the token alone. Two weapons on one unlinked token: one
  // the world actor has too, RENAMED on the token (the name is on the card, and
  // unlike the die it does not depend on which quality the dialog's first
  // button picks), and one only the token has. Each is dropped on a real slot
  // and its macro EXECUTED, as a click on the bar does. The scene is never
  // viewed, so a card spoken for the world actor names no token at all. The
  // slots are two of the probe's own that the legs above leave empty.
  console.log("\nan unlinked token's weapon");
  tokFx = await page.evaluate(async () => {
    const stamp = { "air-bladder": { probeFixture: "e2e-hotbar" } };
    const scene = await Scene.create({ name: "ZZ Hotbar Token scene", width: 1000, height: 1000, flags: stamp });
    const base = await getDocumentClass("Actor").create({
      name: "ZZ Hotbar Monster", type: "npc", system: { role: "monster" }, flags: stamp,
      items: [{ name: "ZZ Tok Claw", type: "weapon", system: { damageFormula: "1d6" } }],
    }, { abNoStatusCard: true });
    const [tok] = await scene.createEmbeddedDocuments("Token",
      [await base.getTokenDocument({ x: 100, y: 100, actorLink: false })]);
    const shared = tok.actor.items.find((i) => i.name === "ZZ Tok Claw");
    await shared.update({ name: "ZZ Tok Claw EDITED" });
    const knownItems = new Set(tok.actor.items.map((i) => i.id));
    await tok.actor.createEmbeddedDocuments("Item",
      [{ name: "ZZ Tok Sting", type: "weapon", system: { damageFormula: "1d6" } }]);
    const own = tok.actor.items.find((i) => !knownItems.has(i.id));
    return {
      sceneId: scene.id, baseId: base.id, tokenId: tok.id,
      unlinked: tok.actorLink === false && tok.actor !== base && tok.actor.id === base.id,
      sharedUuid: shared.uuid, sharedOnBase: base.items.get(shared.id)?.name ?? null,
      ownUuid: own?.uuid ?? null, ownOnBase: !!base.items.get(own?.id),
    };
  });
  check("precondition: an unlinked token sharing its base actor's id", tokFx.unlinked, JSON.stringify(tokFx));
  check("precondition: one weapon renamed on the token only, one the token alone has",
    tokFx.sharedOnBase === "ZZ Tok Claw" && !!tokFx.ownUuid && tokFx.ownOnBase === false, JSON.stringify(tokFx));

  // Execute the macro a slot holds and report what it posted and warned. The
  // quality dialog is answered by its first button, as the leg above does.
  const press = async (slotId) => page.evaluate(async ({ slotId, baseId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const warns = [];
    const origWarn = ui.notifications.warn;
    ui.notifications.warn = function (msg, ...rest) { warns.push(rest[0]?.format ? game.i18n.format(String(msg), rest[0].format) : String(msg)); return origWarn.call(this, msg, ...rest); };
    const before = new Set(game.messages.map((m) => m.id));
    const stale = new Set(foundry.applications.instances.values());
    const mine = () => game.messages.filter((m) => !before.has(m.id) && m.speaker?.actor === baseId);
    try {
      const macro = game.macros.get(slotId);
      if (!macro) return { error: "no macro in the slot" };
      const pending = Promise.resolve(macro.execute()).catch((e) => warns.push(`threw: ${e.message}`));
      for (let i = 0; i < 20 && !warns.length; i++) {
        const d = [...foundry.applications.instances.values()].find((x) => !stale.has(x) && x instanceof foundry.applications.api.DialogV2);
        if (d) { d.element.querySelector("footer button")?.click(); break; }
        await sleep(100);
      }
      await Promise.race([pending, sleep(3000)]);
      for (let i = 0; i < 20 && !warns.length && !mine().length; i++) await sleep(150);
      await sleep(300);
      const made = mine();
      const out = {
        posted: made.length, warns: [...warns],
        flavor: String(made[0]?.flavor ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        speakerToken: made[0]?.speaker?.token ?? null,
      };
      for (const m of made) await m.delete();
      return out;
    } finally {
      ui.notifications.warn = origWarn;
    }
  }, { slotId, baseId: tokFx.baseId });

  const sharedDrop = await drop(SLOT_TEXT, JSON.stringify({ type: "Item", uuid: tokFx.sharedUuid }));
  check("a token's weapon still makes its roll macro", /game\.cairn\.rollItemMacro/.test(sharedDrop.command ?? ""),
    `command=${JSON.stringify(sharedDrop.command)}`);
  const sharedRoll = sharedDrop.slotId ? await press(sharedDrop.slotId) : { error: "nothing in the slot" };
  check("...which rolls the TOKEN's copy of the weapon, not the world actor's",
    sharedRoll.posted === 1 && /ZZ Tok Claw EDITED/.test(sharedRoll.flavor ?? ""),
    `${JSON.stringify(sharedRoll)} — the world actor's copy is still "ZZ Tok Claw", and the two share an id`);
  check("...and speaks for that token", sharedRoll.speakerToken === tokFx.tokenId,
    `speaker token=${sharedRoll.speakerToken} want=${tokFx.tokenId}`);

  const ownDrop = await drop(SLOT_LOCK, JSON.stringify({ type: "Item", uuid: tokFx.ownUuid }));
  const ownRoll = ownDrop.slotId ? await press(ownDrop.slotId) : { error: "nothing in the slot" };
  check("a weapon only the token has rolls too", ownRoll.posted === 1 && ownRoll.warns?.length === 0
    && /ZZ Tok Sting/.test(ownRoll.flavor ?? "") && ownRoll.speakerToken === tokFx.tokenId,
    `${JSON.stringify(ownRoll)} — the world actor has no such item, so the old command answered "no longer has the item"`);

  // What the button says once its weapon, then its token, is gone: the same
  // two sentences a world actor's button has.
  const gone = await page.evaluate(async ({ sceneId, tokenId, ownUuid }) => {
    const tok = game.scenes.get(sceneId)?.tokens.get(tokenId);
    const wantItem = game.i18n.format("CAIRN.Macro.NoItem", { name: tok.actor.name });
    await (await fromUuid(ownUuid))?.delete();
    return { wantItem, wantActor: game.i18n.localize("CAIRN.Macro.NoActor") };
  }, tokFx);
  const itemGone = ownDrop.slotId ? await press(ownDrop.slotId) : { error: "nothing in the slot" };
  check("the button says so by name once the token's weapon is gone",
    itemGone.posted === 0 && (itemGone.warns ?? []).includes(gone.wantItem), `${JSON.stringify(itemGone)} want=${JSON.stringify(gone.wantItem)}`);
  await page.evaluate(({ sceneId, tokenId }) => game.scenes.get(sceneId)?.tokens.get(tokenId)?.delete(), tokFx);
  const tokenGone = sharedDrop.slotId ? await press(sharedDrop.slotId) : { error: "nothing in the slot" };
  check("...and that its actor no longer exists once the token is",
    tokenGone.posted === 0 && (tokenGone.warns ?? []).includes(gone.wantActor), `${JSON.stringify(tokenGone)} want=${JSON.stringify(gone.wantActor)}`);

} catch (e) {
  check("the probe ran to the end", false, e.message);
} finally {
  if (tokFx) {
    await page.evaluate(async ({ sceneId, baseId }) => {
      for (const m of game.messages.filter((m) => m.speaker?.actor === baseId)) { try { await m.delete(); } catch { /* gone */ } }
      try { await game.scenes.get(sceneId)?.delete(); } catch { /* gone */ }
      try { await game.actors.get(baseId)?.delete(); } catch { /* gone */ }
    }, tokFx).catch(() => {});
  }
  if (fx) {
    /* ----------------------------------------------------------- teardown ---- */
    // Restore the bar to its SNAPSHOT and delete only the id DIFFERENCE. Never "the
    // macro that is in the slot I used" — that is how the first draft deleted the
    // Warden's world copy of the shipped Toggle Change Log macro.
    const swept = await page.evaluate(async ({ fx, hotbar, macroIds }) => {
      const known = new Set(macroIds);
      const made = game.macros.filter((m) => !known.has(m.id)).map((m) => m.id);
      await game.user.update({ hotbar }, { diff: false, recursive: false });
      for (const id of made) await game.macros.get(id)?.delete();
      await game.tables.get(fx.tableId)?.delete();
      await game.actors.get(fx.actorId)?.delete();
      return {
        made: made.length,
        restored: JSON.stringify(foundry.utils.deepClone(game.user.hotbar)) === JSON.stringify(hotbar),
        kept: game.macros.size,
      };
    }, { fx, hotbar: world.hotbar, macroIds: world.macroIds });
    console.log(`  note  cleanup: removed ${swept.made} macro(s) this run created; ${swept.kept} pre-existing kept`);
    check("the Warden's hotbar is exactly as it was found", swept.restored,
      `snapshot=${JSON.stringify(world.hotbar)} — the bar is user content, not scratch space`);
    check("every pre-existing macro survived", swept.kept === world.macroIds.length,
      `${swept.kept} left, ${world.macroIds.length} at the start`);
  }
}

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

clearTimeout(dog);
await browser.close();
console.log(failures ? `\nhotbar probe FAILED — ${failures}` : "\nhotbar probe passed");
process.exit(failures ? 1 : 0);

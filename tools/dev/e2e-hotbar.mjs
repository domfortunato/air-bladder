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
 *      and builds one that DRAWS (hotbar.mjs:499); the system's catch-all
 *      swallowed that branch. This system ships encounter, spell and Scars
 *      tables.
 *   3. A LOCKED bar accepted the drop. Core tests the hook's return value BEFORE
 *      its own lock check (hotbar.mjs:488-490) and `assignHotbarMacro` never
 *      consults `locked`, so `return false` skipped the only enforcement there
 *      is.
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
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

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
  for (let s = 1; s <= 50 && free.length < 5; s++) if (!taken.has(String(s))) free.push(s);
  return { hotbar, free, macroIds: game.macros.map((m) => m.id) };
});
check("precondition: five EMPTY hotbar slots to work in", world.free.length === 5,
  `free=${JSON.stringify(world.free)} of the 50 — the bar is the Warden's, and a probe that writes over an `
  + "occupied slot destroys their macro");
const [SLOT_TEXT, SLOT_TABLE, SLOT_LOCK, SLOT_WEAPON, SLOT_MACRO] = world.free;
console.log(`  note  using slots ${world.free.join(", ")}; ${world.macroIds.length} macros already in the world`);

const fx = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const actor = await ActorImpl.create({ name: "ZZ Hotbar PC", type: "character" });
  await actor.createEmbeddedDocuments("Item", [
    { name: "ZZ Hotbar Blade", type: "weapon", system: { damageFormula: "d6" } },
  ]);
  const weapon = actor.items.find((i) => i.name === "ZZ Hotbar Blade");
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
  };
});
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
  + "RollTable (hotbar.mjs:499); the system's catch-all swallowed the branch, and this system ships "
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
  + "— core tests this hook's return BEFORE its own lock check, and assignHotbarMacro never consults "
  + "`locked`, so returning false here skipped the only enforcement there is");

/* ------------------------------------- 4. the positive controls still work */
console.log("\nwhat must keep working");
const weapon = await drop(SLOT_WEAPON, JSON.stringify({ type: "Item", uuid: fx.weaponUuid }));
check("an owned weapon still makes its roll macro",
  /game\.cairn\.rollItemMacro/.test(weapon.command ?? ""),
  `command=${JSON.stringify(weapon.command)} — the leg that proves the three fixes above did not simply `
  + "disable the feature");
const macroDrop = await drop(SLOT_MACRO, JSON.stringify({ type: "Macro", uuid: fx.macroUuid }));
check("an existing Macro is placed as ITSELF, not wrapped",
  macroDrop.slotId === fx.macroId && macroDrop.after === macroDrop.before,
  `slot=${macroDrop.slotId} expected=${fx.macroId} macros ${macroDrop.before} -> ${macroDrop.after} — `
  + "a wrapper here would open the macro's edit sheet instead of running it");

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

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

clearTimeout(dog);
await browser.close();
console.log(failures ? `\nhotbar probe FAILED — ${failures}` : "\nhotbar probe passed");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * A background belongs to a player character and to nothing else.
 *
 * Dropping one on a sheet is not an inventory add — it CHANGES the character's
 * background, deleting everything the old one granted. So on any other actor type
 * the drop must be refused outright: no owned item, no statblock change, nothing
 * silently pocketed. `system.background` exists on `NpcData` as a string, and the
 * NPC sheet has a "Career/Role" row that reads like a background to a Warden, which
 * is exactly the confusion that makes an accidental drop likely.
 *
 * The refusal lives in `_onDropBackground` (actor-sheet.js), reached from
 * `_onDropItem`'s type intercept. That intercept sits ABOVE the capacity checks and
 * above the transfer path on purpose: a background has neither `weightless` nor
 * `bulky` declared, so falling through made it cost a slot, and on an encumbered
 * actor the capacity refusal swallowed the drop entirely.
 *
 * Every route a background can arrive by is covered, because they resolve
 * differently and only the last two exercise a document that is not a world Actor:
 *
 *   1. from a COMPENDIUM (the shipped 2e packs — the common case)
 *   2. from a WORLD item in the Items sidebar
 *   3. from another character's INVENTORY — a "pocketed" background, the 0.1.7
 *      artefact that still exists in upgraded worlds and is a draggable row
 *   4. onto an UNLINKED token's synthetic actor, whose items live in a delta
 *
 * Drops go in through `_onDrop` with a real DataTransfer rather than by calling
 * `_onDropBackground` directly, so the uuid resolution and the type intercept are
 * exercised too — calling the guard directly would assert only that the guard
 * guards, not that anything reaches it.
 *
 * Usage: npm run dev:bg-drop-guard
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(240000, "background drop guard probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const out = await page.evaluate(async () => {
  const res = { cases: [] };
  for (const s of game.actors.filter((a) => a.name?.startsWith("ZZ BGGuard"))) await s.delete();
  for (const i of game.items.filter((i) => i.name?.startsWith("ZZ BGGuard"))) await i.delete();

  const warns = [];
  const origWarn = ui.notifications.warn.bind(ui.notifications);
  ui.notifications.warn = (m, ...r) => { warns.push(m); return origWarn(m, ...r); };

  const Cls = CONFIG.Actor.documentClass;
  const ItemCls = CONFIG.Item.documentClass;

  const pack = game.packs.find((p) => p.metadata.name?.startsWith("backgrounds"));
  const idx = await pack.getIndex();
  const packBg = await pack.getDocument(idx.contents[0]._id);
  res.packBg = packBg.name;

  const worldBg = await ItemCls.create({ name: "ZZ BGGuard World Bg", type: "background" });

  // A background sitting in a character's inventory, as upgraded worlds still carry.
  const donor = await Cls.create({ name: "ZZ BGGuard Donor", type: "character" });
  const [pocketed] = await donor.createEmbeddedDocuments("Item", [
    { name: "ZZ BGGuard Pocketed", type: "background" },
  ]);

  /** Drive a real drop and report everything that could show it was not refused. */
  const drop = async (label, actor, sheet, uuid) => {
    const before = actor.items.map((i) => i.id);
    const bgBefore = actor.system.background;
    await sheet.render(true);
    await new Promise((r) => setTimeout(r, 400));
    warns.length = 0;
    let threw = null;
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
    try { await sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); }
    catch (e) { threw = e.message; }
    await new Promise((r) => setTimeout(r, 700));
    res.cases.push({
      label,
      type: actor.type,
      warned: warns.length ? warns[0] : null,
      threw,
      gainedItems: actor.items.filter((i) => !before.includes(i.id)).map((i) => `${i.name} [${i.type}]`),
      backgroundChanged: actor.system.background !== bgBefore,
    });
  };

  const npc = await Cls.create({ name: "ZZ BGGuard NPC", type: "npc" });
  const hire = await Cls.create({ name: "ZZ BGGuard Hireling", type: "hireling" });
  const cont = await Cls.create({ name: "ZZ BGGuard Container", type: "container", system: { slots: 6 } });

  await drop("compendium background -> npc", npc, npc.sheet, packBg.uuid);
  await drop("world background -> npc", npc, npc.sheet, worldBg.uuid);
  await drop("pocketed background -> npc", npc, npc.sheet, pocketed.uuid);
  await drop("compendium background -> hireling", hire, hire.sheet, packBg.uuid);
  await drop("compendium background -> container", cont, cont.sheet, packBg.uuid);

  // The donor must keep it: a refused transfer must not decrement the source.
  res.donorKeptIt = donor.items.some((i) => i.id === pocketed.id);

  // Unlinked token: its items live in a delta, a different write path entirely.
  const scene = game.scenes.current ?? game.scenes.contents[0];
  if (scene) {
    const [td] = await scene.createEmbeddedDocuments("Token", [
      { name: "ZZ BGGuard Token", actorId: npc.id, actorLink: false, x: 120, y: 120 },
    ]);
    if (td?.actor) await drop("compendium background -> unlinked token npc", td.actor, td.actor.sheet, packBg.uuid);
    else res.tokenSkipped = "token had no synthetic actor";
    await scene.deleteEmbeddedDocuments("Token", [td.id]);
  } else res.tokenSkipped = "no scene in this world";

  // POSITIVE CONTROL. Without it every assertion above is satisfied by a drop
  // handler that refuses everything, or by uuids that never resolved at all.
  const pc = await Cls.create({ name: "ZZ BGGuard PC", type: "character" });
  await pc.sheet.render(true);
  await new Promise((r) => setTimeout(r, 400));
  const dt = new DataTransfer();
  dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: packBg.uuid }));
  // The character path confirms first; auto-accept just this once.
  const DialogV2 = foundry.applications.api.DialogV2;
  const origConfirm = DialogV2.confirm;
  DialogV2.confirm = async () => true;
  try { await pc.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); }
  finally { DialogV2.confirm = origConfirm; }
  await new Promise((r) => setTimeout(r, 4000));
  res.characterAccepted = { background: pc.system.background, items: pc.items.size };

  ui.notifications.warn = origWarn;
  for (const a of [npc, hire, cont, donor, pc]) await a.delete();
  await worldBg.delete();
  return res;
});

console.log(`\nrefusing a background everywhere but a character (using "${out.packBg}")`);
if (out.tokenSkipped) console.log(`  note  unlinked-token case skipped: ${out.tokenSkipped}`);

for (const c of out.cases) {
  const clean = !c.gainedItems.length && !c.backgroundChanged && !c.threw;
  if (!clean) {
    fail(`${c.label} — gained ${JSON.stringify(c.gainedItems)}`
      + `${c.backgroundChanged ? ", background CHANGED" : ""}${c.threw ? `, threw: ${c.threw}` : ""}`);
  } else if (!c.warned) {
    fail(`${c.label} — refused silently, with no warning to explain why`);
  } else {
    ok(`${c.label} — refused ("${c.warned}")`);
  }
}

if (out.donorKeptIt) ok("the donor character kept its background item (a refused drop takes nothing)");
else fail("the donor LOST its background item to a refused drop");

if (out.characterAccepted?.background) {
  ok(`positive control: a CHARACTER still accepts one (background "${out.characterAccepted.background}", `
    + `${out.characterAccepted.items} item(s) granted)`);
} else {
  fail("positive control: a character did NOT accept a background — the drop path is broken, "
    + "so every refusal above proves nothing");
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "BACKGROUND DROP GUARD PROBE FAILED" : "Background drop guard probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

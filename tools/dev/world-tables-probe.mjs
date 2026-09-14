#!/usr/bin/env node
/**
 * WORLD-FIRST TABLES (2026-09-13): every table a generator declares resolves to
 * a RollTable in the Warden's world of the same name before the shipped pack.
 *
 *   node tools/dev/world-tables-probe.mjs   (needs Foundry running, world launched)
 *
 * What it holds, and why each leg is there:
 *   1. THE RESOLVER, over every declaration — read IN-PAGE off CONFIG.Cairn (a
 *      probe-side list is a copy that goes stale), plus the Barebones creation
 *      tables off their pack's index and Scars. Baseline: each resolves to a
 *      PACK document. Plant a world table of that name → each resolves to the
 *      world one. CONTROL, in-page: the old pack-only lookup still answers the
 *      pack copy, so the world tables really are a second document and the
 *      green lines are not reading the shipped catalog twice.
 *   2. END TO END through the real generators, because a resolver that works and
 *      a generator that never calls it look identical from leg 1: a generated
 *      monster's name and attack, an NPC's background, traits and name, and a 2e
 *      character's eight traits all carry the planted marker; a scar roll posts
 *      the planted scar.
 *   3. THE PICKER — the NPC Background pick-list — offers the world table's rows.
 *      The die and the list must resolve the same table, or a Warden's own
 *      Backgrounds roll and cannot be picked. Opened un-awaited and read off the
 *      live dialog, then closed: a probe that awaits a modal hangs.
 *   4. THE DRAWN-STATE INVARIANT. A world table with replacement OFF is rolled
 *      six times through the generators' reader and no row is marked drawn,
 *      because `roll()` writes nothing. CONTROL: one bare `draw()` on the same
 *      table DOES mark a row — so the assertion can fail, and what the reader
 *      escaped is real. This is the write that made the conversion more than a
 *      one-line change (config.js records the rule).
 *   5. Deleting the world tables puts every pack copy back.
 *
 * Planted tables carry `flags.air-bladder.probeWorldTable`, and the run sweeps
 * that flag before starting AND from Node in the finally: a killed run's
 * leftover is, by name, exactly a Warden's own table, and every generator would
 * quietly roll "PROBE::" text into the dev world until somebody noticed.
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

const MARK = "PROBE::";
const FLAG = "probeWorldTable";

/** Delete every planted table, temp actor and scar card. Safe to run twice. */
const sweep = () => page.evaluate(async ({ FLAG, MARK }) => {
  const out = { tables: [], actors: 0, messages: 0 };
  for (const t of [...game.tables].filter((x) => x.getFlag("air-bladder", FLAG))) { out.tables.push(t.name); await t.delete(); }
  for (const a of [...game.actors].filter((x) => x.getFlag("air-bladder", FLAG))) { out.actors++; await a.delete(); }
  for (const i of [...game.items].filter((x) => x.getFlag("air-bladder", FLAG))) { out.actors++; await i.delete(); }
  for (const m of [...game.messages].filter((x) => String(x.content ?? "").includes(MARK))) { out.messages++; await m.delete(); }
  return out;
}, { FLAG, MARK });

try {
  await joinAsGM(page);

  const pre = await sweep();
  pre.tables.length || pre.actors || pre.messages
    ? console.log(`  --    swept leftovers first: ${pre.tables.length} table(s) ${pre.tables.join(", ")}, ${pre.actors} actor(s), ${pre.messages} card(s)`)
    : ok("nothing planted left behind by an earlier run — the legs below start clean");

  /* ---- 1. the resolver, every declaration --------------------------------- */
  console.log("\nthe resolver, over every declared table");
  const r = await page.evaluate(async ({ MARK, FLAG }) => {
    const comp = await import("/systems/air-bladder/module/compendium.js");
    const C = CONFIG.Cairn;
    const decls = new Set([
      ...Object.values(C.characterGenerator2e.biography.items),
      C.npcGenerator.name, C.npcGenerator.background, C.npcGenerator.faction,
      ...Object.values(C.npcGenerator.traits),
      ...Object.values(C.monsterGenerator),
      C.barebonesGenerator.name,
      "air-bladder.utils;Scars",
    ]);
    // The Barebones creation tables are looked up by name inside the generator
    // and declared nowhere in CONFIG, so read the pack's own index for them.
    for (const e of await game.packs.get("air-bladder.tables-barebones").getIndex()) decls.add(`air-bladder.tables-barebones;${e.name}`);
    const nameOf = (d) => (d.includes(";") ? d.split(";")[1] : d).trim();
    const packOf = (d) => (d.includes(";") ? d.split(";")[0] : null);

    const out = { count: decls.size, baselinePack: 0, baselineMiss: [], worldHits: 0, worldMiss: [], control: 0, controlMiss: [], planted: [] };

    for (const d of decls) {
      const t = await comp.findDeclaredTable(d);
      if (t?.pack) out.baselinePack++; else out.baselineMiss.push(d);
    }

    // Plant by ID DIFFERENCE, never by name: a leftover with this name is the
    // one thing the sweep above could have missed if it lost its flag.
    const before = new Set(game.tables.map((t) => t.id));
    const RT = CONFIG.RollTable.documentClass;
    // One row spanning 1-20, not [1, 1]: the scar roll is `new Roll(damage)`,
    // and a fixture only a 1 can hit made core answer "no possible results"
    // for a damage of 3 — a red the first run reported against the code.
    await RT.createDocuments([...decls].map((d) => ({
      name: nameOf(d),
      formula: "1d1",
      replacement: true,
      results: [{ type: "text", description: `${MARK}${nameOf(d)}`, range: [1, 20], weight: 1 }],
      flags: { "air-bladder": { [FLAG]: true } },
    })));
    const planted = game.tables.filter((t) => !before.has(t.id));
    out.planted = planted.map((t) => t.name);

    for (const d of decls) {
      const t = await comp.findDeclaredTable(d);
      const mine = planted.find((p) => p.name === nameOf(d));
      if (t && !t.pack && t.id === mine?.id) out.worldHits++; else out.worldMiss.push(d);
      // CONTROL: the pack-only lookup this replaced.
      const pack = packOf(d);
      if (!pack) { out.control++; continue; }           // the bare faction name had no pack half
      const old = await comp.findCompendiumItem(pack, nameOf(d));
      if (old?.pack && old.id !== mine?.id) out.control++; else out.controlMiss.push(d);
    }
    return out;
  }, { MARK, FLAG });

  r.baselinePack === r.count && r.baselineMiss.length === 0
    ? ok(`${r.count} declared tables, every one resolving to a PACK document before anything is planted`)
    : fail(`baseline: ${r.baselinePack}/${r.count} on the pack; missing or wrong: ${r.baselineMiss.join(", ")}`);
  r.planted.length === r.count
    ? ok(`planted ${r.planted.length} world tables of the same names`)
    : fail(`planted ${r.planted.length}, expected ${r.count}`);
  r.worldHits === r.count
    ? ok(`WORLD FIRST: every declaration now resolves to the planted world table`)
    : fail(`${r.count - r.worldHits} declaration(s) still resolve to the pack: ${r.worldMiss.join(", ")}`);
  r.control === r.count
    ? ok(`CONTROL: the pack-only lookup still answers the shipped copy for every one — the world tables are a second document`)
    : fail(`CONTROL FAILED for ${r.controlMiss.join(", ")} — the pack copy and the world copy are not distinguishable, so the leg above proves nothing`);

  /* ---- 2. end to end through the generators -------------------------------- */
  console.log("\nthrough the generators, with the world tables planted");
  const g = await page.evaluate(async ({ MARK, FLAG }) => {
    const mg = await import("/systems/air-bladder/module/monster-generator.js");
    const cg = await import("/systems/air-bladder/module/character-generator.js");
    const dmg = await import("/systems/air-bladder/module/damage.js");
    const has = (s) => String(s ?? "").includes(MARK);
    const out = {};

    const m = await mg.generateMonster("standard");
    out.monsterName = m.name;
    out.monsterAttack = m.items?.find((i) => i.type === "item" && i.system?.damageFormula)?.name ?? "";
    out.monster = has(m.name) && has(out.monsterAttack);

    const n = await cg.generateNpc();
    out.npcBackground = n.background;
    out.npcName = n.name;
    out.npcTraits = n.traits;
    out.npc = has(n.background) && has(n.name) && ["quirk", "goal", "virtue", "vice"].every((k) => has(n.traits?.[k]));

    const c = await cg.generateCharacter(null, "2e");
    out.pcTraits = c.traits;
    const eight = Object.keys(CONFIG.Cairn.characterGenerator2e.biography.items);
    out.pc = eight.every((k) => has(c.traits?.[k]));
    out.pcMissing = eight.filter((k) => !has(c.traits?.[k]));

    // The scar roll posts a card; find it by id difference and read it.
    const before = new Set(game.messages.map((x) => x.id));
    await dmg.Damage._rollScarsTable(3);
    let card = null;
    for (let i = 0; i < 40 && !card; i++) {
      card = game.messages.find((x) => !before.has(x.id)) ?? null;
      if (!card) await new Promise((res) => setTimeout(res, 100));
    }
    out.scarCard = card ? String(card.content) : null;
    out.scar = has(out.scarCard);
    return out;
  }, { MARK, FLAG });

  g.monster ? ok(`a generated monster carries the world tables: "${g.monsterName}", attack "${g.monsterAttack}"`)
            : fail(`monster generation read the pack: name "${g.monsterName}", attack "${g.monsterAttack}"`);
  g.npc ? ok(`a generated NPC carries them too: background "${g.npcBackground}", name "${g.npcName}", four traits`)
        : fail(`NPC generation read the pack somewhere: background "${g.npcBackground}", name "${g.npcName}", traits ${JSON.stringify(g.npcTraits)}`);
  g.pc ? ok("a generated 2e character carries all eight biography tables")
       : fail(`2e generation read the pack for: ${g.pcMissing.join(", ")} — ${JSON.stringify(g.pcTraits)}`);
  g.scar ? ok("a scar roll posts the world Scars table's row")
         : fail(`the scar card did not come from the world table: ${g.scarCard === null ? "no card posted" : g.scarCard.slice(0, 120)}`);

  /* ---- 2b. a DOCUMENT row on a Warden's monster table (review #30) --------- */
  console.log("\na document row on a world monster table");
  const dr = await page.evaluate(async ({ MARK, FLAG }) => {
    const mg = await import("/systems/air-bladder/module/monster-generator.js");
    const decl = CONFIG.Cairn.monsterGenerator.feature;
    const name = decl.split(";")[1];
    const item = await CONFIG.Item.documentClass.create({
      name: `${MARK}Feature Doc`, type: "item", flags: { "air-bladder": { [FLAG]: true } },
    });
    const table = game.tables.find((x) => x.name === name && x.getFlag("air-bladder", FLAG));
    const swap = async (rows) => {
      await table.deleteEmbeddedDocuments("TableResult", table.results.map((r) => r.id));
      await table.createEmbeddedDocuments("TableResult", rows);
    };
    // A row dragged in from the Items sidebar, the shape the shipped tables
    // never hold: the generator's reader rendered it as `@UUID[...]{name}` for
    // a day, and ARMORED_FEATURES could never match it.
    await swap([{ type: "document", documentUuid: item.uuid, name: item.name, range: [1, 20], weight: 1 }]);
    const m = await mg.generateMonster("standard");
    await swap([{ type: "text", description: `${MARK}${name}`, range: [1, 20], weight: 1 }]);   // the later legs read the marker
    await item.delete();
    return { name: m.name, hasUuid: String(m.name).includes("@UUID"), hasItem: String(m.name).includes(`${MARK}Feature Doc`) };
  }, { MARK, FLAG });
  !dr.hasUuid && dr.hasItem
    ? ok(`a document row reads as its NAME in a generated monster: "${dr.name}"`)
    : fail(`a document row on the feature table produced "${dr.name}" — @UUID: ${dr.hasUuid}, item name: ${dr.hasItem}`);

  /* ---- 3. the picker ------------------------------------------------------- */
  console.log("\nthe NPC Background pick-list");
  const p = await page.evaluate(async ({ MARK, FLAG }) => {
    const cg = await import("/systems/air-bladder/module/character-generator.js");
    const actor = await CONFIG.Actor.documentClass.create({
      name: "PROBE world-tables npc", type: "npc", system: { role: "npc" }, flags: { "air-bladder": { [FLAG]: true } },
    });
    const before = new Set(foundry.applications.instances.keys());
    const pending = cg.promptNpcBackground(actor);            // NOT awaited — it is a modal
    let dialog = null;
    for (let i = 0; i < 60 && !dialog; i++) {
      dialog = [...foundry.applications.instances.entries()].find(([id, app]) => !before.has(id) && app.element?.querySelector(".bg-pick-list"))?.[1] ?? null;
      if (!dialog) await new Promise((res) => setTimeout(res, 50));
    }
    const rows = dialog ? [...dialog.element.querySelectorAll(".bg-pick-name")].map((el) => el.textContent.trim()) : [];
    await dialog?.close();
    await pending;
    await actor.delete();
    return { opened: !!dialog, rows, marked: rows.filter((t) => t.includes(MARK)) };
  }, { MARK, FLAG });

  p.opened && p.marked.length === 1 && p.rows.length === 2
    ? ok(`the pick-list offers the world table's row and nothing from the pack: [${p.rows.join(" | ")}]`)
    : fail(`pick-list wrong: opened=${p.opened}, ${p.rows.length} rows, ${p.marked.length} from the world table — ${JSON.stringify(p.rows.slice(0, 5))}`);

  /* ---- 4. the drawn-state invariant ---------------------------------------- */
  console.log("\nthe drawn-state invariant, on a world table with replacement off");
  const d = await page.evaluate(async ({ MARK, FLAG }) => {
    const cg = await import("/systems/air-bladder/module/character-generator.js");
    const decl = CONFIG.Cairn.characterGenerator2e.biography.items.physique;
    const name = decl.split(";")[1];
    // Replace the planted Physique with a three-row, no-replacement one.
    for (const t of game.tables.filter((x) => x.name === name && x.getFlag("air-bladder", FLAG))) await t.delete();
    const table = await CONFIG.RollTable.documentClass.create({
      name, formula: "1d3", replacement: false, flags: { "air-bladder": { [FLAG]: true } },
      results: [1, 2, 3].map((i) => ({ type: "text", description: `${MARK}${name} ${i}`, range: [i, i], weight: 1 })),
    });
    const texts = [];
    for (let i = 0; i < 6; i++) texts.push((await cg.rollTextItems({ physique: decl })).physique);
    const drawnAfterRolls = table.results.filter((x) => x.drawn).length;
    // CONTROL: the write the reader escaped.
    await table.draw({ displayChat: false });
    const drawnAfterDraw = table.results.filter((x) => x.drawn).length;
    await table.delete();
    return { texts, drawnAfterRolls, drawnAfterDraw };
  }, { MARK, FLAG });

  d.texts.length === 6 && d.texts.every((t) => t.includes(MARK)) && d.drawnAfterRolls === 0
    ? ok("six rolls through the generators' reader, six results, and NO row marked drawn")
    : fail(`the reader marks or misses: ${d.drawnAfterRolls} row(s) drawn after six rolls, texts ${JSON.stringify(d.texts)}`);
  d.drawnAfterDraw > 0
    ? ok(`CONTROL: one bare draw() on the same table marks ${d.drawnAfterDraw} row(s) — the write is real and the reader avoids it`)
    : fail("CONTROL FAILED: draw() marked nothing, so the leg above could not have failed");

  /* ---- 4b. a DRAWN row is still a scar (review #30) ------------------------ */
  console.log("\na drawn row is still a scar");
  const sd = await page.evaluate(async ({ MARK, FLAG }) => {
    const dmg = await import("/systems/air-bladder/module/damage.js");
    const table = game.tables.find((x) => x.name === "Scars" && x.getFlag("air-bladder", FLAG));
    // The Warden's own hand draw, on a table with replacement off, leaves the
    // row marked. roll() skips drawn rows and a CONSTANT roll cannot escape
    // one — core rerolled the damage number 10,000 times and gave no scar.
    // The flow selects by range now and never asks.
    await table.updateEmbeddedDocuments("TableResult", table.results.map((r) => ({ _id: r.id, drawn: true })));
    const before = new Set(game.messages.map((x) => x.id));
    await dmg.Damage._rollScarsTable(3);
    let card = null;
    for (let i = 0; i < 40 && !card; i++) {
      card = game.messages.find((x) => !before.has(x.id)) ?? null;
      if (!card) await new Promise((res) => setTimeout(res, 100));
    }
    await table.updateEmbeddedDocuments("TableResult", table.results.map((r) => ({ _id: r.id, drawn: false })));
    return { card: card ? String(card.content) : null };
  }, { MARK, FLAG });
  sd.card?.includes(MARK)
    ? ok("a scar row a hand draw marked `drawn` still scars — the damage flow selects by range, never through roll()'s drawn filter")
    : fail(`no scar from a drawn row: ${sd.card === null ? "no card posted" : sd.card.slice(0, 120)}`);

  /* ---- 5. restore ---------------------------------------------------------- */
  console.log("\nrestore");
  const post = await sweep();
  const back = await page.evaluate(async () => {
    const comp = await import("/systems/air-bladder/module/compendium.js");
    const C = CONFIG.Cairn;
    const sample = [C.characterGenerator2e.biography.items.physique, C.npcGenerator.background, C.monsterGenerator.quirk, "air-bladder.utils;Scars"];
    const packAgain = [];
    for (const dcl of sample) packAgain.push(!!(await comp.findDeclaredTable(dcl))?.pack);
    return { packAgain, leftovers: game.tables.filter((t) => t.getFlag("air-bladder", "probeWorldTable")).length };
  });
  back.packAgain.every(Boolean) && back.leftovers === 0
    ? ok(`deleting the world tables puts the pack copies back (${post.tables.length} table(s) removed, ${post.messages} card(s), ${post.actors} actor(s))`)
    : fail(`restore incomplete: pack again=${JSON.stringify(back.packAgain)}, ${back.leftovers} planted table(s) still in the world`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  // From Node, so a leg that threw cannot leave "PROBE::" tables that every
  // generator in the dev world would then roll.
  try { const s = await sweep(); if (s.tables.length) console.log(`  --    finally: removed ${s.tables.length} planted table(s)`); } catch { /* page gone */ }
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nWORLD-TABLES PROBE FAILED\n" : "\nworld-tables probe passed\n");
process.exit(failed ? 1 : 0);

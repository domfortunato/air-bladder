#!/usr/bin/env node
/**
 * TableResult: no deprecated members, and a WORLD document row really resolves.
 *
 * Foundry v13 merged the "compendium" result type into "document" and replaced
 * `documentId` + `documentCollection` with a single `documentUuid`. Five members
 * this system used are shims that go in **v15**: `TableResult#text`,
 * `#documentId`, `#documentCollection`, `getChatText()`, and
 * `CONST.TABLE_RESULT_TYPES.COMPENDIUM`. The deploy target is 14.365, so the
 * deadline is one major away and every one of them still WORKS today — which is
 * why nothing caught this and why a grep-based check would rot the moment someone
 * writes `r.text` again.
 *
 * PHASE 1 sets `CONFIG.compatibility.mode = FAILURE`, which makes
 * `logCompatibilityWarning` THROW instead of warn (common/utils/logging.mjs:53-54)
 * — note it throws unconditionally, ignoring the `once: true` these getters pass,
 * so there is no first-call-only escape. `includePatterns` scopes it to
 * TableResult, so an unrelated core deprecation somewhere else does not fail this
 * probe with a misleading message. Then it exercises every path that reads a
 * table: the shop, the eight 2e trait draws, bonds, name rolls, Barebones
 * generation, and the character sheet's trait/scar pick-lists. A surviving
 * deprecated read throws, and the thrown message names the member.
 *
 * PHASE 2 is the user-visible bug the migration closed. A result pointing at a
 * WORLD document — what you get by dragging an item out of the Items sidebar into
 * a table — was silently dropped. Not at the type check, as it looks: the
 * deprecated `COMPENDIUM` getter returns `"document"`, so a world row matched
 * fine. It died one line later, because `documentCollection` returns the document
 * NAME ("Item") for a world document, and that is not a pack id, so the name
 * lookup missed and returned undefined. `fromUuid` resolves both.
 *
 * PHASE 3 is the specificity control: compendium rows must still resolve, and the
 * shop must still hold every item it held before. Phase 2 passing on its own would
 * also be consistent with "everything now resolves to something", which is worse
 * than the bug.
 *
 * Usage: npm run dev:table-results
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m, d) => console.log(`  ok    ${m}${d ? ` — ${d}` : ""}`);
const fail = (m, d) => { console.error(`  FAIL  ${m}${d ? ` — ${d}` : ""}`); failed = true; };

const browser = await chromium.launch();
watchdog(300000, "table results probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const out = await page.evaluate(async () => {
  const sys = "/systems/air-bladder/module";
  const comp = await import(`${sys}/compendium.js`);
  const mk = await import(`${sys}/marketplace.js`);
  const cg = await import(`${sys}/character-generator.js`);
  const res = { deprecations: [], phase1: [] };

  const cleanup = async () => {
    for (const t of game.tables.filter((t) => t.name?.startsWith("ZZ TR"))) await t.delete();
    for (const i of game.items.filter((i) => i.name?.startsWith("ZZ TR"))) await i.delete();
  };
  await cleanup();

  /* ---- PHASE 1: any deprecated TableResult read throws ------------------- */
  const before = foundry.utils.deepClone(CONFIG.compatibility);
  CONFIG.compatibility = {
    mode: CONST.COMPATIBILITY_MODES.FAILURE,
    includePatterns: [/TableResult/, /TABLE_RESULT_TYPES/, /TableResultData/],
    excludePatterns: [],
  };
  const step = async (label, fn) => {
    try {
      await fn();
      res.phase1.push({ label, ok: true });
    } catch (e) {
      res.phase1.push({ label, ok: false, error: String(e.message ?? e).split("\n")[0] });
      res.deprecations.push(`${label}: ${String(e.message ?? e).split("\n")[0]}`);
    }
  };

  try {
    await step("the shop catalogue (getMarketplaceCatalog)", async () => {
      const cat = await mk.getMarketplaceCatalog();
      res.shopItems = cat.categories.reduce((n, c) => n + c.items.length, 0);
    });

    await step("findTableItems over every shipped RollTable", async () => {
      let n = 0;
      for (const pack of game.packs.filter((p) => p.metadata.type === "RollTable"
          && p.metadata.packageName === "air-bladder")) {
        for (const table of await pack.getDocuments()) n += (await comp.findTableItems([...table.results])).length;
      }
      res.shippedResolved = n;
    });

    await step("the eight 2e trait draws (drawTableText)", async () => {
      const mapping = CONFIG.Cairn?.characterGenerator2e?.biography?.items ?? {};
      res.traits = await cg.rollTextItems(mapping);
    });

    await step("a bond draw (drawBond)", async () => { res.bond = !!(await cg.drawBond()); });

    await step("a name roll (rollNameFromTable)", async () => {
      res.rolledName = await cg.rollNameFromTable(CONFIG.Cairn?.hirelingGenerator?.name, "ZZ-fallback");
    });

    // Barebones is where resolveBarebonesResult lives — the nested-RollTable and
    // transport branches, which are the two that used to key on a pack id.
    // generateBarebonesCharacter, not createCharacter: the latter routes through
    // the background PROMPT, and a probe that awaits a modal dialog hangs.
    await step("a Barebones character (the nested-table + transport branches)", async () => {
      const c = await cg.generateBarebonesCharacter();
      res.barebones = { items: c?.items?.length ?? 0, containers: c?.containers?.length ?? 0 };
    });

    await step("a character sheet render (trait rows, scars, omen list)", async () => {
      const a = await CONFIG.Actor.documentClass.create({ name: "ZZ TR Sheet", type: "character" });
      const ctx = await a.sheet._prepareContext({});
      res.traitRows = ctx.traitRows?.length ?? 0;
      res.scarOptions = ctx.scarOptions?.length ?? 0;
      await a.delete();
    });
  } finally {
    CONFIG.compatibility = before;
  }

  /* ---- PHASE 2: a WORLD document row resolves ---------------------------- */
  const worldItem = await CONFIG.Item.documentClass.create({ name: "ZZ TR World Dagger", type: "weapon" });
  const packItem = await fromUuid("Compendium.air-bladder.weapons.Item.bBxRixn3s83nf22t");
  const table = await RollTable.create({
    name: "ZZ TR Mixed Table",
    results: [
      { type: "document", documentUuid: worldItem.uuid, name: worldItem.name, range: [1, 1] },
      { type: "document", documentUuid: packItem?.uuid, name: packItem?.name, range: [2, 2] },
      { type: "text", description: "ZZ TR just prose", range: [3, 3] },
    ],
  });
  const resolved = await comp.findTableItems([...table.results]);
  res.mixed = {
    names: resolved.map((d) => d.name),
    uuids: resolved.map((d) => d.uuid),
    worldResolved: resolved.some((d) => d.uuid === worldItem.uuid),
    packResolved: resolved.some((d) => d.uuid === packItem?.uuid),
    textSkipped: resolved.length === 2,
  };

  // The text row's prose and the document rows' names, via the one helper.
  res.helper = [...table.results].map((r) => comp.resultText(r));
  res.chatText = [...table.results].map((r) => comp.resultChatText(r));

  /* ---- CONTROLS: both of the above must be able to FAIL ------------------ */
  // (a) Phase 1's trip-wire. A green phase 1 means "nothing read a deprecated
  //     member" only if a deprecated read would in fact have thrown. Run the OLD
  //     expression under the same CONFIG.compatibility and require the throw.
  //     Without this, a typo in includePatterns turns phase 1 into seven ok lines
  //     that assert nothing.
  const before2 = foundry.utils.deepClone(CONFIG.compatibility);
  CONFIG.compatibility = {
    mode: CONST.COMPATIBILITY_MODES.FAILURE,
    includePatterns: [/TableResult/, /TABLE_RESULT_TYPES/, /TableResultData/],
    excludePatterns: [],
  };
  try {
    const r = [...table.results][0];
    const old = `${r.text}|${r.documentCollection}|${r.documentId}`;
    res.tripwire = { threw: false, got: old };
  } catch (e) {
    res.tripwire = { threw: true, message: String(e.message ?? e).split("\n")[0] };
  } finally {
    CONFIG.compatibility = before2;
  }

  // (b) Phase 2's bug. Run the OLD resolution algorithm over the SAME table and
  //     require it to drop the world row. If it resolved, this table never
  //     reproduced the bug and phase 2 was passing for free.
  const oldWay = [];
  for (const r of table.results) {
    if (r.type !== CONST.TABLE_RESULT_TYPES.DOCUMENT) continue;
    const d = await comp.findCompendiumItem(r.documentCollection, r.text);
    if (d) oldWay.push(d.uuid);
  }
  res.oldWay = {
    uuids: oldWay,
    droppedWorld: !oldWay.includes(worldItem.uuid),
    keptPack: oldWay.includes(packItem?.uuid),
  };

  await cleanup();
  return res;
});

console.log("\nphase 1 — no deprecated TableResult member survives on any read path");
for (const s of out.phase1) {
  if (s.ok) ok(s.label);
  else fail(s.label, s.error);
}

console.log("\nphase 1 — and the paths actually did something");
out.shopItems > 50
  ? ok("the shop stocked its catalogue", `${out.shopItems} items`)
  : fail("the shop came back near-empty", `${out.shopItems} items — phase 1 proved nothing`);
out.shippedResolved === 198
  ? ok("every shipped document row resolved", `${out.shippedResolved}/198`)
  : fail("shipped rows resolved to a different count", `${out.shippedResolved}, expected 198`);
Object.keys(out.traits ?? {}).length >= 8 && Object.values(out.traits ?? {}).every(Boolean)
  ? ok("all eight 2e traits drew text", Object.values(out.traits)[0])
  : fail("a 2e trait draw came back empty", JSON.stringify(out.traits));
out.bond ? ok("a bond drew") : fail("no bond drew");
out.rolledName && out.rolledName !== "ZZ-fallback"
  ? ok("a name rolled off the table", out.rolledName)
  : fail("the name roll fell back", `got "${out.rolledName}" — the table was not read`);
out.barebones?.items > 0
  ? ok("a Barebones character generated with gear",
      `${out.barebones.items} items, ${out.barebones.containers} containers`)
  : fail("Barebones generated no items", `${JSON.stringify(out.barebones)} — the nested-table branch did not run`);
out.traitRows >= 8 && out.scarOptions > 0
  ? ok("the sheet built its pick-lists", `${out.traitRows} trait rows, ${out.scarOptions} scars`)
  : fail("the sheet's pick-lists were empty", `${out.traitRows} traits, ${out.scarOptions} scars`);

console.log("\nphase 2 — a row pointing at a WORLD document (dragged from the Items sidebar)");
out.mixed.worldResolved
  ? ok("a world-document row resolves", out.mixed.names.join(", "))
  : fail("a world-document row was DROPPED", "this is the live bug; it is not fixed");

console.log("\nphase 3 — specificity");
out.mixed.packResolved
  ? ok("a compendium row still resolves")
  : fail("a compendium row stopped resolving", "the shipped content is broken");
out.mixed.textSkipped
  ? ok("a text row is still not an item", `${out.mixed.names.length} of 3 rows resolved`)
  : fail("a text row resolved to a document", JSON.stringify(out.mixed.names));
out.helper[2] === "ZZ TR just prose" && out.helper[0] === "ZZ TR World Dagger"
  ? ok("resultText reads prose from a text row and the name from a document row")
  : fail("resultText returned the wrong field", JSON.stringify(out.helper));
out.chatText[2] === "ZZ TR just prose" && out.chatText[0].startsWith("@UUID[")
  ? ok("resultChatText links a document row and passes prose through")
  : fail("resultChatText is not what getChatText produced", JSON.stringify(out.chatText));

console.log("\ncontrols — both of the above must be able to fail");
out.tripwire.threw
  ? ok("a deprecated read DOES throw under this config", out.tripwire.message)
  : fail("the deprecation trip-wire is dead", `read "${out.tripwire.got}" without throwing — `
      + "every ok in phase 1 is meaningless");
out.oldWay.droppedWorld
  ? ok("the OLD algorithm drops the world row, as reported", `kept ${out.oldWay.uuids.length} of 2`)
  : fail("the old algorithm resolved the world row too", "this table does not reproduce the bug, "
      + "so phase 2 proves nothing");
out.oldWay.keptPack
  ? ok("the old algorithm did keep the compendium row", "so it was working, just not for world rows")
  : fail("the old algorithm resolved nothing at all", "the control is broken, not the code");

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "TABLE RESULTS PROBE FAILED" : "Table results probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

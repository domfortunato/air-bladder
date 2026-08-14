#!/usr/bin/env node
/**
 * The shipped canon spell table, and the Warden reseed that keeps a world
 * copy honest (ruling 2026-08-05: ship maintained tables + a reseed action).
 *
 *   npm run dev:spell-tables     (needs Foundry running, world launched)
 *
 * Legs:
 *   1. The SHIPPED "Spells — Canon (1d100)" table: present in tables-2e,
 *      100 document rows, formula 1d100, and EVERY row's uuid resolves to a
 *      document whose name matches the row. Row uuids embed the pack name, so
 *      this leg is the gate that catches a future pack rename before a user
 *      does. In-page control: a deliberately-broken uuid resolves null, so
 *      "resolved" is a real observation, not a fromUuid that never fails.
 *   2. RESEED, update-in-place: import the shipped table into the world,
 *      plant a bogus extra row (assert it landed — the precondition said out
 *      loud), reseed from the canon pack, and assert the TABLE ID IS
 *      UNCHANGED (the whole point — @UUID links survive), the bogus row is
 *      gone, 100 alphabetical rows, formula rewritten. The plant→gone
 *      transition is the fail-with-fix-removed witness: a reseed that does
 *      nothing leaves the bogus row and fails.
 *   3. EMPTY-SOURCE REFUSAL: reseeding from a scratch world pack with no
 *      spellbooks returns 0 and touches nothing — an empty result is never
 *      what "reseed" meant, and refusal must come BEFORE any delete.
 *   4. The DIRECTORY BUTTON: the Tables directory carries the Warden's
 *      Reseed button, clicking it opens the two-select dialog, and Cancel
 *      touches nothing. Buttons must be pressed on every path — an
 *      unanswered DialogV2 is a probe hang, not a failure.
 *
 * Cleanup in a Node-level finally: the imported world table and the scratch
 * pack are deleted, names and ids printed at plant time.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const TABLE_NAME = "Spells — Canon (1d100)";
const TABLES_PACK = "air-bladder.tables-2e";
const CANON = "air-bladder.spellbooks";

const browser = await chromium.launch();
watchdog(180000, "spell-tables probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);
const note = (m) => console.log(`  note  ${m}`);

let planted = null;

try {
  await joinAsGM(page);

  /* --- 1. the shipped table, every row resolving --------------------------- */

  const shipped = await page.evaluate(async ({ TABLES_PACK, TABLE_NAME, CANON }) => {
    const pack = game.packs.get(TABLES_PACK);
    if (!pack) return { missing: "pack" };
    const index = await pack.getIndex();
    const entry = index.find((e) => e.name === TABLE_NAME);
    if (!entry) return { missing: "table", names: index.map((e) => e.name) };
    const table = await pack.getDocument(entry._id);
    const out = {
      id: entry._id,
      rows: table.results.size,
      formula: table.formula,
      allDocRows: table.results.every((r) => r.type === CONST.TABLE_RESULT_TYPES.DOCUMENT),
      badRows: [],
      intoCanon: 0,
    };
    for (const r of table.results) {
      const doc = await fromUuid(r.documentUuid);
      if (!doc) out.badRows.push(`${r.name}: ${r.documentUuid} resolves to NOTHING`);
      else if (doc.name !== r.name) out.badRows.push(`row "${r.name}" resolves to "${doc.name}"`);
      if (r.documentUuid?.includes(CANON)) out.intoCanon++;
    }
    // CONTROL: a broken uuid must read as null, or "every row resolved" is
    // a fromUuid that cannot fail.
    out.brokenResolves = await fromUuid(`Compendium.air-bladder.no-such-pack.Item.aaaabbbbccccdddd`)
      .then((d) => d !== null).catch(() => false);
    return out;
  }, { TABLES_PACK, TABLE_NAME, CANON });

  if (shipped.missing) {
    fail(shipped.missing === "pack" ? "tables-2e pack missing" : `"${TABLE_NAME}" not in tables-2e (has: ${shipped.names?.join(", ")})`);
  } else {
    shipped.rows === 100 && shipped.formula === "1d100" && shipped.allDocRows
      ? ok(`shipped table: 100 document rows, formula 1d100`)
      : fail(`shipped table shape wrong (rows ${shipped.rows}, formula ${shipped.formula}, allDocRows ${shipped.allDocRows})`);
    shipped.badRows.length === 0 && shipped.intoCanon === 100
      ? ok("every row resolves into the canon pack, name-for-name — a pack rename cannot get past this")
      : fail(`${shipped.badRows.length} bad row(s), ${shipped.intoCanon}/100 into canon:\n        ${shipped.badRows.slice(0, 5).join("\n        ")}`);
    shipped.brokenResolves === false
      ? ok("NEGATIVE CONTROL: a broken uuid reads as unresolved — the leg above can fail")
      : fail("a nonsense uuid RESOLVED — fromUuid is not measuring what this probe claims");
  }

  /* --- 2. reseed a world copy, update-in-place ----------------------------- */

  planted = await page.evaluate(async ({ TABLES_PACK, TABLE_NAME }) => {
    const pack = game.packs.get(TABLES_PACK);
    const entry = (await pack.getIndex()).find((e) => e.name === TABLE_NAME);
    const table = await game.tables.importFromCompendium(pack, entry._id, {}, { keepId: false });
    const [bogus] = await table.createEmbeddedDocuments("TableResult", [{
      type: CONST.TABLE_RESULT_TYPES.TEXT,
      description: "zz-bogus-planted-row",
      weight: 1, range: [101, 101], drawn: false,
    }]);
    const scratch = await foundry.documents.collections.CompendiumCollection.createCompendium({
      label: "zz-spell-tables-scratch", type: "Item",
    });
    return {
      tableId: table.id, tableName: table.name,
      rowsAfterPlant: table.results.size, bogusId: bogus.id,
      scratchId: scratch.collection,
    };
  }, { TABLES_PACK, TABLE_NAME });

  note(`planted: world table "${planted.tableName}" ${planted.tableId} (bogus row ${planted.bogusId}); scratch pack ${planted.scratchId}`);
  planted.rowsAfterPlant === 101
    ? ok("precondition: the world copy holds 101 rows with the bogus row planted — the reseed below has something to remove")
    : fail(`world copy holds ${planted.rowsAfterPlant} rows, expected 101 — the transition below is not being witnessed`);

  const reseeded = await page.evaluate(async ({ tableId, CANON }) => {
    const { reseedTableFromPack } = await import("/systems/air-bladder/module/spell-tables.js");
    const table = game.tables.get(tableId);
    const written = await reseedTableFromPack(table, game.packs.get(CANON));
    // Order lives in each row's RANGE, not in collection iteration order —
    // the embedded collection does not iterate in insertion order, and the
    // draw only ever consults range. Sort by range before reading names.
    const names = [...table.results].sort((a, b) => a.range[0] - b.range[0]).map((r) => r.name);
    return {
      written,
      idAfter: table.id,
      rows: table.results.size,
      formula: table.formula,
      bogusGone: !table.results.find((r) => r.description === "zz-bogus-planted-row"),
      alphabetical: names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0),
      allResolveInCanon: table.results.every((r) => r.documentUuid?.includes(CANON)),
    };
  }, { tableId: planted.tableId, CANON });

  reseeded.idAfter === planted.tableId
    ? ok("reseed kept the TABLE ID — @UUID links pointing at the table survive")
    : fail(`reseed changed the table id (${planted.tableId} -> ${reseeded.idAfter}) — every link to it just died`);
  reseeded.written === 100 && reseeded.rows === 100 && reseeded.formula === "1d100"
    ? ok("reseed wrote 100 rows and rewrote the formula to 1d100")
    : fail(`reseed wrote ${reseeded.written}, table holds ${reseeded.rows}, formula ${reseeded.formula}`);
  reseeded.bogusGone
    ? ok("the planted bogus row is GONE — the reseed demonstrably replaced the rows")
    : fail("the planted bogus row SURVIVED the reseed");
  reseeded.alphabetical && reseeded.allResolveInCanon
    ? ok("rows are alphabetical and all point into the canon pack — the shipped importer's order, row-for-row")
    : fail(`alphabetical ${reseeded.alphabetical}, allInCanon ${reseeded.allResolveInCanon}`);

  /* --- 3. an empty source refuses ------------------------------------------ */

  const refusal = await page.evaluate(async ({ tableId, scratchId }) => {
    const { reseedTableFromPack } = await import("/systems/air-bladder/module/spell-tables.js");
    const table = game.tables.get(tableId);
    const written = await reseedTableFromPack(table, game.packs.get(scratchId));
    return { written, rows: table.results.size, formula: table.formula };
  }, { tableId: planted.tableId, scratchId: planted.scratchId });

  refusal.written === 0 && refusal.rows === 100 && refusal.formula === "1d100"
    ? ok("an empty source REFUSES: nothing written, the table untouched — reseed can never mean empty")
    : fail(`empty-source reseed wrote ${refusal.written}, left ${refusal.rows} rows, formula ${refusal.formula}`);

  /* --- 3b. a reseed that FAILS must not empty the table (review #14) -------- */

  // The defeat has to be the CREATE, not the delete. Making the delete throw
  // proves nothing: under the old delete-then-create order the delete is the
  // FIRST step, so a throw there leaves the rows exactly where they were and
  // the leg passes green under both codes. A create that throws is what tells
  // the two orders apart — and it is the realistic failure too (a malformed
  // row, a validation refusal, a pack that went away mid-call).
  //
  // Old order: delete succeeds (100 -> 0), create throws, the Warden's table is
  // EMPTY with no undo — a world table is not in git and LevelDB keeps no
  // history. New order: the create throws before anything is deleted.
  const survives = await page.evaluate(async ({ tableId, CANON }) => {
    const { reseedTableFromPack } = await import("/systems/air-bladder/module/spell-tables.js");
    const table = game.tables.get(tableId);
    const before = table.results.size;
    table.createEmbeddedDocuments = async () => { throw new Error("zz-planted create failure"); };
    let threw = "";
    try {
      await reseedTableFromPack(table, game.packs.get(CANON));
    } catch (e) {
      threw = e.message;
    }
    delete table.createEmbeddedDocuments;      // back to the prototype's
    return {
      before,
      after: table.results.size,
      threw,
      shadowGone: table.createEmbeddedDocuments === Object.getPrototypeOf(table).createEmbeddedDocuments,
    };
  }, { tableId: planted.tableId, CANON });

  survives.threw.includes("zz-planted")
    ? ok("precondition: the planted create failure actually fired — the leg below is not vacuous")
    : fail(`the shadowed create never threw (threw=${JSON.stringify(survives.threw)}) — the assertion below proves nothing`);
  survives.after === survives.before && survives.after > 0
    ? ok(`a failed reseed left all ${survives.after} rows in place — create BEFORE delete, so a throw can never empty a curated table`)
    : fail(`a failed reseed took the table from ${survives.before} rows to ${survives.after} — the Warden's rows are gone with no undo`);
  survives.shadowGone
    ? ok("the shadow is off the table again — the legs below run against the real method")
    : fail("the shadowed createEmbeddedDocuments is STILL on the table; everything below is testing a stub");

  /* --- 4. the directory button and its dialog ------------------------------ */

  await page.evaluate(() => ui.tables.render(true));
  const hasButton = await page.waitForFunction(
    () => !!ui.tables?.element?.querySelector(".cairn-reseed-spell-table"),
    null, { timeout: 15000 }
  ).then(() => true).catch(() => false);
  hasButton
    ? ok("the Tables directory carries the Reseed Spell Table button for the Warden")
    : fail("no Reseed button in the rendered Tables directory");

  if (hasButton) {
    await page.evaluate(() => ui.tables.element.querySelector(".cairn-reseed-spell-table").click());
    // instances is a MAP — Object.values() is [] and a close loop over it is a
    // silent no-op. Poll for the dialog, read its selects, then press Cancel:
    // every DialogV2 path must end on a button or the probe hangs.
    const dialog = await page.waitForFunction(() => {
      const d = [...foundry.applications.instances.values()]
        .find((a) => a.constructor.name === "DialogV2" && a.element?.querySelector('select[name="table"]'));
      if (!d) return null;
      return {
        selects: d.element.querySelectorAll("select").length,
        defaultPack: d.element.querySelector('select[name="pack"]')?.value,
      };
    }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);

    dialog && dialog.selects === 2 && dialog.defaultPack === CANON
      ? ok("the dialog offers table + source selects, canon pre-selected")
      : fail(`dialog wrong or absent (${JSON.stringify(dialog)})`);

    const afterCancel = await page.evaluate(async ({ tableId }) => {
      const d = [...foundry.applications.instances.values()]
        .find((a) => a.constructor.name === "DialogV2" && a.element?.querySelector('select[name="table"]'));
      d?.element.querySelector('button[data-action="cancel"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
      const table = game.tables.get(tableId);
      return { rows: table.results.size, open: !!d && foundry.applications.instances.has(d.id) };
    }, { tableId: planted.tableId });
    afterCancel.rows === 100
      ? ok("Cancel touches nothing — the world table still holds its 100 rows")
      : fail(`after Cancel the table holds ${afterCancel.rows} rows`);
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  try {
    if (planted) {
      const gone = await page.evaluate(async (p) => {
        const gone = [], left = [];
        try { await game.tables.get(p.tableId)?.delete(); gone.push("world table"); } catch { left.push("world table"); }
        try {
          const pk = game.packs.get(p.scratchId);
          if (pk) { await pk.deleteCompendium(); }
          gone.push("scratch pack");
        } catch { left.push("scratch pack"); }
        return { gone, left };
      }, planted);
      console.log(`  note  cleanup: removed ${gone.gone.join(", ")}${gone.left.length ? ` — LEFT BEHIND: ${gone.left.join(", ")}` : ""}`);
      if (gone.left.length) failed = true;
    }
  } catch (e) {
    console.error(`  FAIL  cleanup failed: ${e.message}`);
    failed = true;
  }
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nSPELL TABLES PROBE FAILED\n" : "\nspell tables probe passed\n");
process.exit(failed ? 1 : 0);

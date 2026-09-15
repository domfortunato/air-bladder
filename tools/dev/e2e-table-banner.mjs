#!/usr/bin/env node
/**
 * A TABLE EXPLAINS ITSELF (module/table-banner.js, 2026-09-15, user, on a copied
 * Market: Armor: "there is nothing that readily identifies it as being used for
 * customizing the marketplace other than its location — there is nothing that
 * tells me how to add an item to the table or to even drag and drop items onto
 * it").
 *
 *   node tools/dev/e2e-table-banner.mjs [--shots]   (needs Foundry running, the
 *                                      world launched, `npm run dev:players`)
 *
 * What it holds, in order:
 *   1. A world `Market: Gear` wears the Marketplace banner in EDIT mode (inside
 *      the results section, above the list, unshrinkable, the glyph RENDERED —
 *      read from `::before`, never the class list — and exactly one) and in
 *      VIEW mode (a direct child of the window content, after the header).
 *      Red-first: `withHookOff` on the named handler → the sheet, no banner.
 *   2. An EMPTY hand-made `Market: Potions` — its first render is forced into
 *      edit mode by core — names its aisle. `Market: Transports & Containers`
 *      gets the actors sentence. The SAME rows as `PROBE Gear` and as
 *      `Not a Market: X` get nothing: the prefix is anchored, and the name is
 *      the whole mechanism.
 *   3. The shipped PACK tables, locked and so forced into view mode: Market:
 *      Armor names the Marketplace button and the Rollable Tables sidebar,
 *      Bonds the Backgrounds button and the Compendium sidebar, both pool
 *      tables the Spell Table button whatever the hack says, utils' Scars the
 *      import sentence and no button at all.
 *   4. THE SPELL TABLES STAY ALPHABETICAL ON A DROP, like the aisles: three rows
 *      planted out of order, a fourth dropped through the same
 *      createEmbeddedDocuments call core's sheet makes, with the sheet OPEN →
 *      name order, ranges 1..4, `_source.formula` 1d4, and one banner still
 *      over four rows after the re-render. Controls: the same rows as `PROBE
 *      Spells` keep the dropped row last with the formula untouched; a drop
 *      onto the world `Bonds` re-sorts nothing (2e tables keep the book's
 *      order) but its die follows. The GLOG pool table sorts too, in either
 *      hack state.
 *  4b. THE FORMULA FOLLOWS THE ROWS on every other read table, FLAT DICE ONLY
 *      (user: "is its draw formula automatically updated?"): the world Bonds
 *      at b,a,c under 1d3 loses its last row → 1d2; red-first, with
 *      `onReadTableRowsChanged` off a dropped third row sits at 3 under 1d2;
 *      back on, a fourth row takes it to 1d4 with the order untouched and
 *      deleting both returns 1d2. Controls: a table of an unread name keeps
 *      1d2 over three rows; a world `Warden: NPC - Reactions` under 2d6
 *      (rows 2..12) keeps 2d6 after a drop and its banner tail names 2d6 and
 *      the Summary tab; a drag-built `Omens` with NO stored formula gets 1d3
 *      WRITTEN on its first added row (review #30's shape).
 *   5. The other roles by name: Bonds → cairn2e, Barebones: Creation - Weapon →
 *      barebones, Warden: NPC - Quirk → generic, Scars → cairn2e (a name shipped
 *      in two packs takes the button's kind, never the generic), GLOG Magic:
 *      Mishaps → generic; each flat one ends "a new row lands at the bottom and
 *      is rolled with the rest" and none names the scales button; Mishaps,
 *      planted 2d12, names its dice. `PROBE nothing` → none.
 *  5b. TWO WORLD TABLES OF ONE NAME (user ask, after wondering whether copies
 *      should be prefixed "Custom"): under a probe-only aisle name — never
 *      `Market: Gear`, which the Warden's own copy legitimately holds, so a
 *      fixture of that name is a duplicate the moment it lands (the first run
 *      redded on exactly that) — a second table created while the first's
 *      sheet is OPEN puts a warning line under its banner with no
 *      reopen — the create/rename/delete hooks re-inject the DOM rather than
 *      re-render — renaming it away removes the line, renaming it back
 *      restores it, deleting it removes it; the role banner stays single
 *      throughout. Control: two world tables of a name nothing reads warn
 *      nothing.
 *   6. Alice, Observer on the Market fixture, opens it in view mode and sees no
 *      banner — every sentence is a Warden instruction.
 *   7. Both interface schemes through `game.configureUI` (never a body class):
 *      the ink and the wash both change with the scheme and the wash is never
 *      transparent. `--shots` writes tools/dev/out/table-banner-{edit,view}-
 *      {light,dark}.png.
 *
 * Fixtures are planted by NAME (the identity rule) and flagged
 * `air-bladder.probeTableBanner`; the flag is swept before the first write and
 * again in the finally, and everything else is selected by id difference. The
 * sheet mode is STICKY session-wide (roll-table-sheet.mjs #DEFAULT_MODE), so it
 * is put back to view before the browser closes. Exits non-zero on any failed
 * assertion or console error.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog, withHookOff } from "./lib.mjs";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const WANT_SHOTS = process.argv.includes("--shots");
if (WANT_SHOTS) fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
watchdog(600000, "dev:table-banner", () => browser.close());
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);

let failed = false;
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? `  ${d}` : ""}`);
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? `  ${d}` : ""}`); failed = true; };
const check = (cond, m, d = "") => (cond ? ok(m, d) : fail(m, d));
const NS = "air-bladder";
const FLAG = "probeTableBanner";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OBSERVER = 2;

/* ------------------------------------------------------------------ helpers */

const sweep = () => page.evaluate(async ({ NS, FLAG }) => {
  const ids = game.tables.filter((t) => t.getFlag(NS, FLAG)).map((t) => t.id);
  if (ids.length) await RollTable.implementation.deleteDocuments(ids);
  return ids.length;
}, { NS, FLAG });

/** Plant a world table by NAME; `rows` are create-data results. */
const plant = (name, rows, extra = {}) => page.evaluate(async ({ NS, FLAG, name, rows, extra }) => {
  const t = await RollTable.implementation.create({ name, results: rows, flags: { [NS]: { [FLAG]: true } }, ...extra });
  return t.uuid;
}, { NS, FLAG, name, rows, extra });

/** Open a table's sheet in `mode` (a locked pack forces view whatever is asked)
 *  and read the banner off the rendered DOM. */
const bannerOf = (pg, uuid, mode = null, { keepOpen = false } = {}) => pg.evaluate(async ({ uuid, mode, keepOpen }) => {
  const table = await fromUuid(uuid);
  const sheet = table.sheet;
  if (mode && sheet.isEditable) sheet.mode = mode;
  await sheet.render(true);
  for (let i = 0; i < 40 && !sheet.element?.querySelector("table[data-results]"); i++) await new Promise((r) => setTimeout(r, 150));
  const root = sheet.element;
  const all = root?.querySelectorAll(".ab-table-role") ?? [];
  const p = all[0] ?? null;
  const tbl = root?.querySelector("table[data-results]");
  const glyph = p ? getComputedStyle(p.querySelector("i"), "::before").content.replace(/"/g, "") : "";
  const out = {
    mode: sheet.mode, editable: sheet.isEditable, hasTable: !!tbl,
    present: !!p, count: all.length,
    role: p?.dataset.role ?? null, text: p?.textContent.trim() ?? "", head: p?.querySelector("strong")?.textContent.trim() ?? null,
    parent: !p ? null : p.closest('[data-application-part="results"]') ? "results"
      : p.parentElement?.classList.contains("window-content") ? "content" : p.parentElement?.tagName,
    afterHeader: p ? !!p.previousElementSibling?.matches("header.sheet-header") : null,
    aboveTable: p && tbl ? p.getBoundingClientRect().bottom <= tbl.getBoundingClientRect().top + 1 : null,
    flexShrink: p ? getComputedStyle(p).flexShrink : null,
    glyphCode: glyph.length ? glyph.codePointAt(0) : 0,
    color: p ? getComputedStyle(p).color : null,
    background: p ? getComputedStyle(p).backgroundColor : null,
    sheetId: sheet.id,
  };
  if (!keepOpen) await sheet.close();
  return out;
}, { uuid, mode, keepOpen });

const closeSheet = (uuid) => page.evaluate(async (uuid) => { const t = await fromUuid(uuid); await t.sheet.close(); }, uuid);

/** The first `n` rows of a shipped table, by range, as create-data document rows. */
const harvest = (pack, name, n) => page.evaluate(async ({ pack, name, n }) => {
  const docs = await game.packs.get(pack).getDocuments();
  const t = docs.find((d) => d.name === name);
  return [...t.results].sort((a, b) => a.range[0] - b.range[0]).slice(0, n)
    .map((r) => ({ type: "document", documentUuid: r.documentUuid, name: r.name, img: r.img, weight: 1 }));
}, { pack, name, n });

const packUuid = (pack, name) => page.evaluate(async ({ pack, name }) => {
  const e = (await game.packs.get(pack).getIndex()).find((x) => x.name === name);
  return e ? `Compendium.${pack}.RollTable.${e._id}` : null;
}, { pack, name });

const order = (uuid) => page.evaluate(async (uuid) => {
  const t = await fromUuid(uuid);
  const rows = [...t.results].sort((a, b) => a.range[0] - b.range[0]);
  return { names: rows.map((r) => r.name), ranges: rows.map((r) => r.range.join("-")), formula: t._source.formula };
}, uuid);

/** The drop, as core's sheet makes it (roll-table-sheet.mjs _createResult). */
const drop = (uuid, row) => page.evaluate(async ({ uuid, row }) => {
  const t = await fromUuid(uuid);
  await t.createEmbeddedDocuments("TableResult", [row], { renderSheet: false });
}, { uuid, row });

const at = (r, i) => ({ ...r, range: [i, i] });
const text = (d) => ({ type: "text", description: `<p>${d}</p>`, weight: 1 });
const byName = (rows) => rows.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
const L = (key) => page.evaluate((key) => game.i18n.localize(key), key);
const setScheme = (s) => page.evaluate((s) => {
  const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
  cfg.colorScheme = { applications: s, interface: s };
  game.configureUI(cfg);
}, s);

/* --------------------------------------------------------------------- run */

let alice = null;
let before = null;
try {
  await joinAsGM(page);
  const swept = await sweep();
  if (swept) console.log(`  note  swept ${swept} leftover fixture table(s)`);
  before = await page.evaluate(() => game.tables.map((t) => t.id));
  const glogOn = await page.evaluate(() => !!game.settings.get("air-bladder", "enable-glog-magic"));
  const NORMALIZE = await L("TABLE.ACTIONS.NormalizeResults");
  const BTN = {};
  for (const k of ["Marketplace", "Spells", "Cairn2e", "Barebones"]) BTN[k] = await L(`CAIRN.TakeOver.${k}.Button`);
  const SIDEBAR = { tables: await L("SIDEBAR.TabTables"), compendium: await L("SIDEBAR.TabCompendium") };

  const gearRows = byName(await harvest("air-bladder.marketplace", "Market: Gear", 3));
  const [A, B] = gearRows;

  /* ------------------------------------------ 1. a world aisle, both modes */
  console.log("\n1. a world Market: Gear, both modes, red-first");
  const gear = await plant("Market: Gear", [at(B, 1), at(A, 2)], { formula: "1d2", ownership: { default: OBSERVER } });
  const e1 = await bannerOf(page, gear, "edit");
  check(e1.mode === "edit" && e1.present && e1.count === 1 && e1.role === "market" && e1.parent === "results" && e1.aboveTable,
    "edit mode: ONE Marketplace banner inside the results section, above the list",
    JSON.stringify({ mode: e1.mode, count: e1.count, role: e1.role, parent: e1.parent, aboveTable: e1.aboveTable }));
  check(/Gear/.test(e1.head ?? "") && /alphabetical/.test(e1.text) && /Items sidebar/.test(e1.text) && /drag/i.test(e1.text),
    "…it names the aisle, says drag from the Items sidebar, and that rows stay alphabetical", e1.head);
  check(e1.flexShrink === "0", "…and the list cannot squeeze it (flex-shrink 0)", e1.flexShrink);
  check(e1.glyphCode >= 0xe000, "…its glyph RENDERS: a private-use code point read off ::before", `U+${e1.glyphCode.toString(16)}`);
  const v1 = await bannerOf(page, gear, "view");
  check(v1.mode === "view" && v1.present && v1.count === 1 && v1.role === "market" && v1.parent === "content" && v1.afterHeader && v1.aboveTable,
    "view mode: the banner is a direct child of the window content, after the header, above the list",
    JSON.stringify({ mode: v1.mode, parent: v1.parent, afterHeader: v1.afterHeader }));
  const off = await withHookOff(page, "renderRollTableSheet", "abTableRoleBanner", () => bannerOf(page, gear, "edit"));
  check(off.hasTable && !off.present, "red-first: with abTableRoleBanner off the sheet renders and carries NO banner");
  const on = await bannerOf(page, gear, "edit");
  check(on.present, "…and with it back on, the banner is back");

  /* ----------------------------------------- 2. hand-made aisles, controls */
  console.log("\n2. hand-made aisles and the controls");
  const potions = await plant("Market: Potions", []);
  const e2 = await bannerOf(page, potions);
  check(e2.mode === "edit" && e2.present && e2.role === "market" && e2.parent === "results" && /Potions/.test(e2.head ?? ""),
    "an EMPTY hand-made Market: Potions opens in edit mode (core forces it) and names its aisle", e2.head);
  const trans = await plant("Market: Transports & Containers", [at(B, 1), at(A, 2)], { formula: "1d2" });
  const e3 = await bannerOf(page, trans, "edit");
  check(e3.present && e3.role === "transports" && /Actors sidebar/.test(e3.text) && /Transports & Containers/.test(e3.head ?? ""),
    "Market: Transports & Containers gets the actors sentence", e3.head);
  const plainGear = await plant("PROBE Gear", [at(B, 1), at(A, 2)], { formula: "1d2" });
  const notMarket = await plant("Not a Market: X", [at(B, 1), at(A, 2)], { formula: "1d2" });
  const c1 = await bannerOf(page, plainGear, "edit");
  const c2 = await bannerOf(page, notMarket, "edit");
  check(c1.hasTable && !c1.present && c2.hasTable && !c2.present,
    "controls: the same rows under PROBE Gear and Not a Market: X wear nothing — the name is the mechanism");

  /* ------------------------------------------------- 3. the pack templates */
  console.log("\n3. the shipped pack tables are templates");
  const pArmor = await bannerOf(page, await packUuid("air-bladder.marketplace", "Market: Armor"));
  check(pArmor.editable === false && pArmor.mode === "view" && pArmor.present && pArmor.role === "template"
    && pArmor.text.includes(BTN.Marketplace) && pArmor.text.includes(SIDEBAR.tables),
    "the pack Market: Armor (locked, view) names the Marketplace button and the Rollable Tables sidebar", pArmor.text.slice(-90));
  const pBonds = await bannerOf(page, await packUuid("air-bladder.tables-2e", "Bonds"));
  check(pBonds.present && pBonds.role === "template" && pBonds.text.includes(BTN.Cairn2e) && pBonds.text.includes(SIDEBAR.compendium),
    "the pack Bonds names the Backgrounds button and the Compendium sidebar", pBonds.text.slice(-90));
  const pCanon = await bannerOf(page, await packUuid("air-bladder.tables-2e", "Spells — Canon (1d100)"));
  const pGlog = await bannerOf(page, await packUuid("air-bladder.tables-glog", "Spells — GLOG"));
  check(pCanon.role === "template" && pCanon.text.includes(BTN.Spells) && pGlog.role === "template" && pGlog.text.includes(BTN.Spells),
    `both pool tables name the Spell Table button — the pool NOT in force too (hack ${glogOn ? "ON" : "OFF"})`);
  const pScars = await bannerOf(page, await packUuid("air-bladder.utils", "Scars"));
  const namesAButton = Object.values(BTN).some((b) => pScars.text.includes(b));
  check(pScars.present && pScars.role === "templateImport" && !namesAButton && /Import/.test(pScars.text),
    "utils' Scars has no button: the banner says import it and keep the name", pScars.text.slice(-80));

  /* ------------------------------------------ 4. the spell tables re-sort */
  console.log("\n4. a drop keeps the spell tables alphabetical");
  const [S1, S2, S3, S4] = byName(await harvest("air-bladder.tables-2e", "Spells — Canon (1d100)", 4));
  const canon = await plant("Spells — Canon (1d100)", [at(S3, 1), at(S1, 2), at(S2, 3)], { formula: "1d3" });
  const sBefore = await bannerOf(page, canon, "edit", { keepOpen: true });
  check(sBefore.present && sBefore.role === "spells" && /alphabetical/.test(sBefore.text) && /spellbook/.test(sBefore.text),
    "the world spell table wears the spells banner (drag a spellbook, rows stay alphabetical)", sBefore.head);
  await drop(canon, at(S4, 4));
  const want = [S1, S2, S3, S4].map((r) => r.name).join();
  let o = null;
  for (let i = 0; i < 40; i++) { o = await order(canon); if (o.names.join() === want && o.formula === "1d4") break; await wait(100); }
  check(o.names.join() === want && o.formula === "1d4" && o.ranges.join() === "1-1,2-2,3-3,4-4",
    "a dropped spellbook re-sorts the whole table by name: ranges 1..4, stored formula 1d4", JSON.stringify(o));
  const sAfter = await page.evaluate(async (uuid) => {
    const t = await fromUuid(uuid);
    const root = t.sheet.element;
    const out = { count: root?.querySelectorAll(".ab-table-role").length ?? 0, rows: root?.querySelectorAll("tr[data-result-id]").length ?? 0 };
    await t.sheet.close();
    return out;
  }, canon);
  check(sAfter.count === 1 && sAfter.rows === 4, "…and the OPEN sheet, re-rendered by the drop, shows one banner over four rows", JSON.stringify(sAfter));
  const plainSp = await plant("PROBE Spells", [at(S3, 1), at(S1, 2), at(S2, 3)], { formula: "1d3" });
  await drop(plainSp, at(S4, 4));
  await wait(500);
  const oc = await order(plainSp);
  check(oc.names.join() === [S3, S1, S2, S4].map((r) => r.name).join() && oc.formula === "1d3",
    "CONTROL: the same rows under PROBE Spells keep the dropped row last, formula untouched", JSON.stringify(oc));
  const [G1, G2, G3] = byName(await harvest("air-bladder.tables-glog", "Spells — GLOG", 3));
  const glog = await plant("Spells — GLOG", [at(G2, 1), at(G1, 2)], { formula: "1d2" });
  await drop(glog, at(G3, 3));
  const wantG = [G1, G2, G3].map((r) => r.name).join();
  let og = null;
  for (let i = 0; i < 40; i++) { og = await order(glog); if (og.names.join() === wantG && og.formula === "1d3") break; await wait(100); }
  check(og.names.join() === wantG && og.formula === "1d3", `the GLOG pool table sorts too (hack ${glogOn ? "ON" : "OFF"})`, JSON.stringify(og));
  const rowsOf = (uuid) => page.evaluate(async (uuid) => {
    const t = await fromUuid(uuid);
    const rows = [...t.results].sort((a, b) => a.range[0] - b.range[0]);
    return { texts: rows.map((r) => r.description.replace(/<[^>]+>/g, "")), ranges: rows.map((r) => r.range.join("-")), formula: t._source.formula, ids: rows.map((r) => r.id) };
  }, uuid);
  const untilRows = async (uuid, pred) => { let d = null; for (let i = 0; i < 40; i++) { d = await rowsOf(uuid); if (pred(d)) break; await wait(100); } return d; };
  const bonds = await plant("Bonds", [at(text("b"), 1), at(text("a"), 2)], { formula: "1d2" });
  await drop(bonds, at(text("c"), 3));
  const ob = await untilRows(bonds, (d) => d.formula === "1d3");
  check(ob.texts.join() === "b,a,c" && ob.formula === "1d3" && ob.ranges.join() === "1-1,2-2,3-3",
    "CONTROL: a drop onto the world Bonds re-sorts nothing — the 2e tables keep the book's order — but the die follows it (1d3)", JSON.stringify(ob));

  /* ------------------------------ 4b. the formula follows the rows */
  console.log("\n4b. the formula follows the rows on every other read table, flat dice only");
  const NEW_ROW = await L("CAIRN.TableRole.NewRow");
  const removeRow = (uuid, id) => page.evaluate(async ({ uuid, id }) => { const t = await fromUuid(uuid); await t.deleteEmbeddedDocuments("TableResult", [id]); }, { uuid, id });
  await removeRow(bonds, ob.ids[2]);
  const ob2 = await untilRows(bonds, (d) => d.formula === "1d2");
  check(ob2.texts.join() === "b,a" && ob2.formula === "1d2", "deleting the last row shrinks the die back: b,a under 1d2", JSON.stringify(ob2));
  const obOff = await withHookOff(page, "createTableResult", "onReadTableRowsChanged", async () => {
    await drop(bonds, at(text("c"), 3));
    await wait(600);
    return rowsOf(bonds);
  });
  check(obOff.texts.join() === "b,a,c" && obOff.formula === "1d2",
    "red-first: with onReadTableRowsChanged off, the dropped third row sits at 3 under 1d2 — unrollable, core's own behaviour", JSON.stringify(obOff));
  await drop(bonds, at(text("d"), 4));
  const ob4 = await untilRows(bonds, (d) => d.formula === "1d4");
  check(ob4.texts.join() === "b,a,c,d" && ob4.formula === "1d4", "…with it back on, a fourth row takes the die to 1d4, order untouched", JSON.stringify(ob4));
  await removeRow(bonds, ob4.ids[3]);
  await removeRow(bonds, ob4.ids[2]);
  const ob5 = await untilRows(bonds, (d) => d.formula === "1d2" && d.texts.length === 2);
  check(ob5.texts.join() === "b,a" && ob5.formula === "1d2", "…and deleting both takes it back to 1d2", JSON.stringify(ob5));
  const unread = await plant("PROBE unread", [at(text("b"), 1), at(text("a"), 2)], { formula: "1d2" });
  await drop(unread, at(text("c"), 3));
  await wait(600);
  const ou = await rowsOf(unread);
  check(ou.texts.join() === "b,a,c" && ou.formula === "1d2", "CONTROL: a table of a name nothing reads keeps 1d2 over three rows — the name is the mechanism", JSON.stringify(ou));
  // A bell curve is the Warden's: the SRD's own 2d6 reactions table, rows 2..12.
  const curveRows = Array.from({ length: 11 }, (_, i) => at(text(`r${i + 2}`), i + 2));
  const reactions = await plant("Warden: NPC - Reactions", curveRows, { formula: "2d6" });
  const rReact = await bannerOf(page, reactions, "edit");
  check(rReact.role === "generic" && /2d6/.test(rReact.text) && /Summary tab/.test(rReact.text) && !rReact.text.includes(NEW_ROW),
    "a world Warden: NPC - Reactions under 2d6 wears the generic banner whose tail names 2d6 and the Summary tab", rReact.text.slice(-110));
  await drop(reactions, at(text("r13"), 13));
  await wait(600);
  const orc = await rowsOf(reactions);
  check(orc.formula === "2d6" && orc.texts.length === 12, "…and a dropped row leaves 2d6 alone: a curve is never flattened", JSON.stringify({ formula: orc.formula, rows: orc.texts.length }));
  // A DRAG-BUILT read table stores NO formula (review #30's shape): its first
  // added row must write one, or the first roll() normalizes and saves.
  const omens = await plant("Omens", [at(text("b"), 1), at(text("a"), 2)]);
  const oo0 = await rowsOf(omens);
  await drop(omens, at(text("c"), 3));
  const oo = await untilRows(omens, (d) => d.formula === "1d3");
  // The stored formula of a table created without one is UNDEFINED, not "":
  // the schema's StringField is not required, so nothing fills it.
  check(!oo0.formula && oo.formula === "1d3" && oo.texts.join() === "b,a,c",
    "a drag-built world Omens (no stored formula) gets 1d3 WRITTEN on its first added row", JSON.stringify({ before: oo0.formula ?? null, after: oo.formula }));

  /* ------------------------------------------------- 5. the other roles */
  console.log("\n5. the other roles, by name");
  const roleOf = async (name, extra = { formula: "1d1" }) => {
    const u = await plant(name, [at(text("x"), 1)], extra);
    const b = await bannerOf(page, u, "edit");
    return { role: b.role, text: b.text, present: b.present, hasTable: b.hasTable };
  };
  const rBonds = await bannerOf(page, bonds, "edit");
  check(rBonds.role === "cairn2e" && rBonds.text.includes(NEW_ROW) && !rBonds.text.includes(NORMALIZE),
    "Bonds → the Cairn 2e banner, ending 'a new row … is rolled with the rest' and naming no scales button", NEW_ROW);
  const rWeapon = await roleOf("Barebones: Creation - Weapon");
  check(rWeapon.role === "barebones" && rWeapon.text.includes(NEW_ROW) && /drag an item/i.test(rWeapon.text), "Barebones: Creation - Weapon → the Barebones banner", rWeapon.role);
  const rQuirk = await roleOf("Warden: NPC - Quirk");
  check(rQuirk.role === "generic" && rQuirk.text.includes(NEW_ROW), "Warden: NPC - Quirk → the generic banner", rQuirk.role);
  const rScars = await roleOf("Scars");
  check(rScars.role === "cairn2e", "Scars, shipped in two packs, takes the button's kind and never the generic", rScars.role);
  const rMishaps = await roleOf("GLOG Magic: Mishaps", { formula: "2d12" });
  check(rMishaps.role === "generic" && /2d12/.test(rMishaps.text) && /Summary tab/.test(rMishaps.text),
    "GLOG Magic: Mishaps → generic, its 2d12 lookup named in the tail", rMishaps.role);
  const rNothing = await roleOf("PROBE nothing");
  check(rNothing.hasTable && !rNothing.present, "PROBE nothing → no banner");

  /* ------------------------------------------- 5b. two tables of one name */
  console.log("\n5b. two world tables of one name");
  const dupCheck = (uuid) => page.evaluate(async (uuid) => {
    const t = await fromUuid(uuid);
    const root = t.sheet.element;
    const w = root?.querySelector(".ab-table-duplicate");
    const glyph = w ? getComputedStyle(w.querySelector("i"), "::before").content.replace(/"/g, "") : "";
    return { roles: root?.querySelectorAll(".ab-table-role").length ?? 0, warned: !!w, text: w?.textContent.trim() ?? "", glyphCode: glyph.length ? glyph.codePointAt(0) : 0 };
  }, uuid);
  const rename = (uuid, name) => page.evaluate(async ({ uuid, name }) => { const t = await fromUuid(uuid); await t.update({ name }); }, { uuid, name });
  const until = async (uuid, pred) => { let d = null; for (let i = 0; i < 40; i++) { d = await dupCheck(uuid); if (pred(d)) break; await wait(100); } return d; };
  // A probe-only AISLE name, never `Market: Gear`: the dev world legitimately
  // holds the Warden's own copies under the shipped names, and a fixture that
  // shares one is a duplicate from the moment it is planted — which is exactly
  // what this leg measures, so the name must be one nothing else here carries.
  const AISLE = "Market: PROBE Aisle";
  const aisle = await plant(AISLE, [at(A, 1)], { formula: "1d1" });
  const sameName = await page.evaluate((n) => game.tables.filter((t) => t.name === n).length, AISLE);
  check(sameName === 1, `precondition: exactly one world table named ${AISLE}`, String(sameName));
  const alone = await bannerOf(page, aisle, "edit", { keepOpen: true });
  const d0 = await dupCheck(aisle);
  check(alone.present && alone.role === "market" && !d0.warned, "alone under its name, the aisle carries its banner and no duplicate line");
  const aisle2 = await plant(AISLE, [at(A, 1)], { formula: "1d1" });
  const d1 = await until(aisle, (d) => d.warned);
  check(d1.warned && d1.roles === 1 && /another table/i.test(d1.text) && /rename or delete/i.test(d1.text),
    "a second world table of that name is created → the OPEN sheet gains the line without a reopen, and keeps ONE role banner", d1.text.slice(0, 60));
  check(d1.glyphCode >= 0xe000, "…its glyph renders", `U+${d1.glyphCode.toString(16)}`);
  await rename(aisle2, "PROBE renamed");
  const d2 = await until(aisle, (d) => !d.warned);
  check(!d2.warned && d2.roles === 1, "…renamed away, the line goes and the role banner stays");
  await rename(aisle2, AISLE);
  const d3 = await until(aisle, (d) => d.warned);
  check(d3.warned, "…renamed back, it returns");
  await page.evaluate(async (uuid) => { const t = await fromUuid(uuid); await t.delete(); }, aisle2);
  const d4 = await until(aisle, (d) => !d.warned);
  check(!d4.warned, "…deleted, it goes");
  await closeSheet(aisle);
  const twin = await plant("PROBE twins", [at(A, 1)], { formula: "1d1" });
  await plant("PROBE twins", [at(A, 1)], { formula: "1d1" });
  const tw = await bannerOf(page, twin, "edit", { keepOpen: true });
  const twd = await dupCheck(twin);
  await closeSheet(twin);
  check(tw.hasTable && !tw.present && !twd.warned, "CONTROL: two world tables of a name Air Bladder does not read warn nothing");

  /* ------------------------------------------------------------ 6. Alice */
  console.log("\n6. Alice sees none");
  alice = await browser.newContext({ viewport: VIEWPORT });
  const alicePage = await alice.newPage();
  const aliceErrors = watchErrors(alicePage);
  await joinAs(alicePage, "Alice");
  const a = await bannerOf(alicePage, gear, "edit");
  check(a.hasTable && a.mode === "view" && !a.editable && !a.present,
    "Alice (Observer) opens Market: Gear in view mode and sees no banner", JSON.stringify({ mode: a.mode, present: a.present }));
  if (aliceErrors.length) { fail(`Alice's client logged ${aliceErrors.length} console error(s)`); for (const e of aliceErrors) console.error(`        ${e}`); }
  await alice.close();
  alice = null;

  /* ------------------------------------------------------ 7. both schemes */
  console.log("\n7. both interface schemes");
  const shots = {};
  for (const scheme of ["light", "dark"]) {
    await setScheme(scheme);
    await wait(300);
    for (const mode of ["edit", "view"]) {
      const b = await bannerOf(page, gear, mode, { keepOpen: true });
      shots[`${mode}-${scheme}`] = b;
      if (WANT_SHOTS) await page.locator(`[id="${b.sheetId}"]`).screenshot({ path: path.join(outDir, `table-banner-${mode}-${scheme}.png`) });
      await closeSheet(gear);
    }
  }
  await page.evaluate(() => game.configureUI(game.settings.get("core", "uiConfig")));
  const l = shots["edit-light"];
  const d = shots["edit-dark"];
  check(l.present && d.present && l.color !== d.color && l.background !== d.background,
    "the banner's ink and wash both change with the scheme", `${l.color} on ${l.background} / ${d.color} on ${d.background}`);
  check(![l, d, shots["view-light"], shots["view-dark"]].some((s) => /rgba\(0, 0, 0, 0\)|transparent/.test(s.background ?? "")),
    "…and the wash is never transparent, in either mode");
  if (WANT_SHOTS) console.log(`  note  screenshots in ${outDir}`);
} catch (e) {
  fail(`probe threw: ${e.stack ?? e}`);
} finally {
  try {
    await page.evaluate(async () => {
      game.configureUI(game.settings.get("core", "uiConfig"));
      // The sticky default mode, back to view through a sheet nothing else
      // will miss: the setter writes the class-wide default.
      const pack = game.packs.get("air-bladder.tables-2e");
      const first = (await pack.getIndex()).contents[0];
      if (first) (await pack.getDocument(first._id)).sheet.mode = "view";
    });
    const n = await page.evaluate(async ({ before, NS, FLAG }) => {
      const was = before ? new Set(before) : null;
      const ids = game.tables.filter((t) => t.getFlag(NS, FLAG) || (was && !was.has(t.id))).map((t) => t.id);
      for (const id of ids) await game.tables.get(id)?.sheet?.close();
      if (ids.length) await RollTable.implementation.deleteDocuments(ids);
      return ids.length;
    }, { before, NS, FLAG });
    console.log(`\n  note  cleanup: removed ${n} planted table(s)`);
  } catch (e) {
    fail(`cleanup threw: ${e.message}`);
  }
  try { await alice?.close(); } catch { /* gone */ }
  await browser.close();
}

if (errors.length) {
  console.error(`\n  FAIL  ${errors.length} console error(s):`);
  for (const e of errors) console.error(`        ${e}`);
  failed = true;
}
console.log(failed ? "\ndev:table-banner FAILED" : "\ndev:table-banner passed");
process.exit(failed ? 1 : 0);

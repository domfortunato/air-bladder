#!/usr/bin/env node
/**
 * The random-spell pool: a DECLARED RollTable, world-first, the shipped table
 * as its fallback (user ruling 2026-09-14, "exactly the same way as
 * marketplace, bonds, omens").
 *
 *   npm run dev:spell-pool     (needs Foundry running, world launched)
 *
 * History worth one paragraph, because the legs are shaped by it. From
 * 2026-08-05 a random spellbook was an index scan over spellbook ITEMS
 * (canon-only, index-first — never a full pack load), so the 2026-09-13
 * conversion that made every DECLARED table read world-first never saw it.
 * A first fix (2026-09-14, morning) put a world table in front of the scan and
 * kept the scan as the fallback, arguing a shipped table is a snapshot that
 * goes stale; the user threw that out the same day as a second rule for one
 * table. Now `randomSpellbookDoc` resolves `CONFIG.Cairn.characterGenerator2e
 * .spells.{canon,glog}` through `findDeclaredTable` like Bonds, rolls it with
 * `roll()`, and type-filters the row's document.
 *
 * Legs:
 *   1. THE SHIPPED TABLES. Both declarations resolve to a PACK table; every row
 *      is a document row resolving to a `spellbook` Item named as the row; the
 *      row count equals the spellbook count of the pack(s) the table snapshots;
 *      the stored formula is 1dN. Row uuids embed the pack names, so this is
 *      the leg that catches a pack rename before a user does. Control: a
 *      deliberately broken uuid reads unresolved (fromUuid CAN fail).
 *   2. WORK DONE. Zero unfiltered getDocuments() calls across 10 item draws and
 *      a 200-draw sweep. The table path costs getIndex + getDocument(id) for the
 *      table and one fromUuid → getDocument(id) per row, all id-filtered;
 *      getDocument(id)'s cache-miss path is getDocuments({_id}) and is the
 *      intended cost. Control: a probe-local load-everything shape trips the
 *      same counter.
 *   3. THE POOLS. GLOG shadowed OFF: 200 draws all from the canon pack (a spell
 *      pack outside canon asserted non-empty out loud, or "only canon came out"
 *      is vacuous). Shadowed ON: twelve draws, none canon.
 *   4. WORLD-FIRST, both modes. A planted world table with the declared name —
 *      a text row, a row pointing at a Dagger, one spellbook — captures every
 *      draw and the scroll path; deleted, the pack answers again. Control: the
 *      same rows under a different NAME are ignored.
 *   5. THE FALLBACK IS A TABLE, NOT A SCAN. With the tables pack blinded
 *      in-page (game.packs.get shadowed for that one collection) the pool
 *      deals NOTHING — the retired scan would have dealt a spell — and deals
 *      again once unblinded.
 *   6. TWO NAMESPACES for a by-NAME grant (2026-09-14, the day More Spellbooks
 *      left the repo and Shield moved to background-items beside armor's own
 *      Shield): "Spellbook (Shield)" resolves to the SPELLBOOK in both hack
 *      states, and a plain "Shield" grant to the ARMOR — never to each other,
 *      whatever the pack order. Control: the two names differ only by the
 *      grant shape, so a resolver that ignored type would answer one of them
 *      wrong.
 *
 * Every settings shadow forwards `...rest` and passes a `{document: true}`
 * request straight to ClientSettings.prototype.get (review #27; check:probes
 * gates it). Nothing here is a real write except the planted tables, deleted
 * in a finally and selected by the ids the plant returned.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(180000, "spell-pool probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? `  ${d}` : ""}`); failed = true; };
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? `  ${d}` : ""}`);
const check = (cond, m, d = "") => (cond ? ok(m, d) : fail(m, d));

const CANON = "air-bladder.spellbooks";
const GLOG_PACKS = ["air-bladder.spellbooks-glog"];

try {
  await joinAsGM(page);

  /* --- 1. the shipped tables ---------------------------------------------- */
  console.log("\n1. the shipped tables");
  const shipped = await page.evaluate(async ({ CANON, GLOG_PACKS }) => {
    const cpd = await import("/systems/air-bladder/module/compendium.js");
    const decls = CONFIG.Cairn.characterGenerator2e.spells;
    const out = {};
    for (const [mode, packs] of [["canon", [CANON]], ["glog", GLOG_PACKS]]) {
      const table = await cpd.findDeclaredTable(decls[mode]);
      if (!table) { out[mode] = { resolved: false, decl: decls[mode] }; continue; }
      const rows = [...table.results].sort((a, b) => a.range[0] - b.range[0]);
      let spellbooks = 0, named = 0, ranged = 0, inPools = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const doc = r.type === CONST.TABLE_RESULT_TYPES.DOCUMENT ? await fromUuid(r.documentUuid).catch(() => null) : null;
        if (doc?.documentName === "Item" && doc.type === "spellbook") spellbooks++;
        if (doc && doc.name === r.name) named++;
        if (r.range[0] === i + 1 && r.range[1] === i + 1) ranged++;
        if (packs.some((p) => String(r.documentUuid).startsWith(`Compendium.${p}.`))) inPools++;
      }
      let expected = 0;
      for (const p of packs) expected += (await game.packs.get(p).getIndex()).filter((e) => e.type === "spellbook").length;
      out[mode] = {
        resolved: true, decl: decls[mode], inPack: !!table.pack, name: table.name,
        rows: rows.length, spellbooks, named, ranged, inPools, expected, formula: table._source.formula,
        description: table.description ?? "",
      };
    }
    // Control: fromUuid CAN fail, so "every row resolves" is a claim.
    out.brokenResolves = !!(await fromUuid(`Compendium.${CANON}.Item.0000000000000000`).catch(() => null));
    return out;
  }, { CANON, GLOG_PACKS });
  for (const mode of ["canon", "glog"]) {
    const s = shipped[mode];
    check(s.resolved && s.inPack, `${mode}: the declaration resolves to the shipped PACK table`, `${s.decl} → ${s.name ?? "nothing"}`);
    check(s.resolved && s.rows === s.expected && s.rows > 0,
      `…${mode}: one row per spellbook in the pack(s) it snapshots`, `${s.rows} rows, ${s.expected} spellbooks`);
    check(s.resolved && s.spellbooks === s.rows && s.named === s.rows && s.inPools === s.rows,
      `…${mode}: every row resolves into those packs to a spellbook named as the row`, `${s.spellbooks}/${s.named}/${s.inPools} of ${s.rows}`);
    check(s.resolved && s.ranged === s.rows && s.formula === `1d${s.rows}`, `…${mode}: ranged 1..N with the stored formula 1dN`, s.formula);
    // A world COPY inherits the description verbatim (take-over.js), so a
    // sentence naming the button would tell the Warden to press what they just
    // pressed; the pack table's sheet says it instead (table-banner.js).
    check(s.resolved && !/make it yours|Create a Custom/i.test(s.description),
      `…${mode}: its description names no button`, s.description.slice(-60));
  }
  check(shipped.brokenResolves === false, "control: a broken uuid reads unresolved — fromUuid can fail, so the rows above are a claim");

  /* --- 2 + 3. work done, and the pools ----------------------------------- */
  console.log("\n2. work done, and 3. the pools");
  const r = await page.evaluate(async ({ CANON, GLOG_PACKS }) => {
    const out = {};
    const CG = game.cairn.characterGenerator;

    // Warm the document cache with ONE bulk load per pool pack, OUTSIDE the
    // counter installed below: a cache-missing draw pays a single-document
    // server query (~1s each against a long-lived server), and the 200-draw
    // leg's runtime scaled with that until it timed out on 2026-08-05. The
    // claims are about the DRAW's work, not the cache state.
    for (const key of [CANON, ...GLOG_PACKS]) await game.packs.get(key)?.getDocuments();

    // Count FULL pack loads while drawing. Two reads are deliberately NOT
    // counted: getIndex() (cheap, live, intended), and the id-filtered form —
    // CompendiumCollection#getDocument's cache-miss path is
    // `getDocuments({_id: id})` (compendium-collection.mjs:379), one document,
    // the intended cost of a draw.
    const proto = foundry.documents.collections.CompendiumCollection.prototype;
    const origGetDocs = proto.getDocuments;
    let fullLoads = 0;
    proto.getDocuments = function (query = {}, ...rest) {
      if (!("_id" in query) && !("_id__in" in query)) fullLoads++;
      return origGetDocs.call(this, query, ...rest);
    };

    // The dev world plays in GLOG mode; pin the hack with a read-shadow, never
    // a world write. A DOCUMENT request is never shadowed (review #27): core's
    // #setWorld asks get(ns, key, {document: true}) for the Setting document it
    // updates by id, and any value handed back makes it CREATE a duplicate.
    const origGet = game.settings.get;
    const shadowGlog = (on) => {
      game.settings.get = function (scope, key, ...rest) {
        if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
        if (scope === game.system.id && key === "enable-glog-magic") return on;
        return origGet.call(this, scope, key, ...rest);
      };
    };

    try {
      shadowGlog(false);
      const drawn = [];
      for (let i = 0; i < 5; i++) {
        const book = await CG.randomSpellbookItem();
        const scroll = await CG.randomScrollItem();
        if (book) drawn.push(book);
        if (scroll) drawn.push(scroll);
      }
      out.drawCount = drawn.length;
      out.fullLoads = fullLoads;
      out.scrollShapes = drawn.filter((d) => d.system?.scroll).every(
        (d) => d.system.weightless === true && d.system.uses?.max === 1
      );

      const canonIds = new Set(game.packs.get(CANON).index.map((e) => e._id));
      // Non-vacuousness: "only canon came out" means nothing unless a spell
      // pack OUTSIDE canon exists to come out of. The GLOG pack is that pack
      // (More Spellbooks was, until it left the repo on 2026-09-14).
      out.outsidePackSize = game.packs.get(GLOG_PACKS[0])?.index.size ?? 0;
      fullLoads = 0;
      let inCanon = 0; const outside = [];
      for (let i = 0; i < 200; i++) {
        const doc = await CG.randomSpellbookDoc();
        if (!doc) continue;
        if (canonIds.has(doc.id)) inCanon++;
        else outside.push(doc.name);
      }
      out.canonDraws = inCanon;
      out.outsideDraws = [...new Set(outside)].slice(0, 5);
      out.fullLoads200 = fullLoads;

      shadowGlog(true);
      let glogCanon = 0; const glogPacks = new Set();
      for (let i = 0; i < 12; i++) {
        const doc = await CG.randomSpellbookDoc();
        if (!doc) continue;
        if (canonIds.has(doc.id) && doc.pack === CANON) glogCanon++;
        glogPacks.add(doc.pack);
      }
      out.glogCanon = glogCanon;
      out.glogPacks = [...glogPacks];

      // NEGATIVE CONTROL, probe-local: the retired load-everything shape must
      // trip the counter the legs above read.
      fullLoads = 0;
      const books = [];
      for (const key of [CANON, ...GLOG_PACKS]) books.push(...(await game.packs.get(key).getDocuments()));
      out.controlLoads = fullLoads;
      out.controlDrew = !!books[Math.floor(Math.random() * books.length)];
    } finally {
      proto.getDocuments = origGetDocs;
      game.settings.get = origGet;
    }
    return out;
  }, { CANON, GLOG_PACKS });

  check(r.drawCount === 10, "10 draws resolved (5 spellbooks + 5 scrolls)", `${r.drawCount}/10`);
  check(r.fullLoads === 0, "zero full pack loads across 10 draws — the table path is id-filtered throughout", `${r.fullLoads}`);
  check(r.scrollShapes, "every scroll draw came out petty and single-use (the spellScrollItem shape)");
  check(r.outsidePackSize > 0, `precondition: a spell pack outside canon holds ${r.outsidePackSize} docs, so canon-only is a real claim`);
  check(r.canonDraws === 200, "GLOG off: 200/200 draws resolved inside the canon pack", r.canonDraws === 200 ? "" : `${r.canonDraws}/200; escaped: ${JSON.stringify(r.outsideDraws)}`);
  check(r.fullLoads200 === 0, "zero full pack loads across the 200 draws", `${r.fullLoads200}`);
  check(r.glogCanon === 0 && r.glogPacks.length > 0 && r.glogPacks.every((p) => GLOG_PACKS.includes(p)),
    "GLOG on: twelve draws, none canon, all from the GLOG pool packs", JSON.stringify(r.glogPacks));
  check(r.controlLoads >= 1 && r.controlDrew,
    `NEGATIVE CONTROL: the retired load-everything shape trips the counter (${r.controlLoads} loads) — the zero assertions above can fail`);

  /* --- 4. a WORLD spell table is the pool --------------------------------- */
  console.log("\n4. world-first, both modes");
  const wf = await page.evaluate(async ({ CANON }) => {
    const CG = await import("/systems/air-bladder/module/character-generator.js");
    const cpd = await import("/systems/air-bladder/module/compendium.js");
    const GLOG_POOL = "air-bladder.spellbooks-glog";
    const decls = CONFIG.Cairn.characterGenerator2e.spells;
    const out = { pre: {} };
    const origGet = game.settings.get;
    const shadowGlog = (on) => {
      game.settings.get = function (scope, key, ...rest) {
        if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
        if (scope === game.system.id && key === "enable-glog-magic") return on;
        return origGet.call(this, scope, key, ...rest);
      };
    };
    const planted = [];
    const drawMany = async (n = 12) => {
      const seen = [];
      for (let i = 0; i < n; i++) seen.push((await CG.randomSpellbookDoc())?.name);
      return seen;
    };
    try {
      for (const [mode, glog, pool] of [["canon", false, CANON], ["glog", true, GLOG_POOL]]) {
        shadowGlog(glog);
        const name = cpd.compendiumInfoFromString(decls[mode])[1];
        // Never plant over a table the world already holds.
        out.pre[mode] = !game.tables.some((t) => t.name === name);
        const one = (await game.packs.get(pool).getIndex()).find((e) => e.type === "spellbook");
        const dagger = (await game.packs.get("air-bladder.weapons").getIndex()).find((e) => e.name === "Dagger");
        const before = await drawMany();
        // Two decoy rows, so the type filter is exercised rather than assumed:
        // a text row and a row pointing at a weapon must both be re-rolled.
        const table = await RollTable.create({
          name, formula: "1d3",
          results: [
            { type: CONST.TABLE_RESULT_TYPES.TEXT, description: "not a spell", range: [1, 1], weight: 1 },
            { type: CONST.TABLE_RESULT_TYPES.DOCUMENT, name: "Dagger", documentUuid: `Compendium.air-bladder.weapons.Item.${dagger._id}`, range: [2, 2], weight: 1 },
            { type: CONST.TABLE_RESULT_TYPES.DOCUMENT, name: one.name, documentUuid: `Compendium.${pool}.Item.${one._id}`, range: [3, 3], weight: 1 },
          ],
        });
        planted.push(table.id);
        const resolved = await cpd.findDeclaredTable(decls[mode]);
        const during = await drawMany();
        const scroll = await CG.randomScrollItem();
        await table.delete();
        planted.pop();
        const after = await drawMany();
        out[mode] = {
          name, spell: one.name, before: [...new Set(before)], during: [...new Set(during)],
          scroll: scroll?.name ?? null, after: [...new Set(after)],
          resolvedToWorld: !!resolved && !resolved.pack && resolved.id === table.id,
        };
      }

      // THE NAME IS THE MECHANISM: the same rows under another name are ignored.
      shadowGlog(false);
      const one = (await game.packs.get(CANON).getIndex()).find((e) => e.type === "spellbook");
      const decoy = await RollTable.create({
        name: "zz-probe Not The Spell Table", formula: "1d1",
        results: [{ type: CONST.TABLE_RESULT_TYPES.DOCUMENT, name: one.name, documentUuid: `Compendium.${CANON}.Item.${one._id}`, range: [1, 1], weight: 1 }],
      });
      planted.push(decoy.id);
      out.wrongName = { spell: one.name, draws: [...new Set(await drawMany())] };
      await decoy.delete();
      planted.pop();
    } finally {
      game.settings.get = origGet;
      for (const id of planted) await game.tables.get(id)?.delete();
    }
    return out;
  }, { CANON });

  for (const mode of ["canon", "glog"]) {
    const m = wf[mode];
    check(wf.pre[mode], `precondition: no world "${m.name}" before planting — the transition below is real`);
    check(m.resolvedToWorld, `${mode}: the declaration resolves to the planted WORLD table`);
    check(m.during.length === 1 && m.during[0] === m.spell,
      `${mode}: a world spell table IS the pool — 12 draws, all "${m.spell}", decoy rows re-rolled`, JSON.stringify(m.during));
    check(m.scroll === m.spell, `…${mode}: the scroll path reads the same table`, `${m.scroll}`);
    check(m.before.length > 1 && m.after.length > 1,
      `…${mode}: with no such table the shipped table answers, before and after`, `${m.before.length}/${m.after.length} distinct`);
  }
  check(wf.wrongName.draws.length > 1, "control: the same rows under another NAME are ignored — the name is the whole mechanism", `${wf.wrongName.draws.length} distinct`);

  /* --- 5. the fallback is a TABLE, not a scan ----------------------------- */
  console.log("\n5. the fallback is the shipped table, not a scan of the spell packs");
  const fb = await page.evaluate(async () => {
    const CG = await import("/systems/air-bladder/module/character-generator.js");
    const cpd = await import("/systems/air-bladder/module/compendium.js");
    const decls = CONFIG.Cairn.characterGenerator2e.spells;
    const origGet = game.settings.get;
    game.settings.get = function (scope, key, ...rest) {
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === game.system.id && key === "enable-glog-magic") return false;
      return origGet.call(this, scope, key, ...rest);
    };
    const tablesPack = cpd.compendiumInfoFromString(decls.canon)[0];
    const origPacksGet = game.packs.get;
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...a) => { warns.push(a.map(String).join(" ")); return origWarn.apply(console, a); };
    const out = { tablesPack };
    try {
      out.spellPackReachable = !!game.packs.get("air-bladder.spellbooks");
      // Blind ONLY the tables pack. The spellbook packs stay reachable, which
      // is what tells a table fallback from the retired index scan: a scan
      // would still deal a spell here.
      game.packs.get = function (key, ...rest) { return key === tablesPack ? undefined : origPacksGet.call(this, key, ...rest); };
      const blinded = [];
      for (let i = 0; i < 6; i++) blinded.push(await CG.randomSpellbookDoc());
      out.blindedDealt = blinded.filter(Boolean).length;
      out.warned = warns.some((w) => /no spell table resolves/.test(w));
      delete game.packs.get;
      if (game.packs.get !== origPacksGet) game.packs.get = origPacksGet;
      const again = [];
      for (let i = 0; i < 6; i++) again.push(await CG.randomSpellbookDoc());
      out.unblindedDealt = again.filter(Boolean).length;
    } finally {
      delete game.packs.get;
      if (game.packs.get !== origPacksGet) game.packs.get = origPacksGet;
      console.warn = origWarn;
      game.settings.get = origGet;
    }
    return out;
  });
  check(fb.spellPackReachable, "precondition: the spellbook pack itself is reachable throughout — only the TABLES pack is blinded");
  check(fb.blindedDealt === 0 && fb.warned, `with ${fb.tablesPack} unreachable the pool deals NOTHING and says so — a scan would have dealt a spell`, `${fb.blindedDealt}/6 dealt`);
  check(fb.unblindedDealt === 6, "…and deals again the moment the tables pack is back", `${fb.unblindedDealt}/6`);

  /* --- 6. two namespaces: a spell grant and a gear grant of the same name --- */
  console.log("\n6. two namespaces for a by-name grant");
  const ns = await page.evaluate(async () => {
    const gear = await import("/systems/air-bladder/module/gear.js");
    const origGet = game.settings.get;
    const shadowGlog = (on) => {
      game.settings.get = function (scope, key, ...rest) {
        if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
        if (scope === game.system.id && key === "enable-glog-magic") return on;
        return origGet.call(this, scope, key, ...rest);
      };
    };
    const shape = (it) => (it ? { type: it.type, scroll: !!it.system?.scroll, armor: it.system?.armor ?? null } : null);
    const out = {};
    try {
      // Precondition: the collision is real — a spellbook AND an armor both named Shield.
      const bg = await game.packs.get("air-bladder.background-items").getIndex();
      const armor = await game.packs.get("air-bladder.armor").getIndex();
      out.spellbookShield = bg.some((e) => e.name === "Shield" && e.type === "spellbook");
      out.armorShield = armor.some((e) => e.name === "Shield" && e.type === "armor");
      shadowGlog(false);
      out.offSpell = shape(await gear.resolveGearItem("Spellbook (Shield)"));
      out.offGear = shape(await gear.resolveGearItem("Shield"));
      shadowGlog(true);
      out.onSpell = shape(await gear.resolveGearItem("Spellbook (Shield)"));
      out.onGear = shape(await gear.resolveGearItem("Shield"));
    } finally {
      game.settings.get = origGet;
    }
    return out;
  });
  check(ns.spellbookShield && ns.armorShield, "precondition: background-items ships a Shield SPELLBOOK and armor ships a Shield — the names collide across types");
  check(ns.offSpell?.type === "spellbook" && !ns.offSpell.scroll, "GLOG off: \"Spellbook (Shield)\" resolves to the spellbook", JSON.stringify(ns.offSpell));
  check(ns.onSpell?.type === "spellbook" && ns.onSpell.scroll, "GLOG on: \"Spellbook (Shield)\" resolves to the spellbook, dealt as a scroll", JSON.stringify(ns.onSpell));
  check(ns.offGear?.type === "armor" && ns.onGear?.type === "armor", "a plain \"Shield\" grant resolves to the ARMOR in both states — never the spellbook", JSON.stringify([ns.offGear, ns.onGear]));
} catch (e) {
  fail(`${e.name}: ${e.message}`, e.stack);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nSPELL POOL PROBE FAILED\n" : "\nspell pool probe passed\n");
process.exit(failed ? 1 : 0);

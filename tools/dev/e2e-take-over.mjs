#!/usr/bin/env node
/**
 * COPY TO YOUR WORLD — the Spell Tables, the Marketplace, the Barebones creation
 * tables, and Cairn 2e's backgrounds and tables (module/take-over.js,
 * 2026-09-14, user ask: "a script that imports the marketplace tables, imports
 * the items, and repoints the tables", then round two: "one button one job, each
 * on the tab where the output lands", then round three: "rename Reseed Spell
 * Table to Copy Spell Tables to this world and have it work exactly the same way
 * as the other two buttons").
 *
 *   node tools/dev/e2e-take-over.mjs   (needs Foundry running, world launched,
 *                                      and `npm run dev:players` for Alice)
 *
 * What it holds, in order:
 *   1. The four doors, ALL on the Rollable Tables sidebar in declared order,
 *      and the Cairn 2e door ALSO at the top of the Compendium tab (both user
 *      rulings of 2026-09-15: a fourth button with the others, then "both
 *      sidebars"), docked AND popped out, each on a row of its OWN spanning
 *      the header (round one's cramped button beside the old Reseed Spell
 *      Table is what this measures), nothing clipped, glyph rendered (read
 *      from `::before`, never the class list). Red-first: `withHookOff` on
 *      each named handler → absent. Alice's directories carry none.
 *   2. The confirms: one per kind, each with its three bold headers, its counts
 *      line, NO submit button (Enter never copies) and Cancel focused. Cancel and
 *      ✕ create nothing. The spells confirm carries the GLOG paragraph for the
 *      hack state in force — a canon world is told to come back for the GLOG
 *      table if it switches the hack on; a GLOG world is NOT invited to switch
 *      it off (a one-way campaign decision).
 *   3. The plans are pure reads: the marketplace's 77 document rows, Barebones'
 *      124 rows with three pointing at the tier TABLES, the 2e eleven's 132 TEXT
 *      rows with nothing to re-point and the Spells table left out. A source pack
 *      shadowed to nothing → unresolved rows, nothing written.
 *   4. TABLES LAST. With `RollTable.createDocuments` shadowed to throw, the items
 *      and mounts land and no `Market:` table does, so the shop still reads the
 *      shipped aisles — an EMPTY world table would have deleted an aisle.
 *   5. The marketplace claim: the run through the real confirm creates the four
 *      tables under the shipped ids in the flagged folders, every row pointing at
 *      a WORLD document that resolves, `_source.formula` = 1dN, the catalog
 *      unchanged — and the ITEMS land in a subfolder per source compendium under
 *      the flagged Marketplace parent (Armor, Gear, Market Goods, Tools,
 *      Trinkets, Weapons — each named with its compendium's label), while the
 *      mounts sit directly under theirs, one source meaning no subfolder. Every
 *      folder, parent or child, carries the kind flag. The catalog is
 *      unchanged in names and order; control: the pack's own rows still point at
 *      the pack. Editing the world Dagger re-prices the shop while the pack Dagger
 *      reads 5. The RESULT window names what landed and its Open buttons go there.
 *      The copied `Market: Gear`, OPENED, wears the Marketplace banner naming
 *      its aisle (2026-09-15; `dev:table-banner` owns the banner itself).
 *   6. A second run keeps every edit: 0 copied, all kept, Dagger still 99, and the
 *      result window says nothing needed copying. Red-first on the PLAN ONLY —
 *      blinding `game.items.get`/`find` to the Dagger makes the plan say "add" —
 *      never on the run, because a blinded run is a real overwrite (v14's server
 *      refuses a duplicate id only in EMBEDDED collections).
 *   7. Alice: no buttons; her shop reads the world copies (Dagger 99, control: the
 *      pack Dagger on her own client reads 5); an ownership-NONE world mount still
 *      resolves for her — measured, not reasoned.
 *   8. A table the Warden imported BY HAND (same name, another id) is kept, never
 *      twinned, and the result window says its rows still point at the shipped
 *      items.
 *   9. An item imported earlier under a NEW id is adopted through
 *      `_stats.compendiumSource`: the new Weapons table's Dagger row points at that
 *      copy and no document is created under the shipped id.
 *  10. Cairn 2e, with the custom source OFF at entry: 27 background copies under
 *      the shipped IDS and names, no "(Copy)", source 2e; the setting switched on;
 *      the pool holds the copies and no original; a canon stand-in keeps its
 *      ARCHETYPE group (red-first: the canon index shadowed empty puts it under
 *      Custom); Alice's picker shows the same groups. AND the eleven tables: under
 *      the shipped ids in one folder, text rows verbatim, Bonds' gold/items row
 *      flags intact, the Spells table NOT copied, every declaration resolving to
 *      the world copy — control: the Spells declaration still resolves to the pack.
 *      A reworded row is what `rollTableText` returns.
 *  11. A second backgrounds run keeps a rename, even with the pack locked; red-first
 *      on the plan: the world index shadowed empty → 27 to add.
 *  12. Barebones: six tables under the shipped ids, 38 items, the Weapon table's
 *      three rows pointing at the WORLD tier tables, every row resolving. Then the
 *      reader: a row pointing at a WORLD item hands over THAT item — a generated
 *      character wears the world Gambeson's armor 3 — and the control is the same
 *      table with the row pointing at the pack, which hands over armor 1.
 *  13. The spell table (the pool in force — canon, or GLOG with the hack on, read
 *      off the live setting rather than pinned, because flipping the hack ON
 *      sweeps the world): before the copy the declaration resolves to the pack
 *      and twelve draws come from the compendium; the plan is one table and every
 *      row a spellbook; the run through the confirm lands the table under the
 *      shipped id in the flagged Custom Spells folder with every row pointing at a WORLD
 *      spellbook that resolves, the result window names Rollable Tables and Items
 *      and not Actors, the declaration resolves to the world copy and twelve draws
 *      all hand over world documents off its rows. Then the reader, both ways off
 *      ONE row: pointed at a world spellbook with a probe-edited description the
 *      draw hands over THAT document; pointed at the pack's it hands over the
 *      pack's. The copy, opened, wears the spells banner, and its description
 *      no longer names the button (2026-09-15).
 *
 * REVIEW #31 (2026-09-15) added legs where each finding lives: the Actor
 * Directory's nine creation buttons fully legible on as many rows as that
 * takes, never nine (leg 1); a double-click opens ONE confirm, and at a 650px
 * viewport the confirm scrolls so Copy is reachable, with core's own overflow
 * rule as the control (leg 2); the 2e set's Scars is UTILS' — the list the
 * damage card rolls — and a scar card rolled with the copy in the world prints
 * the SRD prose, never the sheet checklist's label (legs 3, 10); a background
 * switched off before the copy stays off after it, by ID, with the old uuid
 * test as the control, and its stand-in's eye re-enables it clearing both
 * stored uuids (leg 10); a RENAMED copy that still holds the shipped id
 * survives a re-run, which lands a fresh copy under another id, and both
 * windows name the folder by its document's name (leg 10b); a no-op
 * backgrounds run leaves `content-source-custom` alone, and a LOCKED pack with
 * a background missing is said so in the confirm, which then counts no
 * backgrounds (leg 11).
 *
 * Everything planted is selected by ID DIFFERENCE from a snapshot taken before the
 * first write and deleted in the finally; leftovers of a killed run are recognised
 * by the flagged folders (ours, one flag value per kind) and by
 * `_stats.compendiumSource` into the shipped background packs (a Duplicate copy
 * carries none), never by name — the dev world already holds shop items under
 * their shipped ids, and those are exactly the "kept" case this feature exists to
 * respect. NOTE: that entry sweep also removes copies a HUMAN made with these
 * buttons in the dev world, because a copy the button made and a copy the button
 * made are the same document. The world is left with none; press the buttons again
 * if you want them back.
 * Exits non-zero on any failed assertion or console error.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, dismissChrome, watchErrors, watchdog, withHookOff, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(900000, "dev:take-over", () => browser.close());
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log(`  note  the Warden's page navigated: ${f.url()}`); });
page.on("crash", () => console.log("  note  the Warden's page CRASHED"));

let failed = false;
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? `  ${d}` : ""}`);
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? `  ${d}` : ""}`); failed = true; };
const check = (cond, m, d = "") => (cond ? ok(m, d) : fail(m, d));
const NS = "air-bladder";
const MOD = "/systems/air-bladder/module/take-over.js";
const MKT = "/systems/air-bladder/module/marketplace.js";
const GEN = "/systems/air-bladder/module/character-generator.js";
const CPD = "/systems/air-bladder/module/compendium.js";
const WORLD_BG_PACK = "world.custom-backgrounds";
const BG_PACKS = ["air-bladder.backgrounds-2e", "air-bladder.backgrounds-custom"];
const KIND_TAB = { spells: "tables", marketplace: "tables", barebones: "tables", cairn2e: "tables" };
// As the button declares them: `pack;Name`, Scars from UTILS (review #31 — the
// list the damage card rolls; tables-2e's namesake is the sheet checklist's).
const CAIRN_2E_TABLES = [
  "air-bladder.tables-2e;Bonds", "air-bladder.tables-2e;Omens", "air-bladder.utils;Scars",
  "air-bladder.tables-2e;Physique", "air-bladder.tables-2e;Skin", "air-bladder.tables-2e;Hair", "air-bladder.tables-2e;Face",
  "air-bladder.tables-2e;Speech", "air-bladder.tables-2e;Clothing", "air-bladder.tables-2e;Vice", "air-bladder.tables-2e;Virtue",
];
const CAIRN_2E_NAMES = CAIRN_2E_TABLES.map((d) => d.split(";")[1]);
const DMG = "/systems/air-bladder/module/damage.js";

/* ------------------------------------------------------------------ helpers */

const snapshot = () => page.evaluate(async (WORLD_BG_PACK) => {
  const pack = game.packs.get(WORLD_BG_PACK);
  return {
    items: game.items.map((d) => d.id), actors: game.actors.map((d) => d.id),
    tables: game.tables.map((d) => d.id), folders: game.folders.map((d) => d.id),
    characters: game.actors.map((d) => d.id),
    bgPackExisted: !!pack, bgDocs: pack ? (await pack.getIndex()).map((e) => e._id) : [],
  };
}, WORLD_BG_PACK);

/** What exists now that did not at `before` — the only way a fixture is found. */
const fresh = (before) => page.evaluate(async ({ before, WORLD_BG_PACK }) => {
  const d = (coll, was) => { const w = new Set(was); return coll.filter((x) => !w.has(x.id)).map((x) => x.id); };
  const pack = game.packs.get(WORLD_BG_PACK);
  const was = new Set(before.bgDocs);
  return {
    items: d(game.items, before.items), actors: d(game.actors, before.actors),
    tables: d(game.tables, before.tables), folders: d(game.folders, before.folders),
    bgDocs: pack ? (await pack.getIndex()).filter((e) => !was.has(e._id)).map((e) => e._id) : [],
  };
}, { before, WORLD_BG_PACK });

/** Raise a tab and return its rendered root, the way a Warden reaches it. */
const showTab = (tab) => page.evaluate(async (tab) => {
  ui.sidebar.expand();
  ui.sidebar.changeTab(tab, "primary");
  await ui[tab].render({ force: true });
  await new Promise((r) => setTimeout(r, 400));
}, tab);

/** Open one door and wait for ITS confirm (found by instance-id difference, never
 *  the first DialogV2 in the map — a closing one lingers there for its animation). */
const openConfirm = (kind) => page.evaluate(async ({ kind, tab }) => {
  ui.sidebar.expand();
  ui.sidebar.changeTab(tab, "primary");
  await ui[tab].render({ force: true });
  await new Promise((r) => setTimeout(r, 300));
  const btn = ui[tab].element.querySelector(`.cairn-take-over[data-kind="${kind}"]`);
  if (!btn) return { error: `no ${kind} button on ${tab}` };
  const before = new Set(foundry.applications.instances.keys());
  btn.click();
  for (let t = 0; t < 120; t++) {
    const dlg = [...foundry.applications.instances.values()]
      .find((x) => !before.has(x.id) && x.constructor.name === "DialogV2" && x.element?.querySelector(".cairn-take-over")
        && x.element.querySelector('button[data-action="copy"]'));
    if (dlg) {
      globalThis.__abConfirm = dlg;
      const el = dlg.element;
      return {
        title: el.querySelector(".window-title")?.textContent.trim(),
        heads: [...el.querySelectorAll(".cairn-take-over p > strong")].map((s) => s.textContent.trim()),
        counts: el.querySelector(".take-over-counts")?.textContent.trim() ?? null,
        text: el.querySelector(".cairn-take-over")?.textContent ?? "",
        // The dialog's OWN buttons, not the window frame's (close, toggleControls).
        buttons: [...el.querySelectorAll('button[data-action="copy"], button[data-action="cancel"]')]
          .map((b) => ({ action: b.dataset.action, type: b.getAttribute("type"), focused: el.ownerDocument.activeElement === b })),
        width: el.getBoundingClientRect().width,
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { error: "confirm never appeared" };
}, { kind, tab: KIND_TAB[kind] });

/**
 * Answer the confirm. On Copy, wait for the run to finish and report the RESULT
 * window (left open on `__abResult` so a caller can press one of its buttons).
 */
const answerConfirm = (action) => page.evaluate(async (action) => {
  const dlg = globalThis.__abConfirm;
  if (!dlg) return { error: "no confirm handle" };
  const warns = [];
  const origWarn = ui.notifications.warn;
  ui.notifications.warn = (m, ...rest) => { warns.push(String(m)); return origWarn.call(ui.notifications, m, ...rest); };
  const seen = new Set(foundry.applications.instances.keys());
  try {
    if (action === "close") await dlg.close();
    else {
      const btn = dlg.element.querySelector(`button[data-action="${action}"]`);
      if (!btn) return { error: `no ${action} button` };
      btn.click();
    }
    const mod = await import("/systems/air-bladder/module/take-over.js");
    await new Promise((r) => setTimeout(r, 400));
    for (let t = 0; t < 600; t++) {
      if (!foundry.applications.instances.has(dlg.id) && !mod.isTakeOverRunning()) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (action !== "copy") return { warns };
    for (let t = 0; t < 120; t++) {
      const res = [...foundry.applications.instances.values()]
        .find((x) => !seen.has(x.id) && x.id !== dlg.id && x.constructor.name === "DialogV2"
          && x.element?.querySelector('button[data-action="close"]'));
      if (res) {
        globalThis.__abResult = res;
        return {
          warns,
          result: {
            title: res.element.querySelector(".window-title")?.textContent.trim(),
            lines: [...res.element.querySelectorAll(".cairn-take-over p")].map((p) => p.textContent.trim()),
            // The dialog's OWN footer, never the window frame — its ✕ is a
            // `data-action="close"` button too, and fooled the first draft.
            buttons: [...res.element.querySelectorAll(".dialog-buttons button, .form-footer button")]
              .map((b) => ({
                action: b.dataset.action, type: b.getAttribute("type"), label: b.textContent.trim(), focused: res.element.ownerDocument.activeElement === b,
                // Layout: one button per row (distinct tops), a sentence that
                // fits its box, and a glyph that RENDERS — a misspelled FA
                // class is an empty box with no error, so read `::before`.
                top: Math.round(b.getBoundingClientRect().top),
                clipped: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1,
                // The door leg's rule: a rendered glyph is a private-use character.
                glyph: (() => {
                  const i = b.querySelector("i");
                  const c = i ? getComputedStyle(i, "::before").content : null;
                  return i ? !!c && c !== "none" && c.charCodeAt(1) > 0xe000 : null;
                })(),
              })),
          },
        };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return { warns, result: { error: "no result window" } };
  } finally {
    ui.notifications.warn = origWarn;
    delete globalThis.__abConfirm;
  }
}, action);

/** Press one of the result window's buttons and report where it landed. */
const pressResult = (action) => page.evaluate(async (action) => {
  const res = globalThis.__abResult;
  if (!res) return { error: "no result handle" };
  try {
    const btn = res.element.querySelector(`button[data-action="${action}"]`);
    if (!btn) return { error: `no ${action} button` };
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    const expanded = Object.keys(game.folders._expanded ?? {});
    return {
      tab: ui.sidebar.tabGroups.primary,
      expanded,
      packWindows: [...foundry.applications.instances.values()]
        .filter((x) => x.constructor.name === "Compendium" || x.collection?.collection)
        .map((x) => x.collection?.collection).filter(Boolean),
    };
  } finally { delete globalThis.__abResult; }
}, action);

const closeResult = () => page.evaluate(async () => {
  const res = globalThis.__abResult;
  delete globalThis.__abResult;
  if (!res) return false;
  res.element.querySelector('button[data-action="close"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  return true;
});

const planOf = (kind) => page.evaluate(async ({ kind, MOD, CAIRN_2E_TABLES }) => {
  const mod = await import(MOD);
  if (kind === "backgrounds") {
    const p = await mod.planBackgroundsTakeOver();
    return { ok: p.ok, add: p.add.length, kept: p.kept.length, exists: p.exists, locked: p.locked };
  }
  // The spells spec is the pool IN FORCE, exactly as the button computes it.
  const spellDecl = CONFIG.Cairn.characterGenerator2e.spells[game.settings.get("air-bladder", "enable-glog-magic") ? "glog" : "canon"];
  const [spellPack, spellTable] = spellDecl.split(";");
  const specs = {
    spells: { key: "spells", pack: spellPack, only: [spellTable], folder: "CAIRN.TakeOver.Spells.Folder" },
    marketplace: { key: "marketplace", pack: "air-bladder.marketplace", folder: "CAIRN.TakeOver.Marketplace.Folder" },
    barebones: { key: "barebones", pack: "air-bladder.tables-barebones", folder: "CAIRN.TakeOver.Barebones.Folder" },
    cairn2e: { key: "cairn2e", pack: "air-bladder.tables-2e", only: CAIRN_2E_TABLES, folder: "CAIRN.TakeOver.Cairn2e.Folder" },
  };
  const p = await mod.planTableTakeOver(specs[kind]);
  return {
    ok: p.ok, rows: p.rows, unresolved: p.unresolved, targets: p.targets.size, tableTargets: [...p.tableTargets.values()],
    tablesAdd: p.tables.add.map((t) => t.name), tablesAddFrom: p.tables.add.map((t) => `${t.pack};${t.name}`), tablesKept: p.tables.kept,
    itemsAdd: p.items.add.length, itemsKept: p.items.kept.length,
    actorsAdd: p.actors.add.length, actorsKept: p.actors.kept.length,
    addNames: [...p.items.add, ...p.actors.add].map((d) => d.name),
  };
}, { kind, MOD, CAIRN_2E_TABLES });

const catalog = (pg) => pg.evaluate(async (MKT) => {
  const mkt = await import(MKT);
  const cat = await mkt.getMarketplaceCatalog();
  return cat.categories.map((c) => ({ name: c.name, items: c.items.map((i) => [i.name, i.system?.cost ?? null]) }));
}, MKT);

const sweep = () => page.evaluate(async ({ NS, WORLD_BG_PACK, BG_PACKS }) => {
  // Leftovers of a killed run: anything inside OUR flagged folders (one flag value
  // per kind), plus copies in the world background pack that name a shipped
  // background as their source.
  let n = 0;
  // Subfolders (they name a pack) go before their parents, so no folder is
  // deleted out from under the loop by a parent's cascade.
  const folders = game.folders.filter((f) => ["spells", "marketplace", "barebones", "cairn2e"].includes(f.getFlag(NS, "takeOver")))
    .sort((a, b) => (b.getFlag(NS, "takeOverPack") ? 1 : 0) - (a.getFlag(NS, "takeOverPack") ? 1 : 0));
  for (const f of folders) {
    const coll = { Item: game.items, Actor: game.actors, RollTable: game.tables }[f.type];
    const ids = coll.filter((d) => d.folder?.id === f.id).map((d) => d.id);
    if (ids.length) { await coll.documentClass.deleteDocuments(ids); n += ids.length; }
    await f.delete(); n++;
  }
  const pack = game.packs.get(WORLD_BG_PACK);
  if (pack) {
    const idx = await pack.getIndex({ fields: ["_stats.compendiumSource"] });
    const ids = idx.filter((e) => BG_PACKS.some((p) => String(e._stats?.compendiumSource ?? "").startsWith(`Compendium.${p}.`))).map((e) => e._id);
    if (ids.length) { await Item.implementation.deleteDocuments(ids, { pack: pack.collection }); n += ids.length; }
  }
  return n;
}, { NS, WORLD_BG_PACK, BG_PACKS });

/* --------------------------------------------------------------------- run */

let alice = null;
let alicePage = null;
let before = null;
try {
  await joinAsGM(page);
  await dismissChrome(page);
  const swept = await sweep();
  if (swept) console.log(`  note  swept ${swept} leftover document(s) from an earlier run`);

  await withSettings(page, async () => {
    before = await snapshot();
    console.log(`  note  world holds ${before.items.length} items, ${before.actors.length} actors, ${before.tables.length} tables; background pack ${before.bgPackExisted ? "exists" : "absent"}`);

    /* --------------------------------------------------- 1. the four doors */
    console.log("\n1. the four doors");
    const doors = await page.evaluate(async () => {
      const read = async (tab, kinds) => {
        ui.sidebar.expand();
        ui.sidebar.changeTab(tab, "primary");
        await ui[tab].render({ force: true });
        await new Promise((r) => setTimeout(r, 500));
        const app = ui[tab];
        const actions = app.element.querySelector("header.character-generator.directory-header .header-actions");
        const inner = actions ? actions.clientWidth - parseFloat(getComputedStyle(actions).paddingLeft) - parseFloat(getComputedStyle(actions).paddingRight) : 0;
        const out = { rowTops: [], kinds: {} };
        for (const kind of kinds) {
          const b = app.element.querySelector(`.cairn-take-over[data-kind="${kind}"]`);
          const i = b?.querySelector("i");
          const content = i ? getComputedStyle(i, "::before").content : null;
          const r = b?.getBoundingClientRect();
          out.kinds[kind] = {
            present: !!b, label: b?.textContent.trim(), type: b?.getAttribute("type"),
            width: r ? Math.round(r.width) : 0, headerWidth: Math.round(inner),
            glyph: !!content && content !== "none" && content !== '""' && content.charCodeAt(1) > 0xe000,
            // A label longer than the row WRAPS (the door rule's white-space:
            // normal + height: auto); the 2e door's label grew past one line
            // on 2026-09-15 (user: fine "as long as it's all readable"), so a
            // clipped label — overflow beyond the box — is the red here.
            clipped: b ? (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1) : null,
            lines: b && r ? Math.max(1, Math.round((r.height - 10) / parseFloat(getComputedStyle(b).lineHeight))) : 0,
          };
        }
        out.rowTops = [...(actions?.children ?? [])].map((c) => Math.round(c.getBoundingClientRect().top));
        const pop = await app.renderPopout();
        await new Promise((r) => setTimeout(r, 700));
        const popEl = pop?.element instanceof HTMLElement ? pop.element : null;
        out.popped = popEl?.querySelectorAll(".cairn-take-over").length ?? null;
        out.separate = !!popEl && popEl !== app.element;
        try { await pop.close(); } catch { /* gone */ }
        return out;
      };
      const order = [...(ui.tables.element?.querySelectorAll(".cairn-take-over") ?? [])].map((b) => b.dataset.kind);
      // The 2e door has TWO homes (user ruling 2026-09-15, an hour after the
      // move to Rollable Tables): read the Compendium directory the same way,
      // and it must carry exactly that one door.
      const compendium = await read("compendium", ["cairn2e"]);
      return {
        tables: await read("tables", ["spells", "marketplace", "barebones", "cairn2e"]),
        compendium, order,
        compendiumDoors: ui.compendium.element?.querySelectorAll(".cairn-take-over").length ?? 0,
      };
    });
    for (const [tab, kind] of [["tables", "spells"], ["tables", "marketplace"], ["tables", "barebones"], ["tables", "cairn2e"], ["compendium", "cairn2e"]]) {
      const k = doors[tab].kinds[kind];
      check(k.present && k.type === "button", `${tab}: the ${kind} button is there, type=button`, k.label);
      check(k.glyph, `…${kind}'s glyph RENDERS (read from ::before)`);
      check(k.width >= k.headerWidth * 0.9, `…and it spans the header`, `${k.width} of ${k.headerWidth}px`);
      check(k.clipped === false, `…and nothing of its label is clipped (${k.lines} line${k.lines === 1 ? "" : "s"})`, k.label);
    }
    check(new Set(doors.tables.rowTops).size === doors.tables.rowTops.length && doors.tables.rowTops.length === 4,
      "Rollable Tables: the four Copy buttons each on a row of their own, and nothing else in the header", JSON.stringify(doors.tables.rowTops));
    check(doors.order.join(",") === "spells,marketplace,barebones,cairn2e",
      "…in the declared order, the backgrounds door fourth", doors.order.join(","));
    check(doors.tables.popped === 4 && doors.tables.separate, "…and all four once more on the popped-out directory (a second root)");
    check(doors.compendiumDoors === 1, "Compendium: the 2e door, and only that one, at the top of the pack list (its second home)", String(doors.compendiumDoors));
    check(doors.compendium.popped === 1 && doors.compendium.separate, "…and once more on the popped-out Compendium directory");

    for (const [hook, fn, tab, n] of [["renderRollTableDirectory", "abTakeOverTablesButton", "tables", 4], ["renderCompendiumDirectory", "abTakeOverCompendiumButton", "compendium", 1]]) {
      const off = await withHookOff(page, hook, fn, () => page.evaluate(async (tab) => {
        const a = ui[tab];
        // The per-root guard keeps an injected button across re-renders of
        // core's own parts; a full re-render rebuilds the root.
        a.element.querySelectorAll(".cairn-take-over").forEach((b) => b.remove());
        await a.render({ force: true });
        await new Promise((r) => setTimeout(r, 400));
        return a.element.querySelectorAll(".cairn-take-over").length;
      }, tab));
      const on = await page.evaluate(async (tab) => {
        await ui[tab].render({ force: true });
        await new Promise((r) => setTimeout(r, 400));
        return ui[tab].element.querySelectorAll(".cairn-take-over").length;
      }, tab);
      check(off === 0 && on === n, `red-first: with ${fn} off the ${tab} buttons are gone, back on ${n} return`, `${off} → ${on}`);
    }

    alice = await browser.newContext({ viewport: VIEWPORT });
    alicePage = await alice.newPage();
    alicePage.on("crash", () => console.log("  note  Alice's page CRASHED"));
    await joinAs(alicePage, "Alice");
    await dismissChrome(alicePage);
    const aliceDoors = await alicePage.evaluate(async () => {
      await ui.tables.render(true); await ui.compendium.render(true);
      await new Promise((r) => setTimeout(r, 400));
      return { tables: ui.tables.element?.querySelectorAll(".cairn-take-over").length ?? 0, compendium: ui.compendium.element?.querySelectorAll(".cairn-take-over").length ?? 0, isGM: game.user.isGM };
    });
    check(!aliceDoors.isGM && aliceDoors.tables === 0 && aliceDoors.compendium === 0, "Alice sees no door at all", JSON.stringify(aliceDoors));

    // The Actor Directory's own row shares this header (review #31): its nine
    // creation buttons caught the take-over buttons' full-width rule for a day.
    // User ruling: every label fully legible, never clipped, on as many rows
    // as that takes — some may span the whole width — but not nine rows.
    const nine = await page.evaluate(async () => {
      ui.sidebar.expand();
      ui.sidebar.changeTab("actors", "primary");
      await ui.actors.render({ force: true });
      await new Promise((r) => setTimeout(r, 500));
      const row = ui.actors.element.querySelector("#cairn-character-gen-button");
      const inner = row ? row.clientWidth - parseFloat(getComputedStyle(row).paddingLeft) - parseFloat(getComputedStyle(row).paddingRight) : 0;
      const buttons = [...(row?.querySelectorAll(":scope > button") ?? [])].map((b) => {
        const r = b.getBoundingClientRect();
        // What the label NEEDS: the same button laid out at max-content.
        const probe = b.cloneNode(true);
        probe.style.cssText = "position:absolute;visibility:hidden;width:max-content;flex:none;min-width:0;white-space:nowrap";
        row.append(probe);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        return { label: b.textContent.trim(), width: Math.round(r.width), need: Math.round(need), top: Math.round(r.top), clipped: b.scrollWidth > b.clientWidth + 1 };
      });
      return { headerWidth: Math.round(inner), buttons };
    });
    const nineRows = new Set(nine.buttons.map((b) => b.top)).size;
    check(nine.buttons.length === 9, "Actors: the Warden's directory row carries its nine creation buttons", nine.buttons.map((b) => b.label).join(" | "));
    check(nine.buttons.every((b) => !b.clipped && b.width >= b.need - 1),
      "…every label fully legible: no button narrower than its own label, nothing clipped", JSON.stringify(nine.buttons.map((b) => [b.label, b.width, b.need])));
    check(nineRows >= 2 && nineRows < nine.buttons.length,
      `…wrapped onto ${nineRows} rows, sharing a row where two fit — not one button per row`, JSON.stringify(nine.buttons.map((b) => b.top)));
    check(nine.buttons.every((b) => b.width <= nine.headerWidth + 1), "…and none wider than the header", `${nine.headerWidth}px`);

    /* ----------------------------------------------------- 2. the confirms */
    console.log("\n2. the confirms");
    // The label a sentence names the pack by: the pack's OWN when it exists
    // (an older world keeps the name it was made under — core cannot rename a
    // world compendium), else the key's text for the one a run will create.
    const PACK_LABEL = await page.evaluate(() => game.packs.get("world.custom-backgrounds")?.metadata.label ?? game.i18n.localize("CAIRN.CustomBackgroundsPack"));

    // A double-click opens ONE confirm (review #31): `running` goes up before
    // the plan's first await, so the second call returns null at once.
    const dbl = await page.evaluate(async (MOD) => {
      const mod = await import(MOD);
      const before = new Set(foundry.applications.instances.keys());
      // Neither call awaited before the dialogs are counted: a build that opens
      // two confirms would otherwise hang this leg on the second one's `wait`.
      const first = mod.openTakeOver("marketplace");
      const second = mod.openTakeOver("marketplace");
      const confirms = () => [...foundry.applications.instances.values()].filter((x) => !before.has(x.id) && x.element?.querySelector(".cairn-take-over"));
      for (let t = 0; t < 120 && !confirms().length; t++) await new Promise((r) => setTimeout(r, 250));
      await new Promise((r) => setTimeout(r, 800));
      const open = confirms();
      const n = open.length;
      for (const d of open) await d.close();
      const [firstOut, secondOut] = await Promise.all([first, second]);
      return { n, secondOut, firstOut, running: mod.isTakeOverRunning() };
    }, MOD);
    check(dbl.n === 1 && dbl.secondOut === null && dbl.firstOut === null && !dbl.running,
      "two calls in one tick open ONE confirm: the second returns null at once, and the flag is down after ✕", JSON.stringify(dbl));

    // On a short screen the confirm SCROLLS (review #31: measured at 650px, the
    // Copy button sat below the bottom edge with the overflow hidden).
    await page.setViewportSize({ width: VIEWPORT.width, height: 650 });
    const short = await openConfirm("cairn2e");
    const scroll = await page.evaluate(() => {
      const dlg = globalThis.__abConfirm;
      const wc = dlg.element.querySelector(".window-content");
      const copy = dlg.element.querySelector('button[data-action="copy"]');
      const before = copy.getBoundingClientRect().bottom;
      const overflowY = getComputedStyle(wc).overflowY;
      const scrollable = wc.scrollHeight > wc.clientHeight + 1;
      wc.scrollTop = wc.scrollHeight;
      const after = copy.getBoundingClientRect().bottom;
      // CONTROL: without the dialog's class, core's own overflow rule applies.
      dlg.element.classList.remove("cairn-take-over-dialog");
      const coreOverflow = getComputedStyle(wc).overflowY;
      dlg.element.classList.add("cairn-take-over-dialog");
      return { viewport: window.innerHeight, overflowY, scrollable, before: Math.round(before), after: Math.round(after), coreOverflow };
    });
    await answerConfirm("cancel");
    await page.setViewportSize(VIEWPORT);
    check(!short.error && scroll.scrollable && scroll.before > scroll.viewport, "precondition: at a 650px viewport the confirm's content overflows and Copy starts below the fold", JSON.stringify(scroll));
    check(scroll.overflowY === "auto" && scroll.after <= scroll.viewport + 1, "…the content scrolls, and scrolled down Copy is on screen", `${scroll.before} → ${scroll.after} of ${scroll.viewport}`);
    check(scroll.coreOverflow !== "auto" && scroll.coreOverflow !== "scroll", "CONTROL: without the dialog's class core hides the overflow — the class is load-bearing", scroll.coreOverflow);
    const WANT_HEADS = {
      spells: ["Create a Custom Spell Table!", "How Air Bladder works", "Here is an easy fix"],
      marketplace: ["Create a Custom Marketplace!", "How Air Bladder works", "Here is an easy fix"],
      barebones: ["Create Custom Barebones Creation Tables!", "How Air Bladder works", "Here is an easy fix"],
      cairn2e: ["Create Custom 2e Backgrounds!", "How Air Bladder works", "Here is an easy fix"],
    };
    const glogOn = await page.evaluate(() => !!game.settings.get("air-bladder", "enable-glog-magic"));
    console.log(`  note  the GLOG hack is ${glogOn ? "ON" : "OFF"} in this world; the spells door copies the ${glogOn ? "GLOG" : "canon"} pool`);
    for (const kind of ["spells", "marketplace", "barebones", "cairn2e"]) {
      const c = await openConfirm(kind);
      check(!c.error && WANT_HEADS[kind].every((h) => c.heads.includes(h)),
        `${kind}: the confirm leads with its three bold headers`, c.error ?? JSON.stringify(c.heads));
      if (kind === "spells") {
        check(/GLOG Magic/.test(c.text) && (glogOn ? !/come back/i.test(c.text) : /come back/i.test(c.text)),
          glogOn ? "…spells: it says the hack is on and which list it copies, and does NOT invite switching it off"
            : "…spells: it warns that switching the hack on later means coming back for the GLOG table");
      }
      check(c.buttons?.length === 2 && c.buttons.every((b) => b.type === "button"), `…${kind}: no submit button at all — Enter never copies`, JSON.stringify(c.buttons));
      check(c.buttons?.find((b) => b.action === "cancel")?.focused, `…${kind}: Cancel is the focused button`);
      check(c.width > 0 && c.width <= 520, `…${kind}: the window states its width`, `${Math.round(c.width ?? 0)}px`);
      check(/templates/.test(c.text), `…${kind}: it says the shipped compendiums are templates`);
      if (kind === "cairn2e") {
        check(c.text.includes(PACK_LABEL) && !c.text.includes("{pack}"),
          `…cairn2e: it names the world compendium by its label ("${PACK_LABEL}"), the key the pack is created with`);
      }
      await answerConfirm(kind === "cairn2e" ? "close" : "cancel");
    }
    let f = await fresh(before);
    check(f.items.length + f.actors.length + f.tables.length + f.folders.length + f.bgDocs.length === 0, "Cancel and ✕ create nothing");

    /* ------------------------------------------- 3. the plans are pure reads */
    console.log("\n3. the plans");
    const p0 = await planOf("marketplace");
    check(p0.ok && p0.rows === 77 && p0.targets === 77 && p0.unresolved.length === 0 && p0.tablesAdd.length === 4,
      "marketplace: 77 rows, 77 targets, 4 tables to add, nothing unresolved",
      `add ${p0.itemsAdd} items + ${p0.actorsAdd} mounts, kept ${p0.itemsKept} + ${p0.actorsKept}`);
    const pb0 = await planOf("barebones");
    check(pb0.ok && pb0.rows === 124 && pb0.tablesAdd.length === 6 && pb0.unresolved.length === 0
      && pb0.tableTargets.length === 3 && pb0.tableTargets.every((u) => /^RollTable\.[A-Za-z0-9]{16}$/.test(u)),
      "Barebones: 124 rows, 6 tables, three rows pointing at the tier TABLES, nothing unresolved",
      `add ${pb0.itemsAdd} items, kept ${pb0.itemsKept}; table targets ${JSON.stringify(pb0.tableTargets)}`);
    const pc0 = await planOf("cairn2e");
    check(pc0.ok && pc0.tablesAdd.length === 11 && pc0.targets === 0 && pc0.unresolved.length === 0
      && !pc0.tablesAdd.some((n) => /Spells/.test(n)) && pc0.itemsAdd === 0 && pc0.actorsAdd === 0,
      "Cairn 2e: eleven TEXT tables, nothing to re-point, the Spells table left out", `${pc0.rows} rows`);
    check(CAIRN_2E_NAMES.every((n) => pc0.tablesAdd.includes(n)), "…and all eleven are named", pc0.tablesAdd.sort().join(", "));
    check(pc0.tablesAddFrom.includes("air-bladder.utils;Scars") && !pc0.tablesAddFrom.includes("air-bladder.tables-2e;Scars"),
      "…its Scars is the one in UTILS — the list the damage card rolls — not the sheet checklist's in Tables (2e)", pc0.tablesAddFrom.filter((d) => /Scars/.test(d)).join(", "));
    const b0 = await planOf("backgrounds");
    check(b0.ok && b0.add + b0.kept === 27, "backgrounds: 27 shipped backgrounds accounted for", JSON.stringify(b0));
    const ps0 = await planOf("spells");
    check(ps0.ok && ps0.tablesAdd.length === 1 && /^Spells/.test(ps0.tablesAdd[0]) && ps0.unresolved.length === 0
      && ps0.rows > 0 && ps0.targets === ps0.rows && ps0.itemsAdd + ps0.itemsKept === ps0.rows && ps0.actorsAdd + ps0.actorsKept === 0,
      "spells: one table, every row a spellbook to copy or keep, nothing unresolved, no actors",
      `${ps0.tablesAdd[0]}: ${ps0.rows} rows, add ${ps0.itemsAdd} kept ${ps0.itemsKept}`);
    const pRefused = await page.evaluate(async (MOD) => {
      const mod = await import(MOD);
      const pack = game.packs.get("air-bladder.trinkets");
      const orig = pack.getDocuments;
      pack.getDocuments = async () => [];
      try {
        const p = await mod.planTableTakeOver({ key: "marketplace", pack: "air-bladder.marketplace", folder: "CAIRN.TakeOver.Marketplace.Folder" });
        return { unresolved: p.unresolved.length, targets: p.targets.size };
      } finally { delete pack.getDocuments; if (pack.getDocuments !== orig) pack.getDocuments = orig; }
    }, MOD);
    f = await fresh(before);
    check(pRefused.unresolved === 4 && pRefused.targets === 73 && f.items.length === 0,
      "a source pack that answers nothing → 4 unresolved rows, and a plan writes nothing", JSON.stringify(pRefused));

    /* --------------------------------------------------- 4. tables LAST */
    console.log("\n4. tables last");
    const catBefore = await catalog(page);
    const gearBefore = catBefore.find((c) => c.name === "Gear")?.items.length;
    const partial = await page.evaluate(async (MOD) => {
      const mod = await import(MOD);
      const cls = RollTable.implementation;
      const orig = cls.createDocuments;
      cls.createDocuments = async () => { throw new Error("probe: tables refused"); };
      try {
        const p = await mod.planTableTakeOver({ key: "marketplace", pack: "air-bladder.marketplace", folder: "CAIRN.TakeOver.Marketplace.Folder" });
        try { await mod.runTableTakeOver(p); return { threw: false }; }
        catch (e) { return { threw: true, message: e.message, planned: p.items.add.length + p.actors.add.length }; }
      } finally { delete cls.createDocuments; if (cls.createDocuments !== orig) cls.createDocuments = orig; }
    }, MOD);
    f = await fresh(before);
    const catMid = await catalog(page);
    check(partial.threw && f.tables.length === 0 && f.items.length + f.actors.length === partial.planned,
      "with table creation refused: the targets landed, NO Market table did", `${f.items.length} items + ${f.actors.length} mounts, ${f.tables.length} tables`);
    check(catMid.find((c) => c.name === "Gear")?.items.length === gearBefore, "…and the shop still reads the shipped Gear aisle", `${gearBefore} rows`);
    const p1 = await planOf("marketplace");
    check(p1.itemsAdd === 0 && p1.actorsAdd === 0 && p1.tablesAdd.length === 4, "a re-plan resumes: nothing to add but the four tables");

    /* ------------------------------------------------- 5. the claim, via UI */
    console.log("\n5. the marketplace run, through the confirm");
    await openConfirm("marketplace");
    const run1 = await answerConfirm("copy");
    f = await fresh(before);
    const tree = await page.evaluate(({ folders, items, actors, NS }) => {
      const fs = folders.map((id) => game.folders.get(id)).filter(Boolean);
      const parents = fs.filter((f) => !f.getFlag(NS, "takeOverPack"));
      const children = fs.filter((f) => f.getFlag(NS, "takeOverPack"));
      const itemParent = parents.find((f) => f.type === "Item");
      const actorParent = parents.find((f) => f.type === "Actor");
      const packOf = (d) => String(d._stats?.compendiumSource ?? "").split(".").slice(1, 3).join(".");
      const newItems = items.map((id) => game.items.get(id)).filter(Boolean);
      return {
        parentTypes: parents.map((f) => f.type).sort(),
        children: children.map((c) => ({
          name: c.name, type: c.type, pack: c.getFlag(NS, "takeOverPack"),
          underItems: c.folder?.id === itemParent?.id, label: game.packs.get(c.getFlag(NS, "takeOverPack"))?.metadata.label,
        })).sort((a, b) => a.name.localeCompare(b.name)),
        sourcePacks: [...new Set(newItems.map(packOf))].length,
        itemsFiled: newItems.filter((d) => { const c = children.find((x) => x.getFlag(NS, "takeOverPack") === packOf(d)); return c && d.folder?.id === c.id; }).length,
        actorsDirect: actors.filter((id) => game.actors.get(id)?.folder?.id === actorParent?.id).length,
      };
    }, { folders: f.folders, items: f.items, actors: f.actors, NS });
    check(f.tables.length === 4 && JSON.stringify(tree.parentTypes) === JSON.stringify(["Actor", "Item", "RollTable"]),
      "four tables, and one flagged parent folder per directory", `result: ${JSON.stringify(run1.result?.lines)}`);
    check(tree.children.length === tree.sourcePacks && tree.sourcePacks >= 5
      && tree.children.every((c) => c.type === "Item" && c.underItems && c.name === c.label),
      "one item subfolder per source compendium under Marketplace, each named with that compendium's label", tree.children.map((c) => c.name).join(", "));
    check(tree.itemsFiled === f.items.length && f.items.length > 0, "every copied item sits in the subfolder of the compendium it came from", `${tree.itemsFiled}/${f.items.length}`);
    check(tree.actorsDirect === f.actors.length && f.actors.length > 0, "the mounts sit directly under the Actors parent — one source, so no subfolder", `${tree.actorsDirect}/${f.actors.length}`);
    check(run1.result?.title === "Copied"
      && run1.result.lines.some((l) => ["Rollable Tables", "Items", "Actors", "Marketplace"].every((w) => l.includes(w))),
      "the result window names all three directories it wrote into, and the folder", JSON.stringify(run1.result?.lines));
    check(["tables", "items", "actors", "close"].every((a) => run1.result?.buttons.some((b) => b.action === a))
      && run1.result.buttons.every((b) => b.type === "button")
      && run1.result.buttons.find((b) => b.action === "close")?.focused,
      "…with a button per directory — Rollable Tables, Items and Actors — and Close, all type=button, Close focused", JSON.stringify(run1.result?.buttons?.map((b) => b.action)));
    // Each button says what it opens: the folder by its DOCUMENT's name and
    // the directory, formatted in-page off the key so the English is not
    // pinned here — and one regex so a format that returned the key reds.
    const expectOpen = await page.evaluate(({ ids, NS }) => {
      const parent = (type) => ids.map((id) => game.folders.get(id)).find((x) => x?.type === type && !x.getFlag(NS, "takeOverPack"));
      return Object.fromEntries([["tables", "RollTable", "OpenTables"], ["items", "Item", "OpenItems"], ["actors", "Actor", "OpenActors"]]
        .map(([a, type, key]) => [a, game.i18n.format(`CAIRN.TakeOver.Result.${key}`, { folder: parent(type)?.name ?? "?" })]));
    }, { ids: f.folders, NS });
    check(Object.entries(expectOpen).every(([a, label]) => run1.result?.buttons.find((b) => b.action === a)?.label === label)
      && /Custom Marketplace folder in Items/.test(expectOpen.items),
      "…each naming what it opens: the folder by its document's name, and the directory", JSON.stringify(run1.result?.buttons?.map((b) => b.label)));
    const rows = run1.result?.buttons ?? [];
    check(rows.length === 4 && new Set(rows.map((b) => b.top)).size === rows.length && rows.every((b) => !b.clipped)
      && rows.filter((b) => b.action !== "close").every((b) => b.glyph === true),
      "…one button per row, nothing clipped, every directory button's glyph rendered", JSON.stringify(rows.map((b) => [b.action, b.top, b.clipped, b.glyph])));
    const landedItems = await pressResult("items");
    const itemFolder = await page.evaluate(({ ids, NS }) => ids.map((id) => game.folders.get(id))
      .find((x) => x?.type === "Item" && !x.getFlag(NS, "takeOverPack"))?.uuid, { ids: f.folders, NS });
    check(landedItems.tab === "items" && landedItems.expanded.includes(itemFolder),
      "Open Items raises the Items tab with the Custom Marketplace folder expanded", `${landedItems.tab}, folder ${itemFolder}`);

    const claim = await page.evaluate(async ({ newTables, newFolders, NS }) => {
      const pack = game.packs.get("air-bladder.marketplace");
      const shipped = await pack.getDocuments();
      const out = { tables: [], foldersFlagged: 0, packRowsStillPack: 0, packRows: 0 };
      for (const id of newFolders) out.foldersFlagged += game.folders.get(id)?.getFlag(NS, "takeOver") === "marketplace" ? 1 : 0;
      for (const id of newTables) {
        const t = game.tables.get(id);
        const s = shipped.find((x) => x.id === id);
        const rows = [...t.results].sort((a, b) => a.range[0] - b.range[0]);
        let resolves = 0, world = 0, ranged = 0;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (/^(Item|Actor)\.[A-Za-z0-9]{16}$/.test(r.documentUuid ?? "")) world++;
          const doc = await fromUuid(r.documentUuid).catch(() => null);
          if (doc && doc.name === r.name) resolves++;
          if (r.range[0] === i + 1 && r.range[1] === i + 1) ranged++;
        }
        out.tables.push({ name: t.name, sameId: !!s, rows: rows.length, shippedRows: s?.results.size, world, resolves, ranged, formula: t._source.formula, inFolder: newFolders.includes(t.folder?.id) });
      }
      for (const s of shipped) for (const r of s.results) { out.packRows++; if (String(r.documentUuid).startsWith("Compendium.")) out.packRowsStillPack++; }
      return out;
    }, { newTables: f.tables, newFolders: f.folders, NS });
    check(claim.foldersFlagged === f.folders.length, "every folder, parent and subfolder alike, carries the take-over flag", `${claim.foldersFlagged}/${f.folders.length}`);
    for (const t of claim.tables) {
      check(t.sameId && t.rows === t.shippedRows && t.world === t.rows && t.resolves === t.rows && t.ranged === t.rows && t.formula === `1d${t.rows}` && t.inFolder,
        `${t.name}: shipped id, ${t.rows} rows all pointing at WORLD documents that resolve, ranged 1..${t.rows}, stored formula 1d${t.rows}, in the folder`,
        JSON.stringify(t));
    }
    check(claim.packRowsStillPack === claim.packRows, "control: the shipped tables' own rows still point at the compendium (the pack was never written)", `${claim.packRows}`);
    const catAfter = await catalog(page);
    const shape = (cat) => cat.map((c) => `${c.name}:${c.items.map(([n]) => n).join("|")}`).join("\n");
    check(shape(catAfter) === shape(catBefore), "the catalog is unchanged in names and order", `${catAfter.map((c) => `${c.name} ${c.items.length}`).join(", ")}`);
    // Prices: identical for every row whose copy THIS run created. A row adopted
    // from a copy the Warden already had may legitimately differ (that copy is
    // theirs to edit), so those are reported, never asserted.
    const created = new Set(p0.addNames);
    const priceDiffs = [];
    for (const c of catBefore) {
      const after = catAfter.find((x) => x.name === c.name);
      for (const [name, cost] of c.items) {
        const now = after?.items.find(([n]) => n === name)?.[1];
        if (now !== cost) priceDiffs.push({ name, cost, now, created: created.has(name) });
      }
    }
    check(priceDiffs.every((d) => !d.created), "every price the run copied reads as the pack's", priceDiffs.length ? `adopted copies that differ: ${JSON.stringify(priceDiffs)}` : "no differences at all");

    const dagger = await page.evaluate(async () => {
      const shipped = await game.packs.get("air-bladder.weapons").getDocuments();
      const src = shipped.find((d) => d.name === "Dagger");
      const world = game.items.get(src.id) ?? game.items.find((d) => d._stats?.compendiumSource === src.uuid);
      await world.update({ "system.cost": 99 });
      return { id: world.id, uuid: world.uuid, shippedId: src.id, shippedUuid: src.uuid, packCost: src.system.cost };
    });
    const catPriced = await catalog(page);
    const daggerRow = catPriced.find((c) => c.name === "Weapons")?.items.find(([n]) => n === "Dagger");
    check(daggerRow?.[1] === 99 && dagger.packCost === 5, "edit the world Dagger to 99 → the shop sells it at 99 while the pack Dagger reads 5", JSON.stringify(daggerRow));

    // The copy, OPENED as a Warden opens it, wears the banner its kind decides
    // (module/table-banner.js; dev:table-banner owns the banner itself). The
    // sheet mode is sticky session-wide, so it is put back to view here.
    const gearBanner = await page.evaluate(async (ids) => {
      const t = ids.map((id) => game.tables.get(id)).find((x) => x?.name === "Market: Gear");
      if (!t) return { error: "no Market: Gear copy" };
      t.sheet.mode = "edit";
      await t.sheet.render(true);
      for (let i = 0; i < 40 && !t.sheet.element?.querySelector("table[data-results]"); i++) await new Promise((r) => setTimeout(r, 150));
      const p = t.sheet.element?.querySelector(".ab-table-role");
      const out = { role: p?.dataset.role ?? null, head: p?.querySelector("strong")?.textContent ?? null };
      t.sheet.mode = "view";
      await t.sheet.close();
      return out;
    }, f.tables);
    check(gearBanner.role === "market" && /Gear/.test(gearBanner.head ?? ""),
      "the copied Market: Gear, opened, wears the Marketplace banner naming its aisle", JSON.stringify(gearBanner));

    /* ------------------------------------------------ 6. a second run keeps */
    console.log("\n6. idempotency");
    const p2 = await planOf("marketplace");
    check(p2.itemsAdd === 0 && p2.actorsAdd === 0 && p2.tablesAdd.length === 0 && p2.tablesKept.length === 4 && p2.tablesKept.every((k) => k.pointingAtPack === 0),
      "re-plan: nothing to add, four tables kept, none pointing at the pack", JSON.stringify(p2.tablesKept));
    const snapBefore2 = await fresh(before);
    await openConfirm("marketplace");
    const run2 = await answerConfirm("copy");
    // A nothing-new run is a Warden looking for the copies: all three folder
    // buttons, the Actors one included (runTableTakeOver fills each folder
    // from the flagged one when a run wrote nothing there).
    check(["tables", "items", "actors"].every((a) => run2.result?.buttons.some((b) => b.action === a)),
      "…and the window still offers the three folder buttons — the Warden came back to find the copies", JSON.stringify(run2.result?.buttons?.map((b) => b.action)));
    const landedActors = await pressResult("actors");
    const actorFolder = await page.evaluate(({ ids, NS }) => ids.map((id) => game.folders.get(id))
      .find((x) => x?.type === "Actor" && !x.getFlag(NS, "takeOverPack"))?.uuid, { ids: f.folders, NS });
    check(landedActors.tab === "actors" && landedActors.expanded.includes(actorFolder),
      "Show … in Actors raises the Actors tab with the Custom Marketplace folder expanded", `${landedActors.tab}, folder ${actorFolder}`);
    const snapAfter2 = await fresh(before);
    const daggerNow = await page.evaluate((id) => game.items.get(id)?.system.cost, dagger.id);
    check(JSON.stringify(snapAfter2) === JSON.stringify(snapBefore2) && daggerNow === 99 && run2.warns.length === 0,
      "second run: no new document, the Dagger still 99, no warning");
    check(run2.result?.lines.some((l) => /Nothing needed copying/.test(l)) && run2.result.lines.some((l) => /Already in your world/.test(l)),
      "…and the result window says nothing needed copying, and how much was left alone", JSON.stringify(run2.result?.lines));
    const blind = await page.evaluate(async ({ MOD, id }) => {
      const mod = await import(MOD);
      const origGet = game.items.get, origFind = game.items.find;
      game.items.get = function (k, ...r) { return k === id ? undefined : origGet.call(this, k, ...r); };
      game.items.find = function (fn, ...r) { return origFind.call(this, (d, ...a) => d.id !== id && fn(d, ...a), ...r); };
      try {
        const p = await mod.planTableTakeOver({ key: "marketplace", pack: "air-bladder.marketplace", folder: "CAIRN.TakeOver.Marketplace.Folder" });
        return { add: p.items.add.map((d) => d.name), kept: p.items.kept.length };
      } finally { delete game.items.get; delete game.items.find; }
    }, { MOD, id: dagger.id });
    check(blind.add.length === 1 && blind.add[0] === "Dagger", "red-first (plan only): blinded to the Dagger, the plan says add it — the existence check is load-bearing", JSON.stringify(blind));

    /* ------------------------------------------------------------ 7. Alice */
    console.log("\n7. Alice's shop");
    const aliceShop = await alicePage.evaluate(async ({ MKT, shippedId, worldUuid }) => {
      const mkt = await import(MKT);
      const cat = await mkt.getMarketplaceCatalog();
      const weapons = cat.categories.find((c) => c.name === "Weapons");
      const gear = cat.categories.find((c) => c.name === "Gear");
      const packDagger = await game.packs.get("air-bladder.weapons").getDocument(shippedId);
      const worldDagger = await fromUuid(worldUuid).catch(() => null);
      const horse = (await game.packs.get("air-bladder.mounts-transports").getDocuments()).find((d) => d.name === "Horse");
      const worldHorse = await fromUuid(`Actor.${horse.id}`).catch(() => null);
      return { dagger: weapons?.items.find((i) => i.name === "Dagger")?.system.cost, gear: gear?.items.length, packDagger: packDagger?.system.cost, worldDaggerSeen: !!worldDagger, worldHorseSeen: !!worldHorse, horseOwnership: worldHorse?.ownership?.default };
    }, { MKT, shippedId: dagger.shippedId, worldUuid: dagger.uuid });
    check(aliceShop.dagger === 99 && aliceShop.gear === gearBefore, "Alice's shop reads the world copies: Dagger 99, Gear complete", JSON.stringify(aliceShop));
    check(aliceShop.packDagger === 5, "control on her client: the pack Dagger still reads 5");
    check(aliceShop.worldHorseSeen, "an ownership-NONE world mount resolves on a player's client (measured)", `default ${aliceShop.horseOwnership}`);

    /* ------------------------------------------- 8. kept by name, warned */
    console.log("\n8. a hand-imported table is kept, never twinned");
    const gearId = await page.evaluate((ids) => ids.find((id) => game.tables.get(id)?.name === "Market: Gear"), f.tables);
    const planted = await page.evaluate(async ({ gearId, shippedUuid }) => {
      await game.tables.get(gearId).delete();
      const t = await RollTable.create({ name: "Market: Gear", formula: "1d1", results: [{ type: CONST.TABLE_RESULT_TYPES.DOCUMENT, name: "Dagger", documentUuid: shippedUuid, range: [1, 1], weight: 1 }] });
      return t.id;
    }, { gearId, shippedUuid: dagger.shippedUuid });
    const p3 = await planOf("marketplace");
    const keptGear = p3.tablesKept.find((k) => k.name === "Market: Gear");
    check(keptGear && keptGear.id === planted && keptGear.pointingAtPack === 1 && p3.tablesAdd.length === 0,
      "plan: the hand-made Market: Gear is KEPT (another id), one row pointing at the pack", JSON.stringify(keptGear));
    await openConfirm("marketplace");
    const run3 = await answerConfirm("copy");
    await closeResult();
    const gearCount = await page.evaluate(() => game.tables.filter((t) => t.name === "Market: Gear").length);
    check(gearCount === 1 && run3.result?.lines.some((l) => l.includes("Market: Gear")),
      "run: still exactly one Market: Gear, and the result window says its rows still point at the shipped items", JSON.stringify(run3.result?.lines));

    /* --------------------------------------------- 9. adopted, not twinned */
    console.log("\n9. an earlier copy under a new id is adopted");
    const adopted = await page.evaluate(async ({ daggerId, shippedId, newTables }) => {
      await game.items.get(daggerId).delete();
      const weapons = newTables.map((id) => game.tables.get(id)).find((t) => t?.name === "Market: Weapons");
      await weapons.delete();
      const pack = game.packs.get("air-bladder.weapons");
      const copy = await game.items.importFromCompendium(pack, shippedId, {}, { keepId: false, renderSheet: false });
      return { id: copy.id, uuid: copy.uuid, source: copy._stats?.compendiumSource, sameId: copy.id === shippedId };
    }, { daggerId: dagger.id, shippedId: dagger.shippedId, newTables: f.tables });
    check(adopted.source === dagger.shippedUuid && !adopted.sameId, "precondition: a Dagger imported under a NEW id, source stamped", JSON.stringify(adopted));
    const p4 = await planOf("marketplace");
    const run4 = await page.evaluate(async (MOD) => {
      const mod = await import(MOD);
      const spec = { key: "marketplace", pack: "air-bladder.marketplace", folder: "CAIRN.TakeOver.Marketplace.Folder" };
      const r = await mod.runTableTakeOver(await mod.planTableTakeOver(spec));
      return { added: r.added, kept: r.kept };
    }, MOD);
    const adoptedRow = await page.evaluate(async ({ shippedId, adoptedUuid }) => {
      const weapons = game.tables.find((t) => t.name === "Market: Weapons");
      const row = weapons?.results.find((r) => r.name === "Dagger");
      return { twin: !!game.items.get(shippedId), rowUuid: row?.documentUuid, adoptedUuid, weaponsId: weapons?.id };
    }, { shippedId: dagger.shippedId, adoptedUuid: adopted.uuid });
    check(p4.addNames.includes("Dagger") === false && !adoptedRow.twin && adoptedRow.rowUuid === adoptedRow.adoptedUuid,
      "the new Weapons table's Dagger row points at the adopted copy and no twin was created under the shipped id", JSON.stringify({ run4, adoptedRow }));

    /* --------------------- 10-pre. an existing pack is named by its own label */
    // The compendium was renamed "Custom 2e Backgrounds" on 2026-09-15, and
    // core cannot rename a world compendium that already exists (the sidebar
    // menu is ownership, lock, duplicate, delete), so a world that made its
    // pack under the old name keeps it — and the confirm must name THAT
    // label, never the key's current text. Planted only when no pack exists
    // (the dev world's empty one is deleted before a sweep; a Warden's real
    // pack is never replaced), removed again before the real run below.
    console.log("\n10-pre. an existing pack is named by its own label");
    const literal = await page.evaluate(async ({ WORLD_BG_PACK }) => {
      if (game.packs.get(WORLD_BG_PACK)) return { skipped: true };
      const label = "Custom Backgrounds (Probe Literal)";
      await foundry.documents.collections.CompendiumCollection.createCompendium({ type: "Item", label, name: WORLD_BG_PACK.split(".")[1] });
      // The sentence that names the pack, up to the name: the confirm's
      // headline ("Create Custom 2e Backgrounds!") carries the key's words
      // too, so the test anchors on the words that introduce the name.
      const strip = (s) => s.replace(/<[^>]+>/g, "");
      const [pre] = strip(game.i18n.format("CAIRN.TakeOver.Cairn2e.How", { pack: " " })).split(" ");
      return { skipped: false, label, keyText: game.i18n.localize("CAIRN.CustomBackgroundsPack"), live: game.packs.get(WORLD_BG_PACK)?.metadata.label, lead: pre.slice(-24) };
    }, { WORLD_BG_PACK });
    if (literal.skipped) {
      console.log("  note  a world pack already exists here — the literal-label leg is skipped (delete it for the full run)");
    } else {
      const cLit = await openConfirm("cairn2e");
      check(!cLit.error && cLit.text.includes(literal.lead + literal.label) && !cLit.text.includes(literal.lead + literal.keyText),
        `the confirm names the pack by its OWN label ("${literal.label}"), not the key's text ("${literal.keyText}")`, JSON.stringify({ lead: literal.lead, text: cLit.text.slice(0, 160) }));
      await answerConfirm("cancel");
      await page.evaluate(async ({ WORLD_BG_PACK }) => { await game.packs.get(WORLD_BG_PACK)?.deleteCompendium(); }, { WORLD_BG_PACK });
      check(literal.live === literal.label && literal.keyText !== literal.label,
        "control: the planted label is what the pack wears, and it differs from the key's text", JSON.stringify(literal));
    }

    /* ------------------------------------------------------ 10. Cairn 2e */
    console.log("\n10. Cairn 2e: the backgrounds and the eleven tables, custom source OFF at entry");
    await page.evaluate((NS) => game.settings.set(NS, "content-source-custom", false), NS);
    // A background switched OFF before the copy (review #31): the stand-in
    // carries the shipped ID under another uuid, and the eye must follow the id.
    const eyeBefore = await page.evaluate(async ({ GEN, NS }) => {
      const gen = await import(GEN);
      const fw = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments()).find((d) => d.name === "Fieldwarden");
      const was = game.settings.get(NS, "disabled-backgrounds") ?? [];
      await game.settings.set(NS, "disabled-backgrounds", []);
      await gen.toggleBackgroundDisabled(fw.uuid);
      return { was, uuid: fw.uuid, id: fw.id, off: game.settings.get(NS, "disabled-backgrounds") };
    }, { GEN, NS });
    check(eyeBefore.off.includes(eyeBefore.uuid), "precondition: the shipped Fieldwarden is switched off by its eye before the copy", eyeBefore.uuid);
    const beforeC2e = await fresh(before);
    // The pack the run creates carries the KEY as its label, not the English:
    // core localizes every pack's label at construction
    // (compendium-collection.mjs:46), so the sidebar follows the language and
    // any rename. Nothing client-side keeps the raw label once constructed —
    // the create handler stores the very object the constructor localizes —
    // so the witness is the create REQUEST, seen on its way out.
    const spyOn = await page.evaluate(() => {
      const CC = foundry.documents.collections.CompendiumCollection;
      window.__abCreateSpy = { seen: [], orig: CC.createCompendium };
      CC.createCompendium = async function (metadata, options) { window.__abCreateSpy.seen.push(metadata?.label); return window.__abCreateSpy.orig.call(this, metadata, options); };
      return !!game.packs.get("world.custom-backgrounds");
    });
    await openConfirm("cairn2e");
    const runC2e = await answerConfirm("copy");
    const spied = await page.evaluate(() => {
      const CC = foundry.documents.collections.CompendiumCollection;
      const s = window.__abCreateSpy; CC.createCompendium = s.orig; delete window.__abCreateSpy;
      return { seen: s.seen, live: game.packs.get("world.custom-backgrounds")?.metadata.label, keyText: game.i18n.localize("CAIRN.CustomBackgroundsPack") };
    });
    if (spyOn) console.log("  note  the pack already existed — the key-label witness had nothing to see");
    else check(spied.seen.length === 1 && spied.seen[0] === "CAIRN.CustomBackgroundsPack" && spied.live === spied.keyText,
      "the run creates the pack with the KEY as its label, and core shows it localized", JSON.stringify(spied));
    const afterC2e = await fresh(before);
    const newC2eTables = afterC2e.tables.filter((id) => !beforeC2e.tables.includes(id));
    check(runC2e.result?.buttons.some((b) => b.action === "backgrounds") && runC2e.result.buttons.some((b) => b.action === "tables"),
      "the result window offers the compendium button and the Rollable Tables button", JSON.stringify(runC2e.result?.buttons?.map((b) => b.action)));
    const openBgLabel = await page.evaluate(() => game.i18n.format("CAIRN.TakeOver.Result.OpenBackgrounds", { pack: game.packs.get("world.custom-backgrounds")?.metadata.label ?? game.i18n.localize("CAIRN.CustomBackgroundsPack") }));
    check(runC2e.result?.buttons.find((b) => b.action === "backgrounds")?.label === openBgLabel && runC2e.result.lines.some((l) => l.includes(PACK_LABEL)),
      `…the Open button and the line name the compendium by its label ("${PACK_LABEL}")`, JSON.stringify(runC2e.result?.buttons.map((b) => b.label)));
    const landedBg = await pressResult("backgrounds");
    check(landedBg.packWindows?.includes(WORLD_BG_PACK), "the compendium button opens that compendium", JSON.stringify(landedBg.packWindows));

    const eye1 = await page.evaluate(async ({ GEN, WORLD_BG_PACK, id }) => {
      const gen = await import(GEN);
      const standIn = (await game.packs.get(WORLD_BG_PACK).getDocuments()).find((d) => d.id === id);
      const pool = await gen.getBackgroundsFor("2e");
      return {
        standInUuid: standIn?.uuid ?? null, poolHasId: pool.some((b) => b.id === id),
        // `typeof`, so a pre-fix build (no such export) reds this leg instead
        // of throwing past every leg after it.
        byId: standIn && typeof gen.isBackgroundDisabled === "function" ? gen.isBackgroundDisabled(standIn) : null,
        // CONTROL: the uuid set the eye used to read cannot see the stand-in.
        oldMiss: standIn ? !gen.disabledBackgrounds().has(standIn.uuid) : null,
      };
    }, { GEN, WORLD_BG_PACK, id: eyeBefore.id });
    check(!!eye1.standInUuid && !eye1.poolHasId && eye1.byId, "after the copy the switched-off Fieldwarden is STILL out of the pool — by id, its stand-in included", JSON.stringify(eye1));
    check(eye1.oldMiss, "CONTROL: the uuid set the eye used to read cannot see the stand-in — the id test is what keeps it off");
    const aliceEye = await alicePage.evaluate(async ({ GEN, id }) => {
      const gen = await import(GEN);
      return (await gen.getBackgroundsFor("2e")).some((b) => b.id === id);
    }, { GEN, id: eyeBefore.id });
    check(aliceEye === false, "…and Alice's pool has no Fieldwarden either");
    const eye2 = await page.evaluate(async ({ GEN, NS, id, standInUuid }) => {
      const gen = await import(GEN);
      const before = new Set(foundry.applications.instances.keys());
      const pending = gen.promptBackground("2e", null);          // NOT awaited — a modal
      let dialog = null;
      for (let i = 0; i < 100 && !dialog; i++) {
        dialog = [...foundry.applications.instances.values()].find((app) => !before.has(app.id) && app.element?.querySelector(".bg-pick-list")) ?? null;
        if (!dialog) await new Promise((r) => setTimeout(r, 100));
      }
      const row = dialog?.element.querySelector(`input[name="bg"][value="${standInUuid}"]`)?.closest(".bg-pick-row") ?? null;
      const greyed = !!row?.classList.contains("bg-pick-off");
      const dead = !!row?.querySelector("input")?.disabled;
      row?.querySelector(".bg-pick-eye")?.click();
      for (let i = 0; i < 100 && row?.classList.contains("bg-pick-off"); i++) await new Promise((r) => setTimeout(r, 100));
      const live = !!row && !row.classList.contains("bg-pick-off") && !row.querySelector("input").disabled;
      const offAfter = game.settings.get(NS, "disabled-backgrounds") ?? [];
      dialog?.element.querySelector('button[data-action="cancel"]')?.click();
      await pending;
      const poolAfter = await gen.getBackgroundsFor("2e");
      return { rowFound: !!row, greyed, dead, live, offAfter, poolAfterHasId: poolAfter.some((b) => b.id === id) };
    }, { GEN, NS, id: eyeBefore.id, standInUuid: eye1.standInUuid });
    check(eye2.rowFound && eye2.greyed && eye2.dead, "the picker greys the stand-in's row with a dead radio", JSON.stringify({ rowFound: eye2.rowFound, greyed: eye2.greyed, dead: eye2.dead }));
    check(eye2.live && eye2.offAfter.every((u) => !u.endsWith(`.${eyeBefore.id}`)) && eye2.poolAfterHasId,
      "…and its eye switches it back on live, clearing every stored uuid with that id — the shipped one's too", JSON.stringify(eye2.offAfter));
    await page.evaluate(({ NS, was }) => game.settings.set(NS, "disabled-backgrounds", was), { NS, was: eyeBefore.was });

    const bg = await page.evaluate(async ({ GEN, NS, WORLD_BG_PACK }) => {
      const gen = await import(GEN);
      const pack = game.packs.get(WORLD_BG_PACK);
      const docs = pack ? await pack.getDocuments() : [];
      const shipped = [];
      for (const c of ["air-bladder.backgrounds-2e", "air-bladder.backgrounds-custom"]) shipped.push(...await game.packs.get(c).getDocuments());
      const byId = new Map(shipped.map((d) => [d.id, d]));
      const copies = docs.filter((d) => byId.has(d.id));
      const shaped = copies.filter((d) => d.name === byId.get(d.id).name && !/\(Copy\)/.test(d.name) && d.system.source === "2e" && d._stats?.compendiumSource === byId.get(d.id).uuid).length;
      const pool = await gen.getBackgroundsFor("2e");
      const poolWorld = pool.filter((b) => b.uuid.startsWith(`Compendium.${WORLD_BG_PACK}.`)).length;
      const poolShipped = pool.filter((b) => byId.has(b.id) && !b.uuid.startsWith(`Compendium.${WORLD_BG_PACK}.`)).length;
      const groups = await gen.getBackgroundsByArchetype("2e");
      const groupOf = (name) => groups.find((g) => g.backgrounds.some((b) => b.name === name))?.archetype;
      const fieldwarden = shipped.find((d) => d.name === "Fieldwarden");
      const custom7 = shipped.filter((d) => d.uuid.startsWith("Compendium.air-bladder.backgrounds-custom.")).map((d) => d.name);
      return {
        exists: !!pack, copies: copies.length, shaped,
        setting: game.settings.get(NS, "content-source-custom"),
        pool: pool.length, poolWorld, poolShipped,
        fieldwardenGroup: groupOf("Fieldwarden"), fieldwardenArchetype: fieldwarden?.system.archetype,
        custom7Groups: [...new Set(custom7.map(groupOf))],
        groupNames: groups.map((g) => `${g.archetype}:${g.backgrounds.length}`),
      };
    }, { GEN, NS, WORLD_BG_PACK });
    check(bg.exists && bg.copies === 27 && bg.shaped === 27,
      "27 copies under the shipped ids and names, no (Copy), source 2e, source stamped", JSON.stringify({ copies: bg.copies, shaped: bg.shaped }));
    check(bg.setting === true, "the custom source is switched on");
    check(bg.pool >= 27 && bg.poolWorld === 27 && bg.poolShipped === 0, "the 2e pool holds the 27 copies and no original", `${bg.pool} / ${bg.poolWorld} / ${bg.poolShipped}`);
    check(bg.fieldwardenGroup && bg.fieldwardenGroup === (bg.fieldwardenArchetype || "Other"), "a canon stand-in keeps its ARCHETYPE group in the picker", `${bg.fieldwardenGroup} (${bg.groupNames.join(" ")})`);
    check(bg.custom7Groups.length === 1 && bg.custom7Groups[0] === "Custom", "the seven shipped-custom stand-ins stay under Custom");
    const bgRed = await page.evaluate(async (GEN) => {
      const gen = await import(GEN);
      const pack = game.packs.get("air-bladder.backgrounds-2e");
      const orig = pack.getIndex;
      pack.getIndex = async () => new foundry.utils.Collection();
      try {
        const groups = await gen.getBackgroundsByArchetype("2e");
        return groups.find((g) => g.backgrounds.some((b) => b.name === "Fieldwarden"))?.archetype;
      } finally { delete pack.getIndex; if (pack.getIndex !== orig) pack.getIndex = orig; }
    }, GEN);
    check(bgRed === "Custom", "red-first: with the canon index shadowed empty the stand-in falls under Custom", bgRed);
    const aliceGroups = await alicePage.evaluate(async (GEN) => {
      const gen = await import(GEN);
      const groups = await gen.getBackgroundsByArchetype("2e");
      return { groups: groups.map((g) => `${g.archetype}:${g.backgrounds.length}`), fieldwarden: groups.find((g) => g.backgrounds.some((b) => b.name === "Fieldwarden"))?.archetype, world: groups.flatMap((g) => g.backgrounds).every((b) => b.uuid.startsWith("Compendium.world.custom-backgrounds.")) };
    }, GEN);
    check(aliceGroups.fieldwarden === bg.fieldwardenGroup && aliceGroups.world, "Alice's picker: the same groups, every row a world copy", JSON.stringify(aliceGroups));

    const c2e = await page.evaluate(async ({ ids, NS, CPD, CAIRN_2E_TABLES }) => {
      const cpd = await import(CPD);
      // The shipped table behind each declaration — Scars from UTILS.
      const shippedOf = new Map();
      for (const decl of CAIRN_2E_TABLES) {
        const [pack, name] = decl.split(";");
        shippedOf.set(name, (await game.packs.get(pack).getDocuments()).find((d) => d.name === name));
      }
      const tables = ids.map((id) => game.tables.get(id)).filter(Boolean);
      const out = { made: tables.map((t) => t.name).sort(), folder: null, verbatim: 0, rows: 0, bondFlags: 0, bondRows: 0, resolved: {}, spells: null, scarsSource: null, scarsIsChecklist: null };
      const folder = tables[0]?.folder;
      out.folder = folder ? { name: folder.name, flag: folder.getFlag(NS, "takeOver"), all: tables.every((t) => t.folder?.id === folder.id) } : null;
      for (const t of tables) {
        const s = shippedOf.get(t.name);
        if (!s) continue;
        const a = [...t.results].sort((x, y) => x.range[0] - y.range[0]).map((r) => r.description ?? r.name);
        const b = [...s.results].sort((x, y) => x.range[0] - y.range[0]).map((r) => r.description ?? r.name);
        out.rows += a.length;
        if (JSON.stringify(a) === JSON.stringify(b)) out.verbatim++;
      }
      const bonds = tables.find((t) => t.name === "Bonds");
      for (const r of bonds?.results ?? []) {
        out.bondRows++;
        const fl = r.flags?.["air-bladder"];
        if (fl && "gold" in fl && Array.isArray(fl.items)) out.bondFlags++;
      }
      for (const decl of CAIRN_2E_TABLES) {
        const t = await cpd.findDeclaredTable(decl);
        out.resolved[decl.split(";")[1]] = t ? (t.pack ? "pack" : "world") : "none";
      }
      const spells = await cpd.findDeclaredTable("air-bladder.tables-2e;Spells — Canon (1d100)");
      out.spells = spells ? (spells.pack ? "pack" : "world") : "none";
      // The world Scars: sourced from utils, sharing no row with the checklist.
      const scars = tables.find((t) => t.name === "Scars");
      out.scarsSource = scars?._stats?.compendiumSource ?? null;
      const checklist = (await game.packs.get("air-bladder.tables-2e").getDocuments()).find((d) => d.name === "Scars");
      const labels = new Set([...checklist.results].map((r) => r.description));
      out.scarsIsChecklist = scars ? [...scars.results].some((r) => labels.has(r.description)) : null;
      return out;
    }, { ids: newC2eTables, NS, CPD, CAIRN_2E_TABLES });
    check(c2e.made.length === 11 && JSON.stringify(c2e.made) === JSON.stringify([...CAIRN_2E_NAMES].sort()),
      "the eleven 2e tables are in the world under their own names", c2e.made.join(", "));
    check(c2e.folder?.flag === "cairn2e" && c2e.folder.all, "…all in one flagged folder", JSON.stringify(c2e.folder));
    check(c2e.verbatim === 11, "…every row of every one copied verbatim", `${c2e.rows} rows`);
    check(c2e.bondRows === 20 && c2e.bondFlags === 20, "…and Bonds' gold/items payload rode along on all 20 rows");
    check(/^Compendium\.air-bladder\.utils\./.test(c2e.scarsSource ?? "") && c2e.scarsIsChecklist === false,
      "…the world Scars is UTILS' list — the SRD prose the damage card rolls — and shares no row with the sheet checklist", c2e.scarsSource);
    check(Object.values(c2e.resolved).every((v) => v === "world"), "every 2e declaration now resolves to the WORLD copy", JSON.stringify(c2e.resolved));
    check(c2e.spells === "pack", "control: the Spells table was NOT copied and still resolves to the compendium", c2e.spells);
    // The damage flow, with the copy in the world: the card prints the prose.
    const scarCard = await page.evaluate(async ({ DMG, ids }) => {
      const dmg = await import(DMG);
      const scars = ids.map((id) => game.tables.get(id)).find((t) => t?.name === "Scars");
      const strip = (html) => String(html ?? "").replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
      const prose = strip([...scars.results].find((r) => Number.between(3, r.range[0], r.range[1]))?.description);
      const checklist = (await game.packs.get("air-bladder.tables-2e").getDocuments()).find((d) => d.name === "Scars");
      const label = strip([...checklist.results].find((r) => Number.between(3, r.range[0], r.range[1]))?.description);
      const before = new Set(game.messages.map((m) => m.id));
      await dmg.Damage._rollScarsTable(3);
      let card = null;
      for (let i = 0; i < 40 && !card; i++) { card = game.messages.find((m) => !before.has(m.id)) ?? null; if (!card) await new Promise((r) => setTimeout(r, 100)); }
      const content = strip(card?.content);
      const out = { prose, label, posted: !!card, cardHasProse: !!prose && content.includes(prose.slice(0, 30)), cardHasLabel: !!label && content.includes(label) };
      await card?.delete();
      return out;
    }, { DMG, ids: newC2eTables });
    check(scarCard.posted && scarCard.cardHasProse && !scarCard.cardHasLabel,
      `a scar card rolled for 3 damage prints the copy's prose and never the checklist label "${scarCard.label}"`, JSON.stringify(scarCard));
    const reworded = await page.evaluate(async ({ CPD, ids }) => {
      const cpd = await import(CPD);
      const bonds = ids.map((id) => game.tables.get(id)).find((t) => t?.name === "Bonds");
      const keep = [...bonds.results].map((r) => r.id);
      await bonds.deleteEmbeddedDocuments("TableResult", keep);
      await bonds.createEmbeddedDocuments("TableResult", [{ type: CONST.TABLE_RESULT_TYPES.TEXT, description: "A probe owes you a favour.", range: [1, 1], weight: 1 }]);
      await bonds.update({ formula: "1d1" });
      return cpd.rollTableText("air-bladder.tables-2e;Bonds");
    }, { CPD, ids: newC2eTables });
    check(/probe owes you a favour/.test(reworded ?? ""), "a reworded row is what a Bonds roll returns", JSON.stringify(reworded));

    /* ------------------ 10b. a renamed copy survives a re-run (review #31) */
    console.log("\n10b. a renamed copy holding the shipped id survives a re-run, and both windows name the folder");
    // Park the Omens copy under another name with an edit; it STILL holds the
    // shipped id, which is exactly the id `keepId` fought it for. And rename
    // the folder, so the windows can only be naming the document.
    const parked = await page.evaluate(async ({ ids }) => {
      const omens = ids.map((id) => game.tables.get(id)).find((t) => t?.name === "Omens");
      const shipped = (await game.packs.get("air-bladder.tables-2e").getIndex()).find((e) => e.name === "Omens");
      const folder = omens.folder;
      await folder.update({ name: "PROBE 2e Folder" });
      await omens.update({ name: "Omens (parked)" });
      const row = omens.results.contents[0];
      await omens.updateEmbeddedDocuments("TableResult", [{ _id: row.id, description: "<p>A probe parked this omen.</p>" }]);
      return { id: omens.id, holdsShippedId: omens.id === shipped._id, folderId: folder.id, rows: omens.results.size };
    }, { ids: newC2eTables });
    check(parked.holdsShippedId, "precondition: the parked Omens still holds the SHIPPED id — the id a keepId create would have replaced it under", parked.id);
    const cP = await openConfirm("cairn2e");
    check(!cP.error && cP.text.includes("PROBE 2e Folder") && /1 table/.test(cP.counts ?? ""),
      "the confirm names the folder by its document's name and counts one table to add", cP.counts);
    const runP = await answerConfirm("copy");
    await closeResult();
    const afterP = await page.evaluate(({ id }) => {
      const parkedDoc = game.tables.get(id);
      const fresh = game.tables.filter((t) => t.name === "Omens");
      return {
        parkedName: parkedDoc?.name ?? null, parkedEdit: parkedDoc?.results.contents[0]?.description ?? "",
        fresh: fresh.length, freshId: fresh[0]?.id ?? null, freshRows: fresh[0]?.results.size ?? 0, freshFolder: fresh[0]?.folder?.name ?? null,
      };
    }, { id: parked.id });
    check(afterP.parkedName === "Omens (parked)" && /probe parked/.test(afterP.parkedEdit), "the parked copy SURVIVES with its edit — the re-run overwrote nothing", JSON.stringify(afterP));
    check(afterP.fresh === 1 && afterP.freshId !== parked.id && afterP.freshRows === parked.rows && afterP.freshFolder === "PROBE 2e Folder",
      "…and a fresh Omens landed under a DIFFERENT id in the flagged folder, the shipped rows intact", JSON.stringify(afterP));
    check(runP.result?.lines.some((l) => l.includes("PROBE 2e Folder")) && !runP.result?.lines.some((l) => l.includes("Custom 2e Character Creation")),
      "the result window names the folder by its document's name, not the key's default", JSON.stringify(runP.result?.lines));
    check(runP.result?.buttons.find((b) => b.action === "tables")?.label.includes("PROBE 2e Folder"),
      "…and so does its Rollable Tables button", JSON.stringify(runP.result?.buttons?.map((b) => b.label)));
    await page.evaluate(({ folderId }) => game.folders.get(folderId)?.update({ name: "Custom 2e Character Creation" }), { folderId: parked.folderId });

    /* ------------------------------------------- 11. backgrounds idempotency */
    console.log("\n11. a second backgrounds run keeps a rename, pack locked");
    const bg2 = await page.evaluate(async ({ MOD, WORLD_BG_PACK, NS }) => {
      const mod = await import(MOD);
      const pack = game.packs.get(WORLD_BG_PACK);
      const docs = await pack.getDocuments();
      const fw = docs.find((d) => d.name === "Fieldwarden");
      await fw.update({ name: "Fieldwarden of the Probe" });
      await pack.configure({ locked: true });
      // A run with nothing to add changes NOTHING — the custom source included
      // (review #31: it was switched on by every run, whatever it wrote).
      await game.settings.set(NS, "content-source-custom", false);
      let r;
      try { r = await mod.runBackgroundsTakeOver(await mod.planBackgroundsTakeOver()); }
      finally { await pack.configure({ locked: false }); }
      const settingAfterNoop = game.settings.get(NS, "content-source-custom");
      await game.settings.set(NS, "content-source-custom", true);
      const after = await pack.getDocuments();
      const p = await mod.planBackgroundsTakeOver();
      const origIdx = pack.getIndex;
      pack.getIndex = async () => new foundry.utils.Collection();
      let blind;
      try { blind = (await mod.planBackgroundsTakeOver()).add.length; }
      finally { delete pack.getIndex; if (pack.getIndex !== origIdx) pack.getIndex = origIdx; }
      return { r, renamed: after.some((d) => d.name === "Fieldwarden of the Probe"), count: after.length, kept: p.kept.length, add: p.add.length, blind, settingAfterNoop };
    }, { MOD, WORLD_BG_PACK, NS });
    check(bg2.r?.added === 0 && bg2.r?.kept === 27 && bg2.count === 27 && bg2.renamed && bg2.r?.locked === false,
      "locked pack, second run: 0 added, 27 kept, the rename survives, no refusal (nothing to add needs no unlock)", JSON.stringify(bg2));
    check(bg2.settingAfterNoop === false, "…and a run that added nothing left the custom source OFF — it switches on only inside a write");
    check(bg2.blind === 27 && bg2.add === 0, "red-first (plan only): the world index shadowed empty → 27 to add", `${bg2.blind}`);

    // A LOCKED pack with a background MISSING: the confirm says so and counts
    // no backgrounds, rather than promising one the run will refuse.
    const lockedSetup = await page.evaluate(async ({ WORLD_BG_PACK }) => {
      const pack = game.packs.get(WORLD_BG_PACK);
      const prowler = (await pack.getDocuments()).find((d) => d.name === "Prowler");
      await prowler.delete();
      await pack.configure({ locked: true });
      return { deleted: !!prowler, locked: pack.locked };
    }, { WORLD_BG_PACK });
    const lockedLine = await page.evaluate(() => game.i18n.format("CAIRN.TakeOver.PackLockedConfirm", { pack: game.packs.get("world.custom-backgrounds")?.metadata.label ?? game.i18n.localize("CAIRN.CustomBackgroundsPack") }));
    const cl = await openConfirm("cairn2e");
    check(lockedSetup.deleted && lockedSetup.locked && !cl.error && cl.text.includes(lockedLine) && !/This will copy/.test(cl.counts ?? "") && !/Everything this copies/.test(cl.counts ?? ""),
      "locked pack, one background missing: the confirm carries the locked line, promises no copy and does not claim everything is here", JSON.stringify({ counts: cl.counts }));
    await answerConfirm("cancel");
    const unlocked = await page.evaluate(async ({ MOD, WORLD_BG_PACK }) => {
      const mod = await import(MOD);
      const pack = game.packs.get(WORLD_BG_PACK);
      await pack.configure({ locked: false });
      const r = await mod.runBackgroundsTakeOver(await mod.planBackgroundsTakeOver());
      return { added: r.added, count: (await pack.getIndex()).size };
    }, { MOD, WORLD_BG_PACK });
    check(unlocked.added === 1 && unlocked.count === 27, "unlocked, a run puts the missing Prowler back: 27 again", JSON.stringify(unlocked));

    /* --------------------------------------------------------- 12. Barebones */
    console.log("\n12. the Barebones creation tables, and the reader");
    await page.evaluate((NS) => game.settings.set(NS, "content-source-barebones", true), NS);
    const beforeBB = await fresh(before);
    await openConfirm("barebones");
    const runBB = await answerConfirm("copy");
    await closeResult();
    const afterBB = await fresh(before);
    const newBBTables = afterBB.tables.filter((id) => !beforeBB.tables.includes(id));
    check(newBBTables.length === 6, "six Barebones tables created", `result: ${JSON.stringify(runBB.result?.lines)}`);
    const bb = await page.evaluate(async ({ ids, NS }) => {
      const pack = game.packs.get("air-bladder.tables-barebones");
      const shipped = await pack.getDocuments();
      const tables = ids.map((id) => game.tables.get(id)).filter(Boolean);
      const out = { sameId: 0, folder: null, intoPack: [], unresolvable: [], tierRows: [], formulas: [] };
      const folder = tables[0]?.folder;
      out.folder = folder ? { name: folder.name, flag: folder.getFlag(NS, "takeOver"), all: tables.every((t) => t.folder?.id === folder.id) } : null;
      for (const t of tables) {
        if (shipped.some((s) => s.id === t.id)) out.sameId++;
        out.formulas.push(`${t.name}=${t._source.formula}`);
        for (const r of t.results) {
          if (String(r.documentUuid ?? "").startsWith("Compendium.")) out.intoPack.push(`${t.name}: ${r.documentUuid}`);
          if (r.documentUuid && !await fromUuid(r.documentUuid)) out.unresolvable.push(`${t.name}: ${r.documentUuid}`);
        }
      }
      const weapon = tables.find((t) => t.name === "Barebones: Creation - Weapon");
      for (const r of weapon?.results ?? []) {
        if (!String(r.documentUuid ?? "").startsWith("RollTable.")) continue;
        const id = r.documentUuid.split(".")[1];
        out.tierRows.push({ uuid: r.documentUuid, isNewWorldTable: ids.includes(id), name: game.tables.get(id)?.name });
      }
      return out;
    }, { ids: newBBTables, NS });
    check(bb.sameId === 6 && bb.folder?.flag === "barebones" && bb.folder.all, "…under the shipped ids, all in the Custom Barebones Character Creation folder", JSON.stringify(bb.folder));
    check(bb.intoPack.length === 0 && bb.unresolvable.length === 0, "…no row still points into a compendium, and every row resolves",
      `${bb.intoPack.length} into pack, ${bb.unresolvable.length} dangling`);
    check(bb.tierRows.length === 3 && bb.tierRows.every((r) => r.isNewWorldTable), "…and the Weapon table's three rows point at the WORLD tier tables", JSON.stringify(bb.tierRows.map((r) => r.name)));
    const newBBItems = afterBB.items.filter((id) => !beforeBB.items.includes(id));
    const bbTree = await page.evaluate(({ items, NS }) => {
      const packOf = (d) => String(d._stats?.compendiumSource ?? "").split(".").slice(1, 3).join(".");
      const parent = game.folders.find((f) => f.type === "Item" && f.getFlag(NS, "takeOver") === "barebones" && !f.getFlag(NS, "takeOverPack"));
      const docs = items.map((id) => game.items.get(id)).filter(Boolean);
      const filed = docs.filter((d) => {
        const fo = d.folder;
        return fo && fo.folder?.id === parent?.id && fo.getFlag(NS, "takeOverPack") === packOf(d) && fo.name === game.packs.get(packOf(d))?.metadata.label;
      }).length;
      const children = game.folders.filter((f) => f.getFlag(NS, "takeOver") === "barebones" && f.getFlag(NS, "takeOverPack")).map((f) => f.name).sort();
      return { filed, children, sourcePacks: [...new Set(docs.map(packOf))].length };
    }, { items: newBBItems, NS });
    check(newBBItems.length > 0 && bbTree.filed === newBBItems.length && bbTree.children.length === bbTree.sourcePacks,
      "the new Barebones items sit in a subfolder per source compendium under Custom Barebones Character Creation, kept items left where they were",
      `${bbTree.filed}/${newBBItems.length} filed; ${bbTree.children.join(", ")}`);

    // The reader: a row pointing at a WORLD item hands over THAT item. Both sides
    // are measured with the SAME one-row table; only the row's target moves.
    const armour = await page.evaluate(async ({ ids, GEN }) => {
      const gen = await import(GEN);
      const packArmor = await game.packs.get("air-bladder.armor").getDocuments();
      const gambeson = packArmor.find((d) => d.name === "Gambeson");
      const world = game.items.get(gambeson.id);
      await world.update({ "system.armor": 3 });
      const table = ids.map((id) => game.tables.get(id)).find((t) => t?.name === "Barebones: Creation - Armor");
      const point = async (uuid) => {
        await table.deleteEmbeddedDocuments("TableResult", [...table.results].map((r) => r.id));
        await table.createEmbeddedDocuments("TableResult", [{ type: CONST.TABLE_RESULT_TYPES.DOCUMENT, name: "Gambeson", documentUuid: uuid, range: [1, 1], weight: 1 }]);
        await table.update({ formula: "1d1" });
      };
      const wear = async () => {
        const actor = await gen.createCharacter({ source: "barebones", waitForDice: false });
        const worn = actor?.items.find((i) => i.name === "Gambeson");
        const out = { armor: worn?.system.armor ?? null, id: actor?.id };
        return out;
      };
      await point(`Item.${world.id}`);
      const fromWorld = await wear();
      await point(gambeson.uuid);
      const fromPack = await wear();
      return { fromWorld, fromPack, packArmor: gambeson.system.armor, worldArmor: world.system.armor };
    }, { ids: newBBTables, GEN });
    check(armour.worldArmor === 3 && armour.packArmor === 1, "precondition: the world Gambeson is armor 3, the pack's armor 1", JSON.stringify({ w: armour.worldArmor, p: armour.packArmor }));
    check(armour.fromWorld.armor === 3, "a row pointing at the WORLD item hands over THAT item (armor 3)", JSON.stringify(armour.fromWorld));
    check(armour.fromPack.armor === 1, "control: the same table pointing at the PACK item resolves by name (armor 1)", JSON.stringify(armour.fromPack));

    /* --------------------------------------------------------- 13. spells */
    console.log("\n13. the spell table, and the pool reading it");
    const pre13 = await page.evaluate(async ({ GEN, CPD }) => {
      const gen = await import(GEN);
      const cpd = await import(CPD);
      const glog = !!game.settings.get("air-bladder", "enable-glog-magic");
      const decl = CONFIG.Cairn.characterGenerator2e.spells[glog ? "glog" : "canon"];
      const [pack, name] = cpd.compendiumInfoFromString(decl);
      const shipped = await cpd.findDeclaredTable(decl);
      const draws = [];
      for (let i = 0; i < 12; i++) draws.push(await gen.randomSpellbookDoc());
      return {
        glog, decl, pack, name, shippedInPack: !!shipped?.pack, rows: shipped?.results.size ?? 0,
        dealt: draws.filter(Boolean).length, fromPack: draws.filter((d) => d?.pack).length,
      };
    }, { GEN, CPD });
    check(pre13.shippedInPack && pre13.dealt === 12 && pre13.fromPack === 12,
      `before the copy: "${pre13.name}" resolves to the pack and twelve draws all come from the compendium`, `${pre13.rows} rows`);
    const beforeSp = await fresh(before);
    await openConfirm("spells");
    const runSp = await answerConfirm("copy");
    const afterSp = await fresh(before);
    const newSpTables = afterSp.tables.filter((id) => !beforeSp.tables.includes(id));
    const newSpItems = afterSp.items.filter((id) => !beforeSp.items.includes(id));
    check(newSpTables.length === 1 && newSpItems.length === ps0.itemsAdd && afterSp.actors.length === beforeSp.actors.length,
      "one table and every missing spellbook created, no actor", `${newSpItems.length} items; result: ${JSON.stringify(runSp.result?.lines)}`);
    check(runSp.result?.lines.some((l) => /Spells/.test(l) && /Rollable Tables/.test(l) && /Items/.test(l) && !/Actors/.test(l)),
      "the result window names Rollable Tables and Items under Spells, and not Actors", JSON.stringify(runSp.result?.lines));
    check(["tables", "items", "close"].every((a) => runSp.result?.buttons.some((b) => b.action === a))
      && !runSp.result.buttons.some((b) => b.action === "backgrounds" || b.action === "actors"),
      "…with the Rollable Tables and Items buttons and Close — no Actors button, no compendium button", JSON.stringify(runSp.result?.buttons?.map((b) => b.action)));
    await closeResult();
    const sp = await page.evaluate(async ({ id, NS, GEN, CPD, decl, newItems }) => {
      const gen = await import(GEN);
      const cpd = await import(CPD);
      const t = game.tables.get(id);
      const pack = game.packs.get(cpd.compendiumInfoFromString(decl)[0]);
      const shippedId = (await pack.getIndex()).find((e) => e.name === t.name)?._id;
      const rows = [...t.results];
      let world = 0, resolves = 0, spellbooks = 0;
      for (const r of rows) {
        if (/^Item\.[A-Za-z0-9]{16}$/.test(r.documentUuid ?? "")) world++;
        const doc = await fromUuid(r.documentUuid).catch(() => null);
        if (doc && doc.name === r.name) resolves++;
        if (doc?.type === "spellbook" && !doc.pack) spellbooks++;
      }
      const resolved = await cpd.findDeclaredTable(decl);
      const rowIds = new Set(rows.map((r) => String(r.documentUuid).split(".")[1]));
      const draws = [];
      for (let i = 0; i < 12; i++) draws.push(await gen.randomSpellbookDoc());
      // One source compendium, so the spellbooks sit directly under the Spells
      // parent and no subfolder exists for this kind.
      const first = newItems.length ? game.items.get(newItems[0]) : null;
      return {
        sameId: !!shippedId && t.id === shippedId, folderFlag: t.folder?.getFlag(NS, "takeOver") ?? null,
        rows: rows.length, world, resolves, spellbooks, formula: t._source.formula,
        declWorld: !!resolved && !resolved.pack && resolved.id === t.id,
        drawsWorld: draws.filter((d) => d && !d.pack).length, drawsInRows: draws.filter((d) => d && rowIds.has(d.id)).length,
        itemDirect: !first || (first.folder?.getFlag(NS, "takeOver") === "spells" && !first.folder.getFlag(NS, "takeOverPack")),
        subfolders: game.folders.filter((f) => f.getFlag(NS, "takeOver") === "spells" && f.getFlag(NS, "takeOverPack")).length,
      };
    }, { id: newSpTables[0], NS, GEN, CPD, decl: pre13.decl, newItems: newSpItems });
    check(sp.sameId && sp.folderFlag === "spells" && sp.rows === pre13.rows && sp.world === sp.rows && sp.resolves === sp.rows && sp.spellbooks === sp.rows && sp.formula === `1d${sp.rows}`,
      `the table: shipped id, in the flagged Custom Spells folder, ${sp.rows} rows all pointing at WORLD spellbooks that resolve, stored formula 1d${sp.rows}`, JSON.stringify(sp));
    check(sp.declWorld, "the declaration now resolves to the WORLD copy");
    check(sp.itemDirect && sp.subfolders === 0, "the spellbooks sit directly under the Spells parent — one source compendium, so no subfolder", `${sp.subfolders} subfolders`);
    check(sp.drawsWorld === 12 && sp.drawsInRows === 12, "twelve draws all hand over WORLD spellbooks off the copied table (twelve from the pack before)", `${sp.drawsWorld}/${sp.drawsInRows}`);
    // Opened, the copy wears the spells banner — and its description no longer
    // tells the Warden to press the button they just pressed (the importer's
    // "To make it yours…" sentence went on 2026-09-15; the copy inherits the
    // description verbatim).
    const spBanner = await page.evaluate(async (id) => {
      const t = game.tables.get(id);
      t.sheet.mode = "edit";
      await t.sheet.render(true);
      for (let i = 0; i < 40 && !t.sheet.element?.querySelector("table[data-results]"); i++) await new Promise((r) => setTimeout(r, 150));
      const p = t.sheet.element?.querySelector(".ab-table-role");
      const out = { role: p?.dataset.role ?? null, description: t.description ?? "" };
      t.sheet.mode = "view";
      await t.sheet.close();
      return out;
    }, newSpTables[0]);
    check(spBanner.role === "spells", "the copied spell table, opened, wears the spells banner", spBanner.role);
    check(!/make it yours|Create a Custom/i.test(spBanner.description),
      "…and its description names no button — the copy inherits it verbatim", spBanner.description.slice(-70));

    // The reader, both ways off ONE row — a row at the world copy hands over
    // THAT document, the same row at the pack's hands over the pack's. Only a
    // spellbook THIS run created is edited; a kept one is somebody's document.
    if (newSpItems.length) {
      const spReader = await page.evaluate(async ({ id, GEN, itemId }) => {
        const gen = await import(GEN);
        const t = game.tables.get(id);
        const world = game.items.get(itemId);
        await world.update({ "system.description": "<p>A probe wrote this spell.</p>" });
        const packUuid = world._stats?.compendiumSource ?? null;
        const point = async (uuid) => {
          await t.deleteEmbeddedDocuments("TableResult", [...t.results].map((r) => r.id));
          await t.createEmbeddedDocuments("TableResult", [{ type: CONST.TABLE_RESULT_TYPES.DOCUMENT, name: world.name, documentUuid: uuid, range: [1, 1], weight: 1 }]);
          await t.update({ formula: "1d1" });
        };
        const shape = (d) => ({ pack: d?.pack ?? null, probeText: /probe wrote/.test(d?.system?.description ?? "") });
        await point(world.uuid);
        const fromWorld = shape(await gen.randomSpellbookDoc());
        await point(packUuid);
        const fromPack = shape(await gen.randomSpellbookDoc());
        return { packUuid, fromWorld, fromPack };
      }, { id: newSpTables[0], GEN, itemId: newSpItems[0] });
      check(!!spReader.packUuid && spReader.fromWorld.pack === null && spReader.fromWorld.probeText,
        "a row pointing at the WORLD spellbook hands over THAT document — the edit is what a character receives", JSON.stringify(spReader.fromWorld));
      check(!!spReader.fromPack.pack && !spReader.fromPack.probeText,
        "control: the same row pointing at the PACK spellbook hands over the pack's", JSON.stringify(spReader.fromPack));
    } else {
      console.log("  note  every spellbook was already in this world under its shipped id; the reader legs need a copy this run created and were skipped");
    }
  });
} catch (e) {
  fail(`probe threw: ${e.stack ?? e}`);
} finally {
  try {
    if (before) {
      const f = await fresh(before);
      const swept = await page.evaluate(async ({ f, WORLD_BG_PACK, bgPackExisted }) => {
        let n = 0;
        if (f.tables.length) { await RollTable.implementation.deleteDocuments(f.tables); n += f.tables.length; }
        if (f.items.length) { await Item.implementation.deleteDocuments(f.items); n += f.items.length; }
        if (f.actors.length) { await Actor.implementation.deleteDocuments(f.actors); n += f.actors.length; }
        // Subfolders first, then parents: never both in one batch, so a
        // parent's cascade cannot make the same batch's child a stale delete.
        const [subs, tops] = f.folders.reduce(([s, t], id) => (game.folders.get(id)?.folder ? [[...s, id], t] : [s, [...t, id]]), [[], []]);
        if (subs.length) { await Folder.implementation.deleteDocuments(subs); n += subs.length; }
        if (tops.length) { await Folder.implementation.deleteDocuments(tops); n += tops.length; }
        const pack = game.packs.get(WORLD_BG_PACK);
        if (pack) {
          if (pack.locked) await pack.configure({ locked: false });
          if (!bgPackExisted) { await pack.deleteCompendium(); n += 1; }
          else if (f.bgDocs.length) { await Item.implementation.deleteDocuments(f.bgDocs, { pack: pack.collection }); n += f.bgDocs.length; }
        }
        return n;
      }, { f, WORLD_BG_PACK, bgPackExisted: before.bgPackExisted });
      console.log(`\n  note  cleanup: removed ${swept} planted document(s)`);
    }
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
console.log(failed ? "\ndev:take-over FAILED" : "\ndev:take-over passed");
process.exit(failed ? 1 : 0);

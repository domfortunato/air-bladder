#!/usr/bin/env node
/**
 * GLOG'S TWO SHEET FLAGS ARE HACK CONTROLS (2026-09-13, user ruling after an
 * Air Bladder in a GLOG-off world offered to become a Grimoire).
 *
 *   node tools/dev/e2e-glog-flags.mjs   (needs Foundry running, world launched)
 *
 * Three planted world documents — a plain item, an item already flagged
 * `grimoire`, a spellbook — each rendered under BOTH switch states, with
 * `enable-glog-magic` SHADOWED in-page both ways. Never the world's own value:
 * the legs assert the ruling, and the dev world's setting is the Warden's.
 *
 *   OFF  no Grimoire box, no Pages field, no GLOG box on any of the three, and
 *        the `.plain-item` grid variant absent.
 *   ON   Grimoire box + Pages on the FLAGGED item only — not on the plain item,
 *        even with the hack on: a Grimoire is found, made or taken, never
 *        declared by ticking a box on a rope — with the grid variant on exactly
 *        that sheet; the GLOG box on the spellbook. 2e's Scroll box shows in
 *        both states, because it is not the hack's.
 *
 * Red-first: with the template conditions removed, every OFF leg and the
 * plain-item ON leg fail. Fixtures are found by ID DIFFERENCE, flagged
 * `probeGlogFlags`, and swept from Node in the finally.
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
const FLAG = "probeGlogFlags";

const sweep = () => page.evaluate(async (FLAG) => {
  let n = 0;
  for (const i of [...game.items].filter((x) => x.getFlag("air-bladder", FLAG))) { await i.sheet?.close(); await i.delete(); n++; }
  return n;
}, FLAG);

try {
  await joinAsGM(page);
  const pre = await sweep();
  if (pre) console.log(`  --    swept ${pre} leftover fixture(s) from an earlier run`);

  const ids = await page.evaluate(async (FLAG) => {
    const before = new Set(game.items.map((i) => i.id));
    await CONFIG.Item.documentClass.createDocuments([
      { name: "PROBE glog rope", type: "item", flags: { "air-bladder": { [FLAG]: true } } },
      { name: "PROBE glog grimoire", type: "item", system: { grimoire: true, grimoirePages: 10 }, flags: { "air-bladder": { [FLAG]: true } } },
      { name: "PROBE glog spell", type: "spellbook", flags: { "air-bladder": { [FLAG]: true } } },
    ]);
    const fresh = game.items.filter((i) => !before.has(i.id));
    const byName = Object.fromEntries(fresh.map((i) => [i.name, i.id]));
    return { rope: byName["PROBE glog rope"], grimoire: byName["PROBE glog grimoire"], spell: byName["PROBE glog spell"], count: fresh.length };
  }, FLAG);
  ids.count === 3 && ids.rope && ids.grimoire && ids.spell
    ? ok("three fixtures planted and found by id difference")
    : fail(`fixtures: ${JSON.stringify(ids)}`);

  /** Render the three sheets under one shadowed switch state and read what they show. */
  const readState = (on) => page.evaluate(async ({ ids, on }) => {
    const ns = game.system.id;
    const origGet = game.settings.get;
    game.settings.get = function (scope, key, ...rest) {
      // A DOCUMENT request is never shadowed: core's #setWorld asks
      // get(ns, key, {document: true}) and any value handed back makes it
      // CREATE a duplicate. check:probes gates this.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "enable-glog-magic") return on;
      return origGet.call(this, scope, key, ...rest);
    };
    const out = {};
    try {
      for (const [k, id] of Object.entries(ids)) {
        if (k === "count") continue;
        const item = game.items.get(id);
        const sheet = item.sheet;
        await sheet.render(true);
        let grid = null;
        for (let i = 0; i < 40 && !grid; i++) {
          grid = sheet.element?.querySelector(".item-sheet-grid") ?? null;
          if (!grid) await new Promise((res) => setTimeout(res, 50));
        }
        const el = sheet.element;
        // The room above the tabs, MEASURED: a counter row the grid declares
        // and nothing fills is invisible to a count of counters (review #30 —
        // the spellbook kept three counter rows for its four GLOG-off
        // counters and rendered a 36px gap on every shipped spellbook).
        const tabs = el?.querySelector(".item-sheet-section-tabs");
        const counters = [...(el?.querySelectorAll(".resource-counter") ?? [])];
        const last = counters[counters.length - 1];
        out[k] = {
          rendered: !!grid,
          grimoire: !!el?.querySelector('input[name="system.grimoire"]'),
          pages: !!el?.querySelector('input[name="system.grimoirePages"]'),
          glog: !!el?.querySelector('input[name="system.glog"]'),
          scroll: !!el?.querySelector('input[name="system.scroll"]'),
          plain: !!grid?.classList.contains("plain-item"),
          compact: !!grid?.classList.contains("compact"),
          gap: tabs && last ? Math.round(tabs.getBoundingClientRect().top - last.getBoundingClientRect().bottom) : null,
        };
        await sheet.close();
      }
    } finally {
      game.settings.get = origGet;
    }
    return out;
  }, { ids, on });

  console.log("\nGLOG off");
  const off = await readState(false);
  const noneOf = (r) => r.rendered && !r.grimoire && !r.pages && !r.glog;
  noneOf(off.rope) && !off.rope.plain
    ? ok("a plain item shows no Grimoire box, no Pages, and keeps the standard grid")
    : fail(`plain item, hack off: ${JSON.stringify(off.rope)}`);
  noneOf(off.grimoire) && !off.grimoire.plain
    ? ok("an item already flagged Grimoire shows neither box while the hack is off")
    : fail(`grimoire item, hack off: ${JSON.stringify(off.grimoire)}`);
  off.spell.rendered && !off.spell.glog && off.spell.scroll
    ? ok("a spellbook shows no GLOG box while the hack is off — and 2e's Scroll box is there")
    : fail(`spellbook, hack off: ${JSON.stringify(off.spell)}`);

  console.log("\nGLOG on");
  const on = await readState(true);
  on.rope.rendered && !on.rope.grimoire && !on.rope.pages && !on.rope.plain
    ? ok("a plain item STILL offers no Grimoire box with the hack on — a rope does not become the one permitted book")
    : fail(`plain item, hack on: ${JSON.stringify(on.rope)}`);
  on.grimoire.rendered && on.grimoire.grimoire && on.grimoire.pages && on.grimoire.plain
    ? ok("the flagged Grimoire shows its box and Pages, on the six-counter-row grid variant")
    : fail(`grimoire item, hack on: ${JSON.stringify(on.grimoire)}`);
  on.spell.rendered && on.spell.glog && on.spell.scroll
    ? ok("a spellbook shows the GLOG box beside Scroll with the hack on")
    : fail(`spellbook, hack on: ${JSON.stringify(on.spell)}`);

  console.log("\nno empty counter row above the tabs");
  off.spell.compact && off.spell.gap !== null && off.spell.gap <= 12
    ? ok(`a plain spellbook with the hack off takes the compact grid — ${off.spell.gap}px between its last counter and the tabs`)
    : fail(`spellbook, hack off: compact=${off.spell.compact} gap=${off.spell.gap}px — the third counter row is sitting empty above the tabs`);
  !on.spell.compact && on.spell.gap !== null && on.spell.gap <= 12
    ? ok(`with the hack on it keeps the three-row grid, no gap either (${on.spell.gap}px)`)
    : fail(`spellbook, hack on: compact=${on.spell.compact} gap=${on.spell.gap}px`);

  /* The toggle must reach an OPEN item sheet (review #30): the setting has no
   * reload, its onChange fanned re-renders over ACTOR sheets only, and an open
   * Grimoire sheet kept a live Grimoire box on a hack that had just been
   * switched off. The setting's own onChange is invoked with `false` — the
   * value a Configure Settings save would hand it, and the one that converts
   * nothing — under the same read shadow, flipped between the two renders. */
  console.log("\nthe toggle reaches an open item sheet");
  const live = await page.evaluate(async ({ ids }) => {
    const ns = game.system.id;
    const origGet = game.settings.get;
    let on = true;
    game.settings.get = function (scope, key, ...rest) {
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "enable-glog-magic") return on;
      return origGet.call(this, scope, key, ...rest);
    };
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = {};
    const sheet = game.items.get(ids.grimoire).sheet;
    try {
      await sheet.render(true);
      for (let i = 0; i < 40 && !sheet.element?.querySelector(".item-sheet-grid"); i++) await wait(50);
      out.beforeBox = !!sheet.element?.querySelector('input[name="system.grimoire"]');
      on = false;
      await game.settings.settings.get(`${ns}.enable-glog-magic`).onChange(false);
      for (let i = 0; i < 40 && sheet.element?.querySelector('input[name="system.grimoire"]'); i++) await wait(75);
      out.afterBox = !!sheet.element?.querySelector('input[name="system.grimoire"]');
      out.stillOpen = sheet.rendered;
    } finally {
      game.settings.get = origGet;
      await sheet.close();
    }
    return out;
  }, { ids });
  live.beforeBox && !live.afterBox && live.stillOpen
    ? ok("switching the hack off re-renders the open Grimoire sheet — its box is gone without a reopen")
    : fail(`open item sheet across the toggle: ${JSON.stringify(live)}`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  try { const n = await sweep(); if (n) console.log(`\n  --    removed ${n} fixture(s)`); } catch { /* page gone */ }
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nGLOG-FLAGS PROBE FAILED\n" : "\nglog-flags probe passed\n");
process.exit(failed ? 1 : 0);

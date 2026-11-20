#!/usr/bin/env node
/**
 * Smoke test against a running local Foundry: load the system, check every
 * compendium, render a character sheet, and report any console error.
 *
 * There is no unit test suite for this system, and there cannot easily be one —
 * almost everything needs a live Foundry. This is the substitute: it catches
 * "the system no longer loads" and "the sheet throws", which is most of what
 * actually breaks.
 *
 *   npm run dev:smoke                       (needs Foundry running, world launched)
 *   FOUNDRY_URL=http://host:30000 npm run dev:smoke
 *
 * Exits non-zero if the system fails to load, a pack is empty, the sheet fails
 * to render, or anything lands in the console. Screenshot: tools/dev/out/.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
const errors = watchErrors(page);
let failed = false;
const fail = m => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = m => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const info = await page.evaluate(() => ({
    system: game.system.id,
    systemVersion: game.system.version,
    coreVersion: game.version,
    world: game.world.id,
    packs: game.packs.map(p => ({ name: p.metadata.name, id: p.metadata.id, size: p.index.size })),
    actorTypes: game.documentTypes.Actor,
    itemTypes: game.documentTypes.Item,
  }));

  console.log(`\nFoundry ${info.coreVersion} | system ${info.system} ${info.systemVersion} | world ${info.world}\n`);

  info.system === "air-bladder" ? ok("system loaded") : fail(`wrong system: ${info.system}`);

  // Only SHIPPED packs must be non-empty. game.packs also carries world-level ones,
  // and `world.custom-backgrounds` (created on demand by character-generator.js for
  // GM-authored backgrounds) is empty until a GM authors one — so asserting over
  // every pack failed on a perfectly healthy world, and told you to run build:packs,
  // which could never have fixed it.
  const shipped = info.packs.filter(p => p.id.startsWith("air-bladder."));
  const world = info.packs.filter(p => !p.id.startsWith("air-bladder."));
  const total = shipped.reduce((n, p) => n + p.size, 0);
  const empty = shipped.filter(p => !p.size);
  if (empty.length) fail(`empty packs (did you run build:packs?): ${empty.map(p => p.name).join(", ")}`);
  else ok(`${shipped.length} system packs, ${total} documents${world.length ? ` (+${world.length} world pack(s), not asserted)` : ""}`);

  // Render a character sheet: the AppV1 path, and where most breakage shows up.
  const sheet = await page.evaluate(async () => {
    const out = {};
    try {
      let a = game.actors.getName("Smoke Probe");
      if (!a) a = await Actor.create({ name: "Smoke Probe", type: "character" });
      a.sheet.render(true);
      await new Promise(r => setTimeout(r, 3000));
      const el = a.sheet.element;
      const node = el instanceof HTMLElement ? el : el?.[0];   // AppV1 returns jQuery
      out.sheetClass = a.sheet.constructor.name;
      // Ask the sheet for its own element rather than matching a framework class:
      // AppV1 windows are `.app.window-app`, ApplicationV2's are `.application`.
      out.inDom = !!node?.isConnected;
      // A character's pages are turned from the thumb-tab RAIL since 2026-11-19
      // (parts/tab-rail.html): icon buttons with no text, each named by its
      // aria-label (the tooltip); every other sheet's too since 2026-11-20.
      // The old `nav .item` text strip is gone, so reading it lists nothing.
      // Every page is TURNED, the way a player does — a click on its rail
      // button — because a page whose tab handler throws is exactly the
      // breakage this smoke exists for, and an unvisited page cannot throw.
      const rail = [...(node?.querySelectorAll?.("nav.cairn-tab-rail button[data-tab]") ?? [])];
      out.tabs = rail.map(b => `${b.dataset.tab}: ${b.getAttribute("aria-label") ?? ""}`.trim());
      out.tabIds = rail.map(b => b.dataset.tab);
      out.turned = [];
      for (const b of rail) {
        b.click();
        await new Promise(r => setTimeout(r, 250));
        const shown = [...node.querySelectorAll(".tab[data-tab]")]
          .filter(p => getComputedStyle(p).display !== "none").map(p => p.dataset.tab);
        out.turned.push({ id: b.dataset.tab, shown });
      }
      await a.delete();
    } catch (e) { out.error = `${e.name}: ${e.message}`; }
    return out;
  });

  if (sheet.error) fail(`sheet render threw: ${sheet.error}`);
  else if (!sheet.inDom) fail("sheet did not appear in the DOM");
  else {
    ok(`${sheet.sheetClass} rendered [${sheet.tabs.join(" | ")}]`);
    // The character's four pages since round 4 (the parked Connections page is absent by
    // default). A page missing from the rail is unreachable for a player, and
    // an empty rail would make the turning loop above prove nothing.
    const want = ["character", "items", "growth", "notes"];
    const missing = want.filter(id => !sheet.tabIds.includes(id));
    missing.length
      ? fail(`the character sheet's rail lacks page(s): ${missing.join(", ")} (rail: ${sheet.tabIds.join(", ") || "empty"})`)
      : ok(`the rail turns to every page (${sheet.tabIds.join(", ")})`);
    const wrong = sheet.turned.filter(t => t.shown.length !== 1 || t.shown[0] !== t.id);
    if (wrong.length) fail(`turning a page did not show it alone: ${JSON.stringify(wrong)}`);
  }

  await page.screenshot({ path: path.join(outDir, "smoke.png"), fullPage: true });
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach(e => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nSMOKE FAILED\n" : "\nsmoke passed\n");
process.exit(failed ? 1 : 0);

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
      const node = el?.[0] ?? el;            // AppV1 returns jQuery
      out.sheetClass = a.sheet.constructor.name;
      out.inDom = !!document.querySelector(".app.window-app");
      out.tabs = [...(node?.querySelectorAll?.("nav .item, .tabs .item") ?? [])].map(t => t.textContent.trim());
      await a.delete();
    } catch (e) { out.error = `${e.name}: ${e.message}`; }
    return out;
  });

  if (sheet.error) fail(`sheet render threw: ${sheet.error}`);
  else if (!sheet.inDom) fail("sheet did not appear in the DOM");
  else ok(`${sheet.sheetClass} rendered [${sheet.tabs.join(" | ")}]`);

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

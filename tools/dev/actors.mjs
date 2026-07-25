#!/usr/bin/env node
/**
 * List or delete world actors in a running local Foundry (the actor directory,
 * NOT compendium actors). Handy for resetting a dev world.
 *
 *   npm run dev:actors                          list every actor (default, read-only)
 *   npm run dev:actors -- delete                DRY RUN: show what delete would remove
 *   npm run dev:actors -- delete --yes          actually delete every actor
 *   npm run dev:actors -- delete --type character --yes   delete only characters
 *   npm run dev:actors -- list --type container           list only containers
 *
 * Target a different instance with FOUNDRY_URL (defaults to localhost:30000):
 *   bash:        FOUNDRY_URL=http://localhost:30001 npm run dev:actors
 *   PowerShell:  $env:FOUNDRY_URL="http://localhost:30001"; npm run dev:actors
 *
 * Needs Foundry running with a world launched (see the dev loop in CLAUDE.md).
 * `delete` never runs without `--yes`; without it you get a preview.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith("-")) ?? "list";
const yes = argv.includes("--yes") || argv.includes("-y");
const typeIdx = argv.findIndex((a) => a === "--type" || a.startsWith("--type="));
const type = typeIdx === -1
  ? null
  : (argv[typeIdx].includes("=") ? argv[typeIdx].split("=")[1] : argv[typeIdx + 1]) || null;

if (!["list", "delete"].includes(mode)) {
  console.error(`Unknown mode "${mode}". Use "list" or "delete".`);
  process.exit(2);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
watchErrors(page);

try {
  await joinAsGM(page);
  const info = await page.evaluate((t) => ({
    system: game.system.id,
    world: game.world.id,
    actors: game.actors
      .filter((a) => !t || a.type === t)
      .map((a) => ({ id: a.id, name: a.name, type: a.type, img: a.img })),
  }), type);

  const filter = type ? ` (type=${type})` : "";
  console.log(`\n${FOUNDRY_URL} | system ${info.system} | world ${info.world} | ${info.actors.length} actor(s)${filter}\n`);
  for (const a of info.actors) {
    const broken = /character_(portraits|tokens)\/.*\.png$/i.test(a.img ?? "") ? "  ⚠ broken .png portrait" : "";
    console.log(`   ${String(a.type).padEnd(10)} ${a.name}${broken}`);
  }

  if (mode === "delete") {
    if (!info.actors.length) {
      console.log("\nnothing to delete");
    } else if (!yes) {
      console.log(`\nDRY RUN — would delete ${info.actors.length} actor(s). Re-run with --yes to confirm.`);
    } else {
      const n = await page.evaluate(async (ids) => {
        await Actor.deleteDocuments(ids);
        return ids.length;
      }, info.actors.map((a) => a.id));
      const left = await page.evaluate(() => game.actors.size);
      console.log(`\ndeleted ${n} actor(s); ${left} remaining in the world`);
    }
  }
} finally {
  await browser.close();
}

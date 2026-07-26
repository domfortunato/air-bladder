#!/usr/bin/env node
/**
 * Create player User accounts in the running world (joins as GM first).
 *
 *   FOUNDRY_URL=http://localhost:30001 node tools/dev/create-players.mjs
 *   node tools/dev/create-players.mjs Alice Bob Carol      # custom names
 *
 * Defaults to two players (Alice, Bob) with role PLAYER and no password.
 * Idempotent: names that already exist are skipped. Part of the release
 * validation flow — a fresh test world should always get two player accounts so
 * ownership/permission behaviour can be exercised the way real play does.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const names = process.argv.slice(2);
if (!names.length) names.push("Alice", "Bob");

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
watchErrors(page);
try {
  await joinAsGM(page);
  const res = await page.evaluate(async (names) => {
    const roleName = (r) => Object.keys(CONST.USER_ROLES).find((k) => CONST.USER_ROLES[k] === r);
    const created = [], existed = [];
    for (const name of names) {
      if (game.users.getName(name)) { existed.push(name); continue; }
      await User.create({ name, role: CONST.USER_ROLES.PLAYER });
      created.push(name);
    }
    return { world: game.world.id, created, existed, all: game.users.map((u) => `${u.name} [${roleName(u.role)}]`) };
  }, names);
  console.log(`world: ${res.world}`);
  if (res.created.length) console.log(`created players: ${res.created.join(", ")}`);
  if (res.existed.length) console.log(`already existed: ${res.existed.join(", ")}`);
  console.log(`users now: ${res.all.join(", ")}`);
} finally {
  await browser.close();
}

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
await joinAsGM(page);
const state = await page.evaluate(() => {
  if (game.paused) game.togglePause(false);
  return { paused: game.paused, world: game.world.id };
});
console.log(`world=${state.world} paused=${state.paused}`);
await browser.close();

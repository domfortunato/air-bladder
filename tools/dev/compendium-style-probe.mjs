#!/usr/bin/env node
/**
 * The compendium sidebar reads flat black with white text — no banner art.
 *
 * Each pack row's "background image" is a real <img class="compendium-banner">;
 * we hide it (opacity 0, NOT display:none — the img gives the row its height) and
 * black out the row, with white text/icons, scoped to #compendium. If Foundry
 * renames the banner class or the tab id on a version bump this goes silent, so
 * assert the computed result rather than the CSS.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

const isBlack = (c) => /rgba?\(\s*0,\s*0,\s*0\s*(,\s*1)?\s*\)/.test(c ?? "");
const isWhite = (c) => /rgb\(\s*255,\s*255,\s*255\s*\)/.test(c ?? "");

try {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const tab = ui.sidebar?.tabs?.compendium ?? ui.compendium;
    await tab?.render(true);
    ui.sidebar?.changeTab?.("compendium", "primary");
    await new Promise((res) => setTimeout(res, 700));
    const li = document.querySelector("#compendium .directory-item.compendium");
    const img = li?.querySelector(".compendium-banner");
    const a = li?.querySelector(".entry-name");
    const fh = document.querySelector("#compendium .directory-item.folder > .folder-header");
    const g = (el, p) => (el ? getComputedStyle(el)[p] : null);
    return {
      foundPack: !!li,
      foundBanner: !!img,
      bannerOpacity: g(img, "opacity"),
      rowBg: g(li, "backgroundColor"),
      rowText: g(a, "color"),
      iconColor: g(li?.querySelector(".entry-name i"), "color"),
      folderBg: g(fh, "backgroundColor"),
      folderText: g(fh, "color"),
    };
  });

  r.foundPack ? ok("a compendium pack row was found under #compendium")
              : fail("no #compendium pack row found — selector may have changed");
  r.foundBanner && r.bannerOpacity === "0"
    ? ok("the pack banner image is suppressed (opacity 0, box kept)")
    : fail(`banner state: found=${r.foundBanner} opacity=${r.bannerOpacity}`);
  isBlack(r.rowBg) ? ok(`pack rows are black (${r.rowBg})`) : fail(`pack row bg is ${r.rowBg}`);
  isWhite(r.rowText) && isWhite(r.iconColor)
    ? ok(`pack text and icons are white (${r.rowText})`)
    : fail(`pack text=${r.rowText} icon=${r.iconColor}`);
  isBlack(r.folderBg) && isWhite(r.folderText)
    ? ok(`folder headers are black with white text (${r.folderBg} / ${r.folderText})`)
    : fail(`folder header bg=${r.folderBg} text=${r.folderText}`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nCOMPENDIUM STYLE PROBE FAILED\n" : "\ncompendium style probe passed\n");
process.exit(failed ? 1 : 0);

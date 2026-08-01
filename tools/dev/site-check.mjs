#!/usr/bin/env node
/**
 * Renders the built landing page headlessly and asserts it is not broken.
 *
 *   npm run build:site && npm run dev:site
 *
 * Sibling of dev:smoke, and for the same reason: the page is hand-authored
 * HTML with no build step to catch mistakes, so a mistyped asset path or a
 * renamed screenshot would ship silently. Checks, in both colour schemes:
 *
 *   - no console errors and no failed requests (a missing asset is a failure,
 *     not a warning — the page is meant to make zero external requests, so
 *     every request it makes must resolve locally)
 *   - every <img> decoded to real pixels rather than a broken-image box
 *   - no horizontal overflow at 1280 / 768 / 380px
 *   - the manifest URL on the page still points at releases/latest
 *
 * Screenshots land in tools/dev/out/ (gitignored), like the smoke test's.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const built = path.join(root, "_site", "index.html");
const outDir = path.join(root, "tools", "dev", "out");

if (!fs.existsSync(built)) {
  console.error("_site/index.html is missing — run `npm run build:site` first.");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const MANIFEST_SUFFIX = "/releases/latest/download/system.json";
const browser = await chromium.launch();
let problems = 0;

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error") { console.error(`[${scheme}] console: ${m.text()}`); problems++; }
  });
  page.on("pageerror", (e) => { console.error(`[${scheme}] pageerror: ${e.message}`); problems++; });
  page.on("requestfailed", (r) => {
    console.error(`[${scheme}] failed request: ${r.url()} — ${r.failure()?.errorText}`);
    problems++;
  });

  await page.goto(pathToFileURL(built).href, { waitUntil: "networkidle" });

  const broken = await page.$$eval("img", (imgs) => imgs
    .filter((i) => !i.complete || i.naturalWidth === 0)
    .map((i) => i.getAttribute("src")));
  if (broken.length) {
    console.error(`[${scheme}] broken images: ${broken.join(", ")}`);
    problems += broken.length;
  }

  for (const width of [1280, 768, 380]) {
    await page.setViewportSize({ width, height: 900 });
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (overflows) { console.error(`[${scheme}] horizontal overflow at ${width}px`); problems++; }
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  const manifest = (await page.textContent("#manifest-url"))?.trim() ?? "";
  if (!manifest.endsWith(MANIFEST_SUFFIX)) {
    console.error(`[${scheme}] manifest URL is not a latest-release link: ${manifest}`);
    problems++;
  }

  await page.screenshot({ path: path.join(outDir, `site-${scheme}.png`), fullPage: true });
  console.log(`[${scheme}] rendered — manifest ${manifest}`);
  await ctx.close();
}

await browser.close();

if (problems > 0) {
  console.error(`\nFAIL — ${problems} problem(s). See tools/dev/out/site-*.png.`);
  process.exit(1);
}
console.log("\nPASS — no console errors, no failed requests, no overflow, no broken images.");
console.log(`Screenshots: ${path.relative(root, outDir)}/site-{light,dark}.png`);

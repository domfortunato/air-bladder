#!/usr/bin/env node
/**
 * Convert replacement token art from PNG to WebP, in place.
 *
 *   node tools/import/tokens-from-png.mjs [--dry] [--quality 0.92] [--force]
 *
 * Drop the PNGs in new-tokens/ (gitignored) and run this. It verifies the names
 * against the shipped set FIRST and refuses to write anything if they disagree,
 * because the portrait/token pairing is by IDENTICAL BASENAME — character_portraits
 * and character_tokens hold the same 80 names, and module/portrait-manifest.json
 * ships that list. A token whose stem does not match a portrait is not a broken
 * image, it is a character wearing someone else's face, which nothing downstream
 * can detect.
 *
 * Encoding goes through the Chromium that Playwright already installs. This box
 * has no ImageMagick, cwebp, ffmpeg or sharp — and note that `convert` on PATH
 * here is C:\WINDOWS\system32\convert, the FAT-to-NTFS disk utility. Never let a
 * script find that one.
 *
 * The originals are committed, so `git checkout -- character_tokens` undoes a bad
 * run. That is the safety net; this script deliberately has no backup logic.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "new-tokens");
const DEST = path.join(ROOT, "character_tokens");
const PORTRAITS = path.join(ROOT, "character_portraits");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");
const QUALITY = Number(arg("quality", "0.92"));

const stems = (dir, ext) => new Set(
  fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.basename(f, ext))
);

if (!fs.existsSync(SRC)) {
  console.error(`nothing to do: ${SRC} does not exist. Put the PNGs there first.`);
  process.exit(1);
}

const incoming = stems(SRC, ".png");
const current = stems(DEST, ".webp");
const portraits = stems(PORTRAITS, ".webp");

/* ---- verify names BEFORE touching anything -------------------------------- */

const missing = [...current].filter((s) => !incoming.has(s)).sort();
const extra = [...incoming].filter((s) => !current.has(s)).sort();
const unpaired = [...incoming].filter((s) => !portraits.has(s)).sort();

console.log(`incoming PNGs : ${incoming.size}`);
console.log(`shipped tokens: ${current.size}`);
console.log(`portraits     : ${portraits.size}`);

let bad = false;
if (missing.length) { bad = true; console.error(`\nNOT REPLACED — ${missing.length} shipped token(s) have no incoming PNG:\n  ${missing.join(", ")}`); }
if (extra.length) { bad = true; console.error(`\nUNKNOWN — ${extra.length} incoming PNG(s) match no shipped token:\n  ${extra.join(", ")}`); }
if (unpaired.length) { bad = true; console.error(`\nUNPAIRED — ${unpaired.length} incoming PNG(s) have no portrait of the same name:\n  ${unpaired.join(", ")}`); }

if (bad && !FORCE) {
  console.error("\nRefusing to convert. Fix the names, or pass --force if you know better.");
  process.exit(1);
}
if (!bad) console.log("\nnames check out — every PNG replaces a token and pairs with a portrait\n");

/* ---- convert -------------------------------------------------------------- */

const browser = await chromium.launch();
const page = await browser.newPage();

let written = 0, before = 0, after = 0;
const dims = {};

for (const stem of [...incoming].sort()) {
  const src = path.join(SRC, `${stem}.png`);
  const dest = path.join(DEST, `${stem}.webp`);
  const b64 = fs.readFileSync(src).toString("base64");

  const out = await page.evaluate(async ({ b64, quality }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return { w: img.naturalWidth, h: img.naturalHeight, url: c.toDataURL("image/webp", quality) };
  }, { b64, quality: QUALITY });

  // Chromium silently falls back to PNG if it cannot encode WebP. Catch that
  // rather than writing PNG bytes into a .webp file, which would "work" in a
  // browser and be wrong everywhere else.
  if (!out.url.startsWith("data:image/webp")) {
    console.error(`\n${stem}: Chromium returned ${out.url.slice(5, 20)} instead of WebP — aborting.`);
    await browser.close();
    process.exit(1);
  }

  const buf = Buffer.from(out.url.split(",")[1], "base64");
  const key = `${out.w}x${out.h}`;
  dims[key] = (dims[key] ?? 0) + 1;
  before += fs.statSync(src).size;
  after += buf.length;

  if (!DRY) { fs.writeFileSync(dest, buf); written++; }
}

await browser.close();

console.log(`source dimensions: ${JSON.stringify(dims)}`);
console.log(`PNG in : ${(before / 1024).toFixed(0)} KB`);
console.log(`WebP out: ${(after / 1024).toFixed(0)} KB  (quality ${QUALITY})`);
console.log(DRY ? "\ndry run — nothing written" : `\nwrote ${written} file(s) to character_tokens/`);
if (!DRY) console.log("next: node tools/import/portraits.mjs   (rebuilds module/portrait-manifest.json)");

#!/usr/bin/env node
/**
 * Author icons/*.svg from game-icons.net.
 *
 *   node tools/import/icons.mjs [--dry]
 *
 * These are the class icons shown for gear, spellbooks, transports, containers
 * and monsters. They were originally committed as 512x512 RGBA PNGs (~30 KB
 * each, 492 KB in every release); the site publishes the same glyphs as SVG at
 * ~700 bytes, so this fetches those instead — a 45x saving, and they stay crisp
 * at any size, which matters because several of these are ACTOR art and so end
 * up as canvas tokens.
 *
 * Re-runnable and byte-stable: the URL encodes the colours (white glyph on
 * black, matching the PNGs they replace), so a rerun produces no diff unless
 * game-icons.net changes the art.
 *
 * The mapping below is the SAME table as icons/CREDITS.md, which carries the
 * per-icon CC BY 3.0 attribution each author is owed. Keep them in step: add a
 * row here, add a row there.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = path.join(root, "icons");
const dry = process.argv.includes("--dry");

// file (without extension) -> [author, icon slug on game-icons.net]
const ICONS = {
  "armor": ["delapouite", "armor-upgrade"],
  "weapons": ["delapouite", "switch-weapon"],
  "spellbook": ["lorc", "book-aura"],
  "spellscroll": ["lorc", "scroll-unfurled"],
  "tools": ["delapouite", "toolbox"],
  "generic-item": ["delapouite", "expense"],
  "background": ["delapouite", "shattered-heart"],
  "monster": ["lorc", "monster-grasp"],
  "backpack": ["lorc", "knapsack"],
  "sack": ["lorc", "swap-bag"],
  "chest": ["lorc", "locked-chest"],
  "donkey": ["skoll", "donkey"],
  "horse": ["delapouite", "horse-head"],
  "cart": ["lorc", "cartwheel"],
  "handcart": ["delapouite", "wheelbarrow"],
  // Deliberately the same glyph as `cart` — see the note at the foot of CREDITS.md.
  "wagon": ["lorc", "cartwheel"],
  "stack": ["delapouite", "stack"],
  // Storage a Warden can pick from the container art list. `box` is deliberately
  // NOT called "cardboard box" -- the glyph is a plain closed box and cardboard
  // has no place in Cairn.
  "crate": ["delapouite", "wooden-crate"],
  "barrel": ["delapouite", "barrel"],
  "box": ["delapouite", "cardboard-box-closed"],
};

// White glyph on a black field, which is what the PNGs were and what the sheet
// CSS expects; the system never recolours them.
const url = (author, slug) => `https://game-icons.net/icons/ffffff/000000/1x1/${author}/${slug}.svg`;

/**
 * game-icons.net ships `<svg viewBox="0 0 512 512">` with NO width/height, so the
 * file has no intrinsic size. An SVG without one is rasterised at the browser's
 * fallback (300x150), which Foundry then squares off — a token drew at 150x150
 * where the PNG it replaced was 512x512, i.e. visibly soft the moment anyone
 * zoomed in. Caught on the canvas during the 0.1.6 upgrade test; nothing that
 * only fetches or decodes the file can see it.
 *
 * Stamp the viewBox's own dimensions in. ~30 bytes, and rasterisation becomes
 * deterministic at the size the art was drawn for.
 */
const withIntrinsicSize = (svg) => {
  if (/<svg[^>]*\swidth=/.test(svg)) return svg;
  const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!box) throw new Error("no viewBox to derive an intrinsic size from");
  return svg.replace(/<svg /, `<svg width="${box[1]}" height="${box[2]}" `);
};

let bytes = 0;
let changed = 0;
for (const [file, [author, slug]] of Object.entries(ICONS)) {
  const res = await fetch(url(author, slug));
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} from ${url(author, slug)}`);
  const raw = await res.text();
  if (!raw.trimStart().startsWith("<svg")) throw new Error(`${file}: response is not an SVG`);
  const svg = withIntrinsicSize(raw);
  bytes += Buffer.byteLength(svg);

  const dest = path.join(outDir, `${file}.svg`);
  const prior = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
  if (prior === svg) { console.log(`  =    ${file}.svg`); continue; }
  changed++;
  console.log(`  ${prior === null ? "+" : "~"}    ${file}.svg  (${Buffer.byteLength(svg)} bytes)`);
  if (!dry) fs.writeFileSync(dest, svg);
}

console.log(
  `\n${Object.keys(ICONS).length} icons, ${(bytes / 1024).toFixed(1)} KB total` +
  `${dry ? " (dry run, nothing written)" : `, ${changed} written`}`
);

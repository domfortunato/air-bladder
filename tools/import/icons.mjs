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
import { withIntrinsicSize } from "./svg-size.mjs";

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
  // The 0-slot companions (2026-08-08): Fletchwind's falcon, Half Witch's
  // raven. Both glyphs already ship in the art/game-icons GALLERY under the
  // same licence; these are the class-art copies icons/ needs.
  "falcon": ["delapouite", "falcon-moon"],
  "raven": ["lorc", "raven"],
  "cart": ["lorc", "cartwheel"],
  "handcart": ["delapouite", "wheelbarrow"],
  // Used to be the cartwheel again, which put two identical wheels in the
  // container art picker. The picker dedupes shared GLYPHS (mule/donkey), but
  // these were two files, invisible to it — so the wagon gets its own art.
  "wagon": ["delapouite", "old-wagon"],
  // A funeral wagon is a wagon by construction and a hearse by purpose, and only
  // the purpose is drawable — game-icons.net has no hearse, so the COFFIN stands
  // for the thing it carries. Deliberately not a second wagon glyph: the picker
  // dedupes shared glyphs, so two wagons would silently cost one of them its cell.
  "funeralwagon": ["lorc", "coffin"],
  // Cairn's water transport is a rowboat, a skiff, a coracle -- one or two people
  // and their gear, never a ship. The canoe is the smallest hull on the site.
  "smallcraft": ["delapouite", "canoe"],
  "stack": ["delapouite", "stack"],
  // Storage a Warden can pick from the container art list. `box` is deliberately
  // NOT called "cardboard box" -- the glyph is a plain closed box and cardboard
  // has no place in Cairn.
  "crate": ["delapouite", "wooden-crate"],
  "barrel": ["delapouite", "barrel"],
  "box": ["delapouite", "cardboard-box-closed"],
  // Requested 2026-08-13, not yet wired to a class. FIRST icon here by
  // SeregaCthtuf, who was already credited for the art/game-icons GALLERY but
  // not for icons/ — so this row also moved his name into icons/CREDITS.md,
  // LICENSE.txt and both READMEs, all of which name that folder's authors.
  "thought-bubble": ["seregacthtuf", "thought-bubble"],
};

// White glyph on a black field, which is what the PNGs were and what the sheet
// CSS expects; the system never recolours them.
const url = (author, slug) => `https://game-icons.net/icons/ffffff/000000/1x1/${author}/${slug}.svg`;

// The intrinsic-size stamp moved to ./svg-size.mjs so game-icons.mjs writes the
// same file this one does. See that module for why it exists.

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

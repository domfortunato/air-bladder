#!/usr/bin/env node
/**
 * Import tlomdev's token drawings into tlomdev/.
 *
 *   node tools/import/tlomdev.mjs --src <dir> --kw <dir> [--dry]
 *
 * Like its sibling `game-icons.mjs`, this is NOT reproducible from the network:
 * `--src` is the unpacked itch.io download of "Tlomdev's Tokens"
 * (https://tlomdev.itch.io/tlomdevs-tokens) and `--kw` is a folder holding the
 * portrait files from the Kettlewright repo
 * (https://github.com/yochaigal/kettlewright, app/static/images/portraits).
 * `tlomdev/`, its CREDITS.md/license.txt and module/tlomdev-manifest.json are
 * the artifacts of record — committed, rerun only when the inputs change.
 *
 * SOURCE SHAPE:
 *
 *   <src>/<category>/<name>.png        the itch pack, one folder per category
 *   <kw>/portraitN.webp                Kettlewright's copies of the same
 *                                      artist's drawings, plus
 *                                      default-portrait.webp
 *
 * SHIPPED SHAPE (what the picker browses):
 *
 *   tlomdev/<category>/<name>.png              category names kept VERBATIM
 *   tlomdev/kettlewright-portraits/<name>.webp
 *
 * Category folder names are the artist's own, kept verbatim (including the
 * spaces in "human-npcs-for-itmod") — display labels are localized via
 * CAIRN.TlomdevCategory.* instead of renaming folders. The Kettlewright files
 * keep KETTLEWRIGHT'S exact names because the Kettlewright importer maps a
 * stock portrait pick by that numbering (portrait17.webp) — rename one and the
 * import of a character wearing it silently loses its face.
 *
 * One artist, one licence (CC BY-SA 4.0), so unlike game-icons there is no
 * per-file attribution problem and no collision handling: each category is one
 * flat folder from one person.
 *
 * Writes:
 *   tlomdev/<category>/*.png|webp
 *   tlomdev/CREDITS.md            attribution + provenance
 *   tlomdev/license.txt           the licence notice that must travel with the art
 *   module/tlomdev-manifest.json  category -> filenames, for the picker
 *
 * The manifest exists for the same reason portrait-manifest.json does: a client
 * cannot enumerate a server folder without FILES_BROWSE, and players pick art.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(root, "art", "tlomdev");
const MANIFEST = path.join(root, "module", "tlomdev-manifest.json");
const KW_CATEGORY = "kettlewright-portraits";
const dry = process.argv.includes("--dry");

const argAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
};
const SRC = argAfter("--src");
const KW = argAfter("--kw");
const TO_WEBP = process.argv.includes("--to-webp");

// macOS archives ship AppleDouble litter (`__MACOSX/`, `.DS_Store`, `._*`)
// alongside the real files; none of it is art.
const isJunkName = (name) => name === ".DS_Store" || name.startsWith("._") || name === "__MACOSX";

/**
 * `--to-webp`: re-encode the SHIPPED tree in place, no download needed.
 *
 * Same argument `game-icons.mjs --restamp` and `lydia-comer.mjs --to-webp` make:
 * the committed tree is the only copy this machine is guaranteed to hold, and
 * making a conversion every file needs depend on finding the itch download again
 * is a bad trade for something that is a pure function of bytes already in git.
 *
 * ONLY the artist's own category folders. `kettlewright-portraits/` is ALREADY
 * WebP — it is Kettlewright's copies of the same drawings, shipped that way, and
 * its filenames are load-bearing (the KW character importer maps a stock
 * portrait pick by `portrait17.webp`). Converting is a no-op there and renaming
 * would break the mapping, so the folder is skipped by name rather than by
 * "already .webp", which would silently start touching it the day one PNG
 * appeared in it.
 *
 * CC BY-SA 4.0 permits this — but §3(a)(1)(B) also REQUIRES that a modification
 * be indicated. That notice is written into CREDITS.md below; it is an
 * obligation of the licence, not a courtesy, and it is the half of a format
 * conversion that is easy to forget.
 */
if (TO_WEBP) {
  const sharp = (await import("sharp")).default;
  let done = 0, before = 0, after = 0;
  const cats = fs.readdirSync(OUT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !isJunkName(e.name) && e.name !== KW_CATEGORY)
    .map((e) => e.name);
  for (const cat of cats) {
    const dir = path.join(OUT_DIR, cat);
    for (const f of fs.readdirSync(dir).filter((n) => !isJunkName(n) && /\.png$/i.test(n))) {
      const from = path.join(dir, f);
      const to = path.join(dir, `${f.replace(/\.[^.]+$/, "")}.webp`);
      before += fs.statSync(from).size;
      const buf = await sharp(from).webp({ quality: 95, effort: 6 }).toBuffer();
      if (!dry) { fs.writeFileSync(to, buf); fs.rmSync(from); }
      after += buf.length;
      done++;
    }
  }
  console.log(done
    ? `${dry ? "(dry) " : ""}re-encoded ${done} file(s) in ${cats.length} categories to WebP q95: `
      + `${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB `
      + `(${(100 - after / before * 100).toFixed(0)}% smaller); ${KW_CATEGORY} skipped`
    : "nothing to convert — the artist's categories are already .webp");
  if (dry) process.exit(0);
}

if ((!SRC || !fs.existsSync(SRC) || !KW || !fs.existsSync(KW)) && !TO_WEBP) {
  console.error("usage: node tools/import/tlomdev.mjs --src <unpacked itch download> --kw <kettlewright portraits dir> [--dry]");
  console.error("  --src must contain the category folders (aqua/, beast/, ...);");
  console.error("  --kw must contain default-portrait.webp and portrait1..N.webp");
  process.exit(1);
}

// macOS archives ship AppleDouble litter (`__MACOSX/`, `.DS_Store`, `._*`)
// alongside the real files; none of it is art.
const isJunk = (name) => name === ".DS_Store" || name.startsWith("._") || name === "__MACOSX";
const isArt = (name) => !isJunk(name) && /\.(png|webp)$/i.test(name);

/** Filenames are numbered (beast2 before beast10), so sort like a human. */
const natural = (a, b) => a.localeCompare(b, "en", { numeric: true });

const artIn = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isArt(e.name))
    .map((e) => e.name)
    .sort(natural);

// ---------------------------------------------------------------------------
// Read the two source trees
// ---------------------------------------------------------------------------

/**
 * Where the categories come from.
 *
 * Normally the two downloads. With `--to-webp` and no `--src`, the SHIPPED tree
 * is the source of truth — the conversion above just rewrote it, and the
 * manifest has to be regenerated from what is actually on disk or it goes on
 * naming `.png` files that no longer exist. Same reason `lydia-comer.mjs` with
 * no `--src` re-validates and regenerates rather than refusing.
 */
const fromShipped = TO_WEBP && !SRC;

const itchCats = fs.readdirSync(fromShipped ? OUT_DIR : SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !isJunk(e.name) && !(fromShipped && e.name === KW_CATEGORY))
  .map((e) => e.name)
  .sort(natural);
if (!itchCats.length) {
  console.error(`no category folders under ${fromShipped ? OUT_DIR : SRC}`);
  process.exit(1);
}

/** [{key, srcDir, names}] — itch categories in order, Kettlewright last. */
// Folder names the artist ships that this system renames on ingest —
// Foundry's media guidance forbids spaces in asset folders, and a spaced path
// is also invisible to licence-check's reference regex (it reads up to the
// first space). DISPLAY labels are untouched: pascal() folds spaces and
// hyphens to the same lang key, so the picker still shows the artist's own
// wording. Applied here, at ingest, so a future --src re-import cannot
// resurrect the spaced folders. (2026-08-04, user ruling.)
const FOLDER_RENAMES = { "human npcs for itmod": "human-npcs-for-itmod" };

const plan = itchCats.map((srcName) => {
  const dir = path.join(fromShipped ? OUT_DIR : SRC, srcName);
  return { key: fromShipped ? srcName : (FOLDER_RENAMES[srcName] ?? srcName), srcDir: dir, names: artIn(dir) };
});
const kwDir = fromShipped ? path.join(OUT_DIR, KW_CATEGORY) : KW;
plan.push({ key: KW_CATEGORY, srcDir: kwDir, names: artIn(kwDir) });

for (const cat of plan) {
  if (!cat.names.length) {
    console.error(`FATAL empty category: ${cat.key}`);
    process.exit(1);
  }
}
const kwNames = plan[plan.length - 1].names;
if (!kwNames.includes("default-portrait.webp") || !kwNames.some((n) => /^portrait\d+\.webp$/.test(n))) {
  console.error(`FATAL --kw does not look like the Kettlewright portrait set (got ${kwNames.length} files)`);
  process.exit(1);
}

const total = plan.reduce((n, c) => n + c.names.length, 0);
console.log(`${total} drawings in ${plan.length} categories (${kwNames.length} of them Kettlewright's copies)`);

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const manifest = {
  _comment: "Generated by tools/import/tlomdev.mjs. Art: CC BY-SA 4.0, tlomdev — see tlomdev/CREDITS.md.",
  artDir: "systems/air-bladder/art/tlomdev",
  categories: plan.map(({ key, names }) => ({ key, names })),
};

const credits = [
  "# Tlomdev gallery",
  "",
  "Every drawing in this folder is by **[tlomdev](https://tlomdev.itch.io/)**, from",
  "**[Tlomdev's Tokens](https://tlomdev.itch.io/tlomdevs-tokens)**, used under the",
  "**Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**",
  "licence: <https://creativecommons.org/licenses/by-sa/4.0/>.",
  "",
  "The artist's statement, from the itch.io page:",
  "",
  "> Tlomdev's Tokens © 2023 by tlomdev is licensed under Attribution-ShareAlike",
  "> 4.0 International",
  "",
  "They are black-and-white circular token drawings, offered in the portrait",
  "picker's **Tlomdev** gallery under the artist's own category folders. Names",
  "are kept verbatim with two exceptions: the folders the artist shipped as",
  "\"human npcs for itmod\" and \"Kettlewright Portraits\" are",
  "`human-npcs-for-itmod/` and `kettlewright-portraits/` here, because Foundry's",
  "media guidance forbids spaces in asset folder names. The picker still",
  "displays the artist's own wording; only the on-disk folder is renamed, and",
  "the FILE names inside are untouched.",
  "",
  "## Modifications",
  "",
  "**These files have been re-encoded from PNG to WebP (quality 95) and changed",
  "in no other way** — not cropped, rescaled, recoloured or redrawn. The system",
  "is installed as a single download and the conversion roughly halves the",
  "gallery's weight.",
  "",
  "CC BY-SA 4.0 §3(a)(1)(B) requires that a modification be indicated, so this",
  "notice is a term of the licence rather than a courtesy. The share-alike",
  "condition is unaffected: the art remains CC BY-SA 4.0.",
  "",
  `The \`${KW_CATEGORY}\` folder is **not** re-encoded — Kettlewright ships those`,
  "as WebP already, and their filenames are load-bearing (see below).",
  "",
  `## The \`${KW_CATEGORY}\` folder`,
  "",
  "The same artist's drawings as shipped by",
  "**[Kettlewright](https://github.com/yochaigal/kettlewright)** (Yochai Gal's",
  "Cairn companion app), copied from `app/static/images/portraits` with",
  "Kettlewright's exact filenames: the Kettlewright character importer maps a",
  "stock portrait pick by that numbering (`portrait17.webp`), so the names are",
  "load-bearing. Kettlewright's README lists this art as CC-BY 4.0; the artist's",
  "own page says CC BY-SA 4.0, and the artist's statement governs. (Kettlewright's",
  "GPL-3.0 covers its code, not this art — the images are separately-licensed",
  "aggregated works.)",
  "",
  "## Contents",
  "",
  "| category | drawings |",
  "| --- | --- |",
  ...plan.map((c) => `| \`${c.key}/\` | ${c.names.length} |`),
  "",
  `${total} drawings. Generated by \`tools/import/tlomdev.mjs\`.`,
  "",
];

// The notice that travels with the art — same job as character_portraits/
// license.txt. The itch download carries no licence file of its own, so this
// records the artist's page statement rather than copying an upstream file.
const notice = [
  "Tlomdev's Tokens © 2023 by tlomdev",
  "Licensed under Creative Commons Attribution-ShareAlike 4.0 International",
  "(CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/",
  "",
  "Artist: https://tlomdev.itch.io/",
  "Source: https://tlomdev.itch.io/tlomdevs-tokens",
  "",
  `The "${KW_CATEGORY}" subfolder holds the same artist's drawings as shipped`,
  "by Kettlewright (https://github.com/yochaigal/kettlewright), with",
  "Kettlewright's exact filenames — its character importer maps stock portrait",
  "picks by that numbering. The artist's page statement above governs the",
  "licence for every file in this folder.",
  "",
].join("\n");

if (dry) {
  console.log("(dry run, not writing)");
  process.exit(0);
}

// A REBUILD THAT READS FROM THE TREE IT DELETES is the shape that removed all
// 1,366 game-icons on 2026-08-04 and then failed on its first read. Under
// `--to-webp` with no `--src`, every `cat.srcDir` points INSIDE OUT_DIR, so the
// rm below would take the art and the copy would find nothing. The files are
// already exactly where they belong in that mode; only the three generated
// files need rewriting.
if (!fromShipped) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  for (const cat of plan) {
    fs.mkdirSync(path.join(OUT_DIR, cat.key), { recursive: true });
    for (const n of cat.names) fs.copyFileSync(path.join(cat.srcDir, n), path.join(OUT_DIR, cat.key, n));
  }
}
fs.writeFileSync(path.join(OUT_DIR, "CREDITS.md"), credits.join("\n"));
fs.writeFileSync(path.join(OUT_DIR, "license.txt"), notice);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

console.log(`wrote ${path.relative(root, OUT_DIR)}/ (${total} files + CREDITS.md + license.txt)`);
console.log(`wrote ${path.relative(root, MANIFEST)}`);

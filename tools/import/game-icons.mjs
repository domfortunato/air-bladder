#!/usr/bin/env node
/**
 * Import the curated game-icons.net collection into game-icons/.
 *
 *   node tools/import/game-icons.mjs --src <dir> [--dry]
 *   node tools/import/game-icons.mjs --restamp [--dry]   (shipped tree, no download)
 *
 * Unlike its sibling `icons.mjs`, this one is NOT reproducible from the network:
 * its input is a hand-curated download, so which icons ship is a decision, not a
 * query. That makes `game-icons/` and `game-icons/CREDITS.md` the artifacts of
 * record — they are committed, and a rerun only ever needs to happen when the
 * curation changes. Point --src at the unpacked game-icons.net download.
 *
 * SOURCE SHAPE (what the site's archive gives you):
 *
 *   <src>/<category>/icons/<fg>/<bg>/1x1/<artist>/<icon>.svg
 *   <src>/<category>/icons/license.txt
 *
 * SHIPPED SHAPE (what the picker browses):
 *
 *   game-icons/<category>/<icon>.svg
 *
 * The flatten is the whole point — a Warden picking art should see thumbnails
 * under a category, not drill through a folder per artist. But it throws away
 * the one thing CC BY 3.0 requires, because **the artist is encoded ONLY in the
 * source path**. So the credits table is built from the source tree BEFORE the
 * copy, and `game-icons/CREDITS.md` is the attribution: lose it and the
 * collection is no longer licensed to ship.
 *
 * COLLISIONS. Within a single category the same filename can arrive from two
 * different artists (13 of them do — `animals/horse-head.svg` is both Lorc's and
 * Delapouite's). A naive flatten drops one and mis-credits the survivor, which
 * is a licensing error, not just a lost file. Colliding names are therefore
 * suffixed with the artist (`horse-head-lorc.svg`); names that do not collide
 * are left clean, because those are what the picker shows.
 *
 * Writes:
 *   game-icons/<category>/*.svg
 *   game-icons/CREDITS.md            per-icon CC BY 3.0 attribution
 *   game-icons/license.txt           upstream notice, verbatim
 *   module/game-icons-manifest.json  category -> filenames, for the picker
 *
 * The manifest exists for the same reason portrait-manifest.json does: a client
 * cannot enumerate a server folder without FILES_BROWSE, and players pick art.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withIntrinsicSize } from "./svg-size.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(root, "game-icons");
const MANIFEST = path.join(root, "module", "game-icons-manifest.json");
const dry = process.argv.includes("--dry");

/** Every .svg under dir, as absolute paths. */
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith(".svg")) out.push(p);
  }
  return out;
};

/**
 * `--restamp`: stamp the intrinsic size into the SHIPPED tree, no download
 * needed.
 *
 * This one is not reproducible from the network — its input is a hand-curated
 * download that lives on one machine — so the ordinary way to correct the
 * shipped files would be to find that download again. That is a bad dependency
 * for a fix every glyph needs, and the operation is a pure function of the file
 * anyway: idempotent, and a no-op on anything already carrying a width. Runs
 * before the --src check on purpose.
 */
if (process.argv.includes("--restamp")) {
  const files = walk(OUT_DIR);
  let stamped = 0;
  for (const f of files) {
    const before = fs.readFileSync(f, "utf8");
    const after = withIntrinsicSize(before);
    if (after === before) continue;
    if (!dry) fs.writeFileSync(f, after);
    stamped++;
  }
  console.log(`${dry ? "(dry run) " : ""}stamped ${stamped} of ${files.length} svg in ${path.relative(root, OUT_DIR)}/`);
  process.exit(0);
}

const srcFlag = process.argv.indexOf("--src");
const SRC = srcFlag !== -1 ? process.argv[srcFlag + 1] : null;
if (!SRC || !fs.existsSync(SRC)) {
  console.error("usage: node tools/import/game-icons.mjs --src <unpacked game-icons download> [--dry]");
  console.error("  the source tree must look like <src>/<category>/icons/<fg>/<bg>/1x1/<artist>/<icon>.svg");
  process.exit(1);
}

/**
 * Author display names. The download's own license.txt lists contributors in
 * prose; the folder slug is what the path carries. Anything not named here is
 * title-cased from its slug, which is right for the simple ones (`skoll`) and
 * would be wrong only for a name with unusual capitalisation — so the ones that
 * DO have unusual capitalisation are all listed.
 */
const AUTHORS = {
  "carl-olsen": "Carl Olsen",
  "caro-asercion": "Caro Asercion",
  "cathelineau": "Cathelineau",
  "darkzaitzev": "DarkZaitzev",
  "delapouite": "Delapouite",
  "faithtoken": "Faithtoken",
  "generalace135": "GeneralAce135",
  "irongamer": "Irongamer",
  "lorc": "Lorc",
  "lord-berandas": "Lord Berandas",
  "lucasms": "Lucas",
  "sbed": "Sbed",
  "skoll": "Skoll",
  "sparker": "Sparker",
  "various-artists": "Various artists",
  "willdabeast": "Willdabeast",
};
const authorName = (slug) =>
  AUTHORS[slug] ?? slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/**
 * The icon's page on game-icons.net, which is the CC BY "source" column.
 * `various-artists` has no per-artist page, so it gets the site root.
 */
const sourceUrl = (artist, slug) =>
  artist === "various-artists"
    ? "https://game-icons.net"
    : `https://game-icons.net/1x1/${artist}/${slug}.html`;

/** "horse-head" -> "Horse Head", for the credits table's readable column. */
const titleCase = (slug) =>
  slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// ---------------------------------------------------------------------------
// Read the source tree
// ---------------------------------------------------------------------------

const categories = fs.readdirSync(SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

if (!categories.length) {
  console.error(`no category folders under ${SRC}`);
  process.exit(1);
}

/** category -> [{ slug, artist, srcPath }] */
const found = new Map();
for (const cat of categories) {
  const entries = walk(path.join(SRC, cat)).map((srcPath) => {
    const parts = srcPath.split(path.sep);
    return {
      slug: path.basename(srcPath, ".svg"),
      // The artist is the directory the file sits in — the ONLY place the
      // source records it, which is why this runs before the copy.
      artist: parts[parts.length - 2],
      srcPath,
    };
  });
  if (entries.length) found.set(cat, entries);
}

// ---------------------------------------------------------------------------
// Resolve collisions, then plan the copy
// ---------------------------------------------------------------------------

/** category -> [{ file, slug, artist, srcPath }] where `file` is the shipped name. */
const plan = new Map();
const collisions = [];

for (const [cat, entries] of found) {
  const seen = new Map();
  for (const e of entries) seen.set(e.slug, (seen.get(e.slug) ?? 0) + 1);

  const rows = entries.map((e) => {
    const clashes = seen.get(e.slug) > 1;
    if (clashes) collisions.push(`${cat}/${e.slug}.svg (${e.artist})`);
    return { ...e, file: clashes ? `${e.slug}-${e.artist}.svg` : `${e.slug}.svg` };
  }).sort((a, b) => a.file.localeCompare(b.file));

  // A suffixed name could in principle still collide (one artist, same slug
  // twice). That cannot happen from a filesystem, but assert it rather than
  // silently overwrite — a lost icon here is a lost icon nobody would notice.
  const names = new Set();
  for (const r of rows) {
    if (names.has(r.file)) {
      console.error(`FATAL unresolved collision: ${cat}/${r.file}`);
      process.exit(1);
    }
    names.add(r.file);
  }
  plan.set(cat, rows);
}

const total = [...plan.values()].reduce((n, rows) => n + rows.length, 0);
const artists = new Set([...plan.values()].flat().map((r) => r.artist));

console.log(`${total} icons in ${plan.size} categories by ${artists.size} artists`);
if (collisions.length) {
  console.log(`${collisions.length} name collision(s), artist-suffixed:`);
  for (const c of collisions.sort()) console.log(`  ${c}`);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const manifest = {
  _comment: "Generated by tools/import/game-icons.mjs. Art: CC BY 3.0, game-icons.net — see game-icons/CREDITS.md.",
  iconDir: "systems/air-bladder/game-icons",
  categories: [...plan.entries()].map(([key, rows]) => ({ key, names: rows.map((r) => r.file) })),
};

const credits = [
  "# Game-Icons gallery",
  "",
  "The SVG icons in this folder are from **[game-icons.net](https://game-icons.net)**,",
  "used under the **Creative Commons Attribution 3.0 Unported (CC BY 3.0)** licence:",
  "<https://creativecommons.org/licenses/by/3.0/>.",
  "",
  "They are a curated selection offered in the portrait picker's **Game-Icons**",
  "gallery, grouped into the categories below. Each is a white glyph on a black",
  "field; the system does not recolour them.",
  "",
  "## Attribution",
  "",
  "game-icons.net art is contributed by individual authors, each of whom must be",
  "credited under CC BY 3.0. The upstream notice asks that derivative work include",
  '*"a mention \'Icons made by {author}\'"*, so every icon is listed with its author',
  "below.",
  "",
  "**This file IS the attribution.** The shipped path records only the category —",
  "the artist lives in the source download's folder structure, which the flatten",
  "discards (see `tools/import/game-icons.mjs`). Nothing else in the repo carries",
  "it.",
  "",
  `Icons made by ${[...artists].map(authorName).sort().join(", ")}.`,
  "",
  `${total} icons in ${plan.size} categories.`,
  "",
];

for (const [cat, rows] of plan) {
  credits.push(`## ${titleCase(cat)}`, "");
  credits.push("| file | icon | author | source |", "| --- | --- | --- | --- |");
  for (const r of rows) {
    credits.push(`| \`${r.file}\` | ${titleCase(r.slug)} | ${authorName(r.artist)} | <${sourceUrl(r.artist, r.slug)}> |`);
  }
  credits.push("");
}

// The upstream notice, verbatim from the download — same treatment as
// fonts/OFL.txt and character_portraits/license.txt, both of which ship because
// their licence requires the notice travel with the art.
const upstream = path.join(SRC, categories[0], "icons", "license.txt");
const notice = fs.existsSync(upstream) ? fs.readFileSync(upstream, "utf8") : null;
if (!notice) console.warn("WARN  no upstream license.txt found in the source tree");

if (dry) {
  console.log("(dry run, not writing)");
  process.exit(0);
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
for (const [cat, rows] of plan) {
  fs.mkdirSync(path.join(OUT_DIR, cat), { recursive: true });
  // Not copyFileSync: the download has no intrinsic size on any glyph, and 42
  // pack documents use these as TOKEN art. See ./svg-size.mjs.
  for (const r of rows) {
    fs.writeFileSync(
      path.join(OUT_DIR, cat, r.file),
      withIntrinsicSize(fs.readFileSync(r.srcPath, "utf8"))
    );
  }
}
fs.writeFileSync(path.join(OUT_DIR, "CREDITS.md"), credits.join("\n"));
if (notice) fs.writeFileSync(path.join(OUT_DIR, "license.txt"), notice);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

console.log(`wrote ${path.relative(root, OUT_DIR)}/ (${total} svg + CREDITS.md${notice ? " + license.txt" : ""})`);
console.log(`wrote ${path.relative(root, MANIFEST)}`);

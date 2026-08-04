#!/usr/bin/env node
/**
 * Import the curated game-icons.net collection into game-icons/.
 *
 *   node tools/import/game-icons.mjs --src <dir> [--dry]
 *   node tools/import/game-icons.mjs --add <dir> [--dry]  (one category, keep the rest)
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
 *
 * `--add`: ADDING ONE CATEGORY WITHOUT THE OTHER DOWNLOADS
 *
 * `--src` is a whole-collection rebuild — it wipes game-icons/ and writes back
 * only what the source tree holds. That is correct when you still have every
 * category's download, and useless when you do not: by 2026-08-03 exactly three
 * of the twenty-four survived on disk, so re-running it to add one category
 * would have silently dropped twenty-one.
 *
 * `--add <dir>` takes the same per-category download shape and MERGES it, by
 * reconstructing the existing categories from what is committed:
 *
 *   the SVG files       -> game-icons/<category>/*.svg  (already size-stamped;
 *                          withIntrinsicSize is idempotent, so they survive
 *                          a rewrite untouched)
 *   the artist + slug   -> game-icons/CREDITS.md, which is the ONLY record of
 *                          either (the flatten discards the artist, and this
 *                          file says so). Recovered from each row's source URL,
 *                          https://game-icons.net/1x1/<artist>/<slug>.html.
 *
 * That reconstruction is exactly why CREDITS.md has to stay one row per shipped
 * file: it is not just the attribution any more, it is the input that lets the
 * collection be extended at all. `--add` asserts the two agree before writing,
 * because a credits file that has drifted from the tree would silently
 * mis-attribute every icon it rebuilt.
 *
 * The source shape is per-category, so <dir> is the PARENT of the category
 * folder — the same thing --src wants. Categories already present are refused
 * rather than merged: re-importing one means resolving collisions against a
 * flattened tree whose artist suffixes are already baked in, and getting that
 * subtly wrong is a licensing error. Delete the folder and use --src for that.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withIntrinsicSize } from "./svg-size.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(root, "art", "game-icons");
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
const addFlag = process.argv.indexOf("--add");
const ADD = addFlag !== -1;
const SRC = ADD ? process.argv[addFlag + 1] : (srcFlag !== -1 ? process.argv[srcFlag + 1] : null);
if (!SRC || !fs.existsSync(SRC)) {
  console.error("usage: node tools/import/game-icons.mjs --src <unpacked game-icons download> [--dry]");
  console.error("       node tools/import/game-icons.mjs --add <unpacked download> [--dry]   (merge new categories)");
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
  // Two the title-caser gets wrong, both confirmed 2026-08-04 when `shields`
  // arrived: the download's own license.txt names "Andy Meneely" (the slug has
  // no separator to split on), and game-icons.net credits `seregacthtuf` as
  // "SeregaCthtuf" -- an interior capital no slug can carry. That artist is not
  // in the upstream notice at all, which is a static file and lags the site, so
  // the icon's own page is the authority for a name CC BY requires be right.
  "andymeneely": "Andy Meneely",
  "seregacthtuf": "SeregaCthtuf",
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

// ---------------------------------------------------------------------------
// --add: fold the SHIPPED collection back into the plan, so the whole-tree
// write below reproduces it instead of deleting it.
// ---------------------------------------------------------------------------

if (ADD) {
  const creditsPath = path.join(OUT_DIR, "CREDITS.md");
  if (!fs.existsSync(creditsPath)) {
    console.error(`--add needs the existing ${path.relative(root, creditsPath)} to recover artists from`);
    process.exit(1);
  }
  // Reverse the display-name map for the one row whose source URL carries no
  // artist slug (`various-artists` has no per-artist page, so sourceUrl() emits
  // the bare site).
  const slugOf = Object.fromEntries(Object.entries(AUTHORS).map(([slug, name]) => [name, slug]));

  // | `file.svg` | Title | Author Name | <https://game-icons.net/1x1/artist/slug.html> |
  const ROW = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*<([^>]+)>\s*\|$/;
  let current = null;
  const recovered = new Map();
  for (const line of fs.readFileSync(creditsPath, "utf8").split(/\r?\n/)) {
    const head = /^##\s+(.+?)\s*$/.exec(line);
    // Section headings are title-cased category names; "Attribution" is prose.
    if (head) { current = head[1].toLowerCase().replace(/\s+/g, "-"); continue; }
    const m = ROW.exec(line);
    if (!m || !current) continue;
    const [, file, , author, url] = m;
    const fromUrl = /game-icons\.net\/1x1\/([^/]+)\/([^/.]+)\.html/.exec(url);
    const artist = fromUrl ? fromUrl[1] : (slugOf[author] ?? author.toLowerCase().replace(/\s+/g, "-"));
    const slug = fromUrl ? fromUrl[2] : path.basename(file, ".svg");
    if (!recovered.has(current)) recovered.set(current, []);
    // `content`, not `srcPath`: a recovered icon's source IS the shipped tree,
    // and the write phase removes that tree before it copies. Reading the bytes
    // now is what makes the rebuild survive its own rm -- pointing srcPath into
    // OUT_DIR deletes every shipped icon and then fails on the first read.
    recovered.get(current).push({ file, slug, artist, srcPath: path.join(OUT_DIR, current, file), content: null });
  }

  // The credits file is the input here, not just documentation — so prove it
  // still describes the tree before trusting it. A row without a file would
  // crash the copy; a file without a row would be dropped AND lose its
  // attribution, which is the licensing failure this whole script exists to
  // avoid. Neither is worth a partial write.
  const problems = [];
  for (const [cat, rows] of recovered) {
    for (const r of rows) if (!fs.existsSync(r.srcPath)) problems.push(`credited but missing: ${cat}/${r.file}`);
  }
  for (const cat of fs.readdirSync(OUT_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const known = new Set((recovered.get(cat) ?? []).map((r) => r.file));
    for (const f of fs.readdirSync(path.join(OUT_DIR, cat)).filter((f) => f.endsWith(".svg"))) {
      if (!known.has(f)) problems.push(`on disk but uncredited: ${cat}/${f}`);
    }
  }
  if (problems.length) {
    console.error(`CREDITS.md has drifted from game-icons/ -- refusing to rebuild from it:`);
    for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
    if (problems.length > 20) console.error(`  ...and ${problems.length - 20} more`);
    process.exit(1);
  }

  // Every shipped byte into memory, BEFORE the write phase removes the tree.
  for (const rows of recovered.values()) {
    for (const r of rows) r.content = fs.readFileSync(r.srcPath, "utf8");
  }

  const added = [...plan.keys()];
  for (const cat of added) {
    if (recovered.has(cat)) {
      console.error(`category "${cat}" already ships (${recovered.get(cat).length} icons).`);
      console.error(`  --add will not merge into an existing category: the shipped names already carry`);
      console.error(`  artist suffixes from the last collision pass, and re-resolving against them is`);
      console.error(`  how an icon gets mis-credited. Delete game-icons/${cat}/ and use --src instead.`);
      process.exit(1);
    }
  }
  for (const [cat, rows] of recovered) plan.set(cat, rows);
  // Re-sort: the new category was planned first, and both the manifest and the
  // credits tables are written in Map order. Alphabetical keeps the picker's
  // category strip stable and keeps an --add diff to the rows it really added.
  const sorted = new Map([...plan.entries()].sort(([a], [b]) => a.localeCompare(b)));
  plan.clear();
  for (const [k, v] of sorted) plan.set(k, v);
  console.log(`--add: recovered ${[...recovered.values()].reduce((n, r) => n + r.length, 0)} shipped icons`
    + ` in ${recovered.size} categories, adding ${added.join(", ")}`);
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
  iconDir: "systems/air-bladder/art/game-icons",
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
// In --add the shipped notice is already the one of record and covers the whole
// collection; a per-category download carries the same text, but rewriting it
// from one category's copy would put a licence file's provenance at the mercy of
// whichever folder happened to be added last. Read it into memory NOW rather
// than skipping the write -- the whole directory is removed below, so "leave it
// alone" and "delete it" are the same thing here, and this file is the notice
// CC BY 3.0 requires travel with the art.
const shipped = path.join(OUT_DIR, "license.txt");
const upstream = path.join(SRC, categories[0], "icons", "license.txt");
const noticeSrc = ADD && fs.existsSync(shipped) ? shipped : upstream;
const notice = fs.existsSync(noticeSrc) ? fs.readFileSync(noticeSrc, "utf8") : null;
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
    // `content` is set only by --add, whose sources live in the tree this write
    // has already removed. Everything else still reads from the download.
    fs.writeFileSync(
      path.join(OUT_DIR, cat, r.file),
      withIntrinsicSize(r.content ?? fs.readFileSync(r.srcPath, "utf8"))
    );
  }
}
fs.writeFileSync(path.join(OUT_DIR, "CREDITS.md"), credits.join("\n"));
if (notice) fs.writeFileSync(path.join(OUT_DIR, "license.txt"), notice);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

console.log(`wrote ${path.relative(root, OUT_DIR)}/ (${total} svg + CREDITS.md${notice ? " + license.txt" : ""})`);
console.log(`wrote ${path.relative(root, MANIFEST)}`);

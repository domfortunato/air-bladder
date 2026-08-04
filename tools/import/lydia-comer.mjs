#!/usr/bin/env node
/**
 * Build the Lydia Comer gallery — her monster art, offered in the portrait
 * picker on NPC and Monster sheets.
 *
 *   node tools/import/lydia-comer.mjs [--src <dir>] [--dry]
 *   node tools/import/lydia-comer.mjs --to-webp      (re-encode the shipped tree)
 *
 * UNLIKE its siblings `game-icons.mjs` and `tlomdev.mjs`, this gallery is a
 * PAIRED one: every creature ships twice, as a square portrait and as the
 * circle-cropped token drawn from it, exactly like Jon Aspeheim's
 * character_portraits/ + character_tokens/. That is the whole reason it is a
 * gallery of its own rather than another tlomdev-shaped category tree — a
 * tlomdev pick is its own token because there is no square to pair with, and
 * Lydia's circles have black corners that make a poor `actor.img`.
 *
 * SOURCE SHAPE (`--src`, ingest mode):
 *
 *   <src>/<Name>.jpg     the square drawing            -> portraits/
 *   <src>/<Name>.png     the circle-cropped token      -> tokens/
 *
 * Pairing is BY STEM, not by filename — the halves arrive in different formats,
 * and the SOURCE is still read that way. Every stem must have both halves; a
 * lone file is a hard error, never a skip, because a missing token ships a
 * portrait whose token silently falls back to the black-cornered circle, and a
 * missing portrait ships nothing at all.
 *
 * WEBP, AND WHY THAT WAS A LICENCE DECISION BEFORE IT WAS A TECHNICAL ONE.
 * Everything ships re-encoded to WebP q95 since 2026-08-04. Until that date this
 * file said "her grant forbids modifying the artwork, so nothing here
 * re-encodes", and that was correct at the time: the grant then in force said
 * the artwork may not be modified, and re-encoding under it would have been a
 * licence breach dressed up as an optimisation. The artist has since rewritten
 * the grant (`art/lydia-comer/license.txt`) and the current text sets no bar on
 * altering the artwork at all — it bounds USE instead, to Air Bladder and to
 * representing the project.
 *
 * So the reason nothing here crops, rescales or recolours is now HOUSE PRACTICE,
 * not a licence term. Keep it anyway. It is someone's original artwork, the
 * artist is reachable, and "the licence would let us" is a poor answer to give
 * her. What it is NOT any longer is a rule this file may cite as external.
 *
 * q95 rather than the usual q80-85: at q95 the average pixel moves less than
 * 1/255 (PSNR 46-50 dB) and the gallery still loses 54% of its weight, 15.8 MB
 * down to ~7 MB. It is someone's original artwork, and the ~1.3 MB that q90
 * would have saved is not worth spending on it.
 *
 * Lossless was measured and rejected: it is the WRONG tool for the square half.
 * Those arrive as JPEG, so a lossless re-encode faithfully preserves their
 * existing compression artifacts and the file gets BIGGER — 592K to 672K on the
 * largest. Lossless only pays on the PNG circles.
 *
 * SHIPPED SHAPE (what the picker browses):
 *
 *   lydia-comer/portraits/<Name>.webp
 *   lydia-comer/tokens/<Name>.webp
 *   lydia-comer/CREDITS.md            the gallery's contents + attribution
 *   module/lydia-manifest.json        pairs, for the picker
 *
 * Both halves are now the same extension, so the manifest's `pairs` could in
 * principle be a bare name list the way portrait-manifest.json is. It stays a
 * pair list: the runtime lookup already reads it, changing the shape buys
 * nothing, and a gallery whose two halves live in different folders is exactly
 * where a "they must match" assumption goes unnoticed until it does not.
 *
 * With NO --src it re-validates the shipped tree and regenerates the manifest
 * and CREDITS.md from it — the tree is its own source of truth, so a rerun is
 * safe and needs no download. (game-icons.mjs `--restamp` exists for the same
 * reason: an operation that is a pure function of the shipped files should not
 * depend on finding the original download again.)
 *
 * IT NEVER TOUCHES lydia-comer/ ITSELF, only the two subfolders. The parent
 * holds the LOGO (Airbladder*.webp, Airbladder07.jpg) and her licence grant,
 * and `tools/site.mjs` copies three of those webps into the website by name.
 * tlomdev.mjs rmSyncs its whole output folder; doing that here would delete the
 * logo, the licence and the site's header image. Airbladder* is excluded from
 * ingest by name for the same reason — Airbladder07.jpg is a wordmark, not a
 * creature, and it is a .jpg sitting in the ingest folder.
 *
 * The manifest exists for the same reason portrait-manifest.json does: a client
 * cannot enumerate a server folder without FILES_BROWSE, and players pick art.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GALLERY = path.join(root, "art", "lydia-comer");
const PORTRAITS = path.join(GALLERY, "portraits");
const TOKENS = path.join(GALLERY, "tokens");
const MANIFEST = path.join(root, "module", "lydia-manifest.json");
const CREDITS = path.join(GALLERY, "CREDITS.md");

const ARTIST = "Lydia Comer";
const ARTIST_URL = "https://linktr.ee/lydiadidmyink";

const dry = process.argv.includes("--dry");
const argAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
};
const srcArg = argAfter("--src");
const SRC = srcArg ? path.resolve(srcArg) : null;

const die = (msg) => { console.error(`FATAL ${msg}`); process.exit(1); };

if (SRC && !fs.existsSync(SRC)) die(`--src does not exist: ${SRC}`);

// The logo lives in the same folder and must never be read as creature art.
const isLogo = (name) => /^Airbladder/i.test(name);
const isJunk = (name) => name === ".DS_Store" || name.startsWith("._");
const natural = (a, b) => a.localeCompare(b, "en", { numeric: true });

/** {stem -> filename} for one extension set, logo and junk excluded. */
const filesByStem = (dir, re) => {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || isJunk(e.name) || isLogo(e.name) || !re.test(e.name)) continue;
    const stem = e.name.replace(re, "");
    if (out.has(stem)) die(`two files share the stem "${stem}" in ${dir}`);
    out.set(stem, e.name);
  }
  return out;
};

/** What the artist delivers. */
const PORTRAIT_EXT = /\.jpe?g$/i;
const TOKEN_EXT = /\.png$/i;
/** What ships, both halves alike, since the grant was extended to allow it. */
const SHIPPED_EXT = /\.webp$/i;

/**
 * q95, and the reason is at the top of this file: it is someone's original
 * artwork, so the setting errs toward the art rather than toward the byte count.
 * `effort: 6` is sharp's default; raised because this runs 34 times, once.
 */
const WEBP = { quality: 95, effort: 6 };
const webpName = (file) => `${file.replace(/\.[^.]+$/, "")}.webp`;

/* -------------------------------------------------------------------------- */
/*  Ingest                                                                     */
/* -------------------------------------------------------------------------- */

if (SRC) {
  const squares = filesByStem(SRC, PORTRAIT_EXT);
  const circles = filesByStem(SRC, TOKEN_EXT);
  if (!squares.size && !circles.size) die(`no .jpg/.png art under ${SRC}`);

  // Report BOTH halves of the mismatch, never just the first — a half-delivered
  // batch is the normal failure and naming one file at a time turns it into a
  // guessing game.
  const lonely = [
    ...[...squares.keys()].filter((s) => !circles.has(s)).map((s) => `${s}: square with no token`),
    ...[...circles.keys()].filter((s) => !squares.has(s)).map((s) => `${s}: token with no square`),
  ].sort(natural);
  if (lonely.length) die(`unpaired art in ${SRC}:\n  ${lonely.join("\n  ")}`);

  const stems = [...squares.keys()].sort(natural);
  console.log(`${stems.length} paired drawings under ${path.relative(root, SRC) || SRC}`);

  // Staged INSIDE the gallery folder (how they arrive: dropped in beside the
  // logo) means moving, not copying — a copy would ship every drawing twice,
  // once loose in lydia-comer/ and once under portraits/.
  const consume = SRC === GALLERY;
  console.log(consume ? "  source is the gallery folder — moving into place" : "  copying into place");

  if (!dry) {
    fs.rmSync(PORTRAITS, { recursive: true, force: true });
    fs.rmSync(TOKENS, { recursive: true, force: true });
    fs.mkdirSync(PORTRAITS, { recursive: true });
    fs.mkdirSync(TOKENS, { recursive: true });
    for (const stem of stems) {
      const moves = [
        [path.join(SRC, squares.get(stem)), path.join(PORTRAITS, webpName(squares.get(stem)))],
        [path.join(SRC, circles.get(stem)), path.join(TOKENS, webpName(circles.get(stem)))],
      ];
      for (const [from, to] of moves) {
        await sharp(from).webp(WEBP).toFile(to);
        // `consume` means the source IS the gallery folder — the artist drops
        // the batch in beside the logo. The original has to go either way, or
        // the tree ships every drawing twice, once loose and once encoded.
        if (consume) fs.rmSync(from);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Validate the shipped tree and regenerate                                   */
/* -------------------------------------------------------------------------- */

if (dry) {
  console.log("(dry run, nothing written)");
  process.exit(0);
}

/**
 * `--to-webp`: re-encode the SHIPPED tree in place, no delivery needed.
 *
 * The same argument `game-icons.mjs --restamp` makes. The gallery in the repo is
 * the only copy of these files that this machine is guaranteed to have — the
 * artist's originals came in a one-off delivery — so making a conversion every
 * file needs depend on finding that delivery again is a bad trade for something
 * that is a pure function of the bytes already committed.
 *
 * Runs before the shipped-tree validation below, which now expects .webp on both
 * halves and would otherwise refuse to look at a tree that has not been through
 * here yet.
 */
if (process.argv.includes("--to-webp")) {
  let done = 0, before = 0, after = 0;
  for (const [dir, ext] of [[PORTRAITS, PORTRAIT_EXT], [TOKENS, TOKEN_EXT]]) {
    for (const [, file] of filesByStem(dir, ext)) {
      const from = path.join(dir, file);
      const to = path.join(dir, webpName(file));
      before += fs.statSync(from).size;
      const buf = await sharp(from).webp(WEBP).toBuffer();
      fs.writeFileSync(to, buf);
      after += buf.length;
      // Only after the replacement is on disk. A crash between the two leaves a
      // duplicated pair, which the validation below reports; the reverse leaves
      // artwork that exists nowhere.
      fs.rmSync(from);
      done++;
    }
  }
  if (!done) console.log("nothing to convert — the shipped tree is already .webp");
  else console.log(`re-encoded ${done} file(s) to WebP q${WEBP.quality}: `
    + `${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB `
    + `(${(100 - after / before * 100).toFixed(0)}% smaller)`);
}

const shippedPortraits = filesByStem(PORTRAITS, SHIPPED_EXT);
const shippedTokens = filesByStem(TOKENS, SHIPPED_EXT);
if (!shippedPortraits.size) die(`no portraits under ${path.relative(root, PORTRAITS)} — run with --src first`);

const broken = [
  ...[...shippedPortraits.keys()].filter((s) => !shippedTokens.has(s)).map((s) => `${s}: portrait with no token`),
  ...[...shippedTokens.keys()].filter((s) => !shippedPortraits.has(s)).map((s) => `${s}: token with no portrait`),
].sort(natural);
if (broken.length) die(`the shipped gallery is unpaired:\n  ${broken.join("\n  ")}`);

const stems = [...shippedPortraits.keys()].sort(natural);
const pairs = stems.map((stem) => ({ portrait: shippedPortraits.get(stem), token: shippedTokens.get(stem) }));

const manifest = {
  _comment: `Generated by tools/import/lydia-comer.mjs. Art: © ${ARTIST}, all rights reserved — see lydia-comer/license.txt.`,
  portraitDir: "systems/air-bladder/art/lydia-comer/portraits",
  tokenDir: "systems/air-bladder/art/lydia-comer/tokens",
  pairs,
};

const kb = (p) => Math.round(fs.statSync(p).size / 1024);
const credits = [
  `# ${ARTIST} gallery`,
  "",
  `Every drawing here is by **[${ARTIST}](${ARTIST_URL})**, drawn for Air Bladder`,
  "and licensed to it directly. It is **not** Creative Commons and not part of any",
  "of the system's other licence regimes: **© Lydia Comer, all rights reserved**,",
  "granted to Air Bladder for inclusion and redistribution as part of the system",
  "and its forks, and for use representing and promoting the project. Any use",
  "outside the Air Bladder project requires the artist's permission. Full terms:",
  "`license.txt` beside this file.",
  "",
  "**These files are re-encoded to WebP q95 and changed in no other way.** They",
  "are not cropped, rescaled, recoloured or redrawn. That is this project's own",
  "practice rather than a term of the grant — the licence sets no bar on altering",
  "the artwork, and leaving someone's drawings as they were drawn does not need",
  "one.",
  "",
  "## Shape",
  "",
  "A **paired** gallery, like Jon Aspeheim's: each creature ships as a square",
  "portrait and as the circle-cropped token drawn from it, matched **by stem**.",
  "Picking a portrait sets the paired token with it.",
  "",
  "| | |",
  "| --- | --- |",
  "| `portraits/` | square art, shown on the sheet (`actor.img`) |",
  "| `tokens/` | circle-cropped art, the prototype token texture |",
  "",
  "Offered in the portrait picker's **Lydia Comer** tab on NPC, Hireling and",
  "Monster sheets. Not offered on Player Characters — these are creatures.",
  "",
  "The logo files (`Airbladder*.webp`, `Airbladder07.jpg`) sit in the parent",
  "folder and are the same artist under the same grant, but they are not gallery",
  "art and the importer ignores them by name.",
  "",
  "## Contents",
  "",
  "| creature | portrait | token |",
  "| --- | --- | --- |",
  ...pairs.map(({ portrait, token }) =>
    `| ${portrait.replace(PORTRAIT_EXT, "").replace(/-/g, " ")} `
    + `| \`${portrait}\` (${kb(path.join(PORTRAITS, portrait))} KB) `
    + `| \`${token}\` (${kb(path.join(TOKENS, token))} KB) |`),
  "",
  `${pairs.length} creatures, ${pairs.length * 2} files. Generated by \`tools/import/lydia-comer.mjs\`.`,
  "",
];

fs.writeFileSync(CREDITS, credits.join("\n"));
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

const bytes = pairs.reduce((n, { portrait, token }) =>
  n + fs.statSync(path.join(PORTRAITS, portrait)).size + fs.statSync(path.join(TOKENS, token)).size, 0);
console.log(`gallery: ${pairs.length} pairs, ${(bytes / 1048576).toFixed(1)} MB`);
console.log(`wrote ${path.relative(root, CREDITS)}`);
console.log(`wrote ${path.relative(root, MANIFEST)}`);

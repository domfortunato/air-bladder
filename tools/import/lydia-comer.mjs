#!/usr/bin/env node
/**
 * Build the Lydia Comer galleries — her art for this system, offered in the
 * portrait picker. TWO SETS since 2026-09-05:
 *
 *   characters  portraits/ + tokens/                    PC, NPC and Hireling sheets
 *   monsters    portraits-monsters/ + tokens-monsters/  Monster sheets
 *
 *   node tools/import/lydia-comer.mjs --src <dir> --set characters|monsters [--add] [--dry]
 *   node tools/import/lydia-comer.mjs                (validate + regenerate both sets)
 *   node tools/import/lydia-comer.mjs --to-webp      (re-encode the shipped tree)
 *
 * The monsters lived in portraits/ + tokens/ from 2026-08-04 until the artist's
 * character batch arrived; they moved aside (git mv, plus `movedArt` rules in
 * cairn.js for existing worlds) so the characters could take the plain folders —
 * they are the set most sheets offer.
 *
 * UNLIKE its siblings `game-icons.mjs` and `tlomdev.mjs`, these galleries are
 * PAIRED: every drawing ships twice, as a square portrait and as the
 * circle-cropped token drawn from it, exactly like Jon Aspeheim's
 * character_portraits/ + character_tokens/. That is the whole reason each is a
 * gallery of its own rather than another tlomdev-shaped category tree — a
 * tlomdev pick is its own token because there is no square to pair with, and
 * Lydia's circles have black corners that make a poor `actor.img`.
 *
 * SOURCE SHAPE (`--src`, ingest mode) — either a flat folder or one with the
 * two halves already split (how deliveries arrive since the character batch):
 *
 *   <src>/<Name>.jpg                  the square drawing            -> portraits half
 *   <src>/<Name>.png                  the circle-cropped token      -> tokens half
 *   <src>/portraits/<Name>.jpg        same, pre-sorted
 *   <src>/tokens/<Name>.png
 *
 * Pairing is BY STEM, not by filename — the halves arrive in different formats,
 * and the SOURCE is still read that way. Every stem must have both halves; a
 * lone file is a hard error, never a skip, because a missing token ships a
 * portrait whose token silently falls back to the black-cornered circle, and a
 * missing portrait ships nothing at all. Sources are COPIED, never consumed:
 * the delivery folder is the artist's archive, and the one mode that consumed
 * (art staged loose in the gallery folder itself) is refused outright now that
 * two sets share that folder.
 *
 * `--add` appends the source's pairs to the set instead of rebuilding it — how
 * a follow-up delivery lands without re-encoding what already shipped. A stem
 * the set already holds is a hard error, not an overwrite.
 *
 * WEBP, AND WHY THAT WAS A LICENCE DECISION BEFORE IT WAS A TECHNICAL ONE.
 * Everything ships re-encoded to WebP q95 since 2026-08-04. Until that date this
 * file said "her grant forbids modifying the artwork, so nothing here
 * re-encodes", and that was correct at the time: the grant then in force said
 * the artwork may not be modified, and re-encoding under it would have been a
 * licence breach dressed up as an optimisation. The artist has since relicensed
 * the galleries under CC BY 4.0 (2026-09-05; before that, a rewritten direct
 * grant), which sets no bar on altering the artwork at all.
 *
 * So the reason nothing here crops, rescales or recolours is HOUSE PRACTICE,
 * not a licence term. Keep it anyway. It is someone's original artwork, the
 * artist is reachable, and "the licence would let us" is a poor answer to give
 * her. What it is NOT is a rule this file may cite as external.
 *
 * q95 rather than the usual q80-85: at q95 the average pixel moves less than
 * 1/255 (PSNR 46-50 dB) and the gallery still loses half its weight. It is
 * someone's original artwork, and the little that q90 would save is not worth
 * spending on it.
 *
 * Lossless was measured and rejected: it is the WRONG tool for the square half.
 * Those arrive as JPEG, so a lossless re-encode faithfully preserves their
 * existing compression artifacts and the file gets BIGGER — 592K to 672K on the
 * largest. Lossless only pays on the PNG circles.
 *
 * SHIPPED SHAPE (what the picker browses):
 *
 *   lydia-comer/portraits/<Name>.webp            characters set
 *   lydia-comer/tokens/<Name>.webp
 *   lydia-comer/portraits-monsters/<Name>.webp   monsters set
 *   lydia-comer/tokens-monsters/<Name>.webp
 *   lydia-comer/CREDITS.md                       both sets' contents + attribution
 *   module/lydia-manifest.json                   { sets: { characters, monsters } }
 *
 * Both halves are the same extension, so a set's `pairs` could in principle be
 * a bare name list the way portrait-manifest.json is. It stays a pair list: the
 * runtime lookup already reads it, changing the shape buys nothing, and a
 * gallery whose two halves live in different folders is exactly where a "they
 * must match" assumption goes unnoticed until it does not.
 *
 * With NO --src it re-validates the shipped tree and regenerates the manifest
 * and CREDITS.md from it — the tree is its own source of truth, so a rerun is
 * safe and needs no download. (game-icons.mjs `--restamp` exists for the same
 * reason: an operation that is a pure function of the shipped files should not
 * depend on finding the original download again.)
 *
 * IT NEVER TOUCHES lydia-comer/ ITSELF, only the four subfolders. The parent
 * holds the LOGO — Airbladder01/02/06.webp, exactly the three the README and
 * `tools/site.mjs` use by name; the unused variants (03, 04, and the 07.jpg
 * wordmark) were removed 2026-08-04 by user ruling — and her licence file.
 * tlomdev.mjs rmSyncs its whole output folder; doing that here would delete
 * the logo, the licence and the site's header image. Airbladder* is excluded
 * from ingest by name for the same reason — a wordmark is not gallery art.
 * The logo also stays ALL RIGHTS RESERVED: the CC BY relicence covers the
 * galleries, not the mark.
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
const MANIFEST = path.join(root, "module", "lydia-manifest.json");
const CREDITS = path.join(GALLERY, "CREDITS.md");

const ARTIST = "Lydia Comer";
const ARTIST_URL = "https://linktr.ee/lydiadidmyink";
const SOURCE_URL = "https://domfortunato.itch.io/lydia-comer";
const DEED_URL = "https://creativecommons.org/licenses/by/4.0/";

/**
 * The two sets. `noun` is what a row of the set's CREDITS table is; the
 * `portraitDir`/`tokenDir` strings are what the manifest publishes and every
 * runtime consumer prefixes onto a filename.
 */
const SETS = {
  characters: {
    portraits: path.join(GALLERY, "portraits"),
    tokens: path.join(GALLERY, "tokens"),
    portraitDir: "systems/air-bladder/art/lydia-comer/portraits",
    tokenDir: "systems/air-bladder/art/lydia-comer/tokens",
    noun: "character",
  },
  monsters: {
    portraits: path.join(GALLERY, "portraits-monsters"),
    tokens: path.join(GALLERY, "tokens-monsters"),
    portraitDir: "systems/air-bladder/art/lydia-comer/portraits-monsters",
    tokenDir: "systems/air-bladder/art/lydia-comer/tokens-monsters",
    noun: "creature",
  },
};

const dry = process.argv.includes("--dry");
const add = process.argv.includes("--add");
const argAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
};
const srcArg = argAfter("--src");
const SRC = srcArg ? path.resolve(srcArg) : null;
const setArg = argAfter("--set");

const die = (msg) => { console.error(`FATAL ${msg}`); process.exit(1); };

if (SRC && !fs.existsSync(SRC)) die(`--src does not exist: ${SRC}`);
if (SRC && !setArg) die(`--src needs --set characters|monsters — two sets ship, and a source does not say which it is`);
if (setArg && !SETS[setArg]) die(`unknown --set "${setArg}" (characters|monsters)`);
if (add && !SRC) die(`--add is an ingest option — it needs --src`);

// The logo lives in the same folder and must never be read as gallery art.
const isLogo = (name) => /^Airbladder/i.test(name);
const isJunk = (name) => name === ".DS_Store" || name.startsWith("._")
  || /^(desktop\.ini|thumbs\.db)$/i.test(name);
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
/** What ships, both halves alike. */
const SHIPPED_EXT = /\.webp$/i;

/**
 * q95, and the reason is at the top of this file: it is someone's original
 * artwork, so the setting errs toward the art rather than toward the byte count.
 * `effort: 6` is sharp's default; raised because an ingest runs each file once.
 */
const WEBP = { quality: 95, effort: 6 };
/**
 * The TOKEN half is sized for the canvas (user ruling 2026-08-04): 400×400,
 * the media guide's stated standard. A map token draws at ~100px on a 100px
 * grid; shipping it at the portrait's 1000×1000 uploaded a 25× texture per
 * token for nothing. PORTRAITS STAY FULL SIZE: they are sheet art, and
 * 1000×1000 is correct there.
 */
const TOKEN_SIZE = 400;
const encodeToken = (img) => img.resize(TOKEN_SIZE, TOKEN_SIZE, { fit: "cover" }).webp(WEBP);
const webpName = (file) => `${file.replace(/\.[^.]+$/, "")}.webp`;

/* -------------------------------------------------------------------------- */
/*  Ingest                                                                     */
/* -------------------------------------------------------------------------- */

if (SRC) {
  const set = SETS[setArg];

  // The one mode the old single-set importer CONSUMED — art staged loose in the
  // gallery folder beside the logo — is refused now: with two sets in the tree
  // there is no way to read "the gallery folder" as one set's delivery, and
  // consuming was only ever a way to avoid shipping a drawing twice.
  if (SRC === GALLERY || SRC.startsWith(GALLERY + path.sep))
    die(`--src must be a staging folder outside ${path.relative(root, GALLERY)} — sources are copied, never consumed`);

  // A delivery either arrives flat or pre-split into portraits/ + tokens/.
  // One level, no deeper: the split is the artist's own sorting, not a tree.
  const subP = path.join(SRC, "portraits");
  const subT = path.join(SRC, "tokens");
  const presplit = fs.existsSync(subP) && fs.existsSync(subT);
  const squares = filesByStem(presplit ? subP : SRC, PORTRAIT_EXT);
  const circles = filesByStem(presplit ? subT : SRC, TOKEN_EXT);
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
  console.log(`${stems.length} paired drawings under ${path.relative(root, SRC) || SRC}`
    + ` -> ${setArg}${presplit ? " (pre-split source)" : ""}${add ? " (append)" : ""}`);

  if (add) {
    const shipped = filesByStem(set.portraits, SHIPPED_EXT);
    const clash = stems.filter((s) => shipped.has(s));
    if (clash.length) die(`--add would overwrite shipped pairs in ${setArg}: ${clash.join(", ")}`
      + ` — a re-delivery of an existing drawing is a decision, not an append`);
  }

  if (!dry) {
    if (!add) {
      fs.rmSync(set.portraits, { recursive: true, force: true });
      fs.rmSync(set.tokens, { recursive: true, force: true });
    }
    fs.mkdirSync(set.portraits, { recursive: true });
    fs.mkdirSync(set.tokens, { recursive: true });
    const srcP = presplit ? subP : SRC;
    const srcT = presplit ? subT : SRC;
    for (const stem of stems) {
      await sharp(path.join(srcP, squares.get(stem))).webp(WEBP)
        .toFile(path.join(set.portraits, webpName(squares.get(stem))));
      await encodeToken(sharp(path.join(srcT, circles.get(stem))))
        .toFile(path.join(set.tokens, webpName(circles.get(stem))));
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
 * artist's originals came in one-off deliveries — so making a conversion every
 * file needs depend on finding a delivery again is a bad trade for something
 * that is a pure function of the bytes already committed.
 *
 * Runs before the shipped-tree validation below, which expects .webp on both
 * halves and would otherwise refuse to look at a tree that has not been through
 * here yet.
 */
if (process.argv.includes("--to-webp")) {
  let done = 0, before = 0, after = 0;
  for (const set of Object.values(SETS)) {
    for (const [dir, ext] of [[set.portraits, PORTRAIT_EXT], [set.tokens, TOKEN_EXT]]) {
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
  }
  if (!done) console.log("nothing to convert — the shipped tree is already .webp");
  else console.log(`re-encoded ${done} file(s) to WebP q${WEBP.quality}: `
    + `${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB `
    + `(${(100 - after / before * 100).toFixed(0)}% smaller)`);
}

/**
 * `--resize-tokens`: bring the SHIPPED token halves to TOKEN_SIZE in place —
 * the 2026-08-04 pass that took them from the portrait's 1000×1000 down to
 * canvas size. Same shipped-tree argument as `--to-webp` above. Skips a file
 * already at or below TOKEN_SIZE rather than re-encoding it: a q95 re-encode
 * of a q95 file is pure generation loss, so a re-run must be a no-op.
 */
if (process.argv.includes("--resize-tokens")) {
  let done = 0, skipped = 0, before = 0, after = 0;
  for (const set of Object.values(SETS)) {
    for (const [, file] of filesByStem(set.tokens, SHIPPED_EXT)) {
      const p = path.join(set.tokens, file);
      // Through a BUFFER, not the path: sharp holds the input file open on
      // Windows, so encoding from the path and writing back to it EPERMs.
      const src = fs.readFileSync(p);
      const meta = await sharp(src).metadata();
      if (meta.width <= TOKEN_SIZE && meta.height <= TOKEN_SIZE) { skipped++; continue; }
      before += src.length;
      const buf = await encodeToken(sharp(src)).toBuffer();
      fs.writeFileSync(p, buf);
      after += buf.length;
      done++;
    }
  }
  console.log(done
    ? `resized ${done} token(s) to ${TOKEN_SIZE}px WebP q${WEBP.quality}: `
      + `${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(2)} MB; ${skipped} already at size`
    : `nothing to resize — all ${skipped} token(s) already at ${TOKEN_SIZE}px or below`);
}

/**
 * Both sets, validated the same way. BOTH must be populated: the runtime offers
 * each on some sheet, so an empty set is a mid-migration tree (the window
 * between `git mv`-ing the monsters aside and ingesting the characters), never
 * a shippable state.
 */
const setPairs = {};
for (const [name, set] of Object.entries(SETS)) {
  const shippedPortraits = filesByStem(set.portraits, SHIPPED_EXT);
  const shippedTokens = filesByStem(set.tokens, SHIPPED_EXT);
  if (!shippedPortraits.size)
    die(`no portraits under ${path.relative(root, set.portraits)} — run with --src <dir> --set ${name} first`);

  const broken = [
    ...[...shippedPortraits.keys()].filter((s) => !shippedTokens.has(s)).map((s) => `${s}: portrait with no token`),
    ...[...shippedTokens.keys()].filter((s) => !shippedPortraits.has(s)).map((s) => `${s}: token with no portrait`),
  ].sort(natural);
  if (broken.length) die(`the shipped ${name} gallery is unpaired:\n  ${broken.join("\n  ")}`);

  const stems = [...shippedPortraits.keys()].sort(natural);
  setPairs[name] = stems.map((stem) => ({ portrait: shippedPortraits.get(stem), token: shippedTokens.get(stem) }));
}

const manifest = {
  _comment: `Generated by tools/import/lydia-comer.mjs. Art: © ${ARTIST}, CC BY 4.0 — see lydia-comer/license.txt (the logo in the parent folder stays all rights reserved).`,
  sets: Object.fromEntries(Object.entries(SETS).map(([name, set]) => [name, {
    portraitDir: set.portraitDir,
    tokenDir: set.tokenDir,
    pairs: setPairs[name],
  }])),
};

const kb = (p) => Math.round(fs.statSync(p).size / 1024);
const setTable = (name) => {
  const set = SETS[name];
  return [
    `## ${name[0].toUpperCase()}${name.slice(1)}`,
    "",
    `| ${set.noun} | portrait | token |`,
    "| --- | --- | --- |",
    ...setPairs[name].map(({ portrait, token }) =>
      `| ${portrait.replace(SHIPPED_EXT, "").replace(/-/g, " ")} `
      + `| \`${portrait}\` (${kb(path.join(set.portraits, portrait))} KB) `
      + `| \`${token}\` (${kb(path.join(set.tokens, token))} KB) |`),
    "",
  ];
};

const nChars = setPairs.characters.length;
const nMonsters = setPairs.monsters.length;
const credits = [
  `# ${ARTIST} galleries`,
  "",
  `Every drawing here is by **[${ARTIST}](${ARTIST_URL})**, licensed under`,
  "the **Creative Commons Attribution 4.0** licence",
  `([CC BY 4.0](${DEED_URL})). Source:`,
  `<${SOURCE_URL}>. No AI was used to create this artwork.`,
  "",
  "The **logo** in the parent folder (`Airbladder01/02/06.webp`) is the same",
  "artist but NOT under CC BY: **© Lydia Comer, all rights reserved**, granted",
  "to Air Bladder directly. Both sets of terms: `license.txt` beside this file.",
  "",
  "**These files are re-encoded to WebP q95, and the token halves are sized",
  `for the canvas (${TOKEN_SIZE}×${TOKEN_SIZE} — a map token draws at ~100px).** The portraits`,
  "keep the artist's full 1000×1000: they are sheet art. Beyond that, nothing",
  "is cropped, recoloured or redrawn — this project's own practice rather than",
  "a term of the licence, which sets no bar on altering the artwork.",
  "",
  "## Shape",
  "",
  "Two **paired** galleries, like Jon Aspeheim's: each drawing ships as a",
  "square portrait and as the circle-cropped token drawn from it, matched **by",
  "stem**. Picking a portrait sets the paired token with it.",
  "",
  "| set | folders | offered on |",
  "| --- | --- | --- |",
  "| characters | `portraits/`, `tokens/` | Player Character, NPC and Hireling sheets |",
  "| monsters | `portraits-monsters/`, `tokens-monsters/` | Monster sheets |",
  "",
  ...setTable("characters"),
  ...setTable("monsters"),
  `${nChars} characters and ${nMonsters} creatures, ${(nChars + nMonsters) * 2} files. `
  + "Generated by `tools/import/lydia-comer.mjs`.",
  "",
];

fs.writeFileSync(CREDITS, credits.join("\n"));
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

for (const [name, set] of Object.entries(SETS)) {
  const bytes = setPairs[name].reduce((n, { portrait, token }) =>
    n + fs.statSync(path.join(set.portraits, portrait)).size + fs.statSync(path.join(set.tokens, token)).size, 0);
  console.log(`${name}: ${setPairs[name].length} pairs, ${(bytes / 1048576).toFixed(1)} MB`);
}
console.log(`wrote ${path.relative(root, CREDITS)}`);
console.log(`wrote ${path.relative(root, MANIFEST)}`);

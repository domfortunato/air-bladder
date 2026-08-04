#!/usr/bin/env node
/**
 * Build the Lydia Comer gallery — her monster art, offered in the portrait
 * picker on NPC and Monster sheets.
 *
 *   node tools/import/lydia-comer.mjs [--src <dir>] [--dry]
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
 * Pairing is BY STEM, not by filename — the two halves carry different
 * extensions because they arrived in different formats and her grant forbids
 * modifying the artwork, so nothing here re-encodes. Every stem must have both
 * halves; a lone file is a hard error, never a skip, because a missing token
 * ships a portrait whose token silently falls back to the black-cornered
 * circle and a missing portrait ships nothing at all.
 *
 * SHIPPED SHAPE (what the picker browses):
 *
 *   lydia-comer/portraits/<Name>.jpg
 *   lydia-comer/tokens/<Name>.png
 *   lydia-comer/CREDITS.md            the gallery's contents + attribution
 *   module/lydia-manifest.json        pairs, for the picker
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

const PORTRAIT_EXT = /\.jpe?g$/i;
const TOKEN_EXT = /\.png$/i;

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
        [path.join(SRC, squares.get(stem)), path.join(PORTRAITS, squares.get(stem))],
        [path.join(SRC, circles.get(stem)), path.join(TOKENS, circles.get(stem))],
      ];
      for (const [from, to] of moves) {
        if (consume) fs.renameSync(from, to);
        else fs.copyFileSync(from, to);
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

const shippedPortraits = filesByStem(PORTRAITS, PORTRAIT_EXT);
const shippedTokens = filesByStem(TOKENS, TOKEN_EXT);
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
  "granted to Air Bladder for inclusion and *unmodified* redistribution as part of",
  "the system and its forks. The artwork may not be modified and may not be used",
  "separately from Air Bladder. Full terms and grant history: `license.txt` beside",
  "this file.",
  "",
  "**Nothing in this repository re-encodes, rescales or crops these files.** They",
  "ship as the artist delivered them, which is what the grant requires — and the",
  "reason the two halves carry different extensions.",
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

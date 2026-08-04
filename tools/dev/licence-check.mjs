#!/usr/bin/env node
/**
 * LICENSE.txt must not shrink back to a bare MIT file.
 *
 * Air Bladder ships six licensing regimes, and until 2026-07-30 the root
 * LICENSE.txt was 21 lines of unqualified MIT covering all of them — naming Yochai
 * Gal as a copyright holder OF THE SOFTWARE when his contribution is game text
 * under CC BY-SA, and purporting to grant sublicensing over Jon Aspeheim's CC BY
 * art, game-icons.net's CC BY 3.0 icons, the OFL fonts, and Lydia Comer's
 * all-rights-reserved logo. README.md had it right the whole time; the two files
 * had simply drifted, and the one that ships in the zip and that GitHub reads for
 * the repo's licence badge was the wrong one.
 *
 * The realistic way it regresses is not someone editing prose — it is someone
 * reaching for GitHub's "Add license" button, or a tidy-up that decides a licence
 * file should look like every other licence file. Both produce exactly the shape
 * this rejects.
 *
 * Four checks, all offline:
 *
 *   1. LICENSE.txt does not OPEN as a bare licence template.
 *   2. Every licence named in README's "Credits & licenses" is named in
 *      LICENSE.txt too. README is canonical; this is a drift detector, not a
 *      second source of truth.
 *   3. Every repo path LICENSE.txt points at exists — the per-asset notices it
 *      delegates to are the attribution itself, so a rotted pointer is a broken
 *      licence, not a broken link.
 *   4. Every directory the release zip SHIPS is named by some clause. This is
 *      check 3's other direction and it was blind: `lang/` shipped named by
 *      nothing at all, which the rewrite's own "these and only these" turns from
 *      silence into an affirmative exclusion — seven interface files, five of
 *      them other people's inherited work, left with no grant. The two fail
 *      differently, which is why both are needed: a rotted pointer shows itself
 *      the moment someone follows it, an unnamed directory never does. What
 *      ships is read from the workflow, not from a list kept here, because a
 *      second list drifts exactly as LICENSE.txt drifted from README.
 *
 * Scope, stated plainly: it checks the two files agree on WHICH licences apply.
 * It cannot check the licences are correct, and a regime added to README under a
 * name not in LICENCES below is invisible to it — add the pattern when that
 * happens.
 *
 * Usage: npm run check:licence
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const licence = read("LICENSE.txt");
const readme = read("README.md");

/** The regimes this project actually ships under, by how each is written. */
const LICENCES = [
  { name: "MIT", re: /\bMIT\b/ },
  { name: "CC BY-SA 4.0", re: /CC BY-SA 4\.0/ },
  { name: "CC BY 4.0", re: /CC BY 4\.0/ },
  { name: "CC BY 3.0", re: /CC BY 3\.0/ },
  { name: "OFL 1.1", re: /OFL 1\.1|Open Font License,? Version 1\.1|Open Font License 1\.1/ },
  { name: "all rights reserved", re: /all rights reserved/i },
];

console.log("\nLICENSE.txt vs README.md");

/* 1. Not a bare template ---------------------------------------------------- */

const firstLine = licence.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
if (/^(MIT|Apache|BSD|GNU|ISC|The MIT)\b/i.test(firstLine)) {
  fail(`LICENSE.txt opens with "${firstLine}" — it reads as a single-licence file. `
    + "Six regimes ship here and MIT covers the code only; see README.md.");
} else {
  ok(`LICENSE.txt opens as a multi-licence notice ("${firstLine}")`);
}

// The MIT grant must still be present and still scoped, not merely absent.
if (!/Permission is hereby granted, free of charge/.test(licence)) {
  fail("the MIT grant itself is missing from LICENSE.txt — the code has no licence text");
} else if (!/\bCODE\b|\bcode only\b|SOFTWARE ONLY/i.test(licence)) {
  fail("LICENSE.txt carries the MIT grant but never scopes it to the code");
} else {
  ok("the MIT grant is present and scoped to the code");
}

/* 2. Both files name the same regimes -------------------------------------- */

// README's credits section is the canonical list.
const credits = readme.slice(readme.indexOf("## Credits & licenses"));
if (!credits) fail("could not find README's '## Credits & licenses' section");

for (const { name, re } of LICENCES) {
  const inReadme = re.test(credits);
  const inLicence = re.test(licence);
  if (inReadme && !inLicence) {
    fail(`README credits "${name}" but LICENSE.txt never mentions it`);
  } else if (!inReadme && inLicence) {
    fail(`LICENSE.txt claims "${name}" but README's credits do not — one of them is wrong`);
  }
}
if (!failed) ok(`both files name the same ${LICENCES.length} regimes`);

/* 3. Every notice LICENSE.txt delegates to exists --------------------------- */

// Anchor on what the repo actually contains rather than on what a path looks
// like. Pattern-matching alone picks up "and/or" out of the MIT grant and
// "by-sa/4.0/" out of a Creative Commons URL; requiring the first segment to be a
// real top-level entry excludes both without a growing list of exceptions, and it
// keeps working as the repo changes.
const topLevel = new Set(readdirSync(ROOT));
const paths = new Set();
for (const m of licence.matchAll(/([A-Za-z_][\w-]*)\/([\w./-]*)/g)) {
  if (!topLevel.has(m[1])) continue;
  paths.add(`${m[1]}/${m[2]}`.replace(/[.,]$/, ""));
}

let missing = 0;
for (const p of [...paths].sort()) {
  if (existsSync(join(ROOT, p))) continue;
  fail(`LICENSE.txt points at "${p}", which does not exist`);
  missing++;
}
if (!missing) ok(`all ${paths.size} referenced paths exist (${[...paths].sort().join(", ")})`);

/* 4. Every SHIPPED path is named by some clause ----------------------------- */

// The other direction, and the one that was blind. Check 3 asks "does everything
// LICENSE.txt names exist"; nothing asked "is everything that ships named". Those
// fail differently: a rotted pointer is visible the moment someone follows it,
// whereas an unnamed directory is silent forever — and LICENSE.txt now says the
// MIT grant applies to its listed paths "and only these", which turns an omission
// from silence into an affirmative exclusion. lang/ shipped unnamed that way.
//
// The manifest is the source of what ships, not a hand-kept list here: a second
// list would drift from the workflow exactly as LICENSE.txt drifted from README.
const workflow = readFileSync(join(ROOT, ".github/workflows/main.yml"), "utf8");
const zipLine = workflow.split("\n").find((l) => l.includes("zip -r ./system.zip"));
if (!zipLine) {
  fail("could not find the release zip command in .github/workflows/main.yml — "
    + "this check cannot tell what ships");
} else {
  const shipped = zipLine
    .replace(/^.*zip -r \.\/system\.zip/, "")
    .trim()
    .split(/\s+/)
    .filter((p) => p.endsWith("/"));            // directories; loose files are prose
  const named = [...paths].map((p) => p.split("/")[0]);
  const unnamed = shipped.filter((dir) => !named.includes(dir.replace(/\/$/, "")));
  if (unnamed.length) {
    fail(`the release zip ships ${unnamed.join(", ")}, which LICENSE.txt names in no clause — `
      + 'and its MIT clause says "these and only these", so an unnamed path is excluded, not implied');
  } else {
    ok(`every shipped directory is named by a clause (${shipped.length} checked)`);
  }
}

/* --- 5. the gallery's stated size, everywhere it is stated ----------------- */

// This file compares NAMES and never numbers, which is how "1,310 glyphs" and
// "1,239 glyphs" survived a collection that had grown past both (review
// #7 finding 16). Both README files state it as part of a CC BY attribution, so
// it is not decoration; the four working-note copies drift for the ordinary
// reason a number restated in six places drifts.
//
// Anchored deliberately: a reword that breaks one of these patterns fails the
// gate and someone updates it, which is the outcome to want. A regex that
// quietly matched nothing would put the count straight back to unchecked.
const galleryRoot = join(ROOT, "art", "game-icons");
const galleryDirs = readdirSync(galleryRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
const onDisk = galleryDirs
  .reduce((n, d) => n + readdirSync(join(galleryRoot, d.name)).filter((f) => f.endsWith(".svg")).length, 0);
const catsOnDisk = galleryDirs.length;

const COUNT_SITES = [
  ["README.md", /picker gallery — ([\d,]+) glyphs/],
  ["README.es.md", /del selector de imágenes — ([\d,]+) íconos/],
  ["module/art-picker.js", /gameicons\s+([\d,]+) game-icons\.net glyphs/],
  ["module/art-picker.js", /at once is ([\d,]+) <img>/],
  ["module/art-picker.js", /the ([\d,]+)-glyph gallery/],
  ["module/character-generator.js", /([\d,]+) game-icons\.net glyphs in \d+ categories/],
  ["tools/import/item-icons.mjs", /`game-icons\/` \(([\d,]+) glyphs/],
  ["tools/import/README.md", /`game-icons\/` \(([\d,]+) svg/],
  // LICENSE.txt was the one site stating this number that NOTHING checked, and
  // it was three collections stale (1,366 glyphs, 24 categories, 16
  // contributors) while this gate reported green over eight other sites. The
  // gate was written to compare the two files that matter and then given count
  // lists that happened not to include one of them. Its number is part of a CC
  // BY attribution exactly as README's is, so it is the LAST place drift should
  // have been tolerable. Wrapped across two lines in the file — hence \s+.
  ["LICENSE.txt", /picker gallery, ([\d,]+) glyphs/],
];

// The CATEGORY count drifts for exactly the reason the glyph count does, and was
// unchecked while the glyph count was gated -- so adding the 25th category left
// four sites still saying 24, none of which any gate could see. The category
// count used to be pinned inside the character-generator pattern above, which
// made this gate fail for the RIGHT collection whenever a category was added:
// it read as a stale glyph count when nothing about the glyphs had changed.
const CATEGORY_SITES = [
  ["README.md", /picker gallery — [\d,]+ glyphs in (\d+) categories/],
  ["README.es.md", /del selector de imágenes — [\d,]+ íconos en (\d+) categorías/],
  ["module/art-picker.js", /\*\s+(\d+) folder tiles, then that category's thumbnails/],
  ["module/art-picker.js", /rendering all (\d+) at once/],
  ["module/character-generator.js", /game-icons\.net glyphs in (\d+) categories/],
  ["LICENSE.txt", /picker gallery, [\d,]+ glyphs in (\d+)\s+categories/],
];

const wrongCounts = [];
for (const [file, pattern] of COUNT_SITES) {
  const m = read(file).match(pattern);
  if (!m) wrongCounts.push(`${file}: the count sentence this gate anchors on is gone (${pattern})`);
  // es-ES writes it without the separator, so compare digits, not spelling.
  else if (Number(m[1].replace(/[.,]/g, "")) !== onDisk) wrongCounts.push(`${file}: says ${m[1]}, disk holds ${onDisk}`);
}
wrongCounts.length === 0
  ? ok(`every stated gallery size matches disk (${onDisk} glyphs, ${COUNT_SITES.length} sites)`)
  : fail(`stale gallery counts:\n        ${wrongCounts.join("\n        ")}`);

const wrongCats = [];
for (const [file, pattern] of CATEGORY_SITES) {
  const m = read(file).match(pattern);
  if (!m) wrongCats.push(`${file}: the category sentence this gate anchors on is gone (${pattern})`);
  else if (Number(m[1]) !== catsOnDisk) wrongCats.push(`${file}: says ${m[1]}, disk holds ${catsOnDisk}`);
}
wrongCats.length === 0
  ? ok(`every stated category count matches disk (${catsOnDisk} categories, ${CATEGORY_SITES.length} sites)`)
  : fail(`stale gallery category counts:\n        ${wrongCats.join("\n        ")}`);

// The ARTIST list is the CC BY attribution itself -- "include a mention 'Icons
// made by {author}'" is the upstream licence's own wording -- and both READMEs
// restate it. game-icons/CREDITS.md is generated from the download, so it is
// right by construction; the READMEs are hand-kept and were not checked by
// anything. Adding a category brings new artists with it (shields brought Andy
// Meneely and SeregaCthtuf, bottles brought Guard13007 and Starseeker), so the
// lists drift on exactly the occasion nobody is thinking about them, and an
// unnamed artist is a licence breach rather than a typo. "Various artists" is
// excluded: both READMEs render it as prose ("and one icon credited to various
// artists") rather than as a name in the list.
const creditedArtists = (/^Icons made by (.+)\.$/m.exec(read("art/game-icons/CREDITS.md"))?.[1] ?? "")
  .split(", ").map((s) => s.trim()).filter((s) => s && s !== "Various artists");

const unnamedArtists = [];
if (!creditedArtists.length) {
  unnamedArtists.push("art/game-icons/CREDITS.md: no 'Icons made by …' line to check against");
} else {
  for (const file of ["README.md", "README.es.md"]) {
    const text = read(file);
    const missing = creditedArtists.filter((a) => !text.includes(a));
    if (missing.length) unnamedArtists.push(`${file}: does not name ${missing.join(", ")}`);
  }
}
unnamedArtists.length === 0
  ? ok(`both READMEs name every credited artist (${creditedArtists.length})`)
  : fail(`gallery artists missing from a CC BY attribution:\n        ${unnamedArtists.join("\n        ")}`);

// LICENSE.txt states the contributor count in prose. It is the same drift as
// the two above and computed right here, so it is checked here rather than
// carrying a one-entry site list of its own.
const statedArtists = /picker gallery[\s\S]{0,120}?by (\d+) named contributors/.exec(licence)?.[1];
if (statedArtists === undefined) {
  fail("LICENSE.txt: the contributor sentence this gate anchors on is gone");
} else if (Number(statedArtists) !== creditedArtists.length) {
  fail(`LICENSE.txt says ${statedArtists} named contributors, CREDITS.md credits ${creditedArtists.length}`);
} else {
  ok(`LICENSE.txt's contributor count matches CREDITS.md (${creditedArtists.length})`);
}

/* --- 6. the Lydia Comer gallery is PAIRED, and stated at its true size ------ */

// This one is not a public licence: an all-rights-reserved grant to this system
// alone. So the thing to hold is narrower than attribution -- it is that the
// shipped tree still matches what the manifest and the notices claim, because
// every consumer of this gallery (the picker, the portrait die, the paired-token
// lookup) trusts the manifest and none of them can see the disk.
//
// The PAIRING is the load-bearing half. A portrait with no token is not a
// missing file, it is an actor whose sheet shows the square and whose token on
// the canvas silently keeps whatever it had -- which looks like a Foundry bug
// and is a build error. Checked here rather than only in the importer because
// the importer runs once and this runs on every gate.
const lydiaPortraits = readdirSync(join(ROOT, "art", "lydia-comer", "portraits")).filter((f) => /\.jpe?g$/i.test(f));
const lydiaTokens = new Set(readdirSync(join(ROOT, "art", "lydia-comer", "tokens")).filter((f) => /\.png$/i.test(f)));
const lydiaManifest = JSON.parse(read("module/lydia-manifest.json"));
const stem = (f) => f.replace(/\.[^.]+$/, "");

const lydiaProblems = [];
for (const p of lydiaPortraits) if (!lydiaTokens.has(`${stem(p)}.png`)) lydiaProblems.push(`portraits/${p} has no paired token`);
for (const t of lydiaTokens) if (!lydiaPortraits.some((p) => stem(p) === stem(t))) lydiaProblems.push(`tokens/${t} has no paired portrait`);
if (lydiaManifest.pairs?.length !== lydiaPortraits.length) {
  lydiaProblems.push(`module/lydia-manifest.json lists ${lydiaManifest.pairs?.length} pairs, disk holds ${lydiaPortraits.length}`);
}
for (const { portrait, token } of lydiaManifest.pairs ?? []) {
  if (!lydiaPortraits.includes(portrait)) lydiaProblems.push(`manifest names portraits/${portrait}, which is not on disk`);
  if (!lydiaTokens.has(token)) lydiaProblems.push(`manifest names tokens/${token}, which is not on disk`);
}
// Named rather than inlined so the pass message can COUNT them. It said "4
// sites" from a literal, and went stale the moment two more were added -- this
// gate reporting a stale number about staleness.
const LYDIA_COUNT_SITES = [
  ["LICENSE.txt", /hold (\d+)\s+creatures/],
  ["README.md", /(\d+) creatures drawn for this system/],
  ["README.es.md", /(\d+) criaturas dibujadas para este sistema/],
  ["art/lydia-comer/CREDITS.md", /^(\d+) creatures, \d+ files\./m],
  // Both READMEs state it a second time, up in the feature list. Two statements
  // of one number in one file is the ordinary way a count goes stale.
  ["README.md", /A gallery of (\d+) monsters drawn for Air Bladder/],
  ["README.es.md", /Una galería de (\d+) monstruos dibujados para Air Bladder/],
];
for (const [file, pattern] of LYDIA_COUNT_SITES) {
  const m = read(file).match(pattern);
  if (!m) lydiaProblems.push(`${file}: the count sentence this gate anchors on is gone (${pattern})`);
  else if (Number(m[1]) !== lydiaPortraits.length) lydiaProblems.push(`${file}: says ${m[1]}, disk holds ${lydiaPortraits.length}`);
}
lydiaProblems.length === 0
  ? ok(`the Lydia Comer gallery is fully paired and stated at its true size (${lydiaPortraits.length} creatures, ${LYDIA_COUNT_SITES.length} sites)`)
  : fail(`Lydia Comer gallery:\n        ${lydiaProblems.join("\n        ")}`);

console.log(`\n${failed ? "LICENCE CHECK FAILED" : "Licence check passed."}`);
process.exit(failed ? 1 : 0);

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
 * Three checks, all offline:
 *
 *   1. LICENSE.txt does not OPEN as a bare licence template.
 *   2. Every licence named in README's "Credits & licenses" is named in
 *      LICENSE.txt too. README is canonical; this is a drift detector, not a
 *      second source of truth.
 *   3. Every repo path LICENSE.txt points at exists — the per-asset notices it
 *      delegates to are the attribution itself, so a rotted pointer is a broken
 *      licence, not a broken link.
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

console.log(`\n${failed ? "LICENCE CHECK FAILED" : "Licence check passed."}`);
process.exit(failed ? 1 : 0);

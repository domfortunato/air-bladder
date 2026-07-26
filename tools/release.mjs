#!/usr/bin/env node
/**
 * Cut a new Air Bladder release — one command, no GitHub UI.
 *
 *     npm run release 0.1.1
 *
 * What it does:
 *   1. validates the version (X.Y.Z, no leading "v")
 *   2. refuses if the working tree has uncommitted TRACKED changes, or the tag exists
 *   3. bumps `version` in system.json (minimal, single-line edit)
 *   4. commits "Release X.Y.Z", creates an annotated tag, and pushes the branch + tag
 *      to `origin`
 *
 * The tag originates on `origin` (Gitea), so the Gitea->GitHub push mirror PROTECTS
 * it instead of pruning it — that pruning was the whole reason releases used to
 * vanish. Once the tag reaches GitHub, the "Release Creation" workflow triggers on
 * the tag push and builds + publishes the release with system.json + system.zip.
 *
 * See RELEASE.md for the full runbook.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capture = (cmd) => execSync(cmd, { cwd: ROOT }).toString().trim();
const run = (cmd) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd: ROOT, stdio: "inherit" }); };
const die = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

const version = process.argv[2];
if (!version) die("Usage: npm run release <version>   e.g. npm run release 0.1.1");
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`Version must be X.Y.Z (digits only, no leading "v"). Got: ${version}`);

// 1. Working tree must be clean of TRACKED changes (untracked scratch files are fine).
const dirty = capture("git status --porcelain --untracked-files=no");
if (dirty) die(`Working tree has uncommitted changes — commit or stash them first:\n${dirty}`);

// 2. The tag must not already exist locally.
if (capture(`git tag --list ${version}`)) {
  die(`Tag ${version} already exists. Pick a new version, or remove it first:\n` +
      `    git tag -d ${version} && git push origin :refs/tags/${version}`);
}

// 3. Bump system.json version (targeted single-line replace, so the diff stays minimal).
const sysPath = path.join(ROOT, "system.json");
const before = fs.readFileSync(sysPath, "utf8");
const after = before.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
if (after === before) die(`Could not find a "version" field to update in system.json`);
fs.writeFileSync(sysPath, after);
if (JSON.parse(after).version !== version) die(`system.json version did not update cleanly — aborting.`);
console.log(`✓ system.json version → ${version}`);

// 4. Commit, tag, push branch + tag to origin.
run(`git add system.json`);
run(`git commit -m "Release ${version}"`);
run(`git tag -a ${version} -m "Air Bladder ${version}"`);
run(`git push origin HEAD`);
run(`git push origin ${version}`);

console.log(`
✓ Release ${version} pushed to origin.

Next:
  1. If origin mirrors to GitHub, make sure the mirror has synced (the tag must
     reach GitHub). The "Release Creation" workflow triggers on the tag push and
     builds + publishes the release with system.json + system.zip (~1-2 min; watch
     the Actions tab).
  2. Verify the install manifest returns 200:
     https://github.com/<owner>/<repo>/releases/latest/download/system.json
  3. (Optional) add release notes on the GitHub release; rebuilds preserve them.
`);

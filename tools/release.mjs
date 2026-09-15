#!/usr/bin/env node
/**
 * Cut a new Air Bladder release — one command, no GitHub UI.
 *
 *     npm run release 0.1.1
 *     npm run release 0.1.1 -- --dry-run     # every check and the notes, nothing written
 *
 * What it does:
 *   1. validates the version (X.Y.Z, no leading "v")
 *   2. refuses unless you are on `master` — releases are never cut from a branch
 *   3. refuses if the working tree has uncommitted TRACKED changes, or the tag exists
 *   4. reads the release notes from CHANGELOG.md — the `## X.Y.Z` section — and
 *      refuses without them, so a release can never be published with an empty body
 *   5. prints the commits since the last tag and the notes, so you see what you are
 *      shipping and what the release page will say
 *   6. bumps `version` in system.json (minimal, single-line edit)
 *   7. commits "Release X.Y.Z", creates an annotated tag whose BODY is the notes,
 *      and pushes the branch + tag to `origin`
 *
 * The tag originates on `origin` (Gitea), so the Gitea->GitHub push mirror PROTECTS
 * it instead of pruning it — that pruning was the whole reason releases used to
 * vanish. Once the tag reaches GitHub, the "Release Creation" workflow triggers on
 * the tag push, builds + publishes the release with system.json + system.zip, and
 * reads the notes back out of the tag for the release body — the notes land in the
 * same call that attaches the assets, nothing is pasted afterwards. The mirror
 * carries the tag OBJECT, not just the ref (every tag on GitHub lists a peeled `^{}`
 * entry, which only an annotated tag has), which is what makes the tag a carrier.
 *
 * See RELEASE.md for the full runbook.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseBody, sectionFor, tagMessage } from "./release-notes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capture = (cmd) => execSync(cmd, { cwd: ROOT }).toString().trim();
const run = (cmd) => { console.log(`  $ ${cmd}`); execSync(cmd, { cwd: ROOT, stdio: "inherit" }); };
const die = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

const args = process.argv.slice(2);
// Both spellings are dry. `npm run release X -- --dry-run` hands the flag to
// argv; `npm run release X --dry-run` — the form every doc here gave for a day —
// hands it to NPM, which owns a `dry-run` config of its own and forwards nothing
// but `npm_config_dry_run=true` (review #32, measured on npm 11). Reading argv
// alone made the documented preview a REAL release on master and a refusal on dev.
const dryRun = args.includes("--dry-run") || process.env.npm_config_dry_run === "true";
const version = args.find((a) => !a.startsWith("--"));
if (!version) die("Usage: npm run release <version> [-- --dry-run]   e.g. npm run release 0.1.1");
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`Version must be X.Y.Z (digits only, no leading "v"). Got: ${version}`);

// 1. Releases are cut from master, never from a branch. Work lives on `dev` and
//    reaches master by merge. Without this guard `git push origin HEAD` below would
//    happily publish a branch and tag unmerged work — see docs/git-flow.md.
//    A dry run on `dev` is the ordinary way to preview the notes before the merge,
//    so there the guard reports instead of refusing.
const branch = capture("git rev-parse --abbrev-ref HEAD");
if (branch !== "master") {
  const msg = `Releases are cut from master. You are on "${branch}".\n` +
              `    git checkout master && git merge ${branch}`;
  if (dryRun) console.log(`(dry run) would refuse: ${msg}\n`);
  else die(msg);
}

// 2. Working tree must be clean of TRACKED changes (untracked scratch files are fine).
const dirty = capture("git status --porcelain --untracked-files=no");
if (dirty) die(`Working tree has uncommitted changes — commit or stash them first:\n${dirty}`);

// 3. The tag must not already exist locally...
if (capture(`git tag --list ${version}`)) {
  die(`Tag ${version} already exists. Pick a new version, or remove it first:\n` +
      `    git tag -d ${version} && git push origin :refs/tags/${version}`);
}
// ...nor on origin. The local check alone missed a tag deleted here but still on
// the remote — the release commit would land on master and only the tag push be
// refused, leaving master bumped for a version that never shipped (review #18).
// ls-remote needs the network; so does the push that follows.
if (capture(`git ls-remote --tags origin refs/tags/${version}`)) {
  die(`Tag ${version} already exists on origin. Pick a new version, or remove it first:\n` +
      `    git push origin :refs/tags/${version}`);
}

// 4. The release notes: CHANGELOG.md's section for this version, which becomes the
//    body of the tag and so the body of the GitHub release. Refused when the file
//    is missing, untracked (the notes would reach the tag and never the repo),
//    has no heading for the version, or has an empty one — 0.1.22 was published
//    with an empty body because the notes were a separate step nobody's checklist
//    held, and this is the step that holds it.
const changelogPath = path.join(ROOT, "CHANGELOG.md");
if (!fs.existsSync(changelogPath)) die(`CHANGELOG.md is missing. Write a "## ${version}" section in it first.`);
if (!capture("git ls-files CHANGELOG.md")) die(`CHANGELOG.md is not tracked. Commit it first.`);
const section = sectionFor(fs.readFileSync(changelogPath, "utf8"), version);
if (section === null) die(`CHANGELOG.md has no "## ${version}" section. Write the release notes there first.`);
if (!section) die(`CHANGELOG.md's "## ${version}" section is empty. Write the release notes there first.`);
const body = releaseBody(version, section);

// 5. Show what is about to ship. A forgotten merge shows up here as an empty list,
//    which is far cheaper to notice now than after the tag exists.
const lastTag = capture("git tag --sort=-v:refname").split("\n")[0];
if (lastTag) {
  const log = capture(`git log --oneline ${lastTag}..HEAD`);
  console.log(`\nShipping since ${lastTag}:`);
  console.log(log ? log.split("\n").map((l) => `  ${l}`).join("\n") : "  (nothing — no commits since that tag)");
  console.log("");
}
console.log(`Release notes (CHANGELOG.md, "## ${version}") — the body of the tag and of the GitHub release:\n`);
console.log(body.split("\n").map((l) => `  ${l}`).join("\n"));

if (dryRun) {
  console.log(`\n(dry run) Nothing written, nothing pushed.\n`);
  process.exit(0);
}

// 6. Bump system.json version (targeted single-line replace, so the diff stays minimal).
const sysPath = path.join(ROOT, "system.json");
const before = fs.readFileSync(sysPath, "utf8");
const after = before.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
if (after === before) die(`Could not find a "version" field to update in system.json`);
fs.writeFileSync(sysPath, after);
if (JSON.parse(after).version !== version) die(`system.json version did not update cleanly — aborting.`);
console.log(`\n✓ system.json version → ${version}`);

// 7. Commit, tag, push branch + tag to origin.
run(`git add system.json`);
run(`git commit -m "Release ${version}"`);
// The tag message comes from a file, not `-m`: it is many lines, and a quoted
// multi-line argument is exactly what PowerShell mangles. `--cleanup=verbatim`
// is load-bearing — git's default cleanup strips every line beginning with `#` as
// a comment, so the notes' own headline would vanish from the tag in silence; and
// `whitespace`, the mode for a day, still dropped a Markdown hard break's two
// trailing spaces and collapsed blank lines, which made RELEASE.md's "verbatim"
// false by two characters (review #32, proven in a throwaway repo, all three modes).
const msgDir = fs.mkdtempSync(path.join(os.tmpdir(), "air-bladder-release-"));
const msgPath = path.join(msgDir, "tag-message.txt");
fs.writeFileSync(msgPath, tagMessage(version, body));
try {
  run(`git tag -a ${version} --cleanup=verbatim -F "${msgPath.replace(/\\/g, "/")}"`);
} finally {
  fs.rmSync(msgDir, { recursive: true, force: true });
}
// ONE atomic push: branch and tag land together or not at all, so a refused tag
// can never leave master bumped without its release (review #18).
run(`git push --atomic origin HEAD refs/tags/${version}`);

console.log(`
✓ Release ${version} pushed to origin, notes and all.

Next:
  1. If origin mirrors to GitHub, make sure the mirror has synced (the tag must
     reach GitHub). The "Release Creation" workflow triggers on the tag push and
     builds + publishes the release with system.json + system.zip, its body read
     from the tag (~1-2 min; watch the Actions tab).
  2. Verify the install manifest returns 200:
     https://github.com/<owner>/<repo>/releases/latest/download/system.json
  3. Sync the development branch, or the next merge conflicts on the version bump
     this commit just made:
         git checkout dev && git merge master && git push origin dev
`);

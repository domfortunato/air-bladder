#!/usr/bin/env node
/**
 * Snapshot the two things in this project that git does NOT protect.
 *
 *   node tools/dev/backup.mjs [--label <text>] [--list] [--prune-only]
 *
 * WHY THIS EXISTS. On 2026-08-04 a `build:packs` run destroyed roughly five
 * hours of a Warden's compendium work — monster art assigned inside Foundry,
 * plus a description fix. `build` regenerates `packs/` FROM `src/packs/`, so
 * anything edited in the world since the last `extract` is overwritten, and
 * `packs/` is gitignored, LevelDB keeps no history, and Foundry writes no
 * automatic backups. There was nothing to recover from. The guard in
 * tools/packs.mjs now refuses that build; this is the belt to its braces,
 * because a guard only catches the failure it was written for.
 *
 * WHAT IS AT RISK, precisely:
 *
 *   packs/            generated LevelDB. Gitignored BY DESIGN — it is binary,
 *                     unmergeable and rewritten by the act of opening it. But
 *                     "generated" is only true until a Warden edits a compendium
 *                     inside Foundry, and from that moment until someone runs
 *                     `extract`, packs/ holds the ONLY copy of that work.
 *   the world data    actors, scenes, journals, settings. Never in git at all.
 *                     Every probe in tools/dev/ writes to it, and a migration
 *                     phase rewrites documents across the whole world.
 *
 * Snapshots land OUTSIDE the repo (they must survive a clean checkout, and they
 * must never be committable), newest-first by name, pruned to KEEP.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FOUNDRY = "C:/Users/domin/foundry";
const DEST = path.join(FOUNDRY, "backups");
const KEEP = 24;

/** What gets copied. A missing source is skipped with a warning, never fatal. */
const SOURCES = [
  { name: "packs", from: path.join(ROOT, "packs") },
  { name: "world-air-bladder-dev", from: path.join(FOUNDRY, "data", "Data", "worlds", "air-bladder-dev") },
  { name: "world-ab019", from: path.join(FOUNDRY, "ghtest-data", "Data", "worlds", "ab019") },
];

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
};
const has = (flag) => process.argv.includes(flag);

const du = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) n += fs.statSync(p).size;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
};
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * Recursive copy that SKIPS what it cannot read instead of aborting.
 *
 * Foundry holds an exclusive handle on each pack's `LOCK` file while the server
 * runs, and `fs.cpSync` on the tree dies with EPIPE on the first one — which
 * would mean backups only work while Foundry is stopped, i.e. exactly when the
 * data is least likely to be at risk and least likely to be remembered. A
 * LevelDB `LOCK` is a zero-byte mutex and carries no data, so skipping it costs
 * nothing; the `.ldb`, `.log`, `MANIFEST` and `CURRENT` files are the content
 * and they copy fine open. A partial snapshot is a floor under the loss, not a
 * transactionally perfect image, and that is the right trade for a safety net.
 */
const copyTree = (from, to) => {
  let skipped = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    try {
      if (e.isDirectory()) skipped += copyTree(src, dst).skipped;
      else if (e.isFile()) fs.copyFileSync(src, dst);
    } catch { skipped++; }
  }
  return { skipped };
};

const snapshots = () =>
  (fs.existsSync(DEST) ? fs.readdirSync(DEST, { withFileTypes: true }) : [])
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();

if (has("--list")) {
  const all = snapshots();
  if (!all.length) console.log(`no snapshots under ${DEST}`);
  for (const s of all) console.log(`  ${s.padEnd(40)} ${mb(du(path.join(DEST, s)))}`);
  process.exit(0);
}

const prune = () => {
  const all = snapshots();
  for (const old of all.slice(KEEP)) {
    fs.rmSync(path.join(DEST, old), { recursive: true, force: true });
    console.log(`  pruned   ${old}`);
  }
};

if (has("--prune-only")) { prune(); process.exit(0); }

// A sortable, filename-safe stamp. Date.now() is fine here — this is a tool, not
// a workflow script.
const now = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
  + `_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
const label = (arg("--label") ?? "").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40);
const dir = path.join(DEST, label ? `${stamp}_${label}` : stamp);

fs.mkdirSync(dir, { recursive: true });
let total = 0;
for (const { name, from } of SOURCES) {
  if (!fs.existsSync(from)) { console.log(`  skipped  ${name.padEnd(28)} (not present: ${from})`); continue; }
  const to = path.join(dir, name);
  const { skipped } = copyTree(from, to);
  const size = du(to);
  total += size;
  console.log(`  saved    ${name.padEnd(28)} ${mb(size)}${skipped ? `  (${skipped} locked file(s) skipped)` : ""}`);
}

fs.writeFileSync(path.join(dir, "README.txt"),
  `Air Bladder snapshot ${stamp}${label ? ` (${label})` : ""}\n\n`
  + "packs/                  -> copy back into the repo as packs/, then run\n"
  + "                           `npm run extract:packs` to fold the content into\n"
  + "                           src/packs/ YAML where git can see it.\n"
  + "world-air-bladder-dev/  -> copy back over foundry/data/Data/worlds/air-bladder-dev\n"
  + "world-ab019/            -> copy back over foundry/ghtest-data/Data/worlds/ab019\n\n"
  + "Stop Foundry before restoring anything: LevelDB holds a lock and a restore\n"
  + "under a running server produces a corrupt mix of both states.\n");

console.log(`snapshot ${path.relative(FOUNDRY, dir)} — ${mb(total)}`);
prune();

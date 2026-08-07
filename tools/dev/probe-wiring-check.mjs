#!/usr/bin/env node
/**
 * Every probe under tools/dev/ must be reachable as an npm script.
 *
 *   npm run check:probes        (offline, no Foundry needed)
 *
 * Why this gate exists. On 2026-07-29 a sweep found **18** probe files with no
 * npm script. Nobody had run them in weeks, and between them they were hiding:
 *
 *   - a real content defect (two hireling gear names resolving to nothing, so
 *     those hirelings generated a piece of gear short) — `gear-probe.mjs` is
 *     documented in tools/import/README.md as the ONLY thing protecting the
 *     hand-maintained gear pool, and it was not wired;
 *   - four probes rotted by the ApplicationV2 port, each failing in a way that
 *     reads as "no result" rather than "error";
 *   - two probes asserting a custom skin that `f00e72c` had deliberately
 *     reverted — i.e. asserting a bug.
 *
 * A probe with no npm script is a probe nobody runs, and an unrun probe rots
 * silently: it keeps passing in the imagination and stops testing anything. The
 * cost of writing one is wasted the moment it drops out of the release routine.
 *
 * This is deliberately dumb and offline so it can never be the slow step.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = require(path.join(ROOT, "package.json"));

// Shared machinery and one-shot utilities, not probes. Keep this list SHORT and
// justify every entry — "it's not really a probe" is how the 18 accumulated.
const NOT_PROBES = new Map([
  ["lib.mjs", "shared harness (joinAsGM, watchErrors, VIEWPORT) — imported, never run"],
  ["unpause.mjs", "operational helper, run by hand after a server restart"],
]);

const dir = path.join(ROOT, "tools", "dev");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"));
const wired = new Set(
  Object.values(pkg.scripts ?? {})
    .map((s) => (s.match(/tools[/\\]dev[/\\]([\w.-]+\.mjs)/) || [])[1])
    .filter(Boolean)
);

const orphans = files.filter((f) => !wired.has(f) && !NOT_PROBES.has(f));
const missing = [...wired].filter((f) => !files.includes(f));
const staleExempt = [...NOT_PROBES.keys()].filter((f) => !files.includes(f));

// A script name is only half of it. `docs/release-testing.md` is the list a
// release is actually run from, and a probe absent from it runs when somebody
// remembers it and not otherwise — which that file's own opening paragraph says
// is the failure it exists to prevent, while nothing enforced it.
//
// Found 2026-08-07 (review #10): `dev:spellscroll` had been wired from the day
// it was written, so the check above was green for it the whole time, and its
// only appearance in the doc was as an ILLUSTRATION inside "Reading the
// results". Wired, documented, and on no run list — the exact state this gate
// was built to make impossible, one file further along than it was looking.
const RUN_LIST = path.join(ROOT, "docs", "release-testing.md");

// Wired under tools/dev/ but deliberately NOT part of a release run. Same rule
// as NOT_PROBES: keep it short and justify each one, because a silent exemption
// is how the thing above happened.
const NOT_RELEASE_RUN = new Map([
  ["backup", "operational — snapshots packs/worlds, run BEFORE risky work, not as a check"],
  ["backup:list", "operational — prints existing backups"],
  ["dev:actors", "operational — lists/deletes world actors to reset a dev world"],
]);

const runList = fs.readFileSync(RUN_LIST, "utf8");
const probeScripts = Object.entries(pkg.scripts ?? {})
  .filter(([, cmd]) => /tools[/\\]dev[/\\][\w.-]+\.mjs/.test(cmd))
  .map(([name]) => name);
const undocumented = probeScripts.filter(
  (name) => !NOT_RELEASE_RUN.has(name) && !runList.includes(`\`npm run ${name}\``)
);
const staleRunExempt = [...NOT_RELEASE_RUN.keys()].filter((n) => !probeScripts.includes(n));

let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

orphans.length === 0
  ? ok(`all ${files.length - NOT_PROBES.size} probes are wired to an npm script`)
  : fail(`${orphans.length} probe(s) with no npm script — nobody runs these:\n         ${orphans.join("\n         ")}`);

missing.length === 0
  ? ok("every npm script points at a file that exists")
  : fail(`npm script(s) pointing at a deleted probe: ${missing.join(", ")}`);

staleExempt.length === 0
  ? ok(`${NOT_PROBES.size} non-probe helper(s) exempt, all present`)
  : fail(`stale exemption(s) for files that no longer exist: ${staleExempt.join(", ")}`);

undocumented.length === 0
  ? ok(`all ${probeScripts.length - NOT_RELEASE_RUN.size} probe scripts appear in docs/release-testing.md`)
  : fail(
    `${undocumented.length} probe script(s) on no run list in docs/release-testing.md — these run only when someone remembers them:\n         ${undocumented.join("\n         ")}`
  );

staleRunExempt.length === 0
  ? ok(`${NOT_RELEASE_RUN.size} operational script(s) exempt from the run list, all present`)
  : fail(`stale run-list exemption(s) for scripts that no longer exist: ${staleRunExempt.join(", ")}`);

console.log(failed ? "\nPROBE WIRING CHECK FAILED\n" : "\nprobe wiring check passed\n");
process.exit(failed ? 1 : 0);

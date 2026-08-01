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

console.log(failed ? "\nPROBE WIRING CHECK FAILED\n" : "\nprobe wiring check passed\n");
process.exit(failed ? 1 : 0);

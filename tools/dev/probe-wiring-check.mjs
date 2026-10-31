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
 *     those hirelings generated a piece of gear short) — `e2e-gear.mjs` is
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

// THE FLEET'S OWN RULE (review #34 finding 110). The probe fleet runs every
// `dev:` script whose command runs a `tools/dev/e2e-*.mjs` (docs/fleet-probes.md)
// and nothing else, so a probe wired under any other filename passes both
// checks above and never runs there — how combat-options, 0.1.24's headline
// rules, stayed out of the 78/78 at 05e28ef5 without anyone deciding it
// (3301fafc). The off-fleet `dev:` scripts are listed, each with its reason.
const OFF_FLEET = new Map([
  ["dev:smoke", "the local dev world's smoke test, run by hand before a push"],
  ["dev:site", "checks the published GitHub Pages site, not a Foundry world"],
  ["dev:actors", "operational — lists/deletes world actors to reset a dev world"],
  ["dev:players", "operational — creates the player users a fleet world already has"],
]);
const offFleet = Object.entries(pkg.scripts ?? {})
  .filter(([name, cmd]) => name.startsWith("dev:") && /tools[/\\]dev[/\\][\w.-]+\.mjs/.test(cmd))
  .filter(([, cmd]) => !/tools[/\\]dev[/\\]e2e-[\w.-]+\.mjs/.test(cmd))
  .map(([name]) => name)
  .filter((name) => !OFF_FLEET.has(name));
const staleOffFleet = [...OFF_FLEET.keys()].filter((n) => !(n in (pkg.scripts ?? {})));

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

offFleet.length === 0 && staleOffFleet.length === 0
  ? ok(`every dev: probe runs a tools/dev/e2e-*.mjs, so the fleet runs it (${OFF_FLEET.size} off-fleet, each stated)`)
  : fail(`${offFleet.length ? `dev: script(s) the fleet will never run — rename the file e2e-<name>.mjs or state the reason in OFF_FLEET:\n         ${offFleet.join("\n         ")}` : ""}${staleOffFleet.length ? `\n         stale OFF_FLEET entries: ${staleOffFleet.join(", ")}` : ""}`);

// A `game.settings.get` SHADOW MUST FORWARD EVERY ARGUMENT AND PASS A DOCUMENT
// REQUEST THROUGH. `ClientSettings#set` → `#setWorld` asks
// `get(ns, key, {document: true})` for the Setting document it will update by
// id; a shadow that drops the third argument, or answers that call with a
// value, hands back no `_id`, and core CREATES a second Setting document for
// the key. The write then silently does nothing, forever, and the duplicate
// outlives the probe. The dev world held 131 of these once, and CLAUDE.md then
// said "every shadow forwards ...rest now" for a day while eighteen shadows in
// eight probes still did not, and a nineteenth forwarded but answered the
// document request with `[]` — four more duplicates in one day of sweeps
// (2026-09-12). A claim about probe hygiene is a copy that drifts unless a
// gate holds it, so this holds it: every function-form shadow declares a rest
// parameter and, within its first lines, returns the real getter's answer for
// `rest[0]?.document`.
const shadowProblems = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // Function form AND arrow form (review #34 finding 29): the gate used to
    // see only `function (`, and sixteen arrow shadows answered a
    // {document: true} request for their own forced key with the forced value.
    const m = line.match(/settings\.get = (?:function )?\(([^)]*)\)/);
    if (!m) return;
    if (!/\.\.\.\w+/.test(m[1])) {
      shadowProblems.push(`${f}:${i + 1} shadows settings.get without a rest parameter — the {document: true} call is dropped`);
      return;
    }
    const window = lines.slice(i, i + 8).join("\n");
    if (!/rest\[0\]\?\.document\)?\s*(?:return|\?)\s+foundry\.helpers\.ClientSettings\.prototype\.get\.call\(/.test(window)) {
      shadowProblems.push(`${f}:${i + 1} shadows settings.get without passing a {document: true} request to ClientSettings.prototype.get`);
    }
  });
}
shadowProblems.length === 0
  ? ok("every settings.get shadow, function or arrow form, forwards its arguments and passes document requests through")
  : fail(`${shadowProblems.length} settings.get shadow(s) that would make a world-setting write create a duplicate document:\n         ${shadowProblems.join("\n         ")}`);

// `game.i18n.format` CANNOT BE SHADOWED BY ASSIGNMENT. Core aliases it with
// `Object.defineProperties(Localization.prototype, {format: …})`, which is
// non-writable, and a non-writable prototype property blocks a plain
// assignment on the instance: a silent no-op in a page.evaluate's sloppy
// mode, every call still reaching core. dev:grimoire paid an hour for it
// (2026-08-18), and review #34's F238 legs repeated it (2026-10-31): all three
// read red, the control included, which looks exactly like the fix failing.
// Shadow with `Object.defineProperty(game.i18n, "format", {value, configurable:
// true, writable: true})` and restore with `delete`. (`localize` is an ordinary
// method and assigns.)
const formatAssigns = [];
for (const f of files) {
  fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).forEach((line, i) => {
    // Code only: the notes that warn about this quote it.
    if (/^\s*\*/.test(line)) return;
    if (/i18n\.format\s*=(?!=)/.test(line.replace(/\/\/.*$/, ""))) formatAssigns.push(`${f}:${i + 1}`);
  });
}
formatAssigns.length === 0
  ? ok("no probe shadows game.i18n.format by assignment (a silent no-op)")
  : fail(`${formatAssigns.length} game.i18n.format assignment(s) — a silent no-op; use Object.defineProperty:\n         ${formatAssigns.join("\n         ")}`);

console.log(failed ? "\nPROBE WIRING CHECK FAILED\n" : "\nprobe wiring check passed\n");
process.exit(failed ? 1 : 0);

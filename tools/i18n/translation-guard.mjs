#!/usr/bin/env node
/**
 * check:translations — the translation-loss guard (user ruling 2026-08-11:
 * "this cannot happen again and must be checked pre-release and post-release").
 *
 * Exists because of a real loss: PR #14's merge fixed a wrong-path upload
 * (the content overlay dumped over lang/es.json) by resolving the file to
 * ours — which silently discarded 158 interface translations sitting three
 * commits earlier in the contributor's own chain. Every review of the merge
 * was green, because nothing compared the translator's file against what it
 * used to hold. This gate is that comparison, plus the two other silent ways
 * a language dies that this repo has already paid for.
 *
 * Three rules per interface file (lang/*.json except en):
 *
 *  1. IDENTITY — the file must be the file its path claims: the share of its
 *     flat keys that exist in en.json must be at least half. The wrong-path
 *     clobber (overlay keys are English SENTENCES, not CAIRN.* keys) scores
 *     ~0% and dies here instantly.
 *  2. LOADABILITY — no path may hold a STRING in one entry and need to be an
 *     OBJECT for another ("CAIRN.X": "..." beside "CAIRN.X.Y": "...").
 *     Foundry's expand-and-merge drops the whole file on that shape and the
 *     UI silently falls back to English (review #7's class, re-litigated
 *     2026-08-11 before being ruled out live).
 *  3. NO SILENT SHRINK — every key the file held AT THE LAST RELEASE TAG
 *     that is still live in current en.json must still be present. A key may
 *     leave only when English dropped it (mount → companion); a key leaving
 *     while English still asks for it is a translation REGRESSION, whatever
 *     the diff looked like. This is the rule that catches the PR-#14 class:
 *     the restored file passing today becomes the baseline the next merge is
 *     judged against.
 *
 * The content overlay (lang/content/*.json) gets rules 3': it must parse,
 *  must exist if it existed at the tag, and its entry count must not shrink
 *  by more than SHRINK_TOLERANCE entries (English prose edits legitimately
 *  orphan a few translations at a time; a merge that halves the file is a
 *  loss, not housekeeping). Orphan-by-orphan hygiene stays i18n:repair's job.
 *
 * Baseline: the last release tag (git describe). Runs offline, no Foundry.
 * A missing baseline (fresh clone without tags) degrades to rules 1+2 and
 * says so — never a silent pass.
 *
 * Self-witness: `--witness` runs the three rules against known-bad fixtures
 * built in memory (the 0.1.15-era 457-key file vs the restored one, a
 * clobber, a string/object collision) and exits 0 only if ALL of them FAIL
 * their rule — proof this gate can go red, kept runnable so the check never
 * decays into ceremony.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LANG = join(ROOT, "lang");
const SHRINK_TOLERANCE = 20;

let failed = false;
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? "  " + d : ""}`);
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? "  " + d : ""}`); failed = true; };

const flat = (obj, prefix = "", out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix + k;
    if (v && typeof v === "object") flat(v, key + ".", out);
    else out[key] = v;
  }
  return out;
};

/** Rule 2: a STRING stored at a path some other entry needs as an OBJECT. */
const loaderCollisions = (obj) => {
  const strings = new Set(), parents = new Set();
  const walk = (o, prefix = "") => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix + k;
      // A dotted literal key contributes every ancestor as an object path.
      const parts = key.split(".");
      for (let i = 1; i < parts.length; i++) parents.add(parts.slice(0, i).join("."));
      if (v && typeof v === "object") { parents.add(key); walk(v, key + "."); }
      else strings.add(key);
    }
  };
  walk(obj);
  return [...strings].filter((s) => parents.has(s));
};

const gitShow = (ref, path) => {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  } catch { return null; }
};

const lastTag = (() => {
  try { return execFileSync("git", ["describe", "--tags", "--abbrev=0"], { cwd: ROOT }).toString().trim(); }
  catch { return null; }
})();

const en = flat(JSON.parse(readFileSync(join(LANG, "en.json"), "utf8")));

const checkInterfaceFile = (name, raw, baselineRaw, label = name) => {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { fail(`${label} parses`, String(e.message).slice(0, 80)); return; }
  const keys = flat(parsed);
  const keyList = Object.keys(keys);

  // Rule 1 — identity.
  const known = keyList.filter((k) => k in en).length;
  const share = keyList.length ? known / keyList.length : 0;
  share >= 0.5
    ? ok(`${label} is an interface file`, `${known}/${keyList.length} keys known to en.json`)
    : fail(`${label} is an interface file`, `only ${known}/${keyList.length} keys exist in en.json — this looks like the WRONG FILE at this path (the PR-#14 clobber class)`);

  // Rule 2 — loadability.
  const coll = loaderCollisions(parsed);
  coll.length === 0
    ? ok(`${label} has no string/object path collisions`)
    : fail(`${label} has no string/object path collisions`, `${coll.slice(0, 5).join(", ")} — Foundry drops the WHOLE file on this shape (review #7)`);

  // Rule 3 — no silent shrink vs the last release.
  if (baselineRaw === undefined) return;               // witness mode supplies its own
  if (baselineRaw === null) { ok(`${label} shrink check`, `no baseline at ${lastTag ?? "(no tag)"} — new file, rules 1+2 only`); return; }
  let baseKeys;
  try { baseKeys = Object.keys(flat(JSON.parse(baselineRaw))); } catch { ok(`${label} shrink check`, "baseline unparseable — rules 1+2 only"); return; }
  const lost = baseKeys.filter((k) => k in en && !(k in keys));
  lost.length === 0
    ? ok(`${label} lost no live translations since ${lastTag}`, `${keyList.length} keys (baseline ${baseKeys.length})`)
    : fail(`${label} lost no live translations since ${lastTag}`, `${lost.length} keys the last release shipped are GONE while en.json still has them: ${lost.slice(0, 8).join(", ")}${lost.length > 8 ? ", …" : ""}`);
};

const checkOverlayFile = (name, raw, baselineRaw, label = name) => {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { fail(`${label} parses`, String(e.message).slice(0, 80)); return; }
  const count = Object.keys(flat(parsed)).length;
  if (baselineRaw === undefined) return;
  if (baselineRaw === null) { ok(`${label} shrink check`, `no baseline at ${lastTag ?? "(no tag)"}`); return; }
  let base;
  try { base = Object.keys(flat(JSON.parse(baselineRaw))).length; } catch { ok(`${label} shrink check`, "baseline unparseable"); return; }
  count >= base - SHRINK_TOLERANCE
    ? ok(`${label} did not collapse since ${lastTag}`, `${count} entries (baseline ${base})`)
    : fail(`${label} did not collapse since ${lastTag}`, `${base} -> ${count} entries — a translator's file shrinking past ${SHRINK_TOLERANCE} is a LOSS, not housekeeping`);
};

/* ------------------------------------------------------------------ */

if (process.argv.includes("--witness")) {
  // Each fixture must make its rule FAIL, or the gate cannot see the defect
  // class it exists for. Output stays quiet on success.
  console.log("witness fixtures (each must go RED):\n");
  const before = () => failed;
  let witnessed = 0, missed = [];
  const expectFail = (what, run) => {
    const was = before();
    failed = false;
    run();
    if (failed) witnessed++; else missed.push(what);
    failed = was;
  };
  // 1. The wrong-path clobber: overlay-shaped keys at an interface path.
  expectFail("clobber", () =>
    checkInterfaceFile("clobber", JSON.stringify({ "Some English sentence.": "Una frase.", "Another sentence.": "Otra." }), undefined, "witness:clobber"));
  // 2. The loader-killing collision.
  expectFail("collision", () =>
    checkInterfaceFile("collision", JSON.stringify({ "CAIRN.Notify": "cadena", "CAIRN.Notify.X": "hoja" }), undefined, "witness:collision"));
  // 3. The PR-#14 silent shrink: baseline holds a live key the file lost.
  const enSample = Object.keys(en).slice(0, 40);
  const baseline = Object.fromEntries(enSample.map((k) => [k, "x"]));
  const shrunk = Object.fromEntries(enSample.slice(0, 20).map((k) => [k, "x"]));
  expectFail("shrink", () =>
    checkInterfaceFile("shrink", JSON.stringify(shrunk), JSON.stringify(baseline), "witness:shrink"));
  // 4. The overlay collapse.
  expectFail("overlay collapse", () =>
    checkOverlayFile("collapse", JSON.stringify({ a: "1" }), JSON.stringify(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "v"]))), "witness:collapse"));
  console.log(missed.length === 0
    ? `\nall ${witnessed} witness fixtures went red — the gate can fail\n`
    : `\nWITNESS BROKEN: ${missed.join(", ")} did not fail — the gate is blind to its own class\n`);
  process.exit(missed.length === 0 ? 0 : 1);
}

console.log(`\ntranslation guard (baseline: ${lastTag ?? "NO TAG — rules 1+2 only"})\n`);

for (const f of readdirSync(LANG).filter((f) => f.endsWith(".json") && f !== "en.json")) {
  checkInterfaceFile(f, readFileSync(join(LANG, f), "utf8"), lastTag ? gitShow(lastTag, `lang/${f}`) : null, `lang/${f}`);
}
const contentDir = join(LANG, "content");
if (existsSync(contentDir)) {
  for (const f of readdirSync(contentDir).filter((f) => f.endsWith(".json"))) {
    checkOverlayFile(f, readFileSync(join(contentDir, f), "utf8"), lastTag ? gitShow(lastTag, `lang/content/${f}`) : null, `lang/content/${f}`);
  }
  // A content file the tag shipped must not vanish outright (PR #14 DELETED
  // lang/content/es.json; only the tree-fix caught it).
  if (lastTag) {
    const lsTree = execFileSync("git", ["ls-tree", "--name-only", lastTag, "lang/content/"], { cwd: ROOT }).toString().split("\n").filter(Boolean);
    for (const path of lsTree) {
      const base = path.split("/").pop();
      existsSync(join(contentDir, base))
        ? ok(`${path} still shipped`)
        : fail(`${path} still shipped`, `present at ${lastTag}, gone from the tree — a deleted overlay is a deleted language`);
    }
  }
}

console.log(failed ? "\nTRANSLATION GUARD FAILED\n" : "\ntranslation guard passed\n");
process.exit(failed ? 1 : 0);

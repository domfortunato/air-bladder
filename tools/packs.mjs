#!/usr/bin/env node
/**
 * Compendium packs are LevelDB databases: binary, unmergeable, and rewritten by
 * the act of opening them. The YAML under src/packs/ is the source of truth;
 * packs/ is generated output and is gitignored.
 *
 *   node tools/packs.mjs build     src/packs/ -> packs/   (before release, or to test locally)
 *   node tools/packs.mjs extract   packs/ -> src/packs/   (after editing content inside Foundry)
 *
 * The pack list comes from system.json so the two cannot drift apart.
 */

import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// js-yaml arrives with @foundryvtt/foundryvtt-cli, which is this file's only
// non-builtin import and is what a server installs with --no-save. Required
// rather than imported: it is CommonJS.
const yaml = createRequire(import.meta.url)("js-yaml");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src", "packs");
const outRoot = path.join(root, "packs");

const mode = process.argv[2] ?? "build";
if (!["build", "extract"].includes(mode)) {
  console.error("Usage: node tools/packs.mjs [build|extract]");
  process.exit(1);
}

const { packs } = JSON.parse(fs.readFileSync(path.join(root, "system.json"), "utf8"));
const countYaml = dir =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".yml")).length : 0;

/* -------------------------------------------------------------------------- */
/*  The guard that should always have been here                                */
/* -------------------------------------------------------------------------- */

/**
 * A BUILD IS DESTRUCTIVE WHENEVER A WARDEN HAS EDITED A COMPENDIUM IN FOUNDRY.
 *
 * `build` rmSyncs each pack and recompiles it from YAML, so anything edited
 * inside the world since the last `extract` is gone — and `packs/` is
 * gitignored, LevelDB keeps no history, and Foundry writes no automatic
 * backups. On 2026-08-04 that destroyed roughly five hours of monster art
 * assignment plus a description fix, with no recovery path at all: the newest
 * Volume Shadow Copy predated the work.
 *
 * "packs/ is generated output" is true right up until someone edits a
 * compendium in the world, and from that moment it holds the ONLY copy. The
 * header of this file says the YAML is the source of truth, which is the
 * intent — but intent is not a safeguard, and the destructive direction ran
 * with nothing standing in front of it.
 *
 * So: before building, EXTRACT packs/ to a scratch directory and compare it to
 * a SYNC MARKER — a fingerprint of what packs/ held the last time build or
 * extract left the two sides agreeing. Unchanged since then means the build is
 * a safe regeneration; changed means somebody edited a compendium in Foundry
 * and the build would eat it.
 *
 * TWO WRONG DESIGNS CAME FIRST, and both are worth naming because each looked
 * obviously right:
 *
 *   mtime. Useless. LevelDB rewrites CURRENT, MANIFEST and its .log merely
 *   because Foundry opened the world, so packs/ is newer than src/packs after
 *   every single server start. It fired on a provably clean tree — and a guard
 *   that always fires is worse than none, because it teaches you to reach for
 *   --force, which is exactly the reflex that destroys the work.
 *
 *   Comparing packs/ against src/packs directly. Also wrong, and dangerously
 *   plausible: "different" has no DIRECTION. Editing YAML and then building is
 *   the normal workflow and makes the two differ just as surely as editing a
 *   compendium does, so that guard would have blocked ordinary content work
 *   while claiming to protect it. The marker is what supplies direction: it
 *   answers "did packs/ move on its own since we last agreed", which is the
 *   only question that matters here.
 *
 * The marker is gitignored and disposable. If it is missing (fresh clone, first
 * ever build) there is no baseline to compare against, so the build takes a
 * BACKUP first and proceeds — a fresh clone has nothing to lose, and a snapshot
 * costs seconds.
 */
const SYNC_MARKER = path.join(root, ".pack-sync.json");

const listYaml = (dir) => {
  const out = new Map();
  const walk = (d, prefix = "") => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else if (e.name.endsWith(".yml")) out.set(rel, fs.readFileSync(path.join(d, e.name), "utf8"));
    }
  };
  walk(dir);
  return out;
};

/**
 * The fingerprint's canonical form of one document.
 *
 * Hashing the extracted YAML TEXT was the first cut and it made the guard cry
 * wolf: Foundry fills schema defaults into a compendium document merely by
 * loading the world, so the extract that follows carries `_stats` blocks and
 * empty-string members the committed YAML omits, and the hash moves without a
 * single Warden keystroke. Twice on 2026-08-13 the guard named five packs and
 * every difference in them was default-filling — and a guard that fires on
 * nothing teaches the same reflex the mtime design did: reach for --force.
 * That reflex is what destroys the work this exists to protect.
 *
 * So the comparison is on MEANING, not bytes:
 *   - `_stats` goes entirely. Every member of it moves on any write, and
 *     modifiedTime moves on writes that changed nothing. Provenance is not this
 *     gate's job — `check:fields` holds compendiumSource/exportSource/ownership
 *     clean, straight from the YAML.
 *   - `_key` goes: it is derived from the id.
 *   - null, undefined and "" are dropped, because "absent" and "empty" is
 *     exactly the difference default-filling creates. This does NOT hide a
 *     Warden clearing a field: the repo side still holds the old text, so text
 *     against absent still differs. Only empty-against-empty collapses.
 *   - keys are sorted, so serialization order cannot register as change.
 */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * Foundry stores HTML with entities DECODED. The committed YAML carries them
 * encoded (`&#39;`, `&quot;`) because that is what the doc importers and the
 * ProseMirror serializer emit, so every journal page differs the moment a world
 * has loaded — same markup, different spelling of the same characters. Decoding
 * both sides makes them agree; it cannot mask an edit, because two different
 * texts stay different after decoding.
 */
const decodeEntities = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, body) => {
  if (body[0] !== "#") return ENTITIES[body.toLowerCase()] ?? m;
  const code = body[1] === "x" || body[1] === "X"
    ? parseInt(body.slice(2), 16)
    : parseInt(body.slice(1), 10);
  return Number.isFinite(code) ? String.fromCodePoint(code) : m;
});

/**
 * Keys Foundry FILLS with a non-empty default the first time a world loads the
 * pack, which nothing in this system ever authors. Empty defaults (`image: {}`,
 * `system: {}`, `categories: []`) need no list — they collapse under the
 * empty-container rule below. Keep this list short and justified: dropping a key
 * blinds the guard to it, which is why `system` is NOT here (it is where every
 * Item and Actor keeps its content, and it is dropped only when empty).
 */
const FOUNDRY_FILLED = new Set(["video"]);

const canonicalDoc = (v) => {
  if (typeof v === "string") return decodeEntities(v);
  if (Array.isArray(v)) {
    const out = v.map(canonicalDoc);
    return out.length ? out : undefined;
  }
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (k === "_stats" || k === "_key" || FOUNDRY_FILLED.has(k)) continue;
      const c = canonicalDoc(v[k]);
      if (c === null || c === undefined || c === "") continue;
      out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
};

/**
 * Marker format version. The fingerprint's meaning changed when normalization
 * landed, so an older marker's hashes are not comparable — and comparing them
 * anyway would report every pack as drifted, which is the false alarm this
 * change exists to end. A mismatch is treated as NO marker: back up, proceed,
 * re-stamp. Bump this on any change to canonicalDoc or to what is hashed.
 */
const MARKER_FORMAT = 3;

/** A per-pack fingerprint of the CURRENT contents of packs/, or null if unreadable. */
const fingerprintBuilt = async () => {
  const scratch = path.join(root, ".pack-guard-tmp");
  fs.rmSync(scratch, { recursive: true, force: true });
  const out = {};
  for (const { name } of packs) {
    const built = path.join(outRoot, name);
    if (!fs.existsSync(built)) continue;
    try {
      await extractPack(built, path.join(scratch, name), { yaml: true, clean: true });
    } catch {
      continue;                       // locked or absent: the build itself will report it
    }
    const docs = listYaml(path.join(scratch, name));
    // Keyed by the document's own id, not the filename: `extract` renames files
    // to <Name>_<id>.yml, so a document renamed in the world would otherwise
    // register twice over - once as content, once as a path.
    const canon = [...docs.keys()].map((k) => {
      let doc = null;
      try { doc = yaml.load(docs.get(k)); } catch { /* unparseable: fall back to the text */ }
      return doc && typeof doc === "object"
        ? `${doc._id ?? k}::${JSON.stringify(canonicalDoc(doc))}`
        : `${k}::${docs.get(k)}`;
    }).sort();
    out[name] = crypto.createHash("sha256").update(canon.join("\n")).digest("hex");
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  return out;
};

if (mode === "build" && !process.argv.includes("--force")) {
  const stored = fs.existsSync(SYNC_MARKER)
    ? JSON.parse(fs.readFileSync(SYNC_MARKER, "utf8"))
    : null;
  // A marker written before the fingerprint was normalized holds hashes of the
  // extracted TEXT, which are not comparable with these. Comparing anyway would
  // report every pack as drifted — the exact false alarm the normalization was
  // added to end — so an old marker is treated as no marker: back up, build,
  // re-stamp. Costs one backup, once.
  const marker = stored && stored.__format === MARKER_FORMAT ? stored.packs : null;
  if (stored && !marker) {
    console.log(`  sync marker is format ${stored.__format ?? 1}, this build wants ${MARKER_FORMAT}`
      + " — re-stamping (the fingerprint now compares meaning, not bytes)");
  }

  if (!marker) {
    console.log("  no comparable sync marker — taking a backup before building");
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync(process.execPath, [path.join(root, "tools", "dev", "backup.mjs"), "--label", "first-build"], { stdio: "inherit" });
    } catch { console.log("  (backup failed; continuing — nothing to compare against anyway)"); }
  } else {
    const now = await fingerprintBuilt();
    const drifted = Object.keys(now).filter((n) => marker[n] && marker[n] !== now[n]);
    if (drifted.length) {
      console.error(
        "\nREFUSING TO BUILD — packs/ has changed since the last build or extract.\n\n"
        + drifted.map((n) => `  ${n}`).join("\n")
        + "\n\nThat means a compendium was edited inside Foundry. A build recompiles\n"
        + "packs/ FROM src/packs/, so those edits would be destroyed — and nothing can\n"
        + "recover them: packs/ is gitignored, LevelDB keeps no history, Foundry writes\n"
        + "no backups, and Volume Shadow Copies are days apart. This exact build cost\n"
        + "five hours of compendium work on 2026-08-04.\n\n"
        + "  npm run extract:packs           fold the world's edits into src/packs/ first\n"
        + "  npm run backup                  snapshot packs/ and both worlds\n"
        + "  npm run build:packs -- --force  only if you mean to discard those edits\n");
      process.exit(1);
    }
  }
}

let failed = false;

for (const { name } of packs) {
  const src = path.join(srcRoot, name);
  const out = path.join(outRoot, name);

  try {
    if (mode === "build") {
      if (!fs.existsSync(src)) throw new Error(`no YAML source at src/packs/${name}`);
      // Compaction leaves orphaned .ldb files behind, so build into a clean directory.
      fs.rmSync(out, { recursive: true, force: true });
      await compilePack(src, out, { yaml: true, recursive: true });
      console.log(`  built    ${name.padEnd(30)} ${String(countYaml(src)).padStart(3)} docs`);
    } else {
      // A pack DECLARED but never BUILT has nothing to extract and nothing to
      // lose — skip it rather than fail. Failing here was a circular trap: the
      // failed run exited before re-stamping the sync marker, so the next
      // build refused on stale "drift" that extract had already folded in, and
      // re-running extract failed the same way forever. Hit on 2026-08-04, the
      // first time a new pack (backgrounds-custom) was declared since the
      // guard was written.
      if (!fs.existsSync(out)) {
        console.log(`  skipped  ${name.padEnd(30)} (declared but not built yet — nothing to extract)`);
        continue;
      }
      await extractPack(out, src, { yaml: true, clean: true });
      console.log(`  extracted ${name.padEnd(29)} ${String(countYaml(src)).padStart(3)} docs`);
    }
  } catch (err) {
    console.error(`  FAILED   ${name.padEnd(30)} ${err.message}`);
    failed = true;
  }
}

// A pack removed from system.json leaves its built directory behind forever:
// nothing here ever looked at what was already in packs/, only at what was
// declared. Three orphans from the removed 1e generator packs sat there for days,
// and they SHIP — the release zip takes packs/ wholesale, so a deleted pack keeps
// going out to users. Prune on build, and say which, rather than deleting quietly.
if (mode === "build" && fs.existsSync(outRoot)) {
  const declared = new Set(packs.map(p => p.name));
  const orphans = fs.readdirSync(outRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && !declared.has(d.name))
    .map(d => d.name);
  for (const name of orphans) {
    fs.rmSync(path.join(outRoot, name), { recursive: true, force: true });
    console.log(`  pruned   ${name.padEnd(30)} (not in system.json)`);
  }
}

if (failed) process.exit(1);

// Re-stamp the sync marker: after either direction succeeds, packs/ and
// src/packs agree, and THAT state is the baseline the next build compares
// against. Written last so a failed run never moves the baseline forward —
// a marker that advanced past work nobody folded in would silently re-arm the
// exact loss this guards.
try {
  fs.writeFileSync(SYNC_MARKER,
    JSON.stringify({ __format: MARKER_FORMAT, packs: await fingerprintBuilt() }, null, 2) + "\n");
} catch (err) {
  console.error(`  WARNING  could not write ${path.basename(SYNC_MARKER)} — the next build will `
    + `have no baseline and will back up instead of comparing (${err.message})`);
}

console.log(`${mode === "build" ? "Built" : "Extracted"} ${packs.length} packs.`);

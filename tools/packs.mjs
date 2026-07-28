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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      if (!fs.existsSync(out)) throw new Error(`no pack at packs/${name}`);
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
console.log(`${mode === "build" ? "Built" : "Extracted"} ${packs.length} packs.`);

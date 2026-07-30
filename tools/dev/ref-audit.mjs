#!/usr/bin/env node
/**
 * Every compendium reference in every shipped RollTable must resolve.
 *
 *   node tools/dev/ref-audit.mjs [--verbose]
 *
 * A RollTable result of type `pack` carries a documentCollection + documentId.
 * If that id names nothing, the table still LOOKS fine — it draws, it prints the
 * item's name to chat, and the generator quietly grants nothing. There is no
 * error, no warning, and no way for a player to tell the difference between "you
 * rolled a Wig" and "you rolled a Wig and received it".
 *
 * That is not hypothetical: 16 of the 100 rows on Barebones: Creation - Additional
 * Gear pointed at items that did not exist (2026-07-28). They had been authored
 * and then removed by a later consolidation pass, which had no way to know a table
 * still named them. Rolling any of those 16 gave the player nothing at all.
 *
 * No Foundry required — this reads src/packs YAML directly, so it is cheap enough
 * to run on every content change. Exits non-zero on any dangling reference.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const yaml = createRequire(import.meta.url)("js-yaml");
const load = yaml.load ?? yaml.safeLoad;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(root, "src", "packs");
const verbose = process.argv.includes("--verbose");

const packDirs = fs.readdirSync(srcRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);

const docsIn = (pack) => {
  const dir = path.join(srcRoot, pack);
  return fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))
    .map((f) => load(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter(Boolean);
};

/* ---- index every document id, keyed the way a result addresses it ---------- */

const byId = new Map();
for (const pack of packDirs) {
  for (const d of docsIn(pack)) {
    if (d._id) byId.set(`air-bladder.${pack}/${d._id}`, { name: d.name, pack });
  }
}

/* ---- walk every table result ---------------------------------------------- */

const dangling = [];
const byName = [];
let checked = 0, tables = 0;

for (const pack of packDirs) {
  for (const d of docsIn(pack)) {
    if (!Array.isArray(d.results)) continue;
    tables++;
    for (const r of d.results) {
      // Foundry writes the type as the string "pack" in YAML; tolerate the
      // numeric legacy form too rather than silently skipping a whole table.
      if (r.type !== "pack" && r.type !== 2) continue;
      checked++;
      const key = `${r.documentCollection}/${r.documentId}`;
      const hit = byId.get(key);
      if (!hit) { dangling.push(`${d.name} [${(r.range ?? []).join("-")}] -> "${r.text}" (${key})`); continue; }
      // Resolving is necessary but not sufficient: an id that points at the WRONG
      // document draws the right name and grants something else entirely.
      if (hit.name !== r.text) byName.push(`${d.name} -> "${r.text}" resolves to "${hit.name}" in ${hit.pack}`);
    }
  }
}

console.log(`${tables} table(s), ${checked} compendium reference(s) across ${packDirs.length} packs`);

let failed = false;
if (dangling.length) {
  failed = true;
  console.error(`\nDANGLING — ${dangling.length} reference(s) name a document that does not exist:`);
  for (const d of dangling) console.error(`  ${d}`);
} else {
  console.log("  ok    every compendium reference resolves");
}

if (byName.length) {
  failed = true;
  console.error(`\nMISMATCHED — ${byName.length} reference(s) resolve to a differently-named document:`);
  for (const d of byName) console.error(`  ${d}`);
} else if (checked) {
  console.log("  ok    every reference resolves to a document of the same name");
}

/* ---- no two canonical gear packs may hold the same item NAME ----------------
 *
 * Gear is granted BY NAME: module/gear.js walks CANONICAL_GEAR_PACKS and takes
 * the first index entry that matches. A second document with the same name is
 * therefore unreachable — and unreachable in a way nothing else here can see,
 * because every reference still resolves and every grant still succeeds. The
 * only symptom is a Warden editing the copy that never wins.
 *
 * 17 of these had accumulated by 2026-07-29, from two importers disagreeing
 * about where the pool is: background-items.mjs moved an item out of a type
 * pack, barebones.mjs could not see the new home in its POOL_PACKS scan,
 * declared the item missing and re-authored it with a fresh id. Both are fixed;
 * this is what stops it coming back quietly a third time. */
const CANONICAL_GEAR_PACKS = [
  "expeditionary-gear", "tools", "trinkets",
  "weapons", "armor", "market-goods", "background-items",
];
const gearByName = new Map();
for (const pack of CANONICAL_GEAR_PACKS) {
  const dir = path.join(srcRoot, pack);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
    const doc = load(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!doc?.name) continue;
    const key = String(doc.name).toLowerCase();
    if (!gearByName.has(key)) gearByName.set(key, []);
    gearByName.get(key).push(pack);
  }
}
const dupes = [...gearByName.entries()].filter(([, packs]) => packs.length > 1);
if (dupes.length) {
  failed = true;
  console.error(`\nDUPLICATE GEAR NAMES — ${dupes.length} name(s) in more than one canonical pack:`);
  for (const [name, packs] of dupes) {
    console.error(`  ${name} — ${packs.join(", ")}   (resolves to ${packs.sort((a, b) =>
      CANONICAL_GEAR_PACKS.indexOf(a) - CANONICAL_GEAR_PACKS.indexOf(b))[0]}, the rest are dead)`);
  }
} else {
  console.log(`  ok    ${gearByName.size} gear names, each in exactly one canonical pack`);
}

/* ---------------------------------------------------------------------------
 * The pack list above is declared in four places, and they must not drift.
 *
 * Until now that was enforced by a paragraph of comment in each file, and the
 * comments were right about the hazard and powerless to stop it: the 17 duplicate
 * gear names of 2026-07-29 came from exactly this, two importers disagreeing about
 * where the pool is. Retiring the one-item `extra` pack meant editing SIX
 * hand-maintained copies, which is the moment to make it a check.
 *
 * `module/gear.js` is the source of truth -- it is what the running resolver
 * walks. Only lists that are meant to BE the pool are compared:
 *
 *   - barebones.mjs POOL_PACKS  — "every item the resolver can reach"
 *   - item-usage.mjs, this file — audits of that same pool
 *
 * Three others look similar and are deliberately different, so they are left out
 * rather than papered over: marketplace.mjs CANONICAL excludes `market-goods`
 * (it authors INTO it), background-items.mjs SOURCE_PACKS names only the type
 * packs it consolidates OUT of, and barebones.mjs TARGET_PACKS is the set it
 * writes rather than reads.
 * ------------------------------------------------------------------------- */
const listIn = (relPath, constName) => {
  const src = fs.readFileSync(path.join(root, relPath), "utf8");
  const m = new RegExp(`const ${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/["']([\w.-]+)["']/g)]
    .map((x) => x[1].replace(/^air-bladder\./, ""));
};

const truth = listIn("module/gear.js", "CANONICAL_GEAR_PACKS");
if (!truth?.length) {
  failed = true;
  console.error("\nCANONICAL_GEAR_PACKS could not be read out of module/gear.js");
} else {
  const mirrors = [
    ["tools/dev/ref-audit.mjs", "CANONICAL_GEAR_PACKS"],
    ["tools/dev/item-usage.mjs", "CANONICAL_GEAR_PACKS"],
    ["tools/import/barebones.mjs", "POOL_PACKS"],
  ];
  const drifted = [];
  for (const [rel, name] of mirrors) {
    const got = listIn(rel, name);
    if (!got) { drifted.push(`${rel}: ${name} not found (renamed?)`); continue; }
    if (got.join(",") !== truth.join(",")) {
      drifted.push(`${rel}: ${name} = [${got.join(", ")}]`);
    }
  }
  if (drifted.length) {
    failed = true;
    console.error(`\nPACK LIST DRIFT — module/gear.js has [${truth.join(", ")}]:`);
    for (const d of drifted) console.error(`  ${d}`);
  } else {
    console.log(`  ok    ${mirrors.length} mirrored pack list(s) match module/gear.js`);
  }
}

if (verbose && !failed) {
  console.log(`\nindexed ${byId.size} documents`);
}

console.log(failed ? "\nREFERENCE AUDIT FAILED\n" : "\nreference audit passed\n");
process.exit(failed ? 1 : 0);

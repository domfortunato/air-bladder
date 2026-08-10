#!/usr/bin/env node
/**
 * Every compendium reference in every shipped RollTable must resolve.
 *
 *   node tools/dev/ref-audit.mjs [--verbose]
 *
 * A RollTable result of type `document` carries a `documentUuid`. If that uuid
 * names nothing, the table still LOOKS fine — it draws, it prints the item's name
 * to chat, and the generator quietly grants nothing. There is no error, no
 * warning, and no way for a player to tell the difference between "you rolled a
 * Wig" and "you rolled a Wig and received it".
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

/**
 * Not for sale, by decision (2026-07-29): relics, spellbooks and spell scrolls.
 *
 * Relics are Warden-placed treasure and spellbooks are found, not shopped for. The
 * shop is built ENTIRELY from the `marketplace` tables' compendium references, so
 * a pack that no table names is unbuyable — which means today this holds by
 * OMISSION, and omission is not a decision anyone can see. One dragged-in result
 * would quietly put a d8 Mace of the Kingslayer on the shelf for 0gp.
 *
 * Checked here rather than filtered at runtime: a filter over a catalog that
 * cannot contain them would be dead code that reads as protection.
 */
const NO_SALE_PACKS = ["reliquary", "spellbooks", "more-spellbooks"];
const forSale = [];

const dangling = [];
const byName = [];
const malformed = [];
let checked = 0, tables = 0;

/**
 * Inline `@UUID[...]` links in result TEXT are how encounter rows reference
 * monsters (2026-08-09): the Warden-authorable convention carries the link in
 * the row's rich text because Foundry's table editor exposes no flags UI. They
 * draw and enrich exactly like document rows and fail exactly as silently, so
 * they are held to the same standard — with one deliberate difference: no
 * name-matching. An inline label is display WORDING, not a document name
 * ("Mountain Lion" deliberately links the Tiger; "Bronze Construct" links
 * Golem, Bronze). A non-Compendium link (`@UUID[Actor.<id>]`) in shipped YAML
 * can resolve only in the world it was authored in, so here it is always a bug.
 */
const INLINE_UUID = /@UUID\[([^\]]+)\]/g;
const EXPECTED_INLINE_REFS = 80;   // raise deliberately when content adds links
let inlineChecked = 0;
const inlineDangling = [];
const inlineUnresolvable = [];

/**
 * How many compendium references there are supposed to BE.
 *
 * Because this gate reads a schema, and a schema rename turns it into a gate that
 * checks nothing while still printing "passed". That is exactly what happened on
 * 2026-07-30: v13 renamed the row type from `pack` to `document` and replaced
 * documentCollection+documentId with documentUuid, so `if (r.type !== "pack")
 * continue` skipped every row in every table. 198 references one run, 0 the next,
 * green both times.
 *
 * Raise this deliberately when content adds references. A gate that cannot notice
 * it has stopped looking is worse than no gate, because it is believed.
 */
// 198 → 298 on 2026-08-05: "Spells — Canon (1d100)" added 100 document rows.
const EXPECTED_REFS = 298;

for (const pack of packDirs) {
  for (const d of docsIn(pack)) {
    if (!Array.isArray(d.results)) continue;
    tables++;
    for (const r of d.results) {
      for (const m of String(r.description ?? "").matchAll(INLINE_UUID)) {
        const p = m[1].split(".");
        if (p[0] !== "Compendium" || p.length !== 5 || p[1] !== "air-bladder") {
          inlineUnresolvable.push(`${d.name} [${(r.range ?? []).join("-")}] -> ${m[1]}`);
          continue;
        }
        inlineChecked++;
        if (!byId.has(`${p[1]}.${p[2]}/${p[4]}`)) {
          inlineDangling.push(`${d.name} [${(r.range ?? []).join("-")}] -> ${m[1]}`);
        }
      }
      // v13 merged the "compendium"/"pack" row type into "document". The legacy
      // numeric form is tolerated rather than silently skipping a whole table.
      if (r.type !== "document" && r.type !== 2) continue;
      // "Compendium.<packageName>.<packName>.<DocumentName>.<id>" -> the two
      // parts this indexes by. Anything else is not a compendium reference.
      const parts = String(r.documentUuid ?? "").split(".");
      if (parts[0] !== "Compendium" || parts.length !== 5) {
        malformed.push(`${d.name} [${(r.range ?? []).join("-")}] -> "${r.name}" (documentUuid: ${r.documentUuid ?? "missing"})`);
        continue;
      }
      const [, pkg, packName, , id] = parts;
      checked++;
      if (pack === "marketplace" && NO_SALE_PACKS.includes(packName)) {
        forSale.push(`${d.name} -> "${r.name}" (from ${packName})`);
      }
      const key = `${pkg}.${packName}/${id}`;
      const hit = byId.get(key);
      if (!hit) { dangling.push(`${d.name} [${(r.range ?? []).join("-")}] -> "${r.name}" (${key})`); continue; }
      // Resolving is necessary but not sufficient: an id that points at the WRONG
      // document draws the right name and grants something else entirely.
      if (hit.name !== r.name) byName.push(`${d.name} -> "${r.name}" resolves to "${hit.name}" in ${hit.pack}`);
    }
  }
}

console.log(`${tables} table(s), ${checked} compendium reference(s) + ${inlineChecked} inline link(s) across ${packDirs.length} packs`);

let failed = false;

if (checked < EXPECTED_REFS) {
  failed = true;
  console.error(`\nUNDER-COUNTED — found ${checked} compendium reference(s), expected at least `
    + `${EXPECTED_REFS}. This gate reads a schema; if content did not shrink, it has stopped `
    + "looking. Check the row type and documentUuid shape before raising EXPECTED_REFS.");
}

if (malformed.length) {
  failed = true;
  console.error(`\nMALFORMED — ${malformed.length} document row(s) carry no usable documentUuid:`);
  for (const d of malformed) console.error(`  ${d}`);
}

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

if (inlineChecked < EXPECTED_INLINE_REFS) {
  failed = true;
  console.error(`\nUNDER-COUNTED — found ${inlineChecked} inline @UUID link(s), expected at least `
    + `${EXPECTED_INLINE_REFS}. Same rule as EXPECTED_REFS: if content did not shrink, this `
    + "gate has stopped looking. Check the regex and the description field before raising it.");
}

if (inlineUnresolvable.length) {
  failed = true;
  console.error(`\nUNRESOLVABLE — ${inlineUnresolvable.length} inline link(s) are world-scoped or `
    + "foreign (only Compendium.air-bladder.* can resolve in a user's world):");
  for (const d of inlineUnresolvable) console.error(`  ${d}`);
}

if (inlineDangling.length) {
  failed = true;
  console.error(`\nDANGLING — ${inlineDangling.length} inline link(s) name a document that does not exist:`);
  for (const d of inlineDangling) console.error(`  ${d}`);
} else {
  console.log("  ok    every inline @UUID link resolves");
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

if (forSale.length) {
  failed = true;
  console.error(`\nFOR SALE BUT SHOULD NOT BE — ${forSale.length} marketplace result(s) from a no-sale pack:`);
  for (const f of forSale) console.error(`  ${f}`);
} else {
  console.log(`  ok    nothing from ${NO_SALE_PACKS.join(" / ")} is on sale`);
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

/* ---------------------------------------------------------------------------
 * The Hireling scrub must not quietly un-happen.
 *
 * The NPC generator was called "hireling" everywhere until 2026-08-01, when the
 * hireling ROLE collapsed into npc + forHire and the identifiers were renamed
 * wholesale (createHireling -> createNpc and friends, module/hirelings-2e.json
 * -> npc-careers-2e.json). A stale branch, an old patch or a copy-paste from
 * the fork can bring one back, and it would still parse -- the import would
 * just resolve to nothing at runtime, or a probe would quietly exercise a
 * function that no longer exists.
 *
 * Two exemptions, both named rather than implied: this file (it spells the
 * pattern out in order to look for it), and the SRC line of
 * tools/import/npc-careers-2e.mjs -- upstream's file is resources/hirelings.md
 * and their name is not ours to rename.
 * ------------------------------------------------------------------------- */
const SCRUBBED = /createHireling|regenerateHireling|rerollHireling|hirelingToActorData|generateHireling|getHirelings2e|hirelingGenerator|hirelings-2e/;
const SELF = "tools/dev/ref-audit.mjs";
const SRC_EXEMPT = "tools/import/npc-careers-2e.mjs";
const scrubHits = [];
const walkForScrub = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walkForScrub(p); continue; }
    const rel = path.relative(root, p).replace(/\\/g, "/");
    if (rel === SELF) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (!SCRUBBED.test(line)) return;
      if (rel === SRC_EXEMPT && line.includes("raw.githubusercontent.com")) return;
      scrubHits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
};
for (const r of ["module", "tools"]) walkForScrub(path.join(root, r));
if (scrubHits.length) {
  failed = true;
  console.error(`\nHIRELING SCRUB REGRESSION — ${scrubHits.length} line(s) name a scrubbed identifier:`);
  for (const h of scrubHits) console.error(`  ${h}`);
} else {
  console.log("  ok    no scrubbed hireling identifier is back in module/ or tools/");
}

/* ---- every art path a pack doc names must actually exist ------------------ */
// Hand-picked icons (2026-08-01) are stored in the pack YAML and deliberately
// left alone by tools/import/item-icons.mjs, which means nothing else re-derives
// them — so a typo, a renamed glyph or a deleted file is invisible until a
// player sees a broken image, and by then it has shipped in the manifest. The
// classifier's own output cannot rot this way (it is generated); a chosen path
// can, which is exactly why choosing is worth gating.
//
// `systems/air-bladder/...` maps to the repo root. Anything else — a core
// `icons/svg/...` path, a module's art — is not ours to resolve and is skipped.
const PREFIX = "systems/air-bladder/";
const artMissing = [];
const walkPackArt = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walkPackArt(full); continue; }
    if (!e.name.endsWith(".yml")) continue;
    const rel = path.relative(root, full).replace(/\\/g, "/");
    fs.readFileSync(full, "utf8").split(/\r?\n/).forEach((line, i) => {
      // Top-level and nested art alike: `img:`, and prototype token `src:`.
      const m = line.match(/^\s*(?:img|src):\s*(\S+)\s*$/);
      if (!m) return;
      const p = m[1].replace(/^["']|["']$/g, "");
      if (!p.startsWith(PREFIX)) return;
      if (!fs.existsSync(path.join(root, p.slice(PREFIX.length)))) {
        artMissing.push(`${rel}:${i + 1}  ${p}`);
      }
    });
  }
};
walkPackArt(path.join(root, "src", "packs"));
if (artMissing.length) {
  failed = true;
  console.error(`\nMISSING ART — ${artMissing.length} pack path(s) point at a file that is not there:`);
  for (const a of artMissing.slice(0, 20)) console.error(`  ${a}`);
} else {
  console.log("  ok    every art path a pack document names exists on disk");
}

if (verbose && !failed) {
  console.log(`\nindexed ${byId.size} documents`);
}

console.log(failed ? "\nREFERENCE AUDIT FAILED\n" : "\nreference audit passed\n");
process.exit(failed ? 1 : 0);

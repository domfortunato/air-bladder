#!/usr/bin/env node
/**
 * Static usage analysis of the Item packs: which pool items are actually
 * referenced by a consumer, and which are orphans left over from upstream.
 *
 * A gear grant resolves BY NAME across CANONICAL_GEAR_PACKS (see module/gear.js),
 * so "used" == "some consumer names it". Consumers scanned:
 *   - 2e backgrounds     startingGear[].name  +  tables[].options[].items[].name
 *   - Barebones bgs      startingGear[].name
 *   - 2e Bonds table     per-result flag items
 *   - Hirelings          gear names (module/hirelings-2e.json)
 *   - Marketplace tables result.text (the item name)
 *   - SRD creation tables + legacy gear-tables  result.text
 *   - default gear       Rations, Torch  (config.js startingItems)
 *   - GEAR_ALIASES       alias targets
 * Spell grants ("Scroll (X)", "X Spellbook") route to the spellbook packs and are
 * counted separately; spellbooks/monsters are NOT orphan-analysed (core content).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const YAML = require("js-yaml");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const P = (...a) => path.join(ROOT, "src", "packs", ...a);
const readPack = (pack) => {
  const dir = P(pack);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".yml"))
    .map((f) => YAML.load(fs.readFileSync(path.join(dir, f), "utf8"))).filter(Boolean);
};

// ---- mirror module/gear.js (kept in sync by hand) -------------------------
const CANONICAL_GEAR_PACKS = ["expeditionary-gear", "tools", "trinkets", "extra", "weapons", "armor", "market-goods"];
const GEAR_ALIASES = new Map([
  ["lockpick", "Lockpicks"], ["hand drill", "Hand-Drill"], ["torches", "Torch"],
  ["rope (25ft)", "Rope"], ["chain (10ft)", "Chain, 10ft"], ["chains (10ft)", "Chain, 10ft"],
  ["chains", "Chain, 10ft"], ["chain", "Chain, 10ft"], ["pole (10ft)", "Pole, 10ft"],
  ["pole", "Pole, 10ft"], ["plate", "Plate Mail"],
  ["simple instrument (pipes, lute, etc.)", "Simple Instruments (Pipes, Lute, etc.)"],
  ["boltcutters", "Bolt Cutters"], ["tent (fits 2)", "Tent"],
]);
const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
const spellFromGrant = (name) => {
  const s = decode(name).trim();
  const m = s.match(/^spellbook\s*\((.+)\)$/i) || s.match(/^scroll\s*\((.+)\)$/i) || s.match(/^(.+?)\s+spellbook$/i);
  return m ? m[1].trim() : null;
};
/** Normalise a grant name to the canonical gear key (lowercased), or {spell} if it's a spell. */
const canon = (name) => {
  if (name == null) return null;
  const spell = spellFromGrant(name);
  if (spell) return { spell: spell.toLowerCase() };
  const raw = decode(name).trim();
  const aliased = GEAR_ALIASES.get(raw.toLowerCase()) ?? raw;
  return { gear: aliased.toLowerCase() };
};

// ---- collect references, tagged by consumer class -------------------------
const refGear = new Map();   // lc name -> Set(consumerClass)  ("bg" | "market" | "srd" | "hireling" | "default" | "alias")
const refSpell = new Set();
const add = (name, cls) => {
  const c = canon(name);
  if (!c) return;
  if (c.spell) { refSpell.add(c.spell); return; }
  if (!refGear.has(c.gear)) refGear.set(c.gear, new Set());
  refGear.get(c.gear).add(cls);
};

// 2e backgrounds: startingGear + every choice-table option's items
for (const bg of readPack("backgrounds-2e")) {
  for (const g of bg.system?.startingGear ?? []) add(g.name, "bg");
  for (const t of bg.system?.tables ?? [])
    for (const o of t.options ?? []) for (const it of o.items ?? []) add(it.name, "bg");
}
// Barebones backgrounds
for (const bg of readPack("backgrounds-barebones"))
  for (const g of bg.system?.startingGear ?? []) add(g.name, "bg");

// 2e Bonds table: per-result flag items (scope air-bladder or legacy cairn)
for (const t of readPack("tables-2e"))
  for (const r of t.results ?? []) {
    const f = r.flags ?? {};
    for (const scope of ["air-bladder", "cairn"])
      for (const it of f[scope]?.items ?? []) add(it.name ?? it, "bg");
  }

// Hirelings
try {
  const hire = JSON.parse(fs.readFileSync(path.join(ROOT, "module", "hirelings-2e.json"), "utf8"));
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      if (typeof o.name === "string" && (o.uses !== undefined || o.tags !== undefined || o.type !== undefined || o.equipped !== undefined)) add(o.name, "hireling");
      Object.values(o).forEach(walk);
    }
  };
  walk(hire);
} catch {}

// Marketplace + SRD + legacy gear-tables: result.text is the item name
for (const pack of ["marketplace"]) for (const t of readPack(pack)) for (const r of t.results ?? []) add(r.text, "market");
for (const pack of ["character-creation-tables-srd", "gear-tables"]) for (const t of readPack(pack)) for (const r of t.results ?? []) add(r.text, "srd");

// default gear + alias targets
["Rations", "Torch"].forEach((n) => add(n, "default"));
for (const target of GEAR_ALIASES.values()) add(target, "alias");

// ---- per-pack report -------------------------------------------------------
// LIVE   : referenced by a 2e/barebones consumer (bg, marketplace, hireling, default)
// LEGACY : reachable ONLY via the dead 1e generator (srd creation tables / gear-tables / alias)
// ORPHAN : no consumer at all
const LIVE_CLASSES = new Set(["bg", "market", "hireling", "default"]);
console.log(`\n================ ORPHAN / LEGACY ANALYSIS (Item packs) ================`);
const allNames = new Map();  // lc -> [pack]
const bgOnly = [];           // referenced ONLY by backgrounds -> reorg candidates
let totalOrphans = 0, totalLegacy = 0;
for (const pack of CANONICAL_GEAR_PACKS) {
  const items = readPack(pack).map((d) => d.name).sort();
  const orphans = [], legacyOnly = [];
  for (const name of items) {
    const lc = name.toLowerCase();
    if (!allNames.has(lc)) allNames.set(lc, []);
    allNames.get(lc).push(pack);
    const cls = refGear.get(lc);
    if (!cls) { orphans.push(name); continue; }
    const live = [...cls].some((c) => LIVE_CLASSES.has(c));
    if (!live) legacyOnly.push(name);                                          // dead-1e-path only
    else if (![...cls].some((c) => c !== "bg")) bgOnly.push({ name, pack });   // bg-only (Q2)
  }
  totalOrphans += orphans.length; totalLegacy += legacyOnly.length;
  console.log(`\n${pack}  (${items.length} items — ${orphans.length} orphan, ${legacyOnly.length} legacy-1e-only)`);
  if (orphans.length) console.log(`  ORPHAN (no consumer):     ${orphans.join(", ")}`);
  if (legacyOnly.length) console.log(`  LEGACY-1e-ONLY (dead path): ${legacyOnly.join(", ")}`);
}

// ---- dangling grants: a consumer names an item no pack has ----------------
const dangling = [];
for (const [lc, classes] of refGear) if (!allNames.has(lc)) dangling.push({ lc, classes: [...classes].join("+") });

console.log(`\n================ BACKGROUND-ONLY ITEMS (in standard packs) ================`);
console.log(`${bgOnly.length} items are granted by a background but never sold/standard — the "special" items:`);
const byPack = {};
for (const { name, pack } of bgOnly) (byPack[pack] ??= []).push(name);
for (const [pack, names] of Object.entries(byPack)) console.log(`\n  ${pack} (${names.length}): ${names.sort().join(", ")}`);

console.log(`\n================ SUMMARY ================`);
console.log(`  total orphans (no consumer at all):        ${totalOrphans}`);
console.log(`  legacy-1e-only (dead generator path only):  ${totalLegacy}`);
console.log(`  background-only items filed in standard packs: ${bgOnly.length}`);
console.log(`  dangling grants (named, but no pack item): ${dangling.length}`);
if (dangling.length) console.log(`    ${dangling.slice(0, 60).map((d) => `${d.lc} [${d.classes}]`).join(", ")}`);
console.log(`  spells referenced by grants: ${refSpell.size}`);

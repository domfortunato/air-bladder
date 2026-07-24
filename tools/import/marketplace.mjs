#!/usr/bin/env node
/**
 * Build Air Bladder's marketplace as a REFERENCE catalog over the editable gear
 * pool.
 *
 *   node tools/import/marketplace.mjs [--dry]
 *
 * The shop is not a separate inlined price list (that was the fork's model, and
 * the very duplication this rebuild removes). Instead it is a RollTable pack whose
 * results REFERENCE pool items by name — exactly how backgrounds reference gear —
 * and the price/description shown for a row is read off the referenced Item at
 * runtime. Edit a pool item's cost in Foundry → the shop updates. To stock or
 * unstock an item, drag it into (or out of) one of these tables.
 *
 * This one script does the three data jobs that make that work:
 *
 *   1. COST MIGRATION. The authoritative 2e prices are in the SRD marketplace
 *      table (fetched live); the pool items carry none (system.cost defaults to
 *      0). For every catalog entry that resolves to an existing pool item, we
 *      patch that item's YAML `system.cost` in place (and fill an empty
 *      description from the catalog prose). This is the single source of truth:
 *      after this, cost lives ON the item.
 *
 *   2. SHOP-ONLY GOODS. 2e's market also sells things no background grants —
 *      abstract BUNDLES ("Common Tools (Hammer, Shovel, etc.)") and a few plain
 *      goods absent from the pool. Any catalog entry that does NOT resolve to a
 *      pool item is authored as a real, editable Item in a dedicated
 *      `market-goods` pack, so its cost/description are edited like any other
 *      item. A bundle is bought as a generic item and RENAMED on the character
 *      sheet to the specific thing carried (owned items are freely renameable —
 *      no automation, matching house style); bundle descriptions carry a nudge.
 *
 *   3. THE CATALOG. Three RollTables — "Market: Weapons/Armor/Gear" — of
 *      type:"pack" results pointing at the resolved (pack, name) for each entry,
 *      in the catalog's order. module/marketplace.js reads these to render the
 *      shop. Transports & Containers are deferred to Phase 4 (they mint container
 *      Actors, not items) and are skipped here.
 *
 * Sources:
 *   - second-edition/players-guide/marketplace.md (yochaigal/cairn), fetched
 *     live — the item list and every price. Parsed rather than snapshotted so a
 *     rerun surfaces upstream changes. (It previously read a second-hand price
 *     list the fork carried; the two agree item-for-item and price-for-price,
 *     and the SRD is better in eleven places — it title-cases ten names that
 *     copy had lowercased, and fixes a misplaced bracket in "Expeditionary Gear
 *     (Climbing Spikes, Pulley), etc.".)
 *   - tools/import/marketplace-descriptions.csv — the shop flavour text, which
 *     is OURS, not upstream: the SRD price list is names and numbers only.
 *     Looked up by normalised name, so a re-casing upstream cannot silently drop
 *     a description; anything unmatched is warned about rather than lost quietly.
 *
 * Run order: barebones.mjs -> THIS -> transports.mjs. Barebones first, or the
 * shop cannot see the gear it authors and stocks a near-duplicate beside it;
 * transports after, because this wipes the whole marketplace table dir and would
 * delete the shop table transports.mjs writes there.
 * Idempotent: market-goods + marketplace dirs are wiped and rewritten, ids are
 * name-hashed, and re-patching an already-priced item is a no-op. Rebuild the
 * LevelDB packs afterwards: npm run build:packs (stop Foundry first).
 *
 * Game text: CC BY-SA 4.0, Yochai Gal (attribution required; see README).
 *
 * buildGearItem + ALIASES here are byte-identical to module/gear.js — Node can't
 * import that browser module across the ESM/CJS boundary. KEEP THEM IN SYNC.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const load = yaml.load ?? yaml.safeLoad;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry");

// Categories the shop stocks, in shopper-facing order. Transports & Containers is
// deferred (Phase 4): those are container Actors, not items.
const CATEGORY_ORDER = ["Weapons", "Armor", "Gear"];
// The type pack a category's authored/looked-up items prefer, when a name could
// live in more than one pack. Gear spans several, so it has no single preference.
const CATEGORY_PACK = { Weapons: "weapons", Armor: "armor" };

// Pool packs to resolve a catalog name against (dir names), in the same
// precedence module/gear.js uses. market-goods is NOT here: shop-only goods are
// referenced by explicit documentCollection, never resolved by search.
const CANONICAL = ["expeditionary-gear", "tools", "trinkets", "extra", "weapons", "armor"];

// ---- KEEP IN SYNC with module/gear.js GEAR_ALIASES ----
const ALIASES = new Map([
  ["lockpick", "Lockpicks"],
  ["hand drill", "Hand-Drill"],
  ["torches", "Torch"],
  ["rope (25ft)", "Rope"],
  ["chain (10ft)", "Chain, 10ft"],
  ["chains (10ft)", "Chain, 10ft"],
  ["chains", "Chain, 10ft"],
  ["chain", "Chain, 10ft"],
  ["pole (10ft)", "Pole, 10ft"],
  ["pole", "Pole, 10ft"],
  ["plate", "Plate Mail"],
  ["simple instrument (pipes, lute, etc.)", "Instrument"],
  ["simple instruments (pipes, lute, etc.)", "Instrument"],
  ["boltcutters", "Bolt Cutters"],
  // The shop's tent IS the pool's tent: the barebones item is already
  // bulky with "fits 2" as its description. Without this the shop cannot see
  // it and authors a second, identical tent as a market-only good.
  ["tent (fits 2)", "Tent"],
]);

/* -------------------------------------------------------- the SRD catalog */

const SRC = "https://raw.githubusercontent.com/yochaigal/cairn/main/second-edition/players-guide/marketplace.md";

/** Our own shop flavour text (not upstream) — prose only. Looked up by
 *  normalised name so an upstream re-casing does not silently drop it. */
const DESC_CSV = path.join(root, "tools", "import", "marketplace-descriptions.csv");
const descKey = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "");
const readDescriptions = () => {
  const text = fs.readFileSync(DESC_CSV, "utf8").replace(/^﻿/, "");
  const out = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = line.match(/^"((?:[^"]|"")*)","((?:[^"]|"")*)"\s*$/);
    if (m) out.set(descKey(m[1].replace(/""/g, '"')), m[2].replace(/""/g, '"'));
  }
  return out;
};

/** Table rows under `## heading` whose second cell is a price. */
const pricedRows = (md, heading) => {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) throw new Error(`SRD heading not found: ${heading} — has upstream restructured?`);
  const rows = [];
  let seen = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#{1,6} /.test(l)) break;
    if (!l.startsWith("|")) { if (seen) break; continue; }
    seen = true;
    const cells = l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
    if (/^\d+$/.test(cells[1] ?? "")) rows.push(cells);
  }
  return rows;
};

/** Split on commas outside parentheses. */
const splitTop = (s) => {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
};

/**
 * "Chainmail (2 Armor, _bulky_)" -> { label: "Chainmail", tags: ["2 Armor",
 * "bulky"], uses: 0, notes: [] }.
 *
 * Only the LAST parenthetical can hold qualifiers, and it may MIX them with name
 * text — "Tent (fits 2, _bulky_)" is a tent that fits two AND is bulky — so the
 * recognised qualifiers are lifted out and whatever remains stays in the name.
 * A "d6 STR damage" is direct ability damage, not a wielded weapon (Trap), so it
 * becomes prose: buildGearItem would otherwise mint a d6 weapon called Trap.
 */
const parseCell = (raw) => {
  const tags = [], keep = [], notes = [];
  let uses = 0, label = raw.trim();
  const m = label.match(/\(([^()]*)\)\s*$/);
  if (m) {
    for (const q of splitTop(m[1])) {
      const t = q.replace(/_/g, "").trim();
      let mm;
      if (/^petty$/i.test(t)) tags.push("petty");
      else if (/^bulky$/i.test(t)) tags.push("bulky");
      else if ((mm = t.match(/^(\d+)\s+uses?$/i))) { tags.push("uses"); uses = Number(mm[1]); }
      else if ((mm = t.match(/^\+?(\d+)\s+armou?r$/i))) tags.push(`${mm[1]} Armor`);
      else if ((mm = t.match(/^(d\d+)\s+damage$/i))) tags.push(mm[1]);
      else if (/^d\d+\s+\w+\s+damage$/i.test(t)) notes.push(t);
      else keep.push(q.trim());
    }
    if (tags.length || uses || notes.length) {
      const head = label.slice(0, m.index).trim();
      label = keep.length ? `${head} (${keep.join(", ")})` : head;
    }
  }
  return { label, tags, uses, notes };
};

/**
 * The 2e marketplace, parsed from the SRD into the three shopper-facing
 * categories. Costs and the item list are upstream's; the descriptions are ours.
 *
 * Two shapes need care. A WEAPONS row is a damage TIER listing several example
 * weapons at one price ("Dagger, Cudgel, Sickle, Staff, etc. (d6 damage) | 5"),
 * so it expands to one item each. And two consumables the shop obviously sells —
 * Rations and Animal Feed — are filed under Upkeep & Recovery, whose other rows
 * are services (a night's board is not an item), so they are lifted by name.
 */
const CONSUMABLES = new Set(["Rations", "Animal Feed"]);

const buildCatalog = async () => {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`fetch ${SRC}: HTTP ${res.status}`);
  const md = await res.text();
  const descriptions = readDescriptions();

  const entry = (cell, cost) => {
    const { label, tags, uses, notes } = parseCell(cell);
    const desc = descriptions.get(descKey(label));
    const description = [desc, ...notes].filter(Boolean).join(" ");
    return { name: label, tags, cost, ...(uses ? { uses } : {}), ...(description ? { description } : {}) };
  };

  const armor = pricedRows(md, "## Armor").map((r) => entry(r[0], Number(r[1])));
  const weapons = pricedRows(md, "## Weapons").flatMap((r) => {
    const { label, tags } = parseCell(r[0]);
    return splitTop(label)
      .filter((n) => !/^etc\.?$/i.test(n))
      // The tier's tags (damage die, bulky) belong to each weapon in the row.
      .map((name) => ({ ...entry(name, Number(r[1])), tags: [...tags] }));
  });
  const gear = [
    ...pricedRows(md, "## Gear"),
    ...pricedRows(md, "## Upkeep & Recovery").filter((r) => CONSUMABLES.has(parseCell(r[0]).label)),
  ].map((r) => entry(r[0], Number(r[1])));

  // Positions carry no meaning here, but a silent parse failure would quietly
  // empty a whole shop category, so assert the shape upstream has today.
  const expect = (what, got, want) => {
    if (got !== want) throw new Error(`SRD marketplace: ${what} = ${got}, expected ${want} — upstream changed shape, check the tables before rerunning`);
  };
  expect("weapons", weapons.length, 15);
  expect("armor", armor.length, 6);
  expect("gear", gear.length, 49);

  // Shopper-facing order within a category is alphabetical, not the SRD's row
  // order: the weapon tiers expand out of sequence, and the two consumables come
  // from a different table entirely.
  const byName = (a, b) => a.name.localeCompare(b.name);
  weapons.sort(byName); armor.sort(byName); gear.sort(byName);

  const all = [...weapons, ...armor, ...gear];
  const undescribed = all.filter((e) => !e.description).map((e) => e.name);
  if (undescribed.length) {
    console.warn(`WARNING: no description for ${undescribed.length} item(s) — add them to marketplace-descriptions.csv: ${undescribed.join(", ")}`);
  }
  console.log(`parsed the 2e SRD marketplace: ${weapons.length} weapons, ${armor.length} armor, ${gear.length} gear`);
  return new Map([["Weapons", weapons], ["Armor", armor], ["Gear", gear]]);
};

// ---- author-time inference: byte-identical to module/gear.js buildGearItem ----
const buildGearItem = (g) => {
  const tags = g.tags ?? [];
  const lower = tags.map((t) => String(t).toLowerCase());
  const damageTag = tags.find((t) => /^\s*\d*d\d+(\s*\+\s*\d*d\d+)*\s*$/i.test(String(t)));
  const armorTag = tags.find((t) => /armor/i.test(String(t)));

  let usesMax = g.uses ?? g.maxCharges ?? g.charges ?? 0;
  let usesValue = g.uses ?? g.charges ?? usesMax;
  if (!usesMax) {
    const m = String(g.description ?? "").match(/\b(\d+)\s+uses?\b/i);
    if (m) { usesMax = Number(m[1]); usesValue = usesMax; }
  }

  const system = {
    description: g.description ?? "",
    weightless: lower.includes("petty"),
    bulky: lower.includes("bulky"),
    equipped: false,
    cost: g.cost ?? 0,
    quantity: 1,
    uses: { value: usesValue, max: usesMax },
  };

  let type = "item";
  if (damageTag) {
    type = "weapon";
    system.damageFormula = String(damageTag).trim();
    system.criticalDamage = "";
    system.blast = lower.includes("blast");
  } else if (armorTag) {
    type = "armor";
    const n = parseInt(String(armorTag), 10);
    system.armor = Number.isNaN(n) ? 1 : n;
  }
  return { name: g.name, type, system };
};

// ---- YAML helpers ----
// Quote a scalar unless it is a plain, safe bareword.
const y = (s) => {
  const str = String(s);
  if (str === "") return "''";
  if (/[:#{}\[\],&*?|<>=!%@`'"]/.test(str) || /^\s|\s$/.test(str) || /^[-?]/.test(str)) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return str;
};

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const idFor = (seed) => [...crypto.createHash("sha256").update(seed).digest().subarray(0, 16)]
  .map((b) => ALPHA[b % ALPHA.length]).join("");

// ---- index the existing pool: lowerName -> { pack -> {id, file} } ----
const poolByName = new Map();
for (const pack of CANONICAL) {
  const dir = path.join(root, "src", "packs", pack);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    const doc = load(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!doc?.name) continue;
    const key = String(doc.name).toLowerCase();
    if (!poolByName.has(key)) poolByName.set(key, { name: doc.name, packs: new Map() });
    poolByName.get(key).packs.set(pack, { id: doc._id, file: path.join(dir, f) });
  }
}

/** Resolve a catalog name to a pool item, honouring aliases + a category's
 *  preferred pack. Returns {name, pack, id, file} or null. */
const resolvePool = (rawName, category) => {
  const canonical = ALIASES.get(String(rawName).trim().toLowerCase()) ?? rawName;
  const hit = poolByName.get(String(canonical).toLowerCase());
  if (!hit) return null;
  const pref = CATEGORY_PACK[category];
  const pack = pref && hit.packs.has(pref) ? pref : [...hit.packs.keys()][0];
  const { id, file } = hit.packs.get(pack);
  return { name: hit.name, pack, id, file };
};

// ---- patch an existing pool item's YAML: set system.cost, fill empty desc ----
let patched = 0;
const patchPoolItem = (file, cost, description) => {
  let text = fs.readFileSync(file, "utf8");
  const before = text;

  if (/^([ \t]+)cost:[ \t]*.*$/m.test(text)) {
    text = text.replace(/^([ \t]+)cost:[ \t]*.*$/m, `$1cost: ${cost}`);
  } else {
    // No cost line yet (upstream items omit it): add one under `system:`.
    text = text.replace(/^system:[ \t]*$/m, `system:\n  cost: ${cost}`);
  }

  // Only fill a genuinely empty description — never clobber existing prose.
  if (description) {
    text = text.replace(
      /^([ \t]+)description:[ \t]*(''|"")[ \t]*$/m,
      `$1description: '${String(description).replace(/'/g, "''")}'`
    );
  }

  if (text !== before) {
    if (!dry) fs.writeFileSync(file, text, "utf8");
    patched++;
    return true;
  }
  return false;
};

// ---- author a shop-only item ----
// A real weapon/armor belongs with its kin (and stays generation-resolvable), so
// it goes to its type pack; bundles and generic goods go to the dedicated
// market-goods pack. All carry a marketSource marker so re-runs (and barebones.mjs,
// which only wipes its own gearSource docs) never collide.
const BUNDLE = /etc\b/i;                       // "(…, etc.)" → a pick-one bundle
const RENAME_NUDGE = "Rename this to the specific item you are carrying.";
const AUTHOR_DIRS = ["weapons", "armor", "market-goods"];
const authored = [];                           // {name, type, system, id, pack}
const authorMarketItem = (entry) => {
  const isBundle = BUNDLE.test(entry.name);
  const description = isBundle && entry.description
    ? `${entry.description} (${RENAME_NUDGE})`
    : entry.description ?? "";
  const item = buildGearItem({ ...entry, description });
  const pack = item.type === "weapon" ? "weapons" : item.type === "armor" ? "armor" : "market-goods";
  const id = idFor(`air-bladder-market:${item.name}`);
  authored.push({ ...item, id, pack });
  return { id, pack };
};

const authoredYaml = ({ name, type, system, id }) => {
  const s = system;
  const lines = [
    `_id: ${id}`,
    `name: ${y(name)}`,
    `type: ${type}`,
    "img: icons/svg/item-bag.svg",
    "effects: []",
    "folder: null",
    "sort: 0",
    "flags:",
    "  air-bladder:",
    "    marketSource: 2e",
    "system:",
    `  description: ${y(s.description)}`,
    `  weightless: ${s.weightless}`,
    "  equipped: false",
    `  bulky: ${s.bulky}`,
    `  cost: ${s.cost}`,
    "  quantity: 1",
    "  uses:",
    `    value: ${s.uses.value}`,
    `    max: ${s.uses.max}`,
  ];
  if (type === "weapon") lines.push(`  damageFormula: ${y(s.damageFormula)}`, "  criticalDamage: ''", `  blast: ${s.blast}`);
  if (type === "armor") lines.push(`  armor: ${s.armor}`);
  lines.push("ownership:", "  default: 0", "_stats:", "  systemId: air-bladder", "  coreVersion: '14.365'", `_key: '!items!${id}'`, "");
  return lines.join("\n");
};

// ---- serialize a marketplace RollTable of pack results ----
const tableYaml = (category, refs) => {
  const tid = idFor(`air-bladder-market-table:${category}`);
  const results = refs.map((ref, i) => {
    const rid = idFor(`air-bladder-market-result:${category}:${i}:${ref.text}`);
    return [
      `  - _id: ${rid}`,
      "    type: pack",
      `    text: ${y(ref.text)}`,
      "    img: icons/svg/item-bag.svg",
      "    weight: 1",
      "    range:",
      `      - ${i + 1}`,
      `      - ${i + 1}`,
      "    drawn: false",
      `    documentCollection: ${ref.documentCollection}`,
      `    documentId: ${ref.documentId}`,
      "    flags: {}",
      `    _key: '!tables.results!${tid}.${rid}'`,
    ].join("\n");
  });
  return [
    `_id: ${tid}`,
    `name: ${y(`Market: ${category}`)}`,
    "img: icons/svg/d20-grey.svg",
    `description: ${y(`Air Bladder marketplace — ${category}. Drag an item in to stock it; prices are read off the item.`)}`,
    "results:",
    ...results,
    `formula: 1d${Math.max(refs.length, 1)}`,
    "replacement: true",
    "displayRoll: true",
    "flags: {}",
    "folder: null",
    "sort: 0",
    "ownership:",
    "  default: 0",
    "_stats:",
    "  systemId: air-bladder",
    "  coreVersion: '14.365'",
    `_key: '!tables!${tid}'`,
    "",
  ].join("\n");
};

// ================= run =================
const byCategory = await buildCatalog();

const marketDir = path.join(root, "src", "packs", "marketplace");
if (!dry) {
  // The tables dir is ours entirely — wipe it whole. In the author dirs (which
  // also hold the rest of the pool) wipe only our marketSource files.
  fs.mkdirSync(marketDir, { recursive: true });
  for (const f of fs.readdirSync(marketDir).filter((f) => f.endsWith(".yml"))) fs.rmSync(path.join(marketDir, f));
  for (const d of AUTHOR_DIRS) {
    const dir = path.join(root, "src", "packs", d);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
      if (fs.readFileSync(path.join(dir, f), "utf8").includes("marketSource: 2e")) fs.rmSync(path.join(dir, f));
    }
  }
}

const perCategory = {};
const tables = [];
for (const category of CATEGORY_ORDER) {
  const items = byCategory.get(category) ?? [];
  const refs = [];
  for (const entry of items) {
    const pool = resolvePool(entry.name, category);
    if (pool) {
      patchPoolItem(pool.file, entry.cost ?? 0, entry.description);
      refs.push({ text: pool.name, documentCollection: `air-bladder.${pool.pack}`, documentId: pool.id });
    } else {
      const { id, pack } = authorMarketItem(entry);
      refs.push({ text: entry.name, documentCollection: `air-bladder.${pack}`, documentId: id });
    }
  }
  perCategory[category] = { total: items.length, refs: refs.length };
  tables.push({ category, refs });
}

if (!dry) {
  for (const { category, refs } of tables) {
    fs.writeFileSync(path.join(marketDir, `Market_${category}.yml`), tableYaml(category, refs), "utf8");
  }
  for (const g of [...authored].sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${g.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${g.id}.yml`;
    fs.writeFileSync(path.join(root, "src", "packs", g.pack, file), authoredYaml(g), "utf8");
  }
}

// ---- report ----
console.log(`${dry ? "[dry] " : ""}marketplace catalog:`);
for (const c of CATEGORY_ORDER) console.log(`   ${c.padEnd(10)} ${perCategory[c].refs}/${perCategory[c].total} referenced`);
console.log(`\n${dry ? "would patch" : "patched"} ${patched} pool item(s) with cost/description`);
console.log(`${dry ? "would author" : "authored"} ${authored.length} shop-only item(s):`);
for (const g of [...authored].sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`   ${(BUNDLE.test(g.name) ? "bundle" : "single").padEnd(6)} → ${g.pack.padEnd(13)} ${g.name} [${g.type}] ${g.system.cost}gp`);
}
console.log(`\n${dry ? "would write" : "wrote"} ${tables.length} marketplace tables${dry ? "" : `; next: npm run build:packs (stop Foundry first)`}`);

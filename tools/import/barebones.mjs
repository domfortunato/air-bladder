#!/usr/bin/env node
/**
 * Author the Cairn Barebones content source: its gear, its 100 backgrounds, and
 * the three tables its creation procedure rolls on.
 *
 *   node tools/import/barebones.mjs [--dry]
 *
 * Barebones and 2e are ONE system that differ only in how a character is made
 * (see CLAUDE.md / the one-system-two-generators note), so this authors no
 * parallel universe: Barebones gear goes into the SAME editable type packs 2e
 * uses, and a Barebones background is the SAME `background` Item type — it simply
 * leaves the richer 2e fields (archetype, names, choice tables) empty.
 *
 * Three jobs, in order:
 *
 *   1. GEAR. Every distinct item the Barebones tables name, authored into the
 *      canonical type packs if the pool has no such item yet. Aliases and
 *      already-present names are skipped, so this adds only what is genuinely
 *      missing (~48 of 126).
 *
 *   2. BACKGROUNDS. The d100 table becomes 100 `background` documents in
 *      `backgrounds-barebones`, each holding its 3 items as BY-NAME references
 *      into that pool — never inlined records. Two of them (Merchant's wagon,
 *      Peddler's cart) grant a transport, which is a container Actor, so those
 *      ride in `system.containers` instead.
 *
 *   3. TABLES. The armor, weapon and additional-gear steps become RollTables in
 *      `tables-barebones` whose results REFERENCE pool items, so a Warden restocks
 *      a table by dragging an item in or out:
 *        Barebones: Creation - Armor      d6, 1 = "None" (text), 2-6 = armor
 *        Barebones: Creation - Weapon     d6, 1-3 = a damage tier, 4-6 = a weapon
 *        Barebones: Weapon Tier - d6|d8|d10   the three tier tables
 *        Barebones: Creation - Additional Gear  d100
 *      Rows the SRD writes as an instruction rather than an item ("Random
 *      Spellbook", "Scroll of Random Spellbook") stay TEXT results; the generator
 *      resolves those against the spellbook packs.
 *
 * Source: the Cairn SRD itself, fetched live —
 *   barebones/rules/barebones-character-creation.md (yochaigal/cairn)
 * which holds all four tables this needs: the d100 backgrounds, the d6 armor and
 * weapon steps, and the d100 additional gear. Parsed here rather than read from a
 * checked-in JSON so a rerun surfaces upstream changes instead of freezing a
 * snapshot. (It previously read the fork's module/barebones-*.json; that copy was
 * verified to be a faithful parse — this parser reproduces it with zero
 * differences across all four structures — so the switch changed provenance, not
 * content.)
 *
 * Idempotent: authored gear carries flags.air-bladder.gearSource: barebones and
 * is wiped before each run; the two new pack dirs are ours entirely and are
 * rewritten whole. Every id is name-hashed, so a rerun is byte-identical.
 *
 * Run order: THIS -> marketplace.mjs -> transports.mjs.
 * This must precede marketplace.mjs: the shop authors a near-duplicate of any
 * item it cannot find in the pool, so the Barebones gear has to be there first
 * or the shop stocks its own "Sewing kit" beside the real "Sewing Kit". It reads
 * the transports pack (for the Cart/Wagon rows), which is checked in, so running
 * before transports.mjs is fine except on a from-nothing rebuild -- in which case
 * rerun this afterwards.
 *
 * Game text: CC BY-SA 4.0, Yochai Gal (attribution required; see README).
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

const SRC = "https://raw.githubusercontent.com/yochaigal/cairn/main/barebones/rules/barebones-character-creation.md";

const TARGET_PACKS = ["armor", "weapons", "tools", "trinkets", "expeditionary-gear", "extra"];
const BG_PACK = "backgrounds-barebones";
const TABLE_PACK = "tables-barebones";
const packDir = (p) => path.join(root, "src", "packs", p);

// KEEP IN SYNC with module/gear.js GEAR_ALIASES. Authoring skips these names, so
// the resolver must carry the identical map or the grant will not resolve.
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
  // The shop's tent IS the pool's tent: the barebones item is already bulky
  // with "fits 2" as its description. Without this the shop cannot see it and
  // authors a second, identical tent as a market-only good.
  ["tent (fits 2)", "Tent"],
]);

// Rows that are an instruction to roll elsewhere, not an item. See CLAUDE.md —
// importing these naively authors three nonsense items nobody notices until
// someone rolls Acolyte.
const META = new Set([
  "spellbook", "random spellbook", "scroll of random spellbook", "random additional gear",
]);

// A thing with its own slots is a container Actor, never an embedded item, so
// these route to the transports pack instead of being authored as gear.
const TRANSPORTS = new Map([["cart", "Cart"], ["wagon", "Wagon"]]);

/* ------------------------------------------------------------------ helpers */

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const idFor = (seed) => [...crypto.createHash("sha256").update(seed).digest().subarray(0, 16)]
  .map((b) => ALPHA[b % ALPHA.length]).join("");

const y = (s) => {
  const str = String(s);
  if (str === "") return "''";
  if (/[:#{}\[\],&*?|<>=!%@`'"]/.test(str) || /^\s|\s$/.test(str) || /^[-?]/.test(str)) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return str;
};
const fileFor = (name, id) => `${name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${id}.yml`;

/** Byte-identical to module/gear.js buildGearItem (Node cannot import that
 *  browser module). KEEP IN SYNC — marketplace.mjs carries the same copy. */
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

/** Categorization for a newly authored item — which type pack it belongs in. */
const EXTRA = /\b(homunculus|mimic stone|living nightmare|raven familiar|carrion cat|glowsnail|hawk|mischievous spirit|ivy worm|dream stone|briar thorn|heartseed|paper legs|whiskerwort|lodestone|voidglass|single gem|cursed sapphire|fake jewels|golem|effigy|familiar)\b/i;
const TRINKET = /\b(locket|ring|amulet|necklace|bracelet|gem|prism|crest|badge|\bpin\b|book|journal|ledger|letter|map|storybook|lute|fiddle|violin|flute|instrument|harp|mask|cards|costume|hat|portrait|feather|quill|seal|twig|flower|charm|luck|rabbit|dice|jewel|puppet|theatre|tale|treatise|symphony|waltz|paint|perfume|soap|whistle|bell|prayer|vestment|habit|uniform|apron|outfit|cane|cuff|sketch|thesaurus|astronomy)\b/i;
const TOOL = /\b(hammer|tongs|pincers|pail|pot|pots|bucket|bellows|drill|file|chisel|shovel|sextant|stylus|whetstone|trowel|awl|roll of tin|ingot|screwdriver|pump|paste|grease|solvent|glue|tinker|sealant|nails|spike|wire|ladder|net)\b/i;
const categorize = (item) => {
  if (item.type === "weapon") return "weapons";
  if (item.type === "armor") return "armor";
  const n = item.name.toLowerCase();
  if (EXTRA.test(n)) return "extra";
  if (TRINKET.test(n)) return "trinkets";
  if (TOOL.test(n)) return "tools";
  return "expeditionary-gear";
};

/** A Barebones gear entry -> the record buildGearItem consumes. A short table
 *  note ("10ft", "dim") is the item's whole description.
 *
 *  The damage/armor tags matter more than they look: they are what buildGearItem
 *  infers an item's TYPE from. Without a damage tag a weapon is authored as a
 *  plain `item`, which looks harmless in the pack and then quietly breaks the
 *  game — the sheet gives it no damage roll, and generation cannot equip it,
 *  because both select on type. Only the weapon and armor TABLES carry these; the
 *  d100 background and additional-gear rows name ordinary goods. */
const entryToRecord = (g) => {
  const tags = [];
  if (g.petty) tags.push("petty");
  if (g.bulky) tags.push("bulky");
  if (g.damage) tags.push(g.damage);
  if (g.armor) tags.push(`${g.armor} Armor`);
  return { name: String(g.name).trim(), tags, uses: g.uses || 0, description: (g.notes ?? []).join(", ") };
};

/* --------------------------------------------------------------- parse SRD */

const res = await fetch(SRC);
if (!res.ok) throw new Error(`fetch ${SRC}: HTTP ${res.status}`);
const md = await res.text();

/** Rows of the first markdown table after `heading`, minus rule and spacer rows. */
const tableAfter = (heading) => {
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
    rows.push(cells);
  }
  return rows;
};

/** `[Spellbook](/x)` -> `Spellbook`; `**Bold**` -> `Bold`. */
const plain = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").trim();

/** Only the numbered rows, so a `| d100 | Gear |` header cannot shift every roll. */
const numbered = (rows) => rows.filter((r) => /^\d+$/.test(plain(r[0])));

/** Split on commas that are NOT inside parentheses ("Candle (3 uses, dim)"). */
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
 * One SRD gear phrase -> the record the rest of this script consumes.
 * Every parenthetical is a bag of comma-separated qualifiers; the recognised
 * ones become fields and the remainder is prose kept as the item's description
 * ("dim", "10ft", "restores 1 STR").
 */
const parseGear = (raw) => {
  let s = plain(raw);
  const g = { name: "", petty: false, bulky: false, uses: 0, notes: [] };
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => {
    for (const q of splitTop(inner)) {
      const t = q.replace(/_/g, "").trim();
      let m;
      if (/^petty$/i.test(t)) g.petty = true;
      else if (/^bulky$/i.test(t)) g.bulky = true;
      else if ((m = t.match(/^(\d+)\s+uses?$/i))) g.uses = Number(m[1]);
      else if ((m = t.match(/^\+?(\d+)\s+armou?r$/i))) g.armor = Number(m[1]);
      else if ((m = t.match(/^(d\d+)\s+damage$/i))) g.damage = m[1];
      else g.notes.push(t);
    }
    return "";
  });
  g.name = s.replace(/\s{2,}/g, " ").trim().replace(/[.,]$/, "");
  return g;
};

const backgrounds = numbered(tableAfter("## Background")).map((r) => {
  const roll = Number(r[0]);
  const m = r[1].match(/^\*\*(.+?)\*\*:\s*(.*)$/);
  if (!m) throw new Error(`background row ${roll} does not parse: ${r[1]}`);
  return { roll, name: plain(m[1]), gear: splitTop(m[2]).map(parseGear) };
});

const armorRows = numbered(tableAfter("#### Armor (d6)")).map((r) => {
  const g = parseGear(r[1]);
  const roll = Number(plain(r[0]));
  // Row 1 is "None. Roll for Additional Gear" — an instruction, not an item.
  return /^None/i.test(g.name)
    ? { roll, name: "None", additionalGear: true }
    : { roll, name: g.name, armor: g.armor ?? 1, bulky: g.bulky };
});

const weaponRows = numbered(tableAfter("#### Weapons (d6)")).map((r) => {
  const g = parseGear(r[1]);
  // Rows 1-3 list several example weapons of one damage tier; 4-6 name just one.
  return {
    roll: Number(plain(r[0])),
    options: splitTop(g.name).filter((o) => !/^etc\.?$/i.test(o)),
    damage: g.damage,
    bulky: g.bulky,
  };
});

const additional = numbered(tableAfter("#### Additional Gear"))
  .map((r) => ({ roll: Number(plain(r[0])), ...parseGear(r[1]) }));

// Structural guard: positions carry meaning here (a roll number IS an index), so
// a silent parse failure would misalign a whole table rather than error.
const expect = (what, got, want) => {
  if (got !== want) throw new Error(`SRD parse: ${what} = ${got}, expected ${want} — upstream changed shape, check the tables before rerunning`);
};
expect("backgrounds", backgrounds.length, 100);
expect("additional-gear rows", additional.length, 100);
expect("armor rows", armorRows.length, 6);
expect("weapon rows", weaponRows.length, 6);
for (const bg of backgrounds) expect(`${bg.name} gear`, bg.gear.length, 3);
for (const r of weaponRows) if (!r.damage) throw new Error(`weapon row ${r.roll} has no damage tier`);
console.log(`parsed the Barebones SRD: ${backgrounds.length} backgrounds, ${additional.length} gear rows, ${armorRows.length} armor, ${weaponRows.length} weapon`);

// Every gear entry the tables name, merged by lowercased name.
const entries = new Map();
const note = (g) => {
  if (!g?.name) return;
  const key = String(g.name).trim().toLowerCase();
  const prev = entries.get(key);
  if (!prev) { entries.set(key, { ...g }); return; }
  // Divergent copies: keep the most generous reading of each flag.
  prev.petty = prev.petty || g.petty;
  prev.bulky = prev.bulky || g.bulky;
  prev.uses = Math.max(prev.uses ?? 0, g.uses ?? 0);
  prev.damage = prev.damage ?? g.damage;
  prev.armor = prev.armor ?? g.armor;
  if (!(prev.notes ?? []).length && (g.notes ?? []).length) prev.notes = g.notes;
};
for (const bg of backgrounds) for (const g of bg.gear ?? []) note(g);
for (const g of additional) note(g);
// The armor and weapon tables name items too, and they must be in the pool to be
// referenced. Carry each row's damage die / armor value: it is what decides the
// authored item's TYPE, and all but one of these names happens to exist already
// from another source, which is exactly why a missing tag stays invisible. The
// Sickle was the one that did not, and it shipped as a plain `item` — untypeable
// as a weapon, so generation could not equip it.
for (const r of armorRows) if (r.name && r.name !== "None") note({ name: r.name, bulky: r.bulky, armor: r.armor });
for (const r of weaponRows) for (const o of r.options ?? []) note({ name: o, bulky: r.bulky, damage: r.damage });

/* ------------------------------------------------- job 1: author the gear gap */

// Wipe our own prior output first, so the "what exists" scan below cannot see it.
const MARKER = "gearSource: barebones";
let wiped = 0;
for (const p of TARGET_PACKS) {
  const dir = packDir(p);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    const fp = path.join(dir, f);
    if (fs.readFileSync(fp, "utf8").includes(MARKER)) { if (!dry) fs.rmSync(fp); wiped++; }
  }
}

// EXACTLY module/gear.js CANONICAL_GEAR_PACKS. This must not drift: scanning
// more than the resolver searches makes the importer skip authoring an item it
// can see but generation cannot reach, and the grant silently resolves to
// nothing. That is precisely how Sedative and Sewing Kit went missing once.
const POOL_PACKS = ["expeditionary-gear", "tools", "trinkets", "extra", "weapons", "armor", "market-goods"];

/** Every item the RESOLVER can reach, by lowercased name -> {pack, id, img, type}. */
const scanPool = () => {
  const out = new Map();
  const packsRoot = path.join(root, "src", "packs");
  for (const dir of POOL_PACKS) {
    const p = path.join(packsRoot, dir);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p).filter((f) => f.endsWith(".yml"))) {
      const d = load(fs.readFileSync(path.join(p, f), "utf8"));
      if (!d?.name || !d?._id) continue;
      const key = String(d.name).toLowerCase();
      if (!out.has(key)) out.set(key, { pack: dir, id: d._id, img: d.img, type: d.type, name: d.name });
    }
  }
  return out;
};
const pool = scanPool();

const authored = [];
for (const [key, g] of [...entries].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (META.has(key) || TRANSPORTS.has(key) || ALIASES.has(key) || pool.has(key)) continue;
  const item = buildGearItem(entryToRecord(g));
  const pack = categorize(item);
  const id = idFor(`air-bladder-gear-barebones:${item.name}`);
  const s = item.system;
  const lines = [
    `_id: ${id}`, `name: ${y(item.name)}`, `type: ${item.type}`, "img: icons/svg/item-bag.svg",
    "effects: []", "folder: null", "sort: 0",
    "flags:", "  air-bladder:", "    gearSource: barebones",
    "system:", `  description: ${y(s.description)}`, `  weightless: ${s.weightless}`,
    "  equipped: false", `  bulky: ${s.bulky}`, `  cost: ${s.cost}`, "  quantity: 1",
    "  uses:", `    value: ${s.uses.value}`, `    max: ${s.uses.max}`,
  ];
  if (item.type === "weapon") lines.push(`  damageFormula: ${y(s.damageFormula)}`, "  criticalDamage: ''", `  blast: ${s.blast}`);
  if (item.type === "armor") lines.push(`  armor: ${s.armor}`);
  lines.push("ownership:", "  default: 0", "_stats:", "  systemId: air-bladder", "  coreVersion: '14.365'", `_key: '!items!${id}'`, "");
  if (!dry) fs.writeFileSync(path.join(packDir(pack), fileFor(item.name, id)), lines.join("\n"), "utf8");
  authored.push({ name: item.name, pack, type: item.type });
  // Register it as pool immediately rather than rescanning the directory, so a
  // --dry run resolves references against exactly what a real run would write.
  pool.set(key, { pack, id, img: "icons/svg/item-bag.svg", type: item.type, name: item.name });
}

/* ------------------------------------------- job 2: the 100 background docs */

/** Turn a Barebones gear entry into a by-name REFERENCE, or null when it is a
 *  transport (a container Actor) or an instruction the generator resolves. */
const gearRef = (g) => {
  const key = String(g.name).trim().toLowerCase();
  if (TRANSPORTS.has(key)) return null;
  const ref = { name: ALIASES.get(key) ?? String(g.name).trim() };
  if (g.uses) ref.uses = g.uses;
  return ref;
};

const bgYaml = (bg, id) => {
  const refs = (bg.gear ?? []).map(gearRef).filter(Boolean);
  const containers = (bg.gear ?? [])
    .filter((g) => TRANSPORTS.has(String(g.name).trim().toLowerCase()))
    .map((g) => {
      const name = TRANSPORTS.get(String(g.name).trim().toLowerCase());
      // Capacity is written on the SRD row itself, e.g. "+8 slots".
      const slots = Number((g.notes ?? []).join(" ").match(/\+\s*(\d+)\s*slots?/i)?.[1] ?? 0);
      return { name, slots };
    });
  const lines = [
    `_id: ${id}`, `name: ${y(bg.name)}`, "type: background", "img: icons/svg/item-bag.svg",
    "effects: []", "folder: null", `sort: ${bg.roll * 100}`,
    "flags:", "  air-bladder:", "    backgroundSource: barebones", `    roll: ${bg.roll}`,
    "system:",
    "  source: barebones",
    "  archetype: ''",
    // A Barebones background has no prose in the SRD — it is a name and 3 items.
    // The picker builds its one-line summary from startingGear, so nothing here
    // can go stale when a Warden edits the references.
    "  description: ''",
    "  names: []",
    "  startingGear:",
    ...refs.flatMap((r) => [`    - name: ${y(r.name)}`, ...(r.uses ? [`      uses: ${r.uses}`] : [])]),
    ...(containers.length
      ? ["  containers:", ...containers.flatMap((c) => [`    - name: ${y(c.name)}`, `      slots: ${c.slots}`])]
      : ["  containers: []"]),
    "  tables: []",
    "ownership:", "  default: 0",
    "_stats:", "  systemId: air-bladder", "  coreVersion: '14.365'",
    `_key: '!items!${id}'`, "",
  ];
  return { yaml: lines.join("\n"), refs, containers };
};

const bgDir = packDir(BG_PACK);
if (!dry) {
  fs.mkdirSync(bgDir, { recursive: true });
  for (const f of fs.readdirSync(bgDir).filter((f) => f.endsWith(".yml"))) fs.rmSync(path.join(bgDir, f));
}
let refCount = 0;
let containerCount = 0;
const unresolved = [];
for (const bg of backgrounds) {
  const id = idFor(`air-bladder-bg-barebones:${bg.name}`);
  const { yaml: text, refs, containers } = bgYaml(bg, id);
  if (!dry) fs.writeFileSync(path.join(bgDir, fileFor(bg.name, id)), text, "utf8");
  refCount += refs.length;
  containerCount += containers.length;
  for (const r of refs) {
    const key = r.name.toLowerCase();
    if (!META.has(key) && !pool.has(key)) unresolved.push(`${bg.name}: ${r.name}`);
  }
}

/* ------------------------------------------------------ job 3: the RollTables */

/** One RollTable result: a reference to a pool item, or plain text. */
const resultYaml = (tid, i, r) => {
  const rid = idFor(`air-bladder-bb-result:${tid}:${i}:${r.text}`);
  const range = r.range ?? [i + 1, i + 1];
  const lines = [
    `  - _id: ${rid}`,
    `    type: ${r.pack ? "pack" : "text"}`,
    `    text: ${y(r.text)}`,
    `    img: ${y(r.img ?? "icons/svg/item-bag.svg")}`,
    "    weight: 1",
    "    range:", `      - ${range[0]}`, `      - ${range[1]}`,
    "    drawn: false",
  ];
  if (r.pack) lines.push(`    documentCollection: ${r.pack}`, `    documentId: ${r.id}`);
  lines.push("    flags: {}", `    _key: '!tables.results!${tid}.${rid}'`);
  return lines.join("\n");
};

const tableYaml = (name, description, formula, results) => {
  const tid = idFor(`air-bladder-bb-table:${name}`);
  return [
    `_id: ${tid}`,
    `name: ${y(name)}`,
    "img: icons/svg/d20-grey.svg",
    `description: ${y(description)}`,
    "results:",
    ...results.map((r, i) => resultYaml(tid, i, r)),
    `formula: ${formula}`,
    "replacement: true",
    "displayRoll: true",
    "flags:", "  air-bladder:", "    tableSource: barebones",
    "folder: null", "sort: 0",
    "ownership:", "  default: 0",
    "_stats:", "  systemId: air-bladder", "  coreVersion: '14.365'",
    `_key: '!tables!${tid}'`, "",
  ].join("\n");
};

/** A pool reference for a table result, or a text result if the pool lacks it. */
const poolResult = (name, range) => {
  const key = ALIASES.get(String(name).toLowerCase()) ?? String(name);
  const e = pool.get(key.toLowerCase());
  if (!e) { unresolved.push(`table: ${name}`); return { text: String(name), range }; }
  return { text: e.name, img: e.img, pack: `air-bladder.${e.pack}`, id: e.id, range };
};

const tables = [];

// -- armor (d6). Row 1 is "None", which the SRD trades for an extra gear roll.
tables.push({
  name: "Barebones: Creation - Armor",
  description: "Cairn Barebones character creation, step 5. Roll d6 for starting armor; a result of None grants an extra roll on Barebones: Creation - Additional Gear instead. Drag an armor item in to restock a row.",
  formula: "1d6",
  results: armorRows.map((r, i) =>
    r.name === "None" ? { text: "None", img: "icons/svg/cancel.svg", range: [i + 1, i + 1] } : poolResult(r.name, [i + 1, i + 1])),
});

// -- weapons (d6). Rows 1-3 are a tier of several example weapons, so each points
//    at its own table; rows 4-6 are a single weapon apiece.
const TIER_LABEL = { d6: "Barebones: Weapon Tier - d6", d8: "Barebones: Weapon Tier - d8", d10: "Barebones: Weapon Tier - d10" };
const tierRows = weaponRows.filter((r) => (r.options ?? []).length > 1);
for (const row of tierRows) {
  const name = TIER_LABEL[row.damage] ?? `Barebones: Weapon Tier - ${row.damage}`;
  tables.push({
    name,
    description: `Cairn Barebones ${row.damage} weapons. Rolled from Barebones: Creation - Weapon. Damage comes from the item itself, not from this table — edit the weapon to change it.`,
    formula: `1d${row.options.length}`,
    results: row.options.map((o, i) => poolResult(o, [i + 1, i + 1])),
  });
}
tables.push({
  name: "Barebones: Creation - Weapon",
  description: "Cairn Barebones character creation, step 5. Roll d6: 1-3 pick a damage tier (roll that table too), 4-6 are a single weapon. The weapon is granted equipped.",
  formula: "1d6",
  results: weaponRows.map((r, i) => {
    const range = [i + 1, i + 1];
    if ((r.options ?? []).length > 1) {
      const name = TIER_LABEL[r.damage] ?? `Barebones: Weapon Tier - ${r.damage}`;
      return { text: name, img: "icons/svg/d20-grey.svg", pack: `air-bladder.${TABLE_PACK}`, id: idFor(`air-bladder-bb-table:${name}`), range };
    }
    return poolResult(r.options[0], range);
  }),
});

// -- additional gear (d100)
tables.push({
  name: "Barebones: Creation - Additional Gear",
  description: "Cairn Barebones character creation, step 6. Roll d100 for one extra item (twice if your armor roll was None). Reroll duplicates. Two rows are instructions rather than items — the generator resolves those against the spellbook packs.",
  formula: "1d100",
  results: additional.map((g, i) => {
    const key = String(g.name).toLowerCase();
    const range = [g.roll ?? i + 1, g.roll ?? i + 1];
    if (META.has(key)) return { text: g.name, img: "icons/svg/book.svg", range };
    if (TRANSPORTS.has(key)) {
      const nm = TRANSPORTS.get(key);
      // Prefer the TRANSPORT document over the like-named gear item: rolling a
      // cart here should give you a thing with slots, not a 1-slot object.
      const dir = packDir("transports");
      const f = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(`${nm}_`)) : null;
      if (!f) {
        // transports.mjs has not run yet (a from-nothing rebuild). Leave a text
        // row rather than a broken reference; a rerun in order fixes it.
        console.warn(`WARNING: no transport document for "${nm}" — run transports.mjs, then rerun this`);
        return { text: nm, range };
      }
      const t = load(fs.readFileSync(path.join(dir, f), "utf8"));
      return { text: nm, img: t?.img, pack: "air-bladder.transports", id: t?._id, range };
    }
    return poolResult(g.name, range);
  }),
});

const tblDir = packDir(TABLE_PACK);
if (!dry) {
  fs.mkdirSync(tblDir, { recursive: true });
  for (const f of fs.readdirSync(tblDir).filter((f) => f.endsWith(".yml"))) fs.rmSync(path.join(tblDir, f));
  for (const t of tables) {
    const id = idFor(`air-bladder-bb-table:${t.name}`);
    fs.writeFileSync(path.join(tblDir, fileFor(t.name, id)), tableYaml(t.name, t.description, t.formula, t.results), "utf8");
  }
}

/* ------------------------------------------------------------------- report */

const byPack = {};
for (const a of authored) byPack[a.pack] = (byPack[a.pack] ?? 0) + 1;

console.log(`\n${dry ? "[dry] " : ""}wiped ${wiped} prior barebones gear docs`);
console.log(`${dry ? "[dry] would author" : "authored"} ${authored.length} gear items into the shared pool:`);
for (const p of TARGET_PACKS) if (byPack[p]) console.log(`   ${p.padEnd(20)} +${byPack[p]}`);
console.log(`${dry ? "[dry] would write" : "wrote"} ${backgrounds.length} backgrounds -> src/packs/${BG_PACK}/  (${refCount} gear references, ${containerCount} transports)`);
console.log(`${dry ? "[dry] would write" : "wrote"} ${tables.length} tables -> src/packs/${TABLE_PACK}/`);
for (const t of tables) console.log(`   ${t.name.padEnd(32)} ${t.formula.padEnd(6)} ${t.results.length} results`);

if (unresolved.length) {
  console.error(`\nERROR: ${unresolved.length} references do not resolve against the pool:`);
  for (const u of unresolved.slice(0, 40)) console.error(`   ${u}`);
  process.exit(1);
}
console.log(`\nevery reference resolves against the pool.`);

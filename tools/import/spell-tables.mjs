#!/usr/bin/env node
/**
 * Ship the two spell tables: "Spells — Canon (1d100)" over the canon
 * spellbooks pack (into tables-2e) and "Spells — GLOG" over the GLOG pack
 * (into tables-glog).
 *
 *   node tools/import/spell-tables.mjs [--dry]
 *
 * Why shipped at all: the random-spell pool a generated character is dealt
 * from is a DECLARED RollTable (module/config.js characterGenerator2e.spells),
 * resolved world-first like every other generator table with the shipped copy
 * as its fallback — so one must ship for each pool (user ruling 2026-09-14,
 * "exactly the same way as marketplace, bonds, omens"; until then the pool was
 * an index scan over the spell packs and the canon table shipped only for a
 * Warden's own rolls). A Warden makes the pool theirs with "Copy the Spell
 * Tables to this world…" (module/take-over.js), which copies the table in force
 * and every spellbook its rows point at. Rows are `type: document` results
 * whose uuids point INTO the spell packs; this importer regenerates both tables
 * whenever a pack's contents change, alphabetical, `formula: 1d<rows>`.
 *
 * The uuids EMBED THE PACK NAMES: renaming a spell pack would kill every row
 * silently. dev:spell-pool asserts every shipped row of both tables resolves
 * to a spellbook, which is the gate that catches a rename before a user does.
 *
 * Run order: AFTER glog-content.mjs, which wipes tables-glog whole EXCEPT the
 * file this importer owns there (spared by its stable _id). It reads
 * src/packs/spellbooks and spellbooks-glog, which no importer writes after its
 * own run. Idempotent: two files, stable ids, each wiped and
 * rewritten in place; the rest of both packs is untouched. Only spell NAMES
 * appear here (game text CC BY-SA 4.0, Yochai Gal — covered by the existing
 * attribution).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { packUuid } from "./uuid.mjs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const load = yaml.load ?? yaml.safeLoad;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry");

// Same emitters as marketplace.mjs — a bareword-safe scalar quoter and the
// sha-derived 16-char id every generator here uses.
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

/** The table's stable id for one pool. glog-content.mjs derives the GLOG one
 *  from the same seed to spare that file when it wipes tables-glog — derived,
 *  not imported, because importing this script runs it. Change the seed in
 *  both places or not at all. */
const spellTableId = (seed) => idFor(`air-bladder-spell-table:${seed}`);

const MAKE_IT_YOURS = "To make it yours, press Create a Custom Spell Table… on the Rollable Tables sidebar.";

/** One entry per pool: the declaration in module/config.js names the same
 *  pack and table, and dev:spell-pool holds the two in step. */
const TABLES = [
  {
    seed: "canon",
    name: "Spells — Canon (1d100)",
    outDir: "tables-2e",
    sources: ["spellbooks"],
    description: `The canon spell list as a rollable table — one row per spellbook in the Spellbooks compendium, alphabetical. The pool a character is dealt a random spellbook or scroll from. ${MAKE_IT_YOURS}`,
  },
  {
    seed: "glog",
    name: "Spells — GLOG",
    outDir: "tables-glog",
    sources: ["spellbooks-glog"],
    description: `The GLOG spell list as a rollable table — one row per spellscroll in the GLOG Spellscrolls compendium, alphabetical. The pool a character is dealt from while the GLOG Magic hack is on. ${MAKE_IT_YOURS}`,
  },
];

/** Every spellbook in one pack directory: name, id, icon. */
const readPack = (dirName) => {
  const dir = path.join(root, "src", "packs", dirName);
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    const d = load(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!d?.name || !d?._id) continue;
    if (d.type !== "spellbook") continue;   // an unlocked pack accepts anything
    out.push({ name: d.name, id: d._id, img: d.img ?? "icons/svg/book.svg", pack: `air-bladder.${dirName}` });
  }
  return out;
};

for (const spec of TABLES) {
  const spells = spec.sources.flatMap(readPack);
  if (!spells.length) throw new Error(`spell-tables: ${spec.sources.join(" + ")} hold no spellbooks — refusing to write an empty table`);
  spells.sort((a, b) => a.name.localeCompare(b.name));

  // ---- serialize the table, marketplace.mjs's exact emitted shape ----
  const tid = spellTableId(spec.seed);
  const results = spells.map((s, i) => {
    const rid = idFor(`air-bladder-spell-table-row:${spec.seed}:${s.id}`);
    return [
      `  - _id: ${rid}`,
      "    type: document",
      `    name: ${y(s.name)}`,
      `    img: ${y(s.img)}`,
      "    weight: 1",
      "    range:",
      `      - ${i + 1}`,
      `      - ${i + 1}`,
      "    drawn: false",
      `    documentUuid: ${packUuid(s.pack, s.id)}`,
      "    flags: {}",
      `    _key: '!tables.results!${tid}.${rid}'`,
    ].join("\n");
  });
  const table = [
    `_id: ${tid}`,
    `name: ${y(spec.name)}`,
    "img: icons/svg/d20-grey.svg",
    `description: ${y(spec.description)}`,
    "results:",
    ...results,
    `formula: 1d${spells.length}`,
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

  // ---- write, already under extract's <Name>_<id>.yml naming so a later
  // extract does not rename the committed file ----
  const outDir = path.join(root, "src", "packs", spec.outDir);
  const fileName = `${spec.name.replace(/[^A-Za-z0-9]/g, "_")}_${tid}.yml`;
  if (!dry) {
    fs.mkdirSync(outDir, { recursive: true });
    // Wipe any earlier copy of OUR table (matched by stable _id), whatever its
    // file was called — the rest of the pack is someone else's and untouched.
    for (const f of fs.readdirSync(outDir).filter((f) => f.endsWith(".yml"))) {
      const d = load(fs.readFileSync(path.join(outDir, f), "utf8"));
      if (d?._id === tid) fs.rmSync(path.join(outDir, f));
    }
    fs.writeFileSync(path.join(outDir, fileName), table, "utf8");
  }
  console.log(`${dry ? "[dry] would write" : "wrote"} ${spec.outDir}/${fileName}: ${spells.length} rows, formula 1d${spells.length}`);
}
if (!dry) console.log("next: npm run build:packs (stop Foundry first)");

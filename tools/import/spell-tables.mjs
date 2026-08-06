#!/usr/bin/env node
/**
 * Ship "Spells — Canon (1d100)": a RollTable over the canon spellbooks pack.
 *
 *   node tools/import/spell-tables.mjs [--dry]
 *
 * Why shipped at all: a Warden always needs a rollable spell table — a found
 * scroll, a looted library, "what spell was that?" — and Foundry has no
 * dynamic pack-backed table, so the system ships a MAINTAINED snapshot
 * (ruling 2026-08-05: ship tables + a reseed action). Rows are
 * `type: document` results whose uuids point INTO `air-bladder.spellbooks`;
 * this importer regenerates the shipped table whenever the pack's contents
 * change, and the Reseed Spell Table action (module/spell-tables.js) rebuilds
 * a Warden's own WORLD copy from a pack index at the table — same shape, same
 * alphabetical order, so the two agree row-for-row.
 *
 * The uuids EMBED THE PACK NAME: renaming the spellbooks pack would kill
 * every row silently. dev:spell-tables asserts every shipped row resolves,
 * which is the gate that catches a rename before a user does. (`spellbooks`
 * is not being renamed — that is what made this safe to ship now.)
 *
 * Run order: independent — it reads src/packs/spellbooks, which no importer
 * writes. Idempotent: one file, stable ids, wiped and rewritten in place.
 * Only spell NAMES appear here (game text CC BY-SA 4.0, Yochai Gal — covered
 * by the existing attribution).
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

const TABLE_NAME = "Spells — Canon (1d100)";
const SOURCE_PACK = "air-bladder.spellbooks";
const OUT_DIR = path.join(root, "src", "packs", "tables-2e");

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

// ---- read the canon pack: every spellbook's name, id and icon ----
const srcDir = path.join(root, "src", "packs", "spellbooks");
const spells = [];
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith(".yml"))) {
  const d = load(fs.readFileSync(path.join(srcDir, f), "utf8"));
  if (!d?.name || !d?._id) continue;
  if (d.type !== "spellbook") continue;   // an unlocked pack accepts anything
  spells.push({ name: d.name, id: d._id, img: d.img ?? "icons/svg/book.svg" });
}
if (!spells.length) throw new Error("spell-tables: src/packs/spellbooks holds no spellbooks — refusing to write an empty table");
spells.sort((a, b) => a.name.localeCompare(b.name));

// ---- serialize the table, marketplace.mjs's exact emitted shape ----
const tid = idFor(`air-bladder-spell-table:canon`);
const results = spells.map((s, i) => {
  const rid = idFor(`air-bladder-spell-table-row:canon:${s.id}`);
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
    `    documentUuid: ${packUuid(SOURCE_PACK, s.id)}`,
    "    flags: {}",
    `    _key: '!tables.results!${tid}.${rid}'`,
  ].join("\n");
});
const table = [
  `_id: ${tid}`,
  `name: ${y(TABLE_NAME)}`,
  "img: icons/svg/d20-grey.svg",
  `description: ${y("The canon spell list as a rollable table — one row per spellbook in the Spellbooks compendium, alphabetical. To roll on an edited pack, import this table into the world and use the Reseed Spell Table button in the Tables directory.")}`,
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
const fileName = `${TABLE_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${tid}.yml`;
if (!dry) {
  // Wipe any earlier copy of OUR table (matched by stable _id), whatever its
  // file was called — the rest of tables-2e is hand-tended and untouched.
  for (const f of fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".yml"))) {
    const d = load(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
    if (d?._id === tid) fs.rmSync(path.join(OUT_DIR, f));
  }
  fs.writeFileSync(path.join(OUT_DIR, fileName), table, "utf8");
}
console.log(`${dry ? "[dry] would write" : "wrote"} ${fileName}: ${spells.length} rows, formula 1d${spells.length}`);
if (!dry) console.log("next: npm run build:packs (stop Foundry first)");

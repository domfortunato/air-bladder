#!/usr/bin/env node
/**
 * Author `src/packs/reliquary/` from the Cairn 2e SRD's Reliquary (46 relics).
 *
 *   node tools/import/reliquary.mjs [--dry]
 *
 * Fetches live from yochaigal/cairn, so a rerun surfaces upstream changes.
 * Re-runnable and byte-identical: ids are derived from the relic's name, so a
 * second run produces no diff.
 *
 * ## A relic is not a TYPE
 *
 * Every relic is ALSO an ordinary thing — a stone, a sword, a helm, a pair of
 * shoes — so `relic` is a flag on the existing item types rather than a type of
 * its own. The reliquary itself is what settles it: three relics carry weapon
 * damage (A Blade Called Hope d6, Last Breath d6, Mace of the Kingslayer d8) and
 * three grant +1 Armor. A `relic` type would have to re-implement damage rolling,
 * armor summing and equip behaviour for those six. As a flag they keep all of it,
 * and `iconForItem` gives a relic sword the sword art for free.
 *
 * ## "uses" vs "charges" is ONE field plus a condition
 *
 * The distinction looks like two mechanics and is not. Checked across all 46:
 * every relic whose header says "charges" carries a `**Recharge**:` line, every
 * relic whose header says "uses" does not, and NO relic carries both — the
 * equivalence is exact, not approximate. So both land in the existing
 * `system.uses` counter and the difference is whether `system.recharge` is
 * filled; the sheet relabels the counter "Charges" when it is. 17 relics have
 * charges, 17 have uses, and the rest have neither (uses.max 0, the existing
 * "no counter" convention).
 *
 * ## The header grammar is closed
 *
 * Verified against the source rather than assumed — every one of the 46 sections
 * is one description bullet plus an optional Recharge bullet, and the qualifier
 * vocabulary after the name is exactly five forms:
 *
 *   ## <Name>[ (<damage>)][, <N> use(s)|<N> charge(s)][, +<N> Armor][, _petty_][, _bulky_]
 *     - <description>
 *     - **Recharge**: <condition>
 *
 * Anything outside that vocabulary is reported and skipped rather than guessed
 * at, so an upstream edit surfaces instead of silently authoring a wrong item.
 *
 * ## What is deliberately NOT parsed
 *
 * Damage written into a DESCRIPTION rather than the header. Tupshead Crown's
 * horns are "(d6+d6)" mid-sentence; it is authored as plain armor and the horns
 * stay prose. Parsing formulas out of prose is how an importer starts inventing
 * structure, and house style keeps mechanical text as text — the same call that
 * leaves Homunculus Nail's and Sponge Army's statblocks as description instead of
 * spawning Actors.
 *
 * This pack is deliberately NOT in module/gear.js CANONICAL_GEAR_PACKS: relics
 * are Warden-placed, so no background, hireling or marketplace roll can ever
 * hand one out by name.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
// The art comes from the SAME mapping the runtime and item-icons.mjs use, so this
// importer alone produces a finished pack. Emitting a placeholder and relying on a
// later `item-icons.mjs` run is the pipeline-order trap that has bitten this repo
// before: whoever reruns the importer and stops there ships item-bag.svg 46 times.
import { iconForItem } from "../../module/icons.js";

const SRC = "https://raw.githubusercontent.com/yochaigal/cairn/main/second-edition/wardens-guide/reliquary.md";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACK = path.join(ROOT, "src", "packs", "reliquary");
const DRY = process.argv.includes("--dry");

/* ------------------------------------------------------------------ helpers */

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const idFor = (seed) => [...crypto.createHash("sha256").update(seed).digest().subarray(0, 16)]
  .map((b) => ALPHA[b % ALPHA.length]).join("");

/** YAML scalar quoting. Same rules as the other importers. */
const y = (s) => {
  const str = String(s);
  if (str === "") return "''";
  if (/[:#{}\[\],&*?|<>=!%@`'"]/.test(str) || /^\s|\s$/.test(str) || /^[-?]/.test(str)) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return str;
};

const fileFor = (name, id) =>
  `${name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${id}.yml`;

/** Markdown -> plain text, keeping the words. Byte-identical to backgrounds-2e.mjs. */
const plain = (s) =>
  String(s)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/* ------------------------------------------------------------------ parsing */

/**
 * Split a relic header into name + the qualifiers after it.
 * The damage parens attach to the NAME, everything else is comma-separated.
 */
const parseHeader = (header) => {
  const out = { name: "", damage: "", uses: 0, charges: 0, armor: 0, petty: false, bulky: false, unknown: [] };
  // Damage first: it is the only qualifier written in parentheses, and it sits
  // before the comma list, so pulling it out leaves a clean comma split.
  const dmg = header.match(/^([^,(]+?)\s*\(([^)]+)\)/);
  let rest;
  if (dmg) {
    out.name = dmg[1].trim();
    out.damage = dmg[2].trim();
    rest = header.slice(dmg[0].length);
  } else {
    const [first, ...tail] = header.split(",");
    out.name = first.trim();
    rest = tail.length ? `,${tail.join(",")}` : "";
  }
  for (const raw of rest.split(",").map((p) => p.trim()).filter(Boolean)) {
    const q = raw.replace(/^_|_$/g, "").trim();
    let m;
    if ((m = q.match(/^(\d+)\s+uses?$/i))) out.uses = Number(m[1]);
    else if ((m = q.match(/^(\d+)\s+charges?$/i))) out.charges = Number(m[1]);
    else if ((m = q.match(/^\+(\d+)\s+armor$/i))) out.armor = Number(m[1]);
    else if (/^petty$/i.test(q)) out.petty = true;
    else if (/^bulky$/i.test(q)) out.bulky = true;
    else out.unknown.push(raw);
  }
  return out;
};

const res = await fetch(SRC);
if (!res.ok) throw new Error(`could not fetch the Reliquary: ${res.status} ${res.statusText}`);
const md = await res.text();

const sections = md.split(/^## /m).slice(1);
const relics = [];
const problems = [];

for (const section of sections) {
  const [header, ...body] = section.split(/\r?\n/);
  const bullets = body.map((l) => l.trim()).filter((l) => l.startsWith("- "))
    .map((l) => l.replace(/^-\s*/, ""));
  const h = parseHeader(header.trim());

  if (h.unknown.length) problems.push(`${h.name}: unrecognised qualifier(s) ${h.unknown.join(" | ")}`);
  if (!bullets.length) { problems.push(`${h.name}: no description bullet`); continue; }

  const rechargeBullets = bullets.filter((b) => /^\*\*Recharge\*\*/i.test(b));
  const descBullets = bullets.filter((b) => !/^\*\*Recharge\*\*/i.test(b));
  if (descBullets.length !== 1) problems.push(`${h.name}: ${descBullets.length} description bullets, expected 1`);
  if (rechargeBullets.length > 1) problems.push(`${h.name}: ${rechargeBullets.length} Recharge bullets`);
  if (h.uses && h.charges) problems.push(`${h.name}: carries BOTH uses and charges`);
  // The equivalence this whole model rests on. If upstream ever breaks it, the
  // "Charges vs Uses" label stops meaning anything and we want to hear about it.
  if (!!h.charges !== !!rechargeBullets.length) {
    problems.push(`${h.name}: charges/Recharge mismatch (charges ${h.charges || 0}, recharge ${rechargeBullets.length ? "yes" : "no"})`);
  }

  const recharge = rechargeBullets.length
    ? plain(rechargeBullets[0].replace(/^\*\*Recharge\*\*\s*:?\s*/i, ""))
    : "";
  const count = h.uses || h.charges;

  relics.push({
    name: h.name,
    // A relic keeps the type of the thing it IS, so weapon/armor behaviour and
    // art come for free. Only the header decides — never the description.
    type: h.damage ? "weapon" : h.armor ? "armor" : "item",
    description: plain(descBullets[0] ?? ""),
    damage: h.damage,
    armor: h.armor,
    uses: count,
    recharge,
    weightless: h.petty,
    bulky: h.bulky,
  });
}

/* ------------------------------------------------------------------ emitting */

const docYaml = (r) => {
  const id = idFor(`air-bladder-relic:${r.name}`);
  const lines = [
    `_id: ${id}`,
    `name: ${y(r.name)}`,
    `type: ${r.type}`,
    // Keyed on TYPE, which is the payoff of relic-as-a-flag: a relic sword gets
    // the sword, a relic helm the shield, Obliteration Scroll the scroll, with no
    // relic-specific art to invent. Identical to what item-icons.mjs would stamp.
    `img: ${y(iconForItem(r.type, r.name))}`,
    "effects: []",
    "folder: null",
    "sort: 0",
    "flags:",
    "  air-bladder:",
    "    relicSource: srd-2e",
    "system:",
    `  description: ${y(r.description)}`,
    `  weightless: ${r.weightless}`,
    "  equipped: false",
    `  bulky: ${r.bulky}`,
    "  cost: 0",
    "  quantity: 1",
    "  uses:",
    `    value: ${r.uses}`,
    `    max: ${r.uses}`,
    "  relic: true",
    `  recharge: ${y(r.recharge)}`,
  ];
  if (r.type === "weapon") {
    lines.push(`  damageFormula: ${y(r.damage)}`, "  criticalDamage: ''", "  blast: false");
  }
  if (r.type === "armor") lines.push(`  armor: ${r.armor}`);
  lines.push("ownership:", "  default: 0", "_stats:", "  systemId: air-bladder",
    "  coreVersion: '14.365'", `_key: '!items!${id}'`, "");
  return { id, yaml: lines.join("\n") };
};

if (problems.length) {
  console.error(`\n${problems.length} problem(s) parsing the Reliquary:`);
  for (const p of problems) console.error(`  ${p}`);
}

if (!DRY) {
  fs.mkdirSync(PACK, { recursive: true });
  // `clean` rather than merge: the SRD is the whole truth for this pack, so a
  // relic renamed upstream must not leave its old file behind as a second relic.
  for (const f of fs.existsSync(PACK) ? fs.readdirSync(PACK).filter((n) => n.endsWith(".yml")) : []) {
    fs.unlinkSync(path.join(PACK, f));
  }
}

const counts = { weapon: 0, armor: 0, item: 0, charges: 0, uses: 0, none: 0, petty: 0, bulky: 0 };
for (const r of relics) {
  const { id, yaml } = docYaml(r);
  counts[r.type]++;
  if (r.recharge) counts.charges++; else if (r.uses) counts.uses++; else counts.none++;
  if (r.weightless) counts.petty++;
  if (r.bulky) counts.bulky++;
  if (!DRY) fs.writeFileSync(path.join(PACK, fileFor(r.name, id)), yaml, "utf8");
}

const tag = DRY ? "[dry] would write" : "wrote";
console.log(`\n${tag} ${relics.length} relics -> src/packs/reliquary/`);
console.log(`  types      : ${counts.item} item, ${counts.weapon} weapon, ${counts.armor} armor`);
console.log(`  counters   : ${counts.charges} charges (recharge set), ${counts.uses} uses, ${counts.none} neither`);
console.log(`  slots      : ${counts.petty} petty, ${counts.bulky} bulky`);
if (relics.length !== 46) console.log(`  NOTE: expected 46 relics, parsed ${relics.length} — upstream may have changed.`);
console.log(problems.length ? "\nFINISHED WITH PROBLEMS\n" : "\nreliquary import clean\n");
// `process.exitCode`, NOT process.exit(). Exiting explicitly while fetch's
// keep-alive handle is still closing trips a libuv assertion on Windows
// (`!(handle->flags & UV_HANDLE_CLOSING)`) and the process dies with 127 — so a
// clean import reported FAILURE to anything checking the status. Setting the code
// and letting Node drain gives the right answer.
process.exitCode = problems.length ? 1 : 0;

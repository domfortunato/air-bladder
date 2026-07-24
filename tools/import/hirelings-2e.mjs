#!/usr/bin/env node
/**
 * Author the Cairn 2e hirelings catalogue into module/hirelings-2e.json.
 *
 *   node tools/import/hirelings-2e.mjs [--dry]
 *
 * Source: yochaigal/cairn, resources/hirelings.md, CC BY-SA 4.0 by Yochai Gal.
 * Fetched live so this is reproducible and a rerun surfaces upstream changes.
 *
 * The 2e "example hirelings" are twelve full statblocks, not a bare rate table:
 *
 *   ## Veteran Bodyguard (20/day)
 *
 *   6 HP, 2 Armor, 14 STR, 12 DEX, 11 WIL
 *
 *   - Long Sword (d10, _bulky_)
 *   - Helmet (+1 Armor)
 *   - Gambeson (+1 Armor)
 *
 * Each becomes { name, rate, hp, armor, abilities:{STR,DEX,WIL}, gear:[...] }.
 *
 * WHERE THIS DIVERGES FROM THE FORK: gear entries are BY-NAME REFERENCES into
 * the editable gear pool -- { name, uses? } -- not inline {name, tags,
 * description} records. The tags on the SRD line (_petty_, _bulky_, d10,
 * +1 Armor) are what the pool item ALREADY encodes, so re-stating them here
 * would fork the truth: edit the pool's Long Sword and a hireling would still
 * roll the stale inline copy. They are parsed only to VERIFY the reference (see
 * below) and then dropped. `uses` survives as a per-grant override because it is
 * a property of this loadout, not of the item (a hireling carries 3 Rations).
 *
 * Every reference is checked against src/packs at author time -- a name that
 * does not resolve is a hard error, not a silent empty loadout at generation.
 * The gear it names is part of the checked-in pool (see tools/import/README.md);
 * a miss means the pool lost an item, not that an importer needs running.
 *
 * An inline companion in [brackets] (the Animal Handler's Hawk) lives as prose
 * on its pool item, never a spawned Actor -- house style: no statblock
 * automation.
 *
 * Shipped as runtime data alongside portrait-manifest.json; the hireling
 * generator fetches it. No pack, so no build:packs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = "https://raw.githubusercontent.com/yochaigal/cairn/main/resources/hirelings.md";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(root, "module", "hirelings-2e.json");
const dry = process.argv.includes("--dry");

// KEEP IN SYNC with module/gear.js GEAR_ALIASES (and gear-2e.mjs / marketplace.mjs):
// the resolver maps these grant names onto differently-named pool items, so the
// author-time check has to know them or it reports a false miss.
const ALIASES = new Map([
  ["lockpick", "Lockpicks"],
  ["hand drill", "Hand-Drill"],
  ["torches", "Torch"],
  ["rope (25ft)", "Rope"],
  ["chain (10ft)", "Chain, 10ft"],
  ["chains (10ft)", "Chain, 10ft"],
  ["chains", "Chain, 10ft"],
  ["pole (10ft)", "Pole, 10ft"],
  ["plate", "Plate Mail"],
  ["simple instrument (pipes, lute, etc.)", "Instrument"],
  ["simple instruments (pipes, lute, etc.)", "Instrument"],
]);

const res = await fetch(SRC);
if (!res.ok) throw new Error(`fetch ${SRC}: ${res.status}`);
const md = await res.text();

// Parse one "- Foo (tags)" gear line. The tags are parsed ONLY so this script can
// sanity-check the reference (and keep `uses`); they are not emitted -- the pool
// item is the single source of truth for what an item is.
const parseGearLine = (raw) => {
  let s = raw.replace(/^\s*-\s*/, "").trim();
  const br = s.match(/\[(.+)\]\s*$/);
  if (br) s = s.slice(0, br.index).trim();

  const parenContents = [...s.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const name = s.replace(/\([^)]*\)/g, "").replace(/\*/g, "").trim();
  const tokens = parenContents
    .flatMap((p) => p.split(","))
    .map((t) => t.trim().replace(/^_|_$/g, "").trim())
    .filter(Boolean);

  let uses = 0;
  for (const t of tokens) {
    const flat = t.replace(/\s+/g, "");
    if (/^\d+uses?$/i.test(flat)) uses = Number(flat.match(/\d+/)[0]);
  }
  // A reference carries `uses` only when this loadout overrides the pool default.
  return uses ? { name, uses } : { name };
};

// Each hireling is a "## Name (rate)" block: a statline then a "- " gear list.
const blocks = md.split(/\n##\s+/).slice(1);
const hirelings = [];
for (const block of blocks) {
  const lines = block.split("\n");
  const heading = lines[0].trim();
  const name = heading.split("(")[0].replace(/\*/g, "").trim();
  const rate = Number(heading.match(/\((\d+)/)?.[1] ?? 0);
  const statLine = lines.find((l) => /\bHP\b/.test(l) && /\bSTR\b/.test(l));
  if (!statLine) continue; // not a hireling block (defensive)

  const num = (re) => Number(statLine.match(re)?.[1] ?? 0);
  const abilities = { STR: num(/(\d+)\s*STR/i), DEX: num(/(\d+)\s*DEX/i), WIL: num(/(\d+)\s*WIL/i) };
  const gear = lines.filter((l) => /^\s*-\s+/.test(l)).map(parseGearLine).filter((g) => g.name);

  hirelings.push({
    name,
    rate,
    hp: num(/(\d+)\s*HP/i),
    // Derived from the equipped armor pieces; kept for verification only -- the
    // actor recomputes it via calcArmor() from the equipped Gambeson/Helmet.
    armor: num(/(\d+)\s*Armor/i),
    abilities,
    gear,
  });
}

if (hirelings.length !== 12) {
  console.warn(`WARNING: parsed ${hirelings.length} hirelings, expected 12 - has upstream changed?`);
}
for (const h of hirelings) {
  if (!h.hp || !h.abilities.STR || !h.gear.length) {
    console.warn(`WARNING: "${h.name}" looks under-parsed (hp=${h.hp}, STR=${h.abilities.STR}, gear=${h.gear.length})`);
  }
}

// ---- verify every reference resolves against the editable pool ----
const packsRoot = path.join(root, "src", "packs");
const have = new Map();           // lowerName -> pack it lives in
for (const dir of fs.readdirSync(packsRoot)) {
  const p = path.join(packsRoot, dir);
  if (!fs.statSync(p).isDirectory()) continue;
  for (const f of fs.readdirSync(p).filter((f) => f.endsWith(".yml"))) {
    const nm = fs.readFileSync(path.join(p, f), "utf8").match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    if (nm && !have.has(nm.toLowerCase())) have.set(nm.toLowerCase(), dir);
  }
}

const misses = [];
for (const h of hirelings) {
  for (const g of h.gear) {
    const lower = g.name.toLowerCase();
    const target = (ALIASES.get(lower) ?? g.name).toLowerCase();
    if (!have.has(target)) misses.push(`${h.name}: "${g.name}"`);
  }
}
if (misses.length) {
  console.error(`\nERROR: ${misses.length} hireling gear reference(s) do not resolve against src/packs:`);
  for (const m of misses) console.error(`  ${m}`);
  console.error("\nAuthor the missing item into a pool pack, or add an alias to");
  console.error("module/gear.js GEAR_ALIASES and mirror it here.");
  process.exit(1);
}

const refCount = hirelings.reduce((n, h) => n + h.gear.length, 0);
if (!dry) fs.writeFileSync(OUT, JSON.stringify(hirelings, null, 2) + "\n", "utf8");
console.log(`${dry ? "[dry] would write" : "wrote"} ${path.relative(root, OUT)} (${hirelings.length} hirelings, ${refCount} gear references, all resolving)`);
for (const h of hirelings) {
  console.log(`  ${h.name} (${h.rate}/day) - ${h.hp} HP${h.armor ? `, ${h.armor} Armor` : ""}, ` +
    `${h.abilities.STR}/${h.abilities.DEX}/${h.abilities.WIL}, ${h.gear.length} items`);
}

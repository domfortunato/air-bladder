#!/usr/bin/env node
/**
 * Consolidate the "special" background-granted items into one pack.
 *
 * Most gear items are standard kit filed by mechanical type (armor, weapons, …).
 * But the 2e/Barebones backgrounds also grant ~260 distinctive one-off items
 * (Alchemical Sigils, Catring, Twin daggers, Homunculus…) that were scattered
 * across the type packs by their type, cluttering "Armor" with 13 oddments and so
 * on. This relocates every item granted by EXACTLY ONE background (and by nothing
 * standard) into src/packs/background-items/. Generic gear that several
 * backgrounds share (Hammer, Shovel, Short sword…) stays in the type packs.
 *
 * Safe because resolution is BY NAME across CANONICAL_GEAR_PACKS (module/gear.js)
 * and an item's TYPE lives on the item, not the pack — a moved armor item is still
 * armor. background-items MUST be listed in CANONICAL_GEAR_PACKS or grants of the
 * moved items resolve to nothing.
 *
 * This is a POST-IMPORT step, like item-icons.mjs / table-icons.mjs: run it after
 * backgrounds-2e.mjs / barebones.mjs (which re-author gear into the type packs),
 * then `npm run build:packs`. Idempotent — an item already in background-items is
 * left alone, and a stray re-authored duplicate in a type pack is removed in
 * favour of the canonical copy.
 *
 *   node tools/import/background-items.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const YAML = require("js-yaml");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRY = process.argv.includes("--dry");
const PP = (...a) => path.join(ROOT, "src", "packs", ...a);
const readPack = (p) => {
  const dir = PP(p);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".yml"))
    .map((f) => ({ file: path.join(dir, f), base: f, doc: YAML.load(fs.readFileSync(path.join(dir, f), "utf8")) }))
    .filter((e) => e.doc);
};

// The type packs that hold background specials. market-goods is left alone (its
// items are shop stock, never background-only).
const SOURCE_PACKS = ["expeditionary-gear", "tools", "trinkets", "weapons", "armor"];
const DEST = "background-items";

// mirror module/gear.js
const GEAR_ALIASES = new Map([["lockpick","Lockpicks"],["hand drill","Hand-Drill"],["torches","Torch"],["rope (25ft)","Rope"],["chain (10ft)","Chain, 10ft"],["chains (10ft)","Chain, 10ft"],["chains","Chain, 10ft"],["chain","Chain, 10ft"],["pole (10ft)","Pole, 10ft"],["pole","Pole, 10ft"],["plate","Plate Mail"],["simple instrument (pipes, lute, etc.)","Simple Instruments (Pipes, Lute, etc.)"],["boltcutters","Bolt Cutters"],["tent (fits 2)","Tent"]]);
// decode &amp; LAST so a literal "&amp;#039;" doesn't double-unescape into "'".
const decode = (s) => String(s).replace(/&#0?39;/g,"'").replace(/&apos;/g,"'").replace(/&amp;/g,"&");
const spell = (n) => { const s=decode(n).trim(); const m=s.match(/^spellbook\s*\((.+)\)$/i)||s.match(/^scroll\s*\((.+)\)$/i)||s.match(/^(.+?)\s+spellbook$/i); return m?m[1]:null; };
const norm = (n) => { if(n==null) return null; if(spell(n)) return null; const raw=decode(n).trim(); return (GEAR_ALIASES.get(raw.toLowerCase())??raw).toLowerCase(); };

// keep       = names a NON-background consumer references (marketplace, hireling, default gear, alias targets).
// bgSources  = name -> the distinct backgrounds that grant it. "Special" == granted by exactly ONE
//              (the one-off items like Alchemical Sigils); generic gear several backgrounds share
//              (Hammer, Shovel, Short sword) stays in the type packs. Bonds count as one source.
const keep = new Set();
const bgSources = new Map();
const addKeep = (n) => { const k=norm(n); if(k) keep.add(k); };
const addBg = (n, src) => { const k=norm(n); if(!k) return; (bgSources.get(k) ?? bgSources.set(k, new Set()).get(k)).add(src); };

for (const { doc } of readPack("backgrounds-2e")) { for (const g of doc.system?.startingGear ?? []) addBg(g.name, doc.name); for (const t of doc.system?.tables ?? []) for (const o of t.options ?? []) for (const it of o.items ?? []) addBg(it.name, doc.name); }
for (const { doc } of readPack("backgrounds-barebones")) for (const g of doc.system?.startingGear ?? []) addBg(g.name, doc.name);
for (const { doc } of readPack("tables-2e")) for (const r of doc.results ?? []) for (const sc of ["air-bladder","cairn"]) for (const it of r.flags?.[sc]?.items ?? []) addBg(it.name ?? it, "bond");
for (const { doc } of readPack("marketplace")) for (const r of doc.results ?? []) addKeep(r.text);
try { const h = JSON.parse(fs.readFileSync(path.join(ROOT,"module","hirelings-2e.json"),"utf8")); const walk=(o)=>{ if(Array.isArray(o))o.forEach(walk); else if(o&&typeof o==="object"){ if(typeof o.name==="string"&&(o.uses!==undefined||o.tags!==undefined||o.equipped!==undefined))addKeep(o.name); Object.values(o).forEach(walk);} }; walk(h);} catch {}
["Rations","Torch"].forEach(addKeep);
for (const t of GEAR_ALIASES.values()) addKeep(t);

/** A "special" background item: granted by exactly one background, and by nothing standard. */
const isBackgroundItem = (name) => { const k = norm(name); const s = k && bgSources.get(k); return !!s && s.size === 1 && !keep.has(k); };

// ---- relocate --------------------------------------------------------------
const destDir = PP(DEST);
if (!DRY) fs.mkdirSync(destDir, { recursive: true });
const destIds = new Set(readPack(DEST).map((e) => e.doc._id));

// Dedupe on NAME, not on _id.
//
// Gear resolution is by name: module/gear.js walks CANONICAL_GEAR_PACKS and takes
// the first index entry whose name matches. So two documents sharing a name ARE
// duplicates however their ids differ — one of them is unreachable, and it is the
// one in whichever pack comes later, i.e. always the background-items copy.
//
// This used to test `destIds.has(doc._id)`. That worked only while both copies
// descended from the same document. Four items (Acid, Marbles, Iron Tongs,
// Sextant) had been re-authored with FRESH ids, so the id test missed, the move
// branch fired, and the script filed a second copy inside background-items
// itself — turning 17 cross-pack collisions into 4 worse in-pack ones. Measured
// 2026-07-29; the by-id check had left all 17 in place for weeks.
const destByName = new Map(readPack(DEST).map((e) => [String(e.doc.name).toLowerCase(), e]));

// What a player can actually tell apart. Identity and bookkeeping fields (_id,
// _key, _stats, sort, folder) are excluded on purpose: two copies of Acid differ
// only in _id, and reporting that as a content change would cry wolf on every
// run and train the reader to skim past the line that matters.
const contentOf = (d) => JSON.stringify({
  name: d.name, type: d.type, img: d.img, system: d.system, flags: d.flags, effects: d.effects,
});

let moved = 0, deduped = 0;
const byPack = {};
const replaced = [];
for (const pack of SOURCE_PACKS) {
  for (const { file, base, doc } of readPack(pack)) {
    if (!isBackgroundItem(doc.name)) continue;
    const key = String(doc.name).toLowerCase();
    const twin = destByName.get(key);
    if (twin) {
      // Both exist. Keep the SOURCE copy's content and drop the DEST one, then
      // fall through to the move. Deliberately conservative: the source copy is
      // the one that has been WINNING resolution all along (type packs precede
      // background-items in CANONICAL_GEAR_PACKS), so consolidating cannot change
      // what a character is handed. It also happened to be the better document in
      // every observed case -- the DEST copies of Iron Tongs and Sextant had lost
      // their tools.svg class icon to the generic bag, and the DEST Marbles said
      // weightless:true where the SRD's Astrologer line marks no (_petty_).
      if (contentOf(twin.doc) !== contentOf(doc)) replaced.push(doc.name);
      deduped++;
      if (!DRY) fs.rmSync(twin.file);
      destByName.delete(key);
    }
    (byPack[pack] ??= []).push(doc.name);
    moved++;
    destByName.set(key, { file: path.join(destDir, base), base, doc });
    if (!DRY) fs.renameSync(file, path.join(destDir, base));
  }
}

console.log(`\n${DRY ? "[dry] would move" : "moved"}: ${moved} item(s) into src/packs/${DEST}/  |  deduped: ${deduped}`);
for (const [pack, names] of Object.entries(byPack)) console.log(`  from ${pack} (${names.length}): ${names.sort().join(", ")}`);
// Name a dedupe that actually discarded different content, so a silent content
// change can never hide inside a routine "deduped: N".
if (replaced.length) {
  console.log(`  ${DRY ? "would replace" : "replaced"} ${replaced.length} DIFFERING ${DEST} copy(ies) with the type-pack version: ${replaced.sort().join(", ")}`);
}

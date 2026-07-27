#!/usr/bin/env node
/**
 * Extract translatable *content* strings from src/packs/ into per-pack TSV files
 * (tools/i18n/tsv/content-<pack>.tsv), keyed by (namespace, normalized English
 * source) — the same source-string scheme the runtime overlay uses, so a filled
 * cell round-trips straight into lang/content/es.json.
 *
 * This is the authoritative enumeration of "what is translatable content" — the
 * overlay engine (module/i18n-content.js) must translate exactly these fields and
 * leave everything else (slugs, numerics, img, proper names, dice formulae) alone.
 *
 * Offline: reads YAML source of truth only. Never touches runtime or packs/.
 *
 *   node tools/i18n/extract-content.mjs            # → tools/i18n/tsv/
 *   node tools/i18n/extract-content.mjs --out DIR
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, listPacks, readPack, writeTSV, normalizeKey } from "./lib.mjs";

const outArg = process.argv.indexOf("--out");
const OUT = outArg === -1 ? path.join(ROOT, "tools", "i18n", "tsv") : process.argv[outArg + 1];

const langArg = process.argv.indexOf("--lang");
const LANG = langArg === -1 ? "es" : process.argv[langArg + 1];

// Pre-fill the translation column from the existing content overlay so a re-extract after
// a pack edit carries prior translations forward (idempotent, loss-free) rather
// than handing the translator blank cells — mirrors extract-ui.mjs's prefill.
const overlayPath = path.join(ROOT, "lang", "content", `${LANG}.json`);
const OVERLAY = fs.existsSync(overlayPath) ? JSON.parse(fs.readFileSync(overlayPath, "utf8")) : {};
const priorTr = (ns, en) => OVERLAY[ns]?.[normalizeKey(en)] ?? "";

const ACTOR_TYPES = new Set(["character", "npc", "container", "hireling"]);

/**
 * Yield { ns, en, context } for every translatable string in one document.
 * The taxonomy IS the contract with the overlay engine — keep the two in step.
 * A pure generator: no side effects, so the caller owns dedup/collection.
 */
function* stringsFromDoc(doc) {
  const name = doc.name ?? "(unnamed)";

  // RollTable — has a top-level results[] array.
  if (Array.isArray(doc.results)) {
    if (doc.name) yield { ns: "table.name", en: doc.name, context: "table" };
    // A RollTable's `description` is authoring / GM-procedure metadata (marketplace
    // stocking notes, "roll each dungeon cycle", one-line trait-table labels) shown
    // only on Foundry's EDITABLE RollTable config sheet — there is no read-only
    // surface to translate it on without risking a save writing the Spanish back
    // over the English source, and no player ever sees it. Deliberately NOT
    // extracted. Table RESULTS (what players/Wardens read when rolling) ARE, below.
    for (const r of doc.results) {
      const range = Array.isArray(r.range) ? r.range.join("-") : "";
      if (r.text) yield { ns: "table.result", en: r.text, context: `${name} · ${range}`.trim() };
    }
    return;
  }

  // background Item — name/description plus the two d6 choice tables' prose.
  if (doc.type === "background") {
    if (doc.name) yield { ns: "bg.name", en: doc.name, context: "background" };
    if (doc.system?.description) yield { ns: "bg.desc", en: doc.system.description, context: `${name} · description` };
    const tables = doc.system?.tables ?? [];
    for (let ti = 0; ti < tables.length; ti++) {
      const t = tables[ti];
      if (t.question) yield { ns: "bg.question", en: t.question, context: `${name} · question ${ti + 1}` };
      const options = t.options ?? [];
      for (let oi = 0; oi < options.length; oi++) {
        if (options[oi].description) {
          yield { ns: "bg.optionDesc", en: options[oi].description, context: `${name} · Q${ti + 1} opt ${oi + 1}` };
        }
      }
    }
    // system.names[] are in-world proper names — deliberately NOT translated.
    return;
  }

  // Actor (monsters / npc) — name, description, and embedded item name/desc.
  if (ACTOR_TYPES.has(doc.type) || doc.system?.abilities) {
    if (doc.name) yield { ns: "monster.name", en: doc.name, context: "monster" };
    if (doc.system?.description) yield { ns: "monster.desc", en: doc.system.description, context: `${name} · description` };
    for (const it of doc.items ?? []) {
      if (it.name) yield { ns: "monster.itemName", en: it.name, context: `${name} · ${it.name}` };
      if (it.system?.description) yield { ns: "monster.itemDesc", en: it.system.description, context: `${name} · ${it.name} desc` };
    }
    return;
  }

  // Item (gear, weapons, armor, spellbooks, transports, market-goods, background-items).
  if (doc.name) yield { ns: "item.name", en: doc.name, context: doc.type ?? "item" };
  if (doc.system?.description) yield { ns: "item.desc", en: doc.system.description, context: `${name} · description` };
}

let totalRows = 0;
const perPack = [];
// Every current source string's composite key, across ALL packs — used after the
// loop to find overlay translations that no longer match any source (stale).
const currentKeys = new Set();

for (const pack of listPacks()) {
  const map = new Map(); // (ns \0 normalizedEn) → row ; first occurrence keeps its context
  for (const { doc } of readPack(pack)) {
    for (const s of stringsFromDoc(doc)) {
      const k = `${s.ns}\0${normalizeKey(s.en)}`;
      currentKeys.add(k);
      if (!map.has(k)) {
        const tr = priorTr(s.ns, s.en);
        map.set(k, { key: s.ns, context: s.context, en: s.en, tr, notes: "", status: tr && tr !== s.en ? "done" : "todo" });
      }
    }
  }
  const rows = [...map.values()];
  if (!rows.length) continue;
  // Stable order (namespace, then English) so re-extraction never reshuffles.
  rows.sort((a, b) => a.key.localeCompare(b.key) || a.en.localeCompare(b.en));
  writeTSV(path.join(OUT, `content-${pack}.tsv`), rows, LANG);
  perPack.push({ pack, rows: rows.length });
  totalRows += rows.length;
}

// Stale rows: overlay translations whose (ns, normKey) no longer matches any
// current source string (the English drifted, or the doc was removed). Emitted to
// ONE review file because the overlay isn't pack-attributed (a table.result string
// can't be traced back to a single pack). These carry the prior translation so a
// resuming translator can revise rather than lose it; they are read-only — import
// never re-imports content-stale.tsv. en = the normalized old English (best record
// we still have, since the overlay is keyed by the normalized form).
const staleRows = [];
for (const [ns, entries] of Object.entries(OVERLAY)) {
  if (!entries || typeof entries !== "object") continue;
  for (const [normEn, tr] of Object.entries(entries)) {
    if (!currentKeys.has(`${ns}\0${normEn}`)) {
      staleRows.push({ key: ns, context: "stale — source removed or changed", en: normEn, tr, notes: "", status: "stale" });
    }
  }
}
const staleFile = path.join(OUT, "content-stale.tsv");
if (staleRows.length) {
  staleRows.sort((a, b) => a.key.localeCompare(b.key) || a.en.localeCompare(b.en));
  writeTSV(staleFile, staleRows, LANG);
} else if (fs.existsSync(staleFile)) {
  fs.rmSync(staleFile); // no orphans now → don't leave a stale stale-file behind
}

console.log(`\nExtracted ${totalRows} translatable content string(s) → ${path.relative(ROOT, OUT)}/\n`);
for (const { pack, rows } of perPack.sort((a, b) => b.rows - a.rows)) {
  console.log(`   ${String(rows).padStart(5)}  content-${pack}.tsv`);
}
if (staleRows.length) console.log(`\n   ${String(staleRows.length).padStart(5)}  content-stale.tsv  (orphaned translations to revise)`);

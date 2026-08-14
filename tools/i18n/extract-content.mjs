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
import { ROOT, listPacks, readPack, writeTSV, normalizeKey, domSourceKey, guardOverwrite } from "./lib.mjs";
import { stringsFromDoc } from "./content-strings.mjs";

const outArg = process.argv.indexOf("--out");
const OUT = outArg === -1 ? path.join(ROOT, "tools", "i18n", "tsv") : process.argv[outArg + 1];

const langArg = process.argv.indexOf("--lang");
const LANG = langArg === -1 ? "es" : process.argv[langArg + 1];
const FORCE = process.argv.includes("--force");

// Pre-fill the translation column from the existing content overlay so a re-extract after
// a pack edit carries prior translations forward (idempotent, loss-free) rather
// than handing the translator blank cells — mirrors extract-ui.mjs's prefill.
const overlayPath = path.join(ROOT, "lang", "content", `${LANG}.json`);
const OVERLAY = fs.existsSync(overlayPath) ? JSON.parse(fs.readFileSync(overlayPath, "utf8")) : {};

// A second index of the same overlay, keyed by the ENTITY-DECODED form of each
// stored key. Without it the entity re-keying loses work rather than fixing it:
// `stringsFromDoc` now emits the decoded English (what the runtime asks for),
// which no longer matches an overlay key stored as `&mdash;`, so 24 finished
// Spanish strings would come back as blank cells and their old entries would be
// reported stale. Looked up only on a miss, so a normal key never pays for it
// and an exact match always wins.
const DECODED_INDEX = {};
for (const [ns, entries] of Object.entries(OVERLAY)) {
  if (!entries || typeof entries !== "object") continue;
  for (const [k, v] of Object.entries(entries)) {
    const d = normalizeKey(domSourceKey(k));
    if (d !== k) (DECODED_INDEX[ns] ??= {})[d] = v;
  }
}
const priorTr = (ns, en) => {
  const k = normalizeKey(en);
  return OVERLAY[ns]?.[k] ?? DECODED_INDEX[ns]?.[k] ?? "";
};

let totalRows = 0;
const perPack = [];
const pending = []; // [{ file, rows }] — written only after guardOverwrite clears them
// Every current source string's composite key, across ALL packs — used after the
// loop to find overlay translations that no longer match any source (stale).
const currentKeys = new Set();

// NPC careers live in module/npc-careers-2e.json, NOT in a pack — so listPacks
// never saw them and their ~20 names reached no spreadsheet in any language,
// while landing verbatim in the player-facing system.profession field. The
// same silent-absence class as the r.text failure documented above: a corpus
// hole indistinguishable from "there were none". Only `name` is emitted: the
// stat fields are numbers, and the gear lists resolve to pack items already
// covered by item.name. The display surface is the npc sheet's Career input
// (t("npc.career", …) with a sourceOf() reverse map on submit — the stored
// career is a MATCH KEY for the day-rate autofill and reroll exclusion, so it
// must stay English).
{
  const careersPath = path.join(ROOT, "module", "npc-careers-2e.json");
  const careers = JSON.parse(fs.readFileSync(careersPath, "utf8"));
  const map = new Map();
  for (const c of careers) {
    if (!c?.name) continue;
    const k = `npc.career\0${normalizeKey(c.name)}`;
    currentKeys.add(k);
    if (!map.has(k)) {
      const trPrior = priorTr("npc.career", c.name);
      map.set(k, { key: "npc.career", context: "npc career", en: c.name, tr: trPrior, notes: "", status: trPrior && trPrior !== c.name ? "done" : "todo" });
    }
  }
  const rows = [...map.values()].sort((a, b) => a.en.localeCompare(b.en));
  pending.push({ file: path.join(OUT, "content-npc-careers.tsv"), rows });
  perPack.push({ pack: "npc-careers", rows: rows.length });
  totalRows += rows.length;
}

for (const pack of listPacks()) {
  const map = new Map(); // (ns \0 normalizedEn) → row ; first occurrence keeps its context
  for (const { doc } of readPack(pack)) {
    for (const s of stringsFromDoc(doc, pack)) {
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
  // Collected, not written: nothing may hit disk until the overwrite guard has
  // seen every file, or a refusal would leave half the spreadsheets rebuilt.
  pending.push({ file: path.join(OUT, `content-${pack}.tsv`), rows });
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

// A pack full of RollTables that yields no `table.result` rows is this extractor
// having lost the field it reads, not a pack of empty tables — the failure that
// went unnoticed above, where the spreadsheets simply came out short. Refuse to
// write rather than hand a translator a corpus with a hole in it.
const tableResultRows = pending.reduce(
  (n, p) => n + p.rows.filter((r) => r.key === "table.result").length, 0
);
if (!tableResultRows) {
  console.error("no table.result strings were extracted at all — the TableResult row schema "
    + "has moved under this tool, so it is reading nothing rather than finding nothing");
  process.exit(1);
}

// Guard, then write — everything or nothing. content-stale.tsv is deliberately
// NOT guarded: import never reads it, so "unimported work" there is a category
// error, and blocking on it would print advice (`run i18n:import`) that cannot
// clear the block.
guardOverwrite(pending, LANG, FORCE);
for (const { file, rows } of pending) writeTSV(file, rows, LANG);

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

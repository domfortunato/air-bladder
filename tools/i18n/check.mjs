#!/usr/bin/env node
/**
 * i18n release gate. Compares lang/<lang>.json against lang/en.json:
 *   - coverage    : keys in en missing from the translation, or still English
 *   - placeholders: {n}/{name}/… parity for translated keys   → ERROR
 *   - HTML tags   : <p>/<strong>/<a>… parity for translated keys → ERROR
 *   - stale       : keys in the translation but not in en      → warning
 *   - glossary    : (--glossary) a translated key whose en uses a glossary term
 *                   but whose translation lacks the mapped term   → warning (advisory)
 *
 * Exit non-zero on any validation ERROR, or on a coverage gap with --strict.
 * (Coverage gaps alone are non-fatal by default: Foundry falls back to English
 * per key, so a partial translation is shippable — the translator's core promise.)
 *
 *   node tools/i18n/check.mjs [--strict] [--glossary] [--lang es]
 *
 * The glossary is per-locale: tools/i18n/glossary-<lang>.tsv, with the unsuffixed
 * glossary.tsv serving Spanish. No glossary for a locale simply skips that check.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, listPacks, readPack, normalizeKey } from "./lib.mjs";
import { stringsFromDoc } from "./content-strings.mjs";
import { checkPair, flattenLang } from "./validate.mjs";

const STRICT = process.argv.includes("--strict");
const GLOSSARY = process.argv.includes("--glossary");
const langArg = process.argv.indexOf("--lang");
const LANG = langArg === -1 ? "es" : process.argv[langArg + 1];
const load = (f) => flattenLang(JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")));

/**
 * Parse the curated glossary (en·<lang>·kind·source·notes) into {en,es} pairs.
 * Per-locale: glossary-<lang>.tsv, with the unsuffixed glossary.tsv serving
 * Spanish because it predates the tooling being localized. A locale with no
 * glossary yet returns nothing, which skips the drift check rather than failing.
 */
const loadGlossary = () => {
  const perLang = path.join(ROOT, "tools", "i18n", `glossary-${LANG}.tsv`);
  const spanish = path.join(ROOT, "tools", "i18n", "glossary.tsv");
  const p = fs.existsSync(perLang) ? perLang : LANG === "es" ? spanish : perLang;
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  lines.shift(); // header
  return lines
    .map((l) => { const [en, es] = l.split("\t"); return { en: (en ?? "").trim(), es: (es ?? "").trim() }; })
    .filter((g) => g.en && g.es);
};

// Match a term's es form loosely: for words >=6 chars, drop trailing vowels/-s so
// an inflection (Exhausto→exhausta) still counts; shorter terms match exactly.
const esStem = (s) => (s.length >= 6 ? s.replace(/[aeos]+$/i, "") : s).toLowerCase();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const en = load("lang/en.json");
const es = load(`lang/${LANG}.json`);

const missing = [], untranslated = [], stale = [], errors = [];
for (const [k, enVal] of Object.entries(en)) {
  if (!(k in es)) { missing.push(k); continue; }
  if (es[k] === enVal) untranslated.push(k);
  for (const e of checkPair(enVal, es[k])) errors.push(`${k}: ${e}`);
}
for (const k of Object.keys(es)) if (!(k in en)) stale.push(k);

// --glossary: advisory drift check over translated keys only.
const glossaryWarn = [];
if (GLOSSARY) {
  const terms = loadGlossary().map((g) => ({ ...g, re: new RegExp(`\\b${reEsc(g.en)}\\b`, "i"), stem: esStem(g.es) }));
  for (const [k, enVal] of Object.entries(en)) {
    const esVal = es[k];
    if (esVal == null || esVal === enVal) continue; // only actually-translated keys
    const esLower = esVal.toLowerCase();
    for (const t of terms) {
      if (t.re.test(enVal) && !esLower.includes(t.stem)) {
        glossaryWarn.push(`${k}: en uses "${t.en}" → expected "${t.es}"  (es: "${esVal}")`);
      }
    }
  }
}

/* ---- the CONTENT overlay ---------------------------------------------------
 * Everything above compares two interface files key-for-key, which the content
 * overlay cannot be checked against: it is keyed on the ENGLISH SOURCE STRING,
 * so a translation dies not by losing its key but by keeping one nothing asks
 * for any more. `i18n:extract` has always computed that (content-stale.tsv) and
 * has never been a gate — the file is gitignored, and the one tool that wrote it
 * spent two days unable to run at all. Thirty finished Spanish strings shipped
 * dead in that window. So the same computation runs here, where it is read.
 *
 * Three classes, and the split is the point, because only two are defects:
 *
 *   - **quoted**   — the key is a spreadsheet's CSV quoting of a real source
 *     string (wrapped, inner quotes doubled). Always a tooling defect, always
 *     mechanically recoverable.        ERROR
 *   - **moved**    — the same English exists in the source under a DIFFERENT
 *     namespace. A rename or a type move that was never carried through to the
 *     overlay; the value is reusable verbatim.   ERROR
 *   - **dropped**  — the English exists nowhere. Editing English prose orphans
 *     its translation, and CLAUDE.md records that as the expected cost of the
 *     source-string scheme, not as a bug.        warning
 */
const contentPath = path.join(ROOT, "lang", "content", `${LANG}.json`);
const contentOrphans = { quoted: [], moved: [], dropped: [] };
if (fs.existsSync(contentPath)) {
  const overlay = JSON.parse(fs.readFileSync(contentPath, "utf8"));
  const byNs = new Set();      // "ns\0normEn"
  const byText = new Map();    // normEn → Set(ns)
  const add = (ns, enStr) => {
    const k = normalizeKey(enStr);
    byNs.add(`${ns}\0${k}`);
    if (!byText.has(k)) byText.set(k, new Set());
    byText.get(k).add(ns);
  };
  for (const pack of listPacks()) {
    for (const { doc } of readPack(pack)) for (const s of stringsFromDoc(doc)) add(s.ns, s.en);
  }
  // Careers live in a module JSON, not a pack — same exception extract makes.
  for (const c of JSON.parse(fs.readFileSync(path.join(ROOT, "module", "npc-careers-2e.json"), "utf8"))) {
    if (c?.name) add("npc.career", c.name);
  }
  const unquoted = (s) => (/^".*"$/s.test(s) && s.includes('""')
    ? s.slice(1, -1).replace(/""/g, '"') : null);
  for (const [ns, entries] of Object.entries(overlay)) {
    if (!entries || typeof entries !== "object") continue;
    for (const normEn of Object.keys(entries)) {
      if (byNs.has(`${ns}\0${normEn}`)) continue;
      const u = unquoted(normEn);
      if (u && byNs.has(`${ns}\0${normalizeKey(u)}`)) {
        contentOrphans.quoted.push(`${ns}: ${normEn.slice(0, 70)}…`);
      } else if (byText.has(normEn)) {
        contentOrphans.moved.push(`${ns} → ${[...byText.get(normEn)].join("/")}: ${normEn.slice(0, 60)}`);
      } else {
        contentOrphans.dropped.push(`${ns}: ${normEn.slice(0, 70)}`);
      }
    }
  }
  const bad = contentOrphans.quoted.length + contentOrphans.moved.length;
  for (const e of [...contentOrphans.quoted, ...contentOrphans.moved]) errors.push(`content overlay — ${e}`);
  console.log(`\nlang/content/${LANG}.json vs src/packs/`);
  console.log(`  entries     : ${Object.values(overlay).reduce((n, e) => n + Object.keys(e ?? {}).length, 0)}`);
  console.log(`  CSV-quoted  : ${contentOrphans.quoted.length}   (spreadsheet mangling — re-run i18n:import)`);
  console.log(`  moved ns    : ${contentOrphans.moved.length}   (re-key, do not retranslate)`);
  console.log(`  source gone : ${contentOrphans.dropped.length}   (English edited or removed — advisory)`);
  if (contentOrphans.dropped.length) {
    for (const w of contentOrphans.dropped.slice(0, 10)) console.log(`     ! ${w}`);
    if (contentOrphans.dropped.length > 10) console.log(`     … and ${contentOrphans.dropped.length - 10} more`);
  }
  if (!bad) console.log("  ok - every translation is keyed to a string the runtime still asks for");
}

/* --- every language file must survive Foundry's own loader ---------------- */

// Foundry expands dotted keys into nested objects when it loads a language file
// (`expandObject`), so `"CAIRN.NUses"` holding a STRING and `"CAIRN.NUses.one"`
// in the same file collide: the loader throws "Cannot create property 'one' on
// string" and abandons the WHOLE file. A world then starts with no interface
// strings at all — every label a raw key — from one added line.
//
// Nothing here modelled the loader before, because nothing needed to: this is
// only reachable once a key gains a child, which plural forms are the first
// thing to want. Found by a probe's console-error watch, which is a long way
// round for a defect an offline read can see.
const collisionsIn = (file) => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  const strings = new Set();
  const parents = new Map();          // prefix -> the key that needs it to be an object
  const visit = (obj, base = "") => {
    for (const [k, v] of Object.entries(obj)) {
      const full = `${base}${k}`;
      if (v && typeof v === "object") { visit(v, `${full}.`); continue; }
      strings.add(full);
      const parts = full.split(".");
      for (let i = 1; i < parts.length; i++) parents.set(parts.slice(0, i).join("."), full);
    }
  };
  visit(raw);
  return [...parents].filter(([p]) => strings.has(p))
    .map(([p, child]) => `${file}: "${p}" is a string AND the parent of "${child}" — the loader drops the whole file`);
};

for (const f of fs.readdirSync(path.join(ROOT, "lang")).filter((f) => f.endsWith(".json"))) {
  for (const e of collisionsIn(`lang/${f}`)) errors.push(e);
}

const enCount = Object.keys(en).length;
const translated = enCount - missing.length - untranslated.length;
const pct = Math.round((translated / enCount) * 100);

console.log(`\nlang/${LANG}.json vs lang/en.json`);
console.log(`  translated  : ${translated}/${enCount}  (${pct}%)`);
console.log(`  missing     : ${missing.length}${missing.length ? `   e.g. ${missing.slice(0, 5).join(", ")}` : ""}`);
console.log(`  ${LANG} == en    : ${untranslated.length}`);
console.log(`  stale       : ${stale.length}${stale.length ? `   e.g. ${stale.slice(0, 5).join(", ")}` : ""}`);

if (errors.length) {
  console.log(`\n  x ${errors.length} validation error(s):`);
  for (const e of errors.slice(0, 40)) console.log(`     ${e}`);
  if (errors.length > 40) console.log(`     … and ${errors.length - 40} more`);
} else {
  console.log(`\n  ok - no placeholder/HTML mismatches in translated keys`);
}

if (GLOSSARY) {
  if (glossaryWarn.length) {
    console.log(`\n  ! ${glossaryWarn.length} glossary drift warning(s) (advisory):`);
    for (const w of glossaryWarn.slice(0, 40)) console.log(`     ${w}`);
    if (glossaryWarn.length > 40) console.log(`     … and ${glossaryWarn.length - 40} more`);
  } else {
    console.log(`\n  ok - no glossary drift in translated keys`);
  }
}

const coverageBad = STRICT && (missing.length > 0 || untranslated.length > 0);
process.exit(errors.length > 0 || coverageBad ? 1 : 0);

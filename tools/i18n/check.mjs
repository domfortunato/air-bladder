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
import { ROOT } from "./lib.mjs";
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

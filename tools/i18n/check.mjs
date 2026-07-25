#!/usr/bin/env node
/**
 * i18n release gate. Compares lang/es.json against lang/en.json:
 *   - coverage    : keys in en missing from es, or still equal to English
 *   - placeholders: {n}/{name}/… parity for translated keys   → ERROR
 *   - HTML tags   : <p>/<strong>/<a>… parity for translated keys → ERROR
 *   - stale       : keys in es but not in en                   → warning
 *
 * Exit non-zero on any validation ERROR, or on a coverage gap with --strict.
 * (Coverage gaps alone are non-fatal by default: Foundry falls back to English
 * per key, so a partial es.json is shippable — the translator's core promise.)
 *
 *   node tools/i18n/check.mjs [--strict]
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";
import { checkPair, flattenLang } from "./validate.mjs";

const STRICT = process.argv.includes("--strict");
const load = (f) => flattenLang(JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")));

const en = load("lang/en.json");
const es = load("lang/es.json");

const missing = [], untranslated = [], stale = [], errors = [];
for (const [k, enVal] of Object.entries(en)) {
  if (!(k in es)) { missing.push(k); continue; }
  if (es[k] === enVal) untranslated.push(k);
  for (const e of checkPair(enVal, es[k])) errors.push(`${k}: ${e}`);
}
for (const k of Object.keys(es)) if (!(k in en)) stale.push(k);

const enCount = Object.keys(en).length;
const translated = enCount - missing.length - untranslated.length;
const pct = Math.round((translated / enCount) * 100);

console.log(`\nlang/es.json vs lang/en.json`);
console.log(`  translated  : ${translated}/${enCount}  (${pct}%)`);
console.log(`  missing     : ${missing.length}${missing.length ? `   e.g. ${missing.slice(0, 5).join(", ")}` : ""}`);
console.log(`  es == en    : ${untranslated.length}`);
console.log(`  stale       : ${stale.length}${stale.length ? `   e.g. ${stale.slice(0, 5).join(", ")}` : ""}`);

if (errors.length) {
  console.log(`\n  x ${errors.length} validation error(s):`);
  for (const e of errors.slice(0, 40)) console.log(`     ${e}`);
  if (errors.length > 40) console.log(`     … and ${errors.length - 40} more`);
} else {
  console.log(`\n  ok - no placeholder/HTML mismatches in translated keys`);
}

const coverageBad = STRICT && (missing.length > 0 || untranslated.length > 0);
process.exit(errors.length > 0 || coverageBad ? 1 : 0);

#!/usr/bin/env node
/**
 * Import filled translator TSVs back into the shipped JSON:
 *   tools/i18n/tsv/ui.tsv         → lang/<lang>.json          (UI; nested by dotted key)
 *   tools/i18n/tsv/content-*.tsv  → lang/content/<lang>.json  (overlay: {ns:{normKey(en):es}})
 *
 * A validating gate, not a dumb writer. A row with a non-empty `es` is REJECTED
 * (named, counted) when it drops/adds a {placeholder}, changes the HTML tag
 * multiset, or mangles an @Enricher[target]; a row marked status=done with an
 * empty es is also an error. Clean rows are MERGED onto the existing JSON — never
 * replacing it — so importing a partial TSV only updates the rows it carries and
 * never deletes prior work. Empty-es rows are skipped (English fallback, the
 * translator's core promise). It WARNS (does not block) when es == en (untranslated
 * or an intentional proper noun) or when es drops a trailing space / em-dash that
 * en carries — the "Spellbook — " trap.
 *
 * Exits non-zero if any row was rejected, so it can gate a release.
 *
 *   node tools/i18n/import-i18n.mjs [--dry] [--lang es] [--tsv DIR]
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readTSV, normalizeKey } from "./lib.mjs";
import { checkPair } from "./validate.mjs";

const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : process.argv[i + 1];
};
const DRY = process.argv.includes("--dry");
const LANG = argVal("--lang", "es");
const TSV_DIR = argVal("--tsv", path.join(ROOT, "tools", "i18n", "tsv"));

const UI_JSON = path.join(ROOT, "lang", `${LANG}.json`);
const CONTENT_JSON = path.join(ROOT, "lang", "content", `${LANG}.json`);

const loadJSON = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {});

/** Set obj.a.b.c = val, creating intermediate objects. Preserves existing keys/order. */
const setDeep = (obj, dotted, val) => {
  const parts = dotted.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null || typeof o[parts[i]] !== "object") o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = val;
};

/** Recursively sort object keys for a stable, diff-friendly generated file. */
const sortDeep = (o) =>
  o && typeof o === "object" && !Array.isArray(o)
    ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortDeep(o[k])]))
    : o;

/** en carries a trailing space or em-dash that es doesn't → a likely silent drop. */
const trailingTrap = (en, es) =>
  (/\s$/.test(en) && !/\s$/.test(es)) || (/—\s*$/.test(en) && !/—\s*$/.test(es));

const errors = [];
const warnings = [];
let imported = 0;
let skipped = 0; // empty es (todo) — legitimately left to English

// Accumulate into in-memory targets; write once at the end (or not, if --dry).
const ui = loadJSON(UI_JSON);
const content = loadJSON(CONTENT_JSON);

const tsvFiles = fs.existsSync(TSV_DIR)
  ? fs.readdirSync(TSV_DIR).filter((f) => f === "ui.tsv" || (f.startsWith("content-") && f.endsWith(".tsv")))
  : [];

if (!tsvFiles.length) {
  console.error(`No TSVs found in ${path.relative(ROOT, TSV_DIR)} (run \`npm run i18n:extract\` first).`);
  process.exit(1);
}

for (const file of tsvFiles.sort()) {
  const isUI = file === "ui.tsv";
  const rows = readTSV(path.join(TSV_DIR, file));
  for (const row of rows) {
    const { key, en, es, status } = row;
    const where = `${file} · ${isUI ? key : `${key} · "${en.slice(0, 40)}${en.length > 40 ? "…" : ""}"`}`;

    if (!es) {
      if (status === "done") errors.push(`${where}: status=done but es is empty`);
      else skipped++;
      continue;
    }

    const errs = checkPair(en, es);
    if (errs.length) {
      for (const e of errs) errors.push(`${where}: ${e}`);
      continue; // reject the row — don't stage a broken translation
    }

    if (es === en) warnings.push(`${where}: es == en (untranslated, or intentional proper noun)`);
    if (trailingTrap(en, es)) warnings.push(`${where}: es drops a trailing space/em-dash that en carries`);

    if (isUI) setDeep(ui, key, es);
    else {
      (content[key] ??= {})[normalizeKey(en)] = es;
    }
    imported++;
  }
}

// ---- Report ----------------------------------------------------------------
console.log(`\nimport-i18n → ${LANG}  (from ${path.relative(ROOT, TSV_DIR)}/, ${tsvFiles.length} file(s))`);
console.log(`  imported : ${imported}`);
console.log(`  skipped  : ${skipped}   (empty es → English fallback)`);
console.log(`  warnings : ${warnings.length}`);
console.log(`  errors   : ${errors.length}`);

for (const w of warnings.slice(0, 20)) console.log(`   ! ${w}`);
if (warnings.length > 20) console.log(`   … and ${warnings.length - 20} more warning(s)`);

if (errors.length) {
  console.log(`\n  x ${errors.length} rejected row(s):`);
  for (const e of errors.slice(0, 40)) console.log(`     ${e}`);
  if (errors.length > 40) console.log(`     … and ${errors.length - 40} more`);
}

// ---- Write -----------------------------------------------------------------
if (DRY) {
  console.log(`\n  --dry: no files written.`);
} else if (imported > 0) {
  fs.mkdirSync(path.dirname(CONTENT_JSON), { recursive: true });
  fs.writeFileSync(UI_JSON, JSON.stringify(ui, null, 2) + "\n");
  fs.writeFileSync(CONTENT_JSON, JSON.stringify(sortDeep(content), null, 2) + "\n");
  console.log(`\n  wrote ${path.relative(ROOT, UI_JSON)} + ${path.relative(ROOT, CONTENT_JSON)}`);
} else {
  console.log(`\n  nothing to write (no valid translations found).`);
}

process.exit(errors.length > 0 ? 1 : 0);

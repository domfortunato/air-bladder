#!/usr/bin/env node
/**
 * Import filled translator TSVs back into the shipped JSON:
 *   tools/i18n/tsv/ui.tsv         → lang/<lang>.json          (UI; flat dotted keys)
 *   tools/i18n/tsv/content-*.tsv  → lang/content/<lang>.json  (overlay: {ns:{normKey(en):translation}})
 *
 * A validating gate, not a dumb writer. A row with a non-empty translation is
 * REJECTED (named, counted) when it drops/adds a {placeholder}, changes the HTML
 * tag multiset, or mangles an @Enricher[target]; a row marked status=done with an
 * empty translation is also an error. Clean rows are MERGED onto the existing JSON
 * — never replacing it — so importing a partial TSV only updates the rows it
 * carries and never deletes prior work. Untranslated rows are skipped (English
 * fallback, the translator's core promise). It WARNS (does not block) when the
 * translation equals the English (untranslated or an intentional proper noun) or
 * drops a trailing space / em-dash that en carries — the "Spellbook — " trap.
 *
 * The TSV's translation column is named after --lang, so the same tooling serves
 * any locale; readTSV exposes it as `tr` regardless.
 *
 * Exits non-zero if any row was rejected, so it can gate a release.
 *
 *   node tools/i18n/import-i18n.mjs [--dry] [--lang es] [--tsv DIR]
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readTSV, normalizeKey } from "./lib.mjs";
import { checkPair, flattenLang } from "./validate.mjs";
import { loadBaseline, saveBaseline, baselinePath } from "./baseline.mjs";

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
let skipped = 0; // empty translation (todo) — legitimately left to English
let staleIgnored = 0; // status=stale rows — review-only, never re-imported

// Accumulate into in-memory targets; write once at the end (or not, if --dry).
// The UI file (en.json/es.json) is flat dotted keys — with a couple of dotted keys
// whose VALUES are nested groups (CAIRN.Settings, CAIRN.Notify). flattenLang (the
// same flattener extraction uses to build the TSV) collapses those to flat leaf
// keys, so we merge and write ONE uniform shape. Writing nested here instead would
// leave a flat "CAIRN.Foo" key beside a new nested {CAIRN:{Foo}} object; Foundry
// expands both and the group object clobbers its flat siblings — wiping most of the
// translated UI at runtime while i18n:check still reports full coverage.
const ui = flattenLang(loadJSON(UI_JSON));
const content = loadJSON(CONTENT_JSON);
const nextBaseline = loadBaseline(LANG);

// content-stale.tsv is a review-only orphan list (see extract-content.mjs), never
// an import source — re-importing it would re-bloat the JSON with dead keys.
const tsvFiles = fs.existsSync(TSV_DIR)
  ? fs.readdirSync(TSV_DIR).filter((f) => f === "ui.tsv" || (f.startsWith("content-") && f.endsWith(".tsv") && f !== "content-stale.tsv"))
  : [];

if (!tsvFiles.length) {
  console.error(`No TSVs found in ${path.relative(ROOT, TSV_DIR)} (run \`npm run i18n:extract\` first).`);
  process.exit(1);
}

for (const file of tsvFiles.sort()) {
  const isUI = file === "ui.tsv";
  const rows = readTSV(path.join(TSV_DIR, file), LANG);
  for (const row of rows) {
    const { key, en, tr, status } = row;
    const where = `${file} · ${isUI ? key : `${key} · "${en.slice(0, 40)}${en.length > 40 ? "…" : ""}"`}`;

    // Stale rows (orphaned by a source change) are informational only — never write
    // them back, or a removed/renamed key would return to the shipped JSON.
    if (status === "stale") { staleIgnored++; continue; }

    if (!tr) {
      if (status === "done") errors.push(`${where}: status=done but ${LANG} is empty`);
      else skipped++;
      continue;
    }

    const errs = checkPair(en, tr);
    if (errs.length) {
      for (const e of errs) errors.push(`${where}: ${e}`);
      continue; // reject the row — don't stage a broken translation
    }

    if (tr === en) warnings.push(`${where}: ${LANG} == en (untranslated, or intentional proper noun)`);
    if (trailingTrap(en, tr)) warnings.push(`${where}: ${LANG} drops a trailing space/em-dash that en carries`);

    if (isUI) {
      const previous = ui[key];
      ui[key] = tr;
      // Record WHICH English this translation answers to — but ONLY where a human
      // actually wrote something on this round trip.
      //
      // The first version of this advanced the baseline for every accepted row,
      // reasoning that the translator was handed the row with its current English
      // and sent back what they sent back, so they saw it either way. That
      // reasoning has one assumption in it that is not always true: **that a
      // translator was involved at all.** An extract→import pair run purely as a
      // maintenance step has no human in the middle, and on 2026-08-07 exactly one
      // such run silently marked all five DRIFTED keys as verified — erasing the
      // signal the baseline exists to hold, with nobody having read a word of
      // Spanish. It looked like the drift had been dealt with.
      //
      // So the test is an affirmative act, and there are two:
      //   - the translation differs from what the shipped JSON already held, or
      //   - a row that WAS drifted at export time comes back marked `done`, which
      //     is a translator explicitly re-certifying wording they chose to keep.
      // Anything else leaves the baseline alone — including an untouched `done`
      // row, where by definition nothing happened. Failing to clear a real
      // re-verification leaves a row visibly on the list, which someone can act
      // on; falsely clearing one is silent and unrecoverable.
      //
      // `en` is the ROW's, not lang/en.json's, on purpose: those differ exactly
      // when English moved while the TSV was out with the translator, and
      // recording the live value would erase that drift the moment it appeared.
      const wasDrifted = key in nextBaseline && nextBaseline[key] !== en;
      const humanTouched = tr !== previous || (wasDrifted && status === "done");
      // An untranslated row asserts no verification, matching the seeder's rule.
      if (humanTouched && tr !== en) nextBaseline[key] = en;
    } else {
      (content[key] ??= {})[normalizeKey(en)] = tr;
    }
    imported++;
  }
}

// ---- Report ----------------------------------------------------------------
console.log(`\nimport-i18n → ${LANG}  (from ${path.relative(ROOT, TSV_DIR)}/, ${tsvFiles.length} file(s))`);
console.log(`  imported : ${imported}`);
console.log(`  skipped  : ${skipped}   (untranslated → English fallback)`);
if (staleIgnored) console.log(`  stale    : ${staleIgnored}   (review-only, not imported)`);
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
  saveBaseline(LANG, nextBaseline);
  console.log(`\n  wrote ${path.relative(ROOT, UI_JSON)} + ${path.relative(ROOT, CONTENT_JSON)}`);
  console.log(`        ${path.relative(ROOT, baselinePath(LANG))}  (${Object.keys(nextBaseline).length} keys verified against their source English)`);
} else {
  console.log(`\n  nothing to write (no valid translations found).`);
}

process.exit(errors.length > 0 ? 1 : 0);

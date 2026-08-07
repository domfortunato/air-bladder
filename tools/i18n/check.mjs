#!/usr/bin/env node
/**
 * i18n release gate. Compares lang/<lang>.json against lang/en.json:
 *   - coverage    : keys in en missing from the translation, or still English
 *   - placeholders: {n}/{name}/… parity for translated keys   → ERROR
 *   - HTML tags   : <p>/<strong>/<a>… parity for translated keys → ERROR
 *   - stale       : keys in the translation but not in en      → warning
 *   - drifted     : translated, but the ENGLISH VALUE has changed since it was
 *                   translated (tools/i18n/baseline/<lang>.json) — the only
 *                   check here that looks at prose rather than structure, and
 *                   the only one that can see a translation that is WRONG
 *                   rather than missing              → warning, ERROR w/ --strict
 *   - glossary    : (--glossary) a translated key whose en uses a glossary term
 *                   but whose translation lacks the mapped term   → warning (advisory)
 *
 * Exit non-zero on any validation ERROR, or on a coverage gap or value drift
 * with --strict.
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
import { loadBaseline, classifyDrift } from "./baseline.mjs";
import { classifyOverlay } from "./orphans.mjs";

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

/* ---- VALUE drift ----------------------------------------------------------
 * Everything above is structural: is the key there, do the placeholders and
 * tags match. None of it moves when an English VALUE is rewritten under a
 * translation that already exists — the key stays, the placeholders stay, and
 * the translation is now WRONG rather than missing. That is invisible here by
 * construction, and `extract-ui` used to mark exactly those rows `done`.
 *
 * Advisory by default, fatal under --strict, deliberately matching how coverage
 * behaves in this file: the drift is real, but clearing it needs a translator,
 * and a gate that only a third party can turn green is a gate people learn to
 * force. What it must do is be impossible to MISS, which is the part that was
 * actually broken.
 *
 * `unverified` is reported separately rather than folded into either side. A
 * translated key with no baseline entry is not known-good; it is unexamined,
 * and presenting an unexamined key as clean is the shape of the original bug.
 */
const baseline = loadBaseline(LANG);
const { drifted, unverified } = classifyDrift(en, es, baseline);
const noBaseline = Object.keys(baseline).length === 0;

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
 *   - **entity**   — the key differs from a live source string only by HTML
 *     ENTITIES. The runtime looks up `node.innerHTML`, where the browser has
 *     already decoded `&mdash;` to `—`, so a key carrying the entity form is one
 *     nothing can ever ask for. Mechanically recoverable, and the replacement is
 *     printed.                                   ERROR
 *   - **dropped**  — the English exists nowhere. Editing English prose orphans
 *     its translation, and CLAUDE.md records that as the expected cost of the
 *     source-string scheme, not as a bug.        warning
 *
 * `entity` was split out of `dropped` in review #10, and the split is the whole
 * value: 22 finished Spanish strings were sitting in the advisory bucket, which
 * reads as "English was edited, nothing to do" when it actually meant "this
 * translation has never once been displayed".
 */
// The classification itself lives in orphans.mjs — `i18n:handoff` builds the
// translator's document from exactly these classes, and two copies of the rule
// for "why did this key stop being asked for" would drift apart into two
// different answers to the same question.
const entityWarn = [];
const content = classifyOverlay(LANG);
if (content) {
  const { entries: overlayEntries, orphans: contentOrphans } = content;
  const bad = contentOrphans.quoted.length + contentOrphans.moved.length;
  for (const o of contentOrphans.quoted) errors.push(`content overlay — ${o.ns}: ${o.key.slice(0, 70)}…`);
  for (const o of contentOrphans.moved) {
    errors.push(`content overlay — ${o.ns} → ${o.movedTo.join("/")}: ${o.key.slice(0, 60)}`);
  }
  // `entity` is loud but not fatal by default, for the same reason value drift
  // is not: clearing it means writing lang/content/<lang>.json, which belongs to
  // the translator. A gate that can only go green by editing somebody else's
  // file is a gate that gets forced. --strict makes it fatal for a release.
  for (const o of contentOrphans.entity) {
    entityWarn.push(`${o.ns}: ${o.ents.join(" ")} → decode; ${o.key.slice(0, 60)}`);
  }
  console.log(`\nlang/content/${LANG}.json vs src/packs/`);
  console.log(`  entries     : ${overlayEntries}`);
  console.log(`  CSV-quoted  : ${contentOrphans.quoted.length}   (spreadsheet mangling — re-run i18n:import)`);
  console.log(`  moved ns    : ${contentOrphans.moved.length}   (re-key, do not retranslate)`);
  console.log(`  HTML entity : ${contentOrphans.entity.length}   (keyed on &mdash;/&rsquo; the DOM never asks for — these have NEVER been displayed)`);
  if (contentOrphans.entity.length) {
    for (const w of entityWarn.slice(0, 10)) console.log(`     ! ${w}`);
    if (contentOrphans.entity.length > 10) console.log(`     … and ${contentOrphans.entity.length - 10} more`);
    console.log(`     fix: npm run i18n:extract && npm run i18n:import -- --lang ${LANG}`);
    console.log(`          (re-keys them mechanically, keeping every translated value — it WRITES lang/content/${LANG}.json)`);
  }
  if (contentOrphans.entityDup.length) {
    console.log(`  entity residue: ${contentOrphans.entityDup.length}   (already re-keyed; the old entity key is spent and safe to delete)`);
  }
  console.log(`  source gone : ${contentOrphans.dropped.length}   (English edited or removed — advisory)`);
  if (contentOrphans.dropped.length) {
    for (const o of contentOrphans.dropped.slice(0, 10)) console.log(`     ! ${o.ns}: ${o.key.slice(0, 70)}`);
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

// The same loader, a second way to lose a block of strings — and this one is
// currently load-bearing rather than hypothetical.
//
// `#loadTranslationFile` runs the whole file through `expandObject`
// (client/helpers/localization.mjs:368), which walks `Object.entries` in
// INSERTION ORDER and `setProperty`s each key in turn. So a file holding both
// an object-valued `"CAIRN.Notify"` and a dotted `"CAIRN.Notify.LastBackground"`
// merges them — but only if the OBJECT comes first. Reversed, the object write
// lands second and replaces the branch the dotted keys built, taking them with
// it. Verified against the shipped 14.365 helper:
//
//   {"X.G": {a,b}, "X.G.c": 3}  ->  {a, b, c}
//   {"X.G.c": 3, "X.G": {a,b}}  ->  {a, b}          <- c is gone, silently
//
// Both `lang/en.json` and `lang/es.json` are in this shape today and both are
// safe purely by ordering. Nothing enforced that, and nothing would report it:
// the keys simply stop existing, and Foundry falls back to English for them, so
// a Spanish client shows a few English notifications and no error anywhere.
const orderingIn = (file) => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  const top = Object.keys(raw);
  const out = [];
  for (const [i, k] of top.entries()) {
    if (!raw[k] || typeof raw[k] !== "object" || Array.isArray(raw[k])) continue;
    const dotted = top.filter((o) => o.startsWith(`${k}.`));
    if (!dotted.length) continue;
    const firstDotted = Math.min(...dotted.map((o) => top.indexOf(o)));
    if (firstDotted < i) {
      out.push(
        `${file}: "${k}" is an object literal declared AFTER ${dotted.length} dotted "${k}.*" key(s) — ` +
        `expandObject writes the object second and DELETES them (e.g. "${top[firstDotted]}"). ` +
        `Move the object literal above them, or fold them into it.`
      );
    }
  }
  return out;
};

for (const f of fs.readdirSync(path.join(ROOT, "lang")).filter((f) => f.endsWith(".json"))) {
  for (const e of collisionsIn(`lang/${f}`)) errors.push(e);
  for (const e of orderingIn(`lang/${f}`)) errors.push(e);
}

const enCount = Object.keys(en).length;
const translated = enCount - missing.length - untranslated.length;
const pct = Math.round((translated / enCount) * 100);

console.log(`\nlang/${LANG}.json vs lang/en.json`);
console.log(`  translated  : ${translated}/${enCount}  (${pct}%)`);
console.log(`  missing     : ${missing.length}${missing.length ? `   e.g. ${missing.slice(0, 5).join(", ")}` : ""}`);
console.log(`  ${LANG} == en    : ${untranslated.length}`);
console.log(`  stale       : ${stale.length}${stale.length ? `   e.g. ${stale.slice(0, 5).join(", ")}` : ""}`);
if (noBaseline) {
  console.log(`  drifted     : ?   no tools/i18n/baseline/${LANG}.json — run \`npm run i18n:baseline -- --lang ${LANG}\``);
} else {
  console.log(`  drifted     : ${drifted.length}   (translated, but the English changed underneath — the translation is WRONG, not missing)`);
  for (const k of drifted) console.log(`     ! ${k}`);
  if (unverified.length) {
    console.log(`  unverified  : ${unverified.length}   (translated with no baseline entry — nothing known about their source English)`);
  }
}

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
const driftBad = STRICT && (drifted.length > 0 || entityWarn.length > 0);
process.exit(errors.length > 0 || coverageBad || driftBad ? 1 : 0);

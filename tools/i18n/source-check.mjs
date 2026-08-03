#!/usr/bin/env node
/**
 * i18n SOURCE gate — compares the code to lang/en.json.
 *
 * `i18n:check` compares language files *to each other*, which makes it
 * structurally blind to the one thing a translator can never fix: a string that
 * was never routed through `game.i18n` at all. Such a string is identical in
 * en.json and es.json — because it is in neither. That blindness is how
 * `title="Double click to change limit"` shipped, the only hint the
 * double-click-to-set-equipment-limit feature exists.
 *
 * Three classes, all checkable offline:
 *
 *   missing    a key referenced by module/ or templates/ that en.json lacks.
 *              Foundry renders the raw key, so the user sees "CAIRN.Whatever".
 *   unused     a key in en.json that nothing references. Dead weight a
 *              translator is nonetheless asked to translate.
 *   hardcoded  user-visible English in module/ or templates/ that never passes
 *              through game.i18n. Untranslatable by construction.
 *
 * All three are errors. A warning that is permanently non-zero is a gate nobody
 * reads, which is the failure mode this file exists to correct.
 *
 *   node tools/i18n/source-check.mjs [--verbose]
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";

const VERBOSE = process.argv.includes("--verbose");

const walk = (dir, ext, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
};

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const lineOf = (src, i) => src.slice(0, i).split("\n").length;

const flattenKeys = (o, prefix = "") =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

const JS_FILES = walk(path.join(ROOT, "module"), /\.js$/);
const TPL_FILES = walk(path.join(ROOT, "templates"), /\.(html|hbs)$/);

// ---------------------------------------------------------------------------
// Keys referenced by the code
// ---------------------------------------------------------------------------

/**
 * Namespaces Foundry resolves itself, from data rather than from a call site.
 * `TYPES.<Document>.<type>` is looked up by core whenever it names a document
 * type (the create dialog, sheet headers, the sidebar), so no literal appears
 * in our source and "unused" would be wrong for every one of them.
 */
const CORE_RESOLVED = [/^TYPES\./];

/** Literal keys, plus the PREFIXES of keys built by interpolation. */
const collectKeys = () => {
  const used = new Map(); // key -> "file:line" of its first use
  const prefixes = new Map(); // dynamic prefix -> "file:line"
  const suffixes = new Map(); // dynamic suffix -> "file:line"
  const note = (map, k, site) => { if (!map.has(k)) map.set(k, site); };

  for (const f of [...JS_FILES, ...TPL_FILES]) {
    let src = fs.readFileSync(f, "utf8");
    // Strip JS BLOCK comments before scanning (newline-preserving, so the
    // recorded line numbers hold). A JSDoc that QUOTES a key otherwise counts
    // as a use: actor.js documents its old concatenation as
    // `localize("CAIRN.Owner") + ...`, and that mention alone kept CAIRN.Owner
    // looking referenced while it sat orphaned in all 7 locales (review #5).
    // Line comments are left alone deliberately — `//` also begins every URL
    // inside a string, and truncating those lines would silently drop real
    // keys that follow on the same line.
    if (f.endsWith(".js")) src = src.replace(/\/\*[\s\S]*?\*\//g, blank);
    const at = (i) => `${rel(f)}:${lineOf(src, i)}`;

    // Literals: a localize()/format() argument, or any bare CAIRN.*/TYPES.*
    // string — keys are routinely parked in config maps and passed indirectly
    // (config.js's trait tables, actor-sheet's tab labels).
    for (const re of [
      /localize[\s(]+["'`]([A-Za-z][\w.]*)["'`]/g,
      /format\(\s*["'`]([A-Za-z][\w.]*)["'`]/g,
      /["'`](CAIRN\.[\w.]+)["'`]/g,
      /["'`](TYPES\.[\w.]+)["'`]/g,
    ]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) note(used, m[1], at(m.index));
    }

    // Interpolated: `CAIRN.Archetype.${archetype}` names four real keys and no
    // literal. Record the static prefix and treat everything under it as used.
    const dyn = /`((?:CAIRN|TYPES)\.[\w.]*)\$\{/g;
    let m;
    while ((m = dyn.exec(src))) note(prefixes, m[1], at(m.index));

    // The mirror image: `${key}Npc` derives a VARIANT of a key held in a variable,
    // so there is no static prefix to record — the literal part is the tail. Used by
    // actor-sheet's _wording(), which swaps a shared prompt for its NPC phrasing.
    // A suffix cannot stand alone as licence (that would excuse any key ending in
    // it), so a variant only counts as referenced when the key it is derived FROM is
    // itself referenced — see `unused` below.
    const suf = /`\$\{[^}]+\}([A-Za-z][\w.]*)`/g;
    while ((m = suf.exec(src))) note(suffixes, m[1], at(m.index));
  }
  return { used, prefixes, suffixes };
};

// ---------------------------------------------------------------------------
// Hardcoded user-visible strings
// ---------------------------------------------------------------------------

/** Blank a span while preserving newlines, so byte offsets and line numbers hold. */
const blank = (s) => s.replace(/[^\n]/g, " ");

/**
 * Strip Handlebars and HTML comments. Both are multi-line and both are full of
 * English prose — this file's own templates carry long design notes — so a
 * line-oriented scan drowns in them.
 */
const stripComments = (src) =>
  src
    .replace(/\{\{!--[\s\S]*?--\}\}/g, blank)
    .replace(/\{\{![\s\S]*?\}\}/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);

/**
 * Split a template into tags and text nodes. Hand-rolled rather than regexed
 * because attribute values legitimately contain `<` (`data-roll="d20cs<=@…"`)
 * and tags span lines, so `/<[^>]*>/` gets both wrong.
 */
const tokenize = (src) => {
  const tags = [];
  const text = [];
  let i = 0;
  let textStart = 0;
  while (i < src.length) {
    // A tag starts only at `<` followed by a name or a closing slash; `<=`
    // inside an attribute or a stray comparison is text.
    if (src[i] === "<" && /[a-zA-Z/]/.test(src[i + 1] ?? "")) {
      if (i > textStart) text.push({ start: textStart, value: src.slice(textStart, i) });
      const start = i;
      i++;
      let quote = null;
      while (i < src.length) {
        const c = src[i];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        i++;
      }
      tags.push({ start, value: src.slice(start, i + 1) });
      i++;
      textStart = i;
    } else i++;
  }
  if (textStart < src.length) text.push({ start: textStart, value: src.slice(textStart) });
  return { tags, text };
};

/** Attributes a user reads. `value`/`data-*` generally are not, so they are out. */
const VISIBLE_ATTRS = ["title", "placeholder", "alt", "aria-label", "data-tooltip", "label"];

/** Text with no letters at all, or only Handlebars leftovers, is not a string. */
const hasWords = (s) => /[A-Za-z]{2}/.test(s);

const scanTemplates = () => {
  const hits = [];
  for (const f of TPL_FILES) {
    const raw = fs.readFileSync(f, "utf8");
    const src = stripComments(raw);
    const { tags, text } = tokenize(src);

    for (const t of tags) {
      for (const a of VISIBLE_ATTRS) {
        // Lookbehind, not a leading `\s`: a conditional attribute is written
        // `{{#if x}}title="…"{{/if}}`, so the character before it is `}`. The
        // two real findings this gate was written for are both that shape.
        const re = new RegExp(`(?<![\\w-])${a}\\s*=\\s*"([^"]*)"`, "g");
        let m;
        while ((m = re.exec(t.value))) {
          const v = m[1];
          // Any Handlebars in the value means it came from somewhere else; the
          // key check above is what covers whether THAT is localized.
          if (v.includes("{{") || !hasWords(v)) continue;
          hits.push({ site: `${rel(f)}:${lineOf(src, t.start)}`, what: `${a}="${v}"` });
        }
      }
    }

    for (const t of text) {
      const stripped = t.value
        .replace(/\{\{[\s\S]*?\}\}/g, " ")
        .replace(/&[a-zA-Z]+;|&#\d+;/g, " ")
        .trim();
      if (!hasWords(stripped)) continue;
      hits.push({ site: `${rel(f)}:${lineOf(src, t.start)}`, what: `text ${JSON.stringify(stripped.slice(0, 70))}` });
    }
  }
  return hits;
};

/**
 * JS sites where a string literal is guaranteed user-visible: a notification,
 * or a property whose whole job is to be read (a dialog title, a button label,
 * a setting hint, a compendium label, a chat flavor line).
 *
 * The property pattern anchors on `{`, `,` or a line start, because otherwise
 * `startsWith("question:")` reads as a `question:` property whose value opens
 * with `)`. Two of the three hits in the first run were exactly that.
 */
const JS_PATTERNS = [
  [/ui\.notifications\.\w+\(\s*(["'])((?:[^"'\\]|\\.)*)\1/g, 2, "notification"],
  [/(?:^|[{,])\s*(title|label|hint|placeholder|flavor)\s*:\s*(["'])((?:[^"'\\]|\\.)*)\2/g, 3, "property"],
];

/** A literal that is a key, a path, a css class or a formula is not prose. */
const looksTranslatable = (v) =>
  /[A-Za-z]{3}/.test(v) &&
  !/^(CAIRN|TYPES)\./.test(v) &&
  !/^(STR|DEX|WIL)$/.test(v) &&
  !/^[\w.-]+$/.test(v) && // single token: an id, a class, a path fragment
  !/^(icons|systems|modules|worlds)\//.test(v);

const scanJs = () => {
  const hits = [];
  for (const f of JS_FILES) {
    const src = fs.readFileSync(f, "utf8");
    for (const [re, grp, kind] of JS_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const v = m[grp];
        if (!looksTranslatable(v)) continue;
        hits.push({ site: `${rel(f)}:${lineOf(src, m.index)}`, what: `${kind} ${JSON.stringify(v.slice(0, 70))}` });
      }
    }
  }
  return hits;
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const en = flattenKeys(JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8")));
const enSet = new Set(en);
const { used, prefixes, suffixes } = collectKeys();

/** A `${key}Npc`-style variant of a key that IS referenced counts as referenced. */
const isVariantOfUsed = (k) =>
  [...suffixes.keys()].some((s) => k.endsWith(s) && used.has(k.slice(0, -s.length)));

/**
 * `formatCount("CAIRN.NUses", n)` licenses the plural-form variants of that key
 * as well as the key itself. The form comes from `Intl.PluralRules` at runtime,
 * so no literal `.one` appears anywhere and the plain scan calls it dead —
 * which would push someone to delete the string that fixes "1 uses".
 *
 * The categories are the CLDR set, and this is deliberately keyed on the base
 * key being referenced: a bare `CAIRN.Whatever.one` with no formatCount call
 * behind it is still dead weight and still reported.
 */
const PLURAL_FORMS = ["zero", "one", "two", "few", "many"];
const isPluralFormOfUsed = (k) => {
  const us = k.lastIndexOf("_");
  if (us === -1 || !PLURAL_FORMS.includes(k.slice(us + 1))) return false;
  return used.has(k.slice(0, us));
};

const missing = [...used.keys()].filter((k) => !enSet.has(k));
const unused = en.filter(
  (k) =>
    !used.has(k) &&
    !CORE_RESOLVED.some((re) => re.test(k)) &&
    ![...prefixes.keys()].some((p) => k.startsWith(p)) &&
    !isVariantOfUsed(k) &&
    !isPluralFormOfUsed(k));
const hardcoded = [...scanTemplates(), ...scanJs()];

const list = (label, rows, fmt) => {
  console.log(`  ${rows.length ? "x" : "ok -"} ${label}: ${rows.length}`);
  for (const r of rows) console.log(`      ${fmt(r)}`);
};

console.log(`\nsource vs lang/en.json`);
console.log(`  scanned     : ${JS_FILES.length} js, ${TPL_FILES.length} templates`);
console.log(`  en.json keys: ${en.length}   referenced: ${used.size}   dynamic prefixes: ${prefixes.size}   suffixes: ${suffixes.size}`);
if (VERBOSE && prefixes.size) for (const [p, site] of prefixes) console.log(`      ${p}*  @ ${site}`);
if (VERBOSE && suffixes.size) for (const [s, site] of suffixes) console.log(`      *${s}  @ ${site}`);
console.log("");

list("keys used but missing from en.json", missing, (k) => `${k}   @ ${used.get(k)}`);
list("keys in en.json nothing references", unused, (k) => k);
list("hardcoded user-visible strings", hardcoded, (h) => `${h.site}   ${h.what}`);

const bad = missing.length + unused.length + hardcoded.length;
console.log(bad ? `\n${bad} problem(s).\n` : "");
process.exit(bad ? 1 : 0);

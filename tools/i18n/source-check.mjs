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
 * Four classes, all checkable offline:
 *
 *   missing    a key referenced by module/, templates/ or the macros pack's
 *              command JS that en.json lacks. Foundry renders the raw key, so
 *              the user sees "CAIRN.Whatever".
 *   unused     a key in en.json that nothing references. Dead weight a
 *              translator is nonetheless asked to translate.
 *   hardcoded  user-visible English in module/ or templates/ that never passes
 *              through game.i18n. Untranslatable by construction.
 *   unlabelled a gallery category in a MANIFEST with no label key — the one the
 *              first two are structurally blind to. See CATEGORY_LABELS below.
 *   rawattr    a `{{{ }}}` inside an HTML attribute, where not escaping means a
 *              quotation mark in the value ends the attribute. Added 2026-08-07.
 *   duplicate  the same key declared twice in one object of a lang file.
 *              JSON.parse keeps the LAST and says nothing, so the file still
 *              loads, still flattens to the same key set, and the earlier
 *              string simply stops being used. Added 2026-08-20, after a new
 *              die on the NPC sheet was given `CAIRN.RollBackground` — a key
 *              the character sheet's background die already had — and silently
 *              re-worded that one's tooltip. This is the only class here that
 *              reads the lang files as TEXT, because it is invisible to
 *              anything that parses them first.
 *
 * All six are errors. A warning that is permanently non-zero is a gate nobody
 * reads, which is the failure mode this file exists to correct.
 *
 *   node tools/i18n/source-check.mjs [--verbose]
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";
import { duplicateKeys } from "./validate.mjs";

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

/**
 * The macros pack is CODE, not content: each document's `command` is JS the
 * client executes, and its toasts localize exactly like module/ does. Review
 * #13 found this gate's corpus stopped at module/ + templates/, so all nine
 * keys referenced only by macro commands (WardenOnly + the four On/Off pairs)
 * sat "unused" — a red that teaches people to stop reading the gate. The scan
 * is the raw YAML text: a key literal survives both block-scalar styles the
 * pack round-trip produces (`|-` as committed, `>-` after an extract — folded
 * style wraps at spaces, and a localize("CAIRN.X") call carries none inside).
 * Deliberately ONLY the macros pack: the other packs hold prose for the
 * content overlay, where an en.json key would be a bug, not a reference.
 * No existsSync guard on purpose — if the pack directory vanishes, its keys
 * genuinely are unreferenced, and the walk of a missing dir failing loudly
 * beats reporting green over a corpus that silently shrank.
 */
const MACRO_FILES = walk(path.join(ROOT, "src/packs/macros"), /\.yml$/);

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

/**
 * Keys our forked core templates reference that the CLIENT's own language
 * file supplies, so they are rightly absent from lang/en.json. The forked
 * combat tracker (templates/sidebar/combat-tracker.html is core 14.365's
 * tracker.hbs with the initiative block swapped) keeps core's own localize
 * calls — each verified present in
 * C:\Users\domin\foundry\app\public\lang\en.json. EXACT keys, never a
 * prefix: a prefix would hide a typo'd COMBAT.* key of our own, which is
 * this gate's whole job to catch. (Review #11: these three rows kept the
 * gate permanently red, which is the failure mode its docstring names.)
 */
const CORE_SUPPLIED = new Set(["COMBATANT.Ping", "COMBATANT.PanTo", "COMBAT.InitiativeRoll"]);

/** Literal keys, plus the PREFIXES of keys built by interpolation. */
const collectKeys = () => {
  const used = new Map(); // key -> "file:line" of its first use
  const prefixes = new Map(); // dynamic prefix -> "file:line"
  const suffixes = new Map(); // dynamic suffix -> "file:line"
  const note = (map, k, site) => { if (!map.has(k)) map.set(k, site); };

  for (const f of [...JS_FILES, ...TPL_FILES, ...MACRO_FILES]) {
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
    // `<!` opens a declaration or an HTML comment, neither of which is
    // user-visible text: `<!DOCTYPE html>` used to fall through to the TEXT
    // branch and report itself as a hardcoded string. A comment consumes to
    // `-->` (a bare `>` inside one must not end it); a declaration to `>`.
    if (src[i] === "<" && src[i + 1] === "!") {
      if (i > textStart) text.push({ start: textStart, value: src.slice(textStart, i) });
      const end = src.startsWith("<!--", i)
        ? src.indexOf("-->", i + 4) + 3
        : src.indexOf(">", i) + 1;
      i = end > 2 ? end : src.length;
      textStart = i;
      continue;
    }
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
      // A stylesheet is not prose: the print page's inline <style> block
      // used to be scanned as one giant "hardcoded user-visible string".
      // Same for <script>, should a template ever carry one.
      const opened = /^<(style|script)[\s>]/i.exec(src.slice(start, start + 8));
      if (opened) {
        const close = new RegExp(`</${opened[1]}\\s*>`, "i");
        const m = close.exec(src.slice(i));
        i = m ? i + m.index + m[0].length : src.length;
        textStart = i;
      }
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

/**
 * Category labels built from a MANIFEST, which the three classes above are all
 * blind to.
 *
 * `art-picker.js` renders a gallery's category strip by localizing
 * `CAIRN.GameIconCategory.${pascal(key)}` for every key in the manifest. The key
 * is interpolated, so `missing` cannot see it — the scan records the dynamic
 * PREFIX and stops there — and `unused` cannot see it either, since that same
 * prefix licenses every key under it. Both report green while a tile renders the
 * literal string "CAIRN.GameIconCategory.Fire".
 *
 * Nothing caught that, and adding a category is exactly when it happens: it is
 * the one site in the whole operation that is not gated, arriving on the day
 * attention is on glyph counts and artist attribution. So the manifest is the
 * authority here — it is generated from disk by the importer, which makes it the
 * closest thing to "what the picker will actually try to draw".
 *
 * Keyed on the manifest rather than on a hand-kept list of categories, for the
 * same reason: a list maintained beside the thing it describes drifts from it.
 */
const CATEGORY_LABELS = [
  { manifest: "module/game-icons-manifest.json", prefix: "CAIRN.GameIconCategory." },
  { manifest: "module/tlomdev-manifest.json", prefix: "CAIRN.TlomdevCategory." },
];

// Must match art-picker.js's `pascal`: "greek-roman" -> "GreekRoman".
const pascal = (key) =>
  key.split(/[\s-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");

const unlabelled = CATEGORY_LABELS.flatMap(({ manifest, prefix }) => {
  const file = path.join(ROOT, manifest);
  if (!fs.existsSync(file)) return [{ key: `(missing) ${manifest}`, label: "" }];
  const { categories = [] } = JSON.parse(fs.readFileSync(file, "utf8"));
  return categories
    .map((c) => ({ key: `${manifest}  ${c.key}`, label: `${prefix}${pascal(c.key)}` }))
    .filter((r) => !enSet.has(r.label));
});

/**
 * Pack LABELS in system.json — a fourth key producer the three classes above
 * are all blind to.
 *
 * Foundry localizes `metadata.label` per viewer when the collection is built
 * (compendium-collection.mjs:46), so a CAIRN.* key in a pack's `label` is the
 * supported route, and the manifest is scanned in both directions: a
 * key-shaped label is a REFERENCE (fed into `used`, so `missing` catches a
 * key en.json lacks — which every client would render as the literal key —
 * and `unused` stops calling the 24 CAIRN.Pack.* strings dead), and a
 * non-key label is hardcoded English on a user-visible surface, reported
 * beside scanJs's findings.
 *
 * `packFolders` names are deliberately NOT held to this. The server writes a
 * packFolder's name VERBATIM into a real world Folder document at world init
 * (dist/packages/world.mjs — db.Folder.createDocuments, matched across
 * launches by the dot-joined hierarchyName), nothing localizes a Folder
 * document's name, and one shared document serves every viewer's language —
 * so a key there would BE the sidebar text. Folder names stay English by
 * mechanism, not oversight; the review #13 claim that they share the pack
 * labels' route was checked against the server and refuted.
 */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const packLabels = [];
for (const p of manifest.packs ?? []) {
  const label = String(p.label ?? "");
  if (/^CAIRN\./.test(label)) used.set(label, `system.json pack "${p.name}"`);
  else packLabels.push({ site: `system.json pack "${p.name}"`, what: `hardcoded label ${JSON.stringify(label)} — core localizes metadata.label, use a CAIRN.Pack.* key` });
}

const missing = [...used.keys()].filter((k) => !enSet.has(k) && !CORE_SUPPLIED.has(k));
const unused = en.filter(
  (k) =>
    !used.has(k) &&
    !CORE_RESOLVED.some((re) => re.test(k)) &&
    ![...prefixes.keys()].some((p) => k.startsWith(p)) &&
    !isVariantOfUsed(k) &&
    !isPluralFormOfUsed(k));
const hardcoded = [...scanTemplates(), ...scanJs()];

/**
 * A triple-stache inside an HTML ATTRIBUTE.
 *
 * `{{{ }}}` tells Handlebars not to escape, which is right for a block of
 * authored prose and wrong inside quotes: the value is not markup there, it is
 * an attribute, and a `"` anywhere in it terminates the attribute early and
 * puts whatever follows into the tag. When the value is a LOCALIZED string that
 * is a translator's quotation mark away from injecting into a sheet, and no
 * gate here could see it — `i18n:check` compares language files to each other,
 * and a quote is legal in every one of them.
 *
 * Two sites carried it (review #10), both
 * `data-label="{{{ localize 'CAIRN.Save' … }}}"`, and neither wanted markup at
 * all: `dataset.label` is read as plain text into a dialog title and into chat
 * flavor (actor-sheet.js:2246, :2617). Escaping is not a restriction on those,
 * it is what makes them read back correctly.
 *
 * Deliberately narrow — a triple-stache in element CONTENT is a legitimate and
 * common thing here, so only the quoted-attribute position is flagged.
 */
const rawAttrs = [];
for (const f of TPL_FILES) {
  const src = stripComments(fs.readFileSync(f, "utf8"));
  for (const m of src.matchAll(/([\w:-]+)\s*=\s*"[^"]*\{\{\{/g)) {
    rawAttrs.push({ site: `${rel(f)}:${lineOf(src, m.index)}`, what: `${m[1]}="{{{ … }}}" — unescaped inside an attribute; use {{ }}` });
  }
}

/**
 * Every lang file, TEXT not parsed — including the translators', because a
 * duplicate there wastes exactly the work this project asks them for: two rows
 * translated, one of them dead. `lang/content/` is scanned too; it is keyed on
 * English source strings, so a repeat there means one of two translations of
 * the same sentence never renders.
 */
const langFiles = [
  ...walk(path.join(ROOT, "lang"), /\.json$/),
];
const duplicates = [];
for (const f of langFiles) {
  for (const d of duplicateKeys(fs.readFileSync(f, "utf8"))) {
    duplicates.push({ site: `${rel(f)}:${d.line}`, what: `"${d.key}" was already declared at line ${d.first} — JSON.parse keeps THIS one and drops that one` });
  }
}

const list = (label, rows, fmt) => {
  console.log(`  ${rows.length ? "x" : "ok -"} ${label}: ${rows.length}`);
  for (const r of rows) console.log(`      ${fmt(r)}`);
};

console.log(`\nsource vs lang/en.json`);
console.log(`  scanned     : ${JS_FILES.length} js, ${TPL_FILES.length} templates, ${MACRO_FILES.length} macro yml`);
console.log(`  en.json keys: ${en.length}   referenced: ${used.size}   dynamic prefixes: ${prefixes.size}   suffixes: ${suffixes.size}`);
if (VERBOSE && prefixes.size) for (const [p, site] of prefixes) console.log(`      ${p}*  @ ${site}`);
if (VERBOSE && suffixes.size) for (const [s, site] of suffixes) console.log(`      *${s}  @ ${site}`);
console.log("");

list("keys used but missing from en.json", missing, (k) => `${k}   @ ${used.get(k)}`);
list("keys in en.json nothing references", unused, (k) => k);
list("hardcoded user-visible strings", hardcoded, (h) => `${h.site}   ${h.what}`);
list("manifest categories with no label key", unlabelled, (r) => `${r.key}   needs ${r.label}`);
list("hardcoded pack labels in system.json", packLabels, (r) => `${r.site}   ${r.what}`);
list("unescaped {{{ }}} inside an HTML attribute", rawAttrs, (r) => `${r.site}   ${r.what}`);
list("keys declared twice in one lang file", duplicates, (r) => `${r.site}   ${r.what}`);

const bad = missing.length + unused.length + hardcoded.length + unlabelled.length + packLabels.length
  + rawAttrs.length + duplicates.length;
console.log(bad ? `\n${bad} problem(s).\n` : "");
process.exit(bad ? 1 : 0);

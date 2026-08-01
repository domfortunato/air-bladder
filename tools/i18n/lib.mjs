/**
 * Shared helpers for the Air Bladder i18n tooling (content + UI).
 *
 * Everything here is offline: it reads the YAML source of truth under src/packs/
 * and the lang/*.json files, and never touches Foundry runtime or the built
 * LevelDB in packs/. Node-only (ESM), mirrors the conventions in tools/import/*.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const YAML = require("js-yaml");

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const packDir = (...a) => path.join(ROOT, "src", "packs", ...a);

/** Every pack directory under src/packs/ (each holds *.yml documents), sorted. */
export const listPacks = () =>
  fs.readdirSync(packDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

/** Load a pack's documents as [{ file, base, doc }], skipping unparseable files. */
export const readPack = (name) => {
  const dir = packDir(name);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith(".yml"))
    .map((f) => ({ file: path.join(dir, f), base: f, doc: YAML.load(fs.readFileSync(path.join(dir, f), "utf8")) }))
    .filter((e) => e.doc);
};

/**
 * Frozen English slug from a display name — lowercase, apostrophes/dots dropped,
 * every other run of non-alphanumerics collapsed to a single hyphen. Used by the
 * slug refactor (resolution key) and as a stable identity in tooling. Examples:
 *   "Rations" -> "rations", "Needle-Knife" -> "needle-knife",
 *   "Chain, 10ft" -> "chain-10ft", "Weaver's Kit" -> "weavers-kit".
 */
export const slugify = (name) =>
  String(name).trim().toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Normalize a source string for KEYING ONLY (collapse all whitespace to single
 * spaces, trim). The stored en/es values keep their full markup — this only
 * decides when two sources are "the same key", so reflowed whitespace or an
 * importer re-wrap doesn't fork a translation. Never store the normalized form.
 */
export const normalizeKey = (s) => String(s).replace(/\s+/g, " ").trim();

// ---- TSV round-trip --------------------------------------------------------
// TSV over CSV: content is comma-heavy prose and Spanish Excel defaults its list
// separator to ";". BOM so Excel renders accents instead of mojibake. One physical
// line per row, so tabs/newlines/backslashes inside a cell are escaped reversibly.

const BOM = "﻿";

/**
 * The translation column is named after the TARGET LOCALE, so a French
 * translator fills a column headed `fr` rather than one headed `es`. In code the
 * cell is always `row.tr` — the file format carries the locale, the tooling does
 * not, which is the whole reason a second language is possible at all.
 */
export const tsvCols = (lang) => ["key", "context", "en", lang, "notes", "status"];

/** Which header cell holds the translation, tolerating an older `es`-headed TSV. */
const trColumn = (header, lang) =>
  header.includes(lang) ? lang
    : header.includes("es") ? "es"   // a TSV generated before the column was localized
      : header[3];                    // last resort: the translation is always 4th

/** The locale an existing TSV was written for — its 4th column. null if absent. */
export const tsvLocaleOf = (file) => {
  if (!fs.existsSync(file)) return null;
  const first = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
  return first.split("\t")[3] ?? null;
};

const encCell = (s) => String(s ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/\t/g, "\\t")
  .replace(/\r?\n/g, "\\n");

// Single left-to-right pass so an escaped backslash never double-unescapes.
const decCell = (s) => String(s ?? "")
  .replace(/\\([\\nt])/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : "\\"));

/**
 * Write rows to a UTF-8-BOM, CRLF, tab-separated file. Each row is keyed by
 * key/context/en/notes/status plus `tr` for the translation, which lands in the
 * locale-named column.
 */
export const writeTSV = (file, rows, lang = "es") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cols = tsvCols(lang);
  const cell = (r, c) => encCell(c === lang ? r.tr : r[c]);
  const lines = [cols.join("\t")];
  for (const r of rows) lines.push(cols.map((c) => cell(r, c)).join("\t"));
  fs.writeFileSync(file, BOM + lines.join("\r\n") + "\r\n");
};

/**
 * Read a TSV written by writeTSV back into row objects, exposing the
 * translation as `tr` whatever the column happens to be called.
 */
export const readTSV = (file, lang = "es") => {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines.shift().split("\t");
  const tr = trColumn(header, lang);
  return lines.map((line) => {
    const cells = line.split("\t");
    const r = {};
    header.forEach((h, i) => { r[h] = decCell(cells[i] ?? ""); });
    r.tr = r[tr] ?? "";
    return r;
  });
};

// ---- Overwrite guard -------------------------------------------------------
// extract rebuilds every TSV from the committed JSON, which is loss-free ONLY for
// translations already run through i18n:import. A cell that was typed but not
// imported has no other copy anywhere — the TSVs are git-ignored, so git cannot
// show what vanished and cannot restore it. Warning in the docs was not enough:
// the guide's own first instruction is to extract, so the trap sits directly on
// the happy path. These two helpers let extract refuse instead.

/**
 * Classify what writing `rows` over an existing TSV would do to cells already in
 * it. Identity is (key, normalized en) — the same pairing the overlay keys on, so
 * a reflowed source string doesn't read as a different row.
 *
 * Two outcomes, and conflating them is a mistake worth not repeating:
 *
 *   lost    the JSON has NOTHING for this row, so the sheet holds the only copy
 *           of that translation anywhere. Overwriting destroys it outright. This
 *           is the "filled a pack in the evening, never imported" case.
 *   differs the JSON has a DIFFERENT value. Ambiguous, and usually harmless: it
 *           is equally an unimported edit and a sheet that has simply gone stale
 *           because the JSON moved on (a merged PR, someone else's import). The
 *           JSON's value is safe either way, so nothing is destroyed that has no
 *           other copy — this warns, never blocks. Blocking here walls off a
 *           routine re-extract behind --force, which just teaches people to pass
 *           --force, and then the real guard below stops working too.
 */
export const classifyOverwrite = (file, rows, lang = "es") => {
  const out = { lost: [], differs: [] };
  if (!fs.existsSync(file)) return out;
  const incoming = new Map(rows.map((r) => [`${r.key}\0${normalizeKey(r.en)}`, (r.tr ?? "").trim()]));
  for (const old of readTSV(file, lang)) {
    const had = (old.tr ?? "").trim();
    if (!had) continue;
    const k = `${old.key}\0${normalizeKey(old.en)}`;
    // A row the new extraction doesn't produce is orphaned, not overwritten — the
    // stale-row machinery already carries those forward for review.
    if (!incoming.has(k)) continue;
    const next = incoming.get(k);
    if (next === had) continue;
    (next === "" ? out.lost : out.differs).push({ key: old.key, en: old.en, had });
  }
  return out;
};

/**
 * Guard a batch of pending writes: [{ file, rows }]. Exits non-zero listing the
 * unimported work rather than destroying it, unless `force`. All-or-nothing on
 * purpose — extract writes many TSVs, and aborting halfway would leave the
 * spreadsheet set inconsistent.
 */
export const guardOverwrite = (pending, lang = "es", force = false) => {
  // A sheet written for ANOTHER locale is not unimported work — it is a different
  // language's spreadsheet. Blocking on it as if it were would be bad enough; the
  // remedy this prints for real unimported work ("run i18n:import") would be
  // actively destructive here, filing Spanish cells into lang/<other>.json.
  const foreign = pending
    .map(({ file }) => ({ file, locale: tsvLocaleOf(file) }))
    .filter((f) => f.locale && f.locale !== lang);

  if (foreign.length && !force) {
    console.error(`\nREFUSING TO OVERWRITE — ${foreign.length} spreadsheet(s) in that folder belong to`);
    console.error(`locale "${foreign[0].locale}", and you are extracting "${lang}". Rebuilding them here would`);
    console.error(`replace ${foreign[0].locale} sheets with ${lang} ones.\n`);
    console.error(`  Keep them apart:  ... --lang ${lang} --out tools/i18n/tsv-${lang}`);
    console.error(`  Or replace them:  ... --lang ${lang} --force\n`);
    console.error(`  (Do NOT run i18n:import to "save" them — it would file ${foreign[0].locale} text`);
    console.error(`   into lang/${lang}.json.)\n`);
    process.exit(1);
  }

  const seen = pending.map(({ file, rows }) => ({ file, ...classifyOverwrite(file, rows, lang) }));
  const lost = seen.filter((h) => h.lost.length);
  const differs = seen.filter((h) => h.differs.length);

  // Advisory: the JSON still holds a value for these, so nothing is destroyed
  // that has no other copy. Say so, don't stop.
  if (differs.length) {
    const n = differs.reduce((a, h) => a + h.differs.length, 0);
    console.warn(`\n  ! ${n} cell(s) in ${differs.length} spreadsheet(s) differ from lang/${lang}.json and will be`);
    console.warn(`    replaced by its values. Usually the sheet is just stale. If they are edits you`);
    console.warn(`    have not imported, stop and run \`npm run i18n:import\` first.`);
  }

  if (!lost.length) return;

  const cells = lost.reduce((n, h) => n + h.lost.length, 0);
  if (force) {
    console.warn(`\n  ! --force: discarding ${cells} unimported translation(s) in ${lost.length} file(s).\n`);
    return;
  }

  console.error(`\nREFUSING TO OVERWRITE — ${cells} translated cell(s) in ${lost.length} spreadsheet(s)`);
  console.error(`exist nowhere but the spreadsheet. lang/${lang}.json has nothing for them, so`);
  console.error(`extracting now would destroy them with no way to get them back.\n`);
  for (const h of lost.slice(0, 12)) {
    const eg = h.lost[0];
    console.error(`  ${path.basename(h.file).padEnd(34)}${String(h.lost.length).padStart(4)} cell(s)   e.g. "${eg.en.slice(0, 32)}" → "${eg.had.slice(0, 32)}"`);
  }
  if (lost.length > 12) console.error(`  … and ${lost.length - 12} more file(s)`);
  console.error(`\n  Save them first:  npm run i18n:import        (then extract is safe)`);
  console.error(`  Or discard them:  <this command> -- --force\n`);
  process.exit(1);
};

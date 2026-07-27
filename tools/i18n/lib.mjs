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

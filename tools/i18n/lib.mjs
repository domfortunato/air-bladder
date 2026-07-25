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
export const TSV_COLS = ["key", "context", "en", "es", "notes", "status"];

const encCell = (s) => String(s ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/\t/g, "\\t")
  .replace(/\r?\n/g, "\\n");

// Single left-to-right pass so an escaped backslash never double-unescapes.
const decCell = (s) => String(s ?? "")
  .replace(/\\([\\nt])/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : "\\"));

/** Write rows (objects keyed by TSV_COLS) to a UTF-8-BOM, CRLF, tab-separated file. */
export const writeTSV = (file, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [TSV_COLS.join("\t")];
  for (const r of rows) lines.push(TSV_COLS.map((c) => encCell(r[c])).join("\t"));
  fs.writeFileSync(file, BOM + lines.join("\r\n") + "\r\n");
};

/** Read a TSV written by writeTSV back into an array of row objects. */
export const readTSV = (file) => {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines.shift().split("\t");
  return lines.map((line) => {
    const cells = line.split("\t");
    const r = {};
    header.forEach((h, i) => { r[h] = decCell(cells[i] ?? ""); });
    return r;
  });
};

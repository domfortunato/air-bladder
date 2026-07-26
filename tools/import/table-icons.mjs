#!/usr/bin/env node
/**
 * Stamp every RollTable RESULT with the icon of the thing it points at.
 *
 * A RollTable result carries its OWN `img`, snapshotted when the result was
 * authored — it is NOT read live off the referenced document. So after
 * item-icons.mjs re-arted every pool item / monster with a game-icons.net glyph,
 * the tables kept showing whatever art the result was born with: Foundry's
 * `icons/svg/item-bag.svg`, a stock horse photo, a grey d20. This fixes that.
 *
 * The rule is "mirror the target", NOT "assign a class icon", because a
 * `type: pack` result can point at three different kinds of document:
 *   - an Item/Actor  -> its stamped game-icon (weapons.png, armor.png, ...)
 *   - another RollTable (a table-of-tables, e.g. Names -> Male/Female Names)
 *                     -> that table's own d20 art, which is correct as-is
 * Resolving each result against its referenced document's top-level `img` gets
 * all of them right for free. `type: document` results (the legacy gear-tables,
 * which reference WORLD Item ids that don't exist in a fresh install) can't be
 * resolved by id, so they fall back to a name match against the item packs.
 * `type: text` results have no document and are left untouched.
 *
 * Surgical + idempotent, exactly like item-icons.mjs: it parses each table to
 * read result order + targets, then rewrites ONLY the per-result `img:` line
 * (the table's own top-level `img:` in column 0 is never touched). Run it after
 * item-icons.mjs / any pack re-import, then `npm run build:packs`.
 *
 *   node tools/import/table-icons.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const YAML = require("js-yaml");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRY = process.argv.includes("--dry");

const system = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const packsByType = (t) => system.packs.filter((p) => p.type === t).map((p) => p.name);
const DOC_PACKS = [...packsByType("Item"), ...packsByType("Actor")];
const TABLE_PACKS = packsByType("RollTable");
const ALL_PACKS = [...DOC_PACKS, ...TABLE_PACKS];

/** Read every doc in a pack dir, returning parsed YAML objects (with source file). */
const readPack = (pack) => {
  const dir = path.join(ROOT, "src", "packs", pack);
  if (!fs.existsSync(dir)) { console.warn(`(missing pack dir: ${pack})`); return []; }
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith(".yml"))
    .map((file) => ({ file: path.join(dir, file), doc: YAML.load(fs.readFileSync(path.join(dir, file), "utf8")) }))
    .filter((e) => e.doc && typeof e.doc === "object");
};

// ---- Indexes --------------------------------------------------------------
// byId: every document (item, actor, AND table) by its _id -> top-level img.
//       Table results reference all three kinds, so all three must be here.
// byName: item/actor docs by lowercased name -> img, for the legacy
//         `type: document` gear-tables that reference world ids we can't resolve.
const byId = new Map();
const byName = new Map();
const nameConflicts = new Set();

for (const pack of ALL_PACKS) {
  const isDocPack = DOC_PACKS.includes(pack);
  for (const { doc } of readPack(pack)) {
    if (doc._id && doc.img) byId.set(doc._id, { img: doc.img, name: doc.name, pack });
    if (isDocPack && doc.name && doc.img) {
      const key = doc.name.toLowerCase();
      if (byName.has(key) && byName.get(key) !== doc.img) nameConflicts.add(doc.name);
      byName.set(key, doc.img);
    }
  }
}

/** RollTable result text can carry HTML entities ("Quill &amp; Ink"); decode for name matching. */
// decode &amp; LAST so a literal "&amp;lt;" doesn't double-unescape into "<".
const decode = (s) => String(s)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");
const nameHit = (text) => text && byName.get(decode(text).toLowerCase());

/** Target img for one result, or null to leave it alone. */
const targetFor = (r, warnings) => {
  if (r.type === "pack") {
    const hit = byId.get(r.documentId);
    if (hit) return hit.img;
    const byN = nameHit(r.text);
    if (byN) return byN;
    warnings.push(`unresolved pack ref "${r.text}" (${r.documentCollection}/${r.documentId})`);
    return null;
  }
  if (r.type === "document") {                       // legacy world ref -> name match
    const byN = nameHit(r.text);
    if (byN) return byN;
    warnings.push(`unresolved document ref "${r.text}" (${r.documentCollection}/${r.documentId})`);
    return null;
  }
  return null;                                        // text results: no icon
};

// ---- Rewrite --------------------------------------------------------------
let filesChanged = 0, resultsChanged = 0;
const allWarnings = [];

for (const pack of TABLE_PACKS) {
  for (const { file, doc } of readPack(pack)) {
    const results = Array.isArray(doc.results) ? doc.results : [];
    if (!results.length) continue;

    const warnings = [];
    const targets = results.map((r) => targetFor(r, warnings));
    warnings.forEach((w) => allWarnings.push(`  ${pack}/${path.basename(file)}: ${w}`));

    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split(/\r?\n/);

    let inResults = false, resultIndent = null, ri = -1, needImg = false, fileChanged = false;
    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      if (/^results:/.test(line)) { inResults = true; continue; }
      if (inResults && /^[^\s#]/.test(line)) inResults = false;   // column-0 key ends the list
      if (!inResults) continue;

      const dash = line.match(/^(\s+)-\s/);
      if (dash) {
        const indent = dash[1].length;
        if (resultIndent === null) resultIndent = indent;
        if (indent === resultIndent) { ri++; needImg = true; }    // a new result (not a range item)
      }

      const img = needImg && line.match(/^(\s+)img:\s/);
      if (img) {
        needImg = false;
        const target = targets[ri];
        if (target) {
          const next = `${img[1]}img: ${target}`;
          if (next !== line) { lines[k] = next; fileChanged = true; resultsChanged++; }
        }
      }
    }

    if (fileChanged) {
      filesChanged++;
      if (!DRY) fs.writeFileSync(file, lines.join("\n"), "utf8");
    }
  }
}

// ---- Report ---------------------------------------------------------------
if (nameConflicts.size)
  console.warn(`\nname collisions across doc packs (different img for same name): ${[...nameConflicts].join(", ")}`);
if (allWarnings.length) {
  console.warn(`\nunresolved result references (left untouched):`);
  allWarnings.forEach((w) => console.warn(w));
}
console.log(`\n${DRY ? "[dry] would change" : "changed"}: ${resultsChanged} result icon(s) across ${filesChanged} table file(s).`);

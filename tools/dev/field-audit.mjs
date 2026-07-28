/**
 * Field audit — the guard against silent field loss.
 *
 * A TypeDataModel schema is strict: a `system.*` path that is written but not
 * declared is dropped on the next write with no error, no warning and no console
 * output. Nothing in the smoke test catches it, because nothing throws — the data
 * simply stops being saved. That is the single real hazard introduced by moving
 * off `template.json`, and this script is the defence.
 *
 * It loads `module/data-models.js` under a stub `foundry` global (the file only
 * touches `foundry.data.fields` and `foundry.abstract.TypeDataModel`), walks every
 * schema into a set of declared paths, and compares that against three sources of
 * PERSISTED paths:
 *
 *   1. sheet form bindings  — `name="system.x"` and ProseMirror `target="system.x"`
 *   2. code literals        — `"system.x"` string keys in module/ (update/create)
 *   3. shipped pack data    — every `system` key on every src/packs YAML document
 *
 * Derived values are deliberately NOT audited: `prepareData` assigns ~30 computed
 * properties onto `this.system` and they must stay undeclared, since declaring one
 * turns it into stored state.
 *
 * Usage: npm run check:fields
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const at = (...p) => path.join(ROOT, ...p);

/* -------------------------------------------- */
/*  1. Declared paths, read from the real schemas */
/* -------------------------------------------- */

class StubField {
  constructor(opts = {}) { this.options = opts; }
}
class StubSchemaField extends StubField {
  constructor(schema, opts) { super(opts); this.fields = schema; }
}
class StubArrayField extends StubField {
  constructor(element, opts) { super(opts); this.element = element; }
}

globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: {
    fields: {
      StringField: StubField,
      HTMLField: StubField,
      NumberField: StubField,
      BooleanField: StubField,
      ObjectField: StubField,
      SchemaField: StubSchemaField,
      ArrayField: StubArrayField,
    },
  },
};

const { ACTOR_DATA_MODELS, ITEM_DATA_MODELS } = await import(
  `file://${at("module", "data-models.js").replace(/\\/g, "/")}`
);

/** Flatten a schema into dotted paths. Array elements are leaves — their interior
 *  shape is free-form (ObjectField) and never addressed as a `system.*` path. */
const paths = (schema, prefix = "") => {
  const out = new Set();
  for (const [key, field] of Object.entries(schema)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.add(p);
    if (field instanceof StubSchemaField) for (const sub of paths(field.fields, p)) out.add(sub);
  }
  return out;
};

const declared = {};
for (const [type, cls] of Object.entries({ ...ACTOR_DATA_MODELS, ...ITEM_DATA_MODELS })) {
  declared[type] = paths(cls.defineSchema());
}
const anyDeclared = new Set(Object.values(declared).flatMap((s) => [...s]));

/* -------------------------------------------- */
/*  2. Persisted paths                            */
/* -------------------------------------------- */

const readFile = (p) => fs.readFileSync(p, "utf8");
const walk = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });

/** Sheet template -> the sub-type it renders. */
const SHEET_TYPE = {
  "actor/character-sheet.html": "character",
  "actor/hireling-sheet.html": "hireling",
  "actor/npc-sheet.html": "npc",
  "actor/container-sheet.html": "container",
  "item/item-sheet.html": "item",
  "item/weapon-sheet.html": "weapon",
  "item/armor-sheet.html": "armor",
  "item/spellbook-sheet.html": "spellbook",
  "item/object-sheet.html": "object",
  "item/background-sheet.html": "background",
  "item/transport-sheet.html": "transport",
};

const boundIn = (src) => {
  const found = new Set();
  for (const m of src.matchAll(/(?:name|target)="system\.([A-Za-z0-9_.]+)"/g)) found.add(m[1]);
  return found;
};

// templates/parts/* are included by several sheets, so their bindings belong to
// every type that includes them. Attributing them to one sheet would miss real
// hazards, so they are checked against the union instead.
const partPaths = new Set(
  walk(at("templates", "parts"), ".html").flatMap((f) => [...boundIn(readFile(f))])
);

const problems = [];

for (const [rel, type] of Object.entries(SHEET_TYPE)) {
  const file = at("templates", ...rel.split("/"));
  if (!fs.existsSync(file)) { problems.push(`missing sheet template: ${rel}`); continue; }
  for (const p of boundIn(readFile(file))) {
    if (!declared[type].has(p)) {
      problems.push(`${rel} binds system.${p} — not declared on ${type}`);
    }
  }
}

for (const p of partPaths) {
  if (!anyDeclared.has(p)) problems.push(`templates/parts binds system.${p} — declared on no type`);
}

// Code literals. Not type-attributable without running Foundry, so the check is
// "declared somewhere" — enough to catch a wholly undeclared field.
// Comments are stripped first: prose that quotes a path (this file's own header,
// or a note explaining a field that was REMOVED) is documentation, not a write.
// Only whole-line comments go, so a code line can never be truncated.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");

for (const file of walk(at("module"), ".js")) {
  const src = stripComments(readFile(file));
  for (const m of src.matchAll(/"system\.([A-Za-z0-9_.]+)"/g)) {
    if (!anyDeclared.has(m[1])) {
      problems.push(`${path.relative(ROOT, file).replace(/\\/g, "/")} writes "system.${m[1]}" — declared on no type`);
    }
  }
}

// Shipped pack data: a field the schema forgets is silently stripped from the
// document on load, so authored content would quietly lose it.
const packDrops = new Map();
for (const file of walk(at("src", "packs"), ".yml")) {
  let doc;
  try { doc = yaml.load(readFile(file)); } catch { continue; }
  if (!doc || typeof doc !== "object") continue;
  const type = doc.type;
  if (!declared[type] || typeof doc.system !== "object" || !doc.system) continue;
  for (const key of Object.keys(doc.system)) {
    if (!declared[type].has(key)) {
      const k = `${type}.${key}`;
      packDrops.set(k, (packDrops.get(k) ?? 0) + 1);
    }
  }
}

/* -------------------------------------------- */
/*  3. Report                                     */
/* -------------------------------------------- */

const dedup = [...new Set(problems)];
if (dedup.length) {
  console.error(`\nFIELD AUDIT FAILED — ${dedup.length} persisted path(s) would be silently dropped:\n`);
  for (const p of dedup) console.error(`  ✗ ${p}`);
} else {
  console.log("Field audit: every persisted system.* path is declared.");
}

if (packDrops.size) {
  console.log("\nPack fields not in the schema (dropped on load — intentional if listed in docs/data-model-migration.md):");
  for (const [k, n] of [...packDrops].sort()) console.log(`  · ${k} (${n} docs)`);
}

console.log(
  `\nTypes: ${Object.keys(declared).length}  ` +
  `Declared paths: ${anyDeclared.size}  ` +
  `Sheets checked: ${Object.keys(SHEET_TYPE).length}`
);

process.exit(dedup.length ? 1 : 0);

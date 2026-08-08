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
class StubHTMLField extends StubField {}
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
      HTMLField: StubHTMLField,
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

/** HTMLField paths only, one flat set per sub-type. Nested SchemaFields are walked
 *  so a future `system.foo.bar` HTMLField is caught too. */
const htmlPaths = (schema, prefix = "") => {
  const out = new Set();
  for (const [key, field] of Object.entries(schema)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (field instanceof StubHTMLField) out.add(p);
    else if (field instanceof StubSchemaField) for (const sub of htmlPaths(field.fields, p)) out.add(sub);
  }
  return out;
};

/**
 * HTMLFields living INSIDE an ArrayField, at any depth.
 *
 * These are not a gap in `htmlPaths` to be closed by recursing further — they
 * are UNDECLARABLE. `htmlFields` addresses dotted schema paths, and there is no
 * syntax for "every element of this array", so the server has nothing to match
 * a write against and stores it verbatim however the manifest is written. The
 * failure mode is therefore the worst available: `htmlPaths` returns nothing for
 * such a field, the manifest declares nothing, both directions of the
 * cross-check agree, and the gate passes while the field is never sanitized.
 *
 * So this refuses rather than reports a missing declaration. The recipe for a
 * channel the manifest cannot cover is to clean at the SINK with core's own
 * cleaner — `foundry.utils.cleanHTML`, which is what `cleanDescription` in
 * `module/utils.js` does for `features[]`, the ArrayField(ObjectField) that was
 * a live player→GM XSS until f674730. `dev:feature-xss` is that path's probe.
 *
 * Latent today: no schema here declares an HTMLField under an array. It is
 * gated because the day one is added is the day the gate would otherwise go
 * quiet, and because "declare it in system.json" is the wrong instinct and the
 * one somebody will reach for.
 */
const htmlUnderArray = (field, p, inArray) => {
  const out = new Set();
  if (field instanceof StubHTMLField) {
    if (inArray) out.add(p);
  } else if (field instanceof StubSchemaField) {
    for (const [k, f] of Object.entries(field.fields)) {
      for (const s of htmlUnderArray(f, p ? `${p}.${k}` : k, inArray)) out.add(s);
    }
  } else if (field instanceof StubArrayField) {
    for (const s of htmlUnderArray(field.element, `${p}[]`, true)) out.add(s);
  }
  return out;
};

const undeclarableHtml = (schema) => {
  const out = new Set();
  for (const [k, f] of Object.entries(schema)) {
    for (const s of htmlUnderArray(f, k, false)) out.add(s);
  }
  return out;
};

/* -------------------------------------------- */
/*  2. Persisted paths                            */
/* -------------------------------------------- */

const readFile = (p) => fs.readFileSync(p, "utf8");
const walk = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });

/**
 * Sheet template -> the sub-type(s) it renders.
 *
 * An array where one template serves several types: every binding in it must be
 * declared on ALL of them, or the sheet writes a field one type has and another
 * silently drops. `npc-sheet.html` serves both npc and hireling, which are one
 * thing now — this is what would catch the two schemas drifting apart again.
 */
const SHEET_TYPE = {
  "actor/character-sheet.html": "character",
  "actor/npc-sheet.html": ["npc", "hireling"],
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

for (const [rel, spec] of Object.entries(SHEET_TYPE)) {
  const file = at("templates", ...rel.split("/"));
  if (!fs.existsSync(file)) { problems.push(`missing sheet template: ${rel}`); continue; }
  const types = Array.isArray(spec) ? spec : [spec];
  for (const p of boundIn(readFile(file))) {
    for (const type of types) {
      if (!declared[type]?.has(p)) {
        problems.push(`${rel} binds system.${p} — not declared on ${type}`);
      }
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

// Parsed here rather than at its other use below, because the provenance check
// reads `manifest.id` and runs first.
const manifest = JSON.parse(readFile(at("system.json")));

// Shipped provenance must be real or absent. `_stats.compendiumSource` records
// which COMPENDIUM document this one was copied from; the server does not manage
// it, and fromDropData stamps it only when EMPTY (client-document.mjs:989-991) —
// so a junk truthy value shipped in a pack suppresses true provenance on every
// future import of that document, forever. toCompendium()'s clearSource option
// exists for exactly this case, but compilePack builds straight from YAML and
// never runs it, so the YAML itself must be clean. 297 world uuids (Item.<id>,
// RollTable.<id>) rode in from the b2eda4a baseline's flags.core.sourceId move
// before this check existed. Valid values: null, or a Compendium.* uuid.
// Text-level scan, not a YAML walk: the field recurs at every embedding depth
// (actors' items, table results), and the line shape is the invariant.
//
// ALL THREE source fields are checked, because all three are what Foundry itself
// strips: toCompendium's clearSource clears `_stats.compendiumSource`,
// `duplicateSource` AND `exportSource` together (client-document.mjs:1117), under
// a docstring that reads "Remove any features of the data which are
// world-specific". Checking only the first is how a spellbook shipped for months
// still stamped `exportSource: {worldId: cairn, coreVersion: 0.7.5, systemId:
// cairn}` — provenance from a Foundry 0.7.5 world of a different system, and the
// single remaining coreVersion in this repo's content that was not 14.365.
// `duplicateSource` has never been non-null here; it is checked because the cost
// is one regex and the failure mode is identical (a world uuid nobody can resolve).
//
// `_stats.systemId` is checked alongside them for a DIFFERENT reason, and the
// difference is worth keeping straight. It is not one of the three `clearSource`
// strips — it is a MANAGED field: "managed by the server and ignored if they
// appear in creation or update data" (`common/data/fields.mjs:4060-4063`, and
// `_sanitizeType` at :4158-4164 overwrites it). So a foreign value here is inert
// on import, exactly as the ownership keys below are unreadable — and that is
// what makes removing it a zero-behaviour edit, i.e. what makes it SAFE, not
// what makes it unnecessary. What it is NOT is inert to a reader: six documents
// shipped saying `systemId: cairn`, `systemVersion: 0.10.26` — the private fork
// this system descends from, at a version that has never existed here (stripped
// 2026-08-07). Content that names another system as its origin is wrong on the
// face of it, whoever is or is not reading the field.
//
// Only `systemId` is gated. `systemVersion` needs no rule of its own because the
// server stamps the pair together at creation, so a foreign version cannot
// arrive without the foreign id beside it — and a rule about which version
// strings are "ours" would be a hardcoded list going stale every release.
//
// `_stats.lastModifiedBy` and top-level `author` are gated for the SAME
// zero-behaviour-provenance reason as the ownership keys below: `author` is one
// of the fields toCompendium's clearOwnership strips (client-document.mjs:1119)
// and `lastModifiedBy` is a server-managed `_stats` field, so both are inert on
// import — but a shipped pack naming a specific User id is provenance from the
// authoring world that resolves to nobody once installed. 46 documents shipped
// `lastModifiedBy` naming two fork-era users until they were nulled 2026-08-08;
// checking one member of the set the framework clears atomically is how the
// others ship. Valid value for either: null.
const SOURCE_FIELDS = {
  // null, or this system's own id. Read from the manifest rather than written
  // here, so a rename cannot leave the gate asserting the old name.
  systemId: v =>
    v === "null" || v === manifest.id
      ? null
      : `ships _stats.systemId ${v} — content naming a system other than ${manifest.id} as its origin`,
  // null only — a User id here names whoever last touched the document in the
  // authoring world, which exists in nobody's world once the system is installed.
  lastModifiedBy: v =>
    v === "null" ? null : `ships _stats.lastModifiedBy ${v} — a User id from the authoring world, which exists in nobody else's`,
  // null only — cleared by toCompendium's clearOwnership; a non-null value names
  // an author who is a User id from someone else's world.
  author: v =>
    v === "null" ? null : `ships a non-null author — a User id from the authoring world that resolves to nobody once installed`,
  // null, or a genuine Compendium.* uuid — anything else blocks true provenance.
  compendiumSource: v =>
    v === "null" || v.startsWith("Compendium.")
      ? null
      : `ships compendiumSource ${v} — a non-compendium uuid blocks true provenance from ever being stamped`,
  // A world uuid recording what this was duplicated from. Meaningless in a pack.
  duplicateSource: v =>
    v === "null" ? null : `ships duplicateSource ${v} — a world uuid that resolves nowhere for anyone installing this system`,
  // A block stamped by exportToJSON naming the world, core and system it left
  // (client-document.mjs:935). In a shipped pack it is someone else's world.
  exportSource: v =>
    v === "null" ? null : `ships a non-null exportSource — foreign world/core provenance belongs to whoever exported it, not to this pack`,
};

for (const file of walk(at("src", "packs"), ".yml")) {
  const text = readFile(file);
  for (const [field, check] of Object.entries(SOURCE_FIELDS)) {
    // `(.*)` not `(\S+)`: a non-null exportSource is a BLOCK, so its own line has
    // nothing after the colon. Matching only non-empty values would skip exactly
    // the case worth catching.
    for (const m of text.matchAll(new RegExp(`^[ \\t]*${field}:(.*)$`, "gm"))) {
      const problem = check(m[1].trim());
      if (problem) problems.push(`${path.relative(ROOT, file).replace(/\\/g, "/")} ${problem}`);
    }
  }

  // ...and the same for `ownership`, which toCompendium's clearOwnership strips
  // alongside them. A shipped document may carry `default` and nothing else: a
  // per-user key names a User id from whatever world the document was authored
  // in, which is nobody's world once the system is installed.
  //
  // It is UNREADABLE rather than merely unused, and that is the point — nothing
  // will ever surface it to be noticed. `getUserLevel` short-circuits on
  // `if (this.pack) return this.compendium.getUserLevel(user)`
  // (common/abstract/document.mjs:388), whose docstring says outright that
  // "Compendium content ignores the ownership field in favor of User role-based
  // ownership"; and on the way out, fromCompendium clears ownership by default
  // and, when a caller opts out, keeps only `default` and ids that are real
  // users (world-collection.mjs:119-132). So 586 of these rode along invisibly
  // from the upstream fork's worlds until they were stripped on 2026-08-06.
  // Data that cannot be read is data nothing can correct — hence a gate.
  let ownerIndent = null;
  for (const line of text.split("\n")) {
    if (ownerIndent !== null) {
      const child = line.match(/^(\s*)(\S+):/);
      if (child && child[1].length > ownerIndent) {
        if (child[2] !== "default") {
          problems.push(
            `${path.relative(ROOT, file).replace(/\\/g, "/")} ships ownership for user ${child[2]} ` +
            `— a User id from the authoring world, which exists in nobody else's`
          );
        }
        continue;
      }
      ownerIndent = null;
    }
    const open = line.match(/^(\s*)ownership:\s*$/);
    if (open) ownerIndent = open[1].length;
  }
}

/* -------------------------------------------- */
/*  3. Server-side sanitization declarations      */
/* -------------------------------------------- */

// Declaring an HTMLField in the data model does NOTHING for security: the Foundry
// SERVER never loads module/data-models.js. The only channel telling it which
// system.* paths hold HTML is system.json -> documentTypes.<Doc>.<subtype>.htmlFields
// (common/data/fields.mjs: "it is essential to declare this field in the package
// manifest so that it receives proper server-side validation of its contents").
// Undeclared, the field is stored VERBATIM on every write and a player can XSS the
// GM through their own character's notes. There is no client-side fallback, and
// enrichHTML does not sanitize. So the schema and the manifest must agree, and an
// HTMLField added later must not be able to slip through unlisted.

// `manifest` is parsed further up — the provenance check needs the system id.
const DOC_OF = {
  ...Object.fromEntries(Object.keys(ACTOR_DATA_MODELS).map((t) => [t, "Actor"])),
  ...Object.fromEntries(Object.keys(ITEM_DATA_MODELS).map((t) => [t, "Item"])),
};

for (const [type, cls] of Object.entries({ ...ACTOR_DATA_MODELS, ...ITEM_DATA_MODELS })) {
  const want = htmlPaths(cls.defineSchema());
  const got = new Set(manifest.documentTypes?.[DOC_OF[type]]?.[type]?.htmlFields ?? []);
  for (const p of want) {
    if (!got.has(p)) {
      problems.push(
        `system.json documentTypes.${DOC_OF[type]}.${type}.htmlFields omits "${p}" ` +
        `— that HTMLField is NEVER sanitized server-side`
      );
    }
  }
  for (const p of got) {
    if (!want.has(p)) {
      problems.push(`system.json declares ${DOC_OF[type]}.${type}.htmlFields "${p}" — no such HTMLField in the schema`);
    }
  }
  for (const p of undeclarableHtml(cls.defineSchema())) {
    problems.push(
      `${type} schema puts an HTMLField inside an ArrayField at "${p}" — that path CANNOT be declared in ` +
      `system.json htmlFields, so the server will never sanitize it and this cross-check cannot see it. ` +
      `Clean at the sink with foundry.utils.cleanHTML instead (see cleanDescription in module/utils.js)`
    );
  }
}

/* -------------------------------------------- */
/*  4. Report                                     */
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

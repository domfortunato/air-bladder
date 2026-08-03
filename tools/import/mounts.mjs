#!/usr/bin/env node
/**
 * Author the Mounts & Transports ACTOR pack — every mount, vehicle and worn
 * container as an NPC document, in folders — plus the shop table that
 * references them.
 *
 *   node tools/import/mounts.mjs [--dry]
 *
 * THE ONLY TRANSPORT IMPORTER. There used to be two: transports.mjs authored
 * `transport` Items into a shipped `transports` pack, and this file derived NPC
 * Actors from those Items. The Item pack was the old model's home — a thing
 * with slots as an Item, its stat block as PROSE — and once the Actors carried
 * the real fields it was pure leftover: 13 of its 15 documents were superseded
 * and the compendium sat in the sidebar beside the Actor pack showing stale
 * horses. The user's words: "I don't understand why this is still here and I
 * don't want to see it. I don't want this in the 1.9 release." So the Item
 * pack is GONE (dropped from system.json, src/packs/transports deleted,
 * transports.mjs deleted), and everything it did lives here.
 *
 * WHAT IS HERE. Three folders, fifteen documents:
 *   Containers  Backpack, Sack — the worn shapes. These were deliberately NOT
 *               documents while the Item pack shipped ("a Warden makes one by
 *               picking the class"), but the shop has to reference SOMETHING
 *               to sell, and with the Item rows gone the only honest home is
 *               here — which is also the folder layout the user originally
 *               asked for (Containers / Mounts / Transports).
 *   Mounts      Mule, Horse, and every beast a 2e background grants (the six
 *               Outrider breeds, the Kettlewright/Bonekeeper donkey…).
 *   Transports  Handcart, Cart, Wagon, Burial Wagon.
 *
 * BACKGROUND BEASTS are read straight out of src/packs/backgrounds-2e (so the
 * two can never drift) — each an editable document a Warden can retune, NOT
 * stocked by the shop: you cannot buy a Rivertooth, you roll one. Their stat
 * blocks ("8 HP, 1 Armor") are parsed from the granting option's prose; the
 * prose itself stays beside them as the description (house style: no
 * automation of mechanical text).
 *
 * HP RULE. Stated HP is written; an INANIMATE thing with none is written 0/0
 * explicitly — "author nothing" is not "no HP", NpcData defaults hp to 6/6 and
 * that phantom 6 surfaces the moment anyone unticks Inanimate. A beast with no
 * stated HP keeps the schema default on purpose. `armor` is DERIVED every
 * prepare; `armorOverride` is the field that holds a stated Armor.
 *
 * ART is stamped at authoring time via module/icons.js (the same classifier
 * the runtime uses), which item-icons.mjs proved Node can import. This file
 * used to inherit whatever art the source Items carried at read time, which
 * made it order-dependent on item-icons.mjs — a rerun in the wrong order
 * silently regressed all thirteen icons to Foundry-stock webp. Authoring the
 * icon directly kills that trap.
 *
 * VALUES. Cairn 2e's core book is not open; these are the authoritative OPEN
 * numbers from the Barebones Edition marketplace, as tuned in the fork and
 * signed off there: Horse +4/75gp, Mule +6/30 (slow), Cart +4/30 (bulky),
 * Wagon +8/200 (slow), plus Backpack/Sack/Handcart. Defaults, not scripture —
 * the point of this pack is that a Warden can change them. "Slow" and "bulky"
 * live in the prose now; the npc schema has no such fields and the sheet
 * automates nothing.
 *
 * Run order: barebones.mjs -> marketplace.mjs -> THIS -> table-icons.mjs.
 * marketplace.mjs wipes the whole marketplace table dir, so it must run first
 * or it deletes the shop table written here. Rebuild afterwards:
 * npm run build:packs (stop Foundry first).
 *
 * Re-runnable and byte-stable: both dirs' own docs are rewritten from scratch
 * and every id is a sha256 of a fixed seed, so a rerun with unchanged input
 * produces no diff.
 *
 * Game text: CC BY-SA 4.0, Yochai Gal (attribution required; see README).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { packUuid } from "./uuid.mjs";
import { containerClass, iconForTransport } from "../../module/icons.js";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const load = yaml.load ?? yaml.safeLoad;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = path.join(root, "src", "packs", "mounts-transports");
const dry = process.argv.includes("--dry");

const CATEGORY = "Transports & Containers";

// name, kind (worn | mount | vehicle), slots (capacity it HOLDS), cost, description.
// The shop stocks exactly these, in this order (the table rows below).
const TRANSPORTS = [
  {
    name: "Backpack", kind: "worn", slots: 4, cost: 10,
    description: "A sturdy pack worn on the back. Holds four slots of gear or Fatigue. Every adventurer starts with one — this is a spare.",
  },
  {
    name: "Sack", kind: "worn", slots: 2, cost: 10,
    description: "A plain cloth sack for hauling loose goods. Easy to carry, and easy to drop and run.",
  },
  {
    name: "Mule", kind: "mount", slots: 6, cost: 30,
    description: "A stubborn but tireless pack animal. Carries six slots of gear, and sets its own unhurried pace (slow).",
  },
  {
    name: "Horse", kind: "mount", slots: 4, cost: 75,
    description: "A riding horse. Bears four slots of gear and covers open ground quickly.",
  },
  {
    name: "Handcart", kind: "vehicle", slots: 4, cost: 15,
    description: "A small cart pulled by hand. Holds four slots — no beast required, but you are the one doing the hauling.",
  },
  {
    name: "Cart", kind: "vehicle", slots: 4, cost: 30,
    description: "A two-wheeled cart, pulled by hand or beast. Holds four slots; bulky and awkward over rough country.",
  },
  {
    name: "Wagon", kind: "vehicle", slots: 8, cost: 200,
    description: "A large four-wheeled wagon. Hauls eight slots of gear, but needs a beast to draw it and travels slow.",
  },
];

/**
 * Every container a 2e background can grant, read out of the background pack so
 * this list can never drift from the data that grants it. Each becomes an
 * editable NPC document; the shop never stocks them.
 * @returns {Array} the TRANSPORTS shape, plus `from` (the granting background)
 */
const backgroundContainers = () => {
  const dir = path.join(root, "src", "packs", "backgrounds-2e");
  if (!fs.existsSync(dir)) return [];
  const out = new Map();                     // by lowercased name — first wins
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    const bg = load(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const table of bg?.system?.tables ?? []) {
      for (const opt of table.options ?? []) {
        for (const c of opt.containers ?? []) {
          if (!c.name) continue;
          const key = String(c.name).toLowerCase();
          // The same beast can be granted by more than one background (both the
          // Bonekeeper and the Kettlewright start with a donkey). Keep one
          // document and record every background that hands it out.
          if (out.has(key)) { out.get(key).from.push(bg.name); continue; }
          // Outrider's options open with the breed's own name; don't repeat it.
          const prose = String(opt.description ?? "").trim()
            .replace(new RegExp(`^${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i"), "");
          out.set(key, {
            name: c.name,
            // A wagon/cart is drawn; a donkey or a horse breed is ridden or led.
            kind: /\b(wagon|cart|sled|sledge)\b/i.test(c.name) ? "vehicle" : "mount",
            slots: c.slots ?? 0,
            cost: 0,          // not for sale — rolled, not bought
            // The option's own prose is the beast's mechanics (HP, armor, hooves,
            // terrain). Kept as text, per house style — nothing is automated.
            prose,
            from: [bg.name],
          });
        }
      }
    }
  }
  // A beast several backgrounds grant gets a neutral line instead of one of their
  // descriptions, which would credit the wrong background on the other's sheet.
  const list = (names) => names.length <= 1 ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return [...out.values()].map((b) => ({
    ...b,
    description: b.from.length > 1
      ? `Granted by the ${list(b.from)} backgrounds. Carries ${b.slots} slots.`
      : `From the ${b.from[0]} background. ${b.prose}`,
  }));
};

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const idFor = (seed) => [...crypto.createHash("sha256").update(seed).digest().subarray(0, 16)]
  .map((b) => ALPHA[b % ALPHA.length]).join("");

const y = (s) => {
  const str = String(s);
  if (str === "") return "''";
  if (/[:#{}\[\],&*?|<>=!%@`'"]/.test(str) || /^\s|\s$/.test(str) || /^[-?]/.test(str)) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return str;
};

/** "8 HP, 1 Armor" -> {hp: 8, armor: 1}. Absent is absent, never invented. */
const statsFromProse = (text) => ({
  hp: Number((text.match(/(\d+)\s*HP\b/i) ?? [])[1]) || null,
  armor: Number((text.match(/(\d+)\s*Armou?r\b/i) ?? [])[1]) || null,
});

/* ---- emit -------------------------------------------------------------- */

const FOLDERS = [
  { key: "containers", name: "Containers", seed: "air-bladder-folder:containers" },
  { key: "mounts", name: "Mounts", seed: "air-bladder-folder:mounts" },
  { key: "transports", name: "Transports", seed: "air-bladder-folder:transports" },
];

const folderYaml = (f, id) => [
  `_id: ${id}`,
  `name: ${y(f.name)}`,
  "type: Actor",
  "description: ''",
  "folder: null",
  "sorting: a",
  "sort: 0",
  "color: null",
  "flags: {}",
  "_stats:",
  "  systemId: air-bladder",
  "  coreVersion: '14.365'",
  `_key: '!folders!${id}'`,
  "",
].join("\n");

const actorYaml = (t, id, folderId) => {
  // module/icons.js is the single classifier: the same call decides the class
  // the sheet shows and the art the token draws, so they cannot disagree.
  const cls = containerClass(t.name, t.kind);
  const img = iconForTransport(t.name, t.kind);
  const { hp, armor } = statsFromProse(t.description);
  // Role by kind, matching the pack's three folders: worn shapes are
  // containers, vehicles are transports, only a mount is a creature.
  const role = t.kind === "mount" ? "mount" : t.kind === "vehicle" ? "transport" : "container";
  const lines = [
    `_id: ${id}`,
    `name: ${y(t.name)}`,
    "type: npc",
    `img: ${y(img)}`,
    "prototypeToken:",
    `  name: ${y(t.name)}`,
    `  texture:`,
    `    src: ${y(img)}`,
    "items: []",
    "effects: []",
    `folder: ${folderId}`,
    "sort: 0",
    "flags:",
    "  air-bladder:",
    `    transportSource: ${t.from ? "background-2e" : "2e"}`,
    "system:",
    `  description: ${y(t.description)}`,
    // HP only when the book states one — see the HP RULE in the header. A
    // thing-role row with none is written 0/0 explicitly, or the schema default
    // hands a cart six hit points.
    ...(hp ? ["  hp:", `    value: ${hp}`, `    max: ${hp}`]
      : role !== "mount" ? ["  hp:", "    value: 0", "    max: 0"] : []),
    // `armor` is DERIVED every prepare from worn gear, so an authored value never
    // survives; `armorOverride` is the field that actually holds a stated Armor.
    ...(armor ? [`  armorOverride: ${armor}`] : []),
    `  slots: ${t.slots}`,
    `  cost: ${t.cost}`,
    `  containerClass: ${cls}`,
    `  role: ${role}`,
    // These are not rollable NPCs -- "Roll NPC" would overwrite a book statblock.
    "  generationEnabled: false",
    "ownership:",
    "  default: 0",
    "_stats:",
    "  systemId: air-bladder",
    "  coreVersion: '14.365'",
    `_key: '!actors!${id}'`,
    "",
  ];
  return lines.join("\n");
};

const tableYaml = (refs) => {
  const tid = idFor(`air-bladder-market-table:${CATEGORY}`);
  const results = refs.map((ref, i) => {
    const rid = idFor(`air-bladder-market-result:${CATEGORY}:${i}:${ref.text}`);
    return [
      `  - _id: ${rid}`,
      // See marketplace.mjs: `pack` and `text` are both v15 removals.
      "    type: document",
      `    name: ${y(ref.text)}`,
      `    img: ${y(ref.img)}`,
      "    weight: 1",
      "    range:",
      `      - ${i + 1}`,
      `      - ${i + 1}`,
      "    drawn: false",
      `    documentUuid: ${packUuid("air-bladder.mounts-transports", ref.documentId)}`,
      "    flags: {}",
      `    _key: '!tables.results!${tid}.${rid}'`,
    ].join("\n");
  });
  return [
    `_id: ${tid}`,
    `name: ${y(`Market: ${CATEGORY}`)}`,
    "img: icons/svg/d20-grey.svg",
    `description: ${y(`Air Bladder marketplace — ${CATEGORY}. Drag a mount or container in to stock it; capacity and price are read off the document. Buying one creates an NPC connected to the buyer.`)}`,
    "results:",
    ...results,
    `formula: 1d${Math.max(refs.length, 1)}`,
    "replacement: true",
    "displayRoll: true",
    "flags: {}",
    "folder: null",
    "sort: 0",
    "ownership:",
    "  default: 0",
    "_stats:",
    "  systemId: air-bladder",
    "  coreVersion: '14.365'",
    `_key: '!tables!${tid}'`,
    "",
  ].join("\n");
};

/* ---- run --------------------------------------------------------------- */

if (!dry) fs.mkdirSync(outDir, { recursive: true });

// Wipe first so a renamed or retired document cannot linger.
if (!dry && fs.existsSync(outDir)) {
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
}

const folderIds = {};
for (const f of FOLDERS) {
  const id = idFor(f.seed);
  folderIds[f.key] = id;
  const file = `${f.name.replace(/\W+/g, "_")}_${id}.yml`;
  console.log(`  +    ${file}   (folder)`);
  if (!dry) fs.writeFileSync(path.join(outDir, file), folderYaml(f, id), "utf8");
}

const folderFor = (t) =>
  t.kind === "worn" ? "containers" : t.kind === "vehicle" ? "transports" : "mounts";

// The id seed is unchanged from when this file DERIVED its documents from the
// old Item pack ("air-bladder-mount:" + name), deliberately: the market table
// and the Barebones Cart/Wagon rows reference these ids, and a re-seed would
// orphan every one of them.
const write = (t) => {
  const id = idFor(`air-bladder-mount:${t.name}`);
  const file = `${t.name.replace(/\W+/g, "_")}_${id}.yml`;
  const { hp, armor } = statsFromProse(t.description);
  console.log(`  +    ${file.padEnd(46)} ${folderFor(t).padEnd(10)} slots=${String(t.slots).padEnd(2)}`
    + ` hp=${hp ?? "-"} armor=${armor ?? "-"}`);
  if (!dry) fs.writeFileSync(path.join(outDir, file), actorYaml(t, id, folderIds[folderFor(t)]), "utf8");
  return id;
};

const refs = [];
for (const t of TRANSPORTS) {
  refs.push({ text: t.name, img: iconForTransport(t.name, t.kind), documentId: write(t) });
}

// The background beasts share the pack but stay OUT of `refs`, so they are
// editable documents the shop does not stock. A beast whose name collides with
// a shop transport (a plain "Cart") already has a document; don't author a
// second one over it.
const beasts = backgroundContainers();
const stocked = new Set(TRANSPORTS.map((t) => t.name.toLowerCase()));
const newBeasts = beasts.filter((b) => !stocked.has(b.name.toLowerCase()));
for (const b of newBeasts) write(b);

// ---- the shop table ----
const marketDir = path.join(root, "src", "packs", "marketplace");
const tableFile = path.join(marketDir, `Market_${CATEGORY.replace(/[^A-Za-z0-9]+/g, "_")}.yml`);
if (!dry) {
  fs.mkdirSync(marketDir, { recursive: true });
  fs.writeFileSync(tableFile, tableYaml(refs), "utf8");
}

const worn = TRANSPORTS.filter((t) => t.kind === "worn").length;
const vehicles = TRANSPORTS.filter((t) => t.kind === "vehicle").length + newBeasts.filter((b) => b.kind === "vehicle").length;
const mounts = TRANSPORTS.length + newBeasts.length - worn - vehicles;
console.log(`\n${worn} worn container(s), ${mounts} mount(s), ${vehicles} vehicle(s), ${FOLDERS.length} folder(s)`);
console.log(`shop stocks ${refs.length}; ${newBeasts.length} background beast(s) not stocked`);
console.log(`${dry ? "[dry] would write" : "wrote"} ${path.relative(root, tableFile)}`);
if (dry) console.log("(dry run — nothing written)");

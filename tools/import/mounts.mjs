#!/usr/bin/env node
/**
 * Author the mounts and vehicles as NPC ACTORS, in folders, from the transport
 * Items that used to stand in for them.
 *
 *   node tools/import/mounts.mjs [--dry]
 *
 * WHY THEY MOVED. A `transport` Item has nowhere to put a stat block, so the
 * Outrider's six breeds carried theirs as PROSE — "8 HP, 1 Armor, hooves
 * (d10+d10), +2 slots" inside the description — and the container Actor a
 * purchase minted had no hp field either. A warhorse the party rides into a
 * fight could not be hit, because of a type choice rather than a rules one.
 * As NPCs they get real fields, and the prose stays as prose beside them (house
 * style: no automation of mechanical text).
 *
 * WHAT IS HERE AND WHAT IS NOT. Only things that carry themselves: the six
 * breeds, the three beasts, the four vehicles. Backpack and Sack are deliberately
 * absent — they have no authored content, nothing but a shape and a capacity, so
 * they are rows in CONTAINER_CLASSES (module/icons.js) rather than documents. A
 * Warden makes one by creating a container and picking "Sack"; shipping a
 * document for it would be shipping a table row with extra steps.
 *
 * SOURCE OF TRUTH is still src/packs/transports/*.yml, so the numbers cannot
 * drift from what the shop and the backgrounds already use, and the six breeds
 * still trace back through THAT importer to src/packs/backgrounds-2e. Editing
 * this file's output by hand is pointless — rerun instead.
 *
 * Re-runnable and byte-stable: every id is a sha256 of a fixed seed, so a rerun
 * with unchanged input produces no diff.
 *
 * Run AFTER tools/import/transports.mjs (which authors the input) AND after
 * tools/import/item-icons.mjs: this pack is not in item-icons' own list — the
 * Actor docs inherit whatever art the source Items carry at read time, so a run
 * before the stamp silently regresses every icon here to the Foundry-stock webp
 * the TRANSPORTS table names. item-icons' "name collisions across doc packs"
 * warning naming Cart/Horse/etc. is the symptom that this happened.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(root, "src", "packs", "transports");
const outDir = path.join(root, "src", "packs", "mounts-transports");
const dry = process.argv.includes("--dry");

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const idFor = (seed) => [...crypto.createHash("sha256").update(seed).digest().subarray(0, 16)]
  .map((b) => ALPHA[b % ALPHA.length]).join("");

/** Quote a scalar the way the other importers do. */
const y = (str) => {
  if (str === "" || /[:#'"\n{}[\]&*?|>%@`]|^\s|\s$/.test(String(str))) {
    return `'${String(str).replace(/'/g, "''")}'`;
  }
  return String(str);
};

/* ---- read the transport Items ------------------------------------------- */

/** Deliberately tiny: these files are emitted by transports.mjs in one shape. */
const readTransport = (file) => {
  const s = fs.readFileSync(path.join(srcDir, file), "utf8");
  const pick = (re) => (s.match(re) ?? [])[1];
  const raw = pick(/^  description: (.*)$/m) ?? "";
  const description = raw.startsWith("'")
    ? raw.slice(1, -1).replace(/''/g, "'")
    : raw;
  return {
    name: (pick(/^name: (.*)$/m) ?? "").replace(/^'|'$/g, "").replace(/''/g, "'"),
    img: pick(/^img: (.*)$/m) ?? "",
    description,
    kind: pick(/^  transportKind: (.*)$/m) ?? "",
    slots: Number(pick(/^  slots: (.*)$/m) ?? 0),
    cost: Number(pick(/^  cost: (.*)$/m) ?? 0),
    fromBackground: /transportSource: background-2e/.test(s),
  };
};

/**
 * Which CONTAINER_CLASSES key a thing is. Mirrors module/icons.js containerClass
 * for the names that actually ship here; the named breeds carry no give-away
 * word, so a mount falls through to "horse" exactly as the runtime does.
 */
const classOf = (name, kind) => {
  const n = name.toLowerCase();
  if (n.includes("handcart")) return "handcart";
  if (n.includes("cart")) return "cart";
  if (n.includes("wagon")) return "wagon";
  if (n.includes("mule")) return "mule";
  if (n.includes("donkey")) return "donkey";
  if (n.includes("horse")) return "horse";
  return kind === "vehicle" ? "wagon" : "horse";
};

/** "8 HP, 1 Armor" -> {hp: 8, armor: 1}. Absent is absent, never invented. */
const statsFromProse = (text) => ({
  hp: Number((text.match(/(\d+)\s*HP\b/i) ?? [])[1]) || null,
  armor: Number((text.match(/(\d+)\s*Armou?r\b/i) ?? [])[1]) || null,
});

/* ---- emit -------------------------------------------------------------- */

const FOLDERS = [
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
  const cls = classOf(t.name, t.kind);
  const { hp, armor } = statsFromProse(t.description);
  const inanimate = t.kind === "vehicle";
  const lines = [
    `_id: ${id}`,
    `name: ${y(t.name)}`,
    "type: npc",
    `img: ${y(t.img)}`,
    "prototypeToken:",
    `  name: ${y(t.name)}`,
    `  texture:`,
    `    src: ${y(t.img)}`,
    "items: []",
    "effects: []",
    `folder: ${folderId}`,
    "sort: 0",
    "flags:",
    "  air-bladder:",
    `    transportSource: ${t.fromBackground ? "background-2e" : "2e"}`,
    "system:",
    `  description: ${y(t.description)}`,
    // HP only when the book states one. A cart has none and must not be given a
    // made-up number just to fill the field -- but "author nothing" is not the
    // same as "no HP": NpcData defaults hp to 6/6, so leaving it out gave every
    // cart and wagon six hit points. Invisible while `inanimate` hides the block,
    // and a phantom 6 the moment anyone unticks it. So an inanimate thing is
    // written as 0/0 explicitly, and a beast with no stated HP keeps the default.
    ...(hp ? ["  hp:", `    value: ${hp}`, `    max: ${hp}`]
      : inanimate ? ["  hp:", "    value: 0", "    max: 0"] : []),
    // `armor` is DERIVED every prepare from worn gear, so an authored value never
    // survives; `armorOverride` is the field that actually holds a stated Armor.
    ...(armor ? [`  armorOverride: ${armor}`] : []),
    `  slots: ${t.slots}`,
    `  cost: ${t.cost}`,
    `  containerClass: ${cls}`,
    `  inanimate: ${inanimate}`,
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

/* ---- run --------------------------------------------------------------- */

if (!fs.existsSync(srcDir)) throw new Error(`no transports source at ${srcDir}`);
if (!dry) fs.mkdirSync(outDir, { recursive: true });

// Wipe first so a renamed or retired document cannot linger. Same reason
// marketplace.mjs wipes its table dir.
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

let mounts = 0;
let vehicles = 0;
const skipped = [];
for (const file of fs.readdirSync(srcDir).sort()) {
  if (!file.endsWith(".yml")) continue;
  const t = readTransport(file);
  // `worn` is Backpack and Sack: shapes, not documents. See the header.
  if (t.kind === "worn") { skipped.push(t.name); continue; }
  const folderKey = t.kind === "vehicle" ? "transports" : "mounts";
  if (folderKey === "mounts") mounts++; else vehicles++;
  const id = idFor(`air-bladder-mount:${t.name}`);
  const out = `${t.name.replace(/\W+/g, "_")}_${id}.yml`;
  const { hp, armor } = statsFromProse(t.description);
  console.log(`  +    ${out.padEnd(46)} ${folderKey.padEnd(10)} slots=${String(t.slots).padEnd(2)}`
    + ` hp=${hp ?? "-"} armor=${armor ?? "-"}`);
  if (!dry) fs.writeFileSync(path.join(outDir, out), actorYaml(t, id, folderIds[folderKey]), "utf8");
}

console.log(`\n${mounts} mount(s), ${vehicles} vehicle(s), 2 folder(s)`);
console.log(`skipped (they are CONTAINER_CLASSES rows, not documents): ${skipped.join(", ") || "none"}`);
if (dry) console.log("(dry run — nothing written)");

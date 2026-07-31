#!/usr/bin/env node
/**
 * Author the transports & containers as EDITABLE documents, plus the shop table
 * that references them.
 *
 *   node tools/import/transports.mjs [--dry]
 *
 * A transport is a thing with its own slots: a worn pack, a beast of burden, or a
 * vehicle. The fork kept these as inlined entries in marketplace-catalog.json, so
 * a Warden could not retune a mule's capacity without editing a shipped JSON file
 * — the exact duplication this rebuild removes. Here each is a real `transport`
 * Item in the `transports` pack, carrying its own transportKind / slots / load /
 * cost / description, and the shop REFERENCES it by name like every other row.
 * Edit the Mule's slots in Foundry and the next one bought reflects it.
 *
 * The three fields that matter:
 *   transportKind  worn | mount | vehicle
 *   slots          capacity it HOLDS
 *   load           footprint it COSTS its carrier (worn only; 0 for mount/vehicle)
 *
 * `load` is what distinguishes a backpack from a mule: a worn container is
 * strapped to you and costs `load` of your own ten slots (while giving back more
 * than it takes); a mount or vehicle travels alongside and costs you nothing.
 *
 * Buying one mints a CONTAINER ACTOR keeper-linked to the buyer (see
 * module/marketplace.js acquireTransport) — a thing with its own slots has to be
 * an Actor in this system.
 *
 * VALUES. Cairn 2e's core book is not open; these are the authoritative OPEN
 * numbers from the Barebones Edition marketplace, as tuned in the fork and signed
 * off there: Horse +4/75gp, Mule +6/30 (slow), Cart +4/30 (bulky), Wagon +8/200
 * (slow), plus a Backpack/Sack/Handcart. They are defaults, not scripture — the
 * point of this pack is that a Warden can change them.
 *
 * BACKGROUND BEASTS. Three 2e backgrounds grant a container from a choice table —
 * Kettlewright's donkey, Bonekeeper's burial wagon and donkey, and every one of
 * Outrider's six horse breeds. Those are read straight out of src/packs/
 * backgrounds-2e (so the two can never drift) and authored into this same pack,
 * making each beast an editable document a Warden can retune. They are NOT
 * referenced by the shop table: you cannot buy a Rivertooth, you roll one.
 * Generation resolves a grant by name here and falls back to the background's own
 * numbers if it finds nothing (module/character-generator.js grantContainers).
 *
 * Run order: barebones.mjs -> marketplace.mjs -> THIS -> item-icons.mjs ->
 * mounts.mjs -> table-icons.mjs. marketplace.mjs wipes the whole marketplace table
 * dir, so it must run first or it will delete the shop table written here.
 * mounts.mjs runs after because it derives the NPC Actors (pack `mounts-transports`)
 * that this table's mount/vehicle rows reference — the ids are deterministic, so
 * referencing forward is safe, and check:refs catches a run that stopped short —
 * and it must come after item-icons.mjs or the Actor docs inherit unstamped art
 * (see the mounts.mjs header). Rebuild afterwards: npm run build:packs (stop
 * Foundry first).
 *
 * Idempotent: both dirs' own docs are rewritten from scratch and every id is
 * name-hashed, so a rerun is byte-identical.
 *
 * Game text: CC BY-SA 4.0, Yochai Gal (attribution required; see README).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { packUuid } from "./uuid.mjs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const load = yaml.load ?? yaml.safeLoad;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry");

const CATEGORY = "Transports & Containers";
const PACK = "transports";

// name, kind, slots (holds), load (costs carrier), cost, bulky, slow, img, description
const TRANSPORTS = [
  {
    name: "Backpack", transportKind: "worn", slots: 4, load: 1, cost: 10,
    img: "icons/containers/bags/pack-leather-brown.webp",
    description: "A sturdy pack worn on the back. Holds four slots of gear or Fatigue. Every adventurer starts with one — this is a spare.",
  },
  {
    name: "Sack", transportKind: "worn", slots: 2, load: 1, cost: 10,
    img: "icons/containers/bags/sack-cloth-tan.webp",
    description: "A plain cloth sack for hauling loose goods. Easy to carry, and easy to drop and run.",
  },
  {
    name: "Mule", transportKind: "mount", slots: 6, load: 0, cost: 30, slow: true,
    img: "icons/environment/creatures/horse-tan.webp",
    description: "A stubborn but tireless pack animal. Carries six slots of gear, and sets its own unhurried pace (slow).",
  },
  {
    name: "Horse", transportKind: "mount", slots: 4, load: 0, cost: 75,
    img: "icons/environment/creatures/horse-brown.webp",
    description: "A riding horse. Bears four slots of gear and covers open ground quickly.",
  },
  {
    // Bulky, like the Cart it is a smaller cousin of (fixed in 22ca7f3, but only
    // in the pack YAML — a rerun silently un-fixed it until this line existed).
    name: "Handcart", transportKind: "vehicle", slots: 4, load: 0, cost: 15, bulky: true,
    img: "icons/environment/settlement/wagon.webp",
    description: "A small cart pulled by hand. Holds four slots — no beast required, but you are the one doing the hauling.",
  },
  {
    name: "Cart", transportKind: "vehicle", slots: 4, load: 0, cost: 30, bulky: true,
    img: "icons/environment/settlement/wagon-black.webp",
    description: "A two-wheeled cart, pulled by hand or beast. Holds four slots; bulky and awkward over rough country.",
  },
  {
    name: "Wagon", transportKind: "vehicle", slots: 8, load: 0, cost: 200, slow: true,
    img: "icons/environment/settlement/wagon.webp",
    description: "A large four-wheeled wagon. Hauls eight slots of gear, but needs a beast to draw it and travels slow.",
  },
];

/**
 * Every container a 2e background can grant, read out of the background pack so
 * this list can never drift from the data that grants it. Each becomes an
 * editable transport document; the shop never stocks them.
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
            transportKind: /\b(wagon|cart|sled|sledge)\b/i.test(c.name) ? "vehicle" : "mount",
            slots: c.slots ?? 0,
            load: 0,          // it travels alongside; only a WORN pack costs slots
            cost: 0,          // not for sale — rolled, not bought
            img: /\b(wagon|cart)\b/i.test(c.name)
              ? "icons/environment/settlement/wagon.webp"
              : "icons/environment/creatures/horse-brown.webp",
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

const y = (s) => {
  const str = String(s);
  if (str === "") return "''";
  if (/[:#{}\[\],&*?|<>=!%@`'"]/.test(str) || /^\s|\s$/.test(str) || /^[-?]/.test(str)) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return str;
};

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const idFor = (seed) => [...crypto.createHash("sha256").update(seed).digest().subarray(0, 16)]
  .map((b) => ALPHA[b % ALPHA.length]).join("");

const itemYaml = (t, id) => [
  `_id: ${id}`,
  `name: ${y(t.name)}`,
  "type: transport",
  `img: ${y(t.img)}`,
  "effects: []",
  "folder: null",
  "sort: 0",
  "flags:",
  "  air-bladder:",
  `    transportSource: ${t.from ? "background-2e" : "2e"}`,
  "system:",
  `  description: ${y(t.description)}`,
  "  weightless: false",
  "  equipped: false",
  `  bulky: ${!!t.bulky}`,
  `  cost: ${t.cost}`,
  "  quantity: 1",
  `  transportKind: ${t.transportKind}`,
  `  slots: ${t.slots}`,
  `  load: ${t.load}`,
  `  slow: ${!!t.slow}`,
  "ownership:",
  "  default: 0",
  "_stats:",
  "  systemId: air-bladder",
  "  coreVersion: '14.365'",
  `_key: '!items!${id}'`,
  "",
].join("\n");

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
      `    documentUuid: ${packUuid(ref.documentCollection, ref.documentId)}`,
      "    flags: {}",
      `    _key: '!tables.results!${tid}.${rid}'`,
    ].join("\n");
  });
  return [
    `_id: ${tid}`,
    `name: ${y(`Market: ${CATEGORY}`)}`,
    "img: icons/svg/d20-grey.svg",
    `description: ${y(`Air Bladder marketplace — ${CATEGORY}. Drag a transport in to stock it; capacity and price are read off the document. Buying one creates a container Actor owned by the buyer.`)}`,
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

// ---- author the transport documents ----
const packDir = path.join(root, "src", "packs", PACK);
if (!dry) {
  fs.mkdirSync(packDir, { recursive: true });
  // The pack is ours entirely — wipe it whole so a rename never orphans a doc.
  for (const f of fs.readdirSync(packDir).filter((f) => f.endsWith(".yml"))) {
    fs.rmSync(path.join(packDir, f));
  }
}

const write = (t) => {
  const id = idFor(`air-bladder-transport:${t.name}`);
  const file = `${t.name.replace(/[^A-Za-z0-9]+/g, "_")}_${id}.yml`;
  if (!dry) fs.writeFileSync(path.join(packDir, file), itemYaml(t, id), "utf8");
  return id;
};

const refs = [];
for (const t of TRANSPORTS) {
  const itemId = write(t);
  // The shop row points at the document that buying it MINTS FROM. Mounts and
  // vehicles are NPC Actors now (mounts.mjs derives them from the Items written
  // above), so their rows reference the Actor pack — the Actor is where the stat
  // block lives, and a row still pointing at the Item fed the shop a document
  // with no hp and no `inanimate`, which is how the new pack shipped stocked by
  // nothing (review #5, critical). Backpack and Sack stay Item rows on purpose:
  // worn containers are CONTAINER_CLASSES shapes, not documents, so there is no
  // Actor to point at.
  //
  // The id seed MUST match mounts.mjs idFor("air-bladder-mount:" + name) — this
  // runs before mounts.mjs, so the reference is to a document the NEXT importer
  // writes. Run out of order and check:refs catches the dangling uuid.
  refs.push(t.transportKind === "worn"
    ? { text: t.name, img: t.img, documentCollection: `air-bladder.${PACK}`, documentId: itemId }
    : { text: t.name, img: t.img, documentCollection: "air-bladder.mounts-transports", documentId: idFor(`air-bladder-mount:${t.name}`) });
}

// The background beasts are authored into the same pack but stay OUT of `refs`,
// so they are editable documents that the shop does not stock.
const beasts = backgroundContainers();
// A background name that collides with a shop transport (a plain "Cart") already
// has a document; don't author a second one over it.
const stocked = new Set(TRANSPORTS.map((t) => t.name.toLowerCase()));
const newBeasts = beasts.filter((b) => !stocked.has(b.name.toLowerCase()));
for (const b of newBeasts) write(b);

// ---- author the shop table that references them ----
const marketDir = path.join(root, "src", "packs", "marketplace");
const tableFile = path.join(marketDir, `Market_${CATEGORY.replace(/[^A-Za-z0-9]+/g, "_")}.yml`);
if (!dry) {
  fs.mkdirSync(marketDir, { recursive: true });
  fs.writeFileSync(tableFile, tableYaml(refs), "utf8");
}

console.log(`${dry ? "[dry] would write" : "wrote"} ${TRANSPORTS.length} transports -> src/packs/${PACK}/`);
for (const t of TRANSPORTS) {
  const tags = [t.transportKind, t.bulky ? "bulky" : null, t.slow ? "slow" : null].filter(Boolean).join(", ");
  console.log(`  ${t.name.padEnd(9)} +${t.slots} slots, load ${t.load}, ${t.cost}gp  (${tags})`);
}
console.log(`${dry ? "[dry] would write" : "wrote"} ${newBeasts.length} background beasts -> src/packs/${PACK}/ (not stocked in the shop)`);
for (const b of newBeasts) {
  console.log(`  ${b.name.padEnd(18)} +${b.slots} slots  (${b.transportKind}, from ${b.from.join(" + ")})`);
}
console.log(`${dry ? "[dry] would write" : "wrote"} ${path.relative(root, tableFile)}`);

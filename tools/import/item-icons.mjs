#!/usr/bin/env node
/**
 * Stamp every pool item / monster with its class icon (game-icons.net, CC BY 3.0,
 * shipped in icons/). This is the author-time counterpart to module/icons.js: it
 * rewrites the top-level `img:` line of each Item/Actor doc under src/packs/ using
 * the SAME mapping the runtime uses, so a browsed compendium entry, a generated
 * character's gear, and a hand-made item all show the same picture.
 *
 * Surgical + idempotent: it parses each doc to read type/name/transportKind, but
 * rewrites ONLY the single column-0 `img:` line (nested result/effect images are
 * indented and untouched), so a re-run on already-stamped packs is a no-op. Run
 * it after any pack re-import, then `npm run build:packs`.
 *
 *   node tools/import/item-icons.mjs [--dry]
 *
 * RollTable packs are left alone. The two background packs ARE stamped — type
 * "background" maps to the fractured-heart background icon.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { iconForItem, iconForTransport, iconForActor, ICON_DIR, TOOLS_ICON } from "../../module/icons.js";

const YAML = createRequire(import.meta.url)("js-yaml");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRY = process.argv.includes("--dry");

// Item + Actor packs. Every RollTable pack is excluded.
const ITEM_PACKS = ["armor", "weapons", "spellbooks", "more-spellbooks", "tools",
  "expeditionary-gear", "market-goods", "trinkets", "transports",
  "background-items", "backgrounds-2e", "backgrounds-barebones"];
const ACTOR_PACKS = ["monsters"];

/** The class icon for a doc, given its pack. Mirrors module/icons.js. */
const iconForDoc = (pack, doc) => {
  if (ACTOR_PACKS.includes(pack)) return iconForActor(doc.type, doc.name);
  if (pack === "tools") return TOOLS_ICON;                              // whole pack is tools
  if (pack === "transports") return iconForTransport(doc.name, doc.system?.transportKind);
  return iconForItem(doc.type, doc.name);                              // null for backgrounds
};

let changed = 0, skipped = 0, missing = 0;
const byIcon = {};

for (const pack of [...ITEM_PACKS, ...ACTOR_PACKS]) {
  const dir = path.join(ROOT, "src", "packs", pack);
  if (!fs.existsSync(dir)) { console.warn(`(missing pack dir: ${dir})`); continue; }
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
    const full = path.join(dir, file);
    const raw = fs.readFileSync(full, "utf8");
    const doc = YAML.load(raw);
    if (!doc || typeof doc !== "object") continue;
    const want = iconForDoc(pack, doc);
    if (!want) { skipped++; continue; }
    byIcon[want] = (byIcon[want] || 0) + 1;

    const lines = raw.split(/\r?\n/);
    const i = lines.findIndex((l) => /^img:\s/.test(l));
    if (i < 0) { missing++; console.warn(`  no top-level img in ${pack}/${file}`); continue; }
    if (lines[i] === `img: ${want}`) { continue; }                     // already stamped
    lines[i] = `img: ${want}`;
    if (!DRY) fs.writeFileSync(full, lines.join("\n"), "utf8");
    changed++;
  }
}

console.log(`\n${DRY ? "[dry] " : ""}icon assignments:`);
for (const [icon, n] of Object.entries(byIcon).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(4)}  ${icon}`);
console.log(`\n${DRY ? "would change" : "changed"}: ${changed}  |  skipped (no icon): ${skipped}  |  missing img line: ${missing}`);

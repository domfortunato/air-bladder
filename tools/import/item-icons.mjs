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
 * IT NEVER OVERWRITES ART CHOSEN BY HAND. Everything this classifier can produce
 * lives under ICON_DIR, so an `img:` pointing anywhere else — a `game-icons/`
 * glyph picked in Foundry, a portrait, an upload — is somebody's decision and is
 * left alone. That is what makes assigning icons in the compendium and running
 * `npm run extract:packs` a durable workflow rather than a change one re-import
 * silently reverts. `--force` restores the old blanket restamp.
 *
 *   node tools/import/item-icons.mjs [--dry] [--force]
 *
 * RollTable packs are left alone. The two background packs ARE stamped — type
 * "background" maps to the fractured-heart background icon.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { iconForItem, iconForActor, TOOLS_ICON, ICON_DIR } from "../../module/icons.js";

const YAML = createRequire(import.meta.url)("js-yaml");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRY = process.argv.includes("--dry");
// Restore the pre-2026-08-01 blanket restamp, overwriting hand-picked art too.
// For a deliberate reset of the whole set, never for a routine re-import.
const FORCE = process.argv.includes("--force");

// Item + Actor packs. Every RollTable pack is excluded.
// `reliquary` is stamped like any other item pack, which is the point of relics
// being a FLAG rather than a type: iconForItem sees `weapon`/`armor`/`item` and
// hands a relic sword the sword and a relic helm the shield, with no relic-specific
// art to invent. (Obliteration Scroll gets the scroll icon off its name, too.)
const ITEM_PACKS = ["armor", "weapons", "spellbooks", "more-spellbooks", "tools",
  "expeditionary-gear", "market-goods", "trinkets", "reliquary",
  "background-items", "backgrounds-2e", "backgrounds-barebones"];
// mounts-transports is NOT here: its importer (mounts.mjs) stamps art at
// authoring time via the same module/icons.js classifier, precisely so this
// file's run order stops mattering to it. The legacy `transports` Item pack
// this list used to name is gone entirely — dissolved into the Actor pack.
const ACTOR_PACKS = ["monsters"];

/** The class icon for a doc, given its pack. Mirrors module/icons.js. */
const iconForDoc = (pack, doc) => {
  if (ACTOR_PACKS.includes(pack)) return iconForActor(doc.type, doc.name);
  if (pack === "tools") return TOOLS_ICON;                              // whole pack is tools
  return iconForItem(doc.type, doc.name);                              // null for backgrounds
};

let changed = 0, skipped = 0, missing = 0, kept = 0;
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

    // A HAND-PICKED icon is never overwritten. Every path this classifier can
    // produce goes through `P()` and therefore lives under module/icons.js's
    // ICON_DIR — so an `img:` pointing anywhere else was chosen by a person,
    // in Foundry, on purpose, and re-deriving it from a keyword table would
    // silently throw that choice away. That is not hypothetical: this script
    // rewrites the img of every doc in fourteen packs from the classifier
    // alone, so before this guard the ONLY safe place for a bespoke icon was
    // nowhere. `game-icons/` (1,539 glyphs, CC BY 3.0) is the folder a Warden
    // actually picks from, and no classifier output can ever collide with it.
    //
    // Deliberately keyed on "outside ICON_DIR" rather than on "inside
    // game-icons/": a portrait, a custom upload and a module's art are all
    // equally somebody's decision, and none of them is this table's to revise.
    // `--force` restores the old blanket restamp for a deliberate reset.
    const current = lines[i].slice(5).trim();
    if (!FORCE && current && !current.startsWith(ICON_DIR)) {
      kept++;
      continue;
    }

    lines[i] = `img: ${want}`;
    if (!DRY) fs.writeFileSync(full, lines.join("\n"), "utf8");
    changed++;
  }
}

console.log(`\n${DRY ? "[dry] " : ""}icon assignments:`);
for (const [icon, n] of Object.entries(byIcon).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(4)}  ${icon}`);
console.log(`\n${DRY ? "would change" : "changed"}: ${changed}  |  skipped (no icon): ${skipped}`
  + `  |  kept (hand-picked): ${kept}  |  missing img line: ${missing}`);
if (kept && !FORCE) {
  console.log(`  ${kept} document(s) keep art chosen by hand; --force would overwrite them.`);
}

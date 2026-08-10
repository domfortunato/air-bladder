#!/usr/bin/env node
/**
 * The System Docs journals: `journals-docs` ("System Docs" in the
 * Air Bladder - Journals sidebar group), created 2026-08-10 by user ask —
 * the Warden-facing guides from `docs/`, mirrored where a Warden actually
 * plays so nobody has to open the repo to learn a feature.
 *
 *   node tools/import/system-docs.mjs [--dry]
 *
 * CANONICAL SOURCE IS `docs/*.md` — the recorded warden-guides pattern
 * (docs/ + site card + both READMEs) gains a fourth surface here, and this
 * importer is what keeps it from becoming a fourth thing to drift: edit the
 * doc, rerun this, rebuild. Never edit the pack YAML by hand. Markdown
 * converts via `marked` (devDependency, tools-only like js-yaml); the
 * leading H1 is dropped (the entry name carries the title); links between
 * ROSTER docs become compendium @UUID links, a link to a non-roster doc
 * (contributor material) unwraps to plain text, and external http links
 * stay anchors.
 *
 * Run order: independent. Idempotent: the pack dir is OURS entirely and
 * wiped whole, ids are seed-hashed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { marked } = require("marked");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry");

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
const page = (ownerId, pageId, name, content, sort) => [
  `  - _id: ${pageId}`,
  `    name: ${y(name)}`,
  "    type: text",
  "    title:",
  "      show: false",
  "      level: 1",
  "    text:",
  `      content: ${y(content)}`,
  "      format: 1",
  `    sort: ${sort}`,
  "    ownership:",
  "      default: -1",
  "    flags: {}",
  `    _key: '!journal.pages!${ownerId}.${pageId}'`,
].join("\n");
const journalShell = (id, name, pages) => [
  `_id: ${id}`,
  `name: ${y(name)}`,
  "pages:",
  ...pages,
  "folder: null",
  "sort: 0",
  "ownership:",
  "  default: 0",
  "flags: {}",
  "_stats:",
  "  systemId: air-bladder",
  "  coreVersion: '14.365'",
  `_key: '!journal!${id}'`,
  "",
].join("\n");

/* ------------------------------------------------------------- the roster */
// [docs file, entry name]. Warden-facing guides ONLY — the contributor
// documents (design-of-record files, plans, i18n process, release testing)
// stay repo-side on purpose.
const ROSTER = [
  ["encounter-tables.md", "Encounter Tables"],
  ["generating-monsters.md", "Generating Monsters"],
  ["generating-factions.md", "Generating Factions"],
  ["creating-custom-backgrounds.md", "Creating Custom Backgrounds"],
  ["sharing-custom-backgrounds.md", "Sharing Custom Backgrounds"],
  ["custom-portrait-gallery.md", "Custom Portrait Gallery"],
  ["supplied-macros.md", "Supplied Macros"],
];
const idOf = new Map(ROSTER.map(([f, name]) => [f, idFor(`air-bladder-system-docs:${f}`)]));

/* ---------------------------------------------------------------- convert */
const convert = (file) => {
  const md = fs.readFileSync(path.join(root, "docs", file), "utf8")
    .replace(/^# .*\r?\n/, ""); // the entry name carries the title
  let html = marked.parse(md, { async: false });
  // Cross-links: roster doc -> compendium @UUID (anchor dropped — journal
  // pages have no heading anchors); non-roster doc -> plain text; http(s)
  // links stay anchors.
  html = html.replace(/<a href="([^"]+)">([\s\S]*?)<\/a>/g, (m, href, text) => {
    if (/^https?:\/\//.test(href)) return m;
    const target = href.replace(/#.*$/, "");
    const tid = idOf.get(target);
    if (tid) return `@UUID[Compendium.air-bladder.journals-docs.JournalEntry.${tid}]{${text}}`;
    return text;
  });
  return html.replace(/\r?\n/g, " ").replace(/ {2,}/g, " ").trim();
};

/* ------------------------------------------------------------------ write */
const dir = path.join(root, "src", "packs", "journals-docs");
if (!dry) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) fs.rmSync(path.join(dir, f));
}
for (const [file, name] of ROSTER) {
  const jid = idOf.get(file);
  const pid = idFor(`air-bladder-system-docs-page:${file}`);
  const html = convert(file);
  if (!html || html.length < 200) throw new Error(`FATAL: ${file} converted to ${html.length} chars`);
  const yml = journalShell(jid, name, [page(jid, pid, name, html, 0)]);
  const out = `${name.replace(/[^A-Za-z0-9]/g, "_")}_${jid}.yml`;
  if (!dry) fs.writeFileSync(path.join(dir, out), yml, "utf8");
  console.log(`${dry ? "[dry] would write" : "wrote"} ${out} (${html.length} chars)`);
}
if (!dry) console.log("next: npm run build:packs (stop Foundry first)");

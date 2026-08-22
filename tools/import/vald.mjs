#!/usr/bin/env node
/**
 * The Vald setting journal: `journals-vald` ("Vald" in the Air Bladder -
 * Journals sidebar group), created 2026-08-21 by user ask — the Warden's
 * Guide setting chapter as ONE book-style entry, nine pages in source order.
 * A page per `##` section, because nine separate entries would alphabetize
 * "Belief" ahead of "Introduction" in the compendium list; the page list is
 * the table of contents.
 *
 *   node tools/import/vald.mjs [--dry]
 *
 * Source: fetched at run time from the Cairn SRD (yochaigal/cairn), per the
 * house rule in this directory's README — reliquary.mjs is the precedent.
 * VERBATIM (the cairn-rules.mjs standard: fix nothing, or a diff against the
 * page reads as our editing), with that file's one structural liberty
 * repeated: both source tables ship an EMPTY header row with the real
 * headers bolded in the first body row, which is promoted into the header.
 * The attribution line on the last page is OURS, not the page's.
 *
 * Player-visible and translatable (TRANSLATABLE_JOURNAL_PACKS). Pages SHOW
 * their titles, unlike the single-page rules journals — a book wants its
 * headings, and `title.show` is also what lets `journal.pageName` reach a
 * translator.
 *
 * TWO GUARDS THAT THROW, both so an upstream SRD edit forces a decision
 * here instead of shipping one silently:
 *   - any <a> in the converted HTML. The source has no links today, and
 *     dev:journal-i18n pins the enriched-block count across the player
 *     journals at exactly 2 (both in journals-glog) — a link would move
 *     that pin and mint blocks no translator can reach.
 *   - a section count other than nine. docs/release-testing.md and the
 *     probe notes describe nine pages; update them WITH the count.
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

const SRC = "https://raw.githubusercontent.com/yochaigal/cairn/main/second-edition/wardens-guide/vald.md";
const ENTRY_NAME = "Vald";
const SECTION_COUNT = 9;
const ATTRIBUTION = "<p><em>Cairn 2e Warden’s Guide, cairnrpg.com/second-edition/wardens-guide/vald/ — CC BY-SA 4.0.</em></p>";

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

// The cairn-rules.mjs emitters, with one difference: `show: true` — these
// pages carry their section titles, the entry name carries only "Vald".
const page = (ownerId, pageId, name, content, sort) => [
  `  - _id: ${pageId}`,
  `    name: ${y(name)}`,
  "    type: text",
  "    title:",
  "      show: true",
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

/* --------------------------------------------------- fetch, strip, split */
const res = await fetch(SRC);
if (!res.ok) throw new Error(`FATAL: ${SRC} returned ${res.status}`);
let md = (await res.text()).replace(/\r\n/g, "\n");
md = md.replace(/^---\n[\s\S]*?\n---\n/, ""); // Jekyll front-matter
md = md.replace(/^\s*# .*\n/, ""); // the H1 — the entry name carries it

// [preamble, heading1, body1, heading2, body2, ...]; ### stays inside its
// section's body and renders as <h3> under the page title.
const parts = md.split(/^## +(.+)$/m);
if (parts[0].trim()) throw new Error("FATAL: prose before the first ## heading would be dropped");
const sections = [];
for (let i = 1; i < parts.length; i += 2) sections.push({ name: parts[i].trim(), body: parts[i + 1] ?? "" });
if (sections.length !== SECTION_COUNT) {
  throw new Error(`FATAL: expected ${SECTION_COUNT} sections, got ${sections.length} — `
    + "the SRD chapter changed shape; update SECTION_COUNT, docs/release-testing.md and the probe notes together");
}

/* ---------------------------------------------------------------- convert */
// Promote a table's real header out of its first body row. Both source
// tables open with an all-empty header row and bold their headers in the
// row after the separator; without this, marked emits an empty <thead> and
// the headers render as an ordinary body row.
const promoteTableHeaders = (text) => {
  const lines = text.split("\n");
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l ?? "");
  for (let i = 0; i + 2 < lines.length; i++) {
    if (!isRow(lines[i]) || !/^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1] ?? "") || !isRow(lines[i + 2])) continue;
    if (lines[i].split("|").slice(1, -1).some((c) => c.trim() !== "")) continue;
    lines[i] = lines[i + 2];
    lines.splice(i + 2, 1);
  }
  return lines.join("\n");
};

const convert = (name, body) => {
  let html = marked.parse(promoteTableHeaders(body), { async: false });
  html = html.replace(/\r?\n/g, " ").replace(/ {2,}/g, " ").trim();
  if (/<a[\s>]/.test(html)) {
    throw new Error(`FATAL: section "${name}" converted with a link in it — `
      + "the SRD text gained one; decide how it ships (plain text? @UUID?) and update the dev:journal-i18n enriched pin with it");
  }
  if (!html || html.length < 200) throw new Error(`FATAL: section "${name}" converted to ${html.length} chars`);
  return html;
};

/* ------------------------------------------------------------------ write */
const jid = idFor("air-bladder-vald");
const pageBlocks = sections.map((s, i) => {
  let html = convert(s.name, s.body);
  if (i === sections.length - 1) html += ` ${ATTRIBUTION}`;
  console.log(`  ${s.name.padEnd(24)} ${html.length} chars`);
  return page(jid, idFor(`air-bladder-vald:${s.name}`), s.name, html, i * 100);
});
const yml = journalShell(jid, ENTRY_NAME, pageBlocks);

const dir = path.join(root, "src", "packs", "journals-vald");
const out = `${ENTRY_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${jid}.yml`;
if (!dry) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) fs.rmSync(path.join(dir, f));
  fs.writeFileSync(path.join(dir, out), yml, "utf8");
}
console.log(`${dry ? "[dry] would write" : "wrote"} ${out} (${sections.length} pages)`);
if (!dry) console.log("next: npm run build:packs (stop Foundry first)");

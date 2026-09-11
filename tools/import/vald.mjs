#!/usr/bin/env node
/**
 * The Vald setting journal: `journals-vald` ("Vald" in the Air Bladder -
 * Journals sidebar group), created 2026-08-21 by user ask — the Warden's
 * Guide setting chapter as ONE book-style entry, nine pages in source order.
 * A page per `##` section, because nine separate entries would alphabetize
 * "Belief" ahead of "Introduction" in the compendium list; the page list is
 * the table of contents.
 *
 * SINCE 2026-09-10 IT WRITES A SECOND ENTRY, "Festivals of Vald" — the 24
 * named festivals off the calendar section's own Holidays table, one page
 * each, carrying the month and day in `flags.air-bladder` so the in-game
 * calendar window can mark them. THE REASON IT IS PACK CONTENT AND NOT A
 * TABLE IN `module/`: LICENSE.txt declares module/ templates/ css/ tools/
 * lang/ to be MIT "and only these", while every word of Cairn's text is
 * CC BY-SA. Putting 24 Warden's Guide descriptions in `lang/en.json` would
 * make the licence inventory's own sentence false, and `check:licence`
 * compares README against LICENSE.txt so nothing would catch it. Shipping
 * them here also means exactly ONE copy of the text in the repo, still
 * upstream's, and the content-translation overlay reaches it for free.
 *
 * The festival pages carry no attribution line of their own: they are the
 * same chapter as the "Vald" entry beside them in the same pack, and that
 * entry's last page credits it.
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
 * GUARDS THAT THROW, all of them so an upstream SRD edit forces a decision
 * here instead of shipping one silently:
 *   - any <a> in the converted HTML. The source has no links today, and
 *     dev:journal-i18n pins the enriched-block count across the player
 *     journals at exactly 2 (both in journals-glog) — a link would move
 *     that pin and mint blocks no translator can reach.
 *   - a section count other than nine. docs/release-testing.md and the
 *     probe notes describe nine pages; update them WITH the count.
 *   - a holiday row count other than 28, or a festival count other than 24.
 *   - THE PARSE CHECKS ITSELF AGAINST THE SOURCE. Every holiday row names
 *     the weekday it falls on, so the importer computes the weekday for the
 *     day number it just parsed and throws on a mismatch — and for a span,
 *     the last day too. A misread day number cannot pass. That is worth
 *     more than any count: 288 days, a six-day week and a six-day leap week
 *     mean the weekday cycle is locked to the day of the month forever, so
 *     this is an independent fact the parse cannot be right about by
 *     accident. Same shape as SECTION_COUNT, one layer deeper.
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

// The festivals entry, parsed out of the calendar section's Holidays table.
const FESTIVALS_NAME = "Festivals of Vald";
const CALENDAR_SECTION = "The Vald Calendar";
const HOLIDAY_HEADING = "Holidays, Festivals, & Events Sorted by Date";
const DATED_ROW_COUNT = 28; // 24 named festivals + 4 "X season begins"
const FESTIVAL_COUNT = 24;
const SEASON_ROW_COUNT = 4;
// Source order, and the only order that matters: the week is six days and a
// month is 24, so day-of-month 1 is always the first of these.
const WEEKDAYS = ["Market Day", "Garden Day", "Song Day", "Tithe Day", "Bathing Day", "Resting Day"];
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
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
const page = (ownerId, pageId, name, content, sort, flags = null) => [
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
  ...(flags
    // The calendar window reads these to mark the grid. `valdMonth` is the
    // source's own 1-based month number, so a page can be checked against the
    // Warden's Guide by eye; the consumer subtracts one for the month index.
    ? [
      "    flags:",
      "      air-bladder:",
      `        valdMonth: ${flags.valdMonth}`,
      `        valdDay: ${flags.valdDay}`,
      `        valdDays: ${flags.valdDays}`,
    ]
    : ["    flags: {}"]),
  `    _key: '!journal.pages!${ownerId}.${pageId}'`,
].join("\n");
const journalShell = (id, name, pages, sort = 0) => [
  `_id: ${id}`,
  `name: ${y(name)}`,
  "pages:",
  ...pages,
  "folder: null",
  `sort: ${sort}`,
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

/* ----------------------------------------------------- the holiday table */

/**
 * The 24 named festivals, off the calendar section's Holidays table.
 *
 * Row shapes, and all three are load-bearing:
 *   `| **7. Flood** |  |  |`          sets the month for the rows beneath it
 *   `|  | <date> | _Name_: <text> |`  a festival
 *   `|  | <date> | Wet season begins. |`   a season boundary, which becomes NO
 *                                          page — the calendar already knows
 *                                          its seasons from the config
 *
 * The date cell is prose ("Dusk on the 24th (Resting Day)", "3 days starting
 * on the 5th (Bathing Day to Market Day)"). Only the ordinal and the span
 * length are taken from it. TIME-OF-DAY PHRASES ARE DROPPED on purpose:
 * nothing in this system displays an hour, by the watch ruling, and where the
 * hour matters the description says so in its own words.
 *
 * Anything that is neither separator, header, month nor event THROWS, so a new
 * row shape upstream cannot be skipped in silence.
 */
const parseHolidays = (body) => {
  const at = body.indexOf(`### ${HOLIDAY_HEADING}`);
  if (at < 0) throw new Error(`FATAL: "${HOLIDAY_HEADING}" is gone from the ${CALENDAR_SECTION} section`);
  const lines = body.slice(at).split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l));

  const festivals = [];
  let month = null;
  let dated = 0;
  let seasonRows = 0;

  for (const line of lines) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) throw new Error(`FATAL: holiday row has ${cells.length} cells, not 3: ${line.trim()}`);
    // The blank header row the source opens with, and the separator beneath it.
    if (cells.every((c) => c === "" || /^:?-+:?$/.test(c))) continue;
    if (cells[0] === "**Month**") continue; // the real header, bolded a row late

    const monthCell = cells[0].match(/^\*\*(\d+)\.\s*(.+?)\*\*$/);
    if (monthCell) {
      month = { number: Number(monthCell[1]), name: monthCell[2].trim() };
      continue;
    }
    if (cells[0] !== "") throw new Error(`FATAL: unrecognised holiday row: ${line.trim()}`);
    if (!month) throw new Error(`FATAL: a dated row appears before any month heading: ${line.trim()}`);

    const [, dateCell, eventCell] = cells;
    const ordinalMatch = dateCell.match(/\b(\d+)(?:st|nd|rd|th)\b/);
    if (!ordinalMatch) throw new Error(`FATAL: no day of the month in "${dateCell}"`);
    const day = Number(ordinalMatch[1]);

    // A span says how long it runs, in digits ("3 days") or in words ("Five
    // days"). Both spellings are in the source today, which is why both are read.
    let days = 1;
    const span = dateCell.match(/^\s*(\d+|[A-Za-z]+)\s+days\s+starting\s+on\s+the\b/i);
    if (span) {
      days = /^\d+$/.test(span[1]) ? Number(span[1]) : WORD_NUMBERS[span[1].toLowerCase()];
      if (!days) throw new Error(`FATAL: cannot read the length of the span in "${dateCell}"`);
    }

    // THE SELF-CHECK. The row names its own weekday; a span names the first and
    // the last. Both are recomputed from the day number just parsed.
    const named = dateCell.match(/\(([^)]+)\)/);
    if (!named) throw new Error(`FATAL: no weekday named in "${dateCell}" — the self-check has nothing to check against`);
    const wanted = named[1].split(/\s+to\s+/).map((s) => s.trim());
    const weekdayOf = (d) => WEEKDAYS[(d - 1) % WEEKDAYS.length];
    const got = days > 1 ? [weekdayOf(day), weekdayOf(day + days - 1)] : [weekdayOf(day)];
    if (wanted.length !== got.length || wanted.some((w, i) => w !== got[i])) {
      throw new Error(`FATAL: ${month.name} ${day} computes to ${got.join(" to ")}, `
        + `but the Warden's Guide says ${wanted.join(" to ")} — the day number was misread, `
        + "or the calendar in module/game-time.js no longer matches the source");
    }

    dated += 1;
    const festival = eventCell.match(/^_(.+?)_:\s*([\s\S]+)$/);
    if (!festival) {
      if (!/\bseason begins\b/i.test(eventCell)) throw new Error(`FATAL: unrecognised event cell: ${eventCell}`);
      seasonRows += 1;
      continue;
    }
    festivals.push({
      name: festival[1].trim(),
      text: festival[2].trim(),
      valdMonth: month.number,
      valdDay: day,
      valdDays: days,
    });
  }

  if (dated !== DATED_ROW_COUNT || seasonRows !== SEASON_ROW_COUNT || festivals.length !== FESTIVAL_COUNT) {
    throw new Error(`FATAL: expected ${DATED_ROW_COUNT} dated rows `
      + `(${FESTIVAL_COUNT} festivals + ${SEASON_ROW_COUNT} season boundaries), got ${dated} `
      + `(${festivals.length} + ${seasonRows}) — the Holidays table changed shape; update the counts here, `
      + "docs/keeping-time.md and the dev:vald-time festival leg together");
  }
  return festivals;
};

/** One festival's description. Short prose, so `convert`'s 200-char floor is wrong for it. */
const convertFestival = (name, text) => {
  const html = marked.parse(text, { async: false }).replace(/\r?\n/g, " ").replace(/ {2,}/g, " ").trim();
  if (/<a[\s>]/.test(html)) throw new Error(`FATAL: festival "${name}" converted with a link in it`);
  if (html.length < 40) throw new Error(`FATAL: festival "${name}" converted to ${html.length} chars`);
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

const calendarSection = sections.find((s) => s.name === CALENDAR_SECTION);
if (!calendarSection) throw new Error(`FATAL: no "${CALENDAR_SECTION}" section to take the holidays from`);
const festivals = parseHolidays(calendarSection.body);

const fid = idFor("air-bladder-vald-festivals");
// Source order, which is date order — the table's own heading says so. Pages
// sort by it, so the book reads down the year rather than alphabetically.
const festivalBlocks = festivals.map((f, i) => {
  const html = convertFestival(f.name, f.text);
  const span = f.valdDays > 1 ? ` (${f.valdDays} days)` : "";
  console.log(`  ${`${f.valdMonth}/${f.valdDay}`.padStart(5)} ${f.name.padEnd(20)}${span}`);
  return page(fid, idFor(`air-bladder-vald-festival:${f.name}`), f.name, html, i * 100, {
    valdMonth: f.valdMonth, valdDay: f.valdDay, valdDays: f.valdDays,
  });
});
const festivalYml = journalShell(fid, FESTIVALS_NAME, festivalBlocks, 100);

const dir = path.join(root, "src", "packs", "journals-vald");
const out = `${ENTRY_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${jid}.yml`;
const festivalOut = `${FESTIVALS_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${fid}.yml`;
if (!dry) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) fs.rmSync(path.join(dir, f));
  fs.writeFileSync(path.join(dir, out), yml, "utf8");
  fs.writeFileSync(path.join(dir, festivalOut), festivalYml, "utf8");
}
console.log(`${dry ? "[dry] would write" : "wrote"} ${out} (${sections.length} pages)`);
console.log(`${dry ? "[dry] would write" : "wrote"} ${festivalOut} (${festivals.length} pages)`);
if (!dry) console.log("next: npm run build:packs (stop Foundry first)");

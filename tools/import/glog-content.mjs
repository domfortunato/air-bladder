#!/usr/bin/env node
/**
 * The GLOG Magic RULES content: the Mishaps table and the player journals
 * (ruling 15, 2026-08-05; journals extended 2026-08-10 by user ask) —
 * `tables-glog` (RollTable) and `journals-glog` (the system's FIRST
 * JournalEntry pack; packs are single-type, so the pair is two declarations).
 * `journals-glog` ships TWO entries:
 *
 *   - "GLOG Magic — Player Rules": the hack's rules page, plus a "Magical
 *     Mishaps" page carrying the mishap table annotated with EXACT odds per
 *     cast (computed here by enumeration, per dice count — several rows are
 *     unreachable below a given count and say so) and a risks-by-dice table
 *     (any-Fatigue chance, average Fatigue, mishap chance).
 *   - "GLOG Magic — Spells": the full spell list, read FROM the generated
 *     src/packs/spellbooks-glog so it can never disagree with the documents
 *     it describes. Cross-linked with the rules journal both ways.
 *
 *   node tools/import/glog-content.mjs [--dry]
 *
 * Source: cairnrpg.com/hacks/glog-magic/ — CC BY-SA 4.0, stated on the page,
 * covered by the same attribution row as the GLOG spells. No machine-readable
 * upstream, so the transcription below is the artifact of record, VERBATIM
 * including the page's own typos ("One your hands becomes fused", "Both age
 * at at the rate", "call on it for aide") — the glog-spells.mjs standard: fix
 * nothing, or a diff against the page reads as our editing. The odds
 * annotations and the risk table are OURS, appended in italics and credited
 * as such on the page.
 *
 * The Mishaps table is a LOOKUP: the caster's [sum] (2–24) picks the row.
 * Its stored formula is 2d12 — the one dice expression whose range is exactly
 * 2–24 — so core's draw button functions, but the description says out loud
 * that the sum from the cast is what consults it. The ROLLTABLE rows stay
 * verbatim — the cast whisper quotes them; odds live in the journal only.
 *
 * Run order: AFTER glog-spells.mjs — the spell-list journal reads
 * src/packs/spellbooks-glog, so a spells rerun must precede this one.
 * Idempotent: both pack dirs are OURS entirely and wiped whole, ids are
 * seed-hashed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const YAML = createRequire(import.meta.url)("js-yaml");

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

/* ------------------------------------------------ the Mishaps table, 2–24 */
// VERBATIM from the page. Key: the [sum]; value: the entry's full text.
const MISHAPS = [
  [2, "You cannot cast spells for 1d6 hours, and any attempts to manipulate magic will fail."],
  [3, "For the next 24 hours, when casting spells you gain a Fatigue on a roll of 3-6."],
  [4, "There is a chain reaction to the spell (the Warden will say how). Take an additional Fatigue."],
  [5, "The Spell’s effects are reversed; the Warden will tell you how. Take an additional Fatigue."],
  [6, "Any objects in your inventory that are not made of metal instantly combust. You are now immune to fire for short bursts."],
  [7, "You are deprived. After recovery, roll 1d6. If the total is higher than your max HP, take the new result."],
  [8, "You take 1d4 WIL damage when casting spells for the next 24 hours. Afterwards roll 3d6. If the total is higher than your max WIL, take the new result."],
  [9, "The spell turns your skin a dark shade of purple, and makes you invisible in the moonlight. Your eyes however glow a bright yellow at night."],
  [10, "You become insubstantial for 1d4 hours as your spirit leaves your body, which remains unconscious. You can fly and pass through walls, but not touch anything. Also, no one can see or hear you through mundane means."],
  [11, "You suffer horrible arcane burns; lose 1d4 WIL. From now on you can add +1 Magic Dice to a spell’s [dice] (use a die of a different color). If it results in a 4-6 you lose 1 WIL."],
  [12, "The spell backfires; you lose 1 inventory slot (scratch it off your sheet). You are now surrounded by a magical essence that provides +1 Armor (normal limits still apply)."],
  [13, "Your Grimoire is damaged and unusable. Creating a new Grimoire from its remains restores the original spells as well."],
  [14, "Instead of Fatigue, the spell causes magical tumors to fill their respective slots. They can only be removed by a specialized healer. Upon recovery, you are able to ignore a single Fatigue taken from spellcasting. If the spell did not cause Fatigue, you are deprived."],
  [15, "Arcane energies wrack your body as a piece of your soul is transferred into your Grimoire. You lose half your WIL (rounded down). Your Grimoire now appears in any form you wish and takes no space in inventory. It cannot be destroyed except by your own death, and vice-versa."],
  [16, "You permanently lose 1d4 STR as the spell interacts with nearby plant life, which rips out of the earth and fuses against your skin. You have +1 Armor, although fire does enhanced damage against you. You can only feed by photosynthesis."],
  [17, "You are transformed into something weird and unnatural (the Warden will say exactly how). Others will have difficulty looking at you. If someone doesn’t focus on you, you are invisible. You fail any attempts at persuasion."],
  [18, "One your hands becomes fused with your Grimoire. You can never let go of it, however it only takes up 1 inventory slot. You can fire a bolt of arcane energy from that hand that deals 1d6 damage. If your hand is cut off, you can never cast spells again."],
  [19, "Large ugly wings sprout from your back, ripping through whatever you are wearing. You gain 1d4 DEX and can fly. You cannot wear armor or a backpack, and have only 5 inventory slots."],
  [20, "You dimensionally swap limbs with a magical being from an alien plane. Gain its properties (ask the Warden), both good and bad. Also: it’s coming for you, and it’s mad as hell."],
  [21, "An extra-planar deity senses your arcane power (ask the Warden which). You are now linked, and can call on it for aide. It can likewise ask you for help, and punish you for non-compliance. Good luck."],
  [22, "Your body becomes a vessel of pure magical energy. You no longer need to consume food, water or air. Fatigue and Mishaps from casting spells does not affect you, but instead you lose 1d4 STR on a result of 5-6. At STR 0 you become a spell (ask the Warden which). You can smell magic."],
  [23, "You create an exact duplicate of yourself. One grows older while the other grows younger. Both age at at the rate of 1 year per day. Your thoughts are joined, and if one dies so does the other. Only magical aide will restore you; afterward add +1d6 to each ability score."],
  [24, "You have become Elemental. Create a True Name for yourself. Magical energies surround you at all times, and mundane attacks against you are impaired. If someone learns your True Name, they can control you. Other Elementals will come for you."],
];
if (MISHAPS.length !== 23) throw new Error(`FATAL: ${MISHAPS.length} mishap entries, expected 23 (sums 2..24)`);
for (let i = 0; i < MISHAPS.length; i++) {
  if (MISHAPS[i][0] !== i + 2) throw new Error(`FATAL: mishap ${i} carries sum ${MISHAPS[i][0]}, expected ${i + 2}`);
}

const TABLE_NAME = "GLOG Magic: Mishaps";
const tid = idFor("air-bladder-glog-mishaps-table");
const tableResults = MISHAPS.map(([sum, text]) => {
  const rid = idFor(`air-bladder-glog-mishap:${sum}`);
  return [
    `  - _id: ${rid}`,
    "    type: text",
    `    description: ${y(text)}`,
    "    img: icons/svg/d20-black.svg",
    "    weight: 1",
    "    range:",
    `      - ${sum}`,
    `      - ${sum}`,
    "    drawn: false",
    "    flags: {}",
    `    _key: '!tables.results!${tid}.${rid}'`,
  ].join("\n");
});
const tableYaml = [
  `_id: ${tid}`,
  `name: ${y(TABLE_NAME)}`,
  "img: icons/svg/d20-grey.svg",
  `description: ${y("A LOOKUP, not a roll: when a cast comes up doubles, find the cast's [sum] (2–24) on this table. The 2d12 formula exists only so the draw button works. GLOG Magic, cairnrpg.com/hacks/glog-magic/ (CC BY-SA 4.0).")}`,
  "results:",
  ...tableResults,
  "formula: 2d12",
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

/* ------------------------------------------- the odds, exactly enumerated */
// A mishap fires when at least two dice match; the ROW is the cast's [sum].
// Enumerate every 2/3/4-die outcome (36/216/1296) and count, per sum, the
// outcomes that mishap — the journal's odds are exact, never sampled. One
// die never mishaps: doubles take two (the cast whisper's own gate).
const DICE_COUNTS = [2, 3, 4];
const mishapCounts = new Map(DICE_COUNTS.map((n) => [n, new Map()]));
const doublesTotals = new Map(DICE_COUNTS.map((n) => [n, 0]));
for (const n of DICE_COUNTS) {
  for (let x = 0; x < 6 ** n; x++) {
    const faces = [];
    for (let i = 0, v = x; i < n; i++, v = Math.floor(v / 6)) faces.push((v % 6) + 1);
    if (new Set(faces).size === faces.length) continue;
    const s = faces.reduce((a, b) => a + b, 0);
    mishapCounts.get(n).set(s, (mishapCounts.get(n).get(s) ?? 0) + 1);
    doublesTotals.set(n, doublesTotals.get(n) + 1);
  }
}
const oneIn = (total, count) => `1 in ${Math.round(total / count).toLocaleString("en-US")}`;
const oddsSentence = (sum) => {
  const reachable = DICE_COUNTS.filter((n) => mishapCounts.get(n).get(sum));
  if (!reachable.length) throw new Error(`FATAL: sum ${sum} unreachable at every dice count`);
  if (reachable.length === 1) {
    const n = reachable[0];
    return `Odds per cast: ${oneIn(6 ** n, mishapCounts.get(n).get(sum))} — only possible with ${n} dice.`;
  }
  return `Odds per cast: ${reachable
    .map((n) => `${oneIn(6 ** n, mishapCounts.get(n).get(sum))} with ${n} dice`)
    .join("; ")}.`;
};
const pct = (x) => {
  const v = x * 100;
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
};

/* ------------------------------------------------------------- names + ids */
const JOURNAL_NAME = "GLOG Magic — Player Rules";
const jid = idFor("air-bladder-glog-handout");
const pid = idFor("air-bladder-glog-handout-page");
const mpid = idFor("air-bladder-glog-handout-mishaps-page");
const SPELLS_JOURNAL_NAME = "GLOG Magic — Spells";
const sjid = idFor("air-bladder-glog-spells-journal");
const spid = idFor("air-bladder-glog-spells-journal-page");

/* ------------------------------------------------------ the player handout */
const p = (t) => `<p>${t}</p>`;
const h = (t) => `<h2>${t}</h2>`;
const HANDOUT = [
  p("You carry a <strong>Grimoire</strong> worth 300gp. It is <em>bulky</em>, and contains a single random spell."),
  p("Treat any discovered Spellbooks as <strong>Scrolls</strong>."),
  h("Casting Spells"),
  p("Holding your <strong>Grimoire</strong> in both hands, choose a spell. The description may denote the spell’s duration with <strong>D</strong> and range with <strong>R</strong>."),
  p("You have an amount of <strong>Magic Dice</strong> (d6) equal to the amount of available <em>inventory slots</em>. Choose how many you wish to invest (up to a maximum of 4). Spells will refer to these as [dice]. Some spells will refer to their [sum] as well."),
  p("Roll [dice]. For each die that shows a 4-6, you gain one <strong>Fatigue</strong>."),
  p("If you get a series (e.g. 2-4 dice that match), something has gone very wrong. Look up the spell’s [sum] on the <strong>Mishaps</strong> table for what happens next."),
  h("Scrolls"),
  p("Scrolls contain a single spell and are destroyed after a single use. Otherwise, they work exactly the same as spells recorded in your <strong>Grimoire</strong>."),
  h("Copying Spells"),
  p("You may copy spells found in Scrolls to your <strong>Grimoire</strong>. It costs 50gp for the gold inks and takes 6 hours to complete, reduced by [sum] hours. The Scroll is destroyed in the process."),
  h("Creating a Grimoire"),
  p("Creating a <strong>Grimoire</strong> is time-consuming and expensive. You will need:"),
  "<ul><li>A single Scroll, which is sacrificed through the process.</li>"
    + "<li>200gp in inks, as well as a blank book.</li>"
    + "<li>6 hours of undisturbed labor in the light of a full moon. Afterwards, you are <em>deprived</em>.</li></ul>",
  p("The spell contained within the Scroll becomes the first recorded spell."),
  p("<em>GLOG Magic, cairnrpg.com/hacks/glog-magic/ — CC BY-SA 4.0.</em>"),
  // Ours, not the hack's: the companion journal, one click away.
  p(`<em>The full spell list: @UUID[Compendium.air-bladder.journals-glog.JournalEntry.${sjid}]{${SPELLS_JOURNAL_NAME}}.</em>`),
].join("");   // NO newlines: the y() quoter emits one single-quoted line, and a
              // raw newline inside it is the YAML indentation error the first
              // build caught ("deficient indentation") — HTML needs none.

/* -------------------------------------------------- the Magical Mishaps page */
const RISK_ROWS = [1, 2, 3, 4].map((n) => {
  const fat = pct(1 - 0.5 ** n);
  const avg = String(n / 2);
  const mis = n === 1 ? "Impossible" : pct(doublesTotals.get(n) / 6 ** n);
  return `<tr><td>${n}</td><td>${fat}</td><td>${avg}</td><td>${mis}</td></tr>`;
}).join("");
const MISHAPS_PAGE = [
  p("When a cast comes up doubles, something has gone very wrong: look up the cast's [sum] on the table below. A single die can never mishap — doubles take at least two."),
  h("Risks by Magic Dice"),
  p("Every die that shows 4–6 costs a Fatigue, and every extra die raises the chance of doubles. The odds under each mishap are per cast and exact; a dice count an entry does not list cannot produce that [sum] at all — the deepest mishaps are simply out of reach unless you risk more dice."),
  "<table><thead><tr><th>Magic Dice</th><th>Any Fatigue</th><th>Average Fatigue</th><th>Mishap</th></tr></thead>"
    + `<tbody>${RISK_ROWS}</tbody></table>`,
  h("Mishaps, by [sum]"),
  "<table><thead><tr><th>[sum]</th><th>Mishap</th></tr></thead><tbody>"
    + MISHAPS.map(([sum, text]) =>
      `<tr><td>${sum}</td><td>${text} <em>${oddsSentence(sum)}</em></td></tr>`).join("")
    + "</tbody></table>",
  p("<em>Mishap text: GLOG Magic, cairnrpg.com/hacks/glog-magic/ — CC BY-SA 4.0. The odds annotations and the risk table are Air Bladder's.</em>"),
].join("");
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
const journalYaml = journalShell(jid, JOURNAL_NAME, [
  page(jid, pid, JOURNAL_NAME, HANDOUT, 0),
  page(jid, mpid, "Magical Mishaps", MISHAPS_PAGE, 100),
]);

/* ---------------------------------------------------- the spell-list journal */
// Read the GENERATED spell pack (glog-spells.mjs runs first), so this list
// can never disagree with the documents it describes.
const spellsDir = path.join(root, "src", "packs", "spellbooks-glog");
const spells = fs.readdirSync(spellsDir).filter((f) => f.endsWith(".yml")).map((f) => {
  const doc = YAML.load(fs.readFileSync(path.join(spellsDir, f), "utf8"));
  return { name: String(doc.name), desc: String(doc.system?.description ?? "") };
}).sort((a, b) => a.name.localeCompare(b.name, "en"));
if (spells.length !== 100) throw new Error(`FATAL: ${spells.length} spells in ${spellsDir}, expected 100`);
const spellEntries = spells.map(({ name, desc }) => {
  const m = desc.match(/^<p>([\s\S]*)<\/p>$/);
  if (!m || m[1].includes("<p>")) throw new Error(`FATAL: unexpected description shape on ${name}`);
  return `<p><strong>${name}.</strong> ${m[1]}</p>`;
}).join("");
const SPELLS_PAGE = [
  p(`The GLOG spell list — the canon hundred re-worded to scale with casting: [dice] is the Magic Dice invested, [sum] their total. How casting works: @UUID[Compendium.air-bladder.journals-glog.JournalEntry.${jid}]{${JOURNAL_NAME}}.`),
  spellEntries,
  p("<em>GLOG Spells, cairnrpg.com/hacks/glog-spells/ — CC BY-SA 4.0.</em>"),
].join("");
const spellsJournalYaml = journalShell(sjid, SPELLS_JOURNAL_NAME, [
  page(sjid, spid, SPELLS_JOURNAL_NAME, SPELLS_PAGE, 0),
]);

/* ------------------------------------------------------------------ write */
const tableDir = path.join(root, "src", "packs", "tables-glog");
const journalDir = path.join(root, "src", "packs", "journals-glog");
const tableFile = `${TABLE_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${tid}.yml`;
const journalFile = `${JOURNAL_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${jid}.yml`;
const spellsJournalFile = `${SPELLS_JOURNAL_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${sjid}.yml`;
if (!dry) {
  for (const dir of [tableDir, journalDir]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) fs.rmSync(path.join(dir, f));
  }
  fs.writeFileSync(path.join(tableDir, tableFile), tableYaml, "utf8");
  fs.writeFileSync(path.join(journalDir, journalFile), journalYaml, "utf8");
  fs.writeFileSync(path.join(journalDir, spellsJournalFile), spellsJournalYaml, "utf8");
}
console.log(`${dry ? "[dry] would write" : "wrote"} ${tableFile}: ${MISHAPS.length} rows (sums 2–24)`);
console.log(`${dry ? "[dry] would write" : "wrote"} ${journalFile}: 2 pages (rules + annotated mishaps)`);
console.log(`${dry ? "[dry] would write" : "wrote"} ${spellsJournalFile}: 1 page, ${spells.length} spells`);
if (!dry) console.log("next: npm run build:packs (stop Foundry first)");

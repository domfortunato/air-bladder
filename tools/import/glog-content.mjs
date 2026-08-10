#!/usr/bin/env node
/**
 * The GLOG Magic RULES content: the Mishaps table and the player handout
 * (ruling 15, 2026-08-05) — `tables-glog` (RollTable) and `journals-glog`
 * (the system's FIRST JournalEntry pack; packs are single-type, so the pair
 * is two declarations).
 *
 *   node tools/import/glog-content.mjs [--dry]
 *
 * Source: cairnrpg.com/hacks/glog-magic/ — CC BY-SA 4.0, stated on the page,
 * covered by the same attribution row as the GLOG spells. No machine-readable
 * upstream, so the transcription below is the artifact of record, VERBATIM
 * including the page's own typos ("One your hands becomes fused", "Both age
 * at at the rate", "call on it for aide") — the glog-spells.mjs standard: fix
 * nothing, or a diff against the page reads as our editing.
 *
 * The Mishaps table is a LOOKUP: the caster's [sum] (2–24) picks the row.
 * Its stored formula is 2d12 — the one dice expression whose range is exactly
 * 2–24 — so core's draw button functions, but the description says out loud
 * that the sum from the cast is what consults it.
 *
 * Run order: independent. Idempotent: both pack dirs are OURS entirely and
 * wiped whole, ids are seed-hashed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

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
].join("");   // NO newlines: the y() quoter emits one single-quoted line, and a
              // raw newline inside it is the YAML indentation error the first
              // build caught ("deficient indentation") — HTML needs none.

const JOURNAL_NAME = "GLOG Magic — Player Rules";
const jid = idFor("air-bladder-glog-handout");
const pid = idFor("air-bladder-glog-handout-page");
const journalYaml = [
  `_id: ${jid}`,
  `name: ${y(JOURNAL_NAME)}`,
  "pages:",
  `  - _id: ${pid}`,
  `    name: ${y(JOURNAL_NAME)}`,
  "    type: text",
  "    title:",
  "      show: false",
  "      level: 1",
  "    text:",
  `      content: ${y(HANDOUT)}`,
  "      format: 1",
  "    sort: 0",
  "    ownership:",
  "      default: -1",
  "    flags: {}",
  `    _key: '!journal.pages!${jid}.${pid}'`,
  "folder: null",
  "sort: 0",
  "ownership:",
  "  default: 0",
  "flags: {}",
  "_stats:",
  "  systemId: air-bladder",
  "  coreVersion: '14.365'",
  `_key: '!journal!${jid}'`,
  "",
].join("\n");

/* ------------------------------------------------------------------ write */
const tableDir = path.join(root, "src", "packs", "tables-glog");
const journalDir = path.join(root, "src", "packs", "journals-glog");
const tableFile = `${TABLE_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${tid}.yml`;
const journalFile = `${JOURNAL_NAME.replace(/[^A-Za-z0-9]/g, "_")}_${jid}.yml`;
if (!dry) {
  for (const dir of [tableDir, journalDir]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) fs.rmSync(path.join(dir, f));
  }
  fs.writeFileSync(path.join(tableDir, tableFile), tableYaml, "utf8");
  fs.writeFileSync(path.join(journalDir, journalFile), journalYaml, "utf8");
}
console.log(`${dry ? "[dry] would write" : "wrote"} ${tableFile}: ${MISHAPS.length} rows (sums 2–24)`);
console.log(`${dry ? "[dry] would write" : "wrote"} ${journalFile}: 1 page`);
if (!dry) console.log("next: npm run build:packs (stop Foundry first)");

#!/usr/bin/env node
/**
 * Offline check for the Kettlewright trait-sentence parser.
 *
 *   node tools/dev/trait-parse-check.mjs
 *
 * The parser is the one piece of the importer that is pure string work, so it can
 * be tested without Foundry — which matters, because the alternative is clicking
 * an import button and eyeballing eight dropdowns.
 *
 * `parseTraitSentence` is imported from the real module. The virtue/vice split is
 * checked separately here against the shipped tables read straight from
 * src/packs/, because `resolveVirtueVice` needs `game.packs` at runtime; this
 * asserts the same decision the tables will drive in Foundry.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const YAML = require("js-yaml");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The module imports Foundry-only siblings at load time, so pull just the parser
// out of the source text rather than importing the whole importer.
const src = fs.readFileSync(path.join(ROOT, "module", "kettlewright-import.js"), "utf8");
const slice = (from, to) => {
  const a = src.indexOf(from);
  // Search for the end marker AFTER the start, or a banner comment earlier in the
  // file wins and the slice comes out empty (or backwards).
  const b = a === -1 ? -1 : src.indexOf(to, a + from.length);
  if (a === -1 || b === -1) {
    console.error(`Could not locate ${from} in module/kettlewright-import.js`);
    process.exit(1);
  }
  return src.slice(a, b);
};
const load = async (code) => import("data:text/javascript," + encodeURIComponent(code));
const { parseTraitSentence } = await load(
  slice("export const parseTraitSentence", "export const resolveVirtueVice")
);
const { parseQuestionAnswers } = await load(
  slice("export const parseQuestionAnswers", "/* ---")
);
// This slice runs up to the next docblock, so it ends on a dangling "/**".
const { bestTextMatch } = await load(
  slice("/** Loose text identity", "* Re-tag imported items").replace(/\/\*+\s*$/, "")
);

// v13 split `TableResult#text` in two, and the halves went to DIFFERENT fields: a
// text row's value is now `description`, a document row's is `name`. That is the
// rule `resultText` encodes in module/compendium.js, and reading `r.text` here
// silently produced a set of `"undefined"` — so the virtue/vice split fell through
// to its positional default and only two downstream assertions complained, about
// the wrong thing. Hence the floor below: a table this reads to zero values is a
// broken check, not an empty table.
const tableValues = (name) => {
  const dir = path.join(ROOT, "src", "packs", "tables-2e");
  const file = fs.readdirSync(dir).find((f) => f.startsWith(`${name}_`));
  const doc = YAML.load(fs.readFileSync(path.join(dir, file), "utf8"));
  const values = (doc.results ?? [])
    .map((r) => String((r.type === "text" ? r.description : r.name) ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (values.length < 10) {
    throw new Error(`${name} table read to ${values.length} value(s) from ${file} — `
      + "the row schema has changed under this check; it is matching nothing, not passing");
  }
  return new Set(values);
};
const virtues = tableValues("Virtue");
const vices = tableValues("Vice");
const splitPair = ([a, b]) => {
  if (!a || !b) return {};
  if (virtues.has(a.toLowerCase()) && vices.has(b.toLowerCase())) return { virtue: a, vice: b };
  if (vices.has(a.toLowerCase()) && virtues.has(b.toLowerCase())) return { virtue: b, vice: a };
  return { virtue: a, vice: b };
};

let failures = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(12)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};

const run = (label, sentence, expected) => {
  console.log(`\n${label}`);
  const parsed = parseTraitSentence(sentence);
  const traits = { ...parsed.traits, ...splitPair(parsed.pair) };
  for (const [k, v] of Object.entries(expected.traits)) eq(k, traits[k] ?? "", v);
  eq("age", parsed.age, expected.age);
};

// The real export the user hit the bug with.
const fixture = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tools", "dev", "fixtures", "kettlewright-solene.json"), "utf8")
);
run("Solene (real Kettlewright export)", fixture.traits, {
  traits: {
    physique: "Stout", skin: "Birthmarked", hair: "Long", face: "Pale",
    speech: "Precise", clothing: "Rancid", virtue: "Honorable", vice: "Craven",
  },
  age: "36",
});

// Air Bladder's own sentence writes vice BEFORE virtue. Parsing has to survive
// the round trip in both directions, or an export of our own character would
// import back with the two swapped.
run("Air Bladder's own ordering (vice first)",
  "You have a Lanky Physique, Scarred Skin, and Wild Hair. Your Face is Broken, your Speech Blunt. " +
  "You have Frayed Clothing. You are Greedy and Merciful. You are 22 years old.", {
  traits: {
    physique: "Lanky", skin: "Scarred", hair: "Wild", face: "Broken",
    speech: "Blunt", clothing: "Frayed", virtue: "Merciful", vice: "Greedy",
  },
  age: "22",
});

// Partial sentence: missing traits must not shift the others.
run("Partial sentence", "You have a Stout Physique. You are 41 years old.", {
  traits: { physique: "Stout", skin: "", hair: "", face: "", speech: "", clothing: "", virtue: "", vice: "" },
  age: "41",
});

// Nothing parseable -> the importer's Notes fallback should take over.
run("Unparseable free text", "A wandering sort, difficult to describe.", {
  traits: { physique: "", skin: "", hair: "", face: "", speech: "", clothing: "", virtue: "", vice: "" },
  age: "",
});

/* ---- Background questions ------------------------------------------------ */

const MOUNTEBANK = ["How was your fraud exposed?", "What keepsake could always identify you?"];

const runQA = (label, notes, questions, expect) => {
  console.log(`\n${label}`);
  const got = parseQuestionAnswers(notes, questions);
  eq("found", got.found, expect.found);
  (expect.answers ?? []).forEach((want, i) => eq(`answer[${i}]`, got.answers[i], want));
  if (expect.leftover !== undefined) eq("leftover", got.leftover, expect.leftover);
};

runQA("Solene's notes (real export)", fixture.notes, MOUNTEBANK, {
  found: 2,
  answers: [
    "You were cursed by a hedgewitch for fooling some innocent village folk. Magic acts unpredictably in your hands (WIL save to avoid disaster). If you are the target of magic, the same applies to its wielder.",
    "Surgeon's Soap: A lye and ash block that makes skin temporarily transparent, revealing the anatomy within. 4 uses.",
  ],
  leftover: "",
});

// A player's own writing above the questions must survive in Notes.
runQA("Player's own note kept",
  "Remember to bribe the guard.\n\nHow was your fraud exposed?\nCaught in the act.",
  MOUNTEBANK,
  { found: 1, answers: ["Caught in the act.", ""], leftover: "Remember to bribe the guard." });

// Questions in the other order: answers must follow the question, not the index.
runQA("Questions in reverse order",
  "What keepsake could always identify you?\nA brass ring.\n\nHow was your fraud exposed?\nA rival talked.",
  MOUNTEBANK,
  { found: 2, answers: ["A rival talked.", "A brass ring."] });

// No questions present -> nothing claimed, notes untouched.
runQA("Free-form notes only", "Just some thoughts.", MOUNTEBANK,
  { found: 0, answers: ["", ""], leftover: "Just some thoughts." });

// Unmatched background -> no questions to look for.
runQA("No background questions", fixture.notes, [], { found: 0, leftover: fixture.notes });

// Punctuation spacing must not decide a match (review #20 follow-up): the SRD's
// Greenwise heading reads "How has the Wood failed you ?" — space before the
// mark, upstream typo, mirrored faithfully by our pack — while Kettlewright's
// copy of the same text writes "you?". One character of drift left the whole
// Q+A in Notes on a real import (Moss, 2026-09-01). Both directions, because
// either side may be the cleaner one.
runQA("SRD space before ? vs clean export",
  "How has the Wood failed you?\nA spirit cursed me.",
  ["How has the Wood failed you ?"],
  { found: 1, answers: ["A spirit cursed me."], leftover: "" });
runQA("Clean question vs typo'd export",
  "How has the Wood failed you ?\nA spirit cursed me.",
  ["How has the Wood failed you?"],
  { found: 1, answers: ["A spirit cursed me."], leftover: "" });

/* -------------------------------------------------------------------------- */
/*  bestTextMatch: answer -> the option it came from                            */
/* -------------------------------------------------------------------------- */

// Real options, so the thresholds are exercised against the spread of wording
// the game text actually has rather than against invented sentences.
const jongleur = YAML.load(fs.readFileSync(
  path.join(ROOT, "src", "packs", "backgrounds-2e", "Jongleur_LFOAOlXTH0Bsk2g4.yml"), "utf8"));
const trinkets = jongleur.system.tables[1].options;
const performance = jongleur.system.tables[0].options;
const nameOf = (opt) => opt?.items?.[0]?.name ?? "(none)";

console.log("\nbestTextMatch");

// Every option must match itself, or nothing else here means anything.
for (const table of jongleur.system.tables) {
  for (const opt of table.options) {
    const hit = bestTextMatch(opt.description, table.options, (o) => o.description);
    if (hit !== opt) { failures++; console.log(`  FAIL  self-match   ${nameOf(opt)} -> ${nameOf(hit)}`); }
  }
}
console.log(`  ok    self-match   all ${jongleur.system.tables.reduce((n, t) => n + t.options.length, 0)} options`);

// THE BUG: Kettlewright says "dark-grey", our copy says "dark-gray". One letter,
// and the exact match that used to be the only match silently lost the item.
eq("grey vs gray", nameOf(bestTextMatch(
  "Ghost Violin: A dark-grey violin that plays a haunting tune, mirrored by an invisible, distant twin.",
  trinkets, (o) => o.description)), "Ghost Violin");

// Longer drift in the middle of a sentence still resolves.
eq("reworded", nameOf(bestTextMatch(
  "Tragic Tales: Banned in polite company, this book grows less bawdy and more harrowing towards the end. Worth 100gp.",
  trinkets, (o) => o.description)), "Tragic Tales");

// Text from a different table must NOT be forced onto the nearest option.
eq("wrong table", bestTextMatch(performance[0].description, trinkets, (o) => o.description), null);

// Nor should free-form writing of the player's own.
eq("free text", bestTextMatch("A fiddle my mother left me.", trinkets, (o) => o.description), null);

// Ambiguity is left unmatched: re-tagging the wrong item means a later re-roll
// deletes something the player owns.
const twins = [
  { description: "A brass key, cold to the touch, that opens nothing you have found." },
  { description: "A brass key, warm to the touch, that opens nothing you have found." },
];
eq("ambiguous", bestTextMatch("A brass key, cool to the touch, that opens nothing you have found.",
  twins, (o) => o.description), null);

console.log(failures === 0 ? "\nPASS — import parsing is correct." : `\nFAIL — ${failures} assertion(s).`);
process.exit(failures === 0 ? 0 : 1);

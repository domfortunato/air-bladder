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

const tableValues = (name) => {
  const dir = path.join(ROOT, "src", "packs", "tables-2e");
  const file = fs.readdirSync(dir).find((f) => f.startsWith(`${name}_`));
  const doc = YAML.load(fs.readFileSync(path.join(dir, file), "utf8"));
  return new Set((doc.results ?? []).map((r) => String(r.text).trim().toLowerCase()));
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

console.log(failures === 0 ? "\nPASS — import parsing is correct." : `\nFAIL — ${failures} assertion(s).`);
process.exit(failures === 0 ? 0 : 1);

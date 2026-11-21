/**
 * Probe: the Kettlewright -> Air Bladder character importer.
 * Feeds a synthetic Kettlewright export (built from the real toJSON schema) through
 * kettlewrightToActorData, asserts the field mapping (abilities/hp/gold, item match
 * vs. tag-fallback, fatigue, carrying-marker skip, background match vs. keep-as-text,
 * scars split, omen, bonds, flattened containers), then CREATES the actor to confirm
 * the runtime fields (notes/description) persist.
 *
 *   node tools/dev/e2e-kw-import-data.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const browser = await chromium.launch();
// The fleet's hang guard (review #34): without it a hang runs to the runner's
// 65-minute cap and skips every restore. A bound on a hang, not a timing claim.
watchdog(900000, "dev:kw-import-data");
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

const result = await page.evaluate(async () => {
  const KW = game.cairn.kettlewrightImport;
  const FAT = game.i18n.localize("CAIRN.Fatigue");

  const sample = {
    id: 123,
    name: "Bram Testcairn",
    background: "Kettlewright", // a real shipped 2e background
    strength: 11, strength_max: 13,
    dexterity: 9, dexterity_max: 9,
    willpower: 8, willpower_max: 10,
    hp: 3, hp_max: 5,
    gold: 57,
    deprived: true,
    panicked: false,
    armor: "1",
    description: "A weathered peddler.",
    traits: "Athletic; scarred",
    notes: "Player note here.",
    bonds: "You owe a debt to the guild.",
    scars: "Split Ear;Broken Nose",
    omens: "The crows gather at dusk.",
    custom_image: false,
    image_url: "",
    items: [
      { id: "a1", name: "Rations", tags: ["uses"], uses: 3, location: 0, description: "-" }, // known -> matched
      { id: "b2", name: "Frobnicator", tags: ["d8", "bulky"], location: 0, description: "A strange weapon." }, // unknown -> weapon+bulky
      { id: "c3", name: "Fatigue", tags: [], location: 0, editable: false }, // -> AB fatigue item
      { id: "d4_0", name: "Carrying Donkey", tags: [], location: 0, editable: false, carrying: 1 }, // marker -> skipped
    ],
    containers: [
      { id: 0, name: "Main", slots: 10 },
      { id: 1, name: "Donkey", slots: 4 },
    ],
  };

  const { data, report } = await KW.kettlewrightToActorData(sample);
  const s = data.system;

  const out = {
    // abilities / core
    str: [s.abilities.STR.value, s.abilities.STR.max],
    dex: [s.abilities.DEX.value, s.abilities.DEX.max],
    wil: [s.abilities.WIL.value, s.abilities.WIL.max],
    hp: [s.hp.value, s.hp.max],
    gold: s.gold,
    deprived: s.deprived,
    panicked: s.panicked,
    armorOverride: s.armorOverride,
    // background
    background: s.background,
    backgroundUuidSet: !!s.backgroundUuid,
    reportBgMatched: report.background?.matched,
    // items
    itemNames: data.items.map((i) => i.name),
    itemTypes: data.items.map((i) => i.type),
    frob: data.items.find((i) => i.name === "Frobnicator"),
    hasFatigue: data.items.some((i) => i.name === FAT),
    carryingSkipped: !data.items.some((i) => /carrying/i.test(i.name)),
    reportMatched: report.matched,
    reportFallback: report.fallback,
    reportFatigue: report.fatigue,
    allImportedTagged: data.items.every((i) => i.flags?.["air-bladder"]?.grantSource === "imported"),
    // text best-fit
    scars: s.scars,
    scarEnabled: s.scarEnabled,
    omen: s.omen,
    omenEnabled: s.omenEnabled,
    bonds: s.bonds,
    notesHasTraits: /Athletic; scarred/.test(s.notes),
    description: s.description,
    // containers flattened
    reportContainers: report.containers,
  };

  // Unmatched background keeps the raw string, empty uuid.
  const bad = await KW.kettlewrightToActorData({ ...sample, background: "Nonexistent QZ", custom_background: "" });
  out.badBgName = bad.data.system.background;
  out.badBgUuid = bad.data.system.backgroundUuid;
  out.badBgMatched = bad.report.background?.matched;

  // CREATE the actor to confirm runtime fields (notes/description) persist + items land.
  const actor = await Actor.implementation.create(data);
  out.created = !!actor;
  out.persistNotes = /Player note here/.test(actor.system.notes ?? "");
  out.persistDesc = actor.system.description ?? "";
  out.persistOmen = actor.system.omen ?? "";
  out.persistScars = actor.system.scars ?? [];
  out.actorItemCount = actor.items.size;
  await actor.delete();

  return out;
});

// --- The current export shape (Kettlewright since 2026-09-22) ---------------
// Darragh is a real export from the user, 2026-11-20: the background's
// answers ride `background_tableN_question` / `_answer` and `notes` is empty.
// Read only `notes`, as the importer did, and he lands with no answers and
// nothing re-rollable. Data-only: nothing is created, so nothing to clean up.
const darragh = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "dev", "fixtures", "kettlewright-darragh.json"), "utf8"));
const pairs = await page.evaluate(async (dj) => {
  const KW = game.cairn.kettlewrightImport;
  const read = async (json) => {
    const { data, report } = await KW.kettlewrightToActorData(json);
    const tag = (name) => data.items.find((i) => i.name === name)?.flags?.["air-bladder"]?.grantSource ?? null;
    return {
      answers: data.system.questions.map((q) => q.answer),
      questions: data.system.questions.map((q) => q.question),
      found: report.questions ?? null,
      total: report.questionsTotal ?? null,
      notes: data.system.notes,
      sword: tag("Long Sword"),
      gambeson: tag("Gambeson"),
      paste: tag("Tinker's Paste"),
      bondId: data.system.bonds[0]?.id ?? null,
      moss: tag("Silver Moss"),
    };
  };
  const strip = (json) => Object.fromEntries(Object.entries(json).filter(([k]) => !/^background_table\d+_/.test(k)));
  return {
    direct: await read(dj),
    // The player relay rebuilds the export field by field; a key it does not
    // copy never reaches the conversion.
    relay: await read(KW.sanitizeKettlewrightExport(dj)),
    // Kettlewright passes the question through its translation step, so a
    // Spanish creator's question matches no English text; the number places it.
    translated: await read({ ...dj, background_table1_question: "¿Cuál es tu oficio?" }),
    // No background to place the answers on: they must reach Notes, not vanish.
    unmatched: await read({ ...dj, background: "Nonexistent QZ" }),
    // An older export, the same answers written into notes: still split.
    legacy: await read({
      ...strip(dj),
      notes: `${dj.background_table1_question}\n${dj.background_table1_answer}\n\n${dj.background_table2_question}\n${dj.background_table2_answer}`,
    }),
  };
}, darragh);

await browser.close();

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wantAnswers = [darragh.background_table1_answer, darragh.background_table2_answer];
const placedRight = (r) => r && eq(r.answers, wantAnswers) && r.found === 2 && r.total === 2;
const retagged = (r) => r && r.sword === "question:0" && r.gambeson === "question:0" && r.paste === "question:1"
  && !!r.bondId && r.moss === `bond:${r.bondId}`;
const checks = [
  ["STR value+max mapped", eq(result.str, [11, 13])],
  ["DEX value+max mapped", eq(result.dex, [9, 9])],
  ["WIL value+max mapped", eq(result.wil, [8, 10])],
  ["HP value+max mapped", eq(result.hp, [3, 5])],
  ["gold mapped", result.gold === 57],
  ["deprived / panicked mapped", result.deprived === true && result.panicked === false],
  ["armorOverride = 1", result.armorOverride === 1],
  ["background matched -> uuid set", result.background === "Kettlewright" && result.backgroundUuidSet && result.reportBgMatched === true],
  ["unmatched background kept as text, no uuid", result.badBgName === "Nonexistent QZ" && result.badBgUuid === "" && result.badBgMatched === false],
  ["Rations matched by name", result.reportMatched.includes("Rations")],
  ["Frobnicator -> weapon + bulky", result.frob?.type === "weapon" && result.frob?.system?.bulky === true],
  ["Frobnicator in fallback list", result.reportFallback.includes("Frobnicator")],
  ["Fatigue item created", result.hasFatigue && result.reportFatigue === 1],
  ["Carrying marker skipped", result.carryingSkipped === true],
  ["all imported items tagged grantSource=imported", result.allImportedTagged === true],
  ["scars split into two, enabled", eq(result.scars, ["Split Ear", "Broken Nose"]) && result.scarEnabled === true],
  ["omen set + enabled", /crows gather/.test(result.omen) && result.omenEnabled === true],
  ["bonds -> one entry", Array.isArray(result.bonds) && result.bonds.length === 1 && /owe a debt/.test(result.bonds[0].description)],
  ["traits folded into notes", result.notesHasTraits === true],
  ["description mapped", /weathered peddler/.test(result.description)],
  ["containers flattened (Donkey listed, not Main)", eq(result.reportContainers, ["Donkey"])],
  ["actor created", result.created === true],
  ["notes persisted on actor", result.persistNotes === true],
  ["description persisted on actor", /weathered peddler/.test(result.persistDesc)],
  ["omen persisted on actor", /crows gather/.test(result.persistOmen)],
  ["scars persisted on actor", eq(result.persistScars, ["Split Ear", "Broken Nose"])],
  ["actor has 3 items (Rations, Frobnicator, Fatigue)", result.actorItemCount === 3],
  ["current export: both numbered answers land on the background's questions", placedRight(pairs.direct)
    && eq(pairs.direct.questions, [darragh.background_table1_question, darragh.background_table2_question])],
  ["current export: the answers' items and the bond's are re-rollable", retagged(pairs.direct)],
  ["current export: notes stay the player's (empty)", pairs.direct.notes === ""],
  ["player relay: the numbered answers survive the rebuild", placedRight(pairs.relay) && retagged(pairs.relay)],
  ["translated question: placed by its number", placedRight(pairs.translated) && pairs.translated.sword === "question:0"],
  ["unmatched background: both questions and answers kept in Notes",
    pairs.unmatched.found === null && wantAnswers.every((a) => pairs.unmatched.notes.includes(a))
    && pairs.unmatched.notes.includes(darragh.background_table1_question)],
  ["older export: answers in notes still split", placedRight(pairs.legacy) && retagged(pairs.legacy) && pairs.legacy.notes === ""],
];

console.log(`\n${FOUNDRY_URL}\n`);
let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
console.log("\n", JSON.stringify(result, null, 2));
console.log("\n", JSON.stringify(pairs, null, 2));
if (errors.length) { ok = false; console.log("\nConsole errors:\n" + errors.join("\n")); }
console.log(ok ? "\nprobe passed\n" : "\nprobe FAILED\n");
process.exit(ok ? 0 : 1);

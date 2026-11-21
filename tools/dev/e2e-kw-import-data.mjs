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
    // Rations is in the Kettlewright background's own starting gear, so it
    // re-tags to that background (2026-11-20); the two items no grant names
    // stay `imported`, which no re-roll ever removes.
    allImportedTagged: ["Frobnicator", FAT].every((n) => data.items.find((i) => i.name === n)?.flags?.["air-bladder"]?.grantSource === "imported"),
    rationsSource: data.items.find((i) => i.name === "Rations")?.flags?.["air-bladder"]?.grantSource ?? null,
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

// --- Bonds, uses, Barebones, starting gear (2026-11-20 plan, items 1-3) -----
// Evander is a real Barebones export from the user, 2026-11-20 (Barkeep).
// Data-only like the leg above: nothing is created.
const evander = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "dev", "fixtures", "kettlewright-evander.json"), "utf8"));
const more = await page.evaluate(async ({ dj, ev }) => {
  const KW = game.cairn.kettlewrightImport;
  const src = (item) => item?.flags?.["air-bladder"]?.grantSource ?? null;
  const byName = (data, name) => data.items.find((i) => i.name === name);
  const out = {};

  // (1) Two bonds, the way Kettlewright joins a Fieldwarden's or an
  // Outrider's: a blank line between. The second is another shipped Bonds row
  // that grants an item, picked from the pack so the text is the pack's own.
  const bondsTable = (await game.packs.get("air-bladder.tables-2e").getDocuments()).find((t) => t.name === "Bonds");
  const second = bondsTable.results.find((r) => {
    const its = r.getFlag("air-bladder", "items") ?? [];
    return its.length === 1 && its[0].name !== "Silver Moss" && !dj.items.some((i) => i.name === its[0].name);
  });
  const secondText = second.description || second.name;
  const secondItem = second.getFlag("air-bladder", "items")[0].name;
  out.secondItem = secondItem;
  const twoBonds = {
    ...dj,
    bonds: `${dj.bonds}\n\n${secondText}`,
    items: [...dj.items, { id: "zz-bond2", name: secondItem, tags: [], location: 0, description: "" }],
  };
  for (const [leg, json] of [["bondsDirect", twoBonds], ["bondsRelay", KW.sanitizeKettlewrightExport(twoBonds)]]) {
    const { data } = await KW.kettlewrightToActorData(json);
    const b = data.system.bonds;
    out[leg] = {
      count: b.length,
      texts: b.map((x) => x.description),
      moss: src(byName(data, "Silver Moss")),
      second: src(byName(data, secondItem)),
      ids: b.map((x) => x.id),
    };
  }
  out.secondText = secondText;
  const single = await KW.kettlewrightToActorData(dj);
  out.singleBondCount = single.data.system.bonds.length;

  // (2) Uses below their maximum: a matched Torch at 1 of 3, and an item no
  // pack carries (built from its tags) at 1 of 4.
  const worn = {
    ...dj,
    items: [
      ...dj.items.map((i) => (i.name === "Torch" ? { ...i, uses: 1, max_uses: 3 } : i)),
      { id: "zz-flask", name: "ZZ Probe Flask", tags: ["uses"], uses: 1, max_uses: 4, location: 0, description: "" },
    ],
  };
  for (const [leg, json] of [["usesDirect", worn], ["usesRelay", KW.sanitizeKettlewrightExport(worn)]]) {
    const { data } = await KW.kettlewrightToActorData(json);
    out[leg] = {
      torch: byName(data, "Torch")?.system?.uses ?? null,
      flask: byName(data, "ZZ Probe Flask")?.system?.uses ?? null,
    };
  }

  // (3) Barebones: the content source, the Barebones background pool, the
  // background's three items and the SRD kit each tagged so a re-roll
  // replaces rather than doubles. Darragh is the 2e control.
  for (const [leg, json] of [["evDirect", ev], ["evRelay", KW.sanitizeKettlewrightExport(ev)]]) {
    const { data, report } = await KW.kettlewrightToActorData(json);
    out[leg] = {
      source: data.system.contentSource,
      background: data.system.background,
      uuid: data.system.backgroundUuid,
      matched: report.background?.matched ?? null,
      tags: Object.fromEntries(data.items.map((i) => [i.name, src(i)])),
      questions: data.system.questions.length,
    };
  }
  out.evUuidIsBarebones = !!out.evDirect.uuid && out.evDirect.uuid.includes("backgrounds-barebones");
  const d = single.data;
  out.darraghSource = d.system.contentSource;
  // 2e starting gear: Kettlewright's own Pincers / Roll of Tin / Gloves / Hammer.
  out.darraghGear = Object.fromEntries(["Pincers", "Roll of Tin", "Gloves", "Hammer", "Long Sword"].map((n) => [n, src(byName(d, n))]));
  return out;
}, { dj: darragh, ev: evander });

await browser.close();

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bondsOk = (r) => r && r.count === 2 && r.texts[0] === darragh.bonds && r.texts[1] === more.secondText
  && r.moss === `bond:${r.ids[0]}` && r.second === `bond:${r.ids[1]}`;
const evKit = ["Rations", "Torch", "Chainmail", "Sword", "Air Bladder"];
const evBg = ["Alcohol", "Sealable Bottle", "Sedative"];
const evOk = (r) => r && r.source === "barebones" && r.background === "Barkeep" && r.matched === true
  && evKit.every((n) => r.tags[n] === "barebones-kit")
  && evBg.every((n) => /^background/.test(r.tags[n] ?? "")) && r.questions === 0;
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
  ["items no grant names stay grantSource=imported", result.allImportedTagged === true],
  ["the background's starting gear re-tags to it (Rations)", /^background/.test(result.rationsSource ?? "")],
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
  ["two bonds: split at the blank line, each item re-tagged to its own bond", bondsOk(more.bondsDirect)],
  ["two bonds: the player relay too", bondsOk(more.bondsRelay)],
  ["one bond stays one bond", more.singleBondCount === 1],
  ["uses: a matched Torch keeps 1 of 3", eq(more.usesDirect.torch, { value: 1, max: 3 })],
  ["uses: a tag-built item keeps 1 of 4", eq(more.usesDirect.flask, { value: 1, max: 4 })],
  ["uses: the player relay keeps max_uses", eq(more.usesRelay.torch, { value: 1, max: 3 }) && eq(more.usesRelay.flask, { value: 1, max: 4 })],
  ["Barebones: content source, Barebones background, kit and background gear tagged", evOk(more.evDirect) && more.evUuidIsBarebones],
  ["Barebones: the player relay too", evOk(more.evRelay)],
  ["2e control: Darragh stays 2e", more.darraghSource === "2e"],
  ["2e: the background's starting gear re-tags, an answer's item keeps its question",
    ["Pincers", "Roll of Tin", "Gloves", "Hammer"].every((n) => /^background/.test(more.darraghGear[n] ?? ""))
    && more.darraghGear["Long Sword"] === "question:0"],
];

console.log(`\n${FOUNDRY_URL}\n`);
let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
console.log("\n", JSON.stringify(result, null, 2));
console.log("\n", JSON.stringify(pairs, null, 2));
console.log("\n", JSON.stringify(more, null, 2));
if (errors.length) { ok = false; console.log("\nConsole errors:\n" + errors.join("\n")); }
console.log(ok ? "\nprobe passed\n" : "\nprobe FAILED\n");
process.exit(ok ? 0 : 1);

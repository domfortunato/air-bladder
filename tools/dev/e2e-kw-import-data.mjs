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

// --- Uploaded portraits and pets (plan items 4 and 5) ----------------------
// Ambrose is a real 2e export from the user, 2026-11-20 (Mountebank): an
// uploaded portrait, and a pet that is also an item he holds. Evander's pet
// does not fit his inventory. One leg CREATES documents, so its cleanup runs
// from a finally, by id difference, and reports what it removed.
const ambrose = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "dev", "fixtures", "kettlewright-ambrose.json"), "utf8"));
const petLegs = await page.evaluate(async ({ am, ev }) => {
  const KW = game.cairn.kettlewrightImport;
  const out = {};
  const count = (data, name) => data.items.filter((i) => i.name === name).length;
  const read = async (json) => {
    const r = await KW.kettlewrightToActorData(json);
    return {
      img: r.data.img ?? null,
      linked: r.report.portraitLinked ?? null,
      dropped: r.report.portrait ?? null,
      pets: r.report.pets ?? null,
      specs: (r.pets ?? []).map((s) => ({ name: s.name, role: s.role, description: s.description, hp: s.hp ?? null, abilities: s.abilities ?? null })),
      tattoo: count(r.data, "Alchemical Tattoo"),
      cat: count(r.data, "Carrion Cat"),
      catSource: r.data.items.find((i) => i.name === "Carrion Cat")?.flags?.["air-bladder"]?.grantSource ?? null,
    };
  };
  out.amDirect = await read(am);
  out.amRelay = await read(KW.sanitizeKettlewrightExport(am));
  out.evDirect = await read(ev);
  out.evRelay = await read(KW.sanitizeKettlewrightExport(ev));
  // Without his Chainmail (bulky) Evander has room, so the cat is an item.
  const roomy = { ...ev, items: ev.items.filter((i) => i.name !== "Chainmail") };
  out.evRoomy = await read(roomy);
  // A pet no pack carries, with stats: a companion carrying them.
  const ferret = {
    ...ev,
    pets: [{
      name: "ZZ Probe Ferret", role: "Ferret", notes: "Bites ankles.", attack: "",
      hp: 2, hp_max: 3, strength: 4, strength_max: 5, dexterity: 14, dexterity_max: 15,
      willpower: 6, willpower_max: 7, armor: 0, gold: 0, image_url: "", custom_image: false, items: [], containers: [],
    }],
  };
  out.ferret = await read(ferret);
  out.ferretRelay = await read(KW.sanitizeKettlewrightExport(ferret));

  // The summary dialog's own words for those reports (approved 2026-11-21).
  // Rendered against an unsaved stand-in, read, closed; nothing is stored.
  const summaryText = async (json, extra = {}) => {
    const { data, report } = await KW.kettlewrightToActorData(json);
    Object.assign(report, extra);
    const stand = new Actor.implementation({ name: data.name, type: "character" });
    const was = new Set(foundry.applications.instances.keys());
    await KW.showImportSummary(stand, report);
    const app = [...foundry.applications.instances.values()].find((a) => !was.has(a.id));
    const text = app?.element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    await app?.close();
    return text;
  };
  out.amSummary = await summaryText(am);
  out.evSummary = await summaryText(ev);
  out.roomySummary = await summaryText(roomy);
  out.limitSummary = await summaryText(ev, { pets: [{ name: "Carrion Cat", as: "limit" }] });

  // CREATE: Evander's import mints him AND a Carrion Cat companion connected
  // to him. Everything that appears is deleted by id difference.
  const before = new Set(game.actors.map((a) => a.id));
  try {
    const { actor } = await KW.performKettlewrightImport(ev);
    // The companion lands after the character; poll briefly for it.
    let cat = null;
    for (let i = 0; i < 40 && !cat; i++) {
      cat = game.actors.find((a) => !before.has(a.id) && a.type === "npc" && a.name === "Carrion Cat") ?? null;
      if (!cat) await new Promise((r) => setTimeout(r, 100));
    }
    out.created = {
      actor: !!actor,
      cat: !!cat,
      connected: cat?.system?.connectedTo === actor?.uuid,
      role: cat?.system?.role ?? null,
      description: cat?.system?.description ?? null,
      catItemOnPc: actor ? actor.items.some((i) => i.name === "Carrion Cat") : null,
    };
  } finally {
    const made = game.actors.filter((a) => !before.has(a.id));
    out.cleaned = made.map((a) => a.name);
    if (made.length) await Actor.implementation.deleteDocuments(made.map((a) => a.id));
  }

  // CREATE, two companions (review #36 S13, S14). Two pets no pack carries,
  // each holding its own item, and each named with a word the Kind classifier
  // reads as a thing: "Cart Horse" (cart) and "Chestnut" (chest).
  //   S13: a batch create comes back in the order the server finished each
  //   document, so each pet's items must reach it by identity. The control
  //   is in-page and writes nothing of its own: createDocuments hands a
  //   batch of two or more back REVERSED for this leg only, so pairing by
  //   position puts each pet's item on the other.
  //   S14: a pet is a companion whatever it is called, so its stored Kind
  //   and its art must be a companion's, never the cart's or the chest's.
  const twoPet = (name, item) => ({
    name, role: name, notes: "", attack: "",
    hp: 2, hp_max: 2, strength: 5, strength_max: 5, dexterity: 9, dexterity_max: 9,
    willpower: 6, willpower_max: 6, armor: 0, gold: 0, image_url: "", custom_image: false,
    items: [{ id: `zz-${item}`, name: item, tags: [], location: 0, description: "" }], containers: [],
  });
  const two = { ...ev, pets: [twoPet("Cart Horse", "ZZ Probe Saddle"), twoPet("Chestnut", "ZZ Probe Bell")] };
  const icons = await import("/systems/air-bladder/module/icons.js");
  const Cls = Actor.implementation;
  const ownCreate = Object.hasOwn(Cls, "createDocuments");
  const origCreate = Cls.createDocuments;
  const before2 = new Set(game.actors.map((a) => a.id));
  try {
    Cls.createDocuments = async function(...args) {
      const made = await origCreate.apply(this, args);
      return made.length > 1 ? [...made].reverse() : made;
    };
    const { actor, report } = await KW.performKettlewrightImport(two);
    const fresh = game.actors.filter((a) => !before2.has(a.id) && a.type === "npc");
    const seen = (name) => {
      const npc = fresh.find((a) => a.name === name);
      const cls = npc?.system?.containerClass ?? null;
      return {
        found: !!npc,
        connected: !!npc && npc.system.connectedTo === actor?.uuid,
        role: npc?.system?.role ?? null,
        cls,
        clsRole: cls == null ? null : icons.containerClassRole(cls),
        img: npc?.img ?? null,
        token: npc?.prototypeToken?.texture?.src ?? null,
        items: npc ? npc.items.map((i) => i.name).sort() : null,
      };
    };
    out.twoPets = {
      count: fresh.length,
      cartHorse: seen("Cart Horse"),
      chestnut: seen("Chestnut"),
      turnedAway: report.petsTurnedAway ?? null,
      pets: report.pets ?? null,
    };
  } finally {
    if (ownCreate) Cls.createDocuments = origCreate;
    else delete Cls.createDocuments;
    const made = game.actors.filter((a) => !before2.has(a.id));
    out.twoPetsCleaned = made.length;
    if (made.length) await Actor.implementation.deleteDocuments(made.map((a) => a.id));
  }
  return out;
}, { am: ambrose, ev: evander });

await browser.close();

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AMBROSE_URL = `https://kettlewright.com${ambrose.image_url}`;
const catNotes = evander.pets[0].notes;
const amOk = (r) => r && r.img === AMBROSE_URL && r.linked === AMBROSE_URL && r.dropped === null
  && r.tattoo === 1 && r.specs.length === 0 && eq(r.pets, [{ name: "Alchemical Tattoo", as: "held" }]);
const evOkPet = (r) => r && r.cat === 0 && r.specs.length === 1 && r.specs[0].name === "Carrion Cat"
  && r.specs[0].role === "companion" && r.specs[0].description === catNotes
  && eq(r.pets, [{ name: "Carrion Cat", as: "companion" }]);
const ferretOk = (r) => r && r.specs.length === 1 && r.specs[0].name === "ZZ Probe Ferret"
  && eq(r.specs[0].hp, { value: 2, max: 3 }) && r.specs[0].abilities?.STR?.value === 4 && r.specs[0].abilities?.DEX?.max === 15
  && eq(r.pets, [{ name: "ZZ Probe Ferret", as: "companion" }]);
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
  ["uploaded portrait: linked from kettlewright.com, and the summary is told", amOk(petLegs.amDirect)],
  ["uploaded portrait + held pet: the player relay too", amOk(petLegs.amRelay)],
  ["a pet that is an item he holds adds nothing (Alchemical Tattoo)", petLegs.amDirect.tattoo === 1 && petLegs.amDirect.specs.length === 0],
  ["a pet item that does not fit becomes a companion (Evander's Carrion Cat)", evOkPet(petLegs.evDirect)],
  ["... the player relay too", evOkPet(petLegs.evRelay)],
  ["a pet item that fits becomes an item, not a companion", petLegs.evRoomy.cat === 1 && petLegs.evRoomy.specs.length === 0
    && petLegs.evRoomy.catSource === "imported" && eq(petLegs.evRoomy.pets, [{ name: "Carrion Cat", as: "item" }])],
  ["a pet no pack carries becomes a companion with its stats", ferretOk(petLegs.ferret)],
  ["... the player relay keeps the stats", ferretOk(petLegs.ferretRelay)],
  ["create: the companion is minted and connected to the character", petLegs.created?.actor === true && petLegs.created?.cat === true
    && petLegs.created?.connected === true && petLegs.created?.role === "companion"
    && petLegs.created?.description === catNotes && petLegs.created?.catItemOnPc === false],
  ["create: cleanup removed exactly the character and the companion", eq([...petLegs.cleaned].sort(), ["Carrion Cat", evander.name].sort())],
  ["two companions: both are minted and connected, none turned away", petLegs.twoPets?.count === 2
    && petLegs.twoPets.cartHorse.connected && petLegs.twoPets.chestnut.connected && petLegs.twoPets.turnedAway === null
    && eq(petLegs.twoPets.pets, [{ name: "Cart Horse", as: "companion" }, { name: "Chestnut", as: "companion" }])],
  ["two companions: each holds its own item when the batch comes back reversed (review #36 S13)",
    eq(petLegs.twoPets?.cartHorse.items, ["ZZ Probe Saddle"]) && eq(petLegs.twoPets?.chestnut.items, ["ZZ Probe Bell"])],
  ["a pet named like a cart or a chest is a companion in role, Kind and art (review #36 S14)",
    [petLegs.twoPets?.cartHorse, petLegs.twoPets?.chestnut].every((p) => p && p.role === "companion"
      && ["", "companion"].includes(p.clsRole)
      && !/(?:cart|chest)\.svg$/.test(p.img ?? "") && !/(?:cart|chest)\.svg$/.test(p.token ?? ""))],
  ["two companions: cleanup removed exactly the character and both companions", petLegs.twoPetsCleaned === 3],
  ["summary: the linked portrait is said", petLegs.amSummary.includes("The uploaded portrait is loaded from kettlewright.com. Save a copy and set it from the sheet to keep it.")],
  ["summary: a held pet says nothing", !/Pet: Alchemical Tattoo/.test(petLegs.amSummary)],
  ["summary: a companion pet is said", petLegs.evSummary.includes("Pet: Carrion Cat came in as a companion connected to this character.")],
  ["summary: an item pet is said", petLegs.roomySummary.includes("Pet: Carrion Cat came in as an item.")],
  ["summary: a pet turned away is said", petLegs.limitSummary.includes("Pet: Carrion Cat wasn't imported — this character is at the connection limit.")],
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
console.log("\n", JSON.stringify(petLegs, null, 2));
if (errors.length) { ok = false; console.log("\nConsole errors:\n" + errors.join("\n")); }
console.log(ok ? "\nprobe passed\n" : "\nprobe FAILED\n");
process.exit(ok ? 0 : 1);

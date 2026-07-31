/**
 * Data-model round-trip e2e.
 *
 * The failure mode a TypeDataModel introduces is SILENT: a field the schema
 * forgets is dropped on write with no error, so a sheet edit appears to work and
 * the value is simply gone on the next render. `npm run check:fields` catches it
 * statically; this catches it live, by driving the real write paths and reading
 * the SOURCE back afterwards.
 *
 * Covers: generation on every background, a field round-trip on all four Actor
 * sheets and all seven Item sheets, marketplace buy/take, container grant and
 * delete, and hireling generation.
 *
 * Usage: npm run dev:data-model
 */

import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, watchErrors } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(20)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(20)} ${detail}`); failures++; };
let failures = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/* -------------------------------------------- */

console.log("\ngeneration on every 2e background");
const gen = await page.evaluate(async () => {
  const pack = game.packs.get("air-bladder.backgrounds-2e");
  const bgs = await pack.getDocuments();
  const out = [];
  for (const bg of bgs) {
    const gen = game.cairn.characterGenerator;
    const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter(bg));
    if (!actor) { out.push({ bg: bg.name, error: "no actor" }); continue; }
    // SOURCE, not derived — derived data is recomputed and would mask a drop.
    const src = actor.toObject().system;
    out.push({
      bg: bg.name,
      background: src.background,
      uuid: !!src.backgroundUuid,
      hp: src.hp?.value,
      str: src.abilities?.STR?.value,
      traits: Object.values(src.traits ?? {}).filter(Boolean).length,
      age: src.age,
      bonds: (src.bonds ?? []).length,
      questions: (src.questions ?? []).length,
      items: actor.items.size,
      gold: src.gold,
    });
    await actor.delete();
  }
  return out;
});

const missing = (k) => gen.filter((g) => !g[k] && g[k] !== 0);
if (gen.some((g) => g.error)) fail("all generated", gen.filter((g) => g.error).map((g) => g.bg).join(", "));
else ok("all generated", `${gen.length} backgrounds`);

for (const [field, test] of [
  ["background", (g) => !!g.background],
  ["backgroundUuid", (g) => g.uuid],
  ["hp", (g) => g.hp > 0],
  ["abilities", (g) => g.str > 0],
  ["traits (8)", (g) => g.traits === 8],
  ["age", (g) => !!g.age],
  ["bonds", (g) => g.bonds >= 1],
  ["questions", (g) => g.questions >= 1],
  ["items", (g) => g.items > 0],
]) {
  const bad = gen.filter((g) => !g.error && !test(g));
  if (bad.length) fail(field, `${bad.length} bad: ${bad.slice(0, 3).map((g) => g.bg).join(", ")}`);
  else ok(field, `present on all ${gen.length}`);
}

/* -------------------------------------------- */

console.log("\nActor sheet round-trip (write, reload source, compare)");
const actorRT = await page.evaluate(async () => {
  const probes = {
    character: { "system.pronouns": "they/them", "system.gold": 42, "system.omen": "<p>a red sky</p>", "system.slots": 12 },
    npc: { "system.gold": 7, "system.slots": 5, "system.background": "Ruin-dweller", "system.notes": "<p>n</p>" },
    container: { "system.slots": 4, "system.cost": 15, "system.gold": 3, "system.biography": "<p>b</p>" },
    hireling: { "system.profession": "Linkboy", "system.dayRate": 3, "system.gold": 9, "system.notes": "<p>h</p>" },
  };
  const out = [];
  for (const [type, patch] of Object.entries(probes)) {
    const actor = await Actor.create({ name: `__rt_${type}`, type });
    await actor.update({ ...patch });
    const src = actor.toObject().system;
    for (const [path, want] of Object.entries(patch)) {
      const key = path.replace("system.", "");
      out.push({ type, key, want, got: src[key] });
    }
    await actor.delete();
  }
  return out;
});
for (const r of actorRT) {
  if (r.got === r.want) ok(`${r.type}.${r.key}`, String(r.got));
  else fail(`${r.type}.${r.key}`, `wrote ${JSON.stringify(r.want)}, read back ${JSON.stringify(r.got)}`);
}

/* -------------------------------------------- */

console.log("\nItem sheet round-trip");
const itemRT = await page.evaluate(async () => {
  const probes = {
    item: { "system.cost": 11, "system.quantity": 3, "system.bulky": true, "system.armor": 1, "system.uses.max": 4 },
    weapon: { "system.cost": 12, "system.damageFormula": "d8", "system.blast": true, "system.criticalDamage": "<p>c</p>" },
    armor: { "system.cost": 13, "system.armor": 2, "system.uses.value": 1 },
    spellbook: { "system.cost": 14, "system.weightless": true },
    object: { "system.cost": 15, "system.quantity": 2 },
    background: { "system.source": "2e", "system.archetype": "Thief", "system.names": ["Bel", "Cass"] },
    transport: { "system.cost": 16, "system.slots": 8, "system.load": 1, "system.slow": true, "system.transportKind": "vehicle" },
  };
  const out = [];
  for (const [type, patch] of Object.entries(probes)) {
    const item = await Item.create({ name: `__rt_${type}`, type });
    await item.update({ ...patch });
    const src = item.toObject().system;
    for (const [path, want] of Object.entries(patch)) {
      const key = path.replace("system.", "");
      const got = key.includes(".") ? key.split(".").reduce((o, k) => o?.[k], src) : src[key];
      out.push({ type, key, want, got });
    }
    await item.delete();
  }
  return out;
});
for (const r of itemRT) {
  const same = JSON.stringify(r.got) === JSON.stringify(r.want);
  if (same) ok(`${r.type}.${r.key}`, JSON.stringify(r.got));
  else fail(`${r.type}.${r.key}`, `wrote ${JSON.stringify(r.want)}, read back ${JSON.stringify(r.got)}`);
}

/* -------------------------------------------- */

console.log("\nderived data reaches the sheet");
const derived = await page.evaluate(async () => {
  const actor = await Actor.create({ name: "__rt_derived", type: "character" });
  const pack = game.packs.get("air-bladder.market-goods");
  const goods = await pack.getDocuments();
  await actor.createEmbeddedDocuments("Item", [goods[0].toObject()]);
  await actor.update({ "system.gold": 250 });
  // ApplicationV2's context hook is `_prepareContext`, and it publishes system
  // data at the context ROOT rather than under AppV1's `context.data` sub-object.
  const sheetData = await actor.sheet._prepareContext({});
  const out = {
    slotsUsed: sheetData.system.slotsUsed,
    slotsMax: sheetData.system.slotsMax,
    encumbered: sheetData.system.encumbered,
    goldSlots: sheetData.system.goldSlots,
    coinsPerSlot: sheetData.system.coinsPerSlot,
    armor: sheetData.system.armor,
    itemHasDerived: sheetData.items?.[0]?.system?.isEquipable !== undefined,
    // stored fields must still be there alongside the derived ones
    gold: sheetData.system.gold,
  };
  // Armor is derived from equipped gear via calcArmor(), which reads
  // item.system.armor on BOTH armor and item types — the field the survey nearly
  // dropped from the item schema.
  const [helm] = await actor.createEmbeddedDocuments("Item", [
    { name: "__rt_helm", type: "armor", system: { armor: 2, equipped: true } },
  ]);
  const [charm] = await actor.createEmbeddedDocuments("Item", [
    { name: "__rt_charm", type: "item", system: { armor: 1, equipped: true } },
  ]);
  out.armorFromGear = actor.system.armor;
  out.armorOverride = await actor.update({ "system.armorOverride": 3 }).then(() => actor.system.armor);
  await actor.delete();
  return out;
});
for (const [k, v] of Object.entries(derived)) {
  if (v === undefined) fail(`sheet ${k}`, "undefined — derived data is not reaching the template");
  else if (k === "armorFromGear" && v !== 3) fail("armor from gear", `expected 3 (armor 2 + item 1), got ${v}`);
  else if (k === "armorOverride" && v !== 3) fail("armor override", `expected 3, got ${v}`);
  else ok(`sheet ${k}`, String(v));
}

/* -------------------------------------------- */

console.log("\ncontainers and marketplace");
const containers = await page.evaluate(async () => {
  const actor = await Actor.create({ name: "__rt_mkt", type: "character" });
  await actor.update({ "system.gold": 500 });
  const transports = await game.packs.get("air-bladder.transports").getDocuments();
  const mule = transports.find((t) => t.system.slots > 0) ?? transports[0];
  // The real marketplace path, not a reimplementation of it — acquireTransport is
  // where a transport document becomes a connected NPC, i.e. where the slots
  // shape used to be converted. (It minted a `container` keeper-linked through
  // the owner's array before containers-as-NPCs; this section asserted that
  // old shape long after the code stopped producing it.)
  const mkt = await import("/systems/air-bladder/module/marketplace.js");
  const bought = await mkt.acquireTransport(actor, mule, true);
  const container = game.actors.find((a) => a.type === "npc" && a.system.connectedTo === actor.uuid);
  if (!container) return { error: "no connected npc minted" };
  const csrc = container.toObject().system;
  const out = {
    transportSlots: mule.system.slots,
    containerSlots: csrc.slots,
    containerSlotsIsNumber: typeof csrc.slots === "number",
    containerCapacity: container.calcCurrentMaxSlots(),
    // ONE link, derived: the owner's list comes from each child's connectedTo.
    linked: actor.connectedActors().some((c) => c.id === container.id),
    bought: bought === undefined ? "n/a" : bought,
  };
  await container.delete();
  await actor.delete();
  return out;
});
if (containers.containerSlotsIsNumber) ok("container slots", `plain number ${containers.containerSlots}`);
else fail("container slots", "not a plain number");
if (containers.containerCapacity === containers.transportSlots)
  ok("capacity carried", `${containers.containerCapacity} from the transport`);
else fail("capacity carried", `transport ${containers.transportSlots} -> container ${containers.containerCapacity}`);
if (containers.linked) ok("connected link", "derived onto the owner's list");
else fail("connected link", "the owner's derived list did not pick it up");

/* -------------------------------------------- */

/* The containers-as-NPCs fields. A container is becoming "an NPC with `slots` and
   a `connectedTo`", so these four live on NpcData. Declaring a field and
   PERSISTING one look identical until you read it back off the collection --
   a mis-declared field is silently dropped by schema cleaning with no error
   anywhere -- so every assertion here writes a value and re-reads it. The closed
   -schema check at the end is the control: without it "the value came back" would
   also be true of an object that simply kept whatever it was handed. */
console.log("\ncontainers-as-NPCs fields (NpcData)");
const npcFields = await page.evaluate(async () => {
  const Cls = CONFIG.Actor.documentClass;   // not the global Actor -- see docs
  const a = await Cls.create({ name: "ZZ Schema NpcFields", type: "npc" });
  const pick = (s) => ({
    connectedTo: s.connectedTo, inanimate: s.inanimate,
    containerClass: s.containerClass, cost: s.cost,
  });
  const defaults = pick(a.system);
  await a.update({
    "system.connectedTo": "Actor.abcdef1234567890",
    "system.inanimate": true,
    "system.containerClass": "crate",
    "system.cost": 42,
    // Written ON PURPOSE and expected to vanish. If an undeclared key survived,
    // "the value came back" would be true of anything and every assertion above
    // would pass whether or not the field is really in the schema.
    "system.zzNotAField": "should vanish",
  });
  const fresh = game.actors.get(a.id).system;
  const persisted = pick(fresh);
  const closed = !("zzNotAField" in fresh) && "connectedTo" in fresh;
  await a.delete();
  return { defaults, persisted, closed };
});
const wantDefaults = { connectedTo: "", inanimate: false, containerClass: "", cost: 0 };
const wantStored = { connectedTo: "Actor.abcdef1234567890", inanimate: true, containerClass: "crate", cost: 42 };
for (const [k, v] of Object.entries(wantDefaults)) {
  if (npcFields.defaults[k] === v) ok(`${k} default`, JSON.stringify(v));
  else fail(`${k} default`, `got ${JSON.stringify(npcFields.defaults[k])}, want ${JSON.stringify(v)}`);
}
for (const [k, v] of Object.entries(wantStored)) {
  if (npcFields.persisted[k] === v) ok(`${k} persists`, JSON.stringify(v));
  else fail(`${k} persists`, `got ${JSON.stringify(npcFields.persisted[k])}, want ${JSON.stringify(v)}`);
}
if (npcFields.closed) ok("schema closed", "declared fields present, stowaways dropped");
else fail("schema closed", "an undeclared key survived, so persistence proves nothing");

/* -------------------------------------------- */

console.log("\nhireling generation");
const hire = await page.evaluate(async () => {
  const actor = await game.cairn.characterGenerator.createHireling();
  if (!actor) return { error: "no hireling" };
  const src = actor.toObject().system;
  const out = { profession: src.profession, dayRate: src.dayRate, hp: src.hp?.value, str: src.abilities?.STR?.value, items: actor.items.size, armor: actor.system.armor };
  await actor.delete();
  return out;
});
if (hire.error) fail("hireling", hire.error);
else {
  ok("hireling", `${hire.profession} @ ${hire.dayRate}/day, HP ${hire.hp}, STR ${hire.str}, ${hire.items} items, armor ${hire.armor}`);
  if (!hire.profession || !hire.hp) fail("hireling fields", "profession or hp missing");
}

/* -------------------------------------------- */

await browser.close();

if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  failures += errors.length;
}

console.log(failures ? `\ndata-model e2e FAILED (${failures})` : "\ndata-model e2e passed");
process.exit(failures ? 1 : 0);

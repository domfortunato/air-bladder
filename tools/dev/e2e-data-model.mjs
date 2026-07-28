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
  const sheetData = await actor.sheet.getData();
  const out = {
    slotsUsed: sheetData.data.system.slotsUsed,
    slotsMax: sheetData.data.system.slotsMax,
    encumbered: sheetData.data.system.encumbered,
    goldSlots: sheetData.data.system.goldSlots,
    coinsPerSlot: sheetData.data.system.coinsPerSlot,
    armor: sheetData.data.system.armor,
    itemHasDerived: sheetData.data.items?.[0]?.system?.isEquipable !== undefined,
    // stored fields must still be there alongside the derived ones
    gold: sheetData.data.system.gold,
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
  // where a transport Item becomes a container Actor, i.e. where the slots shape
  // used to be converted.
  const mkt = await import("/systems/air-bladder/module/marketplace.js");
  const bought = await mkt.acquireTransport(actor, mule, true);
  const container = game.actors.find((a) => a.type === "container" && a.system.keeper === actor.uuid);
  if (!container) return { error: "no container minted" };
  const csrc = container.toObject().system;
  const out = {
    transportSlots: mule.system.slots,
    containerSlots: csrc.slots,
    containerSlotsIsNumber: typeof csrc.slots === "number",
    containerCapacity: container.calcCurrentMaxSlots(),
    linked: (actor.toObject().system.containers ?? []).includes(container.uuid),
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
if (containers.linked) ok("keeper link", "container registered on the owner");
else fail("keeper link", "container not registered");

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

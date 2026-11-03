/**
 * Probe: the authoring follow-ups — "Test ×10" preview/linter and "Duplicate into
 * my backgrounds". Verifies the linter flags an unresolvable grant, classifies
 * resolvable ones, samples the option/gold spread, and that Duplicate lands a
 * source-2e copy in an editable world pack (created on first use).
 *
 *   node tools/dev/e2e-bg-tools.mjs
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
// The fleet's hang guard (review #34): without it a hang runs to the runner's
// 65-minute cap and skips every restore. A bound on a hang, not a timing claim.
watchdog(900000, "dev:bg-tools");
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

const result = await page.evaluate(async () => {
  const out = {};
  const CG = game.cairn.characterGenerator;

  // --- Preview / linter ------------------------------------------------------
  const snap = { name: "Ghost Widget", type: "item", img: "icons/svg/item-bag.svg", system: { description: "", bulky: false } };
  const bg = await Item.create({
    name: "Linter Probe ZZ", type: "background",
    system: {
      source: "2e", archetype: "Fighter", names: ["Ade"],
      startingGear: [
        { name: "Rations" },                      // resolves by name (shipped)
        { name: "Ghost Widget", itemData: snap }, // snapshot
        { name: "Nonexistent Doohickey QQ" },     // MISSING -> should be an error
      ],
      tables: [
        { question: "Q1?", options: [
          { description: "Take the Ghost Widget.", items: [{ name: "Ghost Widget", itemData: snap }], bonusGold: 10 },
          { description: "Take a Missing Thing WW.", items: [{ name: "Missing Thing WW" }] }, // MISSING option item
          {}, {}, {}, {}, // four empty options -> "empty option" warnings
        ] },
        { question: "Q2?", options: [{ description: "So it goes.", bonusGold: 3 }] },
      ],
    },
  });

  const report = await CG.previewBackground(bg, 10);
  out.gearKinds = report.gear.map((g) => g.kind);
  out.problemLevels = report.problems.map((p) => p.level);
  out.errorCount = report.problems.filter((p) => p.level === "error").length;
  out.hasMissingGearError = report.problems.some((p) => p.level === "error" && /Nonexistent Doohickey QQ/.test(p.msg));
  out.hasMissingOptionError = report.problems.some((p) => p.level === "error" && /Missing Thing WW/.test(p.msg));
  out.emptyOptionWarnings = report.problems.filter((p) => /empty/i.test(p.msg)).length;
  out.firedSumsToN = report.tables.map((t) => t.fired.reduce((a, b) => a + b, 0));
  out.sampling = report.sampling;

  await bg.delete();

  // --- Duplicate into my backgrounds -----------------------------------------
  // THE WARDEN'S PACK IS NEVER DELETED (review #34 finding 22).
  // `world.custom-backgrounds` is "the only place user backgrounds survive"
  // (character-generator.js), and the 2e take-over door fills it too; this probe
  // used to delete it whole at entry and again at exit, wiping every
  // hand-authored and door-copied background in whatever world it ran on. A
  // pack that is already there is the Warden's: the probe adds its one copy,
  // reads it, and removes that copy by id. Only a pack this run created goes.
  const prePack = game.packs.get("world.custom-backgrounds");
  const packPreexisted = !!prePack;

  const shipped = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())[0];
  const copy = await CG.duplicateBackgroundToWorld(shipped);
  out.copyName = copy?.name;
  out.copySource = copy?.system?.source;
  out.copyPack = copy?.pack;
  out.copyInWorldPack = copy?.pack === "world.custom-backgrounds";
  out.copyGearCount = (copy?.system?.startingGear ?? []).length;
  out.copyTablesCount = (copy?.system?.tables ?? []).length;
  // Regression: the index-first world/module scan still surfaces a world-pack
  // background. Turn the custom source on so getBackgroundsFor unions it in, then
  // confirm the freshly-duplicated copy is discovered by id.
  const NS = "air-bladder";
  const priorCustom = game.settings.get(NS, "content-source-custom");
  try {
    await game.settings.set(NS, "content-source-custom", true);
    const pool = await CG.getBackgroundsFor("2e");
    out.worldPackDiscovered = pool.some((b) => b.id === copy?.id);

    // ONE REQUEST PER PACK (review #34 finding 206). The world/module scan
    // fetched each source-2e background with its own `getDocument`, one
    // awaited server request after another: 27 in a row once the 2e
    // take-over has filled this pack. Three more plants (stamped, deleted by
    // id below), the cache of every world/module Item pack evicted with
    // core's own `clear()` (it keeps the index; nothing is written), each
    // pack's `getDocuments` shadowed ON THE INSTANCE to count its calls
    // (core's `getDocument` goes through it), the pool built once. Every
    // pack must be asked at most once. Witness: at least four backgrounds in
    // the world pack were cold, and the pool still holds every plant.
    const wpack = game.packs.get("world.custom-backgrounds");
    const planted = await Item.createDocuments([1, 2, 3].map((n) => ({
      name: `ZZ Pool Probe ${n}`, type: "background", system: { source: "2e" },
      flags: { [NS]: { probeFixture: "bg-tools" } },
    })), { pack: wpack.collection });
    const shadowed = [];
    try {
      const scanned = [...game.packs].filter((p) => p.metadata.type === "Item"
        && ["world", "module"].includes(p.metadata.packageType));
      for (const p of scanned) p.clear();
      const isBg = (e) => e.type === "background" && e.system?.source === "2e";
      const indexed = (await wpack.getIndex({ fields: ["system.source"] })).filter(isBg);
      const calls = Object.fromEntries(scanned.map((p) => [p.collection, 0]));
      for (const p of scanned) {
        const orig = p.getDocuments;
        shadowed.push([p, Object.hasOwn(p, "getDocuments"), orig]);
        p.getDocuments = function (...args) { calls[this.collection] += 1; return orig.apply(this, args); };
      }
      out.poolCold = indexed.filter((e) => !(wpack.get(e._id) instanceof foundry.abstract.Document)).length;
      const pool2 = await CG.getBackgroundsFor("2e");
      out.poolCalls = calls;
      out.poolHoldsPlants = planted.every((d) => pool2.some((b) => b.id === d.id));
    } finally {
      for (const [p, own, orig] of shadowed) { if (own) p.getDocuments = orig; else delete p.getDocuments; }
      await Item.deleteDocuments(planted.map((d) => d.id), { pack: wpack.collection });
    }
  } finally {
    await game.settings.set(NS, "content-source-custom", priorCustom);
  }

  // Cleanup: this run's copy only, from a pack that was already there; the
  // whole pack only when this run created it.
  const pack = game.packs.get("world.custom-backgrounds");
  if (packPreexisted) {
    if (copy?.id) await (await pack?.getDocument(copy.id))?.delete();
    out.packRemoved = !!game.packs.get("world.custom-backgrounds") && !pack?.index.has(copy?.id);
  } else {
    if (pack) await pack.deleteCompendium();
    out.packRemoved = !game.packs.get("world.custom-backgrounds");
  }
  out.packPreexisted = packPreexisted;

  return out;
});

// ONE REQUEST PER PACK FOR GEAR NAMES (review #34 finding 207). Three loops
// resolved grant names one awaited `getDocument` at a time: a background's
// starting gear (every generation, swap and re-deal), each Kettlewright item,
// and Test ×10's lint. Four names only the FIRST gear pack answers (so the
// unfixed loops ask that one pack four times), an UNSAVED background carrying
// them as starting gear and as one option's items (nothing is written), and
// each site run once with every gear and spell pack's cache evicted by core's
// own `clear()` and its `getDocuments` counted on the instance. Every pack
// must be asked at most once per site. Witness: the four were cold before
// each site, and each site resolved all four by name.
const gearLeg = await page.evaluate(async () => {
  const CGm = await import("/systems/air-bladder/module/character-generator.js");
  const KW = await import("/systems/air-bladder/module/kettlewright-import.js");
  const G = await import("/systems/air-bladder/module/gear.js");
  const packs = [...new Set([...G.CANONICAL_GEAR_PACKS, ...G.SPELL_PACKS])]
    .map((k) => game.packs.get(k)).filter(Boolean);
  const first = game.packs.get(G.CANONICAL_GEAR_PACKS[0]);
  const entries = [...first.index].filter((e) => e.type !== "spellbook" && !G.spellNameFromGrant(e.name)
    && !G.GEAR_ALIASES.has(e.name.toLowerCase()) && !/^(random|scroll|spellbook|fatigue)\b/i.test(e.name));
  const picked = entries.filter((e, i) => entries.findIndex((x) => x.name === e.name) === i).slice(0, 4);
  const names = picked.map((e) => e.name);
  const calls = {};
  const site = async (fn) => {
    for (const p of packs) p.clear();
    const cold = picked.filter((e) => !(first.get(e._id) instanceof foundry.abstract.Document)).length;
    for (const k of Object.keys(calls)) delete calls[k];
    const resolved = await fn();
    return { cold, resolved, calls: { ...calls } };
  };
  const shadowed = [];
  try {
    for (const p of packs) {
      const orig = p.getDocuments;
      shadowed.push([p, Object.hasOwn(p, "getDocuments"), orig]);
      p.getDocuments = function (...args) { calls[this.collection] = (calls[this.collection] ?? 0) + 1; return orig.apply(this, args); };
    }
    const refs = names.map((name) => ({ name }));
    const bg = new Item.implementation({
      name: "ZZ Gear Probe", type: "background",
      system: { source: "2e", archetype: "Fighter", names: ["Ade"], startingGear: refs,
        tables: [{ question: "Q?", options: [{ description: "Take them.", items: refs }] }] },
    });
    const isNamed = (n) => names.includes(n);
    return {
      names,
      starting: await site(async () => (await CGm.resolveStartingGear(bg)).filter((i) => isNamed(i.name)).length),
      kettlewright: await site(async () => (await KW.kettlewrightToActorData({ name: "ZZ Gear Probe", items: refs }))
        .report.matched.filter(isNamed).length),
      preview: await site(async () => (await CGm.previewBackground(bg, 0)).gear.filter((g) => g.kind === "name").length),
    };
  } finally {
    for (const [p, own, orig] of shadowed) { if (own) p.getDocuments = orig; else delete p.getDocuments; }
  }
});

await browser.close();

const checks = [
  ["gear classified [name, snapshot, missing]", JSON.stringify(result.gearKinds) === JSON.stringify(["name", "snapshot", "missing"])],
  ["exactly 2 resolution errors", result.errorCount === 2],
  ["missing starting-gear flagged", result.hasMissingGearError === true],
  ["missing option item flagged", result.hasMissingOptionError === true],
  ["empty options warned (>=4)", result.emptyOptionWarnings >= 4],
  ["table 1 fired sums to 10", result.firedSumsToN[0] === 10],
  ["table 2 fired sums to 10", result.firedSumsToN[1] === 10],
  ["sampling reports gold", typeof result.sampling.goldAvg === "number"],
  ["duplicate → source 2e", result.copySource === "2e"],
  ["duplicate → world pack", result.copyInWorldPack === true],
  ["duplicate name suffixed", /\(Copy\)$/.test(result.copyName ?? "")],
  ["duplicate carried gear + tables", result.copyGearCount > 0 && result.copyTablesCount > 0],
  ["world-pack bg discovered by index-first scan", result.worldPackDiscovered === true],
  [`witness: ${result.poolCold} world-pack backgrounds were cold, and the pool holds every plant`,
    result.poolCold >= 4 && result.poolHoldsPlants === true],
  [`the pool asked each world/module pack at most once: ${JSON.stringify(result.poolCalls)}`,
    Object.values(result.poolCalls ?? { none: 2 }).every((n) => n <= 1)],
  ...["starting", "kettlewright", "preview"].flatMap((k) => [
    [`witness (${k}): ${gearLeg[k].cold} of ${JSON.stringify(gearLeg.names)} cold, ${gearLeg[k].resolved} resolved by name`,
      gearLeg.names.length === 4 && gearLeg[k].cold === 4 && gearLeg[k].resolved === 4],
    [`${k} asked each gear pack at most once: ${JSON.stringify(gearLeg[k].calls)}`,
      Object.values(gearLeg[k].calls).every((n) => n <= 1)],
  ]),
  ["world pack cleaned up", result.packRemoved === true],
];

console.log(`\n${FOUNDRY_URL}\n`);
let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
console.log("\n", JSON.stringify(result, null, 2));
if (errors.length) { ok = false; console.log("\nConsole errors:\n" + errors.join("\n")); }
console.log(ok ? "\nprobe passed\n" : "\nprobe FAILED\n");
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
/**
 * Phase 1 acceptance probe: every gear item a 2e character (or their hireling)
 * can be granted must resolve to a real, editable pack item.
 *
 *   node tools/dev/e2e-gear.mjs        (needs Foundry running, world launched)
 *
 * The name list is harvested from the SHIPPED packs inside the running world —
 * every background's starting gear, every choice-table option's grant, every bond
 * payload, every hireling loadout — not from an importer's report. That way the
 * probe measures what a player can actually be handed, and new content is covered
 * the moment it is added rather than the next time an importer happens to run.
 *
 * Then: dynamic-import module/gear.js and resolve every name. Fails (non-zero) if
 * ANY name does not resolve. Also spot-checks that quantity/uses overrides apply
 * and that spell/alias/case routing works.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
// The fleet's hang guard (review #34): without it a hang runs to the runner's
// 65-minute cap and skips every restore. A bound on a hang, not a timing claim.
watchdog(900000, "dev:gear");
const page = await browser.newContext({ viewport: VIEWPORT }).then(c => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = m => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = m => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const gear = await import("/systems/air-bladder/module/gear.js");

    // ---- harvest every name any grant path can hand a character ----
    const names = new Set();
    const add = (list) => { for (const g of list ?? []) if (g?.name) names.add(g.name); };
    for (const key of ["air-bladder.backgrounds-2e", "air-bladder.backgrounds-barebones"]) {
      const pack = game.packs.get(key);
      if (!pack) continue;
      for (const bg of await pack.getDocuments()) {
        add(bg.system?.startingGear);
        for (const t of bg.system?.tables ?? []) for (const o of t.options ?? []) add(o.items);
      }
    }
    for (const key of ["air-bladder.tables-2e"]) {
      const pack = game.packs.get(key);
      if (!pack) continue;
      for (const table of await pack.getDocuments()) {
        for (const r of table.results ?? []) add(r.getFlag?.("air-bladder", "items"));
      }
    }
    const hire = await fetch("/systems/air-bladder/module/npc-careers-2e.json").then((r) => r.json());
    for (const h of hire.hirelings ?? hire) add(h.gear);

    // Preload each pack's names ONCE (calling resolveGearItem per-name would
    // re-scan every pack 300+ times). We still apply the resolver's own routing
    // (spellNameFromGrant / GEAR_ALIASES) so this tests the real resolution path.
    const load = async (keys) => {
      const set = new Set();
      for (const key of keys) {
        const pack = game.packs.get(key);
        if (!pack) continue;
        for (const d of await pack.getDocuments()) set.add(d.name.toLowerCase());
      }
      return set;
    };
    const gearSet = await load(gear.CANONICAL_GEAR_PACKS);
    const spellSet = await load(gear.SPELL_PACKS);

    // Nine Barebones backgrounds grant a row the SRD writes as an INSTRUCTION
    // ("Spellbook", "Random Additional Gear") rather than an item. Those must NOT
    // resolve by name — they are rolled. Excluding them here would be a hole, so
    // they are checked separately below, through resolveStartingGear itself.
    const INSTRUCTIONS = new Set(["spellbook", "random spellbook", "scroll of random spellbook", "random additional gear"]);
    const instructionNames = [...names].filter((n) => INSTRUCTIONS.has(String(n).trim().toLowerCase()));
    for (const n of instructionNames) names.delete(n);

    const out = { misses: [], resolved: 0, checks: {}, instructions: instructionNames.length };
    for (const name of names) {
      const spell = gear.spellNameFromGrant(name);
      const target = spell ?? gear.GEAR_ALIASES.get(String(name).trim().toLowerCase()) ?? name;
      const set = spell ? spellSet : gearSet;
      if (set.has(String(target).toLowerCase())) out.resolved++;
      else out.misses.push(name);
    }

    // End-to-end spot-checks that exercise resolveGearItem itself.
    const r = await gear.resolveGearItem("Rations", { quantity: 3, uses: 2 });
    out.checks.override = !!r && r.system.quantity === 3 && r.system.uses.value === 2 && r.system.uses.max === 2;
    const spell = await gear.resolveGearItem("Spellbook (Detect Magic)");
    out.checks.spell = !!spell && spell.type === "spellbook" && spell.name === "Detect Magic";
    const alias = await gear.resolveGearItem("Torches");
    out.checks.alias = !!alias && alias.name === "Torch";
    const cased = await gear.resolveGearItem("leather jerkin");
    out.checks.case = !!cased && cased.type === "armor";
    const sack = await gear.resolveGearItem("Sack");
    out.checks.sack = !!sack && sack.name === "Sack";

    // Each instruction row must still yield an item, or that background is one
    // short with no error at all — the exact failure mode this guards.
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const bbPack = game.packs.get("air-bladder.backgrounds-barebones");
    const bbDocs = bbPack ? await bbPack.getDocuments() : [];
    out.instructionBgs = [];
    for (const name of ["Acolyte", "Fence", "Cultist"]) {
      const bg = bbDocs.find((d) => d.name === name);
      if (!bg) { out.instructionBgs.push(`${name}: MISSING`); continue; }
      const items = await gen.resolveStartingGear(bg);
      const want = (bg.system.startingGear ?? []).length;
      out.instructionBgs.push(items.length === want ? null : `${name}: ${items.length}/${want}`);
    }
    out.instructionBgs = out.instructionBgs.filter(Boolean);
    out.total = names.size;
    return out;
  });

  // A harvest that finds nothing would "pass" with zero misses, so require the
  // list to be at least as big as the content known to ship today.
  if (result.total < 250) fail(`harvested only ${result.total} granted names — expected 250+, the harvest is broken`);
  result.misses.length === 0
    ? ok(`all ${result.resolved}/${result.total} granted names resolve`)
    : fail(`${result.misses.length} unresolved: ${result.misses.join(", ")}`);

  result.checks.override ? ok("quantity/uses override applies") : fail("quantity/uses override broken");
  result.checks.spell ? ok("spell grant routes to spellbooks pack") : fail("spell routing broken");
  result.checks.alias ? ok("alias resolves (Torches → Torch)") : fail("alias routing broken");
  result.checks.case ? ok("case-insensitive resolve (leather jerkin → armor)") : fail("case-insensitive resolve broken");
  result.checks.sack ? ok("Sack resolves") : fail("Sack resolve broken");

  result.instructions > 0
    ? ok(`${result.instructions} instruction row(s) held back from name resolution`)
    : fail("no instruction rows found — the Barebones backgrounds are not being harvested");
  result.instructionBgs.length === 0
    ? ok("instruction rows still grant an item (Acolyte, Fence, Cultist full loadouts)")
    : fail(`instruction rows dropped: ${result.instructionBgs.join(", ")}`);

  // THE DROP ASKS THE SHARED CAPACITY TEST (review #34 finding 47). It kept its
  // own arithmetic: every person was refused once encumbered whatever the item
  // needed, so a PETTY item dragged onto a full character was refused while
  // Create Item, the shop and a gift all take it; and only a THING was strict,
  // so a bulky item dragged onto a companion at 9/10 landed at 11/10, which the
  // offer route refuses as full. Driven through the sheet's own drop handler.
  const drops = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const made = [];
    const drop = async (actor, item) => {
      await actor.sheet.render(true);
      for (let i = 0; i < 30 && !actor.sheet.element; i++) await sleep(100);
      const before = actor.items.size;
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
      try { await actor.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); } catch { /* refused */ }
      await sleep(600);
      await actor.sheet.close();
      return actor.items.size - before;
    };
    try {
      const petty = await getDocumentClass("Item").create({ name: "ZZ Gear Petty Charm", type: "item", system: { weightless: true } });
      const bulky = await getDocumentClass("Item").create({ name: "ZZ Gear Bulky Crate", type: "item", system: { bulky: true } });
      made.push(petty, bulky);
      const full = await Actor.create({ name: "ZZ Gear Full PC", type: "character" });
      made.push(full);
      await full.createEmbeddedDocuments("Item", Array.from({ length: full.system.slotsMax }, (_, i) => ({ name: `ZZ Gear Rock ${i}`, type: "item" })));
      const comp = await Actor.create({ name: "ZZ Gear Companion", type: "npc", system: { role: "companion", slots: 10 } });
      made.push(comp);
      await comp.createEmbeddedDocuments("Item", Array.from({ length: 9 }, (_, i) => ({ name: `ZZ Gear Load ${i}`, type: "item" })));
      return {
        fullEncumbered: full.isEncumbered(),
        compAt: `${comp.system.slotsUsed}/${comp.system.slotsMax}`,
        pettyLanded: await drop(full, petty),
        bulkyLanded: await drop(comp, bulky),
      };
    } finally {
      for (const d of made.reverse()) { try { await d.delete(); } catch { /* gone */ } }
    }
  });
  drops.fullEncumbered && drops.pettyLanded === 1
    ? ok("a petty item dragged onto a full character lands, as every other route lets it", JSON.stringify(drops))
    : fail(`a petty drop onto a full character: ${JSON.stringify(drops)}`);
  drops.compAt === "9/10" && drops.bulkyLanded === 0
    ? ok("a bulky item dragged onto a companion at 9/10 is refused, as a gift is", JSON.stringify(drops))
    : fail(`a bulky drop onto a companion at 9/10: ${JSON.stringify(drops)}`);

  // AN ITEM ON A COMPENDIUM ACTOR IS COPIED, NEVER MOVED (review #34 finding
  // 160). Its `.actor` is the pack entry, so the drop read it as a transfer:
  // the copy landed and then the source write took the unit OUT of the pack.
  // And Give was offered on the pack actor's rows. A throwaway WORLD Actor
  // compendium is made and deleted here — never a shipped pack, which a red run
  // would really edit.
  const packDrop = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let pack = null;
    let pc = null;
    try {
      pack = game.packs.get("world.zz-probe-gear-actors")
        ?? await foundry.documents.collections.CompendiumCollection.createCompendium({
          label: "ZZ Probe Gear Actors", name: "zz-probe-gear-actors", type: "Actor", packageType: "world",
        });
      const [entry] = await Actor.createDocuments([{
        name: "ZZ Gear Pack Hermit", type: "npc", system: { role: "npc" },
        items: [{ name: "ZZ Gear Pack Lantern", type: "item", system: { quantity: 2 } }],
      }], { pack: pack.collection });
      const lantern = entry.items.find((i) => i.name === "ZZ Gear Pack Lantern");
      pc = await Actor.create({ name: "ZZ Gear Pack Taker", type: "character" });
      await pc.sheet.render(true);
      for (let i = 0; i < 30 && !pc.sheet.element; i++) await sleep(100);
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: lantern.uuid }));
      try { await pc.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); } catch { /* refused */ }
      await sleep(800);
      await pc.sheet.close();
      const fresh = await pack.getDocument(entry.id);
      const packLantern = fresh?.items.find((i) => i.name === "ZZ Gear Pack Lantern");
      return {
        landed: pc.items.filter((i) => i.name === "ZZ Gear Pack Lantern").length,
        packQty: packLantern?.system.quantity ?? null,
        canGive: lantern.system.canGive === true,
      };
    } finally {
      try { await pc?.delete(); } catch { /* gone */ }
      try { await pack?.deleteCompendium(); } catch { /* gone */ }
    }
  });
  packDrop.landed === 1 && packDrop.packQty === 2
    ? ok("an item dragged off a COMPENDIUM actor is copied; the pack entry keeps it", JSON.stringify(packDrop))
    : fail(`a drag off a compendium actor wrote back to the pack: ${JSON.stringify(packDrop)}`);
  packDrop.canGive === false
    ? ok("...and a compendium actor's rows offer no Give")
    : fail("a compendium actor's item offers Give — delivery would take it out of the pack");

  // THE OTHER DIRECTION (review #34 finding 169): an item dragged from a WORLD
  // actor onto an open compendium actor's sheet. The handler never asked
  // whether the TARGET is a pack entry, so the copy landed there and the
  // source write then took the unit out of play. Core only copies there, and
  // canDrop / canReceiveOffer already refuse a pack. And a drag WITHIN one
  // compendium actor's sheet is a reorder: the item count must not change.
  const packTarget = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const dropOn = async (sheet, uuid) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      try { await sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); } catch { /* refused */ }
      await sleep(800);
    };
    let pack = null;
    let pc = null;
    try {
      pack = game.packs.get("world.zz-probe-gear-actors-2")
        ?? await foundry.documents.collections.CompendiumCollection.createCompendium({
          label: "ZZ Probe Gear Actors 2", name: "zz-probe-gear-actors-2", type: "Actor", packageType: "world",
        });
      const [entry] = await Actor.createDocuments([{
        name: "ZZ Gear Pack Keeper", type: "npc", system: { role: "npc" },
        items: [{ name: "ZZ Gear Pack Rope", type: "item" }, { name: "ZZ Gear Pack Chalk", type: "item" }],
      }], { pack: pack.collection });
      pc = await Actor.create({ name: "ZZ Gear World Giver", type: "character",
        items: [{ name: "ZZ Gear World Torch", type: "item", system: { quantity: 2 } }] });
      const torch = pc.items.find((i) => i.name === "ZZ Gear World Torch");
      await entry.sheet.render(true);
      for (let i = 0; i < 30 && !entry.sheet.element; i++) await sleep(100);
      await dropOn(entry.sheet, torch.uuid);
      const afterIn = await pack.getDocument(entry.id);
      const rope = afterIn.items.find((i) => i.name === "ZZ Gear Pack Rope");
      const countBefore = afterIn.items.size;
      await dropOn(afterIn.sheet, rope.uuid);
      const afterSort = await pack.getDocument(entry.id);
      try { await entry.sheet.close(); } catch { /* gone */ }
      try { await afterSort.sheet.close(); } catch { /* gone */ }
      return {
        landedInPack: afterIn.items.filter((i) => i.name === "ZZ Gear World Torch").length,
        worldQty: pc.items.find((i) => i.name === "ZZ Gear World Torch")?.system.quantity ?? null,
        countBefore, countAfterSort: afterSort.items.size,
        // A same-name drop MERGES into the stack rather than adding a row, so
        // the count alone could miss a copy: the quantity says it.
        ropeQty: afterSort.items.find((i) => i.name === "ZZ Gear Pack Rope")?.system.quantity ?? null,
      };
    } finally {
      try { await pc?.delete(); } catch { /* gone */ }
      try { await pack?.deleteCompendium(); } catch { /* gone */ }
    }
  });
  packTarget.landedInPack === 1 && packTarget.worldQty === 2
    ? ok("an item dragged ONTO a compendium actor is copied; the world actor keeps it", JSON.stringify(packTarget))
    : fail(`a drag onto a compendium actor took the unit out of play: ${JSON.stringify(packTarget)}`);
  packTarget.countAfterSort === packTarget.countBefore && packTarget.ropeQty === 1
    ? ok("...and a drag within one compendium actor's sheet is a reorder, not a copy")
    : fail(`a drag within a compendium actor's sheet duplicated the item: ${JSON.stringify(packTarget)}`);

  // A HANDED-OVER ITEM ARRIVES LIKE A GIFT (review #34 finding 248): at the
  // BOTTOM of the list, unworn. Give builds its payload with sort 0 (so
  // #appendSort places it last) and equipped false; a cross-actor drag kept
  // the source's sort and equipped, and the pile Drop kept the sort. Two
  // world characters, each with a few rows; the giver's TOP row is an
  // equipped armour. Dragged across, and a second one dropped on the pile.
  const handOver = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pp = await import("/systems/air-bladder/module/party-pile.js");
    const made = [];
    try {
      const kit = (tag) => [
        { name: `ZZ Hand ${tag} Mail`, type: "armor", sort: 100000, system: { armor: 1, equipped: true } },
        { name: `ZZ Hand ${tag} Rope`, type: "item", sort: 200000 },
        { name: `ZZ Hand ${tag} Chalk`, type: "item", sort: 300000 },
      ];
      const giver = await Actor.create({ name: "ZZ Hand Giver", type: "character", items: [...kit("A"), ...kit("B")] });
      const taker = await Actor.create({ name: "ZZ Hand Taker", type: "character",
        items: [{ name: "ZZ Hand Own Rope", type: "item", sort: 100000 }, { name: "ZZ Hand Own Chalk", type: "item", sort: 200000 }] });
      made.push(giver, taker);
      const mail = giver.items.find((i) => i.name === "ZZ Hand A Mail");
      await taker.sheet.render(true);
      for (let i = 0; i < 30 && !taker.sheet.element; i++) await sleep(100);
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: mail.uuid }));
      try { await taker.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); } catch { /* refused */ }
      await sleep(800);
      await taker.sheet.close();
      const arrived = taker.items.find((i) => i.name === "ZZ Hand A Mail");
      const others = taker.items.filter((i) => i !== arrived).map((i) => i.sort);

      // The Chalk (sort 300000) goes first, so even an EMPTY pile holds a row
      // the Rope (sort 200000) would land above if it kept the giver's place.
      const pile0 = pp.findDroppedPile();
      const before = new Set(pile0?.items.map((i) => i.id) ?? []);
      for (const name of ["ZZ Hand B Chalk", "ZZ Hand B Rope"]) {
        const it = giver.items.find((i) => i.name === name);
        await pp.dropItemToPile(giver, it.id, {});
        for (let i = 0; i < 40 && giver.items.get(it.id); i++) await sleep(150);
      }
      const pile = pp.findDroppedPile();
      const mine = (pile?.items ?? []).filter((i) => !before.has(i.id));
      const copy = mine.find((i) => i.name === "ZZ Hand B Rope");
      const pileOthers = (pile?.items ?? []).filter((i) => i !== copy).map((i) => i.sort);
      const out = {
        drag: arrived ? { sort: arrived.sort, equipped: arrived.system.equipped, maxOther: Math.max(...others) } : null,
        pile: copy ? { sort: copy.sort, maxOther: pileOthers.length ? Math.max(...pileOthers) : 0 } : null,
      };
      for (const it of mine) { try { await it.delete(); } catch { /* gone */ } }
      return out;
    } finally {
      for (const a of made) { try { await a.delete(); } catch { /* gone */ } }
    }
  });
  handOver.drag && handOver.drag.equipped === false && handOver.drag.sort > handOver.drag.maxOther
    ? ok("a dragged-across item lands at the BOTTOM, unworn, like a gift", JSON.stringify(handOver.drag))
    : fail(`a dragged-across item kept the giver's place or its worn state: ${JSON.stringify(handOver.drag)}`);
  handOver.pile && handOver.pile.sort > handOver.pile.maxOther
    ? ok("...and an item dropped on the pile lands at the pile's bottom", JSON.stringify(handOver.pile))
    : fail(`an item dropped on the pile kept the giver's place: ${JSON.stringify(handOver.pile)}`);

  // A BACKGROUND'S WEAPONS AND ARMOUR ARRIVE EQUIPPED, WHEREVER IN THE BACKGROUND
  // THEY COME FROM (review #34 finding 224). Only the starting gear was equipped;
  // a question's or a bond's grant kept whatever its pack document stored, and
  // the shipped data is mixed — every Fletchwind's question-2 bow is stored
  // unequipped, so every generated Fletchwind came with an unequipped bow. Two
  // routes: a fresh Fletchwind, and a swap onto one.
  const arms = await page.evaluate(async () => {
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const fw = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments()).find((b) => b.name === "Fletchwind");
    const made = [];
    const questionArms = (a) => a.items
      .filter((i) => (i.type === "weapon" || i.type === "armor")
        && String(i.getFlag("air-bladder", "grantSource") ?? "").startsWith("question:"))
      .map((i) => ({ name: i.name, equipped: i.system.equipped === true }));
    try {
      const fresh = await gen.createActorWithCharacter(await gen.generate2eCharacter(fw));
      made.push(fresh);
      const swapped = await gen.createActorWithCharacter(await gen.generate2eCharacter(
        (await game.packs.get("air-bladder.backgrounds-2e").getDocuments()).find((b) => b.name === "Cutpurse")));
      made.push(swapped);
      await gen.changeBackground(swapped, fw);
      return { fresh: questionArms(fresh), swapped: questionArms(swapped) };
    } finally {
      for (const a of made) { try { await a.delete(); } catch { /* gone */ } }
    }
  });
  // HANDED OVER, NOT GRANTED (review #34 finding 172). Give strips the item's
  // grantSource tag on purpose: the recipient's background, bond and question
  // re-rolls delete tagged items with no provenance check. A sheet DRAG between
  // two actors, and the Dropped Item Pile's Drop, kept it — so a dragged-over
  // "background" lantern was eaten by the recipient's next background re-roll.
  const handed = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const made = [];
    try {
      const giver = await Actor.create({ name: "ZZ Gear Giver", type: "character" });
      const taker = await Actor.create({ name: "ZZ Gear Taker", type: "character" });
      made.push(giver, taker);
      const [lamp] = await giver.createEmbeddedDocuments("Item", [{ name: "ZZ Gear Tagged Lamp", type: "item",
        flags: { "air-bladder": { grantSource: "background" } } }]);
      await taker.sheet.render(true);
      for (let i = 0; i < 30 && !taker.sheet.element; i++) await sleep(100);
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: lamp.uuid }));
      try { await taker.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); } catch { /* refused */ }
      await sleep(800);
      await taker.sheet.close();
      const arrived = taker.items.find((i) => i.name === "ZZ Gear Tagged Lamp");
      return { arrived: !!arrived, tag: arrived?.getFlag("air-bladder", "grantSource") ?? null };
    } finally {
      for (const a of made) { try { await a.delete(); } catch { /* gone */ } }
    }
  });
  handed.arrived && handed.tag === null
    ? ok("an item dragged to another actor arrives UNTAGGED, as a gift does")
    : fail(`a dragged-over item kept its grant tag, so the recipient's re-roll would delete it: ${JSON.stringify(handed)}`);

  // ...and the pile's Drop, the other door (same finding): the copy on the
  // pile kept the tag, and whoever took it back off inherited a re-roll target.
  // The pile is made on first drop; if this leg made it, it deletes it too.
  const piled = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pp = await import("/systems/air-bladder/module/party-pile.js");
    const pileBefore = pp.findDroppedPile();
    const pc = await Actor.create({ name: "ZZ Gear Dropper", type: "character" });
    let pile = null;
    let copyId = null;
    try {
      const [rope] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Gear Tagged Rope", type: "item",
        flags: { "air-bladder": { grantSource: "background" } } }]);
      await pp.dropItemToPile(pc, rope.id);
      await sleep(800);
      pile = pp.findDroppedPile();
      const copy = pile?.items.find((i) => i.name === "ZZ Gear Tagged Rope");
      copyId = copy?.id ?? null;
      return { onPile: !!copy, tag: copy?.getFlag("air-bladder", "grantSource") ?? null };
    } finally {
      try { await pc.delete(); } catch { /* gone */ }
      if (pile && !pileBefore) { try { await pile.delete(); } catch { /* gone */ } }
      else if (pile && copyId) { try { await pile.deleteEmbeddedDocuments("Item", [copyId]); } catch { /* gone */ } }
    }
  });
  piled.onPile && piled.tag === null
    ? ok("an item Dropped to the pile lands UNTAGGED")
    : fail(`the pile's copy kept its grant tag: ${JSON.stringify(piled)}`);

  // DROP, DROP ON ONE ROW (review #34 finding 136). The claim id is minted
  // fresh per gesture (review #33), which stopped two actors' items colliding
  // and also stopped refusing a SECOND gesture on the same item: two Drops
  // inside the round trip before the delete lands each passed the existence
  // check and filed a copy. Both started in one tick, as the Warden's client
  // meets two brokered asks.
  const twice = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pp = await import("/systems/air-bladder/module/party-pile.js");
    const pc = await getDocumentClass("Actor").create({ name: "ZZ Gear Twice Dropper", type: "character" });
    const pileBefore = pp.findDroppedPile();
    const before = new Set(pileBefore?.items.map((i) => i.id) ?? []);
    const mine = () => (pp.findDroppedPile()?.items ?? [])
      .filter((i) => !before.has(i.id) && i.name === "ZZ Gear Twice Lamp");
    try {
      const [lamp] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Gear Twice Lamp", type: "item" }]);
      const settled = await Promise.allSettled([pp.dropItemToPile(pc, lamp.id), pp.dropItemToPile(pc, lamp.id)]);
      await sleep(800);
      return {
        results: settled.map((s) => (s.status === "fulfilled" ? s.value : `threw: ${s.reason?.message}`)),
        copies: mine().length,
        sourceGone: !pc.items.get(lamp.id),
      };
    } finally {
      try { await pc.delete(); } catch { /* gone */ }
      const pile = pp.findDroppedPile();
      if (pile && !pileBefore) { try { await pile.delete(); } catch { /* gone */ } }
      else if (pile) { try { await pile.deleteEmbeddedDocuments("Item", mine().map((i) => i.id)); } catch { /* gone */ } }
    }
  });
  twice.copies === 1 && twice.sourceGone
    ? ok("two Drops of one row in one tick file ONE copy", JSON.stringify(twice))
    : fail(`two Drops of one row filed ${twice.copies} copies: ${JSON.stringify(twice)}`);

  // A COMPENDIUM ACTOR RUNS NO WORLD SIDE EFFECTS (review #34 findings 163,
  // 168, 171). Core keeps ids on import, so a pack entry and its world copy
  // share one id, and several things keyed on that id reached the world copy:
  // new art on the entry repainted the copy's placed tokens, a hand edit
  // whispered a ledger card and a STR-0 edit posted a status card, a granted
  // transport became a WORLD actor connected to the pack uuid, and a weapon
  // dragged to the hotbar made a macro keyed to the world copy. The change log
  // is read-shadowed ON so the ledger leg can fail.
  const packSide = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const { createCairnMacro } = await import("/systems/air-bladder/module/macros.js");
    const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
    const ns = "air-bladder";
    const origGet = game.settings.get;
    game.settings.get = function (scope, key, ...rest) {
      // A DOCUMENT request is never shadowed (review #27).
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "change-log") return true;
      return origGet.call(this, scope, key, ...rest);
    };
    const SLOT = 49;
    const slotWas = game.user.hotbar[SLOT] ?? null;
    const macrosBefore = new Set(game.macros.map((m) => m.id));
    const actorsBefore = new Set(game.actors.map((a) => a.id));
    let pack = null, world = null, scene = null, entry = null;
    const out = {};
    try {
      pack = game.packs.get("world.zz-probe-gear-actors-3")
        ?? await foundry.documents.collections.CompendiumCollection.createCompendium({
          label: "ZZ Probe Gear Actors 3", name: "zz-probe-gear-actors-3", type: "Actor", packageType: "world",
        });
      [entry] = await Actor.createDocuments([{
        name: "ZZ Gear Twin", type: "character", img: "icons/svg/mystery-man.svg",
        prototypeToken: { texture: { src: "icons/svg/mystery-man.svg" } },
        system: { hp: { value: 4, max: 4 }, abilities: { STR: { value: 6, max: 10 } } },
        items: [{ name: "ZZ Gear Twin Sword", type: "weapon" }],
      }], { pack: pack.collection });
      world = await game.actors.importFromCompendium(pack, entry.id, {}, { keepId: true });
      out.sharedId = world?.id === entry.id;
      scene = await Scene.create({ name: "ZZ Gear Twin scene", width: 1000, height: 1000 });
      const [tok] = await scene.createEmbeddedDocuments("Token", [await world.getTokenDocument({ x: 100, y: 100 })]);
      await sleep(1000);   // the setup's own cards settle before the count starts
      const msgsBefore = new Set(game.messages.map((m) => m.id));
      await entry.update({ img: "icons/svg/skull.svg", "prototypeToken.texture.src": "icons/svg/skull.svg" });
      await entry.update({ "system.hp.value": 3 });
      await entry.update({ "system.abilities.STR.value": 0 });
      await sleep(1200);
      out.tokenArt = scene.tokens.get(tok.id)?.texture.src ?? null;
      const fresh = game.messages.contents.filter((m) => !msgsBefore.has(m.id));
      out.ledgerCards = fresh.filter((m) => m.getFlag(ns, "changeLog")).length;
      out.statusCards = fresh.filter((m) => /class="status-banner/.test(String(m.content ?? ""))).length;
      out.canKeep = entry.canKeepConnected;
      const minted = await grantContainers(entry, [{ name: "ZZ Gear Twin Mule", slots: 4, grantSource: "probe" }]);
      out.minted = (minted?.length ?? 0) + game.actors.filter((a) => a.system?.connectedTo === entry.uuid).length;
      const sword = entry.items.find((i) => i.name === "ZZ Gear Twin Sword");
      await createCairnMacro({ type: "Item", uuid: sword.uuid }, SLOT);
      await sleep(400);
      out.macros = game.macros.filter((m) => !macrosBefore.has(m.id)).length;
      return out;
    } catch (e) {
      return { ...out, error: `${e.name}: ${e.message}` };
    } finally {
      game.settings.get = origGet;
      for (const m of game.macros.filter((m) => !macrosBefore.has(m.id))) { try { await m.delete(); } catch { /* gone */ } }
      try { await game.user.assignHotbarMacro(slotWas ? game.macros.get(slotWas) : null, SLOT); } catch { /* left */ }
      for (const m of game.messages.contents.filter((m) => m.speaker?.actor === entry?.id)) {
        try { await m.delete(); } catch { /* gone */ }
      }
      for (const a of game.actors.filter((a) => !actorsBefore.has(a.id))) { try { await a.delete(); } catch { /* gone */ } }
      try { await scene?.delete(); } catch { /* gone */ }
      try { await pack?.deleteCompendium(); } catch { /* gone */ }
    }
  });
  packSide.sharedId === true
    ? ok("precondition: the world copy imported from the pack shares the entry's id")
    : fail(`precondition: no shared-id world copy: ${JSON.stringify(packSide)}`);
  packSide.tokenArt === "icons/svg/mystery-man.svg"
    ? ok("new art on the pack entry leaves the world copy's placed token alone (F163)")
    : fail(`the pack entry's art repainted the world copy's token: ${packSide.tokenArt}`);
  packSide.ledgerCards === 0 && packSide.statusCards === 0
    ? ok("a hand edit to the pack entry posts no ledger card and no status card (F168, F163)")
    : fail(`the pack entry's edits posted ${packSide.ledgerCards} ledger and ${packSide.statusCards} status card(s)`);
  packSide.canKeep === false && packSide.minted === 0
    ? ok("a pack character keeps no connections: a granted transport mints nothing in the world (F163)")
    : fail(`pack character canKeepConnected=${packSide.canKeep}, minted ${packSide.minted} world actor(s)`);
  packSide.macros === 0
    ? ok("a pack actor's weapon dragged to the hotbar makes no world-keyed macro (F171)")
    : fail(`the pack actor's weapon made ${packSide.macros} macro(s)`);

  // A PILE MOVE DELETES ONLY WHAT LANDED (review #34 finding 164). A create
  // every seam refuses resolves EMPTY rather than throwing, and the move read
  // only a throw: the item left the sheet with no copy in the pile, and the
  // drop answered `true`. A preCreateItem veto on the pile stands in for any
  // such seam (a module's hook, a construction failure).
  const vetoed = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pp = await import("/systems/air-bladder/module/party-pile.js");
    const pc = await getDocumentClass("Actor").create({ name: "ZZ Gear Veto Dropper", type: "character" });
    const pileBefore = pp.findDroppedPile();
    const veto = Hooks.on("preCreateItem",
      (doc) => (doc.parent?.getFlag("air-bladder", "droppedItemPile") ? false : undefined));
    try {
      const [lamp] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Gear Veto Lamp", type: "item" }]);
      const result = await pp.dropItemToPile(pc, lamp.id);
      await sleep(600);
      return {
        result,
        kept: !!pc.items.get(lamp.id),
        inPile: (pp.findDroppedPile()?.items ?? []).some((i) => i.name === "ZZ Gear Veto Lamp"),
      };
    } finally {
      Hooks.off("preCreateItem", veto);
      try { await pc.delete(); } catch { /* gone */ }
      const pile = pp.findDroppedPile();
      if (pile && !pileBefore) { try { await pile.delete(); } catch { /* gone */ } }
    }
  });
  vetoed.result === false && vetoed.kept && !vetoed.inPile
    ? ok("a Drop the pile refuses keeps the item on the sheet and answers false (F164)")
    : fail(`a refused pile copy still cost the item: ${JSON.stringify(vetoed)}`);

  // A BROKERED DROP'S LEDGER (review #34 finding 245). A player's Drop runs on
  // the active Warden's client (CONFIG.queries["air-bladder.pileDrop"]), so its
  // ledger cards were the Warden's writes: the dropper's read "Changed by
  // Warden", and the pile's whispered "Item added" to every observer on every
  // Drop. The broker is called here as the Warden receives it — the requester
  // is a PLAYER who owns the source — with the change log switched on by a
  // settings READ shadow (no world write). The dropper's card must name the
  // player, and the pile posts none: it is its own record.
  const ledger = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pp = await import("/systems/air-bladder/module/party-pile.js");
    const player = game.users.find((u) => !u.isGM);
    if (!player) return { error: "no player in this world" };
    const pileBefore = pp.findDroppedPile();
    const pc = await Actor.create({ name: "ZZ Gear Brokered Dropper", type: "character",
      ownership: { default: 0, [player.id]: 3 } });
    const settings = game.settings;
    const realGet = settings.get.bind(settings);
    settings.get = (ns, key, ...rest) => rest[0]?.document
      ? foundry.helpers.ClientSettings.prototype.get.call(game.settings, ns, key, ...rest)
      : (ns === "air-bladder" && key === "change-log" ? true : realGet(ns, key, ...rest));
    const before = new Set(game.messages.map((m) => m.id));
    let pile = null;
    try {
      const [cord] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Gear Brokered Cord", type: "item" }],
        { abNoStatusCard: true });
      const okDrop = await CONFIG.queries["air-bladder.pileDrop"](
        { actorUuid: pc.uuid, itemId: cord.id, claimId: foundry.utils.randomID(), place: "", announce: false },
        { user: player });
      await sleep(1200);
      pile = pp.findDroppedPile();
      const cards = game.messages.filter((m) => !before.has(m.id) && m.getFlag("air-bladder", "changeLog"));
      const pileCards = cards.filter((m) => m.speaker?.actor === pile?.id);
      const dropperCards = cards.filter((m) => m.speaker?.actor === pc.id);
      return {
        okDrop, pileCards: pileCards.length,
        dropperBy: dropperCards.map((m) => m.getFlag("air-bladder", "changeLog")?.user),
        want: player.id, warden: game.user.id,
        cardIds: cards.map((m) => m.id),
      };
    } finally {
      settings.get = realGet;
      for (const m of game.messages.filter((x) => !before.has(x.id))) { try { await m.delete(); } catch { /* gone */ } }
      try { await pc.delete(); } catch { /* gone */ }
      if (pile && !pileBefore) { try { await pile.delete(); } catch { /* gone */ } }
      else if (pile) {
        const left = pile.items.filter((i) => i.name === "ZZ Gear Brokered Cord").map((i) => i.id);
        if (left.length) { try { await pile.deleteEmbeddedDocuments("Item", left, { abNoStatusCard: true }); } catch { /* gone */ } }
      }
    }
  });
  if (ledger.error) fail(`precondition: ${ledger.error}`);
  else {
    ledger.okDrop === true && ledger.dropperBy.length === 1 && ledger.dropperBy[0] === ledger.want
      ? ok("a player's brokered Drop: the dropper's ledger card names the PLAYER, not the Warden")
      : fail(`a brokered Drop's dropper card: ${JSON.stringify(ledger)}`);
    ledger.pileCards === 0
      ? ok("...and the pile posts no ledger card of its own (it is its own record)")
      : fail(`the pile whispered ${ledger.pileCards} ledger card(s) for one Drop`);
  }

  for (const [label, list] of [["a generated Fletchwind", arms.fresh], ["a swap onto Fletchwind", arms.swapped]]) {
    list.length > 0 && list.every((x) => x.equipped)
      ? ok(`${label}: the question-granted weapon arrives EQUIPPED ${JSON.stringify(list)}`)
      : fail(`${label}: a question's weapon or armour arrived unequipped (or none was granted) ${JSON.stringify(list)}`);
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach(e => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nGEAR PROBE FAILED\n" : "\ngear probe passed\n");
process.exit(failed ? 1 : 0);

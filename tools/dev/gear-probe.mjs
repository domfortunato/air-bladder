#!/usr/bin/env node
/**
 * Phase 1 acceptance probe: every gear item a 2e character (or their hireling)
 * can be granted must resolve to a real, editable pack item.
 *
 *   node tools/dev/gear-probe.mjs        (needs Foundry running, world launched)
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
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
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

#!/usr/bin/env node
/**
 * Cairn Barebones acceptance probe. Barebones is a second CONTENT SOURCE, not a
 * second system: it differs from 2e only in how a character is made, and every
 * rule after that is shared. This proves both halves — that generation follows
 * the SRD procedure, and that it does so through the SAME editable pool 2e uses.
 *
 *   node tools/dev/barebones-probe.mjs   (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. The packs are installed: 100 background documents (each of the `background`
 *      Item type, source barebones) and the 6 creation RollTables. Every gear
 *      reference on every background resolves against the pool — 0 misses.
 *   2. A generated character follows the SRD: 3d6 abilities, 1d6 HP, its
 *      background's gear tagged `background`, the base Rations + Torch, and an
 *      EQUIPPED weapon (and armor, unless the d6 came up None).
 *   3. The tables are references, not copies: edit a pool weapon, regenerate, and
 *      the character's weapon carries the edit.
 *   4. Regenerate keeps the background and re-rolls the rest.
 *   5. The Merchant's wagon and the Peddler's cart are CONTAINER ACTORS, not
 *      items — the fork could not grant these at all.
 *   6. The armor "None" row buys a second Additional Gear roll instead.
 *   7. The bond setting REPLACES the Additional Gear step rather than adding to
 *      it, so the inventory cannot overflow.
 * Exits non-zero on any failed assertion or console error.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const made = [];
    const track = (a) => { if (a) made.push(a); return a; };
    const containersOf = (actor) =>
      game.actors.filter((a) =>
        // Granted beasts are npc documents connected by `connectedTo` now, not
        // `container` actors keeper-linked through the owner's array.
        (a.system?.connectedTo === actor.uuid || a.system?.keeper === actor.uuid));
    const named = (actor, re) => actor.items.filter((i) => re.test(i.name));

    // 1. Packs + every reference resolves.
    const bgPack = game.packs.get("air-bladder.backgrounds-barebones");
    const tPack = game.packs.get("air-bladder.tables-barebones");
    if (!bgPack || !tPack) return { error: "backgrounds-barebones or tables-barebones pack is not registered" };
    const bgs = await bgPack.getDocuments();
    const tables = await tPack.getDocuments();

    const { resolveGearItem } = await import("/systems/air-bladder/module/gear.js");
    const refNames = new Set();
    for (const bg of bgs) for (const g of bg.system.startingGear ?? []) refNames.add(g.name);
    const META = new Set(["Spellbook", "Random Spellbook", "Scroll of Random Spellbook", "Random Additional Gear"]);
    const misses = [];
    for (const n of refNames) {
      if (META.has(n)) continue;
      if (!(await resolveGearItem(n))) misses.push(n);
    }

    const setup = {
      backgrounds: bgs.length,
      allBackgroundType: bgs.every((b) => b.type === "background"),
      allBarebonesSource: bgs.every((b) => b.system.source === "barebones"),
      // No background inlines gear: every grant is a bare {name, uses?} reference.
      allByReference: bgs.every((b) => (b.system.startingGear ?? []).every(
        (g) => Object.keys(g).every((k) => k === "name" || k === "uses" || k === "quantity"))),
      tables: tables.map((t) => t.name).sort(),
      distinctRefs: refNames.size,
      misses,
    };

    // 2. Generate. Force the source rather than relying on the world's settings.
    const data = await gen.generateBarebonesCharacter();
    if (!data) return { error: "generateBarebonesCharacter returned nothing" };
    const actor = track(await gen.createActorWithCharacter(data));
    for (const c of containersOf(actor)) made.push(c);

    const bg = bgs.find((b) => b.name === data.background);
    const weapons = actor.items.filter((i) => i.type === "weapon");
    const armors = actor.items.filter((i) => i.type === "armor");
    const character = {
      source: actor.system.contentSource,
      background: actor.system.background,
      linked: actor.system.backgroundUuid === bg?.uuid,
      hp: actor.system.hp.max,
      hpInRange: actor.system.hp.max >= 1 && actor.system.hp.max <= 6,
      abilitiesInRange: ["STR", "DEX", "WIL"].every((k) => {
        const v = actor.system.abilities[k].max;
        return v >= 3 && v <= 18;
      }),
      // The SRD's base kit, granted to every Barebones character.
      hasRations: named(actor, /^Rations$/).length === 1,
      hasTorch: named(actor, /^Torch$/).length === 1,
      // Step 5: a weapon always; armor unless the d6 came up None.
      weapon: weapons[0]?.name,
      weaponEquipped: weapons.some((w) => w.system.equipped),
      armor: armors[0]?.name ?? "(None)",
      armorEquipped: armors.length === 0 || armors.some((a) => a.system.equipped),
      // The background's own gear is source-tagged so the sheet can chip it.
      taggedBackgroundGear: actor.items.filter(
        (i) => i.getFlag("air-bladder", "grantSource") === "background").length,
      // 2e-only structures must be absent.
      noQuestions: (actor.system.questions ?? []).length === 0,
      traits: Object.values(actor.system.traits ?? {}).filter(Boolean).length,
      age: actor.system.age,
    };

    // 3. Edit a pool weapon -> regenerate -> the edit is on the character.
    //    Uses the character's OWN weapon so the assertion cannot miss.
    const wPack = game.packs.get("air-bladder.weapons");
    const poolWeapon = (await wPack.getDocuments()).find((d) => d.name === weapons[0]?.name);
    let edit = { skipped: true };
    if (poolWeapon) {
      const wasLocked = wPack.locked;
      if (wasLocked) await wPack.configure({ locked: false });
      const origDesc = poolWeapon.system.description ?? "";
      const marker = "PROBE-BB-MARKER-5";
      await poolWeapon.update({ "system.description": marker });

      // Re-resolve directly: regeneration re-rolls the weapon, so asking for this
      // exact one is the precise test of the reference guarantee.
      const fresh = await resolveGearItem(poolWeapon.name);
      edit = { skipped: false, name: poolWeapon.name, flowed: fresh?.system.description === marker };

      await poolWeapon.update({ "system.description": origDesc });
      if (wasLocked) await wPack.configure({ locked: true });
    }

    // 4. Regenerate keeps the background, re-rolls the rest.
    const beforeItems = actor.items.map((i) => i.name).sort().join("|");
    const beforeBg = actor.system.background;
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) {
      await gen.regenerateActor(actor);
      for (const c of containersOf(actor)) made.push(c);
      changed = actor.items.map((x) => x.name).sort().join("|") !== beforeItems;
    }
    const regen = {
      keptBackground: actor.system.background === beforeBg,
      keptSource: actor.system.contentSource === "barebones",
      rerolled: changed,
    };

    // 5. The two transport backgrounds mint container Actors.
    const merchant = bgs.find((b) => b.name === "Merchant");
    const mActor = track(await gen.createActorWithCharacter(await gen.generateBarebonesCharacter(merchant)));
    const mContainers = containersOf(mActor);
    for (const c of mContainers) made.push(c);
    const transport = {
      background: mActor.system.background,
      containerCount: mContainers.length,
      name: mContainers[0]?.name,
      capacity: mContainers[0]?.system.slotsMax,
      variety: mContainers[0]?.system.containerClass,
      // ...and NOT as an item, which is what the fork was forced to do.
      notAnItem: !mActor.items.some((i) => /^wagon$/i.test(i.name)),
    };

    // 6. Armor "None" buys a second Additional Gear roll. Counted off the
    //    GENERATED DATA rather than by creating actors: this needs both d6
    //    branches to come up, and building ~dozens of Actors (each minting
    //    containers and resolving every reference) took minutes for a fact the
    //    payload already states.
    //    Asserted through an INVARIANT rather than by counting categories: for
    //    ONE fixed background, the total item count is the same whichever way the
    //    armor d6 falls, because "None" trades the armor for an extra gear roll.
    //      with armor: gear + base + weapon + armor + 1 extra
    //      without:    gear + base + weapon +   0   + 2 extras
    //    Earlier versions of this tried to derive the extras count from item
    //    types and grant tags and got it wrong twice: mundane background gear is
    //    deliberately untagged, and a background-granted weapon was subtracted
    //    both as a startingGear reference and as a weapon. Counting nothing is
    //    the fix.
    //    The bond setting is forced OFF here rather than inherited: with bonds on,
    //    step 6 is skipped entirely and this measures nothing. An interrupted run
    //    of THIS probe once left the setting on in the dev world and the failure
    //    looked exactly like a generation bug.
    const bondsWere = game.settings.get("air-bladder", "show-bonds-barebones");
    await game.settings.set("air-bladder", "show-bonds-barebones", false);

    const step6Bg = bgs.find((b) => b.name === "Beadle");   // fixed: gear is 3 plain items
    let armored = null, unarmored = null, tries = 0;
    for (; tries < 60 && (armored === null || unarmored === null); tries++) {
      const d = await gen.generateBarebonesCharacter(step6Bg);
      const hasArmor = d.items.some((i) => i.type === "armor");
      if (hasArmor && armored === null) armored = d.items.length;
      if (!hasArmor && unarmored === null) unarmored = d.items.length;
    }
    const step6 = { armored, unarmored, tries, balanced: armored !== null && armored === unarmored };

    // 7. Bonds REPLACE the Additional Gear step rather than adding to it.
    await game.settings.set("air-bladder", "show-bonds-barebones", true);
    const bonded = await gen.generateBarebonesCharacter();
    await game.settings.set("air-bladder", "show-bonds-barebones", bondsWere);
    //    Two of the twenty bond results grant only gold and narrative, no item, so
    //    "the bond granted a tagged item" is NOT a safe assertion — it fails one
    //    run in ten. What must hold is that every item a bond DOES grant is tagged
    //    with that bond's id, and that enabling bonds does not also roll step 6.
    const bondItems = bonded.items.filter((i) =>
      String(i.flags?.["air-bladder"]?.grantSource ?? "").startsWith("bond:"));
    const bondId = (bonded.bonds ?? [])[0]?.id;
    // Same fixed background, bonds off, for a like-for-like total.
    await game.settings.set("air-bladder", "show-bonds-barebones", false);
    const plain = await gen.generateBarebonesCharacter(step6Bg);
    await game.settings.set("air-bladder", "show-bonds-barebones", true);
    const bondedSame = await gen.generateBarebonesCharacter(step6Bg);
    await game.settings.set("air-bladder", "show-bonds-barebones", bondsWere);
    const bondedItems = bondedSame.items.filter((i) =>
      String(i.flags?.["air-bladder"]?.grantSource ?? "").startsWith("bond:")).length;
    const plainArmor = plain.items.some((i) => i.type === "armor") ? 1 : 0;
    const bondedArmor = bondedSame.items.some((i) => i.type === "armor") ? 1 : 0;
    const bonds = {
      count: (bonded.bonds ?? []).length,
      hasGold: (bonded.bonds ?? []).every((b) => typeof b.gold === "number"),
      allTagged: bondItems.every((i) => i.flags["air-bladder"].grantSource === `bond:${bondId}`),
      // The bond REPLACES the Additional Gear roll: with bonds on you hold the
      // bond's items instead of that one extra, so totals line up once the armor
      // branch and the bond's own grant count are accounted for.
      replaced:
        (bondedSame.items.length - bondedItems - bondedArmor) ===
        (plain.items.length - 1 - plainArmor),
      plainTotal: plain.items.length,
      bondedTotal: bondedSame.items.length,
    };

    // A background whose gear list mixes a "Random Additional Gear" row with
    // literal items must never hand out two of the same thing.
    //
    // Asserting on the guard set's CONTENTS afterwards proves nothing: every
    // resolved item is added to it as the list is walked, so the literal ends up
    // in there either way. What the fix changes is WHEN — the literals must all be
    // present BEFORE the random roll consults it. So record the insertion order
    // and require the literals to land first. (Generating until a collision
    // appears is not an option: the Merchant's clash is Stylus, one row in a
    // hundred.)
    const dupGuard = {};
    for (const name of ["Merchant", "Fence", "Peddler"]) {
      const bg = (await gen.getBarebonesBackgrounds()).find((b) => b.name === name);
      if (!bg) { dupGuard[name] = "MISSING"; continue; }
      const order = [];
      const guard = new Set(["rations", "torch"]);
      const realAdd = guard.add.bind(guard);
      guard.add = (v) => { order.push(v); return realAdd(v); };

      const gear = await gen.resolveStartingGear(bg, guard);
      const literals = (bg.system.startingGear ?? [])
        .map((g) => String(g.name).toLowerCase())
        .filter((n) => !["random additional gear", "spellbook", "random spellbook", "scroll of random spellbook"].includes(n));
      // index of the first thing the walk itself resolved (aliases mean a literal
      // may be recorded under a different name, so compare against the seeded run)
      const seeded = order.slice(0, order.length - gear.length);
      const names = gear.map((g) => g.name.toLowerCase());
      dupGuard[name] = {
        seededFirst: literals.every((n) => seeded.includes(n)),
        noDuplicates: new Set(names).size === names.length,
        literals,
        seeded,
      };
    }

    for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
    return { setup, character, edit, regen, transport, step6, bonds, dupGuard };
  });

  if (r.error) {
    fail(r.error);
  } else {
    const S = r.setup;
    S.backgrounds === 100 ? ok("100 Barebones background documents installed") : fail(`expected 100 backgrounds, got ${S.backgrounds}`);
    S.allBackgroundType && S.allBarebonesSource ? ok("all are the shared `background` Item type, source barebones") : fail("some backgrounds are the wrong type/source");
    S.allByReference ? ok("no background inlines gear — every grant is a by-name reference") : fail("a background carries inlined gear data");
    S.misses.length === 0 ? ok(`all ${S.distinctRefs} distinct gear references resolve against the pool (0 misses)`) : fail(`${S.misses.length} unresolved: ${S.misses.slice(0, 8).join(", ")}`);
    S.tables.length === 6 ? ok(`6 creation tables: ${S.tables.join(", ")}`) : fail(`expected 6 tables, got ${S.tables.length}`);

    const C = r.character;
    C.source === "barebones" && C.linked ? ok(`generated "${C.background}" (linked by uuid)`) : fail(`source/link wrong: ${C.source}, linked=${C.linked}`);
    C.hpInRange && C.abilitiesInRange ? ok(`1d6 HP (${C.hp}) and 3d6 abilities are in range`) : fail(`HP ${C.hp} or abilities out of range`);
    C.hasRations && C.hasTorch ? ok("base kit granted: Rations + Torch") : fail(`base kit missing (rations=${C.hasRations}, torch=${C.hasTorch})`);
    C.weapon && C.weaponEquipped ? ok(`step 5 weapon equipped: ${C.weapon}`) : fail(`no equipped weapon (got ${C.weapon})`);
    C.armorEquipped ? ok(`step 5 armor: ${C.armor}${C.armor === "(None)" ? " — buys an extra gear roll" : " (equipped)"}`) : fail("armor was granted but not equipped");
    C.taggedBackgroundGear > 0 ? ok(`${C.taggedBackgroundGear} background-granted items carry the source tag`) : fail("no background gear was source-tagged");
    C.noQuestions && C.traits === 8 ? ok(`8 traits, age ${C.age}, and no 2e questions`) : fail(`traits=${C.traits}, questions present=${!C.noQuestions}`);

    r.edit.skipped ? fail("could not find the character's weapon in the pool — edit test skipped")
      : r.edit.flowed ? ok(`EDIT FLOWS THROUGH: a pool edit to ${r.edit.name} reaches the next grant`)
      : fail(`the pool edit did NOT flow through for ${r.edit.name}`);

    r.regen.keptBackground && r.regen.keptSource ? ok("regenerate keeps the background and the content source") : fail("regenerate lost the background or switched source");
    r.regen.rerolled ? ok("regenerate re-rolls the rest of the character") : fail("regenerate produced an identical inventory 5 times");

    r.transport.containerCount === 1 && r.transport.notAnItem
      ? ok(`the Merchant's ${r.transport.name} is a container Actor (+${r.transport.capacity}, ${r.transport.variety}), not an item`)
      : fail(`Merchant transport wrong: ${r.transport.containerCount} containers, notAnItem=${r.transport.notAnItem}`);

    r.step6.armored === null || r.step6.unarmored === null
      ? fail(`only one armor branch came up in ${r.step6.tries} rolls — inconclusive`)
      : r.step6.balanced
      ? ok(`armor "None" buys a second Additional Gear roll (same ${r.step6.armored} items either way, over ${r.step6.tries} rolls)`)
      : fail(`step 6 unbalanced: ${r.step6.armored} items with armor vs ${r.step6.unarmored} without (should match)`);

    r.bonds.count === 1 && r.bonds.hasGold && r.bonds.allTagged
      ? ok("with bonds enabled, exactly one bond is rolled and every item it grants is tagged to it")
      : fail(`bond gating wrong: ${r.bonds.count} bonds, allTagged=${r.bonds.allTagged}`);
    r.bonds.replaced
      ? ok(`the bond REPLACES the Additional Gear roll (${r.bonds.plainTotal} items without, ${r.bonds.bondedTotal} with)`)
      : fail(`bonds did not replace step 6: ${r.bonds.plainTotal} plain vs ${r.bonds.bondedTotal} bonded`);


  // Duplicate guard: a "Random Additional Gear" roll must not re-grant something
  // the same background already hands over outright, wherever it sits in the list.
  for (const [name, g] of Object.entries(r.dupGuard ?? {})) {
    if (g === "MISSING") { fail(`${name}: background not found`); continue; }
    g.seededFirst && g.noDuplicates
      ? ok(`${name}: guarded before the roll -> [${(g.seeded ?? []).join(", ")}] (needs: ${g.literals.join(", ")})`)
      : fail(`${name}: seededFirst=${g.seededFirst}, noDuplicates=${g.noDuplicates}, seeded=[${(g.seeded ?? []).join(", ")}]`);
  }  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nBAREBONES PROBE FAILED\n" : "\nbarebones probe passed\n");
process.exit(failed ? 1 : 0);

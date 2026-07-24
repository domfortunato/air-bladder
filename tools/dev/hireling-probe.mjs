#!/usr/bin/env node
/**
 * Hireling acceptance probe: prove that a generated hireling is a faithful copy
 * of one of Cairn 2e's twelve example statblocks, and that its gear is a live
 * COPY of the editable pool -- the same reference guarantee as a character's
 * starting gear, not a second inlined loadout.
 *
 *   node tools/dev/hireling-probe.mjs     (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. Load the shipped catalogue; assert 12 statblocks, all gear by-name refs
 *      (a `tags` key would mean the inline shape crept back in).
 *   2. Create a hireling; assert its profession/day-rate/HP/abilities match its
 *      book statblock exactly, and that every gear reference resolved into an
 *      owned item tagged grantSource "profession".
 *   3. Assert derived Armor equals the statblock's printed Armor -- which only
 *      holds if the armor pieces resolved from the pool AND were equipped.
 *   4. Edit a pool item the hireling carries; re-roll the profession until it
 *      comes back round to that statblock, and assert the edit flows through.
 *   5. Profession re-roll replaces only profession-tagged gear: a GM-added item
 *      survives.
 *   6. Name re-roll changes the name and leaves the statblock alone.
 *   7. Revert the pool item and delete the test actor.
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
    const CG = game.cairn.characterGenerator;
    const gear = await import("/systems/air-bladder/module/gear.js");

    const findPoolDoc = async (name) => {
      const lower = String(name).toLowerCase();
      for (const key of gear.CANONICAL_GEAR_PACKS) {
        const p = game.packs.get(key);
        if (!p) continue;
        const d = (await p.getDocuments()).find((x) => x.name.toLowerCase() === lower);
        if (d) return d;
      }
      return null;
    };

    // 1. The shipped catalogue must be references, not inline records.
    const list = await CG.getHirelings2e();
    if (!list.length) return { error: "hirelings catalogue is empty or unreachable" };
    const inlineLeak = list.flatMap((h) => h.gear ?? []).filter((g) => "tags" in g || "description" in g);
    const catalogue = {
      count: list.length,
      refCount: list.reduce((n, h) => n + (h.gear?.length ?? 0), 0),
      inlineLeak: inlineLeak.length,
    };

    // 2. Create a hireling and match it against its book statblock.
    const actor = await CG.createHireling();
    const book = list.find((h) => h.name === actor.system.profession);
    if (!book) return { error: `generated profession "${actor.system.profession}" is not in the catalogue` };

    const tagged = actor.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "profession");
    const gen = {
      profession: book.name,
      dayRate: actor.system.dayRate === book.rate,
      hp: actor.system.hp.value === book.hp && actor.system.hp.max === book.hp,
      abilities:
        actor.system.abilities.STR.value === book.abilities.STR &&
        actor.system.abilities.DEX.value === book.abilities.DEX &&
        actor.system.abilities.WIL.value === book.abilities.WIL,
      // Every reference resolved into an owned item.
      resolvedAll: tagged.length === (book.gear?.length ?? 0),
      resolved: tagged.length,
      expected: book.gear?.length ?? 0,
      // 3. Printed Armor is DERIVED: it only matches if the armor pieces came out
      //    of the pool and were equipped.
      armorDerived: (actor.system.armor ?? 0) === (book.armor ?? 0),
      armorGot: actor.system.armor ?? 0,
      armorBook: book.armor ?? 0,
      portrait: !!actor.img && actor.img.includes("character_portraits"),
    };

    // 3b. The armor check above is vacuous when the rolled statblock prints 0
    //     Armor (most do). Cycle to one that prints armor so "resolved from the
    //     pool AND equipped" is actually exercised.
    const armored = list.find((h) => (h.armor ?? 0) > 0);
    let armorCase = null;
    if (armored) {
      for (let i = 0; i < 200 && actor.system.profession !== armored.name; i++) {
        await CG.rerollHirelingProfession(actor);
      }
      if (actor.system.profession === armored.name) {
        armorCase = {
          profession: armored.name,
          book: armored.armor,
          got: actor.system.armor ?? 0,
          matches: (actor.system.armor ?? 0) === armored.armor,
          equipped: actor.items.filter((i) => i.type === "armor" && i.system.equipped).length,
        };
      }
    }

    // 4. Edit a pool item this statblock grants, then re-roll professions until we
    //    land back on it, and check the edit came through.
    const refName = book.gear[0].name;
    const poolDoc = await findPoolDoc(refName);
    let editFlowed = null, editTarget = null;
    if (poolDoc) {
      const pack = game.packs.get(poolDoc.pack);
      const wasLocked = pack.locked;
      if (wasLocked) await pack.configure({ locked: false });
      const origDesc = poolDoc.system.description ?? "";
      const marker = "HIRELING-PROBE-MARKER-7";
      await poolDoc.update({ "system.description": marker });

      // Re-roll AWAY first -- the actor currently IS this profession, and its gear
      // was built before the edit, so a loop that stops on "already there" would
      // compare the stale pre-edit item and always fail. Then cycle back to it
      // (re-roll avoids the current profession, so it wanders); bounded so a miss
      // cannot hang the probe.
      await CG.rerollHirelingProfession(actor);
      for (let i = 0; i < 200 && actor.system.profession !== book.name; i++) {
        await CG.rerollHirelingProfession(actor);
      }
      if (actor.system.profession === book.name) {
        const it = actor.items.find((x) => x.name.toLowerCase() === poolDoc.name.toLowerCase());
        editFlowed = (it?.system.description ?? "") === marker;
        editTarget = poolDoc.name;
      }
      await poolDoc.update({ "system.description": origDesc });
      if (wasLocked) await pack.configure({ locked: true });
    }

    // 5. A GM-added item must survive a profession re-roll (it carries no
    //    grantSource, so _replace-by-source must not touch it).
    await actor.createEmbeddedDocuments("Item", [{ name: "PROBE GM Item", type: "item" }]);
    const beforeProf = actor.system.profession;
    await CG.rerollHirelingProfession(actor);
    const survive = {
      gmItemKept: !!actor.items.find((i) => i.name === "PROBE GM Item"),
      professionChanged: actor.system.profession !== beforeProf,
      // Old profession gear must be gone: no item tagged "profession" should
      // belong to a statblock other than the current one.
      staleCleared: (() => {
        const now = list.find((h) => h.name === actor.system.profession);
        const names = new Set((now?.gear ?? []).map((g) => g.name.toLowerCase()));
        const tagged2 = actor.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "profession");
        // Aliased names resolve to a differently-named pool item, so compare on
        // COUNT rather than identity: no more tagged items than the statblock grants.
        return tagged2.length <= (now?.gear?.length ?? 0);
      })(),
    };

    // 6. Name re-roll: name changes, statblock untouched.
    const nameBefore = actor.name;
    const profBefore = actor.system.profession;
    const hpBefore = actor.system.hp.max;
    await CG.rerollHirelingName(actor);
    const rename = {
      changed: actor.name !== nameBefore,
      statblockKept: actor.system.profession === profBefore && actor.system.hp.max === hpBefore,
      newName: actor.name,
    };

    // 7. The sheet itself renders (the probe above is all data; a template typo
    //    would sail straight through it).
    actor.sheet.render(true);
    await new Promise((res) => setTimeout(res, 3000));
    const el = actor.sheet.element;
    const node = el?.[0] ?? el;              // AppV1 returns jQuery
    const sheet = {
      cls: actor.sheet.constructor.name,
      inDom: !!document.querySelector(".app.window-app"),
      tabs: [...(node?.querySelectorAll?.("nav .item, .tabs .item") ?? [])].map((t) => t.textContent.trim()),
      hasProfession: !!node?.querySelector?.(".profession-input"),
      hasDayRate: !!node?.querySelector?.(".day-rate-input"),
      // A hireling has no Description tab -- that is the point of the stripped sheet.
      noDescriptionTab: ![...(node?.querySelectorAll?.("nav .item") ?? [])]
        .some((t) => t.dataset.tab === "description"),
    };

    await actor.delete();
    return { catalogue, gen, armorCase, editFlowed, editTarget, survive, rename, sheet };
  });

  if (r.error) {
    fail(r.error);
  } else {
    console.log(`  catalogue: ${r.catalogue.count} statblocks, ${r.catalogue.refCount} gear references`);
    r.catalogue.count === 12 ? ok("12 example hirelings shipped") : fail(`expected 12 statblocks, got ${r.catalogue.count}`);
    r.catalogue.inlineLeak === 0 ? ok("all gear is by-name references (no inline tags/descriptions)") : fail(`${r.catalogue.inlineLeak} gear entries still carry inline tags/description`);

    console.log(`  generated hireling: ${r.gen.profession}`);
    r.gen.dayRate ? ok("day rate matches the book statblock") : fail("day rate does not match the statblock");
    r.gen.hp ? ok("HP matches the book statblock") : fail("HP does not match the statblock");
    r.gen.abilities ? ok("STR/DEX/WIL match the book statblock") : fail("abilities do not match the statblock");
    r.gen.resolvedAll ? ok(`all ${r.gen.expected} gear references resolved from the pool`) : fail(`only ${r.gen.resolved}/${r.gen.expected} gear references resolved`);
    r.gen.armorDerived ? ok(`derived Armor ${r.gen.armorGot} matches the printed ${r.gen.armorBook} (pool armor resolved AND equipped)`) : fail(`derived Armor ${r.gen.armorGot} != printed ${r.gen.armorBook}`);
    r.gen.portrait ? ok("hireling got a shipped portrait") : fail("hireling has no shipped portrait");

    if (!r.armorCase) fail("could not reach an armoured statblock to test derived Armor");
    else r.armorCase.matches
      ? ok(`${r.armorCase.profession}: derived Armor ${r.armorCase.got} matches the printed ${r.armorCase.book} (${r.armorCase.equipped} armor piece(s) equipped from the pool)`)
      : fail(`${r.armorCase.profession}: derived Armor ${r.armorCase.got} != printed ${r.armorCase.book} (${r.armorCase.equipped} equipped)`);

    if (r.editFlowed === null) fail("could not cycle back to the edited profession to test pool edits");
    else r.editFlowed ? ok(`EDIT FLOWS THROUGH: pool edit to "${r.editTarget}" appears on the re-rolled hireling`) : fail(`pool edit to "${r.editTarget}" did NOT flow through`);

    r.survive.professionChanged ? ok("profession re-roll changes the profession") : fail("profession re-roll did not change the profession");
    r.survive.gmItemKept ? ok("GM-added item survives a profession re-roll") : fail("profession re-roll destroyed a GM-added item");
    r.survive.staleCleared ? ok("previous profession's gear was cleared") : fail("stale profession gear left behind");

    r.rename.changed ? ok(`name re-roll changed the name (${r.rename.newName})`) : fail("name re-roll did not change the name");
    r.rename.statblockKept ? ok("name re-roll left the statblock alone") : fail("name re-roll disturbed the statblock");

    r.sheet.inDom ? ok(`${r.sheet.cls} rendered [${r.sheet.tabs.join(" | ")}]`) : fail("hireling sheet did not appear in the DOM");
    r.sheet.hasProfession && r.sheet.hasDayRate ? ok("sheet shows the Profession and Day Rate fields") : fail("sheet is missing the Profession/Day Rate fields");
    r.sheet.noDescriptionTab ? ok("no Description tab (the stripped 2-tab hireling sheet)") : fail("hireling sheet has a Description tab");
  }
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

console.log(failed ? "\nHIRELING PROBE FAILED\n" : "\nhireling probe passed\n");
process.exit(failed ? 1 : 0);

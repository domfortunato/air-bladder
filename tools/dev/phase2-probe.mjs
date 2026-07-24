#!/usr/bin/env node
/**
 * Phase 2 acceptance probe: prove that a generated 2e character's gear is a live
 * COPY of the editable pool item — so editing the pool and regenerating shows the
 * change. This is the capability the whole rebuild exists to restore.
 *
 *   node tools/dev/phase2-probe.mjs        (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. Find a background whose FIXED startingGear resolves to an armor item.
 *   2. Generate a character with that background; assert the embedded armor item
 *      matches the pool item's armor value AND is equipped (proves clone-from-pool,
 *      not an inline rebuild).
 *   3. Edit the pool armor item in place — bump system.armor, stamp a description
 *      marker — with the pack unlocked. (Name is NOT changed: references resolve by
 *      name, so renaming would correctly orphan the reference.)
 *   4. Regenerate the SAME actor (background persists by uuid) and assert the new
 *      embedded item reflects BOTH edits.
 *   5. Revert the pool item and delete the test actor.
 * Exits non-zero on any failed assertion or console error.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
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

    // 1. A background whose fixed startingGear yields an armor item.
    const bgs = await game.packs.get("air-bladder.backgrounds-2e").getDocuments();
    let bg = null, armorName = null;
    for (const b of bgs) {
      for (const ref of b.system.startingGear ?? []) {
        const it = await gear.resolveGearItem(ref.name);
        if (it && it.type === "armor") { bg = b; armorName = it.name; break; }
      }
      if (bg) break;
    }
    if (!bg) return { error: "no background grants an armor item in startingGear" };

    const poolDoc = await findPoolDoc(armorName);
    const packKey = poolDoc.pack;
    const origArmor = poolDoc.system.armor;
    const origDesc = poolDoc.system.description ?? "";

    // 2. Generate with that background; inspect the embedded armor item.
    const data1 = await CG.generate2eCharacter(bg);
    const actor = await CG.createActorWithCharacter(data1);
    const e1 = actor.items.find((i) => i.type === "armor" && i.name.toLowerCase() === armorName.toLowerCase());
    const gen1 = {
      backgroundPersisted: actor.system.backgroundUuid === bg.uuid,
      hasArmor: !!e1,
      equipped: e1?.system.equipped === true,
      matchesPoolValue: e1?.system.armor === origArmor,
      traits: Object.values(actor.system.traits ?? {}).filter(Boolean).length,
      bonds: (actor.system.bonds ?? []).length,
      questions: (actor.system.questions ?? []).length,
      itemCount: actor.items.size,
    };

    // 3. Edit the pool item in place (unlock, bump armor, stamp description).
    const pack = game.packs.get(packKey);
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });
    const newArmor = origArmor + 5;
    const marker = "PROBE-EDIT-MARKER-42";
    await poolDoc.update({ "system.armor": newArmor, "system.description": marker });

    // 4. Regenerate the same actor (same background, by uuid) and re-inspect.
    await CG.regenerateActor(actor);
    const e2 = actor.items.find((i) => i.type === "armor" && i.name.toLowerCase() === armorName.toLowerCase());
    const gen2 = {
      hasArmor: !!e2,
      armorValue: e2?.system.armor,
      reflectsArmorEdit: e2?.system.armor === newArmor,
      reflectsDescEdit: (e2?.system.description ?? "") === marker,
    };

    // 5. Revert + cleanup.
    await poolDoc.update({ "system.armor": origArmor, "system.description": origDesc });
    if (wasLocked) await pack.configure({ locked: true });
    await actor.delete();

    return { backgroundName: bg.name, armorName, packKey, origArmor, newArmor, gen1, gen2 };
  });

  if (r.error) {
    fail(r.error);
  } else {
    console.log(`  bg "${r.backgroundName}" grants "${r.armorName}" (pool ${r.packKey}, armor ${r.origArmor})`);
    r.gen1.backgroundPersisted ? ok("background persisted on generated actor") : fail("backgroundUuid not set");
    r.gen1.hasArmor ? ok("generated character has the armor item") : fail("armor item missing from generated character");
    r.gen1.equipped ? ok("starting armor is equipped") : fail("starting armor not equipped");
    r.gen1.matchesPoolValue ? ok(`armor value matches pool (${r.origArmor}) — a clone, not an inline build`) : fail("armor value does not match pool item");
    r.gen1.traits === 8 ? ok("8 traits generated") : fail(`expected 8 traits, got ${r.gen1.traits}`);
    r.gen1.bonds >= 1 ? ok(`${r.gen1.bonds} bond(s) generated`) : fail("no bonds generated");
    r.gen1.questions >= 1 ? ok(`${r.gen1.questions} question(s) generated`) : fail("no questions generated");

    r.gen2.hasArmor ? ok("regenerated character still has the armor item") : fail("armor item missing after regenerate");
    r.gen2.reflectsArmorEdit
      ? ok(`EDIT FLOWS THROUGH: armor value is now ${r.newArmor} (was ${r.origArmor})`)
      : fail(`armor edit did NOT flow through (got ${r.gen2.armorValue}, expected ${r.newArmor})`);
    r.gen2.reflectsDescEdit ? ok("EDIT FLOWS THROUGH: description marker present on regenerated item") : fail("description edit did NOT flow through");
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

console.log(failed ? "\nPHASE 2 PROBE FAILED\n" : "\nphase 2 probe passed\n");
process.exit(failed ? 1 : 0);

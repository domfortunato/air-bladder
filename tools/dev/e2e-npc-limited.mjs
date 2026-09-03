#!/usr/bin/env node
/**
 * What a PLAYER may see of the people the Warden makes (2026-08-21, user ask),
 * plus the Warden-side pickers that landed in the same batch. Two sessions —
 * the GM for setup and the picker legs, Alice for everything about players —
 * because a GM can never reproduce a permission bug (the container re-roll
 * lesson).
 *
 *   1. A generated NPC stamps default ownership LIMITED, and a LIMITED viewer's
 *      sheet is the LIMITED VIEW: portrait, name, description — no statblock,
 *      no items, no Print button. The npc sheet had no limited rendering at all
 *      before this, so a LIMITED player saw everything; the negative control
 *      restores exactly that state in-page (context.limitedView forced false on
 *      Alice's client) and must show her the stats.
 *
 *   1b. A LIMITED viewer of a player CHARACTER gets the same wall (review #22,
 *      user ruling 2026-09-02): portrait and name, no statblock, no items, no
 *      Print — the character sheet rendered its FULL sheet to a LIMITED viewer
 *      before this while the Print gate withheld the button on the stated
 *      grounds of hiding what was already on screen. Same in-page negative
 *      control as leg 1.
 *
 *   1c. The Print frame button follows LIVE ownership (review #22): the frame
 *      builds once (isFirstRender only), so the button is built always and
 *      synced per render — Alice's open sheet gains Print when the Warden
 *      promotes her mid-session and loses it when demoted, the content
 *      swapping between full and limited view in the same breath.
 *
 *   2. A player NEVER sees the randomization surface on an npc-type sheet —
 *      dice, pickers, frame buttons — even as OWNER of the hireling, even with
 *      allow-player-randomization ON. The setting is ESTABLISHED on for the
 *      leg, because with it off the old code hides the dice too and the leg
 *      would pass against the unfixed build. The control restores the old
 *      _mayRandomize body (isGM || setting), which must bring her dice back;
 *      the enforcement leg calls the wrapped action directly, because a hidden
 *      control is an affordance and a crafted client must meet a refusal.
 *
 *   3. The Warden's pickers: the magnifying glass rides the actor's
 *      Randomization toggle exactly like the die — OFF removes both, ON
 *      offers both (2026-08-21 pm, reversing that morning's survive-the-toggle
 *      ruling) — and the apply halves adopt what was picked — a career with
 *      its statblock, rate and gear; a Background with its gear, the kit
 *      kept. The pick of a
 *      counterpart-less Background (Politician) grants nothing new and
 *      UNPACKS the kit (2026-08-21, reversing the generation-only scoping the
 *      Lord ruling carried for a few hours). The prompt
 *      DIALOGS share promptFailedCareer's proven shape and are not re-proven
 *      here; the applies and the affordances are what this batch added.
 *
 * World state — the setting and every actor created here — is restored from
 * NODE in a finally, and the restore is asserted.
 *
 * Usage: npm run dev:npc-limited   (needs `npm run dev:players` once, for Alice)
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(420000, "npc limited-view probe");

const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const gmErrors = watchErrors(gm);
await joinAsGM(gm);
await dismissChrome(gm);

let saved = null;
let aliceErrors = [];
const restore = async () => {
  try {
    const left = await gm.evaluate(async (s) => {
      for (const id of s?.ids ?? []) await game.actors.get(id)?.delete();
      if (s) await game.settings.set("air-bladder", "allow-player-randomization", s.randomization);
      return (s?.ids ?? []).filter((id) => game.actors.get(id)).length;
    }, saved);
    if (left) fail(`restore left ${left} probe actor(s) in the world`);
    else if (saved) ok(`restored: ${saved.ids.length} actor(s) removed, settings put back`);
  } catch (e) {
    fail(`could not restore world state: ${e.message}`);
  }
};

try {
  /* --- setup, as GM ---------------------------------------------------------- */

  const setup = await gm.evaluate(async () => {
    const NS = "air-bladder";
    const cg = game.cairn.characterGenerator;
    const alice = game.users.getName("Alice");
    if (!alice) return { error: 'no user named "Alice" — run `npm run dev:players` first' };

    const out = {
      aliceId: alice.id,
      saved: { randomization: game.settings.get(NS, "allow-player-randomization"), ids: [] },
    };
    // ESTABLISH the permissive state: with the switch off, the OLD code hides
    // player dice too, and leg 2 would pass against the unfixed build.
    await game.settings.set(NS, "allow-player-randomization", true);

    const npc = await cg.createNpc();
    out.saved.ids.push(npc.id);
    out.npcId = npc.id;
    out.npcOwnership = npc.ownership?.default;
    // The description a LIMITED viewer is entitled to see.
    await npc.update({ "system.description": "<p>ZZ LIMITED DESC sentinel</p>" });

    const hire = await cg.createHireling();
    out.saved.ids.push(hire.id);
    out.hireId = hire.id;
    // Alice OWNS her hireling — the strongest case for leg 2 — and its own
    // Randomization toggle is ON, so only the viewer gate can hide the dice.
    await hire.update({
      ownership: { [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      "system.generationEnabled": true,
    });
    return out;
  });
  if (setup.error) { fail(`setup: ${setup.error}`); throw new Error(setup.error); }
  saved = setup.saved;

  console.log("\n1. a generated NPC is LIMITED by default");
  if (setup.npcOwnership === 1) ok("createNpc stamps ownership.default LIMITED");
  else fail(`createNpc stamped ownership.default ${setup.npcOwnership}, not LIMITED (1)`);

  /* --- Alice: the limited view ------------------------------------------------ */

  const alice = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
  aliceErrors = watchErrors(alice);
  await joinAs(alice, "Alice");
  await dismissChrome(alice);

  const openAs = (page, id, control) => page.evaluate(async ({ id, control }) => {
    const actor = game.actors.get(id);
    if (!actor) return { error: "Alice cannot see the actor at all" };
    const sheet = actor.sheet;

    // NEGATIVE CONTROL: force limitedView false after the real context builds —
    // the pre-fix template had no limited branch, so a false flag IS the old
    // sheet, byte for byte.
    const proto = Object.getPrototypeOf(sheet);
    const orig = proto._prepareContext;
    if (control) {
      proto._prepareContext = async function (...a) {
        const c = await orig.call(this, ...a);
        c.limitedView = false;
        return c;
      };
    }
    try {
      await sheet.render(true);
      for (let i = 0; i < 40 && !sheet.element; i++) await new Promise((r) => setTimeout(r, 150));
      await new Promise((r) => setTimeout(r, 400));
      const root = sheet.element;
      const q = (sel) => !!root?.querySelector(sel);
      const visible = (sel) => {
        const el = root?.querySelector(sel);
        return !!el && !el.classList.contains("cairn-header-hidden");
      };
      const res = {
        limited: actor.limited,
        limitedBlock: q(".cairn-limited-sheet"),
        fullGrid: q(".charater-sheet-grid"),
        name: root?.querySelector(".cairn-limited-name")?.textContent?.trim() ?? null,
        desc: /ZZ LIMITED DESC sentinel/.test(root?.textContent ?? ""),
        statDice: q('[data-action="rollAbility"]'),
        statText: /STR/.test(root?.querySelector(".charater-sheet-grid")?.textContent ?? ""),
        itemsTab: q('[data-tab="items"]'),
        genDice: q('[data-action="rollProfession"], [data-action="rollName"], [data-action="rollPortrait"]'),
        pickers: q('[data-action="pickProfession"], [data-action="pickFaction"]'),
        printButton: visible('.window-header button[data-action="printSheet"]'),
        headerRoll: visible('.window-header button[data-action="rollActor"]'),
        headerToggle: visible('.window-header button[data-action="toggleGeneration"]'),
      };
      await sheet.close();
      return res;
    } finally {
      if (control) proto._prepareContext = orig;
    }
  }, { id, control });

  console.log("\n2. what Alice sees of the NPC (LIMITED)");
  const lim = await openAs(alice, setup.npcId, false);
  if (lim.error) fail(`limited leg: ${lim.error}`);
  else {
    if (!lim.limited) fail("Alice is not LIMITED on the NPC — the leg is aimed at nothing");
    if (lim.limitedBlock && !lim.fullGrid) ok("the limited view renders, the full grid does not");
    else fail(`limited block ${lim.limitedBlock}, full grid ${lim.fullGrid}`);
    if (lim.name && lim.desc) ok(`portrait block carries the name ("${lim.name}") and the description`);
    else fail(`name "${lim.name}", description shown ${lim.desc}`);
    if (!lim.statDice && !lim.statText && !lim.itemsTab && !lim.genDice && !lim.pickers) {
      ok("no stats, no items tab, no dice, no pickers");
    } else {
      fail(`leaked: statDice ${lim.statDice}, statText ${lim.statText}, itemsTab ${lim.itemsTab}, `
        + `genDice ${lim.genDice}, pickers ${lim.pickers}`);
    }
    if (!lim.printButton) ok("and no Print button — the page would hand over the statblock");
    else fail("the Print button is offered to a LIMITED viewer");
  }

  console.log("   negative control: the same sheet with limitedView forced false");
  const limc = await openAs(alice, setup.npcId, true);
  if (limc.error) fail(`limited control: ${limc.error}`);
  else if (limc.fullGrid && limc.statText) {
    ok("reproduced — the pre-fix sheet shows Alice the statblock");
  } else {
    fail(`the control did NOT reproduce (full grid ${limc.fullGrid}, stats ${limc.statText}) — `
      + "the limited branch cannot be shown to be load-bearing");
  }

  /* --- Alice: a LIMITED player CHARACTER gets the same wall (review #22) ------ */

  console.log("\n2b. what Alice sees of a LIMITED player character");
  const pcId = await gm.evaluate(async (aliceId) => {
    const pc = await getDocumentClass("Actor").create({
      name: "ZZ Limited PC",
      type: "character",
      ownership: { default: 0, [aliceId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
    });
    return pc.id;
  }, setup.aliceId);
  saved.ids.push(pcId);
  const pcLim = await openAs(alice, pcId, false);
  if (pcLim.error) fail(`limited-character leg: ${pcLim.error}`);
  else {
    if (!pcLim.limited) fail("Alice is not LIMITED on the character — the leg is aimed at nothing");
    if (pcLim.limitedBlock && !pcLim.fullGrid) ok("the character sheet renders the limited view, not the full grid");
    else fail(`character limited block ${pcLim.limitedBlock}, full grid ${pcLim.fullGrid}`);
    if (pcLim.name === "ZZ Limited PC") ok(`portrait block carries the name ("${pcLim.name}")`);
    else fail(`limited character name: "${pcLim.name}"`);
    if (!pcLim.statDice && !pcLim.statText && !pcLim.itemsTab) ok("no stats, no items tab");
    else fail(`leaked: statDice ${pcLim.statDice}, statText ${pcLim.statText}, itemsTab ${pcLim.itemsTab}`);
    if (!pcLim.printButton) ok("and no Print button");
    else fail("the Print button is offered to a LIMITED character viewer");
  }

  console.log("   negative control: the same sheet with limitedView forced false");
  const pcLimc = await openAs(alice, pcId, true);
  if (pcLimc.error) fail(`limited-character control: ${pcLimc.error}`);
  else if (pcLimc.fullGrid && pcLimc.statText) {
    ok("reproduced — the pre-fix character sheet shows Alice the whole statblock");
  } else {
    fail(`the control did NOT reproduce (full grid ${pcLimc.fullGrid}, stats ${pcLimc.statText}) — `
      + "the character limited branch cannot be shown to be load-bearing");
  }

  /* --- Alice: the Print button follows LIVE ownership (review #22) ------------ */

  console.log("\n2c. Print follows a promote/demote under the OPEN sheet");
  const printOpen = await alice.evaluate(async (id) => {
    const sheet = game.actors.get(id).sheet;
    await sheet.render(true);
    for (let i = 0; i < 40 && !sheet.element; i++) await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, 400));
    const btn = sheet.element?.querySelector('.window-header button[data-action="printSheet"]');
    return { built: !!btn, visible: !!btn && !btn.classList.contains("cairn-header-hidden") };
  }, pcId);
  printOpen.built && !printOpen.visible
    ? ok("at LIMITED the Print button is BUILT but hidden — the frame can only build once")
    : fail(`at LIMITED: built ${printOpen.built}, visible ${printOpen.visible}`);

  const pollPrint = (want) => alice.evaluate(async ({ id, want }) => {
    const sheet = game.actors.get(id).sheet;
    for (let i = 0; i < 60; i++) {
      const btn = sheet.element?.querySelector('.window-header button[data-action="printSheet"]');
      const visible = !!btn && !btn.classList.contains("cairn-header-hidden");
      if (visible === want.visible
        && !!sheet.element?.querySelector(".charater-sheet-grid") === want.fullGrid) {
        return { visible, fullGrid: want.fullGrid, ok: true };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const btn = sheet.element?.querySelector('.window-header button[data-action="printSheet"]');
    return {
      visible: !!btn && !btn.classList.contains("cairn-header-hidden"),
      fullGrid: !!sheet.element?.querySelector(".charater-sheet-grid"),
      ok: false,
    };
  }, { id: pcId, want });

  await gm.evaluate(async ({ id, aliceId }) => {
    await game.actors.get(id).update({ [`ownership.${aliceId}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
  }, { id: pcId, aliceId: setup.aliceId });
  const promoted = await pollPrint({ visible: true, fullGrid: true });
  promoted.ok
    ? ok("promoted to OWNER: the open sheet re-renders full and the Print button appears")
    : fail(`after promote: print visible ${promoted.visible}, full grid ${promoted.fullGrid}`);

  await gm.evaluate(async ({ id, aliceId }) => {
    await game.actors.get(id).update({ [`ownership.${aliceId}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED });
  }, { id: pcId, aliceId: setup.aliceId });
  const demoted = await pollPrint({ visible: false, fullGrid: false });
  demoted.ok
    ? ok("demoted to LIMITED: the sheet walls itself and the Print button hides — no reopen needed")
    : fail(`after demote: print visible ${demoted.visible}, full grid ${demoted.fullGrid}`);
  await alice.evaluate(async (id) => { await game.actors.get(id).sheet.close(); }, pcId);

  /* --- Alice: an OWNED hireling shows her no dice ----------------------------- */

  const hireAs = (control) => alice.evaluate(async ({ id, control }) => {
    const actor = game.actors.get(id);
    if (!actor?.isOwner) return { error: "Alice does not own the test hireling" };
    const sheet = actor.sheet;

    // NEGATIVE CONTROL: the old _mayRandomize body verbatim — isGM || setting.
    // The setting is ON, so under it Alice's dice come back; the npc-type
    // refusal above it is the whole fix.
    const proto = Object.getPrototypeOf(sheet);
    const orig = proto._mayRandomize;
    if (control) {
      proto._mayRandomize = function () {
        return game.user.isGM || game.settings.get("air-bladder", "allow-player-randomization");
      };
    }
    try {
      await sheet.render(true);
      for (let i = 0; i < 40 && !sheet.element; i++) await new Promise((r) => setTimeout(r, 150));
      await new Promise((r) => setTimeout(r, 400));
      const root = sheet.element;
      const visible = (sel) => {
        const el = root?.querySelector(sel);
        return !!el && !el.classList.contains("cairn-header-hidden");
      };
      const res = {
        flagOn: actor.system.generationEnabled === true,
        genDice: !!root?.querySelector(
          '[data-action="rollProfession"], [data-action="rollName"], [data-action="rollPortrait"], [data-action="rollFaction"]'),
        pickers: !!root?.querySelector('[data-action="pickProfession"], [data-action="pickFaction"]'),
        headerToggle: visible('.window-header button[data-action="toggleGeneration"]'),
        fullGrid: !!root?.querySelector(".charater-sheet-grid"),
      };
      // ENFORCEMENT, fix-live only: the wrapped action must refuse a call that
      // arrives without its control — the crafted-client case.
      if (!control) {
        const before = actor.system.profession;
        let warned = 0;
        const origWarn = ui.notifications.warn.bind(ui.notifications);
        ui.notifications.warn = (...a) => { warned += 1; return origWarn(...a); };
        try {
          await sheet.options.actions.rollProfession.call(
            sheet, new PointerEvent("click"), document.createElement("a"));
        } catch { /* a refusal may throw; the assertion is the non-write */ }
        ui.notifications.warn = origWarn;
        res.enforced = actor.system.profession === before;
        res.warned = warned;
      }
      await sheet.close();
      return res;
    } finally {
      if (control) proto._mayRandomize = orig;
    }
  }, { id: setup.hireId, control });

  console.log("\n3. Alice OWNS a hireling — and still gets no dice");
  const own = await hireAs(false);
  if (own.error) fail(`owned-hireling leg: ${own.error}`);
  else {
    if (!own.flagOn) fail("the hireling's own Randomization toggle is not on — the leg tests the wrong gate");
    if (own.fullGrid && !own.genDice && !own.pickers && !own.headerToggle) {
      ok("full sheet, zero generation surface — no dice, no pickers, no header toggle");
    } else {
      fail(`surface leaked: dice ${own.genDice}, pickers ${own.pickers}, headerToggle ${own.headerToggle}`);
    }
    if (own.enforced) ok(`and a direct action call is refused (profession unchanged, ${own.warned} warning)`);
    else fail("a direct rollProfession call CHANGED the hireling — affordance without enforcement");
  }

  console.log("   negative control: the pre-fix _mayRandomize restored");
  const ownc = await hireAs(true);
  if (ownc.error) fail(`owned-hireling control: ${ownc.error}`);
  else if (ownc.genDice) ok("reproduced — with isGM||setting, Alice's dice come back");
  else fail("the control did NOT bring the dice back — the npc-type gate cannot be shown to be load-bearing");

  await alice.context().close();

  /* --- GM: the pickers -------------------------------------------------------- */

  const pick = await gm.evaluate(async ({ npcId, hireId }) => {
    const cg = game.cairn.characterGenerator;
    const out = {};

    // Affordance: Randomization OFF removes the pickers WITH the dice
    // (2026-08-21 pm, reversing that morning's survive-the-toggle ruling).
    const hire = game.actors.get(hireId);
    await hire.update({ "system.generationEnabled": false });
    await hire.sheet.render(true);
    for (let i = 0; i < 40 && !hire.sheet.element; i++) await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, 300));
    let root = hire.sheet.element;
    out.hireOff = {
      die: !!root?.querySelector('[data-action="rollProfession"]:not(.profession-pick)'),
      pick: !!root?.querySelector('[data-action="pickProfession"]'),
      factionPick: !!root?.querySelector('[data-action="pickFaction"]'),
    };
    await hire.update({ "system.generationEnabled": true });
    await new Promise((r) => setTimeout(r, 300));
    root = hire.sheet.element;
    out.hireOn = {
      die: !!root?.querySelector('[data-action="rollProfession"]:not(.profession-pick)'),
      pick: !!root?.querySelector('[data-action="pickProfession"]'),
    };
    await hire.sheet.close();

    // Apply: a picked career is adopted whole.
    const before = { prof: hire.system.profession, hp: hire.system.hp?.max };
    const target = (await cg.getNpcCareers2e()).find((c) => c.name !== before.prof);
    await cg.pickHirelingCareer(hire, target.name);
    out.career = {
      picked: target.name, landed: hire.system.profession,
      rate: hire.system.dayRate === (target.rate ?? 0),
      hp: hire.system.hp?.max === target.hp,
      gear: hire.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "profession").length,
      gearWant: (target.gear ?? []).length,
      // The arrangement holds after a pick: rations last, weapons (if any) first.
      lastIsRations: /rations?/i.test([...hire.items.contents]
        .filter((i) => !i.system?.bound)
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).at(-1)?.name ?? ""),
    };

    // Apply: a picked Background swaps the trade's gear — and since 2026-08-21
    // (user ruling, reversing the same day's generation-only scoping) a picked
    // Politician UNPACKS the kit too: the NPC ends up holding what generating
    // that Background grants, which is nothing.
    const npc = game.actors.get(npcId);
    await cg.pickNpcBackground(npc, "Blacksmith");
    out.bg = {
      landed: npc.system.background,
      granted: npc.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "background").length,
      // After a geared pick a kit is GUARANTEED — kept if it survived birth,
      // repacked if the npc was born Lord/Politician — which frees this pass
      // from the 2-in-20 birth race the old before-the-pick capture carried.
      kitCount: npc.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "npc-kit").length,
    };
    await cg.pickNpcBackground(npc, "Politician");
    out.bg.politician = npc.system.background;
    out.bg.politicianGranted = npc.items
      .filter((i) => i.getFlag("air-bladder", "grantSource") === "background").length;
    out.bg.kitAfter = npc.items
      .filter((i) => i.getFlag("air-bladder", "grantSource") === "npc-kit").length;
    return out;
  }, { npcId: setup.npcId, hireId: setup.hireId });

  console.log("\n4. the Warden's pickers");
  const HO = pick.hireOff ?? {};
  if (!HO.die && !HO.pick && !HO.factionPick) {
    ok("Randomization OFF: the pickers go WITH the die (2026-08-21 reversal)");
  } else {
    fail(`with the toggle off: die ${HO.die}, careerPick ${HO.pick}, factionPick ${HO.factionPick}`);
  }
  if (pick.hireOn?.die && pick.hireOn?.pick) ok("Randomization ON: die and picker side by side, the PC shape");
  else fail(`with the toggle on: die ${pick.hireOn?.die}, pick ${pick.hireOn?.pick}`);

  const C = pick.career ?? {};
  if (C.landed === C.picked && C.rate && C.hp && C.gear === C.gearWant) {
    ok(`a picked career is adopted whole (${C.picked}: rate, statblock, ${C.gear} item(s))`);
  } else {
    fail(`career pick: landed "${C.landed}" want "${C.picked}", rate ${C.rate}, hp ${C.hp}, `
      + `gear ${C.gear}/${C.gearWant}`);
  }
  if (C.lastIsRations) ok("and the pack is re-arranged — Rations back at the bottom");
  else fail("after a career pick the last row is not Rations — the arrangement did not run");

  const BG = pick.bg ?? {};
  if (BG.landed === "Blacksmith" && BG.granted > 0) ok(`a picked Background grants its gear (${BG.granted} item(s))`);
  else fail(`background pick: landed "${BG.landed}", granted ${BG.granted}`);
  if (BG.politician === "Politician" && BG.politicianGranted === 0
    && BG.kitCount === 5 && BG.kitAfter === 0) {
    ok("picked onto Politician: no new gear, and the kit is UNPACKED (2026-08-21)");
  } else {
    fail(`Politician pick: landed "${BG.politician}", granted ${BG.politicianGranted}, `
      + `kit ${BG.kitCount} -> ${BG.kitAfter}`);
  }
} finally {
  await restore();
}

const errors = [...gmErrors, ...aliceErrors];
if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "NPC LIMITED-VIEW PROBE FAILED" : "NPC limited-view probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

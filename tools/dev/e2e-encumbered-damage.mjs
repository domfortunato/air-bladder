#!/usr/bin/env node
/**
 * The damage flow, end to end: the encumbered-HP data-loss bug, and the chat
 * card's Apply-damage button.
 *
 *   npm run dev:enc-damage        (dev world on :30000, which runs the working tree)
 *
 * _prepareCharacterData zeroes system.hp.value whenever an actor is encumbered or
 * panicked. Two code paths then read that DERIVED zero and persisted it:
 *
 *   1. damage.js applyToTarget — read hp, compute, actor.update(). With hp read as
 *      0 it wrote 0 back even when armor absorbed the hit entirely, destroying the
 *      stored Hit Protection with no message and no way to get it back.
 *   2. The sheet's _getSubmitData guard covered `character` but not `hireling`,
 *      though actor.js routes BOTH through _prepareCharacterData — and AppV1 sets
 *      submitOnClose, so closing the sheet was enough.
 *
 * Both assert on the SOURCE value (toObject()), never the derived one: reading
 * actor.system.hp.value here would report 0 in both the fixed and broken cases and
 * pass for the wrong reason.
 *
 *   2b-2d. Encumbrance follows the ROLE (2026-08-01, `livesByPlayerRules`): a
 *      loaded MOUNT keeps its HP and its input submits; a role-npc PERSON at
 *      capacity reads 0 with the stored value intact and the submit stripped —
 *      exactly a PC; a full CONTAINER neither reads 0 nor loses HP edits, which
 *      is the assertion that the re-key did not simply widen review #5's bug.
 *      Each leg carries an instance shadow of the getter as its fail-witness,
 *      in both directions, proving BOTH sites read the one getter.
 *
 *   3. The chat Apply-damage button — the one path into
 *      Damage.onClickChatMessageApplyButton, which nothing exercised before it
 *      was converted off the repo's last jQuery call. A card carrying two
 *      `;`-joined token ids in data-targets is clicked and both tokens' actors
 *      must lose HP. The click lands on the ICON inside the anchor, where a real
 *      pointer lands: the handler hangs off the anchor, so this is what keeps
 *      `event.currentTarget` (right) distinct from `event.target` (wrong) — a
 *      conversion that reaches for the wrong one goes red here, not in a user's
 *      game. The shift-click branch (toggle targeting) is not covered: it needs
 *      interactive canvas state and reads the same data-targets string.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(240000, "encumbered-damage probe");
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await joinAsGM(page);

const out = await page.evaluate(async () => {
  const NAME = "__encdmg__";
  const results = {};
  for (const a of game.actors.filter((a) => a.name.startsWith(NAME))) await a.delete();

  /** An actor of `type` at 4/6 HP, loaded until it is encumbered. */
  const makeEncumbered = async (type) => {
    const actor = await CONFIG.Actor.documentClass.create({
      name: `${NAME}-${type}`,
      type,
      system: { hp: { value: 4, max: 6 }, abilities: { STR: { value: 10, max: 10 } } },
    });
    // Bulky items are 2 slots each; 10 slots is the default limit.
    const bulky = Array.from({ length: 8 }, (_, i) => ({
      name: `Anvil ${i}`, type: "item", system: { bulky: true },
    }));
    await actor.createEmbeddedDocuments("Item", bulky);
    return actor;
  };

  /* 1. Damage while encumbered -------------------------------------------- */
  const pc = await makeEncumbered("character");
  results.encumbered = pc.system.encumbered === true;
  results.derivedIsZero = pc.system.hp.value === 0;      // data prep zeroed it
  results.sourceBefore = pc.toObject().system.hp.value;  // ...but source holds 4

  // Drive the real damage path. It needs a token, so place one on any scene.
  let scene = game.scenes.contents[0];
  if (!scene) scene = await Scene.create({ name: `${NAME}-scene`, width: 1000, height: 1000 });
  const [tokenDoc] = await scene.createEmbeddedDocuments("Token", [
    await pc.getTokenDocument({ x: 100, y: 100 }),
  ]);
  const { Damage } = await import("/systems/air-bladder/module/damage.js");
  const prev = canvas.scene;
  if (canvas.scene?.id !== scene.id) await scene.view();

  // Damage 1 against armor 0 — a real hit, so HP must drop by 1 from the STORED 4.
  await Damage.applyToTarget(tokenDoc.id, 1);
  results.sourceAfterHit = pc.toObject().system.hp.value;
  results.strAfterHit = pc.toObject().system.abilities.STR.value;

  await tokenDoc.delete();
  if (prev && prev.id !== scene.id) await prev.view();

  /* 2. Hireling sheet submit ----------------------------------------------- */
  const hire = await makeEncumbered("hireling");
  results.hirelingSourceBefore = hire.toObject().system.hp.value;
  const sheet = hire.sheet;
  await sheet.render(true);
  await new Promise((r) => setTimeout(r, 900));

  // What the sheet would actually submit, derived-zero and all. The guard moved
  // from AppV1's `_getSubmitData(updateData)` to ApplicationV2's
  // `_processFormData(event, form, formData)`, which receives the extracted form
  // data rather than reading the DOM itself.
  const form = sheet.element instanceof HTMLElement ? sheet.element : sheet.element[0];
  const formData = new foundry.applications.ux.FormDataExtended(form);
  const submitted = sheet._processFormData(null, form, formData);
  results.submitKeepsHp =
    "system.hp.value" in submitted ||
    submitted?.system?.hp?.value !== undefined;

  // Then the real path. This used to close the sheet, because AppV1 submitted on
  // close — ApplicationV2 has no submitOnClose at all, so that gesture now writes
  // nothing and would pass whether the guard worked or not. Editing a field is
  // what submits now (submitOnChange), so drive that instead.
  const nameInput = form.querySelector('input[name="name"]');
  nameInput.value = `${NAME}-hireling-renamed`;
  nameInput.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  results.hirelingRenamed = hire.name === `${NAME}-hireling-renamed`;
  await sheet.close();
  await new Promise((r) => setTimeout(r, 500));
  results.hirelingSourceAfter = hire.toObject().system.hp.value;

  /* 2b. Encumbrance follows the ROLE (2026-08-01) --------------------------- */
  // The exemption used to be the TYPE — `type !== "npc"` — added for a
  // container at exactly its capacity, which is its NORMAL state, not an
  // injury (review #5). That reasoning is right for a crate and wrong for a
  // person, so the rule is keyed on `livesByPlayerRules` now (character type,
  // or role npc): a full innkeeper zeroes like a PC; monster, mount, transport
  // and container keep the exemption. Both sites — the derived zero in
  // _prepareCharacterData and the submit strip in _processFormData — read that
  // ONE getter, and the shadow controls below prove it of each site.
  //
  // A MOUNT carries the exemption leg — a creature role on purpose: a thing
  // role (transport or container) would hide the HP input the submit half of
  // this section needs; the thing case is 2d below.
  const mule = await CONFIG.Actor.documentClass.create({
    name: `${NAME}-mule`, type: "npc",
    system: { role: "mount", containerClass: "horse", hp: { value: 4, max: 6 }, slots: 2 },
  });
  await mule.createEmbeddedDocuments("Item", [{ name: "Anvil", type: "item", system: { bulky: true } }]);
  results.npcEncumbered = mule.system.encumbered === true;
  results.npcDerivedHp = mule.system.hp.value;             // must stay 4
  results.npcSourceHp = mule.toObject().system.hp.value;

  // ...and its HP input still submits: the strip guard must not fire on an npc
  // that is merely full, or a full mule's HP is un-editable for as long as it
  // stays full.
  const mSheet = mule.sheet;
  await mSheet.render(true);
  await new Promise((r) => setTimeout(r, 900));
  const mForm = mSheet.element instanceof HTMLElement ? mSheet.element : mSheet.element[0];
  const mFD = new foundry.applications.ux.FormDataExtended(mForm);
  const mSubmitted = mSheet._processFormData(null, mForm, mFD);
  results.npcSubmitKeepsHp =
    "system.hp.value" in mSubmitted || mSubmitted?.system?.hp?.value !== undefined;
  await mSheet.close();

  // NEGATIVE CONTROL, on the prototype: re-apply the old unconditional zeroing
  // after prepare and the same full mule must read 0 again — proof the role
  // gate is what the assertion above measures, not a mule that was never
  // really encumbered.
  const proto = CONFIG.Actor.documentClass.prototype;
  const origPrep = proto._prepareCharacterData;
  proto._prepareCharacterData = function (...args) {
    origPrep.apply(this, args);
    if (this.system.encumbered) this.system.hp.value = 0;  // the pre-fix line
  };
  mule.prepareData();
  results.npcControlZeroed = mule.system.hp.value === 0;
  proto._prepareCharacterData = origPrep;
  // reset() first: the control wrote its 0 into the DERIVED model, and the fixed
  // prepare never touches a mount's hp — so without rebuilding from source the
  // 0 lingers and the restore reads the control's own residue, not the fix.
  mule.reset();
  mule.prepareData();
  results.npcRestored = mule.system.hp.value === 4;

  /* 2c. A role-npc PERSON at capacity zeroes exactly like a PC -------------- */
  const person = await CONFIG.Actor.documentClass.create({
    name: `${NAME}-person`, type: "npc",
    system: { role: "npc", generationEnabled: false, hp: { value: 4, max: 6 }, slots: 2 },
  });
  await person.createEmbeddedDocuments("Item", [{ name: "Anvil", type: "item", system: { bulky: true } }]);
  results.personEncumbered = person.system.encumbered === true;
  results.personDerivedHp = person.system.hp.value;            // must read 0
  results.personSourceHp = person.toObject().system.hp.value;  // stored 4 intact

  // ...and the strip guard fires for a person, so the derived 0 never
  // persists: the extracted submit must carry no hp, and a REAL submit (a
  // rename) must leave the stored 4 alone.
  const pSheet = person.sheet;
  await pSheet.render(true);
  await new Promise((r) => setTimeout(r, 900));
  let pForm = pSheet.element instanceof HTMLElement ? pSheet.element : pSheet.element[0];
  const pSubmitted = pSheet._processFormData(null, pForm, new foundry.applications.ux.FormDataExtended(pForm));
  results.personSubmitStripsHp = pSubmitted?.system?.hp?.value === undefined
    && !("system.hp.value" in pSubmitted);
  const pName = pForm.querySelector('input[name="name"]');
  pName.value = `${NAME}-person-renamed`;
  pName.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  results.personRenamed = person.name === `${NAME}-person-renamed`;
  results.personSourceAfter = person.toObject().system.hp.value;

  // FAIL-WITNESS, both sites off one shadow: `livesByPlayerRules` forced false
  // on the instance (the pre-fix answer for any npc) and the person must stop
  // zeroing — proof the getter is what the derived zero reads — and the strip
  // must stop firing, proof the guard reads the SAME getter. That shared read
  // is the whole point of the re-key: the two sites cannot drift.
  Object.defineProperty(person, "livesByPlayerRules", { value: false, configurable: true });
  person.reset();
  person.prepareData();
  results.personControlKeptHp = person.system.hp.value === 4;
  pForm = pSheet.element instanceof HTMLElement ? pSheet.element : pSheet.element[0];
  const pSubmitted2 = pSheet._processFormData(null, pForm, new foundry.applications.ux.FormDataExtended(pForm));
  results.personControlSubmitKeepsHp = pSubmitted2?.system?.hp?.value !== undefined;
  delete person.livesByPlayerRules;
  person.reset();
  person.prepareData();
  results.personRestoredZero = person.system.hp.value === 0;
  await pSheet.close();

  /* 2d. A container-role npc at capacity: no zero, HP still editable -------- */
  // The assertion that proves the re-key did not simply WIDEN the old bug: a
  // full crate must neither read 0 nor have its HP edits stripped.
  const crate = await CONFIG.Actor.documentClass.create({
    name: `${NAME}-crate`, type: "npc",
    system: { role: "container", containerClass: "crate", generationEnabled: false, hp: { value: 4, max: 6 }, slots: 2 },
  });
  await crate.createEmbeddedDocuments("Item", [{ name: "Anvil", type: "item", system: { bulky: true } }]);
  results.crateEncumbered = crate.system.encumbered === true;
  results.crateDerivedHp = crate.system.hp.value;              // must stay 4

  // A thing's sheet hides the HP input, so a real form can never carry one —
  // the guard is interrogated with a synthetic payload instead (core's
  // _processFormData is expandObject(formData.object), document-sheet.mjs:508).
  // If derivedZero misfired on a full crate this value would be stripped, and
  // the field would be un-editable exactly the way review #5 recorded.
  const cSheet = crate.sheet;
  await cSheet.render(true);
  await new Promise((r) => setTimeout(r, 900));
  const cForm = cSheet.element instanceof HTMLElement ? cSheet.element : cSheet.element[0];
  results.crateNoHpInput = !cForm.querySelector('input[name="system.hp.value"]');
  const cSubmitted = cSheet._processFormData(null, cForm, { object: { "system.hp.value": 5 } });
  results.crateSubmitKeepsHp = cSubmitted?.system?.hp?.value === 5;
  // ...and the document write path takes an HP edit while full.
  await crate.update({ "system.hp.value": 5 });
  results.crateHpEditable = crate.toObject().system.hp.value === 5;

  // FAIL-WITNESS, the shadow the other way: a crate forced onto the player
  // rules must zero AND have the synthetic hp stripped — the two greens above
  // can fail, and through the same getter both sites read.
  Object.defineProperty(crate, "livesByPlayerRules", { value: true, configurable: true });
  crate.reset();
  crate.prepareData();
  results.crateControlZeroed = crate.system.hp.value === 0;
  const cSubmitted2 = cSheet._processFormData(null, cForm, { object: { "system.hp.value": 7 } });
  results.crateControlStripped = cSubmitted2?.system?.hp?.value === undefined;
  delete crate.livesByPlayerRules;
  crate.reset();
  crate.prepareData();
  results.crateRestored = crate.system.hp.value === 5;   // DERIVED, not source
  await cSheet.close();

  /* 3. The chat Apply-damage button ---------------------------------------- */
  // Chat litter from this section (the card itself plus the per-target detail
  // messages _showDetails posts) is swept by id-diff at the end.
  const msgsBefore = new Set(game.messages.map((m) => m.id));
  const until = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return fn();
  };

  const mkVictim = (n) => CONFIG.Actor.documentClass.create({
    name: `${NAME}-victim-${n}`, type: "character",
    system: { hp: { value: 4, max: 6 }, abilities: { STR: { value: 10, max: 10 } } },
  });
  const v1 = await mkVictim(1);
  const v2 = await mkVictim(2);
  let scene3 = game.scenes.getName(`${NAME}-scene`);
  if (!scene3) scene3 = await Scene.create({ name: `${NAME}-scene`, width: 1000, height: 1000 });
  const [t1] = await scene3.createEmbeddedDocuments("Token", [await v1.getTokenDocument({ x: 200, y: 200 })]);
  const [t2] = await scene3.createEmbeddedDocuments("Token", [await v2.getTokenDocument({ x: 300, y: 300 })]);
  const prev3 = canvas.scene;
  if (canvas.scene?.id !== scene3.id) await scene3.view();

  // The card, produced the way both real producers do (the sheet's damage roll
  // and macros.js): render the template with `;`-joined ids, ship it as roll
  // flavor. A dieless formula, so the total the handler reads out of
  // .dice-total is a known 2 rather than a parsed random d6.
  const { evaluateFormula } = await import("/systems/air-bladder/module/utils.js");
  const postCard = async () => {
    const roll = await evaluateFormula("2", {});
    const flavor = await foundry.applications.handlebars.renderTemplate(
      "systems/air-bladder/templates/chat/dmg-roll-card.html",
      { label: "probe damage", targets: [t1.id, t2.id].join(";") },
    );
    const msg = await roll.toMessage({ speaker: ChatMessage.getSpeaker(), flavor });
    await until(() => document.querySelector(`[data-message-id="${msg.id}"] .apply-dmg i`));
    return msg;
  };
  const hp = () => [v1.toObject().system.hp.value, v2.toObject().system.hp.value].join(",");

  const msg = await postCard();
  results.applyButtonRendered = !!document.querySelector(`[data-message-id="${msg.id}"] .apply-dmg i`);
  results.hpBeforeClick = hp();
  document.querySelector(`[data-message-id="${msg.id}"] .apply-dmg i`)?.click();
  results.applyLanded = await until(() => hp() === "2,2");
  results.hpAfterClick = hp();

  // Control: the same card with its handler unwired must change nothing — the
  // proof that click-plus-assert can fail, rather than passing on a button
  // that was never bound. The wait mirrors the positive path's poll budget in
  // miniature; there is nothing to poll FOR when asserting absence.
  const msg2 = await postCard();
  const deadBtn = document.querySelector(`[data-message-id="${msg2.id}"] .apply-dmg`);
  if (deadBtn) deadBtn.onclick = null;
  deadBtn?.querySelector("i")?.click();
  await new Promise((r) => setTimeout(r, 2000));
  results.deadButtonInert = hp() === results.hpAfterClick;

  for (const m of game.messages.filter((m) => !msgsBefore.has(m.id))) await m.delete();
  await t1.delete();
  await t2.delete();
  if (prev3 && prev3.id !== scene3.id) await prev3.view();

  for (const a of game.actors.filter((a) => a.name.startsWith(NAME))) await a.delete();
  const s = game.scenes.getName(`${NAME}-scene`);
  if (s) await s.delete();
  return results;
});
await browser.close();

let bad = 0;
const check = (label, ok, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(20)} ${detail}`);
};

console.log("setup");
check("encumbered", out.encumbered, `system.encumbered=${out.encumbered}`);
check("derived HP is 0", out.derivedIsZero, "data prep zeroed the derived value");
check("source HP is 4", out.sourceBefore === 4, `source=${out.sourceBefore}`);

console.log("\ndamage while encumbered");
check("stored HP survives", out.sourceAfterHit === 3,
  `source=${out.sourceAfterHit} (expected 3: stored 4 minus 1 damage)`);
check("STR untouched", out.strAfterHit === 10,
  `STR=${out.strAfterHit} (a 1-point hit must not overflow past stored HP)`);

console.log("\nhireling sheet submit");
check("guard strips HP", !out.submitKeepsHp, "system.hp.value removed from submit data");
// The rename proves the submit actually HAPPENED. Without it, "stored HP survives"
// passes trivially on a sheet that never wrote anything at all.
check("a real submit ran", out.hirelingRenamed, "editing the name field committed");
check("stored HP survives", out.hirelingSourceAfter === 4,
  `source=${out.hirelingSourceAfter} (expected 4: a submit must not persist the derived 0)`);

console.log("\na mount at capacity (a loaded mule is not a dying creature)");
check("mount encumbered", out.npcEncumbered, "a bulky item fills its 2 slots exactly");
check("mount HP NOT zeroed", out.npcDerivedHp === 4,
  `derived=${out.npcDerivedHp}, source=${out.npcSourceHp} (a full mule keeps its HP; the player rule stops at role npc)`);
check("mount HP input submits", out.npcSubmitKeepsHp,
  "the strip guard does not fire on a merely-full mount — its HP stays editable");
check("negative control", out.npcControlZeroed && out.npcRestored,
  `old zeroing on the prototype reproduces the 0 (${out.npcControlZeroed}) and restores (${out.npcRestored})`);

console.log("\na role-npc PERSON at capacity lives by the player rules");
check("person encumbered", out.personEncumbered, "a bulky item fills its 2 slots exactly");
check("person reads HP 0", out.personDerivedHp === 0 && out.personSourceHp === 4,
  `derived=${out.personDerivedHp}, source=${out.personSourceHp} (an overloaded innkeeper zeroes like a PC; the stored value survives)`);
check("guard strips person HP", out.personSubmitStripsHp,
  "system.hp.value removed from the person's submit — the derived 0 cannot persist");
check("a real submit ran", out.personRenamed, "editing the name field committed");
check("stored HP survives it", out.personSourceAfter === 4,
  `source=${out.personSourceAfter} (expected 4 after a real submit)`);
check("witness: both sites, one shadow",
  out.personControlKeptHp && out.personControlSubmitKeepsHp && out.personRestoredZero,
  `livesByPlayerRules shadowed false: no zero (${out.personControlKeptHp}), no strip (${out.personControlSubmitKeepsHp}); restored (${out.personRestoredZero}) — both sites read the ONE getter`);

console.log("\na container-role npc at capacity (the re-key must not widen the old bug)");
check("crate encumbered", out.crateEncumbered, "a bulky item fills its 2 slots exactly");
check("crate HP NOT zeroed", out.crateDerivedHp === 4,
  `derived=${out.crateDerivedHp} (a full crate is in its normal state)`);
check("no HP input on a thing", out.crateNoHpInput,
  "the thing sheet hides the stat block, so the guard is interrogated synthetically");
check("guard passes crate HP", out.crateSubmitKeepsHp,
  "a synthetic system.hp.value survives _processFormData on a full crate");
check("crate HP editable", out.crateHpEditable,
  "an update while full lands (review #5's un-editable trap stays closed)");
check("witness: shadow the other way",
  out.crateControlZeroed && out.crateControlStripped && out.crateRestored,
  `livesByPlayerRules shadowed true: zeroed (${out.crateControlZeroed}), stripped (${out.crateControlStripped}); restored (${out.crateRestored})`);

console.log("\nthe chat Apply-damage button");
check("card + button render", out.applyButtonRendered, "damage card in the log with .apply-dmg");
check("HP intact pre-click", out.hpBeforeClick === "4,4",
  `hp=${out.hpBeforeClick} (posting the card alone must change nothing)`);
check("icon click applies", out.applyLanded && out.hpAfterClick === "2,2",
  `hp=${out.hpAfterClick} (expected 2,2 — the rolled 2 applied to BOTH ids split from data-targets, via a click on the icon inside the anchor)`);
check("dead button inert", out.deadButtonInert,
  "an unwired button's click changed nothing — the assertion above can fail");

if (errors.length) { bad++; console.log("Console errors:\n" + errors.join("\n")); }
console.log(bad === 0 ? "\nencumbered-damage e2e passed" : `\nencumbered-damage e2e FAILED — ${bad}`);
process.exit(bad === 0 ? 0 : 1);

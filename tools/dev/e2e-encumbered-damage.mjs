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

  /* 2b. An npc at capacity keeps its HP ------------------------------------ */
  // A container is an NPC with `slots` (+ `connectedTo`), and holding exactly
  // its capacity is a container's NORMAL state — the character rule
  // ("encumbered zeroes HP") must not reach it. It did (review #5): folding
  // containers into npc put a full mule on the character path, where its sheet
  // and token bar read 0 HP, and the submit strip made the phantom
  // uncorrectable. A creature role on purpose: a thing role (transport or
  // container) would hide the HP input the submit half of this section needs.
  const mule = await CONFIG.Actor.documentClass.create({
    name: `${NAME}-mule`, type: "npc",
    system: { hp: { value: 4, max: 6 }, slots: 2 },
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

  // NEGATIVE CONTROL, on the prototype: re-apply the old zeroing after prepare
  // and the same full mule must read 0 again — proof the type gate is what the
  // assertion above measures, not a mule that was never really encumbered.
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
  // prepare never touches an npc's hp — so without rebuilding from source the
  // 0 lingers and the restore reads the control's own residue, not the fix.
  mule.reset();
  mule.prepareData();
  results.npcRestored = mule.system.hp.value === 4;

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

console.log("\nnpc at capacity (a full container is not a dying creature)");
check("npc encumbered", out.npcEncumbered, "a bulky item fills its 2 slots exactly");
check("npc HP NOT zeroed", out.npcDerivedHp === 4,
  `derived=${out.npcDerivedHp}, source=${out.npcSourceHp} (a full mule keeps its HP; the character rule stops at npc)`);
check("npc HP input submits", out.npcSubmitKeepsHp,
  "the strip guard does not fire on a merely-full npc — its HP stays editable");
check("negative control", out.npcControlZeroed && out.npcRestored,
  `old zeroing on the prototype reproduces the 0 (${out.npcControlZeroed}) and restores (${out.npcRestored})`);

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

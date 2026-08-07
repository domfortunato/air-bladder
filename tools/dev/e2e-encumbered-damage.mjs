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
 *
 *   3b-3c. The card is pinned to the scene it was ROLLED on, not the one being
 *      looked at. `canvas.scene` is the viewer's, so a party that moved on left
 *      every id missing and the button applying nothing — with no message, since
 *      a miss posts no damage card and no card looks exactly like "armor
 *      absorbed it". 3b views a second scene, forces the log to re-render (the
 *      rebind is where the failure was permanent) and clicks. 3c mixes a live id
 *      with a dead one and asserts the survivor is damaged AND the miss is
 *      reported.
 *
 *   4. Fatigue is never refused (2026-08-05 ruling). A full pack does not stop a
 *      spell being cast, so Fatigue lands and the character goes over capacity;
 *      they clear it by dropping something, which is their choice to make. The
 *      character is built to EXACTLY the limit, never over it, or "used exceeds
 *      max" would already be true before the click. It refused in TWO places —
 *      the button's guard and createOwnedItem's behind it — so this clicks the
 *      real button: removing either guard alone leaves the button refusing while
 *      every unit-level assertion passes. The same section pins the BOUNDARY the
 *      ruling draws, which is the part most likely to erode — an unflagged
 *      create on the same full character must still be refused (overflow is owed
 *      to Fatigue and to what generation grants, not to ordinary acquisition),
 *      and a direct grant of three more items must land whole.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

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
  const postCard = async (targets = [t1.id, t2.id], speakerToken = null) => {
    const roll = await evaluateFormula("2", {});
    const flavor = await foundry.applications.handlebars.renderTemplate(
      "systems/air-bladder/templates/chat/dmg-roll-card.html",
      { label: "probe damage", targets: targets.join(";") },
    );
    // A token speaker records `scene: token.parent.id` (chat-message.mjs:271),
    // which is what pins the card to the scene the roll happened on.
    const speaker = speakerToken
      ? ChatMessage.getSpeaker({ token: speakerToken })
      : ChatMessage.getSpeaker();
    const msg = await roll.toMessage({ speaker, flavor });
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

  /* 3b. A card outlives the scene it was rolled on -------------------------- */
  // data-targets holds token ids belonging to the ROLL's scene. The handler read
  // `canvas.scene` — the VIEWER's — so the moment the party moved on, every id
  // missed and the button applied nothing, permanently and with no message: a
  // miss posts no card, and no card is indistinguishable from "armor absorbed
  // it". The sibling STR-save button was fixed for this; this one was not.
  const sceneB = await Scene.create({ name: `${NAME}-scene-b`, width: 1000, height: 1000 });
  const msg3 = await postCard([t1.id, t2.id], t1);
  await sceneB.view();
  await until(() => canvas.scene?.id === sceneB.id);
  results.viewingOtherScene = canvas.scene?.id === sceneB.id;
  // Re-render the log so the button is bound AGAIN under the new scene. Without
  // this the leg would only prove the closure captured the right scene once; the
  // recorded failure is that the re-render rebinds against the wrong one.
  await ui.chat.render({ force: true });
  await until(() => document.querySelector(`[data-message-id="${msg3.id}"] .apply-dmg i`));
  results.crossSceneButton = !!document.querySelector(`[data-message-id="${msg3.id}"] .apply-dmg i`);
  const hpBeforeCross = hp();
  document.querySelector(`[data-message-id="${msg3.id}"] .apply-dmg i`)?.click();
  results.crossSceneLanded = await until(() => hp() === "0,0");
  results.hpAfterCross = `${hpBeforeCross} -> ${hp()}`;

  await scene3.view();
  await until(() => canvas.scene?.id === scene3.id);

  /* 3c. A target that is GONE must say so ----------------------------------- */
  // A killed foe leaves its id on every card it appeared on. Applying to a mixed
  // batch must still damage the survivors AND tell the Warden the rest missed.
  const v3 = await mkVictim(3);
  const [t3] = await scene3.createEmbeddedDocuments("Token", [await v3.getTokenDocument({ x: 400, y: 400 })]);
  const warns = [];
  const origWarn = ui.notifications.warn;
  ui.notifications.warn = function (m, ...rest) { warns.push(String(m)); return origWarn.call(this, m, ...rest); };
  const msg4 = await postCard([t3.id, "zzzzzzzzzzzzzzzz"], t3);
  document.querySelector(`[data-message-id="${msg4.id}"] .apply-dmg i`)?.click();
  results.mixedSurvivorHit = await until(() => v3.toObject().system.hp.value === 2);
  results.mixedWarned = await until(() => warns.length > 0);
  results.missWarning = warns[0] ?? "(none)";
  ui.notifications.warn = origWarn;

  /* 4. Fatigue is never refused at a full pack ------------------------------ */
  // Fatigue is a cost the rules impose, not a purchase: a full pack does not stop
  // a spell being cast, so it lands and the character goes over. The CLICK is
  // what is measured, because this used to refuse TWICE — the button's own guard
  // and createOwnedItem's behind it — and removing either alone leaves the button
  // refusing while every unit-level assertion goes green.
  const fat = await CONFIG.Actor.documentClass.create({
    name: `${NAME}-fatigue`, type: "character",
    system: { hp: { value: 4, max: 6 }, abilities: { STR: { value: 10, max: 10 } } },
  });
  // EXACTLY at the limit — ten one-slot items, so no free slot and nothing yet
  // over the line. makeEncumbered's eight bulky items would start at 16/10, and
  // "used exceeds max" would then be true BEFORE the click and prove nothing.
  await fat.createEmbeddedDocuments("Item", Array.from({ length: 10 }, (_, i) => ({
    name: `Rock ${i}`, type: "item",
  })));
  const fatCount = () => fat.items.filter((i) => i.name === "Fatigue").length;
  results.fatEncumberedBefore = fat.system.encumbered === true;
  results.fatSlotsBefore = `${fat.system.slotsUsed}/${fat.system.slotsMax}`;

  const fSheet = fat.sheet;
  await fSheet.render(true);
  await new Promise((r) => setTimeout(r, 900));
  const fForm = () => (fSheet.element instanceof HTMLElement ? fSheet.element : fSheet.element[0]);
  const addBtn = () => fForm().querySelector('[data-action="addFatigue"]');
  results.fatButtonPresent = !!addBtn();

  addBtn()?.click();
  results.fatFirstLanded = await until(() => fatCount() === 1);
  // Twice, because one click also passes on a path that allows a single Fatigue
  // and then blocks — which is the shape the old guard actually had.
  addBtn()?.click();
  results.fatSecondLanded = await until(() => fatCount() === 2);
  results.fatSlotsAfter = `${fat.system.slotsUsed}/${fat.system.slotsMax}`;
  results.fatOverCeiling = fat.system.slotsUsed > fat.system.slotsMax;
  results.fatStillEncumbered = fat.system.encumbered === true;

  // NEGATIVE CONTROL, in-page: reinstate the old refusal on the INSTANCE and the
  // same click must add nothing. The sheet's own guard is gone, so the method the
  // handler calls is what is left to defeat. Never by editing source — a control
  // that rewrites the thing under test is not a control.
  const origCreate = fat.createOwnedItem.bind(fat);
  fat.createOwnedItem = async function (itemData) {
    if (this.isEncumbered() && !itemData.weightless) return;   // the pre-fix line
    return origCreate(itemData);
  };
  const beforeControl = fatCount();
  addBtn()?.click();
  await new Promise((r) => setTimeout(r, 1500));
  results.fatControlBlocked = fatCount() === beforeControl;
  delete fat.createOwnedItem;
  addBtn()?.click();
  results.fatRestoredWorks = await until(() => fatCount() === beforeControl + 1);

  // THE BOUNDARY. Overflow is owed to Fatigue and to what generation grants —
  // not to ordinary acquisition. An unflagged create on the same full character
  // must still be turned away, or "never refused" has quietly widened into
  // "never refused for anything".
  const beforeRock = fat.items.size;
  await fat.createOwnedItem({ name: "Probe Boulder", type: "item" });
  await new Promise((r) => setTimeout(r, 600));
  results.ordinaryStillRefused = fat.items.size === beforeRock
    && !fat.items.find((i) => i.name === "Probe Boulder");

  // Part 1 of the rule: what generation and a background grant OWE a character
  // arrives whole even when it overflows. Those paths write with
  // createEmbeddedDocuments and never reach the guard, so what this pins is that
  // the actor model itself neither clamps nor drops — which is exactly what a
  // future capacity check in _preCreate would break, silently.
  const beforeGrant = fat.items.size;
  await fat.createEmbeddedDocuments("Item", [
    { name: "Granted A", type: "item" },
    { name: "Granted B", type: "item" },
    { name: "Granted C", type: "item", system: { bulky: true } },
  ]);
  results.grantAllLanded = fat.items.size === beforeGrant + 3;
  results.grantSlots = `${fat.system.slotsUsed}/${fat.system.slotsMax}`;
  await fSheet.close();

  for (const m of game.messages.filter((m) => !msgsBefore.has(m.id))) await m.delete();
  await t1.delete();
  await t2.delete();
  await t3.delete();
  if (prev3 && prev3.id !== scene3.id) await prev3.view();
  await sceneB.delete();

  for (const a of game.actors.filter((a) => a.name.startsWith(NAME))) await a.delete();
  const s = game.scenes.getName(`${NAME}-scene`);
  if (s) await s.delete();
  return results;
});

/* ---------------------------------------------------------------------------
 * The Scar card is posted in the SCARRED actor's name.
 *
 * RollTable#draw forwards only messageOptions to toMessage, never messageData
 * (roll-table.mjs:139), so the card fell through to toMessage's default speaker:
 * ChatMessage.getSpeaker() with no argument, which resolves to the VIEWER'S own
 * assigned character (roll-table.mjs:57). A monster scarred by a player's hit
 * therefore posted its scar under the PLAYER's name, over core's "Draws a result
 * from the Scars table" — reading as though the attacker had drawn a scar for
 * herself, when she had taken no damage and never touched the table.
 *
 * Gathered HERE, before the browser closes; asserted with the rest below.
 * ------------------------------------------------------------------------- */
const scar = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const r = {};
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const { Damage } = await import("/systems/air-bladder/module/damage.js");

  // Give the VIEWER a character, so the pre-fix speaker has something wrong to
  // be: with none assigned the default speaker is already blank and the leg
  // could pass without the fix.
  const mine = await ActorImpl.create({ name: "ZZ Scar Attacker", type: "character" });
  const prevChar = game.user.character;
  await game.user.update({ character: mine.id });

  // Exactly-to-zero is the Scar trigger: hp 3, armor 0, damage 3.
  const victim = await ActorImpl.create({
    name: "ZZ Scar Victim", type: "npc",
    system: { role: "monster", hp: { value: 3, max: 3 }, armor: 0 },
  });
  const scene = await Scene.create({ name: "ZZ Scar Scene", width: 1000, height: 1000 });
  const [tok] = await scene.createEmbeddedDocuments("Token", [await victim.getTokenDocument({ x: 100, y: 100 })]);

  const isTableCard = (m) => !!m.flags?.core?.RollTable;
  const before = new Set(game.messages.filter(isTableCard).map((m) => m.id));
  await Damage.applyToTargets([tok.id], 3, scene);
  // The damage flow deliberately does not await the draw, so poll for it.
  let card = null;
  for (let i = 0; i < 40 && !card; i++) {
    card = game.messages.filter(isTableCard).find((m) => !before.has(m.id)) ?? null;
    if (!card) await sleep(150);
  }
  r.posted = !!card;
  r.speakerToken = card?.speaker?.token ?? null;
  r.speakerActor = card?.speaker?.actor ?? null;
  r.flavor = card?.flavor ?? null;
  r.victimToken = tok.id;
  r.victimActor = victim.id;
  r.attackerActor = mine.id;
  r.coreDrawFlavor = game.i18n.format("TABLE.DrawFlavor", { number: 1, name: "Scars" });

  // The scar BANNER on the damage card itself.
  const dmgCard = game.messages.contents.slice().reverse()
    .find((m) => String(m.content ?? "").includes("cairn-scar-banner"));
  r.bannerPosted = !!dmgCard;
  if (dmgCard) {
    await sleep(300);
    const el = document.querySelector(`[data-message-id="${dmgCard.id}"] .cairn-scar-banner`);
    r.bannerRendered = !!el;
    if (el) {
      const cs = getComputedStyle(el);
      r.bannerCentered = cs.textAlign === "center";
      r.bannerBold = Number(cs.fontWeight) >= 700;
      r.bannerGlow = !!cs.textShadow && cs.textShadow !== "none";
    }
  }

  // The scar card carries NO dice block. The roll handed to draw() is a CONSTANT
  // (new Roll("3")), so forwarding it to toMessage rendered formula "3" and total
  // "3" — the damage number twice, under a damage card that had just given it.
  // BOTH ENDS: the dice block is gone AND the scar text survives, so "removed the
  // block" cannot pass as "removed the card".
  if (card) {
    await sleep(300);
    const row = document.querySelector(`[data-message-id="${card.id}"]`);
    r.scarRendered = !!row;
    r.scarDiceBlocks = row ? row.querySelectorAll(".dice-roll").length : null;
    r.scarResultText = row
      ? (row.querySelector(".table-results li")?.textContent ?? "").trim()
      : null;
  }

  // CONTROL, in-page: the pre-fix call — bare draw() with its own chat card, the
  // exact line this fix replaced. Its speaker must NOT be the victim; if it were,
  // the assertion above would not be measuring anything we changed. It is also
  // the control for the dice block: draw() forwards the roll, so this card MUST
  // show one — otherwise the table has displayRoll off and the leg above proves
  // nothing about our change.
  const { findCompendiumItem } = await import("/systems/air-bladder/module/compendium.js");
  const table = await findCompendiumItem("air-bladder.utils", "Scars");
  const beforeCtl = new Set(game.messages.filter(isTableCard).map((m) => m.id));
  await table.draw({ roll: new Roll("3") });
  let ctl = null;
  for (let i = 0; i < 40 && !ctl; i++) {
    ctl = game.messages.filter(isTableCard).find((m) => !beforeCtl.has(m.id)) ?? null;
    if (!ctl) await sleep(150);
  }
  r.controlSpeakerToken = ctl?.speaker?.token ?? null;
  if (ctl) {
    await sleep(300);
    const ctlRow = document.querySelector(`[data-message-id="${ctl.id}"]`);
    r.controlDiceBlocks = ctlRow ? ctlRow.querySelectorAll(".dice-roll").length : null;
  }

  // Chat body text: bigger than core's 14px. An inequality, not "15px" — the ask
  // was "up a point", and pinning the literal reds on any later tweak while
  // proving no more than this does.
  const anyContent = document.querySelector(".chat-message .message-content");
  r.contentPx = anyContent ? parseFloat(getComputedStyle(anyContent).fontSize) : null;

  // FLAVOR is a separate element in the message HEADER (chat-message.hbs:24), so
  // the .message-content rule above never touched it and every flavor line —
  // "Takes a scar!", "Rolling damage with Mace" — stayed at core's size. Measured
  // on the scar card's own flavor rather than any flavor in the log, so the leg
  // cannot pass on some other message's styling.
  if (card) {
    const flavorEl = document.querySelector(`[data-message-id="${card.id}"] .flavor-text`);
    r.flavorPx = flavorEl ? parseFloat(getComputedStyle(flavorEl).fontSize) : null;
    r.flavorShown = (flavorEl?.textContent ?? "").trim();
  }

  for (const id of [card?.id, ctl?.id, dmgCard?.id].filter(Boolean)) {
    await game.messages.get(id)?.delete();
  }
  await game.user.update({ character: prevChar?.id ?? null });
  await scene.delete();
  await victim.delete();
  await mine.delete();
  return r;
});

/* Apply damage is the WARDEN's. A GM can never see this by looking, so join. */
const warden = { ran: false };
try {
  const alicePage = await browser.newPage({ viewport: VIEWPORT });
  await joinAs(alicePage, "Alice");
  const posted = await page.evaluate(async () => {
    const { evaluateFormula } = await import("/systems/air-bladder/module/utils.js");
    const roll = await evaluateFormula("2", {});
    const flavor = await foundry.applications.handlebars.renderTemplate(
      "systems/air-bladder/templates/chat/dmg-roll-card.html",
      { label: "ZZ warden-only probe", targets: "nonexistent" },
    );
    return { id: (await roll.toMessage({ speaker: ChatMessage.getSpeaker(), flavor })).id };
  });
  // The GM's own copy, while the card is still in the log: the Apply control has
  // to DRAW. A Font Awesome class that does not exist in the shipped font renders
  // an empty box silently — no error, no missing element — so read the glyph's
  // ::before content rather than trusting the class name.
  Object.assign(warden, await page.evaluate(async ({ id }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let icon = null;
    for (let i = 0; i < 40 && !icon; i++) {
      icon = document.querySelector(`[data-message-id="${id}"] .apply-dmg i`);
      if (!icon) await sleep(150);
    }
    if (!icon) return { iconClass: null, iconGlyph: null, iconPx: null };
    const before = getComputedStyle(icon, "::before").content;
    const anchor = icon.closest(".apply-dmg");
    // The control reads in the FAILURE colour (user ask). Asserted as the two
    // computed colours being EQUAL, never against a literal rgb(206,7,7): the
    // ask is "the same as failures", so a literal would go red on core retuning
    // its own token — a change that is not a regression — and would stay green
    // if the failure rule moved off the token while this one did not.
    // The comparison element is planted, read and removed: a computed style is
    // being READ, nothing is written and no document is touched.
    const swatch = document.createElement("div");
    swatch.className = "dice-roll";
    swatch.innerHTML = '<h4 class="dice-total failure">0</h4>';
    document.querySelector(`[data-message-id="${id}"]`)?.appendChild(swatch);
    const failColor = getComputedStyle(swatch.querySelector(".dice-total")).color;
    swatch.remove();
    return {
      iconClass: icon.className,
      // "none" or '""' means the class matched no glyph in the font.
      iconGlyph: before && before !== "none" && before !== '""' ? before : null,
      iconPx: parseFloat(getComputedStyle(anchor).fontSize),
      applyColor: getComputedStyle(anchor).color,
      failColor,
    };
  }, posted));
  Object.assign(warden, await alicePage.evaluate(async ({ id }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let row = null;
    for (let i = 0; i < 40 && !row; i++) {
      row = document.querySelector(`[data-message-id="${id}"]`);
      if (!row) await sleep(150);
    }
    await sleep(500);
    return {
      ran: true,
      rowPresent: !!row,
      isGM: game.user.isGM,
      // The STORED card carries the anchor (one card is sent to everyone), so
      // the render hook is the only place a player's copy can be trimmed — and
      // this is what proves there was something to trim. It lives in FLAVOR, not
      // content: both real producers ship dmg-roll-card.html as the roll's
      // flavor (see postCard above), and reading `content` here reported "no
      // anchor" and quietly turned the leg below into a tautology.
      contentHasAnchor: ["flavor", "content"]
        .some((f) => String(game.messages.get(id)?.[f] ?? "").includes("apply-dmg")),
      anchorInDom: !!row?.querySelector(".apply-dmg"),
    };
  }, posted));
  await page.evaluate(async ({ id }) => { await game.messages.get(id)?.delete(); }, posted);
  await alicePage.close();
} catch (e) {
  warden.error = `${e.name}: ${e.message}`;
}

/* ---------------------------------------------------------------------------
 * Clicking Apply marks the card it was clicked on, and a second click applies
 * nothing.
 *
 * The control used to leave the tile exactly as it found it: three detail cards
 * appeared further down the log and the card that was clicked recorded nothing,
 * so a second click silently applied the whole roll again. Asserted on ACTOR HP,
 * not on the summary text — the text is the affordance, the HP is the hazard.
 * ------------------------------------------------------------------------- */
const applied = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};

  const foe = await ActorImpl.create({
    name: "ZZ Applied Foe", type: "npc",
    system: { role: "monster", hp: { value: 9, max: 9 }, armor: 0 },
  });
  const scene = await Scene.create({ name: "ZZ Applied Scene", width: 1000, height: 1000 });
  const [tok] = await scene.createEmbeddedDocuments("Token", [await foe.getTokenDocument({ x: 100, y: 100 })]);

  const { evaluateFormula } = await import("/systems/air-bladder/module/utils.js");
  const roll = await evaluateFormula("3", {});
  const flavor = await foundry.applications.handlebars.renderTemplate(
    "systems/air-bladder/templates/chat/dmg-roll-card.html",
    { label: "ZZ apply-once probe", targets: tok.id },
  );
  const msg = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: tok }), flavor });

  const btn = async () => {
    let b = null;
    for (let i = 0; i < 40 && !b; i++) {
      b = document.querySelector(`[data-message-id="${msg.id}"] .apply-dmg`);
      if (!b) await sleep(150);
    }
    return b;
  };
  // The TOKEN's actor, not `foe`. An npc token is unlinked, so damage lands on
  // the synthetic delta actor and `game.actors.get(foe.id)` never moves — read
  // the world actor here and the leg reports "nothing applied" while the card
  // itself says otherwise. Source, not derived, for the reason applyToTarget
  // documents: data prep zeroes derived HP on an encumbered or panicked actor.
  const hp = () => tok.actor.toObject().system.hp.value;

  r.hpBefore = hp();
  const first = await btn();
  r.buttonFound = !!first;
  first?.click();
  for (let i = 0; i < 40 && hp() === r.hpBefore; i++) await sleep(150);
  r.hpAfterFirst = hp();

  // The flag is what survives a re-render, so wait for it rather than for paint.
  for (let i = 0; i < 40 && !msg.getFlag("air-bladder", "damageApplied"); i++) await sleep(150);
  r.flagged = !!msg.getFlag("air-bladder", "damageApplied");
  await sleep(400);
  const row = document.querySelector(`[data-message-id="${msg.id}"]`);
  r.summary = (row?.querySelector(".dmg-applied")?.textContent ?? "").trim();
  const after = row?.querySelector(".apply-dmg");
  r.spentClass = !!after?.classList.contains("spent");
  r.spentDisabled = after?.hasAttribute("disabled") ?? false;
  r.pointerEvents = after ? getComputedStyle(after).pointerEvents : null;

  // The hazard: click it AGAIN. Called directly rather than via .click(), because
  // pointer-events:none means a real click never lands — and "the CSS stopped it"
  // is exactly the reassurance this leg must not accept. This reaches the handler
  // the way a devtools-enabled or stale-DOM click would.
  const { Damage } = await import("/systems/air-bladder/module/damage.js");
  await Damage.onClickChatMessageApplyButton(
    { currentTarget: { dataset: { targets: tok.id } }, shiftKey: false },
    row, {}, scene, msg,
  );
  await sleep(500);
  r.hpAfterSecond = hp();

  // CONTROL, in-page: the same call with NO message, which is the pre-fix
  // signature. It must still apply — otherwise the leg above passes because the
  // path is broken, not because the flag refused.
  await Damage.onClickChatMessageApplyButton(
    { currentTarget: { dataset: { targets: tok.id } }, shiftKey: false },
    row, {}, scene, null,
  );
  for (let i = 0; i < 40 && hp() === r.hpAfterSecond; i++) await sleep(150);
  r.hpAfterControl = hp();

  for (const m of game.messages.contents.slice().reverse().slice(0, 12)) {
    if (m.speaker?.token === tok.id || m.id === msg.id) await m.delete();
  }
  await scene.delete();
  await foe.delete();
  return r;
});

/* ---------------------------------------------------------------------------
 * The damage card names who is attacking whom — and never names a token the
 * viewer is not allowed to know about.
 *
 * Driven as ALICE, because this is the one item in the batch that can do real
 * harm and a GM cannot see it by looking: the Warden owns everything, so on the
 * Warden's own screen a hidden token is named correctly and the leak is
 * invisible. Both ends, twice over — a visible target IS named for her, a hidden
 * one is NOT, and the Warden's copy carries both.
 * ------------------------------------------------------------------------- */
const attack = { ran: false };
// If this is ever parsed as HTML the browser fetches nothing, fails, and sets the
// flag — so the leg has a positive witness rather than only the absence of a tag.
const XSS_NAME = 'ZZ <img src=x onerror="window.__abXSS=1"> Foe';
try {
  const alicePage = await browser.newPage({ viewport: VIEWPORT });
  await joinAs(alicePage, "Alice");

  const fixture = await page.evaluate(async ({ xssName }) => {
    const ActorImpl = CONFIG.Actor.documentClass;
    const attacker = await ActorImpl.create({ name: "ZZ Attacker PC", type: "character" });
    const seen = await ActorImpl.create({ name: "ZZ Seen Foe", type: "npc", system: { role: "monster" } });
    const unseen = await ActorImpl.create({ name: "ZZ Unseen Foe", type: "npc", system: { role: "monster" } });
    // A Warden-authored name that is also markup. The attack line now builds DOM
    // nodes so it can bold the target, which is exactly the change that could
    // reopen the player->GM injection this repo has paid for twice.
    const evil = await ActorImpl.create({ name: xssName, type: "npc", system: { role: "monster" } });
    // OBSERVER on the SCENE so a player's client holds its tokens at all. Token
    // ownership is unaffected — TokenDocument#isOwner delegates to the actor
    // (documents/token.mjs:271-275) — so the hidden-token gate is still being
    // tested and not handed a free pass.
    const scene = await Scene.create({
      name: "ZZ Attack Scene", width: 1000, height: 1000,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    });
    const mk = async (actor, x, hidden) => {
      const td = (await actor.getTokenDocument({ x, y: 100 })).toObject();
      td.hidden = hidden;
      const [t] = await scene.createEmbeddedDocuments("Token", [td]);
      return t;
    };
    const aTok = await mk(attacker, 100, false);
    const sTok = await mk(seen, 300, false);
    const uTok = await mk(unseen, 500, true);
    const eTok = await mk(evil, 700, false);

    const { evaluateFormula } = await import("/systems/air-bladder/module/utils.js");
    const post = async (ids) => {
      const roll = await evaluateFormula("2", {});
      const flavor = await foundry.applications.handlebars.renderTemplate(
        "systems/air-bladder/templates/chat/dmg-roll-card.html",
        { label: "ZZ weapon sentence", weapon: "ZZ Probe Mace", targets: ids.join(";") },
      );
      const msg = await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ token: aTok }),
        flavor,
      });
      return msg.id;
    };
    return {
      bothId: await post([sTok.id, uTok.id]),
      hiddenOnlyId: await post([uTok.id]),
      injectedId: await post([eTok.id]),
      sceneId: scene.id, attackerId: attacker.id, seenId: seen.id, unseenId: unseen.id,
      evilId: evil.id, aTokId: aTok.id,
    };
  }, { xssName: XSS_NAME });

  // What the WARDEN sees on the same two cards. Read here rather than assumed:
  // "Alice is missing the hidden name" only means something if the name was
  // there to miss.
  const readLabel = async (pg, id) => pg.evaluate(async (mid) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let row = null;
    for (let i = 0; i < 40 && !row; i++) {
      row = document.querySelector(`[data-message-id="${mid}"]`);
      if (!row) await sleep(150);
    }
    await sleep(300);
    const el = row?.querySelector(".flavor-dice-roll .dmg-label");
    const strong = el?.querySelector("strong.dmg-target");
    return {
      present: !!row, text: (el?.textContent ?? "").trim(), isGM: game.user.isGM,
      // The bolded target: its OWN text, not the sentence's, so a <strong>
      // wrapped round the whole line would not pass this.
      strongText: strong ? strong.textContent : null,
      strongWeight: strong ? getComputedStyle(strong).fontWeight : null,
      // Markup is being introduced where there was none. These two are the
      // standing proof it was introduced safely: no element an authored name
      // asked for, and the label still holds exactly one <strong> — ours.
      injectedTags: el
        ? [...el.querySelectorAll("*")].map((n) => n.tagName.toLowerCase()) : null,
      // The payload's own report. `textContent` cannot fire it and neither can
      // a text node, so a truthy value here means something parsed HTML.
      xssFired: window.__abXSS === 1,
    };
  }, id);

  const gmBoth = await readLabel(page, fixture.bothId);
  const alBoth = await readLabel(alicePage, fixture.bothId);
  const alHiddenOnly = await readLabel(alicePage, fixture.hiddenOnlyId);
  // Read on ALICE's page: a player's copy is the one that matters, and it is the
  // trimmed one, so the injection leg cannot pass on markup only a GM ever saw.
  const alInjected = await readLabel(alicePage, fixture.injectedId);
  Object.assign(attack, {
    ran: true, gmIsGM: gmBoth.isGM, aliceIsGM: alBoth.isGM,
    aliceSawCard: alBoth.present,
    gmText: gmBoth.text, aliceText: alBoth.text, aliceHiddenOnlyText: alHiddenOnly.text,
    gmStrong: gmBoth.strongText, gmStrongWeight: gmBoth.strongWeight,
    aliceStrong: alBoth.strongText,
    injectedText: alInjected.text, injectedTags: alInjected.injectedTags,
    injectedStrong: alInjected.strongText, xssFired: alInjected.xssFired,
  });

  await page.evaluate(async (f) => {
    for (const id of [f.bothId, f.hiddenOnlyId, f.injectedId]) await game.messages.get(id)?.delete();
    await game.scenes.get(f.sceneId)?.delete();
    for (const id of [f.attackerId, f.seenId, f.unseenId, f.evilId]) {
      await game.actors.get(id)?.delete();
    }
  }, fixture);
  await alicePage.close();
} catch (e) {
  attack.error = `${e.name}: ${e.message}`;
}

/* ---------------------------------------------------------------------------
 * A damage roll made with NOTHING TARGETED gets an Apply control anyway, and the
 * Warden is asked who takes it.
 *
 * The card used to carry no control at all — `dmg-roll-card.html`'s
 * `{{#if (isNotNull targets)}}` — so the roll could not be spent from the log.
 * The anchor is built at RENDER and not in the template, which is what makes an
 * untargeted card ALREADY IN THE LOG spendable; the leg that matters most below
 * is therefore the pair "stored flavor has none / the DOM has one", because that
 * pair is the only thing that can tell the two designs apart.
 * ------------------------------------------------------------------------- */
const untargeted = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};

  const foe = await ActorImpl.create({
    name: "ZZ Untargeted Foe", type: "npc",
    system: { role: "monster", hp: { value: 9, max: 9 }, armor: 0 },
  });
  const pc = await ActorImpl.create({
    name: "ZZ Untargeted PC", type: "character",
    system: { hp: { value: 9, max: 9 }, armor: 0 },
  });
  const scene = await Scene.create({ name: "ZZ Untargeted Scene", width: 1000, height: 1000 });
  const [foeTok] = await scene.createEmbeddedDocuments("Token", [await foe.getTokenDocument({ x: 100, y: 100 })]);
  const [pcTok] = await scene.createEmbeddedDocuments("Token", [await pc.getTokenDocument({ x: 300, y: 100 })]);

  const { evaluateFormula, askDamageTargets } = await import("/systems/air-bladder/module/utils.js");
  const { Damage } = await import("/systems/air-bladder/module/damage.js");

  // EXACTLY what both real producers ship when game.user.targets is empty.
  const roll = await evaluateFormula("3", {});
  const flavor = await foundry.applications.handlebars.renderTemplate(
    "systems/air-bladder/templates/chat/dmg-roll-card.html",
    { label: "ZZ untargeted probe", weapon: "ZZ Probe Sling", targets: null },
  );
  const msg = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: foeTok }), flavor });

  // THE CONTROL, and it is intrinsic rather than planted: this is the stored
  // card, which is byte-for-byte what a card rolled before this change looks
  // like. No anchor here and an anchor in the DOM below is the whole claim —
  // remove the render-time injection and the second half goes false, while a
  // template-only fix would make BOTH true and be unable to reach the log's
  // existing cards. Nothing is written and no source is stubbed.
  r.storedHasAnchor = ["flavor", "content"]
    .some((f) => String(msg[f] ?? "").includes("apply-dmg"));

  const rowOf = async (id) => {
    let el = null;
    for (let i = 0; i < 40 && !el?.querySelector(".apply-dmg"); i++) {
      el = document.querySelector(`[data-message-id="${id}"]`);
      if (!el?.querySelector(".apply-dmg")) await sleep(150);
    }
    return el;
  };
  const row = await rowOf(msg.id);
  const anchor = row?.querySelector(".apply-dmg");
  r.anchorInDom = !!anchor;
  // No data-targets AT ALL. Its absence is what the handler reads to decide to
  // ask; an empty attribute would be a datum claiming to hold ids.
  r.anchorHasTargets = anchor?.hasAttribute("data-targets") ?? null;
  r.anchorTooltip = anchor?.dataset.tooltip ?? null;
  r.anchorGlyph = anchor
    ? (() => { const c = getComputedStyle(anchor.querySelector("i"), "::before").content;
      return c && c !== "none" && c !== '""' ? c : null; })()
    : null;
  // The attack line must NOT appear: there is no target to name, so the card
  // keeps the weapon sentence it was rolled with.
  r.labelText = (row?.querySelector(".dmg-label")?.textContent ?? "").trim();

  // A card in the LEGACY shape — the wrapper with a plain child div, before
  // .dmg-label existed. This is what is actually sitting in the user's log.
  const legacy = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: foeTok }),
    flavor: '<div class="flavor-dice-roll"><div>ZZ legacy untargeted</div></div>',
    content: '<div class="dice-roll"><h4 class="dice-total">3</h4></div>',
  });
  const legacyRow = await rowOf(legacy.id);
  r.legacyGainsAnchor = !!legacyRow?.querySelector(".apply-dmg");

  /* The picker itself: what it lists, how it groups it, and what starts ticked. */
  // The scene has to be VIEWED for the canvas selection to exist at all — and
  // the previously-viewed one is captured so it can be restored BEFORE this one
  // is deleted, which is the idiom the legs above already follow. Deleting the
  // ACTIVE scene tears the canvas down at an arbitrary moment; it surfaced once
  // as `pageerror: Cannot set properties of null (setting 'hidden')` and passed
  // on the next run, which is a RACE, not a flake.
  const prevScene = canvas?.scene;
  await scene.view();
  for (let i = 0; i < 40 && canvas?.scene?.id !== scene.id; i++) await sleep(150);
  for (let i = 0; i < 40 && !canvas?.tokens?.get(foeTok.id); i++) await sleep(150);
  canvas.tokens.get(foeTok.id)?.control({ releaseOthers: true });
  r.controlled = canvas.tokens.controlled.map((t) => t.id);

  const dialogEl = async () => {
    for (let i = 0; i < 60; i++) {
      const el = document.querySelector(".application.dialog.cairn-damage-targets");
      if (el?.querySelector('input[name="abDamageTarget"]')) return el;
      await sleep(100);
    }
    return null;
  };
  const dialogGone = async () => {
    for (let i = 0; i < 60; i++) {
      if (!document.querySelector(".application.dialog.cairn-damage-targets")) return true;
      await sleep(100);
    }
    return false;
  };

  // Un-awaited on purpose: the promise settles only when the dialog is answered,
  // so the driving has to happen while it is open. A watchdog guards the case
  // where it never opens at all — an un-raced await there would hang the probe.
  let pickPromise = askDamageTargets(scene);
  const dlg = await dialogEl();
  r.dialogOpened = !!dlg;
  r.groupHeads = Array.from(dlg?.querySelectorAll(".ab-target-group") ?? []).map((p) => p.textContent);
  r.rows = Array.from(dlg?.querySelectorAll(".ab-target-row") ?? []).map((l) => ({
    id: l.querySelector("input")?.value,
    name: l.querySelector("span")?.textContent,
    checked: !!l.querySelector("input")?.checked,
  }));
  // The PC is listed — falling damage and friendly fire are real — and it is
  // listed SECOND, under its own heading.
  r.foeBeforePc = r.rows.findIndex((x) => x.id === foeTok.id) < r.rows.findIndex((x) => x.id === pcTok.id);
  r.pretickedIds = r.rows.filter((x) => x.checked).map((x) => x.id);

  // Cancel applies nothing. The button resolves to its ACTION STRING, never an
  // array, which is what the caller's Array.isArray test turns into "apply
  // nothing" — so this leg is reading the real discriminator.
  dlg?.querySelector('button[data-action="cancel"]')?.click();
  r.cancelResult = await Promise.race([
    pickPromise, new Promise((res) => setTimeout(() => res("TIMEOUT"), 8000)),
  ]);
  r.cancelGaveNothing = Array.isArray(r.cancelResult) ? r.cancelResult.length === 0 : r.cancelResult === "cancel";
  await dialogGone();

  /* End to end, through the REAL anchor on the REAL card. */
  const hpFoe = () => foeTok.actor.toObject().system.hp.value;
  const hpPc = () => pcTok.actor.toObject().system.hp.value;
  r.hpBefore = `${hpFoe()},${hpPc()}`;

  // Optional. With the injection defeated there IS no anchor, and a bare
  // `anchor.click()` threw inside page.evaluate — which kills the whole run and
  // reports a HARNESS error rather than red legs, taking the breakdown section
  // below with it. A probe must fail as a failed assertion, or the regression it
  // exists to catch reads as load or a flake.
  anchor?.click();
  const dlg2 = await dialogEl();
  r.clickOpenedPicker = !!dlg2;
  // Tick the PC as well — two ticked, and BOTH take the FULL roll, which is what
  // a targeted card with two ids already does.
  const pcBox = dlg2?.querySelector(`input[value="${pcTok.id}"]`);
  if (pcBox && !pcBox.checked) pcBox.click();
  r.tickedAtApply = Array.from(dlg2?.querySelectorAll('input[name="abDamageTarget"]:checked') ?? [])
    .map((b) => b.value);
  dlg2?.querySelector('button[data-action="apply"]')?.click();
  for (let i = 0; i < 60 && hpPc() === 9; i++) await sleep(150);
  await sleep(400);
  r.hpAfter = `${hpFoe()},${hpPc()}`;

  for (let i = 0; i < 40 && !msg.getFlag("air-bladder", "damageApplied"); i++) await sleep(150);
  r.flagged = !!msg.getFlag("air-bladder", "damageApplied");
  await sleep(400);
  const after = document.querySelector(`[data-message-id="${msg.id}"] .apply-dmg`);
  r.spent = !!after?.classList.contains("spent");
  // The summary is rendered from the flag, so an untargeted card now records what
  // it did — a log entry these rolls did not produce at all before.
  r.summary = (document.querySelector(`[data-message-id="${msg.id}"] .dmg-applied`)?.textContent ?? "").trim();

  // A spent card must not even ASK. The Warden choosing targets and then being
  // refused would be worse than the refusal alone.
  //
  // NOT a bare await. If the card is not spent — which is exactly the state a
  // defeated fix leaves it in — this call opens a picker and waits for an answer
  // nobody gives, and the probe hangs instead of reporting a red leg. So: start
  // it, watch for the dialog, close whatever opened, then race the promise.
  // .catch, because this call is not awaited here: an un-awaited rejection is an
  // UNCAUGHT error that kills the run, and the guard this exercises is precisely
  // the one whose absence makes it reject. Turning it into data is what lets the
  // leg below go red instead of the harness going bang.
  r.spentThrew = false;
  const spentClick = Damage.onClickChatMessageApplyButton(
    { currentTarget: { dataset: {} }, shiftKey: false }, document.querySelector(`[data-message-id="${msg.id}"]`),
    {}, scene, msg,
  ).catch((e) => { r.spentThrew = `${e.name}: ${e.message}`; });
  r.spentAskedAgain = !!(await dialogEl());
  document.querySelector(".application.dialog.cairn-damage-targets")
    ?.querySelector('button[data-action="cancel"]')?.click();
  await Promise.race([spentClick, new Promise((res) => setTimeout(res, 8000))]);
  await dialogGone();
  r.hpAfterSpentClick = `${hpFoe()},${hpPc()}`;

  // The guard on `targets.split(';')`. Before it, an anchor with no data-targets
  // threw here — which is exactly the anchor this change adds.
  r.shiftThrew = false;
  try {
    await Damage.onClickChatMessageApplyButton(
      { currentTarget: { dataset: {} }, shiftKey: true }, row, {}, scene, null);
  } catch (e) { r.shiftThrew = `${e.name}: ${e.message}`; }

  for (const m of game.messages.contents.slice().reverse().slice(0, 16)) {
    if (m.speaker?.token === foeTok.id || m.speaker?.token === pcTok.id) await m.delete();
  }
  // Look away FIRST, then delete — see prevScene above.
  if (prevScene && prevScene.id !== scene.id) await prevScene.view();
  for (let i = 0; i < 40 && canvas?.scene?.id === scene.id; i++) await sleep(150);
  await scene.delete();
  await foe.delete();
  await pc.delete();
  return r;
});

/* ---------------------------------------------------------------------------
 * The detail card names the armor, and the bracket disappears when there is none.
 *
 * "Damage: 6 (6-0)" named neither number. Both ends, because either leg alone
 * passes on a build that always shows the bracket or never does — plus the
 * absorbed-hit case, which is the one the drop rule exists to protect.
 * ------------------------------------------------------------------------- */
const breakdown = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { Damage } = await import("/systems/air-bladder/module/damage.js");
  const r = {};
  const scene = await Scene.create({ name: "ZZ Breakdown Scene", width: 1000, height: 1000 });
  const made = [];

  const hit = async (name, armor, hp, damage) => {
    const foe = await ActorImpl.create({
      name, type: "npc", system: { role: "monster", hp: { value: hp, max: hp }, armor },
    });
    made.push(foe);
    const [tok] = await scene.createEmbeddedDocuments("Token", [await foe.getTokenDocument({ x: 100, y: 100 })]);
    await Damage.applyToTargets([tok.id], damage, scene);
    for (let i = 0; i < 40; i++) {
      const m = game.messages.contents.slice().reverse().find((x) => x.speaker?.token === tok.id);
      if (m) return String(m.content ?? "");
      await sleep(150);
    }
    return "";
  };

  // Armour 2 against a 6: both numbers named, and the result is the roll minus it.
  r.armored = await hit("ZZ Armored Foe", 2, 20, 6);
  // Armour 0: NO bracket at all (user ruling). Self-consistent — armor 0 implies
  // dmg === damage, so the bracket carries nothing.
  r.bare = await hit("ZZ Bare Foe", 0, 20, 6);
  // Armour 3 against a 3: nothing lands, and the bracket is KEPT. This is the
  // case the drop rule protects — "Damage: 0" alone reads like a broken card.
  // THREE, not the 5 this fixture first asked for: armor is hard-capped at 3, so
  // a 5 arrives at the card as a 3 and the leg fails on its own expectation. Left
  // written down because it looks like the card lost a number.
  r.absorbed = await hit("ZZ Plated Foe", 3, 20, 3);
  // HP and STR must render exactly as they did. The keying was sold as a
  // translatability fix with no visual consequence, and nothing else watches for
  // that promise being broken.
  r.overflow = await hit("ZZ Overflow Foe", 0, 2, 6);
  // Compared against the PRE-FIX CONCATENATION rather than against a literal, and
  // that is the point: a chat message's content is parsed and re-serialized, so
  // the bare ">" in "=>" comes back as "&gt;" — a literal expectation fails while
  // the card is identical, and a hand-escaped one would be asserting my guess
  // about the sanitizer. Posting the old construction through the same path makes
  // the two comparable byte-for-byte with nothing assumed.
  const control = await ChatMessage.create({
    content: '<p><strong>' + game.i18n.localize('CAIRN.HitProtection') + '</strong>: <s>2</s> => 0</p>'
      + '<p><strong>' + game.i18n.localize('STR') + '</strong>: <s>10</s> => 6</p>',
  });
  r.controlContent = String(control.content ?? "");
  await control.delete();

  for (const m of game.messages.contents.slice().reverse().slice(0, 20)) {
    if (scene.tokens.get(m.speaker?.token ?? "")) await m.delete();
  }
  await scene.delete();
  for (const a of made) await a.delete();
  return r;
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

console.log("\na card outlives the scene it was rolled on");
check("viewing another scene", out.viewingOtherScene,
  "the party moved on; the card's token ids belong to the scene it was rolled on");
check("button still bound", out.crossSceneButton,
  "the log re-rendered under the new scene and the anchor is still there");
check("cross-scene apply lands", out.crossSceneLanded,
  `hp ${out.hpAfterCross} (expected 2,2 -> 0,0; reading the VIEWER's scene made every id miss)`);

console.log("\na target whose token is gone");
check("survivor still damaged", out.mixedSurvivorHit,
  "a mixed batch damages the ids that resolve");
check("the miss is reported", out.mixedWarned && !/^CAIRN\./.test(out.missWarning),
  `warn: ${out.missWarning}`);

console.log("\nFatigue is never refused at a full pack");
check("at the limit first", out.fatEncumberedBefore,
  `slots ${out.fatSlotsBefore} — no free slot, and nothing over the line yet`);
check("+ button present", out.fatButtonPresent,
  'the element carrying data-action="addFatigue" (AppV2 actions are private statics — a probe must click)');
check("first click lands", out.fatFirstLanded,
  "a click on the real button added Fatigue to a pack with no free slot");
check("second click lands", out.fatSecondLanded,
  "twice — not a path that allows one and then blocks, which is what the old guard did");
check("past the ceiling", out.fatOverCeiling,
  `slots ${out.fatSlotsAfter} (used must EXCEED max: Fatigue is owed, and capacity does not cap it)`);
check("still encumbered", out.fatStillEncumbered,
  "over capacity stays over capacity — the player drops something to clear it");
check("negative control", out.fatControlBlocked && out.fatRestoredWorks,
  `old refusal shadowed onto the instance blocks the same click (${out.fatControlBlocked}); restored and lands again (${out.fatRestoredWorks})`);
check("ordinary adds refused", out.ordinaryStillRefused,
  "an unflagged createOwnedItem on the same full character is still turned away — overflow is owed to Fatigue, not to shopping");
check("grants land whole", out.grantAllLanded,
  `slots ${out.grantSlots} — what generation and a background grant owe is never clamped`);

console.log("\nthe Scar card names who was scarred");
check("a Scar card was posted", scar.posted, "damage landing exactly on 0 HP draws the table");
check("it names the SCARRED token", scar.speakerToken === scar.victimToken,
  `speaker.token=${scar.speakerToken} (expected the victim ${scar.victimToken}) - the bug the Warden reported`);
// Positive, not "!== the attacker". The negative form does NOT discriminate:
// witnessed 2026-08-06 with the fix reverted, core's getSpeaker() resolved to
// some other controlled token, so "not the attacker" was TRUE while the card was
// still misattributed. A leg that stays green with the bug present is worse than
// no leg. Naming the victim's actor is the claim that actually holds.
check("it names the victim's actor", scar.speakerActor === scar.victimActor,
  `speaker.actor=${scar.speakerActor} (expected the victim ${scar.victimActor}; the viewer's own character is ${scar.attackerActor})`);
check("flavor is ours, not core's", !!scar.flavor && scar.flavor !== scar.coreDrawFlavor,
  `flavor "${scar.flavor}" (core would say "${scar.coreDrawFlavor}", which claims somebody drew it)`);
check("control: bare draw() still misattributes", scar.controlSpeakerToken !== scar.victimToken,
  `bare draw() speaker.token=${scar.controlSpeakerToken} - if this equalled the victim the leg above would prove nothing`);

console.log("\nthe Scar card does not repeat the damage number");
check("the card rendered", scar.scarRendered, "needed before either half below means anything");
check("no dice block", scar.scarDiceBlocks === 0,
  `${scar.scarDiceBlocks} .dice-roll in the card - the roll is a CONSTANT, so rendering it printed the damage as formula AND total`);
check("the scar text survives", !!scar.scarResultText,
  `result row "${scar.scarResultText}" - dropping the dice block must not drop the card`);
check("control: draw() forwarding the roll DOES show dice", scar.controlDiceBlocks > 0,
  `bare draw() card has ${scar.controlDiceBlocks} .dice-roll - if this were 0 the table has displayRoll off and the leg above proves nothing`);

console.log("\nthe Scar banner and chat legibility");
check("the banner renders", scar.bannerRendered, ".cairn-scar-banner on the damage card");
check("centred, bold and glowed", scar.bannerCentered && scar.bannerBold && scar.bannerGlow,
  `align=${scar.bannerCentered} bold=${scar.bannerBold} glow=${scar.bannerGlow}`);
check("chat body above core's 14px", scar.contentPx > 14,
  `.message-content computes to ${scar.contentPx}px`);
// The flavor is a different element from the content and was left behind by the
// first pass at this; measured on the scar card's OWN flavor so no other
// message's styling can carry the leg.
check("flavor above core's 14px too", scar.flavorPx > 14,
  `.flavor-text computes to ${scar.flavorPx}px on the scar card ("${scar.flavorShown}")`);

console.log("\nApply damage is Warden-only");
check("the player leg ran", warden.ran && !warden.isGM,
  warden.error ?? `joined as a player, isGM=${warden.isGM} (needs Alice - npm run dev:players)`);
check("Alice sees the card", !!warden.rowPresent, "the damage card reached her log");
check("the stored card still carries it", !!warden.contentHasAnchor,
  "one HTML goes to everyone, so the render hook is the only place to trim it - and this proves there was something to trim");
check("her copy has no Apply control", warden.ran && !warden.anchorInDom,
  "removed, not display:none - nothing left to un-hide in devtools");
check("the Warden's control draws a glyph", !!warden.iconGlyph,
  `${warden.iconClass} renders ${warden.iconGlyph ?? "NOTHING"} - a Font Awesome class absent from the shipped font fails silently as an empty box`);
check("and at a clickable size", warden.iconPx > 14,
  `.apply-dmg computes to ${warden.iconPx}px`);
check("and in the failure colour",
  !!warden.applyColor && warden.applyColor === warden.failColor,
  `.apply-dmg is ${warden.applyColor}, .dice-total.failure is ${warden.failColor} - the two are compared to EACH OTHER, so a core retune of the token is not a failure and a rule that drifted off it is`);

console.log("\nApply marks the card, and applies once");
check("the control was there", applied.buttonFound, "the card rendered with .apply-dmg");
check("the first click lands", applied.hpAfterFirst === applied.hpBefore - 3,
  `hp ${applied.hpBefore} -> ${applied.hpAfterFirst} (expected -3)`);
check("the card is flagged", applied.flagged,
  "a DOM-only disable would be undone by the next chat re-render");
check("the card says what it did", /ZZ Applied Foe/.test(applied.summary) && /3/.test(applied.summary),
  `"${applied.summary}"`);
check("the control reads as spent", applied.spentClass && applied.spentDisabled && applied.pointerEvents === "none",
  `class=${applied.spentClass} disabled=${applied.spentDisabled} pointer-events=${applied.pointerEvents}`);
// The hazard, asserted on HP rather than on the greying. Called directly, so
// "pointer-events stopped it" cannot be what makes this pass.
check("a second application is refused", applied.hpAfterSecond === applied.hpAfterFirst,
  `hp ${applied.hpAfterFirst} -> ${applied.hpAfterSecond} (a second click must change nothing)`);
check("control: the same call without the card still applies",
  applied.hpAfterControl === applied.hpAfterSecond - 3,
  `hp ${applied.hpAfterSecond} -> ${applied.hpAfterControl} - the pre-fix signature, proving the leg above is the FLAG refusing and not a broken path`);

console.log("\nthe damage card names attacker and target");
check("the player leg ran", attack.ran && attack.gmIsGM && !attack.aliceIsGM,
  attack.error ?? `GM=${attack.gmIsGM} Alice=${attack.aliceIsGM} (needs Alice - npm run dev:players)`);
check("Alice sees the card", !!attack.aliceSawCard, "the damage card reached her log");
check("the Warden sees the whole sentence",
  attack.gmText?.includes("ZZ Attacker PC") && attack.gmText?.includes("ZZ Seen Foe")
  && attack.gmText?.includes("ZZ Unseen Foe"),
  `"${attack.gmText}" - a GM owns everything, so both targets are named`);
check("it names the weapon", attack.gmText?.includes("ZZ Probe Mace"),
  `"${attack.gmText}" - the card shows the die but never the weapon, so dropping it lost that from the log entirely`);
// No article. "attacks the Thaddeus!" is what an early cut produced, and it reads
// wrongly for every named NPC.
check("no article before the target", !/attacks the /.test(attack.gmText ?? ""),
  `"${attack.gmText}"`);
check("the weapon sentence is gone", !attack.gmText?.includes("ZZ weapon sentence"),
  `"${attack.gmText}" - the attack line REPLACES it, it is not added beside it`);
check("Alice is told the visible one",
  attack.aliceText?.includes("ZZ Attacker PC") && attack.aliceText?.includes("ZZ Seen Foe"),
  `"${attack.aliceText}"`);
// The leak. The Warden's copy above proves the name was there to leak, so this
// is not a leg that passes because nothing was resolved.
check("and NOT the hidden one", attack.ran && !attack.aliceText?.includes("ZZ Unseen Foe"),
  `"${attack.aliceText}" - a token the Warden took off the board must not be named in a card the whole table reads`);
check("nothing nameable falls back to the weapon",
  attack.aliceHiddenOnlyText === "ZZ weapon sentence",
  `"${attack.aliceHiddenOnlyText}" - with only a hidden target, she gets the original sentence, not a half-written one`);

// The target's name is BOLD. Asserted on the <strong>'s OWN text, so a <strong>
// wrapped round the whole sentence would not satisfy it, and on the computed
// weight, because markup with no rule behind it looks identical to nothing.
check("the target is bolded",
  attack.gmStrong === "ZZ Seen Foe and ZZ Unseen Foe" && Number(attack.gmStrongWeight) >= 700,
  `<strong>"${attack.gmStrong}"</strong> at weight ${attack.gmStrongWeight}`);
check("and only the target",
  attack.aliceStrong === "ZZ Seen Foe",
  `"${attack.aliceStrong}" - Alice's copy bolds the one name she is told, so the bolding runs through the same visibility gate as the sentence`);
// A Warden-authored name that is markup must arrive as TEXT. Both ends: nothing
// the name asked for got built, and the name is still readable in the sentence.
check("an authored name is never parsed as HTML",
  attack.injectedTags?.length === 1 && attack.injectedTags[0] === "strong"
  && attack.xssFired === false,
  `elements in the label: ${JSON.stringify(attack.injectedTags)} (only ours), payload fired=${attack.xssFired}`);
check("and it still reads literally",
  (attack.injectedStrong ?? "").includes("<img src=x")
  && (attack.injectedText ?? "").includes("<img src=x"),
  `"${attack.injectedStrong}" - escaping it away would hide the attack from the Warden who has to notice it`);

console.log("\nan UNTARGETED roll gets a splat, and the Warden picks who takes it");
// The pair. Either half alone proves nothing: the first is what a pre-change card
// looks like, the second is what the render hook adds to it.
check("the stored card has NO anchor", untargeted.storedHasAnchor === false,
  "the template gate still hides it at creation — so anything in the DOM came from the render hook, which is what reaches cards already in the log");
check("the render hook adds one", untargeted.anchorInDom,
  ".apply-dmg present on an untargeted card");
check("with no data-targets", untargeted.anchorHasTargets === false,
  `hasAttribute=${untargeted.anchorHasTargets} — its ABSENCE is what the handler reads to ask; an empty attribute would be a datum claiming to hold ids`);
check("its own tooltip", untargeted.anchorTooltip === "Apply damage — choose who takes it",
  `"${untargeted.anchorTooltip}" — a different tooltip from the targeted card's, because the rule is meant to be readable from the card`);
check("and it draws a glyph", !!untargeted.anchorGlyph,
  `renders ${untargeted.anchorGlyph ?? "NOTHING"}`);
check("the weapon sentence stands", untargeted.labelText === "ZZ untargeted probe",
  `"${untargeted.labelText}" — no target to name, so the attack line must not half-write one`);
check("a LEGACY-shaped card gains one too", untargeted.legacyGainsAnchor,
  "the wrapper with a plain child div, before .dmg-label existed — what is actually sitting in the log");

check("the picker opens", untargeted.dialogOpened, "clicking asks rather than reading the canvas silently");
check("two groups, monsters first",
  JSON.stringify(untargeted.groupHeads) === JSON.stringify(["Monsters & NPCs", "Player characters"]),
  JSON.stringify(untargeted.groupHeads));
check("the PC is listed", untargeted.rows?.some((x) => x.name === "ZZ Untargeted PC"),
  `${JSON.stringify(untargeted.rows?.map((x) => x.name))} — falling damage and friendly fire are real, so PCs are never filtered out`);
check("and listed second", untargeted.foeBeforePc,
  "ticked in place: nothing re-sorts under the Warden, but the common case is at the top");
// The pre-tick is the whole reason it can always confirm without being a
// nuisance. Asserted on the SELECTED token specifically, not "something is
// ticked" — a build that ticked everything would satisfy the weaker claim.
check("the canvas selection is pre-ticked",
  JSON.stringify(untargeted.pretickedIds) === JSON.stringify(untargeted.controlled),
  `ticked ${JSON.stringify(untargeted.pretickedIds)} vs selected ${JSON.stringify(untargeted.controlled)} — and `
  + "`checked` had to be set as an ATTRIBUTE: the element is serialized to HTML, so the IDL property would not survive");
check("Cancel applies nothing", untargeted.cancelGaveNothing,
  `resolved to ${JSON.stringify(untargeted.cancelResult)} — a ✕ is an instruction, not a default`);
check("clicking the real anchor asks", untargeted.clickOpenedPicker,
  "driven through the button rather than the helper, so neither layer alone can look like a landed fix");
check("both ticked take the FULL roll",
  untargeted.hpBefore === "9,9" && untargeted.hpAfter === "6,6",
  `hp ${untargeted.hpBefore} -> ${untargeted.hpAfter} (expected 6,6 — 3 each, not 3 split), ticked ${JSON.stringify(untargeted.tickedAtApply)}`);
check("the card records it", untargeted.flagged && untargeted.spent
  && /ZZ Untargeted Foe/.test(untargeted.summary),
  `flagged=${untargeted.flagged} spent=${untargeted.spent} "${untargeted.summary}" — a log entry these rolls did not produce at all`);
// States its own precondition. "A spent card does not ask" is unverifiable on a
// card that never got spent, and without the `flagged` term this leg would go
// GREEN in exactly that case — the shape where a probe passes because nothing
// happened.
check("a spent card does not even ask",
  untargeted.flagged && !untargeted.spentAskedAgain && untargeted.hpAfterSpentClick === untargeted.hpAfter,
  `spent=${untargeted.flagged} dialog=${untargeted.spentAskedAgain} hp ${untargeted.hpAfterSpentClick} — choosing targets and THEN being refused is worse than the refusal alone`);
// BOTH paths through the guard, because they are separate reads of the same
// missing attribute and each one alone throws. The bare `targets.split(';')`
// threw on exactly the anchor this change adds — an untargeted card is the only
// way to reach the handler with no data-targets at all.
check("neither path throws on a missing data-targets",
  untargeted.shiftThrew === false && untargeted.spentThrew === false,
  `shift: ${untargeted.shiftThrew} / apply: ${untargeted.spentThrew}`);

console.log("\nthe detail card names the armor");
check("armour is named", /Damage<\/strong>: 4 \(6 damage − 2 armor\)/.test(breakdown.armored),
  `"${(breakdown.armored.match(/Damage<\/strong>:[^<]*/) ?? [""])[0]}" — the Warden had to ask what the 0 in "(6-0)" was`);
// Both ends. Either leg alone passes on a build that always shows the bracket, or
// never does.
check("no armour drops the bracket", /Damage<\/strong>: 6</.test(breakdown.bare)
  && !/\(/.test((breakdown.bare.match(/Damage<\/strong>:[^<]*/) ?? [""])[0]),
  `"${(breakdown.bare.match(/Damage<\/strong>:[^<]*/) ?? [""])[0]}" — ruled, not an oversight: armor 0 implies dmg === damage, so the bracket carries nothing`);
check("an absorbed hit KEEPS it", /Damage<\/strong>: 0 \(3 damage − 3 armor\)/.test(breakdown.absorbed),
  `"${(breakdown.absorbed.match(/Damage<\/strong>:[^<]*/) ?? [""])[0]}" — this is why the drop rule is armor-based and not result-based; a bare "Damage: 0" reads like a broken card`);
check("a spaced U+2212, not a hyphen", /−/.test(breakdown.armored) && !/6 damage - 2/.test(breakdown.armored),
  '"6-0" read as a range; the minus lives inside the key so a translator can change it');
// The promise this half was sold on, asserted against the OLD construction posted
// through the same path — not against a literal, which would be asserting a guess
// about how chat content is re-serialized.
check("HP and STR are unchanged on screen",
  !!breakdown.controlContent && breakdown.overflow.includes(breakdown.controlContent),
  `card has "${breakdown.overflow.replace(/<[^>]*>/g, "|")}"; the pre-fix concatenation renders "${breakdown.controlContent}" — same "=>", same strike-through: the keying was sold as a translatability fix with NO visual consequence`);

if (errors.length) { bad++; console.log("Console errors:\n" + errors.join("\n")); }
console.log(bad === 0 ? "\nencumbered-damage e2e passed" : `\nencumbered-damage e2e FAILED — ${bad}`);
process.exit(bad === 0 ? 0 : 1);

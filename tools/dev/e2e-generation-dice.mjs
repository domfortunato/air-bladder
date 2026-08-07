#!/usr/bin/env node
/**
 * Character generation posts its dice to chat — and posts NOTHING else.
 *
 * The feature: generating or regenerating a PLAYER CHARACTER posts one chat
 * message carrying the five real Roll objects (HP, STR, DEX, WIL, Gold), which is
 * what makes Dice So Nice animate them and what makes core play the dice sound
 * without it. Gated by the world setting `show-generation-rolls`.
 *
 * What this asserts, and why each leg is here:
 *   1. ON  → generate: exactly ONE message, five rolls, right formulas, speaker is
 *            the new actor, and every roll TIES to the stat that was stored. The
 *            tie is the point — without it the card could show decorative dice
 *            that have nothing to do with the character, and still look right.
 *   2. OFF → generate: ZERO messages. The negative control: leg 1 passing proves
 *            nothing about the setting if the setting can't also switch it off.
 *   3. ON  → regenerate: exactly ONE message (the sheet's Roll button path).
 *   4. Test ×10 (previewBackground) posts nothing — it rolls choice tables ten
 *      times over and would be a twenty-message storm if it leaked.
 *   5. Name / Background / Portrait re-rolls post nothing. Ruled explicitly by the
 *      user: only HP/STR/DEX/WIL/Gold reach chat. None of the three is a Roll
 *      (two are Math.random picks, one is a table roll() with displayChat false),
 *      so this is enforced by construction — leg 5 is what keeps it that way.
 *
 * GOLD IS NOT AN EQUALITY. The stored `system.gold` is the roll PLUS bond gold
 * PLUS background-choice gold, so the card shows the bare roll and the assertion
 * is `roll <= stored`. Asserting equality here would fail on any character whose
 * background or bond grants coin, which is most of them.
 *
 * Cleanup runs in NODE, not in page.evaluate — the ids are stashed on `window` as
 * they are created, so a throw halfway through still leaves them findable and the
 * dev world does not silently accumulate probe characters and chat spam.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await withSettings(page, () => page.evaluate(async () => {
    const NS = "air-bladder";
    const out = { legs: {} };
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    // Stashed on window so the Node-level cleanup can find them even if this
    // evaluate throws before returning.
    const track = (globalThis.__genDiceProbe = { actors: [], messages: [] });

    const gen = await import("/systems/air-bladder/module/character-generator.js");

    // Poll for the pack and its documents rather than assuming they are loaded.
    const pack = game.packs.get(`${NS}.backgrounds-2e`);
    if (!pack) throw new Error(`compendium ${NS}.backgrounds-2e not found`);
    let bgs = [];
    for (let i = 0; i < 30 && !bgs.length; i++) {
      bgs = await pack.getDocuments();
      if (!bgs.length) await sleep(100);
    }
    if (!bgs.length) throw new Error("backgrounds-2e is empty");
    out.backgroundUsed = { name: bgs[0].name, id: bgs[0].id };

    out.userName = game.user.name;
    const snapshot = () => new Set(game.messages.map((m) => m.id));
    /** Wait for chat to settle, then return the messages created since `before`. */
    const newSince = async (before, { expect }) => {
      // Poll UP to the deadline when we expect something, so a slow create is not
      // read as an absence; when we expect nothing, still wait the full settle
      // window, because "nothing yet" is not the same as "nothing ever".
      for (let i = 0; i < 30; i++) {
        const found = game.messages.filter((m) => !before.has(m.id));
        if (expect > 0 && found.length >= expect) { await sleep(150); break; }
        await sleep(100);
      }
      const found = game.messages.filter((m) => !before.has(m.id));
      for (const m of found) track.messages.push(m.id);
      return found;
    };
    const describe = (msgs) => msgs.map((m) => ({
      id: m.id,
      alias: m.speaker?.alias ?? null,
      actorId: m.speaker?.actor ?? null,
      rollFormulas: (m.rolls ?? []).map((x) => x.formula),
      rollTotals: (m.rolls ?? []).map((x) => x.total),
      contentHasName: null,
    }));

    /* --- 1. Setting ON: generate ------------------------------------------ */
    await game.settings.set(NS, "show-generation-rolls", true);
    let before = snapshot();
    const actor = await gen.createCharacter({ source: "2e" });
    if (!actor) throw new Error("createCharacter returned null");
    track.actors.push(actor.id);
    out.actor = { name: actor.name, id: actor.id };
    let msgs = await newSince(before, { expect: 1 });
    out.legs.on = describe(msgs);
    if (msgs.length === 1) {
      out.legs.on[0].contentHasName = String(msgs[0].content ?? "").includes(actor.name);
    }
    out.stored = {
      hp: actor.system.hp?.max,
      STR: actor.system.abilities?.STR?.max,
      DEX: actor.system.abilities?.DEX?.max,
      WIL: actor.system.abilities?.WIL?.max,
      gold: actor.system.gold,
    };

    /* --- 2. Setting OFF: generate (negative control) ----------------------- */
    await game.settings.set(NS, "show-generation-rolls", false);
    before = snapshot();
    const actorOff = await gen.createCharacter({ source: "2e" });
    if (actorOff) { track.actors.push(actorOff.id); out.actorOff = { name: actorOff.name, id: actorOff.id }; }
    out.legs.off = describe(await newSince(before, { expect: 0 }));

    /* --- 3. Setting ON: regenerate ---------------------------------------- */
    await game.settings.set(NS, "show-generation-rolls", true);
    before = snapshot();
    await gen.regenerateActor(actor);
    msgs = await newSince(before, { expect: 1 });
    out.legs.regen = describe(msgs);
    out.regenActorId = actor.id;

    /* --- 4. Test x10 preview posts nothing --------------------------------- */
    before = snapshot();
    await gen.previewBackground(bgs[0], 10);
    out.legs.preview = describe(await newSince(before, { expect: 0 }));

    /* --- 5. Name / Background / Portrait re-rolls post nothing -------------- */
    // Driven through the SHEET, the way a user reaches them: AppV2 keeps handlers
    // in private statics reachable only via the actions map, so calling them
    // directly is not possible and would not be the user's path anyway.
    await actor.update({ "system.generationEnabled": true });
    await actor.sheet.render(true);
    for (let i = 0; i < 30 && !(actor.sheet.element instanceof HTMLElement); i++) await sleep(100);
    await sleep(400);
    const root = actor.sheet.element;
    const clicked = [];
    before = snapshot();
    for (const action of ["rollName", "rollPortrait", "rollBackground"]) {
      const btn = root?.querySelector?.(`[data-action="${action}"]`);
      if (!btn) continue;
      clicked.push(action);
      btn.click();
      await sleep(700); // each awaits a table draw / art pick before it writes
    }
    out.clickedActions = clicked;
    out.legs.fieldRerolls = describe(await newSince(before, { expect: 0 }));
    await actor.sheet.close();

    return out;
  }));

  /* ------------------------------ assertions ------------------------------ */
  console.log(`  info  character: ${r.actor.name} (${r.actor.id}), background ${r.backgroundUsed.name}`);

  // 1. ON -> exactly one message, five rolls, right formulas, right speaker.
  const on = r.legs.on;
  if (on.length !== 1) {
    fail(`setting ON: expected 1 chat message, got ${on.length} [${on.map((m) => m.id).join(", ")}]`);
  } else {
    const m = on[0];
    ok(`setting ON: one message ${m.id}, speaker "${m.alias}"`);
    const wanted = ["1d6", "3d6", "3d6", "3d6", "3d6"];
    JSON.stringify(m.rollFormulas) === JSON.stringify(wanted)
      ? ok(`five rolls in order HP/STR/DEX/WIL/Gold: ${m.rollFormulas.join(", ")}`)
      : fail(`roll formulas are ${JSON.stringify(m.rollFormulas)}, expected ${JSON.stringify(wanted)}`);
    m.actorId === r.actor.id
      ? ok(`speaker is the generated actor (${m.actorId})`)
      : fail(`speaker actor is ${m.actorId}, expected ${r.actor.id}`);
    // The header names the ROLLER, not the character -- the card reads as one
    // sentence: "Warden" / "rolled a new character!" / "Ada". Compared against the
    // live user name, never a hardcoded "Warden", so it holds in any world. A
    // GM-only run cannot check the relay half (there the roller is a player and
    // this code runs on the Warden's client); that needs the player pass.
    m.alias === r.userName
      ? ok(`header names the roller, not the character ("${m.alias}")`)
      : fail(`header reads "${m.alias}", expected the roller "${r.userName}"`);
    m.alias !== r.actor.name
      ? ok("header is not the character name (that lives in the card body)")
      : fail("header is the character name — the roller is now named nowhere");
    m.contentHasName
      ? ok(`card names the character ("${r.actor.name}")`)
      : fail(`card content does not contain the character name "${r.actor.name}"`);

    // The tie: the dice must BE the character, not decoration.
    const [hp, str, dex, wil, gold] = m.rollTotals;
    const s = r.stored;
    hp === s.hp ? ok(`HP roll ${hp} matches stored HP ${s.hp}`) : fail(`HP roll ${hp} != stored ${s.hp}`);
    str === s.STR ? ok(`STR roll ${str} matches stored STR ${s.STR}`) : fail(`STR roll ${str} != stored ${s.STR}`);
    dex === s.DEX ? ok(`DEX roll ${dex} matches stored DEX ${s.DEX}`) : fail(`DEX roll ${dex} != stored ${s.DEX}`);
    wil === s.WIL ? ok(`WIL roll ${wil} matches stored WIL ${s.WIL}`) : fail(`WIL roll ${wil} != stored ${s.WIL}`);
    // Gold only ever has bond/background gold ADDED to it, never taken away.
    gold <= s.gold && gold >= 3
      ? ok(`Gold roll ${gold} is the bare roll, within stored gold ${s.gold}`)
      : fail(`Gold roll ${gold} is not a plausible 3d6 within stored gold ${s.gold}`);
  }

  // 2. OFF -> silence.
  r.legs.off.length === 0
    ? ok(`setting OFF: no chat message (generated ${r.actorOff?.name ?? "?"} silently)`)
    : fail(`setting OFF still posted ${r.legs.off.length} message(s) [${r.legs.off.map((m) => m.id).join(", ")}]`);

  // 3. Regenerate -> one message.
  if (r.legs.regen.length !== 1) {
    fail(`regenerate: expected 1 chat message, got ${r.legs.regen.length}`);
  } else {
    const m = r.legs.regen[0];
    ok(`regenerate: one message ${m.id} with ${m.rollFormulas.length} rolls`);
    m.actorId === r.regenActorId
      ? ok(`regenerate speaker is the same actor (${m.actorId})`)
      : fail(`regenerate speaker is ${m.actorId}, expected ${r.regenActorId}`);
  }

  // 4. Test x10 -> silence.
  r.legs.preview.length === 0
    ? ok("Test ×10 background preview posted nothing")
    : fail(`Test ×10 posted ${r.legs.preview.length} message(s) — the choice-table rolls are leaking`);

  // 5. Name / Background / Portrait -> silence. Assert the controls EXISTED
  //    first: if none rendered, zero messages proves nothing at all.
  const want = ["rollName", "rollPortrait", "rollBackground"];
  JSON.stringify(r.clickedActions) === JSON.stringify(want)
    ? ok(`the sheet exposed all three re-roll controls: ${r.clickedActions.join(", ")}`)
    : fail(`only clicked ${JSON.stringify(r.clickedActions)} — expected ${JSON.stringify(want)}; the silence check below proves nothing`);
  r.legs.fieldRerolls.length === 0
    ? ok("name / portrait / background re-rolls posted nothing to chat")
    : fail(`field re-rolls posted ${r.legs.fieldRerolls.length} message(s) [${r.legs.fieldRerolls.map((m) => m.id).join(", ")}]`);

  // ---- Leg 6: the dice land BEFORE the sheet opens -------------------------
  // ChatMessage.create resolves when the document saves; Dice So Nice keeps
  // animating for seconds after that. So opening the new character's sheet on
  // that resolution put the sheet over the dice — the roll was spoiled by its
  // own result. Ordering is the whole assertion: the last
  // `diceSoNiceRollComplete` must precede the sheet's render.
  //
  // The control is what makes this leg mean anything, and it is IN-PAGE: stub
  // DSN's own waitFor3DAnimationByMessageID to resolve immediately. That is
  // precisely the pre-fix world — dice still animate, nobody waits for them —
  // without editing a line of system source. If the order does NOT invert under
  // it, the ordering check above is measuring nothing.
  const order = await page.evaluate(async () => {
    if (typeof game.dice3d?.waitFor3DAnimationByMessageID !== "function") return { skipped: true };
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const track = (globalThis.__genDiceProbe ??= { actors: [], messages: [] });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // This leg runs OUTSIDE withSettings, so state its own preconditions rather
    // than inheriting whatever the previous block restored to: no card means no
    // dice, and the ordering would be unobservable in a way that reads as green.
    const NS = "air-bladder";
    const wasShowing = game.settings.get(NS, "show-generation-rolls");
    if (!wasShowing) await game.settings.set(NS, "show-generation-rolls", true);

    const run = async () => {
      const marks = [];
      const onDice = () => marks.push({ what: "dice", t: performance.now() });
      const onSheet = () => marks.push({ what: "sheet", t: performance.now() });
      Hooks.on("diceSoNiceRollComplete", onDice);
      Hooks.on("renderCairnActorSheet", onSheet);
      const before = new Set(game.messages.map((m) => m.id));
      // `source` is REQUIRED: without it generateCharacter prompts for the
      // content source and this evaluate waits on a modal nobody will answer.
      const actor = await gen.createCharacter({ source: "2e" });
      if (actor) { track.actors.push(actor.id); actor.sheet?.render(true); }
      await sleep(1500);
      Hooks.off("diceSoNiceRollComplete", onDice);
      Hooks.off("renderCairnActorSheet", onSheet);
      for (const m of game.messages) if (!before.has(m.id)) track.messages.push(m.id);
      await actor?.sheet?.close();
      const dice = marks.filter((m) => m.what === "dice").pop();
      const sheet = marks.filter((m) => m.what === "sheet").shift();
      return { sawDice: !!dice, sawSheet: !!sheet, diceFirst: !!(dice && sheet && dice.t <= sheet.t) };
    };

    const fixed = await run();

    const real = game.dice3d.waitFor3DAnimationByMessageID.bind(game.dice3d);
    game.dice3d.waitFor3DAnimationByMessageID = async () => true;   // defeat the wait
    let control;
    try { control = await run(); } finally { game.dice3d.waitFor3DAnimationByMessageID = real; }
    if (!wasShowing) await game.settings.set(NS, "show-generation-rolls", false);
    return { fixed, control };
  });

  if (order.skipped) {
    fail("dice-before-sheet NOT CHECKED: Dice So Nice is not active in this world, so the ordering this leg exists for cannot be observed");
  } else if (!order.fixed.sawDice || !order.fixed.sawSheet) {
    fail(`dice-before-sheet: never observed both events (dice=${order.fixed.sawDice} sheet=${order.fixed.sawSheet}) — the leg proves nothing`);
  } else {
    order.fixed.diceFirst
      ? ok("the dice finish animating before the generated sheet opens")
      : fail("the sheet opened while the dice were still in the air");
    order.control.diceFirst === false
      ? ok("control: stubbing DSN's wait puts the sheet back in front of the dice")
      : fail("control: the order did NOT invert with the wait defeated — the leg above is not measuring the wait");
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  // Cleanup from NODE, reading the ids the page stashed as it went, so a throw
  // partway through still cleans up what it had already made.
  try {
    const cleaned = await page.evaluate(async () => {
      const t = globalThis.__genDiceProbe ?? { actors: [], messages: [] };
      const done = { actors: [], messages: 0 };
      for (const id of t.actors) {
        const a = game.actors.get(id);
        if (!a) continue;
        done.actors.push(`${a.name} (${id})`);
        try { await a.delete(); } catch { /* already gone */ }
      }
      const ids = [...new Set(t.messages)].filter((id) => game.messages.get(id));
      if (ids.length) {
        try { await ChatMessage.deleteDocuments(ids); done.messages = ids.length; } catch { /* already gone */ }
      }
      return done;
    });
    if (cleaned.actors.length) console.log(`  note  removed probe actors: ${cleaned.actors.join(", ")}`);
    if (cleaned.messages) console.log(`  note  removed ${cleaned.messages} probe chat message(s)`);
  } catch (e) {
    console.error(`  note  could not clean up: ${e.message}`);
  }
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nGENERATION DICE PROBE FAILED\n" : "\ngeneration dice probe passed\n");
process.exit(failed ? 1 : 0);

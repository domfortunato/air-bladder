#!/usr/bin/env node
/**
 * The two generation buttons in the title bar: Roll Character and Randomization.
 *
 * They are frame buttons (`_getFrameButtons`), not header controls, so they are
 * built ONCE in _renderFrame and their state is re-applied on every render by
 * #syncGenerationButtons. That split is the thing worth testing: a state change
 * that never reaches the frame is invisible to any probe that only reads the
 * sheet body.
 *
 * Since 2026-08-02 Randomization defaults OFF everywhere (user ask): a fresh
 * or generated actor opens quiet — Roll hidden, no sheet-body dice — and the
 * toggle is the way in. The toggle is therefore built UNCONDITIONALLY for an
 * owner: `show-generate-header` gates only the Roll button, because a hidden
 * toggle would make Off permanent (it is the flag's only user-reachable
 * writer). A monster's Roll button says "Roll Monster" and wears the Generate
 * Monster button's dragon. And thing roles — mount, transport, container —
 * build NEITHER button and render no body dice regardless of the stored flag
 * (ruled 2026-08-02: there is nothing to randomize about a cart).
 *
 * Measured, not inspected: `textContent` reads back correctly from a button
 * whose label is clipped to nothing, so the geometry is asserted separately —
 * nothing overflows its own box, and nothing escapes the title bar.
 *
 *   npm run dev:header-buttons
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(34)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(34)} ${d}`); failures++; };

try {
  await joinAsGM(page);
  await dismissChrome(page);

  const out = await page.evaluate(async () => {
    const NS = "air-bladder";
    const made = [];
    const gen = game.cairn.characterGenerator;

    const read = (sheet) => {
      const header = sheet.element?.querySelector(".window-header");
      const one = (action) => {
        const b = header?.querySelector(`button[data-action="${action}"]`);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return {
          text: b.textContent.trim(),
          icon: [...(b.querySelector("i")?.classList ?? [])].find((c) => c.startsWith("fa-")) ?? null,
          hidden: getComputedStyle(b).display === "none",
          width: Math.round(r.width),
          height: Math.round(r.height),
          // Is the label actually READABLE, or is it overflowing a box that was
          // sized for an icon? textContent reads correctly either way, so this
          // is the only assertion that can see a clipped label.
          clipped: b.scrollWidth > b.clientWidth + 1,
          // Foundry's own header buttons stay inside the header; ours must too.
          overflowsHeader: r.right > header.getBoundingClientRect().right + 1,
        };
      };
      // Foundry's own square icon button, as the width reference. Hardcoding
      // "24px" would break the day Foundry retunes --button-size.
      const ref = header?.querySelector('button[data-action="close"]');
      return {
        roll: one("rollActor"),
        toggle: one("toggleGeneration"),
        popOut: one("detach"),
        // The sheet-BODY dice the flag gates (name + portrait exist on both
        // sheet types) — the default-Off leg asserts a quiet body.
        bodyDice: sheet.element?.querySelectorAll("a.name-roll, a.portrait-roll").length ?? 0,
        canDetach: sheet._canDetach(),
        // Left-to-right order of every button in the title bar. The ⋮ menu is
        // written into the header's static markup BEFORE the slot frame buttons
        // are inserted into, so without intervention it sits to the left of our
        // labelled buttons — which is what this records.
        order: [...(header?.querySelectorAll("button") ?? [])].map((b) => b.dataset.action),
        refWidth: ref ? Math.round(ref.getBoundingClientRect().width) : null,
        // Nothing of ours should be left in the ⋮ menu.
        menuHasOurs: !!header?.querySelector('[data-action="rollActor"], [data-action="toggleGeneration"]')
          && false, // placeholder; the menu is checked below by opening it
      };
    };

    const open = async (actor) => {
      await actor.sheet.render(true);
      for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 500));
      return actor.sheet;
    };

    /* --- a generated character: lands with Randomization OFF (the flipped
           default, stated explicitly by the generator) --- */
    const pc = await gen.createActorWithCharacter(await gen.generate2eCharacter());
    made.push(pc.id);
    const sheet = await open(pc);
    const initial = read(sheet);

    // Turn Randomization ON through the real button — the flag's only
    // user-reachable writer — then read the frame again.
    sheet.element.querySelector('button[data-action="toggleGeneration"]')?.click();
    await new Promise((r) => setTimeout(r, 900));
    const on = read(sheet);

    // A re-render that is NOT a generation change must leave them intact — this
    // is what catches the frame/content split going wrong.
    await pc.update({ "system.gold": (pc.system.gold ?? 0) + 1 });
    await new Promise((r) => setTimeout(r, 700));
    const afterUnrelated = read(sheet);

    // ...and off again, which is the round trip.
    sheet.element.querySelector('button[data-action="toggleGeneration"]')?.click();
    await new Promise((r) => setTimeout(r, 900));
    const offAgain = read(sheet);
    await sheet.close();

    /* --- a hireling: same control, different wording --- */
    const hire = await Actor.create({ name: "ZZ Header Hireling", type: "hireling" });
    made.push(hire.id);
    const hSheet = await open(hire);
    const hire2 = read(hSheet);
    await hSheet.close();

    /* --- an NPC: same header as the hireling since the type fold --- */
    const npc = await Actor.create({ name: "ZZ Header NPC", type: "npc" });
    made.push(npc.id);
    const nSheet = await open(npc);
    const npcRead = read(nSheet);
    await nSheet.close();

    /* --- a monster: Roll Monster, wearing the directory button's dragon.
           Seeded ON so the button is VISIBLE while its face is read. --- */
    const mon = await CONFIG.Actor.documentClass.create({
      name: "ZZ Header Monster", type: "npc", system: { role: "monster", generationEnabled: true },
    });
    made.push(mon.id);
    const mSheet = await open(mon);
    const monster = read(mSheet);
    await mSheet.close();

    /* --- a mount: a THING role builds NEITHER button (ruled 2026-08-02).
           Seeded generationEnabled: true — the adversarial fixture: an
           earlier toggle could have stored true before the role gate
           existed, and the role must win over the stale flag, or the body
           dice would be permanent (the toggle that turns them off is gone
           from this sheet). --- */
    const mount = await CONFIG.Actor.documentClass.create({
      name: "ZZ Header Mount", type: "npc",
      system: { role: "mount", containerClass: "horse", generationEnabled: true },
    });
    made.push(mount.id);
    const tSheet = await open(mount);
    const thing = read(tSheet);
    await tSheet.close();

    /* --- the WINDOW TITLE is frame state too, and had been left out.
           This sheet's title LEADS with the role word ("Monster: Bessie"),
           but core repaints a title only when the update diff carries `name`
           (api/document-sheet.mjs:163-166) — so a person re-typed under an
           open sheet kept announcing the old role until it was closed and
           reopened. Same fixture shape as everything above: read the frame,
           change one thing, read the frame again. The BUTTONS are the control
           — they were already kept in step here, so if they move and the
           title does not, the gap is the title's alone. --- */
    const retyped = await CONFIG.Actor.documentClass.create({
      name: "ZZ Header Retype", type: "npc", system: { role: "npc", generationEnabled: true },
    });
    made.push(retyped.id);
    const rSheet = await open(retyped);
    const titleNow = () => rSheet.element?.querySelector(".window-title")?.textContent?.trim() ?? null;
    const retype = {
      before: titleNow(),
      wantBefore: `${game.i18n.localize("CAIRN.RoleNpc")}: ${retyped.name}`,
      buttonsBefore: read(rSheet),
    };
    await retyped.update({ "system.role": "monster" });
    await new Promise((r) => setTimeout(r, 900));
    retype.after = titleNow();
    retype.wantAfter = `${game.i18n.localize("CAIRN.RoleMonster")}: ${retyped.name}`;
    retype.buttonsAfter = read(rSheet);
    await rSheet.close();

    for (const id of made) await game.actors.get(id)?.delete().catch(() => {});
    return { initial, on, afterUnrelated, offAgain, hireling: hire2, npc: npcRead, monster, thing, retype, NS };
  });

  const { initial, on, afterUnrelated, offAgain, hireling, npc, monster, thing, retype } = out;

  console.log("\ncharacter — a GENERATED actor opens with Randomization OFF");
  // THE NEW-DEFAULT LEG (2026-08-02). Its negative control is stashing
  // module/data-models.js + the generator payloads: the default reads On
  // again and all three of these go red.
  initial.toggle?.text === "Randomization: Off" && initial.toggle?.icon === "fa-toggle-off"
    ? ok("the toggle opens reading Off", `"${initial.toggle.text}"`)
    : fail("the toggle opens reading Off", `text="${initial.toggle?.text}" icon=${initial.toggle?.icon}`);
  initial.roll?.hidden === true
    ? ok("Roll Character opens hidden", "present in the frame, display:none")
    : fail("Roll Character opens hidden", `hidden=${initial.roll?.hidden}`);
  initial.bodyDice === 0
    ? ok("no sheet-body dice on a quiet sheet")
    : fail("no sheet-body dice on a quiet sheet", `${initial.bodyDice} dice rendered`);

  console.log("\nthe toggle is the way in — and updates the FRAME, which renders once");
  on.roll && on.toggle
    ? ok("both buttons are in .window-header", `"${on.roll.text}" | "${on.toggle.text}"`)
    : fail("both buttons are in .window-header", `roll=${JSON.stringify(on.roll)} toggle=${JSON.stringify(on.toggle)}`);
  on.roll?.text === "Roll Character" && on.roll?.hidden === false
    ? ok("Roll Character appears, with visible text")
    : fail("Roll Character appears, with visible text", `text="${on.roll?.text}" hidden=${on.roll?.hidden}`);
  on.toggle?.text === "Randomization: On" && on.toggle?.icon === "fa-toggle-on"
    ? ok("the toggle reads its state, not a tooltip")
    : fail("the toggle reads its state", `text="${on.toggle?.text}"`);
  on.bodyDice > 0
    ? ok("the sheet-body dice arrive with it", `${on.bodyDice} dice`)
    : fail("the sheet-body dice arrive with it", "none rendered");

  // Text assertions pass on a clipped label, so read the geometry too. Both
  // buttons must show their whole label AND stay inside the title bar — this is
  // the pair that would catch someone pinning a width, or the labels growing
  // past a 600px header. Read in the ON state, where Roll is visible.
  !on.roll?.clipped && !on.toggle?.clipped
    ? ok("neither label is clipped", `${on.roll?.width}px / ${on.toggle?.width}px (icon button: ${on.refWidth}px)`)
    : fail("neither label is clipped",
        `roll clipped=${on.roll?.clipped} toggle clipped=${on.toggle?.clipped}`);
  !on.roll?.overflowsHeader && !on.toggle?.overflowsHeader
    ? ok("both stay inside the title bar")
    : fail("both stay inside the title bar",
        `roll=${on.roll?.overflowsHeader} toggle=${on.toggle?.overflowsHeader}`);
  afterUnrelated.roll?.text === "Roll Character" && afterUnrelated.toggle?.text === "Randomization: On"
    ? ok("an unrelated re-render leaves them intact", "gold changed; header unchanged")
    : fail("an unrelated re-render leaves them intact", JSON.stringify(afterUnrelated));
  offAgain.roll?.hidden === true && offAgain.toggle?.text === "Randomization: Off"
    ? ok("switching back off hides Roll again", "the round trip holds")
    : fail("switching back off hides Roll again", JSON.stringify(offAgain));

  console.log("\nper actor type");
  hireling.roll?.text === "Roll NPC"
    ? ok('a hireling reads "Roll NPC"', hireling.roll.text)
    : fail('a hireling reads "Roll NPC"', `text="${hireling.roll?.text}"`);
  hireling.toggle?.text === "Randomization: Off" && hireling.roll?.hidden === true
    ? ok("a bare hireling opens Off too", "the schema initial, not the generator")
    : fail("a bare hireling opens Off too", JSON.stringify({ toggle: hireling.toggle?.text, hidden: hireling.roll?.hidden }));
  // This used to assert an NPC sheet had NEITHER button, and it was correct when
  // written -- `hireling` and `npc` were separate types and only the hireling got
  // generation controls. The Hireling->NPC fold (1d2a214) made them one type
  // discriminated by `system.role`, so a plain NPC now carries the same header,
  // and f674730 answered the danger that creates -- a one-click no-undo wipe of any
  // of the 205 shipped monsters -- by making Roll NPC CONFIRM rather than by hiding
  // it. `dev:roll-npc` owns that confirmation; this probe owns the header.
  //
  // The stale assertion outlived the design by a day and stayed red, which is the
  // real lesson: an expectation written against a type split has to be revisited
  // when the split goes away, or the gate reports a decision as a defect.
  npc.roll?.text === "Roll NPC" && npc.toggle?.text?.startsWith("Randomization")
    ? ok("an NPC sheet gets the same header as a hireling", `"${npc.roll.text}" | "${npc.toggle.text}"`)
    : fail("an NPC sheet gets the same header as a hireling",
      JSON.stringify({ roll: npc.roll, toggle: npc.toggle }));
  // A monster's Roll button says what its click does — the tier picker — and
  // wears the SAME dragon as the directory's Generate Monster button. Seeded
  // On, so this also proves the flag is per-actor, not global.
  monster.roll?.text === "Roll Monster" && monster.roll?.icon === "fa-dragon" && monster.roll?.hidden === false
    ? ok('a monster reads "Roll Monster"', `${monster.roll.icon}, visible`)
    : fail('a monster reads "Roll Monster"', JSON.stringify(monster.roll));
  // THE THING LEG (2026-08-02, by ruling): mount, transport and container
  // have nothing to randomize, so neither button is BUILT — and no body
  // dice render even though the fixture STORES generationEnabled: true.
  // Two separate gates, two separate reds: the buttons are
  // _getFrameButtons' role test, the dice are the context flag's.
  !thing.roll && !thing.toggle
    ? ok("a mount builds neither button", "the role gate in _getFrameButtons")
    : fail("a mount builds neither button", JSON.stringify({ roll: thing.roll, toggle: thing.toggle }));
  thing.bodyDice === 0
    ? ok("no body dice despite a stored true flag", "context.generationEnabled is role-gated")
    : fail("no body dice despite a stored true flag", `${thing.bodyDice} dice rendered`);
  thing.popOut?.text === "Pop Out"
    ? ok("Pop Out survives on a thing", "the gate takes only the generation pair")
    : fail("Pop Out survives on a thing", JSON.stringify(thing.popOut));

  // THE HARD-LOCK GUARD: with `show-generate-header` off, the Roll button is
  // not built at all — but the toggle MUST be, because it is the flag's only
  // user-reachable writer and the default is Off now. Before 2026-08-02 the
  // setting removed both, which would have made Off permanent for the world.
  // Setting flipped and RESTORED inside one evaluate's finally, so an aborted
  // leg cannot leave the world's header controls off.
  console.log("\nshow-generate-header off: the toggle survives");
  const lockOut = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    let a = null;
    try {
      await game.settings.set("air-bladder", "show-generate-header", false);
      a = await Cls.create({ name: "ZZ Header Lock", type: "character" });
      await a.sheet.render(true);
      for (let i = 0; i < 40 && !a.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 500));
      const header = a.sheet.element?.querySelector(".window-header");
      return {
        rollExists: !!header?.querySelector('button[data-action="rollActor"]'),
        toggleExists: !!header?.querySelector('button[data-action="toggleGeneration"]'),
      };
    } finally {
      await game.settings.set("air-bladder", "show-generate-header", true);
      await a?.sheet?.close();
      await a?.delete();
    }
  });
  !lockOut.rollExists && lockOut.toggleExists
    ? ok("Roll is not built; the toggle still is", "the only way back On cannot be hidden")
    : fail("Roll is not built; the toggle still is", JSON.stringify(lockOut));

  console.log("\nPop Out");
  initial.popOut?.text === "Pop Out"
    ? ok("Pop Out carries visible text", `${initial.popOut.width}px`)
    : fail("Pop Out carries visible text", `text="${initial.popOut?.text}"`);
  // It is core's `detach` action, not one of ours -- if this ever stops being
  // true, the button has quietly become something we have to maintain.
  initial.popOut && initial.canDetach
    ? ok("wired to core's detach action", 'data-action="detach", _canDetach() true')
    : fail("wired to core's detach action", `canDetach=${initial.canDetach}`);
  !initial.popOut?.clipped && !initial.popOut?.overflowsHeader && initial.popOut?.hidden === false
    ? ok("shown, unclipped, inside the title bar")
    : fail("shown, unclipped, inside the title bar", JSON.stringify(initial.popOut));
  // Pop Out is core's, not ours, so it must survive independently of the generation
  // header -- proven below by the Randomization-off case, where Roll Character hides
  // and Pop Out does not.
  npc.popOut?.text === "Pop Out"
    ? ok("an NPC sheet still gets it", "not gated by show-generate-header")
    : fail("an NPC sheet still gets it", `popOut=${JSON.stringify(npc.popOut)}`);
  offAgain.popOut?.hidden === false
    ? ok("Randomization off leaves it alone", "only Roll Character hides")
    : fail("Randomization off leaves it alone", `hidden=${offAgain.popOut?.hidden}`);

  console.log("\ntitle-bar order");
  // ⋮ and ✕ are the chrome; everything labelled belongs to the left of them.
  const order = initial.order ?? [];
  const iMenu = order.indexOf("toggleControls");
  const labelled = ["rollActor", "toggleGeneration", "detach"].map((a) => order.indexOf(a));
  iMenu > -1 && labelled.every((i) => i > -1 && i < iMenu)
    ? ok("⋮ sits to the right of our buttons", order.join(" "))
    : fail("⋮ sits to the right of our buttons", order.join(" "));
  order.at(-1) === "close"
    ? ok("✕ stays last", order.join(" "))
    : fail("✕ stays last", order.join(" "));

  /* --- Pop Out actually pops out ---------------------------------------- */
  // Rendering a button labelled "Pop Out" proves nothing about detaching, and
  // detaching is the entire feature. So click it for real and follow the sheet
  // into the browser window it opens.
  //
  // Every wait here POLLS the condition instead of sleeping: the move settled
  // anywhere between 1.0s and 2.5s across runs, so a fixed delay would report a
  // slow machine as a broken feature.
  console.log("\nPop Out detaches for real");
  const info = await page.evaluate(async () => {
    const actor = await Actor.create({ name: "ZZ Header Detach", type: "character" });
    await actor.sheet.render(true);
    for (let i = 0; i < 40 && !actor.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 500));
    return { sheetId: actor.sheet.element.id, actorId: actor.id };
  });

  const [popup] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 20000 }).catch(() => null),
    page.locator(`#${info.sheetId} .window-header button[data-action="detach"]`).click(),
  ]);
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate((id) => !!foundry.applications.instances.get(id)?.window?.windowId, info.sheetId)) break;
    await page.waitForTimeout(500);
  }
  const detached = await page.evaluate((i) => {
    const app = foundry.applications.instances.get(i.sheetId);
    return {
      windowId: app?.window?.windowId ?? null,
      leftMainDocument: !document.getElementById(i.sheetId),
      popOutHidden: app?.element?.querySelector('button[data-action="detach"]')
        ?.classList.contains("cairn-header-hidden") ?? null,
    };
  }, info);

  popup ? ok("clicking it opens a window", await popup.title().catch(() => "?"))
        : fail("clicking it opens a window", "no popup within 20s");
  detached.windowId && detached.leftMainDocument
    ? ok("the sheet moves into that window", detached.windowId)
    : fail("the sheet moves into that window", JSON.stringify(detached));
  // _onDetach, not _updateFrame: the latter runs before the move completes and
  // leaves the button showing on an already-detached sheet.
  detached.popOutHidden === true
    ? ok("Pop Out hides once detached", "_onDetach fired after the move settled")
    : fail("Pop Out hides once detached", `popOutHidden=${detached.popOutHidden}`);

  const reattached = await page.evaluate(async (i) => {
    const app = foundry.applications.instances.get(i.sheetId);
    await app.attachWindow();
    for (let n = 0; n < 40 && app.window.windowId; n++) await new Promise((r) => setTimeout(r, 500));
    const res = {
      windowId: app.window.windowId ?? null,
      backInMainDocument: !!document.getElementById(i.sheetId),
      popOutHidden: app.element?.querySelector('button[data-action="detach"]')
        ?.classList.contains("cairn-header-hidden") ?? null,
    };
    await app.close();
    await game.actors.get(i.actorId)?.delete();
    return res;
  }, info);

  !reattached.windowId && reattached.backInMainDocument && reattached.popOutHidden === false
    ? ok("re-docking brings it back", "_onAttach")
    : fail("re-docking brings it back", JSON.stringify(reattached));

  console.log("\nre-typed under an open sheet — the TITLE is frame state too");
  retype.before === retype.wantBefore
    ? ok("a person's sheet opens naming its role", `"${retype.before}"`)
    : fail("a person's sheet opens naming its role", `"${retype.before}" want "${retype.wantBefore}"`);
  // The control, and it is the point of putting this leg in THIS probe: the
  // buttons already followed the role. If they move and the title does not,
  // the render happened and the title alone was left behind.
  retype.buttonsBefore?.roll?.text !== retype.buttonsAfter?.roll?.text
    && retype.buttonsAfter?.roll?.icon === "fa-dragon"
    ? ok("control: the Roll button follows the role", `"${retype.buttonsBefore?.roll?.text}" → "${retype.buttonsAfter?.roll?.text}"`)
    : fail("control: the Roll button follows the role",
        `before="${retype.buttonsBefore?.roll?.text}" after="${retype.buttonsAfter?.roll?.text}" icon=${retype.buttonsAfter?.roll?.icon}`);
  retype.after === retype.wantAfter
    ? ok("and so does the window title", `"${retype.after}"`)
    : fail("and so does the window title", `"${retype.after}" want "${retype.wantAfter}" — stale until the sheet is reopened`);
} catch (e) {
  fail("probe threw", `${e.name}: ${e.message}`);
} finally {
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nFAILED (${failures})\n` : "\nheader buttons probe passed\n");
process.exit(failures ? 1 : 0);

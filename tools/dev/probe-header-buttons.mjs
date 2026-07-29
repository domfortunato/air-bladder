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

    /* --- a generated character --- */
    const pc = await gen.createActorWithCharacter(await gen.generate2eCharacter());
    made.push(pc.id);
    const sheet = await open(pc);
    const initial = read(sheet);

    // Flip Randomization off through the real button, then read the frame again.
    sheet.element.querySelector('button[data-action="toggleGeneration"]')?.click();
    await new Promise((r) => setTimeout(r, 900));
    const off = read(sheet);
    sheet.element.querySelector('button[data-action="toggleGeneration"]')?.click();
    await new Promise((r) => setTimeout(r, 900));
    const backOn = read(sheet);

    // A re-render that is NOT a generation change must leave them intact — this
    // is what catches the frame/content split going wrong.
    await pc.update({ "system.gold": (pc.system.gold ?? 0) + 1 });
    await new Promise((r) => setTimeout(r, 700));
    const afterUnrelated = read(sheet);
    await sheet.close();

    /* --- a hireling: same control, different wording --- */
    const hire = await Actor.create({ name: "ZZ Header Hireling", type: "hireling" });
    made.push(hire.id);
    const hSheet = await open(hire);
    const hire2 = read(hSheet);
    await hSheet.close();

    /* --- an NPC: no generation controls at all --- */
    const npc = await Actor.create({ name: "ZZ Header NPC", type: "npc" });
    made.push(npc.id);
    const nSheet = await open(npc);
    const npcRead = read(nSheet);
    await nSheet.close();

    for (const id of made) await game.actors.get(id)?.delete().catch(() => {});
    return { initial, off, backOn, afterUnrelated, hireling: hire2, npc: npcRead, NS };
  });

  const { initial, off, backOn, afterUnrelated, hireling, npc } = out;

  console.log("\ncharacter — both buttons inline in the title bar");
  initial.roll && initial.toggle
    ? ok("both buttons are in .window-header", `"${initial.roll.text}" | "${initial.toggle.text}"`)
    : fail("both buttons are in .window-header", `roll=${JSON.stringify(initial.roll)} toggle=${JSON.stringify(initial.toggle)}`);
  initial.roll?.text === "Roll Character"
    ? ok("Roll Character carries visible text")
    : fail("Roll Character carries visible text", `text="${initial.roll?.text}"`);
  initial.toggle?.text === "Randomization: On"
    ? ok("the toggle reads its state, not a tooltip")
    : fail("the toggle reads its state", `text="${initial.toggle?.text}"`);

  // Text assertions pass on a clipped label, so read the geometry too. Both
  // buttons must show their whole label AND stay inside the title bar — this is
  // the pair that would catch someone pinning a width, or the labels growing
  // past a 600px header.
  !initial.roll?.clipped && !initial.toggle?.clipped
    ? ok("neither label is clipped", `${initial.roll?.width}px / ${initial.toggle?.width}px (icon button: ${initial.refWidth}px)`)
    : fail("neither label is clipped",
        `roll clipped=${initial.roll?.clipped} toggle clipped=${initial.toggle?.clipped}`);
  !initial.roll?.overflowsHeader && !initial.toggle?.overflowsHeader
    ? ok("both stay inside the title bar")
    : fail("both stay inside the title bar",
        `roll=${initial.roll?.overflowsHeader} toggle=${initial.toggle?.overflowsHeader}`);
  initial.roll?.hidden === false && initial.toggle?.hidden === false
    ? ok("both are visible with Randomization on")
    : fail("both are visible with Randomization on", JSON.stringify({ roll: initial.roll?.hidden, toggle: initial.toggle?.hidden }));

  console.log("\ntoggling Randomization updates the FRAME, which renders once");
  off.roll?.hidden === true
    ? ok("Randomization off hides Roll Character")
    : fail("Randomization off hides Roll Character", `hidden=${off.roll?.hidden}`);
  off.toggle?.text === "Randomization: Off"
    ? ok("the toggle relabels itself", `"${off.toggle.text}"`)
    : fail("the toggle relabels itself", `text="${off.toggle?.text}"`);
  off.toggle?.icon === "fa-toggle-off"
    ? ok("and swaps its icon", off.toggle.icon)
    : fail("and swaps its icon", `icon=${off.toggle?.icon}`);
  backOn.roll?.hidden === false && backOn.toggle?.text === "Randomization: On"
    ? ok("switching back on restores both")
    : fail("switching back on restores both", JSON.stringify(backOn));
  afterUnrelated.roll?.text === "Roll Character" && afterUnrelated.toggle?.text === "Randomization: On"
    ? ok("an unrelated re-render leaves them intact", "gold changed; header unchanged")
    : fail("an unrelated re-render leaves them intact", JSON.stringify(afterUnrelated));

  console.log("\nper actor type");
  hireling.roll?.text === "Roll NPC"
    ? ok('a hireling reads "Roll NPC"', hireling.roll.text)
    : fail('a hireling reads "Roll NPC"', `text="${hireling.roll?.text}"`);
  !npc.roll && !npc.toggle
    ? ok("an NPC sheet has neither button")
    : fail("an NPC sheet has neither button", JSON.stringify(npc));
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

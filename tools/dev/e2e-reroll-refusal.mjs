#!/usr/bin/env node
/**
 * The Roll Character checklist refuses WHOLE, or not at all (review #21
 * finding 1).
 *
 *   node tools/dev/e2e-reroll-refusal.mjs   (needs Foundry running, world
 *   launched, and `npm run dev:players` — the leg needs Alice)
 *
 * `canRegenerateContainers` refuses a non-GM whose character holds a granted
 * container (a container is an Actor, and Foundry gates Actor deletion on
 * ASSISTANT). The checklist rides the same per-field paths as the sheet dice,
 * and before the fix it DISCARDED their refusal signals: a player's
 * all-checked run kept the background (refused) while re-dealing the bonds,
 * re-rolling the statline, swapping the portrait and clearing armorOverride —
 * a half-applied gesture no one asked for. A GM passes every ownership check
 * and can never reproduce this, so the probe joins as Alice.
 *
 * Legs, each snapshot-compared (dice seeded to max faces so "nothing changed"
 * can only pass by NOT rolling, never by rolling the same numbers):
 *   A. All-checked (Background checked): the container refusal warns
 *      (CAIRN.Notify.NoContainerRegen) and NOTHING changes — no bond
 *      re-deal, no statline, no portrait, no armorOverride wipe.
 *   B. Background unchecked, gear + STR checked: the scoped refusal warns
 *      (CAIRN.Notify.NoContainerBackground) and nothing changes — before the
 *      fix the gear was refused but STR still re-rolled.
 *
 * Red-first record: both legs failed on the unfixed build (warn fired but the
 * snapshot moved) — the refusal-signal plumbing is what makes them pass.
 * World state (one setting, every planted actor) is restored from Node.
 * Exits non-zero on any failed assertion or console error.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(300000, "reroll refusal probe");

const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const gmErrors = watchErrors(gm);
await joinAsGM(gm);
await dismissChrome(gm);

let saved = null;
let aliceErrors = [];

try {
  /* --- setup, as GM ---------------------------------------------------------- */

  const setup = await gm.evaluate(async () => {
    const NS = "air-bladder";
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    // A stale actor from an aborted run would satisfy every precondition below
    // without this run having established any of them.
    for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ RerollRef"))) await a.delete();

    const alice = game.users.getName("Alice");
    if (!alice) return { error: 'no user named "Alice" — run `npm run dev:players` first' };

    const out = {
      saved: { playerRandomization: game.settings.get(NS, "allow-player-randomization") },
      regenWarning: game.i18n.localize("CAIRN.Notify.NoContainerRegen"),
      bgWarning: game.i18n.localize("CAIRN.Notify.NoContainerBackground"),
    };
    // Alice needs the Roll Character button at all.
    await game.settings.set(NS, "allow-player-randomization", true);

    const pack = game.packs.get("air-bladder.backgrounds-2e");
    if (!pack) return { error: "no backgrounds-2e pack in this world" };
    const bgs = await pack.getDocuments();
    const fieldwarden = bgs.find((b) => b.name === "Fieldwarden");
    if (!fieldwarden) return { error: "Fieldwarden background missing" };

    const pc = await CONFIG.Actor.documentClass.create({
      name: "ZZ RerollRef PC", type: "character",
      system: { generationEnabled: true },
      ownership: { [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    });
    // A real background with real grants, so the checklist has children worth
    // keeping. As GM this cannot be refused.
    await gen.changeBackground(pc, fieldwarden);
    // Distinct scalars AFTER the swap (it trades question gold), so any
    // re-roll shows. Seeded dice land 18/18/18 and age 50, never these.
    await pc.update({
      "system.abilities.STR": { value: 10, max: 10 },
      "system.abilities.DEX": { value: 10, max: 10 },
      "system.abilities.WIL": { value: 10, max: 10 },
      "system.hp": { value: 4, max: 4 },
      "system.gold": 7,
      "system.age": "30",
      "system.armorOverride": 1,
    });

    // THE PRECONDITION: a granted container. `grantSource: "background"`
    // reaches both the unscoped check (leg A) and the "background"-scoped one
    // (leg B).
    await CONFIG.Actor.documentClass.create({
      name: "ZZ RerollRef Granted Mule", type: "npc",
      system: { role: "mount", containerClass: "mule", connectedTo: pc.uuid, generationEnabled: false },
      flags: { [NS]: { grantSource: "background" } },
    });

    out.actorId = pc.id;
    out.granted = game.actors.filter(
      (a) => a.system?.connectedTo === pc.uuid && a.getFlag(NS, "grantSource")).length;
    out.items = pc.items.size;
    return out;
  });

  if (setup.error) {
    fail(`setup: ${setup.error}`);
    throw new Error(setup.error);
  }
  saved = setup.saved;
  console.log(`\nsetup: Alice's character holds ${setup.granted} granted container(s), ${setup.items} item(s)`);
  if (!setup.granted) {
    fail("no granted container — canRegenerateContainers has nothing to refuse, "
      + "so neither leg can fail and neither is evidence");
  }
  if (!setup.items) {
    fail("the background swap granted no items — a 'nothing changed' snapshot of an "
      + "empty inventory is weak evidence");
  }

  /* --- the legs, as Alice ----------------------------------------------------- */

  const alice = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
  aliceErrors = watchErrors(alice);
  await joinAs(alice, "Alice");
  await dismissChrome(alice);

  const runLeg = (states) => alice.evaluate(async ({ actorId, states }) => {
    const actor = game.actors.get(actorId);
    if (!actor) return { error: "Alice cannot see the test character" };
    if (!actor.isOwner) return { error: "Alice does not own the test character" };
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitFor = async (test, ms = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const v = test(); if (v) return v; await wait(100); }
      return false;
    };

    const sheet = actor.sheet;
    await sheet.render(true);
    await wait(800);
    const root = sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0];

    const snapshot = () => JSON.stringify({
      name: actor.name,
      img: actor.img,
      system: actor.toObject().system,
      items: actor.items.map((i) => `${i.id}:${i.name}:${i.sort}`).sort(),
      flags: actor.flags?.["air-bladder"] ?? {},
    });

    const warns = [];
    const origWarn = ui.notifications.warn.bind(ui.notifications);
    ui.notifications.warn = (m, ...r) => { warns.push(String(m)); return origWarn(m, ...r); };
    const origUniform = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;   // max faces: a roll that happens SHOWS
    const before = snapshot();
    try {
      root?.closest(".application")?.querySelector('.window-header button[data-action="rollActor"]')?.click();
      const dlg = await waitFor(() => document.querySelector(".reroll-dialog"), 10000);
      if (!dlg) return { error: "the checklist never opened for Alice" };
      // Parents first — a child is disabled while its parent is checked.
      const order = ["background", "failedCareer",
        ...Object.keys(states).filter((k) => k !== "background" && k !== "failedCareer")];
      for (const k of order) {
        if (!(k in states)) continue;
        const input = dlg.querySelector(`input[name="${k}"]`);
        if (input && input.checked !== states[k] && !input.disabled) input.click();
      }
      dlg.closest(".application")?.querySelector('button[data-action="reroll"]')?.click();
      await waitFor(() => !document.querySelector(".reroll-dialog"), 5000);
      await waitFor(() => sheet._rerolling === false, 30000);
      await wait(1500);
    } finally {
      CONFIG.Dice.randomUniform = origUniform;
      ui.notifications.warn = origWarn;
    }
    const res = {
      warns: [...warns],
      unchanged: snapshot() === before,
      rerollingCleared: sheet._rerolling === false,
    };
    await sheet.close();
    return res;
  }, { actorId: setup.actorId, states });

  console.log("\nA. all-checked — the unscoped container refusal must stop the whole gesture");
  const a = await runLeg({ background: true });
  if (a.error) fail(`leg A: ${a.error}`);
  else {
    a.warns.some((w) => w === setup.regenWarning)
      ? ok(`refused in the regenerate wording ("${setup.regenWarning.slice(0, 40)}…")`)
      : fail(`leg A warns: ${JSON.stringify(a.warns)}`);
    a.unchanged
      ? ok("and NOTHING changed — no bonds, no statline, no portrait, no armorOverride wipe")
      : fail("leg A: the refused gesture still changed the character (the half-applied defect)");
    a.rerollingCleared ? ok("the sheet's guard is released") : fail("leg A: _rerolling stayed latched");
  }

  console.log("\nB. Background unchecked, gear + STR checked — the scoped refusal, same rule");
  // Re-establish the baseline leg A may have wrecked (on the unfixed build it
  // left STR at the seeded 18 and armorOverride null — exactly the values leg
  // B's seeded re-roll would land on, which made leg B pass vacuously on the
  // first red run).
  await gm.evaluate(async (actorId) => {
    await game.actors.get(actorId)?.update({
      "system.abilities.STR": { value: 10, max: 10 },
      "system.armorOverride": 1,
    });
  }, setup.actorId);
  const allOff = { background: false, gear: false, question0: false, question1: false, bonds: false,
    STR: false, DEX: false, WIL: false, hp: false, gold: false, age: false, traits: false,
    portrait: false, omen: false, name: false };
  const b = await runLeg({ ...allOff, gear: true, STR: true });
  if (b.error) fail(`leg B: ${b.error}`);
  else {
    b.warns.some((w) => w === setup.bgWarning)
      ? ok("refused in the background swap's own words")
      : fail(`leg B warns: ${JSON.stringify(b.warns)}`);
    b.unchanged
      ? ok("and nothing changed — the refused gear row did not leave STR re-rolled")
      : fail("leg B: the gesture half-applied (gear refused, statline moved)");
  }

  await alice.context().close();
} finally {
  await gm.evaluate(async (saved) => {
    const NS = "air-bladder";
    for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ RerollRef"))) {
      try { await a.delete(); } catch { /* already gone */ }
    }
    if (saved) await game.settings.set(NS, "allow-player-randomization", saved.playerRandomization);
  }, saved).catch((e) => fail(`could not restore world state: ${e.message}`));
}

const errors = [...gmErrors, ...aliceErrors];
if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "REROLL REFUSAL PROBE FAILED" : "Reroll refusal probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

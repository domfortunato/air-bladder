#!/usr/bin/env node
/**
 * The Roll Character choose-what-to-re-roll dialog (2026-09-02, user ask).
 *
 *   node tools/dev/e2e-reroll-dialog.mjs   (needs Foundry running, world launched)
 *
 * The title-bar Roll Character button no longer nukes-and-rebuilds behind a
 * yes/no: it opens a checklist of everything re-rollable, all checked by
 * default, and re-rolls only what stays checked. Questions and starting gear
 * are CHILDREN of Background (a new Background deals its own), Bonds is
 * top-level but rides the Background box too (the entitlement is the
 * Background's), and Background itself defaults UNCHECKED when the player
 * hand-picked it — recorded by the new provenance flag
 * `flags.air-bladder.backgroundChosen`, written wherever a background lands.
 *
 * Steps, driven headless as GM:
 *   1. ROWS. A 2e character (omen enabled) lists name / background with
 *      gear + both questions indented under it / bonds / STR / DEX / WIL /
 *      HP / gold / age / traits / portrait / omen — and both notes. A
 *      Barebones character lists failed career + keepsake instead of
 *      bonds/questions/omen, and no questions note.
 *   2. DEFAULTS. Generation with a CHOSEN background stamps the flag true and
 *      the dialog opens with Background unchecked (children live); flag false
 *      (rolled) and flag absent (legacy) both open all-checked.
 *   3. GATING. Checking Background checks + disables its children AND the
 *      Bonds row; unchecking frees them. Failed career gates its keepsake.
 *   4. PARTIAL. With dice seeded to max faces, re-rolling only the six
 *      stat fields changes exactly those (18/18/18, HP 6, gold 18 + grants,
 *      a new age) while name, background, gear, questions, bonds and traits
 *      survive BY VALUE. Unchecking everything changes nothing at all.
 *   5. FULL. The all-checked default re-rolls the background (uuid changes)
 *      and posts ONE chat message carrying the five generation Rolls.
 *   6. PROVENANCE. changeBackground(null) stamps rolled, changeBackground(bg)
 *      stamps chosen; generation follows chosenBg; a matched Kettlewright
 *      import stamps chosen and an unmatched one stamps nothing.
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
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const made = [];
    const track = (a) => { if (a) made.push(a); return a; };
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitFor = async (test, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const v = test(); if (v) return v; await wait(100); }
      return false;
    };
    const NS = "air-bladder";
    const out = {};
    const t0Message = game.messages.contents.at(-1)?.id ?? null;

    // Preconditions, established and restored: the omen row visible, the
    // Barebones failed career minted, the generation card posted.
    const was = {
      showOmens: game.settings.get(NS, "show-omens"),
      failedCareer: game.settings.get(NS, "barebones-failed-career"),
      genRolls: game.settings.get(NS, "show-generation-rolls"),
    };
    const origUniform = CONFIG.Dice.randomUniform;
    try {
      await game.settings.set(NS, "show-omens", true);
      await game.settings.set(NS, "barebones-failed-career", true);
      await game.settings.set(NS, "show-generation-rolls", true);

      // A 2e character generated FROM a chosen background — the chosen-
      // provenance path, and Fieldwarden's two bonds make the bond re-deal
      // observable.
      const bgs = (await gen.getBackgroundsByArchetype("2e")).flatMap((g) => g.backgrounds);
      const fieldwarden = bgs.find((b) => b.name === "Fieldwarden");
      const actor = track(await gen.createActorWithCharacter(await gen.generate2eCharacter(fieldwarden)));
      for (const c of game.actors.filter((a) => a.system?.connectedTo === actor.uuid)) made.push(c);
      await actor.update({ "system.generationEnabled": true, "system.omenEnabled": true, "system.omen": "the sky is a lid" });

      const sheet = actor.sheet;
      await sheet.render(true);
      await wait(800);
      const rootOf = (s) => (s.element instanceof HTMLElement ? s.element : s.element?.[0]);

      const openDialog = async (s) => {
        const btn = rootOf(s)?.closest(".application")
          ?.querySelector('.window-header button[data-action="rollActor"]');
        btn?.click();
        return waitFor(() => document.querySelector(".reroll-dialog"), 10000);
      };
      const closeDialog = async (dlg) => {
        dlg?.closest(".application")?.querySelector('button[data-action="cancel"]')?.click();
        await waitFor(() => !document.querySelector(".reroll-dialog"), 5000);
        await wait(200);
      };
      const dialogState = (dlg) => {
        const rows = {};
        for (const input of dlg.querySelectorAll('.reroll-row input[type="checkbox"]')) {
          rows[input.name] = { checked: input.checked, disabled: input.disabled };
        }
        return rows;
      };
      // Set checkbox states via clicks (so the gating listener runs), parents
      // first — a child is disabled while its parent is checked.
      const applyStates = (dlg, states) => {
        const order = ["background", "failedCareer",
          ...Object.keys(states).filter((k) => k !== "background" && k !== "failedCareer")];
        for (const k of order) {
          if (!(k in states)) continue;
          const input = dlg.querySelector(`input[name="${k}"]`);
          if (input && input.checked !== states[k] && !input.disabled) input.click();
        }
      };
      const reroll = async (dlg, s) => {
        dlg.closest(".application")?.querySelector('button[data-action="reroll"]')?.click();
        await waitFor(() => !document.querySelector(".reroll-dialog"), 5000);
        await waitFor(() => s._rerolling === false, 30000);
        await wait(300);
      };

      // ---- 2 + 6a. Generation from a chosen background stamps chosen ------
      out.provenanceGenerated = actor.getFlag(NS, "backgroundChosen");

      // ---- 1. The 2e rows and the notes -----------------------------------
      let dlg = await openDialog(sheet);
      out.opened2e = !!dlg;
      if (dlg) {
        out.rows2e = [...dlg.querySelectorAll(".reroll-row")].map((row) => row.dataset.part);
        const kids = dlg.querySelector('.reroll-children[data-parent="background"]');
        out.childRows = kids ? [...kids.querySelectorAll(".reroll-row")].map((row) => row.dataset.part) : [];
        out.notes2e = {
          questions: dlg.querySelector(".reroll-note-questions")?.textContent?.trim() ?? "",
          pick: dlg.querySelector(".reroll-note-pick")?.textContent?.trim() ?? "",
        };
        // Chosen background → Background unchecked, its children live.
        const s = dialogState(dlg);
        out.defaultChosen = {
          background: s.background,
          gear: s.gear,
          name: s.name,
          bonds: s.bonds,
          omenListed: "omen" in s,
        };

        // ---- 3. Gating: check Background → children + Bonds gray ----------
        applyStates(dlg, { background: true });
        const g = dialogState(dlg);
        out.gatedOn = { gear: g.gear, question0: g.question0, question1: g.question1, bonds: g.bonds };
        applyStates(dlg, { background: false });
        const f = dialogState(dlg);
        out.gatedOff = { gear: f.gear, bonds: f.bonds };
        await closeDialog(dlg);
      }

      // ---- 2b. Rolled (flag false) and legacy (flag absent) → all checked -
      await actor.setFlag(NS, "backgroundChosen", false);
      dlg = await openDialog(sheet);
      out.defaultRolled = dlg ? dialogState(dlg).background : null;
      if (dlg) await closeDialog(dlg);
      await actor.unsetFlag(NS, "backgroundChosen");
      dlg = await openDialog(sheet);
      out.defaultLegacy = dlg ? dialogState(dlg).background : null;
      if (dlg) await closeDialog(dlg);
      await actor.setFlag(NS, "backgroundChosen", false);

      // ---- 4a. Nothing checked → nothing changes --------------------------
      const snapshot = () => JSON.stringify({
        name: actor.name,
        img: actor.img,
        system: actor.toObject().system,
        items: actor.items.map((i) => i.id).sort(),
      });
      const before = snapshot();
      dlg = await openDialog(sheet);
      if (dlg) {
        applyStates(dlg, Object.fromEntries(Object.keys(dialogState(dlg)).map((k) => [k, false])));
        await reroll(dlg, sheet);
      }
      await wait(1200);
      out.nothingChanged = snapshot() === before;

      // ---- 4b. Partial: only the six stat fields, dice pinned to max ------
      await actor.update({
        "system.abilities.STR": { value: 10, max: 10 },
        "system.abilities.DEX": { value: 10, max: 10 },
        "system.abilities.WIL": { value: 10, max: 10 },
        "system.hp": { value: 4, max: 4 },
        "system.gold": 7,
        "system.age": "30",
      });
      const keep = {
        name: actor.name,
        backgroundUuid: actor.system.backgroundUuid,
        questions: JSON.stringify(actor.system.questions),
        bonds: JSON.stringify(actor.system.bonds),
        traits: JSON.stringify(actor.system.traits),
        items: actor.items.map((i) => i.id).sort().join(","),
        omen: actor.system.omen,
        img: actor.img,
      };
      CONFIG.Dice.randomUniform = () => 0;   // ceil((1-0)*faces) = max face
      try {
        dlg = await openDialog(sheet);
        if (dlg) {
          const all = Object.fromEntries(Object.keys(dialogState(dlg)).map((k) => [k, false]));
          applyStates(dlg, { ...all, STR: true, DEX: true, WIL: true, hp: true, gold: true, age: true });
          await reroll(dlg, sheet);
        }
      } finally {
        CONFIG.Dice.randomUniform = origUniform;
      }
      const bondGold = (actor.system.bonds ?? []).reduce((n, b) => n + (b.gold ?? 0), 0);
      const qGold = (actor.system.questions ?? []).reduce((n, q) => n + (q.gold ?? 0), 0);
      out.partial = {
        STR: actor.system.abilities.STR.value, STRmax: actor.system.abilities.STR.max,
        DEX: actor.system.abilities.DEX.value, WIL: actor.system.abilities.WIL.value,
        hp: actor._source.system.hp.value, hpMax: actor._source.system.hp.max,
        gold: actor.system.gold, wantGold: 18 + bondGold + qGold,
        ageChanged: actor.system.age !== "30" && actor.system.age !== "",
        kept: {
          name: actor.name === keep.name,
          backgroundUuid: actor.system.backgroundUuid === keep.backgroundUuid,
          questions: JSON.stringify(actor.system.questions) === keep.questions,
          bonds: JSON.stringify(actor.system.bonds) === keep.bonds,
          traits: JSON.stringify(actor.system.traits) === keep.traits,
          items: actor.items.map((i) => i.id).sort().join(",") === keep.items,
          omen: actor.system.omen === keep.omen,
          img: actor.img === keep.img,
        },
      };

      // ---- 5. The all-checked default: new background, one 5-roll card ---
      const uuidBefore = actor.system.backgroundUuid;
      const msgBefore = new Set(game.messages.contents.map((m) => m.id));
      dlg = await openDialog(sheet);
      out.fullDefaults = dlg
        ? Object.values(dialogState(dlg)).every((s) => s.checked)
        : null;
      if (dlg) await reroll(dlg, sheet);
      const newMsgs = game.messages.contents.filter((m) => !msgBefore.has(m.id) && m.rolls?.length);
      out.full = {
        uuidChanged: actor.system.backgroundUuid !== uuidBefore && !!actor.system.backgroundUuid,
        provenance: actor.getFlag(NS, "backgroundChosen"),
        rollMessages: newMsgs.length,
        rollCount: newMsgs[0]?.rolls?.length ?? 0,
      };
      await sheet.close();

      // ---- 1b. The Barebones variant --------------------------------------
      const bactor = track(await gen.createActorWithCharacter(await gen.generateBarebonesCharacter(null)));
      for (const c of game.actors.filter((a) => a.system?.connectedTo === bactor.uuid)) made.push(c);
      await bactor.update({ "system.generationEnabled": true });
      const bsheet = bactor.sheet;
      await bsheet.render(true);
      await wait(800);
      out.barebonesProvenance = bactor.getFlag(NS, "backgroundChosen");
      dlg = await openDialog(bsheet);
      out.openedBb = !!dlg;
      if (dlg) {
        out.rowsBb = [...dlg.querySelectorAll(".reroll-row")].map((row) => row.dataset.part);
        out.notesBb = {
          questions: !!dlg.querySelector(".reroll-note-questions"),
          pick: !!dlg.querySelector(".reroll-note-pick"),
        };
        const s = dialogState(dlg);
        out.keepsakeGated = { checked: s.keepsake?.checked, disabled: s.keepsake?.disabled };
        applyStates(dlg, { failedCareer: false });
        out.keepsakeFreed = dialogState(dlg).keepsake?.disabled === false;
        await closeDialog(dlg);
      }
      await bsheet.close();

      // ---- 6b. The per-field provenance writes ----------------------------
      // Unset first, so the assertion can only pass if changeBackground itself
      // WROTE the flag — an earlier leg left it false, which made this leg
      // green with no fix at all on the first red run.
      await actor.unsetFlag(NS, "backgroundChosen");
      await gen.changeBackground(actor, null);            // the die
      out.provenanceDie = actor.getFlag(NS, "backgroundChosen");
      const other = bgs.find((b) => b.uuid !== actor.system.backgroundUuid);
      await gen.changeBackground(actor, other);           // the picker
      out.provenancePicker = actor.getFlag(NS, "backgroundChosen");

      const rolledData = await gen.generate2eCharacter(null);
      const rolledActor = track(await gen.createActorWithCharacter(rolledData));
      for (const c of game.actors.filter((a) => a.system?.connectedTo === rolledActor.uuid)) made.push(c);
      out.provenanceRolledGen = rolledActor.getFlag(NS, "backgroundChosen");

      const kw = await import("/systems/air-bladder/module/kettlewright-import.js");
      const matched = await kw.kettlewrightToActorData({ name: "KW PROBE", background: "Fieldwarden", items: [] });
      out.kwMatched = matched.data?.flags?.[NS]?.backgroundChosen;
      const unmatched = await kw.kettlewrightToActorData({ name: "KW PROBE", background: "No Such Trade Zzz", items: [] });
      out.kwUnmatched = unmatched.data?.flags?.[NS]?.backgroundChosen;

      return out;
    } catch (e) {
      return { error: `${e.name}: ${e.message}\n${e.stack}` };
    } finally {
      CONFIG.Dice.randomUniform = origUniform;
      await game.settings.set(NS, "show-omens", was.showOmens);
      await game.settings.set(NS, "barebones-failed-career", was.failedCareer);
      await game.settings.set(NS, "show-generation-rolls", was.genRolls);
      const plantedIds = new Set(made.map((a) => a.id));
      for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
      // The probe's own chat cards go with its actors.
      const t0Index = game.messages.contents.findIndex((m) => m.id === t0Message);
      for (const m of game.messages.contents.slice(t0Index + 1)) {
        if (plantedIds.has(m.speaker?.actor)) { try { await m.delete(); } catch { /* gone */ } }
      }
      await waitFor(() => made.every((a) => !game.actors.get(a.id)), 10000);
    }
  });

  if (r.error) {
    fail(r.error);
  } else {
    // ---- 1. rows ----
    const want2e = ["name", "background", "gear", "question0", "question1", "bonds",
      "STR", "DEX", "WIL", "hp", "gold", "age", "traits", "portrait", "omen"];
    r.opened2e && JSON.stringify(r.rows2e) === JSON.stringify(want2e)
      ? ok("the 2e dialog lists every re-rollable part, in order")
      : fail(`2e rows: opened=${r.opened2e}, got ${JSON.stringify(r.rows2e)}`);
    JSON.stringify(r.childRows) === JSON.stringify(["gear", "question0", "question1"])
      ? ok("gear and both questions are indented under Background")
      : fail(`background children: ${JSON.stringify(r.childRows)}`);
    r.notes2e?.questions?.includes("belong to the character's Background")
      && r.notes2e?.pick?.includes("choose instead of rolling")
      ? ok("both notes render (questions scope + pick-instead)")
      : fail(`notes: ${JSON.stringify(r.notes2e)}`);

    const wantBb = ["name", "background", "gear", "failedCareer", "keepsake",
      "STR", "DEX", "WIL", "hp", "gold", "age", "traits", "portrait"];
    r.openedBb && JSON.stringify(r.rowsBb) === JSON.stringify(wantBb)
      ? ok("the Barebones dialog swaps in failed career + keepsake, no bonds/questions/omen")
      : fail(`barebones rows: opened=${r.openedBb}, got ${JSON.stringify(r.rowsBb)}`);
    r.notesBb && !r.notesBb.questions && r.notesBb.pick
      ? ok("…and carries the pick note but not the questions note")
      : fail(`barebones notes: ${JSON.stringify(r.notesBb)}`);

    // ---- 2. defaults ----
    r.provenanceGenerated === true
      ? ok("generation from a chosen background stamps backgroundChosen: true")
      : fail(`generated provenance: ${r.provenanceGenerated}`);
    r.defaultChosen?.background?.checked === false && r.defaultChosen?.gear?.disabled === false
      ? ok("chosen background → Background opens unchecked, children live")
      : fail(`chosen defaults: ${JSON.stringify(r.defaultChosen)}`);
    r.defaultChosen?.name?.checked && r.defaultChosen?.bonds?.checked && r.defaultChosen?.omenListed
      ? ok("…while everything else opens checked (omen row present)")
      : fail(`chosen defaults (rest): ${JSON.stringify(r.defaultChosen)}`);
    r.defaultRolled?.checked === true
      ? ok("rolled background (flag false) → Background opens checked")
      : fail(`rolled default: ${JSON.stringify(r.defaultRolled)}`);
    r.defaultLegacy?.checked === true
      ? ok("legacy character (flag absent) → Background opens checked")
      : fail(`legacy default: ${JSON.stringify(r.defaultLegacy)}`);

    // ---- 3. gating ----
    const g = r.gatedOn ?? {};
    [g.gear, g.question0, g.question1, g.bonds].every((s) => s?.checked && s?.disabled)
      ? ok("checking Background checks + grays gear, both questions AND bonds")
      : fail(`gating on: ${JSON.stringify(g)}`);
    r.gatedOff?.gear?.disabled === false && r.gatedOff?.bonds?.disabled === false
      ? ok("unchecking Background frees them")
      : fail(`gating off: ${JSON.stringify(r.gatedOff)}`);
    r.keepsakeGated?.checked && r.keepsakeGated?.disabled && r.keepsakeFreed
      ? ok("the Barebones keepsake rides its failed-career box the same way")
      : fail(`keepsake gating: ${JSON.stringify(r.keepsakeGated)}, freed=${r.keepsakeFreed}`);

    // ---- 4. partial ----
    r.nothingChanged
      ? ok("unchecking everything re-rolls nothing at all")
      : fail("the all-unchecked run changed the actor");
    const p = r.partial ?? {};
    p.STR === 18 && p.STRmax === 18 && p.DEX === 18 && p.WIL === 18 && p.hp === 6 && p.hpMax === 6
      ? ok("partial: the seeded stat re-rolls landed (18/18/18, HP 6, value and max)")
      : fail(`partial stats: ${JSON.stringify(p)}`);
    p.gold === p.wantGold
      ? ok(`partial: gold is the base roll plus surviving grants (${p.gold})`)
      : fail(`partial gold: ${p.gold}, want ${p.wantGold}`);
    p.ageChanged ? ok("partial: the age re-rolled") : fail("partial: the age did not change");
    p.kept && Object.values(p.kept).every(Boolean)
      ? ok("partial: name, background, gear, questions, bonds, traits, omen and portrait all survive by value")
      : fail(`partial kept: ${JSON.stringify(p.kept)}`);

    // ---- 5. full ----
    r.fullDefaults === true
      ? ok("with a rolled background the dialog opens all-checked")
      : fail(`full defaults: ${r.fullDefaults}`);
    const F = r.full ?? {};
    F.uuidChanged ? ok("the all-checked run re-rolls the background (uuid changed)")
      : fail(`full: backgroundUuid did not change`);
    F.provenance === false
      ? ok("…and stamps it rolled")
      : fail(`full provenance: ${F.provenance}`);
    F.rollMessages === 1 && F.rollCount === 5
      ? ok("…and posts ONE chat message carrying the five generation Rolls")
      : fail(`full chat: ${F.rollMessages} message(s), ${F.rollCount} roll(s)`);

    // ---- 6. provenance ----
    r.provenanceDie === false
      ? ok("the background die (changeBackground null) stamps rolled")
      : fail(`die provenance: ${r.provenanceDie}`);
    r.provenancePicker === true
      ? ok("the background picker (changeBackground doc) stamps chosen")
      : fail(`picker provenance: ${r.provenancePicker}`);
    r.provenanceRolledGen === false
      ? ok("generation with a random background stamps rolled")
      : fail(`rolled-generation provenance: ${r.provenanceRolledGen}`);
    r.barebonesProvenance === false
      ? ok("the Barebones generator stamps it too")
      : fail(`barebones provenance: ${r.barebonesProvenance}`);
    r.kwMatched === true
      ? ok("a matched Kettlewright import stamps chosen")
      : fail(`KW matched provenance: ${r.kwMatched}`);
    r.kwUnmatched === undefined
      ? ok("an unmatched one stamps nothing (legacy = rolled)")
      : fail(`KW unmatched provenance: ${r.kwUnmatched}`);
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

console.log(failed ? "\nREROLL-DIALOG PROBE FAILED\n" : "\nreroll-dialog probe passed\n");
process.exit(failed ? 1 : 0);

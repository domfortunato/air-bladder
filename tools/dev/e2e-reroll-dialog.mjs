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
 *   7. REVIEW #21. The dialog is MODAL with Cancel as the default button; a
 *      pick anchor clicked while a re-roll is in flight opens nothing (the
 *      apply behind it would drop the choice); the one arrangement pass runs
 *      BEFORE the scalar update's render and an items-only run still renders
 *      after it (asserted on the WRITE ORDER, not the DOM — the async render
 *      pipeline makes a DOM read a race); an EMPTY world Omens table wipes
 *      nothing; and the unmatched-Kettlewright shape (backgroundUuid "",
 *      armorOverride set) refuses the whole gesture with a warning instead of
 *      half-applying it.
 *   8. REVIEW #21 finding 2 (user ruling 2026-09-02: mundane grants are
 *      TAGGED). Background-granted rations/light gear carries grantSource
 *      "background-mundane" — identity for the re-deal sweep, while
 *      grantSourceLabel's unknown→"" keeps the chip off (the npc-kit
 *      precedent). A player's bought copy of a granted mundane item survives
 *      TWO consecutive gear re-deals (the untagged name-matcher used to eat
 *      it on the second, once the fresh grant appended behind it), the
 *      granted copy never accumulates, and a LEGACY untagged grant still
 *      swaps — the name-matcher stays, but only for refs no tagged claim
 *      already satisfies.
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
      grantTags: game.settings.get(NS, "show-grant-tags"),
    };
    const origUniform = CONFIG.Dice.randomUniform;
    let emptyOmens = null;
    try {
      await game.settings.set(NS, "show-omens", true);
      await game.settings.set(NS, "barebones-failed-career", true);
      await game.settings.set(NS, "show-generation-rolls", true);
      await game.settings.set(NS, "show-grant-tags", true);

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

      // ---- 7. Review #21 -----------------------------------------------------
      // 7a. The checklist is MODAL (finding 3): while it is open the sheet
      // underneath is inert, so its dice and pickers cannot silently no-op
      // against the held _rerolling flag. And the DEFAULT button is Cancel
      // (finding 4): DialogV2 autofocuses the default button — with none
      // declared, the FIRST one (dialog.mjs:228,242) — so Enter on open must
      // not be a full re-deal.
      await sheet.render(true);
      await wait(800);
      dlg = await openDialog(sheet);
      if (dlg) {
        out.modal = dlg.closest("dialog")?.matches(":modal") ?? false;
        const app = dlg.closest(".application");
        out.autofocus = {
          cancel: app?.querySelector('button[data-action="cancel"]')?.hasAttribute("autofocus") ?? false,
          reroll: app?.querySelector('button[data-action="reroll"]')?.hasAttribute("autofocus") ?? false,
        };
        await closeDialog(dlg);
      } else {
        out.modal = "dialog did not open";
      }

      // 7b. A pick anchor clicked while a re-roll is in flight must not open
      // its list (finding 3's second half): the apply behind the picker
      // checks _rerolling AFTER the dialog, so a choice made there was
      // dropped in silence.
      const bondPickAnchor = () => {
        const id = (actor.system.bonds ?? [])[0]?.id;
        return rootOf(sheet)?.querySelector(`a[data-action="pickBond"][data-bond-id="${id}"]`);
      };
      if (bondPickAnchor()) {
        sheet._rerolling = true;
        bondPickAnchor().click();
        await wait(1200);
        out.pickHeldClosed = !document.querySelector(".bg-picker");
        // Sweep whatever opened (the defect's own state) so the control below
        // starts clean. promptFromRows resolves false on close — no rejection.
        for (const el of document.querySelectorAll(".bg-picker")) {
          await foundry.applications.instances.get(el.closest(".application")?.id)?.close();
        }
        await waitFor(() => !document.querySelector(".bg-picker"), 5000);
        sheet._rerolling = false;
        // The control: the same click with the flag clear DOES open the list —
        // without it, "nothing opened" is satisfied by a dead anchor.
        bondPickAnchor().click();
        const picker = await waitFor(() => document.querySelector(".bg-picker"), 10000);
        out.pickFreeOpens = !!picker;
        if (picker) {
          await foundry.applications.instances.get(picker.closest(".application")?.id)?.close();
          await waitFor(() => !document.querySelector(".bg-picker"), 5000);
        }
      } else {
        out.pickHeldClosed = "no bond pick anchor on the sheet";
      }

      // 7c + 7d. The one arrangement pass must land BEFORE the last render
      // (finding 5). Asserted on the WRITE ORDER via wrapped seams — the DOM
      // alone races the async render pipeline, and a leg that fails once then
      // passes is a race, not evidence.
      const seq = [];
      const origUpdate = actor.update.bind(actor);
      actor.update = (data, opts) => {
        seq.push(`update:${Object.keys(data ?? {}).sort().join(",")}`);
        return origUpdate(data, opts);
      };
      const origUED = actor.updateEmbeddedDocuments.bind(actor);
      actor.updateEmbeddedDocuments = (type, updates, opts) => {
        const reorder = type === "Item" && Array.isArray(updates) && updates.length > 0
          && updates.every((u) => Object.keys(u).sort().join(",") === "_id,sort");
        seq.push(reorder ? "reorder" : "embedded");
        return origUED(type, updates, opts);
      };
      const origRender = sheet.render.bind(sheet);
      sheet.render = (...a) => { seq.push("render"); return origRender(...a); };
      try {
        // Gear-only: the one scalar write is armorOverride, and it must come
        // AFTER the sort pass so its own render shows the arranged list.
        let mark = seq.length;
        dlg = await openDialog(sheet);
        if (dlg) {
          const all = Object.fromEntries(Object.keys(dialogState(dlg)).map((k) => [k, false]));
          applyStates(dlg, { ...all, gear: true });
          await reroll(dlg, sheet);
        }
        await wait(800);
        out.gearSeq = seq.slice(mark);

        // Bonds-only: no scalar write at all — something must still render
        // after the sort pass, or the list shows append order until the next
        // unrelated touch of the sheet.
        mark = seq.length;
        dlg = await openDialog(sheet);
        if (dlg) {
          const all = Object.fromEntries(Object.keys(dialogState(dlg)).map((k) => [k, false]));
          applyStates(dlg, { ...all, bonds: true });
          await reroll(dlg, sheet);
        }
        await wait(800);
        out.bondsSeq = seq.slice(mark);
      } finally {
        delete actor.update;
        delete actor.updateEmbeddedDocuments;
        delete sheet.render;
      }

      // 7e. An EMPTY world Omens table must not wipe the stored omen
      // (finding 6): core's roll() returns {results: []} with its own toast
      // (roll-table.mjs:281-284), and resultText(undefined) is "".
      await actor.update({ "system.omen": "ZZ PROBE OMEN KEEP" });
      emptyOmens = await RollTable.create({ name: "Omens", formula: "1d6", results: [] });
      dlg = await openDialog(sheet);
      if (dlg) {
        const all = Object.fromEntries(Object.keys(dialogState(dlg)).map((k) => [k, false]));
        applyStates(dlg, { ...all, omen: true });
        await reroll(dlg, sheet);
      }
      await wait(400);
      out.omenChecklistKept = actor.system.omen;
      // …and the die takes the same bail.
      rootOf(sheet)?.querySelector('a[data-action="rollOmen"]')?.click();
      await wait(1500);
      out.omenDieKept = actor.system.omen;
      await emptyOmens.delete();
      emptyOmens = null;
      await sheet.close();

      // 7f. The unmatched-Kettlewright shape (finding 1): backgroundUuid ""
      // with an armorOverride from the export's armor column. A checked gear
      // row has no background to deal from — the whole gesture must refuse
      // AND SAY SO, not half-apply (the old path silently skipped the gear,
      // re-rolled the statline and wiped armorOverride anyway).
      const kwActor = track(await CONFIG.Actor.documentClass.create({
        name: "ZZ Reroll KW Unmatched", type: "character",
        system: {
          contentSource: "2e", background: "Cloudwright", backgroundUuid: "",
          armorOverride: 2, generationEnabled: true,
          abilities: {
            STR: { value: 10, max: 10 }, DEX: { value: 10, max: 10 }, WIL: { value: 10, max: 10 },
          },
        },
      }));
      const kwSheet = kwActor.sheet;
      await kwSheet.render(true);
      await wait(800);
      const warns = [];
      const origWarn = ui.notifications.warn.bind(ui.notifications);
      ui.notifications.warn = (m, ...rest) => { warns.push(String(m)); return origWarn(m, ...rest); };
      CONFIG.Dice.randomUniform = () => 0;   // a re-rolled STR is 18, never a lucky 10
      try {
        dlg = await openDialog(kwSheet);
        if (dlg) {
          const all = Object.fromEntries(Object.keys(dialogState(dlg)).map((k) => [k, false]));
          applyStates(dlg, { ...all, gear: true, STR: true });
          await reroll(dlg, kwSheet);
        }
      } finally {
        CONFIG.Dice.randomUniform = origUniform;
        ui.notifications.warn = origWarn;
      }
      await wait(400);
      out.kwAbort = {
        warned: warns.some((w) => w === game.i18n.localize("CAIRN.Reroll.NoBackground")),
        warns: warns.slice(0, 4),
        STR: kwActor.system.abilities.STR.value,
        armorOverride: kwActor._source.system.armorOverride,
      };
      await kwSheet.close();

      // ---- 8. Finding 2 (user ruling 2026-09-02): mundane grants TAGGED ----
      // Fieldwarden grants Rations AND Torch outright, so the mundane half of
      // its loadout is deterministic.
      await gen.changeBackground(actor, fieldwarden);
      out.mundaneTags = {
        rations: actor.items.find((i) => i.name === "Rations")?.getFlag(NS, "grantSource") ?? null,
        torch: actor.items.find((i) => i.name === "Torch")?.getFlag(NS, "grantSource") ?? null,
        sling: actor.items.find((i) => i.name === "Sling")?.getFlag(NS, "grantSource") ?? null,
      };

      // The chip stays OFF the mundane grant while the tagged sling wears one
      // — the visible half of the ruling (grantSourceLabel unknown→"").
      await sheet.render(true);
      await wait(800);
      const chipOf = (name) => {
        const item = actor.items.find((i) => i.name === name);
        return rootOf(sheet)?.querySelector(`[data-item-id="${item?.id}"] .cairn-grant-tag`)?.textContent?.trim() ?? "";
      };
      out.chips = {
        rations: chipOf("Rations"),
        sling: chipOf("Sling"),
        wantSling: game.i18n.localize("CAIRN.GrantBackground"),
      };
      await sheet.close();

      // A bought copy survives TWO consecutive re-deals. Two, because the
      // hole was insertion order: the first re-deal's fresh grant appended
      // BEHIND the purchase, so the SECOND re-deal's name-match found the
      // purchase first and ate it.
      const bought = (await actor.createEmbeddedDocuments("Item",
        [{ name: "Rations", type: "item" }], { render: false }))[0];
      await gen.redealBackgroundGear(actor);
      const boughtAfterOne = !!actor.items.get(bought.id);
      await gen.redealBackgroundGear(actor);
      out.purchase = {
        survivedFirst: boughtAfterOne,
        survivedSecond: !!actor.items.get(bought.id),
        boughtStillUntagged: !actor.items.get(bought.id)?.getFlag(NS, "grantSource"),
        grantedCopies: actor.items.filter((i) => i.name === "Rations" && i.id !== bought.id).length,
      };

      // LEGACY: a pre-tagging character's untagged granted copy still swaps —
      // the name-matcher survives, scoped to refs no tagged claim satisfies.
      // The bought copy is removed first: legacy grant and purchase are
      // fundamentally indistinguishable, and that ambiguity is the accepted
      // one-apiece residue for legacy characters only.
      if (actor.items.get(bought.id)) {
        await actor.deleteEmbeddedDocuments("Item", [bought.id], { render: false });
      }
      const taggedRations = actor.items.find((i) => i.name === "Rations");
      if (taggedRations) await actor.deleteEmbeddedDocuments("Item", [taggedRations.id], { render: false });
      const legacy = (await actor.createEmbeddedDocuments("Item",
        [{ name: "Rations", type: "item" }], { render: false }))[0];
      await gen.redealBackgroundGear(actor);
      out.legacy = {
        plantedGone: !actor.items.get(legacy.id),
        freshTagged: actor.items.filter((i) => i.name === "Rations").length,
      };

      return out;
    } catch (e) {
      return { error: `${e.name}: ${e.message}\n${e.stack}` };
    } finally {
      CONFIG.Dice.randomUniform = origUniform;
      try { await emptyOmens?.delete(); } catch { /* already gone */ }
      await game.settings.set(NS, "show-omens", was.showOmens);
      await game.settings.set(NS, "barebones-failed-career", was.failedCareer);
      await game.settings.set(NS, "show-generation-rolls", was.genRolls);
      await game.settings.set(NS, "show-grant-tags", was.grantTags);
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

    // ---- 7. review #21 ----
    r.modal === true
      ? ok("the checklist is modal — the sheet underneath is inert while it is open")
      : fail(`modal: ${JSON.stringify(r.modal)}`);
    r.autofocus?.cancel === true && r.autofocus?.reroll === false
      ? ok("Cancel is the default button — Enter on open re-deals nothing")
      : fail(`autofocus: ${JSON.stringify(r.autofocus)}`);
    r.pickHeldClosed === true
      ? ok("a pick anchor clicked mid-re-roll opens no list (its apply would drop the choice)")
      : fail(`pick while held: ${JSON.stringify(r.pickHeldClosed)}`);
    r.pickFreeOpens === true
      ? ok("…and the same click with the flag clear opens it (the anchor is live)")
      : fail(`pick control: ${JSON.stringify(r.pickFreeOpens)}`);

    const seqIdx = (seq, pred) => (seq ?? []).findIndex(pred);
    const gearReorder = seqIdx(r.gearSeq, (s) => s === "reorder");
    const gearScalar = seqIdx(r.gearSeq, (s) => s.startsWith("update:") && s.includes("armorOverride"));
    gearReorder >= 0 && gearScalar >= 0 && gearReorder < gearScalar
      ? ok("gear-only: the arrangement pass runs BEFORE the scalar update's render")
      : fail(`gear write order: ${JSON.stringify(r.gearSeq)}`);
    const bondsLastReorder = (r.bondsSeq ?? []).lastIndexOf("reorder");
    bondsLastReorder >= 0 && (r.bondsSeq ?? []).slice(bondsLastReorder + 1).includes("render")
      ? ok("bonds-only: something still renders after the arrangement pass")
      : fail(`bonds write order: ${JSON.stringify(r.bondsSeq)}`);

    r.omenChecklistKept === "ZZ PROBE OMEN KEEP"
      ? ok("an empty world Omens table wipes nothing through the checklist")
      : fail(`omen after empty-table checklist run: ${JSON.stringify(r.omenChecklistKept)}`);
    r.omenDieKept === "ZZ PROBE OMEN KEEP"
      ? ok("…or through the die")
      : fail(`omen after empty-table die roll: ${JSON.stringify(r.omenDieKept)}`);

    const K = r.kwAbort ?? {};
    K.warned === true
      ? ok("unmatched-KW shape: the gear row's refusal is SAID, not silent")
      : fail(`KW abort warning: ${JSON.stringify(K.warns)}`);
    K.STR === 10 && K.armorOverride === 2
      ? ok("…and the whole gesture aborts — STR and armorOverride untouched")
      : fail(`KW abort state: STR=${K.STR} (want 10), armorOverride=${JSON.stringify(K.armorOverride)} (want 2)`);

    // ---- 8. finding 2: mundane grants tagged (user ruling 2026-09-02) ----
    const T = r.mundaneTags ?? {};
    T.rations === "background-mundane" && T.torch === "background-mundane" && T.sling === "background"
      ? ok("granted Rations and Torch carry background-mundane; the Sling carries background")
      : fail(`mundane tags: ${JSON.stringify(T)}`);
    const C = r.chips ?? {};
    C.rations === "" && C.sling === C.wantSling
      ? ok(`…the mundane grant wears NO chip while the Sling reads "${C.sling}"`)
      : fail(`chips: ${JSON.stringify(C)}`);
    const P = r.purchase ?? {};
    P.survivedFirst && P.survivedSecond && P.boughtStillUntagged
      ? ok("a bought Rations survives two consecutive gear re-deals, still untagged")
      : fail(`purchase: ${JSON.stringify(P)}`);
    P.grantedCopies === 1
      ? ok("…and the granted copy never accumulates (one apiece)")
      : fail(`granted Rations copies: ${P.grantedCopies}`);
    const LG = r.legacy ?? {};
    LG.plantedGone && LG.freshTagged === 1
      ? ok("a legacy untagged grant still swaps — the name-matcher covers refs no tag claims")
      : fail(`legacy: ${JSON.stringify(LG)}`);
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

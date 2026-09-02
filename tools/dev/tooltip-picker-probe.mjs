#!/usr/bin/env node
/**
 * Character Creation Mode tooltips + the omen/bond/question pickers.
 *
 *   node tools/dev/tooltip-picker-probe.mjs   (needs Foundry running, world launched)
 *
 * The 2026-09-01 batch: the mode toggle's tooltip follows its state, the
 * creation dice and pickers ride core's data-tooltip (bare i18n KEY, the
 * Age-die idiom), the save dice gray out while the mode is On, the HP/Gold
 * labels and the traits header say what was rolled at creation, the
 * current/max boxes say which side is which, and Omen / Bond / the two
 * background questions each gain a pick-list button (fa-list-ul) beside their die —
 * because a player who rolled a character with the BOOKS wants to recreate
 * that exact character, and a random re-roll cannot reproduce a row they
 * already rolled. The Omens table resolves WORLD-FIRST now, like Bonds.
 *
 * Steps, driven headless as GM:
 *   1. The header toggle's data-tooltip KEY differs between On and Off.
 *   2. The background and omen dice carry data-tooltip (bare key), no title=.
 *   3. Save dice: while On the STR anchor has NO data-action, wears
 *      .save-roll-off and says "turn the mode off"; while Off it rolls with
 *      its normal tip. Same on the npc sheet.
 *   4. Current/max boxes: formatted "Current Hit Protection" / "Maximum STR",
 *      not the bare shared "Current"/"Maximum".
 *   5. Mode-On hints: HP and Gold labels append "Rolled at creation."; the
 *      traits header carries the rolled-at-creation key. All gone while Off.
 *   6. A world RollTable named "Omens" (planted) feeds the omen DIE — the
 *      compendium-pinned build never reads it — and the omen PICKER lists its
 *      row; picking applies the English text to system.omen. Cancel applies
 *      nothing. Deleting the plant restores the shipped table.
 *   7. The bond picker lists the resolved Bonds table and picking a row swaps
 *      the bond's description, gold and bond:<id>-tagged grants — the same
 *      apply the die uses.
 *   8. A question picker lists that question's options off the background and
 *      picking one swaps the answer and its question:<idx> grants.
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
    const L = (k) => game.i18n.localize(k);
    const F = (k, d) => game.i18n.format(k, d);
    const out = {};

    // Precondition: the Omen row must be visible on 2e sheets (Warden switch,
    // default ON — established, not assumed; restored in the teardown).
    const showOmensWas = game.settings.get(NS, "show-omens");
    let worldOmens = null;
    try {
      await game.settings.set(NS, "show-omens", true);

      // A 2e character with bonds and questions to drive everything through.
      const bgs = (await gen.getBackgroundsByArchetype("2e")).flatMap((g) => g.backgrounds);
      const fieldwarden = bgs.find((b) => b.name === "Fieldwarden");
      const actor = track(await gen.createActorWithCharacter(await gen.generate2eCharacter(fieldwarden)));
      for (const c of game.actors.filter((a) => a.system?.connectedTo === actor.uuid)) made.push(c);
      // Creation stamps the mode OFF (the recorded trap); the On legs need it on,
      // and the omen legs need the checkbox.
      await actor.update({ "system.generationEnabled": true, "system.omenEnabled": true });

      const sheet = actor.sheet;
      await sheet.render(true);
      await wait(800);
      const rootOf = () => (sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0]);

      // ---- 1 + 2 + 3 + 4 + 5, mode ON -------------------------------------
      let root = rootOf();
      const toggleEl = () => root?.closest(".application")?.querySelector('.window-header button[data-action="toggleGeneration"]')
        ?? document.querySelector(`#${sheet.id} .window-header button[data-action="toggleGeneration"]`);
      out.toggleOnKey = toggleEl()?.dataset.tooltip ?? "";

      const bgDie = root?.querySelector('a[data-action="rollBackground"]');
      out.migrate = {
        bgKey: bgDie?.dataset.tooltip ?? "",
        bgNoTitle: !!bgDie && !bgDie.hasAttribute("title"),
      };

      const strOn = root?.querySelector(".STR-counter a.resource-roll");
      out.savesOn = {
        noAction: !!strOn && !strOn.dataset.action,
        offClass: !!strOn?.classList.contains("save-roll-off"),
        tip: strOn?.dataset.tooltip ?? "",
        noLabel: !!strOn && !strOn.dataset.label,
      };

      out.boxes = {
        hpCurrent: root?.querySelector('input[name="system.hp.value"]')?.dataset.tooltip ?? "",
        hpCurrentNoTitle: !root?.querySelector('input[name="system.hp.value"]')?.hasAttribute("title"),
        strMax: root?.querySelector('input[name="system.abilities.STR.max"]')?.dataset.tooltip ?? "",
      };

      out.hintsOn = {
        hp: root?.querySelector('label[for$="system.hp.value"]')?.dataset.tooltip ?? "",
        gold: root?.querySelector('label[for$="system.gold"]')?.dataset.tooltip ?? "",
      };
      root?.querySelector('[data-tab="description"]')?.click();
      await wait(300);
      root = rootOf();
      out.hintsOn.traits = root?.querySelector(".trait-picklist-label")?.dataset.tooltip ?? "";
      const omenDie = root?.querySelector('a[data-action="rollOmen"]');
      out.migrate.omenKey = omenDie?.dataset.tooltip ?? "";
      out.migrate.omenNoTitle = !!omenDie && !omenDie.hasAttribute("title");
      out.migrate.omenPickKey = root?.querySelector('a[data-action="pickOmen"]')?.dataset.tooltip ?? "";
      out.migrate.omenPickIcon = root?.querySelector('a[data-action="pickOmen"] i')?.className ?? "";
      out.migrate.bgPickIcon = rootOf()?.querySelector('a[data-action="pickBackground"] i')?.className ?? "";

      // ---- 6. World-first Omens: plant, die, picker, cancel, restore ------
      worldOmens = await RollTable.create({
        name: "Omens", formula: "1d1",
        results: [{ type: CONST.TABLE_RESULT_TYPES.TEXT, description: "PROBE OMEN — the sky is a lid", range: [1, 1] }],
      });
      const omenWas = actor.system.omen;
      omenDie?.click();
      out.omenDieWorld = await waitFor(() => actor.system.omen === "PROBE OMEN — the sky is a lid", 10000)
        ? actor.system.omen : `still "${actor.system.omen}" (was "${omenWas}")`;

      // The picker lists the world row; picking it applies the English text.
      await actor.update({ "system.omen": "" });
      await waitFor(() => rootOf()?.querySelector('a[data-action="pickOmen"]'), 5000);
      rootOf()?.querySelector('a[data-action="pickOmen"]')?.click();
      let dlg = await waitFor(() => document.querySelector(".bg-picker"), 10000);
      out.omenPicker = { opened: !!dlg };
      if (dlg) {
        const inputs = [...dlg.querySelectorAll('input[name="bg"]')];
        out.omenPicker.rows = inputs.length;
        out.omenPicker.hasWorldRow = inputs.some((i) => i.value === "PROBE OMEN — the sky is a lid");
        const row = inputs.find((i) => i.value === "PROBE OMEN — the sky is a lid");
        row?.click();
        dlg.closest(".application")?.querySelector('button[data-action="choose"]')?.click();
        out.omenPicker.applied = await waitFor(() => actor.system.omen === "PROBE OMEN — the sky is a lid", 10000);
        await waitFor(() => !document.querySelector(".bg-picker"), 5000);
      }

      // Cancel applies nothing.
      const omenBefore = actor.system.omen;
      rootOf()?.querySelector('a[data-action="pickOmen"]')?.click();
      dlg = await waitFor(() => document.querySelector(".bg-picker"), 10000);
      if (dlg) {
        dlg.closest(".application")?.querySelector('button[data-action="cancel"]')?.click();
        await waitFor(() => !document.querySelector(".bg-picker"), 5000);
      }
      await wait(400);
      out.omenCancel = actor.system.omen === omenBefore;

      // Deleting the plant restores the shipped table for the die.
      const plantedId = worldOmens.id;
      await worldOmens.delete();
      worldOmens = null;
      await waitFor(() => !game.tables.get(plantedId), 5000);
      out.plantGone = !game.tables.get(plantedId);
      await waitFor(() => rootOf()?.querySelector('a[data-action="rollOmen"]'), 5000);
      rootOf()?.querySelector('a[data-action="rollOmen"]')?.click();
      out.omenDieFallback = await waitFor(
        () => actor.system.omen && actor.system.omen !== "PROBE OMEN — the sky is a lid", 10000)
        ? true : `omen is "${actor.system.omen}"`;

      // ---- 7. The bond picker ---------------------------------------------
      root = rootOf();
      root?.querySelector('[data-tab="notes"]')?.click();
      await wait(300);
      root = rootOf();
      const bondId = (actor.system.bonds ?? [])[0]?.id;
      const bondPick = root?.querySelector(`a[data-action="pickBond"][data-bond-id="${bondId}"]`);
      out.bondPicker = { anchor: !!bondPick, key: bondPick?.dataset.tooltip ?? "", icon: bondPick?.querySelector("i")?.className ?? "" };
      if (bondPick) {
        // A shipped Bonds row that GRANTS something, different from what's held —
        // so the swap of description, gold and tagged items is all observable.
        const shipped = (await game.packs.get("air-bladder.tables-2e").getDocuments())
          .find((t) => t.name === "Bonds");
        const held = new Set((actor.system.bonds ?? []).map((b) => b.description));
        const target = shipped.results.find((res) =>
          (res.getFlag(NS, "items") ?? []).length && !held.has(String(res.description ?? res.text ?? "").trim()));
        const wantText = (await import("/systems/air-bladder/module/compendium.js")).resultText(target);
        const oldGrantIds = actor.items
          .filter((i) => i.getFlag(NS, "grantSource") === `bond:${bondId}`).map((i) => i.id);
        const goldBefore = actor.system.gold;
        const bondGoldBefore = (actor.system.bonds ?? [])[0]?.gold ?? 0;
        bondPick.click();
        dlg = await waitFor(() => document.querySelector(".bg-picker"), 15000);
        out.bondPicker.opened = !!dlg;
        if (dlg) {
          const rowInput = [...dlg.querySelectorAll('input[name="bg"]')].find((i) => i.value === wantText);
          out.bondPicker.hasRow = !!rowInput;
          rowInput?.click();
          dlg.closest(".application")?.querySelector('button[data-action="choose"]')?.click();
          out.bondPicker.applied = await waitFor(
            () => (actor.system.bonds ?? [])[0]?.description === wantText, 15000);
          await waitFor(() => !document.querySelector(".bg-picker"), 5000);
          const newGrants = actor.items.filter((i) => i.getFlag(NS, "grantSource") === `bond:${bondId}`);
          out.bondPicker.granted = newGrants.length > 0;
          out.bondPicker.oldGone = oldGrantIds.every((id) => !actor.items.get(id));
          const wantGold = Math.max(0, goldBefore - bondGoldBefore + (target.getFlag(NS, "gold") ?? 0));
          out.bondPicker.gold = actor.system.gold === wantGold
            ? true : `gold ${actor.system.gold}, want ${wantGold}`;
        }
      }

      // ---- 8. A question picker -------------------------------------------
      root = rootOf();
      const qPick = root?.querySelector('a[data-action="pickQuestion"][data-index="0"]');
      out.questionPicker = { anchor: !!qPick, key: qPick?.dataset.tooltip ?? "", icon: qPick?.querySelector("i")?.className ?? "" };
      if (qPick) {
        const bg = await fromUuid(actor.system.backgroundUuid);
        const options = bg.system.tables[0].options;
        const curIdx = options.findIndex((o) => (o.description ?? "") === (actor.system.questions?.[0]?.answer ?? ""));
        const pickIdx = (Math.max(0, curIdx) + 1) % options.length;
        const oldQGrantIds = actor.items
          .filter((i) => i.getFlag(NS, "grantSource") === "question:0").map((i) => i.id);
        qPick.click();
        dlg = await waitFor(() => document.querySelector(".bg-picker"), 15000);
        out.questionPicker.opened = !!dlg;
        if (dlg) {
          out.questionPicker.rows = dlg.querySelectorAll('input[name="bg"]').length;
          const rowInput = [...dlg.querySelectorAll('input[name="bg"]')].find((i) => i.value === String(pickIdx));
          rowInput?.click();
          dlg.closest(".application")?.querySelector('button[data-action="choose"]')?.click();
          out.questionPicker.applied = await waitFor(
            () => (actor.system.questions ?? [])[0]?.answer === (options[pickIdx].description ?? ""), 15000);
          await waitFor(() => !document.querySelector(".bg-picker"), 5000);
          out.questionPicker.oldGone = oldQGrantIds.every((id) => !actor.items.get(id));
        }
      }

      // ---- mode OFF: dice roll again, hints gone --------------------------
      await actor.update({ "system.generationEnabled": false });
      await waitFor(() => {
        const el = rootOf()?.querySelector(".STR-counter a.resource-roll");
        return el && el.dataset.action === "rollAbility";
      }, 10000);
      root = rootOf();
      out.toggleOffKey = toggleEl()?.dataset.tooltip ?? "";
      const strOff = root?.querySelector(".STR-counter a.resource-roll");
      out.savesOff = {
        action: strOff?.dataset.action ?? "",
        noOffClass: !!strOff && !strOff.classList.contains("save-roll-off"),
        tip: strOff?.dataset.tooltip ?? "",
      };
      out.hintsOff = {
        hp: root?.querySelector('label[for$="system.hp.value"]')?.dataset.tooltip ?? "",
        gold: root?.querySelector('label[for$="system.gold"]')?.dataset.tooltip ?? "",
      };
      root?.querySelector('[data-tab="description"]')?.click();
      await wait(300);
      out.hintsOff.traits = rootOf()?.querySelector(".trait-picklist-label")?.hasAttribute("data-tooltip") ?? false;
      await sheet.close();

      // ---- 3b. The npc sheet's save dice take the same gate ---------------
      const npc = track(await Actor.create({ name: "PROBE Tooltip Hireling", type: "npc" }));
      await npc.update({ "system.generationEnabled": true });
      const nSheet = npc.sheet;
      await nSheet.render(true);
      await wait(800);
      const nRoot = nSheet.element instanceof HTMLElement ? nSheet.element : nSheet.element?.[0];
      const nStr = nRoot?.querySelector(".STR-counter a.resource-roll");
      out.npcSavesOn = {
        noAction: !!nStr && !nStr.dataset.action,
        offClass: !!nStr?.classList.contains("save-roll-off"),
        tip: nStr?.dataset.tooltip ?? "",
        hpCurrent: nRoot?.querySelector('input[name="system.hp.value"]')?.dataset.tooltip ?? "",
      };
      out.npcPickIcon = nRoot?.querySelector(".profession-pick i")?.className ?? "";
      await nSheet.close();

      return out;
    } catch (e) {
      return { error: `${e.name}: ${e.message}\n${e.stack}` };
    } finally {
      await game.settings.set(NS, "show-omens", showOmensWas);
      try { await worldOmens?.delete(); } catch { /* already gone */ }
      for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
      // Poll every planted doc gone — an orphan poisons later probes.
      await waitFor(() => made.every((a) => !game.actors.get(a.id)), 10000);
    }
  });

  if (r.error) {
    fail(r.error);
  } else {
    const exp = {
      on: "CAIRN.ToggleGenerationHintOn",
      off: "CAIRN.ToggleGenerationHint",
    };
    r.toggleOnKey === exp.on && r.toggleOffKey === exp.off
      ? ok(`the toggle's tooltip follows its state (${exp.on} / ${exp.off})`)
      : fail(`toggle tooltip keys: on="${r.toggleOnKey}", off="${r.toggleOffKey}"`);

    const M = r.migrate ?? {};
    M.bgKey === "CAIRN.RollBackground" && M.bgNoTitle
      ? ok("the background die rides data-tooltip (bare key), no title=")
      : fail(`background die: data-tooltip="${M.bgKey}", noTitle=${M.bgNoTitle}`);
    M.omenKey === "CAIRN.RollOmen" && M.omenNoTitle
      ? ok("the omen die too")
      : fail(`omen die: data-tooltip="${M.omenKey}", noTitle=${M.omenNoTitle}`);
    M.omenPickKey === "CAIRN.PickOmen"
      ? ok("an omen picker sits beside it (CAIRN.PickOmen)")
      : fail(`omen picker anchor: data-tooltip="${M.omenPickKey}"`);

    // Every picker wears the pick-list icon — one icon everywhere, or the
    // system speaks two dialects (the magnifier retired 2026-09-02).
    const icons = {
      background: M.bgPickIcon ?? "",
      omen: M.omenPickIcon ?? "",
      bond: r.bondPicker?.icon ?? "",
      question: r.questionPicker?.icon ?? "",
      npcCareer: r.npcPickIcon ?? "",
    };
    const badIcons = Object.entries(icons).filter(([, c]) => !c.includes("fa-list-ul"));
    badIcons.length === 0
      ? ok("all five picker anchors wear fa-list-ul")
      : fail(`picker icons not fa-list-ul: ${badIcons.map(([n, c]) => `${n}="${c}"`).join(", ")}`);

    const S = r.savesOn ?? {};
    S.noAction && S.offClass && S.noLabel
      ? ok("mode On: the STR save die is inert (no data-action, .save-roll-off, no data-label)")
      : fail(`mode-On STR die: ${JSON.stringify(S)}`);
    // The tip is pre-localized TEXT (abilityTips), so compare against the string.
    S.tip === "Turn off Character Creation Mode to roll saves."
      ? ok("…and says how to get the roll back")
      : fail(`mode-On STR tip: "${S.tip}"`);
    const SO = r.savesOff ?? {};
    SO.action === "rollAbility" && SO.noOffClass && SO.tip.startsWith("Used for saves requiring physical power")
      ? ok("mode Off: the STR die rolls again with its normal tip")
      : fail(`mode-Off STR die: ${JSON.stringify(SO)}`);
    const N = r.npcSavesOn ?? {};
    N.noAction && N.offClass && N.tip === "Turn off Character Creation Mode to roll saves."
      ? ok("the npc sheet's save dice take the same gate")
      : fail(`npc mode-On STR die: ${JSON.stringify(N)}`);

    const B = r.boxes ?? {};
    B.hpCurrent === "Current Hit Protection" && B.hpCurrentNoTitle
      ? ok('the HP current box reads "Current Hit Protection" (formatted, data-tooltip)')
      : fail(`HP current box: "${B.hpCurrent}", noTitle=${B.hpCurrentNoTitle}`);
    B.strMax === "Maximum STR"
      ? ok('the STR max box reads "Maximum STR"')
      : fail(`STR max box: "${B.strMax}"`);
    N.hpCurrent === "Current Hit Protection"
      ? ok("npc sheet boxes formatted the same way")
      : fail(`npc HP current box: "${N.hpCurrent}"`);

    const HN = r.hintsOn ?? {}, HF = r.hintsOff ?? {};
    HN.hp.endsWith("Rolled at creation.") && HN.gold.endsWith("Rolled at creation.")
      ? ok('mode On: HP and Gold labels append "Rolled at creation."')
      : fail(`mode-On labels: hp="${HN.hp}", gold="${HN.gold}"`);
    !HF.hp.endsWith("Rolled at creation.") && !HF.gold.endsWith("Rolled at creation.")
      ? ok("mode Off: the sentence is gone")
      : fail(`mode-Off labels still carry it: hp="${HF.hp}", gold="${HF.gold}"`);
    HN.traits === "CAIRN.TraitsRolledTip" && HF.traits === false
      ? ok("the traits header hints only while On")
      : fail(`traits header: on="${HN.traits}", off-has-attr=${HF.traits}`);

    r.omenDieWorld === "PROBE OMEN — the sky is a lid"
      ? ok("the omen DIE reads a world table named Omens (world-first)")
      : fail(`omen die ignored the world table: ${r.omenDieWorld}`);
    const OP = r.omenPicker ?? {};
    OP.opened && OP.hasWorldRow && OP.applied
      ? ok(`the omen PICKER lists the world row (${OP.rows} row(s)) and picking applies it`)
      : fail(`omen picker: ${JSON.stringify(OP)}`);
    r.omenCancel ? ok("cancelling the picker applies nothing") : fail("cancel changed the omen");
    r.plantGone && r.omenDieFallback === true
      ? ok("deleting the world table restores the shipped one")
      : fail(`fallback after delete: plantGone=${r.plantGone}, die=${r.omenDieFallback}`);

    const BP = r.bondPicker ?? {};
    BP.anchor && BP.key === "CAIRN.PickBond"
      ? ok("a bond picker sits beside the bond die (CAIRN.PickBond)")
      : fail(`bond picker anchor: ${JSON.stringify({ anchor: BP.anchor, key: BP.key })}`);
    BP.opened && BP.hasRow && BP.applied
      ? ok("it lists the resolved Bonds table and picking a row applies it")
      : fail(`bond pick: ${JSON.stringify(BP)}`);
    BP.granted && BP.oldGone && BP.gold === true
      ? ok("…swapping the bond:<id> grants and trading the gold, like the die")
      : fail(`bond grant swap: granted=${BP.granted}, oldGone=${BP.oldGone}, gold=${BP.gold}`);

    const QP = r.questionPicker ?? {};
    QP.anchor && QP.key === "CAIRN.PickQuestion"
      ? ok("a question picker sits beside each question die (CAIRN.PickQuestion)")
      : fail(`question picker anchor: ${JSON.stringify({ anchor: QP.anchor, key: QP.key })}`);
    QP.opened && QP.applied && QP.oldGone
      ? ok(`it lists the background's options (${QP.rows} rows + Random) and picking one swaps answer and grants`)
      : fail(`question pick: ${JSON.stringify(QP)}`);
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

console.log(failed ? "\nTOOLTIP-PICKER PROBE FAILED\n" : "\ntooltip-picker probe passed\n");
process.exit(failed ? 1 : 0);

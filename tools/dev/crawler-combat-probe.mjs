#!/usr/bin/env node
/**
 * Crawler Combat Mode — the optional hack (2026-10-02, user ask).
 *
 * A harsher combat, default OFF, joining GLOG Magic and the Vald calendar under
 * Configure Hacks. One rule of its own and two options beside it, and ALL THREE
 * are PLAYER CHARACTERS ONLY (`type === "character"`, the auto-record-scars
 * gate):
 *
 *   - the hack itself: an overburdened PC is DEPRIVED as well as at 0 Hit
 *     Protection, until they are no longer overburdened;
 *   - Exploding damage dice;
 *   - Fatigue instead of Critical Damage.
 *
 * THE KEYSTONE IS MODIFIER ORDER, and leg 1 proves it before anything rests on
 * it. `2d6kx` keeps the highest and explodes ONLY that one, because modifiers
 * apply in written order (`DiceTerm#_evaluateModifiers`), `keep` flags the
 * loser `active: false` (`_keepOrDrop`) and `explode` skips it
 * (`if (!r.active) continue;`). So two sixes are ONE six — the rule as asked
 * for. The control is the same two modifiers REVERSED: `2d6xk` explodes both
 * and then compares raw FACES, so it can never exceed the die.
 *
 * The second dice trap is the Cairn `+` overload. `evaluateFormula` rewrites
 * `a + b` to `{a,b}kh` only when every term is a bare die, so `d6x + d6x` fails
 * that test and evaluates as an arithmetic SUM — a keep-highest weapon silently
 * dealing double. `explodingDamageFormula` emits `2d6kx` for that shape
 * instead, leaving no `+` behind.
 *
 * Deprived is DERIVED, never written: `system.deprived` carries no provenance,
 * so a hack that wrote it could not tell its own deprivation from one the
 * player set for no food, and would stomp theirs when it cleared. Leg 5 asserts
 * `_source` is untouched throughout, which is the whole claim.
 *
 * Dice are pinned through `CONFIG.Dice.randomUniform`, which is INVERTED, and
 * through a SEQUENCE where a chain must terminate: a flat pin at the maximum
 * explodes for ever and core throws at depth 1000.
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
    const KEYS = ["crawler-combat-mode", "crawler-exploding-damage", "crawler-fatigue-for-critical"];
    const out = { made: [] };
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const utils = await import("/systems/air-bladder/module/utils.js");
    const mod = await import("/systems/air-bladder/module/settings.js");

    out.registered = {};
    out.configFlags = {};
    for (const k of KEYS) {
      const cfg = game.settings.settings.get(`${NS}.${k}`);
      out.registered[k] = !!cfg;
      out.configFlags[k] = cfg?.config ?? null;
    }
    out.reload = game.settings.settings.get(`${NS}.crawler-combat-mode`)?.requiresReload ?? null;
    out.inSettingKeys = KEYS.filter((k) => mod.SETTING_KEYS.includes(k));
    out.inInternal = KEYS.filter((k) => mod.INTERNAL_SETTING_KEYS.includes(k));
    const hacks = mod.SETTING_GROUPS.find((g) => g.id === "hacks");
    out.hackKeys = hacks?.keys ?? [];
    out.subSpecs = [hacks?.subOptions].flat().filter(Boolean).map((s) => s.master);
    if (KEYS.some((k) => !out.registered[k])) return out;

    /* ---- 1. the keystone: modifier ORDER -------------------------------- */
    // A SEQUENCE, not a flat pin: every die at max explodes for ever and core
    // throws at recursion depth 1000.
    const withSeq = async (f, vals) => {
      const orig = CONFIG.Dice.randomUniform;
      let i = 0;
      CONFIG.Dice.randomUniform = () => vals[Math.min(i++, vals.length - 1)];
      try {
        const roll = new Roll(f);
        await roll.evaluate();
        return {
          total: roll.total,
          faces: roll.dice.map((d) => d.results.map((x) => ({
            r: x.result, active: x.active, exploded: !!x.exploded, discarded: !!x.discarded,
          }))),
        };
      } catch (e) {
        return { error: `${e.name}: ${e.message}` };
      } finally {
        CONFIG.Dice.randomUniform = orig;
      }
    };
    const MAX = 0.0001, LOW = 0.7;
    out.kxBothMax = await withSeq("2d6kx", [MAX, MAX, LOW]);     // 6(drop) 6! 2 = 8
    out.xkBothMax = await withSeq("2d6xk", [MAX, MAX, LOW, LOW]); // capped at 6
    out.kxOneMax = await withSeq("2d6kx", [MAX, 0.6, LOW]);       // 6! 3(drop) 2 = 8
    out.kxNoMax = await withSeq("2d6kx", [0.6, 0.8, LOW]);        // no explosion
    out.chain = await withSeq("1d6x", [MAX, MAX, LOW]);           // 6!6!2 = 14

    /* ---- 1b. the `+` inversion the transform exists to dodge ------------- */
    // THE NAIVE THING — append `x` to each term of a Cairn keep-highest weapon
    // — does not merely fail to explode properly: it changes what the weapon
    // MEANS. `evaluateFormula` rewrites `a + b` to `{a,b}kh` only when every
    // term is a bare die, so `d6x + d6x` falls through to arithmetic and SUMS.
    // Measured here so the claim is a fact and not a comment.
    {
      const orig = CONFIG.Dice.randomUniform;
      // A SEQUENCE: a flat pin at the maximum explodes for ever (core throws at
      // depth 1000). Each 6 is followed by a 2, so every chain terminates.
      const seqPin = (vals) => {
        let i = 0;
        CONFIG.Dice.randomUniform = () => vals[Math.min(i++, vals.length - 1)];
      };
      try {
        seqPin([MAX, MAX]);
        out.plainKeepHigh = (await utils.evaluateFormula("d6 + d6")).total;      // {d6,d6}kh -> 6
        seqPin([MAX, LOW, MAX, LOW]);
        out.naiveExploded = (await utils.evaluateFormula("d6x + d6x")).total;    // SUMS: 8 + 8
        seqPin([MAX, MAX, LOW]);
        out.rightExploded = (await utils.evaluateFormula("2d6kx")).total;        // keeps: 6 + 2
      } catch (e) {
        out.inversionError = `${e.name}: ${e.message}`;
      } finally {
        CONFIG.Dice.randomUniform = orig;
      }
    }

    /* ---- 2. the transform table ----------------------------------------- */
    const T = utils.explodingDamageFormula;
    out.transform = {
      d6: T("d6"), oneD8: T("1d8"), twoD10: T("2d10"),
      keep: T("2d6k"), keepH: T("2d8kh"), keepH1: T("3d6kh1"),
      plusSame: T("d6 + d6"), plusCount: T("2d6 + d6"),
      plusMixed: T("d6 + d8"),
      arithmetic: T("2d20 + 10"), already: T("1d6x"), empty: T(""),
    };

    /* ---- fixtures -------------------------------------------------------- */
    const mk = async (data) => {
      const a = await Actor.create(data);
      out.made.push(a.id);
      return a;
    };
    const pc = await mk({ name: "ZZ Crawler PC", type: "character" });
    const monster = await mk({ name: "ZZ Crawler Monster", type: "npc", system: { role: "monster" } });
    const hire = await mk({ name: "ZZ Crawler Hireling", type: "npc", system: { role: "hireling" } });

    /* ---- 3/4. the gate, end to end through the real control -------------- */
    // The quality dialog is answered by clicking its REAL Standard button, so
    // the leg exercises the path a player takes.
    const rollDamageVia = async (actor) => {
      const before = new Set(game.messages.contents.map((m) => m.id));
      await actor.sheet.render(true);
      for (let i = 0; i < 30 && !(actor.sheet.element instanceof HTMLElement); i++) await sleep(100);
      await sleep(300);
      const ctl = actor.sheet.element?.querySelector('[data-action="rollDamage"]');
      if (!ctl) return { err: "no rollDamage control" };
      ctl.click();
      let btn = null;
      for (let i = 0; i < 40 && !btn; i++) {
        btn = document.querySelector('dialog.dialog button[data-action="standard"]');
        if (!btn) await sleep(150);
      }
      if (!btn) return { err: "no quality dialog" };
      btn.click();
      let msg = null;
      for (let i = 0; i < 40 && !msg; i++) {
        msg = game.messages.contents.slice().reverse().find((m) => !before.has(m.id));
        if (!msg) await sleep(150);
      }
      await actor.sheet.close();
      return { formula: msg?.rolls?.[0]?.formula ?? null };
    };
    // EQUIPPED, because the roll control is gated on it in items-list.html — an
    // unequipped weapon renders no die at all, which reads as a missing control.
    const weapon = { name: "ZZ Blade", type: "weapon", system: { damageFormula: "d6", equipped: true } };
    await pc.createEmbeddedDocuments("Item", [weapon]);
    await monster.createEmbeddedDocuments("Item", [weapon]);

    await game.settings.set(NS, "crawler-combat-mode", true);
    await game.settings.set(NS, "crawler-exploding-damage", true);
    out.pcRoll = await rollDamageVia(pc);
    out.monsterRoll = await rollDamageVia(monster);

    await game.settings.set(NS, "crawler-exploding-damage", false);
    out.optionOffRoll = await rollDamageVia(pc);
    await game.settings.set(NS, "crawler-combat-mode", false);
    await game.settings.set(NS, "crawler-exploding-damage", true);
    // The master is OFF: `crawlerOption` ANDs it in, so a stored true must not act.
    out.masterOffRoll = await rollDamageVia(pc);
    await game.settings.set(NS, "crawler-combat-mode", true);

    /* ---- 5/6. overburdened means deprived -------------------------------- */
    const fill = async (actor, n) => {
      const items = Array.from({ length: n }, (_, i) => ({ name: `ZZ Load ${i}`, type: "item" }));
      await actor.createEmbeddedDocuments("Item", items);
    };
    const state = (a) => ({
      encumbered: a.system.encumbered === true,
      derived: a.system.deprived === true,
      source: a._source.system.deprived === true,
      used: a.system.slotsUsed, max: a.system.slotsMax,
      hp: a.system.hp.value, srcHp: a._source.system.hp.value,
    });
    out.pcBefore = state(pc);
    await fill(pc, 10);
    await fill(monster, 10);
    await fill(hire, 10);
    out.pcLoaded = state(pc);
    out.monsterLoaded = state(monster);
    out.hireLoaded = state(hire);

    // The checkbox must be disabled while the hack holds it.
    await pc.sheet.render(true);
    await sleep(500);
    const box = pc.sheet.element?.querySelector(".deprived-check");
    out.boxDisabled = box ? box.disabled === true : null;
    out.boxChecked = box ? box.checked === true : null;
    // Rest and Restore refuse while deprived — they read system.deprived.
    out.restDisabled = pc.sheet.element?.querySelector("#rest-button")?.disabled === true;
    out.restoreDisabled = pc.sheet.element?.querySelector("#restore-abilities-button")?.disabled === true;
    // The Overburdened banner is the loudest thing on the sheet, so under the
    // hack it must say BOTH consequences — left at "HP stays 0" it is a
    // half-truth and nothing explains the greyed Rest button. Found by looking
    // at the sheet while this probe was green.
    out.bannerText = [...(pc.sheet.element?.querySelectorAll("[class*=banner]") ?? [])]
      .map((b) => b.textContent.trim()).find((t) => /capacity/i.test(t)) ?? null;
    out.bannerExpected = game.i18n.localize("CAIRN.Crawler.OverburdenedBanner");
    await pc.sheet.close();

    // Hack OFF: an overburdened PC is not deprived. `reset()`, not a bare
    // `prepareData()` — the latter does NOT rebuild `system` from `_source`, so
    // a derived value set by an earlier prepare would still be sitting there
    // and the leg would be measuring staleness rather than the rule. In play
    // the master requiresReload, which is this same re-initialize.
    await game.settings.set(NS, "crawler-combat-mode", false);
    pc.reset();
    out.pcHackOff = state(pc);
    await game.settings.set(NS, "crawler-combat-mode", true);
    pc.reset();

    // Freeing a slot clears it, and SOURCE was never written at any point.
    // TWO items: `encumbered` is `slotsUsed >= slotsMax`, so going 11 -> 10 is
    // still overburdened. That is the rule, not an off-by-one.
    const spares = pc.items.filter((i) => i.name.startsWith("ZZ Load")).slice(0, 2);
    await pc.deleteEmbeddedDocuments("Item", spares.map((i) => i.id));
    out.pcFreed = state(pc);

    /* ---- 8/9. the Fatigue button ---------------------------------------- */
    await game.settings.set(NS, "crawler-fatigue-for-critical", true);
    const postSave = async (actor, fatigue) => {
      const card = {
        kind: "save", ability: "STR", formula: "d20cs<=10",
        rolled: 17, failed: true, crit: true, fatigue,
      };
      const m = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: utils.d20CardBody(card),
        flags: { "air-bladder": { d20Card: card } },
      });
      await sleep(400);
      return m;
    };
    const rowOf = (m) => document.querySelector(`[data-message-id="${m.id}"]`);

    const m1 = await postSave(pc, true);
    out.fatigueBtnRenders = !!rowOf(m1)?.querySelector(".take-fatigue-instead");
    out.critBtnRenders = !!rowOf(m1)?.querySelector(".mark-critical-damage");
    out.tipKeyed = rowOf(m1)?.querySelector(".take-fatigue-instead")?.dataset.tooltip ?? null;

    const fatigueBefore = pc.items.filter((i) => i.name === "Fatigue").length;
    const usedBefore = pc.system.slotsUsed;
    rowOf(m1).querySelector(".take-fatigue-instead").click();
    for (let i = 0; i < 40 && pc.items.filter((x) => x.name === "Fatigue").length === fatigueBefore; i++) await sleep(150);
    await sleep(400);
    out.fatigueAdded = pc.items.filter((i) => i.name === "Fatigue").length - fatigueBefore;
    out.critAfterFatigue = pc._source.system.critical === true;
    out.afterFatigue = state(pc);
    out.usedGrew = pc.system.slotsUsed > usedBefore;
    out.spentFlag = m1.getFlag("air-bladder", "crawlerChoiceTaken") === true;
    // Both buttons sealed, and still sealed after a re-render.
    await ui.chat.render(true);
    await sleep(500);
    out.sealedCrit = rowOf(m1)?.querySelector(".mark-critical-damage")?.disabled === true;
    out.sealedFatigue = rowOf(m1)?.querySelector(".take-fatigue-instead")?.disabled === true;
    // A second click adds nothing.
    rowOf(m1)?.querySelector(".take-fatigue-instead")?.click();
    await sleep(500);
    out.fatigueAfterSecondClick = pc.items.filter((i) => i.name === "Fatigue").length - fatigueBefore;

    // Exclusivity the other way: Mark Critical Damage spends the same choice.
    const m2 = await postSave(pc, true);
    rowOf(m2).querySelector(".mark-critical-damage").click();
    for (let i = 0; i < 40 && pc._source.system.critical !== true; i++) await sleep(150);
    await sleep(400);
    out.critSpends = m2.getFlag("air-bladder", "crawlerChoiceTaken") === true;
    out.critSealedFatigue = rowOf(m2)?.querySelector(".take-fatigue-instead")?.disabled === true;

    // The option off: no button on a new card.
    await game.settings.set(NS, "crawler-fatigue-for-critical", false);
    const m3 = await postSave(monster, false);
    out.noBtnWhenOff = !rowOf(m3)?.querySelector(".take-fatigue-instead");
    out.madeMsgs = [m1.id, m2.id, m3.id];

    /* ---- 10. the submenu greying ---------------------------------------- */
    await game.settings.set(NS, "crawler-combat-mode", false);
    const menu = game.settings.menus.get(`${NS}.hacks`);
    const app = menu ? new menu.type() : null;
    if (app) { await app.render(true); await sleep(700); }
    const root = app?.element;
    const dis = (k) => root?.querySelector(`[name="${NS}.${k}"]`)?.disabled ?? null;
    out.greyedOff = { ex: dis("crawler-exploding-damage"), fa: dis("crawler-fatigue-for-critical") };
    // The OTHER spec must still work — its master lives in another submenu and
    // is read from the stored value at render. This is the regression witness
    // for widening subOptions to a list.
    out.barebonesSub = {
      masterStored: game.settings.get(NS, "content-source-barebones"),
      disabled: dis("barebones-failed-career"),
    };
    // Live branch: tick the master IN this app and the rows must un-grey
    // without anything being saved.
    const master = root?.querySelector(`[name="${NS}.crawler-combat-mode"]`);
    if (master) {
      master.checked = true;
      master.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(200);
    }
    out.greyedOn = { ex: dis("crawler-exploding-damage"), fa: dis("crawler-fatigue-for-critical") };
    if (app) await app.close();

    return out;
  }));

  // ---- 1. the keystone ---------------------------------------------------
  const seq = (d) => (d?.faces ?? []).map((t) => t.map((x) =>
    x.r + (x.discarded ? "(drop)" : x.exploded ? "!" : "")).join(" ")).join(" | ");
  r.kxBothMax?.total === 8
    ? ok(`2d6kx with two 6s keeps ONE and explodes only that: ${seq(r.kxBothMax)} = 8`)
    : fail(`2d6kx both-max gave ${JSON.stringify(r.kxBothMax)}, expected total 8 (6 kept + 2)`);
  r.xkBothMax?.total === 6
    ? ok("CONTROL: 2d6xk — the SAME modifiers reversed — is capped at 6, because keep compares raw faces")
    : fail(`2d6xk gave ${JSON.stringify(r.xkBothMax)}, expected 6; if this changed, modifier order no longer works as the feature assumes`);
  r.kxOneMax?.total === 8 && r.kxNoMax?.total === 3
    ? ok("...one 6 and a 3 explodes the 6 (=8); no max rolls no explosion (=3)")
    : fail(`kxOneMax=${JSON.stringify(r.kxOneMax)}, kxNoMax=${JSON.stringify(r.kxNoMax)}`);
  r.chain?.total === 14
    ? ok("...and a chain keeps going: 1d6x rolling 6, 6, 2 is 14")
    : fail(`1d6x chain gave ${JSON.stringify(r.chain)}, expected 14`);

  // ---- 1b. the inversion -------------------------------------------------
  r.plainKeepHigh === 6 && r.naiveExploded === 16 && r.rightExploded === 8
    ? ok(`the "+" trap is real and measured: d6 + d6 keeps highest (6), but d6x + d6x SUMS two chains (16) — the transform emits 2d6kx (8) so no "+" survives`)
    : fail(`inversion: plain=${r.plainKeepHigh} (want 6), naive=${r.naiveExploded} (want 16, a sum), right=${r.rightExploded} (want 8)${r.inversionError ? " — " + r.inversionError : ""}`);

  // ---- 2. the transform --------------------------------------------------
  const WANT = {
    d6: "d6x", oneD8: "1d8x", twoD10: "2d10x",
    keep: "2d6kx", keepH: "2d8khx", keepH1: "3d6kh1x",
    plusSame: "2d6kx", plusCount: "3d6kx",
    plusMixed: "d6 + d8", arithmetic: "2d20 + 10", already: "1d6x", empty: "",
  };
  const bad = Object.entries(WANT).filter(([k, v]) => r.transform?.[k] !== v);
  bad.length === 0
    ? ok(`the formula transform is right on all ${Object.keys(WANT).length} shapes, including d6 + d6 -> 2d6kx (no "+" left for the Cairn rewrite to invert)`)
    : fail(`transform: ${JSON.stringify(bad.map(([k, v]) => [k, r.transform?.[k], "want " + v]))}`);

  // ---- 3/4. the gate -----------------------------------------------------
  /x/.test(r.pcRoll?.formula ?? "")
    ? ok(`a player character's damage roll explodes (${r.pcRoll.formula})`)
    : fail(`PC damage formula was ${JSON.stringify(r.pcRoll)}, expected it to carry x`);
  r.monsterRoll?.formula && !/x/.test(r.monsterRoll.formula)
    ? ok(`...and a monster's does NOT (${r.monsterRoll.formula}) — PCs only, at the same moment`)
    : fail(`monster damage formula was ${JSON.stringify(r.monsterRoll)}, expected no x`);
  !/x/.test(r.optionOffRoll?.formula ?? "x")
    ? ok("...with the option off, nothing explodes")
    : fail(`option off still exploded: ${JSON.stringify(r.optionOffRoll)}`);
  !/x/.test(r.masterOffRoll?.formula ?? "x")
    ? ok("...and a stored option under a master that is OFF does not act either")
    : fail(`master off still exploded: ${JSON.stringify(r.masterOffRoll)}`);

  // ---- 5/6. deprived -----------------------------------------------------
  r.pcLoaded?.encumbered && r.pcLoaded?.derived && !r.pcLoaded?.source
    ? ok(`an overburdened PC is deprived (${r.pcLoaded.used}/${r.pcLoaded.max}) — DERIVED, with _source untouched`)
    : fail(`loaded PC: ${JSON.stringify(r.pcLoaded)} — want encumbered, derived deprived, source false`);
  r.pcLoaded?.hp === 0 && r.pcLoaded?.srcHp !== 0
    ? ok("...at 0 Hit Protection, with source HP intact")
    : fail(`PC hp derived=${r.pcLoaded?.hp} source=${r.pcLoaded?.srcHp}`);
  !r.monsterLoaded?.derived && !r.hireLoaded?.derived
    ? ok("an overburdened monster and hireling are NOT deprived — the hack is PCs only")
    : fail(`monster derived=${r.monsterLoaded?.derived}, hireling derived=${r.hireLoaded?.derived}`);
  !r.pcHackOff?.derived && r.pcHackOff?.encumbered
    ? ok("...and with the hack OFF an overburdened PC is not deprived either")
    : fail(`hack off: ${JSON.stringify(r.pcHackOff)}`);
  !r.pcFreed?.derived && !r.pcFreed?.source
    ? ok("freeing a slot clears it, and the player's own stored value was never written")
    : fail(`after freeing: ${JSON.stringify(r.pcFreed)}`);
  r.boxDisabled === true && r.boxChecked === true
    ? ok("the Deprived checkbox shows ticked and is DISABLED while the hack holds it")
    : fail(`deprived checkbox: disabled=${r.boxDisabled}, checked=${r.boxChecked}`);
  r.restDisabled && r.restoreDisabled
    ? ok("...and Rest and Restore Abilities refuse, through the field they already read")
    : fail(`rest disabled=${r.restDisabled}, restore disabled=${r.restoreDisabled}`);
  (r.bannerText ?? "").includes(r.bannerExpected ?? "\u0000")
    ? ok("...and the Overburdened banner names BOTH consequences, not just the HP")
    : fail(`banner reads ${JSON.stringify(r.bannerText)}, expected it to contain ${JSON.stringify(r.bannerExpected)}`);

  // ---- 8/9. the Fatigue button -------------------------------------------
  r.fatigueBtnRenders && r.critBtnRenders
    ? ok("a failed PC save offers BOTH Mark Critical Damage and Take a Fatigue instead")
    : fail(`buttons: fatigue=${r.fatigueBtnRenders}, crit=${r.critBtnRenders}`);
  r.tipKeyed === "CAIRN.Crawler.FatigueButtonTip"
    ? ok("...and the Fatigue button names its cost in a tooltip, the only place it can")
    : fail(`tooltip attribute is ${JSON.stringify(r.tipKeyed)}`);
  r.fatigueAdded === 1 && r.usedGrew
    ? ok("clicking it adds exactly one Fatigue, past a full pack")
    : fail(`fatigue added=${r.fatigueAdded}, slots grew=${r.usedGrew}`);
  r.critAfterFatigue === false
    ? ok("...and does NOT set Critical Damage — that is the whole point of the choice")
    : fail("taking the Fatigue also marked Critical Damage");
  r.afterFatigue?.derived && r.afterFatigue?.hp === 0 && r.afterFatigue?.srcHp !== 0
    ? ok("...leaving the character deprived at 0 Hit Protection, source HP intact")
    : fail(`after fatigue: ${JSON.stringify(r.afterFatigue)}`);
  r.spentFlag && r.sealedCrit && r.sealedFatigue && r.fatigueAfterSecondClick === 1
    ? ok("the choice is spent on the MESSAGE: both buttons stay sealed across a re-render and a second click adds nothing")
    : fail(`spent=${r.spentFlag}, sealedCrit=${r.sealedCrit}, sealedFatigue=${r.sealedFatigue}, secondClick total=${r.fatigueAfterSecondClick}`);
  r.critSpends && r.critSealedFatigue
    ? ok("...and pressing Mark Critical Damage spends the same choice, so nobody takes both")
    : fail(`crit spent=${r.critSpends}, sealed fatigue=${r.critSealedFatigue}`);
  r.noBtnWhenOff
    ? ok("with the option off, a new save card carries no Fatigue button")
    : fail("the Fatigue button rendered with the option off");

  // ---- 10. settings ------------------------------------------------------
  Object.values(r.configFlags ?? {}).every((v) => v === false) && r.inSettingKeys?.length === 3 && r.inInternal?.length === 0
    ? ok("all three keys registered config:false, in SETTING_KEYS, none internal")
    : fail(`config=${JSON.stringify(r.configFlags)}, inKeys=${JSON.stringify(r.inSettingKeys)}, internal=${JSON.stringify(r.inInternal)}`);
  r.reload === true
    ? ok("the master requiresReload — it changes a DERIVED value, the use-panic precedent")
    : fail(`crawler-combat-mode requiresReload is ${r.reload}, expected true`);
  JSON.stringify(r.subSpecs) === JSON.stringify(["content-source-barebones", "crawler-combat-mode"])
    ? ok("the Hacks group declares TWO subOptions specs")
    : fail(`subOptions masters are ${JSON.stringify(r.subSpecs)}`);
  r.greyedOff?.ex === true && r.greyedOff?.fa === true
    ? ok("...both option rows greyed while the master is off")
    : fail(`greyed with master off: ${JSON.stringify(r.greyedOff)}`);
  r.greyedOn?.ex === false && r.greyedOn?.fa === false
    ? ok("...and un-greyed LIVE when the master is ticked, before anything is saved")
    : fail(`greyed after ticking the master: ${JSON.stringify(r.greyedOn)}`);
  r.barebonesSub?.disabled === !r.barebonesSub?.masterStored
    ? ok(`REGRESSION WITNESS: the Barebones sub-option still follows its own master in another submenu (stored ${r.barebonesSub.masterStored} -> disabled ${r.barebonesSub.disabled})`)
    : fail(`Barebones sub-option: ${JSON.stringify(r.barebonesSub)} — widening subOptions to a list broke the cross-menu branch`);

  // Cleanup: the actors and the three cards this probe minted.
  await page.evaluate(async ({ ids, msgs }) => {
    for (const id of ids ?? []) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
    for (const id of msgs ?? []) { try { await game.messages.get(id)?.delete(); } catch { /* gone */ } }
  }, { ids: r.made, msgs: r.madeMsgs });
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nCRAWLER COMBAT PROBE FAILED\n" : "\ncrawler combat probe passed\n");
process.exit(failed ? 1 : 0);

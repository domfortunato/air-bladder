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
    const out = { made: [], made2: [] };
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
      // THE d6 FLOOR (user ruling 2026-10-02). These five rows are the ones this
      // table never had, which is exactly why an impaired `1d4` shipped exploding
      // in a16e42e0 with every leg green: a transform table with no d4 in it is a
      // claim about the input space that leaves out the case that fires most.
      // `1d5` pins the threshold as `< 6` rather than `<= 4`, so a nonstandard die
      // cannot fall between "d4 or lower" and "d6 or larger".
      d4: T("1d4"), d4bare: T("d4"), d4keep: T("2d4k"), d4plus: T("d4 + d4"),
      d5: T("1d5"),
      // ...and the enhanced die, which still explodes. The pair is the point:
      // one quality substitution is excluded and the other is not.
      d12: T("1d12"),
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
      for (let i = 0; i < 80 && !btn; i++) {
        btn = document.querySelector('dialog.dialog button[data-action="standard"]');
        if (!btn) await sleep(150);
      }
      if (!btn) return { err: "no quality dialog" };
      btn.click();
      let msg = null;
      for (let i = 0; i < 90 && !msg; i++) {
        msg = game.messages.contents.slice().reverse().find(
          (m) => !before.has(m.id) && m.speaker?.actor === actor.id);
        if (!msg) await sleep(200);
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

    // PART 1: the button wears the teal Fatigue wears, read off the LIVE card and
    // BEFORE the click below seals it (a disabled button may paint differently).
    // The COLOUR and not merely the presence: `textShadow !== "none"` cannot see
    // which colour it is, which is the whole failure mode -- --ab-accent and
    // --ab-fatigue-chat are the SAME hue in light mode and differ only in dark.
    const glowOf = (cs) => (cs.textShadow.match(/rgba?\([^)]*\)/) ?? [null])[0];
    const readBtns = () => {
      const f = rowOf(m1)?.querySelector(".take-fatigue-instead");
      const c = rowOf(m1)?.querySelector(".mark-critical-damage");
      if (!f || !c) return null;
      const fcs = getComputedStyle(f), ccs = getComputedStyle(c);
      return {
        border: fcs.borderTopColor, glow: glowOf(fcs), weight: fcs.fontWeight,
        boxShadow: fcs.boxShadow,
        critBorder: ccs.borderTopColor, critGlow: glowOf(ccs),
      };
    };
    // EXPLICITLY LIGHT, not "whatever the dev world is set to". The first read
    // came back as the DARK accent under the --ab-accent control, which showed the
    // world's interface is dark by default -- so an unset first read would have
    // measured the same scheme twice and the CONTRAST, which is the whole point,
    // would have been untested. The user runs LIGHT.
    const uiCfg0 = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
    const setScheme = async (s) => {
      const cfg = foundry.utils.deepClone(uiCfg0);
      cfg.colorScheme = { applications: s, interface: s };
      game.configureUI(cfg);
      await sleep(600);
    };
    await setScheme("light");
    out.btnLight = readBtns();
    // ...and again under a DARK interface, through core's own configureUI (the
    // Applications theme lands on <body>, the INTERFACE theme on #interface, so
    // a body-only flip never reaches chat). The pinned token must not move.
    try {
      await setScheme("dark");
      out.btnDark = readBtns();
    } finally {
      // Nothing was WRITTEN: configureUI takes the config as an argument, so the
      // world's own stored setting was never touched.
      game.configureUI(game.settings.get("core", "uiConfig"));
      await sleep(400);
    }

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

    /* ---- 11. Part 2: every explosion is announced on the card ------------ */
    // THE KEYSTONE FIRST, and read back off the STORED message rather than the
    // in-memory Roll: the whole feature rests on `exploded` surviving
    // serialization (DiceTerm.SERIALIZE_ATTRIBUTES includes "results"), and an
    // assertion against the object we just built would prove nothing about that.
    await game.settings.set(NS, "crawler-combat-mode", true);
    await game.settings.set(NS, "crawler-exploding-damage", true);
    await game.settings.set(NS, "crawler-maneuver-on-max", false);

    // A terminating sequence, NEVER a flat pin at the maximum: an exploding
    // formula pinned at max throws at recursion depth 1000.
    const seqRoll = async (formula, vals) => {
      const orig = CONFIG.Dice.randomUniform;
      let i = 0;
      // INVERTED: u near 1 rolls 1, u near 0 rolls the maximum.
      CONFIG.Dice.randomUniform = () => vals[Math.min(i++, vals.length - 1)];
      try {
        const roll = await new Roll(formula).evaluate();
        const m = await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: pc }),
          flavor: await foundry.applications.handlebars.renderTemplate(
            "systems/air-bladder/templates/chat/dmg-roll-card.html",
            { label: "ZZ explode", weapon: "ZZ Blade", panic: false }),
        });
        out.made2.push(m.id);
        await sleep(450);
        return m;
      } finally {
        CONFIG.Dice.randomUniform = orig;
      }
    };
    const MAXU = 0.0001, LOWU = 0.9999;

    // 2d6kx with the kept die going 6 -> 6 -> 3: two explosions, two lines.
    const chainMsg = await seqRoll("2d6kx", [MAXU, LOWU, MAXU, 0.5]);
    const stored = game.messages.get(chainMsg.id);
    out.storedExploded = (stored?.rolls?.[0]?.dice?.[0]?.results ?? [])
      .filter((r) => r.exploded).length;
    const linesOf = (m) => Array.from(
      document.querySelector(`[data-message-id="${m.id}"]`)
        ?.querySelectorAll(".dmg-exploded") ?? []).map((e) => e.textContent.trim());
    out.chainLines = linesOf(chainMsg);

    // IDEMPOTENCE: the hook fires on every render and this one APPENDS.
    await ui.chat.render(true);
    await sleep(500);
    out.chainLinesAfterRerender = linesOf(chainMsg);

    // TWO SIXES ARE ONE SIX: the dropped die is inactive, so `explode` skips it
    // and only the kept one chains. One line, not two -- which is a second,
    // independent witness that the modifier order is `kx` and not `xk`.
    const twoSixes = await seqRoll("2d6kx", [MAXU, MAXU, 0.5]);
    out.twoSixesLines = linesOf(twoSixes);

    // Nothing exploded: no lines at all.
    const plainMsg = await seqRoll("1d6", [0.5]);
    out.plainLines = linesOf(plainMsg);

    /* ---- 12. Part 3: maneuver on max melee damage ------------------------ */
    // Fixtures the shipped content cannot supply: a melee d4 weapon (no shipped
    // melee weapon is sub-d6, so a probe using only shipped gear would assert the
    // floor against nothing) and an explicitly ranged one.
    await pc.createEmbeddedDocuments("Item", [
      { name: "ZZ Ranged Bow", type: "weapon", system: { damageFormula: "d6", equipped: false, ranged: true } },
      { name: "ZZ Tiny Blade", type: "weapon", system: { damageFormula: "d4", equipped: false } },
      { name: "ZZ Big Blade", type: "weapon", system: { damageFormula: "d10", equipped: false } },
    ]);
    const equipOnly = async (name) => {
      const ups = pc.items.filter((i) => i.type === "weapon")
        .map((i) => ({ _id: i.id, "system.equipped": i.name === name }));
      await pc.updateEmbeddedDocuments("Item", ups);
      await sleep(150);
    };

    // Roll a named weapon through the REAL control, answering the real dialog,
    // and report what the card became. `quality` picks the dialog button, so the
    // impaired leg goes through the same gesture a panicked player takes.
    const rollWeapon = async (actor, name, quality = "standard") => {
      await equipOnly(name);
      // THE PIN IS PER ROLL, and that is not a tidy-up. One pin around the whole
      // block shares its counter, so only the FIRST roll in it lands on the
      // maximum and every later leg rolls a 1 — which makes "offers no maneuver"
      // trivially true for the ranged, d4 and impaired legs and passes them for
      // the wrong reason. Max first, low after: the maximum is the precondition
      // every one of these legs needs, and the low values terminate the chain on
      // the rows whose formula really does carry x (a flat pin at the maximum
      // throws at recursion depth 1000 rather than capping).
      const origRU = CONFIG.Dice.randomUniform;
      let ru = 0;
      CONFIG.Dice.randomUniform = () => (ru++ === 0 ? MAXU : LOWU);
      const before = new Set(game.messages.contents.map((m) => m.id));
      await actor.sheet.render(true);
      for (let i = 0; i < 30 && !(actor.sheet.element instanceof HTMLElement); i++) await sleep(100);
      await sleep(300);
      const ctl = actor.sheet.element?.querySelector('[data-action="rollDamage"]');
      if (!ctl) { await actor.sheet.close(); CONFIG.Dice.randomUniform = origRU; return { err: "no rollDamage control" }; }
      ctl.click();
      let btn = null;
      for (let i = 0; i < 80 && !btn; i++) {
        btn = document.querySelector(`dialog.dialog button[data-action="${quality}"]`);
        if (!btn) await sleep(150);
      }
      if (!btn) { await actor.sheet.close(); CONFIG.Dice.randomUniform = origRU; return { err: `no ${quality} button` }; }
      btn.click();
      let msg = null;
      for (let i = 0; i < 90 && !msg; i++) {
        msg = game.messages.contents.slice().reverse().find(
          (m) => !before.has(m.id) && m.speaker?.actor === actor.id);
        if (!msg) await sleep(200);
      }
      await actor.sheet.close();
      CONFIG.Dice.randomUniform = origRU;
      if (!msg) return { err: "no message" };
      out.made2.push(msg.id);
      await sleep(400);
      const row = document.querySelector(`[data-message-id="${msg.id}"]`);
      return {
        id: msg.id,
        formula: msg.rolls?.[0]?.formula ?? null,
        total: msg.rolls?.[0]?.total ?? null,
        datum: !!row?.querySelector("[data-maneuver]"),
        explodeBtn: !!row?.querySelector(".explode-the-die"),
        maneuverBtn: !!row?.querySelector(".take-maneuver"),
        tips: {
          explode: row?.querySelector(".explode-the-die")?.dataset.tooltip ?? null,
          maneuver: row?.querySelector(".take-maneuver")?.dataset.tooltip ?? null,
        },
      };
    };

    await game.settings.set(NS, "crawler-maneuver-on-max", true);
    await game.settings.set(NS, "crawler-exploding-damage", true);
    // No block-level pin: rollWeapon pins each roll itself — see its comment.
    {
      // BOTH options on, melee d10, max rolled: the die must NOT have exploded at
      // roll time, and both buttons must be on offer.
      out.mvBoth = await rollWeapon(pc, "ZZ Big Blade");
      // RANGED: no maneuver, and it auto-explodes -- the two halves of the gate.
      out.mvRanged = await rollWeapon(pc, "ZZ Ranged Bow");
      // THE FLOOR, melee d4: neither offers nor explodes.
      out.mvD4 = await rollWeapon(pc, "ZZ Tiny Blade");
      // THE FLOOR VIA IMPAIRED, on a d10 weapon -- the case that actually fires,
      // and the one that proves the test reads the POST-quality formula. Judged on
      // the weapon it would both explode and offer.
      out.mvImpaired = await rollWeapon(pc, "ZZ Big Blade", "impaired");
      // ENHANCED is a d12 and stays in.
      out.mvEnhanced = await rollWeapon(pc, "ZZ Big Blade", "enhanced");
      // A MONSTER never offers.
      await monster.createEmbeddedDocuments("Item",
        [{ name: "ZZ Big Blade", type: "weapon", system: { damageFormula: "d10", equipped: true } }]);
      out.mvMonster = await rollWeapon(monster, "ZZ Big Blade");

      // Maneuver OFF, exploding ON: back to auto-explode with no buttons.
      await game.settings.set(NS, "crawler-maneuver-on-max", false);
      out.mvOptionOff = await rollWeapon(pc, "ZZ Big Blade");
      await game.settings.set(NS, "crawler-maneuver-on-max", true);

      // Maneuver ON, exploding OFF: Maneuver alone, no Explode button.
      await game.settings.set(NS, "crawler-exploding-damage", false);
      out.mvNoExplode = await rollWeapon(pc, "ZZ Big Blade");
      await game.settings.set(NS, "crawler-exploding-damage", true);
    }

    /* ---- 13. pressing the buttons ---------------------------------------- */
    // EXPLODE: the chain is rolled now, the stored total GROWS, the lines appear,
    // DSN is asked to animate, and the choice seals.
    const card = await rollWeapon(pc, "ZZ Big Blade");
    out.explodeBefore = { total: card.total, formula: card.formula };
    // Shadow showForRoll: the CALL is what is asserted, never the animation, so
    // the leg does not depend on DSN's timing. DSN must be ACTIVE though -- a
    // thing the probe cannot observe is not a thing it has checked.
    out.dsnActive = !!game.dice3d;
    const dsnCalls = [];
    const origShow = game.dice3d?.showForRoll;
    if (origShow) {
      game.dice3d.showForRoll = function (roll, user, synchronize, users, blind, messageID, ...rest) {
        dsnCalls.push({ formula: roll?.formula ?? null, synchronize, messageID });
        return origShow.call(this, roll, user, synchronize, users, blind, messageID, ...rest);
      };
    }
    try {
      const row = () => document.querySelector(`[data-message-id="${card.id}"]`);
      if (!row()?.querySelector(".explode-the-die")) {
        out.explodeAfter = { err: "no Explode the Die button to press" };
        out.dsnCalls = [];
        throw new Error("SKIP_EXPLODE");
      }
      // The chain rolls 6 then a low value, so it stops: pinned mid-click.
      const o2 = CONFIG.Dice.randomUniform;
      let k = 0;
      const seq = [MAXU, 0.5];
      CONFIG.Dice.randomUniform = () => seq[Math.min(k++, seq.length - 1)];
      try {
        row().querySelector(".explode-the-die").click();
        for (let i = 0; i < 60 && !game.messages.get(card.id)?.getFlag(NS, "maneuverChoice"); i++) await sleep(200);
      } finally { CONFIG.Dice.randomUniform = o2; }
      await sleep(600);
      const after = game.messages.get(card.id);
      out.explodeAfter = {
        total: after?.rolls?.[0]?.total ?? null,
        formula: after?.rolls?.[0]?.formula ?? null,
        choice: after.getFlag(NS, "maneuverChoice") ?? null,
        exploded: (after?.rolls?.[0]?.dice?.[0]?.results ?? []).filter((r) => r.exploded).length,
      };
      await ui.chat.render(true);
      await sleep(500);
      out.explodeLines = linesOf(after);
      out.explodeSealed = {
        explode: row()?.querySelector(".explode-the-die")?.disabled === true,
        maneuver: row()?.querySelector(".take-maneuver")?.disabled === true,
      };
      out.dsnCalls = dsnCalls;
    } catch (e) {
      if (e?.message !== "SKIP_EXPLODE") throw e;
    } finally {
      if (origShow) game.dice3d.showForRoll = origShow;
      out.dsnShadowLifted = game.dice3d ? game.dice3d.showForRoll === origShow : null;
    }

    // MANEUVER: the damage is forgone -- the flag records it, the line appears,
    // the Apply control greys, and the total is left exactly as it was.
    const card2 = await rollWeapon(pc, "ZZ Big Blade");
    const row2 = () => document.querySelector(`[data-message-id="${card2.id}"]`);
    if (!row2()?.querySelector(".take-maneuver")) {
      out.maneuverTaken = { err: "no Maneuver button to press" };
    } else {
    row2().querySelector(".take-maneuver").click();
    for (let i = 0; i < 60 && !game.messages.get(card2.id)?.getFlag(NS, "maneuverChoice"); i++) await sleep(200);
    await ui.chat.render(true);
    await sleep(600);
    const mvMsg = game.messages.get(card2.id);
    out.maneuverTaken = {
      choice: mvMsg.getFlag(NS, "maneuverChoice") ?? null,
      total: mvMsg.rolls?.[0]?.total ?? null,
      wasTotal: card2.total,
      forgoneLine: !!row2()?.querySelector(".dmg-forgone"),
      applySpent: row2()?.querySelector(".apply-dmg")?.classList.contains("spent") ?? null,
      sealed: row2()?.querySelector(".take-maneuver")?.disabled === true,
      explodeGone: row2()?.querySelector(".explode-the-die")?.disabled === true,
    };
    // A second click adds nothing and cannot flip the choice.
    row2()?.querySelector(".explode-the-die")?.click();
    await sleep(500);
    out.maneuverStillManeuver = game.messages.get(card2.id).getFlag(NS, "maneuverChoice");
    }

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
    // The floor: every sub-d6 shape comes back UNCHANGED, and d12 still explodes.
    d4: "1d4", d4bare: "d4", d4keep: "2d4k", d4plus: "d4 + d4", d5: "1d5",
    d12: "1d12x",
  };
  const bad = Object.entries(WANT).filter(([k, v]) => r.transform?.[k] !== v);
  bad.length === 0
    ? ok(`the formula transform is right on all ${Object.keys(WANT).length} shapes, including d6 + d6 -> 2d6kx (no "+" left for the Cairn rewrite to invert), every sub-d6 shape left alone (1d4, d4, 2d4k, d4 + d4, 1d5) and 1d12 still exploding`)
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

  // ---- Part 1: the Fatigue button wears Fatigue's teal -------------------
  const TEAL = "rgb(18, 163, 180)";
  const bl = r.btnLight, bd = r.btnDark;
  bl && bl.border === TEAL && bl.glow === TEAL && Number(bl.weight) >= 700
    ? ok(`Take a Fatigue instead wears the Fatigue teal: ${TEAL} border + 8px text glow, bold`)
    : fail(`fatigue button style (light): ${JSON.stringify(bl)} — want border/glow ${TEAL}, weight >= 700`);
  bl && bl.boxShadow === "none"
    ? ok(`...as a BORDER and not a halo — the matched-pair treatment, not .grimoire-add-fatigue's box-shadow`)
    : fail(`fatigue button has a box-shadow (${bl?.boxShadow}); the ruling was the bordered shape`);
  bl && bl.critBorder !== TEAL && /^rgb/.test(bl.critBorder ?? "")
    ? ok(`...and Mark Critical Damage beside it is STILL red (${bl.critBorder}) — one selector cannot repaint both`)
    : fail(`Mark Critical Damage border is ${bl?.critBorder}; the pair must stay two colours`);
  // THE DISCRIMINATING HALF. --ab-accent is re-pointed to #35c8da for a
  // .chat-message under a dark interface while --ab-fatigue-chat is declared once
  // on :root. In LIGHT the two are the same hue, so only this read can tell the
  // right token from the wrong one.
  bd && bd.border === TEAL && bd.glow === TEAL
    ? ok(`...and it is UNCHANGED under a dark interface (${bd.border}) — the pinned --ab-fatigue-chat, never --ab-accent (which would read rgb(53, 200, 218) here)`)
    : fail(`fatigue button under a dark interface: ${JSON.stringify(bd)} — want ${TEAL}. rgb(53, 200, 218) means the rule reached for --ab-accent`);

  // ---- Part 2: every explosion is announced -----------------------------
  r.storedExploded === 2
    ? ok(`the STORED roll carries both explosions (exploded x${r.storedExploded}) — DiceTerm.SERIALIZE_ATTRIBUTES keeps its results array, which is what the whole feature rests on`)
    : fail(`stored exploded count was ${r.storedExploded}, want 2 — read back off game.messages, so this is about serialization and not the in-memory Roll`);
  r.chainLines?.length === 2 && r.chainLines.every((t) => /d6/.test(t) && t.length > 4)
    ? ok(`a 6 -> 6 -> 3 chain prints TWO lines, one per explosion: ${JSON.stringify(r.chainLines)}`)
    : fail(`chain lines were ${JSON.stringify(r.chainLines)}, want two localized d6 lines`);
  r.chainLinesAfterRerender?.length === 2
    ? ok(`...and still two after ui.chat.render(true) — the append is idempotent`)
    : fail(`after a re-render there were ${r.chainLinesAfterRerender?.length} lines, want 2 — the guard is missing and the hook doubled them`);
  r.twoSixesLines?.length === 1
    ? ok(`TWO SIXES ARE ONE SIX: one line, not two — a second, independent witness that the formula is 2d6kx and not 2d6xk`)
    : fail(`two sixes produced ${r.twoSixesLines?.length} line(s), want 1 — if 2, the dropped die exploded and the modifier order is reversed`);
  r.plainLines?.length === 0
    ? ok(`...and a card where nothing exploded carries no line at all`)
    : fail(`a plain 1d6 card carried ${r.plainLines?.length} line(s)`);

  // ---- Part 3: the maneuver gate ----------------------------------------
  const noX = (f) => !!f && !/x/.test(f);
  const hasX = (f) => !!f && /x/.test(f);
  r.mvBoth && noX(r.mvBoth.formula) && r.mvBoth.datum && r.mvBoth.explodeBtn && r.mvBoth.maneuverBtn
    ? ok(`both options on, melee d10 at its max: the die did NOT explode at roll time (${r.mvBoth.formula}) and the card offers Explode the Die AND Maneuver`)
    : fail(`mvBoth: ${JSON.stringify(r.mvBoth)} — want an unexploded formula and both buttons`);
  r.mvBoth?.tips?.explode === "CAIRN.Crawler.ExplodeButtonTip"
    && r.mvBoth?.tips?.maneuver === "CAIRN.Crawler.ManeuverButtonTip"
    ? ok(`...and each button carries its own data-tooltip key, so hovering says what it does`)
    : fail(`button tooltips were ${JSON.stringify(r.mvBoth?.tips)}`);
  r.mvRanged && hasX(r.mvRanged.formula) && !r.mvRanged.datum && !r.mvRanged.maneuverBtn
    ? ok(`a RANGED weapon offers no maneuver and auto-explodes (${r.mvRanged.formula}) — both halves of the new ranged field`)
    : fail(`mvRanged: ${JSON.stringify(r.mvRanged)} — want x in the formula and no buttons`);
  r.mvD4 && noX(r.mvD4.formula) && !r.mvD4.maneuverBtn
    ? ok(`THE FLOOR: a melee d4 neither explodes (${r.mvD4.formula}) nor offers a maneuver`)
    : fail(`mvD4: ${JSON.stringify(r.mvD4)} — a sub-d6 die must do neither`);
  r.mvImpaired && /d4/.test(r.mvImpaired.formula ?? "") && noX(r.mvImpaired.formula) && !r.mvImpaired.maneuverBtn
    ? ok(`...and so does an IMPAIRED attack on a d10 weapon (${r.mvImpaired.formula}) — the case that actually fires, and proof the test reads the POST-quality formula`)
    : fail(`mvImpaired: ${JSON.stringify(r.mvImpaired)} — want 1d4, no x, no buttons. A formula with x means the floor is missing; buttons mean the gate judged the WEAPON instead of the roll`);
  r.mvEnhanced && /d12/.test(r.mvEnhanced.formula ?? "") && r.mvEnhanced.maneuverBtn
    ? ok(`...while an ENHANCED attack (${r.mvEnhanced.formula}) is still in — the two quality substitutions fall on opposite sides of the floor`)
    : fail(`mvEnhanced: ${JSON.stringify(r.mvEnhanced)} — a d12 must still offer`);
  r.mvMonster && !r.mvMonster.datum && !r.mvMonster.maneuverBtn
    ? ok(`a MONSTER is offered nothing — player characters only, as everywhere else in this hack`)
    : fail(`mvMonster: ${JSON.stringify(r.mvMonster)}`);
  r.mvOptionOff && hasX(r.mvOptionOff.formula) && !r.mvOptionOff.maneuverBtn
    ? ok(`maneuver OFF with exploding on: back to auto-explode (${r.mvOptionOff.formula}) and no buttons — the shipped behaviour, untouched`)
    : fail(`mvOptionOff: ${JSON.stringify(r.mvOptionOff)}`);
  r.mvNoExplode && !r.mvNoExplode.explodeBtn && r.mvNoExplode.maneuverBtn
    ? ok(`maneuver ON with exploding off: Maneuver alone, no Explode the Die`)
    : fail(`mvNoExplode: ${JSON.stringify(r.mvNoExplode)} — want the maneuver button only`);

  // ---- pressing Explode the Die ------------------------------------------
  r.dsnActive
    ? ok(`Dice So Nice is active, so the animation leg below is a real measurement`)
    : fail(`game.dice3d is absent — this leg FAILS rather than skipping, because a timing it cannot observe is not a timing it has checked`);
  (r.explodeAfter?.total ?? 0) > (r.explodeBefore?.total ?? 0)
    ? ok(`Explode the Die rewrote the stored total, ${r.explodeBefore.total} -> ${r.explodeAfter.total} — without _evaluateTotal() the Apply path would still spend the old number, since Roll.fromData trusts the stored one`)
    : fail(`total went ${r.explodeBefore?.total} -> ${r.explodeAfter?.total}; it must grow`);
  hasX(r.explodeAfter?.formula)
    ? ok(`...and the card's formula follows the terms (${r.explodeAfter.formula}) via resetFormula()`)
    : fail(`formula after exploding was ${r.explodeAfter?.formula}, expected it to carry x`);
  r.explodeLines?.length >= 1 && r.explodeAfter?.exploded >= 1
    ? ok(`...and Part 2's lines appear for free from results[].exploded (${r.explodeLines.length} line(s)) — the two features compose with no extra code`)
    : fail(`after exploding: ${r.explodeAfter?.exploded} exploded result(s), ${r.explodeLines?.length} line(s)`);
  r.explodeSealed?.explode && r.explodeSealed?.maneuver
    ? ok(`...and both buttons stay sealed across a re-render, the choice being spent on the MESSAGE`)
    : fail(`seal after exploding: ${JSON.stringify(r.explodeSealed)}`);
  r.dsnCalls?.length === 1 && r.dsnCalls[0].synchronize === true
    ? ok(`THE DICE ANIMATE: showForRoll called exactly once with synchronize=true (${r.dsnCalls[0].formula}) — an in-place rolls rewrite makes DSN's own dsnCountAddedRoll zero, so without this call nothing would tumble`)
    : fail(`showForRoll calls: ${JSON.stringify(r.dsnCalls)} — want exactly one with synchronize=true. Zero means the silent-dice defect; synchronize=false means the dice land on the roller's client alone`);
  r.dsnCalls?.length === 1 && r.dsnCalls[0].messageID
    ? ok(`...linked to the card (messageID passed), so DSN can associate the animation with it`)
    : fail(`showForRoll got messageID ${r.dsnCalls?.[0]?.messageID}`);
  r.dsnShadowLifted !== false
    ? ok(`...and the showForRoll shadow was lifted, leaving the live client as it was`)
    : fail(`the showForRoll shadow is STILL installed — a probe that leaves a shadow behind poisons every later run`);

  // ---- pressing Maneuver -------------------------------------------------
  r.maneuverTaken?.choice === "maneuver" && r.maneuverTaken.total === r.maneuverTaken.wasTotal
    ? ok(`Maneuver records the choice and leaves the total alone (${r.maneuverTaken.total})`)
    : fail(`maneuver: ${JSON.stringify(r.maneuverTaken)}`);
  r.maneuverTaken?.forgoneLine && r.maneuverTaken?.applySpent
    ? ok(`...the card says the damage was forgone and the Apply control is greyed — with the refusal in onClickChatMessageApplyButton behind it`)
    : fail(`forgone line ${r.maneuverTaken?.forgoneLine}, apply spent ${r.maneuverTaken?.applySpent}`);
  r.maneuverTaken?.sealed && r.maneuverStillManeuver === "maneuver"
    ? ok(`...and the pair is EXCLUSIVE: pressing Explode the Die afterwards changes nothing`)
    : fail(`sealed ${r.maneuverTaken?.sealed}, choice after a second click ${r.maneuverStillManeuver} — want it still "maneuver"`);

  // Cleanup: the actors and the three cards this probe minted.
  await page.evaluate(async ({ ids, msgs }) => {
    for (const id of ids ?? []) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
    for (const id of msgs ?? []) { try { await game.messages.get(id)?.delete(); } catch { /* gone */ } }
  }, { ids: r.made, msgs: [...(r.madeMsgs ?? []), ...(r.made2 ?? [])] });
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nCRAWLER COMBAT PROBE FAILED\n" : "\ncrawler combat probe passed\n");
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * The optional combat rules (2026-10-02, user ask) — `npm run dev:combat-options`.
 *
 * Three settings under Configure Hacks beside GLOG Magic and the Vald calendar,
 * each OFF by default and never greyed, and ALL of them PLAYER CHARACTERS ONLY
 * (`type === "character"`, the auto-record-scars gate):
 *
 *   - Exploding damage dice;
 *   - Fatigue instead of Critical Damage;
 *   - Maneuver on max damage.
 *
 * For a day they sat under a "Crawler Combat Mode" master (this probe was
 * `dev:crawler-combat`), which greyed them while off and carried rules of its
 * own — Deprived when overburdened, 6 HP at generation, a rolled Rest. All of
 * that was reversed on 2026-10-03 and the master removed (user ruling); leg 10
 * now holds that the three rows are NEVER greyed, and legs 5/6 that an
 * overburdened PC is not Deprived.
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
 * Deprived is NEVER DERIVED (2026-10-03): the master's one-day rule derived it
 * from the load, and the user reversed it. Leg 5 asserts an overburdened PC is
 * at 0 Hit Protection and NOT deprived, with the checkbox live and the plain
 * Overburdened banner.
 *
 * THE PICKER OPENS ONLY FOR A CHARACTER ALREADY OVERBURDENED (the night of
 * 2026-10-03, the third ruling on it in two days). `overburdened` builds that
 * fixture at ten slots; the `edge` leg holds that 9 of 10 takes the Fatigue with
 * no picker and lands overburdened, and `firstFull` that 10 of 10 with no
 * Fatigue is asked (every Fatigue fills a slot, the free first one withdrawn).
 *
 * Dice are pinned through `CONFIG.Dice.randomUniform`, which is INVERTED, and
 * through a SEQUENCE where a chain must terminate: a flat pin at the maximum
 * explodes for ever and core throws at depth 1000.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, dismissChrome, watchErrors, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);
const KEYS_ALL = ["exploding-damage-dice", "fatigue-for-critical-damage", "maneuver-on-max-damage"];

try {
  await joinAsGM(page);

  const r = await withSettings(page, () => page.evaluate(async () => {
    const NS = "air-bladder";
    const KEYS = ["exploding-damage-dice", "fatigue-for-critical-damage", "maneuver-on-max-damage"];
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
    out.masterGone = !game.settings.settings.has(`${NS}.crawler-combat-mode`);
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
      // THE SUB-d6 ROWS, kept though the floor is gone. Added 2026-10-02 for a
      // d6 floor, which the user REVERSED on 2026-10-03 ("including impaired
      // attacks ... and attacks with dice smaller than a d6"); they now assert
      // the reversal. A table without them is how the first ruling shipped
      // unexamined: it had no d4 row at all, and the impaired `1d4` is the case
      // that fires on every weapon in the game.
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
    // THE PILE LEGS BELOW ASSERT A PILE MADE ON DEMAND, IN THE PARTY FOLDER, so
    // they need a world with no pile in it — a precondition that must not be
    // satisfiable by stale state, and one a leftover from an interrupted run
    // quietly breaks (a pile at the root of the directory reds "in Party
    // folder=false" with nothing saying why). Recorded rather than swept: a
    // Warden's own pile is legitimate and is not this probe's to delete.
    // IDS, not just a count (2026-10-03): the cleanup deletes every pile this
    // run did not find here. It used to delete `pileId` alone, and the
    // split-world leg below plants a SECOND pile whose random id wins the
    // canonical election about half the time — the original is then merged
    // into it and deleted by the repair, the cleanup deletes the original's id
    // (already gone), and the planted "ZZ Second Floor" survives as an empty
    // pile at the root, which reds the next run's three note legs and the
    // "in Party folder" leg. Fails once, passes next: a coin flip, not a race.
    const pileIdsAtStart = (game.actors?.filter((a) => a.getFlag(NS, "droppedItemPile")) ?? []).map((a) => a.id);
    out.pileIdsAtStart = pileIdsAtStart;
    out.pilesAtStart = pileIdsAtStart.length;
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

    await game.settings.set(NS, "exploding-damage-dice", true);
    // MANEUVER OFF, STATED: these legs are about exploding alone. (For a day a
    // maneuver on offer made a melee roll PLAIN, so an inherited "on" redded
    // these legs for a reason they were not testing; a precondition is
    // asserted, never inherited from whatever the last run left behind.)
    await game.settings.set(NS, "maneuver-on-max-damage", false);
    out.pcRoll = await rollDamageVia(pc);
    out.monsterRoll = await rollDamageVia(monster);

    await game.settings.set(NS, "exploding-damage-dice", false);
    out.optionOffRoll = await rollDamageVia(pc);
    await game.settings.set(NS, "exploding-damage-dice", true);

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

    // The checkbox is LIVE and unticked: nothing locks it now (the one-day
    // derived rule disabled it while the load held).
    await pc.sheet.render(true);
    await sleep(500);
    const box = pc.sheet.element?.querySelector(".deprived-check");
    out.boxDisabled = box ? box.disabled === true : null;
    out.boxChecked = box ? box.checked === true : null;
    // Rest and Restore read system.deprived, which nothing derives any more,
    // so an overburdened PC may still press them (HP 0 is core's business).
    out.restDisabled = pc.sheet.element?.querySelector("#rest-button")?.disabled === true;
    out.restoreDisabled = pc.sheet.element?.querySelector("#restore-abilities-button")?.disabled === true;
    // The Overburdened banner wears ONE wording for every table; the Crawler
    // variant ("…and you are Deprived…") went with the rule it described.
    out.bannerText = [...(pc.sheet.element?.querySelectorAll("[class*=banner]") ?? [])]
      .map((b) => b.textContent.trim()).find((t) => /capacity/i.test(t)) ?? null;
    out.bannerExpected = game.i18n.localize("CAIRN.OverburdenedBanner");
    out.bannerCrawlerKeyGone = !game.i18n.has("CAIRN.Crawler.OverburdenedBanner", false);
    await pc.sheet.close();

    // A full re-initialize changes nothing either: `reset()`, not a bare
    // `prepareData()` — the latter does NOT rebuild `system` from `_source`, so
    // a derived value set by an earlier prepare would still be sitting there
    // and the leg would be measuring staleness rather than the rule.
    pc.reset();
    out.pcReset = state(pc);

    // Freeing a slot clears it, and SOURCE was never written at any point.
    // TWO items: `encumbered` is `slotsUsed >= slotsMax`, so going 11 -> 10 is
    // still overburdened. That is the rule, not an off-by-one.
    const spares = pc.items.filter((i) => i.name.startsWith("ZZ Load")).slice(0, 2);
    await pc.deleteEmbeddedDocuments("Item", spares.map((i) => i.id));
    out.pcFreed = state(pc);

    /* ---- 8/9. the Fatigue button ---------------------------------------- */
    await game.settings.set(NS, "fatigue-for-critical-damage", true);
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
    // THE TWO DAMAGE-CARD LINES GLOW (user ask, 2026-10-04): the explosion
    // line in Mark Critical Damage's red, the maneuver line in the Fatigue
    // teal. Read HERE, inside this one scheme switch, off a fixture card that
    // carries both, because a SECOND configureUI round trip late in the run --
    // after Dice So Nice had been rendering for minutes -- was followed both
    // times it was tried (2026-10-04) by the headless GPU process dying three
    // minutes later and taking the page with it, with nothing else changed. The fixture is the template's own markup with the
    // maneuver datum and a pinned max-then-low `1d6x`.
    let lineCard = null;
    {
      const origRU = CONFIG.Dice.randomUniform;
      const seq = [0.0001, 0.5];
      let k = 0;
      CONFIG.Dice.randomUniform = () => seq[Math.min(k++, seq.length - 1)];
      try {
        const roll = await new Roll("1d6x").evaluate();
        lineCard = await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: pc }),
          flavor: await foundry.applications.handlebars.renderTemplate(
            "systems/air-bladder/templates/chat/dmg-roll-card.html",
            { label: "ZZ glow fixture", weapon: "ZZ Blade", panic: false, maneuver: true }),
        });
        out.made2.push(lineCard.id);
      } finally {
        CONFIG.Dice.randomUniform = origRU;
      }
      await sleep(400);
    }
    const glowIn = (el) => (el
      ? (getComputedStyle(el).textShadow.match(/rgba?\([^)]*\)/) ?? ["none"])[0] : null);
    const readLines = () => {
      const card = lineCard && rowOf(lineCard);
      return {
        exploded: glowIn(card?.querySelector(".dmg-exploded")),
        maneuver: glowIn(card?.querySelector(".dmg-maneuver-line")),
      };
    };
    await setScheme("light");
    out.btnLight = readBtns();
    out.linesLight = readLines();
    // ...and again under a DARK interface, through core's own configureUI (the
    // Applications theme lands on <body>, the INTERFACE theme on #interface, so
    // a body-only flip never reaches chat). The pinned token must not move.
    try {
      await setScheme("dark");
      out.btnDark = readBtns();
      out.linesDark = readLines();
    } finally {
      // Nothing was WRITTEN: configureUI takes the config as an argument, so the
      // world's own stored setting was never touched.
      game.configureUI(game.settings.get("core", "uiConfig"));
      await sleep(400);
    }

    // ALREADY OVERBURDENED: the picker opens only for a character with no
    // free slot (the night of 2026-10-03), and this one sits at 9 of 10 (the
    // blade and eight loads), so a tenth load is planted to keep this leg's
    // drop, pile and card assertions on the picker path. The no-picker paths
    // have their own legs below (10b).
    await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Load Tenth", type: "item" }]);
    await sleep(300);
    const fatigueBefore = pc.items.filter((i) => i.name === "Fatigue").length;
    const usedBefore = pc.system.slotsUsed;
    const itemsBefore = pc.items.size;
    rowOf(m1).querySelector(".take-fatigue-instead").click();
    // SOMETHING GOES ON THE FLOOR FIRST when already overburdened (2026-10-02,
    // narrowed twice on 2026-10-03). The button opens a picker before it creates
    // anything, so the Fatigue never lands until this is answered — which is
    // exactly what three legs below went red on when the picker arrived and
    // nothing here knew about it.
    {
      let dlg = null;
      for (let i = 0; i < 60 && !dlg; i++) {
        dlg = document.querySelector("dialog.dialog.cairn-drop-dialog");
        if (!dlg) await sleep(150);
      }
      out.dropAsked = !!dlg;
      // WHICH item is the player's choice, so the probe makes one: the first
      // radio, whatever it is, and the name is carried so a failure names the
      // thing that moved.
      const picked = dlg?.querySelector('input[name="dropped"]:checked');
      out.dropPickedId = picked?.value ?? null;
      out.dropPickedName = pc.items.get(picked?.value ?? "")?.name ?? null;
      dlg?.querySelector('button[data-action="drop"]')?.click();
    }
    for (let i = 0; i < 40 && pc.items.filter((x) => x.name === "Fatigue").length === fatigueBefore; i++) await sleep(150);
    await sleep(600);
    out.fatigueAdded = pc.items.filter((i) => i.name === "Fatigue").length - fatigueBefore;
    // THE DROP LANDED IN THE PILE and left the character. One in, one out, so
    // the item count is unchanged — which is a tighter test than either half
    // alone, and it is what distinguishes a real move from a delete.
    out.itemsNetZero = pc.items.size === itemsBefore;
    out.droppedGone = !pc.items.get(out.dropPickedId ?? "");
    {
      const pile = game.actors.find((a) => a.getFlag("air-bladder", "droppedItemPile"));
      out.pileMade = !!pile;
      out.pileHasIt = !!pile?.items?.find((i) => i.name === out.dropPickedName);
      out.pileInParty = pile?.folder?.getFlag("air-bladder", "partyFolder") === true;
      // UNLIMITED, and read off the derived value rather than from the source
      // `slots` the pile is created with (0): Infinity is what every capacity
      // path actually consults.
      out.pileUnlimited = pile?.system?.slotsMax === Infinity && pile?.isEncumbered() === false;
      out.pileOwnership = pile?.ownership?.default ?? null;
      // The chat record of the Fatigue drop, rebuilt per viewer from a flag.
      const card = game.messages.contents.slice().reverse()
        .find((m) => m.getFlag("air-bladder", "pileDrop"));
      out.dropCard = card
        ? { item: card.getFlag("air-bladder", "pileDrop")?.item ?? null,
          text: String(card.content ?? "").replace(/<[^>]*>/g, " ").trim() }
        : null;
      out.pileId = pile?.id ?? null;
    }

    /* ---- the "where did you drop it" note ------------------------------- */
    // A 25-character note taken at drop time and shown on the PILE's rows, so a
    // Warden going down the list can tell the rope left at the bridge from the
    // rope left in the crypt.
    //
    // THE TAGS ARE COUNTED AS RENDERED, never read off the flag. The partial
    // gates them on `../withDropNote`, and a missing `../` fails SILENTLY with
    // exactly the signature this file has already paid for twice: flag set, zero
    // elements. Reading the flag would pass in that case.
    {
      const noteActor = await mk({ name: "ZZ Note PC", type: "character" });
      await noteActor.createEmbeddedDocuments("Item", [
        { name: "ZZ Note Rope", type: "item" },
        { name: "ZZ Note Sack", type: "item" },
        // Never dropped: it carries the flag directly, so the CHARACTER-sheet leg
        // below has something a tag could render from if the gate were wrong.
        { name: "ZZ Note Kept", type: "item",
          flags: { [NS]: { droppedAt: "on their own sheet" } } },
      ]);
      // BY NAME, never by position (2026-10-03). This destructured the create's
      // return as `[here, nowhere, kept]`, and the order the documents come back
      // in is not the order they went in — so on the runs where "ZZ Note Kept"
      // came back second, the BLANK drop moved the planted item instead: the
      // pile then showed "ZZ Note Kept" wearing "on their own sheet" (its own
      // planted flag travelling with it), the sack stayed on the character, and
      // three legs went red. Green on the runs where the order happened to
      // match, which is how it read as a race for a morning.
      const here = noteActor.items.getName("ZZ Note Rope");
      const nowhere = noteActor.items.getName("ZZ Note Sack");
      const kept = noteActor.items.getName("ZZ Note Kept");
      const { dropItemToPile } = await import("/systems/air-bladder/module/party-pile.js");
      // AWAITED TO COMPLETION, each of them. A drop is several writes — the pile
      // may have to be made, the item created, then deleted — and a fixed sleep
      // read the state halfway through: "the blank one is not in the pile" looks
      // exactly like "the blank one got no tag", which is the leg below.
      for (const [item, place] of [[here, "under the bridge"], [nowhere, ""]]) {
        await dropItemToPile(noteActor, item.id, place ? { place } : {});
        for (let i = 0; i < 40 && noteActor.items.get(item.id); i++) await sleep(150);
      }
      await sleep(400);
      const pile = game.actors.find((a) => a.getFlag(NS, "droppedItemPile"));
      out.noteDerived = {
        here: pile?.items.find((i) => i.name === "ZZ Note Rope")?.system?.droppedAt ?? null,
        blank: pile?.items.find((i) => i.name === "ZZ Note Sack")?.system?.droppedAt ?? null,
      };
      // The PILE's own sheet: the tag is rendered, and only on the row that has one.
      // POLLS FOR THE ROWS IT IS GOING TO READ. Rendering the sheet and clicking
      // the Items tab are not the same thing as the rows being in the DOM, and a
      // fixed wait made a missing row indistinguishable from an absent tag — which
      // is the exact failure this leg is supposed to detect.
      const readTags = async (actor, expect) => {
        await actor.sheet.render(true);
        for (let i = 0; i < 30 && !(actor.sheet.element instanceof HTMLElement); i++) await sleep(100);
        actor.sheet.element?.querySelector('[data-action="tab"][data-tab="items"]')?.click();
        const rows = () => actor.sheet.element?.querySelectorAll("[data-item-id]")?.length ?? 0;
        for (let i = 0; i < 40 && rows() < expect; i++) await sleep(150);
        await sleep(250);
        const out2 = { rowCount: rows(), expected: expect };
        for (const row of actor.sheet.element.querySelectorAll("[data-item-id]")) {
          const name = actor.items.get(row.dataset.itemId)?.name;
          if (!name) continue;
          const tag = row.querySelector(".cairn-drop-tag");
          out2[name] = tag ? tag.textContent.trim() : null;
        }
        await actor.sheet.close();
        return out2;
      };
      // The pile holds at least the two just dropped; the character keeps the one
      // that was never dropped.
      out.pileTags = pile ? await readTags(pile, 2) : null;
      out.charTags = await readTags(noteActor, 1);
      out.noteKeptFlag = kept.system?.droppedAt ?? null;
    }
    out.critAfterFatigue = pc._source.system.critical === true;
    out.afterFatigue = state(pc);
    out.usedGrew = pc.system.slotsUsed > usedBefore;
    out.spentFlag = m1.getFlag("air-bladder", "crawlerChoiceTaken") === "fatigue";
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
    out.critSpends = m2.getFlag("air-bladder", "crawlerChoiceTaken") === "critical";
    out.critSealedFatigue = rowOf(m2)?.querySelector(".take-fatigue-instead")?.disabled === true;

    // The option off: no button on a new card.
    await game.settings.set(NS, "fatigue-for-critical-damage", false);
    const m3 = await postSave(monster, false);
    out.noBtnWhenOff = !rowOf(m3)?.querySelector(".take-fatigue-instead");
    out.madeMsgs = [m1.id, m2.id, m3.id];

    /* ---- 10b. THE BARGAIN: refuse, Escape, and what the picker offers ---- */
    // The Fatigue is BOUGHT with an item now, and declining to pay costs the save
    // (user ruling, reversing "cancel backs out of the whole thing"). Each case
    // gets its own character and its own card, because every one of them ends with
    // a spent choice and a changed inventory.
    await game.settings.set(NS, "fatigue-for-critical-damage", true);
    const bargain = {};
    const pcWith = async (name, items) => {
      const a = await mk({ name, type: "character" });
      if (items.length) await a.createEmbeddedDocuments("Item", items);
      await sleep(250);
      return a;
    };
    const ORD = { name: "ZZ Plain", type: "item" };
    const PETTY = { name: "ZZ Trinket", type: "item", system: { weightless: true } };
    const BULKY = { name: "ZZ Ladder", type: "item", system: { bulky: true } };
    const TORCH = { name: "ZZ Torch", type: "item", system: { uses: { value: 2, max: 3 } } };
    // ALREADY OVERBURDENED (the night of 2026-10-03, user ruling): the picker
    // opens ONLY for a character with no free slot, so every fixture that
    // expects it is padded to TEN slots, one of them a Fatigue already carried.
    // Every Fatigue fills a slot, so `slotsOf` counts it like any item: `items`
    // + the padding + the helper's own Fatigue is exactly ten.
    const slotsOf = (items) => items.reduce((n, it) =>
      n + (it.system?.weightless ? 0 : it.system?.bulky ? 2 : 1), 0);
    const overburdened = async (name, items) => {
      const pad = Array.from({ length: Math.max(0, 9 - slotsOf(items)) }, (_, i) => ({ name: `ZZ Pad ${i}`, type: "item" }));
      return pcWith(name, [...items, ...pad, { name: "Fatigue", type: "item" }]);
    };
    // The rows a picker should list for an actor: everything that frees a slot.
    const offerable = (a) => a.items.filter((i) => !i.system?.weightless && !i.system?.isFatigue).length;
    // Press the button and wait for EITHER a picker or the choice landing, so a
    // leg that expects no picker neither hangs nor mistakes "slow" for "none".
    const pressFatigue = async (actor) => {
      const m = await postSave(actor, true);
      out.made2.push(m.id);
      rowOf(m)?.querySelector(".take-fatigue-instead")?.click();
      let dlg = null;
      for (let i = 0; i < 40 && !dlg && !m.getFlag(NS, "crawlerChoiceTaken"); i++) {
        dlg = document.querySelector("dialog.dialog.cairn-drop-dialog");
        if (!dlg) await sleep(100);
      }
      // A picker that should not have opened is closed, so a red cannot hang.
      if (dlg) foundry.applications.instances.get(dlg.id)?.close();
      await sleep(800);
      return { m, asked: !!dlg };
    };
    // Open the picker from a real card and hand back the dialog.
    const openPicker = async (actor) => {
      const m = await postSave(actor, true);
      out.made2.push(m.id);
      rowOf(m)?.querySelector(".take-fatigue-instead")?.click();
      let dlg = null;
      for (let i = 0; i < 60 && !dlg; i++) {
        dlg = document.querySelector("dialog.dialog.cairn-drop-dialog");
        if (!dlg) await sleep(150);
      }
      return { m, dlg };
    };
    const rowsOf = (dlg) => [...(dlg?.querySelectorAll(".cairn-drop-list label") ?? [])]
      .map((l) => l.textContent.trim());

    // THE PAIR SIDE BY SIDE. It had no CSS at all, so two block-level buttons
    // stacked — and a column reads as a list of things to do in order.
    {
      const a = await pcWith("ZZ Barg Row", [ORD]);
      const m = await postSave(a, true);
      out.made2.push(m.id);
      const wrap = rowOf(m)?.querySelector(".dmg-choice-row");
      const f = rowOf(m)?.querySelector(".take-fatigue-instead");
      const c = rowOf(m)?.querySelector(".mark-critical-damage");
      bargain.row = wrap && f && c
        ? { display: getComputedStyle(wrap).display,
          sameTop: Math.abs(f.getBoundingClientRect().top - c.getBoundingClientRect().top) < 2,
          differentLeft: Math.abs(f.getBoundingClientRect().left - c.getBoundingClientRect().left) > 2 }
        : null;
    }

    // REFUSED by the named button: the Critical Damage is APPLIED, no Fatigue is
    // created, the pair is sealed and the tick is on the control nobody pressed.
    {
      const a = await overburdened("ZZ Barg Refuse", [ORD]);
      // The fixture carries one Fatigue (the edge); what must not change is
      // the COUNT, so the leg reads a delta rather than expecting zero.
      const fRefuseBefore = a.items.filter((i) => i.system?.isFatigue).length;
      const { m, dlg } = await openPicker(a);
      bargain.refuseAsked = !!dlg;
      bargain.refuseBtnLabel = dlg?.querySelector('button[data-action="critical"]')?.textContent.trim() ?? null;
      dlg?.querySelector('button[data-action="critical"]')?.click();
      await sleep(1200);
      bargain.refuse = {
        critical: a._source.system.critical === true,
        fatigueDelta: a.items.filter((i) => i.system?.isFatigue).length - fRefuseBefore,
        stillHasItem: !!a.items.find((i) => i.name === "ZZ Plain"),
        flag: m.getFlag(NS, "crawlerChoiceTaken") ?? null,
        sealedBoth: rowOf(m)?.querySelector(".take-fatigue-instead")?.disabled === true
          && rowOf(m)?.querySelector(".mark-critical-damage")?.disabled === true,
        tickOnCrit: !!rowOf(m)?.querySelector(".mark-critical-damage .fa-check"),
        tickOnFatigue: !!rowOf(m)?.querySelector(".take-fatigue-instead .fa-check"),
      };
    }

    // ESCAPE IS NOT A REFUSAL — the guard. Only the named button refuses; a
    // dialog dismissed by accident must leave the card exactly as it was.
    {
      const a = await overburdened("ZZ Barg Escape", [ORD]);
      const fEscapeBefore = a.items.filter((i) => i.system?.isFatigue).length;
      const { m, dlg } = await openPicker(a);
      bargain.escapeAsked = !!dlg;
      // The window's own close, which is what Escape reaches.
      foundry.applications.instances.get(dlg?.id)?.close();
      await sleep(1200);
      bargain.escape = {
        critical: a._source.system.critical === true,
        fatigueDelta: a.items.filter((i) => i.system?.isFatigue).length - fEscapeBefore,
        flag: m.getFlag(NS, "crawlerChoiceTaken") ?? null,
        liveBoth: rowOf(m)?.querySelector(".take-fatigue-instead")?.disabled === false
          && rowOf(m)?.querySelector(".mark-critical-damage")?.disabled === false,
      };
    }

    // TAKING IT: the tick goes on the Fatigue button, and the whole bargain
    // NETS TO ZERO — one thing down, one Fatigue on.
    {
      // OVERBURDENED with two Fatigues already carried, and dropping one thing
      // pays for the third exactly. WHICH row goes is
      // the picker's first radio, whatever the sort put there, and the leg
      // asserts THAT item is gone rather than naming one.
      const a = await overburdened("ZZ Barg Take", [ORD, { name: "Fatigue", type: "item" }]);
      const usedBefore2 = a.system.slotsUsed;
      const { m, dlg } = await openPicker(a);
      const picked = dlg?.querySelector('input[name="dropped"]:checked')?.value ?? null;
      dlg?.querySelector('button[data-action="drop"]')?.click();
      // POLLED, not slept: the bargain is a drop (which may create the pile and
      // post a card) followed by the Fatigue and the flag, and a fixed wait read
      // the state halfway through — "dropped, no Fatigue yet" looks exactly like
      // a broken feature.
      for (let i = 0; i < 60 && !m.getFlag(NS, "crawlerChoiceTaken"); i++) await sleep(200);
      await sleep(500);
      bargain.take = {
        critical: a._source.system.critical === true,
        fatigues: a.items.filter((i) => i.system?.isFatigue).length,
        gone: !!picked && !a.items.get(picked),
        usedBefore: usedBefore2, usedAfter: a.system.slotsUsed,
        flag: m.getFlag(NS, "crawlerChoiceTaken") ?? null,
        tickOnFatigue: !!rowOf(m)?.querySelector(".take-fatigue-instead .fa-check"),
        tickOnCrit: !!rowOf(m)?.querySelector(".mark-critical-damage .fa-check"),
      };
    }

    // ROOM: the Fatigue FITS, so there is NO picker and nothing is dropped
    // (user ruling 2026-10-03: at 8 of 10 they were asked to drop something
    // for a Fatigue that fit — "that isn't right"). This is the OLD Take
    // fixture, one plain item and one Fatigue, and the red-first witness: the
    // day-old "always ask" build opens the picker here.
    {
      const a = await pcWith("ZZ Barg Room", [ORD, { name: "Fatigue", type: "item" }]);
      const usedBefore3 = a.system.slotsUsed;
      const itemsBefore3 = a.items.size;
      const { m, asked } = await pressFatigue(a);
      bargain.room = {
        asked,
        critical: a._source.system.critical === true,
        fatigues: a.items.filter((i) => i.system?.isFatigue).length,
        itemsDelta: a.items.size - itemsBefore3,
        stillHasItem: !!a.items.find((i) => i.name === "ZZ Plain"),
        usedBefore: usedBefore3, usedAfter: a.system.slotsUsed,
        flag: m.getFlag(NS, "crawlerChoiceTaken") ?? null,
        tickOnFatigue: !!rowOf(m)?.querySelector(".take-fatigue-instead .fa-check"),
        tickOnCrit: !!rowOf(m)?.querySelector(".mark-critical-damage .fa-check"),
      };
    }
    // A FIRST FATIGUE AT A FULL PACK ASKS (2026-10-03, the free first Fatigue
    // withdrawn): 10 of 10 is overburdened, Fatigue carried or not, so the
    // picker opens. pressFatigue closes
    // it unanswered, so nothing lands. The red-first witness against the
    // free-first build, where this character was never asked.
    {
      const brim = Array.from({ length: 10 }, (_, i) => ({ name: `ZZ Brim ${i}`, type: "item" }));
      const a = await pcWith("ZZ Barg FirstFull", brim);
      const encumberedBefore = a.isEncumbered();
      const usedBefore4 = a.system.slotsUsed;
      const { m, asked } = await pressFatigue(a);
      bargain.firstFull = {
        asked, encumberedBefore,
        fatigues: a.items.filter((i) => i.system?.isFatigue).length,
        usedBefore: usedBefore4, usedAfter: a.system.slotsUsed,
        flag: m.getFlag(NS, "crawlerChoiceTaken") ?? null,
        critical: a._source.system.critical === true,
      };
    }

    // AT 9 OF 10 THERE IS NO PICKER (the night of 2026-10-03, user: "only
    // prompts a character to drop something and requires them to do so if the
    // player is already overburdened"). One free slot is not overburdened, so
    // the Fatigue lands, nothing is dropped, and they end at 10 of 10 —
    // overburdened, which the ruling accepts. The red-first witness against the
    // "would not fit" build, which asked here.
    {
      const nine = Array.from({ length: 9 }, (_, i) => ({ name: `ZZ Nine ${i}`, type: "item" }));
      const a = await pcWith("ZZ Barg Edge", nine);
      const encumberedBefore = a.isEncumbered();
      const usedBefore5 = a.system.slotsUsed;
      const itemsBefore5 = a.items.size;
      const { m, asked } = await pressFatigue(a);
      bargain.edge = {
        asked, encumberedBefore,
        usedBefore: usedBefore5, usedAfter: a.system.slotsUsed,
        encumberedAfter: a.isEncumbered(),
        itemsDelta: a.items.size - itemsBefore5,
        fatigues: a.items.filter((i) => i.system?.isFatigue).length,
        flag: m.getFlag(NS, "crawlerChoiceTaken") ?? null,
        critical: a._source.system.critical === true,
      };
    }

    // A LEGACY CARD carries `true` and is left alone: sealed, quiet, NO check,
    // because a default would silently mislabel history on exactly the cards
    // nothing ever repairs.
    {
      const a = await pcWith("ZZ Barg Legacy", [ORD]);
      const m = await postSave(a, true);
      out.made2.push(m.id);
      await m.setFlag(NS, "crawlerChoiceTaken", true);
      await ui.chat.render(true);
      await sleep(700);
      bargain.legacy = {
        sealed: rowOf(m)?.querySelector(".take-fatigue-instead")?.disabled === true,
        anyTick: !!rowOf(m)?.querySelector(".dmg-choice-row .fa-check"),
      };
    }

    // WHAT THE PICKER OFFERS. Petty is never offered: a petty drop frees
    // nothing. (A second leg read the same exclusion on a character who was NOT
    // overburdened; since the night of 2026-10-03 the picker opens only for one
    // who is, so that case cannot arise and the leg went.)
    {
      // TEN fillers plus a Fatigue is eleven slots: overburdened, with room to
      // spare on the count. (Ten was first chosen while the first Fatigue was
      // free; every Fatigue fills a slot since 2026-10-03, and it still holds.)
      const filler = Array.from({ length: 10 }, (_, i) => ({ name: `ZZ Fill ${i}`, type: "item" }));
      const a = await pcWith("ZZ Barg Full", [...filler, PETTY, { name: "Fatigue", type: "item" }]);
      const { dlg } = await openPicker(a);
      bargain.fullRows = rowsOf(dlg);
      bargain.fullEncumbered = a.isEncumbered();
      bargain.fullNote = !!dlg?.querySelector(".cairn-drop-petty-note");
      foundry.applications.instances.get(dlg?.id)?.close();
      await sleep(600);
    }
    // A SECOND Fatigue costs a real slot, and is STILL not offered: the exclusion
    // is of Fatigue AS Fatigue, never via pettiness, which a pettiness-only
    // implementation fails here.
    {
      const a = await overburdened("ZZ Barg TwoFat",
        [ORD, { name: "Fatigue", type: "item" }, { name: "Fatigue", type: "item" }]);
      const { dlg } = await openPicker(a);
      bargain.twoFatRows = rowsOf(dlg);
      bargain.twoFatExpected = offerable(a);
      foundry.applications.instances.get(dlg?.id)?.close();
      await sleep(600);
    }
    // THE LABELS: a number and never the word "bulky", uses where there are any,
    // and no `x3` anywhere.
    {
      const a = await overburdened("ZZ Barg Labels", [BULKY, TORCH]);
      const { dlg } = await openPicker(a);
      bargain.labelRows = rowsOf(dlg);
      bargain.dialogText = dlg?.textContent ?? "";
      bargain.labelNote = !!dlg?.querySelector(".cairn-drop-petty-note");
      foundry.applications.instances.get(dlg?.id)?.close();
      await sleep(600);
    }
    out.bargain = bargain;

    /* ---- 11. Part 2: every explosion is announced on the card ------------ */
    // THE KEYSTONE FIRST, and read back off the STORED message rather than the
    // in-memory Roll: the whole feature rests on `exploded` surviving
    // serialization (DiceTerm.SERIALIZE_ATTRIBUTES includes "results"), and an
    // assertion against the object we just built would prove nothing about that.
    await game.settings.set(NS, "exploding-damage-dice", true);
    await game.settings.set(NS, "maneuver-on-max-damage", false);

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

    /* ---- 12. Part 3: maneuver on max damage ----------------------------- */
    // Fixtures the shipped content cannot supply: a melee d4 weapon (no shipped
    // melee weapon is sub-d6, so a probe using only shipped gear could not show
    // the smallest die earning the line the d10 does) and an explicitly ranged
    // one, which proves the `ranged` field no longer withholds anything.
    await pc.createEmbeddedDocuments("Item", [
      { name: "ZZ Ranged Bow", type: "weapon", system: { damageFormula: "d6", equipped: false, ranged: true } },
      { name: "ZZ Tiny Blade", type: "weapon", system: { damageFormula: "d4", equipped: false } },
      { name: "ZZ Big Blade", type: "weapon", system: { damageFormula: "d10", equipped: false } },
      // The one `+` shape the packs ship (a single d6+d6 weapon): the pool the
      // maneuver rule gained on 2026-10-03.
      { name: "ZZ Twin Blades", type: "weapon", system: { damageFormula: "d6 + d6", equipped: false } },
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
    const rollWeapon = async (actor, name, quality = "standard", pin = "max") => {
      await equipOnly(name);
      // THE PIN IS PER ROLL, and that is not a tidy-up. One pin around the whole
      // block shares its counter, so only the FIRST roll in it lands on the
      // maximum and every later leg rolls a 1 — which makes "no line" trivially
      // true for the option-off legs, and "a line" false for the d4 and
      // impaired legs, each for the wrong reason. Max first, low after: the
      // maximum is the precondition the line needs, and the low values
      // terminate the chain on the rows whose formula really does carry x (a
      // flat pin at the maximum throws at recursion depth 1000 rather than
      // capping). `pin: "low"` rolls a 1 throughout, for the leg that proves the
      // line waits for the maximum.
      const origRU = CONFIG.Dice.randomUniform;
      let ru = 0;
      CONFIG.Dice.randomUniform = () => (pin === "max" && ru++ === 0 ? MAXU : LOWU);
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
          (m) => !before.has(m.id) && m.speaker?.actor === actor.id && m.rolls?.length);
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
        line: row?.querySelector(".dmg-maneuver-line")?.textContent?.trim() ?? null,
        apply: !!row?.querySelector(".apply-dmg"),
        exploded: row?.querySelectorAll(".dmg-exploded").length ?? 0,
        // The withdrawn choice's controls, which must never come back.
        buttons: !!row?.querySelector(".dmg-maneuver-choice, .explode-the-die, .take-maneuver"),
      };
    };

    // NO CHOICE ON THE CARD (the night of 2026-10-03, user: "They get the
    // damage AND they are offered a maneuver"). With both options on, every
    // die explodes AT ROLL TIME and a maximum adds one line saying a maneuver
    // is also possible; Apply is always there. Melee and RANGED alike (user:
    // "Yes, ranged too; keep the field"). §13, which pressed the old Explode
    // the Die / Use a Maneuver! buttons, went with them.
    out.maneuverLineText = game.i18n.localize("CAIRN.Crawler.ManeuverAvailable");
    await game.settings.set(NS, "maneuver-on-max-damage", true);
    await game.settings.set(NS, "exploding-damage-dice", true);
    // No block-level pin: rollWeapon pins each roll itself — see its comment.
    {
      out.mvBoth = await rollWeapon(pc, "ZZ Big Blade");
      // RANGED gets the line too — the reversal of the day-old melee-only rule.
      out.mvRanged = await rollWeapon(pc, "ZZ Ranged Bow");
      // NO FLOOR: a d4 explodes and earns the line.
      out.mvD4 = await rollWeapon(pc, "ZZ Tiny Blade");
      // IMPAIRED on a d10 weapon: judged on the 1d4 it actually rolls.
      out.mvImpaired = await rollWeapon(pc, "ZZ Big Blade", "impaired");
      // A `+` pool explodes in its keep form `2d6kx`, one Die term.
      out.mvPlus = await rollWeapon(pc, "ZZ Twin Blades");
      out.mvEnhanced = await rollWeapon(pc, "ZZ Big Blade", "enhanced");
      // NOT AT ITS MAXIMUM: the card is marked, and there is NO line — the line
      // is about the die, not the option.
      out.mvLow = await rollWeapon(pc, "ZZ Big Blade", "standard", "low");
      // A MONSTER: no explosion, no mark, no line.
      await monster.createEmbeddedDocuments("Item",
        [{ name: "ZZ Big Blade", type: "weapon", system: { damageFormula: "d10", equipped: true } }]);
      out.mvMonster = await rollWeapon(monster, "ZZ Big Blade");

      // Maneuver OFF, exploding ON: explodes, no mark, no line.
      await game.settings.set(NS, "maneuver-on-max-damage", false);
      out.mvOptionOff = await rollWeapon(pc, "ZZ Big Blade");
      out.mvD4Off = await rollWeapon(pc, "ZZ Tiny Blade");
      await game.settings.set(NS, "maneuver-on-max-damage", true);

      // Maneuver ON, exploding OFF: a plain roll and the line; a `d6 + d6`
      // weapon is rolled as `2d6k` so the card can judge one Die term.
      await game.settings.set(NS, "exploding-damage-dice", false);
      out.mvNoExplode = await rollWeapon(pc, "ZZ Big Blade");
      out.mvPlusNoExplode = await rollWeapon(pc, "ZZ Twin Blades");
      await game.settings.set(NS, "exploding-damage-dice", true);
    }

    /* ---- 14. the Improvised Attack row ------------------------------------- */
    // Driven through the REAL inventory row and the REAL dialog, because the
    // whole point of this control is that it has no item behind it: a probe that
    // called the handler directly would not prove the row exists, is reachable,
    // or opens anything.
    const improvise = async (actor, { description = "", formula = null } = {}) => {
      // Per roll, max first then low -- the maximum is the precondition the
      // maneuver legs need, and the low values terminate any chain on the rows
      // whose formula really does carry x.
      const origRU = CONFIG.Dice.randomUniform;
      let ru = 0;
      CONFIG.Dice.randomUniform = () => (ru++ === 0 ? MAXU : LOWU);
      const before = new Set(game.messages.contents.map((m) => m.id));
      try {
        await actor.sheet.render(true);
        for (let i = 0; i < 30 && !(actor.sheet.element instanceof HTMLElement); i++) await sleep(100);
        await sleep(300);
        // THE ROW IS ON THE ITEMS TAB, so the tab is opened explicitly rather
        // than relied on. A person sheet's initial tab IS Items, which is
        // precisely why not clicking it would let this leg pass on a default
        // that a later ruling could change without anything here noticing.
        actor.sheet.element?.querySelector('[data-action="tab"][data-tab="items"]')?.click();
        await sleep(250);
        const ctrl = actor.sheet.element?.querySelector('[data-action="improvisedAttack"]');
        if (!ctrl) { await actor.sheet.close(); return { err: "no Improvised Attack control" }; }
        // The row itself, and that it is not an item: a trash can on this row
        // would mean somebody had made it a document.
        const improvisedRow = ctrl.closest(".improvised-row");
        const rowShape = {
          isRow: !!improvisedRow,
          tag: ctrl.tagName,
          deletable: !!improvisedRow?.querySelector('[data-action="itemDelete"]'),
          droppable: !!improvisedRow?.querySelector('[data-action="itemDrop"]'),
          glyphs: [...ctrl.querySelectorAll("i")].map((i) => i.className).join(" "),
        };
        // THE DIE MUST SIT ON THE LINE ITS NEIGHBOURS SIT ON. Measured on an
        // ORDINARY item row, where the helper-written `fa-solid` die stands
        // beside hand-written `fas` controls: the stylesheet rule was keyed to
        // `.fas` alone, so the die took the browser's line-height and rode high
        // in a box that already shared its neighbours' top edge. Read as computed
        // style AND as geometry, because the boxes matching was what ruled out
        // flex alignment and sent the search to the rule.
        const anyRow = [...(actor.sheet.element?.querySelectorAll(".cairn-item-controls") ?? [])]
          .find((c) => c.querySelector("a.roll-control i") && c.querySelector('[data-action="itemDelete"] i'));
        if (anyRow) {
          const die = anyRow.querySelector("a.roll-control i");
          const bin = anyRow.querySelector('[data-action="itemDelete"] i');
          const box = (el) => el.getBoundingClientRect();
          rowShape.align = {
            dieClass: die.className,
            binClass: bin.className,
            dieLine: getComputedStyle(die).lineHeight,
            binLine: getComputedStyle(bin).lineHeight,
            // TOP EDGES, not centres. Measured across all four states: the
            // glyph centres sit within 0px whether or not the rule applies, so
            // `midGap` cannot tell the states apart and asserting it would be a
            // leg that always passes. With `align-items: center` shipped on the
            // control, a short line-height moves the die's box down 6px, which
            // this does see.
            topGap: Math.abs(box(die).top - box(bin).top),
          };
          // ONE MARK PER CONTROL ON A ROW, asserted as the RULE. Nothing caught
          // Give and Drop rendering the same hand because nothing ever asked:
          // the two were byte-identical in the partial, one row apart. The family
          // prefix is dropped, since `fas` and `fa-solid` are the same font.
          // ONE MARK PER ANCHOR, not per glyph: a `d6 + d6` weapon's roll
          // control is ONE anchor carrying two d6 glyphs by design, and a
          // per-glyph read called that a collision the moment the last leg
          // above left that weapon equipped (2026-10-04).
          const marks = [...anyRow.querySelectorAll("a")]
            .map((a) => [...a.querySelectorAll(":scope > i")]
              .map((i) => [...i.classList].find((c) => c.startsWith("fa-") && c !== "fa-solid"))
              .filter(Boolean).join("+"))
            .filter(Boolean);
          rowShape.marks = marks;
          rowShape.uniqueMarks = new Set(marks).size;
          // A MISSPELLED FA CLASS RENDERS AN EMPTY BOX WITH NO ERROR, so the
          // glyph is read as rendered content and never from the class list —
          // this build is FA5-era, and the modern spelling of this very arrow
          // (`fa-arrow-down-to-line`) is absent from the shipped font.
          const dropI = anyRow.querySelector('[data-action="itemDrop"] i');
          rowShape.dropGlyph = dropI
            ? { cls: dropI.className,
              content: getComputedStyle(dropI, "::before").content }
            : null;
        }
        ctrl.click();

        let dlg = null;
        for (let i = 0; i < 80 && !dlg; i++) {
          dlg = document.querySelector("dialog.dialog.cairn-improvised-dialog");
          if (!dlg) await sleep(150);
        }
        if (!dlg) { await actor.sheet.close(); return { err: "no improvised dialog", rowShape }; }

        // WHAT THE DIALOG OFFERS IS HALF THE MEASUREMENT. Two fields and two
        // buttons: the dice builder and the three quality buttons were removed
        // by ruling, and their ABSENCE is asserted rather than assumed, because
        // a stale template would put them back in silence. The formula field is
        // present even when panicked -- panic overrides the value, it does not
        // take the field away.
        const fField = dlg.querySelector('input[name="formula"]');
        const shape = {
          hasDescription: !!dlg.querySelector('input[name="description"]'),
          hasFormula: !!fField,
          formulaStart: fField?.value ?? null,
          hasBuilder: !!dlg.querySelector(".wd-dice-builder"),
          hasQuality: !!dlg.querySelector('button[data-action="standard"]')
            || !!dlg.querySelector('button[data-action="enhanced"]'),
          hasRoll: !!dlg.querySelector('button[data-action="roll"]'),
          hasCancel: !!dlg.querySelector('button[data-action="cancel"]'),
          panicNote: dlg.querySelector(".cairn-improvised-panic")?.textContent.trim() ?? null,
        };

        const dField = dlg.querySelector('input[name="description"]');
        if (dField) { dField.value = description; dField.dispatchEvent(new Event("input", { bubbles: true })); }
        if (fField && formula !== null) {
          fField.value = formula;
          fField.dispatchEvent(new Event("input", { bubbles: true }));
          await sleep(150);
        }

        const go = dlg.querySelector('button[data-action="roll"]');
        if (!go) { await actor.sheet.close(); return { err: "no Roll Damage button", shape, rowShape }; }
        go.click();

        let msg = null;
        for (let i = 0; i < 90 && !msg; i++) {
          msg = game.messages.contents.slice().reverse().find(
            (m) => !before.has(m.id) && m.speaker?.actor === actor.id && m.rolls?.length);
          if (!msg) await sleep(200);
        }
        await actor.sheet.close();
        if (!msg) return { err: "no message", shape, rowShape };
        out.made2.push(msg.id);
        await sleep(400);
        const row = document.querySelector(`[data-message-id="${msg.id}"]`);
        return {
          shape,
          rowShape,
          // Apply is always on the card now; it was withheld while the old
          // maneuver choice was pending.
          applyBtn: !!row?.querySelector(".apply-dmg"),
          id: msg.id,
          // WHAT THE CLAIMED MESSAGE ACTUALLY IS, carried so a failure names it
          // instead of just reporting a null formula. It is what identified the
          // change-log ledger card in one run when this leg first went red.
          whatIsIt: { rolls: msg.rolls?.length ?? 0,
            flags: Object.keys(msg.flags?.["air-bladder"] ?? {}),
            content: String(msg.content ?? "").replace(/<[^>]*>/g, " ").trim().slice(0, 70) },
          formula: msg.rolls?.[0]?.formula ?? null,
          line: row?.querySelector(".dmg-label")?.textContent.trim() ?? null,
          // The card's own attributes, so a sentence failure names the datum it
          // was rebuilt from instead of only the text that came out.
          labelData: { ...(row?.querySelector(".dmg-label")?.dataset ?? {}) },
          datum: !!row?.querySelector("[data-maneuver]"),
          maneuverLine: !!row?.querySelector(".dmg-maneuver-line"),
          buttons: !!row?.querySelector(".dmg-maneuver-choice, .explode-the-die, .take-maneuver"),
        };
      } finally {
        CONFIG.Dice.randomUniform = origRU;
      }
    };

    await game.settings.set(NS, "exploding-damage-dice", true);
    await game.settings.set(NS, "maneuver-on-max-damage", true);

    // Both options on: the die explodes at roll time and the maximum earns the
    // line, as a weapon's does.
    out.impD6 = await improvise(pc, { description: "a chair leg", formula: "d6" });
    // A d4 the same (no floor since 2026-10-03), reached by a route that has no
    // item anywhere in it.
    out.impD4 = await improvise(pc, { description: "my fists", formula: "d4" });
    // The TYPED formula is what gets rolled, not the 1d4 the field starts on.
    out.impD10 = await improvise(pc, { description: "a rock", formula: "d10" });
    // Blank description: the card NAMES THE ATTACK ITSELF. Before this it
    // rendered an empty `.dmg-label` -- a damage roll with no sentence at all --
    // and this leg passed anyway, because it asserted only that the line did not
    // end in a dangling "with " and "" satisfies that. The expected sentences
    // are localized IN-PAGE so the leg survives a translation instead of pinning
    // an English literal.
    out.expect = {
      improvised: game.i18n.localize("CAIRN.RollingDmgImprovised"),
      improvisedPanic: game.i18n.localize("CAIRN.RollingDmgImprovisedPanic"),
    };
    out.impBlank = await improvise(pc, { description: "", formula: "d6" });

    // THE TARGETED SENTENCE, BOTH HALVES. This probe has no scene machinery of
    // its own, so a foe is placed and TARGETED the way `#onImprovisedAttack` reads
    // its targets -- not the canvas selection, which is a different signal. Both
    // halves are rolled because the contrast is the whole measurement: a blank
    // field must reach the improvised key and typed text must still reach the
    // weapon key, and one arm always winning would pass either leg alone.
    {
      const foe = await mk({
        name: "ZZ Improvised Foe", type: "npc",
        system: { role: "monster", hp: { value: 9, max: 9 }, armor: 0 },
      });
      const scene = await Scene.create({ name: "ZZ Improvised Scene", width: 1000, height: 1000 });
      out.sceneId = scene.id;
      const [tok] = await scene.createEmbeddedDocuments(
        "Token", [await foe.getTokenDocument({ x: 100, y: 100 })]);
      await scene.view();
      await sleep(600);
      tok.object?.setTarget(true, { releaseOthers: true });
      await sleep(200);
      out.tgtCount = game.user.targets.size;
      // Formatted in-page through the same helpers the rebuild uses, so the leg
      // reads a sentence rather than an English literal.
      const names = game.i18n.getListFormatter().format([tok.name]);
      out.expect.tgtImprovised = game.i18n.format("CAIRN.AttacksTargetImprovised",
        { attacker: pc.name, target: names, weapon: "" });
      out.expect.tgtWeapon = game.i18n.format("CAIRN.AttacksTargetWeapon",
        { attacker: pc.name, target: names, weapon: "a chair leg" });
      out.impTgtBlank = await improvise(pc, { description: "", formula: "d6" });
      out.impTgtTyped = await improvise(pc, { description: "a chair leg", formula: "d6" });
      game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
      await sleep(200);
    }

    // A MONSTER never explodes and earns no line, though the Warden may press
    // the row: rolled with BOTH options on, so the absences are the PC gate's.
    out.impMonster = await improvise(monster, { description: "a rock", formula: "d6" });
    await game.settings.set(NS, "maneuver-on-max-damage", false);
    // ...and with maneuver off a PC's d6 auto-explodes, as a weapon would.
    out.impAutoExplode = await improvise(pc, { description: "a chair leg", formula: "d6" });
    await game.settings.set(NS, "maneuver-on-max-damage", true);

    // PANICKED: the field is STILL THERE and still editable, a note says the
    // override is coming, and `d10` typed into it still rolls 1d4. The typed
    // value is deliberately a big die, so a leg that merely read "1d4" could not
    // pass by the field having been removed and defaulted.
    // RESTORED TO WHAT IT WAS, never hardcoded back to false. `use-panic`
    // DEFAULTS TO TRUE, so setting false here left the dev world one reload away
    // from a character sheet with no Panicked checkbox at all -- and
    // `dev:ui-parity`, which assumes the world sits at defaults, duly went red on
    // `.panicked-check` missing. `withSettings` repairs this at the end of a
    // COMPLETE run; a run that is interrupted leaves the world broken for the
    // next probe, which is a bill the next person pays.
    const panicWas = game.settings.get(NS, "use-panic");
    await game.settings.set(NS, "use-panic", true);
    await pc.update({ "system.panicked": true });
    out.impPanicked = await improvise(pc, { description: "my fists", formula: "d10" });
    await pc.update({ "system.panicked": false });
    await game.settings.set(NS, "use-panic", panicWas);

    // THE OWNERSHIP GATE, both halves. The probe runs as the Warden, who owns
    // every actor, so `isOwner` is shadowed on the instance in-page -- a read,
    // never a world write, and the only way to stand where a non-owning player
    // stands without a second client.
    {
      Object.defineProperty(pc, "isOwner", { get: () => false, configurable: true });
      try {
        await pc.sheet.render(true);
        for (let i = 0; i < 30 && !(pc.sheet.element instanceof HTMLElement); i++) await sleep(100);
        await sleep(400);
        pc.sheet.element?.querySelector('[data-action="tab"][data-tab="items"]')?.click();
        await sleep(250);
        // The affordance: the row is not rendered at all.
        out.gateHidesButton = !pc.sheet.element?.querySelector('[data-action="improvisedAttack"]');
        // The refusal: reaching the action another way is still turned away, and
        // posts nothing.
        const before = game.messages.size;
        await pc.sheet.options.actions.improvisedAttack.call(
          pc.sheet, { preventDefault() {} }, document.createElement("a"));
        await sleep(500);
        out.gateRefuses = game.messages.size === before
          && !document.querySelector("dialog.dialog.cairn-improvised-dialog");
        await pc.sheet.close();
      } finally {
        delete pc.isOwner;
        // The real getter is inherited, so deleting the own property IS the
        // restore -- and a GM owning every actor is what proves it answered.
        out.gateShadowLifted = pc.isOwner === true;
      }
    }

    /* ---- 10. the submenu: three rows, NEVER greyed ----------------------- */
    // With every option OFF, which is exactly when the master's build greyed
    // them: each row must be live, with no disabled input and no greyed-row
    // class. The red-first witness against the master build.
    for (const k of KEYS) await game.settings.set(NS, k, false);
    const menu = game.settings.menus.get(`${NS}.hacks`);
    const app = menu ? new menu.type() : null;
    if (app) { await app.render(true); await sleep(700); }
    const root = app?.element;
    const input = (k) => root?.querySelector(`[name="${NS}.${k}"]`) ?? null;
    out.rowsLive = Object.fromEntries(KEYS.map((k) => [k, {
      present: !!input(k),
      disabled: input(k)?.disabled ?? null,
      greyed: !!input(k)?.closest(".form-group")?.classList.contains("cairn-setting-disabled"),
    }]));
    out.masterRow = !!input("crawler-combat-mode");
    // The OTHER spec must still work — its master lives in another submenu and
    // is read from the stored value at render. The regression witness for the
    // list form of subOptions, which outlived the second master.
    out.barebonesSub = {
      masterStored: game.settings.get(NS, "content-source-barebones"),
      disabled: input("barebones-failed-career")?.disabled ?? null,
    };
    if (app) await app.close();

    /* ---- 16. NOTHING TO DROP ------------------------------------------- */
    // The leg that keeps the OLD claim honest. Before the picker existed, the
    // Fatigue button's headline property was that it lands past a FULL pack
    // (`ignoreCapacity`), leaving the character at 0 Hit Protection —
    // and with a drop in front of it that is no longer what normally happens,
    // because the drop makes the room. It is still what happens to a character
    // with nothing to give up, so that is where the claim is measured now.
    //
    // RUNS LAST, on purpose: it strips the character's inventory, and every
    // earlier leg needs the weapons and the filler items that are on it.
    {
      await game.settings.set(NS, "fatigue-for-critical-damage", true);
      const notFatigue = pc.items.filter((i) => !i.system?.isFatigue).map((i) => i.id);
      if (notFatigue.length) await pc.deleteEmbeddedDocuments("Item", notFatigue);
      // Fill the pack with Fatigue, which is the one thing the picker will not
      // offer — so this character is genuinely full AND has nothing to drop.
      const need = Math.max(0, pc.system.slotsMax - pc.system.slotsUsed);
      if (need > 0) {
        await pc.createEmbeddedDocuments("Item",
          Array.from({ length: need }, () => ({ name: "Fatigue", type: "item" })));
      }
      await sleep(400);
      out.emptyBefore = { used: pc.system.slotsUsed, max: pc.system.slotsMax };
      const fBefore = pc.items.filter((i) => i.name === "Fatigue").length;
      const m4 = await postSave(pc, true);
      out.made2.push(m4.id);
      rowOf(m4)?.querySelector(".take-fatigue-instead")?.click();
      // NO PICKER, AND NOW THE OPPOSITE OUTCOME. This leg used to prove that a
      // character with nothing to give up got the Fatigue anyway, past a full
      // pack, through `ignoreCapacity`. That carve-out is REVERSED (user ruling):
      // the price is an item that frees a slot, and nothing to pay with means the
      // price cannot be paid — so the save stands and the Critical Damage lands
      // the instant the button is pressed, with no dialog in between. The one
      // gesture in the system where a control does the opposite of its label,
      // which is why the check mark below is load-bearing.
      //
      // `ignoreCapacity` itself stays: casting and the Add Fatigue control use it.
      await sleep(1200);
      out.emptyNoPicker = !document.querySelector("dialog.dialog.cairn-drop-dialog");
      out.emptyFatigueAdded = pc.items.filter((i) => i.name === "Fatigue").length - fBefore;
      out.emptyCritical = pc._source.system.critical === true;
      out.emptyChoice = m4.getFlag(NS, "crawlerChoiceTaken") ?? null;
      out.emptyTickOnCrit = !!rowOf(m4)?.querySelector(".mark-critical-damage .fa-check");
      out.emptyTickOnFatigue = !!rowOf(m4)?.querySelector(".take-fatigue-instead .fa-check");
      out.emptyAfter = state(pc);
    }

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
    // NO FLOOR (2026-10-03): every sub-d6 shape explodes like any other, the
    // `+` pool through its keep form, and d12 still does.
    d4: "1d4x", d4bare: "d4x", d4keep: "2d4kx", d4plus: "2d4kx", d5: "1d5x",
    d12: "1d12x",
  };
  const bad = Object.entries(WANT).filter(([k, v]) => r.transform?.[k] !== v);
  bad.length === 0
    ? ok(`the formula transform is right on all ${Object.keys(WANT).length} shapes, including d6 + d6 -> 2d6kx (no "+" left for the Cairn rewrite to invert), every sub-d6 shape exploding too since the floor went (1d4x, d4x, 2d4kx, d4 + d4 -> 2d4kx, 1d5x) and 1d12`)
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

  // ---- 5/6. overburdened: HP 0, and Deprived LEFT ALONE ------------------
  // The one-day derived rule (2026-10-02) is REVERSED (2026-10-03, user).
  r.pcLoaded?.encumbered && !r.pcLoaded?.derived && !r.pcLoaded?.source
    ? ok(`an overburdened PC (${r.pcLoaded.used}/${r.pcLoaded.max}) is NOT deprived — derived false, source false`)
    : fail(`loaded PC: ${JSON.stringify(r.pcLoaded)} — want encumbered, deprived false both ways (the reversed rule derived it true)`);
  r.pcLoaded?.hp === 0 && r.pcLoaded?.srcHp !== 0
    ? ok("...at 0 Hit Protection, with source HP intact — core's rule, untouched")
    : fail(`PC hp derived=${r.pcLoaded?.hp} source=${r.pcLoaded?.srcHp}`);
  !r.monsterLoaded?.derived && !r.hireLoaded?.derived
    ? ok("an overburdened monster and hireling are not deprived either")
    : fail(`monster derived=${r.monsterLoaded?.derived}, hireling derived=${r.hireLoaded?.derived}`);
  !r.pcReset?.derived && r.pcReset?.encumbered
    ? ok("...nor after a full re-initialize (reset, not prepareData)")
    : fail(`after reset: ${JSON.stringify(r.pcReset)}`);
  !r.pcFreed?.derived && !r.pcFreed?.source
    ? ok("...and freeing a slot writes nothing to the player's own stored value")
    : fail(`after freeing: ${JSON.stringify(r.pcFreed)}`);
  r.boxDisabled === false && r.boxChecked === false
    ? ok("the Deprived checkbox is LIVE and unticked — nothing locks it")
    : fail(`deprived checkbox: disabled=${r.boxDisabled}, checked=${r.boxChecked} — the reversed rule ticked and locked it`);
  r.restDisabled === false && r.restoreDisabled === false
    ? ok("...and Rest and Restore Abilities are not refused by the load")
    : fail(`rest disabled=${r.restDisabled}, restore disabled=${r.restoreDisabled}`);
  (r.bannerText ?? "").includes(r.bannerExpected ?? "\u0000") && r.bannerCrawlerKeyGone
    ? ok("...and the Overburdened banner wears the one plain wording; the Crawler variant key is gone")
    : fail(`banner reads ${JSON.stringify(r.bannerText)}, expected ${JSON.stringify(r.bannerExpected)}; crawler key gone=${r.bannerCrawlerKeyGone}`);

  // ---- 8/9. the Fatigue button -------------------------------------------
  r.fatigueBtnRenders && r.critBtnRenders
    ? ok("a failed PC save offers BOTH Mark Critical Damage and Take a Fatigue instead")
    : fail(`buttons: fatigue=${r.fatigueBtnRenders}, crit=${r.critBtnRenders}`);
  r.tipKeyed === "CAIRN.Crawler.FatigueButtonTip"
    ? ok("...and the Fatigue button names its cost in a tooltip, the only place it can")
    : fail(`tooltip attribute is ${JSON.stringify(r.tipKeyed)}`);
  // SOMETHING GOES ON THE FLOOR FIRST (2026-10-02). The button asks before it
  // creates anything, so `usedGrew` is no longer the right question: one item
  // leaves and the Fatigue arrives, which is the whole point of the drop.
  r.dropAsked && r.fatigueAdded === 1 && r.droppedGone && r.itemsNetZero
    ? ok(`clicking it asks what to drop, then adds exactly one Fatigue — "${r.dropPickedName}" went out as the Fatigue came in`)
    : fail(`drop asked=${r.dropAsked}, fatigue added=${r.fatigueAdded}, dropped gone=${r.droppedGone}, net zero=${r.itemsNetZero}`);
  r.pileMade && r.pileHasIt && r.pileInParty
    ? ok(`...and it is IN the Dropped Item Pile, which was made on demand inside the Party folder`)
    : fail(`pile made=${r.pileMade}, holds it=${r.pileHasIt}, in Party folder=${r.pileInParty}`
      + (r.pilesAtStart ? ` — NOTE: ${r.pilesAtStart} pile(s) already existed when this run started, so this leg read one it did not create` : ""));

  /* ---- the "where did you drop it" note -------------------------------- */
  r.pileTags?.["ZZ Note Rope"] === "under the bridge"
    ? ok(`a drop RENDERS where it was left ("${r.pileTags["ZZ Note Rope"]}") on the pile's row — counted as rendered elements, because the partial's `
      + "`../` gate fails silently and leaves flag-set-zero-elements")
    : fail(`drop note tag: ${JSON.stringify(r.pileTags)} (derived: ${JSON.stringify(r.noteDerived)})`);
  r.pileTags?.["ZZ Note Sack"] === null && r.noteDerived?.blank === ""
    ? ok("...and a blank one leaves the row with no tag at all — optional, because a forced field mostly yields \"x\"")
    : fail(`blank note: tag=${JSON.stringify(r.pileTags?.["ZZ Note Sack"])} derived=${JSON.stringify(r.noteDerived?.blank)}`);
  r.noteKeptFlag === "on their own sheet" && r.charTags?.["ZZ Note Kept"] === null
    ? ok("...and a CHARACTER's row shows none even for an item carrying the note — the tag is gated on the sheet, so a handed-back item simply stops advertising where it used to be")
    : fail(`character-sheet tag: ${JSON.stringify(r.charTags)} — the flag reads "${r.noteKeptFlag}", so this leg has something to render if the gate is wrong`);
  // Unlimited is the ruling, and it is read off the DERIVED value every capacity
  // path actually consults, not off the `slots: 0` the pile is created with.
  r.pileUnlimited && r.pileOwnership === 2
    ? ok(`...with no slot limit at all (slotsMax Infinity, never encumbered) and OBSERVER for players: they see what was dropped, the Warden hands it back`)
    : fail(`pile unlimited=${r.pileUnlimited}, ownership.default=${r.pileOwnership} (want 2 = OBSERVER)`);
  // The chat record, and that the card stores a NAME rather than a sentence —
  // it is composed on whichever client ran the move, so a stored line would
  // freeze in that client's language for every reader.
  r.dropCard && r.dropCard.item === r.dropPickedName && r.dropCard.text.includes(r.dropPickedName)
    ? ok(`...and the drop is recorded in chat ("${r.dropCard.text}"), rebuilt per viewer from the stored name`)
    : fail(`drop card: ${JSON.stringify(r.dropCard)} — want the item NAME in the flag, not a composed sentence`);
  r.critAfterFatigue === false
    ? ok("...and does NOT set Critical Damage — that is the whole point of the choice")
    : fail("taking the Fatigue also marked Critical Damage");
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
  // NO MASTER (2026-10-03, user ruling): the key is unregistered, nothing in
  // the Hacks group names it, and the three rows are live with every option
  // off — exactly when the master's build greyed them.
  r.masterGone && !r.masterRow && !(r.hackKeys ?? []).includes("crawler-combat-mode")
    ? ok("there is no Crawler Combat Mode: the key is unregistered and the Hacks submenu has no such row")
    : fail(`master still present: registered=${!r.masterGone}, row=${r.masterRow}, hackKeys=${JSON.stringify(r.hackKeys)}`);
  KEYS_ALL.every((k) => (r.hackKeys ?? []).includes(k))
    ? ok("...and the three options are in the Hacks group")
    : fail(`hack keys: ${JSON.stringify(r.hackKeys)}`);
  JSON.stringify(r.subSpecs) === JSON.stringify(["content-source-barebones"])
    ? ok("the Hacks group's only subOptions spec is Barebones' — nothing gates the three")
    : fail(`subOptions masters are ${JSON.stringify(r.subSpecs)}`);
  KEYS_ALL.every((k) => r.rowsLive?.[k]?.present && r.rowsLive[k].disabled === false && !r.rowsLive[k].greyed)
    ? ok("all three rows are LIVE with every option off — no disabled input, no greyed row")
    : fail(`rows: ${JSON.stringify(r.rowsLive)} — the master build greyed them while it was off`);
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

  // ---- Part 3: maneuver on max damage -----------------------------------
  // NO CHOICE ON THE CARD since the night of 2026-10-03: the damage stands,
  // exploding (when on) happens at roll time, and a maximum adds ONE line. So
  // every leg asserts four things — the formula, the line, Apply present, and
  // the withdrawn buttons absent — because a card that still offered the old
  // pair would pass a line-only check.
  const noX = (f) => !!f && !/x/.test(f);
  const hasX = (f) => !!f && /x/.test(f);
  const LINE = r.maneuverLineText;
  const lineOk = (c) => !!c && c.line === LINE && c.apply && !c.buttons;
  const noLine = (c) => !!c && c.line === null && c.apply && !c.buttons;
  LINE && !LINE.startsWith("CAIRN.")
    ? ok(`the maneuver line localizes in-page ("${LINE}"), so every leg below compares the sentence and not a key`)
    : fail(`CAIRN.Crawler.ManeuverAvailable came back as ${JSON.stringify(LINE)} — an unknown key localizes to itself`);
  lineOk(r.mvBoth) && /^1?d10x/.test(r.mvBoth.formula ?? "") && r.mvBoth.datum && r.mvBoth.exploded >= 1
    ? ok(`both options on, d10 at its max: the die EXPLODED at roll time (${r.mvBoth.formula}, ${r.mvBoth.exploded} line(s)), the card says a maneuver is possible, and Apply is there — the damage stands`)
    : fail(`mvBoth: ${JSON.stringify(r.mvBoth)} — want 1d10x, the line, Apply, and no buttons`);
  // The glows: compared with what the LIVE Mark Critical Damage button and the
  // pinned teal paint in the same scheme, never with a literal of core's red.
  r.linesLight?.exploded && r.linesLight.exploded === r.btnLight?.critGlow
    ? ok(`the explosion line glows Mark Critical Damage's own red (${r.linesLight.exploded}), the colour Explode the Die wore`)
    : fail(`explosion line glow (light): ${r.linesLight?.exploded}, want ${r.btnLight?.critGlow} — "none" means no glow at all`);
  r.linesLight?.maneuver === TEAL
    ? ok(`...and the maneuver line glows the Fatigue teal (${TEAL})`)
    : fail(`maneuver line glow (light): ${r.linesLight?.maneuver}, want ${TEAL}`);
  r.linesDark?.exploded === r.btnDark?.critGlow && r.linesDark?.maneuver === TEAL
    ? ok(`...both UNCHANGED under a dark interface — the teal is the pinned chat token, never --ab-accent (rgb(53, 200, 218) here)`)
    : fail(`line glows (dark): ${JSON.stringify(r.linesDark)}, want red ${r.btnDark?.critGlow} and teal ${TEAL}`);
  lineOk(r.mvRanged) && hasX(r.mvRanged.formula) && r.mvRanged.datum
    ? ok(`a RANGED weapon earns the line too (${r.mvRanged.formula}) — the Ranged box withholds nothing any more`)
    : fail(`mvRanged: ${JSON.stringify(r.mvRanged)} — want x, the datum and the line; no line means the melee-only rule survived`);
  lineOk(r.mvD4) && /^1?d4x/.test(r.mvD4.formula ?? "")
    ? ok(`NO FLOOR: a d4 at its max explodes (${r.mvD4.formula}) and earns the line`)
    : fail(`mvD4: ${JSON.stringify(r.mvD4)} — want 1d4x and the line`);
  lineOk(r.mvImpaired) && /^1?d4x/.test(r.mvImpaired.formula ?? "")
    ? ok(`an IMPAIRED attack on a d10 weapon rolls ${r.mvImpaired.formula} and earns the line — judged on the 1d4 it actually rolls, not the weapon`)
    : fail(`mvImpaired: ${JSON.stringify(r.mvImpaired)} — want 1d4x and the line`);
  lineOk(r.mvPlus) && /^2d6kx/i.test(r.mvPlus.formula ?? "")
    ? ok(`a d6 + d6 weapon explodes in its keep form (${r.mvPlus.formula}) and earns the line`)
    : fail(`mvPlus: ${JSON.stringify(r.mvPlus)} — want 2d6kx and the line`);
  lineOk(r.mvEnhanced) && /d12x/.test(r.mvEnhanced.formula ?? "")
    ? ok(`...and an ENHANCED attack (${r.mvEnhanced.formula}) earns it too`)
    : fail(`mvEnhanced: ${JSON.stringify(r.mvEnhanced)}`);
  noLine(r.mvLow) && r.mvLow.datum
    ? ok(`a roll BELOW the maximum carries the datum and no line (${r.mvLow.formula}, total ${r.mvLow.total}) — the line is about the die, not about the option being on`)
    : fail(`mvLow: ${JSON.stringify(r.mvLow)} — want the datum and NO line`);
  r.mvMonster && noX(r.mvMonster.formula) && !r.mvMonster.datum && r.mvMonster.line === null && !r.mvMonster.buttons
    ? ok(`a MONSTER gets nothing — no explosion, no datum, no line; player characters only`)
    : fail(`mvMonster: ${JSON.stringify(r.mvMonster)}`);
  noLine(r.mvOptionOff) && hasX(r.mvOptionOff.formula) && !r.mvOptionOff.datum
    ? ok(`maneuver OFF with exploding on: the die explodes (${r.mvOptionOff.formula}) and no line is drawn`)
    : fail(`mvOptionOff: ${JSON.stringify(r.mvOptionOff)}`);
  noLine(r.mvD4Off) && /^1?d4x/.test(r.mvD4Off.formula ?? "") && !r.mvD4Off.datum
    ? ok(`...and the same for a d4 (${r.mvD4Off.formula})`)
    : fail(`mvD4Off: ${JSON.stringify(r.mvD4Off)}`);
  lineOk(r.mvNoExplode) && /^1?d10$/.test(r.mvNoExplode.formula ?? "")
    ? ok(`maneuver ON with exploding off: a plain ${r.mvNoExplode.formula} at its max, and the line`)
    : fail(`mvNoExplode: ${JSON.stringify(r.mvNoExplode)} — want a plain 1d10 and the line`);
  lineOk(r.mvPlusNoExplode) && /^2d6k(h1)?$/i.test(r.mvPlusNoExplode.formula ?? "")
    ? ok(`...and a d6 + d6 is rolled as ${r.mvPlusNoExplode.formula}, ONE Die term the card can judge — as a PoolTerm the line could never be drawn`)
    : fail(`mvPlusNoExplode: ${JSON.stringify(r.mvPlusNoExplode)} — want 2d6k and the line`);

  // ---- the Improvised Attack row -------------------------------------------
  const impOk = (r2) => r2 && !r2.err;
  impOk(r.impD6) && hasX(r.impD6.formula) && r.impD6.maneuverLine && !r.impD6.buttons
    ? ok(`Improvised Attack: a d6 typed into the dialog exploded at roll time (${r.impD6.formula}) and the card carries the maneuver line — no item anywhere in the path`)
    : fail(`impD6: ${JSON.stringify(r.impD6)}`);
  r.impD6?.line?.includes("a chair leg")
    ? ok(`...and the description reaches the card as the thing attacked with: "${r.impD6.line}" — the weapon datum, so no new sentence key was needed`)
    : fail(`the description did not reach the card: ${JSON.stringify(r.impD6?.line)}`);
  // THE ROW IS NOT AN ITEM, measured on the row itself rather than trusted from
  // the template: no trash can and no Drop control, because there is no document
  // for either to act on. If it ever becomes an Item those controls appear with
  // it, and this is the leg that says so.
  r.impD6?.rowShape?.isRow && r.impD6.rowShape.tag === "A"
    && !r.impD6.rowShape.deletable && !r.impD6.rowShape.droppable
    ? ok(`...pressed from a permanent row in the inventory that cannot be deleted or dropped (${r.impD6.rowShape.glyphs})`)
    : fail(`the improvised row: ${JSON.stringify(r.impD6?.rowShape)}`);
  // TWO FIELDS AND TWO BUTTONS. The absences are the ruling, so they are
  // asserted: a stale template would restore the builder or the qualities in
  // silence, and every other leg here would still pass.
  r.impD6?.shape?.hasDescription && r.impD6?.shape?.hasFormula
    && r.impD6?.shape?.hasRoll && r.impD6?.shape?.hasCancel
    && !r.impD6?.shape?.hasBuilder && !r.impD6?.shape?.hasQuality
    ? ok(`...and the dialog is exactly two fields and two buttons: no dice builder, no Standard/Impaired/Enhanced (opens on ${r.impD6.shape.formulaStart})`)
    : fail(`dialog shape: ${JSON.stringify(r.impD6?.shape)}`);
  // Apply on the card that carries the line: it was WITHHELD there for a day,
  // while a maneuver forwent the damage.
  r.impD6?.applyBtn === true
    ? ok(`...and Apply is on that card — a maneuver no longer costs the damage`)
    : fail(`Apply missing from a card with the maneuver line: ${JSON.stringify(r.impD6?.applyBtn)}`);
  r.impAutoExplode?.applyBtn === true
    ? ok(`...as it is on a card with no line`)
    : fail(`Apply missing from a card with no line: ${JSON.stringify(r.impAutoExplode?.applyBtn)}`);

  {
    const al = r.impD6?.rowShape?.align;
    al && al.dieLine === al.binLine && al.topGap < 1
      ? ok(`the damage die sits on the line its neighbours sit on: line-height ${al.dieLine} on both, boxes level to ${al.topGap.toFixed(2)}px — the rule covers "${al.dieClass.split(" ")[0]}" as well as "${al.binClass.split(" ")[0]}"`)
      : fail(`die alignment: ${JSON.stringify(al)} — a rule keyed to one spelling misses the other, and Font Awesome's own \`line-height: 1\` takes over (14px against 26px)`);
  }

  {
    const rs = r.impD6?.rowShape;
    rs?.marks?.length >= 3 && rs.uniqueMarks === rs.marks.length
      ? ok(`no two controls on one row share a mark (${rs.marks.length} controls, ${rs.uniqueMarks} marks): ${rs.marks.join(" ")}`)
      : fail(`duplicate control glyph: ${JSON.stringify(rs?.marks)} — Give and Drop both wore fa-hand-holding, one row apart`);
    const g = rs?.dropGlyph;
    g && /fa-down-to-line/.test(g.cls) && g.content && g.content !== "none" && g.content !== '""'
      ? ok(`...and Drop's arrow actually RENDERS (${g.content}) — read as content, never as a class, because a name this build lacks draws an empty box in silence`)
      : fail(`Drop glyph: ${JSON.stringify(g)} — fa-arrow-down-to-line is absent from the bundled FA5-era font; only fa-down-to-line resolves`);
  }

  impOk(r.impD4) && /^1?d4x/.test(r.impD4.formula ?? "") && r.impD4.maneuverLine && !r.impD4.buttons
    ? ok(`NO FLOOR through the improvised route: a typed d4 explodes (${r.impD4.formula}) and carries the line`)
    : fail(`impD4: ${JSON.stringify(r.impD4)} — want 1d4x and the line`);
  impOk(r.impD10) && /d10/.test(r.impD10.formula ?? "")
    ? ok(`the TYPED formula is what gets rolled (${r.impD10.formula}), not the 1d4 the field starts on`)
    : fail(`impD10: ${JSON.stringify(r.impD10)}`);
  // THE SENTENCE IS COMPARED, not merely checked for a dangling "with ". The
  // old assertion was `!/with\s*$/` and "" passes that, which is how a card with
  // NO SENTENCE AT ALL shipped green.
  impOk(r.impBlank) && r.impBlank.line === r.expect?.improvised
    ? ok(`a blank description NAMES THE ATTACK ("${r.impBlank.line}") — not the empty label this leg used to accept`)
    : fail(`impBlank: expected "${r.expect?.improvised}", read "${r.impBlank?.line}" from ${JSON.stringify(r.impBlank?.labelData)}`);
  r.impBlank?.labelData?.unarmed === "1"
    ? ok(`...off a KIND on the card (data-unarmed), never the phrase stored as the weapon — which a possessive frame one card along would render "from X's an improvised attack"`)
    : fail(`data-unarmed missing: ${JSON.stringify(r.impBlank?.labelData)}`);
  r.impTgtBlank?.line === r.expect?.tgtImprovised
    ? ok(`TARGETED and blank: "${r.impTgtBlank.line}"`)
    : fail(`impTgtBlank: expected "${r.expect?.tgtImprovised}", read "${r.impTgtBlank?.line}" (targets ${r.tgtCount})`);
  r.impTgtTyped?.line === r.expect?.tgtWeapon
    ? ok(`...while typed text still reaches the weapon key ("${r.impTgtTyped.line}") — the contrast is what proves the ternary picks an arm rather than one arm always winning`)
    : fail(`impTgtTyped: expected "${r.expect?.tgtWeapon}", read "${r.impTgtTyped?.line}"`);

  impOk(r.impMonster) && noX(r.impMonster.formula) && !r.impMonster.maneuverLine && !r.impMonster.datum
    ? ok(`a MONSTER's improvised attack never explodes (${r.impMonster.formula}) and carries no line — the PC gate is at the roll site`)
    : fail(`impMonster: ${JSON.stringify(r.impMonster)}`);
  impOk(r.impAutoExplode) && hasX(r.impAutoExplode.formula) && !r.impAutoExplode.maneuverLine
    ? ok(`...while a PC's d6 with maneuver OFF explodes (${r.impAutoExplode.formula}) with no line, exactly as a weapon would`)
    : fail(`impAutoExplode: ${JSON.stringify(r.impAutoExplode)}`);

  impOk(r.impPanicked) && r.impPanicked.shape?.hasDescription
    && r.impPanicked.shape?.hasFormula && !r.impPanicked.shape?.hasQuality
    && r.impPanicked.shape?.hasRoll && !!r.impPanicked.shape?.panicNote
    ? ok(`PANICKED: the field is still there and still editable, with a note saying the override is coming ("${r.impPanicked.shape.panicNote}")`)
    : fail(`panicked dialog shape: ${JSON.stringify(r.impPanicked?.shape)}`);
  r.gateHidesButton && r.gateRefuses
    ? ok(`the ownership gate holds BOTH ways: a non-owner is shown no row, and reaching the action anyway is refused with nothing posted`)
    : fail(`ownership gate: row hidden ${r.gateHidesButton}, refused ${r.gateRefuses}`);
  r.gateShadowLifted
    ? ok(`...and the isOwner shadow was lifted, leaving the live actor as it was`)
    : fail(`the isOwner shadow is STILL on the actor — a probe that leaves one poisons every later run`);
  impOk(r.impPanicked) && /^1?d4x/.test(r.impPanicked.formula ?? "")
    && r.impPanicked.maneuverLine && !r.impPanicked.buttons
    ? ok(`...and a typed d10 still rolls ${r.impPanicked.formula} — the override is at the roll site — and that 1d4 explodes and carries the line like any other die`)
    : fail(`panicked roll: ${JSON.stringify(r.impPanicked)} — want 1d4x with the line`);

  // NOTHING TO DROP: the old "past a full pack" claim, measured where it is
  // still true. A character whose every slot is Fatigue has nothing the picker
  // would offer, so no dialog opens and the Fatigue lands over the limit.
  /* ---- the bargain: refuse, Escape, and what the picker offers --------- */
  {
    const b = r.bargain ?? {};
    b.row?.display === "flex" && b.row?.sameTop && b.row?.differentLeft
      ? ok("the save card's pair sits SIDE BY SIDE (one flex row, same top edge, different left) — they had no CSS at all, which is why two block-level buttons stacked")
      : fail(`save-card pair layout: ${JSON.stringify(b.row)}`);

    b.refuseAsked && b.refuse?.critical && b.refuse?.fatigueDelta === 0 && b.refuse?.stillHasItem
      ? ok(`REFUSING APPLIES THE CRITICAL DAMAGE ("${b.refuseBtnLabel}"): no Fatigue created, nothing dropped — the old rule was that cancelling backed out of everything`)
      : fail(`refuse: ${JSON.stringify(b.refuse)} (asked=${b.refuseAsked}, label=${JSON.stringify(b.refuseBtnLabel)})`);
    b.refuse?.flag === "critical" && b.refuse?.sealedBoth
      && b.refuse?.tickOnCrit && !b.refuse?.tickOnFatigue
      ? ok("...and the pair seals with the check on Mark Critical Damage, which nobody pressed")
      : fail(`after refusing: ${JSON.stringify(b.refuse)}`);

    b.escapeAsked && b.escape?.critical === false && b.escape?.fatigueDelta === 0
      && b.escape?.flag === null && b.escape?.liveBoth
      ? ok("ESCAPE IS NOT A REFUSAL — nothing written, nothing spent, both buttons still live. This is the accident guard the old ruling existed for, kept")
      : fail(`escape: ${JSON.stringify(b.escape)} — only the NAMED button may refuse`);

    b.take?.critical === false && b.take?.fatigues === 3 && b.take?.gone
      && b.take?.flag === "fatigue" && b.take?.tickOnFatigue && !b.take?.tickOnCrit
      ? ok(`TAKING IT at the edge: one thing down, one Fatigue on, Critical Damage NOT written, check on the Fatigue button`)
      : fail(`take: ${JSON.stringify(b.take)}`);
    b.take?.usedAfter === b.take?.usedBefore
      ? ok(`...and the bargain NETS TO ZERO (${b.take.usedBefore} slots before, ${b.take.usedAfter} after) — the drop pays for the Fatigue exactly`)
      : fail(`slots: ${b.take?.usedBefore} -> ${b.take?.usedAfter} — the drop is meant to pay for the Fatigue exactly`);

    // ONLY WHEN IT WOULD NOT FIT (2026-10-03, user ruling). The two no-picker
    // legs are what tell this rule from the day-old "always ask" one.
    b.room?.asked === false && b.room?.fatigues === 2 && b.room?.itemsDelta === 1 && b.room?.stillHasItem
      && b.room?.critical === false && b.room?.flag === "fatigue" && b.room?.tickOnFatigue && !b.room?.tickOnCrit
      ? ok(`WITH ROOM (${b.room.usedBefore} of 10) there is NO picker: the Fatigue lands, nothing is dropped, check on the Fatigue button`)
      : fail(`room: ${JSON.stringify(b.room)} — at 8 of 10 the user was asked to drop something for a Fatigue that fit`);
    b.room?.usedAfter === b.room?.usedBefore + 1
      ? ok(`...and it cost its slot (${b.room.usedBefore} -> ${b.room.usedAfter})`)
      : fail(`room slots: ${b.room?.usedBefore} -> ${b.room?.usedAfter}`);
    b.firstFull?.encumberedBefore && b.firstFull?.asked === true && b.firstFull?.fatigues === 0
      && b.firstFull?.usedAfter === b.firstFull?.usedBefore && b.firstFull?.flag === null && b.firstFull?.critical === false
      ? ok(`a FIRST Fatigue at a full pack (${b.firstFull.usedBefore} of 10) ASKS — already overburdened, Fatigue carried or not — and closing the picker unanswered lands nothing`)
      : fail(`first Fatigue at a full pack: ${JSON.stringify(b.firstFull)} — the free-first build never asked this character`);
    b.edge?.encumberedBefore === false && b.edge?.asked === false && b.edge?.fatigues === 1
      && b.edge?.itemsDelta === 1 && b.edge?.usedBefore === 9 && b.edge?.usedAfter === 10
      && b.edge?.encumberedAfter === true && b.edge?.flag === "fatigue" && b.edge?.critical === false
      ? ok(`AT 9 OF 10 there is NO picker: the Fatigue lands and leaves them overburdened (${b.edge.usedBefore} -> ${b.edge.usedAfter}) — only an ALREADY overburdened character is asked`)
      : fail(`edge: ${JSON.stringify(b.edge)} — the "would not fit" build asked here`);

    b.legacy?.sealed && b.legacy?.anyTick === false
      ? ok("a card already in a log (flag `true`) seals with NO check — a default would silently mislabel history on cards nothing ever repairs")
      : fail(`legacy card: ${JSON.stringify(b.legacy)}`);

    const noPetty = (rows) => !rows?.some((t) => t.includes("ZZ Trinket"));
    const noFatigue = (rows) => !rows?.some((t) => t.includes("Fatigue"));
    b.fullEncumbered && noPetty(b.fullRows) && b.fullRows?.some((t) => t.includes("ZZ Fill"))
      ? ok(`overburdened: the picker lists what frees a slot and no petty item (${b.fullRows.length} rows)`)
      : fail(`overburdened rows: ${JSON.stringify(b.fullRows)} encumbered=${b.fullEncumbered}`);
    b.fullNote
      ? ok("...with the note saying why petty items are absent, shown because some were hidden")
      : fail("the PettyHidden note was missing although a petty item was filtered out");
    noFatigue(b.twoFatRows) && b.twoFatRows?.length === b.twoFatExpected
      ? ok(`...and a SECOND Fatigue is not offered though it costs a real slot (${b.twoFatRows.length} rows, none Fatigue) — excluded AS Fatigue, never via pettiness`)
      : fail(`with two Fatigues: ${JSON.stringify(b.twoFatRows)} expected=${b.twoFatExpected}`);

    const bulkyRow = b.labelRows?.find((t) => t.includes("ZZ Ladder")) ?? "";
    const torchRow = b.labelRows?.find((t) => t.includes("ZZ Torch")) ?? "";
    /2\s*slots/.test(bulkyRow) && !/bulky/i.test(bulkyRow)
      ? ok(`a bulky row says the NUMBER it frees ("${bulkyRow.replace(/\s+/g, " ")}") and never the word "bulky" — the number is what the decision turns on`)
      : fail(`bulky row: "${bulkyRow}"`);
    /2 of 3 uses/.test(torchRow) && /1\s*slot/.test(torchRow)
      ? ok(`...and a part-used torch shows its uses beside what it frees ("${torchRow.replace(/\s+/g, " ")}") — ONE item with three uses, not three torches`)
      : fail(`torch row: "${torchRow}"`);
    !/\bx\s*\d/i.test(b.dialogText ?? "") && !b.labelNote
      ? ok("...with no `x3` anywhere in the dialog, and no petty note where nothing was hidden")
      : fail(`quantity chip or a stray note: text=${JSON.stringify((b.dialogText ?? "").slice(0, 160))} note=${b.labelNote}`);
  }

  r.emptyNoPicker && r.emptyFatigueAdded === 0 && r.emptyCritical
    ? ok(`with NOTHING that frees a slot the picker does NOT open and the Critical Damage lands at once (${r.emptyBefore?.used}/${r.emptyBefore?.max}) — the price cannot be paid, so the save stands`)
    : fail(`nothing to pay with: picker suppressed=${r.emptyNoPicker}, fatigue added=${r.emptyFatigueAdded}, critical=${r.emptyCritical}`);
  r.emptyChoice === "critical" && r.emptyTickOnCrit && !r.emptyTickOnFatigue
    ? ok("...and the check lands on Mark Critical Damage although nobody pressed it — the only thing on screen telling a player who chose \"Fatigue instead\" what they actually got")
    : fail(`after a refusal by emptiness: flag=${JSON.stringify(r.emptyChoice)} tick on crit=${r.emptyTickOnCrit} on fatigue=${r.emptyTickOnFatigue}`);

  /* ---- 17. A PLAYER'S DROP, through the broker ------------------------- */
  // THE HALF NO SINGLE-CONTEXT LEG CAN REACH. Every leg above runs as the
  // Warden, who owns every actor and writes to the pile directly — so the whole
  // reason the broker exists (a player may only OBSERVE the pile, and the server
  // refuses their create) has never executed. It is also the authorization
  // boundary: without the ownership test on the GM side, any client could emit
  // another player's actor uuid and strip their sheet an item at a time.
  {
    const seed = await page.evaluate(async () => {
      const Cls = getDocumentClass("Actor");
      const alice = game.users.find((u) => u.name === "Alice");
      if (!alice) return { error: "no Alice user in this world" };
      const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
      const mine = await Cls.create({
        name: "ZZ Pile Alice PC", type: "character",
        ownership: { default: L.NONE, [alice.id]: L.OWNER },
      });
      // A second character Alice does NOT own: the decoy the broker must refuse.
      const theirs = await Cls.create({
        name: "ZZ Pile Foreign PC", type: "character", ownership: { default: L.NONE },
      });
      const item = { name: "ZZ Alice Rope", type: "item" };
      await mine.createEmbeddedDocuments("Item", [item]);
      const foreignItem = (await theirs.createEmbeddedDocuments("Item",
        [{ name: "ZZ Foreign Rope", type: "item" }]))[0];
      return {
        aliceId: alice.id, mineUuid: mine.uuid, theirsUuid: theirs.uuid,
        mineId: mine.id, theirsId: theirs.id, foreignItemId: foreignItem.id,
      };
    });
    if (seed.error) {
      fail(`player drop leg setup: ${seed.error}`);
    } else {
      const alicePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
      const aliceErrors = watchErrors(alicePage);
      await joinAs(alicePage, "Alice");
      await dismissChrome(alicePage);

      const player = await alicePage.evaluate(async ({ mineUuid, theirsUuid, foreignItemId }) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = {};
        const mine = await fromUuid(mineUuid);
        const theirs = await fromUuid(theirsUuid);
        const rope = mine.items.find((i) => i.name === "ZZ Alice Rope");
        out.ownsMine = mine.isOwner;
        out.ownsTheirs = theirs?.isOwner ?? null;

        // THE PILE IS READABLE AND NOT WRITABLE, which is the premise. Proven by
        // trying the write Alice's client would have to make without a broker:
        // the server refuses it, so the item would simply have been destroyed.
        const pile = game.actors.find((a) => a.getFlag("air-bladder", "droppedItemPile"));
        out.pileVisible = !!pile;
        out.pileOwner = pile?.isOwner ?? null;
        out.directWriteRefused = false;
        out.pileId = pile?.id ?? null;
        if (pile) {
          try {
            await pile.createEmbeddedDocuments("Item", [{ name: "ZZ Should Not Land", type: "item" }]);
          } catch { out.directWriteRefused = true; }
          await sleep(600);
          out.directWriteLanded = !!pile.items.find((i) => i.name === "ZZ Should Not Land");
        }

        // The affordance: the Drop control is on her own row.
        await mine.sheet.render(true);
        for (let i = 0; i < 30 && !(mine.sheet.element instanceof HTMLElement); i++) await sleep(100);
        mine.sheet.element?.querySelector('[data-action="tab"][data-tab="items"]')?.click();
        await sleep(400);
        const row = mine.sheet.element?.querySelector(`[data-item-id="${rope.id}"]`);
        out.dropControl = !!row?.querySelector('[data-action="itemDrop"]');

        // The real gesture, through the real handler, with the real confirm.
        // The button is `drop`, not core's `yes`: this dialog became a `wait` when
        // it grew the "Where?" field, so it declares its own buttons. It also
        // ASKS WHERE now, and the field is filled here so the player's own route
        // is the one that proves a note survives the broker.
        const { dropItemToPile } = await import("/systems/air-bladder/module/party-pile.js");
        const clicking = mine.sheet.options.actions.itemDrop.call(
          mine.sheet, { preventDefault() {} },
          row.querySelector('[data-action="itemDrop"]'));
        let yes = null;
        for (let i = 0; i < 40 && !yes; i++) {
          yes = document.querySelector('dialog.dialog button[data-action="drop"]');
          if (!yes) await sleep(150);
        }
        out.confirmAsked = !!yes;
        const where = document.querySelector('dialog.dialog input[name="place"]');
        out.confirmAsksWhere = !!where;
        if (where) where.value = "in the long grass";
        yes?.click();
        await clicking;
        // The GM answers over the socket, so this waits on the DELETE landing
        // back on her client rather than on any return value.
        for (let i = 0; i < 60 && mine.items.get(rope.id); i++) await sleep(200);
        await sleep(600);
        out.goneFromHer = !mine.items.get(rope.id);
        out.inPile = !!pile?.items?.find((i) => i.name === "ZZ Alice Rope");
        // The note she typed, carried across the broker and surfaced on the copy.
        out.brokeredNote = pile?.items?.find((i) => i.name === "ZZ Alice Rope")
          ?.system?.droppedAt ?? null;
        await mine.sheet.close();

        // THE NOTE IS CLAMPED WHERE THE WRITE HAPPENS, not where it is typed.
        // `maxlength="25"` on the field is the affordance; a player's drop is
        // brokered and `senderId` is the only field the server authenticates, so
        // a crafted emit can carry a note of any length. Sent as 40 characters
        // from HER client, through the real path, and read back on the pile.
        {
          const long = "x".repeat(40);
          const [big] = await mine.createEmbeddedDocuments(
            "Item", [{ name: "ZZ Alice Chest", type: "item" }]);
          await dropItemToPile(mine, big.id, { place: long });
          for (let i = 0; i < 60 && mine.items.get(big.id); i++) await sleep(200);
          await sleep(1200);
          const landed = pile?.items?.find((i) => i.name === "ZZ Alice Chest");
          out.clamped = landed?.system?.droppedAt?.length ?? null;
        }

        // THE DECOY: emit the broker's own payload naming an actor she does not
        // own. `senderId` is the only field the server authenticates, so the GM
        // must refuse this on ownership — otherwise one player can empty
        // another's sheet.
        game.socket.emit(`system.${game.system.id}`, {
          action: "pileDrop", actorUuid: theirsUuid, itemId: foreignItemId, announce: false,
        });
        await sleep(2500);
        out.foreignStillThere = !!theirs?.items?.get(foreignItemId);
        out.foreignNotInPile = !pile?.items?.find((i) => i.name === "ZZ Foreign Rope");
        // EXACTLY ONE COPY. The broker runs on "the active GM's client", which is
        // a test on the USER and not the session, so every Warden session answers
        // the same request — measured: two sessions made two copies and one
        // delete that threw. `movePileItem` keeps the item's id so the embedded
        // collection's own uniqueness elects one winner. Counted here, because
        // "is it in the pile" passes with any number of them.
        out.copiesInPile = pile?.items?.filter((i) => i.name === "ZZ Alice Rope").length ?? null;
        // Carried so a failure names WHERE the copies are: two in one pile is a
        // different defect from one in each of two piles.
        out.pileShape = game.actors.filter((a) => a.getFlag("air-bladder", "droppedItemPile"))
          .map((p) => ({ pile: p.id, ropes: p.items.filter((i) => i.name === "ZZ Alice Rope").map((i) => i.id) }));
        out.droppedItemId = rope.id;
        return out;
      }, seed);

      player.ownsMine && player.pileVisible && player.pileOwner === false
        ? ok("a player SEES the pile and does not own it — OBSERVER, which is the ruling")
        : fail(`player's view of the pile: ${JSON.stringify({ owns: player.ownsMine, visible: player.pileVisible, pileOwner: player.pileOwner })}`);
      player.directWriteLanded === false
        ? ok("...and her own write to it is REFUSED by the server, which is why the broker exists at all")
        : fail("a player wrote to the pile directly — the premise of the whole broker is false");
      player.dropControl && player.confirmAsked && player.confirmAsksWhere
        ? ok("the Drop control is on her row, asks before it moves anything, and asks WHERE")
        : fail(`drop control=${player.dropControl}, confirm asked=${player.confirmAsked}, where field=${player.confirmAsksWhere}`);
      player.brokeredNote === "in the long grass"
        ? ok(`...and the note she typed survives the broker ("${player.brokeredNote}") — it travels in the payload and is written GM-side`)
        : fail(`brokered note: ${JSON.stringify(player.brokeredNote)}`);
      player.goneFromHer && player.inPile
        ? ok("THE BROKERED MOVE LANDS: the Warden's client does both halves, so the item leaves her sheet and arrives in the pile")
        : fail(`brokered move: gone from her=${player.goneFromHer}, in pile=${player.inPile}`);
      player.foreignStillThere && player.foreignNotInPile
        ? ok("...and a crafted emit naming an actor she does NOT own is refused: senderId is the only trusted field, and the GM checks ownership against it")
        : fail(`AUTHORIZATION HOLE: foreign item still there=${player.foreignStillThere}, kept out of the pile=${player.foreignNotInPile}`);

      player.clamped === 25
        ? ok("...and a 40-character note sent through the broker lands clamped to 25 — the enforcement is on the GM's side, where the write is, because maxlength binds the field and not the wire")
        : fail(`brokered note length: ${player.clamped} — a crafted emit is not bound by the field's maxlength`);
      player.copiesInPile === 1
        ? ok("...and EXACTLY ONE copy landed — the item keeps its id, so the pile's own collection elects one winner however many Warden SESSIONS answered")
        : fail(`${player.copiesInPile} copies in the pile — the broker's activeGM guard tests the USER, not the session`
          + ` — dropped ${player.droppedItemId}, piles ${JSON.stringify(player.pileShape)}`);

      // THE REFUSAL THIS LEG EXISTS TO PROVE LOGS A CONSOLE ERROR, and it is the
      // probe's own doing: Alice deliberately tries the write the broker exists
      // to avoid, and the server turning her away is the measurement. Filtered
      // NARROWLY — the message must name the pile she was refused on — so any
      // other console error on her client still fails the run. A blanket mute
      // here would hide the next real one.
      /* ---- 18. TWO WARDEN SESSIONS, one drop ---------------------------- */
      // THE BROKER'S GUARD TESTS THE USER, NOT THE SESSION. Foundry lets one
      // Warden hold several sessions — a desktop and a laptop, or two tabs — and
      // `game.users.activeGM === game.user` is true in every one of them, so each
      // answers the same request and each ran the whole move. Measured before the
      // fix: two sessions put two copies in the pile and minted two piles, with
      // one delete throwing "does not exist" because the other had landed; three
      // sessions made three. `game.users.active` counts the USER once, so nothing
      // in the data model shows this.
      //
      // The leg opens a second Warden deliberately, because it cannot be reached
      // from one client at all — the same argument that put Alice in this probe.
      {
        const gm2 = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
        const gm2Errors = watchErrors(gm2);
        await joinAsGM(gm2);
        await dismissChrome(gm2);
        const twoSessions = await gm2.evaluate(() => ({
          sameUser: game.users.activeGM === game.user,
          usersActive: game.users.filter((u) => u.active).length,
        }));
        twoSessions.sameUser
          ? ok("a SECOND Warden session also answers the broker (activeGM === game.user in both) — and the user list still counts one Warden, so nothing in the data model shows it")
          : fail("the second session does not consider itself the active GM; this leg proves nothing");

        const second = await alicePage.evaluate(async ({ mineUuid }) => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const mine = await fromUuid(mineUuid);
          const [it] = await mine.createEmbeddedDocuments(
            "Item", [{ name: "ZZ Alice Lamp", type: "item" }]);
          const { dropItemToPile } = await import("/systems/air-bladder/module/party-pile.js");
          await dropItemToPile(mine, it.id);
          for (let i = 0; i < 60 && mine.items.get(it.id); i++) await sleep(200);
          await sleep(1500);
          return { id: it.id, goneFromHer: !mine.items.get(it.id) };
        }, seed);
        // Read on the FIRST Warden's client, and after a beat: the second
        // session's writes have to have arrived for the count to mean anything.
        const shape = await page.evaluate(async ({ name }) => {
          await new Promise((r) => setTimeout(r, 1200));
          const piles = game.actors.filter((a) => a.getFlag("air-bladder", "droppedItemPile"));
          return { piles: piles.length,
            copies: piles.map((p) => p.items.filter((i) => i.name === name).length) };
        }, { name: "ZZ Alice Lamp" });

        second.goneFromHer && shape.copies.reduce((a, b) => a + b, 0) === 1
          ? ok(`...yet the drop lands EXACTLY ONCE (${JSON.stringify(shape.copies)}): the item keeps its id, and an embedded collection is the one place Foundry refuses a duplicate, so the create IS the election`)
          : fail(`two sessions, one drop: gone from her=${second.goneFromHer}, copies ${JSON.stringify(shape.copies)} across ${shape.piles} pile(s)`);

        /* ---- 19. A SPLIT WORLD REPAIRS ITSELF ----------------------------- */
        // The pile create cannot be made atomic — a world create over an existing
        // id REPLACES rather than being refused, contents and all — so two
        // sessions racing a world's FIRST drop can each mint a pile, and a second
        // floor is one no sheet will ever show, since every reader resolves
        // through `findDroppedPile`.
        //
        // PLANTED, not raced. The race needs a world with no pile and two
        // sessions arriving together, which by this point in the run is gone —
        // and a leg that waits for a race it cannot cause passes by never
        // reaching the code. So the split state is planted directly, with an item
        // in the extra pile, and the next drop is what must repair it.
        const split = await page.evaluate(async () => {
          const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
          const extra = await CONFIG.Actor.documentClass.create({
            name: "ZZ Second Floor", type: "npc",
            system: { role: "container" },
            ownership: { default: L.OBSERVER },
            flags: { "air-bladder": { droppedItemPile: true } },
          });
          const [stranded] = await extra.createEmbeddedDocuments(
            "Item", [{ name: "ZZ Stranded Sack", type: "item" }]);
          return { extraId: extra.id, strandedId: stranded.id,
            piles: game.actors.filter((a) => a.getFlag("air-bladder", "droppedItemPile")).length };
        });
        split.piles === 2
          ? ok("a world SPLIT into two piles (planted, with an item stranded in the second)")
          : fail(`could not plant the split: ${split.piles} pile(s)`);

        // Any drop runs `ensureDroppedPile`, which is where the repair lives.
        const repaired = await page.evaluate(async () => {
          const a = await CONFIG.Actor.documentClass.create({ name: "ZZ Repair PC", type: "character" });
          const [it] = await a.createEmbeddedDocuments("Item", [{ name: "ZZ Repair Rope", type: "item" }]);
          const { dropItemToPile } = await import("/systems/air-bladder/module/party-pile.js");
          await dropItemToPile(a, it.id);
          await new Promise((r) => setTimeout(r, 1200));
          const piles = game.actors.filter((x) => x.getFlag("air-bladder", "droppedItemPile"));
          const out = {
            piles: piles.length,
            // The stranded item must be ON the surviving pile — merged, not lost
            // with the document it sat in.
            strandedKept: piles.some((p) => p.items.some((i) => i.name === "ZZ Stranded Sack")),
            dropped: piles.some((p) => p.items.some((i) => i.name === "ZZ Repair Rope")),
          };
          await a.delete();
          return out;
        });
        repaired.piles === 1 && repaired.strandedKept && repaired.dropped
          ? ok("...and the next drop REPAIRS it: one floor again, with the stranded item merged into it rather than deleted along with the pile it sat in")
          : fail(`repair: ${JSON.stringify(repaired)} — contents must move BEFORE the extra pile goes`);

        // THE LOSING SESSION'S REFUSAL IS THE MECHANISM, and Foundry logs it.
        // Filtered by that exact SHAPE on both clients — a duplicate `_id` inside
        // an embedded collection, which is the election refusing the second
        // create and nothing else — so any other console error still fails the
        // run. Not pinned to one id: every brokered drop made while two sessions
        // are open produces one, and this block makes more than one.
        const dupe = /_id \[\w+\] already exists within the parent collection/;
        for (const [tag, list] of [["second Warden", gm2Errors], ["Warden", errors]]) {
          const left = list.filter((e) => !dupe.test(String(e)));
          const removed = list.length - left.length;
          list.length = 0;
          list.push(...left);
          if (removed) ok(`...and the ${tag} session's refused create is the only thing logged (${removed} duplicate-id refusal${removed === 1 ? "" : "s"})`);
        }
        await gm2.context().close();
      }

      const expected = new RegExp(`lacks permission to create Item .* in parent Actor \\[${player.pileId}\\]`);
      const unexpected = aliceErrors.filter((e) => !expected.test(String(e)));
      if (unexpected.length) {
        console.error("\n  player console errors:");
        unexpected.slice(0, 5).forEach((e) => console.error("  " + e));
        failed = true;
      }
      await alicePage.context().close();
      await page.evaluate(async ({ mineId, theirsId }) => {
        for (const id of [mineId, theirsId]) {
          try { await game.actors.get(id)?.delete(); } catch { /* gone */ }
        }
        const pile = game.actors.find((a) => a.getFlag("air-bladder", "droppedItemPile"));
        const stray = pile?.items?.filter((i) => i.name.startsWith("ZZ ")) ?? [];
        if (stray.length) await pile.deleteEmbeddedDocuments("Item", stray.map((i) => i.id));
      }, seed);
    }
  }
  // Cleanup: the actors and the cards this probe minted — INCLUDING the pile and
  // the Party folder, which this run creates on demand the way a table would. A
  // probe that leaves them behind makes the next run's "made on demand" leg pass
  // for the wrong reason.
  await page.evaluate(async ({ ids, msgs, pileId, pileIdsAtStart, sceneId }) => {
    for (const id of msgs ?? []) { try { await game.messages.get(id)?.delete(); } catch { /* gone */ } }
    // The scene the targeted legs placed a foe on, and its token with it.
    if (sceneId) { try { await game.scenes.get(sceneId)?.delete(); } catch { /* gone */ } }
    for (const m of game.messages.filter((x) => x.getFlag("air-bladder", "pileDrop"))) {
      try { await m.delete(); } catch { /* gone */ }
    }
    const folder = game.actors.get(pileId)?.folder ?? null;
    try { await game.actors.get(pileId)?.delete(); } catch { /* gone */ }
    // EVERY pile this run did not find at its start — by ID DIFFERENCE, the
    // rule for planted documents. The split-world leg's planted pile may have
    // become the floor (see pileIdsAtStart), in which case `pileId` is already
    // gone and the planted one is what would otherwise survive.
    const keep = new Set(pileIdsAtStart ?? []);
    for (const p of game.actors.filter((a) => a.getFlag("air-bladder", "droppedItemPile") && !keep.has(a.id))) {
      try { await p.delete(); } catch { /* gone */ }
    }
    for (const id of ids ?? []) { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }
    // The folder goes only if the probe emptied it — a Warden's own party must
    // survive a probe run, and `deleteSubfolders` is never passed.
    if (folder?.getFlag("air-bladder", "partyFolder") && !folder.contents.length) {
      try { await folder.delete(); } catch { /* gone */ }
    }
  }, { ids: r.made, msgs: [...(r.madeMsgs ?? []), ...(r.made2 ?? [])],
    pileId: r.pileId ?? null, pileIdsAtStart: r.pileIdsAtStart ?? [], sceneId: r.sceneId ?? null });
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nCOMBAT OPTIONS PROBE FAILED\n" : "\ncombat options probe passed\n");
process.exit(failed ? 1 : 0);

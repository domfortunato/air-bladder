#!/usr/bin/env node
/**
 * The Warden's PLAYER-CHARACTER generation dice — abilities, gold and Hit
 * Protection — and the formula every Roll Character row now names.
 *
 * A Warden could already edit the dice for a generated character's AGE
 * (`age-formula`). The other three were literals: 3d6 abilities, 3d6 gold, 1d6
 * Hit Protection, hardcoded or buried in config, so a table wanting a different
 * power level had no route. Three settings close that (2026-10-02, user ask),
 * and with age they make every die in character generation the Warden's.
 *
 *   1. All three are registered `config: false` — so no loose row on the main
 *      settings window — and render inside the Character Generation submenu:
 *      abilities and gold as SELECTS carrying the three tiers in declared
 *      order, Hit Protection as a TEXT box. That last one is the leg that
 *      catches a `choices` key landing on the wrong registration, which would
 *      silently turn the free-text field into a dropdown.
 *   1b. Each rendered option label NAMES THE DICE THE MAP HOLDS. The labels
 *      carry their formula as a literal ("Standard (3d6)") and cannot do
 *      otherwise: `registerSettings()` runs on `init` and `i18nInit` is a later
 *      hook, so `game.i18n.format` is unavailable at registration and the label
 *      cannot be composed from `Cairn.pcDiceTiers`. That duplication is exactly
 *      the review #18 shape — a formula corrected in one place and still
 *      advertised by the other — so it is GATED here rather than wished away.
 *   2. Pinned dice give each tier its true bounds: standard 3..18, adventurer
 *      3..18, crawler 8..18, and HP 1..6 by default or exactly N for a flat N.
 *   3. THE ROLL CHARACTER CHECKLIST OBEYS ALL THREE AND LABELS SIX ROWS. This
 *      is the leg that earns the probe. Abilities, gold and HP are each rolled
 *      in THREE places, and the third — `_applyRerollParts` — calls
 *      `evaluateFormula` DIRECTLY rather than going through the rollers. A
 *      setting wired only into the generators would have left the control a
 *      player uses most often (re-roll one STR) on the old literal, with
 *      generation obeying the Warden and the sheet not.
 *   3b. With Show traits OFF the age row is gone and the other five still carry
 *      their tooltips — `traitsVisible()` gates that row, so six is not a
 *      constant and a probe asserting six would be asserting a coincidence.
 *   4. The three settings are INDEPENDENT: adventurer abilities with standard
 *      gold and a flat HP all land in one generated character.
 *   4b. HP is the one Warden-TYPED formula, so it keeps the age formula's whole
 *      contract: unparseable falls back AND warns naming the rejected text,
 *      blank falls back SILENTLY (blank is a reset, not a mistake), an
 *      `@`-reference is refused before Roll.validate can accept it — with the
 *      control that Roll.validate still DOES accept one.
 *   5. NPCs are untouched, and the ability leg MUST use crawler: standard and
 *      adventurer both span 3..18, so pinned extremes cannot tell a PC from an
 *      NPC under either. Under crawler a PC's floor is 8 and an NPC's is 3.
 *   6. Bond and question gold still add ON TOP of the base roll — those are
 *      grants, not the roll, and a Crawler character still receives them.
 *   7. A stored tier the map does not hold falls back to standard, so a world
 *      holding the retired `hero` key cannot throw mid-generation.
 *
 * The tooltips are read off the RENDERED dialog, never off the source, because a
 * typo in the attribute NAME fails SILENTLY by either of two mechanisms
 * (measured 2026-10-02 against `foundry.utils.cleanHTML`): anything outside
 * core's ALLOWED_HTML_ATTRIBUTES is DROPPED — `dat-tooltip`, `tooltip`,
 * `wibble` all vanish — while `data-*` is whitelisted WHOLESALE, so a suffix
 * typo SURVIVES sanitization and arrives as `dataset.toolip`, which
 * TooltipManager never reads. Neither logs anything. Control: misspelling the
 * attribute reds every tooltip leg here with the rows still `present: true` and
 * a clean console, which is exactly the failure no amount of reading the markup
 * would catch.
 *
 * Dice are pinned via CONFIG.Dice.randomUniform (INVERTED: ceil((1-u)*faces),
 * so u near 1 pins every die to 1 and u near 0 to its maximum) and restored
 * in-page; every settings write rides withSettings so the restore runs in
 * Node's finally — the min-age-99 leak lesson stands whatever the key is called.
 *
 * Generated HP is read off `_source`, never derived: a generated character can
 * land ENCUMBERED because overflow is owed, and derived HP is 0 for one.
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
    const KEYS = ["pc-ability-dice", "pc-hp-formula", "pc-gold-dice"];
    const out = { tipRows: ["STR", "DEX", "WIL", "hp", "gold", "age"] };
    // CRAWLER COMBAT MODE OVERRIDES THE HP FORMULA (2026-10-03): every leg
    // below assumes the setting is READ, so the hack is pinned OFF here rather
    // than inherited from whatever the world was left at — it also silences
    // the bad-formula warning the fallback legs count. Its own leg is below.
    await game.settings.set(NS, "crawler-combat-mode", false);
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const gen = await import("/systems/air-bladder/module/character-generator.js");

    out.tiers = CONFIG.Cairn?.pcDiceTiers ?? null;
    out.hpConfigDefault = CONFIG.Cairn?.pcHpFormula ?? null;
    out.registered = {};
    out.defaults = {};
    out.configFlags = {};
    for (const k of KEYS) {
      const cfg = game.settings.settings.get(`${NS}.${k}`);
      out.registered[k] = !!cfg;
      out.defaults[k] = cfg?.default ?? null;
      out.configFlags[k] = cfg?.config ?? null;
    }
    // The four dead config keys this change removed. Leaving them would be dead
    // config that reads as live; every reader is a helper call now.
    out.deadKeys = {
      barebonesAbility: CONFIG.Cairn?.barebonesGenerator?.ability ?? null,
      barebonesHp: CONFIG.Cairn?.barebonesGenerator?.hitProtection ?? null,
      barebonesGold: CONFIG.Cairn?.barebonesGenerator?.gold ?? null,
      gen2eGold: CONFIG.Cairn?.characterGenerator2e?.gold ?? null,
    };
    // ...and the NPC pair that must SURVIVE, which is what makes "PCs only"
    // structural rather than asserted.
    out.npcKeys = {
      ability: CONFIG.Cairn?.npcGenerator?.ability ?? null,
      hitProtection: CONFIG.Cairn?.npcGenerator?.hitProtection ?? null,
    };

    // --- 1. not on the flat list, present in the Generation submenu ---------
    const SC = foundry.applications?.settings?.SettingsConfig ?? globalThis.SettingsConfig;
    const cfgApp = new SC();
    await cfgApp.render(true);
    for (let i = 0; i < 25 && !(cfgApp.element instanceof HTMLElement); i++) await sleep(200);
    await sleep(400);
    out.onFlatList = KEYS.filter((k) => !!cfgApp.element?.querySelector(`[name="${NS}.${k}"]`));
    await cfgApp.close();

    const mod = await import("/systems/air-bladder/module/settings.js");
    const genGroup = mod.SETTING_GROUPS.find((g) => g.id === "generation");
    out.groupKeys = genGroup?.keys ?? [];
    out.inSettingKeys = KEYS.filter((k) => mod.SETTING_KEYS.includes(k));
    out.inInternalKeys = KEYS.filter((k) => mod.INTERNAL_SETTING_KEYS.includes(k));

    const menu = game.settings.menus.get(`${NS}.generation`);
    const app = menu ? new menu.type() : null;
    if (app) { await app.render(true); await sleep(600); }
    const root = app?.element;
    const control = (k) => root?.querySelector(`[name="${NS}.${k}"]`) ?? null;
    out.controls = {};
    for (const k of KEYS) {
      const el = control(k);
      out.controls[k] = el
        ? { tag: el.tagName.toLowerCase(), type: el.getAttribute("type") }
        : null;
    }
    // 1b. the options, in declared order, each label naming the map's formula.
    const optionsOf = (k) => {
      const el = control(k);
      if (!el || el.tagName.toLowerCase() !== "select") return null;
      return [...el.options].map((o) => [o.value, (o.textContent ?? "").trim()]);
    };
    out.abilityOptions = optionsOf("pc-ability-dice");
    out.goldOptions = optionsOf("pc-gold-dice");
    if (app) await app.close();

    // Against a build without the settings, every write below throws and one
    // absence would red every leg for the wrong reason. Bail and let each
    // Node-side leg fail on its own evidence.
    if (KEYS.some((k) => !out.registered[k])) return out;

    // --- 2. pinned extremes, per tier --------------------------------------
    const pinned = async (u, fn) => {
      const orig = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => u;
      try { return await fn(); } finally { CONFIG.Dice.randomUniform = orig; }
    };
    const abilityAt = (u) => pinned(u, async () =>
      (await gen.rollAbilities(gen.effectivePcAbilityFormula())).STR.total);
    const goldAt = (u) => pinned(u, async () =>
      (await gen.rollGold(gen.effectivePcGoldFormula())).total);
    const hpAt = (u) => pinned(u, async () => (await gen.rollPcHitProtection()).total);

    out.tierRolls = {};
    for (const tier of Object.keys(out.tiers ?? {})) {
      await game.settings.set(NS, "pc-ability-dice", tier);
      await game.settings.set(NS, "pc-gold-dice", tier);
      out.tierRolls[tier] = {
        formula: gen.effectivePcAbilityFormula(),
        abLow: await abilityAt(0.9999),
        abHigh: await abilityAt(0.0001),
        goldLow: await goldAt(0.9999),
        goldHigh: await goldAt(0.0001),
      };
    }

    await game.settings.set(NS, "pc-hp-formula", out.defaults["pc-hp-formula"]);
    out.hpDefLow = await hpAt(0.9999);
    out.hpDefHigh = await hpAt(0.0001);
    await game.settings.set(NS, "pc-hp-formula", "4");
    out.hpFlat = [await hpAt(0.9999), await hpAt(0.0001)];
    // Under the hack the setting is IGNORED and every player character is
    // made with 6, through the ONE helper all three HP sites read — so the
    // flat 4 above becomes 6 at both pins, and the formula the checklist's
    // tooltip would name is "6". Read live: `crawlerCombat()` consults the
    // setting per call, and the reload the master asks for is form-only.
    await game.settings.set(NS, "crawler-combat-mode", true);
    out.hpCrawler = [await hpAt(0.9999), await hpAt(0.0001)];
    out.hpCrawlerFormula = gen.effectivePcHpFormula().formula;
    await game.settings.set(NS, "crawler-combat-mode", false);
    out.hpAfterCrawler = [await hpAt(0.9999), await hpAt(0.0001)];

    // --- 4. the three are independent, measured on ONE generated character --
    await game.settings.set(NS, "pc-ability-dice", "adventurer");
    await game.settings.set(NS, "pc-gold-dice", "standard");
    await game.settings.set(NS, "pc-hp-formula", "4");
    const bg = (await game.packs.get(`${NS}.backgrounds-2e`).getDocuments())[0];
    const actor = await pinned(0.9999, async () =>
      gen.createActorWithCharacter(await gen.generate2eCharacter(bg)));
    out.actorId = actor.id;
    // _source, never derived: an encumbered character derives HP 0.
    out.genHp = actor._source.system.hp.value;
    out.genAbilities = ["STR", "DEX", "WIL"].map((a) => actor._source.system.abilities[a].value);
    out.genBondGold = (actor.system.bonds ?? []).reduce((n, b) => n + (b.gold ?? 0), 0);
    out.genQuestionGold = (actor.system.questions ?? []).reduce((n, q) => n + (q.gold ?? 0), 0);
    out.genGold = actor._source.system.gold;
    // Generated actors land with Randomization OFF (2026-08-02); the checklist
    // is what that flag hides, so switch it on before driving the dialog.
    await actor.update({ "system.generationEnabled": true });

    // --- 3. the checklist: its tooltips, then its rolls ---------------------
    // The REAL dialog, opened through the sheet's own builder. Tooltips are read
    // off the RENDERED markup and never off the source — see the header for the
    // two silent ways a misspelled attribute name produces no tooltip while the
    // markup goes on looking right.
    const readDialog = async () => {
      // A closing DialogV2 lingers for a tick; wait the old one out first.
      for (let i = 0; i < 20 && document.querySelector("dialog.dialog .reroll-dialog"); i++) await sleep(100);
      const pending = actor.sheet._promptRerollParts();
      let dlg = null;
      for (let i = 0; i < 40 && !dlg; i++) {
        dlg = document.querySelector("dialog.dialog .reroll-dialog");
        if (!dlg) await sleep(150);
      }
      const seen = {};
      const labels = {};
      if (dlg) {
        for (const part of ["STR", "DEX", "WIL", "hp", "gold", "age", "traits", "portrait", "background"]) {
          const rowEl = dlg.querySelector(`.reroll-row[data-part="${part}"]`);
          const spanEl = rowEl?.querySelector(".reroll-label");
          // Assert the control EXISTS before trusting what it produced — a
          // querySelector miss plus `?.` makes a tooltip assertion vacuous.
          seen[part] = rowEl
            ? { present: true, row: rowEl.dataset.tooltip ?? null, span: spanEl?.dataset.tooltip ?? null }
            : { present: false, row: null, span: null };
          labels[part] = spanEl?.textContent?.trim() ?? null;
        }
      }
      document.querySelector('dialog.dialog button[data-action="cancel"]')?.click();
      await pending.catch(() => null);
      await sleep(250);
      return { opened: !!dlg, seen, labels };
    };
    out.dialogSix = await readDialog();

    // 3b. Show traits OFF: no age row, the other five still labelled.
    await game.settings.set(NS, "show-traits", false);
    out.dialogFive = await readDialog();
    await game.settings.set(NS, "show-traits", true);

    // The rolls, one checked box at a time — the three bypassing sites.
    await game.settings.set(NS, "pc-ability-dice", "crawler");
    await pinned(0.9999, () => actor.sheet._applyRerollParts({ STR: true }));
    out.rerollStrLow = actor._source.system.abilities.STR.value;
    await pinned(0.0001, () => actor.sheet._applyRerollParts({ STR: true }));
    out.rerollStrHigh = actor._source.system.abilities.STR.value;

    await game.settings.set(NS, "pc-hp-formula", "4");
    await pinned(0.0001, () => actor.sheet._applyRerollParts({ hp: true }));
    out.rerollHp = actor._source.system.hp.value;

    // --- 6. bond gold rides ON TOP of the base roll ------------------------
    // Planted rather than hoped for: a generated character's bonds may grant 0,
    // which would make this leg pass while proving nothing.
    const bonds = foundry.utils.deepClone(actor._source.system.bonds ?? []);
    if (bonds.length) bonds[0].gold = 5;
    await actor.update({ "system.bonds": bonds, "system.questions": [] });
    out.plantedBondGold = (actor.system.bonds ?? []).reduce((n, b) => n + (b.gold ?? 0), 0);
    await game.settings.set(NS, "pc-gold-dice", "crawler");
    await pinned(0.9999, () => actor.sheet._applyRerollParts({ gold: true }));
    out.rerollGold = actor._source.system.gold;

    // --- 5. NPCs are untouched, and crawler is the only discriminating tier -
    await game.settings.set(NS, "pc-ability-dice", "crawler");
    await game.settings.set(NS, "pc-hp-formula", "4");
    const npc = await pinned(0.9999, () => gen.generateNpc());
    out.npcAbilityLow = npc.abilities.STR;
    out.npcHpLow = npc.hp;
    out.pcAbilityLowSameMoment = await abilityAt(0.9999);
    out.pcHpSameMoment = await hpAt(0.9999);

    // --- 4b. HP's three fallbacks, the age-formula contract -----------------
    const warns = [];
    const origWarn = ui.notifications.warn;
    ui.notifications.warn = function (m, ...rest) { warns.push(String(m)); return origWarn.call(this, m, ...rest); };
    try {
      // CONTROL FIRST: Roll.validate still ACCEPTS an @-reference, stubbing
      // every ref to "1" before evaluating (dice/roll.mjs:772-790) while real
      // evaluation resolves them {missing: "0"}. If this ever goes false, core
      // fixed the stub and the @ guard may be retirable.
      out.atStillValidates = Roll.validate("@bonus + 3");
      out.hpFallback = out.hpConfigDefault;

      await game.settings.set(NS, "pc-hp-formula", "not dice");
      out.hpInvalid = await hpAt(0.9999);
      out.warnsAfterInvalid = warns.length;
      out.invalidWarnText = warns[warns.length - 1] ?? "";
      out.tipInvalid = (await readDialog()).seen.hp;

      await game.settings.set(NS, "pc-hp-formula", "");
      out.hpBlank = await hpAt(0.9999);
      out.warnsAfterBlank = warns.length;
      out.tipBlank = (await readDialog()).seen.hp;

      await game.settings.set(NS, "pc-hp-formula", "@bonus + 3");
      out.hpAtRef = await hpAt(0.9999);
      out.warnsAfterAt = warns.length;
      out.atWarnText = warns[warns.length - 1] ?? "";
      out.tipAt = (await readDialog()).seen.hp;
    } finally {
      ui.notifications.warn = origWarn;
    }

    // --- 7. an unknown stored tier falls back to standard ------------------
    // Shadowed rather than written, because `choices` would refuse the value on
    // the way in — and a world upgraded from the day `hero` was the middle key
    // is exactly the shape this guards. THE SHADOW FORWARDS EVERY ARGUMENT and
    // hands a {document: true} request straight to core: #setWorld asks for the
    // Setting DOCUMENT it will update by id, and a plain value handed back there
    // makes core CREATE A DUPLICATE instead (the 131-duplicate scar).
    const origGet = game.settings.get;
    game.settings.get = function (ns, key, ...rest) {
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, ns, key, ...rest);
      if (ns === NS && key === "pc-ability-dice") return "hero";
      return origGet.call(this, ns, key, ...rest);
    };
    try {
      out.unknownTierFormula = gen.effectivePcAbilityFormula();
    } finally {
      game.settings.get = origGet;
    }

    return out;
  }));

  // ---- 1. registration and rendering ------------------------------------
  const missing = ["pc-ability-dice", "pc-hp-formula", "pc-gold-dice"].filter((k) => !r.registered[k]);
  missing.length === 0
    ? ok("all three PC dice settings are registered")
    : fail(`not registered: ${missing.join(", ")} — every leg below is vacuous`);
  Object.values(r.configFlags).every((v) => v === false)
    ? ok("...all three config:false, so the submenu owns the row")
    : fail(`config flags: ${JSON.stringify(r.configFlags)} — every one must be false`);
  r.onFlatList?.length === 0
    ? ok("...and none is a loose row on the main settings window")
    : fail(`these render on the flat list: ${JSON.stringify(r.onFlatList)}`);
  r.inSettingKeys?.length === 3 && r.inInternalKeys?.length === 0
    ? ok("...listed in SETTING_KEYS, and none marked internal")
    : fail(`SETTING_KEYS has ${JSON.stringify(r.inSettingKeys)}, INTERNAL has ${JSON.stringify(r.inInternalKeys)}`);
  JSON.stringify((r.groupKeys ?? []).slice(-4))
    === JSON.stringify(["pc-ability-dice", "pc-hp-formula", "pc-gold-dice", "age-formula"])
    ? ok("the four dice settings close the Character Generation group, in roll order")
    : fail(`generation group tail is ${JSON.stringify((r.groupKeys ?? []).slice(-4))}`);

  r.controls?.["pc-ability-dice"]?.tag === "select" && r.controls?.["pc-gold-dice"]?.tag === "select"
    ? ok("abilities and gold render as selects in the Generation submenu")
    : fail(`controls: ${JSON.stringify(r.controls)}`);
  r.controls?.["pc-hp-formula"]?.tag === "input" && r.controls?.["pc-hp-formula"]?.type === "text"
    ? ok('...and Hit Protection as a TEXT box (a `choices` key on it would make this a select)')
    : fail(`the HP control is ${JSON.stringify(r.controls?.["pc-hp-formula"])}, want an input[type=text]`);

  const declaredTiers = Object.keys(r.tiers ?? {});
  JSON.stringify(r.abilityOptions?.map(([v]) => v)) === JSON.stringify(declaredTiers)
    && JSON.stringify(r.goldOptions?.map(([v]) => v)) === JSON.stringify(declaredTiers)
    ? ok(`both dropdowns offer the same three tiers in declared order: ${declaredTiers.join(" → ")}`)
    : fail(`ability options ${JSON.stringify(r.abilityOptions)}, gold options ${JSON.stringify(r.goldOptions)}, declared ${JSON.stringify(declaredTiers)}`);

  // 1b. the review #18 gate on the dice literal in each label
  const labelDrift = (r.abilityOptions ?? []).filter(([v, label]) => !label.includes(r.tiers[v]));
  labelDrift.length === 0
    ? ok(`each option label names the formula Cairn.pcDiceTiers holds (${(r.abilityOptions ?? []).map(([, l]) => l).join(" · ")})`)
    : fail(`option labels do not name their own dice: ${JSON.stringify(labelDrift)} — the map says ${JSON.stringify(r.tiers)}`);

  // ---- the four dead keys are gone, the NPC pair survives ----------------
  Object.values(r.deadKeys ?? {}).every((v) => v === null)
    ? ok("the four superseded config keys are gone (no dead config reading as live)")
    : fail(`still present: ${JSON.stringify(r.deadKeys)}`);
  r.npcKeys?.ability === "3d6" && r.npcKeys?.hitProtection === "1d6"
    ? ok("...while npcGenerator.ability/hitProtection survive — 'PCs only' is structural")
    : fail(`npcGenerator pair is ${JSON.stringify(r.npcKeys)}, expected 3d6 / 1d6`);

  // ---- 2. pinned extremes per tier --------------------------------------
  const WANT = { standard: [3, 18], adventurer: [3, 18], crawler: [8, 18] };
  for (const [tier, [lo, hi]] of Object.entries(WANT)) {
    const t = r.tierRolls?.[tier];
    t && t.abLow === lo && t.abHigh === hi && t.goldLow === lo && t.goldHigh === hi
      ? ok(`${tier} (${t.formula}) rolls ${lo}..${hi} for both abilities and gold`)
      : fail(`${tier}: ${JSON.stringify(t)}, expected abilities and gold both ${lo}..${hi}`);
  }
  r.hpDefLow === 1 && r.hpDefHigh === 6
    ? ok(`Hit Protection defaults to ${r.hpConfigDefault} — 1..6`)
    : fail(`HP default rolls ${r.hpDefLow}..${r.hpDefHigh}, expected 1..6`);
  JSON.stringify(r.hpFlat) === JSON.stringify([4, 4])
    ? ok("...and a flat 4 is 4 at both pinned extremes")
    : fail(`a flat HP of "4" rolled ${JSON.stringify(r.hpFlat)}`);
  JSON.stringify(r.hpCrawler) === JSON.stringify([6, 6]) && r.hpCrawlerFormula === "6"
    ? ok(`under Crawler Combat Mode the formula is IGNORED: a flat 4 deals 6 at both pins, and the effective formula reads "${r.hpCrawlerFormula}"`)
    : fail(`crawler HP: ${JSON.stringify(r.hpCrawler)} with formula ${JSON.stringify(r.hpCrawlerFormula)} — want [6, 6] and "6"`);
  JSON.stringify(r.hpAfterCrawler) === JSON.stringify([4, 4])
    ? ok("...and the setting is read again the moment the hack is off (4, 4)")
    : fail(`after the hack: ${JSON.stringify(r.hpAfterCrawler)}, want [4, 4]`);

  // ---- 4. the three settings are independent ----------------------------
  const abOk = (r.genAbilities ?? []).length === 3 && r.genAbilities.every((v) => v >= 3 && v <= 18);
  abOk && r.genHp === 4 && r.genGold === 3 + r.genBondGold + r.genQuestionGold
    ? ok(`one character carries all three: abilities ${JSON.stringify(r.genAbilities)} (adventurer), HP ${r.genHp} (flat), gold ${r.genGold} (standard 3 + ${r.genBondGold + r.genQuestionGold} granted)`)
    : fail(`independence: abilities ${JSON.stringify(r.genAbilities)}, HP ${r.genHp} (want 4), gold ${r.genGold} (want ${3 + r.genBondGold + r.genQuestionGold})`);

  // ---- 3. the checklist's tooltips --------------------------------------
  r.dialogSix?.opened
    ? ok("the Roll Character checklist opens")
    : fail("the Roll Character checklist never rendered — every tooltip leg below is vacuous");
  const six = r.tipRows ?? [];
  const absent = six.filter((p) => !r.dialogSix?.seen?.[p]?.present);
  absent.length === 0
    ? ok(`all six dice rows are offered: ${six.join(", ")}`)
    : fail(`rows missing from the dialog: ${absent.join(", ")}`);
  const noTip = six.filter((p) => {
    const s = r.dialogSix?.seen?.[p];
    return !(typeof s?.row === "string" && s.row.length && typeof s?.span === "string" && s.span.length);
  });
  noTip.length === 0
    ? ok("...each carries data-tooltip on BOTH the row and its label span (TooltipManager does no closest() walk)")
    : fail(`rows without a tooltip on both elements: ${JSON.stringify(noTip.map((p) => [p, r.dialogSix?.seen?.[p]]))}`);

  // Named formula, and NOT the default it replaced — the age probe's two-sided
  // shape. The settings live at this point are the INDEPENDENCE set from the
  // leg above: ADVENTURER abilities, STANDARD gold, a flat HP of 4. That makes
  // this pair of legs a stronger claim than one tier alone would — the ability
  // rows say 4d6kh3 while the gold row says 3d6, on the same open dialog, so
  // the two settings are proven independent in the TOOLTIPS and not only in
  // the rolls. (`4d6kh3` carries no "3d6" substring, so the negative clause
  // still bites.)
  const tipSays = (part) => r.dialogSix?.seen?.[part]?.span ?? "";
  ["STR", "DEX", "WIL"].every((a) => tipSays(a).includes("4d6kh3") && !tipSays(a).includes("3d6"))
    ? ok(`the three ability rows name the adventurer formula ("${tipSays("STR")}") and not the default`)
    : fail(`ability tooltips: ${JSON.stringify(["STR", "DEX", "WIL"].map(tipSays))} — want "4d6kh3" and not "3d6"`);
  tipSays("gold").includes("3d6")
    ? ok(`...while the gold row names ITS tier ("${tipSays("gold")}") on the same dialog — independent in the tooltips too`)
    : fail(`gold tooltip: ${JSON.stringify(tipSays("gold"))}, want it to name 3d6`);
  tipSays("hp") === "Rolls 4" || tipSays("hp").includes("4")
    ? ok(`the HP row names the flat value ("${tipSays("hp")}")`)
    : fail(`HP tooltip: ${JSON.stringify(tipSays("hp"))}, want it to name 4`);
  tipSays("age").includes("2d20")
    ? ok(`the AGE row names its formula too ("${tipSays("age")}") — the row that had no tooltip at all before`)
    : fail(`age tooltip: ${JSON.stringify(tipSays("age"))}, want it to name the age formula`);
  ["traits", "portrait", "background"].every((p) => !r.dialogSix?.seen?.[p]?.span)
    ? ok("...and a row that rolls a TABLE carries none — the rule is 'a dice formula or nothing'")
    : fail(`table-rolling rows wear a dice tooltip: ${JSON.stringify(["traits", "portrait", "background"].map((p) => [p, r.dialogSix?.seen?.[p]?.span]))}`);

  // The VISIBLE labels are untouched; the formula rides the tooltip alone.
  const wantLabels = { STR: "STR (Strength)", DEX: "DEX (Dexterity)", WIL: "WIL (Willpower)" };
  Object.entries(wantLabels).every(([k, v]) => r.dialogSix?.labels?.[k] === v)
    ? ok("the visible row labels are unchanged — no formula crept into the label text")
    : fail(`row labels: ${JSON.stringify(r.dialogSix?.labels)}, expected ${JSON.stringify(wantLabels)}`);

  // 3b. traits off: five rows, no age
  r.dialogFive?.opened && r.dialogFive?.seen?.age?.present === false
    ? ok("with Show traits OFF the age row is gone (six is not a constant)")
    : fail(`traits-off dialog: opened=${r.dialogFive?.opened}, age row present=${r.dialogFive?.seen?.age?.present}`);
  ["STR", "DEX", "WIL", "hp", "gold"].every((p) => !!r.dialogFive?.seen?.[p]?.span)
    ? ok("...and the other five still carry theirs")
    : fail(`traits-off tooltips: ${JSON.stringify(["STR", "DEX", "WIL", "hp", "gold"].map((p) => [p, r.dialogFive?.seen?.[p]?.span]))}`);

  // ---- 3. the checklist's ROLLS: the three bypassing sites ---------------
  r.rerollStrLow === 8 && r.rerollStrHigh === 18
    ? ok("ticking only STR rolls the Warden's tier (crawler: 8..18), not the old 3d6 literal")
    : fail(`checklist STR re-roll pinned ${r.rerollStrLow}/${r.rerollStrHigh}, expected 8/18`);
  r.rerollHp === 4
    ? ok("ticking only Hit Protection honours the flat formula (4 at the MAXIMUM pin)")
    : fail(`checklist HP re-roll gave ${r.rerollHp}, expected 4`);

  // ---- 6. bond gold on top ----------------------------------------------
  r.rerollGold === 8 + r.plantedBondGold
    ? ok(`bond gold still rides on top of a Crawler roll: 8 + ${r.plantedBondGold} = ${r.rerollGold}`)
    : fail(`gold re-roll gave ${r.rerollGold}, expected 8 + ${r.plantedBondGold}`);

  // ---- 5. NPCs unaffected -----------------------------------------------
  r.npcAbilityLow === 3 && r.pcAbilityLowSameMoment === 8
    ? ok("a generated NPC still rolls 3d6 (floor 3) while a PC rolls crawler (floor 8) at the same moment")
    : fail(`NPC ability floor ${r.npcAbilityLow} (want 3), PC floor ${r.pcAbilityLowSameMoment} (want 8)`);
  r.npcHpLow === 1 && r.pcHpSameMoment === 4
    ? ok("...and its Hit Protection is 1d6 while the PC setting says a flat 4")
    : fail(`NPC HP ${r.npcHpLow} (want 1), PC HP ${r.pcHpSameMoment} (want 4)`);

  // ---- 4b. HP's fallbacks, the age-formula contract ----------------------
  r.atStillValidates
    ? ok('CONTROL: Roll.validate still accepts "@bonus + 3" — the trap the @ guard refuses is live')
    : fail("Roll.validate now refuses @-references — core changed under us; the HP @ guard may be retirable");
  r.hpInvalid === 1 && r.warnsAfterInvalid >= 1
    ? ok("an unparseable HP formula falls back to 1d6 AND warns")
    : fail(`invalid HP formula: rolled ${r.hpInvalid} (expected 1), warns ${r.warnsAfterInvalid}`);
  (r.invalidWarnText ?? "").includes("not dice")
    ? ok("...and the warning names the rejected text")
    : fail(`HP warning does not name the formula: ${JSON.stringify(r.invalidWarnText)}`);
  r.hpBlank === 1 && r.warnsAfterBlank === r.warnsAfterInvalid
    ? ok("a blank HP formula falls back SILENTLY — blank is a reset, not a mistake")
    : fail(`blank HP: rolled ${r.hpBlank} (expected 1), warns went ${r.warnsAfterInvalid} -> ${r.warnsAfterBlank}`);
  r.hpAtRef === 1 && r.warnsAfterAt === r.warnsAfterBlank + 1
    ? ok("an @-reference HP formula is refused before Roll.validate, falls back AND warns")
    : fail(`@ HP formula: rolled ${r.hpAtRef} (expected 1; a 1 from "@bonus + 3" zeroed would be 3), warns ${r.warnsAfterBlank} -> ${r.warnsAfterAt}`);
  (r.atWarnText ?? "").includes("@bonus")
    ? ok("...naming the rejected text too")
    : fail(`@ warning does not name the formula: ${JSON.stringify(r.atWarnText)}`);
  [["unparseable", r.tipInvalid], ["blank", r.tipBlank], ["@-reference", r.tipAt]]
    .every(([, t]) => typeof t?.span === "string" && t.span.includes(r.hpFallback))
    ? ok(`and in all three cases the HP row's tooltip names the FALLBACK ("${r.hpFallback}") — what a click will actually roll`)
    : fail(`fallback tooltips: invalid=${JSON.stringify(r.tipInvalid?.span)}, blank=${JSON.stringify(r.tipBlank?.span)}, @=${JSON.stringify(r.tipAt?.span)}, each should name "${r.hpFallback}"`);

  // ---- 7. an unknown stored tier ----------------------------------------
  r.unknownTierFormula === r.tiers?.standard
    ? ok(`a stored tier the map does not hold ("hero", the retired key) falls back to standard (${r.unknownTierFormula})`)
    : fail(`an unknown tier gave ${JSON.stringify(r.unknownTierFormula)}, expected ${JSON.stringify(r.tiers?.standard)}`);

  if (r.actorId) {
    await page.evaluate(async (id) => { try { await game.actors.get(id)?.delete(); } catch { /* gone */ } }, r.actorId);
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nPC DICE PROBE FAILED\n" : "\npc dice probe passed\n");
process.exit(failed ? 1 : 0);

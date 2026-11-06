#!/usr/bin/env node
/**
 * The Warden's `use-bonds` switch (2026-11-06, user ask: "a character creation
 * option to disable Bonds — it should remove them from the sheet and remove
 * their items from assignment during character generation").
 *
 * Off means DEAL NONE, SHOW NONE — never HOLD NONE. Every surface asks
 * `bondsEnabled` (character-generator.js), and this probe walks each one with
 * the switch off AND on, the on half being the control that proves the off
 * half is the switch and not a fixture that never had a bond:
 *
 *   1. registration: Boolean, world, default true, config:false, listed in
 *      SETTING_KEYS and in the Character Generation group
 *   2. generation: off deals no bond, no `bond:` item and no bond coins; on,
 *      the same background deals two bonds, their item and their coins
 *   3. the sheet: off renders no bond block, die, picker or "Add a bond", and
 *      keeps the Notes divider for the questions; on renders both bonds
 *   4. the Roll Character checklist: off has no Bond(s) row and no bonds
 *      note; on has both
 *   5. the four bond handlers refuse while off (a sheet already open when
 *      the switch flips); the on control removes one at the end
 *   6. the printed page: off drops the Bonds section; on prints it
 *   7. a checklist gold re-roll: off adds no hidden bond coins; on adds them
 *   8. STORED BONDS SURVIVE: off, rerollAllBonds and a background swap to a
 *      one-bond background leave both bonds and their items; on, the same
 *      swap clamps to one
 *   9. the background's "Roll a second time on the Bonds table" sentence
 *      (user ask 2026-11-06, Fieldwarden's last sentence): off, the sheet
 *      header, the printed page and the picker's description omit it and keep
 *      the rest; on, all three show it. English only, by ruling ("dont
 *      worry about the spanish")
 *
 * The switch is read-SHADOWED in-page (never a world write; restored in
 * finally), forced to false or true, so a dev world with it either way runs
 * the same legs. Fixtures are ZZ-stamped and created here; the character is
 * selected by the id its create returned, and a catch-side sweep removes any
 * litter a killed run left.
 *
 * Bond coins are 1000 a row so that no PC gold tier (3d6 at most 18) can
 * reach them by luck: the coin legs are deterministic, not odds.
 *
 * Usage: npm run dev:bonds-off
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const check = (cond, m, detail = "") => (cond ? ok(m) : fail(detail ? `${m} — ${detail}` : m));

const LITTER = {
  items: ["ZZ Bonds Off Two", "ZZ Bonds Off One"],
  tables: ["ZZ Bonds Off Table"],
};

const dog = watchdog(240000, "bonds-off");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);

const sweep = () => page.evaluate(async (names) => {
  const gone = [];
  for (const d of game.items.filter((d) => names.items.includes(d.name))) { await d.delete(); gone.push(`Item ${d.name}`); }
  for (const d of game.tables.filter((d) => names.tables.includes(d.name))) { await d.delete(); gone.push(`Table ${d.name}`); }
  for (const d of game.actors.filter((d) => d.name?.startsWith?.("ZZ Bonds Off"))) { await d.delete(); gone.push(`Actor ${d.name}`); }
  return gone;
}, LITTER).catch(() => []);

try {
  await joinAsGM(page);
  await dismissChrome(page);
  const swept = await sweep();
  if (swept.length) console.log(`  note  swept ${swept.length} leftover(s): ${swept.join(", ")}`);

  const r = await page.evaluate(async () => {
    const NS = "air-bladder";
    const gen = await import(`/systems/${game.system.id}/module/character-generator.js`);
    const settingsMod = await import(`/systems/${game.system.id}/module/settings.js`);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitFor = async (test, ms = 10000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const v = test(); if (v) return v; await wait(100); }
      return false;
    };
    const out = {};

    // ---- 1. registration ------------------------------------------------
    const cfg = game.settings.settings.get(`${NS}.use-bonds`);
    out.reg = cfg ? {
      type: cfg.type === Boolean, scope: cfg.scope, def: cfg.default, config: cfg.config,
      inKeys: settingsMod.SETTING_KEYS.includes("use-bonds"),
      inGeneration: !!settingsMod.SETTING_GROUPS.find((g) => g.id === "generation")?.keys.includes("use-bonds"),
    } : null;

    const origGet = game.settings.get;
    const force = (value) => {
      game.settings.get = function (ns, key, ...rest) {
        // A DOCUMENT request is never shadowed (review #27): core's #setWorld asks
        // get(ns, key, {document: true}) for the Setting document it updates by id,
        // and any value handed back makes it CREATE a duplicate. check:probes gates this.
        if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, ns, key, ...rest);
        if (ns === NS && key === "use-bonds") return value;
        return origGet.call(this, ns, key, ...rest);
      };
    };
    const bondItems = (a) => a.items.filter((i) => String(i.getFlag(NS, "grantSource") ?? "").startsWith("bond:"));

    let actor = null;
    try {
      const table = await getDocumentClass("RollTable").create({
        name: "ZZ Bonds Off Table", formula: "1d1",
        results: [{
          type: "text", description: "ZZ bonds-off bond", range: [1, 1],
          flags: { [NS]: { gold: 1000, items: [{ name: "Ornate Compass" }] } },
        }],
      });
      const mkBg = (name, secondBond, description = "") => getDocumentClass("Item").create({
        name, type: "background",
        system: { source: "2e", archetype: "Fighter", names: [], startingGear: [], tables: [], secondBond, bondsTable: table.name, description },
      });
      const two = await mkBg("ZZ Bonds Off Two", true,
        "<p>ZZ guardians keep the field. Roll a second time on the Bonds table.</p>");
      const one = await mkBg("ZZ Bonds Off One", false);

      // ---- 2. generation ------------------------------------------------
      force(false);
      const cdOff = await gen.generate2eCharacter(two);
      force(true);
      const cdOn = await gen.generate2eCharacter(two);
      const bondTagged = (cd) => (cd?.items ?? []).filter((i) => String(i.flags?.[NS]?.grantSource ?? "").startsWith("bond:")).length;
      out.gen = {
        offBonds: (cdOff?.bonds ?? []).length, offItems: bondTagged(cdOff), offGold: cdOff?.gold,
        onBonds: (cdOn?.bonds ?? []).length, onItems: bondTagged(cdOn), onGold: cdOn?.gold,
      };

      // The character every later leg reads: made WITH bonds, two of them.
      cdOn.name = "ZZ Bonds Off PC";
      actor = await gen.createActorWithCharacter(cdOn);
      out.actorId = actor?.id ?? null;
      if (!actor) return out;
      await actor.update({ "system.generationEnabled": true });
      const sheet = actor.sheet;
      const rootOf = () => (sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0]);
      const rerender = async () => { await sheet.render(true); await wait(500); };

      // ---- 3. the sheet -------------------------------------------------
      const sheetState = () => {
        const root = rootOf();
        return {
          blocks: root?.querySelectorAll(".bond-block").length ?? null,
          dice: root?.querySelectorAll('[data-action="rerollBond"], [data-action="pickBond"]').length ?? null,
          add: !!root?.querySelector('[data-action="addBond"]'),
          divider: !!root?.querySelector(".notes-divider"),
          desc: root?.querySelector(".background-description")?.textContent ?? null,
        };
      };
      force(false); await rerender(); out.sheetOff = sheetState();
      force(true); await rerender(); out.sheetOn = sheetState();

      // ---- 4. the Roll Character checklist ------------------------------
      const dialogState = async () => {
        rootOf()?.closest(".application")?.querySelector('.window-header button[data-action="rollActor"]')?.click();
        const dlg = await waitFor(() => document.querySelector(".reroll-dialog"));
        if (!dlg) return null;
        const state = {
          row: !!dlg.querySelector('.reroll-row[data-part="bonds"]'),
          note: !!dlg.querySelector(".reroll-note-bonds"),
          str: !!dlg.querySelector('.reroll-row[data-part="STR"]'),
        };
        dlg.closest(".application")?.querySelector('button[data-action="cancel"]')?.click();
        await waitFor(() => !document.querySelector(".reroll-dialog"), 5000);
        await wait(200);
        return state;
      };
      force(false); await rerender(); out.dialogOff = await dialogState();
      force(true); await rerender(); out.dialogOn = await dialogState();

      // ---- 5. the handlers refuse while off ------------------------------
      const call = (name, bondId) => sheet.options.actions[name].call(
        sheet, { preventDefault() {} }, { dataset: { bondId } });
      const ids = () => (actor.system.bonds ?? []).map((b) => b.id);
      force(false);
      const before = ids();
      await call("removeBond", before[1]);
      await call("rerollBond", before[0]);
      await call("addBond", null);
      await wait(300);
      out.handlersOff = { before, after: ids(), items: bondItems(actor).length };

      // ---- 6. the printed page -----------------------------------------
      const printedHeadings = async () => {
        const origOpen = window.open;
        let popup = null;
        let printed = false;
        window.open = (...a) => {
          popup = origOpen.apply(window, a);
          Object.defineProperty(popup, "print", { configurable: true, value: () => { printed = true; } });
          return popup;
        };
        try {
          rootOf()?.querySelector('[data-action="printSheet"]')?.click();
          await waitFor(() => printed, 9000);
        } finally { window.open = origOpen; }
        const h2s = [...(popup?.document?.querySelectorAll("h2") ?? [])].map((h) => h.textContent.trim());
        const body = popup?.document?.body?.innerText ?? "";
        popup?.close();
        return { printed, h2s, body };
      };
      const bondsHeading = game.i18n.localize("CAIRN.PrintBonds");
      force(false); await rerender();
      const pOff = await printedHeadings();
      force(true); await rerender();
      const pOn = await printedHeadings();
      out.print = {
        offPrinted: pOff.printed, onPrinted: pOn.printed,
        off: pOff.h2s.includes(bondsHeading), on: pOn.h2s.includes(bondsHeading),
        offDesc: { rest: pOff.body.includes("ZZ guardians keep the field"), instr: /second time on the Bonds table/i.test(pOff.body) },
        onDesc: { rest: pOn.body.includes("ZZ guardians keep the field"), instr: /second time on the Bonds table/i.test(pOn.body) },
      };

      // ---- 9. the second-bond sentence: the picker's text --------------------
      force(false); const pickOff = gen.backgroundDescriptionText?.(two) ?? null;   // ?.: the red leg ran before the export existed
      force(true); const pickOn = gen.backgroundDescriptionText?.(two) ?? null;
      out.descPick = { off: pickOff, on: pickOn };

      // ---- 7. a checklist gold re-roll ---------------------------------
      force(false); await sheet._applyRerollParts({ gold: true }); const goldOff = actor.system.gold;
      force(true); await sheet._applyRerollParts({ gold: true }); const goldOn = actor.system.gold;
      out.gold = { off: goldOff, on: goldOn, bonds: (actor.system.bonds ?? []).length };

      // ---- 8. stored bonds survive ---------------------------------------
      force(false);
      const idsBefore = ids();
      const itemsBefore = bondItems(actor).length;
      await gen.rerollAllBonds(actor);
      const afterReroll = ids();
      await gen.changeBackground(actor, one);
      out.keep = {
        idsBefore, itemsBefore, afterReroll, afterSwap: ids(), itemsAfterSwap: bondItems(actor).length,
      };
      // The ON control: the same swap clamps (back to the two-bond background
      // first, which keeps both — the clamp only trims — then onto one).
      force(true);
      await gen.changeBackground(actor, two);
      const onBeforeClamp = ids().length;
      await gen.changeBackground(actor, one);
      out.keep.onBeforeClamp = onBeforeClamp;
      out.keep.onAfterClamp = ids().length;

      // ---- 5, the on control: a handler that is let through does write ----
      const lone = ids();
      await call("removeBond", lone[0]);
      await wait(300);
      out.handlersOn = { before: lone.length, after: ids().length };

      await sheet.close();
    } finally {
      game.settings.get = origGet;
    }
    return out;
  });

  // ---- report -------------------------------------------------------------
  const reg = r.reg;
  check(!!reg, "use-bonds is registered");
  if (reg) {
    check(reg.type && reg.scope === "world" && reg.def === true && reg.config === false,
      "a world Boolean, default on, behind a submenu", JSON.stringify(reg));
    check(reg.inKeys && reg.inGeneration, "listed in SETTING_KEYS and the Character Generation group", JSON.stringify(reg));
  }

  const g = r.gen ?? {};
  check(g.onBonds === 2 && g.onItems >= 1 && g.onGold >= 2000,
    "control: with bonds ON the background deals two bonds, their item and their coins", JSON.stringify(g));
  check(g.offBonds === 0, "with bonds OFF generation deals no bond", JSON.stringify(g));
  check(g.offItems === 0, "with bonds OFF generation deals no bond item", JSON.stringify(g));
  check(typeof g.offGold === "number" && g.offGold < 1000, "with bonds OFF generation adds no bond coins", JSON.stringify(g));

  if (!r.actorId) throw new Error("the fixture character was not created");

  const so = r.sheetOff ?? {}, sn = r.sheetOn ?? {};
  check(sn.blocks === 2, "control: with bonds ON the sheet shows both bonds", JSON.stringify(sn));
  check(so.blocks === 0 && so.dice === 0 && !so.add, "with bonds OFF the sheet shows no bond, die, picker or Add a bond", JSON.stringify(so));
  check(so.divider, "with bonds OFF the Notes divider stays for the questions", JSON.stringify(so));

  const dOff = r.dialogOff, dOn = r.dialogOn;
  if (!dOff || !dOn) fail(`the Roll Character checklist did not open (off ${JSON.stringify(dOff)}, on ${JSON.stringify(dOn)})`);
  else {
    check(dOn.row && dOn.note, "control: with bonds ON the checklist offers Bond(s) and the bonds note", JSON.stringify(dOn));
    check(!dOff.row && !dOff.note && dOff.str, "with bonds OFF the checklist has no Bond(s) row and no bonds note", JSON.stringify(dOff));
  }

  const h = r.handlersOff ?? {};
  check(JSON.stringify(h.before) === JSON.stringify(h.after) && h.before?.length === 2,
    "with bonds OFF remove, re-roll and add refuse", JSON.stringify(h));

  const p = r.print ?? {};
  if (!p.offPrinted || !p.onPrinted) fail(`the print page did not build (${JSON.stringify(p)})`);
  else {
    check(p.on, "control: with bonds ON the printed page has its Bonds section");
    check(!p.off, "with bonds OFF the printed page drops its Bonds section");
  }

  check(so.desc?.includes("ZZ guardians keep the field") && !/second time on the Bonds table/i.test(so.desc ?? ""),
    "with bonds OFF the sheet's background description omits the second-bond sentence and keeps the rest", JSON.stringify(so.desc));
  check(/second time on the Bonds table/i.test(sn.desc ?? ""), "control: with bonds ON the sheet's description has it", JSON.stringify(sn.desc));
  if (p.offPrinted && p.onPrinted) {
    check(p.offDesc?.rest && !p.offDesc?.instr, "with bonds OFF the printed description omits the second-bond sentence", JSON.stringify(p.offDesc));
    check(p.onDesc?.instr, "control: with bonds ON the printed description has it", JSON.stringify(p.onDesc));
  }
  const dp = r.descPick ?? {};
  check(/ZZ guardians keep the field/.test(dp.off ?? "") && !/second time/i.test(dp.off ?? ""),
    "with bonds OFF the picker's description omits the second-bond sentence", JSON.stringify(dp.off));
  check(/second time/i.test(dp.on ?? ""), "control: with bonds ON the picker's description has it", JSON.stringify(dp.on));
  const gd = r.gold ?? {};
  check(gd.bonds === 2 && gd.on >= 2000, "control: with bonds ON a gold re-roll adds the bonds' coins", JSON.stringify(gd));
  check(typeof gd.off === "number" && gd.off < 1000, "with bonds OFF a gold re-roll adds no hidden bond coins", JSON.stringify(gd));

  const k = r.keep ?? {};
  check(JSON.stringify(k.afterReroll) === JSON.stringify(k.idsBefore), "with bonds OFF rerollAllBonds leaves the stored bonds", JSON.stringify(k));
  check(k.afterSwap?.length === 2 && k.itemsAfterSwap === k.itemsBefore && k.itemsBefore >= 1,
    "with bonds OFF a swap to a one-bond background keeps both bonds and their items", JSON.stringify(k));
  check(k.onBeforeClamp === 2 && k.onAfterClamp === 1, "control: with bonds ON the same swap clamps to one", JSON.stringify(k));

  const hn = r.handlersOn ?? {};
  check(hn.before === 1 && hn.after === 0, "control: with bonds ON the remove handler writes", JSON.stringify(hn));

  if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  const left = await sweep();
  console.log(`  note  cleaned up ${left.length} probe document(s)`);
  clearTimeout(dog);
  console.log(`\n${failed ? "BONDS-OFF PROBE FAILED" : "Bonds-off probe passed."}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}

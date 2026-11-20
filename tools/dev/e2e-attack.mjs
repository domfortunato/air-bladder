#!/usr/bin/env node
/**
 * The Attack window (2026-11-19, user ask, after Base Knavery's).
 *
 *   npm run dev:attack
 *
 * The character sheet's Attack (the rail's red burst and page 1's button under
 * Die of Fate) is for EVERY attack, not the improvised one alone. One window
 * (askAttack, module/utils.js) asks Cairn's three questions: who is attacked,
 * with what, and whether the roll is standard, impaired or enhanced. What this
 * holds:
 *
 *   1. WHO: the viewed scene's tokens, the attacker's own left out; the user's
 *      one current target comes preselected;
 *   2. WITH WHAT: the EQUIPPED items that roll damage, then the improvised
 *      attack; an unequipped weapon is not offered;
 *   3. HOW, for a weapon: Standard (its own die) / Impaired / Enhanced, and no
 *      Roll Damage;
 *   4. Impaired on the weapon posts the damage card with a d4, the weapon named,
 *      and the chosen target on its Apply button;
 *   5. the improvised choice keeps the 2026-10-02 ruling: its two fields show,
 *      the three quality buttons give way to Roll Damage alone, and "No one in
 *      particular" posts a card with the typed die, unarmed, and no target;
 *   6. the window remembers the attack last made with it;
 *   7. PANIC (use-panic on, the character panicked) offers only Impaired for a
 *      weapon, says why, and Impaired rolls the d4;
 *   8. a REAL Enter (Playwright's keyboard, not requestSubmit(), whose submit
 *      event names no button) in the improvised description rolls the typed
 *      die: implicit submission presses the first submit button on offer.
 *   9. (2026-11-20, user ask) a Cancel button closes the window and posts
 *      nothing; it stands last in the footer, so Enter never reaches it.
 *  10. (2026-11-20, user ask) on a CHARACTER, an inventory row's damage roller
 *      opens this window with that weapon chosen (a second equipped weapon,
 *      so neither the first nor the remembered one), and the Improvised
 *      Attack row's roller opens it on Improvised; Cancel posts nothing. An
 *      npc's row roller keeps the quick quality dialog.
 *  11. (2026-11-20, user ask) the "Hands full" hack: a character holding a
 *      shield and a light is offered only those (when they roll damage) and
 *      Improvised, with the note; any other weapon's roller is drawn disabled
 *      with the same sentence, and a forced click on it opens and posts
 *      nothing; a freed hand brings everything back; the hack off changes
 *      nothing.
 *  12. (2026-11-20, user ask) the "Shields are d4 weapons" hack: a held shield
 *      is offered (and its row rolls) as 1d4; "Add the shield (d4)" shows
 *      under the list for a one-handed weapon, greyed with its reason for a
 *      Bulky weapon and for a bow, hidden for the shield and Improvised;
 *      ticked, Standard names both dice and rolls a keep-highest pool (RNG
 *      pinned for that roll: the d4 kept); Impaired ignores it; the hack off
 *      shows no shield entry, box or roller.
 *  13. (review #35) with a content overlay planted in-page, the window lists
 *      a weapon by its display name and the damage card names it so, as the
 *      row's roller did through 0.1.26.
 *
 * Both hacks, and the two combat options, are shadowed IN-PAGE for legs 11-12
 * (never written).
 *
 * use-panic is shadowed IN-PAGE for leg 7 only (never written), and both it and
 * the panicked flag are put back in its finally. Red-first: before the window the burst
 * opens the Improvised Attack dialog, and every leg fails.
 */
import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const FIXTURE = "attack-window";
const browser = await chromium.launch();
watchdog(300000, "attack probe", async () => { try { await browser.close(); } catch { /* gone */ } });
const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(gm);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

let r = null;
const cleanup = async () => {
  try {
    await gm.evaluate(async (fixture) => {
      for (const d of foundry.applications.instances.values()) {
        if (d.element?.classList?.contains("cairn-attack-dialog")) await d.close();
      }
      // RELEASE THE TARGET FIRST, before anything is deleted. Core's
      // TokenLayer#animateTargets redraws the arrows on every game.user.targets
      // token each frame (tokens.mjs), and a scene deleted under a targeted token
      // leaves a frame drawing on a half-destroyed one: "Cannot read properties
      // of undefined (reading 'clear')" at Token._drawTargetArrows (fleet
      // 20261119T225116Z, every check green, the console error failing the run).
      // The targeting in setup waits for a drawn token for the same reason.
      for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false });
      await new Promise((res) => setTimeout(res, 200));
      const actors = game.actors.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture);
      const ids = new Set(actors.map((a) => a.id));
      for (const m of game.messages.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture || ids.has(x.speaker?.actor))) {
        await m.delete();
      }
      for (const a of actors) {
        await a.sheet?.close();
        await a.delete();
      }
      for (const sc of game.scenes.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) await sc.delete();
    }, FIXTURE);
  } catch (e) {
    console.error(`  note  cleanup: ${e.message}`);
  }
};

try {
  await joinAsGM(gm);
  await dismissChrome(gm);
  await cleanup();

  r = await gm.evaluate(async (fixture) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!(await fn()) && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = {};
    const Actor = getDocumentClass("Actor");

    const pc = await Actor.create({ name: "ZZ Attack PC", type: "character", flags }, { abNoStatusCard: true });
    const foe = await Actor.create({ name: "ZZ Attack Foe", type: "npc", system: { role: "monster" }, flags }, { abNoStatusCard: true });
    await pc.createEmbeddedDocuments("Item", [
      { name: "ZZ Blade", type: "item", system: { equipped: true, damageFormula: "1d6" } },
      { name: "ZZ Club", type: "item", system: { equipped: false, damageFormula: "1d8" } },
    ]);
    const blade = pc.items.find((i) => i.name === "ZZ Blade");

    const scene = await Scene.create({ name: "ZZ Attack Scene", width: 1000, height: 1000, flags });
    await scene.view();
    await until(() => canvas.ready && canvas.scene?.id === scene.id);
    // One create each: a batch comes back in completion order, not as sent.
    const [pcTok] = await scene.createEmbeddedDocuments("Token", [await pc.getTokenDocument({ x: 100, y: 100 })]);
    const [foeTok] = await scene.createEmbeddedDocuments("Token", [await foe.getTokenDocument({ x: 300, y: 100 })]);
    // Target only a DRAWN token. The placeable joins the layer before its async
    // _draw reaches `this.targetArrows ||= ...` (token.mjs), and core's
    // TokenLayer#animateTargets draws arrows on every game.user.targets token each
    // frame, so a token targeted in that gap throws "Cannot read properties of
    // undefined (reading 'clear')" at Token._drawTargetArrows (fleet
    // 20261119T232257Z: every check green, the console error failing the run,
    // after the cleanup's release-first fix). PlaceableObject#drawn is private;
    // targetArrows is the first thing _draw sets that this needs.
    await until(() => canvas.tokens.get(foeTok.id)?.targetArrows);
    await sleep(100);
    canvas.tokens.get(foeTok.id).setTarget(true, { releaseOthers: true });
    out.ids = { pcTok: pcTok.id, foeTok: foeTok.id, blade: blade.id };

    const sheet = pc.sheet;
    await sheet.render(true);
    await until(() => sheet.element?.querySelector?.('[data-action="attack"]'));
    await sleep(300);

    const openWindow = async () => {
      const stale = new Set(document.querySelectorAll(".cairn-attack-dialog"));
      sheet.element.querySelector('.cairn-vital-buttons [data-action="attack"]')?.click();
      let dlg = null;
      await until(() => (dlg = [...document.querySelectorAll(".cairn-attack-dialog")].find((d) => !stale.has(d))));
      await sleep(200);
      return dlg;
    };
    const shown = (dlg) => [...dlg.querySelectorAll("footer button")].filter((b) => !b.hidden && b.getBoundingClientRect().height > 0)
      .map((b) => b.dataset.action);
    const newMessage = async (before) => {
      let m = null;
      await until(() => (m = game.messages.contents.find((x) => !before.has(x.id) && x.speaker?.actor === pc.id)));
      if (m) await m.setFlag("air-bladder", "probeFixture", fixture);
      return m;
    };
    const card = (m) => {
      const div = document.createElement("div");
      div.innerHTML = m?.flavor ?? "";
      return {
        weapon: div.querySelector(".dmg-label")?.dataset.weapon ?? null,
        unarmed: div.querySelector(".dmg-label")?.dataset.unarmed === "1",
        targets: div.querySelector(".apply-dmg")?.dataset.targets ?? null,
        faces: m?.rolls?.[0]?.dice?.[0]?.faces ?? null,
      };
    };

    /* ---- 1-3. the window, for a weapon -------------------------------- */
    let dlg = await openWindow();
    out.window = dlg ? {
      options: [...dlg.querySelectorAll('select[name="target"] option')].map((o) => o.value),
      selected: dlg.querySelector('select[name="target"]')?.value ?? null,
      weapons: [...dlg.querySelectorAll('input[name="weapon"]')].map((i) => i.value),
      checked: dlg.querySelector('input[name="weapon"]:checked')?.value ?? null,
      buttons: shown(dlg),
      standardLabel: dlg.querySelector('footer button[data-action="standard"]')?.textContent.trim() ?? null,
      improvisedHidden: dlg.querySelector(".cairn-attack-improvised")?.hidden ?? null,
    } : null;

    /* ---- 4. Impaired on the weapon ------------------------------------ */
    if (dlg) {
      const before = new Set(game.messages.map((m) => m.id));
      dlg.querySelector('footer button[data-action="impaired"]').click();
      out.weaponCard = card(await newMessage(before));
    }

    /* ---- 5. the improvised attack, no target --------------------------- */
    dlg = await openWindow();
    if (dlg) {
      const impro = dlg.querySelector('input[name="weapon"][value="improvised"]');
      impro.checked = true;
      impro.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(150);
      out.improvised = { buttons: shown(dlg), fields: !dlg.querySelector(".cairn-attack-improvised")?.hidden };
      // Every field label sits on ONE line, and the two improvised inputs
      // share a left edge (user ask 2026-11-20: "What are you attacking
      // with?" broke onto two lines in the label column).
      const lineCount = (n) => {
        const cs = getComputedStyle(n);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        return Math.round(n.getBoundingClientRect().height / lh);
      };
      const inputs = [...dlg.querySelectorAll('.cairn-attack-improvised input[type="text"]')];
      out.improvisedLabels = {
        lines: Object.fromEntries([...dlg.querySelectorAll(".cairn-attack .form-group > label")]
          .map((n) => [n.textContent.trim(), lineCount(n)])),
        lefts: inputs.map((n) => Math.round(n.getBoundingClientRect().left)),
      };
      dlg.querySelector('input[name="description"]').value = "a rock";
      dlg.querySelector('input[name="formula"]').value = "1d6";
      dlg.querySelector('select[name="target"]').value = "";
      const before = new Set(game.messages.map((m) => m.id));
      dlg.querySelector('footer button[data-action="roll"]').click();
      out.improvisedCard = card(await newMessage(before));
    }

    /* ---- 6. it remembers the last attack ------------------------------- */
    dlg = await openWindow();
    out.remembered = dlg?.querySelector('input[name="weapon"]:checked')?.value ?? null;
    if (dlg) {
      dlg.querySelector('header [data-action="close"]')?.click();
      await until(() => !dlg.isConnected);
    }

    /* ---- 13. the content overlay names the weapon (review #35) --------- */
    // In-page overlay, put back in the finally: the window lists the
    // weapon by its display name, and the card names it so, as the row's
    // roller did through 0.1.26 (its data-label was the localized name).
    {
      const i18n = await import("/systems/air-bladder/module/i18n-content.js");
      try {
        i18n._setOverlay({ "item.name": { "ZZ Blade": "ZZ Hoja" } });
        dlg = await openWindow();
        if (dlg) {
          const radio = dlg.querySelector(`input[name="weapon"][value="${blade.id}"]`);
          out.overlay = { listed: radio?.parentElement?.querySelector("strong")?.textContent.trim() ?? null };
          radio.checked = true;
          radio.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(100);
          const before = new Set(game.messages.map((m) => m.id));
          dlg.querySelector('footer button[data-action="impaired"]').click();
          out.overlay.card = card(await newMessage(before)).weapon;
        }
      } finally {
        i18n._setOverlay(null);
      }
    }

    /* ---- 9. Cancel closes it and posts nothing -------------------------- */
    dlg = await openWindow();
    if (dlg) {
      const before = new Set(game.messages.map((m) => m.id));
      const cancel = dlg.querySelector('footer button[data-action="cancel"]');
      out.cancel = { present: !!cancel, last: !!cancel && [...dlg.querySelectorAll("footer button")].at(-1) === cancel };
      cancel?.click();
      await until(() => !dlg.isConnected, 3000);
      await sleep(500);
      out.cancel.closed = !dlg.isConnected;
      out.cancel.posted = game.messages.contents.filter((m) => !before.has(m.id) && m.speaker?.actor === pc.id).length;
      if (!out.cancel.closed) {
        dlg.querySelector('header [data-action="close"]')?.click();
        await until(() => !dlg.isConnected);
      }
    }

    /* ---- 7. panic: only Impaired, and Enter rolls it -------------------- */
    const origGet = game.settings.get;
    game.settings.get = function (ns, key, ...rest) {
      // A DOCUMENT request is never shadowed (review #27).
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, ns, key, ...rest);
      if (ns === "air-bladder" && key === "use-panic") return true;
      return origGet.call(this, ns, key, ...rest);
    };
    try {
      await pc.update({ "system.panicked": true }, { abNoStatusCard: true });
      await sleep(300);
      dlg = await openWindow();
      if (dlg) {
        // The weapon again (the window remembers the improvised attack from leg 5).
        const pick = dlg.querySelector(`input[name="weapon"][value="${out.ids.blade}"]`);
        pick.checked = true;
        pick.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(150);
        out.panic = { buttons: shown(dlg), note: !!dlg.querySelector(".cairn-attack-panic:not([hidden])"),
          checked: dlg.querySelector('input[name="weapon"]:checked')?.value ?? null };
        const before = new Set(game.messages.map((m) => m.id));
        dlg.querySelector('footer button[data-action="impaired"]').click();
        out.panicCard = card(await newMessage(before));
      }
    } finally {
      game.settings.get = origGet;
      await pc.update({ "system.panicked": false }, { abNoStatusCard: true });
    }

    /* ---- 10. the inventory's rollers open the window, preselected ------ */
    {
      // A SECOND equipped weapon, so the preselection cannot be the window's
      // own default (the first) or what it remembers (the Blade, rolled in
      // leg 7). Found by id difference.
      const had = new Set(pc.items.map((i) => i.id));
      await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Spear", type: "item", system: { equipped: true, damageFormula: "1d10" } }]);
      const spear = pc.items.find((i) => !had.has(i.id));
      await sheet.changeTab("items", "primary");
      await until(() => sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${spear.id}"] [data-action="rollDamage"]`));
      await sleep(300);
      // Whatever the click opens (the Attack window, or before this change
      // the quality / improvised dialog): returned, then closed by Cancel.
      const viaRow = async (selector) => {
        const stale = new Set(foundry.applications.instances.values());
        const before = new Set(game.messages.map((m) => m.id));
        sheet.element.querySelector(selector)?.click();
        let app = null;
        await until(() => (app = [...foundry.applications.instances.values()].find((a) => !stale.has(a) && a.element?.isConnected
          && a.element.querySelector("footer button"))), 4000);
        await sleep(200);
        const el = app?.element ?? null;
        const res = {
          attack: !!el?.classList.contains("cairn-attack-dialog"),
          checked: el?.querySelector('input[name="weapon"]:checked')?.value ?? null,
        };
        const cancel = el?.querySelector('footer button[data-action="cancel"]');
        if (cancel) cancel.click(); else await app?.close();
        await until(() => !el?.isConnected, 3000);
        await sleep(500);
        res.posted = game.messages.contents.filter((m) => !before.has(m.id) && m.speaker?.actor === pc.id).length;
        return res;
      };
      out.rowRoller = {
        spear: spear?.id ?? null,
        remembered: out.ids.blade,
        weapon: await viaRow(`.cairn-items-list-row[data-item-id="${spear?.id}"] [data-action="rollDamage"]`),
        improvised: await viaRow('.tab[data-tab="items"] [data-action="improvisedAttack"]'),
      };
      await spear?.delete();
      await sheet.changeTab("character", "primary");
      await sleep(300);

      // An npc's row keeps its quick damage roll: the quality dialog, not
      // the Attack window.
      const npc = await Actor.create({ name: "ZZ Attack NPC", type: "npc", system: { role: "monster" }, flags }, { abNoStatusCard: true });
      await npc.createEmbeddedDocuments("Item", [{ name: "ZZ Claw", type: "item", system: { equipped: true, damageFormula: "1d6" } }]);
      const claw = npc.items.contents[0];
      await npc.sheet.render(true);
      await until(() => npc.sheet.element?.querySelector?.(`.cairn-items-list-row[data-item-id="${claw?.id}"] [data-action="rollDamage"]`));
      await sleep(300);
      {
        const stale = new Set(foundry.applications.instances.values());
        npc.sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${claw?.id}"] [data-action="rollDamage"]`)?.click();
        let app = null;
        await until(() => (app = [...foundry.applications.instances.values()].find((a) => !stale.has(a) && a.element?.isConnected
          && a.element.querySelector("footer button"))), 4000);
        await sleep(200);
        out.npcRoller = {
          opened: !!app,
          quality: !!app?.element?.classList.contains("cairn-damage-quality"),
          attack: !!app?.element?.classList.contains("cairn-attack-dialog"),
        };
        await app?.close();
        await sleep(300);
      }
      await npc.sheet.close();
    }

    /* ---- 11-12. the two shield hacks, settings shadowed in-page --------- */
    {
      const hack = { "hands-full": false, "shield-weapon": false, "exploding-damage-dice": false, "maneuver-on-max-damage": false };
      const origGet = game.settings.get;
      game.settings.get = function (ns, key, ...rest) {
        if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, ns, key, ...rest);
        if (ns === "air-bladder" && key in hack) return hack[key];
        return origGet.call(this, ns, key, ...rest);
      };
      const L = (k) => game.i18n.localize(k);
      const fresh = async (a) => {
        const s = a.sheet;
        const was = s.element?.querySelector?.(".tab[data-tab='items']");
        await s.render(true);
        await until(() => { const n = s.element?.querySelector?.(".tab[data-tab='items']"); return !!n && n !== was; });
        await sleep(300);
        return s;
      };
      const openOn = async (s) => {
        const stale = new Set(document.querySelectorAll(".cairn-attack-dialog"));
        s.element.querySelector('.cairn-vital-buttons [data-action="attack"]')?.click();
        let d = null;
        await until(() => (d = [...document.querySelectorAll(".cairn-attack-dialog")].find((x) => !stale.has(x))));
        await sleep(200);
        return d;
      };
      const closeD = async (d) => {
        if (!d) return;
        d.querySelector('footer button[data-action="cancel"]')?.click();
        await until(() => !d.isConnected, 3000);
        await sleep(200);
      };
      const listed = (d) => [...(d?.querySelectorAll('input[name="weapon"]') ?? [])].map((i) => i.value).sort();
      const choose = async (d, id) => {
        const radio = d?.querySelector(`input[name="weapon"][value="${id}"]`);
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
        await sleep(150);
      };
      const box = (d) => d?.querySelector('input[name="addShield"]');
      const boxState = (d) => {
        const b = box(d);
        const wrap = b?.closest(".cairn-attack-addshield");
        return {
          present: !!b,
          shown: !!wrap && !wrap.hidden && wrap.getBoundingClientRect().height > 0,
          disabled: b?.disabled ?? null,
          tip: wrap?.dataset.tooltip ?? null,
          label: wrap?.textContent.trim() ?? null,
          // Where it sits (user ruling 2026-11-20): after the last weapon,
          // directly before the Improvised Attack row, never after it.
          beforeImprovised: !!wrap?.nextElementSibling?.matches(".cairn-attack-weapon.improvised")
            && !wrap?.previousElementSibling?.matches(".cairn-attack-weapon.improvised"),
        };
      };
      try {
        /* 11. Hands full */
        const hpc = await Actor.create({
          name: "ZZ Attack Hands", type: "character", flags,
          items: [
            { name: "ZZ Buckler", type: "armor", system: { armor: 1, shield: true, equipped: true } },
            { name: "Torch", type: "item", system: { equipped: true, damageFormula: "1d4" } },
            { name: "ZZ Sword", type: "weapon", system: { equipped: true, damageFormula: "1d8" } },
          ],
        }, { abNoStatusCard: true });
        const hi = (n) => hpc.items.find((i) => i.name === n);
        const H = out.hands = { want: L("CAIRN.HandsFullNote"), ids: { torch: hi("Torch").id, sword: hi("ZZ Sword").id, buckler: hi("ZZ Buckler").id } };
        hack["hands-full"] = true;
        let hs = await fresh(hpc);
        let d = await openOn(hs);
        const note = (x) => { const n = x?.querySelector(".cairn-attack-hands"); return n && !n.hidden ? n.textContent.trim() : null; };
        H.full = { listed: listed(d), note: note(d) };
        await closeD(d);
        await hs.changeTab("items", "primary");
        await sleep(300);
        const swordRoller = () => hs.element.querySelector(`.cairn-items-list-row[data-item-id="${H.ids.sword}"] .roll-control`);
        {
          const c = swordRoller();
          H.roller = { present: !!c, action: c?.dataset.action ?? null, disabled: c?.getAttribute("aria-disabled") ?? null, tip: c?.dataset.tooltip ?? null };
          // A forced click: the roller given back its action and a die, as a
          // stale sheet would carry it. Nothing may open or post.
          if (c) {
            c.dataset.action = "rollDamage";
            c.dataset.roll = "1d8";
            c.dataset.label = "ZZ Sword";
            const stale = new Set(foundry.applications.instances.values());
            const before = new Set(game.messages.map((m) => m.id));
            c.click();
            await sleep(1200);
            const opened = [...foundry.applications.instances.values()].filter((a) => !stale.has(a) && a.element?.isConnected && a.element.querySelector("footer button"));
            H.forced = { opened: opened.length, posted: game.messages.contents.filter((m) => !before.has(m.id) && m.speaker?.actor === hpc.id).length };
            for (const a of opened) await a.close();
          }
        }
        // A hand freed: everything back.
        await hi("Torch").update({ "system.equipped": false });
        hs = await fresh(hpc);
        await hs.changeTab("character", "primary");
        d = await openOn(hs);
        H.freed = { listed: listed(d), note: note(d) };
        await closeD(d);
        await hs.changeTab("items", "primary");
        await sleep(300);
        H.freedRoller = swordRoller()?.dataset.action ?? null;
        // The hack off, both held: unchanged.
        await hi("Torch").update({ "system.equipped": true });
        hack["hands-full"] = false;
        hs = await fresh(hpc);
        await hs.changeTab("character", "primary");
        d = await openOn(hs);
        H.off = { listed: listed(d), note: note(d) };
        await closeD(d);
        await hs.changeTab("items", "primary");
        await sleep(300);
        H.offRoller = swordRoller()?.dataset.action ?? null;
        await hs.close();

        /* 12. Shields are d4 weapons */
        const spc = await Actor.create({
          name: "ZZ Attack Shield", type: "character", flags,
          items: [
            { name: "ZZ Kite", type: "armor", sort: 100, system: { armor: 1, shield: true, equipped: true } },
            { name: "ZZ Mace", type: "weapon", sort: 200, system: { equipped: true, damageFormula: "1d6", bulky: false } },
            { name: "ZZ Halberd", type: "weapon", sort: 300, system: { equipped: true, damageFormula: "1d10", bulky: true } },
            { name: "ZZ Bamboo Bow", type: "weapon", sort: 400, system: { equipped: true, damageFormula: "1d6", bulky: false } },
          ],
        }, { abNoStatusCard: true });
        const si = (n) => spc.items.find((i) => i.name === n);
        const ids = { kite: si("ZZ Kite").id, mace: si("ZZ Mace").id, halberd: si("ZZ Halberd").id, bow: si("ZZ Bamboo Bow").id };
        const S = out.shieldWeapon = { ids, wantBox: L("CAIRN.AttackDialog.AddShield"), wantTip: L("CAIRN.AttackDialog.AddShieldTwoHanded") };
        hack["shield-weapon"] = true;
        let ss = await fresh(spc);
        await ss.changeTab("items", "primary");
        await sleep(300);
        S.kiteRoller = ss.element.querySelector(`.cairn-items-list-row[data-item-id="${ids.kite}"] [data-action="rollDamage"]`)?.dataset.roll ?? null;
        await ss.changeTab("character", "primary");
        d = await openOn(ss);
        const kiteRadio = d?.querySelector(`input[name="weapon"][value="${ids.kite}"]`);
        S.list = { listed: listed(d), kiteFormula: kiteRadio?.dataset.formula ?? null,
          kiteDie: kiteRadio?.closest("label")?.querySelector(".cairn-attack-die")?.textContent.trim() ?? null };
        await choose(d, ids.mace);
        S.mace = boxState(d);
        await choose(d, ids.halberd);
        S.halberd = boxState(d);
        await choose(d, ids.bow);
        S.bow = boxState(d);
        await choose(d, ids.kite);
        S.kite = boxState(d);
        await choose(d, "improvised");
        S.improvised = boxState(d);
        // The mace with the shield added: Standard names both dice and rolls a
        // keep-highest pool. RNG pinned for THIS roll: the d6 a 1, the d4 a 4.
        await choose(d, ids.mace);
        if (box(d)) { box(d).checked = true; box(d).dispatchEvent(new Event("change", { bubbles: true })); }
        await sleep(150);
        S.standardLabel = d?.querySelector('footer button[data-action="standard"]')?.textContent.trim() ?? null;
        {
          const origRU = CONFIG.Dice.randomUniform;
          const seq = [0.95, 0.0001];
          let k = 0;
          CONFIG.Dice.randomUniform = () => seq[Math.min(k++, seq.length - 1)];
          try {
            const before = new Set(game.messages.map((m) => m.id));
            d?.querySelector('footer button[data-action="standard"]')?.click();
            let m = null;
            await until(() => (m = game.messages.contents.find((x) => !before.has(x.id) && x.speaker?.actor === spc.id)));
            if (m) await m.setFlag("air-bladder", "probeFixture", fixture);
            const roll = m?.rolls?.[0];
            const t = roll?.terms?.[0];
            S.pool = { formula: roll?.formula ?? null, total: roll?.total ?? null, term: t?.constructor?.name ?? null,
              results: (t?.results ?? []).map((x) => ({ r: x.result, active: x.active })) };
          } finally {
            CONFIG.Dice.randomUniform = origRU;
          }
        }
        // Impaired with the box ticked: the box changes nothing.
        d = await openOn(ss);
        await choose(d, ids.mace);
        if (box(d)) { box(d).checked = true; box(d).dispatchEvent(new Event("change", { bubbles: true })); }
        await sleep(150);
        {
          const before = new Set(game.messages.map((m) => m.id));
          d?.querySelector('footer button[data-action="impaired"]')?.click();
          let m = null;
          await until(() => (m = game.messages.contents.find((x) => !before.has(x.id) && x.speaker?.actor === spc.id)));
          if (m) await m.setFlag("air-bladder", "probeFixture", fixture);
          S.impaired = { formula: m?.rolls?.[0]?.formula ?? null, dice: m?.rolls?.[0]?.dice?.length ?? null, faces: m?.rolls?.[0]?.dice?.[0]?.faces ?? null };
        }
        // The hack off: no shield entry, no box, no shield roller.
        hack["shield-weapon"] = false;
        ss = await fresh(spc);
        await ss.changeTab("character", "primary");
        d = await openOn(ss);
        await choose(d, ids.mace);
        S.off = { listed: listed(d), box: !!box(d) };
        await closeD(d);
        await ss.changeTab("items", "primary");
        await sleep(300);
        S.off.kiteRoller = !!ss.element.querySelector(`.cairn-items-list-row[data-item-id="${ids.kite}"] [data-action="rollDamage"]`);
        await ss.close();
      } catch (e) {
        out.hacksError = e.stack ?? e.message;
      } finally {
        game.settings.get = origGet;
        for (const dd of foundry.applications.instances.values()) {
          if (dd.element?.classList?.contains("cairn-attack-dialog")) await dd.close();
        }
      }
    }

    /* ---- 8 (set up): the improvised attack, ready for a real Enter ------ */
    dlg = await openWindow();
    if (dlg) {
      const impro = dlg.querySelector('input[name="weapon"][value="improvised"]');
      impro.checked = true;
      impro.dispatchEvent(new Event("change", { bubbles: true }));
      dlg.querySelector('input[name="formula"]').value = "1d8";
      dlg.querySelector('input[name="description"]').value = "a stool";
      window.__abAttackBefore = game.messages.map((m) => m.id);
      out.enterReady = true;
    }
    out.pcId = pc.id;
    return out;
  }, FIXTURE);

  /* ---- 8. a real Enter in the improvised description ------------------- */
  if (r?.enterReady) {
    await gm.locator('.cairn-attack-dialog input[name="description"]').press("Enter");
    r.enterCard = await gm.evaluate(async ({ pcId, fixture }) => {
      const before = new Set(window.__abAttackBefore ?? []);
      let m = null;
      for (let i = 0; i < 50 && !(m = game.messages.contents.find((x) => !before.has(x.id) && x.speaker?.actor === pcId)); i++) {
        await new Promise((res) => setTimeout(res, 100));
      }
      if (m) await m.setFlag("air-bladder", "probeFixture", fixture);
      const div = document.createElement("div");
      div.innerHTML = m?.flavor ?? "";
      await game.actors.get(pcId)?.sheet?.close();
      return { faces: m?.rolls?.[0]?.dice?.[0]?.faces ?? null, weapon: div.querySelector(".dmg-label")?.dataset.weapon ?? null };
    }, { pcId: r.pcId, fixture: FIXTURE });
  }
} catch (e) {
  fail(`the run threw: ${e.message}`);
} finally {
  await cleanup();
}

/* ---------------------------------- assertions ----------------------------- */
if (!r) fail("the in-page run returned nothing");
else if (!r.window) fail("page 1's Attack button opened no Attack window");
else {
  const w = r.window;
  // 1
  w.options.includes(r.ids.foeTok) && !w.options.includes(r.ids.pcTok) && w.options.includes("") && w.selected === r.ids.foeTok
    ? ok("Who: the scene's tokens, the attacker's own left out, the current target preselected, and \"no one\" on offer")
    : fail(`target list: ${JSON.stringify({ options: w.options, selected: w.selected, ids: r.ids })}`);
  // 2
  JSON.stringify(w.weapons) === JSON.stringify([r.ids.blade, "improvised"]) && w.checked === r.ids.blade
    ? ok("With what: the equipped weapon, then the improvised attack; the unequipped one is not offered")
    : fail(`weapons: ${JSON.stringify(w.weapons)} checked ${w.checked}`);
  // 3
  JSON.stringify(w.buttons) === JSON.stringify(["standard", "impaired", "enhanced", "cancel"]) && /1d6/.test(w.standardLabel ?? "") && w.improvisedHidden
    ? ok(`How, for a weapon: Standard / Impaired / Enhanced, Standard naming its die ("${w.standardLabel}")`)
    : fail(`weapon buttons: ${JSON.stringify(w.buttons)}, standard "${w.standardLabel}", improvised fields hidden ${w.improvisedHidden}`);
  // 4
  const c = r.weaponCard ?? {};
  c.faces === 4 && c.weapon === "ZZ Blade" && c.targets === r.ids.foeTok
    ? ok("Impaired posts the damage card: a d4, the weapon named, the chosen target on Apply")
    : fail(`weapon card: ${JSON.stringify(c)}`);
  // 5
  const i = r.improvised ?? {}, ic = r.improvisedCard ?? {};
  JSON.stringify(i.buttons) === JSON.stringify(["roll", "cancel"]) && i.fields
    ? ok("the improvised choice shows its two fields and Roll Damage alone (the 10-02 ruling)")
    : fail(`improvised window: ${JSON.stringify(i)}`);
  const il = r.improvisedLabels ?? {};
  const labelLines = Object.values(il.lines ?? {});
  labelLines.length >= 3 && labelLines.every((n) => n === 1) && il.lefts?.length === 2 && il.lefts[0] === il.lefts[1]
    ? ok(`every label in the window sits on one line (${Object.keys(il.lines).join(" / ")}), the improvised inputs aligned`)
    : fail(`Attack window labels: ${JSON.stringify(il)}`);
  ic.faces === 6 && ic.weapon === "a rock" && ic.unarmed && ic.targets === null
    ? ok("...and posts the typed die, unarmed, with no target when \"no one\" is chosen")
    : fail(`improvised card: ${JSON.stringify(ic)}`);
  // 6
  r.remembered === "improvised"
    ? ok("the window remembers the attack last made with it")
    : fail(`remembered ${JSON.stringify(r.remembered)}`);
  // 7
  const p = r.panic ?? {}, pc = r.panicCard ?? {};
  JSON.stringify(p.buttons) === JSON.stringify(["impaired", "cancel"]) && p.note && p.checked === r.ids.blade
    ? ok("panicked, a weapon is offered Impaired alone, and the window says why")
    : fail(`panic window: ${JSON.stringify(p)}`);
  pc.faces === 4
    ? ok("...and Impaired rolls the d4")
    : fail(`panic card: ${JSON.stringify(pc)}`);
  // 9
  const k = r.cancel ?? {};
  k.present && k.last && k.closed && k.posted === 0
    ? ok("Cancel stands last in the footer, closes the window and posts nothing")
    : fail(`Cancel: ${JSON.stringify(k)}`);
  // 13
  const ov = r.overlay ?? {};
  ov.listed === "ZZ Hoja" && ov.card === "ZZ Hoja"
    ? ok("with a content overlay, the window lists the weapon by its display name and the card names it so")
    : fail(`overlay names: ${JSON.stringify(ov)} (want "ZZ Hoja" in the list and on the card)`);
  // 10
  const rr = r.rowRoller ?? {};
  rr.weapon?.attack && rr.spear && rr.weapon.checked === rr.spear && rr.spear !== rr.remembered && rr.weapon.posted === 0
    ? ok("a second weapon's row roller opens the Attack window with THAT weapon chosen; Cancel posts nothing")
    : fail(`weapon row roller: ${JSON.stringify(rr)}`);
  rr.improvised?.attack && rr.improvised.checked === "improvised" && rr.improvised.posted === 0
    ? ok("the Improvised Attack row's roller opens the Attack window on Improvised; Cancel posts nothing")
    : fail(`improvised row roller: ${JSON.stringify(rr.improvised ?? null)}`);
  const nr = r.npcRoller ?? {};
  nr.opened && nr.quality && !nr.attack
    ? ok("an npc's row roller keeps its quick damage roll (the quality dialog, not the Attack window)")
    : fail(`npc row roller: ${JSON.stringify(nr)}`);
  // 11
  if (r.hacksError) fail(`the shield-hack legs threw: ${r.hacksError}`);
  const H = r.hands ?? {}, hid = H.ids ?? {};
  const sorted = (a) => JSON.stringify([...a].sort());
  sorted(H.full?.listed ?? []) === sorted([hid.torch, "improvised"]) && H.full?.note === H.want
    ? ok(`Hands full, shield and light held: only the light (it rolls damage) and Improvised are offered, with "${H.want}"`)
    : fail(`hands full window: ${JSON.stringify(H.full)} (want ${JSON.stringify([hid.torch, "improvised"])}, note ${JSON.stringify(H.want)})`);
  H.roller?.present && !H.roller.action && H.roller.disabled === "true" && H.roller.tip === H.want
    ? ok("...another weapon's roller is drawn disabled, saying why")
    : fail(`hands full roller: ${JSON.stringify(H.roller)}`);
  H.forced?.opened === 0 && H.forced?.posted === 0
    ? ok("...and a forced click on it opens nothing and posts nothing")
    : fail(`hands full forced click: ${JSON.stringify(H.forced)}`);
  sorted(H.freed?.listed ?? []) === sorted([hid.sword, "improvised"]) && H.freed?.note === null && H.freedRoller === "rollDamage"
    ? ok("a hand freed (the light stowed): the sword is back, in the window and on its row, no note")
    : fail(`hands freed: ${JSON.stringify({ freed: H.freed, roller: H.freedRoller })}`);
  sorted(H.off?.listed ?? []) === sorted([hid.sword, hid.torch, "improvised"]) && H.off?.note === null && H.offRoller === "rollDamage"
    ? ok("the hack off, both held: every weapon offered, no note, the roller live")
    : fail(`hands full off: ${JSON.stringify({ off: H.off, roller: H.offRoller })}`);
  // 12
  const S = r.shieldWeapon ?? {}, sid = S.ids ?? {};
  sorted(S.list?.listed ?? []) === sorted([sid.kite, sid.mace, sid.halberd, sid.bow, "improvised"])
    && S.list?.kiteFormula === "1d4" && S.list?.kiteDie === "1d4" && S.kiteRoller === "1d4"
    ? ok("Shields are d4 weapons: the held shield is offered as 1d4, and its row rolls 1d4")
    : fail(`shield weapon list: ${JSON.stringify({ list: S.list, roller: S.kiteRoller })}`);
  S.mace?.shown && S.mace.disabled === false && S.mace.label === S.wantBox
    ? ok(`a one-handed weapon offers "${S.mace.label}", live`)
    : fail(`add-shield box on the mace: ${JSON.stringify(S.mace)} (want ${JSON.stringify(S.wantBox)})`);
  S.mace?.beforeImprovised
    ? ok("the add-shield box sits after the weapons, directly above Improvised Attack")
    : fail(`add-shield box position: ${JSON.stringify(S.mace)}`);
  [S.halberd, S.bow].every((b) => b?.shown && b.disabled === true && b.tip === S.wantTip)
    ? ok(`a Bulky weapon and a bow grey the box: "${S.wantTip}"`)
    : fail(`add-shield box on two-handed weapons: ${JSON.stringify({ halberd: S.halberd, bow: S.bow })}`);
  S.kite && !S.kite.shown && S.improvised && !S.improvised.shown
    ? ok("the box hides while the shield itself or Improvised is chosen")
    : fail(`add-shield box hidden: ${JSON.stringify({ kite: S.kite, improvised: S.improvised })}`);
  /1d6/.test(S.standardLabel ?? "") && /1d4/.test(S.standardLabel ?? "")
    ? ok(`with the box ticked Standard names both dice ("${S.standardLabel}")`)
    : fail(`Standard label with the shield added: ${JSON.stringify(S.standardLabel)}`);
  const pl = S.pool ?? {};
  pl.term === "PoolTerm" && /kh/.test(pl.formula ?? "") && pl.total === 4
    && JSON.stringify(pl.results) === JSON.stringify([{ r: 1, active: false }, { r: 4, active: true }])
    ? ok(`...and rolls a keep-highest pool (${pl.formula}): the d6's 1 dropped, the d4's 4 kept`)
    : fail(`shield pool roll: ${JSON.stringify(pl)}`);
  S.impaired?.dice === 1 && S.impaired?.faces === 4 && !/\{/.test(S.impaired?.formula ?? "{")
    ? ok("Impaired with the box ticked rolls the plain d4")
    : fail(`impaired with the box: ${JSON.stringify(S.impaired)}`);
  sorted(S.off?.listed ?? []) === sorted([sid.mace, sid.halberd, sid.bow, "improvised"]) && S.off?.box === false && S.off?.kiteRoller === false
    ? ok("the hack off: no shield entry, no box, no shield roller")
    : fail(`shield weapon off: ${JSON.stringify(S.off)}`);
  // 8
  const e = r.enterCard ?? {};
  e.faces === 8 && e.weapon === "a stool"
    ? ok("a real Enter in the improvised description rolls the typed die (Roll Damage is the first submit on offer)")
    : fail(`Enter in the improvised field: ${JSON.stringify(e)}`);
}
if (errors.length) { failed = true; console.log("Console errors:\n" + errors.join("\n")); }
console.log(failed ? "\nattack e2e FAILED" : "\nattack e2e passed");
await browser.close();
process.exit(failed ? 1 : 0);

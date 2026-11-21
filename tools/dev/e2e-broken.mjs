#!/usr/bin/env node
/**
 * Broken items (user ask 2026-11-20): "I need a way to mark an inventory item
 * as BROKEN. When an item is Broken it still takes up a slot but doesn't
 * provide any benefit".
 *
 * The user's picks: broken takes away EVERYTHING MECHANICAL (it cannot be
 * equipped — so no Armor, no damage roll, no Hold shield switch — and its
 * uses / charges controls go; the pips stay so the state still shows), its
 * slot stays, it is marked on the ITEM SHEET only (a "Broken" box, here in
 * the name row), and the row wears a "Broken" tag.
 *
 * Asserts:
 *   1. the item, weapon, armor, object and spellbook sheets carry the Broken
 *      box in the name row, clear of the name, and ticking it stores true; a
 *      Fatigue's sheet has none;
 *   2. on a character, marking the equipped armor broken unequips it, the
 *      Armor box drops, its row wears the tag and loses the hand icon, and the
 *      slots used do not move;
 *   3. a broken weapon loses its damage roll, a broken relic its use / charge
 *      controls (its pips stay);
 *   4. a forced `equipped: true` on a broken item is stripped (the document
 *      holds the invariant, so every path agrees);
 *   5. a broken shield gives no Hold shield switch;
 *   6. a broken weapon is not offered in the Attack window;
 *   7. unticking makes it equippable again, without re-equipping it;
 *   8. a character CREATED with a broken item stored as equipped (inline
 *      `items` on the actor create: core runs no item _preCreate there, so
 *      the stored flag stays true — found walking CT 123, 2026-11-20) still
 *      reads it unequipped: the row is not bold, a weapon has no damage roll,
 *      its Armor does not count, and a shield gives no switch.
 *   9. (review #35) a broken item and an intact one of the same name and
 *      type are not one stack, either way round (findMatchingStack); two
 *      intact ones are;
 *  10. (review #35, GLoG and Grimoires read on IN-PAGE, never written) the
 *      Grimoire's cast picker leaves out a broken bound page;
 *  11. (review #35) a broken Grimoire offers no Transmute on a loose book, a
 *      forced Transmute asks nothing and binds nothing, and castFromGrimoire
 *      itself opens nothing and returns null.
 *
 * Added 2026-11-20 (user ask: an icon on each inventory row that marks an
 * item Broken, "to the left of the delete icon (trash can)"; the item sheet's
 * box stays):
 *  12. on a character, an npc and a container, every row that can be broken
 *      carries the control DIRECTLY left of the trash, reading "Mark broken",
 *      its icon game-icons' broken shield (the mask's url fetched); a Fatigue
 *      row has none;
 *  13. a press marks the item broken: the tag shows, the hand goes, an
 *      equipped item is stripped, the control reads "Mark repaired" in the
 *      peril colour (the Broken tag's), not the colour it had intact; a second
 *      press repairs it, and it is not re-equipped;
 *  14. a player OBSERVING the character, pressing the control (forced in if
 *      it is not drawn), writes nothing.
 *
 * Added 2026-11-21 (user ask: "Breaking and unbreaking an item should be
 * Gated by a yes/no dialogue box"):
 *  15. on a character, an npc and a container every row press asks first:
 *      "Mark broken" with the rule line and "Mark {name} broken?"; No writes
 *      nothing; Yes marks it; the repair asks "Mark {name} repaired?";
 *  16. the item sheet's Broken box asks the same: No leaves it unticked and
 *      stores nothing, Yes stores it.
 *
 * Usage: npm run dev:broken
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAs, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const FIXTURE = "e2e-broken";
let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(360000, "broken probe", async () => { try { await browser.close(); } catch { /* gone */ } });
const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(gm);

const cleanup = async () => {
  try {
    await gm.evaluate(async (fixture) => {
      for (const d of foundry.applications.instances.values()) {
        if (d.element?.classList?.contains("cairn-attack-dialog")) await d.close();
      }
      for (const a of game.actors.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) {
        await a.sheet?.close();
        await a.delete();
      }
      for (const i of game.items.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) {
        await i.sheet?.close();
        await i.delete();
      }
    }, FIXTURE);
  } catch (e) {
    console.error(`  note  cleanup: ${e.message}`);
  }
};

let r = null;
try {
  await joinAsGM(gm);
  await dismissChrome(gm);
  await cleanup();

  r = await gm.evaluate(async (fixture) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const L = (k) => game.i18n.localize(k);
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = { want: L("CAIRN.Broken") };

    /* ---- 1. the box on five sheets, none on a Fatigue ------------------ */
    out.sheets = {};
    for (const type of ["item", "weapon", "armor", "object", "spellbook"]) {
      const it = await getDocumentClass("Item").create({ name: `ZZ Broken ${type}`, type, flags });
      const sh = it.sheet;
      await sh.render(true);
      await until(() => sh.element?.querySelector?.(".item-sheet-section-name"));
      await sleep(300);
      const row = sh.element.querySelector(".item-sheet-section-name");
      const box = row?.querySelector('input[name="system.broken"]');
      const name = row?.querySelector(".name-input");
      const a = box?.getBoundingClientRect(), b = name?.getBoundingClientRect();
      const res = {
        box: !!box,
        label: box?.closest("label")?.textContent.trim() ?? row?.querySelector(`label[for="${box?.id}"]`)?.textContent.trim() ?? null,
        clear: !!a && !!b && (a.left >= b.right - 0.5 || a.right <= b.left + 0.5),
        shown: !!a && a.width > 0 && a.height > 0,
      };
      // Since 2026-11-21 the box asks first (leg 16): answer Yes.
      const stale = new Set(document.querySelectorAll(".application.dialog"));
      box?.click();
      let dlg = null;
      await until(() => (dlg = [...document.querySelectorAll(".application.dialog")].find((x) => !stale.has(x))), 2000);
      dlg?.querySelector("button[data-action='yes']")?.click();
      await until(() => it._source.system.broken === true, 3000);
      res.stored = it._source.system.broken ?? null;
      out.sheets[type] = res;
      await sh.close();
    }
    {
      const fat = await getDocumentClass("Item").create({ name: "Fatigue", type: "item", flags });
      const sh = fat.sheet;
      await sh.render(true);
      await until(() => sh.element?.querySelector?.(".item-sheet-section-name"));
      await sleep(300);
      out.fatigueBox = !!sh.element.querySelector('input[name="system.broken"]');
      await sh.close();
    }

    /* ---- 2-7. on a character ------------------------------------------ */
    const pc = await getDocumentClass("Actor").create({
      name: "ZZ Broken PC", type: "character", system: { hp: { value: 4, max: 6 } }, flags,
      items: [
        { name: "ZZ Mail", type: "armor", system: { armor: 1, equipped: true } },
        { name: "ZZ Sword", type: "weapon", system: { damageFormula: "1d6", equipped: true } },
        { name: "ZZ Wand", type: "item", system: { relic: true, uses: { value: 2, max: 3 } } },
        { name: "ZZ Kite", type: "armor", system: { armor: 1, equipped: false, shield: true } },
      ],
    }, { abNoStatusCard: true });
    const item = (n) => pc.items.find((i) => i.name === n);
    const sheet = pc.sheet;
    await sheet.render(true);
    await until(() => sheet.element?.querySelector?.(".cairn-shield"));
    await sleep(400);
    const rowOf = (n) => sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${item(n)?.id}"]`);
    const armorShown = () => sheet.element.querySelector('.tab[data-tab="character"] .armor-input')?.value ?? null;
    const rowState = (n) => {
      const row = rowOf(n);
      return {
        tag: [...(row?.querySelectorAll(".cairn-item-tag.tag-broken") ?? [])].map((t) => t.textContent.trim()),
        hand: !!row?.querySelector('[data-action="itemToggleEquipped"]'),
        roll: !!row?.querySelector('[data-action="rollDamage"]'),
        uses: !!row?.querySelector('[data-action="itemAddUse"], [data-action="itemRemoveUse"]'),
        pips: row?.querySelectorAll(".cairn-item-uses i").length ?? 0,
      };
    };
    const breakIt = async (n, v = true) => {
      await item(n).update({ "system.broken": v });
      await until(() => item(n)?._source.system.broken === v, 3000);
      await sleep(500);
    };

    out.before = {
      armor: armorShown(), slots: pc.system.slotsUsed,
      mail: rowState("ZZ Mail"), sword: rowState("ZZ Sword"), wand: rowState("ZZ Wand"),
      // A LIVE switch: since 2026-11-20 it is always drawn, greyed with none to hold.
      shieldSwitch: sheet.element.querySelector(".shield-hold")?.disabled === false,
    };
    // 2
    await breakIt("ZZ Mail");
    out.mail = { equipped: item("ZZ Mail").system.equipped, armor: armorShown(), slots: pc.system.slotsUsed, row: rowState("ZZ Mail") };
    // 3
    await breakIt("ZZ Sword");
    await breakIt("ZZ Wand");
    out.sword = { equipped: item("ZZ Sword").system.equipped, row: rowState("ZZ Sword") };
    out.wand = rowState("ZZ Wand");
    // 4
    await item("ZZ Sword").update({ "system.equipped": true });
    await sleep(400);
    out.forced = item("ZZ Sword")._source.system.equipped;
    // 5
    await breakIt("ZZ Kite");
    out.kiteSwitch = sheet.element.querySelector(".shield-hold")?.disabled === false;
    // 6
    await sheet.changeTab("character", "primary");
    await sleep(200);
    const stale = new Set(document.querySelectorAll(".cairn-attack-dialog"));
    sheet.element.querySelector('.cairn-vital-buttons [data-action="attack"]')?.click();
    let dlg = null;
    await until(() => (dlg = [...document.querySelectorAll(".cairn-attack-dialog")].find((d) => !stale.has(d))));
    out.attackWeapons = dlg ? [...dlg.querySelectorAll('input[name="weapon"]')].map((i) => i.value) : null;
    out.swordId = item("ZZ Sword").id;
    dlg?.querySelector('header [data-action="close"]')?.click();
    await sleep(300);
    // 7
    await breakIt("ZZ Sword", false);
    out.unbroken = { equipped: item("ZZ Sword").system.equipped, row: rowState("ZZ Sword") };
    await sheet.close();

    // 8. Inline creation: the stored flag stays equipped; the derived read must not.
    const pc2 = await getDocumentClass("Actor").create({
      name: "ZZ Broken Inline", type: "character", system: { hp: { value: 4, max: 6 } }, flags,
      items: [
        { name: "ZZ Old Mail", type: "armor", system: { armor: 1, equipped: true, broken: true } },
        { name: "ZZ Old Axe", type: "weapon", system: { damageFormula: "1d6", equipped: true, broken: true } },
      ],
    }, { abNoStatusCard: true });
    const s2 = pc2.sheet;
    await s2.render(true);
    await until(() => s2.element?.querySelector?.(".cairn-shield"));
    await sleep(400);
    const row2 = (n) => s2.element.querySelector(`.cairn-items-list-row[data-item-id="${pc2.items.find((i) => i.name === n)?.id}"]`);
    out.inline = {
      stored: pc2.items.find((i) => i.name === "ZZ Old Mail")?._source.system.equipped ?? null,
      read: pc2.items.find((i) => i.name === "ZZ Old Mail")?.system.equipped ?? null,
      armor: s2.element.querySelector('.tab[data-tab="character"] .armor-input')?.value ?? null,
      mailBold: !!row2("ZZ Old Mail")?.querySelector(".cairn-item-title :is(b, strong)"),
      axeBold: !!row2("ZZ Old Axe")?.querySelector(".cairn-item-title :is(b, strong)"),
      axeRoll: !!row2("ZZ Old Axe")?.querySelector('[data-action="rollDamage"]'),
    };
    await s2.close();

    // 9. Stacking (review #35): a broken item and an intact one of the same
    // name and type are not one stack, either way round; two intact are.
    {
      const { findMatchingStack } = await import("/systems/air-bladder/module/gear.js");
      const pc3 = await getDocumentClass("Actor").create({
        name: "ZZ Broken Stack", type: "character", flags,
        items: [
          { name: "ZZ Rope", type: "item", system: { broken: true } },
          { name: "ZZ Chain", type: "item", system: {} },
        ],
      }, { abNoStatusCard: true });
      out.stack = {
        intactOnBroken: !!findMatchingStack(pc3, { name: "ZZ Rope", type: "item", system: {} }),
        brokenOnIntact: !!findMatchingStack(pc3, { name: "ZZ Chain", type: "item", system: { broken: true } }),
        intactOnIntact: !!findMatchingStack(pc3, { name: "ZZ Chain", type: "item", system: {} }),
      };
    }

    // 10-11. The Grimoire (review #35), GLoG and Grimoires read ON in-page
    // (never written; put back in the finally): a broken page is not in the
    // cast picker; a broken Grimoire offers no Transmute, a forced Transmute
    // binds nothing, and castFromGrimoire itself opens nothing.
    {
      const ns = game.system.id;
      const origGet = game.settings.get;
      game.settings.get = function (scope, key, ...rest) {
        if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
        if (scope === ns && (key === "enable-glog-magic" || key === "glog-grimoires")) return true;
        return origGet.call(this, scope, key, ...rest);
      };
      const grim = await import("/systems/air-bladder/module/grimoire.js");
      const dialogs = () => [...foundry.applications.instances.values()].filter((d) => d instanceof foundry.applications.api.DialogV2);
      const closeNew = async (before) => {
        for (const d of dialogs()) if (!before.has(d)) await d.close();
      };
      try {
        const pc4 = await getDocumentClass("Actor").create({
          name: "ZZ Broken Grimoire", type: "character", flags,
          items: [
            { name: "ZZ Grim", type: "item", system: { grimoire: true, grimoirePages: 3, grimoireKey: "zzbroken" } },
            { name: "ZZ Page A", type: "spellbook", system: { bound: true, boundTo: "zzbroken" } },
            { name: "ZZ Page B", type: "spellbook", system: { bound: true, boundTo: "zzbroken", broken: true } },
            { name: "ZZ Loose", type: "spellbook", system: {} },
          ],
        }, { abNoStatusCard: true });
        const it4 = (n) => pc4.items.find((i) => i.name === n);
        // 10: the picker.
        let before = new Set(dialogs());
        const pending = grim.castFromGrimoire(pc4);
        let dlg = null;
        await until(() => (dlg = dialogs().find((d) => !before.has(d))));
        await sleep(200);
        out.picker = dlg ? [...dlg.element.querySelectorAll('select[name="page"] option')].map((o) => o.value) : null;
        out.pageIds = { a: it4("ZZ Page A").id, b: it4("ZZ Page B").id };
        await closeNew(before);
        await pending;
        // 11: break the Grimoire.
        await it4("ZZ Grim").update({ "system.broken": true });
        await until(() => it4("ZZ Grim")._source.system.broken === true, 3000);
        const s4 = pc4.sheet;
        await s4.render(true);
        await until(() => s4.element?.querySelector?.(".cairn-items-list-row"));
        await sleep(400);
        const looseRow = s4.element.querySelector(`.cairn-items-list-row[data-item-id="${it4("ZZ Loose").id}"]`);
        out.transmute = { offered: !!looseRow?.querySelector('[data-action="pageTransmute"]') };
        before = new Set(dialogs());
        if (looseRow) {
          const forced = document.createElement("a");
          forced.dataset.action = "pageTransmute";
          looseRow.append(forced);
          forced.click();
        }
        await sleep(700);
        out.transmute.asked = dialogs().some((d) => !before.has(d));
        await closeNew(before);
        await sleep(300);
        out.transmute.bound = it4("ZZ Loose")?.system.bound === true;
        await s4.close();
        before = new Set(dialogs());
        const cast = await Promise.race([grim.castFromGrimoire(pc4), sleep(1500).then(() => "open")]);
        out.brokenCast = { result: cast === null ? null : String(cast), opened: dialogs().some((d) => !before.has(d)) };
        await closeNew(before);
      } finally {
        game.settings.get = origGet;
      }
    }

    // 12-13. The row control, on a character, an npc and a container.
    {
      const want = { mark: L("CAIRN.ItemMarkBroken"), repair: L("CAIRN.ItemMarkRepaired") };
      // The key itself back means the string is missing: never a pass.
      out.rowWant = { ...want, missing: want.mark === "CAIRN.ItemMarkBroken" || want.repair === "CAIRN.ItemMarkRepaired" };
      const loads = new Map();
      const loadsOk = async (url) => {
        if (!url) return false;
        if (!loads.has(url)) loads.set(url, await fetch(url).then((res) => res.ok).catch(() => false));
        return loads.get(url);
      };
      const ITEMS = [
        { name: "ZZ Row Blade", type: "weapon", system: { damageFormula: "1d6", equipped: true } },
        { name: "ZZ Row Rope", type: "item", system: {} },
        { name: "Fatigue", type: "item", system: {} },
      ];
      const actors = {
        character: await getDocumentClass("Actor").create({ name: "ZZ Row PC", type: "character", flags, items: ITEMS }, { abNoStatusCard: true }),
        npc: await getDocumentClass("Actor").create({ name: "ZZ Row NPC", type: "npc", system: { role: "npc" }, flags, items: ITEMS }, { abNoStatusCard: true }),
        container: await getDocumentClass("Actor").create({ name: "ZZ Row Chest", type: "npc", system: { role: "container" }, flags,
          items: ITEMS.filter((i) => i.name !== "Fatigue") }, { abNoStatusCard: true }),
      };
      out.rows = {};
      for (const [kind, a] of Object.entries(actors)) {
        const s = a.sheet;
        await s.render(true);
        await until(() => s.element?.querySelector?.(".cairn-items-list-row"));
        await s.changeTab("items", "primary");
        await sleep(400);
        const it = (n) => a.items.find((i) => i.name === n);
        const rowOf = (n) => s.element.querySelector(`.cairn-items-list-row[data-item-id="${it(n)?.id}"]`);
        const ctl = (n) => rowOf(n)?.querySelector('[data-action="itemToggleBroken"]');
        const read = async (n) => {
          const c = ctl(n);
          const icon = c?.querySelector(".broken-icon");
          const cs = icon ? getComputedStyle(icon) : null;
          const mask = cs?.maskImage || cs?.webkitMaskImage || "";
          const url = /url\("?([^")]+)"?\)/.exec(mask)?.[1] ?? null;
          const tag = rowOf(n)?.querySelector(".cairn-item-tag.tag-broken");
          return {
            present: !!c,
            leftOfTrash: !!c && c.nextElementSibling?.dataset.action === "itemDelete",
            title: c?.getAttribute("title") ?? null,
            pressed: c?.getAttribute("aria-pressed") ?? null,
            icon: /game-icons\/shields\/([a-z-]+)\.svg/.exec(url ?? "")?.[1] ?? null,
            loads: await loadsOk(url),
            color: cs?.backgroundColor ?? null,
            tag: !!tag,
            tagColor: tag ? getComputedStyle(tag).color : null,
            hand: !!rowOf(n)?.querySelector('[data-action="itemToggleEquipped"]'),
          };
        };
        const res = { blade: await read("ZZ Row Blade"), rope: await read("ZZ Row Rope"),
          fatigue: it("Fatigue") ? (await read("Fatigue")).present : null };
        // 15 (2026-11-21, user ask: "Breaking and unbreaking an item should be
        // Gated by a yes/no dialogue box"): every press asks first. `ask`
        // presses, reads the NEW dialog's title and question, answers it.
        const ask = async (n, answer) => {
          const stale = new Set(document.querySelectorAll(".application.dialog"));
          ctl(n)?.click();
          let d = null;
          await until(() => (d = [...document.querySelectorAll(".application.dialog")].find((x) => !stale.has(x))), 3000);
          await sleep(200);
          const seen = d ? { title: d.querySelector(".window-title")?.textContent.trim() ?? null,
            question: d.querySelector(".cairn-confirm-q")?.textContent.trim() ?? null,
            tip: d.querySelector(".cairn-confirm")?.firstChild?.textContent?.trim() ?? null } : null;
          d?.querySelector(`button[data-action='${answer}']`)?.click();
          await until(() => !d?.isConnected, 3000);
          await sleep(300);
          return seen;
        };
        // The blade on every kind, answered No first (nothing written), then
        // 13: Yes, then the repair (Yes).
        {
          const wasEquipped = it("ZZ Row Blade")?.system.equipped ?? null;
          res.askNo = await ask("ZZ Row Blade", "no");
          res.afterNo = { broken: it("ZZ Row Blade")?._source.system.broken ?? null,
            equipped: it("ZZ Row Blade")?._source.system.equipped ?? null };
          res.askYes = await ask("ZZ Row Blade", "yes");
          await until(() => it("ZZ Row Blade")?._source.system.broken === true, 3000);
          await until(() => ctl("ZZ Row Blade")?.getAttribute("aria-pressed") === "true", 3000);
          await sleep(300);
          res.pressed = { broken: it("ZZ Row Blade")?._source.system.broken ?? null,
            equipped: it("ZZ Row Blade")?._source.system.equipped ?? null, wasEquipped, ...(await read("ZZ Row Blade")) };
          res.askRepair = await ask("ZZ Row Blade", "yes");
          await until(() => it("ZZ Row Blade")?._source.system.broken === false, 3000);
          await until(() => ctl("ZZ Row Blade")?.getAttribute("aria-pressed") === "false", 3000);
          await sleep(300);
          res.repaired = { broken: it("ZZ Row Blade")?._source.system.broken ?? null,
            equipped: it("ZZ Row Blade")?._source.system.equipped ?? null, ...(await read("ZZ Row Blade")) };
        }
        out.rows[kind] = res;
        await s.close();
      }
      // 16. The item sheet's Broken box asks too (the same helper): No puts
      // the box back unticked and stores nothing; Yes stores true.
      {
        const rope = actors.character.items.find((i) => i.name === "ZZ Row Rope");
        const sh = rope.sheet;
        await sh.render(true);
        await until(() => sh.element?.querySelector?.('input[name="system.broken"]'));
        await sleep(300);
        const box = () => sh.element.querySelector('input[name="system.broken"]');
        const tick = async (answer) => {
          const stale = new Set(document.querySelectorAll(".application.dialog"));
          box()?.click();
          let d = null;
          await until(() => (d = [...document.querySelectorAll(".application.dialog")].find((x) => !stale.has(x))), 3000);
          await sleep(200);
          const q = d?.querySelector(".cairn-confirm-q")?.textContent.trim() ?? null;
          d?.querySelector(`button[data-action='${answer}']`)?.click();
          await sleep(900);
          return { asked: !!d, question: q, checked: box()?.checked ?? null, stored: rope._source.system.broken ?? null };
        };
        out.sheetNo = await tick("no");
        out.sheetYes = await tick("yes");
        await sh.close();
      }
      out.confirmWant = {
        markTitle: L("CAIRN.ItemMarkBroken"), repairTitle: L("CAIRN.ItemMarkRepaired"), tip: L("CAIRN.ItemBrokenTip"),
        bladeQ: game.i18n.format("CAIRN.ItemBrokenConfirm", { name: "ZZ Row Blade" }),
        bladeRepairQ: game.i18n.format("CAIRN.ItemRepairedConfirm", { name: "ZZ Row Blade" }),
        ropeQ: game.i18n.format("CAIRN.ItemBrokenConfirm", { name: "ZZ Row Rope" }),
      };
      // 14 runs in Alice's own page: hand her the character as an OBSERVER.
      const alice = game.users.getName("Alice");
      out.aliceId = alice?.id ?? null;
      if (alice) {
        await actors.character.update({ ownership: { default: 0, [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
        out.observedId = actors.character.id;
        out.observedItem = actors.character.items.find((i) => i.name === "ZZ Row Rope")?.id ?? null;
      }
    }
    return out;
  }, FIXTURE);

  // 14. An observer's press (forced in if the control is not drawn) writes nothing.
  if (r?.aliceId && r.observedId) {
    const alice = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
    try {
      await joinAs(alice, "Alice");
      r.observer = await alice.evaluate(async ({ actorId, itemId }) => {
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const a = game.actors.get(actorId);
        if (!a) return { error: "Alice cannot see the character" };
        const s = a.sheet;
        await s.render(true);
        for (let i = 0; i < 40 && !s.element?.querySelector?.(".cairn-items-list-row"); i++) await sleep(150);
        await s.changeTab("items", "primary");
        await sleep(400);
        const row = s.element.querySelector(`.cairn-items-list-row[data-item-id="${itemId}"]`);
        let c = row?.querySelector('[data-action="itemToggleBroken"]');
        const drawn = !!c;
        if (!c && row) {
          c = document.createElement("a");
          c.dataset.action = "itemToggleBroken";
          (row.querySelector(".cairn-item-controls") ?? row).append(c);
        }
        c?.click();
        await sleep(1500);
        const res = { editable: s.isEditable, drawn, row: !!row };
        await s.close();
        return res;
      }, { actorId: r.observedId, itemId: r.observedItem });
      r.observer.broken = await gm.evaluate(({ actorId, itemId }) =>
        game.actors.get(actorId)?.items.get(itemId)?._source.system.broken ?? null, { actorId: r.observedId, itemId: r.observedItem });
    } catch (e) {
      r.observer = { error: e.message };
    } finally {
      await alice.context().close();
    }
  }
} catch (e) {
  fail(`probe threw: ${e.stack ?? e.message}`);
} finally {
  await cleanup();
}

/* ---- verdicts ------------------------------------------------------------ */
if (!r) fail("the in-page run returned nothing");
else {
  const bad = Object.entries(r.sheets ?? {}).filter(([, v]) => !(v.box && v.label === r.want && v.clear && v.shown && v.stored === true));
  !bad.length && Object.keys(r.sheets ?? {}).length === 5
    ? ok(`the item, weapon, armor, object and spellbook sheets carry "${r.want}" in the name row, clear of the name, and it stores true`)
    : fail(`Broken box: ${JSON.stringify(Object.fromEntries(bad.length ? bad : Object.entries(r.sheets ?? {})))} (want ${JSON.stringify(r.want)})`);
  r.fatigueBox === false
    ? ok("a Fatigue's sheet has no Broken box")
    : fail(`Fatigue box: ${r.fatigueBox}`);
  const b = r.before ?? {}, m = r.mail ?? {};
  b.armor === "1" && b.mail?.hand && m.equipped === false && m.armor === "0" && m.slots === b.slots
    && m.row?.tag?.[0] === r.want && !m.row?.hand
    ? ok(`a broken armor is unequipped: Armor ${b.armor} → ${m.armor}, the row says "${m.row.tag[0]}" with no hand, slots still ${m.slots}`)
    : fail(`broken armor: ${JSON.stringify({ before: b, mail: m })}`);
  const s = r.sword ?? {}, w = r.wand ?? {};
  b.sword?.roll && s.equipped === false && !s.row?.roll && b.wand?.uses && !w.uses && w.pips === 3
    ? ok("a broken weapon loses its damage roll; a broken relic its use controls, its pips staying")
    : fail(`broken weapon / relic: ${JSON.stringify({ before: { sword: b.sword, wand: b.wand }, sword: s, wand: w })}`);
  r.forced === false
    ? ok("a forced equip of a broken item is stripped")
    : fail(`forced equip stored ${JSON.stringify(r.forced)}`);
  b.shieldSwitch && r.kiteSwitch === false
    ? ok("a broken shield leaves the Hold shield switch greyed (nothing to hold)")
    : fail(`shield switch: before ${b.shieldSwitch}, broken ${r.kiteSwitch}`);
  Array.isArray(r.attackWeapons) && !r.attackWeapons.includes(r.swordId) && r.attackWeapons.includes("improvised")
    ? ok("the Attack window does not offer the broken weapon")
    : fail(`attack weapons: ${JSON.stringify(r.attackWeapons)} (sword ${r.swordId})`);
  const n = r.inline ?? {};
  n.stored === true && n.read === false && n.armor === "0" && !n.mailBold && !n.axeBold && !n.axeRoll
    ? ok("created with a broken item stored as equipped, it still reads unequipped: not bold, no damage roll, no Armor")
    : fail(`inline-created broken items: ${JSON.stringify(n)}`);
  const u = r.unbroken ?? {};
  u.equipped === false && u.row?.hand && !u.row?.tag?.length
    ? ok("unticked, it can be equipped again and is not re-equipped")
    : fail(`unbroken: ${JSON.stringify(u)}`);
  // 9
  const st = r.stack ?? {};
  st.intactOnBroken === false && st.brokenOnIntact === false && st.intactOnIntact === true
    ? ok("a broken item and an intact one of the same name are not one stack; two intact are")
    : fail(`stacking: ${JSON.stringify(st)}`);
  // 10
  Array.isArray(r.picker) && r.picker.includes(r.pageIds?.a) && !r.picker.includes(r.pageIds?.b)
    ? ok("the Grimoire's cast picker leaves out a broken page")
    : fail(`cast picker: ${JSON.stringify(r.picker)} (pages ${JSON.stringify(r.pageIds)})`);
  // 11
  const tm = r.transmute ?? {};
  tm.offered === false && tm.asked === false && tm.bound === false
    ? ok("a broken Grimoire offers no Transmute, and a forced one asks nothing and binds nothing")
    : fail(`broken Grimoire transmute: ${JSON.stringify(tm)}`);
  const bc = r.brokenCast ?? {};
  bc.result === null && bc.opened === false
    ? ok("castFromGrimoire on a broken Grimoire opens nothing and returns null")
    : fail(`broken Grimoire cast: ${JSON.stringify(bc)}`);
  // 12
  const rw = r.rowWant ?? {};
  if (rw.missing) fail(`the row control's strings are missing: ${JSON.stringify(rw)}`);
  const intact = (x) => !!x && x.present && x.leftOfTrash && x.title === rw.mark && x.pressed === "false"
    && x.icon === "broken-shield" && x.loads && !x.tag;
  for (const kind of ["character", "npc", "container"]) {
    const k = r.rows?.[kind] ?? {};
    intact(k.blade) && intact(k.rope)
      ? ok(`${kind}: every row carries "${rw.mark}" directly left of the trash, game-icons' broken shield`)
      : fail(`${kind} row control: ${JSON.stringify({ blade: k.blade, rope: k.rope, want: rw.mark })}`);
    if (kind !== "container") {
      k.fatigue === false
        ? ok(`${kind}: a Fatigue row has no Broken control`)
        : fail(`${kind} Fatigue row control: ${JSON.stringify(k.fatigue)}`);
      // 13
      const pr = k.pressed ?? {}, rp = k.repaired ?? {};
      pr.wasEquipped === true && pr.broken === true && pr.equipped === false && pr.tag && !pr.hand
        && pr.title === rw.repair && pr.pressed === "true" && pr.color === pr.tagColor && pr.color !== k.blade?.color
        ? ok(`${kind}: a press marks it broken (tag shown, hand gone, unequipped); the control reads "${rw.repair}" in the peril colour ${pr.color}`)
        : fail(`${kind} pressed: ${JSON.stringify({ pressed: pr, intactColor: k.blade?.color, want: rw.repair })}`);
      rp.broken === false && rp.equipped === false && !rp.tag && rp.hand && rp.title === rw.mark && rp.pressed === "false"
        && rp.color === k.blade?.color
        ? ok(`${kind}: a second press repairs it, back to "${rw.mark}", not re-equipped`)
        : fail(`${kind} repaired: ${JSON.stringify(rp)}`);
    }
    // 15: every press asks first, on every kind; No writes nothing.
    const cw = r.confirmWant ?? {};
    const missing = [cw.tip, cw.bladeQ, cw.bladeRepairQ].some((v) => typeof v !== "string" || v.startsWith("CAIRN."));
    const no = k.askNo, yes = k.askYes, rep = k.askRepair;
    !missing && no?.title === cw.markTitle && no.question === cw.bladeQ && no.tip === cw.tip
      && k.afterNo?.broken === false && (kind === "container" || k.afterNo?.equipped === true)
      ? ok(`${kind}: a press asks "${cw.markTitle}" / "${cw.bladeQ}"; No writes nothing`)
      : fail(`${kind} confirm, No: ${JSON.stringify({ asked: no, after: k.afterNo, want: cw })}`);
    yes?.question === cw.bladeQ && k.pressed?.broken === true && k.pressed?.tag
      && rep?.title === cw.repairTitle && rep.question === cw.bladeRepairQ && k.repaired?.broken === false
      ? ok(`${kind}: Yes marks it broken; the repair asks "${cw.bladeRepairQ}" and Yes repairs it`)
      : fail(`${kind} confirm, Yes / repair: ${JSON.stringify({ yes, pressed: k.pressed?.broken, repair: rep, repaired: k.repaired?.broken })}`);
  }
  // 16: the item sheet's box asks too.
  {
    const sn = r.sheetNo ?? {}, sy = r.sheetYes ?? {};
    sn.asked && sn.question === r.confirmWant?.ropeQ && sn.checked === false && sn.stored === false
      && sy.asked && sy.stored === true && sy.checked === true
      ? ok("the item sheet's Broken box asks first: No leaves it unticked and stores nothing, Yes stores it")
      : fail(`item sheet box confirm: ${JSON.stringify({ no: sn, yes: sy, want: r.confirmWant?.ropeQ })}`);
  }
  // 14
  if (!r.aliceId) fail('no user named "Alice" — run `npm run dev:players` first; the observer leg did not run');
  else {
    const o = r.observer ?? {};
    !o.error && o.row && o.editable === false && o.broken === false
      ? ok(`an observing player's press writes nothing (control ${o.drawn ? "drawn" : "forced in"})`)
      : fail(`observer press: ${JSON.stringify(o)}`);
  }
}
errors.length === 0 ? ok("no console errors") : fail(`console errors: ${errors.join(" | ")}`);

await browser.close();
if (failed) {
  console.error("\nbroken e2e FAILED");
  process.exit(1);
}
console.log("\nbroken e2e passed");

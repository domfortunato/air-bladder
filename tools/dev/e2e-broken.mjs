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
 *
 * Usage: npm run dev:broken
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const FIXTURE = "e2e-broken";
let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(240000, "broken probe", async () => { try { await browser.close(); } catch { /* gone */ } });
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
      box?.click();
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
      shieldSwitch: !!sheet.element.querySelector(".shield-hold"),
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
    out.kiteSwitch = !!sheet.element.querySelector(".shield-hold");
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
    return out;
  }, FIXTURE);
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
    ? ok("a broken shield gives no Hold shield switch")
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
}
errors.length === 0 ? ok("no console errors") : fail(`console errors: ${errors.join(" | ")}`);

await browser.close();
if (failed) {
  console.error("\nbroken e2e FAILED");
  process.exit(1);
}
console.log("\nbroken e2e passed");

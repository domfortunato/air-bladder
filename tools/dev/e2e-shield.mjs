#!/usr/bin/env node
/**
 * Hold shield (user ask 2026-11-20): "if the character has a shield equipped
 * there should be a toggle to the left of the shield with armor value on the
 * character sheet - the toggle should sling or hold the shield".
 *
 * The user's picks: a SHIELD CHECKBOX on armor items marks what a shield is
 * (`system.shield`, the shipped Shield, Hacked Shield and Steadymade Buckler
 * ticked, existing copies matched ONCE by name or by their compendium source);
 * held = equipped (its Armor counts), slung = not (still carried, still a
 * slot, no Armor) — no new rule, the switch flips `system.equipped`; and a
 * SWITCH reading "Hold shield", the creation-mode toggle's icons.
 *
 * Asserts:
 *   1. an armor item's sheet offers the Shield box, above the tabs (a counter
 *      past the grid's rows lands in an implicit row under them — measured
 *      once off the bottom of the window), and ticking it stores true;
 *   2. the three shipped shields carry it and a Helmet does not;
 *   3. a character with no shield, or only a helmet, shows no switch; with a
 *      slung shield the switch stands LEFT of the Armor box reading "Hold
 *      shield", off, and a press holds the shield (equipped, Armor +1, the
 *      switch on), a second press slings it again; with two shields held one
 *      press slings both;
 *   4. the migration: with its marker cleared and the GM client reloaded (the
 *      real ready path), a world "Shield", an embedded "Steadymade Buckler" and
 *      "Hacked Shield", and a RENAMED copy whose compendium source is the
 *      armor pack's Shield all come back ticked; an armor named "ZZ Shield
 *      Spikes" does not (exact names, not a substring); the marker is set; and
 *      a shield the Warden UNTICKS afterwards stays unticked across a reload
 *      (the marker is what makes it a migration, not a re-enforcement);
 *   5. the "Shields are Bulky" hack (user ask 2026-11-20), its setting read
 *      shadowed both ways: off, a shield needs 1 slot, its row has no Bulky
 *      tag, the shop's Shield row reads 1 slot and its Bulky box is free; on,
 *      the same character's slots rise by one, the drop/gift check asks for 2,
 *      the row and the shop say Bulky (2 slots), the body armor beside it is
 *      untouched, the item sheet's Bulky box is ticked, greyed and says why,
 *      and a sheet submit stores nothing (the stored `bulky` stays false).
 *
 * The re-armed migration walks the whole world, so every armor item's stored
 * `system.shield` is snapshotted first and put back afterwards, with the
 * marker.
 *
 * Usage: npm run dev:shield
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const FIXTURE = "e2e-shield";
let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(300000, "shield probe", async () => { try { await browser.close(); } catch { /* gone */ } });
const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(gm);

const SHIPPED = {
  shield: "Compendium.air-bladder.armor.Item.7r2YpGYPQI2SarO3",
  hacked: "Compendium.air-bladder.background-items.Item.CBziqgsnPhtbysXq",
  buckler: "Compendium.air-bladder.background-items.Item.3QHTT61bXqb2dAeB",
};

const cleanup = async () => {
  try {
    await gm.evaluate(async (fixture) => {
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

let snap = null;
const restore = async () => {
  if (!snap) return;
  try {
    await gm.evaluate(async ({ snap }) => {
      for (const [id, v] of Object.entries(snap.world)) {
        const i = game.items.get(id);
        if (i && i._source.system.shield !== v) await i.update({ "system.shield": v });
      }
      for (const [aid, items] of Object.entries(snap.actors)) {
        const a = game.actors.get(aid);
        if (!a) continue;
        const ups = Object.entries(items)
          .filter(([id, v]) => a.items.get(id) && a.items.get(id)._source.system.shield !== v)
          .map(([id, v]) => ({ _id: id, "system.shield": v }));
        if (ups.length) await a.updateEmbeddedDocuments("Item", ups, { abNoStatusCard: true });
      }
      if (game.settings.get("air-bladder", "shield-flag-stamped") !== snap.marker) {
        await game.settings.set("air-bladder", "shield-flag-stamped", snap.marker);
      }
    }, { snap });
  } catch (e) {
    console.error(`  note  restore: ${e.message}`);
  }
};

const reloadGM = async () => {
  await gm.reload({ waitUntil: "networkidle" });
  await gm.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(gm);
  await gm.waitForFunction(() => game.settings.get("air-bladder", "shield-flag-stamped") === true, null, { timeout: 30000 })
    .catch(() => {});
};

let r = {};
try {
  await joinAsGM(gm);
  await dismissChrome(gm);
  await cleanup();

  /* ---- 1-3: the item sheet, the shipped shields, the switch ------------- */
  r.ui = await gm.evaluate(async ({ fixture, SHIPPED }) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const L = (k) => game.i18n.localize(k);
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = { wantShield: L("CAIRN.Shield"), wantHold: L("CAIRN.HoldShield") };

    // 1. The armor sheet's Shield box.
    const loose = await getDocumentClass("Item").create({ name: "ZZ Shield Sheet", type: "armor", system: { armor: 1 }, flags });
    const isheet = loose.sheet;
    await isheet.render(true);
    await until(() => isheet.element?.querySelector?.(".item-sheet-grid"));
    await sleep(400);
    const box = isheet.element.querySelector('input[name="system.shield"]');
    const tabs = isheet.element.querySelector(".item-sheet-section-tabs");
    const counter = box?.closest(".resource-counter");
    out.sheet = {
      box: !!box,
      label: counter?.querySelector("label")?.textContent.trim() ?? null,
      aboveTabs: !!counter && !!tabs && counter.getBoundingClientRect().bottom <= tabs.getBoundingClientRect().top + 0.5,
    };
    if (box) {
      box.click();
      await until(() => loose._source.system.shield === true, 3000);
    }
    out.sheet.stored = loose._source.system.shield ?? null;
    await isheet.close();

    // 2. The shipped shields, and a Helmet.
    const shipped = {};
    for (const [k, uuid] of Object.entries(SHIPPED)) shipped[k] = (await fromUuid(uuid))?.system?.shield ?? null;
    const armorPack = game.packs.get("air-bladder.armor");
    const helmetIdx = armorPack?.index.find((e) => e.name === "Helmet");
    shipped.helmet = helmetIdx ? (await armorPack.getDocument(helmetIdx._id))?.system?.shield ?? null : "missing";
    out.shipped = shipped;

    // 3. The switch.
    const mkPc = async (name, items) => {
      const pc = await getDocumentClass("Actor").create({
        name, type: "character", system: { hp: { value: 4, max: 6 } }, flags, items,
      }, { abNoStatusCard: true });
      const sheet = pc.sheet;
      await sheet.render(true);
      await until(() => sheet.element?.querySelector?.(".cairn-shield"));
      await sleep(400);
      return { pc, sheet };
    };
    const look = (sheet) => {
      const page = sheet.element.querySelector('.tab[data-tab="character"]');
      const sw = page?.querySelector(".shield-hold");
      const armorBox = page?.querySelector(".cairn-shield");
      const a = sw?.getBoundingClientRect(), b = armorBox?.getBoundingClientRect();
      return {
        present: !!sw,
        text: sw?.textContent.trim() ?? null,
        checked: sw?.getAttribute("aria-checked") ?? null,
        on: !!sw?.querySelector(".fa-toggle-on"),
        off: !!sw?.querySelector(".fa-toggle-off"),
        left: !!a && !!b && a.right <= b.left + 0.5,
        // Beside it, not above or below: the two overlap vertically.
        beside: !!a && !!b && a.top < b.bottom && a.bottom > b.top,
        armor: page?.querySelector(".armor-input")?.value ?? null,
      };
    };
    const press = async (sheet, pc, test) => {
      sheet.element.querySelector('.tab[data-tab="character"] .shield-hold')?.click();
      await until(() => test(pc), 3000);
      await sleep(400);
    };

    {
      const { pc, sheet } = await mkPc("ZZ Shield None", []);
      out.none = look(sheet);
      await sheet.close();
      await pc.delete();
    }
    {
      const { pc, sheet } = await mkPc("ZZ Shield Helmet", [{ name: "ZZ Helmet", type: "armor", system: { armor: 1, equipped: true } }]);
      out.helmetOnly = look(sheet);
      await sheet.close();
      await pc.delete();
    }
    {
      const { pc, sheet } = await mkPc("ZZ Shield One", [
        { name: "ZZ Gambeson", type: "armor", system: { armor: 1, equipped: true } },
        { name: "ZZ Kite", type: "armor", system: { armor: 1, equipped: false, shield: true } },
      ]);
      const kite = () => pc.items.find((i) => i.name === "ZZ Kite");
      out.slung = look(sheet);
      await press(sheet, pc, () => kite()?.system.equipped === true);
      out.held = { ...look(sheet), equipped: kite()?.system.equipped ?? null };
      await press(sheet, pc, () => kite()?.system.equipped === false);
      out.reslung = { ...look(sheet), equipped: kite()?.system.equipped ?? null };
      await sheet.close();
      await pc.delete();
    }
    {
      const { pc, sheet } = await mkPc("ZZ Shield Two", [
        { name: "ZZ Kite A", type: "armor", system: { armor: 1, equipped: true, shield: true } },
        { name: "ZZ Kite B", type: "armor", system: { armor: 1, equipped: true, shield: true } },
      ]);
      const held = () => pc.items.filter((i) => i.system.shield && i.system.equipped).length;
      out.two = { before: look(sheet) };
      await press(sheet, pc, () => held() === 0);
      out.two.after = { ...look(sheet), held: held() };
      await sheet.close();
      await pc.delete();
    }
    return out;
  }, { fixture: FIXTURE, SHIPPED });

  /* ---- 5: the Bulky Shields hack ----------------------------------------- */
  // The setting is READ-SHADOWED in-page, both ways, never written: it is the
  // Warden's, and it reloads Foundry on change. A reset() re-prepares the
  // actor and its items under each reading, which is what the reload does.
  r.bulky = await gm.evaluate(async ({ fixture }) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const L = (k) => game.i18n.localize(k);
    const ns = game.system.id;
    const origGet = game.settings.get;
    let hack = false;
    game.settings.get = function (scope, key, ...rest) {
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "bulky-shields") return hack;
      return origGet.call(this, scope, key, ...rest);
    };
    const { slotsNeeded } = await import("/systems/air-bladder/module/gear.js");
    const { formatCount } = await import("/systems/air-bladder/module/utils.js");
    const mkt = await import("/systems/air-bladder/module/marketplace.js");
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = { wantBulky: L("CAIRN.Bulky"), wantTip: L("CAIRN.BulkyByShieldHack"), want1: formatCount("CAIRN.NSlot", 1), want2: formatCount("CAIRN.NSlot", 2) };
    let pc = null;
    try {
      pc = await getDocumentClass("Actor").create({
        name: "ZZ Shield Bulky", type: "character", system: { gold: 100 }, flags,
        items: [
          { name: "ZZ Round Shield", type: "armor", system: { armor: 1, shield: true, bulky: false } },
          { name: "ZZ Gambeson B", type: "armor", system: { armor: 1 } },
        ],
      }, { abNoStatusCard: true });
      const shield = () => pc.items.find((i) => i.name === "ZZ Round Shield");
      const gambeson = () => pc.items.find((i) => i.name === "ZZ Gambeson B");
      const closeShop = async () => {
        for (const app of foundry.applications.instances.values()) {
          if (app.element?.querySelector?.(".marketplace")) await app.close();
        }
        await sleep(200);
      };
      const reading = async () => {
        pc.reset();
        const sheet = pc.sheet;
        await sheet.render(true);
        await until(() => sheet.element?.querySelector?.(`[data-item-id="${shield().id}"]`));
        await sleep(300);
        const row = (id) => sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${id}"]`);
        const tags = (id) => [...(row(id)?.querySelectorAll(".cairn-item-tag") ?? [])].map((t) => t.textContent.trim());
        const res = {
          slots: pc.system.slotsUsed,
          need: slotsNeeded(shield().system),
          shieldTags: tags(shield().id),
          gambesonTags: tags(gambeson().id),
        };
        await sheet.close();
        await mkt.openMarketplace(pc);
        await until(() => document.querySelector('.marketplace .mkt-row[data-name="shield"]'));
        res.shop = document.querySelector('.marketplace .mkt-row[data-name="shield"] .mkt-slots')?.textContent.trim() ?? null;
        res.shopChips = [...document.querySelectorAll('.marketplace .mkt-row[data-name="shield"] .mkt-chip')].map((c) => c.textContent.trim());
        await closeShop();
        // The item sheet: the Bulky box reads the hack, greyed, and a submit
        // never stores it.
        const isheet = shield().sheet;
        await isheet.render(true);
        await until(() => isheet.element?.querySelector?.('input[name="system.bulky"]'));
        await sleep(300);
        const box = isheet.element.querySelector('input[name="system.bulky"]');
        res.box = { checked: !!box?.checked, disabled: !!box?.disabled, tip: box?.closest(".resource-counter")?.dataset.tooltip ?? null };
        const armorIn = isheet.element.querySelector('input[name="system.armor"]');
        if (armorIn) {
          armorIn.value = "2";
          armorIn.dispatchEvent(new Event("change", { bubbles: true }));
          await until(() => shield()._source.system.armor === 2, 3000);
        }
        res.afterSubmit = { armor: shield()._source.system.armor, bulky: shield()._source.system.bulky };
        if (shield()._source.system.armor !== 1) await shield().update({ "system.armor": 1 });
        await isheet.close();
        return res;
      };
      out.off = await reading();
      hack = true;
      out.on = await reading();
    } finally {
      game.settings.get = origGet;
      try { pc?.reset(); } catch { /* deleted below */ }
      if (pc) { await pc.sheet?.close(); await pc.delete(); }
    }
    return out;
  }, { fixture: FIXTURE });

  /* ---- 4: the migration, through the real ready path -------------------- */
  const seeded = await gm.evaluate(async ({ fixture, SHIPPED }) => {
    const flags = { "air-bladder": { probeFixture: fixture } };
    // Snapshot every armor item's stored flag, world and embedded, and the
    // marker, BEFORE seeding: the re-armed sweep walks the whole world.
    const snap = { world: {}, actors: {}, marker: game.settings.get("air-bladder", "shield-flag-stamped") ?? null };
    for (const i of game.items) if (i.type === "armor") snap.world[i.id] = i._source.system.shield ?? false;
    for (const a of game.actors) {
      const m = {};
      for (const i of a.items) if (i.type === "armor") m[i.id] = i._source.system.shield ?? false;
      if (Object.keys(m).length) snap.actors[a.id] = m;
    }
    const worldShield = await getDocumentClass("Item").create({ name: "Shield", type: "armor", system: { armor: 1, shield: false }, flags });
    const spikes = await getDocumentClass("Item").create({ name: "ZZ Shield Spikes", type: "armor", system: { armor: 1, shield: false }, flags });
    const pc = await getDocumentClass("Actor").create({
      name: "ZZ Shield Mig", type: "character", flags,
      items: [
        { name: "Steadymade Buckler", type: "armor", system: { armor: 1, shield: false } },
        { name: "Hacked Shield", type: "armor", system: { armor: 1, shield: false } },
        { name: "ZZ Renamed Shield", type: "armor", system: { armor: 1, shield: false }, _stats: { compendiumSource: SHIPPED.shield } },
        { name: "ZZ Helm", type: "armor", system: { armor: 1, shield: false } },
      ],
    }, { abNoStatusCard: true });
    const id = (n) => pc.items.find((i) => i.name === n)?.id;
    await game.settings.set("air-bladder", "shield-flag-stamped", false);
    return {
      snap,
      ids: {
        world: worldShield.id, spikes: spikes.id, pc: pc.id,
        buckler: id("Steadymade Buckler"), hacked: id("Hacked Shield"), renamed: id("ZZ Renamed Shield"), helm: id("ZZ Helm"),
      },
    };
  }, { fixture: FIXTURE, SHIPPED });
  snap = seeded.snap;

  await reloadGM();
  const read = () => gm.evaluate(({ ids }) => {
    const pc = game.actors.get(ids.pc);
    const e = (id) => pc?.items.get(id)?._source.system.shield ?? null;
    return {
      marker: game.settings.get("air-bladder", "shield-flag-stamped"),
      world: game.items.get(ids.world)?._source.system.shield ?? null,
      spikes: game.items.get(ids.spikes)?._source.system.shield ?? null,
      buckler: e(ids.buckler), hacked: e(ids.hacked), renamed: e(ids.renamed), helm: e(ids.helm),
    };
  }, { ids: seeded.ids });
  r.mig = await read();
  // The Warden unticks one; a reload must leave it unticked.
  await gm.evaluate(async ({ ids }) => {
    await game.items.get(ids.world)?.update({ "system.shield": false });
  }, { ids: seeded.ids });
  await reloadGM();
  r.mig2 = await read();
} catch (e) {
  fail(`probe threw: ${e.stack ?? e.message}`);
} finally {
  await restore();
  await cleanup();
}

/* ---- verdicts ------------------------------------------------------------ */
const u = r.ui ?? {};
const s = u.sheet ?? {};
s.box && s.label === u.wantShield && s.aboveTabs && s.stored === true
  ? ok(`an armor item's sheet offers "${s.label}", above the tabs, and ticking it stores true`)
  : fail(`armor sheet Shield box: ${JSON.stringify(s)} (want label ${JSON.stringify(u.wantShield)})`);
const sh = u.shipped ?? {};
sh.shield === true && sh.hacked === true && sh.buckler === true && sh.helmet === false
  ? ok("the shipped Shield, Hacked Shield and Steadymade Buckler are shields; the Helmet is not")
  : fail(`shipped shields: ${JSON.stringify(sh)}`);
!u.none?.present && !u.helmetOnly?.present
  ? ok("no switch on a character with no shield, or with only a helmet")
  : fail(`switch without a shield: ${JSON.stringify({ none: u.none, helmetOnly: u.helmetOnly })}`);
const sl = u.slung ?? {};
sl.present && sl.text === u.wantHold && sl.left && sl.beside && sl.checked === "false" && sl.off && !sl.on && sl.armor === "1"
  ? ok(`with a slung shield, "${sl.text}" stands left of the Armor box, off, Armor ${sl.armor}`)
  : fail(`slung: ${JSON.stringify(sl)} (want ${JSON.stringify(u.wantHold)})`);
const he = u.held ?? {};
he.equipped === true && he.checked === "true" && he.on && he.armor === "2"
  ? ok(`a press holds it: equipped, the switch on, Armor ${he.armor}`)
  : fail(`held: ${JSON.stringify(he)}`);
const rs = u.reslung ?? {};
rs.equipped === false && rs.checked === "false" && rs.off && rs.armor === "1"
  ? ok("a second press slings it again: not equipped, off, Armor back to 1")
  : fail(`re-slung: ${JSON.stringify(rs)}`);
const tw = u.two ?? {};
tw.before?.checked === "true" && tw.after?.held === 0 && tw.after?.checked === "false"
  ? ok("with two shields held, one press slings both")
  : fail(`two shields: ${JSON.stringify(tw)}`);
const m = r.mig ?? {};
m.marker === true && m.world === true && m.buckler === true && m.hacked === true && m.renamed === true
  && m.spikes === false && m.helm === false
  ? ok("the migration ticks a world Shield, a Buckler, a Hacked Shield and a renamed copy of the pack's Shield; not Shield Spikes or a helm")
  : fail(`migration: ${JSON.stringify(m)}`);
const m2 = r.mig2 ?? {};
m2.marker === true && m2.world === false && m2.buckler === true
  ? ok("a shield the Warden unticks stays unticked across a reload")
  : fail(`after untick and reload: ${JSON.stringify(m2)}`);
const bk = r.bulky ?? {};
const bOff = bk.off ?? {}, bOn = bk.on ?? {};
bOff.need === 1 && !bOff.shieldTags?.includes(bk.wantBulky) && bOff.shop === bk.want1
  && !bOff.box?.checked && !bOff.box?.disabled
  ? ok(`hack off: a shield needs 1 slot, no Bulky tag, the shop reads "${bOff.shop}", its Bulky box is free and unticked`)
  : fail(`hack off: ${JSON.stringify(bOff)}`);
bOn.slots === (bOff.slots ?? NaN) + 1 && bOn.need === 2
  ? ok(`hack on: the shield costs 2 (slots ${bOff.slots} -> ${bOn.slots}), and the drop/gift check asks for 2`)
  : fail(`hack on, slots: off ${bOff.slots} need ${bOff.need}, on ${bOn.slots} need ${bOn.need}`);
bOn.shieldTags?.includes(bk.wantBulky) && !bOn.gambesonTags?.includes(bk.wantBulky)
  ? ok("hack on: the shield's row shows Bulky; the body armor's does not")
  : fail(`hack on, row tags: shield ${JSON.stringify(bOn.shieldTags)}, gambeson ${JSON.stringify(bOn.gambesonTags)}`);
bOn.shop === bk.want2 && bOn.shopChips?.includes(bk.wantBulky)
  ? ok(`hack on: the shop's Shield row reads "${bOn.shop}" with a Bulky chip`)
  : fail(`hack on, shop: ${JSON.stringify({ shop: bOn.shop, chips: bOn.shopChips, want: bk.want2 })}`);
bOn.box?.checked && bOn.box?.disabled && bOn.box?.tip === bk.wantTip
  ? ok("hack on: the shield's Bulky box is ticked, greyed, and says why")
  : fail(`hack on, Bulky box: ${JSON.stringify(bOn.box)} (want tip ${JSON.stringify(bk.wantTip)})`);
bOn.afterSubmit?.armor === 2 && bOn.afterSubmit?.bulky === false
  ? ok("a sheet submit under the hack never stores Bulky")
  : fail(`stored after a submit: ${JSON.stringify(bOn.afterSubmit)}`);
errors.length === 0 ? ok("no console errors") : fail(`console errors: ${errors.join(" | ")}`);

await browser.close();
if (failed) {
  console.error("\nshield e2e FAILED");
  process.exit(1);
}
console.log("\nshield e2e passed");

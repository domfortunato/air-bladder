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
 *   6. Hold light (user asks 2026-11-20): a light source (a plain item named
 *      as one or named in the radius table — the Glowsnail, the Sun Stick —
 *      never its fuel) shows the hand. The light BADGE right of the Armor box
 *      is the Hold light control: a neutral lantern reading "Hold light", "No
 *      light held."; with several lights a press asks which (each listed with
 *      its radius; Cancel holds nothing), with one it holds at once; held, the
 *      icon matches the light, glows, and the radius shows under it; with two
 *      held a press puts both away. The darkness light and a light with no
 *      numbers read as they should. Both switches are
 *      ALWAYS drawn: with none of their kind they are disabled, off, and say
 *      why (this REWRITES leg 3's "no switch without a shield"); a live switch
 *      carries no tooltip. With the Torch module active (game.Torch and the
 *      module entry STUBBED in-page, recording calls — never a real install)
 *      and a token on the viewed scene, a hold selects that light and lights
 *      it, a stow puts it out, and the row's hand takes the very same path;
 *      no token, Torch inactive, or Torch throwing: no call (or the throw is
 *      swallowed), the hold stands, no console error.
 *   7. Weapon data (user ask 2026-11-20): the compendium Gnarled Staff is not
 *      Bulky and the compendium Sling rolls d6; the one-off migration, run
 *      IN-PAGE with its marker shadowed (never a real marker write), unbulks a
 *      planted "Gnarled Staff" and a renamed copy of the pack's (by its
 *      compendium source), two slots lighter, and leaves a bulky halberd and a
 *      non-weapon "Gnarled Staff" alone.
 *   7b. (review #35) both one-off migrations (the staff's and the shield
 *      flag's) reach WORLD compendiums: in a planted locked Item pack and an
 *      Actor pack, a bulky "Gnarled Staff" is unbulked and an unticked
 *      "Shield" / "Hacked Shield" ticked, and the locked pack is locked again.
 *      Markers shadowed; every other world pack's staffs and shields put back.
 *
 * Rewritten 2026-11-20 (user ask, the Armor row redone): Hold shield is a
 * badge like Hold light's, game-icons' heater shield as a mask (its url
 * fetched), muted when slung, glowing when held, labelled "Hold shield" /
 * "Shield in hand"; Hold light reads "Light in hand" while a light is held
 * (legs 3 and 6). The Armor box's shape is dev:sheet-rail's leg 25.
 * Since 2026-11-21 (user asks) the badge shows game-icons' Shield Disabled
 * (Skoll) while slung and Shield Bash (Delapouite) in hand, and the off
 * labels are questions: "Hold shield?" / "Hold light?".
 *
 * Since 2026-11-21 (user asks, the Equip round): the word is "Equip". Off
 * reads "Equip shield" / "Equip light" under game-icons' Shield (Sbed) or the
 * first carried light's own icon; on reads "Shield equipped" / "Light
 * equipped"; with none carried the badge is greyed and reads "No Shield" /
 * "No Light" (the slashed shield, the neutral lantern). Every label is in full
 * ink (no switch glyph since 2026-11-21, user: "Just \"Equip...\" should be
 * enough"), and the three badges stand in a
 * row UNDER the Armor box (shield | light | book). Lighting spends a use, so
 * the Torch here has 20, and a spent one is now REFUSED (6b). Leg 8 is the
 * book badge: a spellbook, a scroll or the Grimoire, one equipped at a time,
 * a picker when several are carried, "No Spellbook" with none; a scroll and
 * the Grimoire get the row's hand and a bound page does not.
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
    const out = { wantShield: L("CAIRN.Shield"), wantHold: L("CAIRN.EquipShield"), wantInHand: L("CAIRN.ShieldEquipped"),
      wantNoShield: L("CAIRN.NoShield"), wantNoLight: L("CAIRN.NoLight"),
      wantShieldNone: L("CAIRN.EquipShieldNone"), wantLightNone: L("CAIRN.EquipLightNone") };

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
    // Since 2026-11-20 (user ask, the Armor row redone) Hold shield is a BADGE
    // like Hold light's: game-icons' heater shield as a mask, muted when slung,
    // the accent with a glow when held, "Hold shield" / "Shield in hand" under
    // it. The mask's RESOLVED url is fetched (the light badge's 404 lesson).
    const shieldLoads = new Map();
    const shieldLoadsOk = async (url) => {
      if (!url) return false;
      if (!shieldLoads.has(url)) shieldLoads.set(url, await fetch(url).then((res) => res.ok).catch(() => false));
      return shieldLoads.get(url);
    };
    const look = async (sheet) => {
      const page = sheet.element.querySelector('.tab[data-tab="character"]');
      const sw = page?.querySelector(".shield-hold");
      const armorBox = page?.querySelector(".cairn-shield");
      const a = sw?.getBoundingClientRect(), b = armorBox?.getBoundingClientRect();
      const lw = page?.querySelector(".light-hold");
      const lb = lw?.getBoundingClientRect();
      const icon = sw?.querySelector(".shield-icon");
      const lIcon = lw?.querySelector(".light-icon");
      const lcs = lIcon ? getComputedStyle(lIcon) : null;
      const lMask = lcs?.maskImage || lcs?.webkitMaskImage || "";
      // Full ink: the label's colour is the sheet's --ab-ink, read off a
      // scratch span inside the badge (never a hard-coded colour).
      const inkOf = (el) => {
        if (!el) return null;
        const probe = document.createElement("span");
        probe.style.color = "var(--ab-ink)";
        el.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      };
      const lab = sw?.querySelector(".shield-label");
      const cs = icon ? getComputedStyle(icon) : null;
      const mask = cs?.maskImage || cs?.webkitMaskImage || "";
      const url = /url\("?([^")]+)"?\)/.exec(mask)?.[1] ?? null;
      return {
        present: !!sw,
        label: lab?.textContent.trim() ?? null,
        labelInk: !!lab && getComputedStyle(lab).color === inkOf(sw),
        glyph: sw?.querySelector(":is(.badge-switch, .fa-toggle-on, .fa-toggle-off)") ? "drawn" : null,
        icon: /game-icons\/shields\/([a-z-]+)\.svg/.exec(url ?? "")?.[1] ?? null,
        loads: await shieldLoadsOk(url),
        color: cs?.backgroundColor ?? null,
        filter: cs?.filter ?? null,
        disabled: sw?.disabled ?? null,
        tip: sw?.dataset.tooltip ?? null,
        light: { present: !!lw, disabled: lw?.disabled ?? null, checked: lw?.getAttribute("aria-checked") ?? null,
          tip: lw?.dataset.tooltip ?? null, label: lw?.querySelector(".light-label")?.textContent.trim() ?? null,
          icon: /game-icons\/fire\/([a-z-]+)\.svg/.exec(lMask)?.[1] ?? null },
        checked: sw?.getAttribute("aria-checked") ?? null,
        // The badge row stands UNDER the Armor box (2026-11-21): the shield's
        // badge below it, and left of the light's on the same row.
        below: !!a && !!b && a.top >= b.bottom - 0.5,
        leftOfLight: !!a && !!lb && a.right <= lb.left + 0.5 && a.top < lb.bottom && a.bottom > lb.top,
        // The Armor label stands to the RIGHT of a smaller shield outline, a
        // size up from the badges' 12px (2026-11-21, user asks).
        armorLook: (() => {
          const lbl = page?.querySelector(".cairn-armor-box > .armor-label")?.getBoundingClientRect();
          if (!lbl || !b) return null;
          return { right: lbl.left >= b.right - 0.5 && lbl.top < b.bottom && lbl.bottom > b.top,
            size: parseFloat(getComputedStyle(page.querySelector(".cairn-armor-box > .armor-label")).fontSize),
            shieldW: Math.round(b.width), shieldH: Math.round(b.height) };
        })(),
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
      out.none = await look(sheet);
      await sheet.close();
      await pc.delete();
    }
    {
      const { pc, sheet } = await mkPc("ZZ Shield Helmet", [{ name: "ZZ Helmet", type: "armor", system: { armor: 1, equipped: true } }]);
      out.helmetOnly = await look(sheet);
      await sheet.close();
      await pc.delete();
    }
    {
      const { pc, sheet } = await mkPc("ZZ Shield One", [
        { name: "ZZ Gambeson", type: "armor", system: { armor: 1, equipped: true } },
        { name: "ZZ Kite", type: "armor", system: { armor: 1, equipped: false, shield: true } },
      ]);
      const kite = () => pc.items.find((i) => i.name === "ZZ Kite");
      out.slung = await look(sheet);
      await press(sheet, pc, () => kite()?.system.equipped === true);
      out.held = { ...(await look(sheet)), equipped: kite()?.system.equipped ?? null };
      await press(sheet, pc, () => kite()?.system.equipped === false);
      out.reslung = { ...(await look(sheet)), equipped: kite()?.system.equipped ?? null };
      await sheet.close();
      await pc.delete();
    }
    {
      const { pc, sheet } = await mkPc("ZZ Shield Two", [
        { name: "ZZ Kite A", type: "armor", system: { armor: 1, equipped: true, shield: true } },
        { name: "ZZ Kite B", type: "armor", system: { armor: 1, equipped: true, shield: true } },
      ]);
      const held = () => pc.items.filter((i) => i.system.shield && i.system.equipped).length;
      out.two = { before: await look(sheet) };
      await press(sheet, pc, () => held() === 0);
      out.two.after = { ...(await look(sheet)), held: held() };
      await sheet.close();
      await pc.delete();
    }
    return out;
  }, { fixture: FIXTURE, SHIPPED });

  /* ---- 8: the book badge (2026-11-21) ------------------------------------- */
  r.book = await gm.evaluate(async ({ fixture }) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const L = (k) => game.i18n.localize(k);
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = {
      want: {
        none: L("CAIRN.NoBook"), noneTip: L("CAIRN.EquipBookNone"),
        off: L("CAIRN.EquipBook"), on: L("CAIRN.BookEquipped"),
        // One wording for every kind since 2026-11-21 (user: "yes" to "Equip Spell" /
        // "Spell equipped" / "No Spell" for a scroll and the Grimoire too).
        offScroll: L("CAIRN.EquipBook"), onScroll: L("CAIRN.BookEquipped"),
        onGrimoire: L("CAIRN.BookEquipped"),
        tipScroll: game.i18n.format("CAIRN.BookEquippedTip", { name: "ZZ Book Scroll" }),
        prompt: L("CAIRN.EquipPick.Prompt"),
      },
    };
    const mk = async (name, items) => {
      const pc = await getDocumentClass("Actor").create({ name, type: "character", flags, items }, { abNoStatusCard: true });
      const sheet = pc.sheet;
      await sheet.render(true);
      await until(() => sheet.element?.querySelector?.(".cairn-shield"));
      await sleep(400);
      return { pc, sheet };
    };
    const badge = (sheet) => {
      const b = sheet.element.querySelector('.tab[data-tab="character"] .book-hold');
      const icon = b?.querySelector(".book-icon");
      const cs = icon ? getComputedStyle(icon) : null;
      const mask = cs?.maskImage || cs?.webkitMaskImage || "";
      const lb = sheet.element.querySelector('.tab[data-tab="character"] .light-hold')?.getBoundingClientRect();
      const bb = b?.getBoundingClientRect();
      return {
        present: !!b, disabled: b?.disabled ?? null, checked: b?.getAttribute("aria-checked") ?? null,
        label: b?.querySelector(".book-label")?.textContent.trim() ?? null,
        tip: b?.dataset.tooltip ?? null,
        icon: /game-icons\/book\/([a-z-]+)\.svg/.exec(mask)?.[1] ?? null,
        url: /url\("?([^")]+)"?\)/.exec(mask)?.[1] ?? null,
        glyph: b?.querySelector(":is(.badge-switch, .fa-toggle-on, .fa-toggle-off)") ? "drawn" : null,
        rightOfLight: !!lb && !!bb && bb.left >= lb.right - 0.5 && bb.top < lb.bottom && bb.bottom > lb.top,
      };
    };
    const loads = async (url) => !!url && (await fetch(url).then((res) => res.ok).catch(() => false));
    const press = (sheet) => sheet.element.querySelector('.tab[data-tab="character"] .book-hold')?.click();
    const hand = (sheet, pc, n) => sheet.element.querySelector(
      `.cairn-items-list-row[data-item-id="${pc.items.find((i) => i.name === n)?.id}"] [data-action="itemToggleEquipped"]`);
    {
      const { pc, sheet } = await mk("ZZ Book None", []);
      out.none = badge(sheet);
      out.none.loads = await loads(out.none.url);
      await sheet.close();
      await pc.delete();
    }
    {
      const { pc, sheet } = await mk("ZZ Book One", [{ name: "ZZ Book Sleep", type: "spellbook", sort: 100 }]);
      const book = () => pc.items.find((i) => i.name === "ZZ Book Sleep");
      out.one = { off: badge(sheet) };
      press(sheet);
      await until(() => book()?.system.equipped === true, 3000);
      await sleep(400);
      out.one.on = { ...badge(sheet), equipped: book()?.system.equipped ?? null,
        picker: !!document.querySelector(".cairn-book-picker") };
      out.one.on.loads = await loads(out.one.on.url);
      press(sheet);
      await until(() => !book()?.system.equipped, 3000);
      await sleep(400);
      out.one.after = { ...badge(sheet), equipped: book()?.system.equipped ?? null };
      await sheet.close();
      await pc.delete();
    }
    {
      const { pc, sheet } = await mk("ZZ Book Three", [
        { name: "ZZ Book Scroll", type: "spellbook", sort: 100, system: { scroll: true, weightless: true, uses: { value: 1, max: 1 } } },
        { name: "ZZ Book Sleep", type: "spellbook", sort: 200 },
        { name: "ZZ Book Grimoire", type: "item", sort: 300, system: { grimoire: true, bulky: true } },
        { name: "ZZ Book Page", type: "spellbook", sort: 400, system: { bound: true, weightless: true } },
      ]);
      const it = (n) => pc.items.find((i) => i.name === n);
      const equipped = () => ["ZZ Book Scroll", "ZZ Book Sleep", "ZZ Book Grimoire", "ZZ Book Page"].filter((n) => it(n)?.system.equipped);
      out.three = {
        hands: { scroll: !!hand(sheet, pc, "ZZ Book Scroll"), book: !!hand(sheet, pc, "ZZ Book Sleep"),
          grimoire: !!hand(sheet, pc, "ZZ Book Grimoire"), page: !!hand(sheet, pc, "ZZ Book Page") },
        off: badge(sheet),
      };
      const openPicker = async () => {
        const stale = new Set(document.querySelectorAll(".cairn-book-picker"));
        press(sheet);
        let d = null;
        await until(() => (d = [...document.querySelectorAll(".cairn-book-picker")].find((x) => !stale.has(x))), 3000);
        await sleep(200);
        return d;
      };
      let d = await openPicker();
      out.three.picker = {
        opened: !!d,
        prompt: d?.querySelector(".cairn-light-prompt")?.textContent.trim() ?? null,
        ids: [...(d?.querySelectorAll('input[name="book"]') ?? [])].map((i) => i.value),
        order: [it("ZZ Book Scroll").id, it("ZZ Book Sleep").id, it("ZZ Book Grimoire").id],
      };
      d?.querySelector('footer button[data-action="cancel"]')?.click();
      await until(() => !d?.isConnected, 3000);
      await sleep(300);
      out.three.afterCancel = equipped();
      d = await openPicker();
      const pick = d?.querySelector(`input[name="book"][value="${it("ZZ Book Scroll").id}"]`);
      if (pick) { pick.checked = true; pick.dispatchEvent(new Event("change", { bubbles: true })); }
      d?.querySelector('footer button[data-action="hold"]')?.click();
      await until(() => it("ZZ Book Scroll")?.system.equipped === true, 3000);
      await sleep(500);
      out.three.scroll = { ...badge(sheet), equipped: equipped() };
      // The Grimoire's row hand: it is equipped, and the scroll put away.
      hand(sheet, pc, "ZZ Book Grimoire")?.click();
      await until(() => it("ZZ Book Grimoire")?.system.equipped === true, 3000);
      await sleep(500);
      out.three.grimoire = { ...badge(sheet), equipped: equipped() };
      // One press puts it away, no picker.
      press(sheet);
      await until(() => equipped().length === 0, 3000);
      await sleep(400);
      out.three.stowed = { equipped: equipped(), picker: !!document.querySelector(".cairn-book-picker") };
      await sheet.close();
      await pc.delete();
    }
    return out;
  }, { fixture: FIXTURE });

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

  /* ---- 6: Hold light, and lighting through Torch ------------------------- */
  // game.Torch, the module entry and the actor's active tokens are STUBBED in
  // the page and put back in the finally: never a real install, no scene.
  r.light = await gm.evaluate(async ({ fixture }) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const L = (k) => game.i18n.localize(k);
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = { wantLight: L("CAIRN.EquipLight"), wantLightOn: L("CAIRN.LightEquipped") };
    const realTorch = game.Torch;
    const hadOwnGet = Object.prototype.hasOwnProperty.call(game.modules, "get");
    const realGet = game.modules.get;
    let pc = null;
    try {
      pc = await getDocumentClass("Actor").create({
        name: "ZZ Shield Lights", type: "character", flags,
        items: [
          { name: "Torch", type: "item", sort: 100, system: { uses: { value: 20, max: 20 } } },
          { name: "Lantern", type: "item", sort: 200 },
          { name: "Oil Can", type: "item", sort: 300 },
          { name: "ZZ Rope", type: "item", sort: 400 },
          // Named in the radius table though not by the light-name rule (user, 2026-11-20).
          { name: "Glowsnail", type: "item", sort: 500 },
          { name: "Sun Stick", type: "item", sort: 600 },
        ],
      }, { abNoStatusCard: true });
      const it = (n) => pc.items.find((i) => i.name === n);
      const sheet = pc.sheet;
      await sheet.render(true);
      await until(() => sheet.element?.querySelector?.(".cairn-shield"));
      await sleep(400);
      const page = () => sheet.element.querySelector('.tab[data-tab="character"]');
      const sw = () => page()?.querySelector(".light-hold");
      const hand = (n) => !!sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${it(n)?.id}"] [data-action="itemToggleEquipped"]`);
      out.hands = { torch: hand("Torch"), lantern: hand("Lantern"), oil: hand("Oil Can"), rope: hand("ZZ Rope"),
        glowsnail: hand("Glowsnail"), sunStick: hand("Sun Stick") };
      // The badge: the light's icon (a CSS mask on .light-icon), its label, and
      // the radius while one is held.
      // The mask's RESOLVED url, fetched: a relative url() in a custom property
      // resolves against the stylesheet (css/), and the icon drew nothing on
      // CT 123 while its name still read right (found walking ee91cef1).
      const loads = new Map();
      const loadsOk = async (url) => {
        if (!url) return false;
        if (!loads.has(url)) loads.set(url, await fetch(url).then((res) => res.ok).catch(() => false));
        return loads.get(url);
      };
      const badge = () => {
        const b = sw();
        const icon = b?.querySelector(".light-icon");
        const cs = icon ? getComputedStyle(icon) : null;
        const mask = cs?.maskImage || cs?.webkitMaskImage || "";
        return {
          url: /url\("?([^")]+)"?\)/.exec(mask)?.[1] ?? null,
          label: b?.querySelector(".light-label")?.textContent.trim() ?? null,
          glyph: b?.querySelector(":is(.badge-switch, .fa-toggle-on, .fa-toggle-off)") ? "drawn" : null,
          radius: b?.querySelector(".light-radius")?.textContent.trim() ?? null,
          icon: mask.match(/game-icons\/fire\/([a-z-]+)\.svg/)?.[1] ?? null,
          color: cs?.backgroundColor ?? null,
          filter: cs?.filter ?? null,
          checked: b?.getAttribute("aria-checked") ?? null,
          tip: b?.dataset.tooltip ?? null,
          disabled: b?.disabled ?? null,
        };
      };
      const heldTip = (name) => game.i18n.format("CAIRN.LightHeldTip", { name });
      out.want = {
        noneHeld: L("CAIRN.LightNoneHeld"),
        prompt: L("CAIRN.EquipPick.Prompt"),
        heldLantern: heldTip("Lantern"), heldTorch: heldTip("Torch"), heldGlowsnail: heldTip("Glowsnail"),
      };
      out.want.bright = game.i18n.format("CAIRN.LightRadius", { bright: 20, dim: 40 });
      out.want.dimOnly = game.i18n.format("CAIRN.LightRadiusDim", { dim: 10 });
      {
        // Under the Armor box, right of the shield's badge (2026-11-21).
        const a = page()?.querySelector(".cairn-shield")?.getBoundingClientRect();
        const b = sw()?.getBoundingClientRect();
        const sb = page()?.querySelector(".shield-hold")?.getBoundingClientRect();
        out.place = {
          ...badge(),
          right: !!sb && !!b && b.left >= sb.right - 0.5,
          beside: !!a && !!b && b.top >= a.bottom - 0.5,
        };
        out.place.loads = await loadsOk(out.place.url);
      }
      // Several lights, none held: a press asks which, listing each with its
      // radius; Cancel holds nothing; the pick is held.
      const openPicker = async () => {
        const stale = new Set(document.querySelectorAll(".cairn-light-picker"));
        sw()?.click();
        let d = null;
        await until(() => (d = [...document.querySelectorAll(".cairn-light-picker")].find((x) => !stale.has(x))), 3000);
        await sleep(200);
        return d;
      };
      {
        let d = await openPicker();
        const rows = [...(d?.querySelectorAll('input[name="light"]') ?? [])].map((i) => ({
          id: i.value, text: i.closest("label")?.textContent.replace(/\s+/g, " ").trim() ?? "",
        }));
        out.picker = {
          opened: !!d,
          prompt: d?.querySelector(".cairn-light-prompt")?.textContent.trim() ?? null,
          rows: rows.map((x) => x.text),
          ids: rows.map((x) => x.id),
          order: [it("Torch").id, it("Lantern").id, it("Glowsnail").id, it("Sun Stick").id],
        };
        d?.querySelector('footer button[data-action="cancel"]')?.click();
        await until(() => !d?.isConnected, 3000);
        await sleep(300);
        out.picker.afterCancel = ["Torch", "Lantern", "Glowsnail", "Sun Stick"].filter((n) => it(n)?.system.equipped);
        d = await openPicker();
        const pick = d?.querySelector(`input[name="light"][value="${it("Lantern").id}"]`);
        if (pick) { pick.checked = true; pick.dispatchEvent(new Event("change", { bubbles: true })); }
        d?.querySelector('footer button[data-action="hold"]')?.click();
        await until(() => it("Lantern")?.system.equipped === true, 3000);
        await sleep(500);
        out.picker.held = ["Torch", "Lantern", "Glowsnail", "Sun Stick"].filter((n) => it(n)?.system.equipped);
        out.lanternBadge = badge();
        out.lanternBadge.loads = await loadsOk(out.lanternBadge.url);
      }
      // A second held light; one press puts every one away (no picker).
      await it("Glowsnail").update({ "system.equipped": true });
      await sleep(400);
      out.glowBadge = badge();
      sw()?.click();
      await until(() => !it("Lantern")?.system.equipped && !it("Glowsnail")?.system.equipped, 3000);
      await sleep(400);
      out.stowed = { held: ["Torch", "Lantern", "Glowsnail", "Sun Stick"].filter((n) => it(n)?.system.equipped),
        picker: !!document.querySelector(".cairn-light-picker"), badge: badge() };
      // The radius text for the darkness light and for a light with no numbers.
      try {
        const ls = await import("/systems/air-bladder/module/light-sources.js");
        out.texts = { darkness: ls.lightRadiusText("Lightsucker Candle"), none: ls.lightRadiusText("Wraith Lantern"),
          alias: ls.lightRadiusText("Torches"), wantDark: game.i18n.format("CAIRN.LightRadiusDarkness", { bright: 10, dim: 20 }) };
      } catch (e) {
        out.texts = { error: e.message };
      }
      // Down to ONE light for the Torch legs below: a press holds it at once.
      await pc.deleteEmbeddedDocuments("Item", [it("Lantern").id, it("Glowsnail").id, it("Sun Stick").id]);
      await sleep(400);
      const press = async (test) => {
        sw()?.click();
        await until(test, 3000);
        await sleep(400);
      };
      await press(() => it("Torch")?.system.equipped === true);
      out.torchBadge = { ...badge(), picker: !!document.querySelector(".cairn-light-picker"),
        uses: it("Torch")?.system.uses.value ?? null };
      out.torchBadge.loads = await loadsOk(out.torchBadge.url);
      await press(() => !it("Torch")?.system.equipped);

      // Torch, stubbed.
      let calls = [];
      let state = "off";
      let throwing = false;
      const rec = (name) => async (...args) => {
        calls.push([name, ...args]);
        if (throwing) throw new Error("ZZ torch refuses");
        if (name === "currentState") return state;
        if (name === "toggle") { state = state === "on" ? "off" : "on"; return state; }
        if (name === "extinguish") { state = "off"; return state; }
        return undefined;
      };
      game.Torch = { selectSource: rec("selectSource"), toggle: rec("toggle"), currentState: rec("currentState"), extinguish: rec("extinguish") };
      let torchActive = true;
      game.modules.get = function (id, ...rest) {
        if (id === "torch") return { id: "torch", active: torchActive };
        return realGet.call(this, id, ...rest);
      };
      let tokens = [{ id: "zzTokenProbe0001", parent: { id: "zzSceneProbe0001" } }];
      // The real method's two shapes: TokenDocuments with `document` true
      // (holdLight's call), canvas placeables (`.document`, `.controlled`)
      // otherwise — core's ChatMessage.getSpeaker asks for those
      // (chat-message.mjs:229-233), and since 2026-11-21 a hold posts a
      // change-log card, whose speaker reads them.
      pc.getActiveTokens = (_linked, document) => (document ? tokens
        : tokens.map((d) => ({ id: d.id, document: d, controlled: false })));
      const settle = async () => { await sleep(600); };
      const viaSwitch = async () => {
        calls = [];
        state = "off";
        await press(() => it("Torch")?.system.equipped === true);
        await settle();
        const on = calls.slice();
        calls = [];
        await press(() => !it("Torch")?.system.equipped);
        await settle();
        return { on, off: calls.slice() };
      };
      const viaHand = async () => {
        calls = [];
        state = "off";
        sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${it("Torch").id}"] [data-action="itemToggleEquipped"]`)?.click();
        await until(() => it("Torch")?.system.equipped === true, 3000);
        await settle();
        const on = calls.slice();
        calls = [];
        sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${it("Torch").id}"] [data-action="itemToggleEquipped"]`)?.click();
        await until(() => !it("Torch")?.system.equipped, 3000);
        await settle();
        return { on, off: calls.slice() };
      };
      out.torch = { switch: await viaSwitch(), hand: await viaHand() };
      // Already lit: selected, not toggled off again.
      calls = [];
      state = "on";
      await press(() => it("Torch")?.system.equipped === true);
      await settle();
      out.torch.lit = calls.slice();
      await press(() => !it("Torch")?.system.equipped);
      await settle();
      // No token on the viewed scene.
      tokens = [];
      calls = [];
      await press(() => it("Torch")?.system.equipped === true);
      await settle();
      out.torch.noToken = { calls: calls.length, held: it("Torch").system.equipped };
      await press(() => !it("Torch")?.system.equipped);
      await settle();
      tokens = [{ id: "zzTokenProbe0001", parent: { id: "zzSceneProbe0001" } }];
      // Torch inactive.
      torchActive = false;
      calls = [];
      await press(() => it("Torch")?.system.equipped === true);
      await settle();
      out.torch.inactive = { calls: calls.length, held: it("Torch").system.equipped };
      await press(() => !it("Torch")?.system.equipped);
      await settle();
      torchActive = true;
      // Torch throwing: the hold stands.
      throwing = true;
      calls = [];
      await press(() => it("Torch")?.system.equipped === true);
      await settle();
      out.torch.throwing = { calls: calls.length, held: it("Torch").system.equipped };
      throwing = false;
      await press(() => !it("Torch")?.system.equipped);
      await settle();

      // 6b (review #35). Each starts stowed, Torch off. Every write here that
      // is not a hold carries abNoStatusCard: the stubbed token is no
      // TokenDocument, and a change-log card asks it for a speaker.
      const handOf = (n) => sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${it(n)?.id}"] [data-action="itemToggleEquipped"]`);
      const T = out.torch2 = {};
      // A light Torch does not know (not in the radius table): held, unlit, no call.
      await pc.createEmbeddedDocuments("Item", [{ name: "Wraith Lantern", type: "item", sort: 700 }], { abNoStatusCard: true });
      await sleep(400);
      calls = []; state = "off";
      handOf("Wraith Lantern")?.click();
      await until(() => it("Wraith Lantern")?.system.equipped === true, 3000);
      await settle();
      T.unknown = { held: it("Wraith Lantern")?.system.equipped === true, calls: calls.map((c) => c[0]) };
      handOf("Wraith Lantern")?.click();
      await until(() => !it("Wraith Lantern")?.system.equipped, 3000);
      await settle();
      await pc.deleteEmbeddedDocuments("Item", [it("Wraith Lantern").id], { abNoStatusCard: true });
      await sleep(300);
      // A torch with no uses left: REFUSED (2026-11-21), never held.
      await it("Torch").update({ "system.uses.value": 0 }, { abNoStatusCard: true });
      await sleep(300);
      calls = []; state = "off";
      handOf("Torch")?.click();
      await until(() => it("Torch")?.system.equipped === true, 3000);
      await settle();
      T.exhausted = { held: it("Torch")?.system.equipped === true, calls: calls.map((c) => c[0]), state };
      if (it("Torch")?.system.equipped) {
        handOf("Torch")?.click();
        await until(() => !it("Torch")?.system.equipped, 3000);
        await settle();
      }
      await it("Torch").update({ "system.uses.value": 20 }, { abNoStatusCard: true });
      // Two lights by their row hands: one light is held at once, and the
      // token ends lit with the second.
      await pc.createEmbeddedDocuments("Item", [{ name: "Lantern", type: "item", sort: 800 }], { abNoStatusCard: true });
      await sleep(400);
      calls = []; state = "off";
      handOf("Torch")?.click();
      await until(() => it("Torch")?.system.equipped === true, 3000);
      await settle();
      calls = [];
      handOf("Lantern")?.click();
      await until(() => it("Lantern")?.system.equipped === true, 3000);
      await settle();
      const selects = calls.filter((c) => c[0] === "selectSource").map((c) => c[3]);
      T.second = { torch: it("Torch")?.system.equipped === true, lantern: it("Lantern")?.system.equipped === true,
        lastSelect: selects.at(-1) ?? null, state, calls: calls.map((c) => c[0]) };
      handOf("Lantern")?.click();
      await until(() => !it("Lantern")?.system.equipped, 3000);
      await settle();
      // A held, lit light marked Broken, and one deleted: put out.
      calls = []; state = "off";
      handOf("Torch")?.click();
      await until(() => it("Torch")?.system.equipped === true, 3000);
      await settle();
      calls = [];
      await it("Torch").update({ "system.broken": true }, { abNoStatusCard: true });
      await settle();
      T.broken = { calls: calls.map((c) => c[0]), state };
      await it("Torch").update({ "system.broken": false }, { abNoStatusCard: true });
      await settle();
      calls = []; state = "off";
      handOf("Lantern")?.click();
      await until(() => it("Lantern")?.system.equipped === true, 3000);
      await settle();
      calls = [];
      await pc.deleteEmbeddedDocuments("Item", [it("Lantern").id], { abNoStatusCard: true });
      await settle();
      T.deleted = { calls: calls.map((c) => c[0]), state };
      await sheet.close();
    } finally {
      game.Torch = realTorch;
      if (hadOwnGet) game.modules.get = realGet; else delete game.modules.get;
      if (pc) { await pc.sheet?.close(); await pc.delete(); }
    }
    return out;
  }, { fixture: FIXTURE });

  /* ---- 7: weapon data and the Gnarled Staff migration -------------------- */
  // The migration runs IN-PAGE with its marker read shadowed false and its
  // write swallowed: never a real marker write. It walks the whole world, so
  // every OTHER weapon whose bulky it changes is snapshotted and put back.
  r.gnarled = await gm.evaluate(async ({ fixture }) => {
    const flags = { "air-bladder": { probeFixture: fixture } };
    const GNARLED = "Compendium.air-bladder.background-items.Item.TSn8DasTWv7D9gWy";
    const SLING = "Compendium.air-bladder.weapons.Item.OCOPpIkkvUL5fZKQ";
    const out = {
      packStaff: (await fromUuid(GNARLED))?.system?.bulky ?? null,
      packSling: (await fromUuid(SLING))?.system?.damageFormula ?? null,
    };
    let mod = null;
    try {
      mod = await import("/systems/air-bladder/module/cairn.js");
    } catch (e) {
      out.importError = e.message;
    }
    if (typeof mod?.migrateGnarledStaff !== "function") {
      out.missing = true;
      return out;
    }
    const ns = game.system.id;
    const KEY = "gnarled-staff-unbulked";
    const origGet = game.settings.get;
    const origSet = game.settings.set;
    const sets = [];
    // Everything that is NOT this leg's: its bulky, read now, written back after.
    const others = [];
    for (const i of game.items) if (i.type === "weapon") others.push({ parent: null, id: i.id, bulky: i._source.system.bulky });
    for (const a of game.actors) for (const i of a.items) if (i.type === "weapon") others.push({ parent: a.id, id: i.id, bulky: i._source.system.bulky });
    let pc = null, loose = null;
    try {
      pc = await getDocumentClass("Actor").create({
        name: "ZZ Shield Staffs", type: "character", flags,
        items: [
          { name: "Gnarled Staff", type: "weapon", system: { damageFormula: "d8", bulky: true } },
          { name: "ZZ Old Staff", type: "weapon", system: { damageFormula: "d8", bulky: true }, _stats: { compendiumSource: GNARLED } },
          { name: "ZZ Halberd", type: "weapon", system: { damageFormula: "d10", bulky: true } },
          { name: "Gnarled Staff", type: "item", system: { bulky: true } },
        ],
      }, { abNoStatusCard: true });
      loose = await getDocumentClass("Item").create({ name: "Gnarled Staff", type: "weapon", system: { damageFormula: "d8", bulky: true }, flags });
      const slotsBefore = pc.system.slotsUsed;
      game.settings.get = function (scope, key, ...rest) {
        if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
        if (scope === ns && key === KEY) return false;
        return origGet.call(this, scope, key, ...rest);
      };
      game.settings.set = async function (scope, key, value, ...rest) {
        if (scope === ns && key === KEY) { sets.push(value); return value; }
        return origSet.call(this, scope, key, value, ...rest);
      };
      try {
        await mod.migrateGnarledStaff();
      } finally {
        game.settings.get = origGet;
        game.settings.set = origSet;
      }
      pc.reset();
      const w = (n, type = "weapon") => pc.items.find((i) => i.name === n && i.type === type)?._source.system.bulky ?? null;
      out.after = {
        staff: w("Gnarled Staff"), renamed: w("ZZ Old Staff"), halberd: w("ZZ Halberd"), notWeapon: w("Gnarled Staff", "item"),
        loose: game.items.get(loose.id)?._source.system.bulky ?? null,
        slots: [slotsBefore, pc.system.slotsUsed],
      };
      out.sets = sets;
      out.markerReal = game.settings.get(ns, KEY);
    } finally {
      game.settings.get = origGet;
      game.settings.set = origSet;
      for (const o of others) {
        const doc = o.parent ? game.actors.get(o.parent)?.items.get(o.id) : game.items.get(o.id);
        if (doc && doc._source.system.bulky !== o.bulky) await doc.update({ "system.bulky": o.bulky }, { abNoStatusCard: true });
      }
      if (pc) await pc.delete();
      if (loose) await loose.delete();
    }

    // 7b (review #35): WORLD compendiums. A planted Item pack (a bulky
    // "Gnarled Staff", an unticked "Shield") and Actor pack (an actor holding
    // an unticked "Hacked Shield" and a bulky staff), one locked; both
    // migrations run in-page with their markers shadowed. Every OTHER world
    // pack's staffs and shields are snapshotted and put back.
    if (typeof mod?.migrateShieldFlags !== "function") {
      out.packs = { missing: "migrateShieldFlags is not exported" };
      return out;
    }
    const CC = foundry.documents.collections.CompendiumCollection;
    const KEYS = new Set(["gnarled-staff-unbulked", "shield-flag-stamped"]);
    const touched = (i) => (i.type === "weapon" && i.name === "Gnarled Staff")
      || (i.type === "armor" && ["Shield", "Hacked Shield", "Steadymade Buckler"].includes(i.name));
    const packSnap = [];
    const packSets = [];
    let itemPack = null, actorPack = null;
    try {
      for (const p of game.packs) {
        if (p.metadata.packageType !== "world" || !["Item", "Actor"].includes(p.metadata.type)) continue;
        for (const d of await p.getDocuments()) {
          const items = p.metadata.type === "Item" ? [d] : [...d.items];
          for (const i of items.filter(touched)) {
            packSnap.push({ pack: p.collection, parent: p.metadata.type === "Actor" ? d.id : null, id: i.id,
              bulky: i._source.system.bulky, shield: i._source.system.shield });
          }
        }
      }
      itemPack = await CC.createCompendium({ label: "zz-shield-stamp-items", type: "Item" });
      actorPack = await CC.createCompendium({ label: "zz-shield-stamp-actors", type: "Actor" });
      const pStaff = { id: foundry.utils.randomID() }, pShield = { id: foundry.utils.randomID() };
      const pActor = { id: foundry.utils.randomID() };
      await getDocumentClass("Item").createDocuments([
        { _id: pStaff.id, name: "Gnarled Staff", type: "weapon", system: { damageFormula: "d8", bulky: true } },
        { _id: pShield.id, name: "Shield", type: "armor", system: { armor: 1, shield: false } },
      ], { pack: itemPack.collection, keepId: true });
      await getDocumentClass("Actor").createDocuments([{
        _id: pActor.id, name: "ZZ Pack Holder", type: "character",
        items: [
          { name: "Hacked Shield", type: "armor", system: { armor: 1, shield: false } },
          { name: "Gnarled Staff", type: "weapon", system: { damageFormula: "d8", bulky: true } },
        ],
      }], { pack: actorPack.collection, keepId: true });
      await itemPack.configure({ locked: true });
      game.settings.get = function (scope, key, ...rest) {
        if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
        if (scope === ns && KEYS.has(key)) return false;
        return origGet.call(this, scope, key, ...rest);
      };
      game.settings.set = async function (scope, key, value, ...rest) {
        if (scope === ns && KEYS.has(key)) { packSets.push([key, value]); return value; }
        return origSet.call(this, scope, key, value, ...rest);
      };
      try {
        await mod.migrateGnarledStaff();
        await mod.migrateShieldFlags();
      } finally {
        game.settings.get = origGet;
        game.settings.set = origSet;
      }
      const ps = await itemPack.getDocument(pStaff.id);
      const psh = await itemPack.getDocument(pShield.id);
      const pa = await actorPack.getDocument(pActor.id);
      out.packs = {
        staff: ps?._source.system.bulky ?? null,
        shield: psh?._source.system.shield ?? null,
        actorShield: pa?.items.find((i) => i.name === "Hacked Shield")?._source.system.shield ?? null,
        actorStaff: pa?.items.find((i) => i.name === "Gnarled Staff")?._source.system.bulky ?? null,
        relocked: itemPack.locked,
        sets: packSets,
      };
    } catch (e) {
      out.packs = { error: e.stack ?? e.message };
    } finally {
      game.settings.get = origGet;
      game.settings.set = origSet;
      for (const s of packSnap) {
        const p = game.packs.get(s.pack);
        if (!p) continue;
        const wasLocked = p.locked;
        if (wasLocked) await p.configure({ locked: false });
        try {
          const doc = s.parent ? (await p.getDocument(s.parent))?.items.get(s.id) : await p.getDocument(s.id);
          if (doc && (doc._source.system.bulky !== s.bulky || doc._source.system.shield !== s.shield)) {
            await doc.update({ "system.bulky": s.bulky, "system.shield": s.shield }, { abNoStatusCard: true });
          }
        } finally {
          if (wasLocked) await p.configure({ locked: true });
        }
      }
      for (const p of [itemPack, actorPack]) {
        if (!p) continue;
        try { await p.configure({ locked: false }); await p.deleteCompendium(); } catch (e) { out.packCleanup = e.message; }
      }
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
// Leg 3, rewritten by leg 6: both switches are always drawn.
// Since 2026-11-21 with none carried: greyed, "No Shield" under the slashed
// shield, "No Light" under the neutral lantern.
const greyed = (x, tip) => !!x && x.present && x.disabled === true && x.checked === "false" && x.label === u.wantNoShield
  && u.wantNoShield !== "CAIRN.NoShield" && x.icon === "shield-disabled" && x.tip === tip;
const greyedLight = (x, tip) => !!x && x.present && x.disabled === true && x.checked === "false" && x.tip === tip
  && x.label === u.wantNoLight && u.wantNoLight !== "CAIRN.NoLight" && x.icon === "lantern-flame";
greyed(u.none, u.wantShieldNone) && greyed(u.helmetOnly, u.wantShieldNone)
  && greyedLight(u.none?.light, u.wantLightNone) && greyedLight(u.helmetOnly?.light, u.wantLightNone)
  ? ok(`with no shield (or only a helmet) and no light, both badges are greyed: "${u.wantNoShield}" (slashed shield) and "${u.wantNoLight}", saying "${u.wantShieldNone}" / "${u.wantLightNone}"`)
  : fail(`switches without a shield or a light: ${JSON.stringify({ none: u.none, helmetOnly: u.helmetOnly, want: [u.wantShieldNone, u.wantLightNone] })}`);
const sl = u.slung ?? {};
sl.disabled === false && sl.tip === null
  ? ok("a live Hold shield switch carries no tooltip")
  : fail(`live shield switch: disabled ${sl.disabled}, tooltip ${JSON.stringify(sl.tip)}`);
sl.present && sl.label === u.wantHold && u.wantHold !== "CAIRN.EquipShield" && sl.icon === "shield" && sl.loads && sl.below && sl.leftOfLight
  && sl.checked === "false" && sl.glyph === null && sl.labelInk && sl.filter === "none" && sl.armor === "1"
  && sl.armorLook?.right && sl.armorLook.size > 12 && sl.armorLook.shieldW < 54 && sl.armorLook.shieldH < 60
  ? ok(`with a slung shield, the Shield badge "${sl.label}" stands under the Armor box, left of the light's, off (no switch glyph, full ink), Armor ${sl.armor}, "Armor" right of a ${sl.armorLook?.shieldW}x${sl.armorLook?.shieldH} shield at ${sl.armorLook?.size}px`)
  : fail(`slung: ${JSON.stringify(sl)} (want ${JSON.stringify(u.wantHold)}, game-icons shields/shield.svg, under the Armor box)`);
const he = u.held ?? {};
he.equipped === true && he.checked === "true" && he.label === u.wantInHand && u.wantInHand !== "CAIRN.ShieldEquipped" && he.glyph === null && he.labelInk
  && he.icon === "shield-bash" && he.loads && he.color !== sl.color && he.filter && he.filter !== "none" && he.armor === "2"
  ? ok(`a press holds it: equipped, "${he.label}", glowing (${he.color}), Armor ${he.armor}`)
  : fail(`held: ${JSON.stringify(he)} (want ${JSON.stringify(u.wantInHand)}, slung colour ${sl.color})`);
const rs = u.reslung ?? {};
rs.equipped === false && rs.checked === "false" && rs.label === u.wantHold && rs.icon === "shield" && rs.glyph === null && rs.filter === "none" && rs.armor === "1"
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
// 6
const lt = r.light ?? {};
const hs = lt.hands ?? {};
hs.torch && hs.lantern && hs.glowsnail && hs.sunStick && !hs.oil && !hs.rope
  ? ok("a Torch, a Lantern, the Glowsnail and the Sun Stick show the hand; the Oil Can (fuel) and a rope do not")
  : fail(`light hands: ${JSON.stringify(hs)}`);
const lw = lt.want ?? {};
const lp = lt.place ?? {};
lp.label === lt.wantLight && lt.wantLight !== "CAIRN.EquipLight" && lp.disabled === false && lp.checked === "false" && lp.tip === lw.noneHeld
  && lp.radius === null && lp.icon === "torch" && lp.loads && lp.right && lp.beside && lp.glyph === null
  ? ok(`the light badge stands under the Armor box, right of the shield's: the first light's own icon (a torch, unlit), "${lp.label}", "${lp.tip}", no radius`)
  : fail(`light badge, none held: ${JSON.stringify(lp)} (want label ${JSON.stringify(lt.wantLight)}, tip ${JSON.stringify(lw.noneHeld)})`);
const pk = lt.picker ?? {};
pk.opened && pk.prompt === lw.prompt && JSON.stringify(pk.ids) === JSON.stringify(pk.order)
  && pk.rows?.[0]?.includes("Torch") && pk.rows[0].includes(lw.bright)
  && pk.rows?.[2]?.includes("Glowsnail") && pk.rows[2].includes(lw.dimOnly)
  ? ok(`several lights, none held: a press asks "${pk.prompt}", listing each in order with its radius`)
  : fail(`light picker: ${JSON.stringify(pk)} (want prompt ${JSON.stringify(lw.prompt)}, ${JSON.stringify(lw.bright)} / ${JSON.stringify(lw.dimOnly)})`);
JSON.stringify(pk.afterCancel) === "[]" && JSON.stringify(pk.held) === JSON.stringify(["Lantern"])
  ? ok("Cancel holds nothing; picking the Lantern holds the Lantern alone")
  : fail(`picker outcome: cancel ${JSON.stringify(pk.afterCancel)}, pick ${JSON.stringify(pk.held)}`);
const lb = lt.lanternBadge ?? {};
lb.checked === "true" && lb.icon === "lantern-flame" && lb.loads && lb.radius === lw.bright && lb.tip === lw.heldLantern
  && lb.color !== lp.color && lb.filter && lb.filter !== "none"
  && lb.label === lt.wantLightOn && lt.wantLightOn !== "CAIRN.LightEquipped" && lb.glyph === null
  ? ok(`held, the badge glows (${lb.color}, ${lb.filter}), says "${lb.label}" and reads "${lb.radius}", "${lb.tip}"`)
  : fail(`lantern badge: ${JSON.stringify(lb)} (none-held colour ${lp.color}, want label ${JSON.stringify(lt.wantLightOn)})`);
const st = lt.stowed ?? {};
JSON.stringify(st.held) === "[]" && !st.picker && st.badge?.checked === "false" && st.badge?.radius === null
  && st.badge?.label === lt.wantLight
  ? ok(`with two held, one press puts both away, with no picker, back to "${lt.wantLight}"`)
  : fail(`stow all: ${JSON.stringify(st)}`);
const tb = lt.torchBadge ?? {};
tb.checked === "true" && !tb.picker && tb.icon === "torch" && tb.loads && tb.radius === lw.bright && tb.tip === lw.heldTorch
  && tb.label === lt.wantLightOn && tb.uses === 19
  ? ok(`with one light, a press equips it at once: the torch icon, its radius, "${tb.label}", and one use spent (20 -> ${tb.uses})`)
  : fail(`single light: ${JSON.stringify(tb)}`);
const tx = lt.texts ?? {};
tx.darkness === tx.wantDark && tx.none === "" && tx.alias === lw.bright
  ? ok(`the darkness light reads "${tx.darkness}"; a light with no numbers reads nothing; "Torches" reads as a Torch`)
  : fail(`radius texts: ${JSON.stringify(tx)}`);
const tc = lt.torch ?? {};
const lightCalls = [["selectSource", "zzSceneProbe0001", "zzTokenProbe0001", "Torch"], ["currentState", "zzSceneProbe0001", "zzTokenProbe0001"], ["toggle", "zzSceneProbe0001", "zzTokenProbe0001"]];
const outCalls = [["extinguish", "zzSceneProbe0001", "zzTokenProbe0001"]];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
same(tc.switch?.on, lightCalls) && same(tc.switch?.off, outCalls)
  ? ok("with Torch active and a token, Hold light selects the Torch and lights it; a stow puts it out")
  : fail(`Torch via the switch: ${JSON.stringify(tc.switch)}`);
same(tc.hand, tc.switch)
  ? ok("the row's hand takes the very same path")
  : fail(`Torch via the hand: ${JSON.stringify(tc.hand)} (switch ${JSON.stringify(tc.switch)})`);
same(tc.lit, lightCalls.slice(0, 2))
  ? ok("a light Torch already has lit is selected, not toggled out")
  : fail(`already lit: ${JSON.stringify(tc.lit)}`);
tc.noToken?.calls === 0 && tc.noToken?.held && tc.inactive?.calls === 0 && tc.inactive?.held
  ? ok("no token on the viewed scene, or Torch inactive: no call, and the hold stands")
  : fail(`no token / inactive: ${JSON.stringify({ noToken: tc.noToken, inactive: tc.inactive })}`);
tc.throwing?.calls >= 1 && tc.throwing?.held
  ? ok("Torch throwing: the hold stands (the console-error check below covers the rest)")
  : fail(`Torch throwing: ${JSON.stringify(tc.throwing)}`);
// 6b
const T2 = lt.torch2 ?? {};
T2.unknown?.held && !T2.unknown.calls.includes("selectSource") && !T2.unknown.calls.includes("toggle")
  ? ok("a light Torch does not know is held but not lit: no select, no toggle")
  : fail(`unknown light: ${JSON.stringify(T2.unknown)}`);
T2.exhausted && !T2.exhausted.held && T2.exhausted.calls.length === 0 && T2.exhausted.state === "off"
  ? ok("a torch with no uses left is refused: not equipped, no Torch call")
  : fail(`exhausted torch: ${JSON.stringify(T2.exhausted)}`);
T2.second && !T2.second.torch && T2.second.lantern && T2.second.lastSelect === "Lantern" && T2.second.state === "on"
  ? ok("a second light's hand puts the first away: one light held, the token lit with the second")
  : fail(`second light: ${JSON.stringify(T2.second)}`);
T2.broken?.calls.includes("extinguish") && T2.broken.state === "off"
  ? ok("a held, lit light marked Broken is put out")
  : fail(`broken held light: ${JSON.stringify(T2.broken)}`);
T2.deleted?.calls.includes("extinguish") && T2.deleted.state === "off"
  ? ok("a held, lit light deleted from the sheet is put out")
  : fail(`deleted held light: ${JSON.stringify(T2.deleted)}`);
// 8
const bo = r.book ?? {};
const bw = bo.want ?? {};
const bn = bo.none ?? {};
bn.present && bn.disabled === true && bn.checked === "false" && bn.label === bw.none && bw.none !== "CAIRN.NoBook"
  && bn.tip === bw.noneTip && bn.icon === "spell-book" && bn.loads && bn.rightOfLight
  ? ok(`with no book, the book badge stands right of the light's, greyed: "${bn.label}", "${bn.tip}"`)
  : fail(`book badge, none: ${JSON.stringify(bn)} (want ${JSON.stringify([bw.none, bw.noneTip])})`);
const b1 = bo.one ?? {};
b1.off?.label === bw.off && b1.off?.glyph === null && b1.off?.disabled === false && b1.off?.icon === "spell-book"
  && b1.on?.equipped === true && !b1.on.picker && b1.on.checked === "true" && b1.on.label === bw.on && b1.on.glyph === null && b1.on.loads
  && b1.after?.equipped === false && b1.after.label === bw.off
  ? ok(`one spellbook: "${bw.off}", a press equips it at once ("${bw.on}"), a second puts it away`)
  : fail(`one book: ${JSON.stringify(b1)} (want ${JSON.stringify([bw.off, bw.on])})`);
const b3 = bo.three ?? {};
b3.hands?.scroll && b3.hands.book && b3.hands.grimoire && !b3.hands.page
  ? ok("a scroll, a spellbook and the Grimoire show the row's hand; a bound page does not")
  : fail(`book hands: ${JSON.stringify(b3.hands)}`);
b3.off?.label === bw.offScroll && b3.off?.icon === "tied-scroll"
  ? ok(`with a scroll first in the inventory, the badge reads "${b3.off.label}" under the scroll`)
  : fail(`book badge, scroll first: ${JSON.stringify(b3.off)} (want ${JSON.stringify(bw.offScroll)})`);
b3.picker?.opened && b3.picker.prompt === bw.prompt && JSON.stringify(b3.picker.ids) === JSON.stringify(b3.picker.order)
  && JSON.stringify(b3.afterCancel) === "[]"
  ? ok(`several books, none equipped: a press asks "${b3.picker.prompt}", listing all three (never the bound page); Cancel equips nothing`)
  : fail(`book picker: ${JSON.stringify({ picker: b3.picker, afterCancel: b3.afterCancel })}`);
JSON.stringify(b3.scroll?.equipped) === JSON.stringify(["ZZ Book Scroll"]) && b3.scroll.label === bw.onScroll
  && b3.scroll.tip === bw.tipScroll && b3.scroll.icon === "tied-scroll"
  ? ok(`picking the scroll equips it alone: "${b3.scroll.label}", "${b3.scroll.tip}"`)
  : fail(`scroll picked: ${JSON.stringify(b3.scroll)} (want ${JSON.stringify([bw.onScroll, bw.tipScroll])})`);
JSON.stringify(b3.grimoire?.equipped) === JSON.stringify(["ZZ Book Grimoire"]) && b3.grimoire.label === bw.onGrimoire
  && b3.grimoire.icon === "book-aura"
  ? ok(`the Grimoire's row hand equips it and puts the scroll away: "${b3.grimoire.label}"`)
  : fail(`grimoire by its hand: ${JSON.stringify(b3.grimoire)}`);
JSON.stringify(b3.stowed?.equipped) === "[]" && !b3.stowed.picker
  ? ok("one press puts the equipped book away, with no picker")
  : fail(`book stowed: ${JSON.stringify(b3.stowed)}`);
// 7
const gn = r.gnarled ?? {};
gn.packStaff === false && gn.packSling === "1d6"
  ? ok("the compendium Gnarled Staff is not Bulky, and the compendium Sling rolls 1d6")
  : fail(`pack weapons: staff bulky ${gn.packStaff}, sling ${gn.packSling}`);
const ga = gn.after ?? {};
!gn.missing && ga.staff === false && ga.renamed === false && ga.loose === false && ga.halberd === true && ga.notWeapon === true
  && ga.slots?.[1] === ga.slots?.[0] - 2
  ? ok(`the migration unbulks a Gnarled Staff, a renamed copy and a world one (slots ${ga.slots?.[0]} -> ${ga.slots?.[1]}); a halberd and a non-weapon stay Bulky`)
  : fail(`Gnarled Staff migration: ${JSON.stringify(gn)}`);
!gn.missing && JSON.stringify(gn.sets) === "[true]" && gn.markerReal !== undefined
  ? ok("...and it sets its marker once (shadowed: never a real write)")
  : fail(`Gnarled Staff marker: ${JSON.stringify({ sets: gn.sets, real: gn.markerReal, missing: gn.missing, importError: gn.importError })}`);
// 7b
const gp = gn.packs ?? {};
gp.staff === false && gp.shield === true && gp.actorShield === true && gp.actorStaff === false && gp.relocked === true
  ? ok("both migrations reach WORLD compendiums: a pack's staff unbulked and shield ticked, an Actor pack's too; a locked pack is locked again")
  : fail(`world-pack stamps: ${JSON.stringify(gp)}`);
errors.length === 0 ? ok("no console errors") : fail(`console errors: ${errors.join(" | ")}`);

await browser.close();
if (failed) {
  console.error("\nshield e2e FAILED");
  process.exit(1);
}
console.log("\nshield e2e passed");

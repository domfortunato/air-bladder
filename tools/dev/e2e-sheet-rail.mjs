#!/usr/bin/env node
/**
 * The character sheet's thumb-tab rail and its five pages (2026-11-19, the
 * sheet laid out after Base Knavery's).
 *
 *   npm run dev:sheet-rail
 *
 * A player character's sheet is narrow (480 x 700) and its pages are turned
 * from a column of icon buttons hung off the window's edge
 * (templates/parts/tab-rail.html, placed by module/actor/tab-rail.js):
 * Character, Inventory, Growth, Background & Notes (Description until round 4), then the
 * Attack window. The npc sheet keeps its text tab strip. What this holds:
 *
 *   1. the frame: `cairn-railed` + `cairn-character-sheet`, 480 x 700;
 *   2. the rail: a direct child of .window-content, the five pages in order,
 *      each with its approved icon and tooltip (Inventory's carries the slot
 *      count), and a fresh sheet standing on Character;
 *   3. every rail button turns to its own page, and only that page shows;
 *   4. the rail hangs OUTSIDE the frame on the right, flips to the left when
 *      the window stands at the screen's right edge, and flips back;
 *      `railHangsLeft` agrees, case by case;
 *   5. Growth holds Cairn's Growth sentence, the Scars and the growth journal;
 *      Description no longer holds the Scars;
 *   6. what is written to `system.growth` shows in the journal. That the SERVER
 *      sanitizes it (system.json's htmlFields, the security control) is
 *      `dev:sanitize`'s, which writes it as a real player;
 *   7. the rail's burst opens the Attack window (every attack; 2026-11-19 the
 *      user corrected the first cut, which opened the improvised attack only);
 *   8. an npc sheet draws no rail and keeps its strip;
 *   9. a player OBSERVING the character can turn its pages (the rail stays live
 *      on a sheet they cannot edit) and is offered no Attack;
 *  10. a LIMITED viewer's rail is hidden and empty.
 *
 * Added 2026-11-19 (user asks, the second round):
 *   3b. the "For Use With Cairn" footer stands under EVERY page (outside the
 *      pages, as Base Knavery's Made for Knave footer), once;
 *  11. page 1 carries an Attack button under Die of Fate, the rail's red burst,
 *      the same action, live on a sheet the viewer cannot edit;
 *  12. Deprived (over Panicked) stands in the vitals column, under HP and above
 *      Slots and Rest;
 *  13. a click on the slot line, or on the Overburdened banner, turns to
 *      Inventory.
 *  14. (the third round) Pronouns and Age stand under the name; a hireling's
 *      trait pick-lists render OPEN, its pronouns kept on its own sheet.
 *  15. (the fourth round) the Background field is labelled "Background" and
 *      drawn as a field, the Pronouns input's own box, on both branches; a
 *      click on a generated background's name opens the picker. The trait
 *      sentence is page 1's left column's first child, above STR, in sentence
 *      case and in the background description's font size; in Character
 *      Creation Mode it ends in a pen that opens a Traits window with every
 *      picker (a die fills its select and writes nothing, Save writes and
 *      closes, the close button discards), and with no traits the pen still
 *      shows, labelled "Traits"; Creation Mode off, no pen. There is no
 *      Description page (a sheet remembering it lands on Character); Omen and
 *      the character's own Description stand on Background & Notes, with a
 *      rule between every item; the slot line reads "Inventory Slots", or
 *      "Slots" where the long label would clip.
 *  16. (the fifth round, user asks 2026-11-20) one header row over STR names
 *      the ability columns "Current" and "Max", each word centred over its
 *      box; HP's two numbers carry the same words; HP's box fills in
 *      proportion to HP / max (Base Knavery's bar colours: one colour at full,
 *      another below it, a red frame at 0); Inventory opens on the hint
 *      "Click an item to expand its description", first, in full ink, on the
 *      npc sheet too.
 *  17. (the sixth round, user asks 2026-11-20) the Inventory hint shares its
 *      row with Fatigue's controls; HP's box carries + and − in its "HP"
 *      half, + to the left of the label and − to the right (the user's
 *      order), one point each, off at max / 0 and while overburdened.
 *
 * Red-first: run against the commit before the redesign, every leg but 8 and
 * 10 fails (no rail, no growth page, no growth field).
 */
import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAs, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const FIXTURE = "sheet-rail";
const browser = await chromium.launch();
watchdog(360000, "sheet-rail probe", async () => { try { await browser.close(); } catch { /* gone */ } });
const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(gm);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

let r = null;
let p = null;
const cleanup = async () => {
  try {
    await gm.evaluate(async (fixture) => {
      for (const a of game.actors.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) {
        await a.sheet?.close();
        await a.delete();
      }
    }, FIXTURE);
  } catch (e) {
    console.error(`  note  cleanup: ${e.message}`);
  }
};

try {
  await joinAsGM(gm);
  await dismissChrome(gm);
  // Stale state must not satisfy a precondition: anything a crashed run left.
  await cleanup();

  r = await gm.evaluate(async (fixture) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const L = (k) => game.i18n.localize(k);
    const out = {};
    const alice = game.users.getName("Alice");
    out.aliceId = alice?.id ?? null;

    const pc = await getDocumentClass("Actor").create({
      name: "ZZ Rail PC", type: "character",
      // An age and a trait, so the trait sentence has something to say (leg 14).
      // Creation Mode ON: a new character's schema default is off, and the
      // pen (leg 15) rides the mode.
      system: { hp: { value: 4, max: 6 }, age: "30", traits: { physique: "Athletic" }, generationEnabled: true },
      ownership: alice ? { default: 0, [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } : { default: 0 },
      flags: { "air-bladder": { probeFixture: fixture } },
    }, { abNoStatusCard: true });
    out.pcId = pc.id;

    const sheet = pc.sheet;
    await sheet.render(true);
    await until(() => sheet.element?.querySelector?.("nav.cairn-tab-rail button") || sheet.element?.querySelector?.(".tab"));
    await sleep(500);
    const frame = sheet.element;
    const content = frame.querySelector(":scope > .window-content");

    /* ---- 1. the frame -------------------------------------------------- */
    out.frame = {
      railed: frame.classList.contains("cairn-railed"),
      character: frame.classList.contains("cairn-character-sheet"),
      width: sheet.position.width, height: sheet.position.height,
    };

    /* ---- 2. the rail --------------------------------------------------- */
    const rail = content?.querySelector(":scope > nav.cairn-tab-rail");
    out.rail = {
      present: !!rail,
      pages: [...(rail?.querySelectorAll('button[data-action="tab"]') ?? [])].map((b) => ({
        tab: b.dataset.tab,
        icon: b.querySelector("i")?.className ?? null,
        tip: b.dataset.tooltipText ?? null,
        aria: b.getAttribute("aria-label"),
      })),
      activeTab: rail?.querySelector('button[data-action="tab"].active')?.dataset.tab ?? null,
      activePage: content?.querySelector(".tab.active[data-group='primary']")?.dataset.tab ?? null,
      label: rail?.getAttribute("aria-label") ?? null,
    };
    out.expectTips = {
      character: L("CAIRN.Tab.Character"),
      items: game.i18n.format("CAIRN.Tab.InventoryCount", { used: pc.system.slotsUsed, max: pc.system.slotsMax }),
      growth: L("CAIRN.Tab.Growth"),
      notes: L("CAIRN.BackgroundAndNotes"),
      rail: L("CAIRN.Tab.Rail"),
    };
    out.showContainers = !!pc.system.showContainersTab;

    /* ---- 3. every button turns to its own page -------------------------- */
    out.turns = [];
    for (const b of [...(rail?.querySelectorAll('button[data-action="tab"]') ?? [])].reverse()) {
      const id = b.dataset.tab;
      b.click();
      await until(() => frame.querySelector(`.tab[data-group="primary"][data-tab="${id}"]`)?.classList.contains("active"));
      const shown = [...frame.querySelectorAll('.tab[data-group="primary"]')]
        .filter((t) => t.getBoundingClientRect().height > 0).map((t) => t.dataset.tab);
      // The "For Use With Cairn" footer under EVERY page: outside the pages,
      // drawn, its stamp loaded, and below the page it closes.
      const foot = frame.querySelector(".cairn-character > .cairn-compat-footer");
      const img = foot?.querySelector("img");
      if (img && !img.complete) await new Promise((res) => { img.onload = img.onerror = res; });
      const page = frame.querySelector(`.tab[data-group="primary"][data-tab="${id}"]`);
      const footer = !!foot && !foot.closest(".tab") && foot.getBoundingClientRect().height > 0
        && (img?.naturalWidth ?? 0) > 0
        && foot.getBoundingClientRect().top >= (page?.getBoundingClientRect().bottom ?? Infinity) - 1;
      out.turns.push({ id, shown, pressed: b.getAttribute("aria-pressed"), footer });
    }

    /* ---- 4. the rail hangs outside, and flips at the screen's edge ------ */
    const boxes = () => {
      const f = frame.getBoundingClientRect();
      const g = frame.querySelector(":scope > .window-content > nav.cairn-tab-rail")?.getBoundingClientRect();
      return { fl: f.left, fr: f.right, rl: g?.left ?? null, rr: g?.right ?? null,
        left: frame.classList.contains("cairn-rail-left"),
        dir: frame.querySelector("nav.cairn-tab-rail button")?.dataset.tooltipDirection ?? null };
    };
    sheet.setPosition({ left: 100, top: 60 });
    await sleep(400);
    out.placeRight = boxes();
    sheet.setPosition({ left: window.innerWidth - sheet.position.width - 4 });
    await sleep(400);
    out.placeEdge = boxes();
    sheet.setPosition({ left: 100 });
    await sleep(400);
    out.placeBack = boxes();
    const mod = await import("/systems/air-bladder/module/actor/tab-rail.js");
    out.unit = [
      mod.railHangsLeft({ left: 100, right: 580 }, 44, 1600) === false,   // room on the right
      mod.railHangsLeft({ left: 1100, right: 1580 }, 44, 1600) === true,  // 20px right, 1100 left
      mod.railHangsLeft({ left: 0, right: 1590 }, 44, 1600) === false,    // no room either side: stay right
      mod.railHangsLeft({ left: 1100, right: 1556 }, 44, 1600) === false, // exactly fits
    ];

    /* ---- 5. Growth and Description ------------------------------------- */
    await sheet.changeTab("growth", "primary");
    await sleep(300);
    const growth = frame.querySelector('.tab[data-tab="growth"]');
    const desc = frame.querySelector('.tab[data-tab="description"]');
    out.growth = {
      intro: growth?.querySelector(".cairn-growth-intro")?.textContent.trim() ?? null,
      expectIntro: L("CAIRN.Growth.Intro"),
      scars: !!growth?.querySelector(".scar-section .scar-enable"),
      journal: !!growth?.querySelector('prose-mirror[name="system.growth"]'),
      placeholder: growth?.querySelector('prose-mirror[name="system.growth"] .cairn-editor-placeholder')?.textContent.trim() ?? null,
      expectPlaceholder: L("CAIRN.Growth.JournalPlaceholder"),
      heading: growth?.querySelector(".cairn-growth-heading")?.textContent.trim() ?? null,
      expectHeading: L("CAIRN.Growth.Journal"),
      descScars: !!desc?.querySelector(".scar-section"),
      footers: frame.querySelectorAll(".cairn-compat-footer").length,
    };

    /* ---- 14. Pronouns and Age under the name ---------------------------- */
    {
      const page1 = frame.querySelector('.tab[data-tab="character"]');
      const band = page1?.querySelector(".cairn-band");
      const identity = page1?.querySelector(".cairn-head .cairn-identity");
      const kindOf = (keys) => (c) => keys.find((k) => c.classList.contains(k)) ?? "?";
      const bioLine = identity?.querySelector(":scope > .identity-bio-line");
      out.bio = {
        // Gold alone: the sentence left the band in round 4 (leg 15).
        band: [...(band?.children ?? [])].map(kindOf(["band-gold", "trait-sentence"])),
        // The name line, then Pronouns and Age, then the background line.
        identity: [...(identity?.children ?? [])].slice(0, 3).map(kindOf(["name-line", "identity-bio-line", "background-line"])),
        pronounsInput: !!bioLine?.querySelector('.pronouns-row input[name="system.pronouns"]'),
        ageInput: !!bioLine?.querySelector('.age-row input[name="system.age"]'),
      };
    }

    /* ---- 6. the journal shows what is stored --------------------------- */
    await pc.update({ "system.growth": "<p>ZZ grew in the world</p>" });
    const journal = () => frame.querySelector('.tab[data-tab="growth"] prose-mirror[name="system.growth"]');
    await until(() => journal()?.textContent.includes("ZZ grew in the world"));
    out.journal = {
      stored: pc._source.system.growth ?? null,
      shown: journal()?.textContent.includes("ZZ grew in the world") ?? false,
      placeholderGone: !journal()?.querySelector(".cairn-editor-placeholder"),
    };

    /* ---- 7. the rail's Attack ------------------------------------------ */
    const atk = frame.querySelector("nav.cairn-tab-rail button.cairn-rail-attack");
    out.attack = { present: !!atk, action: atk?.dataset.action ?? null };
    if (atk) {
      const stale = new Set(document.querySelectorAll(".application.dialog"));
      atk.click();
      let dlg = null;
      const t0 = Date.now();
      while (!(dlg = [...document.querySelectorAll(".application.dialog")].find((d) => !stale.has(d))) && Date.now() - t0 < 5000) await sleep(100);
      out.attack.dialog = !!dlg?.classList.contains("cairn-attack-dialog");
      dlg?.querySelector('[data-action="close"]')?.click();
      const t1 = Date.now();
      while (dlg?.isConnected && Date.now() - t1 < 5000) await sleep(100);
    }

    /* ---- 11. page 1's Attack button, under Die of Fate ------------------ */
    await sheet.changeTab("character", "primary");
    await sleep(300);
    const fate = frame.querySelector("#die-of-fate-button");
    const btn = frame.querySelector('.tab[data-tab="character"] .cairn-vital-buttons [data-action="attack"]');
    out.button = { present: !!btn, live: btn?.hasAttribute("data-always-live") ?? false,
      afterFate: !!fate && fate.nextElementSibling === btn,
      below: !!fate && !!btn && btn.getBoundingClientRect().top >= fate.getBoundingClientRect().bottom - 1,
      burst: btn?.querySelector("i")?.classList.contains("fa-burst") ?? false,
      // The rail's burst is red (--ab-peril); the button's must be the same red.
      red: btn && atk ? getComputedStyle(btn.querySelector("i")).color === getComputedStyle(atk.querySelector("i")).color : false };
    if (btn) {
      const stale = new Set(document.querySelectorAll(".application.dialog"));
      btn.click();
      let dlg = null;
      const t0 = Date.now();
      while (!(dlg = [...document.querySelectorAll(".application.dialog")].find((d) => !stale.has(d))) && Date.now() - t0 < 5000) await sleep(100);
      out.button.dialog = !!dlg?.classList.contains("cairn-attack-dialog");
      dlg?.querySelector('[data-action="close"]')?.click();
      const t1 = Date.now();
      while (dlg?.isConnected && Date.now() - t1 < 5000) await sleep(100);
    }

    /* ---- 12. Deprived over Panicked, between HP and Slots --------------- */
    {
      const top = (sel) => frame.querySelector(`.tab[data-tab="character"] ${sel}`)?.getBoundingClientRect() ?? null;
      const hp = top(".cairn-vitals .hp-counter"), dep = top(".cairn-vitals .cairn-states .band-deprived");
      const pan = top(".cairn-vitals .cairn-states .band-panicked"), slots = top(".cairn-vitals .cairn-slots-line");
      const rest = top("#rest-button");
      out.states = { usePanic: !!pc.system.usePanic, hp: !!hp, dep: !!dep, pan: !!pan, slots: !!slots, rest: !!rest,
        inBand: !!frame.querySelector(".cairn-band .band-deprived, .cairn-band .band-panicked"),
        order: !!(hp && dep && slots && rest) && dep.top >= hp.bottom - 1
          && (pan ? pan.top >= dep.bottom - 1 && slots.top >= pan.bottom - 1 : slots.top >= dep.bottom - 1)
          && rest.top >= slots.bottom - 1 };
    }

    /* ---- 13. the slot line and the Overburdened banner open Inventory --- */
    {
      const limitOn = game.settings.get("air-bladder", "character-inventory-limit");
      const onItems = () => frame.querySelector('.tab[data-tab="items"]')?.classList.contains("active") ?? false;
      out.toInventory = { limitOn };
      await sheet.changeTab("character", "primary");
      await sleep(200);
      frame.querySelector(".cairn-slots-line")?.click();
      await until(onItems, limitOn ? 2000 : 1000);
      out.toInventory.slots = onItems();
      // Overburdened: a pack heavier than any slot limit (raw embedded create,
      // under the capacity guard, which lives in createOwnedItem).
      const [load] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Rail Load", type: "item", system: { quantity: 40 } }]);
      await until(() => frame.querySelector(".status-banner.status-encumbered"));
      await sheet.changeTab("growth", "primary");
      await sleep(200);
      const banner = frame.querySelector(".status-banner.status-encumbered");
      out.toInventory.banner = !!banner;
      banner?.click();
      await until(onItems);
      out.toInventory.bannerTurns = onItems();
      await load?.delete();
    }

    /* ---- 15. round 4: the Background field, the sentence and its editor,
            Description retired, Omen and rules on Background & Notes ------ */
    const msgsBefore = new Set(game.messages.map((m) => m.id));
    const newDialog = async (stale) => {
      let d = null;
      const t0 = Date.now();
      while (!(d = [...document.querySelectorAll(".application")].find((x) => !stale.has(x) && x !== frame)) && Date.now() - t0 < 5000) await sleep(100);
      return d;
    };
    const closeApp = async (d) => {
      d?.querySelector('header [data-action="close"]')?.click();
      const t0 = Date.now();
      while (d?.isConnected && Date.now() - t0 < 5000) await sleep(100);
      return !d?.isConnected;
    };
    // The field look: the Pronouns input's own box, property by property.
    const BOX = ["backgroundColor", "borderTopStyle", "borderTopWidth", "borderTopColor", "borderTopLeftRadius", "height"];
    const boxOf = (node) => { const cs = node ? getComputedStyle(node) : null; return Object.fromEntries(BOX.map((k) => [k, cs?.[k] ?? null])); };
    const fieldLike = (node, root) => {
      const want = boxOf(root.querySelector(".identity-bio-line .pronouns-row .trait-input"));
      const got = boxOf(node);
      return { same: !!node && BOX.every((k) => got[k] === want[k]), got, want };
    };
    out.r4 = {};
    {
      const R = out.r4;
      await sheet.changeTab("character", "primary");
      await sleep(300);
      // a. hand-made branch: label, then the input, drawn as a field.
      const line = frame.querySelector(".tab[data-tab='character'] .background-line");
      const first = line?.firstElementChild;
      R.hand = {
        label: first?.matches("label.background-label") ? first.textContent.trim() : null,
        next: first?.nextElementSibling?.matches("input.background-input") ?? false,
        box: fieldLike(line?.querySelector(".background-input"), frame),
      };
      R.expectLabel = L("CAIRN.Background");
      // e. the slot line: the long label where it fits, never clipped.
      const slots = frame.querySelector(".cairn-slots-line");
      const lab = slots?.querySelector(".slots-label");
      R.slots = { text: lab?.textContent.trim() ?? null, short: lab?.dataset.short ?? null,
        long: L("CAIRN.InventorySlots"), shortWant: L("CAIRN.Slots"),
        clips: slots ? slots.scrollWidth > slots.clientWidth : null };
      // c. no Description page, and a sheet remembering it lands on Character.
      R.descGone = !frame.querySelector('nav.cairn-tab-rail [data-tab="description"], .tab[data-tab="description"]');
      sheet.tabGroups.primary = "description";
      await sheet.render();
      await sleep(400);
      R.remembered = frame.querySelector(".tab.active[data-group='primary']")?.dataset.tab ?? null;
      // b. the sentence, sentence case, first in the left column.
      const left = () => frame.querySelector(".tab[data-tab='character'] .cairn-left");
      R.handSentence = left()?.querySelector(":scope > .trait-sentence")?.textContent.trim() ?? null;
      R.handPen = !!left()?.querySelector(":scope > .trait-sentence .trait-edit[data-action='editTraits']");
      // Creation Mode off: the sentence stays, the pen goes.
      await pc.update({ "system.generationEnabled": false }, { abNoStatusCard: true });
      await until(() => !left()?.querySelector(".trait-edit"));
      await sleep(200);
      R.offSentence = !!left()?.querySelector(":scope > .trait-sentence");
      R.offPen = !!left()?.querySelector(".trait-edit");
      await pc.update({ "system.generationEnabled": true }, { abNoStatusCard: true });
      await until(() => left()?.querySelector(".trait-edit"));
      // No traits and no age: the pen still shows, labelled "Traits".
      await pc.update({ "system.traits.physique": "", "system.age": "" }, { abNoStatusCard: true });
      await until(() => !left()?.querySelector(".trait-sentence")?.textContent.includes("physique"));
      await sleep(200);
      const blank = left()?.querySelector(":scope > .trait-sentence");
      R.blank = { text: blank?.textContent.trim() ?? null, pen: !!blank?.querySelector(".trait-edit"), want: L("CAIRN.Traits") };
    }

    /* ---- 16. round 5: the Current / Max headers, HP's fill, the
            Inventory hint ------------------------------------------------ */
    {
      const R5 = out.r5 = { wantCurrent: L("CAIRN.AbilityCurrent"), wantMax: L("CAIRN.AbilityMax"), wantHint: L("CAIRN.ExpandHint") };
      await sheet.changeTab("character", "primary");
      await sleep(300);
      const page = frame.querySelector('.tab[data-tab="character"]');
      const mid = (n) => { const b = n?.getBoundingClientRect(); return b ? (b.left + b.right) / 2 : null; };
      const inside = (x, n) => { const b = n?.getBoundingClientRect(); return x !== null && !!b && x >= b.left && x <= b.right; };
      const headOf = (h) => ({
        current: h?.querySelector('[data-head="current"]')?.textContent.trim() ?? null,
        max: h?.querySelector('[data-head="max"]')?.textContent.trim() ?? null,
      });
      // The ability header: right before the abilities, over STR's boxes.
      const abHead = page?.querySelector(".cairn-left > .cairn-abilities-head");
      const str = page?.querySelector(".cairn-ability.STR-ability");
      R5.abilities = {
        ...headOf(abHead),
        beforeAbilities: abHead?.nextElementSibling?.matches(".cairn-abilities") ?? false,
        overCircle: inside(mid(abHead?.querySelector('[data-head="current"]')), str?.querySelector(".cairn-ability-circle")),
        overMax: inside(mid(abHead?.querySelector('[data-head="max"]')), str?.querySelector('.cairn-ability-max input')),
      };
      // HP's header: right before the HP box, over its two numbers.
      const hpHead = page?.querySelector(".cairn-vitals > .cairn-hp-head");
      const hp = page?.querySelector(".cairn-vitals > .hp-counter");
      R5.hp = {
        ...headOf(hpHead),
        beforeBox: hpHead?.nextElementSibling === hp && !!hp,
        overCurrent: inside(mid(hpHead?.querySelector('[data-head="current"]')), hp?.querySelector('input[name="system.hp.value"]')),
        overMax: inside(mid(hpHead?.querySelector('[data-head="max"]')), hp?.querySelector('input[name="system.hp.max"]')),
      };
      // HP's fill at 4 / 6, 6 / 6 and 0 / 6: its share of the number half,
      // its colour, and the box's frame.
      const fillState = () => {
        const box = frame.querySelector('.tab[data-tab="character"] .cairn-vitals > .hp-counter');
        const fill = box?.querySelector(".hp-fill");
        const track = fill?.parentElement;
        return {
          share: fill && track?.clientWidth ? Math.round((fill.getBoundingClientRect().width / track.clientWidth) * 100) : null,
          colour: fill ? getComputedStyle(fill).backgroundColor : null,
          frame: box ? getComputedStyle(box).borderTopColor : null,
        };
      };
      const setHp = async (v) => {
        await pc.update({ "system.hp.value": v, "system.hp.max": 6 }, { abNoStatusCard: true });
        await until(() => frame.querySelector('.tab[data-tab="character"] input[name="system.hp.value"]')?.value === String(v));
        await sleep(300);
        return fillState();
      };
      const hpWas = { value: pc._source.system.hp?.value, max: pc._source.system.hp?.max };
      R5.fill = { low: await setHp(4), full: await setHp(6), zero: await setHp(0) };
      await pc.update({ "system.hp.value": hpWas.value, "system.hp.max": hpWas.max }, { abNoStatusCard: true });
      // The Inventory hint: first on the page, in full ink.
      await sheet.changeTab("items", "primary");
      await sleep(300);
      const items = frame.querySelector('.tab[data-tab="items"]');
      const hint = items?.querySelector(".cairn-expand-hint");
      const reorder = items?.querySelector(".cairn-reorder-hint");
      // Round 6: the hint shares the first row with Fatigue's controls, the
      // hint on the left, Fatigue on the right, centred alike.
      const topRow = items?.firstElementChild;
      const fatigue = items?.querySelector(".add-fatigue")?.closest(".end");
      const hb = hint?.getBoundingClientRect(), fb = fatigue?.getBoundingClientRect();
      R5.hint = {
        text: hint?.textContent.trim() ?? null,
        first: !!hint && !!topRow && topRow.contains(hint),
        shown: (hint?.getBoundingClientRect().height ?? 0) > 0,
        ink: hint ? getComputedStyle(hint).color : null,
        mutedColour: reorder ? getComputedStyle(reorder).color : null,
        italic: hint ? getComputedStyle(hint).fontStyle : null,
        fatigueInRow: !!fatigue && !!topRow && topRow.contains(fatigue),
        sameLine: !!hb && !!fb && Math.abs((hb.top + hb.bottom) / 2 - (fb.top + fb.bottom) / 2) <= 4,
        hintLeft: !!hb && !!fb && hb.right <= fb.left,
      };
    }

    /* ---- 17. round 6: HP's + and − inside the "HP" half -------------- */
    {
      const R6 = out.r6 = { wantLabel: L("CAIRN.HitProtection"), wantUp: L("CAIRN.HpUp"), wantDown: L("CAIRN.HpDown") };
      await sheet.changeTab("character", "primary");
      await sleep(300);
      const q = (s) => frame.querySelector(`.tab[data-tab="character"] .cairn-vitals > .hp-counter ${s}`);
      const hpWas = { value: pc._source.system.hp?.value, max: pc._source.system.hp?.max };
      const setHp = async (v) => {
        await pc.update({ "system.hp.value": v, "system.hp.max": 6 }, { abNoStatusCard: true });
        await until(() => q('input[name="system.hp.value"]')?.value === String(v));
        await sleep(200);
      };
      const state = () => ({ up: q('[data-action="hpUp"]')?.disabled ?? null, down: q('[data-action="hpDown"]')?.disabled ?? null });
      const press = async (action, want) => {
        q(`[data-action="${action}"]`)?.click();
        await until(() => pc._source.system.hp.value === want, 3000);
        await sleep(200);
        return pc._source.system.hp.value;
      };
      await setHp(4);
      const up = q('[data-action="hpUp"]'), down = q('[data-action="hpDown"]');
      const label = q("label");
      const half = up?.parentElement;
      const wrap = q(".resource-input-wrapper");
      const box = (n) => n?.getBoundingClientRect();
      const within = (n, outer) => { const a = box(n), b = box(outer); return !!a && !!b && a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5; };
      R6.layout = {
        label: label?.textContent.trim() ?? null,
        tips: { up: up?.dataset.tooltip ? L(up.dataset.tooltip) : null, down: down?.dataset.tooltip ? L(down.dataset.tooltip) : null },
        sameHalf: !!half && half === down?.parentElement && half.contains(label) && !half.contains(wrap),
        order: !!up && !!label && !!down && box(up).right <= box(label).left && box(label).right <= box(down).left,
        inBox: within(up, half) && within(down, half),
        // No growth: the label half is no taller than the number half.
        noGrowth: !!half && !!wrap && half.offsetHeight <= wrap.offsetHeight + 1,
      };
      R6.at4 = state();
      R6.steps = { up: await press("hpUp", 5), down1: await press("hpDown", 4), down2: await press("hpDown", 3) };
      await setHp(6);
      R6.at6 = state();
      R6.capped = await press("hpUp", 7);
      await setHp(0);
      R6.at0 = state();
      R6.floored = await press("hpDown", -1);
      // Overburdened: HP reads 0 by the rule, so both buttons are off, and
      // a forced press writes nothing over the stored value.
      await setHp(4);
      const [load] = await pc.createEmbeddedDocuments("Item", [{ name: "ZZ Rail HP Load", type: "item", system: { quantity: 40 } }]);
      await until(() => q('[data-action="hpUp"]')?.disabled === true, 3000);
      await sleep(200);
      R6.burdened = state();
      const forced = q('[data-action="hpUp"]');
      forced?.removeAttribute("disabled");
      forced?.click();
      await sleep(800);
      R6.burdenedStored = pc._source.system.hp.value;
      await load?.delete();
      await pc.update({ "system.hp.value": hpWas.value, "system.hp.max": hpWas.max }, { abNoStatusCard: true });
    }
    await sheet.close();

    {
      const R = out.r4;
      const bgPack = game.packs.get("air-bladder.backgrounds-2e");
      const bgDoc = (await bgPack.getDocuments()).find((d) => d.system?.description);
      const bpc = await getDocumentClass("Actor").create({
        name: "ZZ Rail Bg PC", type: "character",
        system: {
          background: bgDoc?.name ?? "", backgroundUuid: bgDoc?.uuid ?? "", contentSource: "2e", age: "30",
          traits: { physique: "Athletic", skin: "Pale", hair: "Braided", face: "Broken", speech: "Booming",
            clothing: "Antique", vice: "Lazy", virtue: "Honest" },
          omenEnabled: true, omen: "ZZ an omen", generationEnabled: true,
          description: "<p>ZZ imported prose</p>",
        },
        flags: { "air-bladder": { probeFixture: fixture } },
      }, { abNoStatusCard: true });
      R.bgName = bgDoc?.name ?? null;
      const bs = bpc.sheet;
      await bs.render(true);
      await until(() => bs.element?.querySelector?.(".tab[data-tab='character'] .cairn-left"));
      await sleep(500);
      const bf = bs.element;
      // a. generated branch: label, then the name, drawn as a field.
      const line = bf.querySelector(".tab[data-tab='character'] .background-line");
      const first = line?.firstElementChild;
      const name = line?.querySelector(".background-name");
      R.gen = {
        label: first?.matches("label.background-label") ? first.textContent.trim() : null,
        next: first?.nextElementSibling === name && !!name,
        box: fieldLike(name, bf),
        // A read-only input: its text is its value.
        text: name?.value?.trim() ?? null,
      };
      // A click on the name opens the picker; its close button changes nothing.
      {
        const stale = new Set(document.querySelectorAll(".application"));
        name?.click();
        const d = await newDialog(stale);
        R.gen.picker = !!d;
        R.gen.pickerClosed = await closeApp(d);
        R.gen.bgKept = bpc.system.backgroundUuid === bgDoc?.uuid;
      }
      // b. the sentence: first in the left column, before the abilities,
      // sentence case, in the background description's size and face.
      const left = bf.querySelector(".tab[data-tab='character'] .cairn-left");
      const sent = left?.firstElementChild;
      const bgDesc = bf.querySelector(".tab[data-tab='character'] .background-description");
      R.sentence = {
        first: sent?.matches("p.trait-sentence") ?? false,
        // Before the abilities, with round 5's header row between them.
        beforeAbilities: !!sent && !!left?.querySelector(":scope > .cairn-abilities")
          && !!(sent.compareDocumentPosition(left.querySelector(":scope > .cairn-abilities")) & Node.DOCUMENT_POSITION_FOLLOWING),
        text: sent?.textContent.trim() ?? null,
        want: "You have athletic physique, pale skin, and braided hair. Your face is broken, your speech booming. "
          + "You have antique clothing. You are lazy and honest. You are 30 years old.",
        size: sent ? getComputedStyle(sent).fontSize : null,
        descSize: bgDesc ? getComputedStyle(bgDesc).fontSize : null,
        face: sent ? getComputedStyle(sent).fontFamily : null,
        descFace: bgDesc ? getComputedStyle(bgDesc).fontFamily : null,
        inBand: !!bf.querySelector(".cairn-band .trait-sentence"),
      };
      // c. the pen and the Traits window.
      let writes = 0;
      const hook = Hooks.on("updateActor", (doc) => { if (doc.id === bpc.id) writes++; });
      try {
        const pen = sent?.querySelector(".trait-edit[data-action='editTraits']");
        R.editor = { pen: !!pen, tip: pen?.dataset.tooltip ?? null };
        let stale = new Set(document.querySelectorAll(".application"));
        pen?.click();
        let d = await newDialog(stale);
        const sel = (k) => d?.querySelector(`select[name="system.traits.${k}"]`);
        R.editor.dialog = d?.classList.contains("cairn-trait-editor") ?? false;
        R.editor.title = d?.querySelector(".window-title")?.textContent.trim() ?? null;
        R.editor.wantTitle = L("CAIRN.Traits");
        R.editor.selects = d?.querySelectorAll("select").length ?? 0;
        R.editor.dice = d?.querySelectorAll('a.trait-roll[data-action="rollTrait"]').length ?? 0;
        R.editor.saveLabel = d?.querySelector('footer button[data-action="save"]')?.textContent.trim() ?? null;
        R.editor.wantSave = L("CAIRN.TraitEditor.Save");
        // A die fills its select and writes nothing.
        if (sel("physique")) sel("physique").value = "";
        writes = 0;
        d?.querySelector('a.trait-roll[data-key="physique"]')?.click();
        await until(() => sel("physique")?.value);
        await sleep(300);
        R.editor.rolled = sel("physique")?.value ?? "";
        R.editor.dieWrites = writes;
        R.editor.dieKept = bpc.system.traits.physique === "Athletic";
        // A hand pick, then Save: both written, the window closed.
        const skinSel = sel("skin");
        const pick = [...(skinSel?.options ?? [])].map((o) => o.value).find((v) => v && v !== skinSel.value) ?? null;
        if (skinSel && pick) { skinSel.value = pick; skinSel.dispatchEvent(new Event("change", { bubbles: true })); }
        R.editor.pick = pick;
        d?.querySelector('footer button[data-action="save"]')?.click();
        await until(() => !d?.isConnected && bpc.system.traits.skin === pick);
        await sleep(300);
        R.editor.saveClosed = !d?.isConnected;
        R.editor.savedSkin = bpc.system.traits.skin;
        R.editor.savedPhysique = bpc.system.traits.physique;
        // Reopen, change a select, close with the window's ×: nothing written.
        stale = new Set(document.querySelectorAll(".application"));
        bf.querySelector(".tab[data-tab='character'] .cairn-left .trait-edit")?.click();
        d = await newDialog(stale);
        const hair = sel("hair");
        const other = [...(hair?.options ?? [])].map((o) => o.value).find((v) => v && v !== hair.value) ?? null;
        if (hair && other) { hair.value = other; hair.dispatchEvent(new Event("change", { bubbles: true })); }
        writes = 0;
        R.editor.reopened = !!d;
        R.editor.xClosed = await closeApp(d);
        await sleep(400);
        R.editor.xWrites = writes;
        R.editor.xKept = bpc.system.traits.hair === "Braided";
      } finally {
        Hooks.off("updateActor", hook);
      }
      // d. Background & Notes: Omen and the Description, a rule between items.
      await bs.changeTab("notes", "primary");
      await sleep(400);
      const notes = bf.querySelector(".tab[data-tab='notes']");
      const items = [...(notes?.querySelectorAll(":scope > .notes-item") ?? [])];
      const kind = (n) => n.matches(".bond-block") ? "bond" : n.matches(".question-block") ? "question"
        : n.querySelector(".omen-row") ? "omen" : n.matches(".character-description") ? "description"
        : n.querySelector('prose-mirror[name="system.notes"]') ? "notes" : "?";
      R.notes = {
        kinds: items.map(kind),
        rules: items.slice(1).map((n) => getComputedStyle(n).borderTopWidth),
        firstRule: items[0] ? getComputedStyle(items[0]).borderTopWidth : null,
        divider: !!notes?.querySelector("hr.notes-divider"),
        omenText: notes?.querySelector(".omen-row .omen-input")?.value ?? null,
        prose: notes?.querySelector('.character-description prose-mirror[name="system.description"]')?.textContent.includes("ZZ imported prose") ?? false,
      };
      await bs.close();
    }
    // The hand-picked trait is logged as a hand edit; the change-log cards it
    // posts are this leg's own, removed by id difference.
    for (const m of game.messages.filter((x) => !msgsBefore.has(x.id))) await m.delete();

    /* ---- 8. an npc sheet draws no rail --------------------------------- */
    const npc = await getDocumentClass("Actor").create({
      name: "ZZ Rail NPC", type: "npc", system: { role: "hireling" },
      flags: { "air-bladder": { probeFixture: fixture } },
    }, { abNoStatusCard: true });
    await npc.sheet.render(true);
    await until(() => npc.sheet.element?.querySelector?.(".tab"));
    await sleep(300);
    const ne = npc.sheet.element;
    out.npc = { rail: !!ne.querySelector("nav.cairn-tab-rail"), strip: !!ne.querySelector('nav.tabs a[data-tab]'),
      railed: ne.classList.contains("cairn-railed"), width: npc.sheet.position.width,
      // Leg 14's other half: a hireling's traits open by default too, and its
      // pronouns stay on its own sheet (the move is the character sheet's).
      traitSelects: ne.querySelectorAll('select[name^="system.traits."]').length,
      pronouns: !!ne.querySelector('.character-traits input[name="system.pronouns"]'),
      // Leg 16: the Inventory hint is on every sheet with an inventory.
      hint: ne.querySelector(".cairn-expand-hint")?.textContent.trim() ?? null };
    await npc.sheet.close();
    return out;
  }, FIXTURE);

  /* ---- 9-10. a player's view ------------------------------------------- */
  if (r?.aliceId) {
    const alice = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
    try {
      await joinAs(alice, "Alice");
      p = { observer: await alice.evaluate(async (id) => {
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const actor = game.actors.get(id);
        if (!actor) return { error: "Alice cannot see the character" };
        await actor.sheet.render(true);
        for (let i = 0; i < 40 && !actor.sheet.element?.querySelector?.("nav.cairn-tab-rail"); i++) await sleep(150);
        await sleep(400);
        const el = actor.sheet.element;
        const growthBtn = el.querySelector('nav.cairn-tab-rail button[data-tab="growth"]');
        const res = { editable: actor.sheet.isEditable, disabled: growthBtn?.disabled ?? null,
          attack: !!el.querySelector("nav.cairn-tab-rail .cairn-rail-attack")
            || !!el.querySelector('.cairn-vital-buttons [data-action="attack"]') };
        growthBtn?.click();
        await sleep(400);
        res.turned = el.querySelector('.tab[data-tab="growth"]')?.classList.contains("active") ?? false;
        await actor.sheet.close();
        return res;
      }, r.pcId) };
      await gm.evaluate(async ({ id, aliceId }) => {
        await game.actors.get(id).update({ [`ownership.${aliceId}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED });
      }, { id: r.pcId, aliceId: r.aliceId });
      p.limited = await alice.evaluate(async (id) => {
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const actor = game.actors.get(id);
        for (let i = 0; i < 30 && !actor?.limited; i++) await sleep(100);
        await actor.sheet.render(true);
        for (let i = 0; i < 40 && !actor.sheet.element?.querySelector?.(".cairn-limited-sheet"); i++) await sleep(150);
        const rail = actor.sheet.element?.querySelector("nav.cairn-tab-rail");
        const res = { limited: actor.limited, block: !!actor.sheet.element?.querySelector(".cairn-limited-sheet"),
          railHidden: rail ? rail.hidden : null, railButtons: rail?.querySelectorAll("button").length ?? null };
        await actor.sheet.close();
        return res;
      }, r.pcId);
    } finally {
      await alice.context().close();
    }
  }
} catch (e) {
  fail(`the run threw: ${e.message}`);
} finally {
  await cleanup();
}

/* ---------------------------------- assertions ----------------------------- */
if (!r) fail("the in-page run returned nothing");
else {
  // 1
  r.frame.railed && r.frame.character && r.frame.width === 480 && r.frame.height === 700
    ? ok("a character's frame wears cairn-railed + cairn-character-sheet and opens 480 x 700")
    : fail(`frame: ${JSON.stringify(r.frame)}`);

  // 2
  // No Description page since round 4 (leg 15).
  const want = ["character", "items", "growth", ...(r.showContainers ? ["containers"] : []), "notes"];
  const icons = { character: "fa-mask", items: "fa-sack", growth: "fa-seedling", containers: "fa-link", notes: "fa-scroll" };
  const got = r.rail.pages.map((b) => b.tab);
  r.rail.present && JSON.stringify(got) === JSON.stringify(want)
    ? ok(`the rail sits in .window-content with the pages in order: ${got.join(", ")}`)
    : fail(`rail present ${r.rail.present}, pages ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  const badIcon = r.rail.pages.filter((b) => !b.icon?.split(/\s+/).includes(icons[b.tab]));
  badIcon.length === 0 && r.rail.pages.length
    ? ok("each page wears its icon (mask, sack, seedling, scroll)")
    : fail(`icons: ${JSON.stringify(badIcon)}`);
  const badTip = r.rail.pages.filter((b) => b.tab !== "containers" && (b.tip !== r.expectTips[b.tab] || b.aria !== r.expectTips[b.tab]));
  badTip.length === 0 && r.rail.pages.length
    ? ok(`each page's tooltip and label is its own word; Inventory's reads "${r.expectTips.items}"`)
    : fail(`tooltips: ${JSON.stringify(badTip)} — want ${JSON.stringify(r.expectTips)}`);
  r.rail.label === r.expectTips.rail
    ? ok(`the rail is labelled "${r.rail.label}" for a screen reader`)
    : fail(`rail aria-label ${JSON.stringify(r.rail.label)}`);
  r.rail.activeTab === "character" && r.rail.activePage === "character"
    ? ok("a fresh sheet stands on the Character page")
    : fail(`fresh sheet stands on button ${r.rail.activeTab}, page ${r.rail.activePage}`);

  // 3
  const badTurn = r.turns.filter((t) => t.shown.length !== 1 || t.shown[0] !== t.id || t.pressed !== "true");
  badTurn.length === 0 && r.turns.length === want.length
    ? ok("every rail button turns to its own page, alone, and is pressed")
    : fail(`turns: ${JSON.stringify(badTurn.length ? badTurn : r.turns)}`);
  const noFoot = r.turns.filter((t) => !t.footer).map((t) => t.id);
  noFoot.length === 0 && r.turns.length === want.length
    ? ok("the \"For Use With Cairn\" footer stands under every page, outside the pages, its stamp loaded")
    : fail(`no footer under: ${JSON.stringify(noFoot)}`);

  // 4
  const a = r.placeRight, e = r.placeEdge, b = r.placeBack;
  !a.left && a.rl !== null && a.rl >= a.fr - 2 && a.dir === "RIGHT"
    ? ok("the rail hangs outside the frame's right edge, tooltips pointing right")
    : fail(`right: ${JSON.stringify(a)}`);
  e.left && e.rr !== null && e.rr <= e.fl + 2 && e.dir === "LEFT"
    ? ok("at the screen's right edge it flips to the frame's left, tooltips pointing left")
    : fail(`edge: ${JSON.stringify(e)}`);
  !b.left && b.rl >= b.fr - 2
    ? ok("...and flips back when the window moves away")
    : fail(`back: ${JSON.stringify(b)}`);
  r.unit.every(Boolean)
    ? ok("railHangsLeft: room right / none right / none either side / exact fit all answer as intended")
    : fail(`railHangsLeft cases: ${JSON.stringify(r.unit)}`);

  // 5
  const g = r.growth;
  g.intro === g.expectIntro
    ? ok("Growth opens on Cairn's own Growth sentence")
    : fail(`growth intro ${JSON.stringify(g.intro)}`);
  g.scars && !g.descScars
    ? ok("the Scars are on Growth, and no longer on Description")
    : fail(`scars on growth ${g.scars}, on description ${g.descScars}`);
  g.journal && g.heading === g.expectHeading && g.placeholder === g.expectPlaceholder
    ? ok(`the growth journal is there, headed "${g.heading}", with its placeholder`)
    : fail(`journal ${g.journal}, heading ${JSON.stringify(g.heading)}, placeholder ${JSON.stringify(g.placeholder)}`);
  g.footers === 1
    ? ok("the sheet draws the compatibility footer once (no second copy on Description)")
    : fail(`the sheet draws ${g.footers} compatibility footers, want 1`);

  // 6
  const j = r.journal;
  j.stored === "<p>ZZ grew in the world</p>" && j.shown && j.placeholderGone
    ? ok("system.growth is stored and the journal shows it, its placeholder gone")
    : fail(`journal: ${JSON.stringify(j)}`);

  // 7
  r.attack.present && r.attack.action === "attack" && r.attack.dialog
    ? ok("the rail's burst opens the Attack window (every attack, not the improvised one alone)")
    : fail(`rail attack: ${JSON.stringify(r.attack)}`);

  // 11
  const bt = r.button;
  bt.present && bt.live && bt.afterFate && bt.below && bt.burst && bt.red && bt.dialog
    ? ok("page 1's Attack button sits under Die of Fate, wears the rail's red burst, stays live, and opens the Attack window")
    : fail(`page-1 attack button: ${JSON.stringify(bt)}`);

  // 12
  const s = r.states;
  !s.inBand && s.order && (!s.usePanic || s.pan)
    ? ok(`Deprived${s.usePanic ? " over Panicked" : ""} stands in the vitals, under HP and above Slots and Rest`)
    : fail(`Deprived/Panicked placement: ${JSON.stringify(s)}`);

  // 13
  const ti = r.toInventory;
  ti.slots
    ? ok(`a click on the slot line turns to Inventory (slot-limit setting ${ti.limitOn ? "on" : "off"})`)
    : fail(`the slot line did not open Inventory: ${JSON.stringify(ti)}`);
  ti.banner && ti.bannerTurns
    ? ok("a click on the Overburdened banner turns to Inventory")
    : fail(`the Overburdened banner did not open Inventory: ${JSON.stringify(ti)}`);

  // 14
  const bio = r.bio ?? {};
  JSON.stringify(bio.band) === JSON.stringify(["band-gold"])
    && JSON.stringify(bio.identity) === JSON.stringify(["name-line", "identity-bio-line", "background-line"])
    && bio.pronounsInput && bio.ageInput
    ? ok("Pronouns and Age stand under the name; Gold stands alone in the band")
    : fail(`page-1 head/band: ${JSON.stringify(bio)}`);
  r.npc.traitSelects > 0 && r.npc.pronouns
    ? ok("a hireling's trait pick-lists are open too, its pronouns on its own sheet")
    : fail(`hireling traits/pronouns: ${JSON.stringify(r.npc)}`);

  // 15
  const R = r.r4 ?? {};
  const h = R.hand ?? {}, gn = R.gen ?? {};
  h.label === R.expectLabel && h.next && h.box?.same
    ? ok(`a hand-made background reads "${h.label}" before an input drawn as the Pronouns field`)
    : fail(`hand-made background field: ${JSON.stringify(h)}`);
  gn.label === R.expectLabel && gn.next && gn.box?.same && gn.text === R.bgName
    ? ok(`a generated background reads "${gn.label}" before its name ("${gn.text}") drawn as the same field`)
    : fail(`generated background field: ${JSON.stringify(gn)} (want name ${JSON.stringify(R.bgName)})`);
  gn.picker && gn.pickerClosed && gn.bgKept
    ? ok("a click on the generated background's name opens the picker, and closing it changes nothing")
    : fail(`background name click: ${JSON.stringify(gn)}`);
  const se = R.sentence ?? {};
  se.first && se.beforeAbilities && !se.inBand
    ? ok("the trait sentence is the left column's first child, above STR, and out of the band")
    : fail(`sentence placement: ${JSON.stringify(se)}`);
  se.text === se.want
    ? ok(`the sentence reads in sentence case: "${se.text}"`)
    : fail(`sentence text ${JSON.stringify(se.text)}, want ${JSON.stringify(se.want)}`);
  se.size && se.size === se.descSize && se.face === se.descFace
    ? ok(`the sentence is set like the background description (${se.size})`)
    : fail(`sentence ${se.size} ${se.face} vs description ${se.descSize} ${se.descFace}`);
  R.handSentence === "You have athletic physique. You are 30 years old." && R.handPen
    ? ok("a hand-made character's sentence is lowercase too and ends in the pen")
    : fail(`hand-made sentence ${JSON.stringify(R.handSentence)}, pen ${R.handPen}`);
  R.offSentence && !R.offPen
    ? ok("with Character Creation Mode off the sentence stays and the pen goes")
    : fail(`Creation Mode off: sentence ${R.offSentence}, pen ${R.offPen}`);
  R.blank?.text === R.blank?.want && R.blank?.pen
    ? ok(`with no traits and no age the slot reads "${R.blank.text}" with the pen`)
    : fail(`blank sentence slot: ${JSON.stringify(R.blank)}`);
  const ed = R.editor ?? {};
  ed.pen && ed.tip === "CAIRN.EditTraits" && ed.dialog && ed.title === ed.wantTitle && ed.selects === 8 && ed.dice === 8 && ed.saveLabel === ed.wantSave
    ? ok(`the pen opens "${ed.title}" with 8 pickers and 8 dice, and one button, "${ed.saveLabel}"`)
    : fail(`trait editor: ${JSON.stringify(ed)}`);
  ed.rolled && ed.dieWrites === 0 && ed.dieKept
    ? ok(`a die fills its select ("${ed.rolled}") and writes nothing`)
    : fail(`editor die: rolled ${JSON.stringify(ed.rolled)}, writes ${ed.dieWrites}, kept ${ed.dieKept}`);
  ed.pick && ed.saveClosed && ed.savedSkin === ed.pick && ed.savedPhysique === ed.rolled
    ? ok("Save writes the hand pick and the rolled value, and closes the window")
    : fail(`editor save: ${JSON.stringify(ed)}`);
  ed.reopened && ed.xClosed && ed.xWrites === 0 && ed.xKept
    ? ok("closing the window with × discards its changes")
    : fail(`editor ×: ${JSON.stringify(ed)}`);
  R.descGone && R.remembered === "character"
    ? ok("there is no Description page, and a sheet remembering it opens on Character")
    : fail(`description gone ${R.descGone}, remembered tab lands on ${R.remembered}`);
  const nt = R.notes ?? {};
  JSON.stringify(nt.kinds?.slice(-3)) === JSON.stringify(["omen", "description", "notes"])
    && nt.rules?.length && nt.rules.every((w) => w !== "0px") && nt.firstRule === "0px" && !nt.divider
    && nt.omenText === "ZZ an omen" && nt.prose
    ? ok(`Background & Notes holds ${nt.kinds.join(", ")}, a rule between each, the old divider gone`)
    : fail(`Background & Notes: ${JSON.stringify(nt)}`);
  const sl = R.slots ?? {};
  sl.short === sl.shortWant && !sl.clips && (sl.text === sl.long || sl.text === sl.shortWant)
    ? ok(`the slot line reads "${sl.text}" and does not clip`)
    : fail(`slot line: ${JSON.stringify(sl)}`);

  // 16
  const R5 = r.r5 ?? {};
  const a5 = R5.abilities ?? {}, h5 = R5.hp ?? {}, f5 = R5.fill ?? {}, i5 = R5.hint ?? {};
  a5.current === R5.wantCurrent && a5.max === R5.wantMax && a5.beforeAbilities && a5.overCircle && a5.overMax
    ? ok(`one header row over STR reads "${a5.current}" over the circle and "${a5.max}" over the max box`)
    : fail(`ability header: ${JSON.stringify(a5)}`);
  h5.current === R5.wantCurrent && h5.max === R5.wantMax && h5.beforeBox && h5.overCurrent && h5.overMax
    ? ok("HP's two numbers carry the same Current and Max words, each over its own box")
    : fail(`HP header: ${JSON.stringify(h5)}`);
  Math.abs((f5.low?.share ?? -99) - 67) <= 2 && Math.abs((f5.full?.share ?? -99) - 100) <= 2 && f5.zero?.share === 0
    ? ok(`HP's box fills in proportion: 4 / 6 is ${f5.low.share}%, full ${f5.full.share}%, 0 empty`)
    : fail(`HP fill shares: ${JSON.stringify(f5)}`);
  f5.low?.colour && f5.full?.colour && f5.low.colour !== f5.full.colour && f5.zero?.frame && f5.zero.frame !== f5.full.frame
    ? ok(`the fill wears one colour at full (${f5.full.colour}) and another below it (${f5.low.colour}); at 0 the frame turns (${f5.zero.frame})`)
    : fail(`HP fill colours: ${JSON.stringify(f5)}`);
  i5.text === R5.wantHint && i5.first && i5.shown && i5.ink && i5.ink !== i5.mutedColour && i5.italic === "normal"
    ? ok(`Inventory opens on "${i5.text}", first and in full ink`)
    : fail(`Inventory hint: ${JSON.stringify(i5)} (want ${JSON.stringify(R5.wantHint)})`);
  r.npc.hint === R5.wantHint
    ? ok("the npc sheet's inventory carries the same hint")
    : fail(`npc inventory hint: ${JSON.stringify(r.npc.hint)}`);
  i5.fatigueInRow && i5.sameLine && i5.hintLeft
    ? ok("the hint shares its row with Fatigue's controls, the hint on the left")
    : fail(`hint and Fatigue row: ${JSON.stringify(i5)}`);

  // 17
  const R6 = r.r6 ?? {};
  const l6 = R6.layout ?? {};
  l6.label === R6.wantLabel && l6.sameHalf && l6.order && l6.inBox && l6.noGrowth
    && l6.tips?.up === R6.wantUp && l6.tips?.down === R6.wantDown
    ? ok(`HP's box reads + "${l6.label}" − in its label half, with "${l6.tips.up}" and "${l6.tips.down}", no taller than the numbers`)
    : fail(`HP buttons layout: ${JSON.stringify(l6)}`);
  R6.at4?.up === false && R6.at4?.down === false && R6.steps?.up === 5 && R6.steps?.down1 === 4 && R6.steps?.down2 === 3
    ? ok("at 4 / 6 + steps to 5, then − twice to 3")
    : fail(`HP steps: ${JSON.stringify({ at4: R6.at4, steps: R6.steps })}`);
  R6.at6?.up === true && R6.at6?.down === false && R6.capped === 6 && R6.at0?.down === true && R6.at0?.up === false && R6.floored === 0
    ? ok("+ is off at max and − at 0; neither steps past its bound")
    : fail(`HP bounds: ${JSON.stringify({ at6: R6.at6, capped: R6.capped, at0: R6.at0, floored: R6.floored })}`);
  R6.burdened?.up === true && R6.burdened?.down === true && R6.burdenedStored === 4
    ? ok("overburdened, both are off, and a forced + leaves the stored 4 alone")
    : fail(`HP while overburdened: ${JSON.stringify({ burdened: R6.burdened, stored: R6.burdenedStored })}`);

  // 8
  !r.npc.rail && r.npc.strip && !r.npc.railed && r.npc.width === 600
    ? ok("an npc sheet draws no rail, keeps its tab strip, and opens 600 wide")
    : fail(`npc: ${JSON.stringify(r.npc)}`);

  // 9-10
  if (!r.aliceId) fail('no user named "Alice" — run `npm run dev:players` first; the player legs did not run');
  else if (!p) fail("the player legs returned nothing");
  else {
    const o = p.observer;
    o?.error ? fail(`observer: ${o.error}`)
      : !o.editable && o.disabled === false && o.turned && !o.attack
        ? ok("an observing player cannot edit the sheet but can turn its pages, and is offered no Attack")
        : fail(`observer: ${JSON.stringify(o)}`);
    const l = p.limited;
    l?.limited && l.block && l.railHidden === true && l.railButtons === 0
      ? ok("a LIMITED viewer gets the portrait-and-name wall and an empty, hidden rail")
      : fail(`limited: ${JSON.stringify(l)}`);
  }
}

if (errors.length) { failed = true; console.log("Console errors:\n" + errors.join("\n")); }
console.log(failed ? "\nsheet-rail e2e FAILED" : "\nsheet-rail e2e passed");
await browser.close();
process.exit(failed ? 1 : 0);

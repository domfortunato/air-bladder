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
 *  18. (user asks 2026-11-20) the Inventory hint reads "read its description"
 *      with a hand pointing DOWN; each current ability score has − then +
 *      under its circle, one point each, off at max / 0; the name is 28px;
 *      the title bar's toggle reads "CharGen".
 *  19. (user asks 2026-11-20) on Background & Notes the Bond heading (no
 *      colon), each question, the Description heading and Omen's label wear page 1's
 *      Background label face, small caps; each answer is indented under a
 *      visible left rule in both schemes; "Saves" heads the ability names,
 *      the size of "Current"; with CharGen off the four max boxes are
 *      disabled with the locked tooltip and a submit writes none of them,
 *      and with CharGen on they are live.
 *  20. (user asks 2026-11-20) the trait sentence stands under a "Traits"
 *      label in page 1's Background label face, and over a thin rule with
 *      space before the Current / Max / Saves header; a blank character's pen
 *      stands alone under the label. Omen is laid out like a Bond: the die and
 *      the list on the heading row right of its label, the text below it,
 *      indented on the answers' left rule in both schemes, with no field box,
 *      in the answers' face; switched off it shows the new hint in the notes
 *      editor placeholder's face, in the same indented place.
 *
 * Red-first: run against the commit before the redesign, every leg but 8 and
 * 10 fails (no rail, no growth page, no growth field).
 */
import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAs, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const FIXTURE = "sheet-rail";
const browser = await chromium.launch();
watchdog(420000, "sheet-rail probe", async () => { try { await browser.close(); } catch { /* gone */ } });
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
      // Leg 20: the label says "Traits" now; the sentence slot holds the pen alone.
      const blankLabel = left()?.firstElementChild?.matches(".traits-label") ? left().firstElementChild : null;
      R.blank = {
        label: blankLabel?.textContent.trim() ?? null,
        labelLeads: !!blankLabel && blankLabel.nextElementSibling === blank,
        text: blank?.textContent.trim() ?? null, pen: !!blank?.querySelector(".trait-edit"), want: L("CAIRN.Traits"),
      };
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
      // Let the restore's re-render LAND before the next leg turns a page: on
      // 14.369 and 14.368 a render still in flight after changeTab("items")
      // put the sheet back on Character, and the Inventory measured all zeros
      // (fc24463e, 20261120T013343Z / 20261120T014109Z; green on 14.370).
      await until(() => frame.querySelector('.tab[data-tab="character"] input[name="system.hp.value"]')?.value === String(hpWas.value), 3000);
      await sleep(500);
      // The Inventory hint: first on the page, in full ink.
      // The HP restore above re-renders the sheet AFTER its update resolves;
      // a node taken before that render is detached and measures 0 high (a
      // race seen on 14.369 at 4454cbe7). Wait for the LIVE hint to show,
      // re-querying each time, then let the render settle.
      await sheet.changeTab("items", "primary");
      await until(() => (frame.querySelector('.tab[data-tab="items"] .cairn-expand-hint')?.getBoundingClientRect().height ?? 0) > 0, 4000);
      if (!((frame.querySelector('.tab[data-tab="items"] .cairn-expand-hint')?.getBoundingClientRect().height ?? 0) > 0)) {
        await sheet.changeTab("items", "primary");
        await until(() => (frame.querySelector('.tab[data-tab="items"] .cairn-expand-hint')?.getBoundingClientRect().height ?? 0) > 0, 4000);
      }
      await sleep(400);
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
        // The WHOLE half wears the label's bar, not just the letters (seen in
        // the light theme on CT 123, 2026-11-20; the dark bar hid it).
        barFilled: !!half && !!label && getComputedStyle(half).backgroundColor === getComputedStyle(label).backgroundColor
          && getComputedStyle(half).backgroundColor !== "rgba(0, 0, 0, 0)",
      };
      // The + and − glyphs read ON that bar in BOTH schemes (seen on CT 123,
      // 2026-11-20: in light, core's button ink #111 sat on the black bar).
      // Schemes switch through core's own configureUI, nothing written (the
      // dev:theme recipe); the contrast floor is dev:theme's 3. The sheet is
      // RE-RENDERED after each switch and its buttons read afresh: measured on
      // CT 123, a button already drawn keeps the ink of the scheme it was drawn
      // in (configureUI alone left 51,51,51 in dark), which let this check pass
      // red-blind on the farm, whose client starts dark.
      {
        const fresh = async () => {
          const was = q('[data-action="hpUp"]');
          await sheet.render();
          await until(() => { const n = q('[data-action="hpUp"]'); return !!n && n !== was; }, 5000);
          await sleep(200);
        };
        const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => {
          const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
        R6.ink = {};
        try {
          for (const scheme of ["light", "dark"]) {
            const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
            cfg.colorScheme = { applications: scheme, interface: scheme };
            game.configureUI(cfg);
            await fresh();
            const barHalf = q('[data-action="hpUp"]').parentElement;
            const barBg = getComputedStyle(barHalf).backgroundColor;
            R6.ink[scheme] = [q('[data-action="hpUp"]'), q('[data-action="hpDown"]')].map((b) => {
              const ink = getComputedStyle(b.querySelector("i")).color;
              return { ink, barBg, ratio: Math.round(ratio(ink, barBg) * 100) / 100 };
            });
          }
        } finally {
          game.configureUI(game.settings.get("core", "uiConfig"));
          await fresh();
        }
      }
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
      // Let the load's renders settle, so the forced press lands on the LIVE
      // button (a detached one would pass without testing anything).
      await sleep(600);
      R6.burdened = state();
      const forced = q('[data-action="hpUp"]');
      forced?.removeAttribute("disabled");
      forced?.click();
      R6.forcedLive = !!forced?.isConnected;
      await sleep(800);
      R6.burdenedStored = pc._source.system.hp.value;
      await load?.delete();
      await pc.update({ "system.hp.value": hpWas.value, "system.hp.max": hpWas.max }, { abNoStatusCard: true });
      // Let the restore's re-render LAND before the next leg turns a page: on
      // 14.369 and 14.368 a render still in flight after changeTab("items")
      // put the sheet back on Character, and the Inventory measured all zeros
      // (fc24463e, 20261120T013343Z / 20261120T014109Z; green on 14.370).
      await until(() => frame.querySelector('.tab[data-tab="character"] input[name="system.hp.value"]')?.value === String(hpWas.value), 3000);
      await sleep(500);
    }

    /* ---- 18. the hint's words and hand, ability ±, the name, CharGen ---- */
    {
      const R7 = out.r7 = { wantHint: L("CAIRN.ExpandHint"), wantUp: L("CAIRN.AbilityUp"), lang: game.i18n.lang };
      await sheet.changeTab("items", "primary");
      await until(() => (frame.querySelector('.tab[data-tab="items"] .cairn-expand-hint')?.getBoundingClientRect().height ?? 0) > 0, 4000);
      if (!((frame.querySelector('.tab[data-tab="items"] .cairn-expand-hint')?.getBoundingClientRect().height ?? 0) > 0)) {
        await sheet.changeTab("items", "primary");
        await until(() => (frame.querySelector('.tab[data-tab="items"] .cairn-expand-hint')?.getBoundingClientRect().height ?? 0) > 0, 4000);
      }
      const hint = frame.querySelector('.tab[data-tab="items"] .cairn-expand-hint');
      R7.hint = { text: hint?.textContent.trim() ?? null, down: !!hint?.querySelector(".fa-hand-point-down"), up: !!hint?.querySelector(".fa-hand-pointer") };
      await sheet.changeTab("character", "primary");
      await sleep(300);
      const strQ = (s) => frame.querySelector(`.tab[data-tab="character"] .cairn-ability.STR-ability ${s}`);
      const abWas = { value: pc._source.system.abilities.STR.value, max: pc._source.system.abilities.STR.max };
      const setStr = async (v) => {
        await pc.update({ "system.abilities.STR.value": v, "system.abilities.STR.max": 12 }, { abNoStatusCard: true });
        await until(() => strQ('input[name="system.abilities.STR.value"]')?.value === String(v));
        await sleep(250);
      };
      const st = () => ({ down: strQ('[data-action="abilityDown"]')?.disabled ?? null, up: strQ('[data-action="abilityUp"]')?.disabled ?? null });
      const pressAb = async (action, want) => {
        strQ(`[data-action="${action}"]`)?.click();
        await until(() => pc._source.system.abilities.STR.value === want, 3000);
        await sleep(250);
        return pc._source.system.abilities.STR.value;
      };
      await setStr(9);
      const down = strQ('[data-action="abilityDown"]'), up = strQ('[data-action="abilityUp"]');
      const circle = strQ(".cairn-ability-circle");
      const bb = (n) => n?.getBoundingClientRect();
      const cMid = circle ? (bb(circle).left + bb(circle).right) / 2 : null;
      const pairMid = down && up ? (bb(down).left + bb(up).right) / 2 : null;
      R7.ab = {
        order: !!down && !!up && bb(down).right <= bb(up).left,
        under: !!down && !!circle && bb(down).top >= bb(circle).bottom - 1 && bb(up).top >= bb(circle).bottom - 1,
        centred: cMid !== null && pairMid !== null && Math.abs(cMid - pairMid) <= 3,
        tip: up?.dataset.tooltip ?? null,
        at9: st(),
      };
      R7.steps = { up: await pressAb("abilityUp", 10), down: await pressAb("abilityDown", 9) };
      await setStr(12);
      R7.at12 = st();
      await setStr(0);
      R7.at0 = st();
      await pc.update({ "system.abilities.STR.value": abWas.value, "system.abilities.STR.max": abWas.max }, { abNoStatusCard: true });
      const nameIn = frame.querySelector('.tab[data-tab="character"] .name-input') ?? frame.querySelector(".name-input");
      R7.nameSize = nameIn ? getComputedStyle(nameIn).fontSize : null;
      const toggle = frame.querySelector('.window-header button[data-action="toggleGeneration"]');
      R7.toggle = toggle?.textContent.trim() ?? null;
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
      const sent = left?.querySelector(":scope > p.trait-sentence") ?? null;
      const lead = left?.firstElementChild ?? null;
      const bgDesc = bf.querySelector(".tab[data-tab='character'] .background-description");
      R.sentence = {
        // First in the column, or first after its own label (leg 20).
        first: !!sent && (lead === sent || (!!lead?.matches(".traits-label") && lead.nextElementSibling === sent)),
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
      // Leg 20: the "Traits" label above the sentence, in the Background
      // label's face, and a thin rule under the sentence with space before
      // the Current / Max / Saves header.
      {
        const FACE = ["fontFamily", "fontVariantCaps", "fontSize", "fontWeight", "color"];
        const face = (n) => { const cs = n ? getComputedStyle(n) : null; return Object.fromEntries(FACE.map((k) => [k, cs?.[k] ?? null])); };
        const label = lead?.matches(".traits-label") ? lead : null;
        const head = left?.querySelector(":scope > .cairn-abilities-head");
        const cs = sent ? getComputedStyle(sent) : null;
        const sb = sent?.getBoundingClientRect(), hb = head?.getBoundingClientRect(), lb = label?.getBoundingClientRect();
        R.t20 = {
          label: label?.textContent.trim() ?? null,
          want: L("CAIRN.Traits"),
          above: !!lb && !!sb && lb.bottom <= sb.top + 0.5,
          face: face(label),
          bgFace: face(bf.querySelector(".tab[data-tab='character'] .background-line .background-label")),
          rule: cs ? { width: cs.borderBottomWidth, style: cs.borderBottomStyle } : null,
          // The rule is the sentence's bottom edge; the header starts below it.
          gap: sb && hb ? Math.round(hb.top - sb.bottom) : null,
        };
      }
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

    /* ---- 19. notes headings, Saves, max scores locked ------------------ */
    {
      const R8 = out.r8 = {
        wantSaves: L("CAIRN.AbilitySaves"), wantLocked: L("CAIRN.MaxLockedTip"), wantBond: L("CAIRN.Bond"),
        wantMaxTip: game.i18n.format("CAIRN.MaximumOf", { name: L("STR") }),
      };
      // Bonds must be on to draw: SET what the leg needs, put back what was read.
      const bondsWas = game.settings.get("air-bladder", "use-bonds");
      if (bondsWas === false) await game.settings.set("air-bladder", "use-bonds", true);
      const omensWas = game.settings.get("air-bladder", "show-omens");
      if (omensWas === false) await game.settings.set("air-bladder", "show-omens", true);
      const notesPc = await getDocumentClass("Actor").create({
        name: "ZZ Rail Notes PC", type: "character",
        system: {
          contentSource: "2e", generationEnabled: false, hp: { value: 4, max: 6 },
          abilities: { STR: { value: 9, max: 12 }, DEX: { value: 8, max: 10 }, WIL: { value: 7, max: 11 } },
          bonds: [{ id: "zzrailbond", description: "ZZ a bond's own words" }],
          questions: [{ question: "ZZ What did you leave behind?", answer: "ZZ an answer long enough to wrap onto a second line of the page" }],
          description: "<p>ZZ notes prose</p>",
        },
        flags: { "air-bladder": { probeFixture: fixture } },
      }, { abNoStatusCard: true });
      const ns = notesPc.sheet;
      try {
        await ns.render(true);
        await until(() => ns.element?.querySelector?.(".tab[data-tab='notes'] .bond-line"));
        await sleep(500);
        const nf = ns.element;
        const q = (s) => nf.querySelector(s);
        const FACE = ["fontFamily", "fontVariantCaps", "fontSize", "fontWeight", "color"];
        const face = (n) => { const cs = n ? getComputedStyle(n) : null; return Object.fromEntries(FACE.map((k) => [k, cs?.[k] ?? null])); };
        const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
        const lum = ([r, g, b]) => {
          const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
        // What is behind an element: the first opaque colour up the chain, or
        // the first background IMAGE, averaged (dev:theme's method: in light the
        // sheet is core's parchment, an image, and a colour-only walk falls
        // through to <body>'s black; measured at 52b50723).
        const sample = (url) => new Promise((res) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const cv = document.createElement("canvas");
            cv.width = Math.min(img.naturalWidth, 64);
            cv.height = Math.min(img.naturalHeight, 64);
            const g = cv.getContext("2d", { willReadFrequently: true });
            g.drawImage(img, 0, 0, cv.width, cv.height);
            const d = g.getImageData(0, 0, cv.width, cv.height).data;
            const sum = [0, 0, 0];
            for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
            const n = d.length / 4;
            res(`rgb(${sum.map((v) => Math.round(v / n)).join(", ")})`);
          };
          img.onerror = () => res(null);
          img.src = url;
        });
        const ground = async (n) => {
          for (let e = n; e; e = e.parentElement) {
            const cs = getComputedStyle(e);
            const c = rgb(cs.backgroundColor);
            if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return cs.backgroundColor;
            const m = /url\("?([^")]+)"?\)/.exec(cs.backgroundImage);
            if (m) return sample(m[1]);
          }
          return null;
        };
        // The text's own left edge, so a padding indent counts as one.
        const textLeft = (n) => {
          const t = [...(n?.childNodes ?? [])].find((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim());
          if (!t) return null;
          const rg = document.createRange();
          rg.selectNodeContents(t);
          return rg.getBoundingClientRect().left;
        };
        const measureNotes = async () => {
          await ns.changeTab("notes", "primary");
          await until(() => (q(".tab[data-tab='notes'] .bond-line")?.getBoundingClientRect().height ?? 0) > 0, 4000);
          await sleep(200);
          const pairs = [[".bond-line", ".bond-answer"], [".question-line", ".question-answer"]];
          const res = [];
          for (const [h, a] of pairs) {
            const head = q(`.tab[data-tab='notes'] ${h}`), ans = q(`.tab[data-tab='notes'] ${a}`);
            const cs = ans ? getComputedStyle(ans) : null;
            const tl = textLeft(ans);
            const under = ans ? await ground(ans.parentElement) : null;
            res.push({
              which: a,
              indented: !!head && tl !== null && tl >= head.getBoundingClientRect().left + 6,
              rule: cs ? { width: cs.borderLeftWidth, style: cs.borderLeftStyle, color: cs.borderLeftColor } : null,
              ground: under,
              contrast: cs && under ? Math.round(ratio(cs.borderLeftColor, under) * 100) / 100 : null,
            });
          }
          return res;
        };

        // a. the headings take page 1's Background label face.
        await ns.changeTab("character", "primary");
        await sleep(200);
        const bgLabel = q(".tab[data-tab='character'] .background-line .background-label");
        R8.labelFace = face(bgLabel);
        await ns.changeTab("notes", "primary");
        await sleep(300);
        const bondHead = q(".tab[data-tab='notes'] .bond-line strong");
        R8.faces = {
          bond: face(bondHead),
          question: face(q(".tab[data-tab='notes'] .question-line strong")),
          description: face(q(".tab[data-tab='notes'] .character-description-heading")),
          // Omen's label too: it read in its own bold sans beside the small
          // caps on CT 123 (the plan's "fold it in if it reads differently").
          omen: face(q(".tab[data-tab='notes'] .notes-omen .omen-label")),
        };
        R8.bondText = bondHead?.textContent.trim() ?? null;

        // Leg 20, Omen OFF: the hint, in the notes editor placeholder's face,
        // in the answers' indented place on their rule.
        {
          const disp = q(".tab[data-tab='notes'] .notes-omen .omen-display");
          const lab = q(".tab[data-tab='notes'] .notes-omen .omen-label");
          const ph = q(".tab[data-tab='notes'] prose-mirror[name='system.notes'] .cairn-editor-placeholder");
          const PH = ["fontFamily", "fontSize", "fontStyle", "color", "opacity"];
          const phFace = (n) => { const cs = n ? getComputedStyle(n) : null; return Object.fromEntries(PH.map((k) => [k, cs?.[k] ?? null])); };
          const cs = disp ? getComputedStyle(disp) : null;
          R8.omenOff = {
            text: disp?.textContent.trim() ?? null,
            want: L("CAIRN.OmenPlaceholder"),
            face: phFace(disp),
            phFace: phFace(ph),
            rule: cs ? { width: cs.borderLeftWidth, style: cs.borderLeftStyle } : null,
            indented: !!disp && !!lab && textLeft(disp) !== null && textLeft(disp) >= lab.getBoundingClientRect().left + 6,
            below: !!disp && !!lab && disp.getBoundingClientRect().top >= lab.getBoundingClientRect().bottom - 0.5,
          };
        }

        // b. indented answers under a visible rule, in both schemes (core's
        // configureUI, nothing written; the sheet RE-RENDERED after each
        // switch, the leg 17 lesson).
        R8.indent = {};
        try {
          for (const scheme of ["light", "dark"]) {
            const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
            cfg.colorScheme = { applications: scheme, interface: scheme };
            game.configureUI(cfg);
            const was = q(".tab[data-tab='notes'] .bond-answer");
            await ns.render();
            await until(() => { const n = q(".tab[data-tab='notes'] .bond-answer"); return !!n && n !== was; }, 5000);
            await sleep(200);
            R8.indent[scheme] = await measureNotes();
          }
        } finally {
          game.configureUI(game.settings.get("core", "uiConfig"));
          await ns.render();
          await sleep(400);
        }

        // c. "Saves" heads the names column, the size of "Current".
        await ns.changeTab("character", "primary");
        await until(() => (q(".tab[data-tab='character'] .cairn-abilities-head")?.getBoundingClientRect().height ?? 0) > 0, 4000);
        await sleep(200);
        const saves = q(".tab[data-tab='character'] .cairn-abilities-head .head-saves");
        const cur = q(".tab[data-tab='character'] .cairn-abilities-head .head-current");
        const words = q(".tab[data-tab='character'] .cairn-ability.STR-ability .cairn-ability-words");
        R8.saves = {
          text: saves?.textContent.trim() ?? null,
          left: saves ? Math.round(saves.getBoundingClientRect().left) : null,
          wordsLeft: words ? Math.round(words.getBoundingClientRect().left) : null,
          size: saves ? getComputedStyle(saves).fontSize : null,
          curSize: cur ? getComputedStyle(cur).fontSize : null,
        };

        // d. CharGen off: the four max boxes are disabled with the locked
        // tooltip, and a submit leaves the maxes as they were. The boxes are
        // planted with other numbers IN THE PAGE, then a current score is
        // changed so the form submits: a live box would send its number.
        const maxSel = ['input[name="system.abilities.STR.max"]', 'input[name="system.abilities.DEX.max"]',
          'input[name="system.abilities.WIL.max"]', 'input[name="system.hp.max"]'];
        const boxes = () => maxSel.map((s) => q(`.tab[data-tab='character'] ${s}`));
        R8.off = boxes().map((n) => ({ disabled: n?.disabled ?? null, tip: n?.dataset.tooltip ?? null }));
        const maxesWas = { STR: 12, DEX: 10, WIL: 11, HP: 6 };
        for (const n of boxes()) if (n) n.value = "3";
        const strIn = q(".tab[data-tab='character'] input[name='system.abilities.STR.value']");
        if (strIn) { strIn.value = "8"; strIn.dispatchEvent(new Event("change", { bubbles: true })); }
        await until(() => notesPc._source.system.abilities.STR.value === 8, 3000);
        await sleep(600);
        const src = notesPc._source.system;
        R8.submitted = { strValue: src.abilities.STR.value,
          maxes: { STR: src.abilities.STR.max, DEX: src.abilities.DEX.max, WIL: src.abilities.WIL.max, HP: src.hp.max } };
        R8.maxesWas = maxesWas;
        // Put back whatever a live box may have written, before the next case.
        await notesPc.update({ "system.abilities.STR.max": 12, "system.abilities.DEX.max": 10, "system.abilities.WIL.max": 11, "system.hp.max": 6 }, { abNoStatusCard: true });
        await sleep(300);

        // e. CharGen on: live, with the boxes' own tooltips.
        const was = boxes()[0];
        await notesPc.update({ "system.generationEnabled": true }, { abNoStatusCard: true });
        await until(() => { const n = boxes()[0]; return !!n && n !== was; }, 5000);
        await sleep(300);
        R8.on = boxes().map((n) => ({ disabled: n?.disabled ?? null, tip: n?.dataset.tooltip ?? null }));

        // Leg 20, Omen ON (CharGen on, so the die and the list draw): laid
        // out like a Bond, measured in both schemes.
        {
          const wasOmen = q(".tab[data-tab='notes'] .notes-omen .omen-row");
          await notesPc.update({ "system.omenEnabled": true, "system.omen": "ZZ an omen" }, { abNoStatusCard: true });
          await until(() => { const n = q(".tab[data-tab='notes'] .notes-omen .omen-row"); return !!n && n !== wasOmen && !!n.querySelector(".omen-input"); }, 5000);
          const measureOmen = async () => {
            await ns.changeTab("notes", "primary");
            await until(() => (q(".tab[data-tab='notes'] .notes-omen .omen-input")?.getBoundingClientRect().height ?? 0) > 0, 4000);
            await sleep(200);
            const head = q(".tab[data-tab='notes'] .notes-omen .omen-head");
            const lab = q(".tab[data-tab='notes'] .notes-omen .omen-label");
            const die = q(".tab[data-tab='notes'] .notes-omen .omen-roll");
            const list = q(".tab[data-tab='notes'] .notes-omen .omen-pick");
            const ta = q(".tab[data-tab='notes'] .notes-omen .omen-input");
            const ans = q(".tab[data-tab='notes'] .bond-answer");
            const lb = lab?.getBoundingClientRect(), db = die?.getBoundingClientRect(), pb = list?.getBoundingClientRect();
            const hb = head?.getBoundingClientRect(), tb = ta?.getBoundingClientRect();
            const cs = ta ? getComputedStyle(ta) : null;
            const ANS = ["fontFamily", "fontSize", "fontWeight", "fontStyle"];
            const pick = (n) => { const c = n ? getComputedStyle(n) : null; return Object.fromEntries(ANS.map((k) => [k, c?.[k] ?? null])); };
            const under = ta ? await ground(ta.parentElement) : null;
            const bg = cs ? rgb(cs.backgroundColor) : [];
            return {
              inHead: !!head && [lab, die, list].every((n) => !!n && head.contains(n)),
              dieRight: !!lb && !!db && !!pb && db.left >= lb.right - 0.5 && pb.left >= db.left,
              sameRow: !!lb && !!db && db.top < lb.bottom && db.bottom > lb.top,
              below: !!hb && !!tb && tb.top >= hb.bottom - 0.5,
              indented: !!tb && !!lb && cs && tb.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) >= lb.left + 6,
              rule: cs ? { width: cs.borderLeftWidth, style: cs.borderLeftStyle, color: cs.borderLeftColor } : null,
              box: cs ? { top: cs.borderTopWidth, right: cs.borderRightWidth, bottom: cs.borderBottomWidth,
                topStyle: cs.borderTopStyle, rightStyle: cs.borderRightStyle, bottomStyle: cs.borderBottomStyle,
                clear: bg.length >= 4 ? bg[3] === 0 : bg.length === 0, shadow: cs.boxShadow } : null,
              font: pick(ta), ansFont: pick(ans),
              contrast: cs && under ? Math.round(ratio(cs.borderLeftColor, under) * 100) / 100 : null,
            };
          };
          R8.omenOn = {};
          try {
            for (const scheme of ["light", "dark"]) {
              const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
              cfg.colorScheme = { applications: scheme, interface: scheme };
              game.configureUI(cfg);
              const was = q(".tab[data-tab='notes'] .notes-omen .omen-input");
              await ns.render();
              await until(() => { const n = q(".tab[data-tab='notes'] .notes-omen .omen-input"); return !!n && n !== was; }, 5000);
              await sleep(200);
              R8.omenOn[scheme] = await measureOmen();
            }
          } finally {
            game.configureUI(game.settings.get("core", "uiConfig"));
            await ns.render();
            await sleep(400);
          }
        }
      } finally {
        await ns.close();
        if (bondsWas === false) await game.settings.set("air-bladder", "use-bonds", false);
        if (omensWas === false) await game.settings.set("air-bladder", "show-omens", false);
      }
    }

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
  R.blank?.label === R.blank?.want && R.blank?.labelLeads && R.blank?.text === "" && R.blank?.pen
    ? ok(`with no traits and no age the pen stands alone under the "${R.blank.label}" label`)
    : fail(`blank sentence slot: ${JSON.stringify(R.blank)}`);
  // 20
  const t20 = R.t20 ?? {};
  const sameBgFace = !!t20.bgFace?.fontFamily && JSON.stringify(t20.face) === JSON.stringify(t20.bgFace);
  t20.label === t20.want && t20.above && sameBgFace
    ? ok(`a "${t20.label}" label stands above the trait sentence, in the Background label's face`)
    : fail(`Traits label: ${JSON.stringify(t20)}`);
  t20.rule && parseFloat(t20.rule.width) >= 1 && t20.rule.style !== "none" && (t20.gap ?? -1) >= 4
    ? ok(`a thin rule (${t20.rule.width} ${t20.rule.style}) under the sentence, ${t20.gap}px before the header`)
    : fail(`rule under the sentence: ${JSON.stringify({ rule: t20.rule, gap: t20.gap })}`);
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
  l6.label === R6.wantLabel && l6.sameHalf && l6.order && l6.inBox && l6.noGrowth && l6.barFilled
    && l6.tips?.up === R6.wantUp && l6.tips?.down === R6.wantDown
    ? ok(`HP's box reads + "${l6.label}" − in its label half, with "${l6.tips.up}" and "${l6.tips.down}", no taller than the numbers`)
    : fail(`HP buttons layout: ${JSON.stringify(l6)}`);
  ["light", "dark"].every((s) => R6.ink?.[s]?.length === 2 && R6.ink[s].every((x) => x.ratio >= 3))
    ? ok(`HP's + and − read on the bar in both schemes (light ${R6.ink.light.map((x) => x.ratio).join("/")}, dark ${R6.ink.dark.map((x) => x.ratio).join("/")})`)
    : fail(`HP buttons' ink on the bar: ${JSON.stringify(R6.ink ?? null)}`);
  R6.at4?.up === false && R6.at4?.down === false && R6.steps?.up === 5 && R6.steps?.down1 === 4 && R6.steps?.down2 === 3
    ? ok("at 4 / 6 + steps to 5, then − twice to 3")
    : fail(`HP steps: ${JSON.stringify({ at4: R6.at4, steps: R6.steps })}`);
  R6.at6?.up === true && R6.at6?.down === false && R6.capped === 6 && R6.at0?.down === true && R6.at0?.up === false && R6.floored === 0
    ? ok("+ is off at max and − at 0; neither steps past its bound")
    : fail(`HP bounds: ${JSON.stringify({ at6: R6.at6, capped: R6.capped, at0: R6.at0, floored: R6.floored })}`);
  R6.burdened?.up === true && R6.burdened?.down === true && R6.forcedLive && R6.burdenedStored === 4
    ? ok("overburdened, both are off, and a forced + leaves the stored 4 alone")
    : fail(`HP while overburdened: ${JSON.stringify({ burdened: R6.burdened, live: R6.forcedLive, stored: R6.burdenedStored })}`);

  // 18
  const R7 = r.r7 ?? {};
  R7.hint?.text === R7.wantHint && R7.hint?.down && !R7.hint?.up && /read its description/.test(R7.wantHint)
    ? ok(`the hint reads "${R7.hint.text}" with a hand pointing down`)
    : fail(`hint words / hand: ${JSON.stringify(R7.hint)} (want ${JSON.stringify(R7.wantHint)})`);
  R7.ab?.order && R7.ab?.under && R7.ab?.centred && R7.ab?.at9?.down === false && R7.ab?.at9?.up === false
    && R7.steps?.up === 10 && R7.steps?.down === 9
    ? ok("STR's circle has − then + under it, centred; + steps 9 to 10, − back to 9")
    : fail(`ability ±: ${JSON.stringify({ ab: R7.ab, steps: R7.steps })}`);
  R7.at12?.up === true && R7.at12?.down === false && R7.at0?.down === true && R7.at0?.up === false
    ? ok("+ is off at max and − at 0")
    : fail(`ability ± bounds: ${JSON.stringify({ at12: R7.at12, at0: R7.at0 })}`);
  R7.nameSize === "28px"
    ? ok("the character's name is 28px")
    : fail(`name size: ${JSON.stringify(R7.nameSize)}`);
  R7.lang !== "en" || /^CharGen: (On|Off)$/.test(R7.toggle ?? "")
    ? ok(`the title bar's toggle reads "${R7.toggle}"`)
    : fail(`toggle label: ${JSON.stringify(R7.toggle)}`);

  // 19
  const R8 = r.r8 ?? {};
  const sameFace = (f) => !!f && !!R8.labelFace?.fontFamily && JSON.stringify(f) === JSON.stringify(R8.labelFace);
  R8.labelFace?.fontVariantCaps === "small-caps" && ["bond", "question", "description", "omen"].every((k) => sameFace(R8.faces?.[k]))
    ? ok("the Bond heading, the question, the Description heading and Omen's label wear page 1's Background label face, small caps")
    : fail(`notes headings' face: ${JSON.stringify({ want: R8.labelFace, got: R8.faces })}`);
  R8.bondText === R8.wantBond && !/:\s*$/.test(R8.bondText ?? ":")
    ? ok(`the Bond heading reads "${R8.bondText}", no colon`)
    : fail(`Bond heading text: ${JSON.stringify(R8.bondText)}`);
  ["light", "dark"].every((s) => R8.indent?.[s]?.length === 2 && R8.indent[s].every((x) => x.indented
    && x.rule && parseFloat(x.rule.width) >= 1 && x.rule.style !== "none" && x.contrast >= 1.5))
    ? ok(`each answer sits indented under a visible left rule in both schemes (contrast light ${R8.indent.light.map((x) => x.contrast).join("/")}, dark ${R8.indent.dark.map((x) => x.contrast).join("/")})`)
    : fail(`answers' indent / rule: ${JSON.stringify(R8.indent ?? null)}`);
  const sv = R8.saves ?? {};
  sv.text === R8.wantSaves && sv.left !== null && sv.wordsLeft !== null && Math.abs(sv.left - sv.wordsLeft) <= 2 && sv.size === sv.curSize
    ? ok(`"${sv.text}" heads the ability names, the size of "Current"`)
    : fail(`Saves header: ${JSON.stringify(sv)} (want ${JSON.stringify(R8.wantSaves)})`);
  R8.off?.length === 4 && R8.off.every((b) => b.disabled === true && b.tip === R8.wantLocked)
    ? ok(`CharGen off: the four max boxes are disabled, "${R8.wantLocked}"`)
    : fail(`max boxes with CharGen off: ${JSON.stringify(R8.off)}`);
  R8.submitted?.strValue === 8 && JSON.stringify(R8.submitted?.maxes) === JSON.stringify(R8.maxesWas)
    ? ok("...and a submit with other numbers planted in them leaves every max as it was")
    : fail(`submit with CharGen off: ${JSON.stringify(R8.submitted)} (want maxes ${JSON.stringify(R8.maxesWas)})`);
  R8.on?.length === 4 && R8.on.every((b) => b.disabled === false && b.tip !== R8.wantLocked) && R8.on[0].tip === R8.wantMaxTip
    ? ok("CharGen on: the max boxes are live, with their own tooltips")
    : fail(`max boxes with CharGen on: ${JSON.stringify(R8.on)}`);
  // 20 (Omen)
  const oo = R8.omenOff ?? {};
  oo.text === oo.want && !!oo.phFace?.fontFamily && JSON.stringify(oo.face) === JSON.stringify(oo.phFace)
    ? ok("Omen off: the new hint, in the notes editor placeholder's face")
    : fail(`Omen off, hint: ${JSON.stringify({ text: oo.text, want: oo.want, face: oo.face, phFace: oo.phFace })}`);
  oo.below && oo.indented && oo.rule && parseFloat(oo.rule.width) >= 1 && oo.rule.style !== "none"
    ? ok("Omen off: the hint sits under the label, indented on the answers' rule")
    : fail(`Omen off, place: ${JSON.stringify(oo)}`);
  const on = R8.omenOn ?? {};
  const omenOk = (x) => !!x && x.inHead && x.dieRight && x.sameRow && x.below && x.indented
    && x.rule && parseFloat(x.rule.width) >= 1 && x.rule.style !== "none" && x.contrast >= 1.5;
  ["light", "dark"].every((s) => omenOk(on[s]))
    ? ok(`Omen on: die and list on the heading row right of the label, the text below, indented on a visible rule (contrast light ${on.light?.contrast}, dark ${on.dark?.contrast})`)
    : fail(`Omen on, layout: ${JSON.stringify(on)}`);
  const unboxed = (b) => !!b && ["top", "right", "bottom"].every((k) => b[k] === "0px" || b[`${k}Style`] === "none") && b.clear && b.shadow === "none";
  ["light", "dark"].every((s) => unboxed(on[s]?.box) && !!on[s]?.ansFont?.fontFamily && JSON.stringify(on[s].font) === JSON.stringify(on[s].ansFont))
    ? ok("Omen on: the text has no field box and wears the answers' face")
    : fail(`Omen on, box / face: ${JSON.stringify({ light: on.light && { box: on.light.box, font: on.light.font, ans: on.light.ansFont }, dark: on.dark && { box: on.dark.box, font: on.dark.font, ans: on.dark.ansFont } })}`);

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

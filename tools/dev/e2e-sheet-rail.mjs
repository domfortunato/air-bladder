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
 * Character, Inventory, Growth, Description, Background & Notes, then the
 * Improvised Attack. The npc sheet keeps its text tab strip. What this holds:
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
 *   7. the rail's Improvised Attack is the inventory row's own action and opens
 *      its dialog;
 *   8. an npc sheet draws no rail and keeps its strip;
 *   9. a player OBSERVING the character can turn its pages (the rail stays live
 *      on a sheet they cannot edit) and is offered no Improvised Attack;
 *  10. a LIMITED viewer's rail is hidden and empty.
 *
 * Added 2026-11-19 (user asks, the second round):
 *   3b. the "For Use With Cairn" footer stands under EVERY page (outside the
 *      pages, as Base Knavery's Made for Knave footer), once;
 *  11. page 1 carries an Improvised Attack button under Die of Fate, the rail's
 *      red burst, the same action, live on a sheet the viewer cannot edit;
 *  12. Deprived (over Panicked) stands in the vitals column, under HP and above
 *      Slots and Rest;
 *  13. a click on the slot line, or on the Overburdened banner, turns to
 *      Inventory.
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
      system: { hp: { value: 4, max: 6 } },
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
      description: L("CAIRN.Description"),
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

    /* ---- 6. the journal shows what is stored --------------------------- */
    await pc.update({ "system.growth": "<p>ZZ grew in the world</p>" });
    const journal = () => frame.querySelector('.tab[data-tab="growth"] prose-mirror[name="system.growth"]');
    await until(() => journal()?.textContent.includes("ZZ grew in the world"));
    out.journal = {
      stored: pc._source.system.growth ?? null,
      shown: journal()?.textContent.includes("ZZ grew in the world") ?? false,
      placeholderGone: !journal()?.querySelector(".cairn-editor-placeholder"),
    };

    /* ---- 7. the rail's Improvised Attack ------------------------------- */
    const atk = frame.querySelector("nav.cairn-tab-rail button.cairn-rail-attack");
    out.attack = { present: !!atk, action: atk?.dataset.action ?? null,
      rowAction: frame.querySelector(".improvised-row [data-action]")?.dataset.action ?? null };
    if (atk) {
      const stale = new Set(document.querySelectorAll(".application.dialog"));
      atk.click();
      let dlg = null;
      const t0 = Date.now();
      while (!(dlg = [...document.querySelectorAll(".application.dialog")].find((d) => !stale.has(d))) && Date.now() - t0 < 5000) await sleep(100);
      out.attack.dialog = !!dlg;
      dlg?.querySelector('[data-action="close"]')?.click();
      const t1 = Date.now();
      while (dlg?.isConnected && Date.now() - t1 < 5000) await sleep(100);
    }

    /* ---- 11. page 1's Improvised Attack button, under Die of Fate ------- */
    await sheet.changeTab("character", "primary");
    await sleep(300);
    const fate = frame.querySelector("#die-of-fate-button");
    const btn = frame.querySelector('.tab[data-tab="character"] .cairn-vital-buttons [data-action="improvisedAttack"]');
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
      out.button.dialog = !!dlg;
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
    await sheet.close();

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
      railed: ne.classList.contains("cairn-railed"), width: npc.sheet.position.width };
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
            || !!el.querySelector('.cairn-vital-buttons [data-action="improvisedAttack"]') };
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
  const want = ["character", "items", "growth", "description", ...(r.showContainers ? ["containers"] : []), "notes"];
  const icons = { character: "fa-mask", items: "fa-sack", growth: "fa-seedling", description: "fa-feather", containers: "fa-link", notes: "fa-scroll" };
  const got = r.rail.pages.map((b) => b.tab);
  r.rail.present && JSON.stringify(got) === JSON.stringify(want)
    ? ok(`the rail sits in .window-content with the pages in order: ${got.join(", ")}`)
    : fail(`rail present ${r.rail.present}, pages ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  const badIcon = r.rail.pages.filter((b) => !b.icon?.split(/\s+/).includes(icons[b.tab]));
  badIcon.length === 0 && r.rail.pages.length
    ? ok("each page wears its icon (mask, sack, seedling, feather, scroll)")
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
  r.attack.present && r.attack.action === "improvisedAttack" && r.attack.action === r.attack.rowAction && r.attack.dialog
    ? ok("the rail's Improvised Attack is the inventory row's own action, and opens its dialog")
    : fail(`rail attack: ${JSON.stringify(r.attack)}`);

  // 11
  const bt = r.button;
  bt.present && bt.live && bt.afterFate && bt.below && bt.burst && bt.red && bt.dialog
    ? ok("page 1's Improvised Attack sits under Die of Fate, wears the rail's red burst, stays live, and opens its dialog")
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
        ? ok("an observing player cannot edit the sheet but can turn its pages, and is offered no Improvised Attack")
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

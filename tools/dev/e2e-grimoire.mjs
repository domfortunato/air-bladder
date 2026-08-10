#!/usr/bin/env node
/**
 * The item Grimoire — pages, the one-book wall, travel, and the cast flow
 * (module/grimoire.js + CairnItem, 2026-08-09).
 *
 *   npm run dev:grimoire      (dev world on :30000; needs Alice — npm run dev:players)
 *
 * Two phases, the GM page staying open through Alice's (the dev:grimoire
 * shape the old role-book probe set): the GM owns the fixtures and the
 * enforcement legs, Alice proves a player can cast from her own character.
 *
 * DICE ARE SHADOWED, never trusted: the cast legs pin
 * `CONFIG.Dice.randomUniform` to a planted sequence in-page (restored in
 * finally), so "doubles" and "two dice came up 4-6" are chosen by the leg,
 * not rolled — a doubles assertion on a real 2d6 greens one run in six.
 *
 * Legs:
 *   1. resolveSpellText, as a unit: block selection by power (preamble kept,
 *      absent block = whole text), [sum]/[dice]/[dado] substitution,
 *      arithmetic ([sum*10], the × spelling), and the refusal to touch
 *      non-numeric brackets ([8 HP, 3 STR...]). A resolved value comes back
 *      wrapped in a grimoire-resolved span whose tooltip holds the authored
 *      expression (ruling 2026-08-10) — asserted as the exact shape here,
 *      and on the rendered card in leg 6.
 *   2. Transmute: with a Grimoire carried, a spellbook row offers the control
 *      and the confirm binds it — bound, weightless, grouped after the book's
 *      row with a Page chip, slots freed. A scroll transmutes too, and comes
 *      out a PAGE: scroll off, uses cleared. Before any page exists the book
 *      row has no Cast control; after the first it does.
 *   3. Bound is forever: a direct un-bind write is stripped, a hostile write
 *      (bound off, weightless off) leaves both pinned.
 *   4. The one-book wall, BOTH layers independently: the drop handler returns
 *      null (affordance), and a bare createEmbeddedDocuments is refused by
 *      _preCreate (enforcement). An npc PILE takes two books happily — the
 *      wall is character-only.
 *   5. Page capacity: at pages == grimoirePages the transmute control is gone
 *      AND the handler refuses (a sheet rendered before the book filled must
 *      not be a way through).
 *   6. The cast, seeded [4,4]: public card carries the localized spell name
 *      and the RESOLVED effect (sum 8 -> "80 damage"), whisper goes to the
 *      caster alone with dice, sum, the 2-Fatigue line, the Add-2-Fatigue
 *      button, the Mishap line and a drawn Mishaps-table row (world-first
 *      resolution against the shipped pack). Both tiles identify themselves
 *      in the flavor line — a lit "GLOG" tag opens it, then "{name}'s Spell"
 *      on the card, and on doubles the whisper's escalates to the mishap
 *      wording (rulings 2026-08-10).
 *   7. The cast, seeded [1,4]: no doubles -> no mishap, and the whisper SAYS
 *      so outright (the no-mishap line, absent on doubles); its flavor stays
 *      the plain spell line; the fatigue line takes its _one form. Block
 *      selection picks the power-2 block.
 *   8. The Fatigue button: clicked at a FULL pack it still lands both
 *      Fatigue items (ignoreCapacity — a cost, never refused); the message
 *      flag spends it, so a second click adds nothing.
 *   9. Dice cap: free slots pin the power select (min(4, free)); at zero
 *      free slots the cast refuses with the no-dice warning.
 *  10. Travel: dropping the book on a pile moves it AND every page; dropping
 *      it back brings the library home; a page dragged alone is refused.
 *  11. Alice casts from her own character end-to-end: public card + whisper
 *      addressed to Alice, not the GM.
 *
 * Everything planted is swept from Node in finally, names and ids printed.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(56)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(56)} ${d}`); failures++; };
const check = (cond, l, d = "") => (cond ? ok(l, d) : fail(l, d));

watchdog(420000, "grimoire probe");
const browser = await chromium.launch();
const gm = await browser.newPage({ viewport: VIEWPORT });
const gmErrors = watchErrors(gm);
await gm.goto(FOUNDRY_URL);
await joinAsGM(gm);
await dismissChrome(gm);

/** Poll in-page until fn(arg) is truthy (or times out). */
const until = async (page, fn, arg, ms = 8000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await page.evaluate(fn, arg);
    if (last) return last;
    await page.waitForTimeout(200);
  }
  return last;
};

const cleanup = { actorIds: [], itemIds: [], msgsAfter: null };

try {
  /* ------------------------------------------------------------ fixtures -- */
  const fx = await gm.evaluate(async () => {
    for (const a of game.actors.filter((x) => x.name?.startsWith("ZZ Grim"))) await a.delete();
    for (const i of game.items.filter((x) => x.name?.startsWith("ZZ Grim"))) await i.delete();
    const alice = game.users.find((u) => u.name === "Alice");
    if (!alice) return { error: "no Alice — run npm run dev:players" };

    const caster = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Caster", type: "character",
      ownership: { default: 0, [alice.id]: 3 },
    });
    // Planted under a settings-read shadow forcing GLOG OFF: these legs
    // exercise the setting-INDEPENDENT grimoire mechanics of a 2e world, and
    // Alpha/Beta/Delta must arrive as slot-consuming BOOKS. Without the
    // shadow, a world playing in GLOG mode (the dev world, the user's choice)
    // makes CairnItem._preCreate convert them to weightless scrolls at create
    // and the freed-slot leg goes 2 -> 2. Establish the precondition, never
    // assume the world's value — and never write it.
    const origGet = game.settings.get;
    game.settings.get = function (scope, key, ...rest) {
      if (scope === game.system.id && key === "enable-glog-magic") return false;
      return origGet.call(this, scope, key, ...rest);
    };
    try {
      await caster.createEmbeddedDocuments("Item", [
        { name: "ZZ Grim Tome", type: "item",
          system: { grimoire: true, grimoirePages: 3, bulky: true } },
        { name: "ZZ Spell Alpha", type: "spellbook",
          system: { description: "<p>[1] A candle-flame. [2] A roaring blast dealing [sum*10] damage.</p>" } },
        { name: "ZZ Spell Beta", type: "spellbook",
          system: { description: "<p>It lasts [sum] rounds across [dice] targets, or [dado] in Spanish.</p>" } },
        { name: "ZZ Scroll Gamma", type: "spellbook",
          system: { description: "<p>[8 HP, 3 STR, 11 DEX] guards it.</p>", scroll: true } },
        { name: "ZZ Spell Delta", type: "spellbook",
          system: { description: "<p>Nothing varies.</p>" } },
      ]);
    } finally { game.settings.get = origGet; }
    if (caster.items.find((i) => i.name === "ZZ Spell Alpha")?.system.scroll) {
      return { error: "planted book arrived as a scroll DESPITE the shadow — the seam is not reading game.settings.get" };
    }
    const pile = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Pile", type: "npc",
      system: { role: "container", containerClass: "pile", slots: 10 },
    });
    return {
      casterId: caster.id, pileId: pile.id, aliceId: alice.id,
      msgsBefore: game.messages.size,
    };
  });
  if (fx.error) { fail("fixtures", fx.error); process.exit(1); }
  cleanup.actorIds.push(fx.casterId, fx.pileId);
  console.log(`  note  planted: caster ${fx.casterId}, pile ${fx.pileId}`);

  /* --------------------------------------------- 1. the resolver, as a unit */
  const unit = await gm.evaluate(async () => {
    const { resolveSpellText } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    return {
      block2: resolveSpellText("Pre. [1] one. [2] two.", 2, 7),
      blockAbsent: resolveSpellText("Pre. [1] one. [2] two.", 3, 7),
      noBlocks: resolveSpellText("Just [sum] words.", 1, 5),
      subs: resolveSpellText("[sum] r, [dice] t, [dado] d", 3, 11),
      math: resolveSpellText("deal [sum*10] now, then [sum×10] again", 2, 8),
      statBlock: resolveSpellText("[8 HP, 3 STR, 11 DEX] guards", 1, 5),
    };
  });
  // A resolved value comes back MARKED: the exact wrapped shape, tooltip
  // carrying the authored expression (ruling 2026-08-10).
  const rv = (expr, v) => `<span class="grimoire-resolved" data-tooltip="${expr}">${v}</span>`;
  check(unit.block2 === "Pre.  two.", "block selection picks the power's block, preamble kept", JSON.stringify(unit.block2));
  check(unit.blockAbsent === "Pre. [1] one. [2] two.", "an absent block leaves the whole text standing");
  check(unit.noBlocks === `Just ${rv("[sum]", 5)} words.`, "[sum] substitutes without blocks, value marked", unit.noBlocks);
  check(unit.subs === `${rv("[sum]", 11)} r, ${rv("[dice]", 3)} t, ${rv("[dado]", 3)} d`,
    "[sum]/[dice]/[dado] all substitute, each marked with its own expression", unit.subs);
  check(unit.math === `deal ${rv("[sum*10]", 80)} now, then ${rv("[sum×10]", 80)} again`,
    "arithmetic evaluates, both * and × spellings, the AUTHORED spelling in each tooltip", unit.math);
  check(unit.statBlock === "[8 HP, 3 STR, 11 DEX] guards", "a non-numeric bracket is never touched — and never marked");

  /* ------------------------------------------------- 2. transmute, via UI -- */
  // Render the caster's sheet and read the affordances.
  await gm.evaluate(async (id) => { await game.actors.get(id).sheet.render(true); }, fx.casterId);
  const sheetSel = `[id$="CairnActorSheet-Actor-${fx.casterId}"]`;
  await gm.waitForSelector(`${sheetSel} .cairn-items-list-row`, { timeout: 8000 });

  const before = await gm.evaluate((id) => {
    const a = game.actors.get(id);
    const el = a.sheet.element;
    const rowOf = (name) => [...el.querySelectorAll("[data-item-id]")]
      .find((r) => r.textContent.includes(name));
    return {
      castOnBook: !!rowOf("ZZ Grim Tome")?.querySelector('[data-action="grimoireCast"]'),
      transmuteOnAlpha: !!rowOf("ZZ Spell Alpha")?.querySelector('[data-action="pageTransmute"]'),
      slotsUsed: a.system.slotsUsed,
    };
  }, fx.casterId);
  check(!before.castOnBook, "no pages yet: the book row offers no Cast control");
  check(before.transmuteOnAlpha, "a spellbook row offers Transmute while the book is carried");

  // Click the real control, confirm the real dialog.
  await gm.evaluate((id) => {
    const el = game.actors.get(id).sheet.element;
    [...el.querySelectorAll("[data-item-id]")]
      .find((r) => r.textContent.includes("ZZ Spell Alpha"))
      .querySelector('[data-action="pageTransmute"]').click();
  }, fx.casterId);
  await gm.waitForSelector("dialog .form-footer button", { timeout: 8000 });
  await gm.evaluate(() => {
    const dlg = [...foundry.applications.instances.values()]
      .find((a) => a.constructor.name === "DialogV2");
    dlg.element.querySelector('[data-action="yes"]')?.click();
  });
  const alpha = await until(gm, (id) => {
    const a = game.actors.get(id);
    const it = a.items.find((i) => i.name === "ZZ Spell Alpha");
    return it.system.bound ? {
      bound: it.system.bound, weightless: it.system.weightless,
      slotsUsed: a.system.slotsUsed,
    } : null;
  }, fx.casterId);
  check(alpha?.bound === true && alpha?.weightless === true,
    "the confirm binds it: bound + weightless", JSON.stringify(alpha));
  check(alpha?.slotsUsed === before.slotsUsed - 1,
    "the page freed its slot", `${before.slotsUsed} -> ${alpha?.slotsUsed}`);

  const grouped = await until(gm, (id) => {
    const el = game.actors.get(id).sheet.element;
    const rows = [...el.querySelectorAll("[data-item-id]")];
    const bookAt = rows.findIndex((r) => r.textContent.includes("ZZ Grim Tome"));
    const pageAt = rows.findIndex((r) => r.textContent.includes("ZZ Spell Alpha"));
    if (bookAt < 0 || pageAt < 0) return null;
    return {
      adjacent: pageAt === bookAt + 1,
      pageClass: rows[pageAt].classList.contains("grimoire-page"),
      chip: rows[pageAt].textContent.includes(game.i18n.localize("CAIRN.GrimoirePage")),
      castOnBook: !!rows[bookAt].querySelector('[data-action="grimoireCast"]'),
    };
  }, fx.casterId);
  check(grouped?.adjacent && grouped?.pageClass && grouped?.chip,
    "the page renders grouped under the book, indented, chipped", JSON.stringify(grouped));
  check(grouped?.castOnBook, "with a page bound, the book row offers Cast");

  /* --------------------------------------------------- 3. bound is forever */
  const pinned = await gm.evaluate(async (id) => {
    const it = game.actors.get(id).items.find((i) => i.name === "ZZ Spell Alpha");
    await it.update({ "system.bound": false });
    const afterUnbind = it.system.bound;
    await it.update({ system: { bound: false, weightless: false, equipped: true } });
    return { afterUnbind, bound: it.system.bound, weightless: it.system.weightless, equipped: it.system.equipped };
  }, fx.casterId);
  check(pinned.afterUnbind === true, "a direct un-bind write is stripped");
  check(pinned.bound === true && pinned.weightless === true && pinned.equipped === false,
    "a hostile write leaves every pin in place", JSON.stringify(pinned));

  /* -------------------------------------------------- 4. the one-book wall */
  const wall = await gm.evaluate(async ({ casterId, pileId }) => {
    const caster = game.actors.get(casterId);
    const world = await CONFIG.Item.documentClass.create({
      name: "ZZ Grim Book2", type: "item", system: { grimoire: true, grimoirePages: 5 } });
    // Layer 1: the drop handler (a stale sheet's route).
    const viaDrop = await caster.sheet._onDropItem({ preventDefault: () => {} }, world);
    const afterDrop = caster.items.filter((i) => i.system?.grimoire).length;
    // Layer 2: a bare create (a macro's route).
    await caster.createEmbeddedDocuments("Item", [world.toObject()]);
    const afterCreate = caster.items.filter((i) => i.system?.grimoire).length;
    // A pile is exempt.
    const pile = game.actors.get(pileId);
    await pile.createEmbeddedDocuments("Item", [world.toObject(), world.toObject()]);
    const onPile = pile.items.filter((i) => i.system?.grimoire).length;
    return { worldId: world.id, viaDrop, afterDrop, afterCreate, onPile };
  }, { casterId: fx.casterId, pileId: fx.pileId });
  cleanup.itemIds.push(wall.worldId);
  check(wall.viaDrop === null && wall.afterDrop === 1,
    "layer 1: the drop handler refuses a second book");
  check(wall.afterCreate === 1,
    "layer 2: a bare createEmbeddedDocuments is refused by _preCreate");
  check(wall.onPile === 2, "an npc pile takes two books — the wall is character-only");
  await gm.evaluate(async (pileId) => {
    const pile = game.actors.get(pileId);
    await pile.deleteEmbeddedDocuments("Item", pile.items.filter((i) => i.system?.grimoire).map((i) => i.id));
  }, fx.pileId);

  /* ---------------------------------------------------- 5. page capacity -- */
  // Fill the book: transmute Beta and Gamma directly (the dialog is leg-2's).
  const cap = await gm.evaluate(async (id) => {
    const a = game.actors.get(id);
    const beta = a.items.find((i) => i.name === "ZZ Spell Beta");
    const gamma = a.items.find((i) => i.name === "ZZ Scroll Gamma");
    const gammaWasScroll = gamma.system.scroll === true;
    await beta.update({ "system.bound": true });
    await gamma.update({ "system.bound": true });
    return {
      gammaWasScroll,
      gamma: { bound: gamma.system.bound, scroll: gamma.system.scroll,
        usesMax: gamma.system.uses.max, weightless: gamma.system.weightless },
      pages: a.items.filter((i) => i.system?.bound).length,
    };
  }, fx.casterId);
  check(cap.gammaWasScroll && cap.gamma.bound && cap.gamma.scroll === false && cap.gamma.usesMax === 0,
    "a transmuted scroll comes out a PAGE: scroll off, uses cleared", JSON.stringify(cap.gamma));
  check(cap.pages === 3, "the book holds 3/3 pages");

  const full = await until(gm, (id) => {
    const a = game.actors.get(id);
    const el = a.sheet.element;
    const row = [...el.querySelectorAll("[data-item-id]")]
      .find((r) => r.textContent.includes("ZZ Spell Delta"));
    if (!row) return null;
    return { control: !!row.querySelector('[data-action="pageTransmute"]'), probed: true };
  }, fx.casterId);
  check(full?.probed && !full.control, "at capacity the Transmute control is gone");
  const fullEnforced = await gm.evaluate(async (id) => {
    const a = game.actors.get(id);
    const delta = a.items.find((i) => i.name === "ZZ Spell Delta");
    // Drive the handler with a synthetic target, the stale-sheet route.
    const rowEl = [...a.sheet.element.querySelectorAll("[data-item-id]")]
      .find((r) => r.dataset.itemId === delta.id);
    const target = rowEl ?? Object.assign(document.createElement("a"),
      { closest: () => ({ dataset: { itemId: delta.id } }) });
    const warns = [];
    const orig = ui.notifications.warn;
    ui.notifications.warn = (m) => { warns.push(String(m)); };
    try {
      await a.sheet.constructor.prototype.constructor
        .DEFAULT_OPTIONS.actions.pageTransmute.call(a.sheet, { preventDefault: () => {} }, target);
    } finally { ui.notifications.warn = orig; }
    return { bound: delta.system.bound, warned: warns.length > 0 };
  }, fx.casterId);
  check(fullEnforced.bound === false && fullEnforced.warned,
    "and the handler refuses with the full warning (enforcement)");

  /* -------------------------------------------------- 6. the cast, seeded -- */
  const seedCast = async (page, sequence) => page.evaluate(async ({ id, seq }) => {
    const { castFromGrimoire } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const a = game.actors.get(id);
    let i = 0;
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => seq[Math.min(i++, seq.length - 1)];
    try {
      const msgsBefore = game.messages.size;
      const p = castFromGrimoire(a);
      // Answer the dialog: pick Alpha, invest 2 dice.
      for (let t = 0; t < 40; t++) {
        const dlg = [...foundry.applications.instances.values()]
          .find((x) => x.constructor.name === "DialogV2" && x.element?.querySelector('select[name="page"]'));
        if (dlg) {
          const pageSel = dlg.element.querySelector('select[name="page"]');
          const alphaId = a.items.find((x) => x.name === "ZZ Spell Alpha").id;
          pageSel.value = alphaId;
          const diceSel = dlg.element.querySelector('select[name="dice"]');
          const options = diceSel.options.length;
          diceSel.value = "2";
          dlg.element.querySelector('[data-action="cast"]').click();
          const publicCard = await p;
          // The whisper is the newest message.
          await new Promise((r) => setTimeout(r, 300));
          const msgs = [...game.messages].slice(-(game.messages.size - msgsBefore));
          const whisper = msgs.find((m) => m.whisper?.length);
          return {
            options,
            publicContent: publicCard?.content ?? "",
            publicFlavor: publicCard?.flavor ?? "",
            rollTotal: publicCard?.rolls?.[0]?.total ?? null,
            whisperContent: whisper?.content ?? "",
            whisperFlavor: whisper?.flavor ?? "",
            whisperTo: whisper?.whisper ?? [],
            whisperId: whisper?.id, publicId: publicCard?.id,
            userId: game.user.id,
          };
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return { error: "dialog never appeared" };
    } finally { CONFIG.Dice.randomUniform = orig; }
  }, { id, seq: sequence });

  let id = fx.casterId;
  // The client maps u -> Math.ceil((1 - u) * faces) (dice.mjs:366), so the
  // sequence is INVERTED: 0.4 -> face 4, 0.9 -> face 1.
  // [4,4]: sum 8, doubles, 2 fatigue.
  const castA = await seedCast(gm, [0.4, 0.4]);
  check(!castA.error && castA.rollTotal === 8, "seeded [4,4]: the roll is the real Roll, total 8", castA.error ?? "");
  check(castA.publicContent.includes(`${rv("[sum*10]", 80)} damage`) && castA.publicContent.includes("roaring blast"),
    "public card carries the RESOLVED power-2 block (sum 8 -> 80), the value marked");
  // The tooltip HOLDS "[sum*10]" on purpose, so the unresolved-marker check
  // reads the VISIBLE text only (tags stripped).
  check(!castA.publicContent.replace(/<[^>]+>/g, "").includes("[sum"),
    "no unresolved [sum] survives in the card's visible text");
  check(castA.whisperTo.length === 1 && castA.whisperTo[0] === castA.userId,
    "whisper goes to the caster alone", JSON.stringify(castA.whisperTo));
  check(castA.whisperContent.includes('data-count="2"'),
    "whisper offers Add-2-Fatigue");
  check(castA.whisperContent.includes(await gm.evaluate(() => game.i18n.localize("CAIRN.GrimoireMishapLine"))),
    "doubles: the Mishap line is present");
  check(/grimoire-mishap-text/.test(castA.whisperContent) && !/grimoire-mishap-text"><\/div>/.test(castA.whisperContent),
    "and a drawn Mishaps row rides in the whisper (world-first table resolved)");
  const castFlavorText = await gm.evaluate(() =>
    game.i18n.format("CAIRN.GrimoireCastFlavor", { name: "ZZ Grim Caster" }));
  const mishapFlavorText = await gm.evaluate(() =>
    game.i18n.format("CAIRN.GrimoireMishapFlavor", { name: "ZZ Grim Caster" }));
  const noMishapText = await gm.evaluate(() =>
    game.i18n.localize("CAIRN.GrimoireNoMishapLine"));
  check(castA.publicFlavor.includes(castFlavorText),
    "public card's flavor identifies the tile as the caster's spell", castA.publicFlavor);
  check(castA.publicFlavor.includes('class="glog-flavor-tag"') && castA.publicFlavor.includes(">GLOG<"),
    "and opens with the lit GLOG tag");
  check(castA.whisperFlavor.includes(mishapFlavorText)
    && castA.whisperFlavor.includes('class="glog-flavor-tag"'),
    "doubles: the whisper's flavor announces the magical mishap, GLOG-tagged", castA.whisperFlavor);
  check(!castA.whisperContent.includes(noMishapText),
    "and the no-mishap line is absent when a mishap happened");

  // [1,4]: no doubles, exactly 1 fatigue.
  const castB = await seedCast(gm, [0.9, 0.4]);
  check(castB.rollTotal === 5, "seeded [1,4]: total 5");
  check(!castB.whisperContent.includes(await gm.evaluate(() => game.i18n.localize("CAIRN.GrimoireMishapLine"))),
    "no doubles: no mishap");
  check(castB.whisperContent.includes(await gm.evaluate(() =>
    game.i18n.format("CAIRN.GrimoireFatigueLine_one", { count: 1 }))),
    "one 4-6 die: the _one fatigue form");
  check(castB.whisperFlavor.includes(castFlavorText) && !castB.whisperFlavor.includes(mishapFlavorText),
    "no doubles: the whisper's flavor stays the plain spell line", castB.whisperFlavor);
  check(castB.whisperContent.includes(noMishapText),
    "no doubles: the whisper SAYS no mishap outright");

  /* --------------------------------------- 8. the Fatigue button, full pack */
  const fatigue = await gm.evaluate(async ({ casterId, whisperId }) => {
    const a = game.actors.get(casterId);
    // Fill the pack to the brim first: the button must land Fatigue anyway.
    const free = a.calcCurrentMaxSlots() - a.system.slotsUsed;
    if (free > 0) {
      await a.createEmbeddedDocuments("Item",
        Array.from({ length: free }, (_, i) => ({ name: `ZZ Grim Rock ${i}`, type: "item" })));
    }
    const fatigueBefore = a.items.filter((i) => i.name === "Fatigue").length;
    const msg = game.messages.get(whisperId);
    // Render the message and click its button.
    const html = document.createElement("div");
    html.innerHTML = msg.content;
    const { bindGrimoireFatigueButton } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    bindGrimoireFatigueButton(msg, html);
    await html.querySelector(".grimoire-add-fatigue").onclick();
    const fatigueAfterFirst = a.items.filter((i) => i.name === "Fatigue").length;
    // Second click: the flag has spent it.
    bindGrimoireFatigueButton(msg, html);
    const disabledOnRebind = html.querySelector(".grimoire-add-fatigue").hasAttribute("disabled");
    if (html.querySelector(".grimoire-add-fatigue").onclick)
      await html.querySelector(".grimoire-add-fatigue").onclick();
    const fatigueAfterSecond = a.items.filter((i) => i.name === "Fatigue").length;
    return { fatigueBefore, fatigueAfterFirst, fatigueAfterSecond, disabledOnRebind,
      encumbered: a.isEncumbered() };
  }, { casterId: fx.casterId, whisperId: castA.whisperId });
  check(fatigue.encumbered, "precondition: the pack is FULL — the refusal below would be reachable");
  check(fatigue.fatigueAfterFirst === fatigue.fatigueBefore + 2,
    "Add-2-Fatigue lands both at a full pack (ignoreCapacity)",
    `${fatigue.fatigueBefore} -> ${fatigue.fatigueAfterFirst}`);
  check(fatigue.disabledOnRebind && fatigue.fatigueAfterSecond === fatigue.fatigueAfterFirst,
    "the message flag spends it: a re-render disables, a re-click adds nothing");

  /* -------------------------------------------------------- 9. the dice cap */
  const capDice = await gm.evaluate(async (id) => {
    const { castFromGrimoire } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const a = game.actors.get(id);
    // The pack is full from leg 8: zero free slots -> refusal.
    const warns = [];
    const orig = ui.notifications.warn;
    ui.notifications.warn = (m) => { warns.push(String(m)); };
    let out;
    try { out = await castFromGrimoire(a); } finally { ui.notifications.warn = orig; }
    return { out, warned: warns.some((w) => w.includes(game.i18n.format("CAIRN.Notify.GrimoireNoDice", { name: a.name }))) };
  }, fx.casterId);
  check(capDice.out === null && capDice.warned,
    "zero free slots: the cast refuses with the no-dice warning");
  // castA's dialog offered min(4, free) options — asserted from its capture.
  check(castA.options >= 1 && castA.options <= 4,
    "the power select never exceeds 4", `offered ${castA.options}`);

  /* ------------------------------------------------------------ 10. travel */
  const travel = await gm.evaluate(async ({ casterId, pileId }) => {
    const caster = game.actors.get(casterId);
    const pile = game.actors.get(pileId);
    // Clear the rocks so the return trip has room for the bulky book.
    await caster.deleteEmbeddedDocuments("Item",
      caster.items.filter((i) => i.name.startsWith("ZZ Grim Rock") || i.name === "Fatigue").map((i) => i.id));
    const book = caster.items.find((i) => i.system?.grimoire);
    await pile.sheet.render(true);
    const out1 = await pile.sheet._onDropItem({ preventDefault: () => {}, target: pile.sheet.element }, book);
    const afterOut = {
      moved: !!out1,
      casterBooks: caster.items.filter((i) => i.system?.grimoire).length,
      casterPages: caster.items.filter((i) => i.system?.bound).length,
      pileBooks: pile.items.filter((i) => i.system?.grimoire).length,
      pilePages: pile.items.filter((i) => i.system?.bound).length,
    };
    // Bring it home.
    const pileBook = pile.items.find((i) => i.system?.grimoire);
    const out2 = await caster.sheet._onDropItem({ preventDefault: () => {}, target: caster.sheet.element }, pileBook);
    const afterBack = {
      moved: !!out2,
      casterBooks: caster.items.filter((i) => i.system?.grimoire).length,
      casterPages: caster.items.filter((i) => i.system?.bound).length,
      pilePages: pile.items.filter((i) => i.system?.bound).length,
    };
    // A page alone is refused.
    const page = caster.items.find((i) => i.system?.bound);
    const warns = [];
    const orig = ui.notifications.warn;
    ui.notifications.warn = (m) => { warns.push(String(m)); };
    let pageDrop;
    try { pageDrop = await pile.sheet._onDropItem({ preventDefault: () => {} }, page); }
    finally { ui.notifications.warn = orig; }
    return { afterOut, afterBack,
      pageRefused: pageDrop === null && warns.length > 0
        && caster.items.filter((i) => i.system?.bound).length === 3 };
  }, { casterId: fx.casterId, pileId: fx.pileId });
  check(travel.afterOut.moved && travel.afterOut.pileBooks === 1 && travel.afterOut.pilePages === 3
    && travel.afterOut.casterBooks === 0 && travel.afterOut.casterPages === 0,
    "the book moved to the pile WITH all 3 pages", JSON.stringify(travel.afterOut));
  check(travel.afterBack.moved && travel.afterBack.casterBooks === 1
    && travel.afterBack.casterPages === 3 && travel.afterBack.pilePages === 0,
    "and came home the same way", JSON.stringify(travel.afterBack));
  check(travel.pageRefused, "a page dragged on its own is refused, and stays");

  /* -------------------------------------- 10b. a scroll casts with NO book -- */
  // The hack's rule: a scroll works exactly like a recorded spell, destroyed
  // after its single use. Gated on enable-glog-magic, which the probe SHADOWS
  // in-page — flipping the real setting would convert the dev world.
  const scrollFx = await gm.evaluate(async () => {
    const c = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Scrollcaster", type: "character" });
    await c.createEmbeddedDocuments("Item", [
      { name: "ZZ Scroll Solo", type: "spellbook",
        system: { description: "<p>A bolt leaps [sum*10] feet.</p>", scroll: true } },
      { name: "ZZ Scroll Used", type: "spellbook",
        system: { description: "<p>Ash.</p>", scroll: true, uses: { value: 0, max: 1 } } },
    ]);
    await c.sheet.render(true);
    return { id: c.id };
  });
  cleanup.actorIds.push(scrollFx.id);

  // BOTH directions run under a read-shadow, symmetrically — the world's real
  // value is the USER'S (they may be playing in GLOG mode right now), so the
  // differential is established in-page, never read from or written to the
  // world. The probe-precondition rule: establish it, don't assume it.
  const offState = await gm.evaluate(async (aid) => {
    const a = game.actors.get(aid);
    const origGet = game.settings.get;
    const ns = game.system.id;
    game.settings.get = function (scope, key, ...rest) {
      if (scope === ns && key === "enable-glog-magic") return false;
      return origGet.call(this, scope, key, ...rest);
    };
    try {
      await a.sheet.render(true);
      await new Promise((r) => setTimeout(r, 400));
      const rowOf = (name) => [...a.sheet.element.querySelectorAll("[data-item-id]")]
        .find((r) => r.textContent.includes(name));
      return {
        solo: !!rowOf("ZZ Scroll Solo")?.querySelector('[data-action="scrollCast"]'),
        used: !!rowOf("ZZ Scroll Used")?.querySelector('[data-action="scrollCast"]'),
        probed: !!rowOf("ZZ Scroll Solo"),
      };
    } finally { game.settings.get = origGet; }
  }, scrollFx.id);
  check(offState?.probed && !offState.solo && !offState.used,
    "setting shadowed OFF: no scroll row offers Cast (the gate's differential)");

  const scrollCastRun = await gm.evaluate(async ({ id, seq }) => {
    const { castScroll } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const a = game.actors.get(id);
    const origGet = game.settings.get;
    const ns = game.system.id;
    game.settings.get = function (scope, key, ...rest) {
      if (scope === ns && key === "enable-glog-magic") return true;
      return origGet.call(this, scope, key, ...rest);
    };
    let i = 0;
    const origRnd = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => seq[Math.min(i++, seq.length - 1)];
    try {
      // Re-render under the shadow: the affordance should appear on the
      // unspent scroll only.
      await a.sheet.render(true);
      await new Promise((r) => setTimeout(r, 400));
      const rowOf = (name) => [...a.sheet.element.querySelectorAll("[data-item-id]")]
        .find((r) => r.textContent.includes(name));
      const shadowedControls = {
        solo: !!rowOf("ZZ Scroll Solo")?.querySelector('[data-action="scrollCast"]'),
        used: !!rowOf("ZZ Scroll Used")?.querySelector('[data-action="scrollCast"]'),
      };
      const solo = a.items.find((x) => x.name === "ZZ Scroll Solo");
      const msgsBefore = game.messages.size;
      const p = castScroll(a, solo);
      for (let tADry = 0; tADry < 40; tADry++) {
        const dlg = [...foundry.applications.instances.values()]
          .find((x) => x.constructor.name === "DialogV2"
            && x.element?.querySelector('select[name="dice"]')
            && !x.element?.querySelector('select[name="page"]'));
        if (dlg) {
          dlg.element.querySelector('select[name="dice"]').value = "2";
          dlg.element.querySelector('[data-action="cast"]').click();
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      const publicCard = await p;
      await new Promise((r) => setTimeout(r, 300));
      const msgs = [...game.messages].slice(-(game.messages.size - msgsBefore));
      const whisper = msgs.find((m) => m.whisper?.length);
      // The spent scroll refuses a second cast, with the warning. Attempted
      // ONLY when the first cast actually spent it: an unspent scroll would
      // re-open the dialog and hang the run — with the spend defeated, this
      // leg must RED, not hang (the timed-witness rule).
      const warns = [];
      let second = undefined;
      if (solo.system.uses.value === 0) {
        const origWarn = ui.notifications.warn;
        ui.notifications.warn = (m) => { warns.push(String(m)); };
        try { second = await castScroll(a, solo); } finally { ui.notifications.warn = origWarn; }
      }
      return {
        shadowedControls,
        publicContent: publicCard?.content ?? "",
        rollTotal: publicCard?.rolls?.[0]?.total ?? null,
        whisperContent: whisper?.content ?? "",
        usesAfter: solo.system.uses.value,
        secondRefused: second === null
          && warns.includes(game.i18n.localize("CAIRN.Notify.ScrollSpent")),
      };
    } finally {
      game.settings.get = origGet;
      CONFIG.Dice.randomUniform = origRnd;
      await a.sheet.render(true);
    }
  }, { id: scrollFx.id, seq: [0.4, 0.4] });
  check(scrollCastRun.shadowedControls.solo && !scrollCastRun.shadowedControls.used,
    "setting on: the unspent scroll offers Cast, the spent one does not");
  check(scrollCastRun.rollTotal === 8
    && scrollCastRun.publicContent.includes(`${rv("[sum*10]", 80)} feet`),
    "a bookless scroll casts with the full machinery — resolved card (value marked), real roll");
  check(scrollCastRun.whisperContent.includes('data-count="2"'),
    "and the same whisper: fatigue button for the two 4-6 dice");
  check(scrollCastRun.usesAfter === 0,
    "the cast SPENDS the scroll (single use, the hack's one difference)");
  check(scrollCastRun.secondRefused,
    "a spent scroll refuses a second cast with the warning");

  /* --------------------------------------------------------- 11. Alice casts */
  const alicePage = await browser.newPage({ viewport: VIEWPORT });
  const aliceErrors = watchErrors(alicePage);
  await alicePage.goto(FOUNDRY_URL);
  await joinAs(alicePage, "Alice");
  await dismissChrome(alicePage);
  try {
    const aliceCast = await seedCast(alicePage, [0.9, 0.4]);
    check(!aliceCast.error && aliceCast.rollTotal === 5,
      "Alice casts from her own character end-to-end");
    const aliceId = await alicePage.evaluate(() => game.user.id);
    check(aliceCast.whisperTo.length === 1 && aliceCast.whisperTo[0] === aliceId,
      "her whisper is addressed to Alice, not the GM", JSON.stringify(aliceCast.whisperTo));
    check(aliceErrors.length === 0, "zero console errors on Alice's client", aliceErrors[0] ?? "");
  } finally {
    await alicePage.close();
  }

  check(gmErrors.length === 0, "zero console errors on the GM client", gmErrors[0] ?? "");
} finally {
  /* ------------------------------------------------------------- sweep ---- */
  try {
    const swept = await gm.evaluate(async ({ actorIds, itemIds }) => {
      const names = [];
      for (const id of actorIds) {
        const a = game.actors.get(id);
        if (a) { names.push(`${a.name} ${a.id}`); await a.delete(); }
      }
      for (const id of itemIds) {
        const i = game.items.get(id);
        if (i) { names.push(`${i.name} ${i.id}`); await i.delete(); }
      }
      for (const m of game.messages.filter((m) =>
        m.content?.includes("ZZ Spell") || m.content?.includes("grimoire-cast"))) {
        await m.delete();
      }
      return names;
    }, cleanup);
    console.log(`  note  cleanup: swept ${swept.join(", ")}`);
  } catch (e) {
    console.log(`  note  cleanup failed: ${e.message}`);
  }
  await browser.close();
}

if (failures) { console.log(`\ngrimoire probe FAILED (${failures})`); process.exit(1); }
console.log("\ngrimoire probe passed");

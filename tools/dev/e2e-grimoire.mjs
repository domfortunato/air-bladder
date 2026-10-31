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
 *      (bound off, weightless off) leaves both pinned. A BOOK's identity is
 *      just as permanent — a write clearing `grimoireKey` is stripped while
 *      the rest of that same write lands (review #15).
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
 *      selection picks the power-2 block. A third cast, seeded [4] on ONE
 *      die, proves the dice line's own _one form ("Rolled 1 magic die,
 *      result is 4") — a lone number must read as a result, never a count.
 *   6b/6c. A hostile desc FLAG: a literal handler is stripped, and so is one
 *      the [N] block cut would splice together out of quoted text.
 *   8. The Fatigue button: clicked at a FULL pack it still lands both
 *      Fatigue items (ignoreCapacity — a cost, never refused); the message
 *      flag spends it, so a second click adds nothing.
 *   9. Dice cap: free slots pin the power select (min(4, free)); at zero
 *      free slots the cast refuses with the no-dice warning.
 *  10. Travel: dropping the book on a pile moves it AND every page; dropping
 *      it back brings the library home; a page dragged alone is refused.
 *  10b. TWO books on one shelf (issue #17, fsmalecho 2026-08-16): each book
 *      keeps its own pages through the move, the one left behind keeps its
 *      library, the receiving book stays inside its page cap, and the pile's
 *      own sheet groups each page under the book it belongs to.
 *  10c. The unkeyed legacy page, both ways round: ambiguous on a two-book
 *      shelf, so it stays; unambiguous when one book remains, so it travels.
 *  10d. A DUPLICATED actor's book (review #15): duplicating an actor copies its
 *      book's key, so moving that copy back makes `_preCreate` re-mint the
 *      arrival — and the pages must be re-stamped from the book that actually
 *      landed, or the pre-existing book claims them all over again.
 *  10e. The same mechanism's other half: a book riding inside an
 *      `Actor.create` PAYLOAD reaches no item-level create seam at all, so it
 *      is keyed on the actor side — and its page stays its own when a second
 *      book joins the shelf, which an unkeyed book could not manage.
 * 10e2. The one-book wall inside that payload (review #34 finding 247): a
 *      CHARACTER created holding two books keeps the first and the rest of
 *      its gear, with one warning; an npc keeps both, and two sharing a key
 *      part, as they would at the item seam. Import Data of a two-book file
 *      onto a character keeps the first (finding 249).
 *  10f. The scroll cast, including CANCEL: the dialog's Cancel resolves null
 *      rather than its own action string, posts no card and spends no charge.
 *  10g. A STACK of two scrolls: one cast spends one scroll, which splits off
 *      as its own spent row; a spent and an unspent copy never merge.
 * 10g2. Two cast dialogs open on ONE scroll: the first answer casts, the
 *      second finds it spent and refuses (review #34 finding 133).
 * 10g3. Transmute on a stack of two scrolls binds one copy; the other stays a
 *      castable scroll (review #34 finding 213).
 *  10h. The Add-N-Fatigue button, hostile: a player's card naming an actor its
 *      author does not own writes nothing on the Warden's click; a count past
 *      four is paid at four; a double-click pays once.
 *  11. Alice casts from her own character end-to-end: public card + whisper
 *      addressed to Alice, not the GM. On her client, a CONCEALED cast card
 *      keeps core's private-roll flavor (isContentVisible first).
 *  12. The stamp migration, across a real RELOAD: books written before
 *      `grimoireKey` existed get one; a page on a shelf holding ONE book is
 *      matched to it wherever it sits in the inventory; and on a shelf holding
 *      two, NO page is matched and the shelf is named in the log — nothing in
 *      the data says which book, and the item order is not the creation order
 *      to fall back on (measured here: a page planted first came back between
 *      two planted after it).
 *
 * Everything planted is swept from Node in finally, names and ids printed.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(56)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(56)} ${d}`); failures++; };
const check = (cond, l, d = "") => (cond ? ok(l, d) : fail(l, d));

// 900s, not 420s, and the browser is closed on the way out.
//
// This is the longest probe here — 112 legs, two raw-socket plants and a great
// many chat cards — and 420s was comfortable for it ALONE and not comfortable
// inside the full before-tagging sweep, where it came in at 421 seconds and
// reported itself as a hang one second over the line (2026-09-12). A ceiling
// that a healthy run can cross is not a hang detector, it is a load meter, and
// the message it prints ("treating as a hang, not a slow run") is then exactly
// wrong. The cleanup matters as much as the number: `process.exit` runs no
// teardown, so a fired watchdog used to leave a Warden client connected to the
// dev world for every probe that followed.
const browser = await chromium.launch();
watchdog(900000, "grimoire probe", () => browser.close());
const gm = await browser.newPage({ viewport: VIEWPORT });
const gmErrors = watchErrors(gm);
await gm.goto(FOUNDRY_URL);
await joinAsGM(gm);
await dismissChrome(gm);

/**
 * THE GLOG HACK READS ON for this probe's sessions (review #34 finding 223).
 * The Grimoire's Cast and every Transmute are the hack's gestures (2174792d's
 * record), gated like the scroll's Cast; this probe exercises them, so it
 * ESTABLISHES the hack in-page — never writing the world's setting, which is
 * the Warden's (one-way for a campaign). A leg that needs it off (the plant,
 * 10f's control) shadows over this one and restores it.
 */
const glogOn = (page) => page.evaluate(() => {
  const ns = game.system.id;
  const origGet = game.settings.get;
  game.settings.get = function (scope, key, ...rest) {
    // A DOCUMENT request is never shadowed (review #27): core's #setWorld asks
    // get(ns, key, {document: true}) and any value handed back makes it CREATE
    // a duplicate. check:probes gates this.
    if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
    if (scope === ns && key === "enable-glog-magic") return true;
    return origGet.call(this, scope, key, ...rest);
  };
});
await glogOn(gm);

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

const cleanup = { actorIds: [], itemIds: [], msgsAfter: null, msgsAtStart: [] };
// The chat log as it stood before this run (review #34 finding 255): the sweep
// deleted every GLOG cast card and whisper in the world by KIND, the table's
// real casts included. Only the id difference is this run's.
cleanup.msgsAtStart = await gm.evaluate(() => game.messages.map((m) => m.id));

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
      // A DOCUMENT request is never shadowed (review #27): core's #setWorld asks
      // get(ns, key, {document: true}) for the Setting document it updates by id,
      // and any value handed back makes it CREATE a duplicate. check:probes gates this.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
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

  // The EMPTY-book refusal, while the book is still empty. It names the book,
  // so it goes through the content overlay like every other name a player reads
  // (review #16) -- the picker two lines below it in grimoire.js always did.
  // Reached the stale-sheet way, since the control the guard answers is exactly
  // the one this state does not render: a sheet drawn while the book had pages,
  // clicked after they left.
  const emptyRefusal = await gm.evaluate(async (id) => {
    const i18n = await import("/systems/air-bladder/module/i18n-content.js");
    const a = game.actors.get(id);
    const warns = [];
    const origWarn = ui.notifications.warn;
    ui.notifications.warn = (m) => { warns.push(String(m)); return null; };
    try {
      i18n._setOverlay({ "item.name": { "ZZ Grim Tome": "ZZ-TOMO" } });
      const book = a.items.find((i) => i.system?.grimoire);
      const row = [...a.sheet.element.querySelectorAll("[data-item-id]")]
        .find((r) => r.dataset.itemId === book.id);
      await a.sheet.constructor.DEFAULT_OPTIONS.actions.grimoireCast
        .call(a.sheet, { preventDefault: () => {} }, row);
      return { said: warns.join(" | "), pages: a.items.filter((i) => i.system?.bound).length };
    } finally {
      ui.notifications.warn = origWarn;
      i18n._setOverlay(null);
    }
  }, fx.casterId);
  check(emptyRefusal.pages === 0 && !!emptyRefusal.said,
    "the empty book refuses a cast at all", JSON.stringify(emptyRefusal));
  check(emptyRefusal.said?.includes("ZZ-TOMO") && !emptyRefusal.said?.includes("ZZ Grim Tome"),
    "…naming the translated book, not the stored English", `"${emptyRefusal.said}"`);

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
      boundTo: it.system.boundTo,
      bookKey: a.items.find((i) => i.system?.grimoire)?.system.grimoireKey,
    } : null;
  }, fx.casterId);
  check(alpha?.bound === true && alpha?.weightless === true,
    "the confirm binds it: bound + weightless", JSON.stringify(alpha));
  // WHICH book, not just "a book" (issue #17). Everything in leg 10b stands on
  // the transmute writing this, so it is asserted where it is written.
  check(!!alpha?.bookKey && alpha?.boundTo === alpha?.bookKey,
    "the page names ITS book: boundTo === the book's key",
    `${alpha?.boundTo} / ${alpha?.bookKey}`);
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

  /* ------------------------- 2b. the transmute confirm, in Spanish -------- */
  // Both names in the ask are shipped Items -- the Grimoire out of the
  // Reliquary, the spell out of a spellbook pack -- and the row the player just
  // clicked shows each of them translated. Review #16: the ask was built from
  // stored English, so a Spanish player clicked Transmute on "Cuerda" and was
  // asked to bind "Rope". Dismissed rather than accepted: leg 5 counts the
  // pages this would have added.
  const spanishAsk = await gm.evaluate(async (id) => {
    const i18n = await import("/systems/air-bladder/module/i18n-content.js");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const a = game.actors.get(id);
    const out = {};
    try {
      i18n._setOverlay({ "item.name": {
        "ZZ Grim Tome": "ZZ-TOMO", "ZZ Spell Beta": "ZZ-BETA-ES",
      } });
      // Snapshot the DialogV2 ids BEFORE the click and find the one that is
      // NEW: an earlier transmute confirm (ZZ Spell Alpha) can still be closing
      // when this fires, and a find-by-constructor-name grabbed that lingering
      // dialog's English text instead — the recorded "a closing DialogV2
      // lingers" race. Id-difference is the fix.
      const before = new Set([...foundry.applications.instances.values()]
        .filter((x) => x.constructor.name === "DialogV2").map((x) => x.id));
      [...a.sheet.element.querySelectorAll("[data-item-id]")]
        .find((r) => r.textContent.includes("ZZ Spell Beta"))
        ?.querySelector('[data-action="pageTransmute"]')?.click();
      let dlg = null;
      for (let i = 0; i < 60 && !dlg; i++) {
        await sleep(100);
        dlg = [...foundry.applications.instances.values()]
          .find((x) => x.constructor.name === "DialogV2" && !before.has(x.id)
            && x.element?.querySelector(".dialog-content"));
      }
      out.ask = dlg?.element?.querySelector(".dialog-content")?.textContent
        ?.replace(/\s+/g, " ").trim() ?? null;
      await dlg?.close().catch(() => {});
      await sleep(300);
      out.stillUnbound = a.items.find((i) => i.name === "ZZ Spell Beta")?.system.bound === false;
    } finally {
      i18n._setOverlay(null);
    }
    return out;
  }, fx.casterId);

  check(!!spanishAsk.ask && spanishAsk.ask.includes("ZZ-BETA-ES") && spanishAsk.ask.includes("ZZ-TOMO"),
    "the transmute confirm names BOTH documents translated", `"${spanishAsk.ask}"`);
  check(!!spanishAsk.ask && !spanishAsk.ask.includes("ZZ Spell Beta") && !spanishAsk.ask.includes("ZZ Grim Tome"),
    "…and neither in stored English", `"${spanishAsk.ask}"`);
  check(spanishAsk.stillUnbound, "dismissing the confirm binds nothing");

  /* --------------------------------------------------- 3. bound is forever */
  const pinned = await gm.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const it = actor.items.find((i) => i.name === "ZZ Spell Alpha");
    await it.update({ "system.bound": false });
    const afterUnbind = it.system.bound;
    await it.update({ system: { bound: false, weightless: false, equipped: true } });
    // And the BOOK's half of the same rule (review #15). Alpha is bound to this
    // key by now (leg 2), so a cleared key would orphan a real page — and
    // unrecoverably, since ensureGrimoireKey mints a FRESH one on next use
    // rather than restoring what was lost. The name edit rides along to prove
    // the write is STRIPPED rather than refused: the rest of it must land.
    const book = actor.items.find((i) => i.name === "ZZ Grim Tome");
    const keyBefore = book.system.grimoireKey;
    await book.update({ name: "ZZ Grim Tome II", "system.grimoireKey": "" });
    const grim = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const stillHeld = grim.pagesOfGrimoire(actor, book).map((p) => p.name);
    // Read the rename BEFORE putting the name back, or the assertion below is
    // one that cannot fail — it would be checking the restore, not the write.
    const renamed = book.name === "ZZ Grim Tome II";
    await book.update({ name: "ZZ Grim Tome" });

    // The OPERATOR spelling of the same attacks (review #17): ForcedDeletion
    // resets a field to its schema initial — false, for these booleans — and
    // is a truthy OBJECT, so the old `=== false` guard stripped the plain
    // spelling while waving the operator through. The platform itself
    // recommends this spelling (operators.mjs, the `-=key` replacement), so
    // it is the FIRST thing a scripted client reaches for.
    const FD = () => new foundry.data.operators.ForcedDeletion();
    await it.update({ system: { bound: FD() } });
    const boundAfterFD = it.system.bound;
    // The string half was already isClearing-guarded (#15) — regression leg.
    await book.update({ "system.grimoireKey": FD() });
    const keyAfterFD = book.system.grimoireKey;
    // A scroll reset by the operator must come out a clean BOOK — pre-fix the
    // truthy operator took the BECOMING-scroll branch, leaving a non-scroll
    // wearing scroll pins and a one-shot counter.
    const [fdScroll] = await actor.createEmbeddedDocuments("Item", [{
      name: "ZZ FD Scroll", type: "spellbook", system: { scroll: true, description: "<p>x</p>" },
    }]);
    await fdScroll.update({ system: { scroll: FD() } });
    const s = actor.items.get(fdScroll.id).system;
    const scrollFD = { scroll: s.scroll, usesMax: s.uses?.max ?? null, usesValue: s.uses?.value ?? null, weightless: s.weightless };
    // And an UNBOUND spellbook must not be touched at all by an operator
    // riding on `bound` — pre-fix the truthy operator satisfied the page
    // invariant's `changed.system?.bound` term and merged PAGE_PINNED onto a
    // non-page. Asserted as before/after NO-OP rather than against literals,
    // because what the create produces is world-dependent: a GLOG world's
    // arrival seam turns a plain spellbook into a scroll (this leg's first
    // draft learned that the hard way).
    const [fdBook] = await actor.createEmbeddedDocuments("Item", [{
      name: "ZZ FD Book", type: "spellbook", system: { description: "<p>y</p>" },
    }]);
    const snap = (i) => ({
      bound: i.system.bound, scroll: i.system.scroll, weightless: i.system.weightless,
      equipped: i.system.equipped, usesMax: i.system.uses?.max ?? null, usesValue: i.system.uses?.value ?? null,
    });
    const bookBefore = snap(actor.items.get(fdBook.id));
    await fdBook.update({ system: { bound: FD() } });
    const bookFD = { before: bookBefore, after: snap(actor.items.get(fdBook.id)) };
    await actor.deleteEmbeddedDocuments("Item", [fdScroll.id, fdBook.id]);

    return {
      afterUnbind, bound: it.system.bound, weightless: it.system.weightless,
      equipped: it.system.equipped,
      keyKept: !!keyBefore && book.system.grimoireKey === keyBefore,
      renamed, stillHeld,
      boundAfterFD, keyAfterFD, keyBefore, scrollFD, bookFD,
    };
  }, fx.casterId);
  check(pinned.afterUnbind === true, "a direct un-bind write is stripped");
  check(pinned.bound === true && pinned.weightless === true && pinned.equipped === false,
    "a hostile write leaves every pin in place", JSON.stringify(pinned));
  check(pinned.keyKept, "a write CLEARING a book's grimoireKey is stripped too");
  check(pinned.renamed && pinned.stillHeld.length > 0,
    "and only that half: the same write's rename landed, pages still held",
    JSON.stringify(pinned.stillHeld));
  check(pinned.boundAfterFD === true,
    "a ForcedDeletion on `bound` is stripped like the plain spelling (review #17)");
  check(pinned.keyAfterFD === pinned.keyBefore,
    "…and on `grimoireKey` (the isClearing guard, regression)");
  check(pinned.scrollFD?.scroll === false && pinned.scrollFD?.usesMax === 0
      && pinned.scrollFD?.usesValue === 0 && pinned.scrollFD?.weightless === false,
    "a ForcedDeletion on `scroll` lands as a clean BOOK, not a non-scroll in scroll pins",
    JSON.stringify(pinned.scrollFD));
  check(pinned.bookFD?.after?.bound === false
      && JSON.stringify(pinned.bookFD?.before) === JSON.stringify(pinned.bookFD?.after),
    "a ForcedDeletion on an unbound item's `bound` is a complete no-op — nothing dressed in PAGE_PINNED",
    JSON.stringify(pinned.bookFD));

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
    // Layer 3: two books in ONE batch, on a character carrying NONE. The
    // fixture must be fresh — run this against the caster and _preCreate
    // refuses both for a reason that has nothing to do with the batch, and the
    // leg passes while the hole stays open. The rope rides along because the
    // wall must drop the surplus BOOK, not the operation: changeBackground
    // batches a whole startingGear, and a wall that took the boots with the
    // second book would be a worse bug than the one it closes.
    const fresh = await CONFIG.Actor.documentClass.create({ name: "ZZ Grim Batch", type: "character" });
    await fresh.createEmbeddedDocuments("Item", [
      world.toObject(),
      world.toObject(),
      { name: "ZZ Grim Rope", type: "item" },
    ]);
    const batched = fresh.items.filter((i) => i.system?.grimoire).length;
    const ropeLanded = fresh.items.some((i) => i.name === "ZZ Grim Rope");
    // A pile is exempt.
    const pile = game.actors.get(pileId);
    await pile.createEmbeddedDocuments("Item", [world.toObject(), world.toObject()]);
    const onPile = pile.items.filter((i) => i.system?.grimoire).length;
    return { worldId: world.id, viaDrop, afterDrop, afterCreate, onPile, batched, ropeLanded, freshId: fresh.id };
  }, { casterId: fx.casterId, pileId: fx.pileId });
  cleanup.itemIds.push(wall.worldId);
  cleanup.actorIds.push(wall.freshId);
  check(wall.viaDrop === null && wall.afterDrop === 1,
    "layer 1: the drop handler refuses a second book");
  check(wall.afterCreate === 1,
    "layer 2: a bare createEmbeddedDocuments is refused by _preCreate");
  check(wall.batched === 1,
    `layer 3: two books in ONE batch land as one (${wall.batched}) — _preCreate runs per document before any `
    + "is in parent.items, so both see zero; only _preCreateOperation can see the batch");
  check(wall.ropeLanded,
    "...and the rest of the batch still lands — the surplus book is spliced out, the operation is not refused");
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
    // The full-book refusal names the book, so it reads through the overlay too
    // (review #16). Installed here rather than in its own leg because the
    // fixture it needs -- a book at capacity -- is this leg's.
    const i18n = await import("/systems/air-bladder/module/i18n-content.js");
    i18n._setOverlay({ "item.name": { "ZZ Grim Tome": "ZZ-TOMO" } });
    try {
      await a.sheet.constructor.prototype.constructor
        .DEFAULT_OPTIONS.actions.pageTransmute.call(a.sheet, { preventDefault: () => {} }, target);
    } finally { ui.notifications.warn = orig; i18n._setOverlay(null); }
    return { bound: delta.system.bound, warned: warns.length > 0, said: warns.join(" | ") };
  }, fx.casterId);
  check(fullEnforced.bound === false && fullEnforced.warned,
    "and the handler refuses with the full warning (enforcement)");
  check(fullEnforced.said?.includes("ZZ-TOMO") && !fullEnforced.said?.includes("ZZ Grim Tome"),
    "the full-book refusal names the translated book", `"${fullEnforced.said}"`);

  /* -------------------------------------------------- 6. the cast, seeded -- */
  const seedCast = async (page, sequence, diceVal = "2") => page.evaluate(async ({ id, seq, diceVal }) => {
    const { castFromGrimoire } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const a = game.actors.get(id);
    let i = 0;
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => seq[Math.min(i++, seq.length - 1)];
    try {
      const msgsBefore = game.messages.size;
      // Snapshot the open windows BEFORE the call opens one, and accept only a
      // dialog that is NOT in the snapshot. `DialogV2.wait` resolves in its
      // submit handler BEFORE the close begins (dialog.mjs:409-418), and
      // `ApplicationV2#close` awaits the fade transition — up to 1000ms — BEFORE
      // it deletes the window from `instances` (application.mjs:1016,1021). So
      // the previous cast's dialog is still in the map, select and all, when
      // this poll starts, and under sweep load it was what the first iteration
      // found: its selects were set, ITS button clicked (a second submit on an
      // already-resolved dialog, a no-op), and the NEW dialog sat unanswered —
      // "never resolved after the cast click (20s)", on the fourth cast in a
      // row, green alone (0.1.23 pre-tag sweep, 2026-09-13). The DOM form of
      // the same trap is recorded on dev:changelog's Restore leg.
      const before = new Set(foundry.applications.instances.keys());
      const p = castFromGrimoire(a);
      // Answer the dialog: pick Alpha, invest 2 dice.
      for (let t = 0; t < 40; t++) {
        const dlg = [...foundry.applications.instances.values()]
          .find((x) => !before.has(x.id) && x.constructor.name === "DialogV2"
            && x.element?.querySelector('select[name="page"]'));
        if (dlg) {
          const pageSel = dlg.element.querySelector('select[name="page"]');
          const alphaId = a.items.find((x) => x.name === "ZZ Spell Alpha").id;
          pageSel.value = alphaId;
          const diceSel = dlg.element.querySelector('select[name="dice"]');
          const options = diceSel.options.length;
          diceSel.value = diceVal;
          dlg.element.querySelector('[data-action="cast"]').click();
          // BOUNDED. The dialog-never-appeared path below has always had a
          // ceiling (40 × 150ms) but this await had none, so a cast that never
          // settles stopped the whole probe dead — no leg, no message, nothing
          // to read but a watchdog line 15 minutes later blaming "a hang" it
          // could not locate (2026-09-12: 54 of 112 legs, alone, on a run that
          // had passed 112 an hour earlier). An unbounded await inside a
          // page.evaluate is a probe that can only ever report silence. This
          // turns the same event into a named red on the leg that caused it.
          const publicCard = await Promise.race([
            p,
            new Promise((r) => setTimeout(() => r("__cast-timeout__"), 20000)),
          ]);
          if (publicCard === "__cast-timeout__") {
            return { error: "castFromGrimoire never resolved after the cast click (20s)" };
          }
          // The whisper is the newest message.
          await new Promise((r) => setTimeout(r, 300));
          const msgs = [...game.messages].slice(-(game.messages.size - msgsBefore));
          // The CAST whisper, not merely the FIRST whispered message: the
          // change-log posts its own [GM + owner] whisper asynchronously from
          // the item edits these legs make (the caster is owned by Alice), and a
          // debounced one can land in this window — a race that reddened only
          // castA, where a preceding transmute's log was still in flight. The
          // cast whisper is the one carrying the grimoire-cast-whisper container.
          const whisper = msgs.find((m) => m.whisper?.length && m.content?.includes("grimoire-cast-whisper"));
          return {
            options,
            publicContent: publicCard?.content ?? "",
            publicFlavor: publicCard?.flavor ?? "",
            rollTotal: publicCard?.rolls?.[0]?.total ?? null,
            whisperContent: whisper?.content ?? "",
            whisperFlavor: whisper?.flavor ?? "",
            whisperTo: whisper?.whisper ?? [],
            whisperId: whisper?.id, publicId: publicCard?.id,
            flag: publicCard?.getFlag("air-bladder", "glogCast") ?? null,
            userId: game.user.id,
          };
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return { error: "dialog never appeared" };
    } finally { CONFIG.Dice.randomUniform = orig; }
  }, { id, seq: sequence, diceVal });

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
  check(castA.whisperContent.includes(await gm.evaluate(() =>
    `<p>${game.i18n.format("CAIRN.GrimoireWhisperDice", { count: 2, faces: "4, 4 (8)" })}</p>`)),
    "the dice line counts the invested dice, lists what they made, sums in parentheses");
  check(castA.whisperContent.includes("fa-weight-hanging") && !castA.whisperContent.includes("fa-battery"),
    "the Add-Fatigue button wears the inventory Fatigue icon, not a battery");
  check(castA.whisperContent.includes('data-count="2"'),
    "whisper offers Add-2-Fatigue");
  check(castA.whisperContent.includes(await gm.evaluate(() => game.i18n.localize("CAIRN.GrimoireMishapLine"))),
    "doubles: the Mishap line is present");
  check(/grimoire-mishap-text/.test(castA.whisperContent) && !/grimoire-mishap-text"><\/div>/.test(castA.whisperContent),
    "and a drawn Mishaps row rides in the whisper (world-first table resolved)");
  // WHICH row (review #34 finding 229): the one whose range holds the CAST'S sum.
  // The whisper rolled the table's own 2d12, independent of the cast, so the row
  // printed under "[4,4] (8)" was any row at all. Read from the same world-first
  // table the cast resolves, by range — core's getResultsForRoll.
  const mishapFor8 = await gm.evaluate(async () => {
    const { findTableByName } = await import("/systems/air-bladder/module/compendium.js");
    const { MISHAPS_TABLE_NAME } = await import("/systems/air-bladder/module/grimoire.js");
    const table = await findTableByName(MISHAPS_TABLE_NAME);
    return table?.getResultsForRoll(8)?.[0]?.description ?? null;
  });
  check(!!mishapFor8 && castA.whisperContent.includes(mishapFor8),
    "the whispered Mishaps row is the one the cast's sum (8) lands on",
    `want ${JSON.stringify(String(mishapFor8).slice(0, 60))}`);
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

  // [4] alone: the _one form. A lone number must read as a RESULT, never a
  // count — the user's screenshot case ("Rolled 1 = 1"), 2026-08-10. The
  // whole <p> is asserted so a defeated singular cannot pass by substring.
  const castC = await seedCast(gm, [0.4], "1");
  check(castC.rollTotal === 4, "seeded [4]: single-die total 4", castC.error ?? "");
  check(castC.whisperContent.includes(await gm.evaluate(() =>
    `<p>${game.i18n.format("CAIRN.GrimoireWhisperDice_one", { count: 1, faces: "4" })}</p>`)),
    "one die: the dice line takes its _one form (magic die, singular)");
  check(!castC.whisperContent.includes(noMishapText),
    "one die: NO mishap sentence at all — a single die cannot double");

  /* ------------------------ 7b. the public card speaks the VIEWER's language */
  // A ChatMessage is composed once, on the caster's client, and then read in
  // every log at the table — so a name or a sentence localized on the way IN
  // freezes the caster's language onto everyone else's screen, and no
  // re-render ever corrects it. This card did exactly that (review #16).
  //
  // The leg casts under one overlay and reads the card back under ANOTHER,
  // which is what tells a card REBUILT per viewer from a stale one that merely
  // happens to be in the right language. Both overlays are installed in-page
  // (`_setOverlay`), no world write, restored in a finally.
  const castLangSetup = await gm.evaluate(async (id) => {
    const i18n = await import(`/systems/${game.system.id}/module/i18n-content.js`);
    const alpha = game.actors.get(id).items.find((x) => x.name === "ZZ Spell Alpha");
    const desc = alpha.system.description ?? "";
    i18n._setOverlay({
      "item.name": { "ZZ Spell Alpha": "ZZ-CASTER-NAME" },
      "item.desc": { [desc]: "ZZ-CASTER-DESC [sum*10]" },
    });
    return {
      desc,
      // The precondition. If t() does not move THIS string on THIS client, a
      // card that comes out English proves nothing at all.
      live: i18n.contentLocalized() && i18n.t("item.name", "ZZ Spell Alpha") === "ZZ-CASTER-NAME",
    };
  }, fx.casterId);
  check(castLangSetup.live,
    "precondition: the caster's client has a live overlay that renames the spell");

  // [4,4] again: sum 8, so [sum*10] must land on 80 in whatever language.
  const castL = await seedCast(gm, [0.4, 0.4]);
  check(!castL.error && castL.rollTotal === 8, "seeded [4,4] under the caster's overlay", castL.error ?? "");
  // A cast that reported an error carries no card; the legs under it must red
  // in their own words rather than throw past every leg that follows.
  const castLContent = castL.publicContent ?? "";
  check(castLContent.includes("ZZ Spell Alpha")
    && !castLContent.includes("ZZ-CASTER-NAME")
    && !castLContent.includes("ZZ-CASTER-DESC"),
    "the STORED card is English, though the caster's own client is not",
    castLContent);
  check(castL.flag?.name === "ZZ Spell Alpha" && castL.flag?.desc === castLangSetup.desc
    && castL.flag?.dice === 2 && castL.flag?.sum === 8,
    "and it carries the English source plus the dice, which is what a viewer rebuilds from",
    JSON.stringify(castL.flag));

  const viewerLeg = await gm.evaluate(async ({ cardId, desc }) => {
    const i18n = await import(`/systems/${game.system.id}/module/i18n-content.js`);
    const card = game.messages.get(cardId);
    const out = { storedFlavor: card?.flavor ?? "" };
    const origFmt = game.i18n.format.bind(game.i18n);
    // `game.i18n.format = fn` DOES NOT WORK and does not say so:
    // Localization's methods are defined non-writable and non-configurable on
    // the prototype, so a plain assignment is a silent no-op in sloppy mode
    // and every call still reaches core. Defining an OWN property on the
    // instance is what shadows it — and `delete` is what restores. Costed an
    // hour reading a green fix as a red one.
    const shadowFormat = (fn) => Object.defineProperty(game.i18n, "format",
      { value: fn, configurable: true, writable: true });
    try {
      // A DIFFERENT overlay: this is the other client at the table.
      i18n._setOverlay({
        "item.name": { "ZZ Spell Alpha": "ZZ-VIEWER-NAME" },
        "item.desc": { [desc]: "ZZ-VIEWER-DESC [sum*10]" },
      });
      const el = await card.renderHTML();
      out.h3 = el.querySelector(".grimoire-cast-card h3")?.textContent ?? "";
      out.effect = el.querySelector(".grimoire-cast-effect")?.textContent ?? "";
      // The flavor is INTERFACE language, not the content overlay, so making
      // the viewer differ from the caster means making game.i18n answer
      // differently. The string is not under test — whether the header is
      // rebuilt from the key or read out of the stored bytes is.
      shadowFormat((k, d) => (k === "CAIRN.GrimoireCastFlavor" ? "ZZ-VIEWER-FLAVOR" : origFmt(k, d)));
      out.shadowTook = game.i18n.format("CAIRN.GrimoireCastFlavor", {}) === "ZZ-VIEWER-FLAVOR";
      const el2 = await card.renderHTML();
      out.flavor = el2.querySelector(".flavor-text")?.textContent ?? "";
      // Idempotence: a second render of the same message must not stack or
      // drift — the chat log re-renders constantly.
      delete game.i18n.format;
      const el3 = await card.renderHTML();
      out.h3Again = el3.querySelector(".grimoire-cast-card h3")?.textContent ?? "";
      out.cards = el3.querySelectorAll(".grimoire-cast-card").length;
    } finally {
      delete game.i18n.format;
      i18n._setOverlay(null);
    }
    return out;
  }, { cardId: castL.publicId, desc: castLangSetup.desc });

  check(viewerLeg.h3 === "ZZ-VIEWER-NAME",
    "RENDERED, the spell's name is the VIEWER's — not the caster's, not the stored English",
    viewerLeg.h3);
  check(viewerLeg.effect.includes("ZZ-VIEWER-DESC") && viewerLeg.effect.includes("80"),
    "and the effect is the viewer's sentence resolved with the caster's dice (sum 8 -> 80)",
    viewerLeg.effect);
  check(viewerLeg.shadowTook,
    "precondition: the interface-language shadow actually took (defineProperty, not assignment)");
  check(viewerLeg.flavor.includes("ZZ-VIEWER-FLAVOR") && !viewerLeg.storedFlavor.includes("ZZ-VIEWER-FLAVOR"),
    "the flavor header is rebuilt per viewer too, not read out of the stored bytes",
    `${viewerLeg.storedFlavor} -> ${viewerLeg.flavor}`);
  check(viewerLeg.h3Again === "ZZ-VIEWER-NAME" && viewerLeg.cards === 1,
    "and re-rendering is idempotent: one card, same name");

  /* ------------------------------- 6b. a hostile desc flag cannot inject --- */
  // The card body is rebuilt from `glogCast.desc` on EVERY viewer's client
  // (localizeGlogCastCard), and a message's flags are player-authorable and
  // NOT server-sanitized the way its `content` HTMLField is. So a card whose
  // stored content is a benign shell but whose FLAG carries markup must come
  // out with the dangerous attributes stripped — an `on*` handler and the
  // `data-action` an injected control would dispatch through (the two
  // cleanDescription is built to strip, utils.js). Asserted on the parsed
  // element, never appended and with no loadable src, so the leg is
  // deterministic and adds no console error; the live firing was observed by
  // hand during review #24. Finding 1 (shipped 0.1.17-0.1.19, the player->GM
  // XSS class the htmlFields control exists to wall off).
  const castXss = await gm.evaluate(async () => {
    const msg = new ChatMessage.implementation({
      content: '<div class="grimoire-cast-card">seed</div>',
      speaker: { alias: "ZZ Grim Caster" },
      flags: { "air-bladder": { glogCast: {
        name: "ZZ Spell Alpha",
        desc: 'benign prose <img onerror="window.__zzGlogXss = 1">'
          + '<span data-action="itemCreate">z</span>',
        dice: 2, sum: 7, alias: "ZZ Grim Caster",
      } } },
    });
    const el = await msg.renderHTML();
    const effect = el.querySelector(".grimoire-cast-effect");
    return {
      hasOnerror: !!el.querySelector(".grimoire-cast-card [onerror]"),
      hasDataAction: !!el.querySelector(".grimoire-cast-card [data-action]"),
      keepsProse: (effect?.textContent ?? "").includes("benign prose"),
    };
  });
  check(!castXss.hasOnerror && !castXss.hasDataAction,
    "a hostile desc flag is stripped before the cast card renders it",
    `onerror-attr=${castXss.hasOnerror} data-action=${castXss.hasDataAction}`);
  check(castXss.keepsProse,
    "and the benign description text survives the clean",
    `effect kept prose=${castXss.keepsProse}`);

  /* ------------------- 6c. the block split cannot splice markup back to life */
  // 6b plants a literal handler and no [N] markers, so it never reaches the
  // splice (review #34 finding 8). resolveSpellText cuts the text between the
  // [1] marker and the [dice] one. Run on a string that has ALREADY been
  // cleaned and serialized, that cut can take an attribute's closing quote
  // with it: here [1] sits inside the img's title and [2] in the text after it,
  // whose raw `"` characters then close the title and open an `onerror`.
  // Clean-then-cut is the order review #24 shipped, and it shipped this hole in
  // 0.1.17-0.1.25. No src, so nothing loads and nothing fires: the attribute on
  // the parsed element is the witness. The control is the honest shape — the
  // power-2 block chosen, its value resolved, and the grimoire-resolved span
  // (class and data-tooltip, both on core's allow-list) surviving the clean.
  const castSplice = await gm.evaluate(async () => {
    const render = async (desc, dice, sum) => {
      const msg = new ChatMessage.implementation({
        content: '<div class="grimoire-cast-card">seed</div>',
        speaker: { alias: "ZZ Grim Caster" },
        flags: { "air-bladder": { glogCast: {
          name: "ZZ Spell Alpha", desc, dice, sum, alias: "ZZ Grim Caster",
        } } },
      });
      return (await msg.renderHTML()).querySelector(".grimoire-cast-card");
    };
    const hostile = await render('<p><img title="[1]">[2]" onerror="window.__zzGlogSplice = 1" x="</p>'
      + '<p title="q">z</p>', 2, 7);
    const honest = await render("<p>[1] ZZ-POWER-ONE.</p><p>[2] ZZ-POWER-TWO deals [sum*10].</p>", 2, 7);
    const span = honest?.querySelector(".grimoire-resolved");
    return {
      spliced: !!hostile?.querySelector("[onerror]"),
      rendered: !!hostile,
      text: honest?.textContent ?? "",
      span: span ? `${span.textContent}|${span.dataset.tooltip}` : null,
    };
  });
  check(castSplice.rendered && !castSplice.spliced,
    "a [N] marker cut cannot splice a live handler into the cast card",
    `onerror-attr=${castSplice.spliced}`);
  check(castSplice.text.includes("ZZ-POWER-TWO") && !castSplice.text.includes("ZZ-POWER-ONE")
    && castSplice.span === "70|[sum*10]",
    "and the honest card still picks the power-2 block and marks its resolved value",
    `${castSplice.text.trim()} / span=${castSplice.span}`);

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

  /* ------------------- 10a. a page copy that does not land is not deleted -- */
  // Review #34 finding 177. The book's own create is checked, but the pages'
  // was not: createEmbeddedDocuments resolves a SHORTER array when a page is
  // refused (a preCreateItem veto) or fails construction, and every travelling
  // page was then deleted from the source anyway. A world script or module
  // veto is planted in-page and removed in a finally; the book is brought home
  // afterwards so the legs below find the caster as it was.
  const lostPages = await gm.evaluate(async ({ casterId, pileId }) => {
    const caster = game.actors.get(casterId);
    const pile = game.actors.get(pileId);
    const veto = Hooks.on("preCreateItem", (doc) => (doc.system?.bound ? false : undefined));
    let out;
    try {
      const book = caster.items.find((i) => i.system?.grimoire);
      await pile.sheet._onDropItem({ preventDefault: () => {}, target: pile.sheet.element }, book);
      out = {
        pileBooks: pile.items.filter((i) => i.system?.grimoire).length,
        pilePages: pile.items.filter((i) => i.system?.bound).length,
        casterPages: caster.items.filter((i) => i.system?.bound).length,
      };
    } finally {
      Hooks.off("preCreateItem", veto);
    }
    const pileBook = pile.items.find((i) => i.system?.grimoire);
    if (pileBook) await caster.sheet._onDropItem({ preventDefault: () => {}, target: caster.sheet.element }, pileBook);
    out.home = caster.items.filter((i) => i.system?.grimoire).length === 1
      && caster.items.filter((i) => i.system?.bound).length === 3;
    return out;
  }, { casterId: fx.casterId, pileId: fx.pileId });
  check(lostPages.pilePages === 0 && lostPages.casterPages === 3,
    "pages whose copies were refused STAY on the source", JSON.stringify(lostPages));
  check(lostPages.home, "and the book came home to its pages", JSON.stringify(lostPages));

  /* ------------------------------ 10b. two books on one shelf (issue #17) -- */
  // fsmalecho, 2026-08-16: two Grimoires with pages in one container, drag one
  // out, and it took EVERY page in the container — three of them past its own
  // capacity — leaving the second book empty. The shelf is the point: a
  // CHARACTER may only carry one book, so the old "every bound page on the
  // source" was right there and unanswerable anywhere else.
  const shelfFx = await gm.evaluate(async () => {
    const shelf = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Shelf", type: "npc",
      system: { role: "container", containerClass: "pile", slots: 20 },
    });
    const reader = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Reader", type: "character" });
    await shelf.createEmbeddedDocuments("Item", [
      { name: "ZZ Grim Tome One", type: "item",
        system: { grimoire: true, grimoirePages: 3, bulky: true } },
      { name: "ZZ Grim Tome Two", type: "item",
        system: { grimoire: true, grimoirePages: 3, bulky: true } },
    ]);
    const one = shelf.items.find((i) => i.name === "ZZ Grim Tome One");
    const two = shelf.items.find((i) => i.name === "ZZ Grim Tome Two");
    // Pages in the shape the transmute writes (asserted in leg 2), interleaved
    // so nothing can pass by taking a contiguous slice of the inventory.
    await shelf.createEmbeddedDocuments("Item", [
      { name: "ZZ Grim Page A1", type: "spellbook",
        system: { bound: true, boundTo: one.system.grimoireKey, description: "<p>a</p>" } },
      { name: "ZZ Grim Page B1", type: "spellbook",
        system: { bound: true, boundTo: two.system.grimoireKey, description: "<p>b</p>" } },
      { name: "ZZ Grim Page A2", type: "spellbook",
        system: { bound: true, boundTo: one.system.grimoireKey, description: "<p>c</p>" } },
      { name: "ZZ Grim Page B2", type: "spellbook",
        system: { bound: true, boundTo: two.system.grimoireKey, description: "<p>d</p>" } },
      { name: "ZZ Grim Page A3", type: "spellbook",
        system: { bound: true, boundTo: one.system.grimoireKey, description: "<p>e</p>" } },
      { name: "ZZ Grim Page B3", type: "spellbook",
        system: { bound: true, boundTo: two.system.grimoireKey, description: "<p>f</p>" } },
    ]);
    return {
      shelfId: shelf.id, readerId: reader.id,
      keysDiffer: !!one.system.grimoireKey && !!two.system.grimoireKey
        && one.system.grimoireKey !== two.system.grimoireKey,
      pages: shelf.items.filter((i) => i.system?.bound).length,
    };
  });
  cleanup.actorIds.push(shelfFx.shelfId, shelfFx.readerId);
  check(shelfFx.keysDiffer && shelfFx.pages === 6,
    "two books minted DIFFERENT keys, six pages planted", JSON.stringify(shelfFx));

  const shelf = await gm.evaluate(async ({ shelfId, readerId }) => {
    const sh = game.actors.get(shelfId);
    const reader = game.actors.get(readerId);
    await reader.sheet.render(true);
    const one = sh.items.find((i) => i.name === "ZZ Grim Tome One");
    const warns = [];
    const orig = ui.notifications.warn;
    ui.notifications.warn = (m) => { warns.push(String(m)); };
    let moved;
    try {
      moved = await reader.sheet._onDropItem(
        { preventDefault: () => {}, target: reader.sheet.element }, one);
    } finally { ui.notifications.warn = orig; }
    const named = (a, f) => a.items.filter(f).map((i) => i.name).sort();
    // The shelf's own sheet must now group the survivors under the book they
    // belong to — a pile shows pages, and used to show them in one
    // undifferentiated alphabetical run.
    await sh.sheet.render(true);
    await new Promise((r) => setTimeout(r, 400));
    const rows = [...sh.sheet.element.querySelectorAll("[data-item-id]")];
    const rowAt = (name) => rows.findIndex((r) => r.textContent.includes(name));
    return {
      moved: !!moved, warns,
      order: {
        book: rowAt("ZZ Grim Tome Two"),
        pages: ["ZZ Grim Page B1", "ZZ Grim Page B2", "ZZ Grim Page B3"].map(rowAt),
      },
      readerBooks: named(reader, (i) => i.system?.grimoire),
      readerPages: named(reader, (i) => i.system?.bound),
      shelfBooks: named(sh, (i) => i.system?.grimoire),
      shelfPages: named(sh, (i) => i.system?.bound),
    };
  }, shelfFx);
  check(shelf.moved && shelf.readerBooks.length === 1
    && shelf.readerPages.join() === "ZZ Grim Page A1,ZZ Grim Page A2,ZZ Grim Page A3",
    "one book out of two takes ITS OWN three pages, not the shelf's six",
    JSON.stringify(shelf.readerPages));
  check(shelf.shelfBooks.join() === "ZZ Grim Tome Two"
    && shelf.shelfPages.join() === "ZZ Grim Page B1,ZZ Grim Page B2,ZZ Grim Page B3",
    "the book left behind keeps its library", JSON.stringify(shelf.shelfPages));
  check(shelf.readerPages.length <= 3,
    "and the receiving book is not over its own page cap",
    `${shelf.readerPages.length} of 3`);
  // Alphabetically "Page" sorts BEFORE "Tome", so an ungrouped list puts all
  // three pages above the book. Grouped, the book leads and its pages follow it
  // contiguously — the differential is the sort order itself.
  const { book: bookRow, pages: pageRows } = shelf.order;
  check(bookRow >= 0 && pageRows.every((p, n) => p === bookRow + 1 + n),
    "a pile groups the pages under the book they belong to",
    `book at ${bookRow}, pages at ${pageRows.join(",")}`);

  /* ------------------------- 10c. the unkeyed legacy page, both ways round -- */
  // A page bound before `boundTo` existed names no book. With ONE book on the
  // actor there is only one answer and it travels, exactly as it did before
  // this fix; with TWO there is no answer in the data, so it stays put — which
  // is recoverable, where leaving with the wrong book is not.
  const legacy = await gm.evaluate(async ({ shelfId, readerId }) => {
    const sh = game.actors.get(shelfId);   // holds Tome Two + its 3 keyed pages
    const reader = game.actors.get(readerId);
    await sh.createEmbeddedDocuments("Item", [
      // No boundTo, ever set — the legacy shape, not a cleared field.
      { name: "ZZ Grim Page Legacy", type: "spellbook",
        system: { bound: true, description: "<p>old</p>" } },
      { name: "ZZ Grim Tome Three", type: "item",
        system: { grimoire: true, grimoirePages: 3, bulky: true } },
    ]);
    const three = sh.items.find((i) => i.name === "ZZ Grim Tome Three");
    // TWO books present: the unkeyed page belongs to neither nameably.
    const pc2 = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Reader Two", type: "character" });
    await pc2.sheet.render(true);
    await pc2.sheet._onDropItem({ preventDefault: () => {}, target: pc2.sheet.element }, three);
    const afterAmbiguous = {
      took: pc2.items.filter((i) => i.system?.bound).map((i) => i.name),
      left: sh.items.some((i) => i.name === "ZZ Grim Page Legacy"),
    };
    // Now ONE book remains (Tome Two) — the unkeyed page is unambiguous again.
    const two = sh.items.find((i) => i.name === "ZZ Grim Tome Two");
    const pc3 = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Reader Three", type: "character" });
    await pc3.sheet.render(true);
    await pc3.sheet._onDropItem({ preventDefault: () => {}, target: pc3.sheet.element }, two);
    return {
      afterAmbiguous,
      soleTook: pc3.items.filter((i) => i.system?.bound).map((i) => i.name).sort(),
      ids: [pc2.id, pc3.id],
      readerUntouched: reader.items.filter((i) => i.system?.bound).length,
    };
  }, shelfFx);
  cleanup.actorIds.push(...legacy.ids);
  check(legacy.afterAmbiguous.took.length === 0 && legacy.afterAmbiguous.left,
    "an unkeyed page on a TWO-book shelf travels with neither, and stays",
    JSON.stringify(legacy.afterAmbiguous));
  check(legacy.soleTook.join() === "ZZ Grim Page B1,ZZ Grim Page B2,ZZ Grim Page B3,ZZ Grim Page Legacy",
    "with ONE book left it is unambiguous again, and travels", JSON.stringify(legacy.soleTook));
  check(legacy.readerUntouched === 3,
    "and nothing reached across to the first reader's library", String(legacy.readerUntouched));

  /* --------------------- 10d. a DUPLICATED actor's book, and its key clash -- */
  // Review #15. `grimoireKey` is minted in `_preCreate`, which the client runs
  // for the operation's TOP-LEVEL documents only (client-backend.mjs:80-110) —
  // so duplicating an ACTOR copies its book's key verbatim and two books end up
  // wearing one. Moving one onto the other then makes `_preCreate` re-mint the
  // ARRIVAL, while the pages were resolved off the source still naming the old
  // key: the pre-existing book claims them, four under a cap of three, and the
  // book that owns them lands empty. Issue #17's symptom, produced by the code
  // that closed it. On a PILE because a character can never hold the colliding
  // pair — the one-book wall guarantees it.
  const dup = await gm.evaluate(async () => {
    const pileA = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Dup A", type: "npc",
      system: { role: "container", containerClass: "pile", slots: 20 },
    });
    // Through createEmbeddedDocuments, the way a Reliquary drag makes one, so
    // `_preCreate` runs and the book is properly KEYED. (A book riding inside
    // the Actor.create payload skips it and gets no key at all — a different
    // gap, and not the one this leg is about.)
    await pileA.createEmbeddedDocuments("Item", [
      { name: "ZZ Grim Dup Tome", type: "item",
        system: { grimoire: true, grimoirePages: 3, bulky: true } },
    ]);
    const bookA = pileA.items.find((i) => i.system?.grimoire);
    await pileA.createEmbeddedDocuments("Item", [
      { name: "ZZ Grim Dup Page One", type: "spellbook",
        system: { bound: true, boundTo: bookA.system.grimoireKey, description: "<p>1</p>" } },
      { name: "ZZ Grim Dup Page Two", type: "spellbook",
        system: { bound: true, boundTo: bookA.system.grimoireKey, description: "<p>2</p>" } },
    ]);
    // The Actor Directory's own Duplicate action: clone(..., {save: true}).
    const pileB = await pileA.clone({ name: "ZZ Grim Dup B" }, { save: true });
    const bookB = pileB.items.find((i) => i.system?.grimoire);
    const keyB = bookB.system.grimoireKey;
    const keysCollide = !!keyB && bookA.system.grimoireKey === keyB;

    await pileA.sheet.render(true);
    const moved = await pileA.sheet._onDropItem(
      { preventDefault: () => {}, target: pileA.sheet.element }, bookB);

    const grim = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const arrived = pileA.items.find((i) => i.system?.grimoire && i.id !== bookA.id);
    return {
      ids: [pileA.id, pileB.id],
      keysCollide, moved: !!moved,
      reminted: !!arrived && arrived.system.grimoireKey !== keyB,
      underOld: grim.pagesOfGrimoire(pileA, bookA).map((p) => p.name).sort(),
      underArrived: arrived
        ? grim.pagesOfGrimoire(pileA, arrived).map((p) => p.name).sort() : [],
      cap: bookA.system.grimoirePages,
    };
  });
  cleanup.actorIds.push(...dup.ids);
  check(dup.keysCollide,
    "duplicating an ACTOR copies its book's key — the collision is real");
  check(dup.moved && dup.reminted,
    "and _preCreate re-mints the arriving book on that clash");
  check(dup.underOld.length === 2 && dup.underArrived.length === 2,
    "each book keeps its OWN two pages across the re-mint",
    `old ${JSON.stringify(dup.underOld)}, arrived ${JSON.stringify(dup.underArrived)}`);
  check(dup.underOld.length <= dup.cap && dup.underArrived.length <= dup.cap,
    "and neither book is pushed past its page cap", `cap ${dup.cap}`);

  /* -------------------- 10e. a book riding inside the CREATION PAYLOAD -- */
  // The other half of 10d's mechanism (review #15). Items handed to
  // `Actor.create` reach neither `CairnItem._preCreate` nor
  // `_preCreateOperation`, so before the fix a book made this way came back
  // `grimoireKey: ""` — measured, and it is what the fixture for 10d did by
  // accident. An unkeyed book works only through the one-book fallback and
  // detaches every page the moment a second book joins the actor, which is
  // asserted here rather than argued: the second book is added the ordinary
  // way and the first must keep its page.
  const payload = await gm.evaluate(async () => {
    const pile = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Payload", type: "npc",
      system: { role: "container", containerClass: "pile", slots: 20 },
      items: [
        { name: "ZZ Grim Payload Tome", type: "item",
          system: { grimoire: true, grimoirePages: 3, bulky: true } },
      ],
    });
    const book = pile.items.find((i) => i.system?.grimoire);
    const key = book.system.grimoireKey;
    await pile.createEmbeddedDocuments("Item", [
      { name: "ZZ Grim Payload Page", type: "spellbook",
        system: { bound: true, boundTo: key, description: "<p>p</p>" } },
      // A SECOND book, the ordinary way. With the first one keyed this changes
      // nothing; unkeyed, it is what took the page away.
      { name: "ZZ Grim Payload Tome Two", type: "item",
        system: { grimoire: true, grimoirePages: 3, bulky: true } },
    ]);
    const grim = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const second = pile.items.find((i) => i.system?.grimoire && i.id !== book.id);
    return {
      id: pile.id, key,
      held: grim.pagesOfGrimoire(pile, book).map((p) => p.name),
      otherHeld: grim.pagesOfGrimoire(pile, second).map((p) => p.name),
      // BOTH non-empty, not merely different: with the fix defeated the first
      // key is "" and any real key differs from it, so a bare inequality is a
      // leg that stays green through the very defect the leg above catches.
      distinct: !!second && !!key && !!second.system.grimoireKey
        && second.system.grimoireKey !== key,
    };
  });
  cleanup.actorIds.push(payload.id);
  check(!!payload.key,
    "a book created INSIDE an Actor.create payload is keyed", payload.key || "empty");
  check(payload.distinct, "and the next book on the shelf gets a different key");
  check(payload.held.length === 1 && payload.otherHeld.length === 0,
    "so its page stays its own once a second book joins the shelf",
    `first ${JSON.stringify(payload.held)}, second ${JSON.stringify(payload.otherHeld)}`);

  /* ------------- 10e2. the one-book wall inside the CREATION PAYLOAD -- */
  // Review #34 finding 247. Both halves of the wall are item seams, so a
  // character created with its inventory in one call — Create PC from a
  // custom background whose Starting gear holds two snapshotted Grimoires —
  // landed both books with no warning, while Regenerate and a background swap
  // of the same background spliced to one. The actor-side walk minted a
  // missing key and stopped there; two books sharing a key (snapshots of one
  // keyed book) also stayed shared, where the item seam re-keys the arrival.
  const payloadWall = await gm.evaluate(async () => {
    const warned = [];
    const origWarn = ui.notifications.warn;
    ui.notifications.warn = function (msg, ...rest) {
      warned.push(String(msg));
      return origWarn.call(this, msg, ...rest);
    };
    const book = (n, key = "") => ({ name: `ZZ Grim Payload Wall ${n}`, type: "item",
      system: { grimoire: true, grimoirePages: 3, bulky: true, grimoireKey: key } });
    const made = [];
    try {
      made.push(await CONFIG.Actor.documentClass.create({ name: "ZZ Grim Payload Wall PC", type: "character",
        items: [book("A"), { name: "ZZ Grim Payload Wall Rope", type: "item" }, book("B")] }));
      // Both books already keyed, apart: the splice is then the ONLY change to
      // the payload, which an embedded collection's by-id diff reads as none.
      made.push(await CONFIG.Actor.documentClass.create({ name: "ZZ Grim Payload Wall PC Keyed", type: "character",
        items: [book("E", "zzkeyedgrimbook1"), book("F", "zzkeyedgrimbook2")] }));
      // An npc carries as many books as it likes — a pile doing its job.
      made.push(await CONFIG.Actor.documentClass.create({ name: "ZZ Grim Payload Wall Pile", type: "npc",
        system: { role: "container", containerClass: "pile", slots: 20 },
        items: [book("C", "zzsharedgrimkey1"), book("D", "zzsharedgrimkey1")] }));
      // Import Data (finding 249): core commits the file as ONE parent update,
      // which no item seam sees. The character's own export, two books for
      // its inventory.
      const target = await CONFIG.Actor.documentClass.create({ name: "ZZ Grim Import Wall PC", type: "character" });
      made.push(target);
      const file = target.toObject();
      file.items = [book("G"), book("H")];
      await target.importFromJSON(JSON.stringify(file));
    } finally {
      ui.notifications.warn = origWarn;
    }
    const [pc, keyed, pile, imported] = made;   // creation order
    const books = (a) => a?.items.filter((i) => i.type === "item" && i.system?.grimoire) ?? [];
    const pileKeys = books(pile).map((b) => b.system.grimoireKey);
    return {
      ids: made.map((a) => a.id),
      pcBooks: books(pc).map((b) => b.name),
      keyedBooks: books(keyed).map((b) => b.name),
      importedBooks: books(imported).map((b) => b.name),
      pcRope: !!pc?.items.some((i) => i.name === "ZZ Grim Payload Wall Rope"),
      warnings: warned.filter((m) => m === game.i18n.localize("CAIRN.Notify.GrimoireOnlyOne")).length,
      pileKeys,
    };
  });
  cleanup.actorIds.push(...payloadWall.ids);
  check(payloadWall.pcBooks.length === 1 && payloadWall.pcBooks[0] === "ZZ Grim Payload Wall A" && payloadWall.pcRope,
    "a character created with two books in its payload keeps the first, and the rest of its gear",
    JSON.stringify({ books: payloadWall.pcBooks, rope: payloadWall.pcRope }));
  check(payloadWall.keyedBooks.length === 1 && payloadWall.keyedBooks[0] === "ZZ Grim Payload Wall E",
    "...also when both books arrive keyed, so the splice is the payload's only change",
    JSON.stringify(payloadWall.keyedBooks));
  check(payloadWall.importedBooks.length === 1 && payloadWall.importedBooks[0] === "ZZ Grim Payload Wall G",
    "Import Data of a two-book file onto a character keeps the first book (finding 249)",
    JSON.stringify(payloadWall.importedBooks));
  check(payloadWall.warnings === 3, "...and each says so once", `${payloadWall.warnings} warnings`);
  check(payloadWall.pileKeys.length === 2 && payloadWall.pileKeys.every(Boolean)
      && payloadWall.pileKeys[0] !== payloadWall.pileKeys[1],
    "an npc's payload keeps both books, and two sharing a key part", JSON.stringify(payloadWall.pileKeys));

  /* -------------------------------------- 10f. a scroll casts with NO book -- */
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
      // A DOCUMENT request is never shadowed (review #27): core's #setWorld asks
      // get(ns, key, {document: true}) for the Setting document it updates by id,
      // and any value handed back makes it CREATE a duplicate. check:probes gates this.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
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

  // Cancel really cancels (review #15). DialogV2 resolves a button as
  // `(await callback(...)) ?? button.action` (dialog.mjs:273), so a callback
  // returning `null` is indistinguishable from NO callback and falls through to
  // the STRING "cancel" — truthy, past `if (!picked)`, into
  // `new Roll("canceld6")`, which throws `Unresolved StringTerm` into an action
  // handler core never awaits. The player saw the dialog close and nothing at
  // all; the error reached only their console. Run BEFORE the cast leg below,
  // while the scroll is still unspent, so "it kept its charge" is an assertion
  // rather than a tautology about an already-spent scroll.
  const cancelRun = await gm.evaluate(async (id) => {
    const { castScroll } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const a = game.actors.get(id);
    const origGet = game.settings.get;
    const ns = game.system.id;
    game.settings.get = function (scope, key, ...rest) {
      // A DOCUMENT request is never shadowed (review #27): core's #setWorld asks
      // get(ns, key, {document: true}) for the Setting document it updates by id,
      // and any value handed back makes it CREATE a duplicate. check:probes gates this.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "enable-glog-magic") return true;
      return origGet.call(this, scope, key, ...rest);
    };
    try {
      const solo = a.items.find((x) => x.name === "ZZ Scroll Solo");
      const usesBefore = solo.system.uses.value;
      const msgsBefore = game.messages.size;
      let resolved = "NEVER SETTLED", threw = null;
      const p = castScroll(a, solo).then(
        (v) => { resolved = v; },
        (e) => { threw = String(e?.message ?? e); });
      let clicked = false;
      for (let t = 0; t < 40; t++) {
        const dlg = [...foundry.applications.instances.values()]
          .find((x) => x.constructor.name === "DialogV2"
            && x.element?.querySelector('select[name="dice"]')
            && !x.element?.querySelector('select[name="page"]'));
        if (dlg) {
          dlg.element.querySelector('[data-action="cancel"]').click();
          clicked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      await p;
      await new Promise((r) => setTimeout(r, 300));
      return {
        clicked, resolved, threw, usesBefore,
        usesAfter: solo.system.uses.value,
        newMessages: game.messages.size - msgsBefore,
      };
    } finally { game.settings.get = origGet; }
  }, scrollFx.id);
  check(cancelRun.clicked, "the scroll cast dialog offers a Cancel button to press");
  check(cancelRun.threw === null,
    "Cancel throws nothing", cancelRun.threw ?? "");
  check(cancelRun.resolved === null,
    "and resolves null, not the button's own action string",
    JSON.stringify(cancelRun.resolved));
  // NOT a witness for the fix above, and the control says so: with `() => null`
  // restored, the two legs above red and this one stays green, because the
  // spend follows the card and the throw lands in between. It guards the
  // ORDERING instead — a future reorder that spent first would red it.
  check(cancelRun.newMessages === 0 && cancelRun.usesAfter === cancelRun.usesBefore,
    "no card posted, and the scroll keeps its charge",
    `${cancelRun.newMessages} message(s), uses ${cancelRun.usesBefore} -> ${cancelRun.usesAfter}`);

  const scrollCastRun = await gm.evaluate(async ({ id, seq }) => {
    const { castScroll } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const a = game.actors.get(id);
    const origGet = game.settings.get;
    const ns = game.system.id;
    game.settings.get = function (scope, key, ...rest) {
      // A DOCUMENT request is never shadowed (review #27): core's #setWorld asks
      // get(ns, key, {document: true}) for the Setting document it updates by id,
      // and any value handed back makes it CREATE a duplicate. check:probes gates this.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
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
      // The cast whisper by its own container, not the first whispered message —
      // the change-log's async [GM + owner] whisper can share this window (the
      // race documented at the seedCast helper above).
      const whisper = msgs.find((m) => m.whisper?.length && m.content?.includes("grimoire-cast-whisper"));
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

  /* ------------------------------ 10g. a STACK of scrolls spends one scroll */
  // Review #34 finding 95. Scrolls stack (findMatchingStack, gear.js) — two
  // drops of the same compendium scroll are enough — and the cast used to spend
  // with a bare `uses.value: 0` whatever the quantity held, so ONE cast spent
  // the whole stack. The cast ruling keeps a spent scroll in the inventory
  // (castScroll's docblock), so the spent one splits off as its own row and
  // the rest stay castable. The stack test's other half: a spent scroll and an
  // unspent one of the same spell are different things, and must not merge
  // into a row that is one or the other for both.
  const stackRun = await gm.evaluate(async ({ id, seq }) => {
    const { castScroll } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const { findMatchingStack } = await import(`/systems/${game.system.id}/module/gear.js`);
    const a = game.actors.get(id);
    const before = new Set(a.items.map((x) => x.id));
    await a.createEmbeddedDocuments("Item", [
      { name: "ZZ Scroll Pair", type: "spellbook",
        system: { description: "<p>Light.</p>", scroll: true, quantity: 2 } },
    ]);
    const pair = a.items.find((x) => !before.has(x.id));
    const origGet = game.settings.get;
    const ns = game.system.id;
    game.settings.get = function (scope, key, ...rest) {
      // A DOCUMENT request is never shadowed (review #27): core's #setWorld asks
      // get(ns, key, {document: true}) for the Setting document it updates by id,
      // and any value handed back makes it CREATE a duplicate. check:probes gates this.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "enable-glog-magic") return true;
      // The change log ON, read-shadowed, for the one-card leg (finding 235).
      if (scope === ns && key === "change-log") return true;
      return origGet.call(this, scope, key, ...rest);
    };
    // The ledger posts AFTER its write, reading the setting then: the pair's
    // own "Item added" lands under the shadow if the snapshot is taken at once
    // (run 20261031T161813Z counted it). Settled first, so only the cast counts.
    await new Promise((r) => setTimeout(r, 1000));
    const msgsBefore = new Set(game.messages.map((m) => m.id));
    let i = 0;
    const origRnd = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => seq[Math.min(i++, seq.length - 1)];
    try {
      const opened = new Set(foundry.applications.instances.keys());
      const p = castScroll(a, pair);
      let clicked = false;
      for (let t = 0; t < 40 && !clicked; t++) {
        const dlg = [...foundry.applications.instances.values()]
          .find((x) => !opened.has(x.id) && x.constructor.name === "DialogV2"
            && x.element?.querySelector('select[name="dice"]'));
        if (dlg) { dlg.element.querySelector('[data-action="cast"]').click(); clicked = true; }
        else await new Promise((r) => setTimeout(r, 150));
      }
      const card = await Promise.race([p, new Promise((r) => setTimeout(() => r("__timeout__"), 20000))]);
      await new Promise((r) => setTimeout(r, 800));
      const ledger = game.messages.contents
        .filter((m) => !msgsBefore.has(m.id) && m.getFlag("air-bladder", "changeLog")).length;
      const rows = a.items.filter((x) => x.name === "ZZ Scroll Pair")
        .map((x) => ({ q: x.system.quantity, u: x.system.uses.value }))
        .sort((x, y) => y.u - x.u);
      // The merge test as a unit, on plain data: the arriving copy's spent
      // state against this actor's rows.
      const spentLike = { name: "ZZ Scroll Pair", type: "spellbook",
        system: { scroll: true, uses: { value: 0, max: 1 } } };
      const freshLike = { name: "ZZ Scroll Pair", type: "spellbook",
        system: { scroll: true, uses: { value: 1, max: 1 } } };
      const spentInto = findMatchingStack(a, spentLike);
      const freshInto = findMatchingStack(a, freshLike);
      return {
        clicked, timedOut: card === "__timeout__",
        rows, ledger,
        spentMergesInto: spentInto ? spentInto.system.uses.value : null,
        freshMergesInto: freshInto ? freshInto.system.uses.value : null,
      };
    } finally {
      game.settings.get = origGet;
      CONFIG.Dice.randomUniform = origRnd;
    }
  }, { id: scrollFx.id, seq: [0.9] });
  check(stackRun.clicked && !stackRun.timedOut,
    "precondition: the stack's cast went through");
  check(JSON.stringify(stackRun.rows) === JSON.stringify([{ q: 1, u: 1 }, { q: 1, u: 0 }]),
    "casting from a stack of two spends ONE scroll: one castable left, one spent row kept",
    JSON.stringify(stackRun.rows));
  check(stackRun.spentMergesInto === 0 && stackRun.freshMergesInto === 1,
    "and a spent scroll stacks only with a spent one, a fresh one only with a fresh one",
    `spent->${stackRun.spentMergesInto} fresh->${stackRun.freshMergesInto}`);
  // One cast, one ledger card (review #34 finding 235): the split's create is
  // the system splitting off the spent copy, not an "Item added".
  check(stackRun.ledger === 1,
    "a cast from a stack posts ONE change-log card — no false 'Item added' for the split",
    `${stackRun.ledger} card(s)`);

  /* -------------- 10g2. two dialogs open on ONE scroll cast it once -- */
  // Review #34 finding 133. castScroll asked the charge before its dialog and
  // never after, and the dialog is not modal: a second press on the row's Cast
  // opened a second dialog on the same scroll, and answering both cast it
  // twice — two cards, Fatigue and Mishap risk twice. Both opened before
  // either is answered; the first is answered and lands, then the second.
  const twiceRun = await gm.evaluate(async ({ id }) => {
    const { castScroll } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const a = game.actors.get(id);
    const before = new Set(a.items.map((x) => x.id));
    await a.createEmbeddedDocuments("Item", [
      { name: "ZZ Scroll Twice", type: "spellbook", system: { description: "<p>Light.</p>", scroll: true } },
    ]);
    const once = a.items.find((x) => !before.has(x.id));
    const origGet = game.settings.get;
    const ns = game.system.id;
    game.settings.get = function (scope, key, ...rest) {
      // A DOCUMENT request is never shadowed (review #27) — see 10f.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "enable-glog-magic") return true;
      return origGet.call(this, scope, key, ...rest);
    };
    const origWarn = ui.notifications.warn;
    const warns = [];
    ui.notifications.warn = (m) => { warns.push(String(m)); };
    const timeout = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r("__timeout__"), 20000))]);
    try {
      const opened = new Set(foundry.applications.instances.keys());
      const cards = () => game.messages.contents.filter((m) => m.content?.includes("grimoire-cast-card")).length;
      const cardsBefore = cards();
      const first = castScroll(a, once);
      const second = castScroll(a, once);
      let dialogs = [];
      for (let t = 0; t < 40 && dialogs.length < 2; t++) {
        dialogs = [...foundry.applications.instances.values()]
          .filter((x) => !opened.has(x.id) && x.constructor.name === "DialogV2"
            && x.element?.querySelector('select[name="dice"]'));
        if (dialogs.length < 2) await new Promise((r) => setTimeout(r, 150));
      }
      if (dialogs.length < 2) {
        for (const d of dialogs) await d.close();
        return { dialogs: dialogs.length };
      }
      dialogs[0].element.querySelector('[data-action="cast"]').click();
      const firstResult = await timeout(first);
      dialogs[1].element.querySelector('[data-action="cast"]').click();
      const secondResult = await timeout(second);
      await new Promise((r) => setTimeout(r, 300));
      return {
        dialogs: 2,
        firstCast: !!firstResult && firstResult !== "__timeout__",
        secondRefused: secondResult === null,
        newCards: cards() - cardsBefore,
        usesAfter: once.system.uses.value,
        warned: warns.includes(game.i18n.localize("CAIRN.Notify.ScrollSpent")),
      };
    } finally {
      ui.notifications.warn = origWarn;
      game.settings.get = origGet;
    }
  }, { id: scrollFx.id });
  check(twiceRun.dialogs === 2, "precondition: two cast dialogs open on one scroll", `${twiceRun.dialogs} opened`);
  check(twiceRun.firstCast && twiceRun.newCards === 1 && twiceRun.usesAfter === 0,
    "the first answer casts and spends the scroll — one card",
    JSON.stringify(twiceRun));
  check(twiceRun.secondRefused && twiceRun.warned,
    "the second dialog's answer finds the scroll spent and refuses, with the warning",
    JSON.stringify(twiceRun));

  /* ---------------- 10g3. Transmute on a STACK binds one copy -- */
  // Review #34 finding 213, 10g's class at a second site. Transmute wrote
  // bound/boundTo on the whole row, so a stack of two scrolls became ONE page
  // carrying quantity 2 — counted as one page, the other copy no longer
  // castable — though the confirm offers to transmute "the scroll" for one
  // conversion's cost. The confirm is answered yes in-page; GLOG is this
  // run's (the in-page shadow established at the top).
  const stackBind = await gm.evaluate(async () => {
    const D = foundry.applications.api.DialogV2;
    const origConfirm = D.confirm;
    const origGet = game.settings.get;
    const ns = game.system.id;
    game.settings.get = function (scope, key, ...rest) {
      // A DOCUMENT request is never shadowed (review #27) — see 10f.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "change-log") return true;   // the one-card half (finding 235's class)
      return origGet.call(this, scope, key, ...rest);
    };
    try {
      const a = await CONFIG.Actor.documentClass.create({ name: "ZZ Grim Stack Binder", type: "character",
        items: [{ name: "ZZ Grim Stack Tome", type: "item", system: { grimoire: true, grimoirePages: 3, bulky: true } }] });
      const before = new Set(a.items.map((x) => x.id));
      await a.createEmbeddedDocuments("Item", [{ name: "ZZ Scroll Stack", type: "spellbook",
        system: { description: "<p>Light.</p>", scroll: true, quantity: 2 } }]);
      const stack = a.items.find((x) => !before.has(x.id));
      await a.sheet.render(true);
      let target = null;
      for (let t = 0; t < 30 && !target; t++) {
        target = a.sheet.element?.querySelector(`[data-item-id="${stack.id}"]`);
        if (!target) await new Promise((r) => setTimeout(r, 100));
      }
      D.confirm = async () => true;
      // The setup's own ledger cards settle first (see 10g's snapshot).
      await new Promise((r) => setTimeout(r, 1000));
      const msgsBefore = new Set(game.messages.map((m) => m.id));
      if (target) {
        await a.sheet.constructor.DEFAULT_OPTIONS.actions.pageTransmute
          .call(a.sheet, { preventDefault: () => {} }, target);
      }
      await new Promise((r) => setTimeout(r, 800));
      await a.sheet.close();
      const ledger = game.messages.contents
        .filter((m) => !msgsBefore.has(m.id) && m.getFlag("air-bladder", "changeLog")).length;
      const rows = a.items.filter((x) => x.name === "ZZ Scroll Stack")
        .map((x) => ({ q: x.system.quantity, bound: !!x.system.bound, scroll: !!x.system.scroll, u: x.system.uses?.value }))
        .sort((x, y) => Number(x.bound) - Number(y.bound));
      return { id: a.id, found: !!target, rows, ledger };
    } finally {
      D.confirm = origConfirm;
      game.settings.get = origGet;
    }
  });
  cleanup.actorIds.push(stackBind.id);
  check(stackBind.found, "precondition: the stack's row rendered");
  check(JSON.stringify(stackBind.rows) === JSON.stringify([
    { q: 1, bound: false, scroll: true, u: 1 }, { q: 1, bound: true, scroll: false, u: 0 }]),
  "Transmute on a stack of two scrolls binds ONE: a castable scroll stays, one page joins the book",
  JSON.stringify(stackBind.rows));
  check(stackBind.ledger === 1,
    "...posting ONE change-log card — no false 'Item added' for the page split off",
    `${stackBind.ledger} card(s)`);

  /* ------------- 10h. the Add-N-Fatigue button trusts no card it did not make */
  // Review #34 findings 7 and 93. The button reads its actor and its count from
  // the message HTML, and a player can post a <button> with any class and any
  // data-* (the server's clean keeps both). So the card's AUTHOR must own the
  // actor the button names — a GM's click on a player's crafted card is the
  // confused deputy — and the count is bounded by what a cast can owe: four
  // Magic Dice, four Fatigue. And one card is one payment: two clicks inside
  // the round trip used to pass the spent-flag check twice.
  const fatigueButtonCard = (actorUuid, count) =>
    `<div class="grimoire-cast-whisper"><button type="button" class="grimoire-add-fatigue"`
    + ` data-actor-uuid="${actorUuid}" data-count="${count}">ZZ Add Fatigue</button></div>`;
  const scrollcasterUuid = `Actor.${scrollFx.id}`;
  const alicePlant = await browser.newPage({ viewport: VIEWPORT });
  const alicePlantErrors = watchErrors(alicePlant);
  let forgedId = null;
  try {
    await alicePlant.goto(FOUNDRY_URL);
    await joinAs(alicePlant, "Alice");
    await dismissChrome(alicePlant);
    forgedId = await alicePlant.evaluate(async (content) => {
      const m = await ChatMessage.create({ content });
      return m?.id ?? null;
    }, fatigueButtonCard(scrollcasterUuid, 3));
    check(alicePlantErrors.length === 0, "zero console errors on Alice's planting client",
      alicePlantErrors[0] ?? "");
  } finally {
    await alicePlant.close();
  }
  const buttonRun = await gm.evaluate(async ({ id, forgedId, own, many }) => {
    const { bindGrimoireFatigueButton } = await import(`/systems/${game.system.id}/module/grimoire.js`);
    const a = game.actors.get(id);
    const fatigue = () => a.items.filter((i) => i.name === "Fatigue").length;
    const press = async (msg, times) => {
      const html = document.createElement("div");
      html.innerHTML = msg.content;
      bindGrimoireFatigueButton(msg, html);
      const btn = html.querySelector(".grimoire-add-fatigue");
      if (!btn?.onclick) return false;
      // NOT awaited between presses: the double-click is the case.
      await Promise.all(Array.from({ length: times }, () => btn.onclick()));
      return true;
    };
    const out = { forgedExists: !!game.messages.get(forgedId) };
    // (a) A player's card naming an actor that player does not own.
    const f0 = fatigue();
    out.forgedAuthorOwns = a.testUserPermission(game.messages.get(forgedId)?.author, "OWNER");
    await press(game.messages.get(forgedId), 1);
    out.forgedAdded = fatigue() - f0;
    // (b) The Warden's own card with a count no cast can owe.
    const bigMsg = await ChatMessage.create({ content: many, whisper: [game.user.id] });
    const f1 = fatigue();
    await press(bigMsg, 1);
    out.bigAdded = fatigue() - f1;
    // (c) An honest card, pressed twice inside one round trip.
    const ownMsg = await ChatMessage.create({ content: own, whisper: [game.user.id] });
    const f2 = fatigue();
    out.pressed = await press(ownMsg, 2);
    await new Promise((r) => setTimeout(r, 300));
    out.doubleAdded = fatigue() - f2;
    return out;
  }, { id: scrollFx.id, forgedId,
    own: fatigueButtonCard(scrollcasterUuid, 2), many: fatigueButtonCard(scrollcasterUuid, 40) });
  check(buttonRun.forgedExists && !buttonRun.forgedAuthorOwns,
    "precondition: Alice's card names an actor she does not own");
  check(buttonRun.forgedAdded === 0,
    "the Warden's click on a player's forged Fatigue button writes nothing",
    `${buttonRun.forgedAdded} Fatigue added`);
  check(buttonRun.bigAdded === 4,
    "a card asking for 40 Fatigue pays at most what four Magic Dice can owe",
    `${buttonRun.bigAdded} Fatigue added`);
  check(buttonRun.pressed && buttonRun.doubleAdded === 2,
    "a double-click on an honest Add-2 button adds 2, not 4",
    `${buttonRun.doubleAdded} Fatigue added`);

  /* --------------------------------------------------------- 11. Alice casts */
  const alicePage = await browser.newPage({ viewport: VIEWPORT });
  const aliceErrors = watchErrors(alicePage);
  await alicePage.goto(FOUNDRY_URL);
  await joinAs(alicePage, "Alice");
  await dismissChrome(alicePage);
  await glogOn(alicePage);
  try {
    const aliceCast = await seedCast(alicePage, [0.9, 0.4]);
    check(!aliceCast.error && aliceCast.rollTotal === 5,
      "Alice casts from her own character end-to-end");
    const aliceId = await alicePage.evaluate(() => game.user.id);
    check(aliceCast.whisperTo.length === 1 && aliceCast.whisperTo[0] === aliceId,
      "her whisper is addressed to Alice, not the GM", JSON.stringify(aliceCast.whisperTo));

    // A CONCEALED cast card, read by a player who may not see it (review #34
    // finding 94). Core's Conceal Message turns any public card into a whisper
    // to the Wardens; the public cast card carries its roll, and a whispered
    // roll stays `visible` to everyone, so the render hook still runs on this
    // client — after core has written "<user> rolled privately" into the flavor.
    // The rebuild must ask isContentVisible first and leave core's line alone.
    // Built in memory on Alice's own client, never posted; the control is the
    // same card unwhispered, whose flavor the rebuild does write.
    const concealed = await alicePage.evaluate(async () => {
      const warden = game.users.find((u) => u.isGM);
      const roll = await new Roll("2d6").evaluate();
      const make = (whisper) => new ChatMessage.implementation({
        author: warden.id, whisper, flavor: "seed",
        speaker: { alias: "ZZ Grim Caster" }, rolls: [JSON.stringify(roll.toJSON())],
        content: '<div class="grimoire-cast-card">seed</div>',
        flags: { "air-bladder": { glogCast: {
          name: "ZZ Spell Alpha", desc: "ZZ-CONCEALED", dice: 2, sum: 7, alias: "ZZ Grim Caster",
        } } },
      });
      const hidden = make([warden.id]);
      const open = make([]);
      const hiddenEl = await hidden.renderHTML();
      const openEl = await open.renderHTML();
      return {
        hiddenReadable: hidden.isContentVisible,
        hiddenFlavor: hiddenEl.querySelector(".flavor-text")?.innerHTML ?? "",
        openFlavor: openEl.querySelector(".flavor-text")?.innerHTML ?? "",
      };
    });
    check(!concealed.hiddenReadable && concealed.openFlavor.includes("glog-flavor-tag"),
      "precondition: Alice cannot read the concealed card, and the open one is rebuilt",
      concealed.openFlavor);
    check(!concealed.hiddenFlavor.includes("glog-flavor-tag") && !concealed.hiddenFlavor.includes("ZZ Grim Caster"),
      "a concealed cast card keeps core's private-roll line: no GLOG tag, no caster",
      concealed.hiddenFlavor);
    check(aliceErrors.length === 0, "zero console errors on Alice's client", aliceErrors[0] ?? "");
  } finally {
    await alicePage.close();
  }

  /* --------------------------- 12. the stamp migration, across a reload ---- */
  // Legacy shape planted the only way it can be: `boundTo` is never written
  // (a page created without it), and the book's key is stripped after creation,
  // because every create route mints one. Then the marker is dropped and the
  // world reloaded, so the real ready-hook phase runs exactly as it does for a
  // Warden opening their world after the update.
  //
  // THE STRIP GOES THROUGH THE RAW SOCKET (review #15), and the reason is the
  // point of the fix it now sits behind: `_preUpdate` strips a write clearing
  // `grimoireKey`, so the document layer can no longer produce this shape at
  // all — which is exactly what a legacy book IS, a record written before the
  // field existed rather than one somebody cleared. The precondition check
  // below caught the change the moment the guard landed; it reported "3 already
  // stamped" and the migration then had nothing to do while every leg after it
  // still passed on keys minted at CREATE. A fixture that quietly stops being
  // the thing under test is the failure mode this leg's precondition exists for.
  const legacyFx = await gm.evaluate(async () => {
    const shelf = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Old Shelf", type: "npc",
      system: { role: "container", containerClass: "pile", slots: 20 },
    });
    const solo = await CONFIG.Actor.documentClass.create({
      name: "ZZ Grim Old Solo", type: "character" });
    // TWO books and three unkeyed pages: nothing in the data says which book
    // any of them is in, so the migration must match NONE of them. It is worth
    // knowing why there is no positional answer — this fixture is planted in a
    // deliberate order and comes back from the reload in a different one, which
    // is what killed the first draft's "nearest preceding book" rule.
    await shelf.createEmbeddedDocuments("Item", [
      { name: "ZZ Grim Old Stray", type: "spellbook", system: { bound: true } },
      { name: "ZZ Grim Old One", type: "item", system: { grimoire: true, bulky: true } },
      { name: "ZZ Grim Old P1", type: "spellbook", system: { bound: true } },
      { name: "ZZ Grim Old Two", type: "item", system: { grimoire: true, bulky: true } },
      { name: "ZZ Grim Old P2", type: "spellbook", system: { bound: true } },
    ]);
    // The single-book case, where ORDER MUST BE IGNORED: the page was
    // transmuted from a scroll the character already had, so it precedes the
    // book — the ordinary case, and a positional rule would miss exactly it.
    await solo.createEmbeddedDocuments("Item", [
      { name: "ZZ Grim Old Early", type: "spellbook", system: { bound: true } },
      { name: "ZZ Grim Old Book", type: "item", system: { grimoire: true, bulky: true } },
    ]);
    const strip = async (actor) => foundry.helpers.SocketInterface.dispatch("modifyDocument", {
      type: "Item", action: "update",
      operation: {
        parentUuid: actor.uuid,
        updates: actor.items.filter((i) => i.system?.grimoire)
          .map((i) => ({ _id: i.id, system: { grimoireKey: "" } })),
        diff: false,
      },
    });
    await strip(shelf);
    await strip(solo);
    // And READ raw as well, for the same reason. A manual dispatch is not the
    // backend's own path, so nothing applies the response to THIS client — the
    // local documents still hold the key that was minted at create, and a
    // precondition read off them reports the fixture unplanted when the
    // database says otherwise. The reload is what the migration will see, so
    // the database is the only honest witness. (Measured: the local read said
    // "3 already stamped" while the run that followed stamped 3 books.)
    const state = async (a) => {
      const res = await foundry.helpers.SocketInterface.dispatch("modifyDocument", {
        type: "Item", action: "get",
        operation: {
          parentUuid: a.uuid, query: { _id__in: a.items.map((i) => i.id) },
          broadcast: false,
        },
      });
      return (res?.result ?? []).map((i) => ({
        n: i.name, key: i.system?.grimoireKey ?? null, to: i.system?.boundTo ?? null }));
    };
    const shelfState = await state(shelf);
    const soloState = await state(solo);
    await game.settings.set(game.system.id, "grimoire-keys-stamped", false);
    return {
      shelfId: shelf.id, soloId: solo.id, shelf: shelfState, solo: soloState,
      // An empty raw read would make the precondition below pass by having
      // nothing to look at, which is the one way it must never pass.
      readEmpty: !shelfState.length || !soloState.length,
    };
  });
  cleanup.actorIds.push(legacyFx.shelfId, legacyFx.soloId);
  const preStamped = [...legacyFx.shelf, ...legacyFx.solo]
    .filter((i) => i.key || i.to).length;
  check(preStamped === 0 && !legacyFx.readEmpty,
    "the legacy fixtures really are unkeyed before the reload",
    legacyFx.readEmpty ? "the raw read returned nothing" : `${preStamped} already stamped`);

  console.log("  note  reloading, so the ready-hook migration runs for real");
  const migrationLog = [];
  const migrationWarn = [];
  gm.on("console", (m) => {
    if (/grimoire keys: /.test(m.text())) migrationLog.push(m.text());
    if (/bound pages sitting with SEVERAL/.test(m.text())) migrationWarn.push(m.text());
  });
  await gm.reload({ waitUntil: "networkidle", timeout: 60000 });
  await gm.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(gm);
  // The migrations are awaited phases inside the ready hook, not part of
  // `ready` itself, so game.ready can be true a beat before they have written.
  await gm.waitForTimeout(3000);

  const stamped = await gm.evaluate(({ shelfId, soloId }) => {
    const read = (id) => {
      const a = game.actors.get(id);
      const m = {};
      for (const i of a.items) m[i.name] = i.system.grimoire
        ? { key: i.system.grimoireKey } : { to: i.system.boundTo };
      return m;
    };
    return { shelf: read(shelfId), solo: read(soloId),
      marker: game.settings.get(game.system.id, "grimoire-keys-stamped") };
  }, legacyFx);
  const sh = stamped.shelf;
  check(!!sh["ZZ Grim Old One"].key && !!sh["ZZ Grim Old Two"].key
    && sh["ZZ Grim Old One"].key !== sh["ZZ Grim Old Two"].key,
    "every legacy book came out with its own key");
  check(["ZZ Grim Old Stray", "ZZ Grim Old P1", "ZZ Grim Old P2"]
    .every((n) => sh[n].to === ""),
    "on a TWO-book shelf no page is matched — the data does not say which book",
    JSON.stringify(sh));
  check(migrationWarn.length > 0 && migrationWarn[0].includes("ZZ Grim Old Shelf"),
    "and the shelf is NAMED in the log, so a Warden can find what to sort out",
    migrationWarn[0] ?? "nothing warned");
  check(stamped.solo["ZZ Grim Old Early"].to === stamped.solo["ZZ Grim Old Book"].key
    && !!stamped.solo["ZZ Grim Old Book"].key,
    "a page BEFORE the only book is still matched — one book, one answer",
    JSON.stringify(stamped.solo));
  check(migrationLog.length > 0, "the migration named itself as the writer",
    migrationLog[0] ?? "nothing logged — something else wrote the keys");
  check(stamped.marker === true, "and the marker is set, so it does not run again");

  check(gmErrors.length === 0, "zero console errors on the GM client", gmErrors[0] ?? "");
} finally {
  /* ------------------------------------------------------------- sweep ---- */
  try {
    const swept = await gm.evaluate(async ({ actorIds, itemIds, msgsAtStart }) => {
      const names = [];
      for (const id of actorIds) {
        const a = game.actors.get(id);
        if (a) { names.push(`${a.name} ${a.id}`); await a.delete(); }
      }
      for (const id of itemIds) {
        const i = game.items.get(id);
        if (i) { names.push(`${i.name} ${i.id}`); await i.delete(); }
      }
      for (const m of game.messages.filter((m) => !msgsAtStart.includes(m.id) &&
        (m.content?.includes("ZZ Spell") || m.content?.includes("grimoire-cast")))) {
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

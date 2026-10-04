#!/usr/bin/env node
/**
 * Rest eats a ration.
 *
 *   npm run dev:rest
 *
 * A HOUSE RULE for every table (2026-10-03, user ask), player characters only:
 * the Rest button tells the player a ration is eaten, refuses with no rations
 * on the sheet, spends one USE of a Rations item (a stack of several rolls a
 * unit over, the row's own − arithmetic), and restores Hit Protection to its
 * maximum. (For a day a Rest under Crawler Combat Mode ROLLED for Hit
 * Protection instead, on a card of its own; the user removed it and the mode
 * the same evening, and legs 10-15 that tested it went with them.)
 *
 * Every leg drives the REAL button and answers the REAL dialog — the two
 * halves of the gesture (the refusal, and the write behind the confirm) are
 * exactly what a handler called directly would skip. Settings ride
 * `withSettings` so the restore runs in Node, not in-page.
 *
 * Legs:
 *   1. no rations → a one-button refusal; nothing written.
 *   2. rations → the confirm names the count, WITHOUT Cairn's "few moments"
 *      prose (2026-10-03, user); No spends nothing.
 *   3. Yes → one use gone, HP at max.
 *   4. Escape → nothing.
 *   5. a stack (uses 1 of quantity 2) → quantity 1, uses refilled; the count
 *      line counted the whole stack.
 *   6. a Rations item at 0 uses does NOT count → the refusal, item untouched.
 *   7. two Rations items → the first with a use left pays.
 *   8. an NPC's Rest is the old confirm, Cairn's prose kept: no ration asked,
 *      HP to max.
 *   9. the PC tooltip is the ration sentence plus the bandages sentence, and
 *      not Cairn's "few moments" opening; the NPC's is Cairn's alone.
 *
 * Red-first (proven when written): drop the ration test in #onRest and legs
 * 1, 2, 5-7 red.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(300000, "rest probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

let r = null;

try {
  await joinAsGM(page);

  r = await withSettings(page, () => page.evaluate(async () => {
    const NS = "air-bladder";
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 4000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const utils = await import("/systems/air-bladder/module/utils.js");
    const out = { made: [] };

    // STALE STATE MUST NOT SATISFY A PRECONDITION: sweep leftovers first.
    for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ Rest "))) await a.delete();

    // No ledger litter in the dev world's chat: the ledger has its own gate
    // (dev:change-log), which asserts the one-card shape of a Rest.
    await game.settings.set(NS, "change-log", false);

    const Cls = getDocumentClass("Actor");
    const pc = await Cls.create({ name: "ZZ Rest PC", type: "character",
      system: { hp: { value: 2, max: 6 } } }, { abNoStatusCard: true });
    out.made.push(pc.id);
    // SOURCE, never derived: derived HP is pinned to 0 under encumbrance/panic.
    const hp = () => pc._source.system.hp.value;
    const rationsOf = (actor) => actor.items.filter((i) => /\brations?\b/i.test(i.name));
    const uses = (item) => item?._source.system.uses?.value ?? null;
    const qty = (item) => item?._source.system.quantity ?? null;

    /**
     * Press the REAL Rest button on an actor's sheet and answer the dialog that
     * appears: "yes" / "no" / "ok" clicks that button, null dismisses it. The
     * dialog is found as the one that was NOT already present (a closing
     * DialogV2 lingers with dead listeners), and the helper waits for it to
     * LEAVE the DOM before returning — the lingering-dialog trap, fourth site.
     */
    const pressRest = async (actor, answer) => {
      await actor.sheet.render(true);
      const t0 = Date.now();
      let btn;
      while (!(btn = actor.sheet.element?.querySelector?.("#rest-button"))) {
        if (Date.now() - t0 > 5000) return { err: "#rest-button never rendered" };
        await sleep(100);
      }
      const tooltip = btn.dataset.tooltip ?? null;
      const stale = new Set(document.querySelectorAll(".application.dialog"));
      btn.click();
      let dlg = null;
      while (!(dlg = [...document.querySelectorAll(".application.dialog")].find((d) => !stale.has(d)))) {
        if (Date.now() - t0 > 5000) break;
        await sleep(100);
      }
      if (!dlg) { await actor.sheet.close(); return { err: "no dialog appeared", tooltip }; }
      const shape = {
        tooltip,
        text: (dlg.querySelector(".cairn-confirm") ?? dlg).textContent.replace(/\s+/g, " ").trim(),
        yes: !!dlg.querySelector('button[data-action="yes"]'),
        no: !!dlg.querySelector('button[data-action="no"]'),
        okBtn: !!dlg.querySelector('button[data-action="ok"]'),
      };
      if (answer) {
        const b = dlg.querySelector(`button[data-action="${answer}"]`);
        if (!b) { await actor.sheet.close(); return { ...shape, err: `no "${answer}" button` }; }
        b.click();
      } else {
        dlg.querySelector('[data-action="close"]')?.click();
      }
      const t1 = Date.now();
      while (dlg.isConnected && Date.now() - t1 < 5000) await sleep(100);
      await sleep(400);
      await actor.sheet.close();
      return shape;
    };

    const count = (n) => utils.formatCount("CAIRN.NRation", n);
    out.strings = {
      noRations: game.i18n.localize("CAIRN.RestNoRations"),
      restTip: game.i18n.localize("CAIRN.RestTip"),
      rationTip: game.i18n.localize("CAIRN.RestRationTip"),
      rest: game.i18n.localize("CAIRN.Rest"),
      confirmQ: game.i18n.localize("CAIRN.RestRationConfirm"),
      npcQ: game.i18n.localize("CAIRN.RestConfirmNpc"),
      line: (n) => game.i18n.format("CAIRN.RestRationLine", { rations: count(n) }),
    };
    out.lines = { 1: out.strings.line(1), 2: out.strings.line(2), 3: out.strings.line(3), 4: out.strings.line(4) };

    /* ---- 1. no rations ------------------------------------------------- */
    out.noRations = { shape: await pressRest(pc, "ok"), hp: hp(), items: pc.items.size };

    /* ---- 2. rations: the count, and No ---------------------------------- */
    await pc.createEmbeddedDocuments("Item",
      [{ name: "Rations", type: "item", system: { uses: { value: 3, max: 3 }, quantity: 1 } }],
      { abNoStatusCard: true });
    const first = () => rationsOf(pc)[0];
    out.declined = { shape: await pressRest(pc, "no"), uses: uses(first()), hp: hp() };

    /* ---- 3. Yes -------------------------------------------------------- */
    // WITH THE RATION'S OWN SHEET OPEN (review #33): the Rest writes the ration
    // inside the actor's update, which fires no item hooks and re-renders only
    // the actor's apps, so this sheet kept the old count — and, saving on every
    // change, its next edit wrote that stale count back. The field is read off
    // the live sheet after the write.
    await first().sheet.render(true);
    await until(() => first().sheet.element instanceof HTMLElement);
    out.rested = { shape: await pressRest(pc, "yes") };
    await until(() => uses(first()) === 2);
    await new Promise((r) => setTimeout(r, 400));
    Object.assign(out.rested, {
      uses: uses(first()), qty: qty(first()), hp: hp(),
      sheetUses: first().sheet.element?.querySelector('[name="system.uses.value"]')?.value ?? null,
    });
    await first().sheet.close();

    /* ---- 4. Escape ----------------------------------------------------- */
    await pc.update({ "system.hp.value": 1 }, { abNoStatusCard: true });
    out.escaped = { shape: await pressRest(pc, null), uses: uses(first()), hp: hp() };

    /* ---- 5. a stack rolls a unit over ---------------------------------- */
    await first().update({ "system.uses.value": 1, "system.quantity": 2 }, { abNoStatusCard: true });
    out.rollover = { shape: await pressRest(pc, "yes") };
    await until(() => qty(first()) === 1);
    Object.assign(out.rollover, { uses: uses(first()), qty: qty(first()), hp: hp() });

    /* ---- 6. zero uses does not count ----------------------------------- */
    await first().update({ "system.uses.value": 0, "system.quantity": 1 }, { abNoStatusCard: true });
    await pc.update({ "system.hp.value": 1 }, { abNoStatusCard: true });
    out.zeroUses = { shape: await pressRest(pc, "ok"), uses: uses(first()), qty: qty(first()), hp: hp() };

    /* ---- 7. two Rations items ------------------------------------------ */
    await pc.createEmbeddedDocuments("Item",
      [{ name: "Iron Rations", type: "item", system: { uses: { value: 2, max: 3 }, quantity: 1 } }],
      { abNoStatusCard: true });
    const second = () => rationsOf(pc).find((i) => i.name === "Iron Rations");
    out.twoItems = { shape: await pressRest(pc, "yes") };
    await until(() => uses(second()) === 1);
    Object.assign(out.twoItems, { firstUses: uses(first()), secondUses: uses(second()), hp: hp() });

    /* ---- 8. an NPC is untouched ---------------------------------------- */
    const npc = await Cls.create({ name: "ZZ Rest NPC", type: "npc",
      system: { role: "hireling", hp: { value: 2, max: 6 } } }, { abNoStatusCard: true });
    out.made.push(npc.id);
    out.npc = { shape: await pressRest(npc, "yes") };
    await until(() => npc._source.system.hp.value === 6);
    out.npc.hp = npc._source.system.hp.value;
    return out;
  }));
} finally {
  try {
    await page.evaluate(async ({ ids }) => {
      for (const id of ids ?? []) await game.actors.get(id)?.delete();
      for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ Rest "))) await a.delete();
    }, { ids: r?.made ?? [] });
  } catch (e) {
    console.error(`  note  cleanup: ${e.message}`);
  }
}

/* ---------------------------------- assertions --------------------------- */
if (!r) { fail("the in-page run returned nothing"); }
else {
  const S = r.strings;
  const has = (text, s) => typeof text === "string" && typeof s === "string" && s && text.includes(s);

  // 1
  r.noRations.shape?.okBtn && !r.noRations.shape?.yes && has(r.noRations.shape?.text, S.noRations)
    ? ok(`no rations: the Rest button opens a one-button refusal that says so ("${S.noRations}")`)
    : fail(`no rations: ${JSON.stringify(r.noRations.shape)}`);
  r.noRations.hp === 2 && r.noRations.items === 0
    ? ok("...and writes nothing: HP 2 and no items, as before")
    : fail(`no rations wrote something: hp ${r.noRations.hp}, items ${r.noRations.items}`);

  // 2
  r.declined.shape?.yes && r.declined.shape?.no && has(r.declined.shape?.text, r.lines[3]) && has(r.declined.shape?.text, S.confirmQ)
    ? ok(`with Rations (3 uses) the confirm names the count — "${r.lines[3]}" — and asks "${S.confirmQ}"`)
    : fail(`confirm shape: ${JSON.stringify(r.declined.shape)}; wanted "${r.lines[3]}" and "${S.confirmQ}"`);
  // 2026-10-03 (user, having read the dialog): the PC confirm opens on the
  // ration line — Cairn's "few moments" prose is NOT above it. Leg 8 holds the
  // converse for an NPC, which is what proves the omission is PC-scoped.
  !has(r.declined.shape?.text, S.restTip)
    ? ok("...and WITHOUT Cairn's \"few moments\" prose above it")
    : fail("the PC confirm still opens with Cairn's RestTip prose");
  r.declined.uses === 3 && r.declined.hp === 2
    ? ok("No spends nothing: uses 3, HP 2")
    : fail(`No spent something: uses ${r.declined.uses}, hp ${r.declined.hp}`);

  // 3
  r.rested.uses === 2 && r.rested.qty === 1 && r.rested.hp === 6
    ? ok("Yes: one use gone (3 -> 2) and HP at its maximum (6) — a full restore")
    : fail(`Yes: ${JSON.stringify(r.rested)} — want uses 2, qty 1, hp 6`);
  r.rested.sheetUses === "2"
    ? ok("...and the ration's OPEN sheet shows the new count, so its next save cannot put the ration back")
    : fail(`the open Rations sheet shows uses ${JSON.stringify(r.rested.sheetUses)} after the Rest — stale, and its next edit resubmits it`);

  // 4
  r.escaped.uses === 2 && r.escaped.hp === 1
    ? ok("Escape (the window's close) spends nothing and heals nothing")
    : fail(`Escape: ${JSON.stringify(r.escaped)} — want uses 2, hp 1`);

  // 5
  r.rollover.qty === 1 && r.rollover.uses === 3 && r.rollover.hp === 6
    ? ok("a stack rolls a unit over: uses 1 of quantity 2 -> quantity 1, uses 3 (the row's own − arithmetic, one copy)")
    : fail(`rollover: ${JSON.stringify(r.rollover)} — want qty 1, uses 3, hp 6`);
  has(r.rollover.shape?.text, r.lines[4])
    ? ok(`...and the count line counted the whole stack: "${r.lines[4]}"`)
    : fail(`the stack's count line: ${JSON.stringify(r.rollover.shape?.text)}; wanted "${r.lines[4]}"`);

  // 6
  r.zeroUses.shape?.okBtn && r.zeroUses.uses === 0 && r.zeroUses.qty === 1 && r.zeroUses.hp === 1
    ? ok("a Rations item at 0 uses does not count: the refusal, the item untouched, HP 1")
    : fail(`zero uses: ${JSON.stringify(r.zeroUses)}`);

  // 7
  r.twoItems.firstUses === 0 && r.twoItems.secondUses === 1 && has(r.twoItems.shape?.text, r.lines[2])
    ? ok(`two Rations items: the one with a use left pays (Iron Rations 2 -> 1), the empty one is untouched, and the count was "${r.lines[2]}"`)
    : fail(`two items: ${JSON.stringify(r.twoItems)}; wanted the count "${r.lines[2]}"`);

  // 8
  r.npc.shape?.yes && r.npc.shape?.no && !has(r.npc.shape?.text, S.rationTip) && !has(r.npc.shape?.text, "ration") && has(r.npc.shape?.text, S.npcQ)
    ? ok(`an NPC's Rest is the old confirm: "${S.npcQ}", no ration asked`)
    : fail(`npc confirm: ${JSON.stringify(r.npc.shape)}`);
  has(r.npc.shape?.text, S.restTip)
    ? ok("...and still opens with Cairn's own prose — the PC omission above is PC-scoped, not the helper dropping every tip")
    : fail("the NPC confirm lost Cairn's RestTip prose");
  r.npc.hp === 6
    ? ok("...and restores HP to its maximum with no rations on the sheet")
    : fail(`npc hp ${r.npc.hp}, want 6`);

  // 9
  // The tooltip is RestRationTip ALONE (2026-10-03, user): the ration sentence
  // plus Cairn's bandages sentence. The "few moments" opening is read off
  // RestTip's own first sentence in this client's language, never a literal.
  const pcTip = r.declined.shape?.tooltip ?? "";
  const fewMoments = S.restTip.split(". ")[0];
  pcTip === S.rationTip && !has(pcTip, fewMoments)
    ? ok(`the PC Rest tooltip is the ration sentence plus the bandages sentence ("${S.rationTip}"), without Cairn's "few moments" opening`)
    : fail(`pc tooltip: ${JSON.stringify(pcTip)} — want exactly "${S.rationTip}"`);
  r.npc.shape?.tooltip === S.restTip
    ? ok("...and the NPC's tooltip is Cairn's prose alone")
    : fail(`npc tooltip: ${JSON.stringify(r.npc.shape?.tooltip)}`);
}

if (errors.length) { failed = true; console.log("Console errors:\n" + errors.join("\n")); }
console.log(failed ? "\nrest e2e FAILED" : "\nrest e2e passed");
await browser.close();
process.exit(failed ? 1 : 0);

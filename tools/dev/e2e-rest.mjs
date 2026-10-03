#!/usr/bin/env node
/**
 * Rest eats a ration; under Crawler Combat Mode, Rest ROLLS for Hit Protection.
 *
 *   npm run dev:rest
 *
 * Both rules landed 2026-10-03 (user ask). The first is a HOUSE RULE for every
 * table, player characters only: the Rest button tells the player a ration is
 * eaten, refuses with no rations on the sheet, and spends one USE of a Rations
 * item (a stack of several rolls a unit over, the row's own − arithmetic). The
 * second is the hack's: a Rest rolls a die the size of the character's maximum
 * and keeps it only if it beats what they have, and says so on a chat card
 * rebuilt per viewer from numbers.
 *
 * Every leg drives the REAL button and answers the REAL dialog — the two
 * halves of the gesture (the refusal, and the write behind the confirm) are
 * exactly what a handler called directly would skip. Settings ride
 * `withSettings` so the restore runs in Node, not in-page.
 *
 * Legs, hack OFF:
 *   1. no rations → a one-button refusal; nothing written.
 *   2. rations → the confirm names the count; No spends nothing.
 *   3. Yes → one use gone, HP at max.
 *   4. Escape → nothing.
 *   5. a stack (uses 1 of quantity 2) → quantity 1, uses refilled; the count
 *      line counted the whole stack.
 *   6. a Rations item at 0 uses does NOT count → the refusal, item untouched.
 *   7. two Rations items → the first with a use left pays.
 *   8. an NPC's Rest is the old confirm: no ration asked, HP to max.
 *   9. the PC tooltip carries the house-rule sentence after Cairn's; the NPC's
 *      is Cairn's alone.
 * Hack ON:
 *  10. pinned HIGH → HP becomes the roll; the card's flag holds the four
 *      numbers and its line says HP rose; the flavor names Rest.
 *  11. pinned LOW → HP unchanged, the ration still spent, the line says stays.
 *  12. a scarred maximum of 7 rolls 1d7.
 *  13. a maximum of 0 takes the plain path: no roll card, ration spent.
 *  14. the flag is numbers only, and the line is REBUILT per viewer: a
 *      translation override in this client changes the rendered line and
 *      restoring it changes it back.
 *  15. a Private GM Roll shows a player's client "rolled privately" — no line,
 *      no die — while the Warden's own client shows the line.
 *
 * Red-first (each proven when written): drop the ration test in #onRest and
 * legs 1, 2, 5-7 red; drop the `>` comparison and leg 11 reds; drop
 * `isContentVisible` from localizeRestCard and leg 15 reds.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(300000, "rest probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

let r = null;
let priv = { gm: null, alice: null };
let rollModeWas = null;
let alicePage = null;

try {
  await joinAsGM(page);
  rollModeWas = await page.evaluate(() => game.settings.get("core", "messageMode"));

  r = await withSettings(page, () => page.evaluate(async () => {
    const NS = "air-bladder";
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 4000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const utils = await import("/systems/air-bladder/module/utils.js");
    const out = { made: [], msgs: [] };

    // STALE STATE MUST NOT SATISFY A PRECONDITION: sweep leftovers first.
    for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ Rest "))) await a.delete();

    await game.settings.set(NS, "crawler-combat-mode", false);
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
    out.crawlerLine = (faces, h) => game.i18n.format("CAIRN.RestCrawlerLine", { faces, hp: h });
    out.crawlerLine62 = game.i18n.format("CAIRN.RestCrawlerLine", { faces: 6, hp: 2 });

    /* ---- 1. no rations ------------------------------------------------- */
    out.noRations = { shape: await pressRest(pc, "ok"), hp: hp(), items: pc.items.size };

    /* ---- 2. rations: the count, and No ---------------------------------- */
    await pc.createEmbeddedDocuments("Item",
      [{ name: "Rations", type: "item", system: { uses: { value: 3, max: 3 }, quantity: 1 } }],
      { abNoStatusCard: true });
    const first = () => rationsOf(pc)[0];
    out.declined = { shape: await pressRest(pc, "no"), uses: uses(first()), hp: hp() };

    /* ---- 3. Yes -------------------------------------------------------- */
    out.rested = { shape: await pressRest(pc, "yes") };
    await until(() => uses(first()) === 2);
    Object.assign(out.rested, { uses: uses(first()), qty: qty(first()), hp: hp() });

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

    /* ---- 10-13. Crawler Combat Mode ------------------------------------ */
    await game.settings.set(NS, "crawler-combat-mode", true);
    const restCards = () => game.messages.contents.filter((m) => m.getFlag(NS, "restRoll"));
    const pinned = async (u, fn) => {
      const orig = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => u;
      try { return await fn(); } finally { CONFIG.Dice.randomUniform = orig; }
    };
    const readCard = async (m) => {
      if (!m) return null;
      out.msgs.push(m.id);
      await until(() => document.querySelector(`[data-message-id="${m.id}"]`));
      const el = document.querySelector(`[data-message-id="${m.id}"]`);
      return {
        id: m.id, isRoll: m.isRoll, formula: m.rolls?.[0]?.formula ?? null,
        flag: foundry.utils.deepClone(m.getFlag(NS, "restRoll")),
        line: el?.querySelector(".rest-roll-line")?.textContent?.trim() ?? null,
        flavor: el?.querySelector(".flavor-text")?.textContent?.trim() ?? null,
        total: el?.querySelector(".dice-total")?.textContent?.trim() ?? null,
      };
    };
    const restUnder = async (u, setup) => {
      await pc.update(setup, { abNoStatusCard: true });
      await second().update({ "system.uses.value": 3 }, { abNoStatusCard: true });
      const n = restCards().length;
      const shape = await pinned(u, () => pressRest(pc, "yes"));
      const posted = await until(() => restCards().length > n, 3000);
      return { shape, card: posted ? await readCard(restCards().at(-1)) : null,
        hp: hp(), uses: uses(second()) };
    };
    // 10. high: 0.0001 -> the maximum (mapRandomFace is ceil((1-u)*faces)).
    out.crawlHigh = await restUnder(0.0001, { "system.hp.value": 2, "system.hp.max": 6 });
    out.crawlHigh.expectLine = game.i18n.format("CAIRN.RestRollUp", { rolled: 6, faces: 6, before: 2, after: 6 });
    // 11. low: 0.9999 -> 1.
    out.crawlLow = await restUnder(0.9999, { "system.hp.value": 2, "system.hp.max": 6 });
    out.crawlLow.expectLine = game.i18n.format("CAIRN.RestRollStays", { rolled: 1, faces: 6, hp: 2 });
    // 12. a scarred maximum.
    out.scar7 = await restUnder(0.0001, { "system.hp.value": 3, "system.hp.max": 7 });
    // 13. a maximum of 0: the plain path, no card.
    out.max0 = await restUnder(0.0001, { "system.hp.value": 0, "system.hp.max": 0 });

    /* ---- 14. numbers only, rebuilt per viewer ---------------------------- */
    const high = game.messages.get(out.crawlHigh.card?.id);
    out.flagTypes = Object.entries(high?.getFlag(NS, "restRoll") ?? {}).map(([k, v]) => `${k}:${typeof v}`);
    const KEY = "CAIRN.RestRollUp";
    const orig = foundry.utils.getProperty(game.i18n.translations, KEY);
    foundry.utils.setProperty(game.i18n.translations, KEY, "ZZ {rolled} of {faces}");
    await ui.chat.updateMessage(high);
    await sleep(300);
    out.rebuilt = document.querySelector(`[data-message-id="${high.id}"] .rest-roll-line`)?.textContent?.trim() ?? null;
    foundry.utils.setProperty(game.i18n.translations, KEY, orig);
    await ui.chat.updateMessage(high);
    await sleep(300);
    out.restored = document.querySelector(`[data-message-id="${high.id}"] .rest-roll-line`)?.textContent?.trim() ?? null;

    /* ---- 15. a Private GM Roll ----------------------------------------- */
    // v14: the chat-controls dropdown is `core.messageMode` ("public" / "gm" /
    // "blind" / "self"); `core.rollMode` and its "gmroll" values are a
    // deprecated alias that `Roll#toMessage` no longer reads (roll.mjs:926-932,
    // game.mjs:1244-1256). A probe that set the old key saw a public card.
    const modeWas = game.settings.get("core", "messageMode");
    await game.settings.set("core", "messageMode", "gm");
    try {
      out.private = await restUnder(0.0001, { "system.hp.value": 2, "system.hp.max": 6 });
      out.privId = out.private.card?.id ?? null;
      out.privWhisper = [...(game.messages.get(out.privId)?.whisper ?? [])];
    } finally {
      await game.settings.set("core", "messageMode", modeWas);
    }

    await game.settings.set(NS, "crawler-combat-mode", false);
    return out;
  }));

  // 15, the player's half: Alice's client renders the private card.
  if (r?.privId) {
    priv.gm = await page.evaluate((id) => {
      const el = document.querySelector(`[data-message-id="${id}"]`);
      return { line: !!el?.querySelector(".rest-roll-line"), total: !!el?.querySelector(".dice-total"),
        text: el?.querySelector(".message-content")?.textContent?.replace(/\s+/g, " ").trim() ?? null };
    }, r.privId);
    alicePage = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
    await joinAs(alicePage, "Alice");
    priv.alice = await alicePage.evaluate(async (id) => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      for (let i = 0; i < 40 && !document.querySelector(`[data-message-id="${id}"]`); i++) await sleep(150);
      const el = document.querySelector(`[data-message-id="${id}"]`);
      return { present: !!el, line: !!el?.querySelector(".rest-roll-line"), total: !!el?.querySelector(".dice-total"),
        text: el?.querySelector(".message-content")?.textContent?.replace(/\s+/g, " ").trim() ?? null };
    }, r.privId);
  }
} finally {
  try {
    await page.evaluate(async ({ ids, msgs, rollMode }) => {
      for (const id of ids ?? []) await game.actors.get(id)?.delete();
      for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ Rest "))) await a.delete();
      for (const id of msgs ?? []) await game.messages.get(id)?.delete();
      if (rollMode) await game.settings.set("core", "messageMode", rollMode);
    }, { ids: r?.made ?? [], msgs: [...(r?.msgs ?? []), r?.privId].filter(Boolean), rollMode: rollModeWas });
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
  has(r.declined.shape?.text, S.restTip)
    ? ok("...under Cairn's own Rest prose, which is kept")
    : fail("the confirm lost Cairn's RestTip prose");
  r.declined.uses === 3 && r.declined.hp === 2
    ? ok("No spends nothing: uses 3, HP 2")
    : fail(`No spent something: uses ${r.declined.uses}, hp ${r.declined.hp}`);

  // 3
  r.rested.uses === 2 && r.rested.qty === 1 && r.rested.hp === 6
    ? ok("Yes: one use gone (3 -> 2) and HP at its maximum (6) — the hack off, so a full restore")
    : fail(`Yes: ${JSON.stringify(r.rested)} — want uses 2, qty 1, hp 6`);

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
  r.npc.hp === 6
    ? ok("...and restores HP to its maximum with no rations on the sheet")
    : fail(`npc hp ${r.npc.hp}, want 6`);

  // 9
  const pcTip = r.declined.shape?.tooltip ?? "";
  pcTip.startsWith(S.restTip) && pcTip.endsWith(S.rationTip) && pcTip.length > S.restTip.length
    ? ok(`the PC Rest tooltip is Cairn's prose followed by the house rule ("${S.rationTip}")`)
    : fail(`pc tooltip: ${JSON.stringify(pcTip)}`);
  r.npc.shape?.tooltip === S.restTip
    ? ok("...and the NPC's tooltip is Cairn's prose alone")
    : fail(`npc tooltip: ${JSON.stringify(r.npc.shape?.tooltip)}`);

  // 10
  const H = r.crawlHigh;
  H.hp === 6 && H.uses === 2
    ? ok("CRAWLER, pinned high: the d6 rolled 6, HP 2 -> 6, one use spent")
    : fail(`crawl high: hp ${H.hp} uses ${H.uses} — want 6 and 2`);
  H.card && H.card.isRoll && H.card.formula === "1d6"
    && JSON.stringify(H.card.flag) === JSON.stringify({ faces: 6, rolled: 6, before: 2, after: 6 })
    ? ok("...a ROLL message posted, formula 1d6, flag {faces 6, rolled 6, before 2, after 6}")
    : fail(`crawl high card: ${JSON.stringify(H.card)}`);
  H.card?.line === H.expectLine && H.card?.flavor === S.rest
    ? ok(`...its line reads "${H.card.line}" under the flavor "${S.rest}"`)
    : fail(`crawl high line: ${JSON.stringify(H.card?.line)} flavor ${JSON.stringify(H.card?.flavor)}; wanted "${H.expectLine}"`);
  has(H.shape?.text, r.crawlerLine62)
    ? ok(`...and the confirm had said what was coming: "${r.crawlerLine62}"`)
    : fail(`crawler confirm line missing: ${JSON.stringify(H.shape?.text)}`);

  // 11
  const L = r.crawlLow;
  L.hp === 2 && L.uses === 2 && L.card?.line === L.expectLine
    && JSON.stringify(L.card?.flag) === JSON.stringify({ faces: 6, rolled: 1, before: 2, after: 2 })
    ? ok(`pinned low: the d6 rolled 1, HP stays 2, the ration is still spent, and the card says "${L.card.line}"`)
    : fail(`crawl low: ${JSON.stringify({ hp: L.hp, uses: L.uses, card: L.card })}; wanted "${L.expectLine}"`);

  // 12
  r.scar7.hp === 7 && r.scar7.card?.formula === "1d7" && r.scar7.card?.flag?.rolled === 7
    ? ok("a scarred maximum of 7 rolls 1d7 (no Dice So Nice model, a real Foundry die) and 7 beats 3")
    : fail(`scar 7: ${JSON.stringify({ hp: r.scar7.hp, card: r.scar7.card })}`);

  // 13
  r.max0.card === null && r.max0.hp === 0 && r.max0.uses === 2 && !has(r.max0.shape?.text, "d0")
    ? ok("a maximum of 0 takes the plain path: no roll card (1d0 would evaluate to 0 in silence), HP 0, ration spent, no d0 in the confirm")
    : fail(`max 0: ${JSON.stringify({ card: r.max0.card, hp: r.max0.hp, uses: r.max0.uses, text: r.max0.shape?.text })}`);

  // 14
  r.flagTypes.length === 4 && r.flagTypes.every((t) => t.endsWith(":number"))
    ? ok(`the flag is numbers only (${r.flagTypes.join(", ")}) — nothing stored can freeze a language`)
    : fail(`flag types: ${JSON.stringify(r.flagTypes)}`);
  r.rebuilt === "ZZ 6 of 6" && r.restored === H.expectLine
    ? ok("the line is REBUILT per viewer: a translation override in this client changed it, and restoring the key changed it back")
    : fail(`rebuild: overridden ${JSON.stringify(r.rebuilt)}, restored ${JSON.stringify(r.restored)}`);

  // 15
  priv.gm?.line && priv.gm?.total
    ? ok("a Private GM Roll: the Warden's own client shows the line and the die")
    : fail(`private, gm: ${JSON.stringify(priv.gm)}`);
  // Core's own private rendering keeps a `.dice-total` element with a
  // PLACEHOLDER in it ("???" / "?"), so the element's presence proves nothing;
  // what must be absent is OUR line and ANY number — the die, the HP values.
  priv.alice?.present && !priv.alice.line && !/\d/.test(priv.alice.text ?? "")
    ? ok(`...and Alice's client shows neither the line nor a single number — core's "rolled privately" stands (${JSON.stringify(priv.alice.text)})`)
    : fail(`private, alice: ${JSON.stringify(priv.alice)} — a rebuild without isContentVisible hands a player the die`);
  (r.privWhisper ?? []).length > 0
    ? ok("...the message being a whisper to the Warden (the precondition, so the leg cannot pass on a public card)")
    : fail("the private card was not whispered — the rollMode did not take");
}

if (errors.length) { failed = true; console.log("Console errors:\n" + errors.join("\n")); }
console.log(failed ? "\nrest e2e FAILED" : "\nrest e2e passed");
if (alicePage) await alicePage.context().close().catch(() => {});
await browser.close();
process.exit(failed ? 1 : 0);

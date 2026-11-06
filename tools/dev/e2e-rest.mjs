#!/usr/bin/env node
/**
 * Rest follows Cairn as written.
 *
 *   npm run dev:rest
 *
 * "Resting for a few moments and having a drink of water restores lost HP but
 * may leave the party exposed" (Cairn 2e, Core Rules, Healing & Recovery). A
 * Rest costs nothing and restores Hit Protection to its maximum, and a player
 * character's Rest is the NPC's Rest: the same confirm (Cairn's own `RestTip`,
 * then the question — an NPC gets its own `RestConfirmNpc` wording), the same
 * tooltip, the same write.
 *
 * From 0.1.24 a player character's Rest ATE A RATION and refused without one —
 * a house rule of 2026-10-03, removed by the user on 2026-11-06 to follow the
 * rules as written. Legs 1-3 are what hold that removal.
 *
 * Every leg drives the REAL button and answers the REAL dialog: the refusal and
 * the write behind the confirm are exactly what a handler called directly would
 * skip. Settings ride `withSettings` so the restore runs in Node, not in-page.
 *
 * Legs:
 *   1. a PC with NO rations → the confirm (Yes/No, Cairn's prose, the PC
 *      question), not a refusal; No writes nothing.
 *   2. ...Yes → HP at its maximum, still no items.
 *   3. a PC WITH Rations → Yes restores HP and the ration is untouched.
 *   4. Escape → nothing.
 *   5. an NPC → the same confirm with the NPC's question; HP to max.
 *   6. the PC and NPC tooltips are both Cairn's prose, identical.
 *   7. a Deprived PC's Rest button is disabled.
 *
 * Red-first (proven 2026-11-06 against the ration-eating build): legs 1-3 and 6
 * red — the refusal prompt has no Yes, a Yes ate a use, the tooltip was
 * RestRationTip.
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
    const hp = (a) => a._source.system.hp.value;

    /**
     * Press the REAL Rest button on an actor's sheet and answer the dialog that
     * appears: "yes" / "no" clicks that button, null dismisses it. The dialog is
     * found as the one that was NOT already present (a closing DialogV2 lingers
     * with dead listeners), and the helper waits for it to LEAVE the DOM before
     * returning — the lingering-dialog trap.
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
        if (!b) {
          // Close whatever came instead, so the next leg starts clean.
          dlg.querySelector('button[data-action="ok"], [data-action="close"]')?.click();
          const t1 = Date.now();
          while (dlg.isConnected && Date.now() - t1 < 5000) await sleep(100);
          await actor.sheet.close();
          return { ...shape, err: `no "${answer}" button` };
        }
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

    out.strings = {
      restTip: game.i18n.localize("CAIRN.RestTip"),
      pcQ: game.i18n.localize("CAIRN.RestConfirm"),
      npcQ: game.i18n.localize("CAIRN.RestConfirmNpc"),
    };

    /* ---- 1. no rations: the confirm, and No ---------------------------- */
    out.declined = { shape: await pressRest(pc, "no"), hp: hp(pc), items: pc.items.size };

    /* ---- 2. no rations: Yes -------------------------------------------- */
    out.rested = { shape: await pressRest(pc, "yes") };
    await until(() => hp(pc) === 6);
    Object.assign(out.rested, { hp: hp(pc), items: pc.items.size });

    /* ---- 3. with Rations: nothing is eaten ----------------------------- */
    const [ration] = await pc.createEmbeddedDocuments("Item",
      [{ name: "Rations", type: "item", system: { uses: { value: 3, max: 3 }, quantity: 1 } }],
      { abNoStatusCard: true });
    await pc.update({ "system.hp.value": 1 }, { abNoStatusCard: true });
    out.withRations = { shape: await pressRest(pc, "yes") };
    await until(() => hp(pc) === 6);
    await sleep(400);   // a ration write, if one came, lands with the HP
    const live = pc.items.get(ration.id);
    Object.assign(out.withRations, { hp: hp(pc),
      uses: live?._source.system.uses?.value ?? null, qty: live?._source.system.quantity ?? null });

    /* ---- 4. Escape ----------------------------------------------------- */
    await pc.update({ "system.hp.value": 1 }, { abNoStatusCard: true });
    out.escaped = { shape: await pressRest(pc, null), hp: hp(pc) };

    /* ---- 5. an NPC ----------------------------------------------------- */
    const npc = await Cls.create({ name: "ZZ Rest NPC", type: "npc",
      system: { role: "hireling", hp: { value: 2, max: 6 } } }, { abNoStatusCard: true });
    out.made.push(npc.id);
    out.npc = { shape: await pressRest(npc, "yes") };
    await until(() => hp(npc) === 6);
    out.npc.hp = hp(npc);

    /* ---- 7. Deprived disables the button ------------------------------- */
    await pc.update({ "system.deprived": true }, { abNoStatusCard: true });
    await pc.sheet.render(true);
    await until(() => pc.sheet.element?.querySelector?.("#rest-button")?.disabled === true);
    out.deprivedDisabled = pc.sheet.element?.querySelector?.("#rest-button")?.disabled ?? null;
    await pc.sheet.close();
    return out;
  }));
} catch (e) {
  fail(`the in-page run threw: ${e.message}`);
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
  const isConfirm = (shape, q) =>
    shape?.yes && shape?.no && !shape?.okBtn && has(shape?.text, S.restTip) && has(shape?.text, q);

  // 1
  isConfirm(r.declined.shape, S.pcQ)
    ? ok(`no rations: the Rest button opens the confirm — Cairn's prose, then "${S.pcQ}" — not a refusal`)
    : fail(`no rations: ${JSON.stringify(r.declined.shape)}; wanted Yes/No, "${S.restTip}" and "${S.pcQ}"`);
  r.declined.hp === 2 && r.declined.items === 0
    ? ok("...and No writes nothing: HP 2, no items")
    : fail(`No wrote something: hp ${r.declined.hp}, items ${r.declined.items}`);

  // 2
  !r.rested.shape?.err && r.rested.hp === 6 && r.rested.items === 0
    ? ok("...and Yes restores HP to its maximum (2 -> 6) with no rations on the sheet")
    : fail(`no rations, Yes: ${JSON.stringify(r.rested)} — want hp 6, items 0`);

  // 3
  r.withRations.hp === 6 && r.withRations.uses === 3 && r.withRations.qty === 1
    ? ok("with Rations on the sheet a Rest restores HP and eats nothing: uses 3 of 3, quantity 1")
    : fail(`with Rations: ${JSON.stringify(r.withRations)} — want hp 6, uses 3, qty 1`);

  // 4
  r.escaped.hp === 1
    ? ok("Escape (the window's close) heals nothing")
    : fail(`Escape: ${JSON.stringify(r.escaped)} — want hp 1`);

  // 5
  isConfirm(r.npc.shape, S.npcQ) && r.npc.hp === 6
    ? ok(`an NPC's Rest is the same confirm with its own question ("${S.npcQ}"), HP to its maximum`)
    : fail(`npc: ${JSON.stringify(r.npc)}`);

  // 6
  r.declined.shape?.tooltip === S.restTip && r.npc.shape?.tooltip === S.restTip
    ? ok("the PC and NPC Rest tooltips are both Cairn's prose, identical")
    : fail(`tooltips: pc ${JSON.stringify(r.declined.shape?.tooltip)}, npc ${JSON.stringify(r.npc.shape?.tooltip)} — want "${S.restTip}"`);

  // 7
  r.deprivedDisabled === true
    ? ok("a Deprived PC's Rest button is disabled")
    : fail(`deprived: the Rest button's disabled is ${JSON.stringify(r.deprivedDisabled)}`);
}

if (errors.length) { failed = true; console.log("Console errors:\n" + errors.join("\n")); }
console.log(failed ? "\nrest e2e FAILED" : "\nrest e2e passed");
await browser.close();
process.exit(failed ? 1 : 0);

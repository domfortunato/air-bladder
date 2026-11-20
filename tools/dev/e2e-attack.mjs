#!/usr/bin/env node
/**
 * The Attack window (2026-11-19, user ask, after Base Knavery's).
 *
 *   npm run dev:attack
 *
 * The character sheet's Attack (the rail's red burst and page 1's button under
 * Die of Fate) is for EVERY attack, not the improvised one alone. One window
 * (askAttack, module/utils.js) asks Cairn's three questions: who is attacked,
 * with what, and whether the roll is standard, impaired or enhanced. What this
 * holds:
 *
 *   1. WHO: the viewed scene's tokens, the attacker's own left out; the user's
 *      one current target comes preselected;
 *   2. WITH WHAT: the EQUIPPED items that roll damage, then the improvised
 *      attack; an unequipped weapon is not offered;
 *   3. HOW, for a weapon: Standard (its own die) / Impaired / Enhanced, and no
 *      Roll Damage;
 *   4. Impaired on the weapon posts the damage card with a d4, the weapon named,
 *      and the chosen target on its Apply button;
 *   5. the improvised choice keeps the 2026-10-02 ruling: its two fields show,
 *      the three quality buttons give way to Roll Damage alone, and "No one in
 *      particular" posts a card with the typed die, unarmed, and no target;
 *   6. the window remembers the attack last made with it;
 *   7. PANIC (use-panic on, the character panicked) offers only Impaired for a
 *      weapon, says why, and Impaired rolls the d4;
 *   8. a REAL Enter (Playwright's keyboard, not requestSubmit(), whose submit
 *      event names no button) in the improvised description rolls the typed
 *      die: implicit submission presses the first submit button on offer.
 *   9. (2026-11-20, user ask) a Cancel button closes the window and posts
 *      nothing; it stands last in the footer, so Enter never reaches it.
 *
 * use-panic is shadowed IN-PAGE for leg 7 only (never written), and both it and
 * the panicked flag are put back in its finally. Red-first: before the window the burst
 * opens the Improvised Attack dialog, and every leg fails.
 */
import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const FIXTURE = "attack-window";
const browser = await chromium.launch();
watchdog(300000, "attack probe", async () => { try { await browser.close(); } catch { /* gone */ } });
const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(gm);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

let r = null;
const cleanup = async () => {
  try {
    await gm.evaluate(async (fixture) => {
      for (const d of foundry.applications.instances.values()) {
        if (d.element?.classList?.contains("cairn-attack-dialog")) await d.close();
      }
      // RELEASE THE TARGET FIRST, before anything is deleted. Core's
      // TokenLayer#animateTargets redraws the arrows on every game.user.targets
      // token each frame (tokens.mjs), and a scene deleted under a targeted token
      // leaves a frame drawing on a half-destroyed one: "Cannot read properties
      // of undefined (reading 'clear')" at Token._drawTargetArrows (fleet
      // 20261119T225116Z, every check green, the console error failing the run).
      // The targeting in setup waits for a drawn token for the same reason.
      for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false });
      await new Promise((res) => setTimeout(res, 200));
      const actors = game.actors.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture);
      const ids = new Set(actors.map((a) => a.id));
      for (const m of game.messages.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture || ids.has(x.speaker?.actor))) {
        await m.delete();
      }
      for (const a of actors) {
        await a.sheet?.close();
        await a.delete();
      }
      for (const sc of game.scenes.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) await sc.delete();
    }, FIXTURE);
  } catch (e) {
    console.error(`  note  cleanup: ${e.message}`);
  }
};

try {
  await joinAsGM(gm);
  await dismissChrome(gm);
  await cleanup();

  r = await gm.evaluate(async (fixture) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!(await fn()) && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = {};
    const Actor = getDocumentClass("Actor");

    const pc = await Actor.create({ name: "ZZ Attack PC", type: "character", flags }, { abNoStatusCard: true });
    const foe = await Actor.create({ name: "ZZ Attack Foe", type: "npc", system: { role: "monster" }, flags }, { abNoStatusCard: true });
    await pc.createEmbeddedDocuments("Item", [
      { name: "ZZ Blade", type: "item", system: { equipped: true, damageFormula: "1d6" } },
      { name: "ZZ Club", type: "item", system: { equipped: false, damageFormula: "1d8" } },
    ]);
    const blade = pc.items.find((i) => i.name === "ZZ Blade");

    const scene = await Scene.create({ name: "ZZ Attack Scene", width: 1000, height: 1000, flags });
    await scene.view();
    await until(() => canvas.ready && canvas.scene?.id === scene.id);
    // One create each: a batch comes back in completion order, not as sent.
    const [pcTok] = await scene.createEmbeddedDocuments("Token", [await pc.getTokenDocument({ x: 100, y: 100 })]);
    const [foeTok] = await scene.createEmbeddedDocuments("Token", [await foe.getTokenDocument({ x: 300, y: 100 })]);
    // Target only a DRAWN token. The placeable joins the layer before its async
    // _draw reaches `this.targetArrows ||= ...` (token.mjs), and core's
    // TokenLayer#animateTargets draws arrows on every game.user.targets token each
    // frame, so a token targeted in that gap throws "Cannot read properties of
    // undefined (reading 'clear')" at Token._drawTargetArrows (fleet
    // 20261119T232257Z: every check green, the console error failing the run,
    // after the cleanup's release-first fix). PlaceableObject#drawn is private;
    // targetArrows is the first thing _draw sets that this needs.
    await until(() => canvas.tokens.get(foeTok.id)?.targetArrows);
    await sleep(100);
    canvas.tokens.get(foeTok.id).setTarget(true, { releaseOthers: true });
    out.ids = { pcTok: pcTok.id, foeTok: foeTok.id, blade: blade.id };

    const sheet = pc.sheet;
    await sheet.render(true);
    await until(() => sheet.element?.querySelector?.('[data-action="attack"]'));
    await sleep(300);

    const openWindow = async () => {
      const stale = new Set(document.querySelectorAll(".cairn-attack-dialog"));
      sheet.element.querySelector('.cairn-vital-buttons [data-action="attack"]')?.click();
      let dlg = null;
      await until(() => (dlg = [...document.querySelectorAll(".cairn-attack-dialog")].find((d) => !stale.has(d))));
      await sleep(200);
      return dlg;
    };
    const shown = (dlg) => [...dlg.querySelectorAll("footer button")].filter((b) => !b.hidden && b.getBoundingClientRect().height > 0)
      .map((b) => b.dataset.action);
    const newMessage = async (before) => {
      let m = null;
      await until(() => (m = game.messages.contents.find((x) => !before.has(x.id) && x.speaker?.actor === pc.id)));
      if (m) await m.setFlag("air-bladder", "probeFixture", fixture);
      return m;
    };
    const card = (m) => {
      const div = document.createElement("div");
      div.innerHTML = m?.flavor ?? "";
      return {
        weapon: div.querySelector(".dmg-label")?.dataset.weapon ?? null,
        unarmed: div.querySelector(".dmg-label")?.dataset.unarmed === "1",
        targets: div.querySelector(".apply-dmg")?.dataset.targets ?? null,
        faces: m?.rolls?.[0]?.dice?.[0]?.faces ?? null,
      };
    };

    /* ---- 1-3. the window, for a weapon -------------------------------- */
    let dlg = await openWindow();
    out.window = dlg ? {
      options: [...dlg.querySelectorAll('select[name="target"] option')].map((o) => o.value),
      selected: dlg.querySelector('select[name="target"]')?.value ?? null,
      weapons: [...dlg.querySelectorAll('input[name="weapon"]')].map((i) => i.value),
      checked: dlg.querySelector('input[name="weapon"]:checked')?.value ?? null,
      buttons: shown(dlg),
      standardLabel: dlg.querySelector('footer button[data-action="standard"]')?.textContent.trim() ?? null,
      improvisedHidden: dlg.querySelector(".cairn-attack-improvised")?.hidden ?? null,
    } : null;

    /* ---- 4. Impaired on the weapon ------------------------------------ */
    if (dlg) {
      const before = new Set(game.messages.map((m) => m.id));
      dlg.querySelector('footer button[data-action="impaired"]').click();
      out.weaponCard = card(await newMessage(before));
    }

    /* ---- 5. the improvised attack, no target --------------------------- */
    dlg = await openWindow();
    if (dlg) {
      const impro = dlg.querySelector('input[name="weapon"][value="improvised"]');
      impro.checked = true;
      impro.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(150);
      out.improvised = { buttons: shown(dlg), fields: !dlg.querySelector(".cairn-attack-improvised")?.hidden };
      // Every field label sits on ONE line, and the two improvised inputs
      // share a left edge (user ask 2026-11-20: "What are you attacking
      // with?" broke onto two lines in the label column).
      const lineCount = (n) => {
        const cs = getComputedStyle(n);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        return Math.round(n.getBoundingClientRect().height / lh);
      };
      const inputs = [...dlg.querySelectorAll('.cairn-attack-improvised input[type="text"]')];
      out.improvisedLabels = {
        lines: Object.fromEntries([...dlg.querySelectorAll(".cairn-attack .form-group > label")]
          .map((n) => [n.textContent.trim(), lineCount(n)])),
        lefts: inputs.map((n) => Math.round(n.getBoundingClientRect().left)),
      };
      dlg.querySelector('input[name="description"]').value = "a rock";
      dlg.querySelector('input[name="formula"]').value = "1d6";
      dlg.querySelector('select[name="target"]').value = "";
      const before = new Set(game.messages.map((m) => m.id));
      dlg.querySelector('footer button[data-action="roll"]').click();
      out.improvisedCard = card(await newMessage(before));
    }

    /* ---- 6. it remembers the last attack ------------------------------- */
    dlg = await openWindow();
    out.remembered = dlg?.querySelector('input[name="weapon"]:checked')?.value ?? null;
    if (dlg) {
      dlg.querySelector('header [data-action="close"]')?.click();
      await until(() => !dlg.isConnected);
    }

    /* ---- 9. Cancel closes it and posts nothing -------------------------- */
    dlg = await openWindow();
    if (dlg) {
      const before = new Set(game.messages.map((m) => m.id));
      const cancel = dlg.querySelector('footer button[data-action="cancel"]');
      out.cancel = { present: !!cancel, last: !!cancel && [...dlg.querySelectorAll("footer button")].at(-1) === cancel };
      cancel?.click();
      await until(() => !dlg.isConnected, 3000);
      await sleep(500);
      out.cancel.closed = !dlg.isConnected;
      out.cancel.posted = game.messages.contents.filter((m) => !before.has(m.id) && m.speaker?.actor === pc.id).length;
      if (!out.cancel.closed) {
        dlg.querySelector('header [data-action="close"]')?.click();
        await until(() => !dlg.isConnected);
      }
    }

    /* ---- 7. panic: only Impaired, and Enter rolls it -------------------- */
    const origGet = game.settings.get;
    game.settings.get = function (ns, key, ...rest) {
      // A DOCUMENT request is never shadowed (review #27).
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, ns, key, ...rest);
      if (ns === "air-bladder" && key === "use-panic") return true;
      return origGet.call(this, ns, key, ...rest);
    };
    try {
      await pc.update({ "system.panicked": true }, { abNoStatusCard: true });
      await sleep(300);
      dlg = await openWindow();
      if (dlg) {
        // The weapon again (the window remembers the improvised attack from leg 5).
        const pick = dlg.querySelector(`input[name="weapon"][value="${out.ids.blade}"]`);
        pick.checked = true;
        pick.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(150);
        out.panic = { buttons: shown(dlg), note: !!dlg.querySelector(".cairn-attack-panic:not([hidden])"),
          checked: dlg.querySelector('input[name="weapon"]:checked')?.value ?? null };
        const before = new Set(game.messages.map((m) => m.id));
        dlg.querySelector('footer button[data-action="impaired"]').click();
        out.panicCard = card(await newMessage(before));
      }
    } finally {
      game.settings.get = origGet;
      await pc.update({ "system.panicked": false }, { abNoStatusCard: true });
    }

    /* ---- 8 (set up): the improvised attack, ready for a real Enter ------ */
    dlg = await openWindow();
    if (dlg) {
      const impro = dlg.querySelector('input[name="weapon"][value="improvised"]');
      impro.checked = true;
      impro.dispatchEvent(new Event("change", { bubbles: true }));
      dlg.querySelector('input[name="formula"]').value = "1d8";
      dlg.querySelector('input[name="description"]').value = "a stool";
      window.__abAttackBefore = game.messages.map((m) => m.id);
      out.enterReady = true;
    }
    out.pcId = pc.id;
    return out;
  }, FIXTURE);

  /* ---- 8. a real Enter in the improvised description ------------------- */
  if (r?.enterReady) {
    await gm.locator('.cairn-attack-dialog input[name="description"]').press("Enter");
    r.enterCard = await gm.evaluate(async ({ pcId, fixture }) => {
      const before = new Set(window.__abAttackBefore ?? []);
      let m = null;
      for (let i = 0; i < 50 && !(m = game.messages.contents.find((x) => !before.has(x.id) && x.speaker?.actor === pcId)); i++) {
        await new Promise((res) => setTimeout(res, 100));
      }
      if (m) await m.setFlag("air-bladder", "probeFixture", fixture);
      const div = document.createElement("div");
      div.innerHTML = m?.flavor ?? "";
      await game.actors.get(pcId)?.sheet?.close();
      return { faces: m?.rolls?.[0]?.dice?.[0]?.faces ?? null, weapon: div.querySelector(".dmg-label")?.dataset.weapon ?? null };
    }, { pcId: r.pcId, fixture: FIXTURE });
  }
} catch (e) {
  fail(`the run threw: ${e.message}`);
} finally {
  await cleanup();
}

/* ---------------------------------- assertions ----------------------------- */
if (!r) fail("the in-page run returned nothing");
else if (!r.window) fail("page 1's Attack button opened no Attack window");
else {
  const w = r.window;
  // 1
  w.options.includes(r.ids.foeTok) && !w.options.includes(r.ids.pcTok) && w.options.includes("") && w.selected === r.ids.foeTok
    ? ok("Who: the scene's tokens, the attacker's own left out, the current target preselected, and \"no one\" on offer")
    : fail(`target list: ${JSON.stringify({ options: w.options, selected: w.selected, ids: r.ids })}`);
  // 2
  JSON.stringify(w.weapons) === JSON.stringify([r.ids.blade, "improvised"]) && w.checked === r.ids.blade
    ? ok("With what: the equipped weapon, then the improvised attack; the unequipped one is not offered")
    : fail(`weapons: ${JSON.stringify(w.weapons)} checked ${w.checked}`);
  // 3
  JSON.stringify(w.buttons) === JSON.stringify(["standard", "impaired", "enhanced", "cancel"]) && /1d6/.test(w.standardLabel ?? "") && w.improvisedHidden
    ? ok(`How, for a weapon: Standard / Impaired / Enhanced, Standard naming its die ("${w.standardLabel}")`)
    : fail(`weapon buttons: ${JSON.stringify(w.buttons)}, standard "${w.standardLabel}", improvised fields hidden ${w.improvisedHidden}`);
  // 4
  const c = r.weaponCard ?? {};
  c.faces === 4 && c.weapon === "ZZ Blade" && c.targets === r.ids.foeTok
    ? ok("Impaired posts the damage card: a d4, the weapon named, the chosen target on Apply")
    : fail(`weapon card: ${JSON.stringify(c)}`);
  // 5
  const i = r.improvised ?? {}, ic = r.improvisedCard ?? {};
  JSON.stringify(i.buttons) === JSON.stringify(["roll", "cancel"]) && i.fields
    ? ok("the improvised choice shows its two fields and Roll Damage alone (the 10-02 ruling)")
    : fail(`improvised window: ${JSON.stringify(i)}`);
  const il = r.improvisedLabels ?? {};
  const labelLines = Object.values(il.lines ?? {});
  labelLines.length >= 3 && labelLines.every((n) => n === 1) && il.lefts?.length === 2 && il.lefts[0] === il.lefts[1]
    ? ok(`every label in the window sits on one line (${Object.keys(il.lines).join(" / ")}), the improvised inputs aligned`)
    : fail(`Attack window labels: ${JSON.stringify(il)}`);
  ic.faces === 6 && ic.weapon === "a rock" && ic.unarmed && ic.targets === null
    ? ok("...and posts the typed die, unarmed, with no target when \"no one\" is chosen")
    : fail(`improvised card: ${JSON.stringify(ic)}`);
  // 6
  r.remembered === "improvised"
    ? ok("the window remembers the attack last made with it")
    : fail(`remembered ${JSON.stringify(r.remembered)}`);
  // 7
  const p = r.panic ?? {}, pc = r.panicCard ?? {};
  JSON.stringify(p.buttons) === JSON.stringify(["impaired", "cancel"]) && p.note && p.checked === r.ids.blade
    ? ok("panicked, a weapon is offered Impaired alone, and the window says why")
    : fail(`panic window: ${JSON.stringify(p)}`);
  pc.faces === 4
    ? ok("...and Impaired rolls the d4")
    : fail(`panic card: ${JSON.stringify(pc)}`);
  // 9
  const k = r.cancel ?? {};
  k.present && k.last && k.closed && k.posted === 0
    ? ok("Cancel stands last in the footer, closes the window and posts nothing")
    : fail(`Cancel: ${JSON.stringify(k)}`);
  // 8
  const e = r.enterCard ?? {};
  e.faces === 8 && e.weapon === "a stool"
    ? ok("a real Enter in the improvised description rolls the typed die (Roll Damage is the first submit on offer)")
    : fail(`Enter in the improvised field: ${JSON.stringify(e)}`);
}
if (errors.length) { failed = true; console.log("Console errors:\n" + errors.join("\n")); }
console.log(failed ? "\nattack e2e FAILED" : "\nattack e2e passed");
await browser.close();
process.exit(failed ? 1 : 0);

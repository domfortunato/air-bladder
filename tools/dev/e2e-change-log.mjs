/**
 * dev:changelog — the manual-change chat audit log (Plan A item 6).
 *
 * TWO clients (GM + Alice), because the feature is per-user three ways at once:
 * the one-poster gate is invisible with a single client (every client posts,
 * one browser shows one copy), the whisper audience needs a NON-observer to
 * prove absence, and a player edit must post from the PLAYER's client.
 *
 * Legs:
 *   field seam  — gold / STR value+max batch / trait / panicked / scar /
 *                 feature add+remove / rest-shaped HP write, each ONE card
 *   item seam   — plain item add + remove, Fatigue add + remove (distinct wording)
 *   item update seam — a uses tick via the REAL − button posts the whole-line
 *                 uses line; the rollover click (uses cross zero on a stack)
 *                 posts ONE card carrying quantity AND uses lines (the
 *                 handler's one-write merge, review #13 #20+#21); a flagged
 *                 quantity write and a rename post nothing (machinery stays
 *                 silent; renames are off the ledger by ruling)
 *   suppression — a flagged update posts nothing; regenerateNpc (the real
 *                 machinery path: deleteAll + create + update) posts nothing.
 *                 The DAMAGE path is not driven here: its writes carry
 *                 abNoStatusCard at source (damage.js:125,149,487 — the same
 *                 flag this probe proves suppresses), and clicking the real
 *                 Apply button is dev:enc-damage / dev:hazard territory.
 *   action header — Rest and Restore, driven through the REAL button and
 *                 confirm dialog, name themselves on the card; a hand edit
 *                 stays anonymous; a non-whitelisted key renders no header
 *   whisper look — the rendered tile wears the system's warm tint + teal
 *                 stripe (cairn.css .chat-message.whisper), not core lavender
 *   audience    — Alice sees the card for HER actor, not the hidden actor's;
 *                 whisper ids are exactly the observers + Warden
 *   one-poster  — with both clients connected, exactly ONE card per change
 *   setting off — the change-log setting silences everything, live
 *
 * World state: creates three actors (witness character owned by Alice, a
 * hidden character, a throwaway npc) and deletes them plus every change-log
 * card in a Node-level finally; settings ride withSettings.
 */
import { chromium } from "playwright";
import {
  FOUNDRY_URL, VIEWPORT, joinAsGM, joinAs, watchdog, watchErrors, withSettings,
} from "./lib.mjs";

const dog = watchdog(300000, "dev:changelog");

const results = [];
const leg = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/** Poll (on whichever page) for change-log cards newer than `since` ids. */
const logsSince = (page, since, { expectNone = false } = {}) =>
  page.evaluate(async ({ since, expectNone }) => {
    const isLog = (m) => (m.content ?? "").includes('class="change-log"');
    const fresh = () => game.messages.contents
      .filter((m) => !since.includes(m.id) && isLog(m))
      .map((m) => ({
        id: m.id,
        content: m.content,
        whisper: [...(m.whisper ?? [])],
        items: (m.content.match(/<li>/g) ?? []).length,
      }));
    const t0 = Date.now();
    // An expect-none wait is a fixed window — there is no event that says
    // "nothing is coming"; an expect-some poll returns on the first arrival.
    for (;;) {
      const got = fresh();
      if (!expectNone && got.length) { await new Promise((r) => setTimeout(r, 300)); return fresh(); }
      if (Date.now() - t0 > (expectNone ? 1500 : 10000)) return got;
      await new Promise((r) => setTimeout(r, 200));
    }
  }, { since, expectNone });

const messageIds = (page) => page.evaluate(() => game.messages.contents.map((m) => m.id));

const run = async () => {
  const browser = await chromium.launch();
  const gmCtx = await browser.newContext({ viewport: VIEWPORT });
  const aliceCtx = await browser.newContext({ viewport: VIEWPORT });
  const gm = await gmCtx.newPage();
  const alice = await aliceCtx.newPage();
  const gmErrors = watchErrors(gm);
  const aliceErrors = watchErrors(alice);

  let created = { witness: null, hidden: null, npc: null };
  const preRunMessages = [];

  try {
    await joinAsGM(gm);
    preRunMessages.push(...await messageIds(gm));

    await withSettings(gm, async () => {
      // The feature must be ON regardless of what the dev world was left at.
      await gm.evaluate(() => game.settings.set("air-bladder", "change-log", true));

      created = await gm.evaluate(async () => {
        const Cls = getDocumentClass("Actor");
        const aliceId = game.users.getName("Alice")?.id;
        if (!aliceId) throw new Error("no Alice user — run `npm run dev:players` first");
        const witness = await Cls.create({
          name: "ChangeLog Witness", type: "character",
          ownership: { default: 0, [aliceId]: 3 },
          system: { gold: 50, hp: { value: 2, max: 4 } },
        });
        const hidden = await Cls.create({
          name: "ChangeLog Hidden", type: "character",
          ownership: { default: 0 },
          system: { gold: 10 },
        });
        const npc = await Cls.create({
          name: "ChangeLog Regen NPC", type: "npc",
          ownership: { default: 0 },
        });
        return { witness: witness.id, hidden: hidden.id, npc: npc.id, aliceId, gmId: game.user.id };
      });

      await joinAs(alice, "Alice");

      // PRECONDITION — the one-poster gate is per acting USER, and every
      // connected client of that user posts: a second session of this same
      // Gamemaster (another tab, another browser) doubles every GM-driven
      // card, which reds half the legs below with a misleading "got 2".
      // Detect it with a canary write and refuse the run with the real
      // diagnosis instead (seen live 2026-08-08: the user's own Chrome and
      // Brave sessions on :30000 while a probe ran).
      {
        const canarySince = await messageIds(gm);
        await gm.evaluate((id) => game.actors.get(id).update({ "system.gold": 51 }), created.witness);
        const canary = await logsSince(gm, canarySince);
        if (canary.length > 1) throw new Error(
          `PRECONDITION: ${canary.length} cards for one GM edit — another client of this `
          + "Gamemaster user is connected (another tab or browser on :30000). Close it and re-run.");
      }
      // The SAME canary for the acting player: the GM check above stayed
      // green on 2026-08-08 while every Alice-driven leg redded "got 3" —
      // the user's two browser tabs were joined as ALICE, and the gate is
      // per acting user, whoever that is. One Alice edit, same refusal.
      {
        const canarySince = await messageIds(gm);
        await alice.evaluate((id) => game.actors.get(id).update({ "system.gold": 52 }), created.witness);
        const canary = await logsSince(gm, canarySince);
        if (canary.length > 1) throw new Error(
          `PRECONDITION: ${canary.length} cards for one Alice edit — another client of the `
          + "Alice user is connected (another tab or browser on :30000). Close it and re-run.");
      }

      // ---- field seam + one-poster + audience (positive) -------------------
      let since = await messageIds(gm);
      await leg("gold edit by Alice → one whispered card naming her", async () => {
        await alice.evaluate((id) => game.actors.get(id).update({ "system.gold": 55 }), created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected exactly 1 card, got ${logs.length} (one-poster gate)`);
        assert(logs[0].content.includes("55"), "card does not show the new gold value");
        assert(logs[0].content.includes("Alice"), "card does not name the acting user");
        assert(logs[0].whisper.length > 0, "card is public — the ledger must whisper");
        const w = new Set(logs[0].whisper);
        assert(w.has(created.gmId) && w.has(created.aliceId),
          "whisper list is missing the Warden or the owner");
        const aliceView = await alice.evaluate((mid) => {
          const m = game.messages.get(mid);
          return m ? m.visible : "absent";
        }, logs[0].id);
        assert(aliceView === true, `owner cannot see her own actor's card (${aliceView})`);
      });

      since = await messageIds(gm);
      await leg("STR value+max in one update → one card, two lines", async () => {
        await gm.evaluate((id) => game.actors.get(id).update({
          "system.abilities.STR.value": 8, "system.abilities.STR.max": 12,
        }), created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected 1 card, got ${logs.length}`);
        assert(logs[0].items === 2, `expected 2 lines, got ${logs[0].items}`);
      });

      since = await messageIds(gm);
      await leg("trait edit → line shows the change", async () => {
        await gm.evaluate((id) => game.actors.get(id).update({ "system.traits.hair": "Braided" }), created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1 && logs[0].content.includes("Braided"), "no trait line");
      });

      since = await messageIds(gm);
      await leg("panicked marked / cleared wording", async () => {
        await gm.evaluate((id) => game.actors.get(id).update({ "system.panicked": true }), created.witness);
        let logs = await logsSince(gm, since);
        assert(logs.length === 1 && /marked/i.test(logs[0].content), "no 'marked' line");
        since = await messageIds(gm);
        await gm.evaluate((id) => game.actors.get(id).update({ "system.panicked": false }), created.witness);
        logs = await logsSince(gm, since);
        assert(logs.length === 1 && /cleared/i.test(logs[0].content), "no 'cleared' line");
      });

      since = await messageIds(gm);
      await leg("scar add → named scar line", async () => {
        await gm.evaluate((id) => {
          const a = game.actors.get(id);
          return a.update({ "system.scars": [...(a.system.scars ?? []), "Nasty burn"] });
        }, created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1 && logs[0].content.includes("Nasty burn"), "no scar line");
      });

      since = await messageIds(gm);
      await leg("feature add then remove → one card each", async () => {
        await gm.evaluate((id) => game.actors.get(id).createOwnedFeature({ name: "Probe Feature", description: "" }), created.witness);
        let logs = await logsSince(gm, since);
        assert(logs.length === 1 && logs[0].content.includes("Probe Feature"), "no feature-added line");
        since = await messageIds(gm);
        await gm.evaluate((id) => {
          const a = game.actors.get(id);
          return a.update({ "system.features": (a.system.features ?? []).filter((f) => f.name !== "Probe Feature") });
        }, created.witness);
        logs = await logsSince(gm, since);
        assert(logs.length === 1 && /removed/i.test(logs[0].content), "no feature-removed line");
      });

      since = await messageIds(gm);
      await leg("rest-shaped HP write → one card, one line", async () => {
        await gm.evaluate((id) => {
          const a = game.actors.get(id);
          return a.update({ "system.hp.value": a.system.hp.max });
        }, created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1 && logs[0].items === 1, `expected 1 card / 1 line, got ${logs.length} / ${logs[0]?.items}`);
      });

      since = await messageIds(gm);
      await leg("encumbered actor's HP write logs STORED values", async () => {
        // Review #13 #1: _prepareCharacterData pins DERIVED hp.value to 0
        // while encumbered (actor.js livesByPlayerRules), and the ledger's
        // first shipping read the PREPARED document on both sides of the
        // diff — so a real write under encumbrance compared 0 → 0 and posted
        // NOTHING (observed live: a Rest took source HP 1 → 6, zero cards).
        // Both halves must read SOURCE. The in-page precondition checks are
        // what stop this leg passing vacuously on an un-encumbered witness.
        await gm.evaluate(async (id) => {
          const a = game.actors.get(id);
          await a.update({ "system.hp.value": 1 }, { abNoStatusCard: true });
          await a.createEmbeddedDocuments("Item",
            [{ name: "Probe Ballast", type: "item", system: { quantity: 20 } }],
            { abNoStatusCard: true });
          if (!a.system.encumbered) throw new Error("witness never became encumbered");
          if (a.system.hp.value !== 0) throw new Error(`derived HP is ${a.system.hp.value}, expected pinned 0`);
        }, created.witness);
        try {
          await gm.evaluate((id) => game.actors.get(id).update({ "system.hp.value": 3 }), created.witness);
          const logs = await logsSince(gm, since);
          assert(logs.length === 1,
            `expected 1 card, got ${logs.length} — a derived read diffs 0 → 0 and posts nothing`);
          const wantLine = await gm.evaluate(() => game.i18n.format("CAIRN.ChangeLog.Field", {
            label: game.i18n.localize("CAIRN.HitProtection"), from: "1", to: "3",
          }));
          assert(logs[0].content.includes(wantLine),
            `card lacks the stored-value line "${wantLine}"`);
        } finally {
          await gm.evaluate(async (id) => {
            const a = game.actors.get(id);
            const it = a.items.find((i) => i.name === "Probe Ballast");
            if (it) await a.deleteEmbeddedDocuments("Item", [it.id], { abNoStatusCard: true });
            await a.update({ "system.hp.value": a.system.hp.max }, { abNoStatusCard: true });
          }, created.witness);
        }
      });

      // ---- action headers (Rest / Restore name themselves) -----------------
      // Both legs drive the REAL button + confirm dialog on Alice's client:
      // the abChangeLogAction option lives in the sheet handler, so a leg
      // that called actor.update itself would stay green with the handler's
      // option removed — the two-layer Fatigue lesson.
      const clickThroughConfirm = (page, actorId, buttonSel) =>
        page.evaluate(async ({ id, sel }) => {
          const sheet = game.actors.get(id).sheet;
          await sheet.render(true);
          const t0 = Date.now();
          let btn;
          while (!(btn = sheet.element?.querySelector(sel))) {
            if (Date.now() - t0 > 5000) throw new Error(`${sel} never rendered`);
            await new Promise((r) => setTimeout(r, 100));
          }
          // A CLOSING DialogV2 lingers in the DOM with DEAD listeners, and a
          // click on a dead dialog's submit button is a NATIVE form submit —
          // a full page navigation that destroys the execution context (seen
          // live: the Restore leg's click found the closing Rest dialog).
          // Snapshot the dialogs already present and click only one that
          // appears AFTER this button press.
          const stale = new Set(document.querySelectorAll(".application.dialog"));
          btn.click();
          let dlg;
          while (!(dlg = [...document.querySelectorAll(".application.dialog")].find((d) => !stale.has(d)))) {
            if (Date.now() - t0 > 5000) throw new Error("confirm dialog never appeared");
            await new Promise((r) => setTimeout(r, 100));
          }
          dlg.querySelector("button[data-action='yes']").click();
        }, { id: actorId, sel: buttonSel });

      since = await messageIds(gm);
      await leg("Rest names itself on the card (real button flow)", async () => {
        await gm.evaluate((id) => game.actors.get(id).update(
          { "system.hp.value": 1 }, { abNoStatusCard: true }), created.witness);
        await clickThroughConfirm(alice, created.witness, "#rest-button");
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected 1 card, got ${logs.length}`);
        assert(logs[0].content.includes('class="change-log-action"'), "no action header on the Rest card");
        const restLabel = await gm.evaluate(() => game.i18n.localize("CAIRN.Rest"));
        assert(logs[0].content.includes(`>${restLabel}<`), `header does not read "${restLabel}"`);
        assert(logs[0].items === 1, `expected the HP line alone, got ${logs[0].items}`);
      });

      since = await messageIds(gm);
      await leg("Restore Abilities names itself on the card", async () => {
        await gm.evaluate((id) => game.actors.get(id).update(
          { "system.abilities.DEX.value": 4 }, { abNoStatusCard: true }), created.witness);
        await clickThroughConfirm(alice, created.witness, "#restore-abilities-button");
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected 1 card, got ${logs.length}`);
        const label = await gm.evaluate(() => game.i18n.localize("CAIRN.RestoreAbilities"));
        assert(logs[0].content.includes('class="change-log-action"') && logs[0].content.includes(`>${label}<`),
          `no "${label}" header on the Restore card`);
        assert(logs[0].items >= 1, "no ability lines on the Restore card");
        await alice.evaluate((id) => game.actors.get(id).sheet.close(), created.witness);
      });

      since = await messageIds(gm);
      await leg("a hand edit stays anonymous (no action header)", async () => {
        await alice.evaluate((id) => game.actors.get(id).update({ "system.gold": 62 }), created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected 1 card, got ${logs.length}`);
        assert(!logs[0].content.includes("change-log-action"),
          "a plain update grew an action header — the header must be earned");
      });

      since = await messageIds(gm);
      await leg("a non-whitelisted action key renders nothing", async () => {
        // CAIRN.Gold is a REAL i18n key that is not in AUDIT_ACTIONS. The Set
        // is ADVISORY — the acting client is trusted (review #13 ruling) —
        // but the header vocabulary must stay closed: an unlisted key renders
        // no header, which is what keeps free-typed prose off the card.
        await alice.evaluate((id) => game.actors.get(id).update(
          { "system.gold": 64 }, { abChangeLogAction: "CAIRN.Gold" }), created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected 1 card, got ${logs.length}`);
        assert(logs[0].content.includes("64"), "the gold line itself is missing");
        assert(!logs[0].content.includes("change-log-action"),
          "an unlisted key produced a header — the header vocabulary must stay closed");
      });

      // ---- whisper look ----------------------------------------------------
      since = await messageIds(gm);
      await leg("whisper tile wears the system tint + accent stripe", async () => {
        // Alice drives the edit: a single-session user posts exactly once even
        // if a stray second GM client is connected — the leg tests the CSS,
        // not the one-poster gate.
        await alice.evaluate((id) => game.actors.get(id).update({ "system.gold": 57 }), created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected 1 card, got ${logs.length}`);
        const style = await gm.evaluate(async (mid) => {
          const t0 = Date.now();
          let el;
          while (!(el = document.querySelector(`.chat-message[data-message-id="${mid}"]`))) {
            if (Date.now() - t0 > 5000) return { missing: true };
            await new Promise((r) => setTimeout(r, 100));
          }
          const cs = getComputedStyle(el);
          // Computed box-shadow/background colours come back as rgb(); the
          // tokens are authored as hex — compare in rgb space.
          const hexToRgb = (h) => {
            const n = parseInt(h.trim().slice(1), 16);
            return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
          };
          return {
            bg: cs.backgroundColor,
            shadow: cs.boxShadow,
            wantBg: hexToRgb(cs.getPropertyValue("--ab-whisper-bg")),
            // The stripe token, not --ab-accent: the whisper tokens carry NO
            // dark override (the tile is parchment in both client themes —
            // the theme-keyed dark values shipped for one evening and were
            // illegible), so all three resolve identically in either scheme.
            wantStripe: hexToRgb(cs.getPropertyValue("--ab-whisper-stripe")),
          };
        }, logs[0].id);
        assert(!style.missing, "card never rendered in the chat log");
        assert(style.bg !== "rgb(232, 232, 239)", "tile still wears core's lavender");
        assert(style.bg === style.wantBg,
          `tile bg ${style.bg} != resolved --ab-whisper-bg ${style.wantBg}`);
        assert(style.shadow.includes("inset") && style.shadow.includes(style.wantStripe),
          `no accent stripe (box-shadow: ${style.shadow})`);
      });

      // ---- item seam -------------------------------------------------------
      since = await messageIds(gm);
      await leg("item add by Alice → 'Item added' card", async () => {
        await alice.evaluate((id) => game.actors.get(id).createEmbeddedDocuments("Item", [{ name: "Probe Rope", type: "item" }]), created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1 && logs[0].content.includes("Probe Rope"), "no item-added card");
      });

      since = await messageIds(gm);
      await leg("item remove → 'Item removed' card", async () => {
        await gm.evaluate((id) => {
          const a = game.actors.get(id);
          const it = a.items.find((i) => i.name === "Probe Rope");
          return a.deleteEmbeddedDocuments("Item", [it.id]);
        }, created.witness);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1 && /removed/i.test(logs[0].content) && logs[0].content.includes("Probe Rope"), "no item-removed card");
      });

      since = await messageIds(gm);
      await leg("Fatigue add/remove → distinct wording, not 'Item added'", async () => {
        await alice.evaluate((id) => game.actors.get(id).createOwnedItem({ name: "Fatigue", type: "item" }, { ignoreCapacity: true }), created.witness);
        let logs = await logsSince(gm, since);
        assert(logs.length === 1 && /Fatigue added/.test(logs[0].content), "no Fatigue-added card");
        assert(!/Item added/.test(logs[0].content), "Fatigue reads like plain gear");
        since = await messageIds(gm);
        await gm.evaluate((id) => {
          const a = game.actors.get(id);
          const it = a.items.find((i) => i.name === "Fatigue");
          return it.delete();
        }, created.witness);
        logs = await logsSince(gm, since);
        assert(logs.length === 1 && /Fatigue removed/.test(logs[0].content), "no Fatigue-removed card");
      });

      // ---- item UPDATE seam (review #13 #20+#21) ---------------------------
      // The REAL − button, not item.update: the one-write rollover merge lives
      // in the sheet handler, so a leg driving the update itself would stay
      // green with the handler reverted — the two-layer Fatigue lesson.
      const clickUsesMinus = (page, actorId, itemName) =>
        page.evaluate(async ({ id, name }) => {
          const actor = game.actors.get(id);
          const sheet = actor.sheet;
          await sheet.render(true);
          const item = actor.items.find((i) => i.name === name);
          if (!item) throw new Error(`no "${name}" on the witness`);
          const sel = `.cairn-items-list-row[data-item-id="${item.id}"] [data-action="itemRemoveUse"]`;
          const t0 = Date.now();
          let btn;
          while (!(btn = sheet.element?.querySelector(sel))) {
            if (Date.now() - t0 > 5000) throw new Error(`${sel} never rendered`);
            await new Promise((r) => setTimeout(r, 100));
          }
          btn.click();
        }, { id: actorId, name: itemName });

      await leg("uses tick via the real − button → whole-line uses line", async () => {
        await gm.evaluate((id) => game.actors.get(id).createEmbeddedDocuments("Item",
          [{ name: "Probe Torch", type: "item", system: { quantity: 1, uses: { value: 3, max: 3 } } }],
          { abNoStatusCard: true }), created.witness);
        since = await messageIds(gm);
        await clickUsesMinus(gm, created.witness, "Probe Torch");
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected 1 card, got ${logs.length}`);
        const want = await gm.evaluate(() => game.i18n.format("CAIRN.ChangeLog.Uses",
          { name: "Probe Torch", from: "3", to: "2" }));
        assert(logs[0].content.includes(want), `card lacks the uses line "${want}"`);
        assert(logs[0].items === 1, `expected the uses line alone, got ${logs[0].items} lines`);
      });

      since = await messageIds(gm);
      await leg("rollover click → ONE card carrying quantity AND uses lines", async () => {
        // uses 1 on a stack of 2: the − click crosses zero, consumes a unit
        // and refills the counter. That is ONE write in the handler now, so
        // ONE card with both lines — the pre-#20 double update posted two
        // operations, which this seam would have turned into two whispered
        // cards for a single press of one button.
        await gm.evaluate(async (id) => {
          const it = game.actors.get(id).items.find((i) => i.name === "Probe Torch");
          await it.update({ "system.quantity": 2, "system.uses.value": 1 }, { abNoStatusCard: true });
        }, created.witness);
        since = await messageIds(gm);
        await clickUsesMinus(gm, created.witness, "Probe Torch");
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected ONE card for one click, got ${logs.length}`);
        assert(logs[0].items === 2, `expected quantity + uses lines together, got ${logs[0].items}`);
        const qty = await gm.evaluate(() => game.i18n.format("CAIRN.ChangeLog.Field",
          { label: "Probe Torch", from: "2", to: "1" }));
        const uses = await gm.evaluate(() => game.i18n.format("CAIRN.ChangeLog.Uses",
          { name: "Probe Torch", from: "1", to: "3" }));
        assert(logs[0].content.includes(qty), `no quantity line "${qty}"`);
        assert(logs[0].content.includes(uses), `no uses line "${uses}"`);
      });

      since = await messageIds(gm);
      await leg("flagged quantity write and a rename post nothing", async () => {
        await gm.evaluate(async (id) => {
          const a = game.actors.get(id);
          const it = a.items.find((i) => i.name === "Probe Torch");
          // Machinery-shaped write: every generation/grant path flags like this.
          await it.update({ "system.quantity": 5 }, { abNoStatusCard: true });
          // A rename is a REAL unflagged update, and it must stay off the
          // ledger: quantity and uses are the whole update-seam vocabulary
          // (equipped/rename/description excluded by ruling).
          await it.update({ name: "Probe Torch Renamed" });
        }, created.witness);
        const logs = await logsSince(gm, since, { expectNone: true });
        assert(logs.length === 0, `expected no cards, got ${logs.length}`);
        await gm.evaluate(async (id) => {
          const a = game.actors.get(id);
          const it = a.items.find((i) => i.name === "Probe Torch Renamed");
          if (it) await a.deleteEmbeddedDocuments("Item", [it.id], { abNoStatusCard: true });
          await a.sheet.close();
        }, created.witness);
      });

      // ---- suppression -----------------------------------------------------
      since = await messageIds(gm);
      await leg("abNoStatusCard update posts nothing", async () => {
        await gm.evaluate((id) => game.actors.get(id).update({ "system.gold": 60 }, { abNoStatusCard: true }), created.witness);
        const logs = await logsSince(gm, since, { expectNone: true });
        assert(logs.length === 0, `flagged update posted ${logs.length} card(s)`);
      });

      since = await messageIds(gm);
      await leg("regenerateNpc (real machinery path) posts nothing", async () => {
        await gm.evaluate(async (id) => {
          const mod = await import("/systems/air-bladder/module/character-generator.js");
          await mod.regenerateNpc(game.actors.get(id));
        }, created.npc);
        const logs = await logsSince(gm, since, { expectNone: true });
        assert(logs.length === 0, `regeneration posted ${logs.length} ledger card(s)`);
      });

      // ---- audience (negative) --------------------------------------------
      since = await messageIds(gm);
      await leg("hidden actor's card is invisible to Alice", async () => {
        await gm.evaluate((id) => game.actors.get(id).update({ "system.gold": 11 }), created.hidden);
        const logs = await logsSince(gm, since);
        assert(logs.length === 1, `expected 1 card, got ${logs.length}`);
        const aliceView = await alice.evaluate((mid) => {
          const m = game.messages.get(mid);
          return m ? m.visible : "absent";
        }, logs[0].id);
        assert(aliceView === "absent" || aliceView === false,
          `a non-observer can see the ledger (visible=${aliceView})`);
      });

      // ---- setting off (last: it flips world state; withSettings restores) -
      since = await messageIds(gm);
      await leg("setting off silences the log, live", async () => {
        await gm.evaluate(() => game.settings.set("air-bladder", "change-log", false));
        await gm.evaluate((id) => game.actors.get(id).update({ "system.gold": 70 }), created.witness);
        const logs = await logsSince(gm, since, { expectNone: true });
        assert(logs.length === 0, `posted ${logs.length} card(s) with the setting off`);
        await gm.evaluate(() => game.settings.set("air-bladder", "change-log", true));
      });
    });

    await leg("zero console errors on either client", async () => {
      assert(gmErrors.length === 0, `GM console: ${gmErrors[0]}`);
      assert(aliceErrors.length === 0, `Alice console: ${aliceErrors[0]}`);
    });
  } finally {
    // Sweep from Node so a throw above cannot skip it: the three actors, and
    // every change-log card the run created (snapshot diff — print what went).
    try {
      const swept = await gm.evaluate(async ({ ids, preRun }) => {
        const out = [];
        for (const id of ids.filter(Boolean)) {
          const a = game.actors.get(id);
          if (a) { out.push(`actor ${a.name} (${id})`); await a.delete(); }
        }
        const cards = game.messages.contents
          .filter((m) => !preRun.includes(m.id) && (m.content ?? "").includes('class="change-log"'))
          .map((m) => m.id);
        if (cards.length) {
          await ChatMessage.deleteDocuments(cards);
          out.push(`${cards.length} change-log card(s)`);
        }
        return out;
      }, { ids: [created.witness, created.hidden, created.npc], preRun: preRunMessages });
      for (const s of swept) console.log(`  swept ${s}`);
    } catch (e) {
      console.error(`  note  cleanup failed: ${e.message}`);
    }
    await browser.close();
  }
};

run().then(() => {
  clearTimeout(dog);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length
    ? `\ndev:changelog: ${failed.length} of ${results.length} legs FAILED`
    : `\ndev:changelog: all ${results.length} legs green`);
  process.exit(failed.length ? 1 : 0);
}).catch((e) => {
  console.error(`dev:changelog crashed: ${e.stack ?? e.message}`);
  process.exit(1);
});

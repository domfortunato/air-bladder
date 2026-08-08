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
 *   suppression — a flagged update posts nothing; regenerateNpc (the real
 *                 machinery path: deleteAll + create + update) posts nothing.
 *                 The DAMAGE path is not driven here: its writes carry
 *                 abNoStatusCard at source (damage.js:125,149,487 — the same
 *                 flag this probe proves suppresses), and clicking the real
 *                 Apply button is dev:enc-damage / dev:hazard territory.
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

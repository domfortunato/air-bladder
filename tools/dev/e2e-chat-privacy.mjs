#!/usr/bin/env node
/**
 * HIDDEN STAYS HIDDEN — the three per-viewer rebuilds review #30 found
 * writing over core's "rolled privately" (2026-09-13).
 *
 *   node tools/dev/e2e-chat-privacy.mjs   (needs Foundry running, world launched, Alice)
 *
 * `ChatMessage#visible` is TRUE for a whispered message that carries a Roll
 * (chat-message.mjs:101-104), so `renderChatMessageHTML` fires on a player's
 * client for a Private GM Roll — after core has replaced the flavor with
 * "<author> rolled privately" and the sender with the author's name. A
 * rebuild that does not ask `isContentVisible` first writes straight over
 * that substitution. Three did, in the same hook review #29 had gated for the
 * d20 card alone:
 *
 *   markInitiativeOutcome   (combat.js)           a HIDDEN combatant's save is
 *                                                 whispered "gm" by design; the
 *                                                 rebuild handed every player its
 *                                                 name, total, DEX and outcome
 *   localizeDashboardCard   (warden-dashboard.js) the Dashboard opens on PRIVATE;
 *                                                 the draw branch named the table
 *                                                 on every player's screen
 *   localizeEncounterQty    (encounters.js)       a quantity roll under the Warden's
 *                                                 Private dropdown named the creature
 *
 * Each leg posts the card its real producer posts — the initiative one
 * THROUGH `Combat#rollInitiative` on a hidden combatant; the other two in the
 * exact shape their producers build, under messageMode "gm" — and reads
 * Alice's RENDERED chat log. EVERY LEG HAS ITS PUBLIC CONTROL: the identical
 * card posted public must show the rebuilt text on her client, or "she cannot
 * see it" passes on a build where the rebuild never ran at all.
 *
 * Red-first: with the three `isContentVisible` gates removed, the three
 * private legs fail and the three controls still pass. Fixtures are flagged
 * `probeChatPrivacy` and swept from Node; the initiative cards carry no flag
 * (core creates them) and are deleted by the ids recorded when they appeared.
 * Exits non-zero on any failed assertion or console error on either client.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(240000, "dev:chat-privacy", () => browser.close());
const gmCtx = await browser.newContext({ viewport: VIEWPORT });
const aliceCtx = await browser.newContext({ viewport: VIEWPORT });
const gm = await gmCtx.newPage();
const alice = await aliceCtx.newPage();
const gmErrors = watchErrors(gm);
const aliceErrors = watchErrors(alice);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);
const FLAG = "probeChatPrivacy";
const MARK = "ZZ Privacy";

/** Everything this probe plants, by flag; the initiative cards by name. */
const sweep = (extraMessageIds = []) => gm.evaluate(async ({ FLAG, MARK, extraMessageIds }) => {
  const out = { messages: 0, combats: 0, scenes: 0, actors: 0 };
  const flagged = (x) => x.getFlag("air-bladder", FLAG) === true;
  const byId = new Set(extraMessageIds);
  for (const m of [...game.messages].filter((x) => flagged(x) || byId.has(x.id)
    || String(x.speaker?.alias ?? "").startsWith(MARK))) { await m.delete(); out.messages++; }
  for (const c of [...game.combats].filter(flagged)) { await c.delete(); out.combats++; }
  for (const s of [...game.scenes].filter(flagged)) { await s.delete(); out.scenes++; }
  for (const a of [...game.actors].filter(flagged)) { await a.delete(); out.actors++; }
  return out;
}, { FLAG, MARK, extraMessageIds });

let posted = {};
try {
  await joinAsGM(gm);
  const pre = await sweep();
  Object.values(pre).some(Boolean)
    ? console.log(`  --    swept leftovers first: ${JSON.stringify(pre)}`)
    : ok("nothing planted left behind by an earlier run");
  await joinAs(alice, "Alice");

  posted = await gm.evaluate(async ({ FLAG, MARK }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const ActorImpl = CONFIG.Actor.documentClass;
    const flags = { "air-bladder": { [FLAG]: true } };

    // 1. The initiative save of a HIDDEN combatant, through the real roll.
    //    DEX 20 cannot fail a d20 save, so the outcome is forced by fixture.
    const scene = await Scene.create({ name: `${MARK} Scene`, width: 1000, height: 1000, flags });
    await scene.view();
    await sleep(300);
    const mk = async (name, x) => {
      const a = await ActorImpl.create({
        name, type: "character", flags,
        system: { abilities: { DEX: { value: 20, max: 20 } } },
        prototypeToken: { disposition: 1 },
      });
      const [t] = await scene.createEmbeddedDocuments("Token", [await a.getTokenDocument({ x, y: 100 })]);
      return { a, t };
    };
    const hidden = await mk(`${MARK} Hidden`, 100);
    const shown = await mk(`${MARK} Shown`, 300);
    const combat = await Combat.create({ scene: scene.id, flags });
    await combat.activate();
    const [ch, cs] = await combat.createEmbeddedDocuments("Combatant", [
      { actorId: hidden.a.id, tokenId: hidden.t.id, sceneId: scene.id, hidden: true },
      { actorId: shown.a.id, tokenId: shown.t.id, sceneId: scene.id },
    ]);
    const before = new Set(game.messages.map((m) => m.id));
    await combat.rollInitiative([ch.id, cs.id]);
    await sleep(400);
    const fresh = game.messages.filter((m) => !before.has(m.id));
    out.initHidden = fresh.find((m) => m.speaker?.alias === `${MARK} Hidden`)?.id ?? null;
    out.initShown = fresh.find((m) => m.speaker?.alias === `${MARK} Shown`)?.id ?? null;
    out.initHiddenWhispered = (game.messages.get(out.initHidden)?.whisper ?? []).length > 0;
    out.initShownPublic = (game.messages.get(out.initShown)?.whisper ?? []).length === 0;

    // 2. The Dashboard's single-table draw, in the shape `postTableDraw`
    //    builds: core's card WITH its roll, the bare-uuid flag, and the
    //    window's dropdown as messageMode — which opens on "gm".
    const comp = await import("/systems/air-bladder/module/compendium.js");
    const table = await comp.findDeclaredTable(CONFIG.Cairn.npcGenerator.traits.quirk);
    out.tableName = table?.name ?? null;
    const draw = async (messageMode) => {
      const drawn = await table.draw({ displayChat: false });
      const msg = await table.toMessage(drawn.results, {
        roll: drawn.roll,
        messageData: {
          speaker: { scene: null, actor: null, token: null, alias: `${MARK} Label` },
          flavor: `${MARK} stored flavor`,
          flags: { "air-bladder": { dashboardDraw: table.uuid, [FLAG]: true } },
        },
        messageOptions: { messageMode },
      });
      return msg.id;
    };
    out.dashPrivate = await draw("gm");
    out.dashPublic = await draw("public");

    // 3. The encounter quantity roll, in the shape `spawnEncounterFromMessage`
    //    builds — no messageMode of its own, so the Warden's dropdown decides.
    const qty = async (messageMode) => {
      const roll = await new Roll("1d4").evaluate();
      const msg = await roll.toMessage({
        flavor: `${MARK} stored qty`,
        speaker: { alias: game.user.name },
        flags: { "air-bladder": { encounterQty: { npc: false, label: `${MARK} Bandit` }, [FLAG]: true } },
      }, { messageMode });
      return msg.id;
    };
    out.qtyPrivate = await qty("gm");
    out.qtyPublic = await qty("public");
    out.gmName = game.user.name;
    return out;
  }, { FLAG, MARK });

  posted.initHidden && posted.initShown && posted.initHiddenWhispered && posted.initShownPublic
    ? ok(`fixtures posted: hidden combatant's save whispered, shown one public, table "${posted.tableName}"`)
    : fail(`fixtures: ${JSON.stringify(posted)}`);

  const seen = await alice.evaluate(async ({ ids, tableName, gmName, MARK }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wd = await import("/systems/air-bladder/module/warden-dashboard.js");
    const all = [ids.initHidden, ids.initShown, ids.dashPrivate, ids.dashPublic, ids.qtyPrivate, ids.qtyPublic];
    for (let i = 0; i < 60; i++) {
      if (all.every((id) => document.querySelector(`[data-message-id="${id}"]`))) break;
      await sleep(100);
    }
    await sleep(400);
    const el = (id, sel) => document.querySelector(`[data-message-id="${id}"] ${sel}`);
    const read = (id) => ({
      present: !!document.querySelector(`[data-message-id="${id}"]`),
      sender: el(id, ".message-sender")?.textContent?.trim() ?? null,
      flavor: el(id, ".flavor-text")?.textContent?.trim() ?? null,
      totalClass: el(id, ".dice-total")?.className ?? "",
      total: el(id, ".dice-total")?.textContent?.trim() ?? null,
    });
    return {
      initHidden: read(ids.initHidden), initShown: read(ids.initShown),
      dashPrivate: read(ids.dashPrivate), dashPublic: read(ids.dashPublic),
      qtyPrivate: read(ids.qtyPrivate), qtyPublic: read(ids.qtyPublic),
      // Core's own substitution, computed on HER client.
      privateLine: game.i18n.format("CHAT.PrivateRollContent", { user: gmName }),
      tableLabel: wd._labelForTable(tableName),
      mark: MARK,
    };
  }, { ids: posted, tableName: posted.tableName, gmName: posted.gmName, MARK });

  const s = seen;
  console.log("\na hidden combatant's initiative save");
  s.initHidden.present
    && !s.initHidden.flavor.includes("DEX save")
    && !s.initHidden.flavor.includes(`${MARK} Hidden`)
    && !/cairn-save-(pass|fail)/.test(s.initHidden.totalClass)
    && !s.initHidden.total.includes("20")
    ? ok(`Alice reads "${s.initHidden.flavor}" and a bare "${s.initHidden.total}" — name, DEX, total and outcome all withheld`)
    : fail(`the hidden combatant's save LEAKED to Alice: flavor "${s.initHidden.flavor}", total "${s.initHidden.total}", classes "${s.initHidden.totalClass}"`);
  s.initShown.present
    && s.initShown.flavor.includes("DEX save")
    && s.initShown.flavor.includes(`${MARK} Shown`)
    && /cairn-save-pass/.test(s.initShown.totalClass)
    ? ok("CONTROL: the visible combatant's save is rebuilt on her client — name, numbers and the green total")
    : fail(`CONTROL FAILED — the public save did not rebuild for Alice: ${JSON.stringify(s.initShown)}`);

  console.log("\nthe Dashboard's private draw");
  s.dashPrivate.present
    && s.dashPrivate.sender === posted.gmName
    && s.dashPrivate.flavor === s.privateLine
    && !s.dashPrivate.flavor.includes(s.tableLabel)
    ? ok(`Alice reads "${s.dashPrivate.sender}" over "${s.dashPrivate.flavor}" — the table's name is withheld`)
    : fail(`the private draw named its table to Alice: sender "${s.dashPrivate.sender}", flavor "${s.dashPrivate.flavor}" (label "${s.tableLabel}")`);
  s.dashPublic.present
    && s.dashPublic.sender === s.tableLabel
    && s.dashPublic.flavor.includes(s.tableLabel)
    && s.dashPublic.sender !== `${MARK} Label`
    ? ok(`CONTROL: the public draw is relabelled "${s.dashPublic.sender}" / "${s.dashPublic.flavor}" on her client`)
    : fail(`CONTROL FAILED — the public draw did not rebuild for Alice: ${JSON.stringify(s.dashPublic)} (label "${s.tableLabel}")`);

  console.log("\nthe encounter quantity roll");
  s.qtyPrivate.present && !s.qtyPrivate.flavor.includes(`${MARK} Bandit`)
    ? ok(`Alice reads "${s.qtyPrivate.flavor}" — the creature is withheld`)
    : fail(`the private quantity roll named the creature to Alice: "${s.qtyPrivate.flavor}"`);
  s.qtyPublic.present && s.qtyPublic.flavor.includes(`${MARK} Bandit`)
    ? ok(`CONTROL: the public one reads "${s.qtyPublic.flavor}" on her client`)
    : fail(`CONTROL FAILED — the public quantity roll did not rebuild for Alice: "${s.qtyPublic.flavor}"`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  try {
    const ids = [posted.initHidden, posted.initShown, posted.dashPrivate, posted.dashPublic, posted.qtyPrivate, posted.qtyPublic].filter(Boolean);
    const post = await sweep(ids);
    console.log(`\n  --    removed ${JSON.stringify(post)}`);
  } catch { /* page gone */ }
  const errors = [...gmErrors, ...aliceErrors];
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nCHAT-PRIVACY PROBE FAILED\n" : "\nchat-privacy probe passed\n");
process.exit(failed ? 1 : 0);

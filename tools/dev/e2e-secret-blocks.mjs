#!/usr/bin/env node
/**
 * A Warden's Secret blocks stay the Warden's on every surface that puts a
 * description on screen without enrichHTML (review #34 finding 126).
 *
 *   npm run dev:secret-blocks
 *
 * Core hides a ProseMirror Secret block (`<section class="secret">`) from a
 * viewer who does not own the document only by enriching with
 * `secrets: document.isOwner` (its sheets) or `speakerActor?.isOwner` (chat);
 * enrichHTML's one removal step is `section.secret:not(.revealed)`. Four
 * surfaces here built descriptions without it, and `cleanDescription` keeps
 * `section` and `class`, so a Warden's note was printed to players:
 *
 *   1. the Marketplace row (textContent flattened the secret into the row);
 *   2. an inventory row's description panel, on a sheet the player only
 *      OBSERVES (a loot container here; the Dropped Item Pile is the same);
 *   3. the GLOG public cast card, rebuilt from its flag after core had already
 *      removed the secret;
 *   4. the background picker's description panel, for a Warden's world-pack
 *      background.
 *
 * Every surface is read on a PLAYER's client, where the viewer owns none of
 * the documents. Two controls run on the Warden's client, who owns them all:
 * the note must be THERE, or the player legs pass for the wrong reason.
 * Concealment, not protection — the raw text is on every client that holds the
 * document, as it is under core.
 *
 * Fixtures stamped `probeFixture` and swept by flag from a finally; the two
 * settings it needs ride withSettings.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAs, joinAsGM, watchErrors, watchdog, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(300000, "secret blocks probe", () => browser.close());
const gm = await browser.newPage({ viewport: VIEWPORT });
const gmErrors = watchErrors(gm);
let player = null;
let playerErrors = [];
let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const FIXTURE = "secret-blocks";
const PUBLIC = "ZZ SECRET PUBLIC";
const NOTE = "ZZ WARDEN NOTE";
const SECRET = `<p>${PUBLIC}</p><section class="secret" id="secret-zzprobe"><p>${NOTE}</p></section>`;

const sweep = () => gm.evaluate(async (fixture) => {
  const stamped = (d) => d.getFlag("air-bladder", "probeFixture") === fixture;
  for (const m of game.messages.filter(stamped)) await m.delete();
  for (const t of game.tables.filter(stamped)) await t.delete();
  for (const a of game.actors.filter(stamped)) await a.delete();
  for (const i of game.items.filter(stamped)) await i.delete();
  const pack = game.packs.get("world.zz-probe-secret-bgs");
  if (pack) await pack.deleteCompendium();
}, FIXTURE);

try {
  await joinAsGM(gm);
  await withSettings(gm, async () => {
    await sweep();
    const fx = await gm.evaluate(async ({ fixture, SECRET }) => {
      const flags = { "air-bladder": { probeFixture: fixture } };
      const NS = "air-bladder";
      await game.settings.set(NS, "allow-player-marketplace", true);
      await game.settings.set(NS, "content-source-custom", true);
      const pc = game.users.find((u) => !u.isGM);
      if (!pc) return { error: "no player in this world" };

      // The shop item: the player has LIMITED, never OWNER.
      const item = await Item.create({ name: "ZZ Secret Lantern", type: "item", flags,
        ownership: { default: 1 }, system: { description: SECRET } });
      await RollTable.create({ name: "Market: ZZ Secrets", flags, ownership: { default: 2 },
        results: [{ type: "document", documentUuid: item.uuid, name: item.name, range: [1, 1], weight: 1 }] });
      const mine = await Actor.create({ name: "ZZ Secret Shopper", type: "character", flags,
        ownership: { default: 0, [pc.id]: 3 } });
      // A loot container the player only OBSERVES.
      const chest = await Actor.create({ name: "ZZ Secret Chest", type: "npc", flags,
        system: { role: "container", slots: 10 }, ownership: { default: 2 },
        items: [{ name: "ZZ Secret Lantern", type: "item", system: { description: SECRET } }] });
      // A public GLOG cast card in its producer's exact shape, spoken by nobody
      // the player owns (core: no speaker actor, so secrets for a GM only).
      const cast = await ChatMessage.create({
        content: `<div class="grimoire-cast-card">placeholder</div>`,
        speaker: { alias: "ZZ Secret Caster" }, flags: { "air-bladder": {
          probeFixture: fixture,
          glogCast: { name: "ZZ Secret Spell", desc: SECRET, dice: [3], sum: 3, alias: "ZZ Secret Caster" },
        } },
      });
      // A Warden's world-pack background, cloned from a shipped one so it is
      // structurally valid without this probe knowing the background schema.
      const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
        label: "ZZ Probe Secret Backgrounds", name: "zz-probe-secret-bgs", type: "Item", packageType: "world",
      });
      const src = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())[0].toObject();
      delete src._id;
      src.name = "ZZ Secret Background";
      src.system.description = SECRET;
      const [bg] = await Item.createDocuments([src], { pack: pack.collection });
      return { playerName: pc.name, mineId: mine.id, chestId: chest.id, castId: cast.id, bgUuid: bg.uuid };
    }, { fixture: FIXTURE, SECRET });
    if (fx.error) { fail(`precondition: ${fx.error}`); return; }
    ok(`fixtures planted; the player is ${fx.playerName}`);

    /** Read all four surfaces on one client. */
    const readSurfaces = (pg, ids) => pg.evaluate(async ({ ids }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
      const out = {};
      // 1. The shop, opened for the player's own character.
      const mkt = await import("/systems/air-bladder/module/marketplace.js");
      const shopper = game.actors.get(ids.mineId);
      await mkt.openMarketplace(shopper);
      const shopRow = await until(() => [...document.querySelectorAll(".marketplace .mkt-row")]
        .find((r) => /ZZ Secret Lantern/.test(r.textContent)));
      out.shop = shopRow?.textContent.replace(/\s+/g, " ").trim() ?? null;
      for (const w of [...foundry.applications.instances.values()]) {
        if (w.element?.querySelector?.(".marketplace")) await w.close();
      }
      // 2. The chest's row panel.
      const chest = game.actors.get(ids.chestId);
      await chest.sheet.render(true);
      await until(() => chest.sheet.element);
      await sleep(500);
      chest.sheet.element.querySelector('.tabs .item[data-tab="items"]')?.click();
      await sleep(300);
      const row = [...chest.sheet.element.querySelectorAll("[data-item-id]")]
        .find((r) => /ZZ Secret Lantern/.test(r.textContent));
      row?.querySelector('[data-action="itemDescription"]')?.click();
      const panel = await until(() => chest.sheet.element.querySelector(".item-description"));
      out.row = panel?.textContent.replace(/\s+/g, " ").trim() ?? null;
      await chest.sheet.close();
      // 3. The cast card as this client rendered it.
      const card = await until(() => document.querySelector(`[data-message-id="${ids.castId}"] .grimoire-cast-card`));
      out.cast = card?.textContent.replace(/\s+/g, " ").trim() ?? null;
      // 4. The background picker's panel for the world-pack background.
      const gen = await import("/systems/air-bladder/module/character-generator.js");
      const pick = gen.promptBackground("2e", null);
      const dlg = await until(() => document.querySelector(".bg-picker"));
      const radio = dlg?.querySelector(`input[value="${ids.bgUuid}"]`);
      radio?.click();
      radio?.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(300);
      out.bg = dlg?.querySelector(".bg-pick-desc")?.textContent.replace(/\s+/g, " ").trim() ?? null;
      out.bgRow = !!radio;
      dlg?.closest(".application")?.querySelector('button[data-action="cancel"]')?.click();
      await pick;
      return out;
    }, { ids: fx });

    // The Warden first: the CONTROLS, on a client that owns every document.
    const warden = await readSurfaces(gm, fx);
    warden.shop?.includes(NOTE) && warden.row?.includes(NOTE)
      ? ok("CONTROL: the Warden, who owns them, reads the note in the shop row and the row panel")
      : fail(`CONTROL FAILED — the note is not on the Warden's surfaces, so the player legs prove nothing: ${JSON.stringify(warden)}`);

    player = await browser.newPage({ viewport: VIEWPORT });
    playerErrors = watchErrors(player);
    await joinAs(player, fx.playerName);
    const seen = await readSurfaces(player, fx);
    const check = (label, text) => (text?.includes(PUBLIC) && !text.includes(NOTE)
      ? ok(`${label}: the player reads the description without the Warden's note`)
      : fail(`${label} on the player's client: ${JSON.stringify(text)}`));
    check("the Marketplace row", seen.shop);
    check("an observed container's row panel", seen.row);
    check("the GLOG public cast card", seen.cast);
    seen.bgRow
      ? check("the background picker's panel", seen.bg)
      : fail("the background picker offered no row for the world-pack background — the leg cannot read its panel");
  });
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  try { await sweep(); } catch { /* page gone */ }
  const errors = [...gmErrors, ...playerErrors];
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nSECRET-BLOCKS PROBE FAILED\n" : "\nsecret-blocks probe passed\n");
process.exit(failed ? 1 : 0);

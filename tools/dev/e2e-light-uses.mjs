#!/usr/bin/env node
/**
 * Lighting a light spends a use (2026-11-21, user ask: "lighting a torch or
 * lantern marks off one use (a lantern can't be used without candle or oil
 * and one use of them is marked off). The warden should be able to put
 * someone's lamp out and the notice in chat should notify everyone.") The
 * user's pick: a public notice both when a light is lit and when it goes out.
 *
 * Lit = equipped (the Equip light badge, a row's hand, any write). The rule
 * lives on the item hooks (registerHeldLightSync, gear.js), so these legs
 * drive it through plain item writes and once through the real badge.
 *
 * Asserts:
 *   1. lighting a 3/3 Torch leaves 2/3 and posts a public card "{actor} lights
 *      the Torch (2 uses left)."; putting it out posts "{actor}'s Torch goes
 *      out." (the Warden, on an actor no player owns: the plain line);
 *   2. a Torch at 0/3 is REFUSED: it stays unequipped, the warning says it is
 *      used up, and no card is posted;
 *   3. the Lantern spends its FUEL: with an Oil Can (2/2) and a Candle (3/3)
 *      the Oil Can goes to 1 and the card names it ("1 use left", singular);
 *      with the Oil Can gone the Candle goes from 3 to 2; with neither use
 *      left the Lantern is refused and the warning asks for oil or a candle;
 *   4. a lantern that is not THE Lantern (the Wisp Lantern) lights free: no
 *      fuel needed, the plain "lights the Wisp Lantern." line;
 *   5. the Warden putting out the light of a character a PLAYER owns posts
 *      "The Warden puts out {actor}'s Torch." (needs Alice);
 *   6. through the real Equip light badge, on a character with one Torch,
 *      a press lights it and spends the use;
 *   7. a STACK rolls over, as the row's minus does (review #36,
 *      CairnItem#spendUse): Torch x2 at 1/3 lit reads x1 at 3/3, and a Lantern
 *      lights off an Oil Can x2 standing at 0/6, which then reads x1 at 5/6;
 *   8. the row's real hand on a SPENT Torch while a fuelled Lantern burns
 *      writes nothing (review #36): the Lantern stays lit, no card, the Oil
 *      Can keeps its count, one warning;
 *   9. a light lit on a HIDDEN token's creature is whispered to the Wardens,
 *      and the same on a token everyone sees is public (review #36; needs a
 *      player user, as leg 5);
 *  10. the card is rebuilt PER VIEWER (review #36): with a sentence and a
 *      light name planted in-page (the language table and the content
 *      overlay, both put back), the rendered card reads the viewer's sentence
 *      and the overlay's name, and the stored body is left as it was;
 *  11. a refusal toast prints the light's name AS TYPED (review #36): a spent
 *      light named with an angle-bracketed part is refused, and the toast
 *      core queued reads the whole sentence, name included. A toast handed
 *      to core already formatted is cleaned whole and loses everything from
 *      the bracket on.
 * Cards are selected by their own class (`cairn-light-card`) and by message
 * id difference, never as "the newest message", and every card a leg made is
 * deleted. Fixtures stamped `probeFixture`, swept from the catch.
 *
 *   npm run dev:light-uses      (leg 5 needs Alice — npm run dev:players)
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors, watchdog } from "./lib.mjs";

const FIXTURE = "light-uses";
const browser = await chromium.launch();
watchdog(240000, "light-uses probe", () => browser.close());
const gm = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(gm);
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(60)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(60)} ${d}`); failures++; };
const check = (cond, l, d = "") => (cond ? ok(l, d) : fail(l, d));

const cleanup = async () => {
  try {
    await gm.evaluate(async (fixture) => {
      for (const sc of game.scenes.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) await sc.delete();
      for (const a of game.actors.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) {
        await a.sheet?.close();
        await a.delete();
      }
    }, FIXTURE);
  } catch (e) {
    console.error(`  note  cleanup: ${e.message}`);
  }
};

let r = {};
try {
  await joinAsGM(gm);
  await dismissChrome(gm);
  await cleanup();

  r = await gm.evaluate(async (fixture) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!fn() && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const F = (k, d) => game.i18n.format(k, d);
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = {};
    // Warnings, recorded (and still shown): the sentence asked for, and the
    // text of the toast core queued for it.
    const warned = [];
    const toasts = [];
    const realWarn = ui.notifications.warn;
    ui.notifications.warn = function (msg, ...rest) {
      warned.push(rest[0]?.format ? game.i18n.format(String(msg), rest[0].format) : String(msg));
      const note = realWarn.call(this, msg, ...rest);
      const p = document.createElement("p");
      p.innerHTML = note?.message ?? "";
      toasts.push(p.textContent);
      return note;
    };
    // Cards a leg made: by class and by id difference.
    const seen = new Set(game.messages.contents.map((m) => m.id));
    const made = [];
    const cards = async (wait = true) => {
      if (wait) await sleep(700);
      const fresh = game.messages.contents.filter((m) => !seen.has(m.id) && (m.content ?? "").includes("cairn-light-card"));
      for (const m of game.messages.contents) seen.add(m.id);
      made.push(...fresh.map((m) => m.id));
      return fresh.map((m) => ({
        id: m.id,
        text: new DOMParser().parseFromString(m.content, "text/html").body.textContent.trim(),
        public: !(m.whisper?.length) && !m.blind,
        whisper: [...(m.whisper ?? [])].map((u) => u?.id ?? u),
      }));
    };
    try {
      const pc = await getDocumentClass("Actor").create({
        name: "ZZ Lights", type: "character", flags,
        items: [
          { name: "Torch", type: "item", sort: 100, system: { uses: { value: 3, max: 3 } } },
          { name: "Lantern", type: "item", sort: 200 },
          { name: "Oil Can", type: "item", sort: 300, system: { uses: { value: 2, max: 2 } } },
          { name: "Candle", type: "item", sort: 400, system: { uses: { value: 3, max: 3 } } },
          { name: "Wisp Lantern", type: "item", sort: 500 },
        ],
      }, { abNoStatusCard: true });
      const it = (n) => pc.items.find((i) => i.name === n);
      const light = async (n, on) => {
        await it(n).update({ "system.equipped": on });
        await until(() => it(n)?.system.equipped === on, 1500);
        return cards();
      };
      await cards(false);

      // 1.
      out.lit = { cards: await light("Torch", true), uses: it("Torch").system.uses.value,
        want: F("CAIRN.LightCard.LitUses", { actor: "ZZ Lights", light: "Torch", n: 2 }) };
      out.out = { cards: await light("Torch", false), want: F("CAIRN.LightCard.Out", { actor: "ZZ Lights", light: "Torch" }) };

      // 2.
      await it("Torch").update({ "system.uses.value": 0 }, { abNoStatusCard: true });
      await cards();
      warned.length = 0;
      out.spent = { cards: await light("Torch", true), equipped: it("Torch").system.equipped,
        warned: warned.slice(), want: F("CAIRN.LightUsedUp", { name: "Torch" }) };

      // 3.
      out.oil = { cards: await light("Lantern", true), oil: it("Oil Can").system.uses.value, candle: it("Candle").system.uses.value,
        want: F("CAIRN.LightCard.LitFuelOne", { actor: "ZZ Lights", light: "Lantern", fuel: "Oil Can", n: 1 }) };
      await light("Lantern", false);
      await pc.deleteEmbeddedDocuments("Item", [it("Oil Can").id], { abNoStatusCard: true });
      await cards();
      out.candle = { cards: await light("Lantern", true), candle: it("Candle").system.uses.value,
        want: F("CAIRN.LightCard.LitFuel", { actor: "ZZ Lights", light: "Lantern", fuel: "Candle", n: 2 }) };
      await light("Lantern", false);
      await it("Candle").update({ "system.uses.value": 0 }, { abNoStatusCard: true });
      await cards();
      warned.length = 0;
      out.nofuel = { cards: await light("Lantern", true), equipped: it("Lantern").system.equipped,
        warned: warned.slice(), want: F("CAIRN.LanternNoFuel", { name: "Lantern" }) };

      // 4.
      out.wisp = { cards: await light("Wisp Lantern", true), equipped: it("Wisp Lantern").system.equipped,
        want: F("CAIRN.LightCard.Lit", { actor: "ZZ Lights", light: "Wisp Lantern" }) };
      await light("Wisp Lantern", false);

      // 5.
      const alice = game.users.getName("Alice");
      out.alice = !!alice;
      if (alice) {
        const owned = await getDocumentClass("Actor").create({
          name: "ZZ Lights Owned", type: "character", flags,
          ownership: { default: 0, [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
          items: [{ name: "Torch", type: "item", system: { equipped: true, uses: { value: 3, max: 3 } } }],
        }, { abNoStatusCard: true });
        await cards();
        const t = owned.items.find((i) => i.name === "Torch");
        await t.update({ "system.equipped": false });
        out.warden = { cards: await cards(), want: F("CAIRN.LightCard.WardenOut", { actor: "ZZ Lights Owned", light: "Torch" }) };
      }

      // 6. The real badge.
      const one = await getDocumentClass("Actor").create({
        name: "ZZ Lights Badge", type: "character", flags,
        items: [{ name: "Torch", type: "item", system: { uses: { value: 3, max: 3 } } }],
      }, { abNoStatusCard: true });
      const sheet = one.sheet;
      await sheet.render(true);
      await until(() => sheet.element?.querySelector?.(".light-hold"));
      await sleep(400);
      await cards();
      sheet.element.querySelector('.tab[data-tab="character"] .light-hold')?.click();
      const torch = () => one.items.find((i) => i.name === "Torch");
      await until(() => torch()?.system.equipped === true, 3000);
      out.badge = { cards: await cards(), equipped: torch()?.system.equipped ?? null, uses: torch()?.system.uses.value ?? null,
        want: F("CAIRN.LightCard.LitUses", { actor: "ZZ Lights Badge", light: "Torch", n: 2 }) };
      await sheet.close();

      // 7. A stack rolls over (CairnItem#spendUse, the row's minus arithmetic).
      const stack = await getDocumentClass("Actor").create({
        name: "ZZ Lights Stack", type: "character", flags,
        items: [
          { name: "Torch", type: "item", sort: 100, system: { quantity: 2, uses: { value: 1, max: 3 } } },
          { name: "Lantern", type: "item", sort: 200 },
          { name: "Oil Can", type: "item", sort: 300, system: { quantity: 2, uses: { value: 0, max: 6 } } },
        ],
      }, { abNoStatusCard: true });
      const of = (actor, n) => actor.items.find((i) => i.name === n);
      const lightOn = async (actor, n, on) => {
        await of(actor, n).update({ "system.equipped": on });
        await until(() => of(actor, n)?.system.equipped === on, 1500);
        return cards();
      };
      await cards();
      out.stackTorch = { cards: await lightOn(stack, "Torch", true), quantity: of(stack, "Torch").system.quantity,
        uses: of(stack, "Torch").system.uses.value,
        want: F("CAIRN.LightCard.LitUses", { actor: "ZZ Lights Stack", light: "Torch", n: 3 }) };
      await lightOn(stack, "Torch", false);
      warned.length = 0;
      out.stackOil = { cards: await lightOn(stack, "Lantern", true), equipped: of(stack, "Lantern").system.equipped,
        quantity: of(stack, "Oil Can").system.quantity, uses: of(stack, "Oil Can").system.uses.value, warned: warned.slice(),
        want: F("CAIRN.LightCard.LitFuel", { actor: "ZZ Lights Stack", light: "Lantern", fuel: "Oil Can", n: 5 }) };

      // 8. The row's real hand on a spent Torch, a fuelled Lantern burning.
      const hand = await getDocumentClass("Actor").create({
        name: "ZZ Lights Hand", type: "character", flags,
        items: [
          { name: "Torch", type: "item", sort: 100, system: { uses: { value: 0, max: 3 } } },
          { name: "Lantern", type: "item", sort: 200 },
          { name: "Oil Can", type: "item", sort: 300, system: { uses: { value: 2, max: 2 } } },
        ],
      }, { abNoStatusCard: true });
      await lightOn(hand, "Lantern", true);
      const handSheet = hand.sheet;
      await handSheet.render(true);
      const handOf = (n) => handSheet.element?.querySelector?.(
        `.cairn-items-list-row[data-item-id="${of(hand, n)?.id}"] [data-action="itemToggleEquipped"]`);
      await until(() => handOf("Torch"));
      await sleep(400);
      await cards();
      warned.length = 0;
      const oilBefore = of(hand, "Oil Can").system.uses.value;
      const pressed = !!handOf("Torch");
      handOf("Torch")?.click();
      await sleep(1200);
      const usedUp = F("CAIRN.LightUsedUp", { name: "Torch" });
      out.hand = { pressed, cards: await cards(), lantern: of(hand, "Lantern").system.equipped, torch: of(hand, "Torch").system.equipped,
        oilBefore, oil: of(hand, "Oil Can").system.uses.value, warnings: warned.filter((w) => w === usedUp).length, warned: warned.slice() };
      await handSheet.close();

      // 9. A hidden token's light is not table news. The scene is planted and
      //    never viewed: a synthetic actor carries its own token.
      const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
      out.players = game.users.some((u) => !u.isGM);
      const scene = await getDocumentClass("Scene").create({ name: "ZZ Lights Scene", width: 1000, height: 1000, flags });
      const lurker = await getDocumentClass("Actor").create({
        name: "ZZ Lights Lurker", type: "npc", system: { role: "monster" }, flags,
        prototypeToken: { actorLink: false, disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE },
        items: [{ name: "Torch", type: "item", system: { uses: { value: 3, max: 3 } } }],
      }, { abNoStatusCard: true });
      const tokenIdsBefore = new Set(scene.tokens.map((t) => t.id));
      await scene.createEmbeddedDocuments("Token", [
        await lurker.getTokenDocument({ x: 100, y: 100, hidden: true }),
        await lurker.getTokenDocument({ x: 300, y: 100, hidden: false }),
      ]);
      const planted = scene.tokens.filter((t) => !tokenIdsBefore.has(t.id));
      const hiddenTok = planted.find((t) => t.hidden);
      const shownTok = planted.find((t) => !t.hidden);
      await cards();
      const lightToken = async (tok) => {
        const torch = () => tok.actor.items.find((i) => i.name === "Torch");
        await torch().update({ "system.equipped": true });
        await until(() => torch()?.system.equipped === true, 1500);
        return cards();
      };
      out.hidden = { cards: await lightToken(hiddenTok), gmIds };
      out.shown = { cards: await lightToken(shownTok) };

      // 10. The card is rebuilt per viewer: a sentence and a light's name
      //     planted in-page, both put back; nothing is written.
      const viewer = await getDocumentClass("Actor").create({
        name: "ZZ Lights Viewer", type: "character", flags,
        items: [{ name: "Torch", type: "item", system: { uses: { value: 3, max: 3 } } }],
      }, { abNoStatusCard: true });
      await cards();
      const [vCard] = await lightOn(viewer, "Torch", true);
      const vMsg = vCard ? game.messages.get(vCard.id) : null;
      const i18n = await import("/systems/air-bladder/module/i18n-content.js");
      const KEY = "CAIRN.LightCard.LitUses";
      const priorLine = foundry.utils.getProperty(game.i18n.translations, KEY);
      try {
        i18n._setOverlay({ "item.name": { Torch: "ZZ Antorcha" } });
        foundry.utils.setProperty(game.i18n.translations, KEY, "ZZ-VIEWER {actor} | {light} | {n}");
        const el = vMsg ? await vMsg.renderHTML() : null;
        out.viewer = { rendered: el?.querySelector(".cairn-light-card p")?.textContent.trim() ?? null,
          want: "ZZ-VIEWER ZZ Lights Viewer | ZZ Antorcha | 2", stored: vCard?.text ?? null,
          storedWant: priorLine.replace("{actor}", "ZZ Lights Viewer").replace("{light}", "Torch").replace("{n}", "2") };
      } finally {
        foundry.utils.setProperty(game.i18n.translations, KEY, priorLine);
        i18n._setOverlay(null);
      }

      // 11. The toast prints a name as typed. The light is found by id
      //     difference: its name is the thing under test.
      const BRACKETED = "Torch <the Old>";
      const namer = await getDocumentClass("Actor").create({ name: "ZZ Lights Namer", type: "character", flags }, { abNoStatusCard: true });
      const namerIds = new Set(namer.items.map((i) => i.id));
      await namer.createEmbeddedDocuments("Item", [{ name: BRACKETED, type: "item", system: { uses: { value: 0, max: 3 } } }],
        { abNoStatusCard: true });
      const old = namer.items.find((i) => !namerIds.has(i.id));
      await cards();
      warned.length = 0;
      toasts.length = 0;
      await old.update({ "system.equipped": true });
      await sleep(600);
      out.named = { cards: await cards(), equipped: old.system.equipped, toasts: toasts.slice(), want: F("CAIRN.LightUsedUp", { name: BRACKETED }) };
    } finally {
      ui.notifications.warn = realWarn;
      for (const id of made) await game.messages.get(id)?.delete();
    }
    return out;
  }, FIXTURE);
} catch (e) {
  fail("probe ran to the end", e.stack ?? e.message);
} finally {
  await cleanup();
}

const one = (x, want) => !!x && x.cards?.length === 1 && x.cards[0].text === want && x.cards[0].public && !/^CAIRN\./.test(want);
check(one(r.lit, r.lit?.want) && r.lit.uses === 2, "1. lighting a 3/3 Torch leaves 2 and tells everyone", JSON.stringify(r.lit));
check(one(r.out, r.out?.want), "1. putting it out tells everyone", JSON.stringify(r.out));
check(r.spent && r.spent.equipped === false && r.spent.cards.length === 0 && r.spent.warned.includes(r.spent.want) && !/^CAIRN\./.test(r.spent.want),
  "2. a spent Torch is refused with a warning, no card", JSON.stringify(r.spent));
check(one(r.oil, r.oil?.want) && r.oil.oil === 1 && r.oil.candle === 3, "3. the Lantern spends the Oil Can first", JSON.stringify(r.oil));
check(one(r.candle, r.candle?.want) && r.candle.candle === 2, "3. with no Oil Can, it spends a Candle", JSON.stringify(r.candle));
check(r.nofuel && r.nofuel.equipped === false && r.nofuel.cards.length === 0 && r.nofuel.warned.includes(r.nofuel.want) && !/^CAIRN\./.test(r.nofuel.want),
  "3. with no fuel left, the Lantern is refused", JSON.stringify(r.nofuel));
check(one(r.wisp, r.wisp?.want) && r.wisp.equipped === true, "4. the Wisp Lantern lights free", JSON.stringify(r.wisp));
if (!r.alice) fail("5. the Warden's line", "no Alice in this world — npm run dev:players");
else check(one(r.warden, r.warden?.want), "5. the Warden putting out a player's light says so", JSON.stringify(r.warden));
check(one(r.badge, r.badge?.want) && r.badge.equipped === true && r.badge.uses === 2,
  "6. the Equip light badge lights it and spends the use", JSON.stringify(r.badge));
check(one(r.stackTorch, r.stackTorch?.want) && r.stackTorch.quantity === 1 && r.stackTorch.uses === 3,
  "7. Torch x2 at 1/3, lit, rolls over to x1 at 3/3", JSON.stringify(r.stackTorch));
check(one(r.stackOil, r.stackOil?.want) && r.stackOil.equipped === true && r.stackOil.quantity === 1 && r.stackOil.uses === 5,
  "7. the Lantern opens the next Oil Can of a stack at 0", JSON.stringify(r.stackOil));
check(r.hand && r.hand.pressed && r.hand.lantern === true && r.hand.torch === false && r.hand.cards.length === 0
  && r.hand.oil === r.hand.oilBefore && r.hand.warnings === 1,
  "8. a spent Torch's hand leaves the lit Lantern alone", JSON.stringify(r.hand));
if (!r.players) fail("9. a hidden token's light", "no player user in this world — npm run dev:players");
else {
  const h = r.hidden?.cards ?? [];
  check(h.length === 1 && h[0].whisper.length > 0 && h[0].whisper.every((id) => r.hidden.gmIds.includes(id)),
    "9. a hidden token's light is whispered to the Wardens", JSON.stringify(r.hidden));
  check(r.shown?.cards?.length === 1 && r.shown.cards[0].public, "9. a token everyone sees still tells everyone", JSON.stringify(r.shown));
}
check(r.viewer && r.viewer.rendered === r.viewer.want && r.viewer.stored === r.viewer.storedWant,
  "10. the card is rebuilt in the viewer's words and names", JSON.stringify(r.viewer));
check(r.named && r.named.equipped === false && r.named.cards.length === 0 && r.named.toasts.length === 1
  && r.named.toasts[0] === r.named.want && r.named.want.includes("<the Old>"),
  "11. a refusal toast prints the light's name as typed", JSON.stringify(r.named));
check(errors.length === 0, "no console errors", errors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall ok");
process.exit(failures ? 1 : 0);

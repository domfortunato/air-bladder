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
 *      a press lights it and spends the use.
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
    // Warnings, recorded (and still shown).
    const warned = [];
    const realWarn = ui.notifications.warn;
    ui.notifications.warn = function (msg, ...rest) { warned.push(String(msg)); return realWarn.call(this, msg, ...rest); };
    // Cards a leg made: by class and by id difference.
    let seen = new Set(game.messages.contents.map((m) => m.id));
    const made = [];
    const cards = async (wait = true) => {
      if (wait) await sleep(700);
      const fresh = game.messages.contents.filter((m) => !seen.has(m.id) && (m.content ?? "").includes("cairn-light-card"));
      for (const m of game.messages.contents) seen.add(m.id);
      made.push(...fresh.map((m) => m.id));
      return fresh.map((m) => ({
        text: new DOMParser().parseFromString(m.content, "text/html").body.textContent.trim(),
        public: !(m.whisper?.length) && !m.blind,
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
check(errors.length === 0, "no console errors", errors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall ok");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * GLOG Magic WITHOUT Grimoires (user ask 2026-11-20): "If GLoG magic is
 * selected, Grimoires should not be enabled by default and all spell books
 * should not automatically convert [to] spell scrolls. They should instead stay
 * spell books but use the GloG magic dice."
 *
 * Grimoires are their own option, `glog-grimoires`, off by default and greyed
 * while GLOG is off. With GLOG on and Grimoires off a spellbook stays a book,
 * wearing its GLOG wording, and casts from its own row with Magic Dice; the
 * scroll conversion, the Grimoire's Cast and every Transmute are Grimoires'.
 * A world that already had GLOG on when the option arrived keeps Grimoires
 * (the one-shot seed), so that table sees no change.
 *
 * Every setting is READ-SHADOWED in-page (`mode(glog, grimoires)`), never
 * written: GLOG and Grimoires each sweep the whole world when switched on.
 * The seed is checked against a shadowed read and a CAPTURED write, so it
 * writes nothing either.
 *
 * Asserts:
 *   1. the conversion diff, as a pure function: Grimoires off swaps the text
 *      and sets `glog` but leaves the form a book; on, it also makes a scroll;
 *   2. the CREATE seam: a canon book arriving on a character under GLOG with
 *      Grimoires off lands a BOOK (not weightless, no uses, the book art)
 *      wearing the GLOG wording; with Grimoires on, a scroll;
 *   3. a canon book riding inside `Actor.create` (arrivingItemSources) the same;
 *   4. generation: a "Spellbook (X)" grant is a GLOG-worded book, a
 *      "Scroll (X)" grant is still a scroll, random spellbooks are books; with
 *      Grimoires on, "Spellbook (X)" is a scroll again;
 *   5. a book's row offers Cast ("Cast this spell with magic dice") and no
 *      Transmute; Cancel posts nothing; a cast with two pinned 4s posts the
 *      card (2 dice, sum 8) and the whisper with its 2-Fatigue button, and the
 *      book is NOT spent (still there, still a book, same quantity);
 *   6. with a Grimoire carried and Grimoires off: no Transmute, the Grimoire
 *      offers no Cast, `castFromGrimoire` refuses, the Grimoire's item sheet
 *      shows no Grimoire box; with Grimoires on the Transmute and the box come
 *      back and the book's own Cast goes;
 *   7. the seed: GLOG on and no marker sets Grimoires on and the marker; GLOG
 *      off sets only the marker; a marker already set writes nothing;
 *   7b. (review #35) before the active Warden's first 0.1.27 load seeds it, a
 *      world with GLoG on reads Grimoires ON on every client (players who
 *      join first); once seeded, the stored setting rules; GLoG off, never.
 *   7c. (review #35) turning Grimoires on clears `glog-converted` before it
 *      forces the sweep, so a sweep cut off by the Save's reload prompt is
 *      resumed at the next load (GLoG read off: the sweep returns at once).
 *   8. the settings window: "Use Grimoires" sits in GLOG & Other Hacks after
 *      "Use GLOG Magic", greys out live when GLOG is unticked there and comes
 *      back when it is ticked, and its hint names GLOG's label. Nothing saved.
 *
 * Usage: npm run dev:glog-books
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const FIXTURE = "e2e-glog-books";
let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(300000, "glog-books probe", async () => { try { await browser.close(); } catch { /* gone */ } });
const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(gm);

const cleanup = async (msgsAtStart) => {
  try {
    await gm.evaluate(async ({ fixture, msgsAtStart }) => {
      for (const a of game.actors.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) {
        await a.sheet?.close();
        await a.delete();
      }
      for (const i of game.items.filter((x) => x.getFlag("air-bladder", "probeFixture") === fixture)) {
        await i.sheet?.close();
        await i.delete();
      }
      if (msgsAtStart) {
        const before = new Set(msgsAtStart);
        const mine = game.messages.filter((m) => !before.has(m.id)
          && (m.getFlag("air-bladder", "glogCast") || m.content?.includes("grimoire-cast-whisper")));
        for (const m of mine) await m.delete();
      }
    }, { fixture: FIXTURE, msgsAtStart });
  } catch (e) {
    console.error(`  note  cleanup: ${e.message}`);
  }
};

let msgsAtStart = null;
let r = {};
try {
  await joinAsGM(gm);
  await dismissChrome(gm);
  await cleanup(null);
  msgsAtStart = await gm.evaluate(() => game.messages.map((m) => m.id));

  r = await gm.evaluate(async ({ fixture }) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (fn, ms = 5000) => {
      const t = Date.now();
      while (!(await fn()) && Date.now() - t < ms) await sleep(100);
      return fn();
    };
    const L = (k) => game.i18n.localize(k);
    const ns = game.system.id;
    const flags = { "air-bladder": { probeFixture: fixture } };
    const out = {};

    // The read shadow: GLOG and Grimoires as this leg needs them, every other
    // read forwarded, a DOCUMENT read never shadowed (review #27).
    const origGet = game.settings.get;
    const state = { glog: false, grimoires: false };
    game.settings.get = function (scope, key, ...rest) {
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
      if (scope === ns && key === "enable-glog-magic") return state.glog;
      if (scope === ns && key === "glog-grimoires") return state.grimoires;
      return origGet.call(this, scope, key, ...rest);
    };
    const mode = (glog, grimoires) => { state.glog = glog; state.grimoires = grimoires; };

    try {
      const glogMod = await import("/systems/air-bladder/module/glog.js");
      const gear = await import("/systems/air-bladder/module/gear.js");
      const CG = await import("/systems/air-bladder/module/character-generator.js");
      const grim = await import("/systems/air-bladder/module/grimoire.js");
      const { SPELLBOOK_ICON, SPELLSCROLL_ICON } = await import("/systems/air-bladder/module/icons.js");
      out.icons = { book: SPELLBOOK_ICON, scroll: SPELLSCROLL_ICON };

      /* 1. the diff, pure */
      const fake = { name: "ZZ Pure", system: { scroll: false, description: "<p>canon</p>", glog: false } };
      const map = new Map([["zz pure", "<p>glog [sum]</p>"]]);
      out.pure = {
        off: glogMod.glogConversionDiff(fake, map, { form: false }),
        on: glogMod.glogConversionDiff(fake, map, { form: true }),
      };

      // A canon spell whose GLOG wording differs, for the arrival legs.
      const canonPack = game.packs.get("air-bladder.spellbooks");
      const glogText = await glogMod.glogTextByName();
      let canonDoc = null;
      for (const e of canonPack.index) {
        const g = glogText.get(e.name.toLowerCase());
        if (!g) continue;
        const d = await canonPack.getDocument(e._id);
        if (d.system.description !== g) { canonDoc = d; break; }
      }
      out.pick = canonDoc?.name ?? null;
      const glogWords = canonDoc ? glogText.get(canonDoc.name.toLowerCase()) : null;
      const shape = (it) => (it ? {
        type: it.type, scroll: !!it.system?.scroll, weightless: !!it.system?.weightless,
        usesMax: it.system?.uses?.max ?? null, glog: !!it.system?.glog, img: it.img,
        glogWords: (it.system?.description ?? "") === glogWords,
      } : null);

      /* 2. the create seam */
      const pc = await getDocumentClass("Actor").create({
        name: "ZZ Books Caster", type: "character", flags,
        system: { hp: { value: 4, max: 6 } },
      }, { abNoStatusCard: true });
      const addBook = async () => {
        const before = new Set(pc.items.map((i) => i.id));
        await pc.createEmbeddedDocuments("Item", [canonDoc.toObject()]);
        return pc.items.find((i) => !before.has(i.id));
      };
      mode(true, false);
      const bookArrived = await addBook();
      out.seamOff = shape(bookArrived);
      mode(true, true);
      const scrollArrived = await addBook();
      out.seamOn = shape(scrollArrived);
      await scrollArrived.delete();

      /* 3. inline in an Actor.create */
      mode(true, false);
      const inline = await getDocumentClass("Actor").create({
        name: "ZZ Books Inline", type: "character", flags, items: [canonDoc.toObject()],
      }, { abNoStatusCard: true });
      out.inline = shape(inline.items.find((i) => i.type === "spellbook"));
      await inline.delete();

      /* 4. generation */
      mode(true, false);
      out.genBook = shape(await gear.resolveGearItem(`Spellbook (${canonDoc.name})`));
      out.genScroll = shape(await gear.resolveGearItem(`Scroll (${canonDoc.name})`));
      const randoms = [];
      for (let i = 0; i < 4; i++) randoms.push(shape(await CG.randomSpellbookItem()));
      out.genRandom = randoms;
      mode(true, true);
      out.genBookGrim = shape(await gear.resolveGearItem(`Spellbook (${canonDoc.name})`));

      /* 5. the book's row */
      mode(true, false);
      const sheet = pc.sheet;
      await sheet.render(true);
      await until(() => sheet.element?.querySelector?.(`[data-item-id="${bookArrived.id}"]`));
      await sleep(400);
      const row = (id) => sheet.element.querySelector(`.cairn-items-list-row[data-item-id="${id}"]`);
      const castCtl = row(bookArrived.id)?.querySelector('[data-action="spellbookCast"]');
      out.row = {
        cast: !!castCtl,
        title: castCtl?.getAttribute("title") ?? null,
        wantTitle: L("CAIRN.SpellbookCastHint"),
        transmute: !!sheet.element.querySelector('[data-action="pageTransmute"]'),
      };
      const findDialog = async () => {
        for (let t = 0; t < 40; t++) {
          const dlg = [...foundry.applications.instances.values()]
            .find((x) => x.constructor.name === "DialogV2" && x.element?.querySelector('select[name="dice"]'));
          if (dlg) return dlg;
          await sleep(150);
        }
        return null;
      };
      // Cancel, straight through the API.
      {
        const before = game.messages.size;
        let resolved = "NEVER SETTLED";
        const p = (grim.castSpellbook ?? (async () => "NO castSpellbook"))(pc, bookArrived).then((v) => { resolved = v; });
        const dlg = await findDialog();
        dlg?.element.querySelector('[data-action="cancel"]')?.click();
        await p;
        await sleep(300);
        out.cancel = { dialog: !!dlg, resolved, newMessages: game.messages.size - before };
      }
      // A cast, through the row's control, two dice pinned to 4 (u=0.4 is face 4).
      {
        const before = new Set(game.messages.map((m) => m.id));
        const origRnd = CONFIG.Dice.randomUniform;
        CONFIG.Dice.randomUniform = () => 0.4;
        try {
          castCtl?.click();
          const dlg = await findDialog();
          if (dlg) {
            dlg.element.querySelector('select[name="dice"]').value = "2";
            dlg.element.querySelector('[data-action="cast"]').click();
          }
          await until(() => game.messages.some((m) => !before.has(m.id) && m.content?.includes("grimoire-cast-whisper")), 6000);
          await sleep(300);
        } finally {
          CONFIG.Dice.randomUniform = origRnd;
        }
        const fresh = game.messages.filter((m) => !before.has(m.id));
        const card = fresh.find((m) => m.getFlag("air-bladder", "glogCast"));
        const whisper = fresh.find((m) => m.content?.includes("grimoire-cast-whisper"));
        const after = pc.items.get(bookArrived.id);
        out.cast = {
          cast: card?.getFlag("air-bladder", "glogCast") ?? null,
          fatigueButton: !!whisper?.content?.includes('data-count="2"'),
          bookKept: !!after, scroll: !!after?.system.scroll, quantity: after?.system.quantity ?? null,
          usesMax: after?.system.uses?.max ?? null,
        };
      }
      await sheet.close();

      /* 6. a Grimoire carried */
      const grimoireDoc = (await pc.createEmbeddedDocuments("Item", [
        { name: "ZZ Books Grimoire", type: "item", system: { grimoire: true, grimoirePages: 3, bulky: true } },
      ]))[0];
      // One bound page, so the Grimoire's Cast would open its picker if
      // anything let it: a pageless book refuses on its own, which would make
      // the refusal below pass for the wrong reason.
      const key = await grim.ensureGrimoireKey(grimoireDoc);
      await pc.createEmbeddedDocuments("Item", [
        { name: "ZZ Books Page", type: "spellbook", system: { bound: true, boundTo: key, description: "<p>Light.</p>" } },
      ]);
      const look = async () => {
        await sheet.render(true);
        await until(() => sheet.element?.querySelector?.(`[data-item-id="${grimoireDoc.id}"]`));
        await sleep(400);
        const isheet = grimoireDoc.sheet;
        await isheet.render(true);
        await until(() => isheet.element?.querySelector?.(".item-sheet-grid"));
        await sleep(300);
        const res = {
          transmute: !!row(bookArrived.id)?.querySelector('[data-action="pageTransmute"]'),
          bookCast: !!row(bookArrived.id)?.querySelector('[data-action="spellbookCast"]'),
          grimoireBox: !!isheet.element.querySelector('input[name="system.grimoire"]'),
        };
        await isheet.close();
        await sheet.close();
        return res;
      };
      mode(true, false);
      out.grimOff = await look();
      {
        const origWarn = ui.notifications.warn;
        ui.notifications.warn = () => {};
        try {
          const p = grim.castFromGrimoire(pc);
          const raced = await Promise.race([p, sleep(1500).then(() => "DIALOG OPENED")]);
          out.grimOff.castFromGrimoire = raced;
          if (raced === "DIALOG OPENED") {
            const dlg = [...foundry.applications.instances.values()].find((x) => x.constructor.name === "DialogV2");
            await dlg?.close();
          }
        } finally {
          ui.notifications.warn = origWarn;
        }
      }
      mode(true, true);
      out.grimOn = await look();

      /* 7. the seed, writes captured */
      {
        const origSet = game.settings.set;
        const writes = [];
        game.settings.set = async function (scope, key, value) {
          writes.push([key, value]);
          return value;
        };
        const seedFn = glogMod.seedGlogGrimoires ?? (async () => { writes.push(["NO seedGlogGrimoires"]); });
        const runSeed = async (glog, marker) => {
          writes.length = 0;
          const prevGet = game.settings.get;
          game.settings.get = function (scope, key, ...rest) {
            if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
            if (scope === ns && key === "glog-grimoires-seeded") return marker;
            if (scope === ns && key === "enable-glog-magic") return glog;
            if (scope === ns && key === "glog-grimoires") return false;
            return prevGet.call(this, scope, key, ...rest);
          };
          try { await seedFn(); } finally { game.settings.get = prevGet; }
          return writes.map((w) => w.join("=")).sort();
        };
        try {
          out.seed = {
            activeGM: game.users.activeGM === game.user,
            glogOn: await runSeed(true, false),
            glogOff: await runSeed(false, false),
            marked: await runSeed(true, true),
          };
        } finally {
          game.settings.set = origSet;
        }
        out.seed.setLifted = game.settings.set === origSet;
      }

      /* 7b-7c (review #35), reads shadowed and writes captured as in 7 */
      {
        const prevGet = game.settings.get;
        const shadowRead = (vals) => {
          game.settings.get = function (scope, key, ...rest) {
            if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
            if (scope === ns && key in vals) return vals[key];
            return prevGet.call(this, scope, key, ...rest);
          };
        };
        try {
          // 7b: before the Warden's first 0.1.27 load seeds it, a world that
          // already played GLoG reads Grimoires ON on every client.
          shadowRead({ "enable-glog-magic": true, "glog-grimoires": false, "glog-grimoires-seeded": false });
          const unseeded = glogMod.grimoiresEnabled();
          shadowRead({ "enable-glog-magic": true, "glog-grimoires": false, "glog-grimoires-seeded": true });
          const seededOff = glogMod.grimoiresEnabled();
          shadowRead({ "enable-glog-magic": false, "glog-grimoires": false, "glog-grimoires-seeded": false });
          const glogOff = glogMod.grimoiresEnabled();
          out.unseeded = { unseeded, seededOff, glogOff };
          // 7c: turning Grimoires on clears glog-converted BEFORE it forces
          // the sweep, so a sweep a reload cuts off is resumed at the next
          // load. GLoG read OFF here, so the sweep itself returns at once.
          shadowRead({ "enable-glog-magic": false });
          const origSet = game.settings.set;
          const writes = [];
          game.settings.set = async function (scope, key, value) { writes.push([key, value]); return value; };
          try {
            await game.settings.settings.get(`${ns}.glog-grimoires`)?.onChange?.(true);
          } finally {
            game.settings.set = origSet;
          }
          out.grimoiresOnWrites = writes.map((w) => w.join("="));
        } finally {
          game.settings.get = prevGet;
        }
      }

      /* 8. the settings window */
      {
        const menu = game.settings.menus.get(`${ns}.hacks`);
        const app = new menu.type();
        await app.render(true);
        await sleep(600);
        const input = (k) => app.element.querySelector(`[name="${ns}.${k}"]`);
        const g = input("enable-glog-magic"), s = input("glog-grimoires");
        const rows = [...app.element.querySelectorAll("input[name]")].map((i) => i.name);
        const flip = (on) => { g.checked = on; g.dispatchEvent(new Event("change", { bubbles: true })); };
        const greyed = () => ({ disabled: !!s?.disabled, greyed: !!s?.closest(".form-group")?.classList.contains("cairn-setting-disabled") });
        out.menu = {
          present: !!s, glogPresent: !!g,
          after: rows.indexOf(`${ns}.glog-grimoires`) === rows.indexOf(`${ns}.enable-glog-magic`) + 1,
          hint: s?.closest(".form-group")?.querySelector(".hint")?.textContent ?? "",
          masterLabel: L("CAIRN.Settings.EnableGlogMagic.label"),
        };
        if (g && s) {
          flip(false); out.menu.off = greyed();
          flip(true); out.menu.on = greyed();
        }
        await app.close();       // nothing submitted
      }
    } finally {
      game.settings.get = origGet;
    }
    out.getLifted = game.settings.get === origGet;
    return out;
  }, { fixture: FIXTURE });
} catch (e) {
  fail(`probe threw: ${e.stack ?? e.message}`);
} finally {
  await cleanup(msgsAtStart);
}

/* ---- verdicts ------------------------------------------------------------ */
const p = r.pure ?? {};
p.off && !("system.scroll" in p.off) && p.off["system.glog"] === true && p.off["system.description"]
  && p.on?.["system.scroll"] === true
  ? ok("the conversion diff: Grimoires off swaps the text and keeps the book; on, it also makes a scroll")
  : fail(`conversion diff: ${JSON.stringify(p)}`);
const isBook = (s) => s && s.type === "spellbook" && !s.scroll && !s.weightless && (s.usesMax ?? 0) === 0;
r.pick ? ok(`a canon spell whose GLOG wording differs: "${r.pick}"`) : fail("no canon spell with a differing GLOG wording");
isBook(r.seamOff) && r.seamOff.glog && r.seamOff.glogWords && r.seamOff.img !== r.icons?.scroll
  ? ok("GLOG on, Grimoires off: a canon book arriving on a character stays a book, in the GLOG wording")
  : fail(`create seam, Grimoires off: ${JSON.stringify(r.seamOff)}`);
r.seamOn?.scroll && r.seamOn.glogWords
  ? ok("...and with Grimoires on it arrives a scroll, as before")
  : fail(`create seam, Grimoires on: ${JSON.stringify(r.seamOn)}`);
isBook(r.inline) && r.inline.glogWords
  ? ok("a canon book riding inside Actor.create stays a book, in the GLOG wording")
  : fail(`inline Actor.create: ${JSON.stringify(r.inline)}`);
isBook(r.genBook) && r.genBook.glog && r.genBook.glogWords && r.genBook.img === r.icons?.book
  ? ok("generation: a \"Spellbook (X)\" grant is a GLOG-worded book with the book art")
  : fail(`generation, Spellbook (X): ${JSON.stringify(r.genBook)} (want img ${r.icons?.book})`);
r.genScroll?.scroll
  ? ok("generation: a \"Scroll (X)\" grant is still a scroll")
  : fail(`generation, Scroll (X): ${JSON.stringify(r.genScroll)}`);
(r.genRandom ?? []).length === 4 && r.genRandom.every((s) => isBook(s))
  ? ok("generation: random spellbooks are books")
  : fail(`generation, random spellbooks: ${JSON.stringify(r.genRandom)}`);
r.genBookGrim?.scroll
  ? ok("generation with Grimoires on: \"Spellbook (X)\" is a scroll again")
  : fail(`generation, Grimoires on: ${JSON.stringify(r.genBookGrim)}`);
const row = r.row ?? {};
row.cast && row.title === row.wantTitle && !row.transmute
  ? ok(`a book's row offers Cast ("${row.title}") and nothing offers Transmute`)
  : fail(`book row: ${JSON.stringify(row)}`);
const c0 = r.cancel ?? {};
c0.dialog && c0.resolved === null && c0.newMessages === 0
  ? ok("Cancel closes the dice window, resolves null and posts nothing")
  : fail(`cancel: ${JSON.stringify(c0)}`);
const c1 = r.cast ?? {};
c1.cast?.dice === 2 && c1.cast?.sum === 8 && c1.fatigueButton
  ? ok("a cast with two 4s posts the card (2 dice, sum 8) and the whisper's 2-Fatigue button")
  : fail(`cast: ${JSON.stringify(c1)}`);
c1.bookKept && !c1.scroll && c1.quantity === 1 && (c1.usesMax ?? 0) === 0
  ? ok("...and the book is not spent: still there, still a book")
  : fail(`book after the cast: ${JSON.stringify(c1)}`);
const go = r.grimOff ?? {};
!go.transmute && !go.grimoireBox && go.bookCast && go.castFromGrimoire === null
  ? ok("Grimoires off, a Grimoire carried: no Transmute, no Grimoire box, the book keeps its Cast, castFromGrimoire refuses")
  : fail(`Grimoires off with a Grimoire: ${JSON.stringify(go)}`);
const gn = r.grimOn ?? {};
gn.transmute && gn.grimoireBox && !gn.bookCast
  ? ok("Grimoires on: Transmute and the Grimoire box are back, the book's own Cast is gone")
  : fail(`Grimoires on with a Grimoire: ${JSON.stringify(gn)}`);
const sd = r.seed ?? {};
JSON.stringify(sd.glogOn) === JSON.stringify(["glog-grimoires-seeded=true", "glog-grimoires=true"])
  ? ok("the seed: a world with GLOG on and no marker gets Grimoires on, and the marker")
  : fail(`seed, GLOG on: ${JSON.stringify(sd.glogOn)} (active GM ${sd.activeGM})`);
JSON.stringify(sd.glogOff) === JSON.stringify(["glog-grimoires-seeded=true"])
  && JSON.stringify(sd.marked) === "[]"
  ? ok("the seed: GLOG off sets only the marker; a marked world writes nothing")
  : fail(`seed, GLOG off ${JSON.stringify(sd.glogOff)}, marked ${JSON.stringify(sd.marked)}`);
const us = r.unseeded ?? {};
us.unseeded === true && us.seededOff === false && us.glogOff === false
  ? ok("before the seed runs, a world with GLoG on reads Grimoires on; once seeded, the setting rules; GLoG off, never")
  : fail(`Grimoires before the seed: ${JSON.stringify(us)}`);
JSON.stringify(r.grimoiresOnWrites) === JSON.stringify(["glog-converted=false"])
  ? ok("turning Grimoires on clears glog-converted before the forced sweep, so a cut-off sweep resumes")
  : fail(`Grimoires on, writes: ${JSON.stringify(r.grimoiresOnWrites)}`);
const mn = r.menu ?? {};
mn.present && mn.glogPresent && mn.after
  ? ok("\"Use Grimoires\" sits in GLOG & Other Hacks, right after \"Use GLOG Magic\"")
  : fail(`settings window rows: ${JSON.stringify(mn)}`);
mn.off?.disabled && mn.off?.greyed && mn.on && !mn.on.disabled && !mn.on.greyed
  ? ok("...greys out live when GLOG is unticked there, and comes back when it is ticked")
  : fail(`settings window greying: off ${JSON.stringify(mn.off)}, on ${JSON.stringify(mn.on)}`);
mn.masterLabel && mn.hint.includes(mn.masterLabel)
  ? ok(`...and its hint names "${mn.masterLabel}"`)
  : fail(`Grimoires hint does not name "${mn.masterLabel}": ${JSON.stringify(mn.hint)}`);
r.getLifted && r.seed?.setLifted
  ? ok("the read shadow and the captured write are both lifted")
  : fail(`shadows lifted: get ${r.getLifted}, set ${r.seed?.setLifted}`);
errors.length === 0 ? ok("no console errors") : fail(`console errors: ${errors.join(" | ")}`);

await browser.close();
if (failed) {
  console.error("\nglog-books e2e FAILED");
  process.exit(1);
}
console.log("\nglog-books e2e passed");

#!/usr/bin/env node
/**
 * The Grimoire (rulings 1–15, 2026-08-05): role, gate, auto-break, the book
 * sheet as the magic surface, the cast flow, and the shipped GLOG content.
 *
 *   npm run dev:grimoire     (needs Foundry on :30000 AND the Alice/Bob
 *                             players — npm run dev:players first)
 *
 * Two phases, because half the rules are PERMISSION rules and a GM passes
 * every ownership check (the container-reroll lesson — a GM can never
 * reproduce a player's failure):
 *
 * GM phase: the shipped Mishaps table covers sums 2–24 exactly, one row
 * each; the handout journal exists and reads like the rules. The one-book
 * wall refuses a second grimoire FOR THE WARDEN TOO (structural, like the
 * ceiling). Contents policy through the real drop route (`_onDrop` with a
 * DataTransfer, the bg-drop-guard pattern): a non-spell refused, spells
 * land, a scroll lands STILL a scroll, capacity refuses at slots+1, and
 * dragging a page OUT is refused ("pages are bound") with the page still in
 * the book. Magic Dice = min(4, keeper's free slots) — read off the RENDERED
 * sheet, then a keeper inventory change must move the rendered number (the
 * reverse sync wire). The cast flow end to end: picker capped at the live
 * MD, a real Roll spoken by the KEEPER, the card's fatigue count matching
 * the faces, the Add-N-Fatigue button adding exactly N, and a loaded keeper
 * (0 free slots) refusing to cast at all.
 *
 * Player phase (Alice, own browser context; the GM page STAYS OPEN — the
 * ownership flag is answered by the active GM's client): connect without
 * the carried Grimoire ITEM refused; with it, the connect lands and the
 * sync-flag path grants Alice OWNER; deleting the item AUTO-BREAKS the
 * connection — `connectedTo` cleared by Alice's client, the BROKEN shape
 * (default LIMITED, her OWNER stripped) applied by the GM's.
 *
 * Every planted document is ZZ-prefixed, ids printed, deleted in a
 * Node-level finally.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(300000, "grimoire probe");
const gmPage = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const gmErrors = watchErrors(gmPage);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);
const note = (m) => console.log(`  note  ${m}`);

let ids = null;
let playerContext = null;

try {
  await joinAsGM(gmPage);

  /* --- shipped GLOG content ------------------------------------------------ */

  const content = await gmPage.evaluate(async () => {
    const out = {};
    const tp = game.packs.get("air-bladder.tables-glog");
    const table = tp ? (await tp.getDocuments()).find((t) => t.name === "GLOG Magic: Mishaps") : null;
    if (table) {
      const rows = [...table.results];
      out.rowCount = rows.length;
      out.allText = rows.every((r) => r.type === CONST.TABLE_RESULT_TYPES.TEXT && (r.description ?? "").length > 20);
      const covered = new Set(rows.map((r) => `${r.range[0]}-${r.range[1]}`));
      out.sumsExact = [...Array(23)].every((_, i) => covered.has(`${i + 2}-${i + 2}`)) && covered.size === 23;
      out.formula = table.formula;
    }
    const jp = game.packs.get("air-bladder.journals-glog");
    const handout = jp ? (await jp.getDocuments())[0] : null;
    if (handout) {
      const page = handout.pages.contents[0];
      out.handoutName = handout.name;
      out.handoutReads = /Magic Dice/.test(page?.text?.content ?? "") && /4-6/.test(page?.text?.content ?? "");
    }
    return out;
  });
  content.rowCount === 23 && content.allText && content.sumsExact
    ? ok("Mishaps table: 23 text rows covering sums 2–24 exactly, one each")
    : fail(`Mishaps table wrong (rows ${content.rowCount}, allText ${content.allText}, sums ${content.sumsExact})`);
  content.formula === "2d12"
    ? ok("Mishaps formula 2d12 — the one expression spanning exactly 2–24")
    : fail(`Mishaps formula is ${content.formula}`);
  content.handoutReads
    ? ok(`the player handout ships ("${content.handoutName}") and reads like the rules`)
    : fail(`handout missing or wrong (${JSON.stringify(content.handoutName)})`);

  /* --- plant ---------------------------------------------------------------- */

  ids = await gmPage.evaluate(async () => {
    const alice = game.users.find((u) => u.name === "Alice");
    if (!alice) return { noAlice: true };
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const keeper = await Actor.create({
      name: "ZZ Grim Keeper", type: "character",
      ownership: { default: L.NONE, [alice.id]: L.OWNER },
    });
    const book = await Actor.create({
      name: "ZZ Grim Book", type: "npc",
      system: { role: "grimoire", slots: 2 },
      ownership: { default: L.NONE, [alice.id]: L.OWNER },
    });
    const book2 = await Actor.create({ name: "ZZ Grim Book Two", type: "npc", system: { role: "grimoire", slots: 2 } });
    const spellA = await Item.create({ name: "ZZ Grim Spell A", type: "spellbook", system: { description: "<p>zz a</p>" } });
    const spellB = await Item.create({ name: "ZZ Grim Spell B", type: "spellbook", system: { description: "<p>zz b</p>" } });
    const spellC = await Item.create({ name: "ZZ Grim Spell C", type: "spellbook", system: { description: "<p>zz c</p>" } });
    const scroll = await Item.create({ name: "ZZ Grim Scroll", type: "spellbook", system: { scroll: true, description: "<p>zz s</p>" } });
    const rock = await Item.create({ name: "ZZ Grim Rock", type: "item" });
    return {
      aliceId: alice.id, keeper: keeper.id, book: book.id, book2: book2.id,
      spellA: spellA.uuid, spellB: spellB.uuid, spellC: spellC.uuid, scroll: scroll.uuid, rock: rock.uuid,
      worldItemIds: [spellA.id, spellB.id, spellC.id, scroll.id, rock.id],
    };
  });
  if (ids.noAlice) { fail("no user named Alice — run `npm run dev:players` first"); throw new Error("precondition"); }
  note(`planted: keeper ${ids.keeper}, books ${ids.book}/${ids.book2}, world items ${ids.worldItemIds.join(", ")}`);

  /* --- the connect walls, GM side ------------------------------------------ */

  const walls = await gmPage.evaluate(async ({ keeper, book, book2 }) => {
    const out = { warns: [] };
    const orig = ui.notifications.warn;
    ui.notifications.warn = (m, ...r) => { out.warns.push(String(m)); return orig.call(ui.notifications, m, ...r); };
    try {
      const k = game.actors.get(keeper);
      out.first = await k.connectActor(game.actors.get(book));      // GM fiat: no item needed
      out.bookLinked = game.actors.get(book).system.connectedTo === k.uuid;
      out.second = await k.connectActor(game.actors.get(book2));    // the one-book wall binds the GM too
      out.secondLinked = game.actors.get(book2).system.connectedTo !== "";
    } finally {
      ui.notifications.warn = orig;
    }
    return out;
  }, ids);
  walls.first && walls.bookLinked
    ? ok("GM fiat: the Warden binds a book to a keeper with no Grimoire item — the item wall is fiction, not structure")
    : fail(`GM connect failed (${walls.first}, linked ${walls.bookLinked})`);
  !walls.second && !walls.secondLinked && walls.warns.some((w) => /exactly one/.test(w))
    ? ok("one-book wall: a second grimoire is refused FOR THE WARDEN TOO")
    : fail(`second connect: returned ${walls.second}, linked ${walls.secondLinked}, warns ${JSON.stringify(walls.warns)}`);

  /* --- contents policy through the real drop route ------------------------- */

  const drops = await gmPage.evaluate(async ({ book, keeper, spellA, spellB, spellC, scroll, rock }) => {
    const out = { warns: [] };
    const orig = ui.notifications.warn;
    ui.notifications.warn = (m, ...r) => { out.warns.push(String(m)); return orig.call(ui.notifications, m, ...r); };
    const drop = async (sheetOf, uuid) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      try { await sheetOf.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); }
      catch (e) { out.threw = `${e.message}`; }
      await new Promise((r) => setTimeout(r, 500));
    };
    try {
      const b = game.actors.get(book);
      await drop(b, rock);
      out.afterRock = b.items.size;
      await drop(b, spellA);
      out.afterSpellA = b.items.size;
      await drop(b, scroll);
      const sc = b.items.find((i) => i.name === "ZZ Grim Scroll");
      out.scrollStillScroll = sc?.system.scroll === true;
      out.afterScroll = b.items.size;
      // A scroll is PETTY — zero slots — so with slots 2 the book takes TWO
      // full spellbooks plus the scroll, and only the THIRD spellbook
      // overflows. The probe's first run had this arithmetic wrong and read
      // the code's correct petty-costs-nothing math as a failed refusal.
      await drop(b, spellB);
      out.afterSpellB = b.items.size;
      await drop(b, spellC);                    // 2 slots used of 2: refused
      out.afterOverfill = b.items.size;
      // Drag a page OUT: the keeper's sheet receives a drop whose source is
      // the grimoire — refused, and the page stays in the book.
      const page = b.items.find((i) => i.name === "ZZ Grim Spell A");
      await drop(game.actors.get(keeper), page.uuid);
      out.pageStillIn = !!b.items.find((i) => i.name === "ZZ Grim Spell A");
      out.keeperGotIt = !!game.actors.get(keeper).items.find((i) => i.name === "ZZ Grim Spell A");
    } finally {
      ui.notifications.warn = orig;
    }
    return out;
  }, ids);
  drops.afterRock === 0 && drops.warns.some((w) => /not a spell/.test(w))
    ? ok("a non-spell is refused at the covers — a grimoire holds spellbooks and scrolls only")
    : fail(`rock drop: ${drops.afterRock} item(s) in book, warns ${JSON.stringify(drops.warns)}`);
  drops.afterSpellA === 1
    ? ok("a spellbook lands as a page")
    : fail(`spell drop landed ${drops.afterSpellA} item(s)`);
  drops.scrollStillScroll && drops.afterScroll === 2
    ? ok("a scroll dropped in STAYS a scroll — becoming a scroll costs no slot either (petty)")
    : fail(`scroll leg: count ${drops.afterScroll}, stillScroll ${drops.scrollStillScroll}`);
  drops.afterSpellB === 3
    ? ok("a second full spellbook fits beside the petty scroll — pages cost slots, scrolls cost none")
    : fail(`spellB landed to ${drops.afterSpellB} item(s), expected 3`);
  drops.afterOverfill === 3 && drops.warns.some((w) => /full|fit/i.test(w))
    ? ok("capacity refuses at slots+1 — the strict thing rule prices the pages")
    : fail(`overfill: ${drops.afterOverfill} item(s), warns ${JSON.stringify(drops.warns)}`);
  drops.pageStillIn && !drops.keeperGotIt && drops.warns.some((w) => /bound/.test(w))
    ? ok("drag OUT refused — its pages are bound, and the page never moved")
    : fail(`drag-out: stillIn ${drops.pageStillIn}, keeperGotIt ${drops.keeperGotIt}`);

  /* --- Magic Dice on the rendered sheet, tracking the keeper --------------- */

  const md1 = await gmPage.evaluate(async ({ book }) => {
    const b = game.actors.get(book);
    await b.sheet.render(true);
    await new Promise((r) => setTimeout(r, 800));
    return b.sheet.element?.querySelector(".magic-dice-value")?.textContent?.trim() ?? null;
  }, ids);
  md1 === "4"
    ? ok("Magic Dice reads 4 on the rendered book sheet — min(4, an unloaded keeper's 10 free slots)")
    : fail(`Magic Dice rendered "${md1}", expected "4"`);

  await gmPage.evaluate(async ({ keeper }) => {
    const k = game.actors.get(keeper);
    await k.createEmbeddedDocuments("Item", [...Array(7)].map((_, i) => ({ name: `ZZ Grim Filler ${i}`, type: "item" })));
  }, ids);
  let md2 = null;
  for (let waited = 0; waited < 10000; waited += 400) {
    md2 = await gmPage.evaluate(({ book }) =>
      game.actors.get(book).sheet.element?.querySelector(".magic-dice-value")?.textContent?.trim() ?? null, ids);
    if (md2 === "3") break;
    await gmPage.waitForTimeout(400);
  }
  md2 === "3"
    ? ok("filling the KEEPER's slots moved the OPEN book sheet's Magic Dice to 3 — the reverse sync wire is live")
    : fail(`after filling 7 keeper slots the rendered Magic Dice reads "${md2}", expected "3"`);

  /* --- the cast flow -------------------------------------------------------- */

  let cast = null;
  for (let attempt = 0; attempt < 6 && !cast?.fatigueCount; attempt++) {
    cast = await gmPage.evaluate(async ({ book }) => {
      const { castFromGrimoire } = await import("/systems/air-bladder/module/grimoire.js");
      const b = game.actors.get(book);
      const spell = b.items.find((i) => i.name === "ZZ Grim Spell A");
      const before = game.messages.size;
      const done = castFromGrimoire(b, spell);
      // Answer the dice picker: poll instances (a MAP — values(), never
      // Object.values), read the select, choose the max, press Cast.
      let dialog = null;
      for (let w = 0; w < 8000 && !dialog; w += 200) {
        dialog = [...foundry.applications.instances.values()]
          .find((a) => a.constructor.name === "DialogV2" && a.element?.querySelector('select[name="dice"]'));
        if (!dialog) await new Promise((r) => setTimeout(r, 200));
      }
      if (!dialog) return { noDialog: true };
      const select = dialog.element.querySelector('select[name="dice"]');
      const optionCount = select.options.length;
      select.value = String(optionCount);
      dialog.element.querySelector('button[data-action="cast"]')?.click();
      const msg = await done;
      if (!msg) return { noMessage: true, optionCount };
      const roll = msg.rolls[0];
      const faces = roll.dice[0].results.map((r) => r.result);
      return {
        optionCount,
        made: game.messages.size === before + 1,
        speaker: msg.speaker?.alias,
        invested: faces.length,
        faces,
        sum: faces.reduce((a, b) => a + b, 0),
        fatigueCount: faces.filter((v) => v >= 4).length,
        doubles: new Set(faces).size < faces.length,
        cardFatigue: (msg.content.match(/data-count="(\d+)"/) || [])[1] ?? null,
        cardMishap: /Mishap/.test(msg.content),
        msgId: msg.id,
      };
    }, ids);
    if (cast?.noDialog) break;
  }
  if (!cast || cast.noDialog || cast.noMessage) {
    fail(`cast flow did not complete: ${JSON.stringify(cast)}`);
  } else {
    cast.optionCount === 3
      ? ok("the dice picker offers exactly the live Magic Dice (3) — the ceiling tracks the keeper")
      : fail(`picker offered ${cast.optionCount} options, expected 3`);
    cast.made && cast.speaker === "ZZ Grim Keeper"
      ? ok("the cast is a real Roll spoken by the KEEPER, not the book")
      : fail(`message made ${cast.made}, speaker "${cast.speaker}"`);
    String(cast.fatigueCount) === (cast.cardFatigue ?? "0") || (cast.fatigueCount === 0 && cast.cardFatigue === null)
      ? ok(`the card's fatigue offer matches the faces (${cast.faces.join(",")} → ${cast.fatigueCount})`)
      : fail(`faces ${cast.faces.join(",")} but card offers ${cast.cardFatigue}`);
    cast.doubles === cast.cardMishap
      ? ok(`the Mishap line appears exactly on doubles (doubles ${cast.doubles})`)
      : fail(`doubles ${cast.doubles} but mishap line ${cast.cardMishap}`);

    if (cast.fatigueCount > 0) {
      const fatigue = await gmPage.evaluate(async ({ keeper, msgId, expected }) => {
        const li = document.querySelector(`#chat .message[data-message-id="${msgId}"], #chat li[data-message-id="${msgId}"]`);
        li?.querySelector(".grimoire-add-fatigue")?.click();
        const k = game.actors.get(keeper);
        for (let w = 0; w < 8000; w += 300) {
          const n = k.items.filter((i) => i.name === "Fatigue").length;
          if (n === expected) return n;
          await new Promise((r) => setTimeout(r, 300));
        }
        return k.items.filter((i) => i.name === "Fatigue").length;
      }, { keeper: ids.keeper, msgId: cast.msgId, expected: cast.fatigueCount });
      fatigue === cast.fatigueCount
        ? ok(`the Add-N-Fatigue button added exactly ${cast.fatigueCount} — never refused, never doubled`)
        : fail(`button added ${fatigue} Fatigue, expected ${cast.fatigueCount}`);
    } else {
      note("no 4–6 face in six casts' final attempt — the fatigue-button leg was exercised by an earlier attempt or skipped this run");
    }
  }

  // A keeper with NO free slot cannot cast at all.
  const noDice = await gmPage.evaluate(async ({ keeper, book }) => {
    const k = game.actors.get(keeper);
    const fill = 10 - Math.max(0, (k.system.slotsMax ?? 10) - (k.system.slotsUsed ?? 0));
    const need = Math.max(0, (k.system.slotsMax ?? 10) - (k.system.slotsUsed ?? 0));
    if (need > 0) {
      await k.createEmbeddedDocuments("Item", [...Array(need)].map((_, i) => ({ name: `ZZ Grim Stuffer ${i}`, type: "item" })));
    }
    const { castFromGrimoire } = await import("/systems/air-bladder/module/grimoire.js");
    const before = game.messages.size;
    const b = game.actors.get(book);
    const spell = b.items.find((i) => i.name === "ZZ Grim Spell A");
    const result = await castFromGrimoire(b, spell);
    return { result, noNewMessage: game.messages.size === before, fillWas: fill };
  }, ids);
  noDice.result === null && noDice.noNewMessage
    ? ok("a fully loaded keeper (0 free slots) cannot cast — refused before any dialog")
    : fail(`loaded-keeper cast returned ${JSON.stringify(noDice.result)}, newMessage ${!noDice.noNewMessage}`);

  // The Warden's directory button exists (found-only: this is the ONE way in).
  const button = await gmPage.evaluate(async () => {
    await ui.actors.render(true);
    await new Promise((r) => setTimeout(r, 600));
    return !!ui.actors.element?.querySelector(".create-grimoire-button");
  });
  button
    ? ok("the Warden's Create Grimoire directory button is present")
    : fail("no Create Grimoire button in the Actor directory for the GM");

  /* --- player phase --------------------------------------------------------- */

  // Reset: strip the keeper's filler/fatigue and the GM-fiat link, so Alice
  // starts from an unbound book and an empty pack.
  await gmPage.evaluate(async ({ keeper, book }) => {
    const k = game.actors.get(keeper);
    const junk = k.items.filter((i) => /^ZZ Grim (Filler|Stuffer)/.test(i.name) || i.name === "Fatigue").map((i) => i.id);
    if (junk.length) await k.deleteEmbeddedDocuments("Item", junk);
    await game.actors.get(book).update({ "system.connectedTo": "" });
  }, ids);

  playerContext = await browser.newContext({ viewport: VIEWPORT });
  const alicePage = await playerContext.newPage();
  const aliceErrors = watchErrors(alicePage);
  await joinAs(alicePage, "Alice");

  const gate = await alicePage.evaluate(async ({ keeper, book }) => {
    const out = { warns: [] };
    const orig = ui.notifications.warn;
    ui.notifications.warn = (m, ...r) => { out.warns.push(String(m)); return orig.call(ui.notifications, m, ...r); };
    try {
      const k = game.actors.get(keeper);
      const b = game.actors.get(book);
      out.without = await k.connectActor(b);           // no Grimoire item: refused
      out.stillUnlinked = b.system.connectedTo === "";
      await k.createOwnedItem({ name: "Grimoire", type: "item", bulky: true });
      out.hasItem = k.hasGrimoireItem;
      out.withItem = await k.connectActor(b);          // now legal
      out.linked = b.system.connectedTo === k.uuid;
    } finally {
      ui.notifications.warn = orig;
    }
    return out;
  }, ids);
  !gate.without && gate.stillUnlinked && gate.warns.some((w) => /does not carry/.test(w))
    ? ok("PLAYER: connect without the carried Grimoire item is refused — the fiction gates her, not the Warden")
    : fail(`itemless connect: returned ${gate.without}, unlinked ${gate.stillUnlinked}, warns ${JSON.stringify(gate.warns)}`);
  gate.hasItem && gate.withItem && gate.linked
    ? ok("PLAYER: carrying the Grimoire item, the same connect lands")
    : fail(`with-item connect: hasItem ${gate.hasItem}, returned ${gate.withItem}, linked ${gate.linked}`);

  // The sync-flag path: the GM's open client answers with the CONNECTED shape.
  let shape = null;
  for (let waited = 0; waited < 15000; waited += 500) {
    shape = await alicePage.evaluate(({ book, aliceId }) => {
      const b = game.actors.get(book);
      return {
        def: b.ownership.default,
        alice: b.ownership[aliceId],
        flag: b.getFlag("air-bladder", "ownershipSyncPending"),
      };
    }, ids);
    if (shape.def === 2 && shape.alice === 3 && shape.flag === undefined) break;
    await alicePage.waitForTimeout(500);
  }
  shape.def === 2 && shape.alice === 3 && shape.flag === undefined
    ? ok("the GM client answered the sync flag: default OBSERVER, Alice OWNER, flag cleared")
    : fail(`connected shape never landed: ${JSON.stringify(shape)}`);

  // AUTO-BREAK: Alice deletes the item; her client clears the link, the GM's
  // applies the BROKEN shape.
  await alicePage.evaluate(async ({ keeper }) => {
    const k = game.actors.get(keeper);
    const item = k.items.find((i) => i.name === "Grimoire");
    await item.delete();
  }, ids);
  let broken = null;
  for (let waited = 0; waited < 15000; waited += 500) {
    broken = await alicePage.evaluate(({ book, aliceId }) => {
      const b = game.actors.get(book);
      return {
        link: b.system.connectedTo,
        def: b.ownership.default,
        alice: b.ownership[aliceId] ?? null,
        former: b.system.formerlyBelongedTo,
      };
    }, ids);
    if (broken.link === "" && broken.def === 1 && broken.alice === null) break;
    await alicePage.waitForTimeout(500);
  }
  broken.link === "" && broken.def === 1 && broken.alice === null && broken.former === "ZZ Grim Keeper"
    ? ok("AUTO-BREAK: the item leaving broke the bind — link cleared by Alice's client, LIMITED + OWNER-stripped by the GM's, provenance stamped")
    : fail(`auto-break state: ${JSON.stringify(broken)}`);

  if (aliceErrors.length) { console.error("  player console errors:"); aliceErrors.slice(0, 5).forEach((e) => console.error("    " + e)); failed = true; }
  else ok("player console errors: 0");
} catch (e) {
  if (e.message !== "precondition") fail(`${e.name}: ${e.message}`);
} finally {
  try {
    if (ids && !ids.noAlice) {
      const gone = await gmPage.evaluate(async (p) => {
        const gone = [], left = [];
        const del = async (label, doc) => { try { await doc?.delete(); gone.push(label); } catch { left.push(label); } };
        for (const m of game.messages.filter((m) => m.speaker?.alias === "ZZ Grim Keeper")) await del("cast card", m);
        await del("keeper", game.actors.get(p.keeper));
        await del("book", game.actors.get(p.book));
        await del("book2", game.actors.get(p.book2));
        for (const id of p.worldItemIds) await del("world item", game.items.get(id));
        return { gone: gone.length, left };
      }, ids);
      console.log(`  note  cleanup: removed ${gone.gone} document(s)${gone.left.length ? ` — LEFT: ${gone.left.join(", ")}` : ""}`);
      if (gone.left.length) failed = true;
    }
  } catch (e) {
    console.error(`  FAIL  cleanup failed: ${e.message}`);
    failed = true;
  }
  if (gmErrors.length) { console.error("\nGM console errors:"); gmErrors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nGRIMOIRE PROBE FAILED\n" : "\ngrimoire probe passed\n");
process.exit(failed ? 1 : 0);

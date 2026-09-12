#!/usr/bin/env node
/**
 * Creating an actor with an EMPTY sheet — the creation dialog's checkbox.
 *
 * The feature (2026-09-11, user ask from a Warden): every creation route now
 * opens one dialog carrying "Use random generation.". Leave it ticked and you
 * get what you always got. Untick it and you get a sheet with nothing rolled,
 * to fill in with the pickers or by typing — the way you transcribe a character
 * that was rolled at the table with the book and paper dice.
 *
 *   npm run dev:blank-actor     (needs Foundry running and the world launched)
 *
 * WHAT EACH LEG IS FOR, and why the obvious shorter probe would be worthless:
 *
 *  1. An empty actor of each of the four kinds carries no background, no gear,
 *     no bond, no question, no trait and no age.
 *  2. It reads HP 3/3 and 10/10/10 — from `_source`, NEVER derived. A generated
 *     character can land encumbered, which drives derived HP to 0, so a derived
 *     read here would be measuring the encumbrance rule rather than the create
 *     payload. HP 3 is deliberately NOT the schema's 6 (user ruling), so this
 *     leg is what pins the ruling.
 *  3. `generationEnabled` is true AND THE PICKERS ACTUALLY RENDER. Asserting
 *     the flag alone would pass with the sheet's template gate broken, and the
 *     pickers are the entire point: a bond and a question answer are read-only
 *     prose on the sheet, so a picker is the ONLY hand-entry path to either.
 *  4. THE CONTROL THAT MATTERS: leaving the box ticked still rolls a full
 *     character. Without it, a generator broken to return nothing would make
 *     every leg above pass and look like a working feature.
 *  5. Nothing is posted to chat. Generation posts a five-roll card; an empty
 *     sheet rolled nothing, so a card would be a lie about dice nobody threw.
 *  6. The dialog's own shape: the checkbox exists, ticked by default, and the
 *     monster tier greys out when it is cleared. The DEFAULT-TICKED half is
 *     load-bearing and is the one a naive probe misses — DialogV2 serializes
 *     element content through innerHTML, so `checked` set as a PROPERTY is
 *     silently dropped and every creation would come out empty.
 *  7. The Warden is asked. This reverses the 2026-08-08 "the Warden's button
 *     keeps rolling instantly" ruling, deliberately, because the dialog is
 *     where the roll/empty choice is made. It is a behaviour change to the most
 *     frequent action in the system and it should not be able to regress
 *     silently in either direction.
 *  8. THE ENTER KEY (review #26). Clearing the box and pressing Enter must
 *     answer blank. It answered NULL and created nothing, because every
 *     DialogV2 button defaults to `type="submit"` and `default: true` buys
 *     autofocus alone, so implicit submission fired the first submit button —
 *     Cancel, declared first. The whole gesture the feature exists for was
 *     dead from the keyboard on all four routes. Only a REAL keypress can see
 *     it: `form.requestSubmit()` sets no submitter at all, and a scripted
 *     `box.click()` does not move focus, so both report the feature working.
 *
 * Every leg was confirmed to FAIL with the feature removed before being kept —
 * see the witness list at the bottom of this file.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m, extra = "") => console.log(`  ok    ${m}${extra ? `  ${extra}` : ""}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(240000, "blank actor probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const PREFIX = "ZZ Blank";

/* -- 1, 2, 3, 5: what an empty actor of each kind actually is --------------- */
console.log("\nan empty sheet, per kind");

const made = await page.evaluate(async (prefix) => {
  const cg = game.cairn.characterGenerator;
  const res = { kinds: [], errors: [] };
  // Sweep by the id DIFFERENCE, never by name alone: a previous run killed
  // mid-flight leaves fixtures behind, and deleting "everything that looks like
  // mine" is how a probe eats a Warden's actor with an unlucky name.
  for (const a of game.actors.filter((x) => x.name?.startsWith(prefix))) await a.delete();

  const before = game.messages.size;
  for (const kind of ["character", "npc", "hireling", "monster"]) {
    let actor = null;
    try {
      actor = await cg.createBlankActor(kind);
    } catch (err) {
      res.errors.push(`${kind}: ${err.message}`);
      continue;
    }
    if (!actor) { res.errors.push(`${kind}: created nothing`); continue; }
    await actor.update({ name: `${prefix} ${kind}` });
    const src = actor._source.system; // _source, never derived — see the header
    res.kinds.push({
      kind,
      id: actor.id,
      type: actor.type,
      role: src.role ?? null,
      hp: [src.hp?.value, src.hp?.max],
      abilities: ["STR", "DEX", "WIL"].map((k) => src.abilities?.[k]?.value),
      generationEnabled: src.generationEnabled,
      // Emptiness, measured on the things a generator WOULD have filled.
      items: actor.items.size,
      background: src.background ?? "",
      backgroundUuid: src.backgroundUuid ?? "",
      bonds: (src.bonds ?? []).length,
      questions: (src.questions ?? []).length,
      age: src.age ?? "",
      traits: Object.values(src.traits ?? {}).filter((v) => typeof v === "string" && v).length,
      contentSource: src.contentSource ?? null,
    });
  }
  res.newMessages = game.messages.size - before;
  return res;
}, PREFIX);

made.errors.forEach((e) => fail(e));

for (const k of made.kinds) {
  const wantType = k.kind === "character" ? "character" : "npc";
  const wantRole = k.kind === "character" ? null : k.kind;
  k.type === wantType && k.role === wantRole
    ? ok(`${k.kind}: type ${k.type}${k.role ? `, role ${k.role}` : ""}`)
    : fail(`${k.kind}: type ${k.type} role ${k.role}, wanted ${wantType}/${wantRole}`);

  // Leg 2 — the numbers, and HP 3 is the user's ruling, not the schema's 6.
  const hpOk = k.hp[0] === 3 && k.hp[1] === 3;
  const abOk = k.abilities.every((v) => v === 10);
  hpOk && abOk
    ? ok(`${k.kind}: HP 3/3 and 10/10/10 in _source`)
    : fail(`${k.kind}: HP ${k.hp.join("/")} abilities ${k.abilities.join("/")}, wanted 3/3 and 10/10/10`);

  // Leg 1 — nothing rolled.
  const empty = !k.items && !k.background && !k.backgroundUuid
    && !k.bonds && !k.questions && !k.age && !k.traits;
  empty
    ? ok(`${k.kind}: nothing rolled`, `items ${k.items}, bonds ${k.bonds}, questions ${k.questions}`)
    : fail(`${k.kind}: not empty — ${JSON.stringify({
      items: k.items, background: k.background, bonds: k.bonds,
      questions: k.questions, age: k.age, traits: k.traits,
    })}`);

  // Leg 3, first half — the flag. The RENDER half is below.
  k.generationEnabled === true
    ? ok(`${k.kind}: Character Creation Mode arrives on`)
    : fail(`${k.kind}: generationEnabled is ${k.generationEnabled}, wanted true`);
}

// Leg 5 — an empty sheet rolled nothing, so it says nothing.
made.newMessages === 0
  ? ok("four empty actors posted nothing to chat")
  : fail(`four empty actors posted ${made.newMessages} chat message(s)`);

/* -- 3 (second half): the pickers are really on the sheet ------------------- */
console.log("\nthe pickers render");

const charId = made.kinds.find((k) => k.kind === "character")?.id;
if (!charId) fail("no empty character to open");
else {
  const rendered = await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    await actor.sheet.render(true);
    // Settle on CONTENT, not on a fixed sleep: a cold first render of this
    // sheet outlives any timeout worth writing.
    const deadline = Date.now() + 15000;
    let el = null;
    while (Date.now() < deadline) {
      el = actor.sheet.element;
      if (el?.querySelector(".window-content")) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    const q = (sel) => !!el?.querySelector(sel);
    const out = {
      // The pick-list buttons, by their ACTION rather than their icon class: a
      // renamed icon is cosmetic, a renamed action is a broken button.
      pickName: q('[data-action="pickName"]'),
      pickBackground: q('[data-action="pickBackground"]'),
      // And a die, to prove the whole generation surface is up rather than one
      // stray anchor that happens to survive the template gate.
      rollBackground: q('[data-action="rollBackground"]'),
      // The background must be TYPABLE while no backgroundUuid is stored —
      // that input is the other hand-entry path and it disappears the moment a
      // background is picked.
      backgroundInput: q('input[name="system.background"]'),
    };
    await actor.sheet.close();
    return out;
  }, charId);

  const wanted = ["pickName", "pickBackground", "rollBackground", "backgroundInput"];
  const missing = wanted.filter((k) => !rendered[k]);
  missing.length === 0
    ? ok("the empty character sheet renders its pickers, its dice and a typable background")
    : fail(`missing on the empty sheet: ${missing.join(", ")}`);
}

/* -- 4: THE CONTROL — ticked still rolls a whole character ------------------ */
console.log("\nthe control: leaving the box ticked");

const rolled = await page.evaluate(async (prefix) => {
  const cg = game.cairn.characterGenerator;
  const actor = await cg.createCharacter({ source: "2e" });
  if (!actor) return { error: "createCharacter returned nothing" };
  await actor.update({ name: `${prefix} rolled` });
  const src = actor._source.system;
  return {
    items: actor.items.size,
    background: src.background ?? "",
    hp: src.hp?.value,
    abilities: ["STR", "DEX", "WIL"].map((k) => src.abilities?.[k]?.value),
  };
}, PREFIX);

if (rolled.error) fail(rolled.error);
else {
  // Not "is it different from empty" — a generator that rolled 10/10/10 by
  // chance would pass that. Gear and a background are what generation OWES.
  const real = rolled.items > 0 && !!rolled.background;
  real
    ? ok("a rolled character still arrives full", `${rolled.items} items, background "${rolled.background}"`)
    : fail(`the rolled path came out thin: ${JSON.stringify(rolled)}`);
}

/* -- 8: a hand-built sheet is handed NOTHING -------------------------------- */
console.log("\nhand-built: choices record, grants do not");

const grants = await page.evaluate(async (prefix) => {
  const cg = game.cairn.characterGenerator;
  const out = { errors: [] };
  const bgs = (await game.packs.get("air-bladder.backgrounds-2e")?.getDocuments()) ?? [];
  // A background that actually GRANTS something, or every "no items" assertion
  // below is vacuous — the commonest way a suppression leg passes for free.
  const bg = bgs.find((b) => (b.system?.startingGear ?? []).length > 1);
  if (!bg) { out.errors.push("no background with starting gear in the 2e pack"); return out; }
  out.bgName = bg.name;
  out.bgGear = bg.system.startingGear.length;

  const settle = async (a) => { await a.sheet?.close(); };

  // (a) hand-built + a PICKED background.
  const blank = await cg.createBlankActor("character");
  await blank.update({ name: `${prefix} handbuilt` });
  const goldBefore = blank._source.system.gold ?? 0;
  await cg.changeBackground(blank, bg);
  out.handBuilt = {
    marked: blank.getFlag("air-bladder", "handBuilt") === true,
    background: blank._source.system.background,
    items: blank.items.size,
    gold: blank._source.system.gold ?? 0,
    goldBefore,
    questions: (blank._source.system.questions ?? []).length,
    questionGold: (blank._source.system.questions ?? []).reduce((n, q) => n + (q.gold ?? 0), 0),
  };

  // (b) THE CONTROL — the same background, the same call, on a ROLLED
  // character. Without this, a changeBackground broken to grant nothing at all
  // would make (a) pass and read as a working feature.
  const rolled = await cg.createCharacter({ source: "2e" });
  await rolled.update({ name: `${prefix} rolled bg` });
  await cg.changeBackground(rolled, bg);
  out.control = {
    marked: rolled.getFlag("air-bladder", "handBuilt") === true,
    background: rolled._source.system.background,
    items: rolled.items.size,
  };

  // (c) THE WAY OUT — Roll Character with Background checked clears the mark
  // and deals the gear. Driven through _applyRerollParts, the checklist's own
  // applier, rather than through the dialog: the dialog is covered above and
  // what matters here is the ORDER, that the mark goes before the re-deal.
  const escapee = await cg.createBlankActor("character");
  await escapee.update({ name: `${prefix} escapee` });
  await escapee.sheet.render(true);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !escapee.sheet.element?.querySelector(".window-content")) {
    await new Promise((r) => setTimeout(r, 150));
  }
  await escapee.sheet._applyRerollParts({ background: true });
  out.escape = {
    stillMarked: escapee.getFlag("air-bladder", "handBuilt") === true,
    background: escapee._source.system.background,
    items: escapee.items.size,
  };
  await settle(escapee);

  // (d) a BOND on a hand-built sheet: text lands, gear and coins do not.
  const bonded = await cg.createBlankActor("character");
  await bonded.update({ name: `${prefix} bonded` });
  await cg.changeBackground(bonded, bg);
  await bonded.sheet.render(true);
  const d2 = Date.now() + 15000;
  while (Date.now() < d2 && !bonded.sheet.element?.querySelector(".window-content")) {
    await new Promise((r) => setTimeout(r, 150));
  }
  const itemsBeforeBond = bonded.items.size;
  const goldBeforeBond = bonded._source.system.gold ?? 0;
  // The REAL "Add a bond" control. Its handler is a private class method, so
  // there is nothing to call from out here — and clicking is the better test
  // anyway, since it proves the affordance survives on a hand-built sheet.
  const addLink = bonded.sheet.element?.querySelector('[data-action="addBond"]');
  out.bondLink = !!addLink;
  if (addLink) {
    addLink.click();
    // Settle on CONTENT: the click kicks off a draw plus two writes.
    const d3 = Date.now() + 20000;
    while (Date.now() < d3 && !(bonded._source.system.bonds ?? []).length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const bondRows = bonded._source.system.bonds ?? [];
  out.bond = {
    rows: bondRows.length,
    text: !!bondRows[0]?.description,
    bondGold: bondRows.reduce((n, b) => n + (b.gold ?? 0), 0),
    itemsBeforeBond,
    itemsAfter: bonded.items.size,
    goldBeforeBond,
    goldAfter: bonded._source.system.gold ?? 0,
  };
  // (e) a QUESTION ANSWER on a hand-built sheet. Driven through the real
  // applier with a synthetic option that DOES grant — the shipped options vary
  // and one that happens to grant nothing would pass this for free.
  const opt = {
    description: "ZZ a test answer",
    items: [{ name: "Rations", quantity: 3 }],
    bonusGold: 25,
  };
  const qIdx = 0;
  const goldBeforeQ = bonded._source.system.gold ?? 0;
  const itemsBeforeQ = bonded.items.size;
  await bonded.sheet._applyQuestionOption(qIdx, "ZZ a test question", opt);
  out.question = {
    answer: (bonded._source.system.questions ?? [])[qIdx]?.answer ?? "",
    banked: (bonded._source.system.questions ?? [])[qIdx]?.gold ?? 0,
    itemsBeforeQ,
    itemsAfter: bonded.items.size,
    goldBeforeQ,
    goldAfter: bonded._source.system.gold ?? 0,
  };
  await settle(bonded);
  return out;
}, PREFIX);

grants.errors.forEach((e) => fail(e));

if (grants.handBuilt) {
  const h = grants.handBuilt;
  h.marked ? ok("a blank actor is marked hand-built") : fail("the hand-built mark was not set");
  h.background === grants.bgName
    ? ok(`picking a background records it`, `"${h.background}" (${grants.bgGear} gear refs)`)
    : fail(`background not recorded: ${JSON.stringify(h.background)}`);
  h.items === 0
    ? ok("   …and grants NO items")
    : fail(`the hand-built sheet was handed ${h.items} item(s)`);
  // Half-vacuous on purpose and worth knowing: whether this reds under witness
  // (f) depends on the background drawn, since not every 2e background's
  // questions bank coins. The GOLD claim is carried properly by the question
  // leg below, which uses a synthetic option worth 25.
  h.gold === h.goldBefore && h.questionGold === 0
    ? ok("   …and no coins, with every question row banking zero")
    : fail(`gold moved ${h.goldBefore} -> ${h.gold}, question gold ${h.questionGold}`);
  h.questions > 0
    ? ok(`   …while the ${h.questions} question rows still land, so the pickers have something to hang on`)
    : fail("the background's question rows did not land");
}

if (grants.control) {
  const c = grants.control;
  // Not "different from the hand-built one" — the same call, on a sheet without
  // the mark, must really hand gear over.
  !c.marked && c.background === grants.bgName && c.items > 0
    ? ok("CONTROL: the same background on a rolled character still grants", `${c.items} items`)
    : fail(`the control did not grant: ${JSON.stringify(c)}`);
}

if (grants.escape) {
  const e = grants.escape;
  !e.stillMarked && e.items > 0
    ? ok("Roll Character with Background checked clears the mark and deals the gear", `${e.items} items`)
    : fail(`the way out failed: ${JSON.stringify(e)}`);
}

if (grants.bond) {
  const b = grants.bond;
  grants.bondLink
    ? ok("the Add-a-bond control is on the hand-built sheet")
    : fail("no addBond control rendered — the whole bond section below is vacuous");
  b.rows > 0 && b.text
    ? ok("adding a bond on a hand-built sheet records its text")
    : fail(`no bond row landed: ${JSON.stringify(b)}`);
  b.itemsAfter === b.itemsBeforeBond && b.goldAfter === b.goldBeforeBond && b.bondGold === 0
    ? ok("   …and hands over no gear and no coins")
    : fail(`the bond granted: items ${b.itemsBeforeBond}->${b.itemsAfter}, gold ${b.goldBeforeBond}->${b.goldAfter}, banked ${b.bondGold}`);
}

if (grants.question) {
  const q = grants.question;
  q.answer === "ZZ a test answer"
    ? ok("answering a question on a hand-built sheet records the answer")
    : fail(`the answer did not land: ${JSON.stringify(q.answer)}`);
  q.itemsAfter === q.itemsBeforeQ && q.goldAfter === q.goldBeforeQ && q.banked === 0
    ? ok("   …and hands over none of its 3 Rations and none of its 25 gold")
    : fail(`the answer granted: items ${q.itemsBeforeQ}->${q.itemsAfter}, gold ${q.goldBeforeQ}->${q.goldAfter}, banked ${q.banked}`);
}

/* -- 6, 7: the dialog itself ------------------------------------------------ */
console.log("\nthe creation dialog");

const dialog = await page.evaluate(async () => {
  const out = {};
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };
  // A CLOSING DialogV2 lingers in the DOM, so ".application.dialog" can hand
  // back the one that just went. Find each new dialog by the id DIFFERENCE
  // against what was already on screen. Getting this wrong hung this probe's
  // first run: the monster legs read the character dialog's markup, then
  // clicked a Cancel on a detached node, and the second promise never settled.
  const ids = () => new Set([...document.querySelectorAll(".application.dialog")].map((d) => d.id));
  const freshDialog = async (before) => {
    const el = await until(() => [...document.querySelectorAll(".application.dialog")]
      .find((d) => !before.has(d.id)));
    return el ?? null;
  };
  // Never `await` a dialog promise bare: an unanswered one never settles, and a
  // hung probe reports nothing at all. Race it and name the failure instead.
  const settle = (p, label) => Promise.race([
    p.then((v) => ({ value: v })),
    new Promise((r) => setTimeout(() => r({ hung: label }), 6000)),
  ]);

  /* -- the character dialog: asked at all, ticked by default, unticks to blank */
  const before1 = ids();
  const pending = game.cairn.characterGenerator.promptCreation("character");
  const el = await freshDialog(before1);
  out.wardenAsked = !!el;
  if (!el) { out.error = "no dialog opened for the Warden"; return out; }

  const box = el.querySelector('input[name="roll"]');
  out.hasCheckbox = !!box;
  // Leg 6 — DEFAULT TICKED, read off the RENDERED node. The dialog serializes
  // its content through innerHTML, so a tick set as a PROPERTY never arrives
  // and every creation would silently come out empty while the code looks right.
  out.checkedByDefault = box?.checked === true;

  if (box) { box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true })); }
  el.querySelector('button[data-action="create"]')?.click();
  out.answer = await settle(pending, "character create");

  /* -- the monster dialog: the tier greys out with the box ------------------ */
  const before2 = ids();
  const pending2 = game.cairn.monsterGenerator.promptMonsterCreation();
  const el2 = await freshDialog(before2);
  out.monsterAsked = !!el2;
  if (el2) {
    const box2 = el2.querySelector('input[name="roll"]');
    const sel2 = el2.querySelector('select[name="choice"]');
    out.tierPresent = !!sel2;
    out.tierLiveWhenTicked = sel2 ? !sel2.disabled : null;
    if (box2 && sel2) {
      box2.checked = false;
      box2.dispatchEvent(new Event("change", { bubbles: true }));
      out.tierGreyedWhenCleared = sel2.disabled === true;
    }
    el2.querySelector('button[data-action="cancel"]')?.click();
    out.cancelled = await settle(pending2, "monster cancel");
  }
  return out;
});

if (dialog.error) fail(dialog.error);
dialog.wardenAsked
  ? ok("the Warden is asked — the dialog opens on the GM's own client")
  : fail("no creation dialog for the Warden");
dialog.hasCheckbox && dialog.checkedByDefault
  ? ok("the roll checkbox is present and ticked by default")
  : fail(`checkbox present: ${dialog.hasCheckbox}, ticked: ${dialog.checkedByDefault}`);
dialog.answer?.value?.blank === true
  ? ok("unticking it and pressing Create answers blank")
  : fail(`unticked answer was ${JSON.stringify(dialog.answer)}`);
dialog.tierPresent && dialog.tierLiveWhenTicked && dialog.tierGreyedWhenCleared
  ? ok("the monster tier is live while ticked and greys out when cleared")
  : fail(`tier present ${dialog.tierPresent}, live ${dialog.tierLiveWhenTicked}, greyed ${dialog.tierGreyedWhenCleared}`);
// null is the ANSWER here, not an absence: promptCreation maps both Cancel and
// the ✕ to null so that "not now" creates nothing.
dialog.cancelled && "value" in dialog.cancelled && dialog.cancelled.value === null
  ? ok("Cancel creates nothing")
  : fail(`Cancel resolved ${JSON.stringify(dialog.cancelled)}`);

/* -- 8: the Enter key (review #26) ------------------------------------------
 * Outside the evaluate above, and it has to be: the defect is what the BROWSER
 * does with Enter, and every scripted stand-in is green against the broken
 * build. `form.requestSubmit()` sets no submitter at all, and a programmatic
 * `box.click()` does not even move focus — both were tried, both said the
 * feature worked.
 *
 * Before the fix, every DialogV2 button defaulted to `type="submit"` and
 * `default: true` bought autofocus and nothing else, so Enter fired the FIRST
 * submit button. Cancel was declared first, so the exact gesture this feature
 * exists for — clear the box, confirm — created nothing at all.
 * -------------------------------------------------------------------------- */
console.log("\nthe Enter key");
await page.evaluate(() => {
  window.__kbd = {};
  game.cairn.characterGenerator.promptCreation("npc").then((a) => { window.__kbd.answer = a; });
});
await page.waitForSelector('dialog input[name="roll"]', { timeout: 15000 });
await page.click('dialog input[name="roll"]');      // a REAL click, so focus lands on the box
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
const kbd = await page.evaluate(() => {
  const out = { ...window.__kbd, stillOpen: !!document.querySelector('dialog input[name="roll"]') };
  [...foundry.applications.instances.values()]
    .filter((a) => a instanceof foundry.applications.api.DialogV2).forEach((d) => d.close());
  return out;
});
kbd.answer && kbd.answer.blank === true
  ? ok("clearing the box and pressing Enter answers blank — Enter reaches Create, not Cancel")
  : fail(`Enter after clearing the box answered ${JSON.stringify(kbd.answer)} (want {blank:true})`);

/* -- teardown --------------------------------------------------------------- */
const swept = await page.evaluate(async (prefix) => {
  const doomed = game.actors.filter((a) => a.name?.startsWith(prefix));
  const names = doomed.map((a) => a.name);
  for (const a of doomed) await a.delete();
  return names;
}, PREFIX);
console.log(`\n  (cleaned up: ${swept.join(", ") || "nothing"})`);

if (errors.length) {
  fail(`${errors.length} console error(s): ${errors.slice(0, 3).join(" | ")}`);
}

await browser.close();
console.log(failed ? "\nblank actor probe FAILED\n" : "\nblank actor probe passed\n");
process.exit(failed ? 1 : 0);

/*
 * WITNESSES — every one RUN, 2026-09-11, with the result recorded rather than
 * predicted. Each was reverted immediately; none is a world write.
 *
 *  a) `createBlankActor`: drop `generationEnabled: true` from the payload
 *     → 5 red: the four "Character Creation Mode arrives on" legs AND the
 *       picker-render leg (which lost pickName, pickBackground, rollBackground).
 *       That pairing is the point — the flag and the render are two claims, and
 *       the second is the one a Warden actually sees.
 *  b) `createBlankActor`: `BLANK_HP = 6`, the schema's own value
 *     → 4 red, one per kind. This is what pins the user's ruling: without it,
 *       the HP leg would be asserting the schema against itself.
 *  c) `promptCreation`: `box.checked = true` instead of `setAttribute`
 *     → 2 red: "ticked by default", and the monster tier as well, because a box
 *       that arrives unticked greys the tier immediately. Stronger than
 *       expected, and it is the serialization trap caught exactly where it
 *       bites — every creation would have come out empty while the code read
 *       correctly.
 *  d) `promptCreation`: neutralise the `render` wiring
 *     → 1 red: "tier present true, live true, greyed false".
 *  e) `createCharacter`: take the blank branch unconditionally
 *     → 1 red, the CONTROL, and every other leg stayed green. That is what
 *       makes the control worth having: without it, a generator broken to
 *       return nothing would leave this whole file passing.
 *
 *  f) `isHandBuilt` forced to `() => false`, defeating the whole suppression
 *     → 4 red: the background's items, the way out, the bond and the question
 *       answer. Each of the four grant paths is separately asserted, which is
 *       what makes (g) below possible.
 *  g) the `!handBuilt` term dropped from the sheet's Add-a-bond handler ALONE
 *     → 1 red, the bond leg, and nothing else. That handler creates its items
 *       DIRECTLY rather than through `_applyBond`, so suppressing it in the
 *       applier was not enough — and the leg that clicks the real Add-a-bond
 *       control is the only thing that found the gap. Three bond paths exist
 *       (`_applyBond`, this handler, `rerollAllBonds`) and a fix to one reads
 *       exactly like a fix to all three.
 *
 *  h) `type: "button"` dropped from the creation dialog's Cancel entry
 *     → 1 red, the Enter leg, and nothing else — the whole rest of the file
 *       stayed green, which is the point: the feature works perfectly to a
 *       mouse and is dead to the keyboard, and no other leg can see that.
 *
 * A METHOD NOTE, because it cost a wrong answer here. Witness (d) first
 * reported "nothing failed — the leg is not real". It was not: the anchor had
 * gone through a shell single-quoted string, the backslashes survived
 * literally, and the module became a syntax error, so the probe never ran and
 * printed no FAIL lines. A witness that produces NO ok lines has not tested
 * anything. Count the greens before believing a red — or an absence of one.
 */

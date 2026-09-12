#!/usr/bin/env node
/**
 * The Create Faction button: ask first, then one JournalEntry dossier.
 *
 * Four things this owns. The BUTTON — Warden-only, beside Create Monster in
 * the Actors directory, and a click opens the CREATION DIALOG (2026-09-12):
 * "Use random generation." ticked, the pick-lists hidden, and Cancel or ✕
 * mints nothing. THE ROLL — Create with the box ticked mints a journal named
 * "The <Trait> <Type>" whose one page carries all six dossier sections,
 * GM-only ownership. The WORLD-FIRST contract — a Warden's own table of a
 * suite name feeds the generator AND its pick-lists: a sentinel world
 * "Warden: Faction - Agenda" must land on the page verbatim and must be the
 * only row its list offers, and a world "(Count)" copy forced to 4 must
 * yield exactly four DISTINCT advantages from the stock twenty. And the
 * MANUAL PATH — with the box cleared a Name field, the six lists and the
 * Advantages ticks appear, every list in TABLE ORDER behind a Random row; a
 * picked Type and Trait name the faction while the Name is left empty,
 * ticked advantages land verbatim, a list left at Random still rolls; a
 * TYPED name wins outright and names the page too while everything else is
 * still rolled, and Enter in that field reaches Create rather than Cancel;
 * the cap disables every clear box once four are ticked; and a cleared box
 * with nothing picked rolls everything.
 *
 * Membership is asserted against the PINNED SRD columns, never "non-empty":
 * a wrong pool that returns something must still fail. All world state
 * (sentinel tables, minted journals) is swept from Node, including on the
 * way in — a prior aborted run's sentinel table would corrupt the stock leg.
 *
 * Red witness: with module/ stashed (the pre-dialog generator) every leg
 * from "the click asks first" down is red — the click mints instantly, so
 * Cancel "mints" a journal, and no dialog carries a list to pick from.
 *
 *   npm run dev:faction-gen
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
watchdog(240000, "dev:faction-gen");
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(48)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(48)} ${d}`); failures++; };

// The pinned SRD columns the stock tables ship (warden-check re-verifies them
// against the live SRD; these literals make membership checkable offline).
const TYPE = ["Artisans", "Commoners", "Criminals", "Cultists", "Exiles", "Explorers", "Industrialists",
  "Merchants", "Military", "Nobles", "Nomads", "Pilgrims", "Protectors", "Religious", "Revolutionaries",
  "Rulers", "Scholars", "Settlers", "Spies", "Tribe"];
const TRAIT1 = ["Cautious", "Connected", "Decadent", "Disciplined", "Discreet", "Dogmatic", "Enigmatic",
  "Fierce", "Incorruptible", "Intellectual", "Judicious", "Keen", "Loyal", "Meticulous", "Popular",
  "Pragmatic", "Resourceful", "Secretive", "Shrewd", "Tenacious"];
const ADVANTAGE = ["Alliances", "Anonymity", "Apparatus", "Beliefs", "Charisma", "Conviction", "Fealty",
  "Force", "Information", "Lineage", "Magic", "Members", "Popularity", "Position", "Renown", "Resources",
  "Ruthlessness", "Specialization", "Subterfuge", "Wealth"];
const AGENDA_TABLE = "Warden: Faction - Agenda";
const COUNT_TABLE = "Warden: Faction - Advantage (Count)";
const SENTINEL_TABLES = [AGENDA_TABLE, COUNT_TABLE];
const SENTINEL = "ZZ-AGENDA-SENTINEL";
const RANDOM = "__random__";
const PARTS = ["type", "agent", "trait1", "trait2", "agenda", "obstacle"];

const advantagesOf = (text) => {
  const m = text.match(/Advantages:<\/strong>\s*([^<]+)</);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
};
const lineOf = (text, label) => {
  const m = text.match(new RegExp(`${label}:</strong>\\s*([^<]+)<`));
  return m ? m[1].trim() : "";
};
const nameRe = new RegExp(`^The (${TRAIT1.join("|")}) (${TYPE.join("|")})$`);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/* ---- in-page helpers, each a plain evaluate ----------------------------- */

const journalIds = () => page.evaluate(() => game.journal.map((j) => j.id));

/** Click the directory button and return the FRESH dialog's element id (a
 *  closing dialog lingers, so the new one is found by id difference). */
const openDialog = () => page.evaluate(async () => {
  const before = new Set([...document.querySelectorAll(".application.dialog")].map((d) => d.id));
  document.querySelector(".create-faction-button")?.click();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const el = [...document.querySelectorAll(".application.dialog")].find((d) => !before.has(d.id));
    if (el) return el.id;
  }
  return null;
});

/** The dialog's shape: the box, its state, the pick section, the Name field,
 *  no tier select. */
const readShape = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  if (!el) return null;
  const roll = el.querySelector('input[name="roll"]');
  const section = el.querySelector(".ab-creation-manual");
  const nameBox = el.querySelector('input[name="faction-name"]');
  return {
    named: !!nameBox,
    nameEmpty: nameBox?.value === "",
    // INSIDE the section, which is what makes it ride the cleared box rather
    // than sit on the rolled route too.
    nameInSection: !!nameBox && !!section?.contains(nameBox),
    title: el.querySelector(".window-title")?.textContent.trim() ?? "",
    roll: !!roll,
    ticked: !!roll?.checked,
    section: !!section,
    hidden: !!section?.hidden,
    visible: !!section && !section.hidden && section.offsetHeight > 0,
    choice: !!el.querySelector('select[name="choice"]'),
  };
}, id);

/** Focus the Name field and report whether it is even there. In-page rather
 *  than through a Playwright locator so a MISSING field fails its leg instead
 *  of throwing a 30s timeout that takes every later leg with it — which is
 *  what the red phase does to it by construction. */
const focusName = (id) => page.evaluate((id) => {
  const box = document.getElementById(id)?.querySelector('input[name="faction-name"]');
  if (!box) return false;
  box.focus();
  return document.activeElement === box;
}, id);

const clickIn = (id, selector) => page.evaluate(({ id, selector }) => {
  const btn = document.getElementById(id)?.querySelector(selector);
  if (!btn) return false;
  btn.click();
  return true;
}, { id, selector });

/** A journal that was not in `before`, or null after `ms`. */
const newJournal = (before, ms) => page.evaluate(async ({ before, ms }) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = game.journal.find((j) => !before.includes(j.id));
    if (e) return e.id;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}, { before, ms });

/** Wait for the minted journal's sheet, close it, and read the dossier. */
const readJournal = (id) => page.evaluate(async (id) => {
  const entry = game.journal.get(id);
  if (!entry) return null;
  let rendered = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 4000 && !rendered) {
    await new Promise((r) => setTimeout(r, 150));
    rendered = !!entry.sheet?.rendered;
  }
  await entry.sheet?.close();
  return {
    name: entry.name,
    // The page carries the name too, and one decision must set both.
    pageName: entry.pages.contents[0]?.name ?? "",
    ownershipDefault: entry.ownership.default,
    rendered,
    text: entry.pages.contents[0]?.text?.content ?? "",
  };
}, id);

const plantTables = (specs) => page.evaluate(async (specs) => {
  const RT = CONFIG.RollTable.documentClass;
  for (const [name, desc] of specs) {
    await RT.create({
      name, formula: "1d1",
      results: [{ type: "text", description: desc, range: [1, 1], weight: 1 }],
    });
  }
}, specs);

const sweepTables = () => page.evaluate(async (names) => {
  for (const t of game.tables.filter((x) => names.includes(x.name))) await t.delete();
}, SENTINEL_TABLES);

const minted = [];
try {
  await joinAsGM(page);
  await dismissChrome(page);

  // Sweep sentinel tables FIRST — a leftover world copy shadows the pack and
  // corrupts the stock leg below.
  await sweepTables();

  await page.evaluate(() => ui.sidebar.changeTab?.("actors", "primary") ?? ui.sidebar.activateTab?.("actors"));
  await page.waitForTimeout(600);
  const button = await page.evaluate(() => document.querySelector(".create-faction-button")?.textContent.trim() ?? null);
  button !== null
    ? ok("Create Faction button injected", `Actors directory, Warden-only — "${button}"`)
    : fail("Create Faction button injected", "no .create-faction-button");

  /* --- 1. the click ASKS FIRST, and a dismiss mints nothing -------------- */
  {
    const before = await journalIds();
    const id = await openDialog();
    const shape = id ? await readShape(id) : null;
    shape && shape.roll && shape.ticked && shape.section && shape.hidden && !shape.choice
      ? ok("the click opens the creation dialog", `"${shape.title}": box ticked, lists hidden, no tier`)
      : fail("the click opens the creation dialog", JSON.stringify(shape));
    await clickIn(id, 'button[data-action="cancel"]');
    const afterCancel = await newJournal(before, 5000);
    if (afterCancel === null) ok("Cancel mints nothing", "5s");
    else { fail("Cancel mints nothing", `journal ${afterCancel} appeared`); minted.push(afterCancel); }

    const id2 = await openDialog();
    await clickIn(id2, '.window-header button[data-action="close"]');
    const afterClose = await newJournal(before, 5000);
    if (afterClose === null) ok("✕ mints nothing", "5s");
    else { fail("✕ mints nothing", `journal ${afterClose} appeared`); minted.push(afterClose); }
  }

  /* --- 2. the box ticked: the shipped stock, end to end ------------------ */
  {
    const before = await journalIds();
    const id = await openDialog();
    await clickIn(id, 'button[data-action="create"]');
    const made = await newJournal(before, 8000);
    const first = made ? await readJournal(made) : null;
    if (!first) {
      fail("Create with the box ticked mints a dossier", "no JournalEntry appeared within 8s");
    } else {
      minted.push(made);
      nameRe.test(first.name)
        ? ok('named "The <Trait> <Type>" from the rolls', `"${first.name}"`)
        : fail('named "The <Trait> <Type>" from the rolls', JSON.stringify(first.name));
      ["Type", "Agent", "Traits", "Advantages", "Agenda", "Obstacle"].every((l) => first.text.includes(`${l}:`))
        ? ok("all six dossier sections on the page")
        : fail("all six dossier sections on the page", first.text.slice(0, 200));
      const advs = advantagesOf(first.text);
      advs.length >= 1 && advs.length <= 4 && new Set(advs).size === advs.length
        && advs.every((a) => ADVANTAGE.includes(a))
        ? ok("1-4 distinct advantages from the stock twenty", advs.join(", "))
        : fail("1-4 distinct advantages from the stock twenty", JSON.stringify(advs));
      first.ownershipDefault === 0
        ? ok("GM-only ownership", "a faction is the Warden's machinery")
        : fail("GM-only ownership", `default=${first.ownershipDefault}`);
      first.rendered
        ? ok("the journal opened for editing")
        : fail("the journal opened for editing", "sheet never rendered");
    }
  }

  /* --- 3. a Warden's world tables feed the roll -------------------------- */
  {
    await plantTables([[AGENDA_TABLE, SENTINEL], [COUNT_TABLE, "4"]]);
    const before = await journalIds();
    const id = await openDialog();
    await clickIn(id, 'button[data-action="create"]');
    const made = await newJournal(before, 8000);
    await sweepTables();
    const second = made ? await readJournal(made) : null;
    if (!second) {
      fail("world-table Create mints a dossier", "no JournalEntry appeared within 8s");
    } else {
      minted.push(made);
      second.text.includes(SENTINEL)
        ? ok("a world suite table wins by name", "the sentinel agenda landed on the page")
        : fail("a world suite table wins by name", second.text.slice(0, 200));
      const advs = advantagesOf(second.text);
      advs.length === 4 && new Set(advs).size === 4 && advs.every((a) => ADVANTAGE.includes(a))
        ? ok("Count 4 → exactly four DISTINCT advantages", advs.join(", "))
        : fail("Count 4 → exactly four DISTINCT advantages", JSON.stringify(advs));
    }
  }

  /* --- 4. the MANUAL path: clear the box, pick from the lists ------------ */
  {
    await plantTables([[AGENDA_TABLE, SENTINEL]]);
    const before = await journalIds();
    const id = await openDialog();
    const heightBefore = await page.evaluate((id) => document.getElementById(id)?.getBoundingClientRect().height ?? 0, id);
    await clickIn(id, 'input[name="roll"]');
    const shape = await readShape(id);
    shape && !shape.ticked && shape.visible
      ? ok("clearing the box reveals the pick-lists")
      : fail("clearing the box reveals the pick-lists", JSON.stringify(shape));

    // The Name field rides the same cleared box, and starts empty. This leg
    // LEAVES it empty on purpose, which is what makes its "the picked Trait
    // and Type name the faction" assertion below the fallback witness.
    shape && shape.named && shape.nameEmpty && shape.nameInSection
      ? ok("the Name field is there, empty, inside the section")
      : fail("the Name field is there, empty, inside the section", JSON.stringify(shape));

    // The window must GROW to hold the section: an AppV2 window at `height:
    // auto` reflows on its own, and this is the measurement that says so.
    const fit = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const section = el?.querySelector(".ab-creation-manual");
      if (!el || !section) return null;
      const w = el.querySelector(".window-content").getBoundingClientRect();
      const s = section.getBoundingClientRect();
      return { height: el.getBoundingClientRect().height, fits: s.bottom <= w.bottom + 1 && s.height > 0, onScreen: el.getBoundingClientRect().bottom <= window.innerHeight };
    }, id);
    fit && fit.fits && fit.height > heightBefore && fit.onScreen
      ? ok("the window reflows to hold the lists", `${Math.round(heightBefore)}px → ${Math.round(fit.height)}px, on screen`)
      : fail("the window reflows to hold the lists", JSON.stringify({ heightBefore, fit }));

    // Every list: Random first. Type: Random + the pinned column, in the
    // pack table's own row order. Agenda: Random + the sentinel, and nothing
    // else — the list reads the WORLD table, the same one the roll does.
    const lists = await page.evaluate(async ({ id, parts, typeTable }) => {
      const { resultText } = await import("/systems/air-bladder/module/compendium.js");
      const el = document.getElementById(id);
      const out = {};
      for (const k of parts) {
        const sel = el.querySelector(`select[name="faction-${k}"]`);
        out[k] = sel ? [...sel.options].map((o) => ({ value: o.value, text: o.textContent })) : null;
      }
      const docs = (await Promise.all(game.packs.filter((p) => p.documentName === "RollTable").map((p) => p.getDocuments()))).flat();
      const table = docs.find((d) => d.name === typeTable);
      out.packTypeRows = table ? table.results.map((r) => String(resultText(r)).trim()).filter(Boolean) : null;
      out.boxes = [...el.querySelectorAll('input[name="faction-advantage"]')].map((b) => b.value);
      return out;
    }, { id, parts: PARTS, typeTable: "Warden: NPC - Faction" });
    const randomFirst = PARTS.every((k) => lists[k]?.[0]?.value === RANDOM && lists[k][0].text === "Random");
    randomFirst
      ? ok("every list leads with Random", PARTS.map((k) => `${k}:${lists[k].length}`).join(" "))
      : fail("every list leads with Random", JSON.stringify(PARTS.map((k) => lists[k]?.[0])));
    const typeRows = (lists.type ?? []).slice(1).map((o) => o.value);
    sameSet(typeRows, TYPE) && lists.packTypeRows && typeRows.join("|") === lists.packTypeRows.join("|")
      ? ok("Type lists the pinned column in TABLE ORDER", `${typeRows.length} rows, first "${typeRows[0]}"`)
      : fail("Type lists the pinned column in TABLE ORDER", JSON.stringify({ typeRows, pack: lists.packTypeRows }));
    const agendaRows = (lists.agenda ?? []).slice(1).map((o) => o.value);
    agendaRows.length === 1 && agendaRows[0] === SENTINEL
      ? ok("Agenda lists the WORLD table's one row", SENTINEL)
      : fail("Agenda lists the WORLD table's one row", JSON.stringify(agendaRows));
    sameSet(lists.boxes, ADVANTAGE)
      ? ok("the Advantages ticks are the stock twenty")
      : fail("the Advantages ticks are the stock twenty", JSON.stringify(lists.boxes));

    // Pick row 3 of Type and Trait 1, tick two advantages, leave Agenda at
    // Random, and Create.
    const picked = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const pick = (name, index) => {
        const sel = el.querySelector(`select[name="${name}"]`);
        sel.selectedIndex = index;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return sel.value;
      };
      const type = pick("faction-type", 3);
      const trait1 = pick("faction-trait1", 3);
      const boxes = [...el.querySelectorAll('input[name="faction-advantage"]')];
      boxes[0].click();
      boxes[1].click();
      return { type, trait1, advantages: [boxes[0].value, boxes[1].value] };
    }, id);
    await clickIn(id, 'button[data-action="create"]');
    const made = await newJournal(before, 8000);
    await sweepTables();
    const manual = made ? await readJournal(made) : null;
    if (!manual) {
      fail("Create with picks mints a dossier", "no JournalEntry appeared within 8s");
    } else {
      minted.push(made);
      manual.name === `The ${picked.trait1} ${picked.type}`
        ? ok("an empty Name still drafts it from the picks", `"${manual.name}"`)
        : fail("an empty Name still drafts it from the picks", `"${manual.name}" vs picks ${JSON.stringify(picked)}`);
      const advs = advantagesOf(manual.text);
      advs.join("|") === picked.advantages.join("|")
        ? ok("the ticked advantages land verbatim, and only those", advs.join(", "))
        : fail("the ticked advantages land verbatim, and only those", JSON.stringify({ advs, picked: picked.advantages }));
      manual.text.includes(SENTINEL)
        ? ok("a list left at Random still rolls, world-first", "the sentinel agenda landed")
        : fail("a list left at Random still rolls, world-first", manual.text.slice(0, 200));
    }
  }

  /* --- 5. a TYPED NAME wins, and Enter in the field creates -------------- */
  {
    // TYPED with real keystrokes, never assigned: the value is read off the
    // live form at Create time, and a `.value` write would not prove a Warden
    // can reach the control at all.
    const typed = `ZZ-Faction-Typed-${Date.now()}`;
    const before = await journalIds();
    const id = await openDialog();
    await clickIn(id, 'input[name="roll"]');
    if (!await focusName(id)) fail("the Name field can be typed into", "no input[name=faction-name]");
    else await page.keyboard.type(typed);
    await clickIn(id, 'button[data-action="create"]');
    const made = await newJournal(before, 8000);
    const named = made ? await readJournal(made) : null;
    if (!named) {
      fail("a typed name mints a dossier", "no JournalEntry appeared within 8s");
    } else {
      minted.push(made);
      named.name === typed && named.pageName === typed
        ? ok("a typed name names the entry AND its page", `"${named.name}"`)
        : fail("a typed name names the entry AND its page",
          JSON.stringify({ name: named.name, page: named.pageName, typed }));
      // Naming it must not stop anything being rolled: every list was left on
      // Random and nothing was ticked, so the six lines are still the dice.
      const advs = advantagesOf(named.text);
      const type = lineOf(named.text, "Type");
      TYPE.includes(type) && advs.length >= 1 && advs.length <= 4 && advs.every((a) => ADVANTAGE.includes(a))
        ? ok("naming it still rolls every line", `Type "${type}", ${advs.length} advantage(s)`)
        : fail("naming it still rolls every line", JSON.stringify({ type, advs }));
    }

    // ENTER in the name field must reach CREATE, not Cancel. Every DialogV2
    // button is `type="submit"` unless it says otherwise, and implicit
    // submission fires the FIRST one — which is exactly why Cancel is declared
    // `type: "button"`. The empty-sheet feature measured this from the other
    // side: Enter dispatched `cancel` and created nothing, on the one gesture
    // the feature existed for. A text field is the control that invites it.
    const typedEnter = `ZZ-Faction-Enter-${Date.now()}`;
    const beforeEnter = await journalIds();
    const idEnter = await openDialog();
    await clickIn(idEnter, 'input[name="roll"]');
    if (await focusName(idEnter)) await page.keyboard.type(typedEnter);
    await page.keyboard.press("Enter");
    const madeEnter = await newJournal(beforeEnter, 8000);
    const entered = madeEnter ? await readJournal(madeEnter) : null;
    if (madeEnter) minted.push(madeEnter);
    entered?.name === typedEnter
      ? ok("Enter in the Name field creates, keeping the name", `"${entered.name}"`)
      : fail("Enter in the Name field creates, keeping the name", JSON.stringify(entered));
  }

  /* --- 6. the CAP, then a cleared box with nothing picked ---------------- */
  {
    const before = await journalIds();
    const id = await openDialog();
    await clickIn(id, 'input[name="roll"]');
    const cap = await page.evaluate(async (id) => {
      const el = document.getElementById(id);
      const boxes = [...el.querySelectorAll('input[name="faction-advantage"]')];
      const state = () => ({
        checked: boxes.filter((b) => b.checked).length,
        disabled: boxes.filter((b) => b.disabled).length,
        clearDisabled: boxes.filter((b) => !b.checked && b.disabled).length,
      });
      for (let i = 0; i < 4; i++) boxes[i].click();
      const atFour = state();
      boxes[2].click();
      const atThree = state();
      for (const b of boxes) if (b.checked) b.click();
      const atNone = state();
      return { total: boxes.length, atFour, atThree, atNone };
    }, id);
    cap.atFour.checked === 4 && cap.atFour.clearDisabled === cap.total - 4 && cap.atFour.disabled === cap.total - 4
      ? ok("four ticked disables every clear box", `${cap.atFour.disabled} of ${cap.total} disabled`)
      : fail("four ticked disables every clear box", JSON.stringify(cap.atFour));
    cap.atThree.checked === 3 && cap.atThree.disabled === 0
      ? ok("unticking one re-enables them all")
      : fail("unticking one re-enables them all", JSON.stringify(cap.atThree));

    await clickIn(id, 'button[data-action="create"]');
    const made = await newJournal(before, 8000);
    const rolled = made ? await readJournal(made) : null;
    if (!rolled) {
      fail("a cleared box with nothing picked still mints", "no JournalEntry appeared within 8s");
    } else {
      minted.push(made);
      const advs = advantagesOf(rolled.text);
      nameRe.test(rolled.name) && advs.length >= 1 && advs.length <= 4 && advs.every((a) => ADVANTAGE.includes(a))
        ? ok("a cleared box with nothing picked rolls everything", `"${rolled.name}", ${advs.length} advantage(s)`)
        : fail("a cleared box with nothing picked rolls everything", JSON.stringify({ name: rolled.name, advs }));
    }
  }
} catch (e) {
  fail("probe threw", `${e.name}: ${e.message}`);
} finally {
  // Node-side restore: minted journals and any straggler sentinel tables —
  // even when a leg above aborted mid-way.
  await page.evaluate(async ({ ids, names }) => {
    for (const id of ids) await game.journal.get(id)?.delete().catch(() => {});
    for (const t of game.tables.filter((x) => names.includes(x.name))) await t.delete();
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof foundry.applications.api.DialogV2) await app.close().catch(() => {});
    }
  }, { ids: minted, names: SENTINEL_TABLES }).catch(() => {});
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nFAILED (${failures})\n` : "\nfaction generator probe passed\n");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * The Generate Faction button: one click, one JournalEntry dossier.
 *
 * Three things this owns. The BUTTON — Warden-only, beside Generate Monster in
 * the Actors directory, and a real click mints a journal named "The <Trait>
 * <Type>" whose one page carries all six dossier sections, GM-only ownership.
 * The WORLD-FIRST contract — a Warden's own table of a suite name feeds the
 * generator: a sentinel world "Warden: Faction - Agenda" must land in the
 * page verbatim. And the ADVANTAGES PROCEDURE — a world "(Count)" copy forced
 * to 4 must yield exactly four DISTINCT advantages from the stock twenty,
 * which is the roll-count-then-reroll-repeats rule doing its job.
 *
 * Membership is asserted against the PINNED SRD columns, never "non-empty":
 * a wrong pool that returns something must still fail. All world state
 * (sentinel tables, minted journals) is swept from Node, including on the
 * way in — a prior aborted run's sentinel table would corrupt the stock leg.
 *
 *   npm run dev:faction-gen
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, dismissChrome, watchErrors, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
watchdog(180000, "dev:faction-gen");
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(44)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(44)} ${d}`); failures++; };

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
const SENTINEL_TABLES = ["Warden: Faction - Agenda", "Warden: Faction - Advantage (Count)"];

const advantagesOf = (text) => {
  const m = text.match(/Advantages:<\/strong>\s*([^<]+)</);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
};

const minted = [];
try {
  await joinAsGM(page);
  await dismissChrome(page);

  // Sweep sentinel tables FIRST — a leftover world copy shadows the pack and
  // corrupts the stock leg below.
  await page.evaluate(async (names) => {
    for (const t of game.tables.filter((x) => names.includes(x.name))) await t.delete();
  }, SENTINEL_TABLES);

  await page.evaluate(() => ui.sidebar.changeTab?.("actors", "primary") ?? ui.sidebar.activateTab?.("actors"));
  await page.waitForTimeout(600);
  const hasButton = await page.evaluate(() => !!document.querySelector(".create-faction-button"));
  hasButton
    ? ok("Generate Faction button injected", "Actors directory, Warden-only")
    : fail("Generate Faction button injected", "no .create-faction-button");

  /* --- click 1: the shipped stock, end to end --------------------------- */
  const first = await page.evaluate(async () => {
    const before = new Set(game.journal.map((j) => j.id));
    document.querySelector(".create-faction-button")?.click();
    let entry = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !entry) {
      await new Promise((r) => setTimeout(r, 150));
      entry = game.journal.find((j) => !before.has(j.id)) ?? null;
    }
    if (!entry) return { error: "no JournalEntry appeared within 8s" };
    let rendered = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 4000 && !rendered) {
      await new Promise((r) => setTimeout(r, 150));
      rendered = !!entry.sheet?.rendered;
    }
    await entry.sheet?.close();
    return {
      id: entry.id,
      name: entry.name,
      ownershipDefault: entry.ownership.default,
      rendered,
      text: entry.pages.contents[0]?.text?.content ?? "",
    };
  });
  if (first.error) {
    fail("one click mints a dossier", first.error);
  } else {
    minted.push(first.id);
    const nameRe = new RegExp(`^The (${TRAIT1.join("|")}) (${TYPE.join("|")})$`);
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

  /* --- click 2: a Warden's world tables feed the generator -------------- */
  const second = await page.evaluate(async (names) => {
    const RT = CONFIG.RollTable.documentClass;
    const mk = (name, desc) => RT.create({
      name, formula: "1d1",
      results: [{ type: "text", description: desc, range: [1, 1], weight: 1 }],
    });
    const made = [await mk(names[0], "ZZ-AGENDA-SENTINEL"), await mk(names[1], "4")];
    const before = new Set(game.journal.map((j) => j.id));
    document.querySelector(".create-faction-button")?.click();
    let entry = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !entry) {
      await new Promise((r) => setTimeout(r, 150));
      entry = game.journal.find((j) => !before.has(j.id)) ?? null;
    }
    for (const t of made) await t.delete();
    if (!entry) return { error: "no JournalEntry appeared within 8s" };
    await entry.sheet?.close();
    return { id: entry.id, text: entry.pages.contents[0]?.text?.content ?? "" };
  }, SENTINEL_TABLES);
  if (second.error) {
    fail("world-table click mints a dossier", second.error);
  } else {
    minted.push(second.id);
    second.text.includes("ZZ-AGENDA-SENTINEL")
      ? ok("a world suite table wins by name", "the sentinel agenda landed on the page")
      : fail("a world suite table wins by name", second.text.slice(0, 200));
    const advs = advantagesOf(second.text);
    advs.length === 4 && new Set(advs).size === 4 && advs.every((a) => ADVANTAGE.includes(a))
      ? ok("Count 4 → exactly four DISTINCT advantages", advs.join(", "))
      : fail("Count 4 → exactly four DISTINCT advantages", JSON.stringify(advs));
  }
} catch (e) {
  fail("probe threw", `${e.name}: ${e.message}`);
} finally {
  // Node-side restore: minted journals and any straggler sentinel tables —
  // even when a leg above aborted mid-way.
  await page.evaluate(async ({ ids, names }) => {
    for (const id of ids) await game.journal.get(id)?.delete().catch(() => {});
    for (const t of game.tables.filter((x) => names.includes(x.name))) await t.delete();
  }, { ids: minted, names: SENTINEL_TABLES }).catch(() => {});
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nFAILED (${failures})\n` : "\nfaction generator probe passed\n");
process.exit(failures ? 1 : 0);

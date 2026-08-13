#!/usr/bin/env node
/**
 * A character never holds the same bond twice.
 *
 * A Fieldwarden rolls two bonds ("roll a second time on the Bonds table"), and on
 * the shipped 20-row table the second lands on the first about one generation in
 * twenty — which is exactly what a player reported. Outrider's "Always pay your
 * debts" answer does the same, and so does the sheet's "Add a bond".
 *
 * The rule lives in ONE place, `drawBond`'s `avoid` option (character-generator.js),
 * because there are three ways a second bond arrives and a rule kept in three
 * places agrees only by luck — the same reasoning that made `bondEntitlement` a
 * single function after its two hand-kept twins drifted.
 *
 * What is NOT asserted, deliberately: that a duplicate is impossible. It is
 * bounded, not forbidden. A custom background may name a bonds table with fewer
 * rows than the character has bonds — one row is legal — and there every draw is a
 * repeat. BOND_DRAW_ATTEMPTS caps the retries and then ACCEPTS the duplicate,
 * because a repeated bond is a nuisance while a missing one leaves the character
 * short of what the rules owe them. Leg 5 pins that: a one-row table still yields
 * two bonds and generation completes.
 *
 * Legs:
 *   1. drawBond re-rolls a duplicate            (dice seeded — deterministic)
 *   2. NEGATIVE CONTROL: the same seed with no `avoid` returns the duplicate,
 *      so leg 1 cannot pass on the seeding alone
 *   3. the retry CAP: every roll forced to the avoided row still returns a bond,
 *      not null, and returns at all
 *   4. real generation, 3-row table, 8 runs: the two bonds always differ
 *   5. real generation, 1-row table: two bonds, both the same, no hang
 *   6. the SHEET's re-roll button, clicked: it never lands on the other bond
 *
 * Dice are shadowed in-page (`CONFIG.Dice.randomUniform`, restored in finally) for
 * legs 1-3 only. The mapping is INVERTED — a face is `ceil((1 - u) * faces)` — so
 * `uFor` below is the whole reason those legs are readable.
 *
 * Legs 4 and 6 are probabilistic in their NEGATIVE direction and the numbers are
 * printed: with the fix removed, leg 4 catches the regression 96% of the time and
 * leg 6 87%. With the fix in place both are ~1e-4 from flaking. That asymmetry is
 * the acceptable one; a green run means what it says.
 *
 * Usage: npm run dev:bond-dupes
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const stage = (m) => console.log(`  stage  ${m}`);

const LITTER = {
  items: ["ZZ Bond Dupe Background"],
  actors: ["ZZ Bond Dupe PC"],
  tables: ["ZZ Bonds Three", "ZZ Bonds One"],
};

const dog = watchdog(180000, "bond-duplicates");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);

try {
  await joinAsGM(page);
  await dismissChrome(page);

  const sweep = async () => page.evaluate(async (names) => {
    const gone = [];
    for (const d of game.items.filter((d) => names.items.includes(d.name))) { await d.delete(); gone.push(`Item ${d.name}`); }
    for (const d of game.actors.filter((d) => names.actors.includes(d.name))) { await d.delete(); gone.push(`Actor ${d.name}`); }
    for (const d of game.tables.filter((d) => names.tables.includes(d.name))) { await d.delete(); gone.push(`Table ${d.name}`); }
    return gone;
  }, LITTER);

  const swept = await sweep();
  if (swept.length) console.log(`  note  swept ${swept.length} leftover(s): ${swept.join(", ")}`);

  /* ---------------------------------------------- 1-3. drawBond, seeded --- */
  stage("drawBond, with the dice pinned");

  const unit = await page.evaluate(async () => {
    const gen = await import(`/systems/${game.system.id}/module/character-generator.js`);
    const pack = game.packs.get("air-bladder.tables-2e");
    const table = (await pack.getDocuments()).find((t) => t.name === "Bonds");
    if (!table) return { error: "no shipped Bonds table" };
    const faces = 20;
    // Foundry maps a uniform to a face as ceil((1 - u) * faces): u = 0.4 IS face 4
    // on a d10. Mid-bucket, so no rounding argument can move it.
    const uFor = (n) => 1 - (n - 0.5) / faces;
    const textOf = (n) => {
      const r = table.results.find((x) => n >= x.range[0] && n <= x.range[1]);
      return (r?.type === "text" ? r.description : r?.name) ?? "";
    };
    const rowA = textOf(7);
    const rowB = textOf(11);
    if (!rowA || !rowB || rowA === rowB) return { error: "rows 7 and 11 are not two distinct texts" };

    const withSeed = async (seq, fn) => {
      const orig = CONFIG.Dice.randomUniform;
      let i = 0;
      CONFIG.Dice.randomUniform = () => seq[Math.min(i++, seq.length - 1)];
      try { return await fn(); } finally { CONFIG.Dice.randomUniform = orig; }
    };

    // Three duplicate draws, then a fresh row: the loop must roll past the repeats.
    const seq = [uFor(7), uFor(7), uFor(7), uFor(11)];
    const deduped = await withSeed(seq, () => gen.drawBond(undefined, { avoid: [rowA] }));
    const control = await withSeed(seq, () => gen.drawBond());

    // Every roll is row 7 forever, and row 7 is the one to avoid: the cap decides.
    const started = Date.now();
    const capped = await withSeed([uFor(7)], () => gen.drawBond(undefined, { avoid: [rowA] }));
    const cappedMs = Date.now() - started;

    return {
      rowA, rowB,
      dedupedText: deduped?.description ?? null,
      controlText: control?.description ?? null,
      cappedText: capped?.description ?? null,
      cappedNull: capped === null,
      cappedMs,
    };
  });

  if (unit.error) {
    fail(`setup: ${unit.error}`);
  } else {
    if (unit.dedupedText === unit.rowB) ok("a duplicate draw is re-rolled — three repeats skipped, row 11 taken");
    else fail(`duplicate NOT re-rolled — got ${JSON.stringify(unit.dedupedText)}, wanted row 11`);

    if (unit.controlText === unit.rowA) {
      ok("negative control: the same seed WITHOUT `avoid` returns the duplicate — leg 1 is load-bearing");
    } else {
      fail(`negative control did NOT reproduce the duplicate (got ${JSON.stringify(unit.controlText)}), `
        + "so leg 1 proves nothing — the seeding, not the fix, may be doing the work");
    }

    if (unit.cappedNull) fail("the retry cap returned NULL — a character loses a bond entirely");
    else if (unit.cappedText === unit.rowA) ok(`the cap accepts the duplicate rather than looping (${unit.cappedMs}ms)`);
    else fail(`the cap returned something unexpected: ${JSON.stringify(unit.cappedText)}`);
  }

  /* ------------------------------------------- 4-5. real generation ------- */
  stage("generation, through a background that grants two bonds");

  const RUNS = 8;
  const generated = await page.evaluate(async (runs) => {
    const three = await getDocumentClass("RollTable").create({
      name: "ZZ Bonds Three", formula: "1d3",
      results: [
        { type: "text", description: "ZZ bond alpha", range: [1, 1] },
        { type: "text", description: "ZZ bond beta", range: [2, 2] },
        { type: "text", description: "ZZ bond gamma", range: [3, 3] },
      ],
    });
    const one = await getDocumentClass("RollTable").create({
      name: "ZZ Bonds One", formula: "1d1",
      results: [{ type: "text", description: "ZZ the only bond", range: [1, 1] }],
    });
    const bg = await getDocumentClass("Item").create({
      name: "ZZ Bond Dupe Background", type: "background",
      system: {
        source: "2e", archetype: "Fighter", names: [], startingGear: [], tables: [],
        secondBond: true, bondsTable: three.name,
      },
    });

    const pairs = [];
    for (let i = 0; i < runs; i++) {
      const cd = await game.cairn.characterGenerator.generate2eCharacter(bg);
      pairs.push((cd?.bonds ?? []).map((b) => b.description));
    }

    await bg.update({ "system.bondsTable": one.name });
    const single = await game.cairn.characterGenerator.generate2eCharacter(bg);

    return {
      pairs,
      singleCount: (single?.bonds ?? []).length,
      singleTexts: (single?.bonds ?? []).map((b) => b.description),
      tables: [three.name, one.name],
    };
  }, RUNS);

  const shortPairs = generated.pairs.filter((p) => p.length !== 2);
  const collisions = generated.pairs.filter((p) => p.length === 2 && p[0] === p[1]);
  if (shortPairs.length) {
    fail(`${shortPairs.length}/${RUNS} generations produced ${JSON.stringify(shortPairs[0])} `
      + "instead of two bonds — the entitlement broke, so the distinctness below is meaningless");
  } else if (collisions.length) {
    fail(`${collisions.length}/${RUNS} generations rolled the SAME bond twice: `
      + `${JSON.stringify(collisions[0])}`);
  } else {
    ok(`${RUNS}/${RUNS} generations gave two DIFFERENT bonds from a 3-row table `
      + "(unfixed, this leg reds ~96% of the time)");
  }

  if (generated.singleCount === 2 && generated.singleTexts[0] === generated.singleTexts[1]) {
    ok("a ONE-row bonds table still yields two bonds — the cap accepts the repeat, generation completes");
  } else {
    fail("a one-row bonds table produced "
      + `${generated.singleCount} bond(s) ${JSON.stringify(generated.singleTexts)} — expected two identical`);
  }

  /* ------------------------------------------- 6. the sheet's button ------ */
  stage("the sheet's re-roll button, clicked");

  const actorId = await page.evaluate(async () => {
    const bg = game.items.getName("ZZ Bond Dupe Background");
    await bg.update({ "system.bondsTable": "ZZ Bonds Three" });
    const cd = await game.cairn.characterGenerator.generate2eCharacter(bg);
    const actor = await getDocumentClass("Actor").create({ name: "ZZ Bond Dupe PC", type: "character" });
    await actor.update({
      "system.bonds": cd.bonds,
      "system.backgroundUuid": bg.uuid,
      "system.generationEnabled": true,
    });
    await actor.sheet.render(true);
    return actor.id;
  });

  // Bonds live on the Background & Notes tab, which is not the one a sheet opens
  // on — the re-roll link exists in the DOM but is not visible, and Playwright
  // waits on visibility, so this click is what makes the leg run at all.
  await page.click('a[data-action="tab"][data-tab="notes"]');
  await page.waitForSelector('[data-action="rerollBond"]', { state: "visible", timeout: 15000 });

  const CLICKS = 5;
  const rerolls = [];
  for (let i = 0; i < CLICKS; i++) {
    const before = await page.evaluate((id) => game.actors.get(id).system.bonds.map((b) => b.description), actorId);
    const buttons = await page.$$('[data-action="rerollBond"]');
    if (!buttons.length) { fail("no re-roll button on the sheet — the leg never ran"); break; }
    await buttons[0].click();
    await page.waitForFunction(
      ([id, was]) => game.actors.get(id).system.bonds[0].description !== was,
      [actorId, before[0]],
      { timeout: 8000 },
    ).catch(() => null);
    const after = await page.evaluate((id) => game.actors.get(id).system.bonds.map((b) => b.description), actorId);
    rerolls.push({ before, after });
  }

  const clash = rerolls.find((r) => r.after.length === 2 && r.after[0] === r.after[1]);
  const stuck = rerolls.filter((r) => r.before[0] === r.after[0]);
  if (!rerolls.length) {
    fail("the re-roll leg produced no results");
  } else if (clash) {
    fail(`a re-roll landed on the character's other bond: ${JSON.stringify(clash.after)}`);
  } else {
    ok(`${rerolls.length} re-rolls, none collided with the other bond `
      + "(unfixed, this leg reds ~87% of the time)");
    if (stuck.length) {
      fail(`${stuck.length} re-roll(s) returned the SAME bond — with the other bond and itself both `
        + "avoided on a 3-row table, only one row is left, so this means `avoid` never arrived");
    } else {
      ok("no re-roll handed back the bond it replaced");
    }
  }

  const left = await sweep();
  console.log(`  note  cleaned up ${left.length} probe document(s)`);

  if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  clearTimeout(dog);
  console.log(`\n${failed ? "BOND DUPLICATE PROBE FAILED" : "Bond duplicate probe passed."}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}

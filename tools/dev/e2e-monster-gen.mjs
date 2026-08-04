#!/usr/bin/env node
/**
 * Generate Monster: the Warden's directory button, the tier picker, and the
 * shape of what it mints.
 *
 * The generator is table-driven (the 8 Warden monster tables) with a stats
 * layer that realizes the SRD's prose guidance as weighted dice — the design
 * of record is docs/monster-generation.md, and this probe asserts the shape
 * that design promises, not merely "an actor appeared".
 *
 * Coverage:
 *   1. the directory button renders for the GM — and NOT for Alice EVEN WHEN
 *      her role holds ACTOR_CREATE. The grant is what makes the leg mean
 *      anything: without it Alice gets no generator section at all, and the
 *      assertion passed identically with the isGM gate deleted (caught by this
 *      probe's own fail-witness run, 2026-08-01). Her Generate PC button is
 *      asserted PRESENT as the non-vacuousness witness. A GM can never see the
 *      player half of a permission policy (lib.mjs joinAs);
 *   2. the tier picker opens, and DISMISSING it creates nothing — a ✕ is an
 *      instruction, not a "surprise me" (the issue #6 rule);
 *   3. picking Standard creates an npc-typed actor, role monster: HP 3=3,
 *      abilities on the 3/6/10/14/18 ladder (DEX never at the extremes), exactly
 *      one starred attack item carrying d6, derived Armor <= 3 with any armor
 *      item drawn from the allowed names, a prose <ul> description whose bullets
 *      all carry a BOLD label ("Quirk:", "Weakness:", "Ability:", "Critical
 *      Damage:") and none of which ends in a period, a creature portrait
 *      mirrored onto a hostile unlinked token with STR/HP bars, and NO
 *      Connections tab;
 *   4. generating leaves the 8 Warden tables' drawn state untouched — roll(),
 *      never draw() (delta-checked, so a world with old draws still passes);
 *   5. the API tiers: serious -> HP 10/d10, hardier -> 6/d8, random ∈ {3,6,10};
 *   6. Roll NPC on a monster re-asks the TIER picker (monster-worded — the
 *      picker IS the confirmation), declining changes nothing after the full
 *      8s (the roll-npc lesson: "unchanged" read early means "not finished"),
 *      and accepting replaces the statblock while KEEPING name and portrait —
 *      the gorilla-into-alchemist guard, monster edition;
 *   7. a negative control feeds the shape checker a corrupted clone (HP 3->4,
 *      DEX 10->9) and requires it to object — a checker that passes corrupted
 *      data would make every green in leg 3 vacuous.
 *
 * Fail-witnesses (run 2026-08-01, each against an otherwise-green tree):
 *   - #onRollActor's monster branch removed -> leg 6 fails (NPC wording; the
 *     hireling regenerator overwrites the monster);
 *   - the isGM ternary dropped in cairn.js  -> the Alice leg fails (only with
 *     the ACTOR_CREATE grant above — that is why the grant exists);
 *   - TIERS.standard.hp changed to 4        -> legs 3 and 7 fail together.
 *
 * Needs the seeded players: run `npm run dev:players` once (Alice).
 * Usage: npm run dev:monster-gen
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog, withSettings } from "./lib.mjs";

const PREFIX = "ZZ Monster Gen";
const KEEP_NAME = "ZZ Monster Gen A";
const LADDER = [3, 6, 10, 14, 18];
const DEX_LADDER = [6, 10, 14];
const ARMOR_NAMES = ["Tough Hide", "Carapace", "Shell", "Scales"];
const CREATURE_CATEGORIES = ["animals", "creatures", "fish", "heads", "mammals", "reptiles", "skull"];
const ICON_PREFIX = "systems/air-bladder/art/game-icons/";
const ICON_FALLBACK = "systems/air-bladder/icons/monster.svg";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

/**
 * Everything leg 3 promises about a generated monster, as a pure function so
 * the negative control can feed it corrupted data. Returns human-readable
 * problems; [] means the shape holds.
 */
const shapeProblems = (s, { hp, die, checkName = false } = {}) => {
  const p = [];
  if (!s) return ["no actor snapshot at all"];
  if (s.type !== "npc") p.push(`type ${s.type}, not npc`);
  if (s.role !== "monster") p.push(`role ${s.role}, not monster`);
  if (s.hp?.value !== hp || s.hp?.max !== hp) p.push(`HP ${s.hp?.value}/${s.hp?.max}, expected ${hp}/${hp}`);
  for (const key of ["STR", "DEX", "WIL"]) {
    const a = s.abilities?.[key];
    if (!a || a.value !== a.max) p.push(`${key} ${a?.value}/${a?.max} is not value=max`);
    if (!LADDER.includes(a?.value)) p.push(`${key} ${a?.value} is off the 3/6/10/14/18 ladder`);
  }
  if (!DEX_LADDER.includes(s.abilities?.DEX?.value)) p.push(`DEX ${s.abilities?.DEX?.value} hit an extreme`);
  const attacks = (s.items ?? []).filter((i) => i.damageFormula);
  if (attacks.length !== 1) p.push(`${attacks.length} attack items, expected exactly 1`);
  const atk = attacks[0];
  if (atk) {
    if (atk.type !== "item") p.push(`attack is type ${atk.type}, not item`);
    if (atk.damageFormula !== die) p.push(`attack die ${atk.damageFormula}, expected ${die}`);
    if (!atk.equipped) p.push("attack item is not equipped");
    if (!atk.name.endsWith("*")) p.push(`attack "${atk.name}" lacks the * special-effect marker`);
  }
  if (typeof s.armorDerived !== "number" || s.armorDerived < 0 || s.armorDerived > 3) {
    p.push(`derived armor ${s.armorDerived} outside 0..3`);
  }
  for (const i of (s.items ?? []).filter((i) => (i.armor ?? 0) > 0)) {
    if (i.armor < 1 || i.armor > 3) p.push(`armor item "${i.name}" carries ${i.armor}`);
    if (!ARMOR_NAMES.includes(i.name)) p.push(`armor item named "${i.name}", not one of ${ARMOR_NAMES.join("/")}`);
  }
  if (!s.description?.includes("<ul>")) p.push("description is not the pack-shaped <ul>");
  if (!s.description?.includes("Critical Damage:")) p.push("description has no Critical Damage bullet");
  // The 2026-08-02 formatting ruling, asserted on the two halves that can
  // silently regress: no bullet ends in a period, and every label arrives bold.
  // Bullets are `<li><p>…</p></li>`, so ".</p>" is the whole of "ends with a
  // period" and costs one substring test.
  if (s.description?.includes(".</p>")) p.push("a description bullet ends with a period");
  for (const label of ["Quirk", "Weakness", "Ability", "Critical Damage"]) {
    if (!s.description?.includes(`<strong>${label}:</strong>`)) p.push(`the ${label} label is not bold`);
  }
  if (checkName) {
    if (!s.name?.endsWith("Creature")) p.push(`name "${s.name}" not composed from the appearance rolls`);
  }
  if (s.img?.startsWith(ICON_PREFIX)) {
    const category = s.img.slice(ICON_PREFIX.length).split("/")[0];
    if (!CREATURE_CATEGORIES.includes(category)) p.push(`portrait category "${category}" is not a creature category`);
  } else if (s.img !== ICON_FALLBACK) {
    p.push(`portrait ${s.img} is neither a game-icons creature nor the fallback`);
  }
  if (s.token?.textureSrc !== s.img) p.push(`token texture ${s.token?.textureSrc} != portrait ${s.img}`);
  if (s.token?.disposition !== -1) p.push(`token disposition ${s.token?.disposition}, not hostile`);
  if (s.token?.actorLink !== false) p.push("token is linked; pack monsters are unlinked");
  if (s.token?.bar1 !== "abilities.STR" || s.token?.bar2 !== "hp") {
    p.push(`token bars ${s.token?.bar1}/${s.token?.bar2}, expected abilities.STR/hp`);
  }
  return p;
};

/** The full snapshot shapeProblems reads, from the live world. */
const readMonster = (page, id) => page.evaluate((actorId) => {
  const a = game.actors.get(actorId);
  if (!a) return null;
  const grab = (k) => ({ value: a.system.abilities?.[k]?.value, max: a.system.abilities?.[k]?.max });
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    role: a.system.role,
    hp: { value: a.system.hp?.value, max: a.system.hp?.max },
    abilities: { STR: grab("STR"), DEX: grab("DEX"), WIL: grab("WIL") },
    armorDerived: a.system.armor,
    description: a.system.description ?? "",
    img: a.img,
    token: {
      disposition: a.prototypeToken?.disposition,
      actorLink: a.prototypeToken?.actorLink,
      bar1: a.prototypeToken?.bar1?.attribute,
      bar2: a.prototypeToken?.bar2?.attribute,
      textureSrc: a.prototypeToken?.texture?.src,
    },
    items: a.items.map((i) => ({
      id: i.id, name: i.name, type: i.type,
      damageFormula: i.system?.damageFormula ?? "",
      armor: i.system?.armor ?? 0,
      equipped: !!i.system?.equipped,
    })),
    modified: a._stats?.modifiedTime ?? 0,
  };
}, id);

const DIALOG = ".application.dialog, dialog.application";

const browser = await chromium.launch();
watchdog(300000, "monster-gen probe");
const gmContext = await browser.newContext({ viewport: VIEWPORT });
const page = await gmContext.newPage();
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

let createdId = null;
let permsPrior = null;

try {
  await withSettings(page, async () => {
    /* --- stale state, then the button ----------------------------------- */

    const setup = await page.evaluate(async (prefix) => {
      // Stale actors first: a leftover from an aborted run would satisfy the
      // regenerate leg's "name kept" check without the fix ever running.
      for (const s of game.actors.filter((a) => a.name.startsWith(prefix))) await s.delete();
      await game.settings.set("air-bladder", "show-generate-header", true);
      await ui.sidebar.changeTab?.("actors", "primary");
      await new Promise((res) => setTimeout(res, 600));
      // The Warden tables' drawn counts BEFORE any generation. Asserted as a
      // delta, not as zero: a human may have drawn on the world copies, and
      // that stale state must not be able to fail (or green) this probe.
      const pack = game.packs.get("air-bladder.warden-monsters");
      const tables = await pack.getDocuments();
      return {
        button: !!document.querySelector("#cairn-character-gen-button .create-monster-button"),
        drawnBefore: tables.map((t) => `${t.name}:${t.results.filter((r) => r.drawn).length}`).sort(),
        actorIds: game.actors.map((a) => a.id),
      };
    }, PREFIX);

    setup.button
      ? ok("the GM's directory has the Generate Monster button")
      : fail("no .create-monster-button in the GM's directory");
    if (!setup.button) return;

    /* --- the tier picker opens; dismissing creates nothing --------------- */

    await page.evaluate(() => document.querySelector(".create-monster-button").click());
    const picker = page.locator(DIALOG).last();
    try {
      await picker.waitFor({ state: "visible", timeout: 5000 });
      ok("the tier picker opened");
    } catch {
      fail("no tier picker appeared — nothing below can run");
      return;
    }
    const tierButtons = await Promise.all(
      ["standard", "hardier", "serious", "random"].map((t) =>
        picker.locator(`button[data-action="${t}"]`).count()),
    );
    tierButtons.every((n) => n === 1)
      ? ok("all four tier buttons render (standard/hardier/serious/random)")
      : fail(`tier buttons found: ${JSON.stringify(tierButtons)}`);

    await picker.locator('[data-action="close"]').click();
    await page.waitForTimeout(3000);
    const afterDismiss = await page.evaluate(() => game.actors.size);
    afterDismiss === setup.actorIds.length
      ? ok("dismissing the picker created nothing")
      : fail(`dismissing the picker changed the actor count ${setup.actorIds.length} -> ${afterDismiss}`);

    /* --- Standard creates, and the shape holds --------------------------- */

    console.log("\ngenerating a Standard monster");
    await page.evaluate(() => document.querySelector(".create-monster-button").click());
    const picker2 = page.locator(DIALOG).last();
    await picker2.waitFor({ state: "visible", timeout: 5000 });
    await picker2.locator('button[data-action="standard"]').click();

    let born = null;
    for (let i = 0; i < 30 && !born; i++) {
      await page.waitForTimeout(1000);
      born = await page.evaluate(async ({ known, keepName }) => {
        const fresh = game.actors.find((a) => !known.includes(a.id));
        if (!fresh) return null;
        const originalName = fresh.name;
        // Renamed the moment it is found, so the cleanup sweep owns it from
        // here even if an assertion below throws.
        await fresh.update({ name: keepName });
        return { id: fresh.id, originalName };
      }, { known: setup.actorIds, keepName: KEEP_NAME });
    }
    if (!born) {
      fail("picking Standard created no actor within 30s");
      return;
    }
    createdId = born.id;
    ok(`Standard created an actor ("${born.originalName}")`);

    const snap = await readMonster(page, createdId);
    snap.name = born.originalName; // the shape check reads the GENERATED name
    const problems = shapeProblems(snap, { hp: 3, die: "d6", checkName: true });
    problems.length === 0
      ? ok(`the Standard shape holds (STR ${snap.abilities.STR.value}, DEX ${snap.abilities.DEX.value}, `
        + `WIL ${snap.abilities.WIL.value}, ${snap.items.length} item(s), armor ${snap.armorDerived})`)
      : problems.forEach((m) => fail(`shape: ${m}`));
    if (born.originalName === "Monster") fail("the generated name fell back to \"Monster\" — the appearance tables did not roll");

    /* --- the sheet: no Connections tab, and the header button ------------ */

    const sheet = await page.evaluate(async (id) => {
      const a = game.actors.get(id);
      await a.sheet.render(true);
      await new Promise((res) => setTimeout(res, 800));
      const el = a.sheet.element;
      const roll = el.querySelector('button[data-action="rollActor"]');
      const hiddenAtBirth = roll?.classList.contains("cairn-header-hidden") ?? null;
      // A generated monster lands with Randomization OFF (2026-08-02), so the
      // regenerate legs below flip it the way a Warden does — the real toggle.
      el.querySelector('button[data-action="toggleGeneration"]')?.click();
      await new Promise((res) => setTimeout(res, 700));
      return {
        sheetId: a.sheet.id,
        connectionsTab: !!el.querySelector('a[data-tab="containers"]'),
        rollButton: !!roll,
        hiddenAtBirth,
        rollText: roll?.textContent.trim() ?? null,
        rollIcon: [...(roll?.querySelector("i")?.classList ?? [])].find((c) => c.startsWith("fa-")) ?? null,
      };
    }, createdId);
    sheet.connectionsTab
      ? fail("a generated monster has a Connections tab")
      : ok("no Connections tab on the generated monster");
    sheet.hiddenAtBirth === true
      ? ok("a generated monster lands with Randomization off", "the Roll button starts hidden")
      : fail(`a generated monster lands with Randomization off (hiddenAtBirth=${sheet.hiddenAtBirth})`);
    sheet.rollButton
      ? ok("the Roll header button renders (the regenerate leg can run)")
      : fail("no rollActor header button — the regenerate leg cannot run");
    sheet.rollText === "Roll Monster" && sheet.rollIcon === "fa-dragon"
      ? ok('it says "Roll Monster" and wears the dragon', sheet.rollIcon)
      : fail(`the monster Roll button face is wrong (text="${sheet.rollText}" icon=${sheet.rollIcon})`);

    /* --- roll(), never draw() -------------------------------------------- */

    const drawnAfter = await page.evaluate(async () => {
      const pack = game.packs.get("air-bladder.warden-monsters");
      const tables = await pack.getDocuments();
      return tables.map((t) => `${t.name}:${t.results.filter((r) => r.drawn).length}`).sort();
    });
    JSON.stringify(drawnAfter) === JSON.stringify(setup.drawnBefore)
      ? ok("the 8 Warden tables' drawn state is untouched (roll(), never draw())")
      : fail(`generation dirtied the Warden tables: ${JSON.stringify(setup.drawnBefore)} -> ${JSON.stringify(drawnAfter)}`);

    /* --- API tiers (plain data, no actors) -------------------------------- */

    const tiers = await page.evaluate(async () => {
      const gen = game.cairn.monsterGenerator.generateMonster;
      const read = (m) => ({ hp: m.hp, die: m.items.find((i) => i.system.damageFormula)?.system.damageFormula });
      return {
        serious: read(await gen("serious")),
        hardier: read(await gen("hardier")),
        random: [read(await gen("random")), read(await gen("random")), read(await gen("random"))],
      };
    });
    tiers.serious.hp === 10 && tiers.serious.die === "d10"
      ? ok("serious -> HP 10, d10")
      : fail(`serious -> ${JSON.stringify(tiers.serious)}`);
    tiers.hardier.hp === 6 && tiers.hardier.die === "d8"
      ? ok("hardier -> HP 6, d8")
      : fail(`hardier -> ${JSON.stringify(tiers.hardier)}`);
    tiers.random.every((r) => [3, 6, 10].includes(r.hp))
      ? ok("random resolves to a real tier every time")
      : fail(`random produced ${JSON.stringify(tiers.random)}`);

    /* --- regenerate: the picker IS the confirmation ----------------------- */

    console.log("\nRoll on the monster sheet: decline, then Hardier");
    const beforeRegen = await readMonster(page, createdId);
    const rollButton = `#${sheet.sheetId} .window-header button[data-action="rollActor"]`;
    await page.click(rollButton);
    const regenDialog = page.locator(DIALOG).last();
    await regenDialog.waitFor({ state: "visible", timeout: 5000 });
    const title = (await regenDialog.locator(".window-title").innerText().catch(() => "")) || "";
    /monster/i.test(title)
      ? ok(`the re-roll ask is monster-worded ("${title.trim()}")`)
      : fail(`the re-roll ask is not monster-worded ("${title.trim()}") — the hireling path answered`);

    await regenDialog.locator('[data-action="close"]').click();
    // Regeneration takes seconds; read too early and "unchanged" only means
    // "not finished yet" (the roll-npc lesson).
    await page.waitForTimeout(8000);
    const afterDecline = await readMonster(page, createdId);
    afterDecline.modified === beforeRegen.modified
      ? ok("dismissing the re-roll ask changed nothing")
      : fail("dismissing the re-roll ask still modified the actor");

    await page.click(rollButton);
    const regenDialog2 = page.locator(DIALOG).last();
    await regenDialog2.waitFor({ state: "visible", timeout: 5000 });
    await regenDialog2.locator('button[data-action="hardier"]').click();

    let afterRegen = null;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      afterRegen = await readMonster(page, createdId);
      if (afterRegen && afterRegen.modified !== beforeRegen.modified) break;
    }
    if (!afterRegen || afterRegen.modified === beforeRegen.modified) {
      fail("accepting the re-roll did nothing — the ask above proves nothing");
    } else {
      const regenProblems = shapeProblems(afterRegen, { hp: 6, die: "d8" });
      regenProblems.length === 0
        ? ok("the Hardier re-roll produced a well-shaped monster")
        : regenProblems.forEach((m) => fail(`re-roll shape: ${m}`));
      afterRegen.name === KEEP_NAME
        ? ok("the re-roll KEPT the name")
        : fail(`the re-roll renamed ${KEEP_NAME} -> ${afterRegen.name}`);
      afterRegen.img === beforeRegen.img
        ? ok("the re-roll KEPT the portrait")
        : fail(`the re-roll swapped the portrait ${beforeRegen.img} -> ${afterRegen.img}`);
      const oldIds = new Set(beforeRegen.items.map((i) => i.id));
      afterRegen.items.some((i) => oldIds.has(i.id))
        ? fail("old embedded items survived the re-roll")
        : ok("the re-roll replaced the embedded items");
    }

    /* --- negative control: the shape checker must be able to object ------- */

    const corrupted = JSON.parse(JSON.stringify(snap));
    corrupted.hp.value = 4;
    corrupted.abilities.DEX.value = 9;
    corrupted.abilities.DEX.max = 9;
    const objections = shapeProblems(corrupted, { hp: 3, die: "d6", checkName: true });
    objections.length >= 2
      ? ok(`the shape checker objects to corrupted data (${objections.length} problems)`)
      : fail("the shape checker PASSED corrupted data — every shape green above is vacuous");
  });

  /* --- Alice: Warden-only means no button even WITH actor-create ---------- */

  // Grant Alice's role ACTOR_CREATE first. Without it she gets no generator
  // section at all and the assertion below passes with the isGM gate deleted —
  // this probe's own fail-witness run proved that. Restored in the finally.
  permsPrior = await page.evaluate(async () => {
    const prior = JSON.stringify(game.settings.get("core", "permissions"));
    const next = JSON.parse(prior);
    const role = game.users.getName("Alice")?.role;
    if (role == null) return null;
    next.ACTOR_CREATE ??= [];
    if (!next.ACTOR_CREATE.includes(role)) next.ACTOR_CREATE.push(role);
    await game.settings.set("core", "permissions", next);
    return prior;
  });
  if (!permsPrior) fail("no Alice user in the world — run `npm run dev:players` first");

  console.log("\njoining as Alice (with ACTOR_CREATE)");
  const aliceContext = await browser.newContext({ viewport: VIEWPORT });
  const alice = await aliceContext.newPage();
  const aliceErrors = watchErrors(alice);
  await joinAs(alice, "Alice");
  const aliceSees = await alice.evaluate(async () => {
    await ui.sidebar.changeTab?.("actors", "primary");
    await new Promise((res) => setTimeout(res, 600));
    return {
      pcButton: !!document.querySelector(".create-character-generator-button"),
      monsterButton: !!document.querySelector(".create-monster-button"),
      isGM: game.user.isGM,
    };
  });
  if (aliceSees.isGM) fail("the Alice leg joined as a GM — it proves nothing");
  aliceSees.pcButton
    ? ok("Alice (with ACTOR_CREATE) sees the Generate PC button — the leg is not vacuous")
    : fail("Alice sees no generator section at all — the ACTOR_CREATE grant did not take, and the check below proves nothing");
  aliceSees.monsterButton
    ? fail("Alice can see the Generate Monster button — Warden-only failed")
    : ok("Alice has no Generate Monster button");
  errors.push(...aliceErrors);
  await aliceContext.close();
} finally {
  // Node-level cleanup: an exception above must not leave ZZ actors behind,
  // nor a player permission the world did not have before.
  if (permsPrior) {
    await page.evaluate(async (p) => {
      await game.settings.set("core", "permissions", JSON.parse(p));
    }, permsPrior).catch(() => {});
  }
  await page.evaluate(async (prefix) => {
    for (const a of game.actors.filter((x) => x.name.startsWith(prefix))) await a.delete();
  }, PREFIX).catch(() => {});
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "MONSTER GEN PROBE FAILED" : "Monster gen probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

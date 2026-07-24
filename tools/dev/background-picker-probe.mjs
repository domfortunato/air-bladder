#!/usr/bin/env node
/**
 * Background picker + per-field background swap.
 *
 *   node tools/dev/background-picker-probe.mjs   (needs Foundry running, world launched)
 *
 * The picker is one function for both editions, driven by the data: 2e
 * backgrounds carry an archetype and prose, so it groups and previews them;
 * Barebones ones carry neither, so it falls back to a flat list summarised by the
 * gear each grants. The swap is likewise one function, and its whole point is
 * that it is SURGICAL — change the background and what it granted, keep the
 * character.
 *
 * Steps, driven headless as GM:
 *   1. Grouping: 2e comes back grouped under real archetypes; Barebones comes
 *      back as one unnamed group of 100, alphabetical.
 *   2. Taglines: a 2e tagline is the first sentence of its prose; a Barebones one
 *      is the gear it grants, DERIVED from the references (so a pool rename shows
 *      up in the picker without re-authoring anything).
 *   3. The dialog renders, is pre-checked on the character's current background,
 *      and offers Random.
 *   4. THE SWAP KEEPS THE CHARACTER: abilities, HP, name, traits, age, bonds,
 *      portrait and a bought item all survive; the old background's gear is gone,
 *      the new one's is present and equipped, questions and coins move with it.
 *   5. Containers move too: swapping onto the Kettlewright grants its donkey, and
 *      swapping away deletes it.
 *   6. A random swap never lands on the background you already had.
 *   7. Barebones swaps the same way through the same function.
 * Exits non-zero on any failed assertion or console error.
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

try {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const made = [];
    const track = (a) => { if (a) made.push(a); return a; };
    const containersOf = (actor) =>
      game.actors.filter((a) => a.type === "container" && a.system?.keeper === actor.uuid);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));

    // 1. Grouping, per edition.
    const g2e = await gen.getBackgroundsByArchetype("2e");
    const gbb = await gen.getBackgroundsByArchetype("barebones");
    const grouping = {
      archetypes: g2e.map((g) => g.archetype),
      grouped2e: g2e.length > 1 && g2e.every((g) => g.archetype),
      count2e: g2e.reduce((n, g) => n + g.backgrounds.length, 0),
      flatBarebones: gbb.length === 1 && gbb[0].archetype === "",
      countBB: gbb[0]?.backgrounds.length ?? 0,
      bbSorted: gbb[0]?.backgrounds.every((b, i, a) => i === 0 || a[i - 1].name.localeCompare(b.name) <= 0),
      // and each group is name-sorted internally
      sorted2e: g2e.every((g) => g.backgrounds.every((b, i, a) => i === 0 || a[i - 1].name.localeCompare(b.name) <= 0)),
    };

    // 2. Taglines.
    const kettle = g2e.flatMap((g) => g.backgrounds).find((b) => b.name === "Kettlewright");
    const beadle = gbb[0].backgrounds.find((b) => b.name === "Beadle");
    const tagline = {
      prose: gen.backgroundTagline(kettle),
      // one sentence, not the whole description
      proseIsOneSentence: gen.backgroundTagline(kettle).length < (kettle.system.description ?? "").length,
      gear: gen.backgroundTagline(beadle),
      // derived from the references, so it names exactly what the background grants
      gearMatchesRefs: gen.backgroundTagline(beadle) ===
        (beadle.system.startingGear ?? []).map((g) => g.name).join(", "),
    };

    // A 2e character to swap around.
    const bgs2e = g2e.flatMap((g) => g.backgrounds);
    const start = bgs2e.find((b) => b.name === "Fieldwarden");
    const actor = track(await gen.createActorWithCharacter(await gen.generate2eCharacter(start)));
    for (const c of containersOf(actor)) made.push(c);

    // 3. The dialog renders, pre-checked, with a Random row.
    const pick = gen.promptBackground("2e", actor.system.backgroundUuid);
    await wait(400);
    const root = document.querySelector(".bg-picker");
    const dialogInfo = {
      rendered: !!root,
      twoColumn: !!root && !root.classList.contains("single"),
      rows: root?.querySelectorAll('input[name="bg"]').length ?? 0,
      hasRandom: !!root?.querySelector('input[value="__random__"]'),
      checkedIsCurrent: root?.querySelector('input[name="bg"]:checked')?.value === actor.system.backgroundUuid,
      groupHeadings: root?.querySelectorAll(".bg-pick-group").length ?? 0,
      // the description panel previews the checked background
      panelFilled: (root?.querySelector(".bg-pick-desc")?.innerHTML ?? "").length > 20,
    };
    // Cancel it: the dialog must resolve false, not hang.
    document.querySelector(".bg-picker")?.closest(".application")
      ?.querySelector('button[data-action="cancel"]')?.click();
    const cancelled = await pick;
    dialogInfo.cancelResolvesFalse = cancelled === false;

    // 4. The surgical swap.
    const before = {
      name: actor.name,
      abilities: JSON.stringify(actor.system.abilities),
      hp: actor.system.hp.max,
      traits: JSON.stringify(actor.system.traits),
      age: actor.system.age,
      bonds: (actor.system.bonds ?? []).length,
      img: actor.img,
      gold: actor.system.gold,
      qGold: (actor.system.questions ?? []).reduce((n, q) => n + (q.gold ?? 0), 0),
      bgGear: actor.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "background").map((i) => i.name),
    };
    // Something the player owns, which must never be touched by a swap.
    const [bought] = await actor.createEmbeddedDocuments("Item", [{ name: "PROBE Bought Lantern", type: "item" }]);

    await gen.changeBackground(actor, kettle);
    for (const c of containersOf(actor)) made.push(c);

    // Compare against RESOLVED names, not reference names: an alias resolves to a
    // different canonical item ("Torches" -> "Torch"), so matching the raw
    // reference would fail on a swap that actually worked.
    const { resolveGearItem } = await import("/systems/air-bladder/module/gear.js");
    const resolvedNames = async (b) => (await Promise.all(
      (b.system.startingGear ?? []).map((g) => resolveGearItem(g.name))
    )).filter(Boolean).map((i) => i.name);
    const newRefs = await resolvedNames(kettle);
    const nowBgGear = actor.items.filter((i) => i.getFlag("air-bladder", "grantSource") === "background");
    const swap = {
      background: actor.system.background,
      uuidLinked: actor.system.backgroundUuid === kettle.uuid,
      // kept
      keptName: actor.name === before.name,
      keptAbilities: JSON.stringify(actor.system.abilities) === before.abilities,
      keptHp: actor.system.hp.max === before.hp,
      keptTraits: JSON.stringify(actor.system.traits) === before.traits,
      keptAge: actor.system.age === before.age,
      keptBonds: (actor.system.bonds ?? []).length === before.bonds,
      keptPortrait: actor.img === before.img,
      keptBought: !!actor.items.get(bought.id),
      // swapped
      // Checked against the WHOLE inventory, not the tagged subset: mundane
      // background gear (Rations, Torch) is deliberately left untagged so it
      // carries no source chip, and it still has to arrive.
      oldGearGone: before.bgGear.every((n) => newRefs.includes(n) || !actor.items.some((i) => i.name === n)),
      newGearPresent: newRefs.every((n) => actor.items.some((i) => i.name === n)),
      // The failure mode that matters for untagged gear: a swap that adds the new
      // Rations without removing the old leaves the character holding two.
      duplicates: [...new Set(actor.items.map((i) => i.name))]
        .filter((n) => actor.items.filter((i) => i.name === n).length > 1),
      newGearEquipped: nowBgGear.filter((i) => i.type === "weapon" || i.type === "armor")
        .every((i) => i.system.equipped),
      questions: (actor.system.questions ?? []).length,
      // coins traded the old questions' gold for the new ones'
      goldTraded: actor.system.gold ===
        Math.max(0, before.gold - before.qGold + (actor.system.questions ?? []).reduce((n, q) => n + (q.gold ?? 0), 0)),
    };

    // 5. Containers follow the background. Kettlewright's donkey is on a choice
    //    table, so force it by swapping onto the Outrider (every option is a horse).
    const outrider = bgs2e.find((b) => b.name === "Outrider");
    await gen.changeBackground(actor, outrider);
    for (const c of containersOf(actor)) made.push(c);
    const withHorse = containersOf(actor).filter((c) => c.getFlag("air-bladder", "grantSource"));
    const bonekeeper = bgs2e.find((b) => b.name === "Bonekeeper");
    await gen.changeBackground(actor, bonekeeper);
    for (const c of containersOf(actor)) made.push(c);
    const afterSwapAway = containersOf(actor).filter((c) => c.getFlag("air-bladder", "grantSource"));
    const containers = {
      gotHorse: withHorse.length === 1,
      horse: withHorse[0]?.name,
      // The Bonekeeper's beast is on one of six options, so this is 0 or more —
      // what matters is the Outrider's horse is not still hanging around.
      oldGone: !afterSwapAway.some((c) => c.uuid === withHorse[0]?.uuid),
      danglingFree: (actor.system.containers ?? []).every((u) => !!game.actors.find((a) => a.uuid === u)),
    };

    // 6. A random swap never repeats the current background.
    let repeated = false;
    for (let i = 0; i < 8; i++) {
      const was = actor.system.backgroundUuid;
      await gen.changeBackground(actor, null);
      for (const c of containersOf(actor)) made.push(c);
      if (actor.system.backgroundUuid === was) { repeated = true; break; }
    }

    // 7. Barebones swaps through the same function.
    const bbActor = track(await gen.createActorWithCharacter(await gen.generateBarebonesCharacter()));
    for (const c of containersOf(bbActor)) made.push(c);
    const bbBefore = { name: bbActor.name, bg: bbActor.system.background, hp: bbActor.system.hp.max };
    const merchant = gbb[0].backgrounds.find((b) => b.name === "Merchant");
    await gen.changeBackground(bbActor, merchant);
    for (const c of containersOf(bbActor)) made.push(c);
    const bbSwap = {
      background: bbActor.system.background,
      keptName: bbActor.name === bbBefore.name,
      keptHp: bbActor.system.hp.max === bbBefore.hp,
      source: bbActor.system.contentSource,
      // the Merchant's wagon is a container, and arrives on a swap too
      wagon: containersOf(bbActor).some((c) => c.name === "Wagon"),
      // The Merchant's gear is a Stylus plus a "Random Additional Gear" roll —
      // an SRD instruction, not an item — so count what the background tagged
      // rather than name-matching the references.
      gearPresent: (await resolvedNames(merchant)).every((n) =>
        bbActor.items.some((i) => i.name === n)),
      taggedCount: bbActor.items.filter(
        (i) => i.getFlag("air-bladder", "grantSource") === "background").length,
      refCount: (merchant.system.startingGear ?? []).length,
    };

    // Barebones renders the single-column variant.
    const pick2 = gen.promptBackground("barebones", bbActor.system.backgroundUuid);
    await wait(400);
    const root2 = document.querySelector(".bg-picker");
    const bbDialog = {
      rendered: !!root2,
      singleColumn: !!root2?.classList.contains("single"),
      rows: root2?.querySelectorAll('input[name="bg"]').length ?? 0,
      noPanel: !root2?.querySelector(".bg-pick-desc"),
      noHeadings: (root2?.querySelectorAll(".bg-pick-group").length ?? 0) === 0,
    };
    document.querySelector(".bg-picker")?.closest(".application")
      ?.querySelector('button[data-action="cancel"]')?.click();
    await pick2;

    for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
    return { grouping, tagline, dialogInfo, swap, containers, randomRepeated: repeated, bbSwap, bbDialog };
  });

  if (r.error) {
    fail(r.error);
  } else {
    const G = r.grouping;
    G.grouped2e && G.count2e === 20 ? ok(`2e groups by archetype: ${G.archetypes.join(", ")} (${G.count2e} backgrounds)`) : fail(`2e grouping wrong: ${JSON.stringify(G.archetypes)}`);
    G.flatBarebones && G.countBB === 100 ? ok("Barebones comes back as one flat group of 100") : fail(`Barebones grouping wrong: ${G.countBB} in ${G.flatBarebones ? 1 : "many"} groups`);
    G.sorted2e && G.bbSorted ? ok("every group is name-sorted") : fail("a group is not name-sorted");

    r.tagline.proseIsOneSentence ? ok(`2e tagline is one sentence: "${r.tagline.prose.slice(0, 60)}…"`) : fail("2e tagline is not a single sentence");
    r.tagline.gearMatchesRefs ? ok(`Barebones tagline is its derived gear: "${r.tagline.gear}"`) : fail(`Barebones tagline wrong: "${r.tagline.gear}"`);

    const D = r.dialogInfo;
    D.rendered && D.twoColumn ? ok(`picker rendered two-column with ${D.rows} rows and ${D.groupHeadings} archetype headings`) : fail("picker did not render the two-column layout");
    D.hasRandom ? ok("a Random row is offered") : fail("no Random row");
    D.checkedIsCurrent ? ok("opens pre-checked on the character's current background") : fail("did not pre-check the current background");
    D.panelFilled ? ok("the description panel previews the checked background") : fail("description panel is empty");
    D.cancelResolvesFalse ? ok("Cancel resolves false (no hang, no swap)") : fail("Cancel did not resolve false");

    const S = r.swap;
    S.uuidLinked ? ok(`swapped to ${S.background}, linked by uuid`) : fail("swap did not relink the background uuid");
    S.keptName && S.keptAbilities && S.keptHp && S.keptTraits && S.keptAge && S.keptBonds && S.keptPortrait
      ? ok("KEEPS THE CHARACTER: name, abilities, HP, traits, age, bonds and portrait all survive")
      : fail(`swap clobbered the character: ${JSON.stringify(S)}`);
    S.keptBought ? ok("an item the player bought is untouched") : fail("the swap deleted a bought item");
    S.oldGearGone && S.newGearPresent ? ok("the old background's gear is gone and the new one's is present") : fail(`gear swap wrong (oldGone=${S.oldGearGone}, newPresent=${S.newGearPresent})`);
    S.duplicates.length === 0 ? ok("no item was duplicated by the swap (untagged Rations/Torch included)") : fail(`the swap duplicated: ${S.duplicates.join(", ")}`);
    S.newGearEquipped ? ok("new weapons/armor arrive equipped") : fail("new weapon/armor was not equipped");
    S.questions === 2 && S.goldTraded ? ok(`questions re-rolled (${S.questions}) and coins traded for the new ones`) : fail(`questions=${S.questions}, goldTraded=${S.goldTraded}`);

    r.containers.gotHorse ? ok(`swapping onto the Outrider granted its ${r.containers.horse}`) : fail("no container arrived with the Outrider");
    r.containers.oldGone && r.containers.danglingFree ? ok("swapping away deletes it and leaves no dangling uuid") : fail("the old container survived the swap or left a dangling uuid");

    !r.randomRepeated ? ok("a random swap never repeats the current background (8 swaps)") : fail("a random swap landed on the background it already had");

    r.bbSwap.keptName && r.bbSwap.keptHp && r.bbSwap.source === "barebones"
      ? ok(`Barebones swaps through the same function (now ${r.bbSwap.background}, character kept)`)
      : fail(`Barebones swap wrong: ${JSON.stringify(r.bbSwap)}`);
    r.bbSwap.gearPresent && r.bbSwap.wagon ? ok("its gear and its Wagon container both arrived") : fail(`Barebones swap gear=${r.bbSwap.gearPresent}, wagon=${r.bbSwap.wagon}`);
    // The Merchant grants a Stylus + a "Random Additional Gear" roll; both must
    // land, so the tag count matches the reference count. This is the assertion
    // that catches an SRD instruction being silently dropped.
    r.bbSwap.taggedCount === r.bbSwap.refCount
      ? ok(`its SRD "Random Additional Gear" row resolved to a real item (${r.bbSwap.taggedCount}/${r.bbSwap.refCount} granted)`)
      : fail(`an instruction row was dropped: ${r.bbSwap.taggedCount} items for ${r.bbSwap.refCount} references`);

    const B = r.bbDialog;
    B.rendered && B.singleColumn && B.noPanel && B.noHeadings
      ? ok(`Barebones picker renders single-column, no panel, no headings (${B.rows} rows)`)
      : fail(`Barebones picker layout wrong: ${JSON.stringify(B)}`);
  }
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) {
    console.error("\nconsole errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "\nBACKGROUND-PICKER PROBE FAILED\n" : "\nbackground-picker probe passed\n");
process.exit(failed ? 1 : 0);

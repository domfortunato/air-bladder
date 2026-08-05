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
 *   4. THE SWAP KEEPS THE CHARACTER: abilities, HP, name, traits, age,
 *      portrait and a bought item all survive; the old background's gear is gone,
 *      the new one's is present and equipped, questions and coins move with it.
 *      Bonds are kept WITHIN the new background's entitlement and clamped above
 *      it (ruled 2026-08-02): Fieldwarden's second bond is removed on the swap
 *      to Kettlewright — first bond kept, its items deleted, its gold refunded.
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
      game.actors.filter((a) => a.system?.connectedTo === actor.uuid);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    // POLL, never sleep: pack.getDocuments() is a server round trip on every
    // call, so the picker's open time tracks the server, not the code — a
    // fixed 400ms here was a race that a slow world turned into a probe that
    // never cancels its own dialog and hangs on the await (2026-08-04).
    const waitFor = async (test, ms = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (test()) return true; await wait(100); }
      return false;
    };

    // 1. Grouping, per edition.
    const g2e = await gen.getBackgroundsByArchetype("2e");
    const gbb = await gen.getBackgroundsByArchetype("barebones");
    // The 2e pool is a UNION of the shipped pack and the Warden's own backgrounds,
    // so its size is not a constant — it grows by one every time someone uses the
    // authoring sheet, which is a shipped feature. This asserted `=== 20` and so
    // went red in any world that had ever authored one, blaming the grouping.
    // Assert instead that every SHIPPED background survives the grouping, and read
    // the roster from the pack so it cannot drift when the content changes.
    const shipped2e = (await game.packs.get("air-bladder.backgrounds-2e")?.getIndex())
      ?.contents.map((d) => d.name) ?? [];
    const seen2e = new Set(g2e.flatMap((g) => g.backgrounds).map((b) => b.name));
    const grouping = {
      archetypes: g2e.map((g) => g.archetype),
      grouped2e: g2e.length > 1 && g2e.every((g) => g.archetype),
      count2e: g2e.reduce((n, g) => n + g.backgrounds.length, 0),
      shipped2e: shipped2e.length,
      missingShipped: shipped2e.filter((n) => !seen2e.has(n)),
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
    await waitFor(() => document.querySelector(".bg-picker"));
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
      // the authoring pointer (2026-08-05): a real link to the how-to guide,
      // surviving DialogV2's content sanitization
      footLinksGuide: (root?.querySelector(".bg-pick-foot a")?.getAttribute("href") ?? "")
        .endsWith("creating-custom-backgrounds.md"),
    };
    // Cancel it: the dialog must resolve false, not hang.
    document.querySelector(".bg-picker")?.closest(".application")
      ?.querySelector('button[data-action="cancel"]')?.click();
    const cancelled = await pick;
    dialogInfo.cancelResolvesFalse = cancelled === false;

    // 3b. THE EYE TOGGLE (2026-08-04): every 2e row carries a Warden-only
    //     disable control — canon and custom alike; Barebones has none (its
    //     source checkbox is all-or-nothing). State is the world setting, the
    //     POOL filters it (random rolls included), and the Warden still sees
    //     disabled rows greyed so a disable can be undone. Preconditions are
    //     established here and restored in the teardown below — a leftover
    //     disabled uuid would silently shrink every later pool count.
    const NS = "air-bladder";
    const offWas = game.settings.get(NS, "disabled-backgrounds") ?? [];
    const customWas = game.settings.get(NS, "content-source-custom");
    const disable = {};
    try {
      await game.settings.set(NS, "disabled-backgrounds", []);
      await game.settings.set(NS, "content-source-custom", true);

      // The shipped custom pack renders as its own picker section, last.
      const gC = await gen.getBackgroundsByArchetype("2e");
      const customGroup = gC.find((g) => g.archetype === "Custom");
      disable.customSection = !!customGroup && customGroup.backgrounds.length >= 7
        && gC[gC.length - 1] === customGroup;

      const allC = gC.flatMap((g) => g.backgrounds);
      const victim = allC.find((b) => b.name === "Prowler");        // canon
      const customVictim = customGroup?.backgrounds.find((b) => b.name === "Cleric");

      // API round trip on a CANON background: the pool excludes it, the
      // Warden's grouped view keeps it, the setting records it.
      await gen.toggleBackgroundDisabled(victim.uuid);
      disable.poolExcludes = !(await gen.getBackgroundsFor("2e")).some((b) => b.uuid === victim.uuid);
      disable.gmStillSees = (await gen.getBackgroundsByArchetype("2e"))
        .flatMap((g) => g.backgrounds).some((b) => b.uuid === victim.uuid);
      disable.settingHolds = game.settings.get(NS, "disabled-backgrounds").includes(victim.uuid);

      // A shipped CUSTOM background disables through the same path.
      await gen.toggleBackgroundDisabled(customVictim.uuid);
      disable.customExcluded = !(await gen.getBackgroundsFor("2e")).some((b) => b.uuid === customVictim.uuid);
      await gen.toggleBackgroundDisabled(customVictim.uuid);

      // The rendered dialog: an eye on every background row (Random has none),
      // the disabled row greyed with a dead radio, and the eye click
      // re-enabling it LIVE — row, radio and setting together.
      const pickD = gen.promptBackground("2e", null);
      await waitFor(() => document.querySelector(".bg-picker"));
      const rootD = document.querySelector(".bg-picker");
      const rowsD = rootD?.querySelectorAll('input[name="bg"]').length ?? 0;
      disable.eyeMatchesRows = (rootD?.querySelectorAll(".bg-pick-eye").length ?? 0) === rowsD - 1;
      const rowD = [...(rootD?.querySelectorAll(".bg-pick-row") ?? [])]
        .find((r) => r.querySelector(`input[value="${victim.uuid}"]`));
      disable.rowGreyed = !!rowD?.classList.contains("bg-pick-off");
      disable.radioDead = !!rowD?.querySelector("input")?.disabled;
      rowD?.querySelector(".bg-pick-eye")?.click();
      // The click handler awaits a world-setting round trip before it touches
      // the row — poll for the flip, don't time it.
      await waitFor(() => rowD && !rowD.classList.contains("bg-pick-off"), 10000);
      disable.reEnabledLive = !!rowD && !rowD.classList.contains("bg-pick-off")
        && !rowD.querySelector("input").disabled
        && !game.settings.get(NS, "disabled-backgrounds").includes(victim.uuid);
      document.querySelector(".bg-picker")?.closest(".application")
        ?.querySelector('button[data-action="cancel"]')?.click();
      await pickD;

      // The floor: with every background but one already off, disabling the
      // last is REFUSED and the setting is untouched by the attempt.
      const pool = await gen.getBackgroundsFor("2e");
      const last = pool[0];
      await game.settings.set(NS, "disabled-backgrounds", pool.slice(1).map((b) => b.uuid));
      const refused = await gen.toggleBackgroundDisabled(last.uuid);
      disable.lastRefused = refused === null
        && !game.settings.get(NS, "disabled-backgrounds").includes(last.uuid);
    } finally {
      await game.settings.set(NS, "disabled-backgrounds", offWas);
      await game.settings.set(NS, "content-source-custom", customWas);
    }

    // 4. The surgical swap. The character starts as a FIELDWARDEN on purpose:
    //    its "Roll a second time on the Bonds table" prose entitles TWO bonds
    //    (the book rule), and Kettlewright entitles one — so this swap is also
    //    the bond clamp's witness (ruled 2026-08-02).
    const before = {
      name: actor.name,
      abilities: JSON.stringify(actor.system.abilities),
      hp: actor.system.hp.max,
      traits: JSON.stringify(actor.system.traits),
      age: actor.system.age,
      bonds: (actor.system.bonds ?? []).length,
      bondIds: (actor.system.bonds ?? []).map((b) => b.id),
      secondBondGold: (actor.system.bonds ?? [])[1]?.gold ?? 0,
      secondBondItemIds: actor.items
        .filter((i) => i.getFlag("air-bladder", "grantSource") === `bond:${(actor.system.bonds ?? [])[1]?.id}`)
        .map((i) => i.id),
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
      keptPortrait: actor.img === before.img,
      // THE CLAMP (2026-08-02). Fieldwarden entitled two bonds; Kettlewright
      // entitles one, so the swap removes the SECOND and keeps the FIRST —
      // the ✕ button's semantics applied automatically. Before the clamp
      // this leg asserted the raw count was preserved, which locked the
      // stale-second-bond bug in as the expectation.
      fieldwardenTwoBonds: before.bonds === 2,
      bondsClamped: (actor.system.bonds ?? []).length === 1,
      firstBondSurvives: (actor.system.bonds ?? [])[0]?.id === before.bondIds[0],
      droppedBondItemsGone: before.secondBondItemIds.every((id) => !actor.items.get(id)),
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
      // coins traded the old questions' gold for the new ones', and the
      // clamped bond's grant refunded out with it
      goldTraded: actor.system.gold ===
        Math.max(0, before.gold - before.qGold - before.secondBondGold
          + (actor.system.questions ?? []).reduce((n, q) => n + (q.gold ?? 0), 0)),
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
      // Every actor the character keeps resolves. There is no stored list to
      // dangle any more, so this now asserts the other end: nothing still
      // points here that Foundry has already deleted.
      danglingFree: containersOf(actor).every((c) => !!game.actors.get(c.id)),
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
    await waitFor(() => document.querySelector(".bg-picker"));
    const root2 = document.querySelector(".bg-picker");
    const bbDialog = {
      rendered: !!root2,
      singleColumn: !!root2?.classList.contains("single"),
      rows: root2?.querySelectorAll('input[name="bg"]').length ?? 0,
      noPanel: !root2?.querySelector(".bg-pick-desc"),
      noHeadings: (root2?.querySelectorAll(".bg-pick-group").length ?? 0) === 0,
      // Barebones is all-or-nothing (2026-08-04): no per-row eye here, ever.
      noEyes: (root2?.querySelectorAll(".bg-pick-eye").length ?? 0) === 0,
      // ... and no authoring pointer either — custom backgrounds are 2e-only.
      noFoot: !root2?.querySelector(".bg-pick-foot"),
    };
    document.querySelector(".bg-picker")?.closest(".application")
      ?.querySelector('button[data-action="cancel"]')?.click();
    await pick2;

    // 8. THE DOUBLE-CLICK on "Add a bond". The handler reads system.bonds,
    //    AWAITS a table draw, then writes the array it read — so two clicks in
    //    one tick both see the old array and the second write overwrites the
    //    first. One bond vanishes from the array while BOTH sets of granted
    //    items were created, and the survivors carry `bond:<id>` for an id
    //    nothing references any more: unreachable by the ✕, and permanent.
    //    Driven through the real control, because the guard lives on the sheet.
    const raceActor = track(await gen.createActorWithCharacter(
      await gen.generate2eCharacter(bgs2e.find((b) => b.name === "Fieldwarden"))));
    for (const c of containersOf(raceActor)) made.push(c);
    // Down to one bond, so the entitlement (Fieldwarden: two) allows exactly
    // one more — that ceiling is what makes a doubled add visible. And
    // generation back ON: creation stamps it OFF, and the Add-a-bond control
    // is built only inside `{{#if generationEnabled}}` (the recorded trap —
    // a regenerate re-stamps Off, so a probe must re-enable it every time).
    const keptBond = (raceActor.system.bonds ?? []).slice(0, 1);
    await raceActor.update({
      "system.bonds": keptBond,
      "system.generationEnabled": true,
    });
    // Trimming the array by hand strands the dropped bond's granted items —
    // the very state this leg then asserts the absence of. Clear it in the
    // PRECONDITION so the assertion is "zero", not "no more than before": a
    // baseline that already contains the defect can only ever measure a delta,
    // and a delta hides the case where the handler orphans exactly as many as
    // it cleans up.
    const stranded = raceActor.items.filter((i) => {
      const src = String(i.getFlag("air-bladder", "grantSource") ?? "");
      return src.startsWith("bond:") && src !== `bond:${keptBond[0]?.id}`;
    }).map((i) => i.id);
    if (stranded.length) await raceActor.deleteEmbeddedDocuments("Item", stranded);
    const sheet = raceActor.sheet;
    await sheet.render(true);
    await wait(900);
    const root3 = sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0];
    root3?.querySelector('[data-tab="notes"]')?.click();
    await wait(300);
    const addBtn = root3?.querySelector('[data-action="addBond"]');
    const bondRace = { control: !!addBtn, before: (raceActor.system.bonds ?? []).length };
    if (addBtn) {
      addBtn.click();
      addBtn.click();   // same tick — no await between them
      // POLL for the second bond, don't time it: each add draws on the Bonds
      // table, and a pack draw is a server round trip whose cost tracks the
      // world, not the code. A fixed 2500ms read the count mid-flight on a
      // cold post-build server and reported 1 of 2 (2026-08-04) — the orphan
      // assertion (the leg's real witness) was green the whole time.
      await waitFor(() => (raceActor.system.bonds ?? []).length >= 2, 15000);
      const bonds = raceActor.system.bonds ?? [];
      bondRace.after = bonds.length;
      const live = new Set(bonds.map((b) => `bond:${b.id}`));
      bondRace.orphanedGrants = raceActor.items
        .filter((i) => String(i.getFlag("air-bladder", "grantSource") ?? "").startsWith("bond:"))
        .filter((i) => !live.has(i.getFlag("air-bladder", "grantSource")))
        .map((i) => i.name);
    }
    await sheet.close();

    for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
    return { grouping, tagline, dialogInfo, disable, swap, containers, randomRepeated: repeated, bbSwap, bbDialog, bondRace };
  });

  if (r.error) {
    fail(r.error);
  } else {
    const G = r.grouping;
    G.grouped2e && G.shipped2e && !G.missingShipped.length
      ? ok(`2e groups by archetype: ${G.archetypes.join(", ")} (${G.shipped2e} shipped`
        + `${G.count2e > G.shipped2e ? ` + ${G.count2e - G.shipped2e} custom` : ""})`)
      : fail(`2e grouping wrong: groups ${JSON.stringify(G.archetypes)}, `
        + `${G.shipped2e} shipped background(s), missing from the grouping: `
        + `${JSON.stringify(G.missingShipped)}`);
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
    D.footLinksGuide
      ? ok("the footer links the custom-backgrounds guide")
      : fail("no footer link to creating-custom-backgrounds.md (stripped by the dialog, or absent)");

    const E = r.disable;
    E.customSection
      ? ok("the shipped custom pack renders as its own 'Custom' section, last")
      : fail("no Custom picker section (or not last / fewer than 7 backgrounds)");
    E.poolExcludes && E.settingHolds
      ? ok("disabling a canon background: pool excludes it, setting records it")
      : fail(`disable wrong: poolExcludes=${E.poolExcludes}, settingHolds=${E.settingHolds}`);
    E.gmStillSees
      ? ok("the Warden's grouped view still shows it (for re-enabling)")
      : fail("a disabled background vanished from the Warden's view — disable would be permanent");
    E.customExcluded
      ? ok("a shipped custom background disables through the same path")
      : fail("custom background did not disable");
    E.eyeMatchesRows && E.rowGreyed && E.radioDead
      ? ok("picker rows: every 2e background has an eye; the disabled row is greyed with a dead radio")
      : fail(`eye rendering wrong: eyes=${E.eyeMatchesRows}, greyed=${E.rowGreyed}, radioDead=${E.radioDead}`);
    E.reEnabledLive
      ? ok("clicking the eye re-enables LIVE: row, radio and setting together")
      : fail("the eye click did not re-enable the background");
    E.lastRefused
      ? ok("the last enabled background cannot be disabled (toast, setting untouched)")
      : fail("the floor failed: the last background was disabled or the setting changed");

    const S = r.swap;
    S.uuidLinked ? ok(`swapped to ${S.background}, linked by uuid`) : fail("swap did not relink the background uuid");
    S.keptName && S.keptAbilities && S.keptHp && S.keptTraits && S.keptAge && S.keptPortrait
      ? ok("KEEPS THE CHARACTER: name, abilities, HP, traits, age and portrait all survive")
      : fail(`swap clobbered the character: ${JSON.stringify(S)}`);
    // The bond clamp (2026-08-02). Its negative control is stashing
    // module/character-generator.js + module/actor/actor-sheet.js: the swap
    // keeps both bonds again and these go red with the stale count.
    S.fieldwardenTwoBonds
      ? ok("Fieldwarden generates two bonds (the book rule)")
      : fail("Fieldwarden did not generate two bonds — the entitlement rule moved?");
    S.bondsClamped && S.firstBondSurvives
      ? ok("the swap CLAMPS bonds to the new entitlement: the first survives, the second is removed")
      : fail(`bond clamp wrong: clamped=${S.bondsClamped}, firstSurvives=${S.firstBondSurvives}`);
    S.droppedBondItemsGone
      ? ok("the dropped bond's granted items went with it")
      : fail("the dropped bond's granted items are still in the inventory");
    S.keptBought ? ok("an item the player bought is untouched") : fail("the swap deleted a bought item");
    S.oldGearGone && S.newGearPresent ? ok("the old background's gear is gone and the new one's is present") : fail(`gear swap wrong (oldGone=${S.oldGearGone}, newPresent=${S.newGearPresent})`);
    S.duplicates.length === 0 ? ok("no item was duplicated by the swap (untagged Rations/Torch included)") : fail(`the swap duplicated: ${S.duplicates.join(", ")}`);
    S.newGearEquipped ? ok("new weapons/armor arrive equipped") : fail("new weapon/armor was not equipped");
    S.questions === 2 && S.goldTraded ? ok(`questions re-rolled (${S.questions}) and coins traded, dropped bond's grant refunded`) : fail(`questions=${S.questions}, goldTraded=${S.goldTraded}`);

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
    B.noEyes ? ok("Barebones rows carry no eye toggle (all-or-nothing by ruling)") : fail("a Barebones row has an eye toggle");
    B.noFoot ? ok("Barebones picker has no authoring footer (2e-only)") : fail("the Barebones picker grew the 2e authoring footer");
    B.rendered && B.singleColumn && B.noPanel && B.noHeadings
      ? ok(`Barebones picker renders single-column, no panel, no headings (${B.rows} rows)`)
      : fail(`Barebones picker layout wrong: ${JSON.stringify(B)}`);

    const R = r.bondRace ?? {};
    R.control && R.before === 1
      ? ok("Add-a-bond control present with one bond and room for one more")
      : fail(`the double-click leg is vacuous: ${JSON.stringify(R)}`);
    // The COUNT is the ceiling, not the race: pre-fix BOTH handlers ran and
    // both wrote a 2-entry array, so this reads 2 either way. It is here to
    // catch a guard that swallows the click entirely (1) or an entitlement
    // that stopped being enforced (3+).
    R.after === 2
      ? ok("the entitlement ceiling holds: two bonds, not one and not three")
      : fail(`two clicks left ${R.after} bond(s) — want 2`);
    // THIS is the race. The losing handler's draw created its items and then
    // had its array overwritten, so the tag points at an id nothing holds.
    (R.orphanedGrants ?? []).length === 0
      ? ok("and no granted item is left tagged to a bond that no longer exists")
      : fail(`orphaned bond grants, unreachable by the ✕: ${JSON.stringify(R.orphanedGrants)}`);
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

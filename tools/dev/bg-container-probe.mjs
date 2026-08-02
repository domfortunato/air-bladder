#!/usr/bin/env node
/**
 * Background-granted containers: four 2e backgrounds hand out a beast or a
 * vehicle — from a choice table (Kettlewright's donkey, Bonekeeper's burial
 * wagon, every one of Outrider's six horse breeds) or outright in their starting
 * gear (the Mountebank's cart). A container is an Actor, so it cannot ride in
 * items[] — it is minted once the character exists. This probe proves the whole
 * path.
 *
 *   node tools/dev/bg-container-probe.mjs   (needs Foundry running, world launched)
 *
 * Steps, driven headless as GM:
 *   1. Every container name the background pack grants has an editable npc
 *      Actor in the `mounts-transports` pack — the pack grantContainers
 *      resolves against — and none of them is stocked by the shop.
 *   2. Generating an Outrider mints a container Actor keeper-linked to the
 *      character, with the capacity the rolled option specified, kind `mount`,
 *      and the buyer's ownership. A mount costs its keeper no slots.
 *   3. Regenerating replaces it — the old one is gone, exactly one remains — and
 *      a container the PLAYER made (no grantSource flag) survives untouched.
 *   4. Re-rolling just that question swaps the beast and leaves the rest alone.
 *   4b. A background can also grant a container OUTRIGHT rather than from a
 *       choice table (the Mountebank's cart). That is a separate code path and
 *       2e generation originally missed it, so it is asserted too.
 *   5. Editing the pack document flows into the next character generated.
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
    const mkt = await import("/systems/air-bladder/module/marketplace.js");
    const made = [];
    const keptBy = (actor) =>
      game.actors.filter((a) =>
        // Granted beasts are npc documents connected by `connectedTo` now, not
        // `container` actors keeper-linked through the owner's array.
        (a.system?.connectedTo === actor.uuid || a.system?.keeper === actor.uuid));

    // 1. Every granted name exists as a document; none is in the shop. The
    //    documents are npc ACTORS in mounts-transports now -- that pack is what
    //    grantContainers resolves against, so this is the pack whose absence
    //    review #5 caught (the old Item pack still ships, but nothing grants
    //    from it).
    const bgPack = game.packs.get("air-bladder.backgrounds-2e");
    const tPack = game.packs.get("air-bladder.mounts-transports");
    if (!bgPack || !tPack) return { error: "backgrounds-2e or mounts-transports pack missing" };
    const bgs = await bgPack.getDocuments();
    const tDocs = await tPack.getDocuments();
    const tByName = new Map(tDocs.map((d) => [d.name.toLowerCase(), d]));

    const granted = new Set();
    for (const bg of bgs)
      for (const table of bg.system.tables ?? [])
        for (const opt of table.options ?? [])
          for (const c of opt.containers ?? []) granted.add(String(c.name).toLowerCase());

    const catalog = await mkt.getMarketplaceCatalog();
    const stocked = new Set(
      (catalog.categories.find((c) => c.name === "Transports & Containers")?.items ?? [])
        .map((i) => i.name.toLowerCase())
    );
    const setup = {
      grantedCount: granted.size,
      allHaveDocs: [...granted].every((n) => tByName.has(n)),
      missing: [...granted].filter((n) => !tByName.has(n)),
      // A rolled beast is not for sale.
      noneStocked: [...granted].every((n) => !stocked.has(n) || n === "cart"),
      shopStill: stocked.size,
    };

    // 2. Generate an Outrider — its second question is six horse breeds, so the
    //    grant is guaranteed whichever option comes up.
    const outrider = bgs.find((b) => b.name === "Outrider");
    if (!outrider) return { error: "Outrider background missing" };
    const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter(outrider));
    if (!actor) return { error: "generation returned no actor" };
    made.push(actor);
    // Generated actors land with Randomization OFF (2026-08-02); the
    // rerollQuestion die this probe clicks is what the flag hides.
    await actor.update({ "system.generationEnabled": true });

    const kept = keptBy(actor);
    const horse = kept[0];
    const spec = (outrider.system.tables ?? [])
      .flatMap((t) => t.options ?? [])
      .flatMap((o) => o.containers ?? [])
      .find((c) => c.name === horse?.name);
    const grant = {
      count: kept.length,
      name: horse?.name,
      // `transportKind` is retired; what a thing IS is its containerClass.
      kind: horse?.system.containerClass,
      capacity: horse?.system.slotsMax,
      wanted: spec?.slots,
      capacityRight: horse?.system.slotsMax === spec?.slots,
      keeperLinked: horse?.system.connectedTo === actor.uuid,
      // Derived, not the legacy array -- generation writes one link now.
      // `connectedActors()`, not the PREPARED copy: nothing re-prepares this
      // actor when a different one is connected to it, so the prepared list is
      // stale until something else touches the owner. The sheet rebuilds it at
      // render for the same reason.
      listed: actor.connectedActors().some((c) => c.id === horse?.id),
      flagged: horse?.getFlag("air-bladder", "grantSource")?.startsWith("question:"),
      // A mount travels alongside: it must cost the rider nothing. Compare the
      // rider's usage against the same actor with the container detached, so this
      // measures the container's contribution rather than restating the total.
      slotsUsed: actor.system.slotsUsed,
      // The link lives on the CHILD, so "the same actor with the container
      // detached" is measured by clearing the child's `connectedTo` in memory,
      // not by emptying an owner-side list (which no longer exists).
      slotsWithout: (() => {
        if (!horse) return null;
        const kept = horse.system.connectedTo;
        horse.system.connectedTo = "";
        const bare = actor.calcSlotsUsed ? actor.calcSlotsUsed() : null;
        horse.system.connectedTo = kept;
        return bare;
      })(),
      // ...and it must not appear as a worn row, which is what charges the carrier.
      wornRows: (actor.system.wornContainerRows ?? []).length,
      // The CONNECTED shape (2026-08-01), not a wholesale copy: default
      // OBSERVER, plus OWNER for exactly the character's own players (this
      // GM-generated character has none, so no non-GM entries at all).
      ownershipShape: horse?.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
        && Object.entries(horse?.ownership ?? {}).every(([id, lvl]) =>
          id === "default" || game.users.get(id)?.isGM
          || ((actor.ownership[id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
            && lvl === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)),
    };

    // 3. A container the PLAYER made must survive a regenerate. An npc with
    //    role container — the `container` type is retired — connected in its
    //    CREATE data, which is the shape every automatic flow uses.
    const mine = await CONFIG.Actor.documentClass.create({
      type: "npc", name: "PROBE Player Chest",
      system: { slots: 3, role: "container", containerClass: "chest", connectedTo: actor.uuid },
    });
    made.push(mine);

    const beforeUuid = horse?.uuid;
    await gen.regenerateActor(actor);
    const after = keptBy(actor);
    made.push(...after);
    const regen = {
      // exactly one granted beast + the player's chest
      grantedNow: after.filter((a) => a.getFlag("air-bladder", "grantSource")).length,
      oldGone: !game.actors.get(beforeUuid?.split(".").pop()),
      mineSurvives: !!game.actors.get(mine.id),
      mineStillListed: actor.connectedActors().some((c) => c.id === mine.id),
      // Nothing can dangle now — the list IS the set of live actors pointing
      // here — so the assertion that has teeth is that the chest's own link
      // still resolves to this character after the granted beast was deleted.
      noDangling: game.actors.get(mine.id)?.system.connectedTo === actor.uuid,
    };

    // 4. Re-roll ONLY the horse question; the chest must not move.
    // regenerateActor above re-stamped generationEnabled: false (generation
    // always leaves the switch Off since 2026-08-02), so switch it back on —
    // the rerollQuestion die below is what the flag hides.
    await actor.update({ "system.generationEnabled": true });
    const qIdx = (outrider.system.tables ?? []).findIndex((t) =>
      (t.options ?? []).some((o) => (o.containers ?? []).length));
    // ApplicationV2 keeps its handlers in private static methods reachable only
    // through the `actions` map, so drive it the way a user does — click the
    // element carrying the data-action. (This used to call
    // `sheet._onRerollQuestion` direct, which stopped existing at the AppV2 port
    // and threw.) Clicking also exercises the data-index wiring, which a direct
    // call faked.
    const sheet = actor.sheet;
    await sheet.render(true);
    for (let i = 0; i < 30 && !(sheet.element instanceof HTMLElement); i++) {
      await new Promise((res) => setTimeout(res, 100));
    }
    await new Promise((res) => setTimeout(res, 300));
    const rerollBtn = sheet.element?.querySelector?.(
      `[data-action="rerollQuestion"][data-index="${qIdx}"]`);
    if (!rerollBtn) return { error: `no [data-action=rerollQuestion][data-index=${qIdx}] control on the sheet` };
    rerollBtn.click();
    // The handler is async behind a _rerolling guard; wait for it to settle.
    for (let i = 0; i < 60 && sheet._rerolling; i++) await new Promise((res) => setTimeout(res, 100));
    await new Promise((res) => setTimeout(res, 400));
    const afterReroll = keptBy(actor);
    made.push(...afterReroll);
    const reroll = {
      questionIndex: qIdx,
      grantedNow: afterReroll.filter((a) => a.getFlag("air-bladder", "grantSource")).length,
      name: afterReroll.find((a) => a.getFlag("air-bladder", "grantSource"))?.name,
      mineSurvives: !!game.actors.get(mine.id),
      noDangling: game.actors.get(mine.id)?.system.connectedTo === actor.uuid,
    };

    // 4b. A background can also grant a container OUTRIGHT, not from a choice
    //     table — the Mountebank's cart is part of the act. That path is separate
    //     from the choice-table one and was missed when 2e generation was first
    //     written, so it is asserted here.
    const mountebank = bgs.find((b) => b.name === "Mountebank");
    const mActor = await gen.createActorWithCharacter(await gen.generate2eCharacter(mountebank));
    made.push(mActor, ...keptBy(mActor));
    const rootSpec = (mountebank?.system.containers ?? [])[0];
    const cart = keptBy(mActor).find((c) => c.name === rootSpec?.name);
    const startingContainer = {
      declared: rootSpec?.name,
      minted: !!cart,
      capacity: cart?.system.slotsMax,
      capacityRight: cart?.system.slotsMax === rootSpec?.slots,
      flagged: cart?.getFlag("air-bladder", "grantSource") === "background",
      // ...and it is a container, not an item on the sheet
      notAnItem: !mActor.items.some((i) => i.name === rootSpec?.name),
    };

    // 5. Edit a pack document -> the next beast granted from it reflects the edit.
    //    Driven through grantContainers with a fixed spec rather than by rolling
    //    until Rivertooth comes up: it is the same resolution path, but exact and
    //    fast instead of ~60 whole characters of luck.
    //    Capacity comes from the BACKGROUND (the grant wins over the document), so
    //    the edit is proved through a field the document owns outright.
    const doc = tByName.get("rivertooth");
    const wasLocked = tPack.locked;
    if (wasLocked) await tPack.configure({ locked: false });
    const origDesc = doc.system.description;
    const marker = "PROBE-BEAST-MARKER-3";
    await doc.update({ "system.description": marker });

    const [minted] = await gen.grantContainers(actor, [
      { name: "Rivertooth", slots: 6, grantSource: "question:9" },
    ]);
    if (minted) made.push(minted);
    const edit = {
      flowed: minted?.system.description === marker,
      // and the grant's own capacity still wins over the document's
      capacityFromGrant: minted?.system.slotsMax === 6,
      // an unknown beast has no document at all and is minted from the spec alone
      got: minted?.system.description,
      // THE stat-block assertion, as a LITERAL: Rivertooth's document states
      // 4 HP and the schema default is 6, so this is the line that goes red
      // when grants resolve against a pack whose documents carry no hp — the
      // shipped review-#5 defect (resolving against the legacy Item pack).
      // Asserting "minted hp equals the doc's hp" instead would pass whenever
      // BOTH reads miss, which is the assertion sharing the bug's assumption.
      hpFromDoc: minted?.system.hp.value === 4 && minted?.system.hp.max === 4,
    };
    const [bespoke] = await gen.grantContainers(actor, [
      { name: "PROBE Unknown Beast", slots: 5, grantSource: "question:9" },
    ]);
    if (bespoke) made.push(bespoke);
    edit.fallbackMinted = bespoke?.system.slotsMax === 5 && bespoke?.type === "npc";

    // NEGATIVE CONTROL, in-page: starve grantContainers of the Actor pack (an
    // instance property shadowing CompendiumCollection#getDocuments — the
    // prototype is untouched and `delete` removes the shadow) and the same
    // grant must come back out with the phantom 6/6 and no marker, i.e. the
    // shipped defect reproduced. If it doesn't, hpFromDoc above is not
    // load-bearing.
    tPack.getDocuments = async () => [];
    const [starved] = await gen.grantContainers(actor, [
      { name: "Rivertooth", slots: 6, grantSource: "question:9" },
    ]);
    delete tPack.getDocuments;
    if (starved) made.push(starved);
    const control = {
      reproduced: starved?.system.hp.max === 6 && starved?.system.description !== marker,
      hp: starved?.system.hp.max,
    };

    await doc.update({ "system.description": origDesc });
    if (wasLocked) await tPack.configure({ locked: true });

    // 6. The connection ceiling in grantContainers itself (2026-08-01). With
    //    partial headroom the grant CLAMPS — the first specs land, the rest are
    //    dropped with a warning — and at zero headroom it refuses outright.
    //    This is the player-facing copy of the broker's wall: it cannot bind a
    //    crafted client (dev:socket-grant proves the wall), but it is what
    //    tells an honest player why their mule did not arrive.
    const { maxConnections } = await import("/systems/air-bladder/module/connections.js");
    const max = maxConnections();
    const cappedPc = await CONFIG.Actor.documentClass.create({ name: "PROBE Cap Keeper", type: "character" });
    made.push(cappedPc);
    for (let i = 0; i < max - 1; i++) {
      made.push(await CONFIG.Actor.documentClass.create({
        name: `PROBE Cap Filler ${i}`, type: "npc",
        system: { role: "container", containerClass: "sack", connectedTo: cappedPc.uuid, hp: { value: 0, max: 0 }, generationEnabled: false },
      }));
    }
    const clamped = await gen.grantContainers(cappedPc, [
      { name: "PROBE Clamp A", slots: 2, grantSource: "question:1" },
      { name: "PROBE Clamp B", slots: 2, grantSource: "question:1" },
    ]);
    made.push(...clamped);
    const capGrant = {
      headroomWas: 1,
      clampedCount: clamped.length,
      survivor: clamped[0]?.name,
      atMax: cappedPc.connectedActors().length === max,
    };
    const refused = await gen.grantContainers(cappedPc, [
      { name: "PROBE Clamp C", slots: 2, grantSource: "question:1" },
    ]);
    made.push(...refused);
    capGrant.refusedCount = refused.length;
    capGrant.noC = !game.actors.getName("PROBE Clamp C");

    for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
    return { setup, grant, regen, reroll, startingContainer, edit, control, capGrant };
  });

  if (r.error) {
    fail(r.error);
  } else {
    r.setup.allHaveDocs
      ? ok(`all ${r.setup.grantedCount} background-granted containers have editable documents`)
      : fail(`no transport document for: ${r.setup.missing.join(", ")}`);
    r.setup.noneStocked ? ok(`rolled beasts are not for sale (shop still stocks ${r.setup.shopStill})`) : fail("a background beast is stocked in the shop");

    r.grant.count === 1 ? ok(`generating an Outrider minted exactly 1 container ("${r.grant.name}")`) : fail(`expected 1 container, got ${r.grant.count}`);
    r.grant.capacityRight ? ok(`capacity +${r.grant.capacity} matches the rolled option`) : fail(`capacity ${r.grant.capacity} != option's ${r.grant.wanted}`);
    r.grant.kind === "horse" ? ok("classified as a horse") : fail(`class is ${r.grant.kind}, expected horse`);
    r.grant.keeperLinked && r.grant.listed ? ok("connected, and derived onto the owner's tab") : fail("connectedTo missing, or the owner's list did not derive it");
    r.grant.flagged ? ok("flagged with the question that granted it") : fail("missing the grantSource flag");
    r.grant.ownershipShape ? ok("wears the connected shape (default OBSERVER + the character's players)") : fail("granted beast's ownership is not the connected shape");
    r.grant.wornRows === 0 && r.grant.slotsUsed === r.grant.slotsWithout
      ? ok(`a mount costs its rider no slots (${r.grant.slotsUsed} with it, ${r.grant.slotsWithout} without; 0 worn rows)`)
      : fail(`the mount charged the rider: ${r.grant.slotsWithout} -> ${r.grant.slotsUsed}, ${r.grant.wornRows} worn rows`);

    r.regen.grantedNow === 1 ? ok("regenerate leaves exactly one granted beast") : fail(`after regenerate: ${r.regen.grantedNow} granted containers`);
    r.regen.oldGone ? ok("the previous beast was deleted") : fail("the previous beast is still around");
    r.regen.mineSurvives && r.regen.mineStillListed ? ok("a container the PLAYER made survives a regenerate") : fail("regenerate destroyed a player-made container");
    r.regen.noDangling ? ok("no dangling container uuids after the delete") : fail("the keeper's container list has a dangling uuid");

    r.reroll.grantedNow === 1 ? ok(`re-rolling question ${r.reroll.questionIndex} swapped the beast ("${r.reroll.name}")`) : fail(`after re-roll: ${r.reroll.grantedNow} granted containers`);
    r.reroll.mineSurvives && r.reroll.noDangling ? ok("the player's container and the uuid list are intact after a re-roll") : fail("re-roll damaged the player's container / the uuid list");

    r.startingContainer.minted && r.startingContainer.capacityRight && r.startingContainer.flagged && r.startingContainer.notAnItem
      ? ok(`a background's OUTRIGHT container is granted too (Mountebank's ${r.startingContainer.declared}, +${r.startingContainer.capacity})`)
      : fail(`starting-gear container wrong: ${JSON.stringify(r.startingContainer)}`);

    r.edit.flowed ? ok("EDIT FLOWS THROUGH: a pack edit reaches the next beast granted") : fail(`the pack edit did NOT reach the granted beast (got "${r.edit.got}")`);
    r.edit.capacityFromGrant ? ok("the background's own capacity still wins over the document's") : fail("the grant's slots did not win");
    r.edit.hpFromDoc ? ok("STAT BLOCK FLOWS: a granted Rivertooth carries its document's 4 HP, not the schema's 6") : fail("the granted beast did not carry the document's hp (phantom default instead)");
    r.edit.fallbackMinted ? ok("a beast with no document is minted from the grant alone") : fail("the no-document fallback did not mint correctly");
    r.control.reproduced ? ok(`NEGATIVE CONTROL: starved of the Actor pack, the grant reverts to the phantom ${r.control.hp} HP`) : fail(`negative control did not reproduce the defect (hp ${r.control.hp})`);

    r.capGrant.clampedCount === 1 && r.capGrant.survivor === "PROBE Clamp A" && r.capGrant.atMax
      ? ok("a grant past the ceiling is CLAMPED: the first spec lands, the rest are dropped")
      : fail(`clamp wrong: ${JSON.stringify(r.capGrant)}`);
    r.capGrant.refusedCount === 0 && r.capGrant.noC
      ? ok("at zero headroom the grant refuses outright, mints nothing")
      : fail(`zero-headroom grant leaked: ${JSON.stringify(r.capGrant)}`);
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

console.log(failed ? "\nBACKGROUND-CONTAINER PROBE FAILED\n" : "\nbackground-container probe passed\n");
process.exit(failed ? 1 : 0);

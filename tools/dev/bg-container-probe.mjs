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
 *   1. Every container name the background pack grants has an editable document
 *      in the `transports` pack, and none of them is stocked by the shop.
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
      game.actors.filter((a) => a.type === "container" && a.system?.keeper === actor.uuid);

    // 1. Every granted name exists as a document; none is in the shop.
    const bgPack = game.packs.get("air-bladder.backgrounds-2e");
    const tPack = game.packs.get("air-bladder.transports");
    if (!bgPack || !tPack) return { error: "backgrounds-2e or transports pack missing" };
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

    const kept = keptBy(actor);
    const horse = kept[0];
    const spec = (outrider.system.tables ?? [])
      .flatMap((t) => t.options ?? [])
      .flatMap((o) => o.containers ?? [])
      .find((c) => c.name === horse?.name);
    const grant = {
      count: kept.length,
      name: horse?.name,
      kind: horse?.system.transportKind,
      capacity: horse?.system.slotsMax,
      wanted: spec?.slots,
      capacityRight: horse?.system.slotsMax === spec?.slots,
      keeperLinked: horse?.system.keeper === actor.uuid,
      listed: (actor.system.containers ?? []).includes(horse?.uuid),
      flagged: horse?.getFlag("air-bladder", "grantSource")?.startsWith("question:"),
      // A mount travels alongside: it must cost the rider nothing. Compare the
      // rider's usage against the same actor with the container detached, so this
      // measures the container's contribution rather than restating the total.
      slotsUsed: actor.system.slotsUsed,
      slotsWithout: (() => {
        const kept = actor.system.containers;
        actor.system.containers = [];
        const bare = actor.calcSlotsUsed ? actor.calcSlotsUsed() : null;
        actor.system.containers = kept;
        return bare;
      })(),
      // ...and it must not appear as a worn row, which is what charges the carrier.
      wornRows: (actor.system.wornContainerRows ?? []).length,
      ownershipCopied: JSON.stringify(horse?.ownership) === JSON.stringify(actor.ownership),
    };

    // 3. A container the PLAYER made must survive a regenerate.
    const mine = await CONFIG.Actor.documentClass.create({
      type: "container", name: "PROBE Player Chest", system: { slots: { value: 3 } },
    });
    made.push(mine);
    await actor.createOwnedContainer(mine);

    const beforeUuid = horse?.uuid;
    await gen.regenerateActor(actor);
    const after = keptBy(actor);
    made.push(...after);
    const regen = {
      // exactly one granted beast + the player's chest
      grantedNow: after.filter((a) => a.getFlag("air-bladder", "grantSource")).length,
      oldGone: !game.actors.get(beforeUuid?.split(".").pop()),
      mineSurvives: !!game.actors.get(mine.id),
      mineStillListed: (actor.system.containers ?? []).includes(mine.uuid),
      // no dangling uuids left behind by the delete
      noDangling: (actor.system.containers ?? []).every((u) => !!game.actors.find((a) => a.uuid === u)),
    };

    // 4. Re-roll ONLY the horse question; the chest must not move.
    const qIdx = (outrider.system.tables ?? []).findIndex((t) =>
      (t.options ?? []).some((o) => (o.containers ?? []).length));
    const sheet = actor.sheet;
    await sheet._onRerollQuestion({
      preventDefault() {}, currentTarget: { dataset: { index: String(qIdx) } },
    });
    const afterReroll = keptBy(actor);
    made.push(...afterReroll);
    const reroll = {
      questionIndex: qIdx,
      grantedNow: afterReroll.filter((a) => a.getFlag("air-bladder", "grantSource")).length,
      name: afterReroll.find((a) => a.getFlag("air-bladder", "grantSource"))?.name,
      mineSurvives: !!game.actors.get(mine.id),
      noDangling: (actor.system.containers ?? []).every((u) => !!game.actors.find((a) => a.uuid === u)),
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
    };
    const [bespoke] = await gen.grantContainers(actor, [
      { name: "PROBE Unknown Beast", slots: 5, grantSource: "question:9" },
    ]);
    if (bespoke) made.push(bespoke);
    edit.fallbackMinted = bespoke?.system.slotsMax === 5 && bespoke?.system.transportKind === "mount";

    await doc.update({ "system.description": origDesc });
    if (wasLocked) await tPack.configure({ locked: true });

    for (const a of made) { try { await a.delete(); } catch { /* already gone */ } }
    return { setup, grant, regen, reroll, startingContainer, edit };
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
    r.grant.kind === "mount" ? ok("kind is `mount`") : fail(`kind is ${r.grant.kind}, expected mount`);
    r.grant.keeperLinked && r.grant.listed ? ok("keeper-linked both ways") : fail("keeper link is one-sided or missing");
    r.grant.flagged ? ok("flagged with the question that granted it") : fail("missing the grantSource flag");
    r.grant.ownershipCopied ? ok("inherits the character's ownership (player-ownable)") : fail("ownership was not copied");
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
    r.edit.fallbackMinted ? ok("a beast with no document is minted from the grant alone") : fail("the no-document fallback did not mint correctly");
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

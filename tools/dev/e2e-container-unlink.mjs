#!/usr/bin/env node
/**
 * Trash vs unlink on the Connected tab — two intentions, two icons, and only one
 * of them destroys anything.
 *
 * The tab used to carry a single trash icon, and it DID NOT DELETE. It asked
 * "Delete X?" and then filtered the owner's array and cleared `keeper`, leaving
 * the actor alive and belonging to nobody. That read as a harmless mislabel while
 * a container was a bag of slots. Under the container rule — an actor connected
 * to nobody IS a loot pile — it silently drops a pile in the middle of the world
 * every time a Warden tries to destroy a crate.
 *
 * So:
 *   - trash DELETES the actor, for real,
 *   - unlink clears `connectedTo` and leaves it in the world,
 *   - unlink snapshots the previous owner's NAME as a string, because the usual
 *     reason a pile exists is that its owner died and was deleted, which is
 *     exactly when a uuid resolves to nothing.
 *
 * Both paths open a modal. `DialogV2.confirm` is stubbed rather than answered by
 * polling the DOM: a settled DialogV2 outlives its promise in the DOM (close
 * awaits a CSS transition), so a poll finds the dead dialog, clicks it for
 * nothing, and the NEXT confirm hangs forever with the whole harness timeout to
 * burn. Stubbing is what dev:bg-drop-order does, for the same reason.
 *
 * NEGATIVE CONTROL, in-page: `deleteOwnedContainer` is swapped on the prototype
 * for the OLD implementation (prune the array, clear the keeper, delete nothing).
 * The actor must then survive its own deletion — reproducing the shipped bug —
 * or the delete assertion below is not load-bearing.
 *
 * Usage: npm run dev:container-unlink
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m, d = "") => console.log(`  ok    ${m.padEnd(46)} ${d}`);
const bad = (m, d = "") => { console.error(`  FAIL  ${m.padEnd(46)} ${d}`); failed = true; };

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
watchdog(180000, "dev:container-unlink");
await joinAsGM(page);
await dismissChrome(page);

try {
  const out = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const DialogV2 = foundry.applications.api.DialogV2;
    const orig = DialogV2.confirm;
    let asked = 0;
    DialogV2.confirm = async () => { asked += 1; return true; };
    // The Connections UI is parked (2026-08-09). Every DOM witness here — the
    // "Formerly connected to" header line, the Connected-tab rows the rerender
    // legs poll — renders only with the UI restored, so the whole evaluate
    // runs under the in-page settings shadow (never a world write). The
    // document methods this probe is ABOUT are unaffected by the parking;
    // the parked default itself is dev:connections' leg.
    const origGet = game.settings.get;
    game.settings.get = function (ns, key) {
      if (key === "connections-ui-enabled") return true;
      return origGet.call(this, ns, key);
    };

    const mk = async () => {
      const owner = await Cls.create({ name: "ZZ Unlink Owner", type: "character" });
      const cart = await Cls.create({
        name: "ZZ Unlink Cart", type: "npc",
        system: { connectedTo: owner.uuid, slots: 4, role: "transport" },
      });
      owner.prepareData();
      return { owner, cart };
    };

    // The "Formerly connected to…" label lives on the RENDERED header line now
    // (2026-08-02): the derived `system.ownedBy` string died with the child-end
    // Connections tab, and the sheet builds the line per render — so the
    // witness is the DOM, which is also what a Warden actually reads.
    const headerLabel = async (actor) => {
      if (!actor) return null;
      const sheet = actor.sheet;
      await sheet.render(true);
      const t0 = Date.now();
      while (Date.now() - t0 < 6000 && !(sheet.element instanceof HTMLElement)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 300));
      const label = sheet.element?.querySelector(".connection-line .connection-label")?.textContent?.trim() ?? null;
      await sheet.close();
      return label;
    };

    /* ---- unlink: survives, disconnected, remembers whose it was ---- */
    const a = await mk();
    const listedBefore = a.owner.system.containerObjects.length;
    await a.owner.unlinkOwnedContainer(a.cart.uuid);
    a.owner.prepareData();
    const survivor = game.actors.get(a.cart.id);
    survivor?.prepareData();
    const unlink = {
      askedOnce: asked === 1,
      stillExists: !!survivor,
      listedBefore,
      listedAfter: a.owner.system.containerObjects.length,
      connectedTo: survivor?.system.connectedTo,
      formerly: survivor?.system.formerlyBelongedTo,
      label: await headerLabel(survivor),
      // The whole point: its cargo is untouched.
      keptName: survivor?.name,
    };

    /* ---- and the owner can be deleted without taking the pile ---- */
    await a.owner.delete();
    const afterOwnerGone = game.actors.get(a.cart.id);
    afterOwnerGone?.prepareData();
    const orphan = {
      stillExists: !!afterOwnerGone,
      label: await headerLabel(afterOwnerGone),
    };
    await afterOwnerGone?.delete();

    /* ---- trash: actually deletes ---- */
    const b = await mk();
    const cartId = b.cart.id;
    await b.owner.deleteOwnedContainer(b.cart.uuid);
    const del = { gone: !game.actors.get(cartId) };
    await b.owner.delete();

    /* ---- negative control: the OLD deleteOwnedContainer ---- */
    const proto = Cls.prototype;
    const realDelete = proto.deleteOwnedContainer;
    proto.deleteOwnedContainer = async function old(itemId) {
      const container = this.getOwnedContainer(itemId);
      if (!container) return;
      const actor = game.actors.find((x) => x.uuid == itemId);
      await actor?.update({ "system.connectedTo": "" });   // ...and never deletes
    };
    const c = await mk();
    const ctrlId = c.cart.id;
    await c.owner.deleteOwnedContainer(c.cart.uuid);
    const control = { survived: !!game.actors.get(ctrlId) };
    proto.deleteOwnedContainer = realDelete;
    await game.actors.get(ctrlId)?.delete();
    await c.owner.delete();

    /* ---- deleting a CONNECTED owner unlinks + stamps the survivors ---- */
    // The case the field exists for, and the one the first version of this
    // probe never covered (review #5): no deliberate unlink first — the owner
    // dies while the link is live, and the mule must come out the other side a
    // labelled loot pile, not a dangler. _onDeleteOperation's writes are
    // awaited by the delete workflow, so they have landed when delete()
    // resolves.
    const d0 = await mk();
    const heirId = d0.cart.id;
    await d0.owner.delete();
    const heir = game.actors.get(heirId);
    heir?.prepareData();
    const ownerDeath = {
      stillExists: !!heir,
      connectedTo: heir?.system.connectedTo,
      formerly: heir?.system.formerlyBelongedTo,
      label: await headerLabel(heir),
    };
    await heir?.delete();

    // NEGATIVE CONTROL: shadow the class's own _onDeleteOperation with a no-op
    // and the same death must leave the mule dangling — the shipped behaviour
    // reproduced — or the stamping assertion above is not load-bearing.
    const origOp = Cls._onDeleteOperation;
    Cls._onDeleteOperation = async () => {};
    const d1 = await mk();
    const dangId = d1.cart.id;
    const dangOwnerUuid = d1.owner.uuid;
    await d1.owner.delete();
    const dangler = game.actors.get(dangId);
    const deathControl = {
      reproduced: dangler?.system.connectedTo === dangOwnerUuid && !dangler?.system.formerlyBelongedTo,
      got: dangler?.system.connectedTo,
    };
    Cls._onDeleteOperation = origOp;
    await dangler?.delete();

    /* ---- the owner's OPEN sheet follows link changes ---- */
    // The list is DERIVED, so a link change writes nothing to the owner: only
    // _synchronizeOwnerSheets makes the open tab true. Review #5: a bought
    // mount never appeared; a deleted one left a phantom row.
    const until = async (fn, ms = 6000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); }
      return fn();
    };
    const watcher = await Cls.create({ name: "ZZ Unlink Watch", type: "character" });
    const wSheet = watcher.sheet;
    await wSheet.render(true);
    await until(() => wSheet.element instanceof HTMLElement);
    const mule = await Cls.create({
      name: "ZZ Unlink Watch Mule", type: "npc", system: { connectedTo: watcher.uuid, slots: 6 },
    });
    const rowSel = () => wSheet.element?.querySelector(`[data-item-id="${mule.uuid}"]`);
    const rerender = { appeared: await until(() => !!rowSel()) };
    await mule.delete();
    rerender.vanished = await until(() => !rowSel());

    // NEGATIVE CONTROL: no-op the sync on the prototype and a new connected
    // mule must NOT appear on the still-open sheet — the pre-fix staleness.
    const realSync = proto._synchronizeOwnerSheets;
    proto._synchronizeOwnerSheets = function () {};
    const mule2 = await Cls.create({
      name: "ZZ Unlink Watch Mule2", type: "npc", system: { connectedTo: watcher.uuid, slots: 6 },
    });
    await new Promise((r) => setTimeout(r, 900));
    rerender.controlStale = !wSheet.element?.querySelector(`[data-item-id="${mule2.uuid}"]`);
    proto._synchronizeOwnerSheets = realSync;
    await mule2.delete();
    await watcher.delete();

    DialogV2.confirm = orig;
    game.settings.get = origGet;
    return { unlink, orphan, del, control, ownerDeath, deathControl, rerender };
  });

  const { unlink, orphan, del, control, ownerDeath, deathControl, rerender } = out;

  console.log("\nunlink: it survives, connected to nobody");
  unlink.askedOnce
    ? ok("it asks before disconnecting", "one confirm")
    : bad("it asks before disconnecting", "no confirmation was raised");
  unlink.stillExists
    ? ok("the actor still exists", `"${unlink.keptName}"`)
    : bad("the actor still exists", "unlink destroyed it");
  unlink.connectedTo === ""
    ? ok("connectedTo is cleared")
    : bad("connectedTo is cleared", JSON.stringify(unlink.connectedTo));
  unlink.listedBefore === 1 && unlink.listedAfter === 0
    ? ok("it leaves the owner's Connected tab", `${unlink.listedBefore} -> ${unlink.listedAfter}`)
    : bad("it leaves the owner's Connected tab", `${unlink.listedBefore} -> ${unlink.listedAfter}`);

  console.log("\nand it remembers whose it was");
  unlink.formerly === "ZZ Unlink Owner"
    ? ok("the previous owner's name is snapshotted", `"${unlink.formerly}"`)
    : bad("the previous owner's name is snapshotted", JSON.stringify(unlink.formerly));
  /^Formerly connected to /.test(unlink.label ?? "")
    ? ok("the sheet line reads as a former owner", `"${unlink.label}"`)
    : bad("the sheet line reads as a former owner", JSON.stringify(unlink.label));
  // Checked against the LITERAL, not against `unlink.label` -- comparing the two
  // observations to each other passes when both are empty, which is exactly the
  // failure being guarded against (a uuid that no longer resolves yields nothing
  // at both ends and the assertion agrees with itself).
  orphan.stillExists && /^Formerly connected to ZZ Unlink Owner$/.test(orphan.label ?? "")
    ? ok("and it SURVIVES the owner being deleted", `"${orphan.label}"`)
    : bad("and it SURVIVES the owner being deleted", JSON.stringify(orphan));

  console.log("\ntrash: it really deletes");
  del.gone
    ? ok("the actor is gone", "not merely disconnected")
    : bad("the actor is gone", "it survived — the trash still only unlinks");

  console.log("\n   negative control: the old deleteOwnedContainer");
  control.survived
    ? ok("reproduced — the old one leaves it alive", "so the delete assertion can fail")
    : bad("reproduced — the old one leaves it alive",
      "the control deleted it too, so nothing above is load-bearing");

  console.log("\ndeleting a CONNECTED owner");
  ownerDeath.stillExists && ownerDeath.connectedTo === ""
    ? ok("the mule survives, unlinked", `connectedTo=${JSON.stringify(ownerDeath.connectedTo)}`)
    : bad("the mule survives, unlinked", JSON.stringify(ownerDeath));
  // The LITERAL, as everywhere in this file: comparing to the (deleted) owner's
  // name read back would agree with itself when both are empty.
  ownerDeath.formerly === "ZZ Unlink Owner" && /^Formerly connected to ZZ Unlink Owner$/.test(ownerDeath.label ?? "")
    ? ok("stamped with the dead owner's name", `"${ownerDeath.label}"`)
    : bad("stamped with the dead owner's name", JSON.stringify(ownerDeath));
  deathControl.reproduced
    ? ok("negative control: a no-op operation leaves it dangling", "so the stamp assertion can fail")
    : bad("negative control: a no-op operation leaves it dangling", JSON.stringify(deathControl));

  console.log("\nthe owner's open sheet follows link changes");
  rerender.appeared
    ? ok("a new connected mule appears on the open tab")
    : bad("a new connected mule appears on the open tab", "no row rendered — the sheet is stale");
  rerender.vanished
    ? ok("a deleted one leaves it")
    : bad("a deleted one leaves it", "phantom row after delete");
  rerender.controlStale
    ? ok("negative control: with the sync no-opped, the row never comes", "the pre-fix staleness reproduced")
    : bad("negative control: with the sync no-opped, the row never comes",
      "row appeared anyway — something else renders, the assertion is not load-bearing");
} catch (e) {
  bad("threw", `${e.name}: ${e.message}`);
} finally {
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
  if (errors.length) failed = true;
  await browser.close();
}

console.log(failed ? "\nCONTAINER UNLINK PROBE FAILED" : "\ncontainer unlink probe passed");
process.exit(failed ? 1 : 0);

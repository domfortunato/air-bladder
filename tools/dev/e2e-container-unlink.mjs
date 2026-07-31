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

    const mk = async () => {
      const owner = await Cls.create({ name: "ZZ Unlink Owner", type: "character" });
      const cart = await Cls.create({
        name: "ZZ Unlink Cart", type: "npc",
        system: { connectedTo: owner.uuid, slots: 4, inanimate: true },
      });
      owner.prepareData();
      return { owner, cart };
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
      label: survivor?.system.ownedBy,
      // The whole point: its cargo is untouched.
      keptName: survivor?.name,
    };

    /* ---- and the owner can be deleted without taking the pile ---- */
    await a.owner.delete();
    const afterOwnerGone = game.actors.get(a.cart.id);
    afterOwnerGone?.prepareData();
    const orphan = {
      stillExists: !!afterOwnerGone,
      label: afterOwnerGone?.system.ownedBy,
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
      const containers = (this.system.containers ?? []).filter((c) => c !== itemId);
      const actor = game.actors.find((x) => x.uuid == itemId);
      await this.update({ "system.containers": containers });
      await actor?.update({ "system.keeper": "" });   // ...and never deletes
    };
    const c = await mk();
    const ctrlId = c.cart.id;
    await c.owner.deleteOwnedContainer(c.cart.uuid);
    const control = { survived: !!game.actors.get(ctrlId) };
    proto.deleteOwnedContainer = realDelete;
    await game.actors.get(ctrlId)?.delete();
    await c.owner.delete();

    DialogV2.confirm = orig;
    return { unlink, orphan, del, control };
  });

  const { unlink, orphan, del, control } = out;

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
  /^Formerly belonged to /.test(unlink.label ?? "")
    ? ok("the sheet line reads as a former owner", `"${unlink.label}"`)
    : bad("the sheet line reads as a former owner", JSON.stringify(unlink.label));
  // Checked against the LITERAL, not against `unlink.label` -- comparing the two
  // observations to each other passes when both are empty, which is exactly the
  // failure being guarded against (a uuid that no longer resolves yields nothing
  // at both ends and the assertion agrees with itself).
  orphan.stillExists && /^Formerly belonged to ZZ Unlink Owner$/.test(orphan.label ?? "")
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

#!/usr/bin/env node
/**
 * Two ORDERINGS on the background-drop path. Both are about *when* the question is
 * asked, not about what the drop does — `dev:bg-drop-guard` already covers that.
 *
 *   1. THE PLAYER ONE. `_onDropBackground` used to show its destructive
 *      confirmation before `changeBackground` reached `canRegenerateContainers`,
 *      which refused a non-GM whose character HELD granted containers (deleting
 *      an Actor needs ASSISTANT): asked, said yes, refused. Since the user's
 *      ruling of 2026-11-01 a swap ORPHANS the old grant's containers and never
 *      deletes one, so nothing refuses at all — the leg now asserts the player
 *      is asked ONCE, the background changes, and each granted container is
 *      orphaned (unlinked, `formerlyBelongedTo` the PC, grant flag gone), not
 *      deleted. It still checks the setup really granted a container.
 *
 *   2. THE REORDER ONE. The background intercept sits at the very top of
 *      `_onDropItem`, above the same-actor branch. A background sitting in the
 *      inventory — the 0.1.7 artefact that upgraded worlds still carry — is a
 *      draggable row like any other, so DRAGGING IT TO REORDER IT raised the
 *      destructive prompt, and a GM answering yes wiped the character's granted
 *      gear. The gesture is a sort, not a swap.
 *
 * The GM cannot reproduce (1) and a player cannot conveniently be given a world to
 * wreck for (2), so this runs two sessions: `joinAsGM` for the setup and the reorder
 * leg, `joinAs(page, "Alice")` for the player leg. Run `npm run dev:players` first.
 *
 * Leg 2 runs twice, the second time with the fix neutralised IN PAGE: it
 * shadows `actor` on the dropped item so the new `item.actor !== this.actor`
 * term is false, which is literally the pre-fix condition. No second copy of
 * the method exists to drift out of step with the real one. (Leg 1's control,
 * which swapped `_mayChangeBackground` for a constant, went with the refusal
 * it reproduced.)
 *
 * World state (two settings, and every actor created here) is restored from NODE in
 * a finally, never from inside a page that may have died mid-evaluate.
 *
 * Usage: npm run dev:bg-drop-order
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog,
  trackCreatedActors, sweepCreatedActors } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(420000, "background drop ordering probe");

const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const gmErrors = watchErrors(gm);
await joinAsGM(gm);
await dismissChrome(gm);
// The player's swap now goes through, and the Warden's client mints whatever
// the new background grants under its own names — swept by id, not by prefix.
await trackCreatedActors(gm);

/** Clean up whatever happens; the world is the user's dev world. */
let saved = null;
let aliceErrors = [];
const restore = async () => {
  if (!saved) return;
  await gm.evaluate(async () => {
    for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ BGOrder"))) await a.delete();
  }).catch((e) => fail(`could not restore world state: ${e.message}`));
};

try {
  /* --- setup, as GM ---------------------------------------------------------- */

  const setup = await gm.evaluate(async () => {
    const NS = "air-bladder";
    // A stale actor from an aborted run would satisfy every precondition below
    // without this run having established any of them.
    for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ BGOrder"))) await a.delete();

    const alice = game.users.getName("Alice");
    if (!alice) return { error: 'no user named "Alice" — run `npm run dev:players` first' };

    const out = {
      aliceId: alice.id,
      // Nothing to save any more: `sort` is always read since 2026-08-22 (the
      // drag-to-reorder toggle retired), so no setting is flipped here.
      saved: {},
    };

    const pack = game.packs.get("air-bladder.backgrounds-2e")
      ?? game.packs.find((p) => p.metadata.name?.startsWith("backgrounds"));
    if (!pack) return { error: "no backgrounds pack in this world" };
    const idx = await pack.getIndex();
    if (idx.contents.length < 2) return { error: `pack ${pack.metadata.id} holds ${idx.contents.length} background(s)` };
    const bgA = await pack.getDocument(idx.contents[0]._id);
    const bgB = await pack.getDocument(idx.contents[1]._id);
    out.bgA = bgA.name;
    out.bgB = bgB.name;
    out.bgBUuid = bgB.uuid;

    const pc = await CONFIG.Actor.documentClass.create({
      name: "ZZ BGOrder Player PC",
      type: "character",
      ownership: { [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    });
    await pc.sheet.render(true);
    await new Promise((r) => setTimeout(r, 400));

    const DialogV2 = foundry.applications.api.DialogV2;
    const origConfirm = DialogV2.confirm;
    DialogV2.confirm = async () => true;
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: bgA.uuid }));
      await pc.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt }));
    } finally { DialogV2.confirm = origConfirm; }
    // The swap rolls tables and resolves gear — poll for the result rather than
    // sleeping past it, or "nothing changed" later is read before anything could.
    for (let i = 0; i < 80 && pc.system.backgroundUuid !== bgA.uuid; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    await pc.sheet.close();
    out.actorId = pc.id;
    out.startBackground = pc.system.background;
    out.startItems = pc.items.size;

    // ESTABLISH the precondition rather than hope for it. The refusal this leg
    // tests fires only when the character HOLDS a granted container to delete
    // (`canRegenerateContainers`); it no longer keys on any setting — a display
    // toggle deciding a permission was the original defect, and that toggle is
    // gone entirely. Whether the setup swap granted one is a d6 roll on
    // whichever background the pack index happened to hand back first, so this
    // leg had quietly become "nothing granted, nothing refused, background
    // changes" and was failing on CONTENT rather than on the code under test.
    // (Confirmed by baselining it against HEAD: it failed the same way there.)
    // So mint one, flagged the way generation flags them.
    const countGranted = () => game.actors.filter(
      (a) => (a.system?.connectedTo === pc.uuid || a.system?.keeper === pc.uuid)
        && a.getFlag("air-bladder", "grantSource")).length;
    out.grantedByBackground = countGranted();
    if (!out.grantedByBackground) {
      await CONFIG.Actor.documentClass.create({
        name: "ZZ BGOrder Granted Mule",
        type: "npc",
        system: { role: "mount", containerClass: "mule", connectedTo: pc.uuid, generationEnabled: false },
        flags: { "air-bladder": { grantSource: "probe" } },
      });
    }
    out.grantedContainers = countGranted();
    // Their IDS, so the player leg reads the very actors the swap must orphan.
    out.grantedIds = game.actors.filter(
      (a) => a.system?.connectedTo === pc.uuid && a.getFlag("air-bladder", "grantSource")).map((a) => a.id);
    out.pcName = pc.name;
    return out;
  });

  if (setup.error) {
    fail(`setup: ${setup.error}`);
    throw new Error(setup.error);
  }
  saved = setup.saved;
  console.log(`\nsetup: "${setup.startBackground}" with ${setup.startItems} item(s), owned by Alice; `
    + `dropping "${setup.bgB}" onto it`);
  if (!setup.startBackground) {
    fail("the setup swap left the character with NO background — every \"nothing changed\" "
      + "assertion below would pass on an empty starting state");
  }

  /* --- leg 1: the player ordering -------------------------------------------- */

  const alice = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
  aliceErrors = watchErrors(alice);
  await joinAs(alice, "Alice");
  await dismissChrome(alice);

  const playerDrop = () => alice.evaluate(async ({ actorId, bgBUuid }) => {
    const actor = game.actors.get(actorId);
    if (!actor) return { error: "Alice cannot see the test character" };
    if (!actor.isOwner) return { error: "Alice does not own the test character" };
    const sheet = actor.sheet;
    await sheet.render(true);
    await new Promise((r) => setTimeout(r, 600));

    const warns = [];
    const origWarn = ui.notifications.warn.bind(ui.notifications);
    ui.notifications.warn = (m, ...r) => { warns.push(String(m)); return origWarn(m, ...r); };

    const DialogV2 = foundry.applications.api.DialogV2;
    const origConfirm = DialogV2.confirm;
    let asked = 0;
    DialogV2.confirm = async () => { asked += 1; return true; };  // answer YES

    const before = { background: actor.system.background, items: actor.items.size };
    let threw = null;
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: bgBUuid }));
      await sheet._onDrop(new DragEvent("drop", { dataTransfer: dt }));
    } catch (e) { threw = e.message; }
    // The swap rolls tables and resolves gear: poll for the new background.
    for (let i = 0; i < 40 && actor.system.background === before.background; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 1500));

    const res = {
      asked,
      threw,
      warns: [...warns],
      background: actor.system.background,
      changed: actor.system.background !== before.background || actor.items.size !== before.items,
    };
    DialogV2.confirm = origConfirm;
    ui.notifications.warn = origWarn;
    await sheet.close();
    return res;
  }, { actorId: setup.actorId, bgBUuid: setup.bgBUuid });

  // Say the precondition OUT LOUD, and where it came from: a background that
  // granted one by its own d6, or the mule the setup had to mint because it
  // did not. Either way the leg only means something with a non-zero count.
  console.log(`\n1. a player dropping a background — holds ${setup.grantedContainers} granted container(s)`
    + ` (${setup.grantedByBackground} from the background, ${setup.grantedContainers - setup.grantedByBackground} seeded)`);
  if (!setup.grantedContainers) {
    fail("the character holds NO granted containers, so there is nothing for the swap to "
      + "orphan — this leg cannot fail and is not evidence");
  }
  // ASKED ONCE, AND THE SWAP HAPPENS (user ruling 2026-11-01). The ordering
  // this leg used to guard — the destructive question asked, then a refusal —
  // has no refusal left to order against: a swap ORPHANS the old grant's
  // containers instead of deleting them, so a player needs no Warden for it.
  // The `_mayChangeBackground` control went with the refusal it reproduced.
  const p = await playerDrop();
  if (p.error) fail(`player leg: ${p.error}`);
  else {
    if (p.threw) fail(`the drop threw: ${p.threw}`);
    p.asked === 1 && p.changed && p.background === setup.bgB
      ? ok(`asked once, and the background changed to "${setup.bgB}"`)
      : fail(`the player's drop: asked ${p.asked}, now "${p.background}", warns ${JSON.stringify(p.warns)}`);
    const orphans = await gm.evaluate(({ ids, pcName }) => ids.map((id) => {
      const a = game.actors.get(id);
      return a ? { connectedTo: a.system?.connectedTo ?? "", formerly: a.system?.formerlyBelongedTo ?? "",
        grantSource: a.getFlag("air-bladder", "grantSource") ?? null, ok: !a.system?.connectedTo
          && a.system?.formerlyBelongedTo === pcName && !a.getFlag("air-bladder", "grantSource") } : { gone: true };
    }), { ids: setup.grantedIds, pcName: setup.pcName });
    orphans.length && orphans.every((o) => o.ok)
      ? ok(`its ${orphans.length} granted container(s) are orphaned, not deleted`)
      : fail(`the old grant's containers: ${JSON.stringify(orphans)}`);
  }

  await alice.context().close();

  /* --- leg 2: the reorder ordering ------------------------------------------- */

  const reorderDrop = (control) => gm.evaluate(async ({ control }) => {
    const NS = "air-bladder";
    const name = `ZZ BGOrder Reorder${control ? " Control" : ""}`;
    for (const a of game.actors.filter((a) => a.name === name)) await a.delete();

    const pc = await CONFIG.Actor.documentClass.create({
      name, type: "character", system: { background: "ZZ Starting Background" },
    });
    // The drop aims at the LAST row, a move that must change the dragged item's
    // sort — otherwise "the reorder happened" is satisfied by a reorder that had
    // nothing to do.
    //
    // Looked up BY NAME, never by position. `createEmbeddedDocuments` does NOT
    // promise to return documents in request order — measured on 14.365, a
    // two-item create came back reversed — so the old
    // `const [pocketed, , gearB] = …` destructuring silently bound the FIRST
    // GEAR item as the "pocketed background" whenever the order came back
    // shuffled. The control then dragged an ordinary item, no background
    // intercept fired, and the leg reported "the drop never reached the
    // handler": a probe failure that looked like a harness fault and said
    // nothing about the code. Assert the type too, so a rename or a subtype
    // change cannot re-create it quietly.
    const made = await pc.createEmbeddedDocuments("Item", [
      { name: "ZZ BGOrder Pocketed", type: "background" },
      { name: "ZZ BGOrder Gear A", type: "item" },
      { name: "ZZ BGOrder Gear B", type: "item" },
    ]);
    const pocketed = made.find((i) => i.name === "ZZ BGOrder Pocketed");
    const gearB = made.find((i) => i.name === "ZZ BGOrder Gear B");
    if (!pocketed || !gearB) {
      await pc.delete();
      return { error: `the probe's own items were not created (got ${made.map((i) => i.name).join(", ")})` };
    }
    if (pocketed.type !== "background") {
      await pc.delete();
      return { error: `the pocketed item is type "${pocketed.type}", not background — `
        + "the background intercept would never fire and this leg would test nothing" };
    }
    await pc.sheet.render(true);
    await new Promise((r) => setTimeout(r, 800));

    const root = pc.sheet.element;
    const dstRow = root?.querySelector(`[data-item-id="${gearB.id}"]`);
    if (!root?.querySelector(`[data-item-id="${pocketed.id}"]`) || !dstRow) {
      await pc.delete();
      return { error: "the inventory rows did not render — a same-actor drop cannot be aimed" };
    }

    const DialogV2 = foundry.applications.api.DialogV2;
    const origConfirm = DialogV2.confirm;
    let asked = 0;
    DialogV2.confirm = async () => { asked += 1; return true; };  // answer YES — see the damage

    // NEGATIVE CONTROL: the fix added `item.actor !== this.actor` to the intercept.
    // Shadowing `actor` on the resolved document makes that term false, which is
    // the pre-fix condition itself. Resolved through fromUuid because that is how
    // the drop resolves it — patching a different reference would prove nothing.
    const dropped = await fromUuid(pocketed.uuid);
    if (control) Object.defineProperty(dropped, "actor", { get: () => null, configurable: true });

    const beforeSort = pocketed.sort;
    const beforeBg = pc.system.background;
    const beforeItems = pc.items.size;
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: pocketed.uuid }));
    let threw = null;
    // Re-query and check attachment: a row captured before a re-render is detached,
    // and dispatching on a detached node reaches no listener at all. That is
    // indistinguishable, in the result, from a drop the code chose to ignore.
    const aim = pc.sheet.element?.querySelector(`[data-item-id="${gearB.id}"]`) ?? dstRow;
    const connected = aim.isConnected;
    try {
      aim.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    } catch (e) { threw = e.message; }
    // The DOM handler is async and nothing awaits it. Poll for either outcome.
    for (let i = 0; i < 60 && !asked && pc.items.get(pocketed.id)?.sort === beforeSort; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1200));

    const res = {
      asked,
      threw,
      connected,
      // Reported because a control that quietly fails to neutralise anything looks
      // exactly like a fix that was never needed.
      shadowed: control ? dropped.actor === null : null,
      sameObject: control ? dropped === pocketed : null,
      sorted: pc.items.get(pocketed.id)?.sort !== beforeSort,
      stillPocketed: !!pc.items.get(pocketed.id),
      changed: pc.system.background !== beforeBg || pc.items.size !== beforeItems,
      background: pc.system.background,
    };
    if (control) delete dropped.actor;
    DialogV2.confirm = origConfirm;
    await pc.sheet.close();
    await pc.delete();
    return res;
  }, { control });

  console.log("\n2. dragging a pocketed background to reorder it");
  const r = await reorderDrop(false);
  if (r.error) fail(`reorder leg: ${r.error}`);
  else {
    if (r.threw) fail(`the drop threw: ${r.threw}`);
    if (r.asked) {
      fail(`a reorder raised ${r.asked} destructive background prompt(s)`
        + `${r.changed ? ` and the background became "${r.background}"` : ""}`);
    } else if (r.changed) {
      fail(`a reorder changed the character without even asking (background "${r.background}")`);
    } else if (!r.stillPocketed) {
      fail("the reorder removed the background item from the inventory");
    } else if (!r.sorted) {
      fail("nothing was asked, but nothing was sorted either — the row is inert, not reordered");
    } else {
      ok("sorted in place: no prompt, no swap, the item stays where it was put");
    }
  }

  console.log("   negative control: the same drag with the same-actor term removed");
  const rc = await reorderDrop(true);
  const rcState = `connected ${rc.connected}, shadowed ${rc.shadowed}, sameObject ${rc.sameObject}, `
    + `sorted ${rc.sorted}`;
  if (rc.error) fail(`reorder control: ${rc.error}`);
  else if (rc.asked) {
    ok(`reproduced — asked ${rc.asked} time(s)${rc.changed ? ", and the swap went through" : ""} `
      + `[${rcState}]`);
  } else if (!rc.connected || (!rc.sorted && !rc.changed)) {
    // Distinguish "the fix was not neutralised" from "the drop never arrived".
    fail(`the control's drop never reached the handler — nothing was asked and nothing was `
      + `sorted [${rcState}]. This says nothing about the fix; the probe missed.`);
  } else {
    fail(`the control did NOT reproduce the defect [${rcState}] — the same-actor term above `
      + "cannot be shown to be load-bearing");
  }
} finally {
  await sweepCreatedActors(gm);
  await restore();
}

const errors = [...gmErrors, ...aliceErrors];
if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "BACKGROUND DROP ORDERING PROBE FAILED" : "Background drop ordering probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

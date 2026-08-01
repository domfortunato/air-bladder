#!/usr/bin/env node
/**
 * Two ORDERINGS on the background-drop path. Both are about *when* the question is
 * asked, not about what the drop does — `dev:bg-drop-guard` already covers that.
 *
 *   1. THE PLAYER ONE. `_onDropBackground` shows its destructive confirmation
 *      ("change this character's background to X? this deletes its granted gear")
 *      before `changeBackground` reaches `canRegenerateContainers`. That guard
 *      refuses for EVERY non-GM whenever `show-containers-tab` is on, whatever the
 *      character is actually carrying — containers are Actors and Foundry gates
 *      Actor deletion on ASSISTANT. So a player was asked a destructive question the
 *      code could never honour, said yes, and got a warning and no change.
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
 * Both legs run twice, the second time with the fix neutralised IN PAGE:
 *   - (1) swaps `_mayChangeBackground` on the prototype to a constant `true`. That
 *     method IS the fix, so replacing it restores the old order exactly, and the
 *     refusal still arrives from `changeBackground`'s own guard downstream — which
 *     is the defect: asked, then refused.
 *   - (2) shadows `actor` on the dropped item so the new `item.actor !== this.actor`
 *     term is false, which is literally the pre-fix condition. No second copy of
 *     either method exists to drift out of step with the real one.
 *
 * World state (two settings, and every actor created here) is restored from NODE in
 * a finally, never from inside a page that may have died mid-evaluate.
 *
 * Usage: npm run dev:bg-drop-order
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(420000, "background drop ordering probe");

const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const gmErrors = watchErrors(gm);
await joinAsGM(gm);
await dismissChrome(gm);

/** Put the two settings back whatever happens; the world is the user's dev world. */
let saved = null;
let aliceErrors = [];
const restore = async () => {
  if (!saved) return;
  await gm.evaluate(async (s) => {
    for (const a of game.actors.filter((a) => a.name?.startsWith("ZZ BGOrder"))) await a.delete();
    await game.settings.set("air-bladder", "show-containers-tab", s.containers);
    await game.settings.set("air-bladder", "enable-inventory-reorder", s.reorder);
  }, saved).catch((e) => fail(`could not restore world state: ${e.message}`));
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
      saved: {
        containers: game.settings.get(NS, "show-containers-tab"),
        reorder: game.settings.get(NS, "enable-inventory-reorder"),
      },
      // The sentence a refused background swap must show, and the one it must NOT.
      // They are different keys because they refuse different operations: the
      // regenerate wording ends "ask them to re-roll it for you", which on a
      // background swap tells a player to request something that discards their
      // abilities, HP and traits.
      bgWarning: game.i18n.localize("CAIRN.Notify.NoContainerBackground"),
      regenWarning: game.i18n.localize("CAIRN.Notify.NoContainerRegen"),
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

    // Containers OFF for the setup swap, so establishing a starting background does
    // not mint container ACTORS this probe would then have to hunt down by name.
    // The guard does not care: with the tab on it refuses on `mayCreate` alone.
    await game.settings.set(NS, "show-containers-tab", false);

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

    // The world state the player defect needs.
    await game.settings.set(NS, "show-containers-tab", true);
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

  const playerDrop = (control) => alice.evaluate(async ({ actorId, bgBUuid, control }) => {
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

    // NEGATIVE CONTROL: `_mayChangeBackground` IS the fix, so a constant `true`
    // restores the pre-fix order exactly — the confirmation is reached, and the
    // refusal then arrives from changeBackground's own guard instead.
    const proto = Object.getPrototypeOf(sheet);
    const savedMay = proto._mayChangeBackground;
    if (control) proto._mayChangeBackground = () => true;

    const before = { background: actor.system.background, items: actor.items.size };
    let threw = null;
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: bgBUuid }));
      await sheet._onDrop(new DragEvent("drop", { dataTransfer: dt }));
    } catch (e) { threw = e.message; }
    await new Promise((r) => setTimeout(r, 2500));

    const res = {
      asked,
      threw,
      warns: [...warns],
      background: actor.system.background,
      changed: actor.system.background !== before.background || actor.items.size !== before.items,
    };
    if (control) proto._mayChangeBackground = savedMay;
    DialogV2.confirm = origConfirm;
    ui.notifications.warn = origWarn;
    await sheet.close();
    return res;
  }, { actorId: setup.actorId, bgBUuid: setup.bgBUuid, control });

  console.log("\n1. a player dropping a background in a containers-on world");
  const p = await playerDrop(false);
  if (p.error) fail(`player leg: ${p.error}`);
  else {
    if (p.threw) fail(`the drop threw: ${p.threw}`);
    if (p.changed) {
      fail(`the background CHANGED to "${p.background}" — the container guard is supposed to `
        + "refuse this, so the premise of the whole leg has moved");
    } else if (p.asked) {
      fail(`asked ${p.asked} destructive question(s) and then refused — the ordering defect`);
    } else if (!p.warns.some((w) => w === setup.bgWarning)) {
      fail(`refused without asking, but said nothing useful: ${JSON.stringify(p.warns)}`);
    } else if (p.warns.some((w) => w === setup.regenWarning)) {
      fail("refused with the REGENERATE wording — it tells the player to ask the Warden to "
        + `re-roll their character, which discards abilities, HP and traits: ${JSON.stringify(p.warns)}`);
    } else {
      ok(`refused up front, unasked, in the background's own words ("${setup.bgWarning}")`);
    }
  }

  console.log("   negative control: the same drop with _mayChangeBackground neutralised");
  const pc = await playerDrop(true);
  if (pc.error) fail(`player control: ${pc.error}`);
  else if (pc.asked && !pc.changed) ok(`reproduced — asked ${pc.asked} time(s), then refused, nothing changed`);
  else {
    fail(`the control did NOT reproduce the defect (asked ${pc.asked}, changed ${pc.changed}) — `
      + "the guard above cannot be shown to be load-bearing");
  }

  await alice.context().close();

  /* --- leg 2: the reorder ordering ------------------------------------------- */

  const reorderDrop = (control) => gm.evaluate(async ({ control }) => {
    const NS = "air-bladder";
    await game.settings.set(NS, "enable-inventory-reorder", true);
    const name = `ZZ BGOrder Reorder${control ? " Control" : ""}`;
    for (const a of game.actors.filter((a) => a.name === name)) await a.delete();

    const pc = await CONFIG.Actor.documentClass.create({
      name, type: "character", system: { background: "ZZ Starting Background" },
    });
    // Pocketed FIRST so it sorts lowest; the drop then aims at the last row, which
    // is a move that must change its sort — otherwise "the reorder happened" is
    // satisfied by a reorder that had nothing to do.
    const [pocketed, , gearB] = await pc.createEmbeddedDocuments("Item", [
      { name: "ZZ BGOrder Pocketed", type: "background" },
      { name: "ZZ BGOrder Gear A", type: "item" },
      { name: "ZZ BGOrder Gear B", type: "item" },
    ]);
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
  await restore();
}

const errors = [...gmErrors, ...aliceErrors];
if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "BACKGROUND DROP ORDERING PROBE FAILED" : "Background drop ordering probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

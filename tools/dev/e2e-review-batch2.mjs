/**
 * Review #6, batch 2 — data integrity. One leg per finding, each proven
 * load-bearing by the batch negative control (stash the source fixes, keep
 * this file, re-run: the discriminating assertions go red).
 *
 *   1. grantContainers' ACTOR_CREATE-player path sets the ownershipSync flag
 *      and emits, so the CONNECTED shape (default OBSERVER) actually arrives —
 *      the comment used to promise a GM sync nothing requested.
 *   2. The HP strip's panic half obeys the use-panic SETTING, matching
 *      prepareData's derived zero: setting off + still panicked must not
 *      leave HP silently un-editable.
 *   3. A hireling-typed doc (frozen alias of npc) gets the npc capacity
 *      override, the Kind label, and container art at creation.
 *   4. A deleted keeper's orphans are unlinked in ONE batched
 *      updateDocuments call, not one awaited update() each.
 *   5. createOwnedFeature neither mutates the caller's object nor pushes
 *      into prepared state before the write.
 *   6. custom-portrait-folder's onChange elects the activeGM: with two GMs
 *      connected, exactly one client scans and writes the cached list.
 *   7. Read-only actions (rollDamage etc.) work on a LOCKED pack's sheet;
 *      mutating actions still warn.
 *   8. (REFUTED — no leg, no fix. See the note where the leg would sit.)
 *   9. The background sheet's _onDrop fires dropItemSheetData and honours a
 *      false veto, like core (item-sheet.mjs:129-130).
 *
 * Needs BOTH player and second-GM sessions, so it establishes Alice (role
 * PLAYER) and a throwaway second GM itself. World writes are restored from
 * Node in `finally` — core permissions, pack lock state, settings, every
 * probe document, the second GM user, and the scanned probe directory.
 *
 * Usage: npm run dev:review-batch2   (Foundry running on :30000)
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, joinAs, watchErrors, watchdog, withSettings } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(46)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(46)} ${detail}`); failures++; };
let failures = 0;

watchdog(300000, "review-batch2");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
const errors = watchErrors(page);
// watchErrors records the message; the stack is what names the throwing core
// line when a leg trips one (it took chat.mjs:1308 to explain the first).
page.on("pageerror", (e) => console.error(`  note  pageerror stack:\n${e.stack}`));
await joinAsGM(page);
await dismissChrome(page);

// Everything the finally needs to undo, collected as legs run.
const cleanup = {
  actorIds: [],
  itemIds: [],
  messageIds: [],
  permSnap: null,        // JSON of core.permissions before the widen (null = untouched)
  packWasUnlocked: false, // monsters pack lock state to restore
  gm2Made: false,
  portraitDir: null,      // probe folder to rmdir from Node
};
let alicePage = null, gm2Page = null;

try {
  await withSettings(page, async () => {

    /* ---- 2. the HP strip's panic half obeys the setting ------------------- */
    console.log("\npanic strip vs the use-panic setting");

    // Each phase CREATES its actor after setting the toggle: use-panic is
    // requiresReload, and a fresh create is the honest stand-in for the reload
    // (prepareData runs once, under the new value, exactly as it would after).
    const panicOn = await page.evaluate(async () => {
      await game.settings.set("air-bladder", "use-panic", true);
      const settle = (ms) => new Promise((r) => setTimeout(r, ms));
      const a = await CONFIG.Actor.documentClass.create({
        name: "ZZ PROBE B2 PanicOn", type: "character",
        system: { hp: { value: 4, max: 4 }, panicked: true },
      });
      await a.sheet.render(true);
      for (let i = 0; i < 60 && !a.sheet.element; i++) await settle(100);
      await settle(400);
      const input = a.sheet.element?.querySelector('input[name="system.hp.value"]');
      if (!input) return { error: "no hp input on the character sheet" };
      const shown = input.value;
      input.value = "3";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(900);
      const stored = a._source.system.hp.value;
      await a.sheet.close();
      return { id: a.id, derived: a.system.hp.value, shown, stored };
    });
    if (panicOn.error) fail("panic-on setup", panicOn.error);
    else {
      cleanup.actorIds.push(panicOn.id);
      panicOn.derived === 0 && panicOn.shown === "0"
        ? ok("precondition: setting on + panicked derives HP 0")
        : fail("precondition broke — panic no longer derives 0", `derived ${panicOn.derived}, shown "${panicOn.shown}"`);
      panicOn.stored === 4
        ? ok("strip HOLDS while the zero is derived", "(edit dropped, stored 4)")
        : fail(`strip released while panicked — stored ${panicOn.stored}`, "a derived 0 can now persist");
    }

    const panicOff = await page.evaluate(async () => {
      await game.settings.set("air-bladder", "use-panic", false);
      const settle = (ms) => new Promise((r) => setTimeout(r, ms));
      const a = await CONFIG.Actor.documentClass.create({
        name: "ZZ PROBE B2 PanicOff", type: "character",
        system: { hp: { value: 4, max: 4 }, panicked: true },
      });
      await a.sheet.render(true);
      for (let i = 0; i < 60 && !a.sheet.element; i++) await settle(100);
      await settle(400);
      const input = a.sheet.element?.querySelector('input[name="system.hp.value"]');
      if (!input) return { error: "no hp input on the character sheet" };
      const shown = input.value;
      input.value = "3";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(900);
      const stored = a._source.system.hp.value;
      await a.sheet.close();
      return { id: a.id, shown, stored };
    });
    if (panicOff.error) fail("panic-off setup", panicOff.error);
    else {
      cleanup.actorIds.push(panicOff.id);
      panicOff.shown === "4"
        ? ok("precondition: setting off shows the real HP", "(no derived zero)")
        : fail(`setting off but the input showed "${panicOff.shown}"`);
      panicOff.stored === 3
        ? ok("strip RELEASES when the setting is off", "(edit persisted, stored 3)")
        : fail(`HP edit silently dropped with use-panic off — stored ${panicOff.stored}`,
          "the strip drifted from prepareData's gate (review #6 finding 2)");
    }

    /* ---- 3. hireling is an npc alias in the three re-keyed gates ---------- */
    console.log("\nhireling-typed docs in the npc gates");

    const hire = await page.evaluate(async () => {
      const maxEquip = Number(game.settings.get("air-bladder", "max-equip-slots"));
      const want = maxEquip + 3;
      const h = await CONFIG.Actor.documentClass.create({
        name: "ZZ PROBE B2 Hire", type: "hireling",
        system: { slots: want, containerClass: "sack" },
      });
      const mule = await CONFIG.Actor.documentClass.create({
        name: "ZZ PROBE B2 Mule", type: "hireling",
        system: { role: "mount" },
      });
      return {
        ids: [h.id, mule.id], maxEquip, want,
        slotsMax: h.system.slotsMax,
        classLabel: h.system.classLabel ?? null,
        img: mule.img,
      };
    });
    cleanup.actorIds.push(...hire.ids);
    hire.slotsMax === hire.want
      ? ok(`capacity override honoured (${hire.slotsMax})`, `not the world max ${hire.maxEquip}`)
      : fail(`hireling slots override ignored — slotsMax ${hire.slotsMax}, wanted ${hire.want}`);
    hire.classLabel
      ? ok(`Kind label derived ("${hire.classLabel}")`)
      : fail("no classLabel on a hireling with a Kind");
    // The discriminator is "container art", NOT "not mystery-man": a
    // hireling-typed doc is unconditionally an npc PERSON to _preCreate
    // (actor.js `isNpcPerson`, type short-circuit), so even without the fix
    // the mule arrived wearing a random HUMAN portrait — which passed a
    // mystery-man check just fine. The container branch runs after the
    // portrait one and must win with a glyph from the icon dir.
    hire.img?.startsWith("systems/air-bladder/icons/")
      ? ok("container art stamped at creation", hire.img.split("/").pop())
      : fail(`hireling mount got ${hire.img ?? "no img"}`, "isContainerish still keys type === \"npc\" (a person portrait is the old behaviour)");

    /* ---- 4. orphan unlink is ONE batched write ---------------------------- */
    console.log("\ndelete-time orphan unlink batches");

    const batch = await page.evaluate(async () => {
      const AC = CONFIG.Actor.documentClass;
      const pc = await AC.create({ name: "ZZ PROBE B2 Dead", type: "character" });
      const kids = [];
      for (let i = 0; i < 2; i++) {
        kids.push(await AC.create({
          name: `ZZ PROBE B2 Orphan ${i}`, type: "npc",
          system: { role: "container", containerClass: "sack", connectedTo: pc.uuid, generationEnabled: false },
        }));
      }
      const orig = AC.updateDocuments;
      let calls = 0;
      AC.updateDocuments = function (...a) { calls++; return orig.apply(this, a); };
      try {
        await pc.delete();
      } finally {
        AC.updateDocuments = orig;
      }
      const after = kids.map((k) => {
        const d = game.actors.get(k.id);
        return { formerly: d?.system.formerlyBelongedTo, link: d?.system.connectedTo, def: d?.ownership.default };
      });
      return { ids: kids.map((k) => k.id), calls, after };
    });
    cleanup.actorIds.push(...batch.ids);
    batch.after.every((a) => a.formerly === "ZZ PROBE B2 Dead" && a.link === "" && a.def === 1)
      ? ok("both orphans stamped, unlinked, dropped to LIMITED")
      : fail("orphan end-state wrong", JSON.stringify(batch.after));
    batch.calls === 1
      ? ok("ONE updateDocuments call for two orphans", "(batched)")
      : fail(`${batch.calls} updateDocuments calls for two orphans`, "still one awaited update() per child");

    /* ---- 5. createOwnedFeature is non-mutating ---------------------------- */
    console.log("\ncreateOwnedFeature");

    const feat = await page.evaluate(async () => {
      const npc = await CONFIG.Actor.documentClass.create({
        name: "ZZ PROBE B2 Feat", type: "npc", system: { role: "npc" },
      });
      const data = { name: "ZZ Probe Feature", description: "probe" };
      await npc.createOwnedFeature(data);
      const stored = (npc.system.features ?? []).find((f) => f.name === "ZZ Probe Feature");
      return { id: npc.id, callerMutated: "id" in data, storedWithId: !!(stored && stored.id) };
    });
    cleanup.actorIds.push(feat.id);
    feat.storedWithId
      ? ok("feature stored, id assigned")
      : fail("feature missing or without id after create");
    feat.callerMutated
      ? fail("caller's data object was mutated", "createOwnedFeature still writes data.id in place")
      : ok("caller's object untouched");

    /* ---- 7. read-only actions on a locked pack ---------------------------- */
    console.log("\nread actions on a locked compendium sheet");

    const packPrep = await page.evaluate(async () => {
      const pack = game.packs.get("air-bladder.monsters");
      if (!pack) return { error: "no air-bladder.monsters pack" };
      const wasUnlocked = !pack.locked;
      if (wasUnlocked) await pack.configure({ locked: true });
      const idx = await pack.getIndex();
      return { wasUnlocked, docId: idx.contents[0]?._id ?? null };
    });
    if (packPrep.error || !packPrep.docId) fail("locked-pack setup", packPrep.error ?? "empty monsters pack");
    else {
      cleanup.packWasUnlocked = packPrep.wasUnlocked;
      const locked = await page.evaluate(async ({ docId }) => {
        const settle = (ms) => new Promise((r) => setTimeout(r, ms));
        const pack = game.packs.get("air-bladder.monsters");
        const doc = await pack.getDocument(docId);
        const sheet = doc.sheet;
        await sheet.render(true);
        for (let i = 0; i < 60 && !sheet.element; i++) await settle(100);
        await settle(300);

        const warns = [];
        const origWarn = ui.notifications.warn;
        ui.notifications.warn = function (msg, ...rest) { warns.push(String(msg)); return origWarn.call(this, msg, ...rest); };
        const out = { editable: sheet.isEditable };
        try {
          const before = game.messages.size;
          const target = document.createElement("a");
          target.dataset.roll = "1d4";
          target.dataset.label = "Probe Attack";
          await sheet.options.actions.rollDamage.call(sheet, { preventDefault() {}, button: 0 }, target);
          // toMessage is not awaited inside the handler — poll for the card.
          const deadline = Date.now() + 4000;
          while (Date.now() < deadline && game.messages.size <= before) await settle(150);
          out.rolled = game.messages.size > before;
          out.rollWarns = warns.length;
          // A mutating action must STILL be walled off.
          await sheet.options.actions.itemDelete.call(sheet, { preventDefault() {} }, document.createElement("a"));
          out.deleteWarned = warns.length > out.rollWarns;
          // The card is probe litter in a shared world, but it is NOT deleted
          // here: core's #postNotification re-queries the card by id AFTER an
          // awaited spacer animation and sets .hidden on the result
          // (chat.mjs:1308-1309), so a delete inside that window finds core a
          // null and throws — a race only a probe can lose. The ids ride out
          // to the Node finally instead, seconds after the pipeline settles.
          out.messageIds = out.rolled
            ? game.messages.contents.slice(-(game.messages.size - before)).map((m) => m.id)
            : [];
        } finally {
          ui.notifications.warn = origWarn;
          await sheet.close();
        }
        return out;
      }, { docId: packPrep.docId });
      cleanup.messageIds.push(...(locked.messageIds ?? []));
      locked.editable === false
        ? ok("precondition: the pack sheet is not editable")
        : fail("monsters pack sheet came up editable — lock did not take");
      locked.rolled && locked.rollWarns === 0
        ? ok("rollDamage rolls from a locked pack", "(no PackLocked toast)")
        : fail(`rollDamage on a locked pack: rolled=${locked.rolled}, warns=${locked.rollWarns}`,
          "the read set is still wrapped in owned()");
      locked.deleteWarned
        ? ok("itemDelete still warns", "(mutations stay walled)")
        : fail("itemDelete no longer warns on a locked pack — the wall moved too far");
    }

    /* ---- (finding 8 — the gear glyph — carries NO leg, deliberately.) -------
     * The review said a click landing on the glyph inside the Items tab anchor
     * never switches the tab, because _onClickTab reads event.target
     * (application.mjs:1975). The structural facts are right and the failure
     * is IMPOSSIBLE anyway: core's own stylesheet declares
     * `nav.tabs [data-tab] > * { pointer-events: none }` (foundry2.css:5768),
     * so no real pointer ever hit-tests the glyph — measured here with
     * elementFromPoint at the glyph's center returning the anchor, template
     * fix stashed. A leg for it passed identically with and without the fix,
     * which is fake coverage; the finding is REFUTED, the template untouched. */

    /* ---- 9. background _onDrop fires dropItemSheetData --------------------- */
    console.log("\nbackground drop hook");

    const drop = await page.evaluate(async () => {
      const settle = (ms) => new Promise((r) => setTimeout(r, ms));
      const bg = await Item.implementation.create({ name: "ZZ PROBE B2 Background", type: "background" });
      const sword = await Item.implementation.create({ name: "ZZ PROBE B2 Sword", type: "weapon" });
      await bg.sheet.render(true);
      for (let i = 0; i < 60 && !bg.sheet.element; i++) await settle(100);
      await settle(300);
      // document.body has no [data-drop] ancestor, so the drop lands on the
      // default starting-gear path.
      const ev = () => ({
        preventDefault() {},
        target: document.body,
        dataTransfer: { getData: () => JSON.stringify({ type: "Item", uuid: sword.uuid }) },
      });
      const out = { ids: [bg.id, sword.id] };
      const veto = () => false;
      Hooks.on("dropItemSheetData", veto);
      try {
        await bg.sheet._onDrop(ev());
        await settle(400);
        out.gearAfterVeto = (bg.system.startingGear ?? []).length;
      } finally { Hooks.off("dropItemSheetData", veto); }
      let seen = null;
      const recorder = (item, sheet, data) => { seen = { name: item?.name, type: data?.type }; };
      Hooks.on("dropItemSheetData", recorder);
      try {
        await bg.sheet._onDrop(ev());
        await settle(400);
        out.gearAfterDrop = (bg.system.startingGear ?? []).length;
        out.seen = seen;
      } finally { Hooks.off("dropItemSheetData", recorder); }
      await bg.sheet.close();
      return out;
    });
    cleanup.itemIds.push(...drop.ids);
    drop.gearAfterVeto === 0
      ? ok("a false veto blocks the drop", "(gear stayed empty)")
      : fail(`vetoed drop landed anyway — ${drop.gearAfterVeto} gear row(s)`, "the hook is not consulted");
    drop.gearAfterDrop === 1
      ? ok("an un-vetoed drop still lands")
      : fail(`expected 1 gear row after the real drop, got ${drop.gearAfterDrop}`);
    drop.seen && drop.seen.name === "ZZ PROBE B2 Background" && drop.seen.type === "Item"
      ? ok("hook receives (item, sheet, data)", "like core's own call")
      : fail("hook saw the wrong arguments", JSON.stringify(drop.seen));

    /* ---- 1. grantContainers under a player WITH ACTOR_CREATE --------------- */
    console.log("\ngrantContainers on the ACTOR_CREATE-player path");

    const grantPrep = await page.evaluate(async () => {
      const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
      const snap = JSON.stringify(perms);
      if (!perms.ACTOR_CREATE.includes(CONST.USER_ROLES.PLAYER)) {
        perms.ACTOR_CREATE = [...perms.ACTOR_CREATE, CONST.USER_ROLES.PLAYER];
        await game.settings.set("core", "permissions", perms);
      }
      let alice = game.users.getName("Alice");
      if (!alice) alice = await User.create({ name: "Alice", role: CONST.USER_ROLES.PLAYER });
      if (alice.role !== CONST.USER_ROLES.PLAYER) return { error: `Alice is role ${alice.role}, not PLAYER` };
      const pc = await CONFIG.Actor.documentClass.create({
        name: "ZZ PROBE B2 Char", type: "character",
        ownership: { default: 0, [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      });
      return { snap, pcUuid: pc.uuid, pcId: pc.id };
    });
    if (grantPrep.error) fail("grant setup", grantPrep.error);
    else {
      cleanup.permSnap = grantPrep.snap;
      cleanup.actorIds.push(grantPrep.pcId);
      alicePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
      await joinAs(alicePage, "Alice");
      const granted = await alicePage.evaluate(async ({ pcUuid }) => {
        if (!game.user.hasPermission("ACTOR_CREATE")) {
          return { error: "Alice lacks ACTOR_CREATE — the widen never reached her client" };
        }
        const gen = await import("/systems/air-bladder/module/character-generator.js");
        const pc = await fromUuid(pcUuid);
        const made = await gen.grantContainers(pc, [{ name: "Rivertooth", slots: 6, grantSource: "question:9" }]);
        const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
        // Flag + emit -> the active GM's client answers. Poll for the SETTLED
        // shape, not for existence: existence is the path under test's OWN
        // client-side create.
        const deadline = Date.now() + 12000;
        let horse = null, synced = false;
        while (Date.now() < deadline) {
          horse = game.actors.find((a) => a.type === "npc" && a.name === "Rivertooth" && a.system.connectedTo === pcUuid);
          if (horse && horse.ownership.default === L.OBSERVER) { synced = true; break; }
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!horse) return { error: "no horse was created at all — did the ACTOR_CREATE path throw?" };
        return {
          horseId: horse.id,
          madeHere: made.length,
          synced,
          def: horse.ownership.default,
          aliceOwner: horse.ownership[game.user.id] === L.OWNER,
          flagCleared: horse.getFlag("air-bladder", "ownershipSyncPending") === undefined,
        };
      }, { pcUuid: grantPrep.pcUuid });
      if (granted.error) fail("player grant", granted.error);
      else {
        cleanup.actorIds.push(granted.horseId);
        granted.madeHere === 1
          ? ok("precondition: Alice's client minted directly", "(not the broker — made.length 1)")
          : fail(`made.length ${granted.madeHere} — this exercised the broker, not the ACTOR_CREATE path`);
        granted.synced
          ? ok("the GM answered the sync flag", "(default is OBSERVER)")
          : fail(`ownership default stayed ${granted.def}`, "no flag, no emit — the promised sync never happened (finding 1)");
        granted.aliceOwner ? ok("Alice owns her horse") : fail("Alice is not OWNER of the horse");
        granted.flagCleared ? ok("sync flag consumed, no residue") : fail("ownershipSyncPending still set");
      }
    }

    /* ---- 6. two GMs, one portrait scan -------------------------------------- */
    console.log("\nportrait-folder scan single-writer");

    await page.evaluate(async () => {
      let gm2 = game.users.getName("ZZ PROBE GM2");
      if (!gm2) gm2 = await User.create({ name: "ZZ PROBE GM2", role: CONST.USER_ROLES.GAMEMASTER });
    });
    cleanup.gm2Made = true;
    gm2Page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
    await joinAs(gm2Page, "ZZ PROBE GM2");

    const activeName = await page.evaluate(() => game.users.activeGM?.name ?? null);
    const idlePage = activeName === "ZZ PROBE GM2" ? page : gm2Page;
    for (const p of [page, gm2Page]) {
      await p.evaluate(() => {
        const orig = game.settings.set;
        globalThis.__b2SetSpy = { orig, count: 0 };
        game.settings.set = function (ns, key, ...rest) {
          if (ns === "air-bladder" && key === "custom-portrait-list") globalThis.__b2SetSpy.count++;
          return orig.call(this, ns, key, ...rest);
        };
      });
    }
    // The change comes from the NON-active GM: under the old code both clients
    // scan (the race); fixed, only the elected one does — and it is not the
    // one that clicked.
    cleanup.portraitDir = "zz-probe-b2-portraits";
    await idlePage.evaluate(async () => {
      await game.settings.set("air-bladder", "custom-portrait-folder", "zz-probe-b2-portraits");
    });
    await page.waitForTimeout(4000);
    const counts = [];
    for (const p of [page, gm2Page]) {
      counts.push(await p.evaluate(() => {
        const c = globalThis.__b2SetSpy.count;
        game.settings.set = globalThis.__b2SetSpy.orig;
        delete globalThis.__b2SetSpy;
        return c;
      }));
    }
    const total = counts[0] + counts[1];
    const activeIdx = activeName === "ZZ PROBE GM2" ? 1 : 0;
    total === 1
      ? ok("exactly one GM wrote the scanned list", `(${activeName})`)
      : fail(`${total} clients wrote custom-portrait-list`, "two GMs raced Setting.create (finding 6)");
    counts[activeIdx] === 1
      ? ok("and it was the ACTIVE GM", `counts gm1=${counts[0]} gm2=${counts[1]}`)
      : fail("the writer was not the elected activeGM", `counts gm1=${counts[0]} gm2=${counts[1]}`);
    // withSettings on the main page restores custom-portrait-folder (and the
    // list) after this block; the rescan that restore triggers targets the
    // ORIGINAL folder, so the probe directory stays deletable.
  });
} finally {
  // World state back the way it was, from Node, whatever happened above.
  try {
    if (gm2Page) await gm2Page.context().close();
    if (alicePage) await alicePage.context().close();
    await page.evaluate(async ({ actorIds, itemIds, messageIds, permSnap, packWasUnlocked, gm2Made }) => {
      for (const id of actorIds) await game.actors.get(id)?.delete();
      for (const id of itemIds) await game.items.get(id)?.delete();
      for (const id of messageIds) await game.messages.get(id)?.delete();
      if (permSnap && JSON.stringify(game.settings.get("core", "permissions")) !== permSnap) {
        await game.settings.set("core", "permissions", JSON.parse(permSnap));
      }
      if (packWasUnlocked) await game.packs.get("air-bladder.monsters")?.configure({ locked: false });
      if (gm2Made) await game.users.getName("ZZ PROBE GM2")?.delete();
    }, cleanup);
  } catch (e) {
    console.error(`  note  cleanup failed: ${e.message}`);
    failures++;
  }
  // The scan created an empty directory in the user's Foundry data — remove it.
  if (cleanup.portraitDir) {
    const dir = path.join("C:\\Users\\domin\\foundry\\data\\Data", cleanup.portraitDir);
    try { if (fs.existsSync(dir)) fs.rmdirSync(dir); } catch (e) {
      console.error(`  note  could not remove ${dir}: ${e.message}`);
    }
  }
}

if (errors.length) {
  console.error("\nconsole errors:");
  errors.slice(0, 15).forEach((e) => console.error("  " + e));
  failures++;
}
await browser.close();

console.log(failures ? "\nREVIEW BATCH 2 PROBE FAILED\n" : "\nreview batch 2 probe passed\n");
process.exit(failures ? 1 : 0);

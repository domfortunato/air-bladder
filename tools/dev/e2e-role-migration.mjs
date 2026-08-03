#!/usr/bin/env node
/**
 * The `role` re-stamp: a world upgraded from before the field must come out
 * stamped, a world upgraded across the HIRELING-ROLE COLLAPSE must come out
 * converted, and the Warden's later choices must never be re-stamped at all.
 *
 * `role` replaced `forHire` and `inanimate` (docs/npc-roles-plan.md). Then the
 * `hireling` role itself collapsed back into `npc` + `forHire` (2026-08-01,
 * NPC_ROLES). Two layers make old documents read correctly, and this probe
 * covers both:
 *
 *   - **The shim** (NpcData.migrateData) derives a role in memory from the
 *     legacy fields, AND converts a stored "hireling" to npc + forHire, on
 *     every load. Provable without persistence: CONSTRUCT an unsaved document
 *     and read what it derives. The conversion half is load-bearing in a way
 *     the derivation half never was — "hireling" is no longer in the enum, so
 *     without it every stored one fails validation.
 *   - **migrateNpcRoles** persists whatever the shim derived, on every npc-typed
 *     world actor, selecting on NOTHING.
 *
 * The blindness is the interesting part, and this probe is why it is blind.
 * Neither broken state can be seen from a client: `migrateData` rewrites
 * `_source` during construction, and `cleanData` PRUNES unknown keys out of it,
 * so a stored "hireling" and a stored `inanimate` are both invisible. The
 * previous version of this migration selected on `"inanimate" in _source.system`
 * and matched nothing, ever — and the previous version of this probe could not
 * tell, because it read `_source` too and read the same pruned object.
 *
 * So the seeding goes around the data model entirely, through the same socket
 * the database backend uses:
 * `SocketInterface.dispatch("modifyDocument", {action: "update", ...})` plants
 * the value the server will actually store — including a `-=role` deletion, for
 * a document that genuinely predates the field — and `{action: "get"}` reads the
 * RAW server record back. That is the only view of the database a client has,
 * and the only way this migration can be witnessed rather than assumed.
 *
 * This is the class of defect a fresh-world validation cannot see by
 * construction. It needs the real `ready`-hook path, so the probe RELOADS and
 * the migrations run exactly as they do for a user opening their world the
 * morning after an update.
 *
 * Usage: npm run dev:role-migration
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const HIRELING = "ZZ Role Hireling";
const RATED = "ZZ Role Rated NPC";
const MONSTER = "ZZ Role Monster";
const LEGACY = "ZZ Role Legacy NPC";
const PLANTED = "ZZ Role Planted Hireling";
const RATE = 5;

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(300000, "role migration probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const readAll = () => page.evaluate(({ h, r, m }) => {
  const pick = (a) => (a
    ? {
      stored: a._source.system.role, live: a.system.role, npcRole: a.npcRole,
      forHire: a.system.forHire, dayRate: a.system.dayRate, type: a.type,
    }
    : null);
  return { hireling: pick(game.actors.getName(h)), rated: pick(game.actors.getName(r)), monster: pick(game.actors.getName(m)) };
}, { h: HIRELING, r: RATED, m: MONSTER });

/**
 * The RAW server record's `system` — what the database holds, before any data
 * model touches it. The only view of the database a client has, and the only
 * way the states this probe plants can be seen at all.
 */
const rawSystem = (id) => page.evaluate(async (actorId) => {
  const res = await foundry.helpers.SocketInterface.dispatch("modifyDocument", {
    type: "Actor", action: "get", operation: { query: { _id__in: [actorId] }, broadcast: false },
  });
  return res?.result?.[0]?.system ?? null;
}, id);
const rawRole = async (id) => (await rawSystem(id))?.role ?? null;

let ids = null;

try {
  /* --- the shim, on unsaved documents ----------------------------------- */

  console.log("the migrateData shim: legacy fields, and the retired role");
  const shim = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const build = (system) => new Cls({ name: "ZZ Shim", type: "npc", system }).system;
    const derive = (system) => build(system).role;

    // The shim also runs over UPDATE DIFFS. Both halves of that are asserted:
    // what migrateData returns for a diff, and what an actual update does to a
    // stored role — the second is the one a Warden feels.
    const onDiff = CONFIG.Actor.dataModels.npc.migrateData({ containerClass: "pile" });
    const onRoleDiff = CONFIG.Actor.dataModels.npc.migrateData({ role: "hireling" });
    for (const a of game.actors.filter((x) => x.name?.startsWith("ZZ Shim Live"))) await a.delete();
    const crate = await Cls.create({
      name: "ZZ Shim Live Crate", type: "npc",
      system: { role: "container", containerClass: "crate" },
    });
    // EXACTLY the write `_setContainerArt` makes when a Warden picks a glyph
    // from the container gallery: the Kind, and nothing else.
    await crate.update({ "system.containerClass": "barrel" });
    const afterArtPick = crate.system.role;
    await crate.delete();

    // EXACTLY the write the npc sheet's "For hire" checkbox makes: one boolean,
    // no role beside it. `forHire` was a RETIRED key when the guard was written
    // and a live one a day later, so this diff used to derive — and a mount came
    // back a person (review #7, observed live before the fix).
    const mount = await Cls.create({
      name: "ZZ Shim Live Mount", type: "npc",
      system: { role: "mount", containerClass: "horse" },
    });
    await mount.update({ "system.forHire": false });
    const afterForHire = mount.system.role;
    await mount.delete();

    // forHire must no longer STEER the role: with a vehicle Kind and inanimate
    // beside it, the cart has to win. It used to return early and mask them.
    const hire = build({ forHire: true });
    const hireCart = build({ forHire: true, inanimate: true, containerClass: "cart" });
    const retired = build({ role: "hireling" });
    const retiredUnticked = build({ role: "hireling", forHire: false });
    return {
      forHire: hire.role,
      forHireKept: hire.forHire,
      forHireCart: hireCart.role,
      retired: { role: retired.role, forHire: retired.forHire },
      retiredUnticked: { role: retiredUnticked.role, forHire: retiredUnticked.forHire },
      cart: derive({ inanimate: true, containerClass: "cart" }),
      thing: derive({ inanimate: true }),
      classAlone: derive({ containerClass: "horse" }),
      plain: derive({}),
      plainForHire: build({}).forHire,
      diffKeys: Object.keys(onDiff),
      hireDiffKeys: Object.keys(CONFIG.Actor.dataModels.npc.migrateData({ forHire: false })),
      roleDiff: onRoleDiff,
      afterArtPick,
      afterForHire,
    };
  });
  // The collapse, first: this is the one holding the shrunk enum up.
  shim.retired.role === "npc" && shim.retired.forHire === true
    ? ok('a stored role "hireling" reads npc + forHire — the enum never sees it')
    : fail(`role "hireling" came back as ${JSON.stringify(shim.retired)}`);
  shim.retiredUnticked.forHire === false
    ? ok("...but an explicit forHire:false beside it is respected")
    : fail(`forHire:false was overwritten to ${JSON.stringify(shim.retiredUnticked.forHire)}`);
  shim.roleDiff?.role === "npc" && shim.roleDiff?.forHire === true
    ? ok("an attempted WRITE of the retired role converts too (migrateData over a diff)")
    : fail(`the diff came back ${JSON.stringify(shim.roleDiff)}`);
  shim.plainForHire === true
    ? ok("forHire initials to true, so an un-migrated npc reads as available")
    : fail(`forHire initialled to ${JSON.stringify(shim.plainForHire)} — every existing `
      + "hireling would come out of the collapse unavailable");

  shim.forHire === "npc" && shim.forHireKept === true
    ? ok("a source carrying only forHire reads npc (the initial), keeping the flag")
    : fail(`forHire:true came back ${JSON.stringify({ role: shim.forHire, forHire: shim.forHireKept })}`);
  // `forHire` is a LIVE field again since the hireling collapse, so it is not
  // evidence of a legacy source and must not arm the derivation. The two legs
  // are the same claim from both ends: the diff, and what a Warden feels.
  !shim.hireDiffKeys.includes("role")
    ? ok("migrateData over a forHire diff injects no role", `kept ${shim.hireDiffKeys.join(", ")}`)
    : fail("migrateData over a forHire diff injects no role", `it added: ${shim.hireDiffKeys.join(", ")}`);
  shim.afterForHire === "mount"
    ? ok("...so unticking For hire on a live mount leaves it a mount")
    : fail(`unticking For hire demoted the mount to ${JSON.stringify(shim.afterForHire)}`);
  shim.forHireCart === "transport"
    ? ok("...and it no longer STEERS the role — inanimate+cart still wins")
    : fail(`forHire masked a live inanimate signal: a cart derived ${JSON.stringify(shim.forHireCart)}`);
  shim.cart === "transport" && shim.thing === "container"
    ? ok("inanimate derives transport (vehicle class) / container (else)")
    : fail(`inanimate derived ${JSON.stringify({ cart: shim.cart, thing: shim.thing })}`);
  // A containerClass with NO retired key beside it is not evidence of a
  // pre-roles document — in an update diff it is just the field being written.
  // It used to derive (a mount class gave "mount"), and that clause is what made
  // the two failures below reachable.
  shim.classAlone === "npc"
    ? ok("a Kind alone does NOT derive — it is not evidence of a legacy source")
    : fail(`a Kind alone derived ${JSON.stringify(shim.classAlone)}`);
  shim.plain === "npc"
    ? ok("everything else derives npc")
    : fail(`plain derived ${JSON.stringify(shim.plain)}`);
  !shim.diffKeys.includes("role")
    ? ok("migrateData over a Kind diff injects no role", `kept ${shim.diffKeys.join(", ")}`)
    : fail("migrateData over a Kind diff injects no role", `it added: ${shim.diffKeys.join(", ")}`);
  shim.afterArtPick === "container"
    ? ok("picking container art leaves the role alone", "role container survived")
    : fail("picking container art leaves the role alone",
      `a crate became "${shim.afterArtPick}" because its Kind was written`);

  /* --- seed the pre-migration state ------------------------------------ */

  ids = await page.evaluate(async ({ h, r, m, l, p, rate }) => {
    // Stale first. A leftover already carrying a stored role would satisfy the
    // post-reload assertion without the migration running at all — the exact
    // shape of stale-precondition failure this suite has been bitten by before.
    for (const s of game.actors.filter((a) => [h, r, m, l, p].includes(a.name))) await s.delete();
    // "Pre-migration" includes the COMPLETION MARKERS being unset — both
    // migrations are one-shot and gated on their own.
    await game.settings.set("air-bladder", "roles-restamped", false);
    const Cls = CONFIG.Actor.documentClass;
    // `hireling` is still a registered alias, so a document of that type is
    // what an upgraded world actually holds.
    const hire = await Cls.create({
      name: h, type: "hireling",
      system: { dayRate: rate, profession: "Torchbearer" },
    });
    // The dev-build Roll-NPC case: an npc with a rate and nothing saying why.
    const rated = await Cls.create({ name: r, type: "npc", system: { dayRate: rate } });
    // A plain npc that must be LEFT a plain npc.
    const mon = await Cls.create({ name: m, type: "npc" });
    // Two documents that cannot be built through any document method, both
    // planted the same way: through the socket the database backend itself
    // uses. Every method runs `cleanData({migrate: true})`, which converts or
    // drops exactly the states being reconstructed here.
    const plant = (id, system) => foundry.helpers.SocketInterface.dispatch("modifyDocument", {
      type: "Actor", action: "update",
      operation: {
        updates: [{ _id: id, system }],
        diff: false, recursive: true, noHook: false, render: false, modifiedTime: Date.now(),
      },
    });

    // The legacy-key case: a genuine PRE-ROLES document — no `role` at all
    // (deleted with the server's own `-=` syntax), `inanimate` beside a vehicle
    // Kind. `inanimate` deliberately, not `forHire`: forHire is a schema field
    // again since the collapse, so cleanData fills it into every npc's _source
    // and its presence proves nothing. This must come out `transport`, never
    // the initial `npc`.
    //
    // The socket is needed because a create WRITE drops an unknown key — the
    // probe used to hedge on that with a read-back and skip the leg, which is
    // how migrateNpcRoles ended up with no live coverage at all.
    const legacy = await Cls.create({ name: l, type: "npc", system: { dayRate: rate } });
    await plant(legacy.id, { "-=role": null, inanimate: true, containerClass: "cart" });

    // The collapse case: a stored role that is no longer in the enum.
    const planted = await Cls.create({ name: p, type: "npc", system: { dayRate: rate, profession: "Barber" } });
    await plant(planted.id, { role: "hireling" });
    return {
      hire: hire.id, rated: rated.id, mon: mon.id, legacy: legacy.id, planted: planted.id,
      stored: [hire, rated, mon].map((a) => a._source.system.role),
    };
  }, { h: HIRELING, r: RATED, m: MONSTER, l: LEGACY, p: PLANTED, rate: RATE });

  if (ids.stored.every((s) => s === "npc")) {
    ok("seeded a hireling-type doc and two npcs, all presenting role npc");
  } else {
    fail(`seed failed — stored roles ${JSON.stringify(ids.stored)}; nothing below can be trusted`);
    throw new Error("preconditions failed — not reloading");
  }
  // Both plants, WITNESSED in the database. Without these the assertions below
  // could pass on documents that were never in the broken state — which is the
  // precondition failure this suite has been bitten by before.
  const legacyRaw = await rawSystem(ids.legacy);
  const legacyPlanted = legacyRaw?.role === undefined && legacyRaw?.inanimate === true;
  if (legacyPlanted) ok("planted a genuine PRE-ROLES document — no role in the database, inanimate beside a cart");
  else fail(`the legacy plant did not land — the database holds ${JSON.stringify({ role: legacyRaw?.role, inanimate: legacyRaw?.inanimate })}`);

  const plantedBefore = await rawRole(ids.planted);
  if (plantedBefore === "hireling") {
    ok('planted a genuine stored role "hireling" (raw server record, not _source)');
  } else {
    fail(`the plant did not land — the database holds ${JSON.stringify(plantedBefore)}. `
      + "The collapse assertions below would pass on a document that was already correct");
  }
  const plantedClientReads = await page.evaluate((id) => game.actors.get(id)?._source.system.role, ids.planted);
  plantedClientReads === "npc"
    ? ok("...and the client still reads npc, which is why the migration must be blind")
    : fail(`the client reads ${JSON.stringify(plantedClientReads)} from a planted hireling — `
      + "if it were observable the migration could select on it");

  /* --- run the real migrations ------------------------------------------ */

  console.log("\nreloading, so the ready-hook migration runs for real");
  // Watch for the migration's own log line. Without it the probe can only say
  // "something changed roles across a reload"; with it, the migration is named
  // as the writer.
  const migrationLog = [];
  page.on("console", (mm) => {
    if (/stamped role on \d+ npc\(s\)/.test(mm.text())) migrationLog.push(mm.text());
  });

  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(page);
  // The migrations are awaited phases inside the ready hook, not part of `ready`
  // itself, so `game.ready` can be true a beat before they have written.
  await page.waitForTimeout(3000);

  const after = await readAll();

  /* --- 1. the collapse: the planted document is converted IN THE DB ------ */

  const plantedAfter = await rawRole(ids.planted);
  if (plantedAfter === "npc") ok('the planted "hireling" is npc in the DATABASE now — the blind re-stamp landed');
  else fail(`the database still holds ${JSON.stringify(plantedAfter)} — the migration did not convert it`);

  if (migrationLog.length) ok(`the migration named itself as the writer — "${migrationLog[0]}"`);
  else fail("the stored role changed but the migration logged nothing — something else wrote it");

  const plantedShown = await page.evaluate((id) => {
    const a = game.actors.get(id);
    return { forHire: a?.system.forHire, dayRate: a?.system.dayRate, role: a?.system.role };
  }, ids.planted);
  plantedShown.forHire === true && plantedShown.dayRate === RATE
    ? ok(`it reads for hire at its old rate (${plantedShown.dayRate}) — nothing was lost in the conversion`)
    : fail(`the converted hireling reads ${JSON.stringify(plantedShown)}`);

  /* --- 2. the hireling-TYPE doc needs nothing, and shows its rate -------- */

  if (after.hireling?.stored === "npc" && after.hireling?.forHire === true) {
    ok("the pre-fold hireling reads role npc + for hire, needing no write at all");
  } else {
    fail(`the hireling is ${JSON.stringify(after.hireling)}`);
  }

  if (after.hireling?.dayRate === RATE) ok(`its day rate survived untouched (${after.hireling.dayRate})`);
  else fail(`its day rate changed: ${RATE} -> ${after.hireling?.dayRate}`);

  // The user-visible consequence, not just the stored field.
  const rowShown = await page.evaluate(async (name) => {
    const a = game.actors.getName(name);
    await a.sheet.render(true);
    await new Promise((rr) => setTimeout(rr, 800));
    const root = document.getElementById(a.sheet.id);
    const out = {
      present: !!root?.querySelector(".day-rate-line"),
      value: root?.querySelector(".day-rate-input")?.value,
      // `.for-hire-check`, which is what the template has always rendered.
      // This read said `.for-hire-input` — a class that has never existed in
      // any template — and both were written in the SAME commit (936215d), so
      // the box has been silently `undefined` and this assertion red since the
      // day it was added. The fourth pre-existing red probe found on this
      // branch; they are only ever found by grepping the SELECTOR, never by a
      // gate announcing itself.
      box: root?.querySelector(".for-hire-check")?.checked,
    };
    await a.sheet.close();
    return out;
  }, HIRELING);
  if (rowShown.present && rowShown.box === true) ok(`the sheet renders For Hire ticked and the day-rate row (showing ${rowShown.value})`);
  else fail(`the sheet shows ${JSON.stringify(rowShown)} — the row a hireling is FOR did not survive the collapse`);

  /* --- 3. the rate-without-a-reason npc, and the plain one --------------- */

  if (after.rated?.forHire === true && after.rated?.stored === "npc") {
    ok("an npc carrying a day rate reads for hire (the Roll-NPC case, now the initial)");
  } else {
    fail(`the rated npc is ${JSON.stringify(after.rated)}`);
  }
  if (after.monster?.stored === "npc") ok("a plain npc was left role npc");
  else fail(`the plain npc is ${JSON.stringify(after.monster)}`);

  /* --- 3b. the legacy-key npc: derived role persisted, key deleted -------- */

  if (legacyPlanted) {
    // Read from the DATABASE, not from _source: the whole point of the plant is
    // that the two disagree until the migration has run.
    const legacyAfter = await rawSystem(ids.legacy);
    const legacyLive = await page.evaluate((name) => {
      const a = game.actors.getName(name);
      return a ? { role: a.system.role, forHire: a.system.forHire } : null;
    }, LEGACY);
    if (legacyAfter?.role === "transport") ok("the pre-roles inanimate+cart npc is role transport in the database, not the initial npc");
    else fail(`the legacy npc's stored role is ${JSON.stringify(legacyAfter?.role)} — the derivation was not persisted`);
    // The retired key is deliberately LEFT. Deleting it would need a selection,
    // and a selection is what could not be made to work: `inanimate` is pruned
    // out of `_source`, so nothing on the client can tell which documents carry
    // it. With `role` now stored beside it, migrateData's guard never looks at
    // it again — so this asserts the state is INERT, not that it is clean.
    if (legacyAfter?.inanimate === true && legacyLive?.role === "transport") {
      ok("...with the retired inanimate key left where it lies, now inert beside a stored role");
    } else {
      fail(`the legacy state reads ${JSON.stringify({ stored: legacyAfter?.inanimate, live: legacyLive?.role })}`);
    }
    // `forHire` used to be deleted as retired alongside it. It is a real schema
    // field again, so deleting it would hand someone who had the box unticked
    // the initial `true`.
    if (legacyAfter?.forHire === true && legacyLive?.forHire === true) ok("...while forHire was KEPT — it is a schema field again, not a retired one");
    else fail(`forHire is ${JSON.stringify({ stored: legacyAfter?.forHire, live: legacyLive?.forHire })} — the migration deleted a field that now means something`);
  }

  /* --- 4. and the Warden's later choice STICKS --------------------------- */
  // The retired forHire migration once selected on the state it writes, so the
  // Warden's untick was re-ticked every load. Role is a pick-list with the same
  // exposure: change a stamped role, reload, and it must stay changed. The
  // collapse re-stamp is blind, so this is the assertion that stops it becoming
  // the same trap one commit later.

  console.log("\nre-roling the plain npc to Monster and unticking For Hire, then reloading again");
  await page.evaluate(async ({ m, p }) => {
    await game.actors.getName(m)?.update({ "system.role": "monster" });
    await game.actors.getName(p)?.update({ "system.forHire": false });
  }, { m: MONSTER, p: PLANTED });

  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(page);
  await page.waitForTimeout(3000);

  const finalState = await page.evaluate(({ m, p }) => ({
    role: game.actors.getName(m)?._source.system.role,
    forHire: game.actors.getName(p)?.system.forHire,
    marker: game.settings.get("air-bladder", "roles-restamped"),
  }), { m: MONSTER, p: PLANTED });

  if (finalState.role === "monster") ok("it is STILL a monster after a reload — the Warden's choice stuck");
  else fail(`the migration re-stamped it to ${JSON.stringify(finalState.role)} on reload`);
  if (finalState.forHire === false) ok("and For Hire is STILL unticked — the collapse did not re-tick it");
  else fail("the untick was reverted — the collapse re-stamped a field the Warden had changed");
  if (finalState.marker === true) ok("the completion marker is set, so the re-stamp is one-shot");
  else fail(`marker ${JSON.stringify(finalState)} — the migration will run again every load`);
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  if (ids) {
    await page.evaluate(async (all) => {
      for (const id of Object.values(all)) await game.actors.get(id)?.delete();
    }, { hire: ids.hire, rated: ids.rated, mon: ids.mon, legacy: ids.legacy, planted: ids.planted }).catch(() => {});
  }
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "ROLE MIGRATION PROBE FAILED" : "role migration probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

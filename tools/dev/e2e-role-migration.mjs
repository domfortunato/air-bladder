#!/usr/bin/env node
/**
 * The `role` migration: a world upgraded from before the role field must come
 * out stamped — hirelings as hirelings, with their day rate still on screen —
 * and the Warden's later choices must never be re-stamped.
 *
 * `role` replaced `forHire` and `inanimate` (docs/npc-roles-plan.md). Two layers
 * make old documents read correctly, and this probe covers both:
 *
 *   - **The shim** (NpcData.migrateData) derives a role in memory from the
 *     legacy fields on every load. Provable without persistence: CONSTRUCT an
 *     unsaved document carrying the old fields and read what it derives.
 *   - **The one-time stamp** (cairn.js migrateNpcRoles) persists the value on
 *     world actors and deletes the legacy keys. The shim cannot see the one
 *     thing the stamp can — a pre-fold `hireling`-TYPE document stores none of
 *     the legacy fields; only its type says what it is.
 *
 * Seeding the pre-migration state is deliberately awkward now, and one shape
 * of it is impossible: "role absent in the database" cannot even be OBSERVED
 * from a running client — cleanData fills the schema initial into `_source` on
 * construction — which is exactly why the migration selects on type, legacy
 * keys and day rate rather than on a missing role. So the probe seeds what an
 * upgraded world actually PRESENTS: a hireling-type doc reading role "npc" (a
 * post-create downgrade reconstructs it), an npc with a bare day rate, and an
 * npc created WITH the legacy `forHire` key, which cleaning preserves in
 * `_source` — whether it also survives the CREATE write is itself read back
 * and reported, never assumed.
 *
 * This is the class of defect a fresh-world validation cannot see by
 * construction. It needs the real `ready`-hook path, so the probe RELOADS and
 * the migration runs exactly as it does for a user opening their world the
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
const RATE = 5;

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(240000, "role migration probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const readAll = () => page.evaluate(({ h, r, m }) => {
  const pick = (a) => (a
    ? { stored: a._source.system.role, live: a.system.role, npcRole: a.npcRole, dayRate: a.system.dayRate, type: a.type }
    : null);
  return { hireling: pick(game.actors.getName(h)), rated: pick(game.actors.getName(r)), monster: pick(game.actors.getName(m)) };
}, { h: HIRELING, r: RATED, m: MONSTER });

let ids = null;

try {
  /* --- the shim, on unsaved documents ----------------------------------- */

  console.log("the migrateData shim derives a role from the legacy fields");
  const shim = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const derive = (system) => new Cls({ name: "ZZ Shim", type: "npc", system }).system.role;

    // The shim also runs over UPDATE DIFFS. Both halves of that are asserted:
    // what migrateData returns for a diff, and what an actual update does to a
    // stored role — the second is the one a Warden feels.
    const onDiff = CONFIG.Actor.dataModels.npc.migrateData({ containerClass: "pile" });
    for (const a of game.actors.filter((x) => x.name?.startsWith("ZZ Shim Live"))) await a.delete();
    const crate = await Cls.create({
      name: "ZZ Shim Live Crate", type: "npc",
      system: { role: "container", containerClass: "crate" },
    });
    // EXACTLY the write `_setContainerArt` makes when a Warden picks a glyph
    // from the container gallery: the variety, and nothing else.
    await crate.update({ "system.containerClass": "barrel" });
    const afterArtPick = crate.system.role;
    await crate.delete();

    return {
      forHire: derive({ forHire: true }),
      cart: derive({ inanimate: true, containerClass: "cart" }),
      thing: derive({ inanimate: true }),
      classAlone: derive({ containerClass: "horse" }),
      plain: derive({}),
      diffKeys: Object.keys(onDiff),
      afterArtPick,
    };
  });
  shim.forHire === "hireling"
    ? ok("forHire:true derives hireling")
    : fail(`forHire:true derived ${JSON.stringify(shim.forHire)}`);
  shim.cart === "transport" && shim.thing === "container"
    ? ok("inanimate derives transport (vehicle class) / container (else)")
    : fail(`inanimate derived ${JSON.stringify({ cart: shim.cart, thing: shim.thing })}`);
  // A containerClass with NO retired key beside it is not evidence of a
  // pre-roles document — in an update diff it is just the field being written.
  // It used to derive (a mount class gave "mount"), and that clause is what made
  // the two failures below reachable.
  shim.classAlone === "npc"
    ? ok("a variety alone does NOT derive — it is not evidence of a legacy source")
    : fail(`a variety alone derived ${JSON.stringify(shim.classAlone)}`);
  shim.plain === "npc"
    ? ok("everything else derives npc")
    : fail(`plain derived ${JSON.stringify(shim.plain)}`);
  !shim.diffKeys.includes("role")
    ? ok("migrateData over a diff injects no role", `kept ${shim.diffKeys.join(", ")}`)
    : fail("migrateData over a diff injects no role", `it added: ${shim.diffKeys.join(", ")}`);
  shim.afterArtPick === "container"
    ? ok("picking container art leaves the role alone", "role container survived")
    : fail("picking container art leaves the role alone",
      `a crate became "${shim.afterArtPick}" because its variety was written`);

  /* --- seed the pre-migration state ------------------------------------ */

  ids = await page.evaluate(async ({ h, r, m, l, rate }) => {
    // Stale first. A leftover already carrying a stored role would satisfy the
    // post-reload assertion without the migration running at all — the exact
    // shape of stale-precondition failure this suite has been bitten by before.
    for (const s of game.actors.filter((a) => [h, r, m, l].includes(a.name))) await s.delete();
    // "Pre-migration" includes the COMPLETION MARKER being unset — the
    // migration is one-shot and gated on it.
    await game.settings.set("air-bladder", "roles-migrated", false);
    const Cls = CONFIG.Actor.documentClass;
    // `hireling` is still a registered alias, so a document of that type is
    // what an upgraded world actually holds. _preCreate stamps NEW ones role
    // hireling, so the downgrade to "npc" reconstructs how a PRE-FOLD doc
    // presents: the initial filled in, nothing else saying hireling but the type.
    const hire = await Cls.create({
      name: h, type: "hireling",
      system: { dayRate: rate, profession: "Torchbearer" },
    });
    await hire.update({ "system.role": "npc" });
    // The dev-build Roll-NPC case: an npc with a rate and nothing saying why.
    const rated = await Cls.create({ name: r, type: "npc", system: { dayRate: rate } });
    // A plain npc that must be LEFT a plain npc.
    const mon = await Cls.create({ name: m, type: "npc" });
    // And the legacy-key case: created WITH forHire, which migrateData reads
    // (deriving hireling) and cleaning does not strip. Whether the CREATE
    // write persisted the unknown key is read back, not assumed.
    const legacy = await Cls.create({ name: l, type: "npc", system: { forHire: true, dayRate: rate } });
    return {
      hire: hire.id, rated: rated.id, mon: mon.id, legacy: legacy.id,
      stored: [hire, rated, mon].map((a) => a._source.system.role),
      legacyKeyHeld: "forHire" in legacy._source.system,
      legacyRole: legacy._source.system.role,
    };
  }, { h: HIRELING, r: RATED, m: MONSTER, l: LEGACY, rate: RATE });

  if (ids.stored.every((s) => s === "npc")) {
    ok("seeded a hireling-type doc and two npcs, all presenting role npc");
  } else {
    fail(`seed failed — stored roles ${JSON.stringify(ids.stored)}; nothing below can be trusted`);
    throw new Error("preconditions failed — not reloading");
  }
  if (ids.legacyKeyHeld) ok(`the legacy forHire key survived into _source (stored role ${JSON.stringify(ids.legacyRole)})`);
  else console.log("  note  the create write dropped the legacy forHire key — the deletion leg is skipped, the shim leg above still covers derivation");

  /* --- run the real migration ------------------------------------------ */

  console.log("\nreloading, so the ready-hook migration runs for real");
  // Watch for the migration's own log line. Without it the probe can only say
  // "something stamped roles across a reload"; with it, the migration is named
  // as the writer.
  const migrationLog = [];
  page.on("console", (mm) => {
    if (/stamped role on \d+ npc\(s\)/.test(mm.text())) migrationLog.push(mm.text());
  });

  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(page);
  // The migration is an awaited phase inside the ready hook, not part of `ready`
  // itself, so `game.ready` can be true a beat before it has written.
  await page.waitForTimeout(3000);

  const after = await readAll();

  /* --- 1. the hireling-type doc is stamped, rate intact ------------------ */

  if (after.hireling?.stored === "hireling") ok("the pre-fold hireling came out stamped role: hireling");
  else fail(`the hireling is ${JSON.stringify(after.hireling)} — the migration did not run or did not match it`);

  if (migrationLog.length) ok(`the migration named itself as the writer — "${migrationLog[0]}"`);
  else fail("roles changed but the migration logged nothing — something else wrote them");

  if (after.hireling?.dayRate === RATE) ok(`its day rate survived untouched (${after.hireling.dayRate})`);
  else fail(`its day rate changed: ${RATE} -> ${after.hireling?.dayRate}`);

  // The user-visible consequence, not just the stored field.
  const rowShown = await page.evaluate(async (name) => {
    const a = game.actors.getName(name);
    await a.sheet.render(true);
    await new Promise((rr) => setTimeout(rr, 800));
    const root = document.getElementById(a.sheet.id);
    const out = { present: !!root?.querySelector(".day-rate-line"), value: root?.querySelector(".day-rate-input")?.value };
    await a.sheet.close();
    return out;
  }, HIRELING);
  if (rowShown.present) ok(`the sheet renders the day-rate row (showing ${rowShown.value})`);
  else fail("the sheet hides the day-rate row — the role landed but the row did not");

  /* --- 2. the rate-without-a-reason npc, and the plain one --------------- */

  if (after.rated?.stored === "hireling") ok("an npc carrying a day rate came out hireling (the Roll-NPC case)");
  else fail(`the rated npc is ${JSON.stringify(after.rated)}`);
  if (after.monster?.stored === "npc") ok("a plain npc was left role npc, not hireling");
  else fail(`the plain npc is ${JSON.stringify(after.monster)} — `
    + "an over-broad migration would grow day-rate rows across the bestiary");

  /* --- 2b. the legacy-key npc: derived role persisted, key deleted -------- */

  if (ids.legacyKeyHeld) {
    const legacyAfter = await page.evaluate((name) => {
      const a = game.actors.getName(name);
      return a ? { stored: a._source.system.role, keyGone: !("forHire" in a._source.system) } : null;
    }, LEGACY);
    if (legacyAfter?.stored === "hireling") ok("the legacy forHire npc came out stamped hireling");
    else fail(`the legacy npc is ${JSON.stringify(legacyAfter)}`);
    if (legacyAfter?.keyGone) ok("...and the forHire key was deleted from its source");
    else fail("the forHire key is still in _source — the migration did not clean the legacy state");
  }

  /* --- 3. and the Warden's later choice STICKS --------------------------- */
  // The retired forHire migration once selected on the state it writes, so the
  // Warden's untick was re-ticked every load. Role is a pick-list with the same
  // exposure: change a stamped role, reload, and it must stay changed.

  console.log("\nre-roling the plain npc to Monster, then reloading again");
  await page.evaluate(async (name) => {
    await game.actors.getName(name)?.update({ "system.role": "monster" });
  }, MONSTER);

  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(page);
  await page.waitForTimeout(3000);

  const finalState = await page.evaluate((name) => ({
    role: game.actors.getName(name)?._source.system.role,
    marker: game.settings.get("air-bladder", "roles-migrated"),
  }), MONSTER);

  if (finalState.role === "monster") ok("it is STILL a monster after a reload — the Warden's choice stuck");
  else fail(`the migration re-stamped it to ${JSON.stringify(finalState.role)} on reload`);
  if (finalState.marker === true) ok("the completion marker is set, so the migration is one-shot");
  else fail("the completion marker is not set — the migration will run again every load");
} catch (e) {
  fail(`threw: ${e.message}`);
} finally {
  if (ids) {
    await page.evaluate(async ({ hire, rated, mon, legacy }) => {
      await game.actors.get(hire)?.delete();
      await game.actors.get(rated)?.delete();
      await game.actors.get(mon)?.delete();
      await game.actors.get(legacy)?.delete();
    }, ids).catch(() => {});
  }
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "ROLE MIGRATION PROBE FAILED" : "role migration probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

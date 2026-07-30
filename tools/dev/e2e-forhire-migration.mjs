#!/usr/bin/env node
/**
 * The `forHire` migration: a hireling upgraded from 0.1.7 must keep its day rate
 * on screen.
 *
 * `forHire` arrived with the Hireling->NPC fold, gating the day-rate row, and
 * defaults `false`. Nothing writes it except hireling CREATION — so on upgrade
 * every hireling already in the world initialised `false` and its stored
 * `system.dayRate` silently stopped rendering. Nothing was lost (the value sits in
 * `_source`) and nothing errored; the sheet just quietly dropped a row.
 *
 * This is the class of defect a fresh-world validation cannot see by construction:
 * a fresh world has no pre-migration documents. It needs the real `ready`-hook path,
 * so the probe seeds a pre-migration actor and RELOADS — the migration then runs
 * exactly as it does for a user opening their world the morning after an update.
 *
 * Two assertions, and the second is why this is not one line:
 *
 *   1. a hireling carrying a day rate comes out flagged, rate intact, and its sheet
 *      shows the day-rate row;
 *   2. a plain monster does NOT — the migration must not put a day rate on every
 *      wolf in the bestiary. An over-broad migration passes (1) perfectly.
 *
 * Usage: npm run dev:forhire
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const HIRELING = "ZZ ForHire Hireling";
const MONSTER = "ZZ ForHire Monster";
const RATE = 5;

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(240000, "forHire migration probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

const readBoth = () => page.evaluate(({ h, m }) => {
  const pick = (a) => (a ? { forHire: a.system.forHire, dayRate: a.system.dayRate, type: a.type } : null);
  return { hireling: pick(game.actors.getName(h)), monster: pick(game.actors.getName(m)) };
}, { h: HIRELING, m: MONSTER });

let ids = null;

try {
  /* --- seed the pre-migration state ------------------------------------ */

  ids = await page.evaluate(async ({ h, m, rate }) => {
    // Stale first. A leftover already carrying forHire:true would satisfy the
    // post-reload assertion without the migration running at all — the exact
    // shape of stale-precondition failure this suite has been bitten by before.
    for (const s of game.actors.filter((a) => a.name === h || a.name === m)) await s.delete();
    // "Pre-migration" now includes the COMPLETION MARKER being unset — the migration
    // is one-shot and gated on it. Clearing it here is what makes this world look
    // like one that has not been upgraded yet; without this the probe would seed a
    // hireling the migration is (correctly) never going to look at again.
    await game.settings.set("air-bladder", "forhire-migrated", false);
    const Cls = CONFIG.Actor.documentClass;
    // `hireling` is still a registered alias of the NPC model, so a document of
    // that type is what an upgraded world actually holds.
    const hire = await Cls.create({
      name: h, type: "hireling",
      system: { forHire: false, dayRate: rate, profession: "Torchbearer" },
    });
    const mon = await Cls.create({
      name: m, type: "npc",
      system: { forHire: false, dayRate: 0 },
    });
    return { hire: hire.id, mon: mon.id };
  }, { h: HIRELING, m: MONSTER, rate: RATE });

  const before = await readBoth();
  if (before.hireling?.forHire !== false || before.hireling?.dayRate !== RATE) {
    fail(`precondition not met — seeded hireling is ${JSON.stringify(before.hireling)}, `
      + `wanted forHire:false with dayRate ${RATE}`);
  } else {
    ok(`seeded a pre-migration hireling (type ${before.hireling.type}, `
      + `forHire ${before.hireling.forHire}, dayRate ${before.hireling.dayRate})`);
  }
  if (before.monster?.forHire === false) ok("seeded a plain monster (forHire false, no day rate)");
  else fail(`seeded monster is ${JSON.stringify(before.monster)}`);

  if (failed) throw new Error("preconditions failed — not reloading");

  /* --- run the real migration ------------------------------------------ */

  console.log("\nreloading, so the ready-hook migration runs for real");
  // Watch for the migration's own log line. Without it the probe can only say
  // "something flipped the flag across a reload"; with it, the migration is named
  // as the writer. It is also the built-in negative control: the same actor is
  // measured before the reload (flag false — i.e. the world as it is WITHOUT the
  // migration) and after, and nothing else in the reload writes this field.
  const migrationLog = [];
  page.on("console", (m) => {
    if (/marked \d+ hireling\(s\) as for hire/.test(m.text())) migrationLog.push(m.text());
  });

  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(page);
  // The migration is an awaited phase inside the ready hook, not part of `ready`
  // itself, so `game.ready` can be true a beat before it has written.
  await page.waitForTimeout(3000);

  const after = await readBoth();

  /* --- 1. the hireling keeps its rate ---------------------------------- */

  if (after.hireling?.forHire === true) ok("the hireling came out flagged for hire");
  else fail(`the hireling is still ${JSON.stringify(after.hireling)} — the migration did not run or did not match it`);

  if (migrationLog.length) ok(`the migration named itself as the writer — "${migrationLog[0]}"`);
  else fail("the flag changed but the migration logged nothing — something else wrote it");

  if (after.hireling?.dayRate === RATE) ok(`its day rate survived untouched (${after.hireling.dayRate})`);
  else fail(`its day rate changed: ${RATE} -> ${after.hireling?.dayRate}`);

  // The user-visible consequence, not just the stored flag.
  const rowShown = await page.evaluate(async (name) => {
    const a = game.actors.getName(name);
    await a.sheet.render(true);
    await new Promise((r) => setTimeout(r, 800));
    const root = document.getElementById(a.sheet.id);
    return { present: !!root?.querySelector(".day-rate-line"), value: root?.querySelector(".day-rate-input")?.value };
  }, HIRELING);
  if (rowShown.present) ok(`the sheet renders the day-rate row (showing ${rowShown.value})`);
  else fail("the sheet still hides the day-rate row — the flag flipped but the row did not come back");

  /* --- 2. the monster is left alone ------------------------------------ */

  if (after.monster?.forHire === false) ok("the plain monster was left alone (still not for hire)");
  else fail(`the migration flipped a plain monster to ${JSON.stringify(after.monster)} — `
    + "every wolf in the bestiary would grow a day-rate row");

  /* --- 3. and the Warden can turn it back OFF --------------------------- */
  // The migration used to select on the state it writes, under a comment claiming
  // that made it idempotent. It does for its three siblings, whose "before" value is
  // unreachable once migrated; it does not here, because `forHire` is a CHECKBOX and
  // `dayRate` is not cleared when it is unticked. So the actor fell straight back
  // into the selection set and the next load re-ticked it — for every pre-fold
  // hireling, i.e. the entire population the migration exists for, "For hire" could
  // not be switched off at all. Unticked through the real sheet, not by writing the
  // field, because the checkbox is the thing that puts it back in scope.

  console.log("\nunticking For hire, then reloading again");
  const unticked = await page.evaluate(async (name) => {
    const a = game.actors.getName(name);
    await a.sheet.render(true);
    await new Promise((r) => setTimeout(r, 800));
    const box = a.sheet.element?.querySelector('input[name="system.forHire"]');
    if (!box) return { boxFound: false };
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 900));
    await a.sheet.close();
    return { boxFound: true, forHire: a.system.forHire, dayRate: a.system.dayRate };
  }, HIRELING);

  if (!unticked.boxFound) {
    fail("no For hire checkbox on the sheet — cannot test whether unticking sticks");
  } else if (unticked.forHire !== false) {
    fail(`unticking did not even persist: ${JSON.stringify(unticked)}`);
  } else {
    ok("unticked through the sheet and it persisted");
    // The precondition that makes the assertion mean something: the actor must
    // still LOOK migratable, or "it stayed off" proves only that it fell out of
    // scope. dayRate is deliberately left intact, which is what keeps it in scope.
    if (unticked.dayRate === RATE) ok(`its day rate is still ${RATE} — still matches the old predicate`);
    else fail(`its day rate changed to ${unticked.dayRate}, so it no longer matches the predicate `
      + "and the assertion below would pass for the wrong reason");

    await page.reload({ waitUntil: "networkidle", timeout: 60000 });
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
    await dismissChrome(page);
    await page.waitForTimeout(3000);

    const finalState = await page.evaluate((name) => ({
      forHire: game.actors.getName(name)?.system.forHire,
      marker: game.settings.get("air-bladder", "forhire-migrated"),
    }), HIRELING);

    if (finalState.forHire === false) ok("it is STILL off after a reload — the Warden's choice stuck");
    else fail("the migration re-ticked For hire on reload — the Warden cannot turn it off");
    if (finalState.marker === true) ok("the completion marker is set, so the migration is one-shot");
    else fail("the completion marker is not set — the migration will run again every load");
  }
} finally {
  if (ids) {
    await page.evaluate(async ({ hire, mon }) => {
      await game.actors.get(hire)?.delete();
      await game.actors.get(mon)?.delete();
    }, ids).catch(() => {});
  }
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "FORHIRE MIGRATION PROBE FAILED" : "forHire migration probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

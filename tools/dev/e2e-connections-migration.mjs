#!/usr/bin/env node
/**
 * Phase B of the connections redesign: `flattenConnections` (2026-08-01),
 * marker `connections-migrated`.
 *
 * A world built under Round 2 can hold npc → npc chains; the flat rule says
 * every `connectedTo` points at a character. The migration walks each chain
 * up with a seen-set and, in ONE batched update: re-points a chain that roots
 * in a character; unlinks (and stamps `formerlyBelongedTo`) a chain that
 * roots in an npc, dangles, or cycles; writes the CONNECTED ownership shape
 * from the FINAL keeper; and raises an unconnected non-monster's stored
 * default from NONE to LIMITED — never lowering anything, never touching a
 * monster.
 *
 * Every branch is seeded HERE, through creation data and raw updates (nothing
 * in a fresh dev world exercises them), the marker is cleared, and the GM
 * client reloaded so the real ready-hook path runs. Witnesses that make the
 * greens believable: the monster is the EXCLUSION witness (same seeded shape
 * as the npc beside it, untouched where the npc moves), the raised-OBSERVER
 * npc is the NEVER-DOWNGRADE witness, and a second reload must write NOTHING
 * (modifiedTime delta over every seeded document — the marker is what makes
 * a migration a migration and not a re-enforcement sweep).
 *
 * Usage: npm run dev:connections-migration
 */
import { chromium } from "playwright";
import { VIEWPORT, dismissChrome, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(50)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(50)} ${detail}`); failures++; };
let failures = 0;

const browser = await chromium.launch();
watchdog(420000, "dev:connections-migration");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

/* ---- seed every branch, then clear the marker ----------------------------- */

const seeded = await page.evaluate(async () => {
  const Cls = CONFIG.Actor.documentClass;
  for (const a of game.actors.filter((x) => x.name.startsWith("ZZ Mig"))) await a.delete();

  let alice = game.users.getName("Alice");
  if (!alice) alice = await User.create({ name: "Alice", role: CONST.USER_ROLES.PLAYER });
  let bob = game.users.getName("Bob");
  if (!bob) bob = await User.create({ name: "Bob", role: CONST.USER_ROLES.PLAYER });
  const sackSys = { role: "container", containerClass: "sack", hp: { value: 0, max: 0 }, generationEnabled: false };
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;

  const pc = await Cls.create({
    name: "ZZ Mig PC", type: "character",
    ownership: { default: 0, [alice.id]: L.OWNER },
  });
  // The Round-2 chain: PC ← person ← sack. The sack must be RE-POINTED.
  const mid = await Cls.create({ name: "ZZ Mig Mid", type: "npc", ownership: { default: 0 }, system: { role: "npc", connectedTo: pc.uuid } });
  const deep = await Cls.create({ name: "ZZ Mig Deep", type: "npc", ownership: { default: 0 }, system: { ...sackSys, connectedTo: mid.uuid } });
  // An npc-rooted chain: unlink + stamp.
  const rootNpc = await Cls.create({ name: "ZZ Mig Root", type: "npc", ownership: { default: 0 }, system: { role: "npc" } });
  const orphan = await Cls.create({ name: "ZZ Mig Orphan", type: "npc", ownership: { default: 0 }, system: { ...sackSys, connectedTo: rootNpc.uuid } });
  // A dangling uuid: unlink, and the STORED formerly survives — a dead uuid
  // preserves nothing worth overwriting it with.
  const dangling = await Cls.create({
    name: "ZZ Mig Dangling", type: "npc", ownership: { default: 0 },
    system: { ...sackSys, connectedTo: "Actor.deadbeefdeadbeef", formerlyBelongedTo: "ZZ Ghost" },
  });
  // A cycle, seeded with a RAW update (connectActor refuses; stored data
  // cannot): both ends come out unlinked.
  const cycA = await Cls.create({ name: "ZZ Mig Cycle A", type: "npc", ownership: { default: 0 }, system: { role: "npc" } });
  const cycB = await Cls.create({ name: "ZZ Mig Cycle B", type: "npc", ownership: { default: 0 }, system: { role: "npc", connectedTo: cycA.uuid } });
  await cycA.update({ "system.connectedTo": cycB.uuid });
  // Unconnected NONE npc → LIMITED; NONE monster → untouched (the exclusion
  // witness — identical seeded shape, different role, only one may move);
  // raised OBSERVER npc → untouched (the never-downgrade witness).
  const noneNpc = await Cls.create({ name: "ZZ Mig NoneNpc", type: "npc", ownership: { default: 0 }, system: { role: "npc" } });
  const noneMonster = await Cls.create({ name: "ZZ Mig Monster", type: "npc", ownership: { default: 0 }, system: { role: "monster" } });
  const raised = await Cls.create({ name: "ZZ Mig Raised", type: "npc", ownership: { default: L.OBSERVER }, system: { role: "npc" } });
  // A connected mount wearing junk: the shape must REPLACE, not merge — the
  // sub-OWNER stray is exactly what a plain object update would leave behind.
  const mount = await Cls.create({
    name: "ZZ Mig Mount", type: "npc",
    ownership: { default: 0, [bob.id]: L.LIMITED },
    system: { role: "mount", containerClass: "horse", connectedTo: pc.uuid },
  });

  const was = game.settings.get("air-bladder", "connections-migrated");
  await game.settings.set("air-bladder", "connections-migrated", false);
  return {
    markerWas: was,
    aliceId: alice.id, bobId: bob.id,
    ids: {
      pc: pc.id, mid: mid.id, deep: deep.id, rootNpc: rootNpc.id, orphan: orphan.id,
      dangling: dangling.id, cycA: cycA.id, cycB: cycB.id,
      noneNpc: noneNpc.id, noneMonster: noneMonster.id, raised: raised.id, mount: mount.id,
    },
    pcUuid: pc.uuid,
  };
});
ok(`seeded 12 actors across every branch (marker was ${seeded.markerWas})`);

/* ---- reload: the real ready-hook path runs the migration ------------------- */

await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
await dismissChrome(page);
await page.waitForFunction(
  () => game.settings.get("air-bladder", "connections-migrated") === true,
  null, { timeout: 30000 }
).catch(() => {});

const after = await page.evaluate(async ({ ids, aliceId, bobId, pcUuid }) => {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const read = (id) => {
    const a = game.actors.get(id);
    return a ? {
      link: a.system.connectedTo || "",
      formerly: a.system.formerlyBelongedTo || "",
      own: { ...a.ownership },
      time: a._stats.modifiedTime,
    } : null;
  };
  const shapeExact = (own) => own.default === L.OBSERVER
    && own[aliceId] === L.OWNER
    && Object.keys(own).every((id) => id === "default" || id === aliceId || game.users.get(id)?.isGM);
  const out = {};
  for (const [k, id] of Object.entries(ids)) out[k] = read(id);
  out.marker = game.settings.get("air-bladder", "connections-migrated");
  out.deepShapeExact = shapeExact(out.deep.own);
  out.midShapeExact = shapeExact(out.mid.own);
  out.mountShapeExact = shapeExact(out.mount.own) && out.mount.own[bobId] === undefined;
  out.pcUuid = pcUuid;
  return out;
}, seeded);

console.log("\nthe flatten");
after.deep.link === after.pcUuid
  ? ok("a chain rooting in a PC is RE-POINTED", "the sack belongs to the hireling's character")
  : fail("a chain rooting in a PC is RE-POINTED", JSON.stringify(after.deep));
after.mid.link === after.pcUuid
  ? ok("an already-flat link is kept", "PC ← person untouched")
  : fail("an already-flat link is kept", JSON.stringify(after.mid));
after.orphan.link === "" && after.orphan.formerly === "ZZ Mig Root"
  ? ok("an npc-rooted chain is unlinked + stamped", `formerly "${after.orphan.formerly}"`)
  : fail("an npc-rooted chain is unlinked + stamped", JSON.stringify(after.orphan));
after.dangling.link === "" && after.dangling.formerly === "ZZ Ghost"
  ? ok("a dangling link is cleared, stored formerly KEPT", `"${after.dangling.formerly}"`)
  : fail("a dangling link is cleared, stored formerly KEPT", JSON.stringify(after.dangling));
after.cycA.link === "" && after.cycB.link === ""
  ? ok("a cycle is broken at both ends", "A→B→A comes out rootless, not hung")
  : fail("a cycle is broken at both ends", JSON.stringify({ a: after.cycA, b: after.cycB }));

console.log("\nthe ownership pass, and its two witnesses");
after.deepShapeExact && after.midShapeExact
  ? ok("connected npcs wear the EXACT shape of their FINAL keeper", "default OBSERVER + Alice OWNER")
  : fail("connected npcs wear the EXACT shape of their FINAL keeper", JSON.stringify({ deep: after.deep.own, mid: after.mid.own }));
after.mountShapeExact
  ? ok("junk entries are REPLACED away, not merged over", "Bob's stray LIMITED is gone")
  : fail("junk entries are REPLACED away, not merged over", JSON.stringify(after.mount.own));
after.noneNpc.own.default === 1 && after.rootNpc.own.default === 1
  && after.orphan.own.default === 1 && after.dangling.own.default === 1
  ? ok("unconnected NONE npcs are raised to LIMITED", "including the ones this migration just unlinked")
  : fail("unconnected NONE npcs are raised to LIMITED",
    JSON.stringify({ none: after.noneNpc.own, root: after.rootNpc.own, orphan: after.orphan.own, dangling: after.dangling.own }));
after.noneMonster.own.default === 0
  ? ok("   the monster beside them is UNTOUCHED", "the exclusion's fail-witness: same seed, different role")
  : fail("   the monster beside them is UNTOUCHED", JSON.stringify(after.noneMonster.own));
after.raised.own.default === 2
  ? ok("   a raised default is NEVER lowered", "the Warden's OBSERVER grant survives")
  : fail("   a raised default is NEVER lowered", JSON.stringify(after.raised.own));
after.marker === true
  ? ok("the marker is set after success")
  : fail("the marker is set after success", `marker=${after.marker}`);

/* ---- second reload writes NOTHING ------------------------------------------ */

console.log("\nthe marker holds: a second reload writes nothing");
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
await dismissChrome(page);
await page.waitForTimeout(4000);

const second = await page.evaluate(async ({ ids }) => {
  const out = {};
  for (const [k, id] of Object.entries(ids)) out[k] = game.actors.get(id)?._stats.modifiedTime ?? null;
  return out;
}, seeded);
const moved = Object.entries(second).filter(([k, t]) => t !== after[k]?.time);
moved.length === 0
  ? ok("every seeded document's modifiedTime is unmoved", `${Object.keys(second).length} checked`)
  : fail("every seeded document's modifiedTime is unmoved", JSON.stringify(moved));

/* ---- cleanup ---------------------------------------------------------------- */

await page.evaluate(async () => {
  for (const a of game.actors.filter((x) => x.name.startsWith("ZZ Mig"))) await a.delete();
  // The marker must be left TRUE — a probe that leaves it false makes the
  // NEXT GM load re-run the migration over the user's world.
  if (game.settings.get("air-bladder", "connections-migrated") !== true) {
    await game.settings.set("air-bladder", "connections-migrated", true);
  }
});

if (errors.length) {
  console.error("\nconsole errors:");
  errors.slice(0, 15).forEach((e) => console.error("  " + e));
  failures++;
}
await browser.close();

console.log(failures ? "\nCONNECTIONS MIGRATION PROBE FAILED\n" : "\nconnections migration probe passed\n");
process.exit(failures ? 1 : 0);

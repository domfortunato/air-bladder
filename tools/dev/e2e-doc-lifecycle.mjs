#!/usr/bin/env node
/**
 * Document-lifecycle probe: the two ways a batch operation can lie to the rest
 * of the world, both from review #2's tail.
 *
 * 1. REGENERATION MUST FIRE createItem HOOKS. `updateActorWithCharacter` and
 *    `regenerateHireling` used to write the new inventory as `items` inside
 *    `actor.update(...)`, which creates the embedded documents server-side and
 *    fires not one createItem hook — anything listening (a module, a world
 *    script) saw an actor whose inventory changed with no item ever created.
 *    `changeBackground` used `createEmbeddedDocuments` all along; now all three
 *    do. The mechanism control below RUNS the abandoned route and asserts it
 *    really is hook-silent, so the counting assertions are proven able to read 0.
 *
 * 2. DELETING A KEEPER MUST UNLINK ITS CHILDREN BEFORE THE DELETE RESOLVES.
 *    `_onDeleteOperation` is awaited by the delete workflow
 *    (client-backend.mjs:478); a per-document `_onDelete` is NOT
 *    (client-backend.mjs:472). So the same work in the wrong hook leaves a
 *    caller that awaits `deleteDocuments` reading a child that still points at
 *    a corpse. The negative control reconstructs the old shape in-page —
 *    operation hook swapped to the base class's, the walk moved to a
 *    `_onDelete` prototype shim — and must see the child still linked at the
 *    moment the delete resolves. If it cannot, the fix is not proven
 *    load-bearing and the probe says so rather than passing.
 *
 *    This leg used to test the same guarantee about a different write: pruning
 *    the deleted container's uuid out of the KEEPER's `system.containers`
 *    array, where the unawaited per-document shape lost a read-modify-write
 *    race with itself and re-dangled the other container's uuid permanently.
 *    That array — and the `container` type that was the other half of it — was
 *    retired on 2026-07-31, so the race is now unreachable by construction and
 *    the surviving batch write is the child-side unlink.
 *
 * Usage: npm run dev:doc-lifecycle
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const stage = (name) => console.log(`  stage ${name}`);

const browser = await chromium.launch();
watchdog(240000, "doc-lifecycle probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

// Stale state must not be able to satisfy a precondition: sweep by name BEFORE
// the assertions as well as after. Node-side, so a throw in an evaluate cannot
// skip it.
const sweepLitter = async () => {
  const swept = await page.evaluate(async () => {
    const names = [];
    const litter = game.actors.filter((x) => x.name?.startsWith("ZZ Lifecycle"));
    // A rolled background can grant connected containers with PLAIN names
    // (a "Mule"), so sweeping by our prefix alone would strand them. Take a
    // litter actor's kept containers with it, containers first.
    const uuids = new Set(litter.map((a) => a.uuid));
    for (const c of game.actors.filter((x) => uuids.has(x.system?.connectedTo))) {
      names.push(`${c.name} (kept by litter)`);
      await c.delete();
    }
    for (const a of litter) {
      if (!game.actors.get(a.id)) continue;
      names.push(a.name);
      await a.delete();
    }
    return names;
  });
  if (swept.length) console.log(`  note  swept litter: ${swept.join(", ")}`);
};

try {
  await sweepLitter();

  stage("character regenerate fires createItem hooks");
  const charRegen = await page.evaluate(async () => {
    const cg = game.cairn.characterGenerator;
    // Source passed explicitly: a bare generateCharacter() falls through to the
    // content-source dialog and hangs a headless page forever.
    const actor = await cg.createActorWithCharacter(await cg.generateCharacter(null, "2e"));
    await actor.update({ name: "ZZ Lifecycle Char" });
    let hooks = 0;
    const hid = Hooks.on("createItem", (doc) => { if (doc.parent === actor) hooks++; });
    await cg.regenerateActor(actor);
    Hooks.off("createItem", hid);
    // Regeneration RENAMES the actor to a freshly rolled name, which put it
    // outside the by-name sweep — the first run of this probe leaked a
    // random-named character into the dev world that way. Rename it back so
    // the litter stays findable no matter where a later stage throws.
    await actor.update({ name: "ZZ Lifecycle Char" });
    return { hooks, items: actor.items.size, id: actor.id };
  });

  stage("mechanism control: the update({items}) route is hook-silent");
  const updateRoute = await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const before = actor.items.size;
    let hooks = 0;
    const hid = Hooks.on("createItem", (doc) => { if (doc.parent === actor) hooks++; });
    await actor.update({ items: [{ name: "ZZ Lifecycle Update-Route", type: "item" }] });
    Hooks.off("createItem", hid);
    return { hooks, created: actor.items.size - before };
  }, charRegen.id);

  stage("hireling regenerate fires createItem hooks");
  const hirelingRegen = await page.evaluate(async () => {
    const cg = game.cairn.characterGenerator;
    const h = await cg.createHireling();
    await h.update({ name: "ZZ Lifecycle Hireling" });
    let hooks = 0;
    const hid = Hooks.on("createItem", (doc) => { if (doc.parent === h) hooks++; });
    await cg.regenerateHireling(h);
    Hooks.off("createItem", hid);
    return { hooks, items: h.items.size };
  });

  stage("deleting a keeper unlinks its children before the delete resolves");
  const bulk = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const keeper = await Cls.create({ name: "ZZ Lifecycle Keeper", type: "character" });
    const mk = (n) => Cls.create({
      name: `ZZ Lifecycle Crate ${n}`, type: "npc",
      system: { slots: 4, role: "container", connectedTo: keeper.uuid },
    });
    const c1 = await mk("A");
    const c2 = await mk("B");
    keeper.prepareData();
    const linked = keeper.connectedActors().length;
    await Cls.deleteDocuments([keeper.id]);
    // No poll on purpose: _onDeleteOperation is awaited by the delete workflow,
    // so the unlink must already be visible when deleteDocuments resolves.
    const state = [c1, c2].map((c) => ({
      link: game.actors.get(c.id)?.system.connectedTo ?? null,
      former: game.actors.get(c.id)?.system.formerlyBelongedTo ?? null,
    }));
    for (const c of [c1, c2]) await game.actors.get(c.id)?.delete().catch(() => {});
    return { linked, state };
  });

  stage("negative control: the same walk in _onDelete is not awaited");
  const control = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const fixedOp = Cls._onDeleteOperation;
    // The WRONG hook, reconstructed: the same child-unlink walk, moved to a
    // per-document callback the workflow fires without awaiting, with the
    // batch-wise fix switched to the base class's no-op.
    Cls._onDeleteOperation = Object.getPrototypeOf(Cls)._onDeleteOperation;
    Cls.prototype._onDelete = async function (options, userId) {
      Object.getPrototypeOf(Object.getPrototypeOf(this))._onDelete.call(this, options, userId);
      if (userId !== game.user.id) return;
      for (const child of game.actors) {
        if (child.system?.connectedTo !== this.uuid) continue;
        await child.update({
          "system.formerlyBelongedTo": this.name,
          "system.connectedTo": "",
        });
      }
    };
    try {
      const keeper = await Cls.create({ name: "ZZ Lifecycle Keeper 2", type: "character" });
      const c1 = await Cls.create({
        name: "ZZ Lifecycle Crate C", type: "npc",
        system: { slots: 4, role: "container", connectedTo: keeper.uuid },
      });
      await Cls.deleteDocuments([keeper.id]);
      // Read IMMEDIATELY. The walk above is in flight: it has yielded at its
      // first `await child.update(...)`, which is a server round-trip and
      // cannot have resolved in the caller's own continuation. That is the
      // whole difference between the two hooks, and it is the reason a caller
      // which awaits a delete can still read a link to a corpse.
      const atResolve = game.actors.get(c1.id)?.system.connectedTo ?? null;
      // Then let it finish, so the cleanup below is not racing it.
      await new Promise((r) => setTimeout(r, 1500));
      const eventually = game.actors.get(c1.id)?.system.connectedTo ?? null;
      await game.actors.get(c1.id)?.delete().catch(() => {});
      return { atResolve, eventually, keeperUuid: keeper.uuid };
    } finally {
      Cls._onDeleteOperation = fixedOp;
      delete Cls.prototype._onDelete;
    }
  });

  console.log("\ndocument lifecycle");
  const checks = [
    ["character regenerate fires one createItem per item",
      charRegen.hooks > 0 && charRegen.hooks === charRegen.items,
      `hooks ${charRegen.hooks}, items ${charRegen.items}`],
    ["the abandoned update({items}) route really is hook-silent",
      updateRoute.created === 1 && updateRoute.hooks === 0,
      `created ${updateRoute.created}, hooks ${updateRoute.hooks}`],
    ["hireling regenerate fires one createItem per item",
      hirelingRegen.hooks > 0 && hirelingRegen.hooks === hirelingRegen.items,
      `hooks ${hirelingRegen.hooks}, items ${hirelingRegen.items}`],
    ["deleting a keeper unlinks and stamps both children, before the delete resolves",
      bulk.linked === 2 && bulk.state.every((s) => s.link === "" && s.former === "ZZ Lifecycle Keeper"),
      `linked ${bulk.linked}, after ${JSON.stringify(bulk.state)}`],
    ["negative control: the same walk in _onDelete is still in flight at resolve",
      control.atResolve === control.keeperUuid && control.eventually === "",
      `atResolve ${JSON.stringify(control.atResolve)}, eventually ${JSON.stringify(control.eventually)}`],
  ];
  for (const [label, pass, detail] of checks) {
    if (pass) ok(`${label} — ${detail}`);
    else fail(`${label} — ${detail}`);
  }

  if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }
} finally {
  await sweepLitter().catch((e) => console.error(`  note  sweep failed: ${e.message}`));
}

console.log(`\n${failed ? "DOC-LIFECYCLE PROBE FAILED" : "doc-lifecycle probe passed"}`);
await browser.close();
process.exit(failed ? 1 : 0);

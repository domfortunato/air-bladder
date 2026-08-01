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
 * 2. BULK CONTAINER DELETE MUST NOT DANGLE UUIDS. The keeper-prune used to be a
 *    per-document `_onDelete` walk, and Foundry fires those without awaiting
 *    them (client-backend.mjs:472) — so deleting two containers kept by the same
 *    actor interleaved two read-modify-writes of the keeper's list: each read
 *    the pre-delete list, filtered out only its own uuid, and whichever update
 *    landed last put the other's uuid back, dangling. The fix is
 *    `_onDeleteOperation`, batch-wise and awaited (client-backend.mjs:478). The
 *    negative control reconstructs the OLD shape in-page — prototype shim on
 *    `_onDelete`, operation hook swapped to the base class's — and must see the
 *    race reproduce. If it cannot, the fix is not proven load-bearing and the
 *    probe says so rather than passing.
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
    // A rolled background can grant keeper-linked containers with PLAIN names
    // (a "Mule"), so sweeping by our prefix alone would strand them. Take a
    // litter actor's kept containers with it, containers first.
    const uuids = new Set(litter.map((a) => a.uuid));
    for (const c of game.actors.filter((x) => x.type === "container" && uuids.has(x.system?.keeper))) {
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

  stage("bulk container delete prunes every uuid");
  const bulk = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const keeper = await Cls.create({ name: "ZZ Lifecycle Keeper", type: "character" });
    const c1 = await Cls.create({ name: "ZZ Lifecycle Crate A", type: "container", system: { slots: 4 } });
    const c2 = await Cls.create({ name: "ZZ Lifecycle Crate B", type: "container", system: { slots: 4 } });
    await keeper.createOwnedContainer(c1);
    await keeper.createOwnedContainer(c2);
    const linked = keeper.system.containers.length;
    await Cls.deleteDocuments([c1.id, c2.id]);
    // No poll on purpose: _onDeleteOperation is awaited by the delete workflow,
    // so the prune must already be visible when deleteDocuments resolves.
    return { linked, remaining: keeper.system.containers.length };
  });

  stage("negative control: the old per-document prune loses the race");
  const control = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const fixedOp = Cls._onDeleteOperation;
    // The OLD shape, reconstructed: prune per document from an unawaited
    // callback, with the batch-wise fix switched to the base class's no-op.
    Cls._onDeleteOperation = Object.getPrototypeOf(Cls)._onDeleteOperation;
    Cls.prototype._onDelete = async function (options, userId) {
      Object.getPrototypeOf(Object.getPrototypeOf(this))._onDelete.call(this, options, userId);
      if (userId !== game.user.id) return;
      const id = this.uuid;
      for (const ac of game.actors) {
        if (["character", "hireling", "npc"].includes(ac.type) && ac.system.containers?.includes(id)) {
          await ac.update({ "system.containers": ac.system.containers.filter((it) => it !== id) });
        }
      }
    };
    try {
      const keeper = await Cls.create({ name: "ZZ Lifecycle Keeper 2", type: "character" });
      const c1 = await Cls.create({ name: "ZZ Lifecycle Crate C", type: "container", system: { slots: 4 } });
      const c2 = await Cls.create({ name: "ZZ Lifecycle Crate D", type: "container", system: { slots: 4 } });
      await keeper.createOwnedContainer(c1);
      await keeper.createOwnedContainer(c2);
      await Cls.deleteDocuments([c1.id, c2.id]);
      // The old prunes are NOT awaited by the workflow, so they are still in
      // flight here. Poll until the list stops moving rather than sleeping a
      // fixed time — a fixed sleep is an assertion about someone else's timing.
      let last = JSON.stringify(keeper.system.containers);
      let stableFor = 0;
      const t0 = Date.now();
      while (stableFor < 800 && Date.now() - t0 < 10000) {
        await new Promise((r) => setTimeout(r, 200));
        const now = JSON.stringify(keeper.system.containers);
        stableFor = now === last ? stableFor + 200 : 0;
        last = now;
      }
      return { remaining: keeper.system.containers.length, list: keeper.system.containers };
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
    ["bulk delete of two kept containers prunes both, before the delete resolves",
      bulk.linked === 2 && bulk.remaining === 0,
      `linked ${bulk.linked}, remaining ${bulk.remaining}`],
    ["negative control: the old per-document prune leaves a dangling uuid",
      control.remaining > 0,
      `remaining ${control.remaining} (${JSON.stringify(control.list)})`],
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

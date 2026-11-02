#!/usr/bin/env node
/**
 * A re-roll ORPHANS the containers the old grant gave, and never deletes one
 * (user ruling 2026-11-01, review #34 finding 183) — and only containers that
 * really are the character's are touched (review #34 finding 120).
 *
 *   node tools/dev/e2e-reroll-refusal.mjs   (needs Foundry running, world
 *   launched, and `npm run dev:players` — the legs need Alice)
 *
 * The name is historical. Until the ruling, `canRegenerateContainers` REFUSED a
 * player whose character held a granted container, because removing one meant
 * deleting an Actor and Foundry gates that on ASSISTANT; this probe proved the
 * refusal was whole (review #21 finding 1). The ruling: "Players should not
 * need the Warden to re-roll for them. A re-roll may just orphan actors
 * assigned by the first question, in which case the Warden will delete them."
 * — on everyone's re-roll, the Warden's included. Orphaned = unlinked, stamped
 * `formerlyBelongedTo` with the character's name, its grant flag gone, the
 * broken (loot-pile) ownership, and everything stowed on it still there.
 *
 * And NAMED so the Warden can find it (ruled 2026-11-02): `o_` in front of its
 * name, never twice, and the tokens still wearing the old name follow — from
 * the player's own client on her re-roll, where the Warden's client takes her
 * Owner away straight after and a token write that lands later is refused.
 * Leg A holds her token writes back 1.5 s each, in her page, so the ordering
 * is tested on every run rather than whenever the network is slow.
 *
 * A container counts as the character's only if no player can have faked it
 * (finding 120): its default is below OWNER, every player who owns it owns the
 * character, and its last writer is a Warden or one of those owners. Two
 * plants the old marks alone accepted must be left exactly as they are.
 *
 * Legs (dice seeded to max faces so a re-roll that happens SHOWS):
 *   A. Alice, all-checked: the gesture applies — STR moves — and her granted
 *      mule is orphaned, not deleted, and is no longer hers to own; it is
 *      renamed o_…, and its tokens on two scenes follow while a third, named
 *      on purpose, keeps its name.
 *   B. Alice, Background unchecked, gear + STR: the same, through the
 *      background-scoped path.
 *   C. The Warden changes the background of a PC no player owns (a world being
 *      prepared): its real granted mule is orphaned, not deleted, and renamed;
 *      a second whose name already starts o_ is not prefixed again; a mule
 *      Alice pointed at it from her own npc, and a party mule shared with
 *      everyone that she pointed at it too, are untouched — still there,
 *      still owned, still named as they were.
 *
 * Every actor the Warden's client creates is swept from the finally
 * (`trackCreatedActors`), the relay's new grants included.
 * Exits non-zero on any failed assertion or console error.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog,
  trackCreatedActors, sweepCreatedActors } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(300000, "reroll orphaning probe");

const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const gmErrors = watchErrors(gm);
await joinAsGM(gm);
await dismissChrome(gm);
await trackCreatedActors(gm);

let saved = null;
let sceneIds = [];
let aliceErrors = [];

/** The prefix a re-roll gives an orphan's name. Spelled out, not imported: the
 *  probe states the ruling, so a changed constant reds here. */
const O = "o_";

/** What a container looks like now, read on the Warden's client. */
const stateOf = (id) => gm.evaluate((id) => {
  const a = game.actors.get(id);
  if (!a) return { exists: false };
  const alice = game.users.getName("Alice");
  return {
    exists: true,
    name: a.name,
    connectedTo: a.system?.connectedTo ?? "",
    formerlyBelongedTo: a.system?.formerlyBelongedTo ?? "",
    grantSource: a.getFlag("air-bladder", "grantSource") ?? null,
    aliceOwns: !!alice && a.testUserPermission(alice, "OWNER"),
    sharedWithAll: (a.ownership?.default ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    items: a.items.size,
  };
}, id);

/** Poll until the Warden's client has applied the orphan's ownership. */
const settled = async (id) => {
  let s = null;
  for (let i = 0; i < 50; i++) {
    s = await stateOf(id);
    if (!s.exists || (!s.connectedTo && !s.aliceOwns)) return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  return s;
};

const orphaned = (s, keeperName) => s.exists && s.connectedTo === "" && s.formerlyBelongedTo === keeperName
  && s.grantSource === null && !s.aliceOwns;

/** Every token name on the probe's scenes, sorted, read on the Warden's client. */
const tokenNames = (ids) => gm.evaluate((ids) =>
  ids.flatMap((id) => game.scenes.get(id)?.tokens.map((t) => t.name) ?? []).sort(), ids);

try {
  /* --- setup, as GM ---------------------------------------------------------- */

  const setup = await gm.evaluate(async () => {
    const NS = "air-bladder";
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    // A stale actor from an aborted run would satisfy every precondition below
    // without this run having established any of them. An orphan of one wears
    // the prefix.
    for (const a of game.actors.filter((a) => /^(o_)?ZZ RerollRef/.test(a.name ?? ""))) await a.delete();
    for (const s of game.scenes.filter((s) => s.name?.startsWith("ZZ RerollRef"))) await s.delete();

    const alice = game.users.getName("Alice");
    if (!alice) return { error: 'no user named "Alice" — run `npm run dev:players` first' };

    const out = { saved: { playerRandomization: game.settings.get(NS, "allow-player-randomization") } };
    // Alice needs the Roll Character button at all.
    await game.settings.set(NS, "allow-player-randomization", true);

    const pack = game.packs.get("air-bladder.backgrounds-2e");
    if (!pack) return { error: "no backgrounds-2e pack in this world" };
    const bgs = await pack.getDocuments();
    const fieldwarden = bgs.find((b) => b.name === "Fieldwarden");
    const other = bgs.find((b) => b.name !== "Fieldwarden");
    if (!fieldwarden || !other) return { error: "Fieldwarden, or a second 2e background, is missing" };
    out.otherBgUuid = other.uuid;

    const Cls = CONFIG.Actor.documentClass;
    const pc = await Cls.create({
      name: "ZZ RerollRef PC", type: "character",
      system: { generationEnabled: true },
      ownership: { [alice.id]: L.OWNER },
    });
    await gen.changeBackground(pc, fieldwarden);
    // Distinct scalars AFTER the swap, so a re-roll shows: seeded dice land 18.
    await pc.update({ "system.abilities.STR": { value: 10, max: 10 } });

    // A granted mule as generation leaves one: connected to the PC, wearing the
    // connected shape (the world may look, the PC's player owns it), with a
    // stowed item so "orphaned with everything on it" is a real claim.
    const mule = async (name, keeper, ownership) => {
      const m = await Cls.create({
        name, type: "npc", ownership,
        system: { role: "companion", containerClass: "mule", connectedTo: keeper.uuid, generationEnabled: false },
        flags: { [NS]: { grantSource: "background" } },
      });
      await m.createEmbeddedDocuments("Item", [{ name: "ZZ RerollRef Saddlebag Rope", type: "item" }]);
      return m.id;
    };
    out.pcId = pc.id;
    out.pcName = pc.name;
    out.muleA = await mule("ZZ RerollRef Mule A", pc, { default: L.OBSERVER, [alice.id]: L.OWNER });

    // Two scenes with the mule placed: both tokens wearing its name must follow
    // the orphan's new one, and a third, named on purpose, must keep its own.
    // One scene per create, so nothing is read off a batch by position.
    const muleA = game.actors.get(out.muleA);
    const td = async (x, overrides = {}) => ({ ...(await muleA.getTokenDocument({ x, y: 100 })).toObject(), ...overrides });
    out.scenes = [];
    for (const n of [1, 2]) {
      const scene = await getDocumentClass("Scene").create({
        name: `ZZ RerollRef Scene ${n}`, width: 1000, height: 1000, grid: { size: 100 },
      });
      out.scenes.push(scene.id);
      await scene.createEmbeddedDocuments("Token", n === 1
        ? [await td(100), await td(300, { name: "ZZ RerollRef Hand-Named Mule" })]
        : [await td(100)]);
    }

    // A PC no player owns — a world the Warden is still preparing — with its
    // own real granted mule (the connected shape of an unowned keeper).
    const victim = await Cls.create({ name: "ZZ RerollRef Unowned PC", type: "character" });
    await gen.changeBackground(victim, fieldwarden);
    out.victimId = victim.id;
    out.victimUuid = victim.uuid;
    out.victimName = victim.name;
    out.muleV = await mule("ZZ RerollRef Mule V", victim, { default: L.OBSERVER });
    // A grant whose name already wears the prefix (a Warden's own naming, or an
    // orphan adopted back by hand): orphaned again, it must not read o_o_.
    out.muleW = await mule(`o_ZZ RerollRef Mule W`, victim, { default: L.OBSERVER });

    // Two actors Alice may write, for her plants: her own npc, and a party
    // mule the Warden shared with everyone (default OWNER).
    out.alicePlant = (await Cls.create({ name: "ZZ RerollRef Alice Npc", type: "npc",
      system: { role: "npc" }, ownership: { [alice.id]: L.OWNER } })).id;
    out.partyMule = (await Cls.create({ name: "ZZ RerollRef Party Mule", type: "npc",
      system: { role: "companion", containerClass: "mule" }, ownership: { default: L.OWNER } })).id;
    return out;
  });

  if (setup.error) {
    fail(`setup: ${setup.error}`);
    throw new Error(setup.error);
  }
  saved = setup.saved;
  sceneIds = setup.scenes;
  const muleA0 = await stateOf(setup.muleA);
  muleA0.exists && muleA0.connectedTo && muleA0.grantSource === "background" && muleA0.aliceOwns && muleA0.items === 1
    ? ok("precondition: Alice's character keeps a granted mule she owns, with a rope stowed on it")
    : fail(`precondition: the granted mule ${JSON.stringify(muleA0)}`);
  const tokens0 = await tokenNames(sceneIds);
  JSON.stringify(tokens0) === JSON.stringify(["ZZ RerollRef Hand-Named Mule", "ZZ RerollRef Mule A", "ZZ RerollRef Mule A"])
    ? ok("precondition: the mule is placed on two scenes, plus one token named on purpose")
    : fail(`precondition: the planted tokens ${JSON.stringify(tokens0)}`);

  /* --- the player's legs, as Alice -------------------------------------------- */

  const alice = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
  aliceErrors = watchErrors(alice);
  await joinAs(alice, "Alice");
  await dismissChrome(alice);

  const runLeg = (states, { slowTokens = false } = {}) => alice.evaluate(async ({ actorId, states, slowTokens }) => {
    const actor = game.actors.get(actorId);
    if (!actor) return { error: "Alice cannot see the test character" };
    if (!actor.isOwner) return { error: "Alice does not own the test character" };
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitFor = async (test, ms = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const v = test(); if (v) return v; await wait(100); }
      return false;
    };
    const sheet = actor.sheet;
    await sheet.render(true);
    await wait(800);
    const root = sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0];
    const warns = [];
    const origWarn = ui.notifications.warn.bind(ui.notifications);
    ui.notifications.warn = (m, ...r) => { warns.push(String(m)); return origWarn(m, ...r); };
    const origUniform = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;   // max faces: a roll that happens SHOWS
    // Every token write from this page held back 1.5 s: the Warden's client
    // takes Alice's Owner on the orphan away as soon as she asks it to, and a
    // token write landing after that is refused — so only a rename that
    // FINISHES before she asks gets the second scene's token renamed.
    const SceneCls = CONFIG.Scene.documentClass;
    const ownUpdate = Object.prototype.hasOwnProperty.call(SceneCls.prototype, "updateEmbeddedDocuments");
    const origUpdate = SceneCls.prototype.updateEmbeddedDocuments;
    let delayedTokenWrites = 0;
    if (slowTokens) {
      SceneCls.prototype.updateEmbeddedDocuments = async function (embeddedName, ...rest) {
        if (embeddedName === "Token") { delayedTokenWrites++; await wait(1500); }
        return origUpdate.call(this, embeddedName, ...rest);
      };
    }
    const strBefore = actor.system.abilities.STR.max;
    try {
      root?.closest(".application")?.querySelector('.window-header button[data-action="rollActor"]')?.click();
      const dlg = await waitFor(() => document.querySelector(".reroll-dialog"), 10000);
      if (!dlg) return { error: "the checklist never opened for Alice" };
      // Parents first — a child is disabled while its parent is checked.
      const order = ["background", "failedCareer",
        ...Object.keys(states).filter((k) => k !== "background" && k !== "failedCareer")];
      for (const k of order) {
        if (!(k in states)) continue;
        const input = dlg.querySelector(`input[name="${k}"]`);
        if (input && input.checked !== states[k] && !input.disabled) input.click();
      }
      dlg.closest(".application")?.querySelector('button[data-action="reroll"]')?.click();
      await waitFor(() => !document.querySelector(".reroll-dialog"), 5000);
      await waitFor(() => sheet._rerolling === false, 30000);
      await wait(1500);
    } finally {
      CONFIG.Dice.randomUniform = origUniform;
      ui.notifications.warn = origWarn;
      if (slowTokens) {
        if (ownUpdate) SceneCls.prototype.updateEmbeddedDocuments = origUpdate;
        else delete SceneCls.prototype.updateEmbeddedDocuments;
      }
    }
    const res = { warns: [...warns], strBefore, strAfter: actor.system.abilities.STR.max,
      rerollingCleared: sheet._rerolling === false, delayedTokenWrites };
    await sheet.close();
    return res;
  }, { actorId: setup.pcId, states, slowTokens });

  console.log("\nA. Alice, all-checked — the gesture applies and her granted mule is orphaned");
  const a = await runLeg({ background: true }, { slowTokens: true });
  if (a.error) fail(`leg A: ${a.error}`);
  else {
    a.strAfter !== a.strBefore
      ? ok(`the re-roll applied (STR ${a.strBefore} → ${a.strAfter}), with no refusal`)
      : fail(`leg A: nothing re-rolled — refused? warns ${JSON.stringify(a.warns)}`);
    const s = await settled(setup.muleA);
    orphaned(s, setup.pcName) && s.items === 1
      ? ok("the old mule is orphaned, not deleted: unlinked, \"formerly\" the PC's, no grant flag, not Alice's, rope still on it")
      : fail(`leg A: the old granted mule ${JSON.stringify(s)}`);
    s.name === `${O}ZZ RerollRef Mule A`
      ? ok(`its name gains the prefix: "${s.name}"`)
      : fail(`leg A: the orphan is named "${s.name}", not "${O}ZZ RerollRef Mule A"`);
    // The token writes trail the actor's; poll for them, then read once more.
    const want = JSON.stringify(["ZZ RerollRef Hand-Named Mule", `${O}ZZ RerollRef Mule A`, `${O}ZZ RerollRef Mule A`]);
    let tokens = [];
    for (let i = 0; i < 50; i++) {
      tokens = await tokenNames(sceneIds);
      if (JSON.stringify(tokens) === want) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    tokens.filter((n) => n === `${O}ZZ RerollRef Mule A`).length === 2
      ? ok("both tokens that wore its old name follow — on scene 1 AND scene 2, from Alice's client")
      : fail(`leg A: tokens after the orphaning ${JSON.stringify(tokens)}`);
    tokens.includes("ZZ RerollRef Hand-Named Mule")
      ? ok("the token named on purpose keeps its name")
      : fail(`leg A: the hand-named token was renamed ${JSON.stringify(tokens)}`);
    a.delayedTokenWrites === 2
      ? ok("witness: Alice's two token writes (one per scene) were each held back 1.5 s")
      : fail(`leg A: ${a.delayedTokenWrites} token write(s) were held back, not 2 — the ordering went untested`);
    a.rerollingCleared ? ok("the sheet's guard is released") : fail("leg A: _rerolling stayed latched");
  }

  console.log("\nB. Alice, Background unchecked, gear + STR — the scoped path orphans too");
  // The character's name as leg B finds it: leg A's all-checked run re-rolled
  // it (the name rides the Background line), and an orphan carries the name
  // its character had when it was orphaned. The first green run compared
  // against the setup's name and reddened on an orphan that was right.
  const legB = await gm.evaluate(async ({ pcId }) => {
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const pc = game.actors.get(pcId);
    const alice = game.users.getName("Alice");
    await pc.update({ "system.abilities.STR": { value: 10, max: 10 } });
    const m = await CONFIG.Actor.documentClass.create({
      name: "ZZ RerollRef Mule B", type: "npc",
      ownership: { default: L.OBSERVER, [alice.id]: L.OWNER },
      system: { role: "companion", containerClass: "mule", connectedTo: pc.uuid, generationEnabled: false },
      flags: { "air-bladder": { grantSource: "background" } },
    });
    return { id: m.id, pcName: pc.name };
  }, { pcId: setup.pcId });
  const allOff = { background: false, gear: false, question0: false, question1: false, bonds: false,
    STR: false, DEX: false, WIL: false, hp: false, gold: false, age: false, traits: false,
    portrait: false, omen: false, name: false };
  const b = await runLeg({ ...allOff, gear: true, STR: true });
  if (b.error) fail(`leg B: ${b.error}`);
  else {
    b.strAfter !== b.strBefore
      ? ok(`the re-roll applied (STR ${b.strBefore} → ${b.strAfter}), with no refusal`)
      : fail(`leg B: nothing re-rolled — refused? warns ${JSON.stringify(b.warns)}`);
    const s = await settled(legB.id);
    orphaned(s, legB.pcName)
      ? ok("the background's mule is orphaned, not deleted")
      : fail(`leg B: the background's granted mule ${JSON.stringify(s)}`);
    s.name === `${O}ZZ RerollRef Mule B`
      ? ok(`…and renamed "${s.name}"`)
      : fail(`leg B: the orphan is named "${s.name}", not "${O}ZZ RerollRef Mule B"`);
  }

  /* --- Alice plants, then the Warden re-rolls (finding 120) -------------------- */

  const planted = await alice.evaluate(async ({ ids, victimUuid }) => {
    const out = {};
    for (const [k, id] of Object.entries(ids)) {
      const a = game.actors.get(id);
      if (!a?.isOwner) { out[k] = "not owned"; continue; }
      await a.update({ "system.connectedTo": victimUuid, "flags.air-bladder.grantSource": "background" });
      out[k] = a.system.connectedTo === victimUuid && a.getFlag("air-bladder", "grantSource") === "background";
    }
    return out;
  }, { ids: { alicePlant: setup.alicePlant, partyMule: setup.partyMule }, victimUuid: setup.victimUuid });
  planted.alicePlant === true && planted.partyMule === true
    ? ok("precondition: Alice pointed her own npc and the shared party mule at the unowned PC, grant flag and all")
    : fail(`precondition: Alice's plants ${JSON.stringify(planted)}`);

  await alice.context().close();

  console.log("\nC. the Warden changes the unowned PC's background — its real mule orphaned, the plants left alone");
  await gm.evaluate(async ({ victimId, otherBgUuid }) => {
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    await gen.changeBackground(game.actors.get(victimId), await fromUuid(otherBgUuid));
    await new Promise((r) => setTimeout(r, 800));
  }, { victimId: setup.victimId, otherBgUuid: setup.otherBgUuid });
  const v = await settled(setup.muleV);
  v.exists && v.connectedTo === "" && v.formerlyBelongedTo === setup.victimName && v.grantSource === null && v.items === 1
    ? ok("the unowned PC's own granted mule is orphaned, not deleted, rope still on it")
    : fail(`leg C: the real granted mule ${JSON.stringify(v)}`);
  v.name === `${O}ZZ RerollRef Mule V`
    ? ok(`…and renamed "${v.name}" on the Warden's re-roll too`)
    : fail(`leg C: the orphan is named "${v.name}", not "${O}ZZ RerollRef Mule V"`);
  const w = await settled(setup.muleW);
  w.exists && w.connectedTo === "" && w.grantSource === null && w.name === `${O}ZZ RerollRef Mule W`
    ? ok(`a grant already named "${O}…" is orphaned and keeps ONE prefix ("${w.name}")`)
    : fail(`leg C: the already-prefixed grant ${JSON.stringify(w)}`);
  const p1 = await stateOf(setup.alicePlant);
  p1.exists && p1.connectedTo === setup.victimUuid && p1.aliceOwns && p1.name === "ZZ RerollRef Alice Npc"
    ? ok("Alice's planted npc is untouched: still there, still pointed, still hers, still named as it was")
    : fail(`leg C: Alice's planted npc ${JSON.stringify(p1)}`);
  const p2 = await stateOf(setup.partyMule);
  p2.exists && p2.connectedTo === setup.victimUuid && p2.sharedWithAll && p2.name === "ZZ RerollRef Party Mule"
    ? ok("the shared party mule is untouched: still there, still shared with everyone, still named as it was")
    : fail(`leg C: the shared party mule ${JSON.stringify(p2)}`);
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  await sweepCreatedActors(gm);
  await gm.evaluate(async ({ saved, sceneIds }) => {
    const NS = "air-bladder";
    for (const a of game.actors.filter((a) => /^(o_)?ZZ RerollRef/.test(a.name ?? ""))) {
      try { await a.delete(); } catch { /* already gone */ }
    }
    for (const id of sceneIds) {
      try { await game.scenes.get(id)?.delete(); } catch { /* already gone */ }
    }
    if (saved) await game.settings.set(NS, "allow-player-randomization", saved.playerRandomization);
  }, { saved, sceneIds }).catch((e) => fail(`could not restore world state: ${e.message}`));
}

const errors = [...gmErrors, ...aliceErrors];
if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "REROLL ORPHANING PROBE FAILED" : "Reroll orphaning probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

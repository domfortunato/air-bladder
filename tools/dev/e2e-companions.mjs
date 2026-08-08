/**
 * Companions: the role that was called Mount, and the creatures the canon owes.
 *
 * Two halves, one commit (2026-08-08). The `mount` role EVOLVED into
 * `companion` — stored key and label, the hireling retirement's machinery —
 * and the canon 2e prose companions (Fletchwind's falcon, Half Witch's raven)
 * are minted as connected Actors the way the Outrider's horse always was.
 *
 * The migration legs use the RAW socket (SocketInterface.dispatch), because a
 * stored "mount" is unobservable any other way: migrateData rewrites the
 * source at initialization, so even `_source.system.role` reads "companion"
 * on a document the database still holds as "mount". That fact cost this
 * feature's own world migration its first draft — it filtered on the stored
 * value, which matches nothing, ever — and is why the restamp is BLIND.
 *
 * The dev world has NO actors; fixtures are created and removed. Needs
 * `npm run dev:players` (Alice) for the broker leg.
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, dismissChrome, joinAs, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(40)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(40)} ${d}`); failures++; };
const check = (l, cond, d = "") => (cond ? ok(l, d) : fail(l, d));

watchdog(420000, "companions");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
await page.goto(FOUNDRY_URL);
await joinAsGM(page);
await dismissChrome(page);

/* ---------------------------------------------------------------------------
 * 1. The role: stored "mount" reads companion, the restamp writes it back,
 *    and the sheet speaks the new word.
 * ------------------------------------------------------------------------- */
console.log("\nmount evolved into companion");
const role = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};

  // Plant a LEGACY document: raw "mount" in the database, as an 0.1.12 world
  // holds it. The client-side create would migrate it on the way in, so the
  // role is written RAW after creation.
  const legacy = await ActorImpl.create({ name: "ZZ Old Mount", type: "npc",
    system: { role: "companion", containerClass: "horse", slots: 4 } });
  await foundry.helpers.SocketInterface.dispatch("modifyDocument", {
    type: "Actor", action: "update",
    operation: { updates: [{ _id: legacy.id, system: { role: "mount" } }], diff: false },
  });
  const rawRole = async () => {
    const res = await foundry.helpers.SocketInterface.dispatch("modifyDocument", {
      type: "Actor", action: "get", operation: { query: { _id__in: [legacy.id] }, broadcast: false },
    });
    return res?.result?.[0]?.system?.role ?? null;
  };
  r.rawBefore = await rawRole();

  // The READ: a fresh initialization of the raw record answers companion.
  // CAUGHT, not bare — with the migrateData shim removed this THROWS ("mount
  // is not a valid choice", the enum failure the shim exists to prevent), and
  // an uncaught throw kills the run before cleanup instead of reddening the
  // leg. The first witness run did exactly that and stranded the fixture.
  const raw = (await foundry.helpers.SocketInterface.dispatch("modifyDocument", {
    type: "Actor", action: "get", operation: { query: { _id__in: [legacy.id] }, broadcast: false },
  })).result[0];
  try {
    r.readAs = new ActorImpl(raw).system.role;
  } catch (e) {
    r.readAs = `THREW: ${e.message.slice(0, 80)}`;
  }
  try {
    r.liveReads = game.actors.get(legacy.id).system.role;
  } catch (e) {
    r.liveReads = `THREW: ${e.message.slice(0, 80)}`;
  }

  // The RESTAMP: reset the marker, run the world migration's own writes the
  // way the ready hook does — write the read value back, diff: false.
  await game.settings.set("air-bladder", "companion-restamped", false);
  const updates = game.actors
    .filter((a) => ["npc", "hireling"].includes(a.type))
    .map((a) => ({ _id: a.id, "system.role": a.system.role }));
  await ActorImpl.updateDocuments(updates, { diff: false });
  await game.settings.set("air-bladder", "companion-restamped", true);
  r.rawAfter = await rawRole();

  // The sheet's role select carries the new word and never the old.
  await legacy.sheet.render(true);
  await sleep(800);
  const options = [...(legacy.sheet.element?.querySelectorAll('select[name="system.role"] option') ?? [])]
    .map((o) => o.textContent.trim());
  r.roleOptions = options;
  await legacy.sheet.close();

  r.ids = { legacyId: legacy.id };
  return r;
});

check("a stored mount READS companion", role.rawBefore === "mount" && role.readAs === "companion"
  && role.liveReads === "companion",
  `db="${role.rawBefore}" read="${role.readAs}" — migrateData, before choices validation`);
check("the restamp writes it to the DATABASE", role.rawAfter === "companion",
  `db="${role.rawAfter}" — blind, like the hireling restamp: the stored value is unobservable, so a filtered migration stamps nothing`);
check("the sheet says Companion, never Mount", role.roleOptions.includes("Companion")
  && !role.roleOptions.includes("Mount"),
  JSON.stringify(role.roleOptions));

/* ---------------------------------------------------------------------------
 * 2. The pack: label, folder, and the two new companions with their stats.
 * ------------------------------------------------------------------------- */
console.log("\nthe Companions & Transports pack");
const pack = await page.evaluate(async () => {
  const r = {};
  const p = game.packs.get("air-bladder.mounts-transports");
  r.label = p?.metadata.label ?? null;
  r.folders = [...(p?.folders ?? [])].map((f) => f.name).sort();
  const docs = await p.getDocuments();
  const falcon = docs.find((d) => d.name === "Falcon");
  const raven = docs.find((d) => d.name === "Raven Familiar");
  const stat = (d) => d ? {
    role: d.system.role, slots: d.system.slots, hp: d.system.hp.max,
    STR: d.system.abilities.STR.value, DEX: d.system.abilities.DEX.value, WIL: d.system.abilities.WIL.value,
    img: d.img,
  } : null;
  r.falcon = stat(falcon);
  r.raven = stat(raven);
  r.everyRole = [...new Set(docs.map((d) => d.system.role))].sort();

  // The grants, both halves: the falcon option gained a container, the raven
  // option's ITEM grant is GONE — the Outrider precedent, "an outrider's horse
  // should never appear in their inventory". The tattoo stays prose (ruled),
  // which is the control that proves this reader distinguishes.
  const bgs = await game.packs.get("air-bladder.backgrounds-2e").getDocuments();
  const opt = (bgName, t, o) => bgs.find((b) => b.name === bgName)?.system.tables?.[t]?.options?.[o] ?? {};
  const falconry = opt("Fletchwind", 0, 1);
  const ravenOpt = opt("Half Witch", 0, 3);
  const tattooOpt = opt("Mountebank", 0, 0);
  r.falconGrant = (falconry.containers ?? []).map((c) => c.name);
  r.ravenGrant = { containers: (ravenOpt.containers ?? []).map((c) => c.name), items: (ravenOpt.items ?? []).map((i) => i.name) };
  r.tattooStaysProse = !(tattooOpt.containers?.length);
  r.ravenItemGone = !(await game.packs.get("air-bladder.background-items").getIndex())
    .some((e) => e.name === "Raven Familiar");
  return r;
});

check("the pack is relabelled, the folder renamed", pack.label === "Companions & Transports"
  && pack.folders.includes("Companions") && !pack.folders.includes("Mounts"),
  `label="${pack.label}" folders=${JSON.stringify(pack.folders)} — same pack id, same folder id`);
check("every creature in it is a companion", JSON.stringify(pack.everyRole) === JSON.stringify(["companion", "container", "transport"]),
  JSON.stringify(pack.everyRole));
check("the Falcon carries its whole stat block", pack.falcon?.role === "companion"
  && pack.falcon?.hp === 3 && pack.falcon?.STR === 5 && pack.falcon?.DEX === 16 && pack.falcon?.WIL === 4
  && pack.falcon?.slots === 0 && /falcon\.svg$/.test(pack.falcon?.img ?? ""),
  JSON.stringify(pack.falcon));
check("the Raven Familiar too", pack.raven?.role === "companion"
  && pack.raven?.hp === 8 && pack.raven?.STR === 3 && pack.raven?.DEX === 11 && pack.raven?.WIL === 13
  && pack.raven?.slots === 0,
  JSON.stringify(pack.raven));
check("the falcon option grants the companion", JSON.stringify(pack.falconGrant) === JSON.stringify(["Falcon"]),
  JSON.stringify(pack.falconGrant));
check("the raven is an Actor grant, NOT an item", JSON.stringify(pack.ravenGrant.containers) === JSON.stringify(["Raven Familiar"])
  && pack.ravenGrant.items.length === 0 && pack.ravenItemGone,
  `${JSON.stringify(pack.ravenGrant)} itemRetired=${pack.ravenItemGone} — the Outrider precedent`);
check("the tattoo stays prose (the ruled boundary)", pack.tattooStaysProse,
  "Mountebank's dog/cat/bird is statless and not a persistent creature — minting it was ruled out");

/* ---------------------------------------------------------------------------
 * 3. The grant, GM path: a minted Falcon carries DEX 16 — the abilities-copy
 *    leg, which nothing else can see (hp/armorOverride were already copied;
 *    a falcon landing 10/10/10 is review #5's bug class again).
 * ------------------------------------------------------------------------- */
console.log("\nthe grant mints a companion");
const grant = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const r = {};
  const keeper = await ActorImpl.create({ name: "ZZ Falconer", type: "character" });
  const hpBefore = keeper._source.system.hp.value;
  const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
  const made = await grantContainers(keeper, [{ name: "Falcon", grantSource: "question:0" }]);
  const falcon = made[0] ?? null;
  r.made = made.length;
  r.stats = falcon ? {
    role: falcon.system.role, DEX: falcon.system.abilities.DEX.value,
    STR: falcon.system.abilities.STR.value, hp: falcon.system.hp.max,
    connectedTo: falcon.system.connectedTo === keeper.uuid, slots: falcon.system.slots,
  } : null;
  // A 0-slot companion is not inventory: the keeper's own accounting must not move.
  r.keeperUntouched = keeper._source.system.hp.value === hpBefore
    && keeper.system.slotsUsed === 0;
  r.ids = { keeperId: keeper.id, falconId: falcon?.id ?? null };
  return r;
});

check("the Falcon lands whole", grant.made === 1 && grant.stats?.role === "companion"
  && grant.stats?.connectedTo && grant.stats?.slots === 0,
  JSON.stringify(grant.stats));
check("with DEX 16, not the schema's 10", grant.stats?.DEX === 16 && grant.stats?.STR === 5
  && grant.stats?.hp === 3,
  `DEX=${grant.stats?.DEX} STR=${grant.stats?.STR} hp=${grant.stats?.hp} — the abilities-copy leg; only hp and armorOverride were copied before`);
check("the keeper is untouched", grant.keeperUntouched,
  "a 0-slot companion is not inventory and costs no capacity");

/* ---------------------------------------------------------------------------
 * 4. The player path: Alice's grant goes through the broker (players lack
 *    ACTOR_CREATE) and GRANTABLE_ROLES must speak the new role — reverted to
 *    "mount", the payload falls back to class derivation and the clamp hands
 *    her a CONTAINER-role raven.
 * ------------------------------------------------------------------------- */
console.log("\na player's grant crosses the broker");
const alice = { ran: false };
try {
  const alicePage = await browser.newPage({ viewport: VIEWPORT });
  await joinAs(alicePage, "Alice");
  const prep = await page.evaluate(async () => {
    const a = game.users.find((u) => u.name === "Alice");
    if (!a) return null;
    const pc = await CONFIG.Actor.documentClass.create({
      name: "ZZ Witch", type: "character", ownership: { default: 0, [a.id]: 3 },
    });
    return { pcId: pc.id };
  });
  if (prep) {
    Object.assign(alice, await alicePage.evaluate(async ({ pcId }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const pc = game.actors.get(pcId);
      const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
      const returned = await grantContainers(pc, [{ name: "Raven Familiar", grantSource: "question:0" }]);
      // The player's side returns [] — the documents appear when the GM's
      // client answers the socket.
      // Poll for the actor AND its ownership: the GM handler creates first
      // and writes the connected-ownership shape second, so reading isOwner
      // the instant the actor appears is a race against the second write.
      let raven = null;
      for (let i = 0; i < 60; i++) {
        raven = game.actors.find((x) => x.name === "Raven Familiar" && x.system.connectedTo === pc.uuid);
        if (raven?.isOwner) break;
        await sleep(250);
      }
      return {
        ran: true, isGM: game.user.isGM, returnedCount: returned.length,
        minted: !!raven, role: raven?.system.role ?? null,
        DEX: raven?.system.abilities.DEX.value ?? null,
        WIL: raven?.system.abilities.WIL.value ?? null,
        owned: raven?.isOwner ?? false,
        ravenId: raven?.id ?? null,
      };
    }, prep));
  }
  await alicePage.close();
} catch (e) {
  alice.error = `${e.name}: ${e.message}`;
}
if (alice.error) check("the player leg ran", false, alice.error);
check("the player leg ran", alice.ran && !alice.isGM && alice.returnedCount === 0,
  `ran=${alice.ran} returned=${alice.returnedCount} (needs npm run dev:players and a GM client open — this probe's own)`);
check("the broker mints her raven as a COMPANION", alice.minted && alice.role === "companion"
  && alice.DEX === 11 && alice.WIL === 13,
  `role=${alice.role} DEX=${alice.DEX} WIL=${alice.WIL} — GRANTABLE_ROLES must name the new role, or the clamp derives and hands her a container`);
check("and she owns it", alice.owned, "connection drives ownership, monsters never touched");

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async ({ ids, grantIds, ravenId }) => {
  for (const id of [ids.legacyId, grantIds.falconId, grantIds.keeperId, ravenId].filter(Boolean)) {
    await game.actors.get(id)?.delete();
  }
  const witch = game.actors.getName("ZZ Witch");
  await witch?.delete();
}, { ids: role.ids, grantIds: grant.ids, ravenId: alice.ravenId ?? null });

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(failures ? `\ncompanions e2e FAILED — ${failures}` : "\ncompanions e2e passed");
process.exit(failures ? 1 : 0);

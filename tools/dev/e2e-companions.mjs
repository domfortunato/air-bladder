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
  r.prose = "Falcon: it can scout ahead and harry a foe. 3 HP. +0 slots.";
  const made = await grantContainers(keeper, [
    { name: "Falcon", grantSource: "question:0", grantNote: r.prose },
  ]);
  const falcon = made[0] ?? null;
  r.made = made.length;
  // The bullet belongs to the CHARACTER, on Background & Notes — not to the bird.
  r.notes = keeper.system.notes ?? null;
  r.beastNotes = falcon?.system.notes ?? null;
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
check("generation writes NO note on the character", grant.notes === "",
  `keeper notes=${JSON.stringify(grant.notes)} — the grant bullets are GONE (user ruling 2026-08-16). `
  + "They were one line per granted thing on Background & Notes; the ruling is that a character sheet "
  + "does not list the beasts and carts a roll handed over. The things themselves still exist");
check("and none on the beast either", !grant.beastNotes,
  `beast notes=${JSON.stringify(grant.beastNotes)} — its own description already carries the same words`);

/* ---------------------------------------------------------------------------
 * 3a. A BACKGROUND grant writes nothing either. This was the POSITIVE control
 *     for the old suppression rule — background lines landed while question
 *     lines were suppressed — and it is now the leg that would catch a HALF
 *     removal, which is exactly what a partial cut of a two-source feature
 *     looks like.
 * ------------------------------------------------------------------------- */
const stock = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
  const keeper = await ActorImpl.create({ name: "ZZ Mountebank", type: "character" });
  await grantContainers(keeper, [{ name: "Cart", slots: 4, grantSource: "background" }]);
  const kids = game.actors.filter((a) => a.system?.connectedTo === keeper.uuid);
  return {
    notes: keeper.system.notes,
    ledger: keeper.getFlag("air-bladder", "grantNotes") ?? null,
    stamped: kids.some((a) => a.getFlag("air-bladder", "grantNoteId")),
    carted: kids.map((a) => a.name),
    keeperId: keeper.id,
    cartIds: kids.map((a) => a.id),
  };
});
check("a BACKGROUND grant writes none either — no ledger, no stamp",
  stock.notes === "" && !stock.ledger && !stock.stamped,
  `notes=${JSON.stringify(stock.notes)} ledger=${JSON.stringify(stock.ledger)} stamped=${stock.stamped} `
  + "— the ledger flag and the per-Actor note-id stamp existed only to take a line back off later");
check("...while the cart itself still lands",
  JSON.stringify(stock.carted) === JSON.stringify(["Cart"]),
  `${JSON.stringify(stock.carted)} — the ruling took the NOTES, not the grants`);

/* ---------------------------------------------------------------------------
 * 3a-ii. One option, TWO things: both Actors are still made. (The one line that
 *     used to describe them both went with the rest.)
 * ------------------------------------------------------------------------- */
const pair = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
  const keeper = await ActorImpl.create({ name: "ZZ Bonekeeper", type: "character" });
  const made = await grantContainers(keeper, [
    { name: "Burial Wagon", slots: 6, grantSource: "question:0" },
    { name: "Donkey", slots: 4, grantSource: "question:0" },
  ]);
  return {
    notes: keeper.system.notes, beasts: made.map((a) => a.name).sort(),
    keeperId: keeper.id, madeIds: made.map((a) => a.id),
  };
});
check("one option granting two things makes BOTH", JSON.stringify(pair.beasts) === JSON.stringify(["Burial Wagon", "Donkey"]),
  JSON.stringify(pair.beasts));
check("...and still writes nothing", pair.notes === "", JSON.stringify(pair.notes));

/* ---------------------------------------------------------------------------
 * 3c. A re-rolled question swaps the beast and LEAVES THE NOTES FIELD ALONE.
 *     The field is the player's, so the removal had to be a line never written
 *     rather than a rewrite of what they typed; the fixture types something so
 *     the difference is visible.
 * ------------------------------------------------------------------------- */
const reroll = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const gen = await import("/systems/air-bladder/module/character-generator.js");
  const first = "Rivertooth: Impressively strong. 4 HP. +6 slots.";
  const mine = "<p>The player's own line, which must survive.</p>";
  const keeper = await ActorImpl.create({
    name: "ZZ Rerouted", type: "character", system: { notes: mine },
  });
  await gen.grantContainers(keeper, [{ name: "Rivertooth", grantSource: "question:0" }]);
  const afterFirst = keeper.system.notes;
  // The sheet records the answer, then re-rolls; replaceGrantedContainers reads
  // the OLD answer off the actor, so the probe stands the actor in that state.
  await keeper.update({ "system.questions": [{ question: "What breed?", answer: first, gold: 0 }] });
  await gen.replaceGrantedContainers(keeper, "question:0", [{ name: "Stray Fogger" }]);
  return {
    mine, afterFirst, afterSecond: keeper.system.notes,
    beasts: game.actors.filter((a) => a.system?.connectedTo === keeper.uuid).map((a) => a.name),
    keeperId: keeper.id,
    beastIds: game.actors.filter((a) => a.system?.connectedTo === keeper.uuid).map((a) => a.id),
  };
});
check("a re-roll swaps the beast",
  JSON.stringify(reroll.beasts) === JSON.stringify(["Stray Fogger"]),
  JSON.stringify(reroll.beasts));
check("and the player's own notes survive it, byte for byte",
  reroll.afterFirst === reroll.mine && reroll.afterSecond === reroll.mine,
  `first=${JSON.stringify(reroll.afterFirst)} second=${JSON.stringify(reroll.afterSecond)}`);

/* ---------------------------------------------------------------------------
 * 3d. The one-time removal, across a real RELOAD: a world that already carries
 *     grant bullets loses them, and loses ONLY them.
 *
 *     The fixture is the shape that makes the difference visible — a grant
 *     bullet, the player's OWN bullet in the same list, and their own paragraph
 *     beside it — because the removal deletes the exact html the ledger
 *     recorded and nothing else. A blunt "strip the list" would satisfy a
 *     bullet-count leg while taking their line with it.
 * ------------------------------------------------------------------------- */
const legacy = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const granted = "<strong>Companion: Raven</strong> <em>[Question]</em> — ZZ It remembers.";
  const orphan = "<strong>Transport: Cart</strong> <em>[Background]</em> — ZZ Long gone.";
  const notes = `<p>ZZ My own paragraph.</p><ul><li>${granted}</li>`
    + `<li>ZZ My own bullet.</li><li>${orphan}</li></ul>`;
  const a = await ActorImpl.create({
    name: "ZZ Legacy Notes", type: "character", system: { notes },
    flags: { "air-bladder": { grantNotes: [
      { id: "aaaaaaaaaaaaaaaa", html: granted, names: ["Raven"], source: "question:0" },
      // A record whose things are ALREADY gone: the removal must not care
      // whether anything still answers for a line, only that it wrote it.
      { id: "bbbbbbbbbbbbbbbb", html: orphan, names: ["Cart"], source: "background" },
    ] } },
  });
  // A HAND-EDITED line (review #15). The player rewrote the bullet, so the
  // ledger's recorded html no longer matches what is on the sheet. That miss is
  // intended — the field is theirs — but the first version deleted the whole
  // flag anyway, in the same write that failed to use it: the bullet stayed,
  // nothing was left to find it by, and no later version could ever retry. The
  // matched record must go and the missed one must STAY.
  const editedFrom = "<strong>Companion: Owl</strong> <em>[Bond]</em> — ZZ It watches.";
  const editedTo = "<strong>Companion: Owl</strong> <em>[Bond]</em> — ZZ It watches me sleep.";
  const alsoGranted = "<strong>Transport: Mule</strong> <em>[Background]</em> — ZZ Patient.";
  const edited = await ActorImpl.create({
    name: "ZZ Legacy Edited", type: "character",
    system: { notes: `<ul><li>${editedTo}</li><li>${alsoGranted}</li></ul>` },
    flags: { "air-bladder": { grantNotes: [
      { id: "cccccccccccccccc", html: editedFrom, names: ["Owl"], source: "bond:0" },
      { id: "dddddddddddddddd", html: alsoGranted, names: ["Mule"], source: "background" },
    ] } },
  });
  // And one where NOTHING matches. Its notes must come through byte-identical —
  // but its RECORD must still move off the flag the migration selects on, or
  // the next load meets the same state and warns again, and again, forever.
  const untouched = await ActorImpl.create({
    name: "ZZ Legacy Untouched", type: "character",
    system: { notes: "<ul><li>ZZ Nothing here was ever written by generation.</li></ul>" },
    flags: { "air-bladder": { grantNotes: [
      { id: "eeeeeeeeeeeeeeee", html: editedFrom, names: ["Owl"], source: "bond:0" },
    ] } },
  });
  // An UNLINKED TOKEN that diverged in its NOTES ONLY (review #16). A delta is a
  // sparse overlay merged onto the base actor, so this token's own notes are its
  // own while its LEDGER is still the world actor's. Clear world actors first
  // and the ledger is gone before the token walk looks: it reports no flag, the
  // walk skips it, and this bullet can never be found again.
  const tokenGranted = "<strong>Companion: Toad</strong> <em>[Bond]</em> — ZZ It croaks.";
  const base = await ActorImpl.create({
    name: "ZZ Legacy Token Base", type: "character",
    system: { notes: `<ul><li>${tokenGranted}</li></ul>` },
    flags: { "air-bladder": { grantNotes: [
      { id: "ffffffffffffffff", html: tokenGranted, names: ["Toad"], source: "bond:0" },
    ] } },
  });
  const scene = await CONFIG.Scene.documentClass.create({ name: "ZZ Legacy Scene" });
  const [tok] = await scene.createEmbeddedDocuments("Token", [{
    name: "ZZ Legacy Token", actorId: base.id, actorLink: false, x: 0, y: 0,
  }]);
  // The divergence: the player added a line to THIS token's copy. Written
  // through the synthetic actor, so it lands in the delta and nowhere else.
  await tok.actor.update({
    "system.notes": `<ul><li>${tokenGranted}</li><li>ZZ The token's own line.</li></ul>`,
  });
  // And one that diverged in NOTHING. The world batch reaches it through its
  // base actor, so the token walk must leave it alone rather than write the
  // same text into its delta — that would MINT an override, pinning this
  // token's notes away from the actor they still follow.
  const [plain] = await scene.createEmbeddedDocuments("Token", [{
    name: "ZZ Legacy Plain Token", actorId: a.id, actorLink: false, x: 200, y: 0,
  }]);
  return {
    id: a.id, before: a.system.notes,
    ledger: (a.getFlag("air-bladder", "grantNotes") ?? []).length,
    editedId: edited.id, editedBefore: edited.system.notes,
    untouchedId: untouched.id, untouchedBefore: untouched.system.notes,
    tokenBaseId: base.id, sceneId: scene.id, tokenId: tok.id,
    tokenBefore: tok.actor.system.notes,
    tokenDeltaKeys: Object.keys(tok.delta._source.system ?? {}),
    tokenDeltaHasLedger: tok.delta._source.flags?.["air-bladder"]?.grantNotes !== undefined,
    tokenSeesLedger: (tok.actor.getFlag("air-bladder", "grantNotes") ?? []).length,
    plainTokenId: plain.id,
    plainDeltaKeys: Object.keys(plain.delta._source.system ?? {}),
  };
});
check("the legacy fixture really carries bullets and a ledger",
  legacy.ledger === 2 && (legacy.before.match(/<li>/g) ?? []).length === 3,
  `ledger=${legacy.ledger} bullets=${(legacy.before.match(/<li>/g) ?? []).length}`);
check("and the hand-edited fixture's recorded line really does NOT match the sheet",
  legacy.editedBefore.includes("ZZ It watches me sleep.")
  && !legacy.editedBefore.includes("ZZ It watches.</strong>"),
  "or the leg below would pass for the wrong reason");
// The precondition that makes the token leg mean anything: its notes must be
// the DELTA'S and its ledger must NOT be. A delta that happened to carry the
// flag too would be found whatever order the migration ran in, and the leg
// would pass while the defect stood.
check("the unlinked token's notes are its own while its ledger is the world actor's",
  legacy.tokenDeltaKeys.includes("notes") && legacy.tokenDeltaHasLedger === false
  && legacy.tokenSeesLedger === 1 && legacy.tokenBefore.includes("ZZ The token's own line."),
  `delta system keys ${JSON.stringify(legacy.tokenDeltaKeys)}, delta carries ledger `
  + `${legacy.tokenDeltaHasLedger}, token sees ${legacy.tokenSeesLedger} record(s)`);

console.log("  note  reloading, so the ready-hook removal runs for real");
const removalLog = [];
const leftoverLog = [];
page.on("console", (m) => {
  if (/removed \d+ grant note\(s\) from \d+ character/.test(m.text())) removalLog.push(m.text());
  if (/recorded line no longer matches/.test(m.text())) leftoverLog.push(m.text());
});
await page.reload({ waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
await dismissChrome(page);
// The migrations are awaited phases inside the ready hook, not part of `ready`
// itself, so game.ready can be true a beat before they have written.
await page.waitForTimeout(3000);

const swept = await page.evaluate((id) => {
  const a = game.actors.get(id);
  return { notes: a.system.notes, ledger: a.getFlag("air-bladder", "grantNotes") ?? null };
}, legacy.id);
check("both grant bullets are gone", !swept.notes.includes("ZZ It remembers.")
  && !swept.notes.includes("ZZ Long gone."),
  JSON.stringify(swept.notes));
check("the player's own bullet and paragraph are untouched",
  swept.notes.includes("<li>ZZ My own bullet.</li>")
  && swept.notes.includes("<p>ZZ My own paragraph.</p>"),
  `${JSON.stringify(swept.notes)} — the removal deletes the exact html the ledger recorded, so a line a `
  + "player has since edited by hand would not match and would stay, which is the right way round for a "
  + "field they own");
check("and the ledger flag is unset", swept.ledger === null || swept.ledger === undefined,
  JSON.stringify(swept.ledger));
check("the removal named itself as the writer", removalLog.length > 0,
  removalLog[0] ?? "nothing logged — something else emptied the notes");

// Review #15: the miss is intended, losing the record of it is not.
const missed = await page.evaluate(({ editedId, untouchedId }) => {
  const e = game.actors.get(editedId);
  const u = game.actors.get(untouchedId);
  return {
    editedNotes: e.system.notes,
    editedLedger: e.getFlag("air-bladder", "grantNotes") ?? null,
    editedKept: e.getFlag("air-bladder", "grantNotesUnmatched") ?? null,
    untouchedNotes: u.system.notes,
    untouchedLedger: u.getFlag("air-bladder", "grantNotes") ?? null,
    untouchedKept: u.getFlag("air-bladder", "grantNotesUnmatched") ?? null,
  };
}, legacy);
check("a hand-edited line stays on the sheet, as it should",
  missed.editedNotes.includes("ZZ It watches me sleep."), JSON.stringify(missed.editedNotes));
check("its neighbour that DID match went",
  !missed.editedNotes.includes("ZZ Patient."), JSON.stringify(missed.editedNotes));
check("and ONLY the record that missed is kept — the bullet stays findable",
  Array.isArray(missed.editedKept) && missed.editedKept.length === 1
  && missed.editedKept[0]?.names?.[0] === "Owl",
  `${JSON.stringify(missed.editedKept)} — dropping it outright leaves a bullet nothing can ever `
  + "find again: no marker, no flag, and a console line reporting success");
check("an actor where nothing matched keeps its notes byte-identical",
  missed.untouchedNotes === legacy.untouchedBefore,
  missed.untouchedNotes === legacy.untouchedBefore ? "" : `CHANGED to ${JSON.stringify(missed.untouchedNotes)}`);
check("and its record is kept too, so a total miss is reported rather than skipped",
  Array.isArray(missed.untouchedKept) && missed.untouchedKept.length === 1,
  JSON.stringify(missed.untouchedKept));
// Review #16: kept, but NOT on the flag this migration selects on. Leaving it
// there is what made the warning permanent — and its own advice could not stop
// it, since deleting the line by hand is exactly what makes a match impossible.
check("both records move OFF the selector, or nothing can ever be terminal",
  (missed.editedLedger === null || missed.editedLedger === undefined)
  && (missed.untouchedLedger === null || missed.untouchedLedger === undefined),
  `edited ${JSON.stringify(missed.editedLedger)}, untouched ${JSON.stringify(missed.untouchedLedger)}`);
check("and both are NAMED in a warning, or nobody ever learns", leftoverLog.length > 0
  && leftoverLog[0].includes("ZZ Legacy Edited") && leftoverLog[0].includes("ZZ Legacy Untouched"),
  leftoverLog[0] ?? "nothing warned — a silent miss is the whole defect");

// The unlinked token, whose ledger lived on the world actor while its notes did
// not. Ordered wrong, the world batch clears that ledger first and this token is
// simply never seen again.
const tokenSwept = await page.evaluate(({ sceneId, tokenId, plainTokenId }) => {
  const scene = game.scenes.get(sceneId);
  const t = scene?.tokens.get(tokenId);
  const p = scene?.tokens.get(plainTokenId);
  return {
    notes: t?.actor?.system?.notes ?? null,
    ledger: t?.actor?.getFlag("air-bladder", "grantNotes") ?? null,
    plainNotes: p?.actor?.system?.notes ?? null,
    plainDeltaKeys: Object.keys(p?.delta?._source?.system ?? {}),
  };
}, legacy);
check("an unlinked token's own notes lose the bullet too",
  typeof tokenSwept.notes === "string" && !tokenSwept.notes.includes("ZZ It croaks."),
  `${JSON.stringify(tokenSwept.notes)} — the delta carries the notes and the base actor carries the `
  + "ledger, so clearing the base first makes this token unreachable for good");
check("and the line the token's own player added survives",
  (tokenSwept.notes ?? "").includes("ZZ The token's own line."), JSON.stringify(tokenSwept.notes));
check("a token that diverged in nothing is cleaned through its base, not overridden",
  !(tokenSwept.plainNotes ?? "x").includes("ZZ It remembers.")
  && tokenSwept.plainDeltaKeys.length === 0,
  `notes ${JSON.stringify(tokenSwept.plainNotes)}, delta system keys `
  + `${JSON.stringify(tokenSwept.plainDeltaKeys)} — writing here would pin this token's notes away `
  + "from the actor they still follow, to say what that actor is about to say anyway");

/* ---------------------------------------------------------------------------
 * 3e. And it has to be able to STOP (review #16). A migration whose warning
 *     repeats on every load for the life of the world is not finished; it is
 *     just loud. Reload a second time on the swept state: nothing may be said
 *     again, and what missed must still be there to read.
 * ------------------------------------------------------------------------- */
const warnedOnce = leftoverLog.length;
console.log("  note  reloading a SECOND time, on the state the first pass left");
await page.reload({ waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
await dismissChrome(page);
await page.waitForTimeout(3000);
check("the leftovers warning is not repeated on the next load",
  leftoverLog.length === warnedOnce,
  `said ${leftoverLog.length - warnedOnce} more time(s) — ${leftoverLog[warnedOnce] ?? ""}`);
const kept = await page.evaluate(({ editedId }) => {
  const e = game.actors.get(editedId);
  return { kept: e.getFlag("air-bladder", "grantNotesUnmatched") ?? null };
}, legacy);
check("and what missed is still readable afterwards, or silence is just forgetting",
  Array.isArray(kept.kept) && kept.kept[0]?.names?.[0] === "Owl", JSON.stringify(kept.kept));

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
      const returned = await grantContainers(pc, [
        { name: "Raven Familiar", grantSource: "background" },
      ]);
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
        // Her CHARACTER's notes. She owns the PC, so this write is hers to make
        // — the socket only ever brokers the Actor she cannot create.
        notes: pc.system.notes ?? null,
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
check("a PLAYER's own character gets no bullet either", alice.notes === "",
  `notes=${JSON.stringify(alice.notes)} — the write ran on HER client, before the fork to the broker, so `
  + "the player path is where a surviving copy of it would hide");

/* ----------------------------------------------------------- teardown ---- */
const cleaned = await page.evaluate(async ({ ids, grantIds, ravenId, rerollIds, sceneId }) => {
  // The scene goes FIRST, so its unlinked token is never left pointing at an
  // actor this loop has already deleted.
  await game.scenes.get(sceneId)?.delete();
  for (const id of [ids.legacyId, grantIds.falconId, grantIds.keeperId, ravenId, ...rerollIds].filter(Boolean)) {
    await game.actors.get(id)?.delete();
  }
  const witch = game.actors.getName("ZZ Witch");
  await witch?.delete();
  // Asserted, not assumed: this run is the first to plant a SCENE, and a scene
  // left behind is clutter in someone's real world rather than a stray actor
  // the next run overwrites.
  return { scenesLeft: game.scenes.filter((s) => s.name.startsWith("ZZ ")).length };
}, {
  ids: role.ids, grantIds: grant.ids, ravenId: alice.ravenId ?? null,
  sceneId: legacy.sceneId,
  rerollIds: [
    reroll.keeperId, ...(reroll.beastIds ?? []),
    stock.keeperId, ...(stock.cartIds ?? []),
    pair.keeperId, ...(pair.madeIds ?? []),
    legacy.id, legacy.editedId, legacy.untouchedId, legacy.tokenBaseId,
  ],
});

check("the fixture scene is gone again", cleaned.scenesLeft === 0,
  `${cleaned.scenesLeft} ZZ scene(s) still in the world`);

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(failures ? `\ncompanions e2e FAILED — ${failures}` : "\ncompanions e2e passed");
process.exit(failures ? 1 : 0);

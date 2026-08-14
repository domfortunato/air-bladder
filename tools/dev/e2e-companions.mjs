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
check("a QUESTION's grant writes NO bullet", grant.notes === "",
  `keeper notes=${JSON.stringify(grant.notes)} — user ruling 2026-08-13. applyChoiceTables stores `
  + "`answer: opt.description` and hands the spec `grantNote: opt.description`, the SAME string, so a "
  + "bullet here is a verbatim second copy of what already prints under QUESTIONS");
check("and not on the beast", !grant.beastNotes,
  `beast notes=${JSON.stringify(grant.beastNotes)} — its own description already carries the same words`);

/* ---------------------------------------------------------------------------
 * 3a. A grant the BACKGROUND makes outright — Mountebank's cart — states no
 *     prose of its own. It still gets a bullet, off the pack document's stock
 *     description; "Transport: Cart" alone tells a player less than the
 *     compendium already knows.
 * ------------------------------------------------------------------------- */
const stock = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
  const keeper = await ActorImpl.create({ name: "ZZ Mountebank", type: "character" });
  await grantContainers(keeper, [{ name: "Cart", slots: 4, grantSource: "background" }]);
  const doc = (await game.packs.get("air-bladder.mounts-transports").getDocuments())
    .find((d) => d.name === "Cart");
  return {
    notes: keeper.system.notes,
    stockProse: doc?.system.description ?? null,
    keeperId: keeper.id,
    cartIds: game.actors.filter((a) => a.system?.connectedTo === keeper.uuid).map((a) => a.id),
  };
});
check("a BACKGROUND's grant still writes one, off STOCK prose",
  stock.notes === `<ul><li><strong>Transport: Cart</strong> <em>[Background]</em> — ${stock.stockProse}</li></ul>`,
  `notes=${JSON.stringify(stock.notes)} — Mountebank's cart has no option text and appears under no question, `
  + "so this line is the only place a player reads it. It is also the POSITIVE CONTROL for the suppression "
  + "above: bullets still land, and they land on the CHARACTER");

/* ---------------------------------------------------------------------------
 * 3a-ii. One option, TWO things, ONE line. The Bonekeeper's burial wagon "came
 *     with a stubborn old donkey" — both Actors are made, but the sentence that
 *     describes them both is printed once, filed under the Transport.
 * ------------------------------------------------------------------------- */
const pair = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
  const prose = "A burial wagon (+6 slots, slow) from your last job. It came with a stubborn old donkey (+4 slots, only +2 slots if pulling wagon).";
  const keeper = await ActorImpl.create({ name: "ZZ Bonekeeper", type: "character" });
  const made = await grantContainers(keeper, [
    { name: "Burial Wagon", slots: 6, grantSource: "question:0", grantNote: prose },
    { name: "Donkey", slots: 4, grantSource: "question:0", grantNote: prose },
  ]);
  // The ONE-OPTION-ONE-LINE rule, asserted on grantLines itself with a source
  // that still writes. Shipped question content can no longer reach the grouping
  // (its lines are suppressed), but a background may carry authored prose on a
  // container spec, and the rule is the same there.
  const { grantLines } = await import("/systems/air-bladder/module/grant-notes.js");
  const lines = grantLines([
    { role: "companion", cls: "donkey", source: "background", prose, name: "Donkey" },
    { role: "transport", cls: "wagon", source: "background", prose, name: "Burial Wagon" },
  ]);
  return {
    prose, notes: keeper.system.notes, beasts: made.map((a) => a.name).sort(),
    bullets: (keeper.system.notes.match(/<li>/g) ?? []).length,
    grouped: lines.length,
    groupedHead: lines[0]?.html.match(/<strong>([^<]*)<\/strong>/)?.[1] ?? null,
    groupedNames: (lines[0]?.names ?? []).slice().sort(),
    keeperId: keeper.id, madeIds: made.map((a) => a.id),
  };
});
check("one option granting two things makes BOTH", JSON.stringify(pair.beasts) === JSON.stringify(["Burial Wagon", "Donkey"]),
  JSON.stringify(pair.beasts));
check("...and the question writes no line for either", pair.bullets === 0 && pair.notes === "",
  `notes=${JSON.stringify(pair.notes)} — the answer prints that sentence under QUESTIONS already`);
check("shared prose is still ONE line, filed under the Transport", pair.grouped === 1
  && pair.groupedHead === "Transport: Wagon" && JSON.stringify(pair.groupedNames) === JSON.stringify(["Burial Wagon", "Donkey"]),
  `lines=${pair.grouped} head=${JSON.stringify(pair.groupedHead)} — asserted on grantLines directly, with the `
  + "source a background: a bullet each printed the same sentence twice, and the rule survives the ruling "
  + "above even though shipped question content no longer reaches it");

/* ---------------------------------------------------------------------------
 * 3b. ...and the prose reaching grantContainers is the OPTION'S OWN. The roll
 *     is random; the assertion is not — every container spec must carry the
 *     description of the answer applyChoiceTables recorded for that question.
 * ------------------------------------------------------------------------- */
const prose = await page.evaluate(async () => {
  const { applyChoiceTables } = await import("/systems/air-bladder/module/character-generator.js");
  const bg = (await game.packs.get("air-bladder.backgrounds-2e").getDocuments())
    .find((d) => d.name === "Outrider");
  if (!bg) return { error: "no Outrider in backgrounds-2e" };
  const out = await applyChoiceTables(bg);
  return {
    granted: out.containers.length,
    matched: out.containers.every((c) => {
      const idx = Number(String(c.grantSource).split(":")[1]);
      return !!c.grantNote && c.grantNote === out.questions[idx]?.answer;
    }),
    sample: out.containers[0]?.grantNote ?? null,
  };
});
check("a question's container carries THAT option's words — the same string as the ANSWER", !prose.error
  && prose.granted >= 1 && prose.matched,
  prose.error ?? `granted=${prose.granted} sample=${JSON.stringify(prose.sample)} — this equality is what `
  + "licenses the suppression above. If it ever stops holding, a question grant carries prose the sheet does "
  + "NOT print and suppressing its line would lose it, so this leg guards that ruling as much as the grant");

/* ---------------------------------------------------------------------------
 * 3c. A re-rolled question SWAPS the bullet. Without the prune the character
 *     accumulates a line about every horse they were ever briefly promised,
 *     and the beast those lines describe was deleted with the re-roll.
 * ------------------------------------------------------------------------- */
const reroll = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const gen = await import("/systems/air-bladder/module/character-generator.js");
  const first = "Rivertooth: Impressively strong. 4 HP. +6 slots.";
  const second = "Stray Fogger: Wild but very fast. 4 HP. +2 slots.";
  const keeper = await ActorImpl.create({
    name: "ZZ Rerouted", type: "character",
    system: { notes: "<p>The player's own line, which must survive.</p>" },
  });
  await gen.grantContainers(keeper, [{ name: "Rivertooth", grantSource: "question:0", grantNote: first }]);
  const afterFirst = keeper.system.notes;
  // The sheet records the answer, then re-rolls; replaceGrantedContainers reads
  // the OLD answer off the actor, so the probe stands the actor in that state.
  await keeper.update({ "system.questions": [{ question: "What breed?", answer: first, gold: 0 }] });
  await gen.replaceGrantedContainers(keeper, "question:0",
    [{ name: "Stray Fogger", grantNote: second }]);
  const afterSecond = keeper.system.notes;
  const beasts = game.actors.filter((a) => a.system?.connectedTo === keeper.uuid).map((a) => a.name);
  return {
    first, second, afterFirst, afterSecond, beasts,
    keptPlayerLine: afterSecond.includes("The player's own line, which must survive."),
    keeperId: keeper.id,
    beastIds: game.actors.filter((a) => a.system?.connectedTo === keeper.uuid).map((a) => a.id),
  };
});
check("a re-roll swaps the beast and writes no line either way",
  !reroll.afterFirst.includes("<li>") && !reroll.afterSecond.includes("<li>")
  && JSON.stringify(reroll.beasts) === JSON.stringify(["Stray Fogger"]),
  `first=${JSON.stringify(reroll.afterFirst)} second=${JSON.stringify(reroll.afterSecond)} `
  + `beasts=${JSON.stringify(reroll.beasts)} — both answers print under QUESTIONS, so neither is repeated here`);
check("the player's own notes survive it", reroll.keptPlayerLine
  && reroll.afterSecond === "<p>The player's own line, which must survive.</p>",
  `notes=${JSON.stringify(reroll.afterSecond)} — untouched, byte for byte; the suppression must be `
  + "a line never written, never a rewrite of the field");

/* ---------------------------------------------------------------------------
 * 3d. The line is removed BY THE DELETE, not by the path that caused it — so a
 *     Warden deleting the beast straight out of the directory cleans up too,
 *     and half a pair keeps the sentence that describes them both.
 * ------------------------------------------------------------------------- */
const gone = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
  const prose = "A burial wagon (+6 slots, slow). It came with a stubborn old donkey.";
  const keeper = await ActorImpl.create({ name: "ZZ Deleter", type: "character" });
  // BACKGROUND-sourced, so a line is actually written: with a question source
  // there would be nothing to prune and every assertion below would pass on an
  // empty string — green for the wrong reason, which is the failure mode this
  // file exists to avoid.
  const made = await grantContainers(keeper, [
    { name: "Burial Wagon", slots: 6, grantSource: "background", grantNote: prose },
    { name: "Donkey", slots: 4, grantSource: "background", grantNote: prose },
  ]);
  const written = keeper.system.notes;
  const ledger = (keeper.getFlag("air-bladder", "grantNotes") ?? []).length;
  // Half the pair: the sentence describes both, so it stays.
  await made.find((a) => a.name === "Donkey").delete();
  const afterHalf = keeper.system.notes;
  await made.find((a) => a.name === "Burial Wagon").delete();
  return {
    written, ledger, afterHalf, afterBoth: keeper.system.notes,
    ledgerAfter: (keeper.getFlag("air-bladder", "grantNotes") ?? []).length,
    keeperId: keeper.id,
  };
});
check("a ledger records what was written", gone.ledger === 1 && gone.written.includes("<li>"),
  `ledger=${gone.ledger} written=${JSON.stringify(gone.written)} — removal reads what WAS written, never a `
  + "recomputation of it; a format change must not orphan a line. The written check is explicit because an "
  + "empty note would satisfy every prune assertion below by accident");
check("deleting half a pair keeps the line", gone.afterHalf === gone.written,
  `notes=${JSON.stringify(gone.afterHalf)} — the sentence describes both`);
check("deleting the rest takes the line and the record", gone.afterBoth === "" && gone.ledgerAfter === 0,
  `notes=${JSON.stringify(gone.afterBoth)} ledger=${gone.ledgerAfter} — a Warden deleting the beast from the directory travels the same seam as a re-roll`);

/* ---------------------------------------------------------------------------
 * 3e. A record is joined to its things by ID, not by NAME (review #14). Two
 *     failures, mirror images of each other, both invisible while every fixture
 *     keeps the name it was minted with — which is why this section renames one
 *     and duplicates another instead of testing the happy path again.
 * ------------------------------------------------------------------------- */
const renamed = await page.evaluate(async () => {
  const ActorImpl = CONFIG.Actor.documentClass;
  const { grantContainers } = await import("/systems/air-bladder/module/character-generator.js");
  const r = {};

  // Two SEPARATE records — different prose, so neither line speaks for the
  // other. 3d above already covers one sentence covering a pair.
  const keeper = await ActorImpl.create({ name: "ZZ Renamer", type: "character" });
  const made = await grantContainers(keeper, [
    { name: "Cart", slots: 4, grantSource: "background", grantNote: "ZZ A serviceable cart." },
    { name: "Mule", slots: 4, grantSource: "background", grantNote: "ZZ A stubborn mule." },
  ]);
  const cart = made.find((a) => a.name === "Cart");
  const mule = made.find((a) => a.name === "Mule");
  r.stamped = made.every((a) => /^[a-zA-Z0-9]{16}$/.test(String(a.getFlag("air-bladder", "grantNoteId") ?? "")));
  r.distinct = new Set(made.map((a) => a.getFlag("air-bladder", "grantNoteId"))).size;
  r.ledger = (keeper.getFlag("air-bladder", "grantNotes") ?? []).length;

  await cart.update({ name: "ZZ Bessie" });   // an ordinary rename, the player's to make
  await mule.delete();                        // ...and an unrelated deletion, which prunes

  const after = keeper.system.notes ?? "";
  r.cartAlive = !!game.actors.get(cart.id);
  r.keptCart = after.includes("ZZ A serviceable cart.");
  r.droppedMule = !after.includes("ZZ A stubborn mule.");
  r.ledgerAfter = (keeper.getFlag("air-bladder", "grantNotes") ?? []).length;
  r.after = after;

  // The mirror image: two things SHARING a name under one source. A live "Ox"
  // answers a name match for both records, so under names neither line is ever
  // pruned and the dead one's bullet outlives it.
  const twin = await ActorImpl.create({ name: "ZZ Twins", type: "character" });
  const oxen = await grantContainers(twin, [
    { name: "Ox", slots: 4, grantSource: "background", grantNote: "ZZ The near ox." },
    { name: "Ox", slots: 4, grantSource: "background", grantNote: "ZZ The off ox." },
  ]);
  r.twinLedger = (twin.getFlag("air-bladder", "grantNotes") ?? []).length;
  // WHICH ox is deleted is deliberately not asserted — a batched create returns
  // its documents in id order, so picking "the first" picks a coin flip.
  await oxen[0].delete();
  r.twinBullets = ((twin.system.notes ?? "").match(/<li>/g) ?? []).length;
  r.twinLedgerAfter = (twin.getFlag("air-bladder", "grantNotes") ?? []).length;
  r.twinAfter = twin.system.notes ?? "";

  r.keeperId = keeper.id;
  r.twinId = twin.id;
  r.leftIds = [cart.id, ...oxen.map((a) => a.id)];
  return r;
});
check("every granted thing is stamped with its record", renamed.stamped && renamed.distinct === 2,
  `stamped=${renamed.stamped} distinct ids=${renamed.distinct} of 2 — the join is the id, so a grant that `
  + "arrives without one has a line nothing can ever take back");
check("renaming a grant does not orphan its line", renamed.keptCart && renamed.cartAlive,
  `cart alive=${renamed.cartAlive} notes=${JSON.stringify(renamed.after)} — "Cart" became "ZZ Bessie", which `
  + "is the player's to do; under the name match her line vanished when the mule beside her died");
check("...while the sibling's deletion still takes the sibling's",
  renamed.droppedMule && renamed.ledgerAfter === 1 && renamed.ledger === 2,
  `ledger ${renamed.ledger} -> ${renamed.ledgerAfter} notes=${JSON.stringify(renamed.after)}`);
check("two things sharing a name are not each other",
  renamed.twinLedger === 2 && renamed.twinBullets === 1 && renamed.twinLedgerAfter === 1,
  `ledger ${renamed.twinLedger} -> ${renamed.twinLedgerAfter} bullets=${renamed.twinBullets} `
  + `notes=${JSON.stringify(renamed.twinAfter)} — a surviving "Ox" answered for the dead one under names`);

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
      const prose = "Raven Familiar: it remembers what you cannot. 2 HP. +0 slots.";
      // BACKGROUND-sourced: a question's line is suppressed by ruling, and the
      // claim under test here is that the note is written on HER client at all,
      // which an empty string could never show.
      const returned = await grantContainers(pc, [
        { name: "Raven Familiar", grantSource: "background", grantNote: prose },
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
        prose,
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
check("a PLAYER's own character gets the bullet",
  alice.notes === `<ul><li><strong>Companion: Raven</strong> <em>[Background]</em> — ${alice.prose}</li></ul>`,
  `notes=${JSON.stringify(alice.notes)} — written on HER client, before the fork to the broker; nothing about it crosses the socket`);

/* ----------------------------------------------------------- teardown ---- */
await page.evaluate(async ({ ids, grantIds, ravenId, rerollIds }) => {
  for (const id of [ids.legacyId, grantIds.falconId, grantIds.keeperId, ravenId, ...rerollIds].filter(Boolean)) {
    await game.actors.get(id)?.delete();
  }
  const witch = game.actors.getName("ZZ Witch");
  await witch?.delete();
}, {
  ids: role.ids, grantIds: grant.ids, ravenId: alice.ravenId ?? null,
  rerollIds: [
    reroll.keeperId, ...(reroll.beastIds ?? []),
    stock.keeperId, ...(stock.cartIds ?? []),
    pair.keeperId, ...(pair.madeIds ?? []),
    gone.keeperId,
    renamed.keeperId, renamed.twinId, ...(renamed.leftIds ?? []),
  ],
});

const errs = errors.filter((e) => !/ZZ /.test(e));
check("zero console errors", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(failures ? `\ncompanions e2e FAILED — ${failures}` : "\ncompanions e2e passed");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * `system.role` — the one discriminator on the NPC sheet (docs/npc-roles-plan.md).
 *
 * Role replaced the For Hire and Inanimate checkboxes: transport/container hide
 * the stat block (HP, STR/DEX/WIL, Armor, Deprived/Panicked, the Rest / Restore /
 * Die-of-Fate buttons and every derived condition) while KEEPING the name,
 * inventory and tabs; only a FOR-HIRE npc shows the day rate; monster loses the
 * Connections tab outright. Since Round 2, GOLD follows the role too: mounts and
 * things hide the counter while the stored value survives.
 *
 * Things here that are correctness, not cosmetics:
 *
 * 1. **The derived conditions.** `_computeStatContext` reads `dead = STR <= 0`,
 *    which is exactly the value a crate sits at, so without the isThing guard the
 *    sheet announces that a barrel is Dead, Paralyzed and Delirious at once.
 *
 * 2. **The role select must not be one-way.** It is deliberately OUTSIDE every
 *    block it hides — pick Container and the select must survive to pick back.
 *
 * 3. **The FLAT graph and the cap (2026-08-01).** Keeping is a TYPE privilege:
 *    only a character keeps, so every edge runs PC → non-character and the
 *    npc→npc nesting Round 2 allowed is refused at connect time. ONE upward
 *    link ever (connectActor itself refuses a connected target — the picker
 *    filter alone never covered a drop), at most `maxConnections()` children
 *    per keeper counting every role, and ownership follows a PC → NPC connect
 *    while a PC child's is never touched.
 *
 * 4. **The conditional tab resets tabGroups.** Standing on Connections and
 *    switching the role to Monster removes the tab under you — the sheet must
 *    land on a rendered tab, not a blank body.
 *
 * 5. **Tab ORDER (2026-08-01).** Description leads the npc sheet — nav, panels
 *    AND the tab a fresh sheet opens on, which takes a `tabGroups` override
 *    because core seeds the group from static TABS at construction. The
 *    character sheet still leads with Items; that leg is what stops a
 *    "reorder both" regression, and it doubles as the order-reader's
 *    differential witness.
 *
 * 6. **Both directions, either end — ONE verb, player-usable (2026-08-01).**
 *    A connected actor's tab shows its upward keeper as a line breakable from
 *    the child end; an unconnected connectable shows Connect (attach ME).
 *    Connect/break is the Warden's always, or the OWNER OF BOTH ENDS' — so
 *    the player leg INVERTED: Alice's direct calls on her own pair now land
 *    end-to-end (link written, sync flag relayed, the GM client answering
 *    with the exact ownership shape), and the fail-witness became the
 *    one-end-foreign differential — a sack she does not own refuses her,
 *    which only the both-ends term can be refusing.
 *
 * Drives the real select so `submitOnChange` commits it the way a user does.
 *
 * NEGATIVE CONTROLS, in-page: `_computeStatContext` runs with the actor's
 * `isThing` shadowed false for the duration of the call — a zero-STR container
 * must then show the Dead banner again. The header-gap leg restores the pre-fix
 * `margin-top: 2px` inline and the dead band between HP/Gold and STR/Armor must
 * come back, or the flush-foot assertion is not load-bearing.
 *
 * Usage: npm run dev:roles   (establishes Alice itself if dev:players has not run)
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

let failed = false;
const ok = (m, d = "") => console.log(`  ok    ${m.padEnd(44)} ${d}`);
const bad = (m, d = "") => { console.error(`  FAIL  ${m.padEnd(44)} ${d}`); failed = true; };

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
watchdog(360000, "dev:roles");
await joinAsGM(page);
await dismissChrome(page);

/** Everything the sheet is or is not showing, read from the live DOM. */
const READ = `(sheet) => {
  const el = sheet.element;
  const vis = (sel) => {
    const n = el.querySelector(sel);
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  return {
    hp:        vis('input[name="system.hp.value"]'),
    str:       vis('input[name="system.abilities.STR.value"]'),
    armor:     vis('.armor-counter'),
    deprived:  vis('.deprived-check'),
    restBtn:   vis('#rest-button'),
    dieOfFate: vis('#die-of-fate-button'),
    gold:      vis('input[name="system.gold"]'),
    roleSelect: vis('.role-select'),
    career:    vis('input[name="system.profession"]'),
    kind:      vis('input[name="system.containerClass"]'),
    dayRate:   vis('.day-rate-line'),
    itemsTab:  vis('[data-tab="items"]'),
    connectionsTab: vis('a[data-tab="containers"]'),
    banners:   [...el.querySelectorAll('.status-banner')].map((b) => b.className),
    visiblePanels: [...el.querySelectorAll('.tab[data-tab]')].filter((p) => {
      const r = p.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length,
  };
}`;

/** Drive the role select the way a user does; submitOnChange commits it. */
const PICK_ROLE = `async (sheet, role) => {
  const sel = sheet.element.querySelector('.role-select');
  if (!sel) return false;
  sel.value = role;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1400));
  return true;
}`;

try {
  // A prior aborted run must not satisfy (or trip) this one's assertions.
  await page.evaluate(async () => {
    for (const a of game.actors.filter((x) => x.name.startsWith("ZZ Roles"))) await a.delete();
  });

  const out = await page.evaluate(async ({ READ, PICK_ROLE }) => {
    const read = eval(READ);
    const pickRole = eval(PICK_ROLE);
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const a = await Cls.create({
      name: "ZZ Roles Probe",
      type: "npc",
      // Zeroed on purpose: this is the state that makes the derived conditions
      // fire, so a crate at 0/0/0 is the case that matters. A FOR-HIRE PERSON
      // first: review #5 found the day-rate row outliving the control that
      // reveals it when the old checkboxes crossed, so this probe starts as
      // someone with a rate and turns into a thing — the exact sequence that
      // stranded the row.
      system: { abilities: { STR: { value: 0, max: 0 }, DEX: { value: 0, max: 0 }, WIL: { value: 0, max: 0 } }, gold: 25, role: "npc", forHire: true, dayRate: 5 },
    });
    const sheet = a.sheet;
    await sheet.render(true);
    await sleep(900);

    const asPerson = read(sheet);

    if (!(await pickRole(sheet, "container"))) return { error: "no .role-select on the sheet" };
    const asThing = read(sheet);
    const storedOn = a.system.role;
    const goldStoredAsThing = a.system.gold;

    // A mount is a CREATURE with no purse: stat block stays, Gold goes.
    await pickRole(sheet, "mount");
    const asMount = read(sheet);
    const storedMount = a.system.role;

    // And back again — the one-way trap.
    const reachable = !!sheet.element.querySelector(".role-select");
    await pickRole(sheet, "npc");
    const backAgain = read(sheet);
    const storedOff = a.system.role;
    const goldStoredBack = a.system.gold;

    await sheet.close();
    await a.delete();
    return { asPerson, asThing, asMount, backAgain, storedOn, storedMount, storedOff, goldStoredAsThing, goldStoredBack, reachable };
  }, { READ, PICK_ROLE });

  if (out.error) throw new Error(out.error);
  const { asPerson, asThing, asMount, backAgain } = out;

  console.log("\na hireling keeps its stat block, career and day rate");
  asPerson.hp && asPerson.str && asPerson.armor && asPerson.restBtn
    ? ok("HP, STR, Armor and Rest all present")
    : bad("HP, STR, Armor and Rest all present", JSON.stringify(asPerson));
  asPerson.career && asPerson.dayRate && asPerson.gold
    ? ok("career, day-rate and Gold rows show", "the hidden-state assertions below can fail")
    : bad("career, day-rate and Gold rows show", JSON.stringify(asPerson));
  asPerson.banners.length
    ? ok("zeroed abilities raise banners", `${asPerson.banners.length} banner(s)`)
    : bad("zeroed abilities raise banners", "none — the control case cannot fail");

  console.log("\npicking Container drops the stat block");
  out.storedOn === "container"
    ? ok("the select committed through submitOnChange", "system.role = container")
    : bad("the select committed through submitOnChange", `stored ${JSON.stringify(out.storedOn)}`);
  !asThing.hp && !asThing.str && !asThing.armor && !asThing.deprived
    ? ok("HP, STR, Armor, Deprived all gone")
    : bad("HP, STR, Armor, Deprived all gone", JSON.stringify(asThing));
  !asThing.restBtn && !asThing.dieOfFate
    ? ok("Rest and Die of Fate gone", "a crate does not rest")
    : bad("Rest and Die of Fate gone", JSON.stringify(asThing));
  asThing.banners.length === 0
    ? ok("no Dead/Paralyzed/Delirious banner", "derived conditions suppressed")
    : bad("no Dead/Paralyzed/Delirious banner", asThing.banners.join(" | "));

  console.log("\nwhat a thing KEEPS, and what follows the role");
  // Round 2 FLIPPED this leg: Gold used to be asserted visible on a thing ("a
  // chest holds coins"). The counter now hides with the role — but the VALUE
  // must survive the trip, because hiding a purse is not emptying it.
  !asThing.gold && out.goldStoredAsThing === 25
    ? ok("Gold hides on a thing, the value survives", "25gp still stored")
    : bad("Gold hides on a thing, the value survives", `visible=${asThing.gold} stored=${out.goldStoredAsThing}`);
  asThing.itemsTab && asThing.visiblePanels === 1
    ? ok("inventory intact, exactly one panel visible", `${asThing.visiblePanels}`)
    : bad("inventory intact, exactly one panel visible", JSON.stringify(asThing));
  !asThing.career && !asThing.dayRate
    ? ok("career and day rate go with the role", "no orphaned rate on a crate")
    : bad("career and day rate go with the role", JSON.stringify(asThing));
  asThing.kind && !asPerson.kind
    ? ok("the Kind field rides the container role", "absent on a hireling, present on a thing")
    : bad("the Kind field rides the container role", JSON.stringify({ thing: asThing.kind, hireling: asPerson.kind }));

  console.log("\na mount is a creature with no purse");
  out.storedMount === "mount" && asMount.hp && asMount.str && asMount.armor
    ? ok("the stat block stays", "a warhorse can be hit")
    : bad("the stat block stays", JSON.stringify({ stored: out.storedMount, ...asMount }));
  !asMount.gold && asMount.kind
    ? ok("Gold hides, Kind shows", "no purse on the horse")
    : bad("Gold hides, Kind shows", JSON.stringify(asMount));

  console.log("\nand it is not a one-way trip");
  out.reachable
    ? ok("the role select is still on screen", "outside every block it hides")
    : bad("the role select is still on screen", "TRAPPED — nothing left to pick with");
  out.storedOff === "npc" && backAgain.hp && backAgain.str && backAgain.dayRate
    && backAgain.gold && out.goldStoredBack === 25
    ? ok("picking NPC back restores stat block + rate + Gold", "25gp intact after the round trip")
    : bad("picking NPC back restores stat block + rate + Gold", JSON.stringify({ stored: out.storedOff, goldStored: out.goldStoredBack, ...backAgain }));

  /* ---- the header gap: the vitals pin to the portrait's foot (Round 2) ---- */
  console.log("\nthe short-stack header leaves no dead band");
  const gap = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Monster: the SHORTEST stack (name, role, vitals) and the sheet the band
    // was reported on.
    const a = await Cls.create({ name: "ZZ Roles Gap", type: "npc", system: { role: "monster" } });
    const sheet = a.sheet;
    await sheet.render(true);
    await sleep(900);
    const el = sheet.element;
    const vit = el.querySelector(".npc-vitals-line");
    const abil = el.querySelector(".character-sheet-section-abilities");
    const port = el.querySelector(".portrait-wrap");
    if (!vit || !abil || !port) { await sheet.close(); await a.delete(); return { error: "missing nodes" }; }
    const gapNow = () => Math.round(abil.getBoundingClientRect().top - vit.getBoundingClientRect().bottom);
    const fixed = gapNow();
    const flush = Math.round(port.getBoundingClientRect().bottom - vit.getBoundingClientRect().bottom);
    // NEGATIVE CONTROL: restore the pre-fix margin inline. The flex column
    // stacks back to the top and the band must return, or the assertion
    // above cannot fail.
    vit.style.marginTop = "2px";
    const control = gapNow();
    vit.style.marginTop = "";
    await sheet.close();
    await a.delete();
    return { fixed, control, flush };
  });
  if (gap.error) bad("gap leg", gap.error);
  else {
    gap.fixed <= 8
      ? ok("HP/Gold sit directly above STR/Armor", `${gap.fixed}px between the rows`)
      : bad("HP/Gold sit directly above STR/Armor", `${gap.fixed}px of dead band`);
    Math.abs(gap.flush) <= 8
      ? ok("the vitals line is flush with the portrait's foot", `${gap.flush}px`)
      : bad("the vitals line is flush with the portrait's foot", `${gap.flush}px off`);
    gap.control > gap.fixed + 12
      ? ok("   control: the old margin brings the band back", `${gap.control}px`)
      : bad("   control: the old margin brings the band back",
        `still ${gap.control}px — the margin is not what closes the gap; assertion not load-bearing`);
  }

  /* ---- the FLAT graph: only a character keeps, and the edge rules hold ---- */
  console.log("\nkeeping is a TYPE privilege: only a character keeps");
  const matrix = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const mk = (name, system) => Cls.create({ name, type: "npc", system });
    const pc = await Cls.create({ name: "ZZ Roles PC", type: "character" });
    const h = await mk("ZZ Roles Hireling", { role: "npc", connectedTo: pc.uuid });
    const m = await mk("ZZ Roles Mount", { role: "mount", containerClass: "horse" });
    const s = await mk("ZZ Roles Sack", { role: "container", containerClass: "sack" });
    const b1 = await mk("ZZ Roles NPC A", { role: "npc" });
    // An npc→npc chain seeded through CREATION DATA — the shape a pre-flat
    // world still holds until the commit-6 migration flattens it. Nothing
    // refuses stored data; the method must refuse to EXTEND it.
    const b2 = await mk("ZZ Roles NPC B", { role: "npc", connectedTo: b1.uuid });
    const monster = await mk("ZZ Roles Monster", { role: "monster" });

    // THE FLAT RULE'S FAIL-WITNESS. Until 2026-08-01 this leg asserted the
    // opposite — a connected hireling keeps her own backpack. Nothing else
    // stands between h and the sack (h is a person, s is free, no cycle, the
    // Warden is clicking), so with the type wall deleted this is what goes red.
    const npcCannotKeep = h.canKeepConnected === false;
    const npcConnectRefused = !(await h.connectActor(s));
    const sackUntouched = !s.system.connectedTo;
    // ...and the SAME call lands for the legal keeper, so the refusal above
    // was the flat rule and not some other wall.
    const pcTakesSack = await pc.connectActor(s);
    const sackWithPc = s.system.connectedTo === pc.uuid;

    const mountKeeps = m.canKeepConnected;            // must be false
    const monsterConnectable = monster.canBeConnected; // must be false
    // b2 hangs off b1; connecting b1 UNDER b2 would close A→B→A. Refused by
    // the type wall now — the cycle guard behind it survives as belt-and-braces
    // for any edge kind a future change lets back in, unreachable today
    // because no legal target stores a connectedTo of its own.
    const chainExtendRefused = !(await b2.connectActor(b1));
    const b1Untouched = !b1.system.connectedTo;

    /* ---- Round 2, as amended 2026-07-31: A PC IS NEVER KEPT ---- */
    // This leg used to assert the opposite — "a PC keeps another PC", the
    // party-roster reading. The user retired PC→PC: a character keeps npcs,
    // hirelings, mounts, transports and containers and is the top of every
    // chain. So the assertions invert, and the schema field they were the
    // fail-witness FOR is gone.
    //
    // The keeper carries a DISTINCTIVE default (OBSERVER) so the ownership
    // assertions below can tell "copied" from "left alone".
    const pc2 = await Cls.create({ name: "ZZ Roles PC Keeper", type: "character", ownership: { default: 2 } });
    const pcChild = await Cls.create({ name: "ZZ Roles PC Child", type: "character", ownership: { default: 0 } });
    const pcPcRefused = !(await pc2.connectActor(pcChild));
    const pcChildUp = !!pcChild.system.connectedTo;               // must be false
    const rosterHasChild = pc2.connectedActors().some((x) => x.id === pcChild.id);
    // The STRUCTURAL half, and the one a re-added field would fail: refusing in
    // connectActor is a guard someone can delete, but CharacterData not
    // declaring `connectedTo` makes the write unrepresentable — cleaning drops
    // it with no error. Assert the field is absent from the source itself.
    const pcHasNoLinkField = !("connectedTo" in (pcChild._source.system ?? {}));
    // A refused connect must not have rewritten ownership either.
    const pcChildOwnershipUntouched = (pcChild.ownership.default ?? 0) === 0;

    // Nor does an NPC keep a PC. Same rule, other keeper: `pc` is FREE here
    // (it keeps h and s, nothing keeps it), so only "no character is a legal
    // target" can refuse it.
    const npcKeepsPcRefused = !(await b1.connectActor(pc));
    const pcStillFree = !pc.system.connectedTo;

    // ONE upward link, enforced in the METHOD: s belongs to pc now, and pc2
    // calling connectActor directly is exactly the path the picker filter
    // never covered (a drop). Must refuse and must not steal.
    const stealRefused = !(await pc2.connectActor(s));
    const sackStillWithPc = s.system.connectedTo === pc.uuid;

    // Ownership follows a PC → NPC connect — the CONNECTED SHAPE since
    // 2026-08-01, not a wholesale copy. The shape assertion needs a keeper
    // whose ownership mixes what MUST propagate (a player's OWNER entry) with
    // what must NOT (a sub-OWNER entry — the Warden letting someone watch a
    // sheet was not granting them the mule). Both users are non-GM; the probe
    // establishes them (Alice may exist from dev:players).
    let alice = game.users.getName("Alice");
    if (!alice) alice = await User.create({ name: "Alice", role: CONST.USER_ROLES.PLAYER });
    let bob = game.users.getName("Bob");
    if (!bob) bob = await User.create({ name: "Bob", role: CONST.USER_ROLES.PLAYER });
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const pc3 = await Cls.create({
      name: "ZZ Roles Shape Keeper", type: "character",
      ownership: { default: 0, [alice.id]: L.OWNER, [bob.id]: L.OBSERVER },
    });
    const g = await mk("ZZ Roles Granted", { role: "container", containerClass: "sack" });
    const grantLinked = await pc3.connectActor(g);
    const gOwn = foundry.utils.deepClone(g.ownership);
    const grantShape = {
      defaultObserver: gOwn.default === L.OBSERVER,
      aliceOwner: gOwn[alice.id] === L.OWNER,
      bobAbsent: gOwn[bob.id] === undefined,
      // No stray non-GM entries beyond Alice's.
      noStrays: Object.entries(gOwn).every(([id, lvl]) =>
        id === "default" || game.users.get(id)?.isGM || (id === alice.id && lvl === L.OWNER)),
    };

    for (const x of [s, g, h, m, b1, b2, monster, pcChild, pc2, pc3, pc]) await x.delete();
    return { npcCannotKeep, npcConnectRefused, sackUntouched, pcTakesSack, sackWithPc,
      mountKeeps, monsterConnectable, chainExtendRefused, b1Untouched,
      pcPcRefused, pcChildUp, rosterHasChild, pcHasNoLinkField, pcChildOwnershipUntouched,
      npcKeepsPcRefused, pcStillFree, stealRefused, sackStillWithPc,
      grantLinked, grantShape };
  });

  matrix.npcCannotKeep && matrix.npcConnectRefused && matrix.sackUntouched
    ? ok("an npc cannot keep — the flat rule's fail-witness", "hireling → sack refused, sack untouched")
    : bad("an npc cannot keep — the flat rule's fail-witness", JSON.stringify(matrix));
  matrix.pcTakesSack && matrix.sackWithPc
    ? ok("the same sack connects to the PC instead", "PC → sack lands; the refusal was the rule")
    : bad("the same sack connects to the PC instead", JSON.stringify(matrix));
  !matrix.mountKeeps
    ? ok("a mount cannot keep connections", "no backpack on the horse")
    : bad("a mount cannot keep connections", "canKeepConnected said yes");
  !matrix.monsterConnectable
    ? ok("a monster never joins the graph", "canBeConnected false")
    : bad("a monster never joins the graph", "canBeConnected said yes");
  matrix.chainExtendRefused && matrix.b1Untouched
    ? ok("a legacy npc→npc chain cannot be extended", "A→B→A never lands")
    : bad("a legacy npc→npc chain cannot be extended", JSON.stringify(matrix));

  console.log("\nRound 2: a PC is never kept, one link, ownership");
  matrix.pcPcRefused && !matrix.pcChildUp && !matrix.rosterHasChild && matrix.pcChildOwnershipUntouched
    ? ok("a PC cannot be kept by a PC", "refused, nothing written, no roster row")
    : bad("a PC cannot be kept by a PC", JSON.stringify(matrix));
  matrix.pcHasNoLinkField
    ? ok("CharacterData declares no connectedTo", "the write is unrepresentable, not merely refused")
    : bad("CharacterData declares no connectedTo", JSON.stringify(matrix));
  matrix.npcKeepsPcRefused && matrix.pcStillFree
    ? ok("an NPC never keeps a PC", "refused, nothing written")
    : bad("an NPC never keeps a PC", JSON.stringify(matrix));
  matrix.stealRefused && matrix.sackStillWithPc
    ? ok("a connected actor cannot be stolen", "single-parent enforced in connectActor itself")
    : bad("a connected actor cannot be stolen", JSON.stringify(matrix));
  matrix.grantLinked && matrix.grantShape.defaultObserver && matrix.grantShape.aliceOwner
    && matrix.grantShape.bobAbsent && matrix.grantShape.noStrays
    ? ok("PC → NPC connect writes the CONNECTED shape", "default OBSERVER, owner propagated, watcher not")
    : bad("PC → NPC connect writes the CONNECTED shape", JSON.stringify(matrix.grantShape));
  // "PC → PC leaves the child's ownership alone" was asserted here. It is now
  // part of the refusal assertion above — with the connect refused there is no
  // ownership step to reach, and a separate line naming a relationship that can
  // no longer exist would read as though PC→PC still worked.

  /* ---- the cap: ten connections per character, counting every role ---- */
  console.log("\nthe ceiling: ten connections, the eleventh refused");
  const cap = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const { maxConnections } = await import("/systems/air-bladder/module/connections.js");
    const max = maxConnections();
    const pc = await Cls.create({ name: "ZZ Roles Cap PC", type: "character" });
    // Seeded through CREATION DATA, the way every mint flow writes the link —
    // seeding through connectActor would trip the very wall under test.
    const sack = (i) => ({
      name: `ZZ Roles Cap Kid ${i}`, type: "npc",
      system: { role: "container", containerClass: "sack", connectedTo: pc.uuid, hp: { value: 0, max: 0 }, generationEnabled: false },
    });
    const kids = [];
    for (let i = 0; i < max; i++) kids.push(await Cls.create(sack(i)));
    // The precondition is ESTABLISHED, not hoped for: exactly `max` children.
    const seeded = pc.connectedActors().length;
    const extra = await Cls.create({
      name: "ZZ Roles Cap Extra", type: "npc",
      system: { role: "container", containerClass: "sack", hp: { value: 0, max: 0 }, generationEnabled: false },
    });
    const eleventhRefused = !(await pc.connectActor(extra));
    const extraUntouched = !extra.system.connectedTo;
    // The differential witness: one child fewer, and the SAME call lands — so
    // the refusal above was the count and nothing else about the pair.
    await kids[0].delete();
    const belowCap = pc.connectedActors().length;
    const landsBelow = await pc.connectActor(extra);
    const extraConnected = extra.system.connectedTo === pc.uuid;
    for (const k of kids.slice(1)) await k.delete();
    await extra.delete();
    await pc.delete();
    return { max, seeded, eleventhRefused, extraUntouched, belowCap, landsBelow, extraConnected };
  });
  cap.seeded === cap.max
    ? ok(`creation data seeded exactly ${cap.max} children`, "the precondition is real")
    : bad(`creation data seeded exactly ${cap.max} children`, `got ${cap.seeded}`);
  cap.eleventhRefused && cap.extraUntouched
    ? ok(`connection ${cap.max + 1} is refused at the ceiling`, "nothing written")
    : bad(`connection ${cap.max + 1} is refused at the ceiling`, JSON.stringify(cap));
  cap.belowCap === cap.max - 1 && cap.landsBelow && cap.extraConnected
    ? ok(`   witness: at ${cap.max - 1} the same call lands`, "the refusal was the count")
    : bad(`   witness: at ${cap.max - 1} the same call lands`, JSON.stringify(cap));

  /* ---- the Connections tab: monster exclusion + the vanishing-tab reset ---- */
  console.log("\nthe Connections tab follows the role");
  const tabs = await page.evaluate(async ({ READ }) => {
    const read = eval(READ);
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // No precondition to establish any more: the tab is structural. This used
    // to set `show-containers-tab`, which master-gated the whole feature and is
    // now removed — a display toggle could hide the only view of a graph that
    // went on existing behind it.
    const a = await Cls.create({ name: "ZZ Roles Tab", type: "npc", system: { role: "npc" } });
    const sheet = a.sheet;
    await sheet.render(true);
    await sleep(900);
    const asNpc = read(sheet);

    // Stand ON the Connections tab, then switch the role to Monster — the tab
    // vanishes under us and tabGroups must reset to a rendered tab.
    sheet.changeTab("containers", "primary");
    await sleep(400);
    const sel = sheet.element.querySelector(".role-select");
    sel.value = "monster";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(1400);
    const asMonster = read(sheet);

    await sheet.close();
    await a.delete();
    return { asNpc, asMonster };
  }, { READ });

  tabs.asNpc.connectionsTab
    ? ok("an NPC shows the Connections tab", "no setting needed — structural")
    : bad("an NPC shows the Connections tab", JSON.stringify(tabs.asNpc));
  !tabs.asMonster.connectionsTab
    ? ok("a Monster hides it", "no connections on a wolf")
    : bad("a Monster hides it", "tab still on screen");
  tabs.asMonster.visiblePanels === 1
    ? ok("the vanishing tab did not blank the body", "tabGroups reset to a rendered tab")
    : bad("the vanishing tab did not blank the body", `${tabs.asMonster.visiblePanels} visible panel(s)`);

  /* ---- tab ORDER (2026-08-01): Description leads the npc sheet ---- */
  // The reorder is the NPC's ALONE — the character-sheet leg below is what
  // stops a "reorder both" regression, and it doubles as the differential
  // witness for the order reader: the same reader on the PC sheet must come
  // back with Items first, so it demonstrably distinguishes the two orders.
  console.log("\nDescription leads the npc sheet; the character sheet is untouched");
  const order = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const read = (sheet) => ({
      nav: [...sheet.element.querySelectorAll("nav.tabs .item")].map((a) => a.dataset.tab),
      panels: [...sheet.element.querySelectorAll("section.content > .tab[data-tab]")].map((p) => p.dataset.tab),
      active: sheet.tabGroups.primary,
      activeVisible: [...sheet.element.querySelectorAll(".tab[data-tab]")].filter((p) => {
        const r = p.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).map((p) => p.dataset.tab),
    });
    const npc = await Cls.create({ name: "ZZ Roles Order NPC", type: "npc", system: { role: "npc" } });
    await npc.sheet.render(true);
    await sleep(900);
    const asNpc = read(npc.sheet);
    const pc = await Cls.create({ name: "ZZ Roles Order PC", type: "character" });
    await pc.sheet.render(true);
    await sleep(900);
    const asPc = read(pc.sheet);
    await npc.sheet.close();
    await pc.sheet.close();

    // FAIL-WITNESS (in-page): the pre-fix shape — the group's initial hardcoded
    // back to "items" the way the static TABS default had it (core seeds
    // tabGroups from static TABS at construction, so this is exactly what the
    // tabGroups override + config.initial exist to beat). A FRESH npc sheet
    // must then open standing on Items again, or "opens on Description" is not
    // load-bearing.
    const proto = Object.values(CONFIG.Actor.sheetClasses.npc)[0].cls.prototype;
    const origCfg = proto._getTabsConfig;
    proto._getTabsConfig = function (group) {
      const config = origCfg.call(this, group);
      // Both halves of the pre-fix shape: the static initial AND the
      // constructor seed both said "items" (the fixed method has already run
      // its reset by now, so the seed must be re-imposed here).
      if (config) {
        config.initial = "items";
        this.tabGroups[group] = "items";
      }
      return config;
    };
    const npc2 = await Cls.create({ name: "ZZ Roles Order Control", type: "npc", system: { role: "npc" } });
    await npc2.sheet.render(true);
    await sleep(900);
    const control = npc2.sheet.tabGroups.primary;
    await npc2.sheet.close();
    proto._getTabsConfig = origCfg;

    await npc.delete(); await pc.delete(); await npc2.delete();
    return { asNpc, asPc, control };
  });

  const NPC_ORDER = ["description", "items", "containers", "notes"];
  const PC_ORDER = ["items", "description", "containers", "notes"];
  JSON.stringify(order.asNpc.nav) === JSON.stringify(NPC_ORDER)
    && JSON.stringify(order.asNpc.panels) === JSON.stringify(NPC_ORDER)
    ? ok("npc nav AND panels run Description → Items → Connections → Notes")
    : bad("npc nav AND panels run Description → Items → Connections → Notes", JSON.stringify({ nav: order.asNpc.nav, panels: order.asNpc.panels }));
  order.asNpc.active === "description"
    && JSON.stringify(order.asNpc.activeVisible) === JSON.stringify(["description"])
    ? ok("a fresh npc sheet OPENS on Description", "tabGroups override beats the static TABS seed")
    : bad("a fresh npc sheet OPENS on Description", JSON.stringify({ active: order.asNpc.active, visible: order.asNpc.activeVisible }));
  JSON.stringify(order.asPc.nav) === JSON.stringify(PC_ORDER)
    && JSON.stringify(order.asPc.panels) === JSON.stringify(PC_ORDER)
    && order.asPc.active === "items"
    ? ok("the character sheet still leads with Items", "the reorder did not spread")
    : bad("the character sheet still leads with Items", JSON.stringify({ nav: order.asPc.nav, active: order.asPc.active }));
  order.control === "items"
    ? ok("   control: initial forced back to \"items\" reopens on Items", "the opens-on-Description assertion can fail")
    : bad("   control: initial forced back to \"items\" reopens on Items", `active=${order.control} — assertion not load-bearing`);

  /* ---- both directions, either end, as the Warden — FLAT since 2026-08-01 ---- */
  console.log("\nthe tab shows both directions; only the PC's end offers keeping");
  const dirs = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pc = await Cls.create({ name: "ZZ Roles Dir PC", type: "character" });
    // BOTH children hang off the PC now — the hireling no longer keeps the
    // sack, because nothing but a character keeps anything.
    const h = await Cls.create({ name: "ZZ Roles Dir Hireling", type: "npc", system: { role: "npc", connectedTo: pc.uuid } });
    const s = await Cls.create({
      name: "ZZ Roles Dir Sack", type: "npc",
      system: { role: "container", containerClass: "sack", connectedTo: pc.uuid, hp: { value: 0, max: 0 }, generationEnabled: false },
    });

    const readTab = async (a) => {
      await a.sheet.render(true);
      await sleep(900);
      a.sheet.changeTab?.("containers", "primary");
      await sleep(300);
      const el = a.sheet.element;
      return {
        keeperLine: !!el.querySelector(".connection-keeper-line"),
        keeperLabel: el.querySelector(".connection-keeper-label")?.textContent ?? "",
        detach: !!el.querySelector(".connection-detach"),
        add: !!el.querySelector(".connection-add"),
        attach: !!el.querySelector(".connection-attach"),
        unlinkIcon: !!el.querySelector(".container-unlink"),
      };
    };

    const sackTab = await readTab(s);
    const hireTab = await readTab(h);
    const pcTab = await readTab(pc);
    await pc.sheet.close();

    // Break from the CHILD end. Confirm is stubbed: a settled DialogV2
    // outlives its promise in the DOM (e2e-container-unlink's lesson).
    const DialogV2 = foundry.applications.api.DialogV2;
    const origConfirm = DialogV2.confirm;
    DialogV2.confirm = async () => true;
    s.sheet.element.querySelector(".connection-detach")?.click();
    await sleep(1500);
    DialogV2.confirm = origConfirm;
    const afterDetach = {
      connectedTo: s.system.connectedTo,
      formerly: s.system.formerlyBelongedTo,
    };

    // Now unconnected: Connect to… must appear; drive the REAL picker. Under
    // the flat graph its keeper list is CHARACTERS with room — the hireling
    // must not be offered, which is the picker filter's own flat witness.
    await sleep(600);
    const attachShown = !!s.sheet.element.querySelector(".connection-attach");
    s.sheet.element.querySelector(".connection-attach")?.click();
    let sel = null;
    for (let i = 0; i < 30 && !sel; i++) {
      await sleep(150);
      sel = document.querySelector('dialog select[name="keeperTarget"]');
    }
    const offered = sel ? [...sel.options].map((o) => o.textContent) : [];
    const npcOffered = offered.some((t) => t.includes("ZZ Roles Dir Hireling"));
    let reattached = false;
    if (sel) {
      const opt = [...sel.options].find((o) => o.textContent.includes("ZZ Roles Dir PC"));
      if (opt) sel.value = opt.value;
      const dlg = sel.closest("dialog");
      (dlg.querySelector('button[data-action="ok"]') ?? dlg.querySelector("footer button, .form-footer button"))?.click();
      for (let i = 0; i < 40 && document.querySelector('dialog select[name="keeperTarget"]'); i++) await sleep(100);
      await sleep(500);
      reattached = s.system.connectedTo === pc.uuid;
    }

    await s.sheet.close();
    await h.sheet.close();
    await s.delete(); await h.delete(); await pc.delete();
    return { sackTab, hireTab, pcTab, afterDetach, attachShown, offered: offered.length, npcOffered, reattached };
  });

  dirs.sackTab.keeperLine && dirs.sackTab.keeperLabel.includes("ZZ Roles Dir PC") && dirs.sackTab.detach
    ? ok("a connected sack names its keeper, breakable here", `"${dirs.sackTab.keeperLabel.trim()}"`)
    : bad("a connected sack names its keeper, breakable here", JSON.stringify(dirs.sackTab));
  !dirs.sackTab.add && !dirs.sackTab.attach
    ? ok("the sack offers neither keeping nor a second parent", "cannot keep; already connected")
    : bad("the sack offers neither keeping nor a second parent", JSON.stringify(dirs.sackTab));
  dirs.hireTab.keeperLine && !dirs.hireTab.add && !dirs.hireTab.attach && !dirs.hireTab.unlinkIcon
    ? ok("the hireling shows her keeper and offers NOTHING", "an npc keeps nobody — the template's flat witness")
    : bad("the hireling shows her keeper and offers NOTHING", JSON.stringify(dirs.hireTab));
  !dirs.pcTab.keeperLine && dirs.pcTab.add && dirs.pcTab.unlinkIcon
    ? ok("the PC's tab is where keeping lives", "Add Connection + per-row unlink, no keeper line")
    : bad("the PC's tab is where keeping lives", JSON.stringify(dirs.pcTab));
  dirs.afterDetach.connectedTo === "" && dirs.afterDetach.formerly === "ZZ Roles Dir PC"
    ? ok("detach from the child end unlinks + stamps", `formerly "${dirs.afterDetach.formerly}"`)
    : bad("detach from the child end unlinks + stamps", JSON.stringify(dirs.afterDetach));
  dirs.attachShown && dirs.offered > 0 && !dirs.npcOffered && dirs.reattached
    ? ok("Connect to… offers characters only, reattaches", `${dirs.offered} keeper(s), hireling not among them`)
    : bad("Connect to… offers characters only, reattaches", JSON.stringify(dirs));

  /* ---- an UNLINKED token's actor is not in the graph ---- */
  // Reported from the dev world: a Backpack was connected to the world
  // "Bat, Vampire" while the sheet on screen was an unlinked TOKEN's actor —
  // same name, same art, a different document — so the tab read 0 forever. The
  // synthetic actor is not in `game.actors`, so it can never appear in a
  // keeper's list nor resolve as one; offering the controls promised something
  // no write could deliver.
  console.log("\nan unlinked token's actor stays out of the graph");
  const tok = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const scene = game.scenes.find((s) => s.tokens.size >= 0) ?? game.scenes.contents[0];
    if (!scene) return { error: "no scene in this world" };

    const world = await Cls.create({ name: "ZZ Roles Tok NPC", type: "npc", system: { role: "npc" } });
    // actorLink FALSE is the whole point — a linked token's `.actor` IS the
    // world Actor and `isToken` is false, so it stays a full graph member.
    const [td] = await scene.createEmbeddedDocuments("Token", [{
      name: "ZZ Roles Tok NPC", actorId: world.id, actorLink: false, x: 100, y: 100,
    }]);
    const synth = td.actor;
    // The KEEPER half needs a CHARACTER pair now: canKeepConnected is
    // character-only under the flat graph, so a world npc reads false with or
    // without the isToken clause — only a character token can witness it.
    const worldChar = await Cls.create({
      name: "ZZ Roles Tok PC", type: "character", prototypeToken: { actorLink: false },
    });
    const [tdChar] = await scene.createEmbeddedDocuments("Token", [{
      name: "ZZ Roles Tok PC", actorId: worldChar.id, actorLink: false, x: 200, y: 100,
    }]);
    const synthChar = tdChar.actor;
    const sack = await Cls.create({
      name: "ZZ Roles Tok Sack", type: "npc",
      system: { role: "container", containerClass: "sack", hp: { value: 0, max: 0 }, generationEnabled: false },
    });

    const res = {
      isToken: synth?.isToken === true && synthChar?.isToken === true,
      worldIsNotToken: world.isToken === false && worldChar.isToken === false,
      // Graph membership, both directions, each with its world differential:
      // a world npc may BE connected while its token copy may not, and a world
      // character may KEEP while its token copy may not.
      canBe: synth?.canBeConnected,
      worldCanBe: world.canBeConnected,
      synthCharKeeps: synthChar?.canKeepConnected,
      worldCharKeeps: worldChar.canKeepConnected,
      showsTab: synth?.system?.showContainersTab,
      worldShowsTab: world.system?.showContainersTab,
    };
    // And the write itself is refused, not merely hidden — from the synthetic
    // CHARACTER, the one actor the type rule would otherwise let keep.
    res.connectRefused = !(await synthChar.connectActor(sack));
    res.sackUntouched = !sack.system.connectedTo;
    // Positive control in the same shape: the WORLD character's call lands.
    res.worldConnectLands = await worldChar.connectActor(sack);

    await td.delete();
    await tdChar.delete();
    await sack.delete();
    await world.delete();
    await worldChar.delete();
    await sleep(200);
    return res;
  });

  if (tok.error) bad("token leg", tok.error);
  else {
    tok.isToken && tok.worldIsNotToken
      ? ok("the probe really built synthetic token actors", "isToken true on both, world actors false")
      : bad("the probe really built synthetic token actors", JSON.stringify(tok));
    !tok.canBe && tok.worldCanBe
      ? ok("the npc token copy cannot BE connected, its world actor can")
      : bad("the npc token copy cannot BE connected, its world actor can", JSON.stringify(tok));
    !tok.synthCharKeeps && tok.worldCharKeeps
      ? ok("the character token copy cannot KEEP, its world actor can")
      : bad("the character token copy cannot KEEP, its world actor can", JSON.stringify(tok));
    tok.showsTab === false && tok.worldShowsTab === true
      ? ok("no Connections tab on the token copy", "the tab could only ever read 0")
      : bad("no Connections tab on the token copy", JSON.stringify(tok));
    tok.connectRefused && tok.sackUntouched && tok.worldConnectLands
      ? ok("a direct connectActor from it is refused", "and the world character's same call lands")
      : bad("a direct connectActor from it is refused", JSON.stringify(tok));
  }

  /* ---- the container art picker ---- */
  console.log("\nthe art picker treats a thing-role NPC as a container");
  const pick = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const a = await Cls.create({ name: "ZZ Art Picker", type: "npc", system: { role: "container" } });
    const sheet = a.sheet;
    await sheet.render(true);
    await sleep(800);

    // Route: a thing-role npc must get the CONTAINER gallery, not 80 portraits.
    sheet.element.querySelector(".portrait")?.click();
    await sleep(900);
    const dlg = [...document.querySelectorAll("dialog")].pop();
    const gallery = dlg?.querySelector(".cairn-container-gallery");
    const cells = [...(dlg?.querySelectorAll(".cairn-portrait-choice") ?? [])];
    const classed = cells.filter((c) => c.dataset.class).length;
    const srcs = cells.map((c) => c.dataset.src);
    const classes = cells.map((c) => c.dataset.class);
    // The two files that spent a year as the same cartwheel glyph.
    const [cartSvg, wagonSvg] = await Promise.all(
      ["cart", "wagon"].map((n) => fetch(`systems/air-bladder/icons/${n}.svg`).then((r) => r.text())));
    const hasBrowse = !!dlg?.querySelector(".cairn-portrait-browse");
    const barrel = cells.find((c) => c.dataset.class === "barrel");
    barrel?.click();
    await sleep(1200);
    // The dialog must be GONE before anything else opens one -- a settled
    // DialogV2 lingers in the DOM while its close transition runs.
    for (let i = 0; i < 40 && document.querySelector("dialog.dialog"); i++) await sleep(100);

    const afterPick = {
      img: a.img,
      token: a.prototypeToken.texture.src,
      cls: a.system.containerClass,
      slots: a.system.slots,
      label: a.system.classLabel,
    };

    // A capacity someone typed must survive a later art change.
    await a.update({ "system.slots": 12 });
    await sheet._setContainerArt("systems/air-bladder/icons/crate.svg", "crate");
    const afterSecond = { cls: a.system.containerClass, slots: a.system.slots };

    // The Browse escape (no cls argument) must leave the Kind ALONE now —
    // custom art is just art, it no longer costs the crate its identity.
    await sheet._setContainerArt("icons/svg/chest.svg");
    const afterBrowse = { img: a.img, cls: a.system.containerClass };

    // TYPING a known Kind brings its defaults the way the glyph does: fresh
    // thing, slots untouched, wagon typed → 8 slots and wagon art.
    // Named "ZZ Roles …" so the sweep at the top of this file collects them if
    // a run aborts before the explicit deletes below.
    const t = await Cls.create({ name: "ZZ Roles Typed Kind", type: "npc", system: { role: "transport" } });
    await t.update({ "system.containerClass": "wagon" });
    const afterTyped = { cls: t.system.containerClass, slots: t.system.slots, img: t.img };
    // ...but an unknown word is just a label: nothing else moves.
    const u = await Cls.create({ name: "ZZ Roles Custom Kind", type: "npc", system: { role: "container" } });
    await u.update({ "system.containerClass": "Saddlebags" });
    const afterCustom = { cls: u.system.containerClass, slots: u.system.slots, label: u.system.classLabel };
    await t.delete(); await u.delete();

    await sheet.close();
    await a.delete();
    return { isContainerGallery: !!gallery, cellCount: cells.length, classed, srcs, classes,
      cartWagonDiffer: cartSvg !== wagonSvg, hasBrowse, afterPick, afterSecond, afterBrowse, afterTyped, afterCustom };
  });

  pick.isContainerGallery
    ? ok("a thing-role NPC gets the container gallery", "not the 80-portrait one")
    : bad("a thing-role NPC gets the container gallery", "it opened the character portrait picker");
  // 14 cells for 15 classes: the gallery shows each GLYPH once, and mule/donkey
  // share Skoll's donkey (game-icons.net has no mule). Removing the dedupe
  // filter fails BOTH of the first two assertions — 15 cells, donkey.svg twice.
  pick.cellCount === 14 && pick.classed === 14
    ? ok("one cell per glyph, each carrying its class key", `${pick.cellCount} cells for 15 classes`)
    : bad("one cell per glyph, each carrying its class key", `${pick.cellCount} cells, ${pick.classed} classed`);
  new Set(pick.srcs).size === pick.srcs.length
    ? ok("no two cells wear the same image", "the doubled donkey is gone")
    : bad("no two cells wear the same image", JSON.stringify(pick.srcs));
  pick.classes.includes("mule") && !pick.classes.includes("donkey")
    ? ok("the shared donkey glyph belongs to the MULE", "donkey stays a name-inferred class")
    : bad("the shared donkey glyph belongs to the MULE", JSON.stringify(pick.classes));
  pick.cartWagonDiffer
    ? ok("cart and wagon wear different glyphs", "wagon.svg is no longer a copy of cart.svg")
    : bad("cart and wagon wear different glyphs", "the two files are byte-identical again");
  pick.hasBrowse
    ? ok("the Browse escape is present", "a Warden can use their own art")
    : bad("the Browse escape is present", "no browse button");
  pick.afterPick.cls === "barrel" && /barrel\.svg$/.test(pick.afterPick.img)
    ? ok("picking barrel sets art AND Kind", `${pick.afterPick.cls}`)
    : bad("picking barrel sets art AND Kind", JSON.stringify(pick.afterPick));
  pick.afterPick.token === pick.afterPick.img
    ? ok("the map token follows the portrait", "one field, no drift")
    : bad("the map token follows the portrait", JSON.stringify(pick.afterPick));
  pick.afterPick.slots === 4
    ? ok("an unset capacity takes the class default", "barrel = 4")
    : bad("an unset capacity takes the class default", `slots=${pick.afterPick.slots}`);
  pick.afterSecond.cls === "crate" && pick.afterSecond.slots === 12
    ? ok("a capacity someone TYPED is not overwritten", "12 survived a re-art to crate")
    : bad("a capacity someone TYPED is not overwritten", JSON.stringify(pick.afterSecond));
  pick.afterBrowse.cls === "crate"
    ? ok("custom art keeps the stored Kind", "only the picture changed")
    : bad("custom art keeps the stored Kind", JSON.stringify(pick.afterBrowse));
  pick.afterTyped.cls === "wagon" && pick.afterTyped.slots === 8 && /wagon\.svg$/.test(pick.afterTyped.img)
    ? ok("typing a known Kind brings its defaults", "wagon → 8 slots + wagon art")
    : bad("typing a known Kind brings its defaults", JSON.stringify(pick.afterTyped));
  pick.afterCustom.cls === "Saddlebags" && !Number(pick.afterCustom.slots) && pick.afterCustom.label === "Saddlebags"
    ? ok("a Warden's own word is just a label", "verbatim, no defaults invented")
    : bad("a Warden's own word is just a label", JSON.stringify(pick.afterCustom));

  /* ---- negative control: remove the guard, in page ---- */
  console.log("\n   negative control: _computeStatContext guard removed");
  const ctrl = await page.evaluate(async ({ READ }) => {
    const read = eval(READ);
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const proto = CONFIG.Actor.sheetClasses.npc
      ? Object.values(CONFIG.Actor.sheetClasses.npc)[0].cls.prototype
      : null;
    if (!proto) return { error: "could not resolve the npc sheet class" };

    const original = proto._computeStatContext;
    // Pre-fix behaviour and nothing else: run the real thing, but with the
    // isThing early-return defeated by an instance shadow over the prototype
    // getter for the duration of the call. Removed immediately afterwards.
    proto._computeStatContext = function patched(context) {
      Object.defineProperty(this.actor, "isThing", { value: false, configurable: true });
      try { return original.call(this, context); } finally {
        delete this.actor.isThing;
      }
    };

    const a = await Cls.create({
      name: "ZZ Roles Control",
      type: "npc",
      system: {
        role: "container",
        abilities: { STR: { value: 0, max: 0 }, DEX: { value: 0, max: 0 }, WIL: { value: 0, max: 0 } },
      },
    });
    await a.sheet.render(true);
    await sleep(900);
    const seen = read(a.sheet);
    await a.sheet.close();
    await a.delete();
    proto._computeStatContext = original;
    return { banners: seen.banners };
  }, { READ });

  if (ctrl.error) bad("control", ctrl.error);
  else if (ctrl.banners.length)
    ok("reproduced — the banners come back", `${ctrl.banners.length}: ${ctrl.banners.join(" | ")}`);
  else
    bad("reproduced — the banners come back",
      "the control changed nothing, so the banner assertion above is not load-bearing");

  /* ---- the player leg: ONE verb, player-usable (INVERTED 2026-08-01) ---- */
  // Until today this leg proved the Warden-only walls held against an owner.
  // Those walls are GONE by design: connect/break is usable by the owner of
  // BOTH ends, so the old fail-witness (her direct call refused) is now the
  // positive case. The NEW differential fail-witness is the one-end-foreign
  // sack: Alice owns her PC but not the foreign sack, so only the both-ends
  // term refuses it — delete the wall and that connect lands. The GM page
  // stays open in this probe, so the socket relay has a live GM client to
  // answer with the ownership shape.
  console.log("\na player who owns both ends connects, breaks, and pays for it");
  const seed = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    let alice = game.users.getName("Alice");
    if (!alice) alice = await User.create({ name: "Alice", role: CONST.USER_ROLES.PLAYER });
    if (alice.role !== CONST.USER_ROLES.PLAYER) return { error: `Alice is role ${alice.role}, not PLAYER` };
    const own = { default: 0, [alice.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
    const pc = await Cls.create({ name: "ZZ Roles Alice PC", type: "character", ownership: own });
    const sack = await Cls.create({
      name: "ZZ Roles Alice Sack", type: "npc", ownership: own,
      system: { role: "container", containerClass: "sack", connectedTo: pc.uuid, hp: { value: 0, max: 0 }, generationEnabled: false },
    });
    const free = await Cls.create({
      name: "ZZ Roles Alice Free", type: "npc", ownership: own,
      system: { role: "container", containerClass: "sack", hp: { value: 0, max: 0 }, generationEnabled: false },
    });
    // Owned by NOBODY Alice can speak for — the one-end-foreign differential.
    const foreign = await Cls.create({
      name: "ZZ Roles Alice Foreign", type: "npc", ownership: { default: 0 },
      system: { role: "container", containerClass: "sack", hp: { value: 0, max: 0 }, generationEnabled: false },
    });
    return { aliceId: alice.id, pcUuid: pc.uuid, sackUuid: sack.uuid, freeUuid: free.uuid, foreignUuid: foreign.uuid };
  });
  if (seed.error) bad("player leg setup", seed.error);
  else {
    const alicePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
    const aliceErrors = watchErrors(alicePage);
    await joinAs(alicePage, "Alice");
    await dismissChrome(alicePage);

    const player = await alicePage.evaluate(async ({ aliceId, pcUuid, sackUuid, freeUuid, foreignUuid }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
      const pc = await fromUuid(pcUuid);
      const sack = await fromUuid(sackUuid);
      const free = await fromUuid(freeUuid);
      const foreign = await fromUuid(foreignUuid);
      await pc.sheet.render(true);
      await sleep(900);
      pc.sheet.changeTab?.("containers", "primary");
      await sleep(300);
      const el = pc.sheet.element;
      const pcTab = {
        tab: !!el.querySelector('.tabs .item[data-tab="containers"]'),
        rowForSack: !!el.querySelector(`[data-item-id="${sack.uuid}"]`),
        editIcon: !!el.querySelector(".item-edit"),
        add: !!el.querySelector(".connection-add"),
        unlinkIcon: !!el.querySelector(".container-unlink"),
      };
      await sack.sheet.render(true);
      await sleep(900);
      sack.sheet.changeTab?.("containers", "primary");
      await sleep(300);
      const sEl = sack.sheet.element;
      const sackTab = {
        keeperLine: !!sEl.querySelector(".connection-keeper-line"),
        detach: !!sEl.querySelector(".connection-detach"),
        attach: !!sEl.querySelector(".connection-attach"),
      };

      // Her CONNECT, both ends owned: must land, and the GM client must
      // answer with the exact connected shape and clear the sync flag. Poll
      // for the SETTLED state, not the first observable — the relay is two
      // writes on two clients.
      const DialogV2 = foundry.applications.api.DialogV2;
      const origConfirm = DialogV2.confirm;
      DialogV2.confirm = async () => true;
      const connectReturned = await pc.connectActor(free);
      const connectLanded = free.system.connectedTo === pc.uuid;
      let shapeSettled = false;
      for (let i = 0; i < 40 && !shapeSettled; i++) {
        await sleep(250);
        shapeSettled = free.ownership.default === L.OBSERVER
          && free.ownership[aliceId] === L.OWNER
          && free.getFlag("air-bladder", "ownershipSyncPending") === undefined;
      }
      const freeShape = { ...free.ownership };

      // The one-end-foreign differential: refused, nothing written.
      const foreignReturned = await pc.connectActor(foreign);
      const foreignUntouched = !foreign.system.connectedTo
        && (foreign.ownership.default ?? 0) === 0;

      // Her BREAK: lands, and the broken shape costs her OWNER — by design.
      await pc.unlinkOwnedContainer(sack.uuid);
      const breakLanded = sack.system.connectedTo === "";
      let broke = false;
      for (let i = 0; i < 40 && !broke; i++) {
        await sleep(250);
        broke = sack.ownership.default === L.LIMITED
          && sack.ownership[aliceId] === undefined;
      }
      const lostWrite = sack.isOwner === false && !sack.canUserModify(game.user, "update");
      DialogV2.confirm = origConfirm;
      await pc.sheet.close();
      await sack.sheet.close();
      return { pcTab, sackTab, connectReturned, connectLanded, shapeSettled, freeShape,
        foreignReturned, foreignUntouched, breakLanded, broke, lostWrite };
    }, seed);

    player.pcTab.tab && player.pcTab.rowForSack && player.pcTab.editIcon
      ? ok("Alice still SEES her connections", "tab, row and edit intact")
      : bad("Alice still SEES her connections", JSON.stringify(player.pcTab));
    player.pcTab.add && player.pcTab.unlinkIcon
      ? ok("Connect and unlink render for the owner now", "the edge controls are hers on her own PC")
      : bad("Connect and unlink render for the owner now", JSON.stringify(player.pcTab));
    player.sackTab.keeperLine && player.sackTab.detach && !player.sackTab.attach
      ? ok("the sack shows its keeper, breakable by its owner", "detach offered; no second parent")
      : bad("the sack shows its keeper, breakable by its owner", JSON.stringify(player.sackTab));
    player.connectReturned && player.connectLanded && player.shapeSettled
      ? ok("her connect lands and the GM answers with the shape", "default OBSERVER, Alice OWNER, flag cleared")
      : bad("her connect lands and the GM answers with the shape", JSON.stringify({ r: player.connectReturned, l: player.connectLanded, s: player.shapeSettled, shape: player.freeShape }));
    !player.foreignReturned && player.foreignUntouched
      ? ok("one end foreign → refused, nothing written", "the both-ends wall's differential fail-witness")
      : bad("one end foreign → refused, nothing written", JSON.stringify(player));
    player.breakLanded && player.broke && player.lostWrite
      ? ok("her break lands, and costs her OWNER", "default LIMITED, entry stripped — by design")
      : bad("her break lands, and costs her OWNER", JSON.stringify({ b: player.breakLanded, broke: player.broke, lost: player.lostWrite }));

    console.log(`\n  player console errors: ${aliceErrors.length}`);
    for (const e of aliceErrors.slice(0, 8)) console.log(`  ${e}`);
    if (aliceErrors.length) failed = true;
    await alicePage.context().close();

    // Restore world state from NODE-driven GM evaluate, never from the player.
    await page.evaluate(async () => {
      for (const a of game.actors.filter((x) => x.name.startsWith("ZZ Roles Alice"))) await a.delete();
    });
  }
} catch (e) {
  bad("threw", `${e.name}: ${e.message}`);
} finally {
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
  if (errors.length) failed = true;
  await browser.close();
}

console.log(failed ? "\nROLES PROBE FAILED" : "\nroles probe passed");
process.exit(failed ? 1 : 0);

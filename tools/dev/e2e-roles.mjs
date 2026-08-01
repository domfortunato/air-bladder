#!/usr/bin/env node
/**
 * `system.role` — the one discriminator on the NPC sheet (docs/npc-roles-plan.md).
 *
 * Role replaced the For Hire and Inanimate checkboxes: transport/container hide
 * the stat block (HP, STR/DEX/WIL, Armor, Deprived/Panicked, the Rest / Restore /
 * Die-of-Fate buttons and every derived condition) while KEEPING the name,
 * inventory and tabs; only hireling shows the day rate; monster loses the
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
 * 3. **The keeping matrix, the cycle guard, and (Round 2) the edge rules.**
 *    Keeping is a Character/NPC/Hireling privilege; a CONNECTED hireling can
 *    still keep, a mount cannot keep at all, an NPC→NPC loop is refused at
 *    connect time. Round 2 adds: PC → PC is legal (a party roster), an NPC
 *    never keeps a PC, ONE upward link ever (connectActor itself refuses a
 *    connected target — the picker filter alone never covered a drop), and
 *    ownership follows a PC → NPC connect while a PC child's is never touched.
 *
 * 4. **The conditional tab resets tabGroups.** Standing on Connections and
 *    switching the role to Monster removes the tab under you — the sheet must
 *    land on a rendered tab, not a blank body.
 *
 * 5. **Both directions, either end (Round 2).** A connected actor's tab shows
 *    its upward keeper as a line the Warden can break from the child end; an
 *    unconnected connectable shows Connect to… (attach ME); and every manual
 *    edge control is the Warden's ALONE — a player client sees none of them,
 *    and the document methods refuse a player even when called directly, which
 *    the sheet gating can never guarantee. The player leg is the
 *    fail-without-the-fix witness for the isGM walls: Alice OWNS every actor
 *    involved, so without the gate her direct connectActor/unlink calls land.
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
      // fire, so a crate at 0/0/0 is the case that matters. Hireling first:
      // review #5 found the day-rate row outliving the control that reveals it
      // when the old checkboxes crossed, so this probe starts as a hireling and
      // turns into a thing — the exact sequence that stranded the row.
      system: { abilities: { STR: { value: 0, max: 0 }, DEX: { value: 0, max: 0 }, WIL: { value: 0, max: 0 } }, gold: 25, role: "hireling", dayRate: 5 },
    });
    const sheet = a.sheet;
    await sheet.render(true);
    await sleep(900);

    const asHireling = read(sheet);

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
    await pickRole(sheet, "hireling");
    const backAgain = read(sheet);
    const storedOff = a.system.role;
    const goldStoredBack = a.system.gold;

    await sheet.close();
    await a.delete();
    return { asHireling, asThing, asMount, backAgain, storedOn, storedMount, storedOff, goldStoredAsThing, goldStoredBack, reachable };
  }, { READ, PICK_ROLE });

  if (out.error) throw new Error(out.error);
  const { asHireling, asThing, asMount, backAgain } = out;

  console.log("\na hireling keeps its stat block, career and day rate");
  asHireling.hp && asHireling.str && asHireling.armor && asHireling.restBtn
    ? ok("HP, STR, Armor and Rest all present")
    : bad("HP, STR, Armor and Rest all present", JSON.stringify(asHireling));
  asHireling.career && asHireling.dayRate && asHireling.gold
    ? ok("career, day-rate and Gold rows show", "the hidden-state assertions below can fail")
    : bad("career, day-rate and Gold rows show", JSON.stringify(asHireling));
  asHireling.banners.length
    ? ok("zeroed abilities raise banners", `${asHireling.banners.length} banner(s)`)
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
  asThing.kind && !asHireling.kind
    ? ok("the Kind field rides the container role", "absent on a hireling, present on a thing")
    : bad("the Kind field rides the container role", JSON.stringify({ thing: asThing.kind, hireling: asHireling.kind }));

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
  out.storedOff === "hireling" && backAgain.hp && backAgain.str && backAgain.dayRate
    && backAgain.gold && out.goldStoredBack === 25
    ? ok("picking Hireling back restores stat block + rate + Gold", "25gp intact after the round trip")
    : bad("picking Hireling back restores stat block + rate + Gold", JSON.stringify({ stored: out.storedOff, goldStored: out.goldStoredBack, ...backAgain }));

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

  /* ---- the keeping matrix, the cycle guard, and the Round-2 edge rules ---- */
  console.log("\nkeeping is a role privilege, and loops are refused");
  const matrix = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const mk = (name, system) => Cls.create({ name, type: "npc", system });
    const pc = await Cls.create({ name: "ZZ Roles PC", type: "character" });
    const h = await mk("ZZ Roles Hireling", { role: "hireling", connectedTo: pc.uuid });
    const m = await mk("ZZ Roles Mount", { role: "mount", containerClass: "horse" });
    const s = await mk("ZZ Roles Sack", { role: "container", containerClass: "sack" });
    const b1 = await mk("ZZ Roles NPC A", { role: "npc" });
    const b2 = await mk("ZZ Roles NPC B", { role: "npc", connectedTo: b1.uuid });
    const monster = await mk("ZZ Roles Monster", { role: "monster" });

    // The new capability: a CONNECTED hireling still keeps (PC → hireling →
    // sack). The old rule (`!connectedTo`) returns false here, so this line is
    // the fail-without-the-fix witness for the whole matrix change.
    const connectedHirelingKeeps = h.canKeepConnected;
    const sackLinked = await h.connectActor(s);
    const sackConnectedTo = s.system.connectedTo;

    const mountKeeps = m.canKeepConnected;            // must be false
    const monsterConnectable = monster.canBeConnected; // must be false
    // b2 hangs off b1; connecting b1 UNDER b2 closes the loop and must refuse.
    const cycleRefused = !(await b2.connectActor(b1));
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
    // (it keeps h, nothing keeps it), so only "no character is a legal target"
    // can refuse it.
    const npcKeepsPcRefused = !(await b1.connectActor(pc));
    const pcStillFree = !pc.system.connectedTo;

    // ONE upward link, enforced in the METHOD: s already belongs to h, and pc
    // calling connectActor directly is exactly the path the picker filter
    // never covered (a drop). Must refuse and must not steal.
    const stealRefused = !(await pc.connectActor(s));
    const sackStillWithHireling = s.system.connectedTo === h.uuid;

    // Ownership follows a PC → NPC connect (the marketplace-buy precedent).
    const g = await mk("ZZ Roles Granted", { role: "container", containerClass: "sack" });
    const grantLinked = await pc2.connectActor(g);
    const grantOwnershipCopied = g.ownership.default === 2;

    for (const x of [s, g, h, m, b1, b2, monster, pcChild, pc2, pc]) await x.delete();
    return { connectedHirelingKeeps, sackLinked, sackConnectedTo: sackConnectedTo ? "set" : "",
      mountKeeps, monsterConnectable, cycleRefused, b1Untouched,
      pcPcRefused, pcChildUp, rosterHasChild, pcHasNoLinkField, pcChildOwnershipUntouched,
      npcKeepsPcRefused, pcStillFree, stealRefused, sackStillWithHireling,
      grantLinked, grantOwnershipCopied };
  });

  matrix.connectedHirelingKeeps && matrix.sackLinked && matrix.sackConnectedTo === "set"
    ? ok("a CONNECTED hireling keeps her own backpack", "PC → hireling → sack")
    : bad("a CONNECTED hireling keeps her own backpack", JSON.stringify(matrix));
  !matrix.mountKeeps
    ? ok("a mount cannot keep connections", "no backpack on the horse")
    : bad("a mount cannot keep connections", "canKeepConnected said yes");
  !matrix.monsterConnectable
    ? ok("a monster never joins the graph", "canBeConnected false")
    : bad("a monster never joins the graph", "canBeConnected said yes");
  matrix.cycleRefused && matrix.b1Untouched
    ? ok("an NPC→NPC loop is refused at connect time", "A→B→A never lands")
    : bad("an NPC→NPC loop is refused at connect time", JSON.stringify(matrix));

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
  matrix.stealRefused && matrix.sackStillWithHireling
    ? ok("a connected actor cannot be stolen", "single-parent enforced in connectActor itself")
    : bad("a connected actor cannot be stolen", JSON.stringify(matrix));
  matrix.grantLinked && matrix.grantOwnershipCopied
    ? ok("PC → NPC connect copies the PC's ownership", "the marketplace precedent")
    : bad("PC → NPC connect copies the PC's ownership", JSON.stringify(matrix));
  // "PC → PC leaves the child's ownership alone" was asserted here. It is now
  // part of the refusal assertion above — with the connect refused there is no
  // ownership step to reach, and a separate line naming a relationship that can
  // no longer exist would read as though PC→PC still worked.

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

  /* ---- both directions, either end (Round 2), as the Warden ---- */
  console.log("\nthe tab shows both directions, manageable from either end");
  const dirs = await page.evaluate(async () => {
    const Cls = CONFIG.Actor.documentClass;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pc = await Cls.create({ name: "ZZ Roles Dir PC", type: "character" });
    const h = await Cls.create({ name: "ZZ Roles Dir Hireling", type: "npc", system: { role: "hireling", connectedTo: pc.uuid } });
    const s = await Cls.create({
      name: "ZZ Roles Dir Sack", type: "npc",
      system: { role: "container", containerClass: "sack", connectedTo: h.uuid, hp: { value: 0, max: 0 }, generationEnabled: false },
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

    // Now unconnected: Connect to… must appear; drive the REAL picker.
    await sleep(600);
    const attachShown = !!s.sheet.element.querySelector(".connection-attach");
    s.sheet.element.querySelector(".connection-attach")?.click();
    let sel = null;
    for (let i = 0; i < 30 && !sel; i++) {
      await sleep(150);
      sel = document.querySelector('dialog select[name="keeperTarget"]');
    }
    const offered = sel ? [...sel.options].map((o) => o.textContent) : [];
    let reattached = false;
    if (sel) {
      const opt = [...sel.options].find((o) => o.textContent.includes("ZZ Roles Dir Hireling"));
      if (opt) sel.value = opt.value;
      const dlg = sel.closest("dialog");
      (dlg.querySelector('button[data-action="ok"]') ?? dlg.querySelector("footer button, .form-footer button"))?.click();
      for (let i = 0; i < 40 && document.querySelector('dialog select[name="keeperTarget"]'); i++) await sleep(100);
      await sleep(500);
      reattached = s.system.connectedTo === h.uuid;
    }

    await s.sheet.close();
    await h.sheet.close();
    await s.delete(); await h.delete(); await pc.delete();
    return { sackTab, hireTab, afterDetach, attachShown, offered: offered.length, reattached };
  });

  dirs.sackTab.keeperLine && dirs.sackTab.keeperLabel.includes("ZZ Roles Dir Hireling") && dirs.sackTab.detach
    ? ok("a connected sack names its keeper, breakable here", `"${dirs.sackTab.keeperLabel.trim()}"`)
    : bad("a connected sack names its keeper, breakable here", JSON.stringify(dirs.sackTab));
  !dirs.sackTab.add && !dirs.sackTab.attach
    ? ok("the sack offers neither keeping nor a second parent", "cannot keep; already connected")
    : bad("the sack offers neither keeping nor a second parent", JSON.stringify(dirs.sackTab));
  dirs.hireTab.keeperLine && dirs.hireTab.add && !dirs.hireTab.attach && dirs.hireTab.unlinkIcon
    ? ok("the hireling shows keeper above AND kept below", "both directions on one tab")
    : bad("the hireling shows keeper above AND kept below", JSON.stringify(dirs.hireTab));
  dirs.afterDetach.connectedTo === "" && dirs.afterDetach.formerly === "ZZ Roles Dir Hireling"
    ? ok("detach from the child end unlinks + stamps", `formerly "${dirs.afterDetach.formerly}"`)
    : bad("detach from the child end unlinks + stamps", JSON.stringify(dirs.afterDetach));
  dirs.attachShown && dirs.offered > 0 && dirs.reattached
    ? ok("Connect to… reattaches through the real picker", `${dirs.offered} keeper(s) offered`)
    : bad("Connect to… reattaches through the real picker", JSON.stringify(dirs));

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
    const sack = await Cls.create({
      name: "ZZ Roles Tok Sack", type: "npc",
      system: { role: "container", containerClass: "sack", hp: { value: 0, max: 0 }, generationEnabled: false },
    });

    const res = {
      isToken: synth?.isToken === true,
      worldIsNotToken: world.isToken === false,
      canKeep: synth?.canKeepConnected,
      canBe: synth?.canBeConnected,
      // The world actor it was made from must be unaffected.
      worldCanKeep: world.canKeepConnected,
      showsTab: synth?.system?.showContainersTab,
      worldShowsTab: world.system?.showContainersTab,
    };
    // And the write itself is refused, not merely hidden.
    res.connectRefused = !(await synth.connectActor(sack));
    res.sackUntouched = !sack.system.connectedTo;

    await td.delete();
    await sack.delete();
    await world.delete();
    await sleep(200);
    return res;
  });

  if (tok.error) bad("token leg", tok.error);
  else {
    tok.isToken && tok.worldIsNotToken
      ? ok("the probe really built a synthetic token actor", "isToken true, world actor false")
      : bad("the probe really built a synthetic token actor", JSON.stringify(tok));
    !tok.canKeep && !tok.canBe && tok.worldCanKeep
      ? ok("it neither keeps nor connects, world actor unaffected")
      : bad("it neither keeps nor connects, world actor unaffected", JSON.stringify(tok));
    tok.showsTab === false && tok.worldShowsTab === true
      ? ok("no Connections tab on the token copy", "the tab could only ever read 0")
      : bad("no Connections tab on the token copy", JSON.stringify(tok));
    tok.connectRefused && tok.sackUntouched
      ? ok("a direct connectActor from it is refused", "no link written into a delta")
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
  // 12 cells for 13 classes: the gallery shows each GLYPH once, and mule/donkey
  // share Skoll's donkey (game-icons.net has no mule). Removing the dedupe
  // filter fails BOTH of the first two assertions — 13 cells, donkey.svg twice.
  pick.cellCount === 12 && pick.classed === 12
    ? ok("one cell per glyph, each carrying its class key", `${pick.cellCount} cells for 13 classes`)
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

  /* ---- the player leg: every Warden wall, from the other side ---- */
  // Alice OWNS every actor involved, so canUserModify passes everywhere and
  // the isGM gates are the ONLY thing refusing — remove them and both direct
  // calls below land, which is what makes this the fail-without-the-fix
  // witness. A Warden client can never show that (permission memo: a GM can
  // never reproduce a permission bug).
  console.log("\na player sees no edge controls, and the walls hold anyway");
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
    return { pcUuid: pc.uuid, sackUuid: sack.uuid, freeUuid: free.uuid };
  });
  if (seed.error) bad("player leg setup", seed.error);
  else {
    const alicePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
    const aliceErrors = watchErrors(alicePage);
    await joinAs(alicePage, "Alice");
    await dismissChrome(alicePage);

    const player = await alicePage.evaluate(async ({ pcUuid, sackUuid, freeUuid }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const pc = await fromUuid(pcUuid);
      const sack = await fromUuid(sackUuid);
      const free = await fromUuid(freeUuid);
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
      // Enforcement, not affordance: the direct calls a hidden link cannot
      // stop. Confirm stubbed so an UNFIXED unlink fails fast instead of
      // hanging the harness on a dialog nobody answers.
      const DialogV2 = foundry.applications.api.DialogV2;
      const origConfirm = DialogV2.confirm;
      DialogV2.confirm = async () => true;
      const connectReturned = await pc.connectActor(free);
      const connectLanded = free.system.connectedTo === pc.uuid;
      await pc.unlinkOwnedContainer(sack.uuid);
      const stillConnected = sack.system.connectedTo === pc.uuid;
      DialogV2.confirm = origConfirm;
      await pc.sheet.close();
      await sack.sheet.close();
      return { pcTab, sackTab, connectReturned, connectLanded, stillConnected };
    }, seed);

    player.pcTab.tab && player.pcTab.rowForSack && player.pcTab.editIcon
      ? ok("Alice still SEES her connections", "tab, row and edit intact")
      : bad("Alice still SEES her connections", JSON.stringify(player.pcTab));
    !player.pcTab.add && !player.pcTab.unlinkIcon
      ? ok("no Add Connection, no unlink on her PC", "edge controls are the Warden's")
      : bad("no Add Connection, no unlink on her PC", JSON.stringify(player.pcTab));
    player.sackTab.keeperLine && !player.sackTab.detach && !player.sackTab.attach
      ? ok("the sack shows its keeper, offers no controls", "read-only from below too")
      : bad("the sack shows its keeper, offers no controls", JSON.stringify(player.sackTab));
    !player.connectReturned && !player.connectLanded
      ? ok("a direct connectActor call is refused", "she owns both ends; only the Warden wall said no")
      : bad("a direct connectActor call is refused", JSON.stringify(player));
    player.stillConnected
      ? ok("a direct unlink call is refused", "the sack stays connected")
      : bad("a direct unlink call is refused", "the player unlinked it — the wall is not there");

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

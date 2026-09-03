#!/usr/bin/env node
/**
 * The Actor Directory's creation surface, in BOTH instances and at three
 * permission levels.
 *
 * Since 2026-08-02 core's own Create Actor button is REMOVED (every creation
 * path must carry a complete workflow, and core's bare type-picker is not
 * one), three role buttons join Generate PC / Generate NPC — Create
 * Container / Create Mount / Create Transport, each opening the shared
 * name+Type dialog (CairnActor.createThing) — and the folder "+" survives
 * because it routes through CairnActor.createDialog, which is the role
 * switchboard now.
 *
 * The popout matters for its own recorded reason: Foundry renders a second,
 * independent ActorDirectory when the sidebar tab is popped out, and the
 * injection hook once guarded on a document-wide getElementById that the
 * docked directory had already satisfied — so the popped-out window silently
 * got no buttons at all.
 *
 * The permission matrix: a Warden sees 8 buttons, an ACTOR_CREATE player 5
 * (no Monster, no Faction, no Import), a player without ACTOR_CREATE exactly
 * ONE — Generate PC, whose click is a socket relay (the generatePC action):
 * the active Warden's client runs the generator and stamps the requester
 * OWNER, because a player's own client cannot create an Actor at all. Core's
 * Create Actor is gone for all three. The count assertions were stale-red
 * before this rewrite (they said 4 while a Warden had had 5 since the faction
 * button) because this probe was not in that batch's run list; the matrix is
 * the fix for the class of miss, not just the number.
 *
 * The player legs need TWO preconditions and this probe used to establish only
 * one. ACTOR_CREATE was granted; `allow-player-generate` — the Warden's switch
 * for the player-facing Generate PC button — was not, and the dev world keeps it
 * OFF by the user's own choice. A GM never notices (the directory hook reads
 * `isGM || setting`), so the probe was green when written and went red the day
 * somebody turned the switch off in a world they play in. Six legs reported a
 * missing button that the world had simply switched off. Both are captured at
 * entry, set, and restored to the CAPTURED value in the finally — never to "on",
 * which would leave a test run holding the Warden's switch. Alice asserts the
 * setting on HER client, because asserting it on the page that wrote it proves
 * only that the write happened.
 *
 * The relay legs need a quiet world: two GM CLIENTS logged in as the same
 * Warden both pass the activeGM check and both answer a generatePC, so a
 * live user session alongside this probe's GM page can double-mint — the
 * exactly-one leg is the tripwire, and its red under a live session is the
 * standing live-GM confound, not a regression. A crashed run can also strand
 * the relay-minted PC (random name, no ZZ prefix): the finally deletes it,
 * but nothing can sweep it after a kill -9.
 *
 * Usage: npm run dev:directory-buttons
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
watchdog(300000, "dev:directory-buttons");
await joinAsGM(page);
await dismissChrome(page);

let failed = false;
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? `  ${d}` : ""}`);
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? `  ${d}` : ""}`); failed = true; };

// Nine and six since 2026-08-20: the NPC/Hireling split gave each person role
// its own Generate button. A COUNT rather than a list of labels, deliberately —
// the labels are i18n keys and a translated world would fail a list compare
// while the row is perfectly correct; what this leg is for is a button that
// silently stopped being injected.
// Seven since 2026-09-02 (261abcd1): players got their own Import from
// Kettlewright, riding the SAME allow-player-generate switch and relay shape
// as Generate PC.
const GM_BUTTONS = 9;
const PLAYER_BUTTONS = 7;

try {
  // A prior aborted run must not satisfy (or trip) this one's assertions.
  await page.evaluate(async () => {
    for (const a of game.actors.filter((x) => x.name.startsWith("ZZ Dir "))) await a.delete();
    for (const f of game.folders.filter((x) => x.name === "ZZ Dir Folder")) await f.delete();
  });

  /* --- 1. both instances: our buttons in, core's Create Actor out --------- */
  console.log("\nboth directory instances, as the Warden");
  const r = await page.evaluate(async () => {
    const out = {};
    const read = (root) => ({
      buttons: [...(root?.querySelectorAll(".character-generator button") ?? [])].map((b) => b.textContent.trim()),
      coreCreate: !!root?.querySelector(".directory-header .create-entry"),
    });

    await ui.actors.render(true);
    await new Promise((res) => setTimeout(res, 500));
    const dockedEl = document.getElementById("actors");
    out.docked = read(dockedEl);

    const pop = await ui.actors.renderPopout();
    await new Promise((res) => setTimeout(res, 800));
    const popEl = pop?.element instanceof HTMLElement ? pop.element : pop?.element?.[0];
    out.popped = read(popEl);
    // Guard against a false pass: if the popout resolved to the docked element,
    // the assertion below would be testing the same DOM twice.
    out.popIsSeparate = popEl && dockedEl ? popEl !== dockedEl : null;
    try { await pop.close(); } catch { /* already gone */ }
    return out;
  });

  r.docked.buttons.length === GM_BUTTONS
    ? ok(`docked directory has its ${GM_BUTTONS} buttons`, `(${r.docked.buttons.join(", ")})`)
    : fail(`docked directory buttons: ${JSON.stringify(r.docked.buttons)}`);
  ["Create Container", "Create Companion", "Create Transport"].every((l) => r.docked.buttons.includes(l))
    ? ok("the three role buttons are among them")
    : fail("the three role buttons are among them", JSON.stringify(r.docked.buttons));
  !r.docked.coreCreate && !r.popped.coreCreate
    ? ok("core's Create Actor button is gone from both instances")
    : fail("core's Create Actor button is back", JSON.stringify({ docked: r.docked.coreCreate, popped: r.popped.coreCreate }));
  r.popIsSeparate
    ? ok("the popout is a separate element from the docked directory")
    : fail("popout and docked resolved to the same element — the popout test is meaningless");
  r.popped.buttons.length === GM_BUTTONS
    ? ok(`popped-out directory has its ${GM_BUTTONS} buttons`)
    : fail(`popped-out directory buttons: ${JSON.stringify(r.popped.buttons)}`);

  /* --- 2. each role button mints its role, through the REAL dialog -------- */
  console.log("\neach role button mints the right role and kind");
  const mints = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (test, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (test()) return true; await sleep(150); }
      return test();
    };
    const out = [];
    // `art` is a STRING pattern, not a RegExp — the cases ride back out of
    // this evaluate and a RegExp does not reliably survive the serialization.
    const CASES = [
      { btn: ".create-container-button", role: "container", kind: "crate", name: "ZZ Dir Crate", slots: 6, art: "crate\\.svg$" },
      { btn: ".create-mount-button", role: "companion", kind: "horse", name: "ZZ Dir Horse", slots: 4, art: "horse\\.svg$" },
      { btn: ".create-transport-button", role: "transport", kind: "wagon", name: "ZZ Dir Wagon", slots: 8, art: "wagon\\.svg$" },
    ];
    for (const c of CASES) {
      document.querySelector(`#actors ${c.btn}`)?.click();
      let form = null;
      await until(() => {
        form = [...document.querySelectorAll("dialog form")].find((f) => f.elements?.thingName);
        return !!form;
      });
      if (!form) { out.push({ name: c.name, error: "no dialog" }); continue; }
      form.elements.thingName.value = c.name;
      form.elements.kindChoice.value = c.kind;
      form.closest("dialog").querySelector('button[data-action="ok"]')?.click();
      await until(() => !!game.actors.getName(c.name));
      const a = game.actors.getName(c.name);
      out.push({
        name: c.name,
        role: a?.system.role,
        cls: a?.system.containerClass,
        slots: a?.system.slots,
        img: a?.img,
        connectedTo: a?.system.connectedTo ?? null,
        wanted: c,
      });
      await a?.sheet?.close();
      await a?.delete();
      // The dialog must be gone before the next opens — a settled DialogV2
      // outlives its promise in the DOM.
      await until(() => ![...document.querySelectorAll("dialog form")].some((f) => f.elements?.thingName));
    }
    return out;
  });

  for (const m of mints) {
    const w = m.wanted ?? {};
    !m.error && m.role === w.role && m.cls === w.kind && m.slots === w.slots
      && w.art && new RegExp(w.art).test(m.img ?? "") && m.connectedTo === ""
      ? ok(`${w.btn} → ${w.role}/${w.kind}`, `${m.slots} slots, class art, unconnected`)
      : fail(`${w.btn ?? m.name} minted wrong`, JSON.stringify(m));
  }

  /* --- 2b. a NAMED mount clones its pack document (ruled 2026-08-02) ------ */
  // The Outrider's six horses are pack docs with their own statblocks, so
  // Create Mount's Type select carries an indented clone group. Pre-fix red
  // witness: the select has no optgroup at all. The plain Horse kind is
  // asserted to SURVIVE beside it — the group must add, never replace.
  console.log("\na named mount clones its pack document");
  const template = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (test, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (test()) return true; await sleep(150); }
      return test();
    };
    // The source of truth the clone is judged against.
    const pack = game.packs.get("air-bladder.mounts-transports");
    const idx = await pack.getDocuments();
    const srcDoc = idx.find((d) => d.name === "Heavy Destrier");
    const src = srcDoc ? {
      hpMax: srcDoc.system.hp?.max, armor: srcDoc.system.armor,
      slots: srcDoc.system.slots, cls: srcDoc.system.containerClass, img: srcDoc.img,
      // Every pack doc states {default: 0}. The clone must NOT inherit it —
      // see the ownership assertion below.
      ownership: srcDoc.ownership?.default,
    } : null;

    document.querySelector("#actors .create-mount-button")?.click();
    let form = null;
    await until(() => {
      form = [...document.querySelectorAll("dialog form")].find((f) => f.elements?.thingName);
      return !!form;
    });
    if (!form) return { error: "no dialog" };
    const select = form.elements.kindChoice;
    const group = select.querySelector("optgroup");
    const opt = [...select.querySelectorAll("optgroup option")]
      .find((o) => o.textContent === "Heavy Destrier");
    const out = {
      src,
      hasGroup: !!group,
      groupLabel: group?.label ?? null,
      namedCount: select.querySelectorAll("optgroup option").length,
      plainHorseSurvives: [...select.options].some((o) => o.value === "horse"),
      sentinel: opt?.value ?? null,
    };
    if (!opt) {
      // A prompt() dialog has NO cancel button — the header ✕ is the only
      // dismiss. Close it and WAIT it out, or the next leg's form lookup
      // finds this stale mount dialog first and feeds it the folder leg's
      // input (learned from this leg's own negative control: the collateral
      // was a role-mount mint with a blank class).
      form.closest("dialog")?.querySelector('[data-action="close"]')?.click();
      await until(() => ![...document.querySelectorAll("dialog form")].some((f) => f.elements?.thingName));
      return { ...out, error: "no Heavy Destrier option" };
    }
    // The Other… reveal, through the REAL change event. This was dead in the
    // shipped UI until 2026-08-02 — DialogV2 renders the content div's
    // innerHTML, so the listener wired on the original node never ran, and
    // every probe set values directly so nothing caught it. This dispatch is
    // what catches it now.
    select.value = "__other__";
    select.dispatchEvent(new Event("change"));
    out.otherRevealed = form.elements.kindOther.hidden === false;
    select.value = opt.value;
    select.dispatchEvent(new Event("change"));
    out.otherRehidden = form.elements.kindOther.hidden === true;
    out.namePrefilled = form.elements.thingName.value;
    form.closest("dialog").querySelector('button[data-action="ok"]')?.click();
    await until(() => !!game.actors.getName("Heavy Destrier"));
    const a = game.actors.getName("Heavy Destrier");
    out.minted = !!a;
    if (a) {
      out.role = a.system.role;
      out.cls = a.system.containerClass;
      out.slots = a.system.slots;
      out.hpMax = a.system.hp?.max;
      out.armor = a.system.armor;
      out.img = a.img;
      out.connectedTo = a.system.connectedTo ?? null;
      out.isWorldActor = !a.pack;
      out.ownership = a.ownership?.default;
      out.compendiumSource = a._stats?.compendiumSource ?? null;
      await a.sheet?.close();
      await a.delete();
    }
    await until(() => ![...document.querySelectorAll("dialog form")].some((f) => f.elements?.thingName));
    return out;
  });

  template.hasGroup && template.plainHorseSurvives && template.namedCount >= 6
    ? ok(`the Type select carries the clone group (“${template.groupLabel}”, ${template.namedCount} entries)`, "plain Horse survives beside it")
    : fail("the Type select carries the clone group", JSON.stringify(template));
  String(template.sentinel ?? "").startsWith("doc:")
    ? ok("template entries use the doc: sentinel", template.sentinel)
    : fail("template entries use the doc: sentinel", String(template.sentinel));
  template.otherRevealed && template.otherRehidden
    ? ok("Other… reveals its input through the real change event", "dead until 2026-08-02: DialogV2 renders innerHTML, listeners go via render")
    : fail("Other… reveals its input", JSON.stringify({ revealed: template.otherRevealed, rehidden: template.otherRehidden }));
  template.namePrefilled === "Heavy Destrier"
    ? ok("picking one prefills the (editable) name")
    : fail("picking one prefills the name", `"${template.namePrefilled}"`);
  !template.error && template.minted && template.role === "companion" && template.connectedTo === "" && template.isWorldActor
    ? ok("the pick mints a world actor: role mount, unconnected")
    : fail("the pick mints a world actor", JSON.stringify(template));
  // The statblock crosses whole — judged against the pack doc, with the
  // plan's stated numbers pinned so a pack edit can't silently weaken this.
  template.src && template.hpMax === template.src.hpMax && template.armor === template.src.armor
    && template.slots === template.src.slots && template.cls === template.src.cls && template.img === template.src.img
    ? ok("the clone carries the document's statblock and art", `hp ${template.hpMax}, armor ${template.armor}, ${template.slots} slots, ${template.cls}`)
    : fail("the clone carries the document's statblock and art", JSON.stringify({ got: template, want: template.src }));
  template.hpMax === 8 && template.slots === 2
    ? ok("Heavy Destrier lands at 8 HP / 2 slots", "the ruled numbers")
    : fail("Heavy Destrier lands at 8 HP / 2 slots", `hp=${template.hpMax} slots=${template.slots}`);
  // ...but NOT its ownership. _preCreate's LIMITED default is guarded on
  // `ownership === undefined` so a pack IMPORT keeps what the pack says, and
  // the clone was carrying {default: 0} straight through it — two mounts from
  // the same dialog a minute apart, one visible to players and one not. The
  // pack reading beside it is what makes this a statement about the clone
  // rather than about the pack (review #7 finding 10).
  // 0/1 are NONE/LIMITED; CONST lives in the page, not in node.
  template.src?.ownership === 0 && template.ownership === 1
    ? ok("the clone does NOT inherit the pack's ownership", "pack 0 (NONE) -> world 1 (LIMITED), as the kind path mints")
    : fail("the clone does NOT inherit the pack's ownership",
      `pack=${template.src?.ownership} clone=${template.ownership} (want pack 0 NONE, clone 1 LIMITED)`);
  template.compendiumSource?.includes("mounts-transports")
    ? ok("the clone records where it came from", template.compendiumSource)
    : fail("the clone records where it came from", String(template.compendiumSource));

  /* --- 3. the folder "+" opens the switchboard, and the folder LANDS ------ */
  console.log("\nthe folder \"+\" survives, routes to the switchboard, and the mint lands in it");
  const folderLeg = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const until = async (test, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (test()) return true; await sleep(150); }
      return test();
    };
    const folder = await Folder.create({ name: "ZZ Dir Folder", type: "Actor" });
    await ui.actors.render(true);
    await sleep(600);
    const plus = document.querySelector(`#actors [data-folder-id="${folder.id}"] .create-entry`)
      ?? document.querySelector(`#actors li[data-entry-id="${folder.id}"] .create-entry`);
    const out = { plusFound: !!plus };
    plus?.click();
    let sel = null;
    await until(() => {
      sel = document.querySelector('dialog select[name="choice"]');
      return !!sel;
    });
    out.switchboardOpened = !!sel;
    if (sel) {
      sel.value = "container";
      sel.closest("dialog").querySelector('button[data-action="ok"]')?.click();
      let form = null;
      await until(() => {
        form = [...document.querySelectorAll("dialog form")].find((f) => f.elements?.thingName);
        return !!form;
      });
      out.thingDialog = !!form;
      if (form) {
        form.elements.thingName.value = "ZZ Dir Foldered";
        form.elements.kindChoice.value = "sack";
        form.closest("dialog").querySelector('button[data-action="ok"]')?.click();
        await until(() => !!game.actors.getName("ZZ Dir Foldered"));
        const a = game.actors.getName("ZZ Dir Foldered");
        out.folderLanded = a?.folder?.id === folder.id;
        out.role = a?.system.role;
        out.cls = a?.system.containerClass;
        await a?.sheet?.close();
        await a?.delete();
      }
    }
    // Sweep ANY dialog left open before returning: under the negative control
    // the folder "+" opens core's own create dialog instead of the
    // switchboard, and a lingering modal poisons the next block's dialog
    // pop() — the content-source leg would close the wrong dialog and hang on
    // its pending promise.
    for (const d of document.querySelectorAll("dialog")) {
      d.querySelector('[data-action="close"], button[data-action="cancel"]')?.click();
    }
    await sleep(400);
    await folder.delete();
    return out;
  });

  folderLeg.plusFound && folderLeg.switchboardOpened
    ? ok("the folder \"+\" is present and opens the switchboard")
    : fail("the folder \"+\" is present and opens the switchboard", JSON.stringify(folderLeg));
  folderLeg.thingDialog && folderLeg.folderLanded && folderLeg.role === "container" && folderLeg.cls === "sack"
    ? ok("the switchboard's container path mints INTO the folder", "role container, kind sack")
    : fail("the switchboard's container path mints INTO the folder", JSON.stringify(folderLeg));

  /* --- 4. cancelling the content-source picker must create NOTHING -------- */
  // The picker only appears when more than one source is enabled, so the probe
  // turns both on and restores them afterwards. Dismissing used to fall through
  // to "2e" under the rule that the Generate button never does nothing — which
  // is right for a Warden who has switched every source off (a configuration
  // gap) and wrong for a ✕ (an instruction). It left a stray actor behind every
  // time. Reported as issue #6.
  console.log("\ndismissing the content-source picker");
  const cancel = await page.evaluate(async () => {
    const NS = "air-bladder";
    const prior = {
      twoE: game.settings.get(NS, "content-source-2e"),
      bare: game.settings.get(NS, "content-source-barebones"),
    };
    await game.settings.set(NS, "content-source-2e", true);
    await game.settings.set(NS, "content-source-barebones", true);
    await ui.sidebar.changeTab?.("actors", "primary");
    await new Promise((res) => setTimeout(res, 600));

    // Count CHARACTERS, not all actors: the leak this guards against creates a
    // character, while a live Warden session minting NPCs alongside the probe
    // (2026-08-02: "Mount", 6:56 PM, mid-run) trips a whole-directory count.
    const pcCount = () => game.actors.filter((a) => a.type === "character").length;
    const before = pcCount();

    // Assert on what generateCharacter RESOLVES, not on an actor count after a
    // fixed sleep. Generating a 2e character rolls tables, resolves gear from
    // packs and can mint container Actors — comfortably longer than any sleep
    // worth writing. A count read too early shows "nothing was created" whether
    // the fix works or not, and the negative control proved exactly that: with
    // the fix reverted the probe still passed.
    const CG = game.cairn.characterGenerator;
    const pending = CG.generateCharacter();
    await new Promise((res) => setTimeout(res, 1200));
    const dlg = [...document.querySelectorAll(".application.dialog, dialog.application")].pop();
    const closeBtn = dlg?.querySelector('[data-action="close"]');
    const shown = !!dlg && !!closeBtn;
    closeBtn?.click();
    const resolved = await pending;

    // Belt and braces: the wired-up button must not create one either. Poll for
    // a new actor rather than sleeping once.
    document.querySelector(".create-character-generator-button")?.click();
    await new Promise((res) => setTimeout(res, 1000));
    const dlg2 = [...document.querySelectorAll(".application.dialog, dialog.application")].pop();
    dlg2?.querySelector('[data-action="close"]')?.click();
    let after = pcCount();
    for (let i = 0; i < 100 && after === before; i++) {
      await new Promise((res) => setTimeout(res, 100));
      after = pcCount();
    }

    await game.settings.set(NS, "content-source-2e", prior.twoE);
    await game.settings.set(NS, "content-source-barebones", prior.bare);
    return { shown, before, after, resolvedNull: resolved === null, resolved: resolved === null ? null : typeof resolved };
  });

  cancel.shown
    ? ok("the content-source picker opens with a dismiss control")
    : fail("no content-source picker with a [data-action=close] appeared — the cancel check below proves nothing");
  cancel.resolvedNull
    ? ok("dismissing the picker resolves generateCharacter() to null")
    : fail(`dismissing the picker resolved to ${cancel.resolved}, not null — a character was generated`);
  cancel.after === cancel.before
    ? ok(`dismissing the picker created no actor (${cancel.before} before and after)`)
    : fail(`dismissing the picker created ${cancel.after - cancel.before} actor(s)`);

  /* --- 5. the permission matrix: ACTOR_CREATE player, then bare player ---- */
  // A GM can never reproduce a permission bug — this is the joinAs half. The
  // bare-player case is made by flipping ACTOR_CREATE off for the PLAYER role
  // from the GM page (world setting, restored in finally from NODE), because
  // no persona without it is guaranteed to exist.
  console.log("\nthe permission matrix, as Alice");
  const alicePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  const aliceErrors = watchErrors(alicePage);
  const priorPerms = await page.evaluate(() => game.settings.get("core", "permissions"));
  // The player legs need TWO preconditions, and only one of them was ever
  // established. `allow-player-generate` is the Warden's switch for the
  // player-facing Generate PC button (`allowGen` in cairn.js's directory hook is
  // `isGM || setting`, so a GM never notices it is off) — and the dev world
  // keeps it OFF, which is the user's choice and not a bug. Every leg from here
  // down is about that button: the 5-button count, the bare player's ONE button,
  // and the whole relay section that clicks it. So all six went red on world
  // state rather than on code, which is the "a world SETTING is a precondition
  // too" class already fixed for dev:playergen (2026-08-09) and
  // dev:container-link and missed here.
  //
  // CAPTURE then SET, and the finally restores the CAPTURED value — so a world
  // that keeps the switch off keeps it off through every run, and the probe is
  // green either way. Never assert a state nothing established.
  const priorGen = await page.evaluate(() => game.settings.get("air-bladder", "allow-player-generate"));
  let relayMintedUuid = null;
  try {
    await page.evaluate(async () => {
      await game.settings.set("air-bladder", "allow-player-generate", true);
    });
    // GRANT first, as dev:monster-gen's Alice leg does and for its reason: the
    // dev world's PLAYER role does not hold ACTOR_CREATE, so without the grant
    // every player leg below is vacuous. Restored in the finally.
    const granted = await page.evaluate(async () => {
      const role = game.users.getName("Alice")?.role;
      if (role == null) return false;
      const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
      perms.ACTOR_CREATE ??= [];
      if (!perms.ACTOR_CREATE.includes(role)) perms.ACTOR_CREATE.push(role);
      await game.settings.set("core", "permissions", perms);
      return true;
    });
    if (!granted) fail("no Alice user in the world — run `npm run dev:players` first");
    await joinAs(alicePage, "Alice");
    await dismissChrome(alicePage);

    const readAlice = () => alicePage.evaluate(async () => {
      await ui.actors.render(true);
      await new Promise((res) => setTimeout(res, 500));
      const root = document.getElementById("actors");
      return {
        buttons: [...(root?.querySelectorAll(".character-generator button") ?? [])].map((b) => b.textContent.trim()),
        coreCreate: !!root?.querySelector(".directory-header .create-entry"),
        canCreate: game.user.can("ACTOR_CREATE"),
        // Read on ALICE's client, not the Warden's: a setting set on the GM page
        // reaches her over the socket, and an assertion made on the page that
        // WROTE it proves only that the write happened.
        allowGen: game.settings.get("air-bladder", "allow-player-generate"),
      };
    });

    const withCreate = await readAlice();
    withCreate.canCreate
      ? ok("Alice holds ACTOR_CREATE", "the player legs are not vacuous")
      : fail("Alice holds ACTOR_CREATE", "grant it in the dev world — every player leg below is vacuous");
    withCreate.allowGen
      ? ok("and player generation is switched on for her", "established by this run, restored at the end")
      : fail("and player generation is switched on for her", "allow-player-generate did not reach her client — every Generate PC leg below is vacuous");
    withCreate.buttons.length === PLAYER_BUTTONS
      && !["Generate Monster", "Generate Faction"].some((l) => withCreate.buttons.includes(l))
      ? ok(`an ACTOR_CREATE player sees ${PLAYER_BUTTONS} buttons, none of the Warden's`, `(${withCreate.buttons.join(", ")})`)
      : fail("ACTOR_CREATE player buttons", JSON.stringify(withCreate.buttons));
    !withCreate.coreCreate
      ? ok("core's Create Actor is gone for her too")
      : fail("core's Create Actor is back for a player");

    // Flip ACTOR_CREATE off for PLAYER from the GM side, then RELOAD Alice —
    // the honest model of the real flow: a permission change reaches players
    // on their next load (core prompts reloads for exactly this), and our
    // injection is render-gated, not revocation-swept. Already-injected
    // buttons lingering until then is the same window core's own UI has, and
    // the server wall refuses the click either way.
    await page.evaluate(async () => {
      const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
      perms.ACTOR_CREATE = (perms.ACTOR_CREATE ?? []).filter((role) => role >= CONST.USER_ROLES.ASSISTANT);
      await game.settings.set("core", "permissions", perms);
    });
    await alicePage.reload({ waitUntil: "networkidle" });
    await alicePage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
    await dismissChrome(alicePage);
    const bare = await readAlice();
    // INVERTED 2026-08-02 (was: "no creation surface at all"): the generatePC
    // relay gives a bare player a button. TWO since 2026-09-02: Import from
    // Kettlewright rides the same relay, so a permission-less player keeps
    // exactly the relay-backed pair and nothing that would need ACTOR_CREATE.
    // Red witness: pre-relay code renders zero buttons here.
    !bare.canCreate && bare.buttons.length === 2
      && bare.buttons.includes("Generate PC") && bare.buttons.includes("Import from Kettlewright")
      && !bare.coreCreate
      ? ok("without ACTOR_CREATE she sees exactly the two relay-backed buttons",
        "Generate PC + Import from Kettlewright")
      : fail("without ACTOR_CREATE she sees exactly the two relay-backed buttons", JSON.stringify(bare));

    /* --- 5b. the offer greys without a Warden (2026-09-02) --------------- */
    // The click-time refusals (section 6's guard leg) predate this; what was
    // missing was the OFFER — a bare player's directory rendered both relay
    // buttons live while no Warden was online, so the click failed where the
    // row could have said so. Greying is the affordance, the refusal is the
    // enforcement (the marketplace rule). Proven IN-PAGE: activeGM is a
    // prototype getter, so an instance property shadows it on Alice's client
    // alone and a delete restores it — no real GM logs out, because a live
    // Warden session beside the probe would confound a real-disconnect leg.
    console.log("\nthe offer greys without a Warden, as bare Alice");
    const grey = await alicePage.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const read = () => {
        const btns = [...(document.getElementById("actors")?.querySelectorAll(".character-generator button") ?? [])];
        return { count: btns.length, disabled: btns.map((b) => b.disabled), tips: btns.map((b) => b.dataset.tooltip ?? null) };
      };
      const out = { keyKnown: game.i18n.has("CAIRN.WardenRequired") };
      Object.defineProperty(game.users, "activeGM", { get: () => null, configurable: true });
      await ui.actors.render(true);
      await sleep(500);
      out.without = read();
      // The liveness hook, driven at the seam core itself fires on any user's
      // active flip (users.mjs:137). A render counter makes the scoping
      // observable: a player's flip must re-render nothing, a GM's must
      // re-render the row. Quiet-world caveat as in the relay legs — a live
      // session re-rendering the directory inside this window is the standing
      // confound, not a regression.
      let renders = 0;
      const proto = Object.getPrototypeOf(ui.actors);
      const orig = proto.render;
      ui.actors.render = function (...a) { renders += 1; return orig.apply(this, a); };
      const gmUser = game.users.find((u) => u.isGM);
      const playerUser = game.users.find((u) => !u.isGM);
      Hooks.callAll("userConnected", playerUser, true);
      await sleep(400);
      out.playerFlipRenders = renders;
      delete game.users.activeGM; // the Warden "returns"
      Hooks.callAll("userConnected", gmUser, true);
      await sleep(800);
      out.gmFlipRenders = renders;
      delete ui.actors.render; // restore the prototype lookup, not a copy
      out.after = read();
      out.restored = !!game.users.activeGM && ui.actors.render === orig;
      return out;
    });
    grey.keyKnown
      ? ok("the tooltip key exists", "CAIRN.WardenRequired")
      : fail("CAIRN.WardenRequired is missing from lang/en.json — the tooltip would show the raw key");
    grey.without.count === 2 && grey.without.disabled.every(Boolean)
      && grey.without.tips.every((t) => t === "CAIRN.WardenRequired")
      ? ok("with no Warden online both buttons render disabled, tooltip'd", "the greying is the affordance")
      : fail("with no Warden online both buttons render disabled", JSON.stringify(grey.without));
    grey.playerFlipRenders === 0
      ? ok("a player's connect re-renders nothing", "the hook is scoped to GM flips")
      : fail("a player's connect re-rendered the directory", `${grey.playerFlipRenders} render(s)`);
    grey.gmFlipRenders >= 1 && grey.after.count === 2 && grey.after.disabled.every((d) => !d)
      && grey.after.tips.every((t) => t === null)
      ? ok("the Warden's arrival re-renders the row live", "buttons enabled, tooltips gone")
      : fail("the Warden's arrival re-renders the row live", JSON.stringify({ renders: grey.gmFlipRenders, after: grey.after }));
    grey.restored
      ? ok("the shadows are off again", "the relay legs below are real")
      : fail("a shadow did not restore — the relay legs below are suspect");

    // The other half of the scoping: a client that HOLDS ACTOR_CREATE runs
    // its imports and generation locally, so a GM flip must re-render nothing
    // there — asserted on the probe's own Warden page.
    const gmScope = await page.evaluate(async () => {
      let renders = 0;
      const proto = Object.getPrototypeOf(ui.actors);
      const orig = proto.render;
      ui.actors.render = function (...a) { renders += 1; return orig.apply(this, a); };
      Hooks.callAll("userConnected", game.users.find((u) => u.isGM), true);
      await new Promise((r) => setTimeout(r, 400));
      delete ui.actors.render;
      return { renders, restored: ui.actors.render === orig };
    });
    gmScope.renders === 0 && gmScope.restored
      ? ok("an ACTOR_CREATE client ignores the flip entirely")
      : fail("an ACTOR_CREATE client ignores the flip entirely", JSON.stringify(gmScope));

    /* --- 5c. one flip renders the popout ONCE (review #22) ---------------- */
    // The handler used to render ui.actors AND ui.actors.popout — but a docked
    // tab's render already forwards to its rendered popout
    // (sidebar-tab.mjs:114-117), so the popped-out directory drew twice per
    // flip. Count the POPOUT's own render calls across one GM flip, on the
    // bare-Alice client the handler runs for.
    const popCount = await alicePage.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const pop = await ui.actors.renderPopout();
      await sleep(600);
      let renders = 0;
      const proto = Object.getPrototypeOf(pop);
      const orig = proto.render;
      pop.render = function (...a) { renders += 1; return orig.apply(this, a); };
      Hooks.callAll("userConnected", game.users.find((u) => u.isGM), true);
      await sleep(800);
      delete pop.render;
      const out = {
        renders,
        restored: pop.render === orig,
        isPopout: pop !== ui.actors && ui.actors.popout === pop,
      };
      try { await pop.close(); } catch { /* already gone */ }
      return out;
    });
    popCount.isPopout && popCount.renders === 1
      ? ok("one GM flip renders the popped-out directory exactly once", "the docked render forwards to it")
      : fail("one GM flip renders the popped-out directory exactly once", JSON.stringify(popCount));
    popCount.restored
      ? ok("the popout render counter is off again")
      : fail("the popout render counter did not restore — later popout legs are suspect");

    /* --- 6. the generatePC relay, as bare Alice ------------------------- */
    console.log("\nthe generatePC relay, as bare Alice");

    // The guard first: no Warden online → a warning, no emit, no actor.
    // activeGM is a prototype getter, so an instance property shadows it on
    // Alice's client alone and a delete restores it — no reload, no effect on
    // the GM page that answers the REAL request below.
    const guarded = await alicePage.evaluate(async () => {
      Object.defineProperty(game.users, "activeGM", { get: () => null, configurable: true });
      // Characters only, like the cancel block: a live Warden minting NPCs
      // beside the probe must not red an absence check about PC generation.
      const pcCount = () => game.actors.filter((a) => a.type === "character").length;
      const before = pcCount();
      document.querySelector("#actors .create-character-generator-button")?.click();
      await new Promise((r) => setTimeout(r, 2000));
      const warned = [...document.querySelectorAll(".notification")]
        .some((n) => n.textContent.includes("No Warden is logged in"));
      delete game.users.activeGM;
      return { warned, before, after: pcCount(), restored: !!game.users.activeGM };
    });
    guarded.warned && guarded.after === guarded.before
      ? ok("with no Warden online the click warns and mints nothing", `characters ${guarded.before} before and after`)
      : fail("with no Warden online the click warns and mints nothing", JSON.stringify(guarded));
    guarded.restored
      ? ok("the activeGM stub is off again", "the mint leg below is real")
      : fail("the activeGM stub did not restore — the mint leg below is vacuous");

    // The relay itself: her click, the probe's GM page answering, Alice OWNER
    // of a character she could never create, sheet open on HER screen.
    const mint = await alicePage.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const mine = () => game.actors
        .filter((a) => a.type === "character" && a.ownership?.[game.user.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
        .map((a) => a.id);
      const beforeIds = new Set(mine());
      document.querySelector("#actors .create-character-generator-button")?.click();
      // The SOURCE question is asked on the CLICKING client (the player's own
      // picker, same as the direct path — asked on the answering side it
      // would hang the request on the Warden's screen). WHICH question she is
      // asked depends on the world, and this used to assume one of the two:
      //
      //   2+ sources enabled -> the source picker, buttons named for a source
      //   0 or 1, and a PLAYER -> a plain Yes/No confirm (2026-08-08 user ask:
      //     an accidental click must not silently roll a PC). The Warden's own
      //     button skips it, which is why no Warden-side leg ever saw this.
      //
      // It waited only for the picker, on a written-down belief that this world
      // had both sources on. It has 2e alone — the user's own content choice —
      // so a player gets the confirm, the wait drained, the dialog was left
      // sitting unanswered, and promptContentSource never resolved: no emit, no
      // mint, and three legs reporting a broken relay that works. Note the
      // comment was stale twice over, because the confirm shipped AFTER it was
      // written and nothing sends a comment red.
      //
      // So answer whatever is actually on screen. Both are real worlds, the
      // relay must work in both, and neither needs a world setting written.
      let picked = null;
      const tPick = Date.now();
      while (Date.now() - tPick < 6000 && !picked) {
        const btn = document.querySelector('dialog button[data-action="2e"]')
          ?? document.querySelector('dialog button[data-action="yes"]');
        if (btn) { picked = btn.dataset.action; btn.click(); break; }
        await sleep(150);
      }
      const t0 = Date.now();
      let fresh = [];
      while (Date.now() - t0 < 30000) {
        fresh = mine().filter((id) => !beforeIds.has(id));
        if (fresh.length) break;
        await sleep(300);
      }
      if (!fresh.length) return { minted: false, picked };
      const actor = game.actors.get(fresh[0]);
      // The pcGenerated answer renders the sheet — poll for the window.
      //
      // 30s: on the relay path Alice's client polls up to 3s for the actor
      // broadcast to catch up with the custom emit, polls up to 1.5s for the
      // generation card, and gives the dice a TWO-SECOND glimpse before the
      // sheet covers them (awaitDiceAnimation's cap since 2026-09-02 — it
      // used to wait the ~5-8s animation OUT, and on this path the Warden's
      // client waited its own copy too before even answering; `dev:gen-dice`
      // holds the glimpse honest). So the render lands in a few seconds now
      // and 30s is pure headroom for a cold-pack generation — kept, because a
      // budget that hugs the expected time is how this leg went red once
      // before while the mint, ownership and no-double-mint legs all passed:
      // the relay worked and only the clock was wrong.
      let sheetOpen = false;
      const t1 = Date.now();
      while (Date.now() - t1 < 30000 && !sheetOpen) {
        sheetOpen = [...foundry.applications.instances.values()]
          .some((x) => x.document === actor && x.rendered);
        await sleep(200);
      }
      // Settle before counting: a double-mint's second copy trails the first.
      await sleep(1500);
      const finalFresh = mine().filter((id) => !beforeIds.has(id));
      return {
        minted: true,
        count: finalFresh.length,
        uuid: actor.uuid,
        name: actor.name,
        type: actor.type,
        level: actor.ownership?.[game.user.id],
        sheetOpen,
        picked,
      };
    });
    relayMintedUuid = mint.uuid ?? null;
    mint.minted && mint.type === "character" && mint.level === 3
      ? ok("her click minted a character through the Warden's client", `${mint.name} — Alice OWNER, via the ${mint.picked ?? "(none)"} prompt`)
      : fail("her click minted a character through the Warden's client", JSON.stringify(mint));
    mint.sheetOpen
      ? ok("and the sheet opened on HER client", "the pcGenerated answer landed")
      : fail("and the sheet opened on HER client", JSON.stringify(mint));
    // The two outcomes are OPPOSITE causes and the message used to name only
    // one of them: "a second GM answered too" was printed for a count of ZERO,
    // which is nothing answering at all. It cost a full triage pass chasing a
    // live-GM confound that was not there — the relay had never been reached,
    // because the source prompt above went unanswered. A count is not a
    // diagnosis; say which way it went.
    mint.count === 1
      ? ok("exactly one character arrived", "no double-mint")
      : fail(
        `expected exactly one new character, got ${mint.count ?? 0}`,
        mint.count > 1
          ? "a second GM client answered too — the live-GM confound, or the in-flight guard broke"
          : "nothing arrived — the legs above say where it stopped, not this one",
      );
  } finally {
    // Restore BOTH preconditions from NODE via the GM page, unconditionally and
    // to the values captured at entry — not to "on", which would leave the
    // Warden's switch flipped by a test run.
    await page.evaluate(async ([perms, gen]) => {
      await game.settings.set("core", "permissions", perms);
      await game.settings.set("air-bladder", "allow-player-generate", gen);
    }, [priorPerms, priorGen]);
    // The relay-minted PC has a rolled name, not a ZZ prefix — delete it (and
    // any container its background granted) by the uuid the mint leg kept.
    if (relayMintedUuid) {
      await page.evaluate(async (uuid) => {
        for (const a of game.actors.filter((x) => x.system?.connectedTo === uuid)) await a.delete();
        await (await fromUuid(uuid))?.delete();
      }, relayMintedUuid).catch(() => {});
    }
    console.log(`\n  player console errors: ${aliceErrors.length}`);
    for (const e of aliceErrors.slice(0, 8)) console.log(`  ${e}`);
    if (aliceErrors.length) failed = true;
    await alicePage.context().close();
  }
} catch (e) {
  fail("threw", `${e.name}: ${e.message}`);
} finally {
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
  if (errors.length) failed = true;
  await browser.close();
}

console.log(failed ? "\nDIRECTORY BUTTONS PROBE FAILED" : "\ndirectory buttons probe passed");
process.exit(failed ? 1 : 0);

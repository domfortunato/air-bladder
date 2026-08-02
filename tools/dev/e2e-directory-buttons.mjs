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
 * (no Monster, no Faction, no Import), a player without ACTOR_CREATE none —
 * and core's Create Actor is gone for all three. The count assertions were
 * stale-red before this rewrite (they said 4 while a Warden had had 5 since
 * the faction button) because this probe was not in that batch's run list;
 * the matrix is the fix for the class of miss, not just the number.
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

const GM_BUTTONS = 8;
const PLAYER_BUTTONS = 5;

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
  ["Create Container", "Create Mount", "Create Transport"].every((l) => r.docked.buttons.includes(l))
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
      { btn: ".create-mount-button", role: "mount", kind: "horse", name: "ZZ Dir Horse", slots: 4, art: "horse\\.svg$" },
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

    const before = game.actors.size;

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
    let after = game.actors.size;
    for (let i = 0; i < 100 && after === before; i++) {
      await new Promise((res) => setTimeout(res, 100));
      after = game.actors.size;
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
  try {
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
      };
    });

    const withCreate = await readAlice();
    withCreate.canCreate
      ? ok("Alice holds ACTOR_CREATE", "the player legs are not vacuous")
      : fail("Alice holds ACTOR_CREATE", "grant it in the dev world — every player leg below is vacuous");
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
    !bare.canCreate && bare.buttons.length === 0 && !bare.coreCreate
      ? ok("without ACTOR_CREATE she sees no creation surface at all")
      : fail("without ACTOR_CREATE she sees no creation surface at all", JSON.stringify(bare));
  } finally {
    // Restore the permission from NODE via the GM page, unconditionally.
    await page.evaluate(async (perms) => {
      await game.settings.set("core", "permissions", perms);
    }, priorPerms);
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

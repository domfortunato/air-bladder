#!/usr/bin/env node
/**
 * Player-side Create PC behaviour — the roll-confirm and the Warden's two
 * player switches (allow-player-generate, allow-player-marketplace). The
 * marketplace legs live HERE rather than in dev:marketplace because that
 * probe is a single GM page and these legs need this file's two-client
 * harness — and the Yes-leg's minted character doubles as the owned sheet
 * the shop button lives on.
 *
 *   npm run dev:playergen     (needs Foundry running, world launched, and
 *                              Alice — `npm run dev:players` seeds her)
 *
 * Two clients drive this: a GM context (so `game.users.activeGM` exists —
 * without one the relay refuses before the code under test even runs) and
 * Alice, because every leg here is per-user and a GM passes every check, so a
 * GM-only probe can literally not see the thing being probed.
 *
 * The roll-confirm legs (2026-08-08): with ONE or ZERO content sources
 * enabled, clicking Create PC used to roll instantly — an accidental click
 * minted a character. A prompt interposed, so nothing is minted by accident.
 *
 * REWRITTEN 2026-09-11, and the two changes are deliberate reversals rather
 * than drift. The prompt is now Cancel/Create rather than Yes/No, because it
 * grew the empty-sheet checkbox and stopped being a question about certainty.
 * And THE WARDEN IS ASKED NOW: the 2026-08-08 ruling exempted them because the
 * risk was an accidental click, which only ever threatened a player, but the
 * prompt is now where the roll-or-empty choice is made and a route that skips
 * it cannot offer the choice at all. With 2+ sources the edition dropdown and
 * the checkbox share ONE window, so the no-stacking rule is unchanged.
 *
 * The source count is forced by shadowing `game.settings.get` IN-PAGE on the
 * asserting client, never by writing the world settings: the probe's
 * precondition must not leak into the world (the 0.1.12 pre-tag batch lost a
 * diagnosis to exactly that), and `enforceSourceFloor` makes flipping the
 * real toggles order-sensitive besides. The shadow is exact — only the three
 * content-source keys are intercepted, everything else passes through.
 *
 * Cleanup is snapshot-diff: every Actor and ChatMessage that exists after a
 * leg but not before it is deleted by id from the GM client, and named in the
 * output — a Yes-leg character arrives with whatever its background granted
 * (a horse, a donkey), so deleting "the character" alone would orphan the
 * grant.
 *
 * Exits non-zero on any failed assertion or console error.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog } from "./lib.mjs";

const dog = watchdog(240000, "player-generate");
const browser = await chromium.launch();
const gmCtx = await browser.newContext({ viewport: VIEWPORT });
const alCtx = await browser.newContext({ viewport: VIEWPORT });
const gm = await gmCtx.newPage();
const alice = await alCtx.newPage();
const gmErrors = watchErrors(gm);
const alErrors = watchErrors(alice);
let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);
// Captured before the switch legs flip them; restored in the Node-level finally
// so a throw mid-leg cannot leak a hidden button or a closed shop into the world.
let priorSwitch = null;
let priorMarket = null;
let priorRand = null;

/** Shadow the three content-source reads on one page. mode: "one" | "two". */
const shadowSources = (page, mode) => page.evaluate((mode) => {
  const NS = "air-bladder";
  const FORCED = mode === "one"
    ? { "content-source-2e": true, "content-source-custom": false, "content-source-barebones": false }
    : { "content-source-2e": true, "content-source-custom": false, "content-source-barebones": true };
  if (!game.settings._probeOrigGet) game.settings._probeOrigGet = game.settings.get.bind(game.settings);
  // FORWARD EVERY ARGUMENT. `ClientSettings#set` asks `get(ns, key, {document:
  // true})` for the Setting DOCUMENT, so a shadow that drops the third argument
  // hands it a plain value, `current?._id` is undefined, and core CREATES A
  // SECOND Setting document for that key rather than updating the first. Every
  // world-setting write in the shadow's window then silently does nothing, and
  // the duplicate document outlives the probe.
  game.settings.get = (ns, key, ...rest) =>
    (ns === NS && key in FORCED ? FORCED[key] : game.settings._probeOrigGet(ns, key, ...rest));
}, mode);

const unshadowSources = (page) => page.evaluate(() => {
  if (game.settings._probeOrigGet) {
    game.settings.get = game.settings._probeOrigGet;
    delete game.settings._probeOrigGet;
  }
});

/** The ids of every Actor and ChatMessage currently in the world (GM view). */
const snapshot = () => gm.evaluate(() => ({
  actors: game.actors.map((a) => a.id),
  messages: game.messages.map((m) => m.id),
}));

/** Delete (GM-side) everything that appeared since `before`; return names. */
const sweep = async (before) => gm.evaluate(async (before) => {
  const newActors = game.actors.filter((a) => !before.actors.includes(a.id));
  const named = newActors.map((a) => `${a.name} (${a.id})`);
  for (const a of newActors) await a.delete();
  const newMsgs = game.messages.filter((m) => !before.messages.includes(m.id));
  for (const m of newMsgs) await m.delete();
  return { named, messages: newMsgs.length };
}, before);

/** Poll the GM page until a NEW character (vs `before`) exists, or timeout. */
const gmPollNewCharacter = async (before, ms = 45000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const found = await gm.evaluate((before) =>
      game.actors.some((a) => a.type === "character" && !before.actors.includes(a.id)), before);
    if (found) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};

/** The visible DialogV2 window titles on a page. */
const dialogTitles = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".application.dialog .window-title")].map((t) => t.textContent.trim()));

/** Click Alice's Create PC button (present on both directory variants). */
const clickGenerate = () => alice.evaluate(() => {
  const btn = document.querySelector("#cairn-character-gen-button .create-character-generator-button");
  if (!btn) throw new Error("no Create PC button on Alice's directory");
  btn.click();
});

/** Wait for a dialog whose title matches, or report what IS there. */
const awaitDialog = async (page, title, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const titles = await dialogTitles(page);
    if (titles.includes(title)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

try {
  await joinAsGM(gm);
  await joinAs(alice, "Alice");

  // ---- Leg 0: the Warden's client pre-warms the generation packs ----------
  // The FIRST generation of a session paid ~5s of compendium loading on the
  // answering client (measured 2026-09-02: ~6s cold vs ~1.2s warm) — so the
  // first player who clicked Create PC ate the whole cold start. A GM
  // client now runs the same reads generation makes, fire-and-forget shortly
  // after ready. The list is READ from the module (dev:monster-gen's rule:
  // a probe-side copy is a list that goes stale), and the poll asserts every
  // shipped pack on it holds LOADED documents with no generation having run.
  // Red witness: without the warm nothing loads these and the poll drains.
  console.log("\n  the Warden's client pre-warms the generation packs");
  const warm = await gm.evaluate(async () => {
    const gen = await import("/systems/air-bladder/module/character-generator.js");
    const ids = gen.GENERATION_PACKS?.documents ?? [];
    const shipped = ids.filter((k) => game.packs.get(k));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const cold = () => shipped.filter((k) => game.packs.get(k).size === 0);
    const t0 = Date.now();
    while (Date.now() - t0 < 25000 && cold().length) await sleep(500);
    return { exported: ids.length, shipped: shipped.length, cold: cold() };
  });
  warm.exported > 0 && warm.shipped > 0
    ? ok(`GENERATION_PACKS names ${warm.exported} document packs (${warm.shipped} present in this world)`)
    : fail(`GENERATION_PACKS is missing or empty (exported=${warm.exported}) — the pre-warm has no list to work from`);
  warm.shipped > 0 && warm.cold.length === 0
    ? ok("every one of them is loaded shortly after login, unprompted")
    : fail(`still cold 25s after ready: ${warm.cold.join(", ") || "(n/a)"} — the pre-warm did not run`);

  const t = await alice.evaluate(() => ({
    confirm: game.i18n.localize("CAIRN.GeneratePcConfirmTitle"),
    picker: game.i18n.localize("CAIRN.ContentSourceTitle"),
    canCreate: game.user.can("ACTOR_CREATE"),
  }));
  console.log(`\n  Alice ${t.canCreate ? "holds" : "lacks"} ACTOR_CREATE — ${t.canCreate ? "direct" : "relay"} path\n`);

  // ESTABLISH the switch the whole file stands on, right at the top. Every leg
  // below clicks Alice's Create PC button, and the Warden's
  // `allow-player-generate` is what puts it there — the dev world keeps it OFF
  // by the user's choice, so the first click threw "no Create PC button" and
  // took the whole run with it. The switch section near the end captured and
  // restored it properly; the twenty legs before it assumed. Third time this
  // family has been bitten (this file's own marketplace legs 2026-08-09,
  // dev:directory-buttons 2026-08-14), and the tell is the same every time: a
  // setting a GM cannot feel, because every Warden-side surface reads
  // `isGM || setting`. Captured ONCE, here; the finally restores THIS value.
  priorSwitch = await gm.evaluate((k) => game.settings.get("air-bladder", k), "allow-player-generate");
  if (priorSwitch !== true) {
    await gm.evaluate((k) => game.settings.set("air-bladder", k, true), "allow-player-generate");
    console.log(`  note  allow-player-generate was ${priorSwitch} - set on for the run, restored after`);
  }
  const gotButton = await (async () => {
    for (let i = 0; i < 40; i++) {
      if (await alice.evaluate(() => !!document.querySelector("#cairn-character-gen-button .create-character-generator-button"))) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })();
  gotButton
    ? ok("precondition: Alice's directory shows Create PC")
    : fail("precondition: no Create PC button on Alice's directory even with the switch on");

  // Spy Alice's socket emits for the whole run (installed once, read per leg).
  // `_probePayloads` keeps the whole message beside the action list, because the
  // empty-sheet leg below needs to see WHAT crossed the wire, not just that
  // something did — a relayed field that never left the sender and one the
  // receiver ignores look identical from the far end.
  await alice.evaluate(() => {
    game._probeEmits = [];
    game._probePayloads = [];
    const orig = game.socket.emit.bind(game.socket);
    game.socket.emit = (ev, data, ...rest) => {
      if (ev === `system.${game.system.id}`) {
        game._probeEmits.push(data?.action ?? "?");
        game._probePayloads.push(foundry.utils.deepClone(data ?? {}));
      }
      return orig(ev, data, ...rest);
    };
    // And the ANSWERS coming back, which are how a leg knows the relay is idle
    // again. An extra listener alongside the system's own; it reads and never
    // acts.
    game._probeAnswers = [];
    game.socket.on(`system.${game.system.id}`, (msg) => {
      if (msg?.action === "pcGenerated") game._probeAnswers.push(msg);
    });
  });
  /**
   * Wait until the Warden's client has ANSWERED every generatePC sent so far.
   *
   * THE RELAY IS SINGLE-FLIGHT PER SENDER (`pcGenerationInFlight`, cairn.js): a
   * second request from the same user while the first is still building is
   * dropped in silence, which is right — it is what stops a doubled click
   * minting two characters — and it means any leg that emits a second time
   * must wait, or it is racing a lock rather than testing anything. Found the
   * hard way: the empty-sheet leg below passed twice and then produced "no
   * character appeared within 45s" on the third run, with a correct payload on
   * the wire every time. A race, not a flake.
   */
  const awaitRelayIdle = async (expected, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await alice.evaluate((n) => game._probeAnswers.length >= n, expected)) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  };
  const emitsOf = (kind) => alice.evaluate((k) => game._probeEmits.filter((a) => a === k).length, kind);

  console.log("one source, a player clicks Create PC");
  await shadowSources(alice, "one");

  // -- The prompt appears, and Cancel creates nothing -----------------------
  //
  // Yes/No became Cancel/Create on 2026-09-11, when the prompt grew the
  // empty-sheet checkbox: the question stopped being "are you sure" and became
  // "what shall I make". The interrupt this leg was written for is unchanged —
  // an accidental click still cannot mint a character.
  let before = await snapshot();
  await clickGenerate();
  (await awaitDialog(alice, t.confirm))
    ? ok("the creation prompt appears before anything rolls")
    : fail(`no creation dialog (visible: ${JSON.stringify(await dialogTitles(alice))})`);
  const hasBox = await alice.evaluate(() =>
    !!document.querySelector('.application.dialog input[name="roll"]:checked'));
  hasBox
    ? ok("   …carrying the roll checkbox, ticked")
    : fail("the player's prompt has no ticked roll checkbox");
  await alice.evaluate(() => {
    [...document.querySelectorAll(".application.dialog button")]
      .find((b) => b.dataset.action === "cancel")?.click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  const afterNo = await snapshot();
  const emitsAfterNo = await emitsOf("generatePC");
  afterNo.actors.length === before.actors.length && emitsAfterNo === 0
    ? ok("Cancel: nothing created, nothing emitted")
    : fail(`Cancel leaked: ${afterNo.actors.length - before.actors.length} new actor(s), ${emitsAfterNo} generatePC emit(s)`);

  // -- ✕ is also a decline --------------------------------------------------
  await clickGenerate();
  await awaitDialog(alice, t.confirm);
  await alice.evaluate(() => {
    [...document.querySelectorAll(".application.dialog")].at(-1)
      ?.querySelector('[data-action="close"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  const afterX = await snapshot();
  const emitsAfterX = await emitsOf("generatePC");
  afterX.actors.length === before.actors.length && emitsAfterX === 0
    ? ok("✕: nothing created, nothing emitted")
    : fail(`✕ leaked: ${afterX.actors.length - before.actors.length} new actor(s), ${emitsAfterX} emit(s)`);

  // -- Create proceeds all the way to a character ---------------------------
  before = await snapshot();
  await clickGenerate();
  await awaitDialog(alice, t.confirm);
  await alice.evaluate(() => {
    [...document.querySelectorAll(".application.dialog button")]
      .find((b) => b.dataset.action === "create")?.click();
  });
  const made = await gmPollNewCharacter(before);
  made
    ? ok("Create: a character was created")
    : fail("Create: no character appeared within 45s");
  if (!t.canCreate) {
    (await emitsOf("generatePC")) === 1
      ? ok("   …via exactly one generatePC relay emit")
      : fail(`expected exactly 1 generatePC emit, saw ${await emitsOf("generatePC")}`);
  }

  // -- The EMPTY choice has to survive the wire -----------------------------
  //
  // The player answers the prompt on their OWN client and the Warden's client
  // does the creating, so the checkbox is a value that has to travel. Get this
  // wrong and a player who asked for an empty sheet is handed a rolled
  // character by a machine that never saw the box — which looks like the
  // feature simply not working, with nothing in any log to say why. This is
  // the only leg that exercises the relay's `blank` field, and it matters most
  // on the relay path, where two clients and a socket sit in between.
  // The relay answers one request at a time. Let the previous one finish, or
  // this emit lands on a held lock and vanishes — see awaitRelayIdle.
  if (!t.canCreate) {
    (await awaitRelayIdle(1))
      ? ok("   …and the Warden's client has answered it")
      : fail("no pcGenerated answer came back within 60s");
  }
  before = await snapshot();
  // Capture the dialog ids FIRST and answer only a dialog that was not there
  // before. A closing DialogV2 lingers in the DOM and the previous leg's
  // dialog carries the SAME title, so both `awaitDialog` and `.at(-1)` can hand
  // back the one on its way out — which is exactly what happened on this leg's
  // first run: it unticked a corpse, the live dialog answered with its own
  // default, and a fully rolled character came back looking like a wire bug.
  const priorIds = await alice.evaluate(() =>
    [...document.querySelectorAll(".application.dialog")].map((d) => d.id));
  // The emit is read by COUNT DIFFERENCE below, so capture the count first.
  const wiresBefore = await alice.evaluate(() =>
    game._probePayloads.filter((p) => p.action === "generatePC").length);
  await clickGenerate();
  const answered = await alice.evaluate(async (prior) => {
    const seen = new Set(prior);
    const deadline = Date.now() + 15000;
    let el = null;
    while (Date.now() < deadline && !el) {
      el = [...document.querySelectorAll(".application.dialog")].find((d) => !seen.has(d.id)) ?? null;
      if (!el) await new Promise((r) => setTimeout(r, 100));
    }
    if (!el) return { opened: false };
    const box = el.querySelector('input[name="roll"]');
    if (!box) return { opened: true, box: false };
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    const cleared = box.checked === false;
    el.querySelector('button[data-action="create"]')?.click();
    return { opened: true, box: true, cleared, id: el.id };
  }, priorIds);
  answered.opened && answered.box && answered.cleared
    ? ok(`   …a fresh prompt (${answered.id}) had its box cleared`)
    : fail(`could not clear the box: ${JSON.stringify(answered)}`);
  // Read the wire itself. Split from the outcome deliberately: if the payload
  // is right and the actor is rolled, the receiver is at fault; if the payload
  // is wrong, the sender is. One leg that only checks the actor cannot say
  // which, and this is a two-client path where that is the whole diagnosis.
  // POLLED, not read once: the dialog's Create resolves the prompt and the
  // emit follows it after an await, so a read taken right after the click
  // raced the wire — green on one run, "null" on the next with the character
  // arriving empty two lines later (2026-09-12). Wait for a NEW payload.
  let wire = null;
  for (let i = 0; i < 50 && !wire; i++) {
    wire = await alice.evaluate((n) => {
      const all = game._probePayloads.filter((p) => p.action === "generatePC");
      return all.length > n ? (all.at(-1) ?? null) : null;
    }, wiresBefore);
    if (!wire) await new Promise((r) => setTimeout(r, 100));
  }
  // On the DIRECT path there is no wire to read: an ACTOR_CREATE player
  // creates locally. Say so rather than reporting a payload that never existed
  // — that misdirection cost an hour on 2026-09-12, when a leaked TRUSTED role
  // put Alice on the direct path and this line blamed the relay.
  if (t.canCreate) {
    console.log("  note  direct path: Alice creates locally, so no generatePC emit is expected here");
  } else {
    wire?.blank === true
      ? ok("   …and the emit carries blank: true")
      : fail(`the generatePC emit did not carry blank: ${JSON.stringify(wire)}`);
  }
  const arrivedEmpty = await gmPollNewCharacter(before);
  arrivedEmpty
    ? ok("unticked: a character still arrives")
    : fail("unticked: no character appeared within 45s");
  if (arrivedEmpty) {
    // _source, never derived — an empty character sits at HP 3 and the derived
    // value would be answering the encumbrance rule instead.
    const shape = await gm.evaluate((before) => {
      const a = game.actors.find((x) => x.type === "character" && !before.actors.includes(x.id));
      if (!a) return null;
      const s = a._source.system;
      return {
        name: a.name, items: a.items.size, background: s.background ?? "",
        hp: s.hp?.value, generationEnabled: s.generationEnabled,
      };
    }, before);
    shape && shape.items === 0 && !shape.background && shape.hp === 3 && shape.generationEnabled === true
      ? ok("   …and it is EMPTY — the checkbox crossed the wire", `"${shape.name}", HP ${shape.hp}`)
      : fail(`the relayed character was not empty: ${JSON.stringify(shape)}`);
  }

  // ---- The marketplace switch, on the Alice-owned character just minted ---
  // (allow-player-marketplace — the second Warden switch, item-5 of the same
  // round.) Runs BEFORE the sweep so the sheet under test is a real owned
  // character, not a fixture. The switch is flipped from the GM client and
  // restored in the Node-level finally alongside the generate switch.
  console.log("\nthe marketplace switch");
  const MKT = "allow-player-marketplace";
  priorMarket = await gm.evaluate((k) => game.settings.get("air-bladder", k), MKT);
  // ESTABLISH the on-state, never assume it (a probe's precondition is its
  // own to make): the dev world arrived 2026-08-09 with this switch OFF —
  // leaked or deliberate — and every "switch on" leg below redded on world
  // state, not on code. The finally still restores the captured prior.
  await gm.evaluate((k) => game.settings.set("air-bladder", k, true), MKT);
  const pcId = await gm.evaluate((before) =>
    game.actors.find((a) => a.type === "character" && !before.actors.includes(a.id))?.id ?? null, before);
  if (!pcId) fail("no minted character to run the marketplace legs on");
  else {
    const shopBtn = () => alice.evaluate((id) =>
      !!game.actors.get(id)?.sheet?.element?.querySelector?.(".item-shop"), pcId);
    const waitShopBtn = async (want, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await shopBtn() === want) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    };
    await alice.evaluate(async (id) => {
      game.actors.get(id).sheet.render(true);
      await new Promise((r) => setTimeout(r, 1500));
    }, pcId);
    (await waitShopBtn(true))
      ? ok("switch on: Alice's owned sheet shows the Marketplace button")
      : fail("switch on: no Marketplace button on Alice's sheet");

    // Open the shop NOW (allowed), so the flip-off can prove the stale-dialog
    // case: the greying is the affordance, acquire's refusal the enforcement.
    await alice.evaluate((id) => {
      game.actors.get(id).sheet.element.querySelector(".item-shop")?.click();
    }, pcId);
    const dialogUp = await (async () => {
      const t0 = Date.now();
      // 30s, not 15: the catalog resolves ~70 compendium refs and each
      // getDocuments call is a server round trip — a cold player cache can
      // push the open past 15s, which read as "never opened" and then
      // poisoned the two legs after it when the dialog surfaced late.
      while (Date.now() - t0 < 30000) {
        if (await alice.evaluate(() => !!document.querySelector(".marketplace .mkt-row"))) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    })();
    dialogUp ? ok("…and the shop opens for them") : fail("the shop did not open while allowed");

    await gm.evaluate((k) => game.settings.set("air-bladder", k, false), MKT);
    (await waitShopBtn(false))
      ? ok("flip off: the button left Alice's open sheet, live")
      : fail("flip off: Alice's sheet still shows the Marketplace button");

    // The dialog opened BEFORE the flip is still on screen — a Take through it
    // must refuse with the switch message and create nothing.
    const itemsBefore = await gm.evaluate((id) => game.actors.get(id)?.items.size ?? -1, pcId);
    const refusal = await alice.evaluate(async () => {
      // Force the button enabled before clicking — dev:marketplace's own
      // technique. The greying reflects SLOTS/gold, and a randomly-generated
      // character is sometimes born encumbered, so a plain click on the
      // first Take was dice-decided: a disabled button dispatches nothing
      // and the leg read green/red by the character's inventory luck.
      const take = document.querySelector(".marketplace .mkt-take");
      if (take) { take.disabled = false; take.click(); }
      await new Promise((r) => setTimeout(r, 1500));
      const want = game.i18n.localize("CAIRN.Notify.MarketplaceDisabled");
      return [...document.querySelectorAll(".notification")].some((n) => n.textContent.includes(want));
    });
    const itemsAfter = await gm.evaluate((id) => game.actors.get(id)?.items.size ?? -1, pcId);
    refusal && itemsAfter === itemsBefore
      ? ok("stale dialog: Take refused with the switch message, nothing created")
      : fail(`stale dialog: refused=${refusal}, items ${itemsBefore}→${itemsAfter}`);
    await alice.evaluate(async () => {
      for (const app of [...foundry.applications.instances.values()]) {
        if (app.element?.querySelector?.(".marketplace")) await app.close();
      }
    });

    // The Warden always shops: with the switch off, the GM's own open works.
    const gmShop = await gm.evaluate(async (id) => {
      const mkt = await import("/systems/air-bladder/module/marketplace.js");
      await mkt.openMarketplace(game.actors.get(id));
      await new Promise((r) => setTimeout(r, 1000));
      const open = !!document.querySelector(".marketplace .mkt-row");
      for (const app of [...foundry.applications.instances.values()]) {
        if (app.element?.querySelector?.(".marketplace")) await app.close();
      }
      return open;
    }, pcId);
    gmShop ? ok("switch off: the Warden still shops") : fail("switch off closed the WARDEN's shop too");

    // And the door itself: Alice calling openMarketplace directly (the stale
    // sheet-button path) is refused before any dialog exists. Close any
    // straggler dialog first — a slow leg-1 open surfacing late must not
    // read as "the door let her in".
    await alice.evaluate(async () => {
      for (const app of [...foundry.applications.instances.values()]) {
        if (app.element?.querySelector?.(".marketplace")) await app.close();
      }
    });
    const doorRefused = await alice.evaluate(async (id) => {
      const mkt = await import("/systems/air-bladder/module/marketplace.js");
      await mkt.openMarketplace(game.actors.get(id));
      await new Promise((r) => setTimeout(r, 800));
      const open = !!document.querySelector(".marketplace");
      const want = game.i18n.localize("CAIRN.Notify.MarketplaceDisabled");
      const told = [...document.querySelectorAll(".notification")].some((n) => n.textContent.includes(want));
      return !open && told;
    }, pcId);
    doorRefused
      ? ok("switch off: openMarketplace refuses Alice at the door")
      : fail("switch off: Alice opened the marketplace directly");

    await gm.evaluate((k) => game.settings.set("air-bladder", k, true), MKT);
    (await waitShopBtn(true))
      ? ok("flip on: the button returned to Alice's open sheet, live")
      : fail("flip on: Alice's Marketplace button did not return");
    await alice.evaluate((id) => game.actors.get(id)?.sheet?.close(), pcId);
  }

  // ---- The randomization switch, on the same Alice-owned character --------
  // (allow-player-randomization — the THIRD Warden switch, 2026-08-09; its
  // shipped macro is "Toggle Player Creation Tools", and the sheet toggle it
  // governs reads "Character Creation Mode" since the 2026-09-01 rename.) Off
  // hides the WHOLE surface from a player — title-bar toggle, Roll button,
  // per-line dice — even on an actor whose OWN generationEnabled flag is on
  // (the derivation is render-only; nothing is written to the actor), while
  // the Warden keeps everything. Flipped from the GM client; restored in the
  // Node-level finally with its two siblings.
  console.log("\nthe randomization switch");
  const RND = "allow-player-randomization";
  priorRand = await gm.evaluate((k) => game.settings.get("air-bladder", k), RND);
  // ESTABLISH the on-state (same rule as the marketplace section above).
  await gm.evaluate((k) => game.settings.set("air-bladder", k, true), RND);
  if (!pcId) fail("no minted character to run the randomization legs on");
  else {
    // The actor's own flag ON, so the dice legs prove the world switch
    // overrides it rather than merely agreeing with a flag that is off.
    await gm.evaluate((id) =>
      game.actors.get(id).update({ "system.generationEnabled": true }, { abNoStatusCard: true }), pcId);
    // `open` guards the polls: a sheet that CLOSED also reads toggle=false,
    // dice=false, which must never pass as "the surface hid".
    const surface = () => alice.evaluate((id) => {
      const el = game.actors.get(id)?.sheet?.element;
      const btn = el?.querySelector('.window-header button[data-action="toggleGeneration"]');
      return {
        open: !!el,
        toggleShown: !!btn && !btn.classList.contains("cairn-header-hidden"),
        dice: !!el?.querySelector(".background-roll"),
      };
    }, pcId);
    await alice.evaluate(async (id) => {
      game.actors.get(id).sheet.render(true);
      await new Promise((r) => setTimeout(r, 1200));
    }, pcId);
    const onState = await surface();
    onState.toggleShown && onState.dice
      ? ok("switch on: Alice sees the Randomization toggle and the re-roll dice")
      : fail(`switch on: toggle=${onState.toggleShown} dice=${onState.dice}`);

    await gm.evaluate((k) => game.settings.set("air-bladder", k, false), RND);
    let offState = await surface();
    for (const t0 = Date.now(); Date.now() - t0 < 15000 && (offState.toggleShown || offState.dice);) {
      await new Promise((r) => setTimeout(r, 250));
      offState = await surface();
    }
    offState.open && !offState.toggleShown && !offState.dice
      ? ok("flip off: toggle AND dice left Alice's open sheet, live — her actor's own flag still on")
      : fail(`flip off: open=${offState.open} toggle=${offState.toggleShown} dice=${offState.dice}`);

    // Enforcement behind the affordance: calling the action past the hidden
    // button is refused — flag unwritten, the switch toast shown.
    const enforce = await alice.evaluate(async (id) => {
      const sheet = game.actors.get(id).sheet;
      await sheet.options.actions.toggleGeneration.call(sheet, new Event("click"), null);
      await new Promise((r) => setTimeout(r, 800));
      const want = game.i18n.localize("CAIRN.Notify.RandomizationDisabled");
      return {
        flag: game.actors.get(id).system.generationEnabled,
        told: [...document.querySelectorAll(".notification")].some((n) => n.textContent.includes(want)),
      };
    }, pcId);
    enforce.flag === true && enforce.told
      ? ok("switch off: the toggle action refuses past the hidden button (flag unwritten, toast shown)")
      : fail(`switch off enforcement: flag=${enforce.flag} told=${enforce.told}`);

    /* -- the empty-sheet box is not offered to someone it would strand ------
     * With the switch OFF, a player's sheet renders no pickers at all — this
     * very section has just measured that. An empty sheet is nothing BUT its
     * pickers: a bond and a question answer are read-only prose with no other
     * entry path. So clearing the box handed the player a character with no
     * background, no gear and no control that could fill any of it in, and no
     * way back without the Warden deleting the actor (review #26).
     *
     * Both states, because withholding the box unconditionally would be the
     * same defect wearing the other face. The switch is still OFF here; the
     * on-state is re-measured after flipping it back.
     * -------------------------------------------------------------------- */
    const boxShown = () => alice.evaluate(async () => {
      const cg = await import("/systems/air-bladder/module/character-generator.js");
      const before = new Set([...document.querySelectorAll(".application.dialog")].map((d) => d.id));
      const pending = cg.promptCreation("character");
      let el = null;
      for (let i = 0; i < 60 && !el; i++) {
        el = [...document.querySelectorAll(".application.dialog")].find((d) => !before.has(d.id)) ?? null;
        if (!el) await new Promise((r) => setTimeout(r, 100));
      }
      if (!el) { return { opened: false }; }
      const box = !!el.querySelector('input[name="roll"]');
      // Answer Create and read what the dialog reports, so this measures the
      // ANSWER and not just the markup: with no checkbox, `!undefined?.checked`
      // is true, and an answer of blank:true here would be the stranded sheet
      // arriving by another route.
      el.querySelector('button[data-action="create"]')?.click();
      const answer = await Promise.race([
        pending,
        new Promise((r) => setTimeout(() => r({ hung: true }), 6000)),
      ]);
      return { opened: true, box, answer };
    });

    const offBox = await boxShown();
    offBox.opened && offBox.box === false
      ? ok("switch off: the creation dialog offers Alice no empty-sheet checkbox")
      : fail(`switch off: checkbox offered=${offBox.box} opened=${offBox.opened}`);
    offBox.answer && offBox.answer.blank === false
      ? ok("   …and its answer is blank:false, not a missing control reading as cleared")
      : fail(`switch off: the dialog answered ${JSON.stringify(offBox.answer)}`);

    await gm.evaluate((k) => game.settings.set("air-bladder", k, true), RND);
    await new Promise((r) => setTimeout(r, 800));
    const onBox = await boxShown();
    onBox.opened && onBox.box === true
      ? ok("switch on: Alice is offered the empty-sheet checkbox again")
      : fail(`switch on: checkbox offered=${onBox.box} opened=${onBox.opened}`);
    await gm.evaluate((k) => game.settings.set("air-bladder", k, false), RND);
    await new Promise((r) => setTimeout(r, 500));

    // THE BROKER ASKS TOO (review #27). Withholding the box on Alice's client
    // is the affordance; the answering GM client is the enforcement, and it
    // coerced `blank` for TYPE only. So a crafted (or stale) client emitting
    // `blank: true` past the withheld box got exactly the stranded sheet the
    // withholding exists to prevent. Emit the raw request from Alice with the
    // switch off and read what arrives: a ROLLED character, never a blank one.
    {
      const rawBefore = await snapshot();
      await alice.evaluate(() => {
        game.socket.emit(`system.${game.system.id}`, { action: "generatePC", source: "2e", blank: true });
      });
      const rawArrived = await gmPollNewCharacter(rawBefore);
      if (!rawArrived) {
        fail("switch off: a raw generatePC emit with blank:true minted nothing within 45s");
      } else {
        const raw = await gm.evaluate(async (before) => {
          const a = game.actors.find((x) => x.type === "character" && !before.actors.includes(x.id));
          const out = {
            handBuilt: a?.getFlag("air-bladder", "handBuilt") === true,
            background: a?._source.system.background ?? "",
            items: a?.items.size ?? 0,
          };
          await a?.delete();
          return out;
        }, rawBefore);
        !raw.handBuilt && raw.background && raw.items > 0
          ? ok("switch off: a raw emit with blank:true still mints a ROLLED character — the broker refuses the blank")
          : fail(`switch off: the broker honoured a blank it should have refused: ${JSON.stringify(raw)}`);
      }
    }
    // Re-establish the actor's own flag before the Warden leg. Idempotent
    // when the guard holds (the flag was never written); under the
    // guard-removed witness the enforcement call above DID write it off, and
    // without this line that one mutation cascaded into the two legs below —
    // a witness should red exactly its own leg.
    await gm.evaluate((id) =>
      game.actors.get(id).update({ "system.generationEnabled": true }, { abNoStatusCard: true }), pcId);

    // The same enforcement for the widest of the dice the mayRandomize()
    // action wrapper guards (review #13 #3: only the two frame buttons
    // carried the guard in-handler while every per-line die answered a call
    // past its hidden control). rollBackground is the one a crafted client
    // would pick — changeBackground(actor, null) rewrites background AND
    // granted gear immediately, no confirm — which also makes the witness
    // deterministic: wrapper dropped, the call writes and never toasts.
    const bgBefore = await gm.evaluate((id) => game.actors.get(id).system.background, pcId);
    const enforceBg = await alice.evaluate(async (id) => {
      const sheet = game.actors.get(id).sheet;
      await sheet.options.actions.rollBackground.call(sheet, new Event("click"), null);
      await new Promise((r) => setTimeout(r, 800));
      const want = game.i18n.localize("CAIRN.Notify.RandomizationDisabled");
      return {
        background: game.actors.get(id).system.background,
        told: [...document.querySelectorAll(".notification")].some((n) => n.textContent.includes(want)),
      };
    }, pcId);
    enforceBg.background === bgBefore && enforceBg.told
      ? ok("switch off: rollBackground refuses past its hidden die (background unwritten, toast shown)")
      : fail(`switch off rollBackground: background "${bgBefore}" → "${enforceBg.background}" told=${enforceBg.told}`);

    // The Warden keeps the whole surface while the switch is off. POLLED, with
    // the same open-guard as Alice's reads: this is the GM client's FIRST
    // render of this sheet, so the pack caches are cold and a fixed sleep read
    // a not-yet-rendered sheet as "surface hidden" (bit this leg's first run).
    const gmSurface = await gm.evaluate(async (id) => {
      const a = game.actors.get(id);
      a.sheet.render(true);
      let out = {};
      for (const t0 = Date.now(); Date.now() - t0 < 20000;) {
        const el = a.sheet.element;
        const btn = el?.querySelector('.window-header button[data-action="toggleGeneration"]');
        out = {
          open: !!el,
          toggleShown: !!btn && !btn.classList.contains("cairn-header-hidden"),
          dice: !!el?.querySelector(".background-roll"),
        };
        if (out.toggleShown && out.dice) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await a.sheet.close();
      return out;
    }, pcId);
    gmSurface.toggleShown && gmSurface.dice
      ? ok("switch off: the Warden keeps the toggle and the dice")
      : fail(`switch off hid the WARDEN's surface: ${JSON.stringify(gmSurface)}`);

    await gm.evaluate((k) => game.settings.set("air-bladder", k, true), RND);
    let backState = await surface();
    for (const t0 = Date.now(); Date.now() - t0 < 15000 && !(backState.toggleShown && backState.dice);) {
      await new Promise((r) => setTimeout(r, 250));
      backState = await surface();
    }
    backState.toggleShown && backState.dice
      ? ok("flip on: the surface returned to Alice's open sheet, live")
      : fail(`flip on: toggle=${backState.toggleShown} dice=${backState.dice}`);
    await alice.evaluate((id) => game.actors.get(id)?.sheet?.close(), pcId);
  }

  const swept = await sweep(before);
  console.log(`  (cleaned up: ${swept.named.join(", ") || "nothing"}; ${swept.messages} chat message(s))`);

  // -- The Warden IS asked, since 2026-09-11 ---------------------------------
  //
  // This leg asserted the OPPOSITE until the empty-sheet checkbox landed, and
  // the reversal is deliberate rather than a regression. The 2026-08-08 ruling
  // ("the Warden's own button keeps rolling instantly") was about an accidental
  // click minting a character, which only ever threatened a player. The dialog
  // is now where the roll-or-empty choice is MADE, so a route that skips it
  // cannot offer the choice at all — and a Warden is the person who most wants
  // an empty sheet. It costs one click on the most frequent action in the
  // system, accepted with eyes open, and this leg is what stops it drifting
  // back in either direction.
  //
  // The source resolution moved out of a dialog entirely: `resolveContentSource`
  // answers it without asking, and `promptCreation` is what opens a window.
  console.log("\none source, the Warden");
  await shadowSources(gm, "one");
  const gmResult = await gm.evaluate(async () => {
    const cg = game.cairn.characterGenerator;
    const src = cg.resolveContentSource();
    const before = new Set([...document.querySelectorAll(".application.dialog")].map((d) => d.id));
    const pending = cg.promptCreation("character");
    // Settle on the dialog APPEARING, not on a fixed sleep, and find it by the
    // id difference: a closing DialogV2 lingers, so a bare querySelector can
    // hand back one that is already on its way out.
    const deadline = Date.now() + 6000;
    let el = null;
    while (Date.now() < deadline && !el) {
      el = [...document.querySelectorAll(".application.dialog")].find((d) => !before.has(d.id)) ?? null;
      if (!el) await new Promise((r) => setTimeout(r, 100));
    }
    const hasCheckbox = !!el?.querySelector('input[name="roll"]');
    el?.querySelector('button[data-action="cancel"]')?.click();
    const answer = await Promise.race([pending, new Promise((r) => setTimeout(() => r("HUNG"), 4000))]);
    return { src, dialogOpen: !!el, hasCheckbox, answer };
  });
  gmResult.src === "2e"
    ? ok("resolveContentSource answers '2e' without asking anybody")
    : fail(`resolveContentSource returned ${JSON.stringify(gmResult.src)}`);
  gmResult.dialogOpen && gmResult.hasCheckbox
    ? ok("the Warden IS asked now, and the prompt carries the empty-sheet checkbox")
    : fail(`GM path: dialog open ${gmResult.dialogOpen}, checkbox ${gmResult.hasCheckbox}`);
  gmResult.answer === null
    ? ok("the Warden's Cancel creates nothing")
    : fail(`GM Cancel resolved ${JSON.stringify(gmResult.answer)}`);
  await unshadowSources(gm);

  // -- Two sources: ONE dialog, carrying both questions ---------------------
  //
  // These were two dialogs' worth of question and are now one: the edition
  // dropdown and the roll checkbox share a window. The unstacked assertion is
  // the same one it always was — two modals in a row for one click is the
  // failure this leg was written to catch — and the source select must stay
  // LIVE, because the edition decides what an EMPTY sheet shows (Barebones has
  // a Failed Career row where 2e has an Omen), unlike the monster tier which
  // greys out.
  console.log("\ntwo sources, a player");
  await shadowSources(alice, "two");
  before = await snapshot();
  await clickGenerate();
  const sawPicker = await awaitDialog(alice, t.picker);
  const titlesNow = await dialogTitles(alice);
  sawPicker && !titlesNow.includes(t.confirm)
    ? ok("one dialog carries both questions, unstacked")
    : fail(`expected the picker alone, saw: ${JSON.stringify(titlesNow)}`);
  const twoSourceShape = await alice.evaluate(() => {
    const el = [...document.querySelectorAll(".application.dialog")].at(-1);
    const sel = el?.querySelector('select[name="choice"]');
    const box = el?.querySelector('input[name="roll"]');
    if (!sel || !box) return { sel: !!sel, box: !!box };
    // Clear the box and confirm the edition select does NOT grey out.
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return { sel: true, box: true, options: sel.options.length, staysLive: !sel.disabled };
  });
  twoSourceShape.sel && twoSourceShape.box && twoSourceShape.staysLive
    ? ok(`   …an edition select (${twoSourceShape.options} rows) that stays live when the box is cleared`)
    : fail(`two-source dialog shape: ${JSON.stringify(twoSourceShape)}`);
  await alice.evaluate(() => {
    [...document.querySelectorAll(".application.dialog")].at(-1)
      ?.querySelector('[data-action="close"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 2000));
  const afterPickerX = await snapshot();
  afterPickerX.actors.length === before.actors.length
    ? ok("picker ✕ still creates nothing (issue #6 behaviour intact)")
    : fail("picker ✕ created something");
  await unshadowSources(alice);

  // ---- The Warden's switch (allow-player-generate) -------------------------
  // A REAL world write, flipped from the GM client and restored in the finally
  // below — the one probe-owned setting write in this file. requiresReload is
  // false and the onChange only re-renders directories, so a mid-run crash
  // leaves nothing worse than a hidden button; the finally puts it back anyway.
  console.log("\nthe Warden's switch");
  const SWITCH = "allow-player-generate";
  // NO re-capture here: `priorSwitch` was taken at the top of the run, before
  // anything set it on. Reading it again now would record the value this probe
  // itself wrote, and the finally would restore the PROBE's state as if it were
  // the Warden's - a leaked setting wearing a restore's clothes.
  await gm.evaluate((k) => game.settings.set("air-bladder", k, true), SWITCH);

  const genButton = (page) => page.evaluate(() =>
    !!document.querySelector("#cairn-character-gen-button .create-character-generator-button"));
  const waitButton = async (page, want, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await genButton(page) === want) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  (await genButton(alice)) && (await genButton(gm))
    ? ok("switch on: both clients show Create PC")
    : fail("switch on: a Create PC button is missing");

  // Live flip OFF: the GM writes, the onChange fires on Alice's client, her
  // ALREADY-OPEN directory re-renders and the hook reconciles — no reload.
  await gm.evaluate((k) => game.settings.set("air-bladder", k, false), SWITCH);
  (await waitButton(alice, false))
    ? ok("flip off: Alice's open directory lost the button, live")
    : fail("flip off: Alice still shows Create PC after 15s");
  (await genButton(gm))
    ? ok("flip off: the Warden keeps their own button")
    : fail("flip off: the WARDEN's button vanished — the isGM OR is gone");

  // The broker is the enforcement: a crafted client emitting past the hidden
  // button must be refused on the answering GM client, with the addressed
  // refusal notify landing back on the requester.
  before = await snapshot();
  await alice.evaluate(() => game.socket.emit(`system.${game.system.id}`, { action: "generatePC", source: "2e" }));
  await new Promise((r) => setTimeout(r, 4000));
  const afterRaw = await snapshot();
  afterRaw.actors.length === before.actors.length
    ? ok("raw emit while off: the broker minted nothing")
    : fail(`raw emit while off minted ${afterRaw.actors.length - before.actors.length} actor(s)`);
  const disabledMsg = await alice.evaluate(() => {
    const want = game.i18n.localize("CAIRN.Notify.PcGenDisabled");
    return [...document.querySelectorAll(".notification")].some((n) => n.textContent.includes(want));
  });
  disabledMsg
    ? ok("…and Alice was told the Warden switched it off")
    : fail("no PcGenDisabled notification reached Alice");

  // Live flip back ON: the button returns without a reload.
  await gm.evaluate((k) => game.settings.set("air-bladder", k, true), SWITCH);
  (await waitButton(alice, true))
    ? ok("flip on: Alice's button returned, live")
    : fail("flip on: Alice's button did not come back");

  const errs = [...gmErrors, ...alErrors];
  errs.length === 0 ? ok("zero console errors across both clients") : fail(`console errors: ${errs.join(" | ")}`);
} finally {
  clearTimeout(dog);
  for (const [key, prior] of [["allow-player-generate", priorSwitch], ["allow-player-marketplace", priorMarket],
    ["allow-player-randomization", priorRand]]) {
    if (prior === null) continue;
    try {
      await gm.evaluate(([k, v]) => game.settings.set("air-bladder", k, v), [key, prior]);
      console.log(`  (${key} restored to ${prior})`);
    } catch (e) {
      console.error(`  COULD NOT RESTORE ${key} (wanted ${prior}): ${e.message}`);
    }
  }
  await browser.close();
}

if (failed) { console.error("\nPLAYER-GENERATE PROBE FAILED"); process.exit(1); }
console.log("\nplayer-generate probe passed");

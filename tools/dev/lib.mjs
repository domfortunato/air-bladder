/**
 * Helpers for driving a local Foundry instance from Playwright.
 * Setup, and which probes run before tagging vs after publishing:
 * `docs/release-testing.md`.
 */

export const FOUNDRY_URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";

/** Foundry's minimum supported resolution; below this it logs a console error. */
export const VIEWPORT = { width: 1600, height: 1000 };

/**
 * Run `fn` and put every world setting back the way it was, even if `fn` throws.
 *
 *   await withSettings(page, async () => { ...probe body... });
 *
 * Why this exists, and why the restore has to live HERE rather than inside the
 * probe's `page.evaluate`: on 2026-07-29 `e2e-age-override` set `min-age` to 99
 * to test the age floor, then threw on the next line (an AppV2 casualty —
 * `sheet._onRollAge` had stopped existing). Its restore sat *after* the throw,
 * inside the same evaluate, so it never ran. The setting stayed at 99 in the dev
 * world, and from then on EVERY character generated aged 99 and the age re-roll
 * looked broken — it was flooring to 99 too, so the value never visibly changed.
 * The user hit it as a system bug hours later.
 *
 * An exception inside `page.evaluate` propagates into Node, so a Node-level
 * `finally` still runs when an in-page one would have been skipped. Anything a
 * probe changes about the world it shares with a human belongs in that finally.
 *
 * Restores by diffing against the snapshot, so it touches only what actually
 * moved, and reports what it put back — a silent repair would hide a probe that
 * leaks on every run.
 */
export async function withSettings(page, fn) {
  const NS = "air-bladder";
  const snapshot = await page.evaluate((ns) => {
    const out = {};
    for (const [key, cfg] of game.settings.settings) {
      if (!key.startsWith(`${ns}.`) || cfg.scope === "client") continue;
      try { out[key.slice(ns.length + 1)] = game.settings.get(ns, key.slice(ns.length + 1)); } catch { /* unreadable */ }
    }
    return out;
  }, NS);

  try {
    return await fn();
  } finally {
    try {
      const restored = await page.evaluate(async ({ ns, snapshot }) => {
        const changed = [];
        for (const [key, was] of Object.entries(snapshot)) {
          let now;
          try { now = game.settings.get(ns, key); } catch { continue; }
          if (JSON.stringify(now) === JSON.stringify(was)) continue;
          await game.settings.set(ns, key, was);
          changed.push(`${key}: ${JSON.stringify(now)} -> ${JSON.stringify(was)}`);
        }
        return changed;
      }, { ns: NS, snapshot });
      if (restored.length) {
        console.log(`  note  restored ${restored.length} leaked setting(s):`);
        for (const c of restored) console.log(`          ${c}`);
      }
    } catch (e) {
      // Never let cleanup mask the real failure.
      console.error(`  note  could not restore settings: ${e.message}`);
    }
  }
}

/**
 * Clear the things that block automated clicks: the one-time usage-data consent
 * prompt, and tour overlays, which cover the screen and swallow pointer events.
 */
export async function dismissChrome(page) {
  const decline = page.getByRole("button", { name: /Decline Sharing/i });
  if (await decline.count()) {
    await decline.first().click().catch(() => {});
    await page.waitForTimeout(800);
  }

  // Exit via the API so the dismissal persists, then sweep any leftover nodes.
  await page.evaluate(() => {
    try {
      for (const t of globalThis.game?.tours?.contents ?? []) {
        if (t.status === "in-progress") t.exit();
      }
    } catch { /* the setup page does not expose game.tours */ }
  }).catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll(".tour-overlay, .tour.active").forEach(e => e.remove());
  }).catch(() => {});

  // Notifications, which are NOT chrome you can ignore. Headless Chromium always
  // raises a PERMANENT hardware-acceleration warning, and it renders in the
  // top-right — directly over a window's header controls. Anything driving the
  // `⋮` menu fails with "notification intercepts pointer events" and looks like a
  // broken sheet rather than a covered button.
  await page.evaluate(() => {
    try { ui.notifications?.clear?.(); } catch { /* pre-ready */ }
    document.querySelectorAll("#notifications > li").forEach(e => e.remove());
  }).catch(() => {});
}

/**
 * Fail the run after `ms` instead of hanging until the harness gives up.
 *
 * Written after a probe deadlocked for SEVEN MINUTES: `DialogV2` is modal and its
 * promise settles only on a button press, so one code path that returned without
 * pressing anything left an awaited `createDialog()` pending forever. A hang is the
 * worst failure mode there is — it costs the whole harness timeout and reports
 * nothing about what broke — and it is the normal shape of failure for any probe
 * that awaits a dialog, a socket round trip, or a poll.
 *
 * Call once, right after launching the browser. `unref()` so a probe that finishes
 * early is not held open by the timer.
 */
export function watchdog(ms = 120000, label = "probe", cleanup = null) {
  const t = setTimeout(async () => {
    console.error(`\n  FAIL  ${label} exceeded ${ms}ms — treating as a hang, not a slow run`);
    // CLOSE THE BROWSER BEFORE EXITING. `process.exit` skips every async
    // teardown a probe would otherwise run, so a watchdog firing used to leave
    // a Chromium alive with a live WARDEN session attached to the dev world —
    // and this repo already records what a parked Warden client does to the
    // probes that come after it (a relay probe counts double; dev:changelog
    // refuses outright). A timeout in one probe must not become a red in the
    // next four. Bounded, because the whole point is that something is stuck:
    // if the close does not come back in two seconds we exit anyway.
    //
    // THE CLEANUP IS NO LONGER THE CALLER'S TO REMEMBER (2026-10-03). It was an
    // optional third argument, and 3 probes of 45 passed it — so for the other
    // 42 the paragraph above described an intention rather than a behaviour, and
    // the cost landed: `dev:enc-damage` timed out, left a Warden session parked,
    // and the next probe's brokered-drop legs duplicated every item because the
    // system's socket brokers answer once per SESSION (see
    // `foundry-userconnected-activegm`). An hour went into the duplication
    // before the parked session was suspected. Every browser that has joined
    // through `joinAsGM`/`joinAs` is registered below and closed here, so the
    // guarantee holds for probes that never knew about it.
    try {
      await Promise.race([
        Promise.all([...joinedBrowsers].map((b) => b.close().catch(() => {}))),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    } catch { /* exiting anyway */ }
    if (typeof cleanup === "function") {
      try {
        await Promise.race([
          Promise.resolve(cleanup()),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      } catch { /* exiting anyway */ }
    }
    process.exit(1);
  }, ms);
  t.unref();
  return t;
}

/**
 * Every browser a probe has joined the world through.
 *
 * Collected so the watchdog can close them without each probe passing a cleanup
 * — see its comment for what the omission cost. A Set, because a probe joins
 * several contexts of ONE browser (a GM page, a player page, a second Warden),
 * and `browser.close()` takes the lot.
 */
const joinedBrowsers = new Set();

/** Register the browser behind a page that is about to join the world. */
const noteBrowser = (page) => {
  const b = page?.context?.()?.browser?.();
  if (b) joinedBrowsers.add(b);
};

/**
 * Run `fn` with one of the system's hooks unregistered, then put it back.
 *
 * This is how a probe negative-controls a hook-based feature WITHOUT editing source
 * and re-running: `Hooks.events` is a public registry of `{hook, id, fn}` entries and
 * `Hooks.off` takes either the id or the function, so the feature can be switched off
 * in the live page, asserted absent, and switched back on — seconds, one session, and
 * the repo is never dirty.
 *
 * The alternative cost real time and left a hazard: stubbing `module/cairn.js` and
 * re-running meant a full browser launch per direction, and when the harness killed
 * one run mid-flight the stub stayed in the working tree. Same reasoning as
 * `withSettings` above — the restore belongs in a Node-level `finally`, where a throw
 * inside the page cannot skip it.
 *
 * Identifies the handler by FUNCTION NAME, so the hook must be registered as a named
 * function expression. That is deliberate: matching on `fn.toString()` would silently
 * stop matching the day the implementation is reworded.
 *
 * @param {import("playwright").Page} page
 * @param {String} hook     e.g. "renderDialogV2"
 * @param {String} fnName   the registered handler's function name
 * @param {Function} fn     Node-side callback run while the hook is off
 */
export async function withHookOff(page, hook, fnName, fn) {
  const found = await page.evaluate(([hook, fnName]) => {
    const entry = (Hooks.events[hook] ?? []).find((e) => e.fn?.name === fnName);
    if (!entry) return false;
    globalThis.__abHookOff = { hook, fn: entry.fn };
    Hooks.off(hook, entry.id);
    return true;
  }, [hook, fnName]);
  if (!found) throw new Error(`withHookOff: no "${fnName}" handler registered for ${hook}`);
  try {
    return await fn();
  } finally {
    await page.evaluate(() => {
      const saved = globalThis.__abHookOff;
      if (!saved) return;
      Hooks.on(saved.hook, saved.fn);
      delete globalThis.__abHookOff;
    });
  }
}

/**
 * Run a write in the page WITHOUT awaiting it across the protocol.
 *
 * An evaluate that awaits a document write can be dropped mid-await with
 * "Execution context was destroyed, most likely because of a navigation" when
 * nothing navigated, no socket dropped and nothing crashed. The ops fleet calls
 * it the collected-promise flake and reruns any probe whose log carries the
 * sentence: Playwright's wording for the inspector's "Promise was collected", a
 * pending promise held weakly and taken by a garbage collection. DB Mythic met it
 * six times from 2026-10-07 and contained it with this helper (its
 * `tools/dev/lib.mjs`, `7b48a54`); the root cause is still unknown, so this is
 * containment, mirrored mechanism for mechanism. Here it struck
 * `dev:directory-buttons` on the fleet (2026-10-22), an evaluate awaiting
 * `game.settings.set("core", "permissions", …)` on the Warden's page while
 * Alice's page, which logs every navigation, logged none.
 *
 * `fn(arg)` is started by one short evaluate that returns at once, its promise
 * held by the page in `globalThis.__abWrites[token]` where no collection can
 * reach it, and the result is read back by polling. `fn` is sent as SOURCE and
 * takes ONE serialisable argument, as `page.evaluate` does — it closes over
 * nothing from Node. Its resolved value comes back when it is plain data (a
 * Document resolves to undefined). A throw inside is rethrown here with `label`.
 *
 * @param {import("playwright").Page} page
 * @param {Function} fn
 * @param {*} arg
 * @param {{timeout?: number, label?: string}} [options]
 */
export async function writeInPage(page, fn, arg, { timeout = 15000, label = "a write in the page" } = {}) {
  const token = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.evaluate(({ src, arg, token }) => {
    const store = (globalThis.__abWrites ??= {});
    store[token] = { state: "pending" };
    const run = new Function(`return (${src})`)();
    Promise.resolve().then(() => run(arg)).then(
      (value) => {
        let plain;
        try { plain = value?.documentName ? undefined : JSON.parse(JSON.stringify(value ?? null)); } catch { plain = undefined; }
        store[token] = { state: "settled", value: plain };
      },
      (error) => { store[token] = { state: "threw", message: error?.message ?? String(error) }; });
  }, { src: fn.toString(), arg, token });
  let done = null;
  for (const deadline = Date.now() + timeout; !done && Date.now() < deadline;) {
    done = await page.evaluate((token) => {
      const w = globalThis.__abWrites?.[token];
      return w && w.state !== "pending" ? w : null;
    }, token);
    if (!done) await page.waitForTimeout(100);
  }
  await page.evaluate((token) => { delete globalThis.__abWrites?.[token]; }, token).catch(() => {});
  if (!done) throw new Error(`${label}: still pending after ${timeout} ms`);
  if (done.state === "threw") throw new Error(`${label}: ${done.message}`);
  return done.value;
}

/**
 * Set the world's OWN RollTables of these names aside, in-page, for the rest of
 * the page's life — so a probe that plants a table of a declared name gets the
 * one it planted.
 *
 * Every world-first resolver takes the FIRST world table of the name
 * (`game.tables.find` in compendium.js `findTableByName`/`findDeclaredTable`
 * and actor-sheet.js), so a Warden's copy made by a take-over door — "Bonds",
 * "Omens", "Spells — Canon (1d100)" in the dev world since 2026-10-04 — beats
 * anything a probe creates after it. Three probes went red on exactly that on
 * the fleet (2026-10-22): `dev:bond-dupes` refused, `dev:spell-pool` resolved
 * the Warden's copy, `dev:reroll-dialog` rolled the real Omens over a planted
 * empty one. A dev world a Warden actually uses holds such copies, so the
 * probe must not need them gone.
 *
 * NOTHING IS WRITTEN. The Warden's tables are neither renamed nor deleted — a
 * rename restored in a `finally` is still a write that a killed run strands.
 * `find` is shadowed on the collection INSTANCE to skip the held ids, which a
 * closed page discards, and the system's own code runs unchanged. Held by ID,
 * fixed at the call: a table the probe plants afterwards is visible as usual.
 *
 * @param {import("playwright").Page} page
 * @param {string[]} names
 * @returns {Promise<{id: string, name: string}[]>} what was set aside, for a note
 */
/**
 * Record every Actor THIS page's user creates from here on, so a probe can
 * sweep what it made from its Node `finally` — whatever a leg threw.
 *
 * WHY A RECORDER AND NOT A STAMP (review #34 findings 150, 256, 259, the third
 * sighting of one class). Sixteen probes generated characters through the
 * real generators, deleted them only on the success path, and stamped nothing,
 * so a crashed leg left randomly named fixtures nothing could tell from the
 * Warden's. And a generated 2e character mints its background's containers as
 * world actors connected to it — a Mountebank's Cart, an Outrider's horse — and
 * deleting the character alone turns each into a stray "formerly belonged to"
 * actor: about one in eight random 2e PCs, so a full suite usually left one.
 * A stamp cannot reach actors a generator mints on the probe's behalf; a
 * `createActor` hook sees all of them, children included.
 *
 * The hook keys on the USER, not the session, so on a world a human Warden is
 * using at the same time, an actor that Warden creates during the run is
 * recorded too. The fleet runs probes alone; on the dev world, run probes
 * while nobody is creating actors there.
 * @param {import("playwright").Page} page
 */
export async function trackCreatedActors(page) {
  await page.evaluate(() => {
    if (window.__abProbeCreated) return;
    window.__abProbeCreated = [];
    Hooks.on("createActor", (actor, _options, userId) => {
      if (userId === game.user.id) window.__abProbeCreated.push(actor.id);
    });
  });
}

/**
 * Delete every actor `trackCreatedActors` recorded that still exists. Never
 * throws: it runs from a `finally`, after whatever went wrong.
 * @param {import("playwright").Page} page
 * @returns {Promise<number>}  how many were deleted
 */
export async function sweepCreatedActors(page) {
  try {
    return await page.evaluate(async () => {
      const ids = [...new Set(window.__abProbeCreated ?? [])].filter((id) => game.actors.has(id));
      // CHILDREN FIRST: deleting a keeper converts its still-connected
      // children into "formerly belonged to" actors (CairnActor's delete
      // operation), which must not race their own deletion in one batch.
      const children = ids.filter((id) => game.actors.get(id)?.system?.connectedTo);
      const rest = ids.filter((id) => !children.includes(id));
      if (children.length) await Actor.deleteDocuments(children);
      const left = rest.filter((id) => game.actors.has(id));
      if (left.length) await Actor.deleteDocuments(left);
      window.__abProbeCreated = [];
      return ids.length;
    });
  } catch {
    return 0;
  }
}

/**
 * Hide world RollTables by id on one page, from EVERY read the shop makes:
 * iteration (marketplace.js `marketTables` walks `game.tables`), `find` and
 * `filter`. In-page only: nothing is written, the shadow dies with the page,
 * and a table planted later is a new id and stays visible. Call it once per
 * page that reads the tables (review #34 findings 153 and 111).
 * @param {import("playwright").Page} page
 * @param {string[]} heldIds
 */
export async function hideTablesInPage(page, heldIds) {
  await page.evaluate((heldIds) => {
    if (!heldIds.length) return;
    const ids = new Set(heldIds);
    const tables = game.tables;
    const baseIter = tables[Symbol.iterator];
    tables[Symbol.iterator] = function* () { for (const t of baseIter.call(this)) if (!ids.has(t.id)) yield t; };
    const baseFind = tables.find;
    tables.find = function (condition, ...rest) {
      return baseFind.call(this, (t, ...a) => !ids.has(t.id) && condition(t, ...a), ...rest);
    };
    const baseFilter = tables.filter;
    tables.filter = function (condition, ...rest) {
      return baseFilter.call(this, (t, ...a) => !ids.has(t.id) && condition(t, ...a), ...rest);
    };
  }, heldIds);
}

export async function holdAsideWorldTables(page, names) {
  return page.evaluate((names) => {
    const held = game.tables.filter((t) => names.includes(t.name));
    if (!held.length) return [];
    const ids = new Set(held.map((t) => t.id));
    const base = game.tables.find;
    game.tables.find = function (condition, ...rest) {
      return base.call(this, (t, ...a) => !ids.has(t.id) && condition(t, ...a), ...rest);
    };
    return held.map((t) => ({ id: t.id, name: t.name }));
  }, names);
}

/**
 * Collect real console errors. Two known-irrelevant messages are filtered:
 * the viewport warning (an artifact of the headless window size) and the
 * hardware-acceleration warning (headless Chromium has no GPU).
 */
export function watchErrors(page) {
  const errors = [];
  const ignore = [
    /requires a screen resolution/i,
    /hardware acceleration/i,
    // A race INSIDE CORE's notification UI, not ours. `#postNotification`
    // re-queries the card it just inserted AFTER awaiting a 100ms spacer
    // animation and dereferences the result unguarded
    // (`element.hidden = false`, scripts/foundry.mjs:130673-130674), so a
    // notification whose element is gone by then throws. Two warnings posted
    // close together is enough; nothing a system does can prevent it.
    //
    // Matched on the FRAME as well as the message, deliberately. "Cannot set
    // properties of null (setting 'hidden')" occurs in half a dozen places in
    // this system too — `CairnActor.createDialog`'s render callback has an
    // unguarded `otherEl.hidden` of exactly this shape — and a message-only
    // ignore would swallow ours along with core's.
    /Cannot set properties of null \(setting 'hidden'\)[\s\S]*#postNotification/,
  ];
  const keep = (t) => !ignore.some((re) => re.test(t));
  page.on("console", m => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!keep(t)) return;
    errors.push(t);
  });
  // The STACK too, first frame onwards. A pageerror reported as its message
  // alone ("Cannot set properties of null (setting 'hidden')") names neither the
  // file nor the caller, and the same message occurs in half a dozen places
  // across core and this system — which turns a one-line diagnosis into a hunt,
  // and tempts a re-run instead. Trimmed so a long core stack cannot bury the
  // rest of the report.
  page.on("pageerror", (e) => {
    const frames = String(e.stack ?? "").split("\n").slice(1, 5).map((s) => s.trim()).join(" <- ");
    const t = `pageerror: ${e.message}${frames ? `\n    at ${frames}` : ""}`;
    // The ignore list applies HERE TOO. It used to filter console errors only,
    // so a pageerror was unconditionally fatal — which is why the ignore above
    // can be written against the stack at all.
    if (keep(t)) errors.push(t);
  });
  return errors;
}

/**
 * Choose the user on the join form, whichever form this build renders.
 *
 * TWO SHAPES (measured 2026-10-04, the 0.1.24 post-publish leg). 14.365 — CT
 * 123 and every probe run before that day — renders a `<select name="userid">`
 * of every user. 14.368, the build `verified` named then, replaced it with a typed
 * `username` field inside `#join-game-form` and no list at all, so the helper
 * waited thirty seconds for a select that never came and smoke could not log
 * in. The page still carries `game.users`, so the name is read from there:
 * the named user, or for the Warden the first GAMEMASTER (the select's first
 * option, which this used to pick, is the same user on a fresh world).
 *
 * THE THIRD SHAPE (2026-10-30, review #34). 14.369 — the probe fleet since
 * 2026-10-28 — brings the dropdown back, named `userId`, so the select is
 * matched by name without regard to case and one selector serves both
 * dropdowns. On a dropdown too the Warden is now the role-4 user, never the
 * first option. And 14.369 DISABLES the option of a user already in the world,
 * and a disabled option drops out of the form it submits. Measured by DB
 * Mythic's probes on the same fleet (its `738a598d`, `1571b3cd`): every box's
 * settle failed on the old selector, then exactly its four second-session
 * probes failed on the disabled option.
 *
 * THAT DISABLED OPTION IS A SIGNAL, NOT AN OBSTACLE (review #34 finding 109).
 * It is the one pre-join sign that the user already holds a session — a parked
 * Warden tab, an orphaned probe browser — and once joined, `game.users` cannot
 * show it (it counts the USER once). This used to re-enable it for every
 * caller, so every probe joined on top of a parked Warden without a word. Now
 * a busy user (a disabled option, or `active` on the page's own user list) is
 * waited for, reloading the join page, because a re-join right after closing
 * the first session (`dev:connections`, `dev:encumbered-damage`) can beat the
 * server's release; and if it is still busy after BUSY_WAIT_MS the join
 * THROWS, naming the user. Only a caller that opens a second session on
 * purpose (`dev:combat-options`' second Warden) passes `secondSession: true`,
 * and only then is the option enabled again.
 *
 * Wait for the CONTROL, not the network — the join form is rendered
 * client-side and is routinely still absent at networkidle. That wait was once
 * missing from `joinAsGM`, and two silent `return`s turned it into a 90-second
 * hang: no user chosen, an empty form posted, the probe sitting on
 * `game.ready`. It surfaced only when a probe re-joined mid-run
 * (`dev:connections`), the first join being slow enough to render by itself.
 *
 * @param {import("playwright").Page} page
 * @param {String|null} name  a User name, or null for the Warden
 * @param {{secondSession?: boolean}} [opts]
 * @return {Promise<String|null>}  the name chosen, or null when there is none
 */
const JOIN_SELECT = 'select[name="userid" i]';
const BUSY_WAIT_MS = 20000;

async function chooseJoinUser(page, name, { secondSession = false } = {}) {
  const deadline = Date.now() + BUSY_WAIT_MS;
  for (;;) {
    // A join page that never drew its form went unexplained once
    // (dev:combat-options' Alice, fleet 20261103T031739Z on 14.368, green on
    // three solo re-runs): say what the page WAS showing, so a repeat names
    // its cause instead of a bare timeout.
    try {
      await page.waitForSelector(
        `${JOIN_SELECT} option[value]:not([value=""]), #join-game-form input[name="username"]`,
        { state: "attached", timeout: 30000 });
    } catch (e) {
      const seen = await page.evaluate(() => ({
        title: document.title,
        body: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
        forms: [...document.querySelectorAll("form")].map((f) => f.id || f.className || "form").slice(0, 5),
      })).catch((err) => ({ unreadable: String(err).slice(0, 120) }));
      throw new Error(`join: no user control on ${page.url()} after 30 s: ${JSON.stringify(seen)} (${e.message.split("\n")[0]})`);
    }
    const r = await page.evaluate(({ name, select, secondSession }) => {
      const raw = globalThis.game?.users;
      const users = raw?.contents ?? (Array.isArray(raw) ? raw : []);
      const GM = globalThis.CONST?.USER_ROLES?.GAMEMASTER ?? 4;
      const warden = users.find((u) => u.role === GM);
      const userOf = (id) => users.find((u) => (u.id ?? u._id) === id);
      // 14.365 and 14.369: Foundry v14 hides <select> behind custom elements, so
      // Playwright's selectOption() sees it as invisible. Drive the element.
      const s = document.querySelector(select);
      if (s) {
        const options = [...s.options].filter((o) => o.value);
        const opt = name ? options.find((o) => o.textContent.trim() === name)
          : (warden ? options.find((o) => o.value === (warden.id ?? warden._id)) : options[0]);
        if (!opt) return { picked: null };
        const label = opt.textContent.trim();
        if ((opt.disabled || userOf(opt.value)?.active === true) && !secondSession) return { busy: label };
        opt.disabled = false;
        s.value = opt.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
        return { picked: label };
      }
      // 14.368: a typed username and no list.
      const field = document.querySelector('#join-game-form input[name="username"]');
      const user = name ? users.find((u) => u.name === name) : (warden ?? users[0]);
      if (!field || !user) return { picked: null };
      if (user.active === true && !secondSession) return { busy: user.name };
      field.value = user.name;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return { picked: user.name };
    }, { name, select: JOIN_SELECT, secondSession });
    if (!r.busy) return r.picked;
    if (Date.now() > deadline) {
      throw new Error(`join: "${r.busy}" already holds a session in this world and still did after `
        + `${BUSY_WAIT_MS / 1000} s — a parked tab or an orphaned probe browser (list chrome-headless-shell). `
        + "Close it and re-run; a probe that opens a second session on purpose passes {secondSession: true}");
    }
    await page.waitForTimeout(2000);
    await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "networkidle", timeout: 60000 });
  }
}

/**
 * Let a load the probe already started FINISH before a join helper navigates.
 * Nine probes call `page.goto(FOUNDRY_URL)` and then joinAsGM/joinAs, which open
 * /join themselves; when the first load is still booting, the second navigation
 * cancels its in-flight fetches and Foundry logs "Unable to load requested
 * localization file lang/en.json", a console error that reds the probe with every
 * check green (fleet 20261106T152655Z grimoire, 20261106T174058Z sheet-basics:
 * the Chromium log shows the banner, "Initializing", the failure, the banner
 * again). Settling here covers every caller, so the race cannot come back with
 * the next probe that writes the same two lines. A blank page has nothing to wait
 * for; a load that never goes idle is not this helper's to diagnose.
 * @param {import("playwright").Page} page
 */
async function settleCurrentLoad(page) {
  if (page.url() === "about:blank") return;
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
}

/**
 * Join the world as the Warden: the role-4 user, on every form.
 * @param {import("playwright").Page} page
 * @param {{secondSession?: boolean}} [opts]  true only to open a second
 *   session of a Warden who is already in the world, on purpose
 */
export async function joinAsGM(page, opts = {}) {
  noteBrowser(page);
  await settleCurrentLoad(page);
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "networkidle", timeout: 60000 });
  const picked = await chooseJoinUser(page, null, opts);
  // Fail LOUDLY and immediately. Returning quietly here is what bought the
  // 90-second timeout above; a thrown error names the real problem.
  if (!picked) throw new Error("joinAsGM: the join form never offered a user");
  await page.locator('button[type="submit"][name="join"], form#join-game button[type="submit"]')
    .first().click({ timeout: 15000 });

  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(page);
}

/**
 * Join the world as a NAMED user — the only way to exercise permission behaviour,
 * since a GM passes every ownership check and so can never reproduce a player's
 * failure. Pair with `create-players.mjs`, which seeds Alice and Bob.
 *
 * Give each session its own browser CONTEXT: Foundry keys the session cookie per
 * origin, so two pages in one context are the same logged-in user.
 *
 * @param {import("playwright").Page} page
 * @param {String} name  a User name that already exists in the world
 * @param {{secondSession?: boolean}} [opts]  as joinAsGM
 */
export async function joinAs(page, name, opts = {}) {
  noteBrowser(page);
  await settleCurrentLoad(page);
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "networkidle", timeout: 60000 });
  const picked = await chooseJoinUser(page, name, opts);
  if (!picked) throw new Error(`joinAs: no user named "${name}" — run \`npm run dev:players\` first`);

  await page.locator('button[type="submit"][name="join"], form#join-game button[type="submit"]')
    .first().click({ timeout: 15000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(page);
}

/**
 * Answer the Kettlewright importer's options dialog, which opens between the
 * import button and the file picker. Informational since the background gate
 * retired (2026-09-01, user ruling), so answering it is pressing the button
 * that opens the picker.
 *
 * Shared, because several e2es drive this flow and a dialog nobody dismisses
 * looks exactly like an importer that silently did nothing.
 */
export async function confirmImportOptions(page) {
  await page.waitForSelector(".kwi-options", { timeout: 15000 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".dialog-v2 button, .application.dialog button, dialog.application button")]
      .find((b) => b.dataset.action === "import");
    btn?.click();
  });
}

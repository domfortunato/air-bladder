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
 * probe's `page.evaluate`: on 2026-07-29 `age-override-probe` set `min-age` to 99
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
 * of every user. 14.368, the build `verified` names, replaced it with a typed
 * `username` field inside `#join-game-form` and no list at all, so the helper
 * waited thirty seconds for a select that never came and smoke could not log
 * in. The page still carries `game.users`, so the name is read from there:
 * the named user, or for the Warden the first GAMEMASTER (the select's first
 * option, which this used to pick, is the same user on a fresh world).
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
 * @return {Promise<String|null>}  the name chosen, or null when there is none
 */
async function chooseJoinUser(page, name) {
  await page.waitForSelector(
    'select[name="userid"] option[value]:not([value=""]), #join-game-form input[name="username"]',
    { state: "attached", timeout: 30000 });
  return page.evaluate((name) => {
    // 14.365: Foundry v14 hides <select> behind custom elements, so
    // Playwright's selectOption() sees it as invisible. Drive the element.
    const s = document.querySelector('select[name="userid"]');
    if (s) {
      const opt = [...s.options].find((o) => (name ? o.textContent.trim() === name : o.value));
      if (!opt) return null;
      s.value = opt.value;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return opt.textContent.trim();
    }
    // 14.368: a typed username and no list.
    const field = document.querySelector('#join-game-form input[name="username"]');
    const users = globalThis.game?.users?.contents ?? [];
    const GM = globalThis.CONST?.USER_ROLES?.GAMEMASTER ?? 4;
    const user = name ? users.find((u) => u.name === name)
      : (users.find((u) => u.role === GM) ?? users[0]);
    if (!field || !user) return null;
    field.value = user.name;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return user.name;
  }, name);
}

/** Join the world as the first available user (the Gamemaster on a fresh world). */
export async function joinAsGM(page) {
  noteBrowser(page);
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "networkidle", timeout: 60000 });
  const picked = await chooseJoinUser(page, null);
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
 */
export async function joinAs(page, name) {
  noteBrowser(page);
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "networkidle", timeout: 60000 });
  const picked = await chooseJoinUser(page, name);
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

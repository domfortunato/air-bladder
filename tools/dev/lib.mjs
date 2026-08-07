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
export function watchdog(ms = 120000, label = "probe") {
  const t = setTimeout(() => {
    console.error(`\n  FAIL  ${label} exceeded ${ms}ms — treating as a hang, not a slow run`);
    process.exit(1);
  }, ms);
  t.unref();
  return t;
}

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

/** Join the world as the first available user (the Gamemaster on a fresh world). */
export async function joinAsGM(page) {
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "networkidle", timeout: 60000 });

  // Wait for the CONTROL, not the network — the join form is rendered
  // client-side and is routinely still absent at networkidle. This wait used to
  // be missing here (it has always been in `joinAs` below), and the two silent
  // `return`s underneath turned that into a 90-second hang with a useless
  // message: no user got selected, the submit posted an empty form, and the
  // probe sat on `game.ready` until the timeout. It survived because the FIRST
  // join of a run is slow enough to have rendered by itself; the failure only
  // appears when a probe closes a GM context and re-joins mid-run, which
  // `dev:connections` is the first probe to do.
  await page.waitForSelector('select[name="userid"] option[value]:not([value=""])', {
    state: "attached", timeout: 30000,
  });

  // Foundry v14 hides <select> behind custom elements, so Playwright's
  // selectOption() sees it as invisible. Drive the underlying element directly.
  const picked = await page.evaluate(() => {
    const s = document.querySelector('select[name="userid"]');
    if (!s) return null;
    const opt = [...s.options].find(o => o.value);
    if (!opt) return null;
    s.value = opt.value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return opt.textContent.trim();
  });
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
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "networkidle", timeout: 60000 });
  // The join form is rendered client-side, so it can still be absent at
  // networkidle. Wait for the control itself rather than the network.
  await page.waitForSelector('select[name="userid"] option[value]:not([value=""])', {
    state: "attached", timeout: 30000,
  });

  const picked = await page.evaluate((name) => {
    // v14 hides <select> behind custom elements — drive the underlying element.
    const s = document.querySelector('select[name="userid"]');
    if (!s) return null;
    const opt = [...s.options].find((o) => o.textContent.trim() === name);
    if (!opt) return null;
    s.value = opt.value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return opt.value;
  }, name);
  if (!picked) throw new Error(`joinAs: no user named "${name}" — run \`npm run dev:players\` first`);

  await page.locator('button[type="submit"][name="join"], form#join-game button[type="submit"]')
    .first().click({ timeout: 15000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  await dismissChrome(page);
}

/**
 * Answer the Kettlewright importer's options dialog, which opens between the
 * import button and the file picker. Ticks or unticks the background gate, then
 * presses the button that opens the picker.
 *
 * Shared, because three e2es drive this flow and a dialog nobody dismisses looks
 * exactly like an importer that silently did nothing.
 */
export async function confirmImportOptions(page, { requireBackground = true } = {}) {
  await page.waitForSelector(".kwi-options", { timeout: 15000 });
  await page.evaluate((req) => {
    const cb = document.querySelector('.kwi-options input[name="requireBackground"]');
    if (cb && cb.checked !== req) cb.click();
  }, requireBackground);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".dialog-v2 button, .application.dialog button, dialog.application button")]
      .find((b) => b.dataset.action === "import");
    btn?.click();
  });
}

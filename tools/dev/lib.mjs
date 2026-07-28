/**
 * Helpers for driving a local Foundry instance from Playwright.
 * See the "Local dev loop" section of CLAUDE.md for setup.
 */

export const FOUNDRY_URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";

/** Foundry's minimum supported resolution; below this it logs a console error. */
export const VIEWPORT = { width: 1600, height: 1000 };

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
}

/**
 * Collect real console errors. Two known-irrelevant messages are filtered:
 * the viewport warning (an artifact of the headless window size) and the
 * hardware-acceleration warning (headless Chromium has no GPU).
 */
export function watchErrors(page) {
  const errors = [];
  const ignore = [/requires a screen resolution/i, /hardware acceleration/i];
  page.on("console", m => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (ignore.some(re => re.test(t))) return;
    errors.push(t);
  });
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Join the world as the first available user (the Gamemaster on a fresh world). */
export async function joinAsGM(page) {
  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: "networkidle", timeout: 60000 });

  // Foundry v14 hides <select> behind custom elements, so Playwright's
  // selectOption() sees it as invisible. Drive the underlying element directly.
  await page.evaluate(() => {
    const s = document.querySelector('select[name="userid"]');
    if (!s) return;
    const opt = [...s.options].find(o => o.value);
    if (!opt) return;
    s.value = opt.value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

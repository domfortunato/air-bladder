#!/usr/bin/env node
/**
 * dev:i18n-load — the Spanish interface actually LOADS in a live client.
 *
 *   npm run dev:i18n-load                          (pre-tag, :30000)
 *   FOUNDRY_URL=http://localhost:30001 npm run dev:i18n-load   (post-release)
 *
 * The other half of the 2026-08-11 translation-loss ruling ("checked
 * pre-release AND post-release"): check:translations proves the FILES are
 * whole offline; this proves the client genuinely serves them — because the
 * file can be perfect and the language still silently dead (a string/object
 * collision makes Foundry drop the whole file and fall back to English with
 * no console error a user would notice; Malecho's report read exactly like
 * that until a live client disproved it).
 *
 * Method: flip the CLIENT language setting to es (browser-local; this
 * Playwright context is ephemeral and the setting is restored in a finally),
 * reload, then compare game.i18n.localize against the SERVED lang/es.json
 * for every deepest-dotted and shallow key alike — no hardcoded Spanish, so
 * a re-voicing by the translator can never red this probe. A key whose
 * localize output is not the served file's value means that part of the file
 * did not load. Asserted over the whole file, plus a floor on its size so an
 * emptied-but-valid file cannot pass (witness: --min-keys 99999 must red).
 */
import { chromium } from "playwright";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors, watchdog } from "./lib.mjs";

watchdog(120000, "dev:i18n-load");
const minKeysArg = process.argv.indexOf("--min-keys");
const MIN_KEYS = minKeysArg > -1 ? Number(process.argv[minKeysArg + 1]) : 400;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
let failures = 0;
const ok = (l, d = "") => console.log(`  ok    ${l.padEnd(44)} ${d}`);
const fail = (l, d = "") => { console.log(`  FAIL  ${l.padEnd(44)} ${d}`); failures++; };

try {
  await joinAsGM(page);
  await page.evaluate(() => game.settings.set("core", "language", "es"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });

  const r = await page.evaluate(async () => {
    const flat = (obj, prefix = "", out = {}) => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix + k;
        if (v && typeof v === "object") flat(v, key + ".", out);
        else out[key] = v;
      }
      return out;
    };
    const served = flat(await (await fetch(`/systems/${game.system.id}/lang/es.json`)).json());
    const keys = Object.keys(served);
    const missing = [];
    for (const k of keys) {
      if (game.i18n.localize(k) !== served[k]) missing.push(k);
    }
    // Distinctness: at least half the served values must differ from the
    // localized ENGLISH value for their key — a file of en==es copies would
    // "load" perfectly while translating nothing. (Shared proper nouns and
    // identical short labels keep this a share, not an every-key rule.)
    const enFile = flat(await (await fetch(`/systems/${game.system.id}/lang/en.json`)).json());
    const differing = keys.filter((k) => k in enFile && served[k] !== enFile[k]).length;
    return { lang: game.i18n.lang, count: keys.length, missing: missing.slice(0, 8), missingCount: missing.length, differing };
  });

  r.lang === "es"
    ? ok("client speaks es", r.lang)
    : fail("client speaks es", `lang=${r.lang}`);
  r.count >= MIN_KEYS
    ? ok(`served es.json holds >= ${MIN_KEYS} keys`, `${r.count}`)
    : fail(`served es.json holds >= ${MIN_KEYS} keys`, `${r.count} — the artifact ships a gutted file`);
  r.missingCount === 0
    ? ok("every served key localizes to its own value", `${r.count} keys checked`)
    : fail("every served key localizes to its own value", `${r.missingCount} did not load: ${r.missing.join(", ")}`);
  r.differing > r.count / 2
    ? ok("the translations are actually Spanish", `${r.differing}/${r.count} differ from en`)
    : fail("the translations are actually Spanish", `only ${r.differing}/${r.count} differ from en — an en copy loaded`);
  errors.length === 0
    ? ok("zero console errors")
    : fail("zero console errors", errors.slice(0, 5).join(" | "));
} catch (e) {
  fail("probe threw", `${e.name}: ${e.message}`);
} finally {
  try { await page.evaluate(() => game.settings.set("core", "language", "en")); } catch {}
  await browser.close();
}
console.log(failures ? `\ni18n-load FAILED (${failures})\n` : "\ni18n-load probe passed\n");
process.exit(failures ? 1 : 0);

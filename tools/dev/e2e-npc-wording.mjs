#!/usr/bin/env node
/**
 * The NPC wording must never discard a translation that exists.
 *
 * `_wording(key)` prefers a `…Npc` variant on a non-player sheet, so a wolf is not
 * asked "Is your character deprived?". It resolved that with `game.i18n.has(npcKey)`
 * — whose `fallback` parameter DEFAULTS TO TRUE, so it also consults the English
 * strings (client/helpers/localization.mjs:390-396). Every `…Npc` variant exists in
 * en.json, so the test was unconditionally true in every language, and the NPC sheet
 * served English in place of a base key the translator had already done.
 *
 * A regression, not a gap: before the Hireling→NPC fold the hireling sheet used the
 * base keys, so these rendered in Spanish in 0.1.7 and in English after. And because
 * only SOME variants exist — there is no `PanickedTipNpc` — one dialog came out half
 * translated, tip in Spanish and question in English.
 *
 * Reproducing that needs a language that HAS the base key and LACKS the variant,
 * which an English world is not: `game.i18n.translations` holds every key, and
 * `_fallback` holds seven core tour strings and nothing of ours. So the probe builds
 * the situation instead — translations with the variants DELETED and a sentinel on
 * each base key, `_fallback` carrying the variants under a different sentinel.
 *
 * That makes each assertion name the code path that produced it:
 *
 *     ZZ-BASE…      the translated base string   -> fixed
 *     ZZ-FALLBACK…  the English variant          -> the bug
 *
 * Two sentinels rather than "is it not English", because a probe that only checks
 * for absence passes when nothing renders at all.
 *
 * Strings are nested by dot path (`translations.CAIRN.DeprivedConfirmNpc`), not
 * stored under a flat "CAIRN.X" key — indexing the flat form reads undefined and
 * makes the whole setup silently inert.
 *
 * Usage: npm run dev:npc-wording
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, dismissChrome, watchdog } from "./lib.mjs";

const S = {
  deprivedTip: "ZZ-BASE-tip-privado",
  deprivedConfirm: "ZZ-BASE-q-privado",
  panickedTip: "ZZ-BASE-tip-panico",
  panickedConfirm: "ZZ-BASE-q-panico",
  fbTip: "ZZ-FALLBACK-tip-deprived-npc",
  fbConfirm: "ZZ-FALLBACK-q-deprived-npc",
  fbPanicked: "ZZ-FALLBACK-q-panicked-npc",
  translatedNpc: "ZZ-NPCVARIANT-q-privado",
};

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };

const browser = await chromium.launch();
watchdog(240000, "npc wording probe");
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
await joinAsGM(page);
await dismissChrome(page);

let out = {};
try {
  out = await page.evaluate(async (S) => {
    const res = {};
    const g = foundry.utils.getProperty;
    for (const a of game.actors.filter((x) => x.name?.startsWith("ZZ Word"))) await a.delete();

    const origTranslations = game.i18n.translations;
    const origFallback = game.i18n._fallback;

    /** Stand up a language that has the base strings and not the variants. */
    const useLanguage = ({ withNpcVariant = false } = {}) => {
      const tr = foundry.utils.deepClone(origTranslations);
      tr.CAIRN.DeprivedTip = S.deprivedTip;
      tr.CAIRN.DeprivedConfirm = S.deprivedConfirm;
      tr.CAIRN.PanickedTip = S.panickedTip;
      tr.CAIRN.PanickedConfirm = S.panickedConfirm;
      // es.json's actual shape: not one `…Npc` variant translated.
      for (const k of ["DeprivedTipNpc", "DeprivedConfirmNpc", "PanickedConfirmNpc",
        "RestConfirmNpc", "RestoreConfirmNpc"]) delete tr.CAIRN[k];
      if (withNpcVariant) tr.CAIRN.DeprivedConfirmNpc = S.translatedNpc;
      game.i18n.translations = tr;
      // English, as the fallback a real translated world has behind it.
      game.i18n._fallback = { CAIRN: {
        DeprivedTipNpc: S.fbTip,
        DeprivedConfirmNpc: S.fbConfirm,
        PanickedConfirmNpc: S.fbPanicked,
      } };
    };

    const npc = await CONFIG.Actor.documentClass.create({ name: "ZZ Word NPC", type: "npc" });
    const pc = await CONFIG.Actor.documentClass.create({ name: "ZZ Word PC", type: "character" });

    /**
     * Open a confirmation and read it WITHOUT awaiting the call. `_confirmAction`
     * uses a modal DialogV2 whose promise settles only on a button press, so
     * awaiting it here would hang the evaluate and burn the whole timeout.
     */
    const readDialog = async (sheet, tipKey, questionKey) => {
      const p = sheet._confirmAction("CAIRN.Deprived", tipKey, questionKey);
      await new Promise((r) => setTimeout(r, 500));
      const el = [...document.querySelectorAll(".application.dialog")].pop();
      const text = el?.querySelector(".cairn-confirm")?.textContent ?? null;
      el?.querySelector('button[data-action="no"]')?.click();
      await p.catch(() => {});
      return text;
    };

    /* --- the regression itself --------------------------------------- */
    useLanguage();
    await npc.sheet.render(true);
    await new Promise((r) => setTimeout(r, 600));
    res.deprived = await readDialog(npc.sheet, "CAIRN.DeprivedTip", "CAIRN.DeprivedConfirm");
    res.panicked = await readDialog(npc.sheet, "CAIRN.PanickedTip", "CAIRN.PanickedConfirm");

    // The sheet's own tooltip, which used to hardcode the variant key.
    const root = document.getElementById(npc.sheet.id);
    res.npcTooltip = [...(root?.querySelectorAll("[data-tooltip]") ?? [])]
      .map((e) => e.getAttribute("data-tooltip"))
      .find((t) => t?.includes("ZZ-")) ?? null;

    /* --- a character is untouched ------------------------------------ */
    res.pcDeprived = await readDialog(pc.sheet, "CAIRN.DeprivedTip", "CAIRN.DeprivedConfirm");

    /* --- positive control: a translated variant still wins ----------- */
    useLanguage({ withNpcVariant: true });
    res.withVariant = await readDialog(npc.sheet, "CAIRN.DeprivedTip", "CAIRN.DeprivedConfirm");

    game.i18n.translations = origTranslations;
    game.i18n._fallback = origFallback;
    await npc.delete();
    await pc.delete();
    return res;
  }, S);
} finally {
  // Belt and braces from NODE: an exception inside the evaluate skips the in-page
  // restore, and a world left with a sentinel language is a wrecked dev world.
  await page.evaluate(() => {
    if (globalThis.game?.i18n) { delete game.i18n.translations; delete game.i18n._fallback; }
  }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
}

console.log("\na language with the base strings and no NPC variants");

const check = (label, text, want, notWant) => {
  if (text === null) return fail(`${label} — nothing rendered, so this proves nothing`);
  if (text.includes(notWant)) {
    return fail(`${label} — fell through to the English variant (${notWant}). `
      + "A translated base string was discarded.");
  }
  if (!text.includes(want)) return fail(`${label} — expected ${want}, got ${JSON.stringify(text)}`);
  ok(`${label} — used the translated base string`);
};

check("Deprived confirmation", out.deprived, S.deprivedConfirm, S.fbConfirm);
check("Panicked confirmation", out.panicked, S.panickedConfirm, S.fbPanicked);

// The half-translated dialog: tip and question must come from the same language.
if (out.panicked && out.panicked.includes(S.panickedTip) && out.panicked.includes(S.panickedConfirm)) {
  ok("the Panicked dialog is translated end to end, tip and question together");
} else if (out.panicked) {
  fail(`the Panicked dialog is mixed: ${JSON.stringify(out.panicked)}`);
}

if (out.npcTooltip === null) fail("no sentinel tooltip on the NPC sheet — the setup did not take");
else if (out.npcTooltip.includes(S.fbTip)) {
  fail("the NPC sheet's Deprived tooltip still resolves the English variant — "
    + "it is bypassing _wording (it used to hardcode CAIRN.DeprivedTipNpc)");
} else if (out.npcTooltip.includes(S.deprivedTip) || out.npcTooltip.includes(S.panickedTip)) {
  ok("the NPC sheet's tooltips resolve through the same rule as the dialogs");
} else fail(`unexpected tooltip: ${JSON.stringify(out.npcTooltip)}`);

check("a character sheet is unaffected", out.pcDeprived, S.deprivedConfirm, S.fbConfirm);

// Positive control. Without it every assertion above passes against a _wording that
// has been gutted to `return key` and never uses the NPC wording at all.
if (out.withVariant?.includes(S.translatedNpc)) {
  ok("positive control: a language that HAS the variant still gets the NPC wording");
} else {
  fail("positive control: a translated `…Npc` variant was NOT used — _wording no longer "
    + `prefers the NPC wording at all. Got ${JSON.stringify(out.withVariant)}`);
}

if (errors.length) { console.log(""); for (const e of errors) fail(`console error: ${e}`); }

console.log(`\n${failed ? "NPC WORDING PROBE FAILED" : "NPC wording probe passed."}`);
await browser.close();
process.exit(failed ? 1 : 0);

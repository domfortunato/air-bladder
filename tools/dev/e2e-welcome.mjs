#!/usr/bin/env node
/**
 * The welcome window (module/welcome.js; user ask 2026-11-19, modelled on Base
 * Knavery's).
 *
 *   node tools/dev/e2e-welcome.mjs   (needs Foundry, world launched, Alice seeded —
 *                                     npm run dev:players)
 *
 * Asserted, each from the Warden's or the player's own client:
 *   - with "Show each time a Game Master loads the world" ON, a Warden's reload
 *     opens the window by itself; with it OFF it does not (the setting is SET for
 *     each leg and the value read at the start restored, never a hardcoded one);
 *   - the setting is registered world, Boolean, default ON;
 *   - the window renders: the title, both portraits loaded, no raw CAIRN. key,
 *     the three System Rules lines, the three buy links on cairnrpg.com, the
 *     licence folds, the sheets' "For Use With Cairn" stamp in BOTH schemes
 *     (configureUI, never a write), and the Air Bladder logo beside it, swapped
 *     by theme; both opaque and at their own aspect;
 *   - "This world offers …" follows the three background switches;
 *   - the footer box writes the setting both ways;
 *   - Open the guide and Open the rulebook open the System Docs and Cairn 2e Rules
 *     compendiums;
 *   - the Settings sidebar button opens it;
 *   - a player is never shown it unasked, gets no footer box, and opens it from
 *     the sidebar.
 *
 * Fails with the feature removed: no window, no sidebar button, no setting.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, watchdog, withSettings } from "./lib.mjs";

const browser = await chromium.launch();
watchdog(900000, "dev:welcome");
const gm = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(gm);
let failed = false;
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? `  ${d}` : ""}`); failed = true; };
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? `  ${d}` : ""}`);
const check = (m, cond, d = "") => (cond ? ok(m) : fail(m, d));

const ID = "air-bladder-welcome";

/** Reload the Warden's page WITHOUT dismissChrome, and report whether the window opened by itself. */
const reloadAndLook = async () => {
  await gm.reload({ waitUntil: "networkidle" });
  await gm.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90000 });
  return gm.evaluate(async (id) => {
    for (let i = 0; i < 60 && !foundry.applications.instances.get(id)?.rendered; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return !!foundry.applications.instances.get(id)?.rendered;
  }, ID);
};

try {
  await joinAsGM(gm);

  await withSettings(gm, async () => {
    /* ---- registration ---------------------------------------------------- */
    const reg = await gm.evaluate(() => {
      const s = game.settings.settings.get("air-bladder.welcome-on-start");
      return s ? { scope: s.scope, type: s.type?.name, def: s.default, config: s.config } : null;
    });
    check("welcome-on-start is a world Boolean, default ON, off the flat list",
      reg?.scope === "world" && reg.type === "Boolean" && reg.def === true && reg.config === false, JSON.stringify(reg));

    /* ---- opens by itself at a Warden login, only while the box is ticked --- */
    await gm.evaluate(() => game.settings.set("air-bladder", "welcome-on-start", true));
    check("ticked: a Warden's reload opens the welcome window by itself", await reloadAndLook());

    /* ---- what it shows, in both schemes ---------------------------------- */
    const content = await gm.evaluate(async (id) => {
      const app = foundry.applications.instances.get(id);
      const el = app.element;
      const imgs = [...el.querySelectorAll(".ab-welcome-bookend img")];
      for (const img of imgs) { try { await img.decode(); } catch { /* reported below */ } }
      const uiCfg0 = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
      const logos = {};
      try {
        for (const s of ["light", "dark"]) {
          const cfg = foundry.utils.deepClone(uiCfg0);
          cfg.colorScheme = { applications: s, interface: s };
          game.configureUI(cfg);
          await new Promise((r) => setTimeout(r, 500));
          // The stamp: the sheets' own file, shown, decoded, fully opaque, and
          // drawn at the file's own aspect — a squashed mark is a cropped one
          // (logo/README.md).
          const vis = el.querySelector(".ab-welcome-stamp");
          if (vis) { try { await vis.decode(); } catch { /* naturalWidth 0 reports it */ } }
          const r = vis?.getBoundingClientRect();
          const shownSel = (sel) => { const e = el.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; };
          logos[s] = { shown: !!vis && getComputedStyle(vis).display !== "none",
            logoLight: shownSel(".ab-logo-light"), logoDark: shownSel(".ab-logo-dark"),
            logo: await (async () => {
              const lg = [...el.querySelectorAll(".ab-welcome-logo")].find((i) => getComputedStyle(i).display !== "none");
              if (!lg) return null;
              try { await lg.decode(); } catch { /* naturalWidth 0 reports it */ }
              const b = lg.getBoundingClientRect();
              return { natural: lg.naturalWidth, opacity: getComputedStyle(lg).opacity,
                aspectOff: lg.naturalWidth ? Math.abs(b.width / b.height - lg.naturalWidth / lg.naturalHeight) : null };
            })(),
            src: vis?.getAttribute("src") ?? null,
            ink: getComputedStyle(el.querySelector(".ab-welcome-title")).color,
            natural: vis?.naturalWidth ?? 0,
            opacity: vis ? getComputedStyle(vis).opacity : null,
            aspectOff: vis && vis.naturalWidth ? Math.abs(r.width / r.height - vis.naturalWidth / vis.naturalHeight) : null };
        }
      } finally {
        game.configureUI(game.settings.get("core", "uiConfig"));
      }
      return {
        title: el.querySelector(".ab-welcome-title")?.textContent.trim(),
        portraits: imgs.map((i) => i.naturalWidth),
        rawKeys: (el.textContent.match(/CAIRN\.\w+/g) ?? []),
        rules: el.querySelectorAll(".ab-welcome-rules li").length,
        buy: [...el.querySelectorAll(".ab-welcome-link")].map((a) => a.href),
        folds: el.querySelectorAll(".ab-welcome-fold").length,
        credits: el.querySelectorAll(".ab-welcome-art li").length,
        box: !!el.querySelector('input[name="welcome-on-start"]'),
        logos,
      };
    }, ID);
    check("the title is the system's", /Air Bladder/.test(content.title ?? ""), content.title);
    check("both portraits loaded", content.portraits.length === 2 && content.portraits.every((w) => w > 0), JSON.stringify(content.portraits));
    check("no raw language key on screen", content.rawKeys.length === 0, content.rawKeys.join(", "));
    check("three System Rules lines: Cairn 2e, Barebones, custom backgrounds", content.rules === 3, String(content.rules));
    check("three buy links, all on cairnrpg.com",
      content.buy.length === 3 && content.buy.every((h) => h.startsWith("https://cairnrpg.com/")), JSON.stringify(content.buy));
    check("four licence folds, the art fold listing its credits", content.folds === 4 && content.credits >= 6,
      `${content.folds} folds, ${content.credits} credits`);
    check("the Warden gets the footer box", content.box);
    check("light scheme: the black-lettered Air Bladder logo shows, the white one does not",
      content.logos.light?.logoLight === true && content.logos.light?.logoDark === false, JSON.stringify(content.logos.light));
    check("dark scheme: the white-lettered Air Bladder logo shows, the black one does not",
      content.logos.dark?.logoLight === false && content.logos.dark?.logoDark === true, JSON.stringify(content.logos.dark));
    for (const s of ["light", "dark"]) {
      const lg = content.logos[s]?.logo ?? {};
      check(`${s} scheme: the Air Bladder logo loaded, at full strength, at its own aspect`,
        lg.natural > 0 && lg.opacity === "1" && lg.aspectOff !== null && lg.aspectOff < 0.02, JSON.stringify(lg));
    }
    for (const s of ["light", "dark"]) {
      const l = content.logos[s] ?? {};
      check(`${s} scheme: the sheets' "For Use With Cairn" stamp shows, loaded, fully opaque, at its own aspect`,
        l.shown === true && /\/logo\/Cairn_Stamp\.jpg$/.test(l.src ?? "") && l.natural > 0
        && l.opacity === "1" && l.aspectOff !== null && l.aspectOff < 0.02, JSON.stringify(l));
    }
    check("the title's ink follows the scheme", content.logos.light?.ink !== content.logos.dark?.ink,
      `${content.logos.light?.ink} / ${content.logos.dark?.ink}`);

    /* ---- "This world offers …" follows the three switches ----------------- */
    const world = await gm.evaluate(async (id) => {
      const set = (k, v) => game.settings.set("air-bladder", k, v);
      const read = async () => {
        const app = foundry.applications.instances.get(id);
        await app.render({ force: true });
        return app.element.querySelector(".ab-welcome-world")?.textContent.trim();
      };
      await set("content-source-2e", true);
      await set("content-source-custom", true);
      await set("content-source-barebones", false);
      const a = await read();
      await set("content-source-barebones", true);
      await set("content-source-custom", false);
      await set("content-source-2e", false);
      const b = await read();
      return { a, b };
    }, ID);
    check("2e + custom on, Barebones off: the line names Cairn 2e and custom",
      /Cairn 2e/.test(world.a) && /custom/.test(world.a) && !/Barebones/.test(world.a), world.a);
    check("Barebones alone: the line names Cairn Barebones only",
      /Cairn Barebones/.test(world.b) && !/2e/.test(world.b) && !/custom/.test(world.b), world.b);

    /* ---- the footer box writes the setting -------------------------------- */
    const box = await gm.evaluate(async (id) => {
      const el = foundry.applications.instances.get(id).element;
      const input = el.querySelector('input[name="welcome-on-start"]');
      const wait = async (v) => {
        for (let i = 0; i < 40 && game.settings.get("air-bladder", "welcome-on-start") !== v; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return game.settings.get("air-bladder", "welcome-on-start");
      };
      input.click();
      const off = await wait(false);
      input.click();
      const on = await wait(true);
      return { off, on };
    }, ID);
    check("unticking the box turns the setting off", box.off === false, JSON.stringify(box));
    check("ticking it again turns it back on", box.on === true, JSON.stringify(box));

    /* ---- the guide and the rulebook ---------------------------------------- */
    const opens = await gm.evaluate(async (id) => {
      const el = foundry.applications.instances.get(id).element;
      const packOpen = async (name) => {
        const pack = game.packs.get(`air-bladder.${name}`);
        for (let i = 0; i < 40 && !pack.apps.some((a) => a.rendered); i++) await new Promise((r) => setTimeout(r, 100));
        const was = pack.apps.some((a) => a.rendered);
        for (const a of pack.apps) await a.close({ animate: false });
        return was;
      };
      el.querySelector('[data-action="openGuide"]')?.click();
      const guide = await packOpen("journals-docs");
      el.querySelector('[data-action="openRulebook"]')?.click();
      const rules = await packOpen("journals-2e");
      return { guide, rules };
    }, ID);
    check("Open the guide opens the System Docs compendium", opens.guide);
    check("Open the rulebook opens the Cairn 2e Rules compendium", opens.rules);

    /* ---- the Settings sidebar button --------------------------------------- */
    const side = await gm.evaluate(async (id) => {
      await foundry.applications.instances.get(id)?.close({ animate: false });
      ui.sidebar.changeTab("settings", "primary");
      await new Promise((r) => setTimeout(r, 400));
      const btn = document.querySelector("#settings [data-ab-welcome]");
      btn?.click();
      for (let i = 0; i < 40 && !foundry.applications.instances.get(id)?.rendered; i++) await new Promise((r) => setTimeout(r, 100));
      const opened = !!foundry.applications.instances.get(id)?.rendered;
      await foundry.applications.instances.get(id)?.close({ animate: false });
      return { button: !!btn, opened };
    }, ID);
    check("the Settings sidebar has a Welcome & credits button", side.button);
    check("...and it opens the welcome window", side.opened);

    /* ---- unticked: a Warden's reload does NOT open it ---------------------- */
    await gm.evaluate(() => game.settings.set("air-bladder", "welcome-on-start", false));
    check("unticked: a Warden's reload leaves it closed", !(await reloadAndLook()));
    // Ticked again, so the player leg below proves the PLAYER is spared, not the switch.
    await gm.evaluate(() => game.settings.set("air-bladder", "welcome-on-start", true));

    /* ---- a player ---------------------------------------------------------- */
    const alicePage = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
    const aliceErrors = watchErrors(alicePage);
    try {
      await joinAs(alicePage, "Alice");
      const p = await alicePage.evaluate(async (id) => {
        await new Promise((r) => setTimeout(r, 2500));
        const unasked = !!foundry.applications.instances.get(id)?.rendered;
        ui.sidebar.changeTab("settings", "primary");
        await new Promise((r) => setTimeout(r, 400));
        document.querySelector("#settings [data-ab-welcome]")?.click();
        for (let i = 0; i < 40 && !foundry.applications.instances.get(id)?.rendered; i++) await new Promise((r) => setTimeout(r, 100));
        const app = foundry.applications.instances.get(id);
        const out = { unasked, opened: !!app?.rendered, box: !!app?.element?.querySelector('input[name="welcome-on-start"]') };
        await app?.close({ animate: false });
        return out;
      }, ID);
      check("a player is not shown the welcome window unasked", p.unasked === false);
      check("a player opens it from the Settings sidebar", p.opened);
      check("a player gets no footer box", p.box === false);
      if (aliceErrors.length) fail("console errors on the player's client", aliceErrors.slice(0, 5).join(" | "));
    } finally {
      await alicePage.context().close();
    }
  });
} catch (e) {
  fail(`${e.name}: ${e.message}`);
} finally {
  if (errors.length) { console.error("\nconsole errors:"); errors.slice(0, 10).forEach((e) => console.error("  " + e)); failed = true; }
  await browser.close();
}
console.log(failed ? "\nWELCOME PROBE FAILED\n" : "\nwelcome probe passed\n");
process.exit(failed ? 1 : 0);

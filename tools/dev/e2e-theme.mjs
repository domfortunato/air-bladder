#!/usr/bin/env node
/**
 * Probe: do the sheets stay readable in BOTH of Foundry's colour schemes?
 *
 * Why this exists. ApplicationV1 force-tags every window `themed theme-light`
 * (client/appv1/api/application-v1.mjs:79-81), so an AppV1 sheet renders on
 * Foundry's light parchment no matter what the player picked. ApplicationV2 does
 * no such thing — a ported sheet inherits the scheme from <body>. So the port
 * silently hands us a dark mode the stylesheet was never written for.
 *
 *   node tools/dev/e2e-theme.mjs            (needs Foundry running)
 *   node tools/dev/e2e-theme.mjs --shots    (also write PNGs to tools/dev/out/)
 *
 * Two measurements that cost a wrong answer once each, so do not "simplify" them:
 *
 * 1. THE BACKDROP IS AN IMAGE IN LIGHT MODE. Foundry's light theme sets
 *    `--background: url(parchment.jpg)`; only in dark does it become a colour
 *    (rgba(11,10,19,.9)). Walking the ancestor chain for a background-COLOUR
 *    therefore falls through to <body>'s black and reports every dark-on-parchment
 *    label as 1.18:1 — in BOTH schemes, which is the tell. The probe samples the
 *    image's average pixel instead.
 * 2. AN AppV1 WINDOW KEEPS PARCHMENT EVEN WHEN TAGGED theme-dark. Its chrome is
 *    legacy CSS; only the CSS *variables* flip. So swapping the class on an AppV1
 *    sheet does NOT simulate the post-port state. To simulate it honestly the
 *    probe opens a real AppV2 sheet, reads the backdrop Foundry gives it, and
 *    paints that onto the AppV1 window. Anything derived rather than measured
 *    would drift the moment Foundry restyles.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors, watchdog, trackCreatedActors, sweepCreatedActors } from "./lib.mjs";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const WANT_SHOTS = process.argv.includes("--shots");
if (WANT_SHOTS) fs.mkdirSync(outDir, { recursive: true });

/**
 * Put the client in one colour scheme the way a Warden does — through core's
 * own `configureUI`, which is what `core.uiConfig`'s onChange calls.
 *
 * NOT `document.body.classList.add("theme-light")`, which is what every pass
 * here used to do and what let a real defect through. ONE setting sets TWO
 * themes and they land on DIFFERENT ELEMENTS (game.mjs:1852-1875): the
 * Applications theme on <body>, the INTERFACE theme on #interface and on each
 * open app. Interface chrome — the watch clock, the player list — resolves its
 * variables from #interface, the nearer ancestor, so flipping <body> alone
 * leaves that chrome in the scheme it already had.
 *
 * What that cost, measured 2026-09-13 on the live dev world: with <body> at
 * theme-light and #interface still theme-dark, the clock kept `#e7d1b1` text
 * and the light pass reported it CLEAN. Under a real light interface its text
 * is `#333` on a `rgba(11,10,19,0.75)` slab — about 1.2:1, unreadable, and
 * visible in a screenshot. The gate measured the dark clock twice and called
 * one of them light. The CSS fix is in the same commit.
 *
 * Nothing is WRITTEN: `configureUI` takes the config as an argument, so the
 * world's own stored setting is never touched and `restoreScheme` puts the
 * live client back to it.
 */
async function setScheme(page, scheme) {
  await page.evaluate((s) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
    cfg.colorScheme = { applications: s, interface: s };
    game.configureUI(cfg);
  }, scheme);
}

async function restoreScheme(page) {
  await page.evaluate(() => game.configureUI(game.settings.get("core", "uiConfig")));
}

/**
 * WCAG's 3:1 is the floor for large text and 4.5 for body text. We gate at 3.0
 * deliberately: the goal is "nobody is reading grey on grey", not AA compliance
 * for a fantasy character sheet. Under 3 is a defect; 3-4.5 is a judgement call
 * best made from --shots.
 */
const TEXT_MIN = 3.0;
/** A border below this against its backdrop is not visibly a border at all. */
const BORDER_MIN = 1.35;

const browser = await chromium.launch();
// The fleet's hang guard (review #34): without it a hang runs to the runner's
// 65-minute cap and skips every restore. A bound on a hang, not a timing claim.
watchdog(900000, "dev:theme");
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
const errors = watchErrors(page);
let failed = false;
const results = [];

try {
  await joinAsGM(page);
  await trackCreatedActors(page);

  await page.evaluate(async ([TEXT_MIN, BORDER_MIN]) => {
    const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (c) => 0.2126 * srgb(c.r / 255) + 0.7152 * srgb(c.g / 255) + 0.0722 * srgb(c.b / 255);
    const parse = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s || "");
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const css = (c) => `rgb(${[c.r, c.g, c.b].map(Math.round).join(",")})`;

    /** Average pixel of a background-image, cached. Foundry's parchment is a tiled
     *  near-uniform texture, so its mean is a fair stand-in for "what is behind". */
    const imgCache = new Map();
    const sampleImage = (url) => new Promise((resolve) => {
      if (imgCache.has(url)) return resolve(imgCache.get(url));
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = Math.min(img.naturalWidth, 64);
        cv.height = Math.min(img.naturalHeight, 64);
        const g = cv.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, cv.width, cv.height);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        let r = 0, gg = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
        const c = { r: r / n, g: gg / n, b: b / n, a: 1 };
        imgCache.set(url, c);
        resolve(c);
      };
      img.onerror = () => { imgCache.set(url, null); resolve(null); };
      img.src = url;
    });

    /** Warm the cache for every background-image inside `root`, so the audit
     *  itself can stay synchronous. */
    window.__abWarm = async (root) => {
      const urls = new Set();
      for (const n of [root, ...root.querySelectorAll("*")]) {
        for (let p = n; p; p = p.parentElement) {
          const m = /url\("?([^")]+)"?\)/.exec(getComputedStyle(p).backgroundImage);
          if (m) urls.add(m[1]);
        }
      }
      await Promise.all([...urls].map(sampleImage));
      return [...urls];
    };

    /** Effective opaque backdrop behind an element. */
    window.__abBackdrop = (el) => {
      const stack = [];
      let base = { r: 255, g: 255, b: 255, a: 1 };
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) {
          stack.push(c);
          if (c.a === 1) { base = c; stack.pop(); break; }
        }
        const m = /url\("?([^")]+)"?\)/.exec(cs.backgroundImage);
        const sampled = m && imgCache.get(m[1]);
        if (sampled) { base = sampled; break; }   // an image is an opaque stop
      }
      let acc = base;
      for (const c of stack.reverse()) acc = over(c, acc);
      return acc;
    };

    /** Inputs whose `value` is not rendered text — auditing them is noise. */
    const NON_TEXT = new Set(["checkbox", "radio", "hidden", "file", "color", "range", "image", "submit", "button"]);

    window.__abAudit = (rootSel) => {
      const root = document.querySelector(rootSel);
      if (!root) return { error: `no element for ${rootSel}` };
      const text = [], borders = [], seen = new Set();
      const label = (el) => {
        const cls = [...el.classList].filter((c) => !/^(active|flex\d|flexrow|flexcol)$/.test(c));
        return `${el.tagName.toLowerCase()}${cls.length ? "." + cls.slice(0, 3).join(".") : ""}`;
      };

      for (const el of root.querySelectorAll("*")) {
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;

        const bg = window.__abBackdrop(el);

        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3 && n.textContent.trim())
          .map((n) => n.textContent.trim()).join(" ");
        const typed = el.tagName === "INPUT" && !NON_TEXT.has(el.type)
          || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
        const content = own || (typed ? String(el.value ?? "").trim() : "");
        if (content) {
          const fg = parse(cs.color);
          if (fg && fg.a > 0) {
            const r = ratio(over(fg, bg), bg);
            const key = `t|${label(el)}|${cs.color}|${css(bg)}`;
            if (r < TEXT_MIN && !seen.has(key)) {
              seen.add(key);
              text.push({ el: label(el), sample: content.slice(0, 30), color: cs.color, bg: css(bg), ratio: +r.toFixed(2) });
            }
          }
        }

        for (const side of ["Top", "Right", "Bottom", "Left"]) {
          const w = parseFloat(cs[`border${side}Width`]);
          if (!w || cs[`border${side}Style`] === "none") continue;
          const bc = parse(cs[`border${side}Color`]);
          if (!bc || bc.a === 0) continue;
          // A border sits on the element's edge, so what it must show against is
          // the PARENT's backdrop, not the element's own background.
          const behind = el.parentElement ? window.__abBackdrop(el.parentElement) : bg;
          const r = ratio(over(bc, behind), behind);
          const key = `b|${label(el)}|${cs[`border${side}Color`]}|${css(behind)}`;
          if (r < BORDER_MIN && !seen.has(key)) {
            seen.add(key);
            borders.push({ el: label(el), side: side.toLowerCase(), color: cs[`border${side}Color`], bg: css(behind), ratio: +r.toFixed(2) });
          }
        }
      }
      return { text, borders };
    };
  }, [TEXT_MIN, BORDER_MIN]);

  /**
   * Measure what Foundry actually gives an ApplicationV2 sheet in each scheme, by
   * opening one. Used to simulate the post-port actor sheet — see the header note.
   *
   * The text colours are here for the same reason as the backdrop, and it is the
   * subtler trap of the two: `body.game .app` (foundry2.css:62-73) re-pins
   * `--color-text-primary` to the fixed `--color-text-dark-primary` (#191813) for
   * ApplicationV1 windows, overriding whatever the theme set. An AppV2 window is
   * `.application`, not `.app`, so it never sees that block. Simulate the port
   * without undoing it and every inherited label reports as unreadable — a wall
   * of findings that resolve themselves the moment the class is really gone.
   */
  const V2_VARS = ["--background", "--color-text-primary", "--color-text-emphatic",
    "--color-text-secondary", "--color-text-subtle", "--color-form-label",
    "--color-data-background", "--color-border"];
  const appv2Vars = await page.evaluate(async (names) => {
    const item = await Item.create({ name: "Theme Probe Frame", type: "object" });
    await item.sheet.render(true);
    for (let i = 0; i < 60 && !item.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
    const root = item.sheet.element;
    const out = {};
    for (const scheme of ["light", "dark"]) {
      const other = scheme === "dark" ? "light" : "dark";
      document.body.classList.remove(`theme-${other}`);
      document.body.classList.add("themed", `theme-${scheme}`);
      const cs = getComputedStyle(root);
      out[scheme] = Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
    }
    await item.sheet.close();
    await item.delete();
    return out;
  }, V2_VARS);

  const targets = await page.evaluate(async () => {
    const gen = game.cairn.characterGenerator;
    // A GENERATED character populates every tab; a blank actor hides most of the
    // surface behind empty lists and would prove nothing.
    const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter());
    const weapon = actor.items.find((i) => i.type === "weapon")
      ?? await Item.create({ name: "Theme Probe Blade", type: "weapon" });

    // The NPC sheet was never covered here, and it is not just the character sheet
    // in another skin: it owns the career/for-hire stack and a labelled Description
    // heading of its own. A GENERATED NPC is used because it arrives with gear,
    // a profession and a day rate; a description is added by hand, since nothing
    // generates one and it is drawn on this tab. (A feature was planted too,
    // until the Features UI went, 2026-08-09 — nothing draws one now.)
    const npc = await game.cairn.characterGenerator.createNpc();
    await npc.update({
      "system.description": "<p>Theme probe prose, so the Description tab is not blank.</p>",
    });

    // The BACKGROUND sheet, added 2026-08-15 with the .bg-tab-hint callout. It is
    // the only surface here that paints --ab-muted text on --ab-wash rather than
    // on the plain sheet surface, and a pairing no sheet in this list renders is a
    // pairing this gate cannot measure — which is the whole job. Its description
    // is planted so the tab is not blank, and it is EDITABLE (a world item), the
    // path that shows the hint at all.
    const bg = await Item.create({
      name: "Theme Probe Background", type: "background",
      system: { source: "2e", archetype: "Fighter",
        description: "<p>Theme probe prose, so the Description tab is not blank.</p>" },
    });

    const open = async (doc) => {
      await doc.sheet.render(true);
      const node = () => {
        const e = doc.sheet.element;
        return e instanceof HTMLElement ? e : e?.[0];
      };
      // AppV1's `element` is a jQuery object — truthy even when it wraps nothing —
      // so waiting on `element` alone exits instantly. Wait for a real node.
      for (let i = 0; i < 60 && !node(); i++) await new Promise((r) => setTimeout(r, 100));
      if (!node()) throw new Error(`sheet for ${doc.name} never rendered`);
      return { sel: `#${CSS.escape(node().id)}`, appv1: !!doc.sheet.element?.jquery, label: doc.sheet.constructor.name };
    };

    return {
      actorId: actor.id, npcId: npc.id, bgId: bg.id,
      weaponId: weapon.id, weaponOwned: !!weapon.parent,
      // `slug` is explicit because it names the screenshot file, and the class name
      // it used to be derived from is `CairnActorSheet` for BOTH actors — so adding
      // the NPC silently overwrote the character's image.
      sheets: [
        { ...(await open(actor)), what: `${actor.name} (character)`, slug: "character" },
        { ...(await open(npc)), what: `${npc.name} (npc)`, slug: "npc" },
        { ...(await open(weapon)), what: `${weapon.name} (weapon)`, slug: "weapon" },
        { ...(await open(bg)), what: `${bg.name} (background)`, slug: "background" },
      ],
    };
  });

  console.log(`\n${FOUNDRY_URL}`);
  for (const scheme of ["light", "dark"]) {
    const v = appv2Vars[scheme];
    console.log(`AppV2 ${scheme.padEnd(5)} backdrop ${v["--background"]}  text ${v["--color-text-primary"]}`);
  }
  console.log("");

  for (const sheet of targets.sheets) {
    for (const scheme of ["light", "dark"]) {
      const simulated = sheet.appv1 && scheme === "dark";
      await page.evaluate(([s, sel, sim, vars]) => {
        const other = s === "dark" ? "light" : "dark";
        document.body.classList.remove(`theme-${other}`);
        document.body.classList.add("themed", `theme-${s}`);
        const root = document.querySelector(sel);
        if (!root) return;
        // Simulating the port means undoing the three things AppV1 does that
        // AppV2 does not: force theme-light on itself (which is what lets the
        // scheme reach the sheet at all — our dark tokens are guarded on
        // :not(.theme-light)), keep parchment chrome under any theme, and re-pin
        // the text colours via `body.game .app`. All three are replaced with what
        // a real AppV2 window was MEASURED to get, in this same scheme.
        if (root.classList.contains("window-app")) {
          root.classList.remove("theme-light", "theme-dark");
          root.classList.add("themed", `theme-${s}`);
        }
        for (const [name, value] of Object.entries(vars)) {
          if (name === "--background") continue;
          if (sim) root.style.setProperty(name, value);
          else root.style.removeProperty(name);
        }
        // `body.game .app` (foundry2.css:62+) is a whole legacy compatibility
        // layer keyed on the AppV1 class, and it EVAPORATES on port — an AppV2
        // window is `.application`, never `.app`. Two of its rules reach into
        // sheet content and would otherwise dominate the findings:
        //   .app.window-app .window-content { color: var(--color-text-dark-primary) }
        //   .app img { border: 1px solid var(--color-border-dark) }
        // Both resolve through fixed-dark variables defined only inside that
        // block, so overriding --color-text-primary alone changes nothing.
        // Redirect the variables instead of the rules: surgical, and it leaves
        // anything the SYSTEM styles (e.g. .portrait's own border) untouched.
        if (sim) {
          root.style.setProperty("--color-text-dark-primary", vars["--color-text-primary"]);
          root.style.setProperty("--color-border-dark", "transparent");
        } else {
          root.style.removeProperty("--color-text-dark-primary");
          root.style.removeProperty("--color-border-dark");
        }
        const content = root.querySelector(".window-content");
        if (content) content.style.background = sim ? vars["--background"] : "";
      }, [scheme, sheet.sel, simulated, appv2Vars[scheme]]);
      await page.waitForTimeout(250);

      await page.evaluate((sel) => window.__abWarm(document.querySelector(sel)), sheet.sel);

      // Audit every tab: inactive panels are display:none and would be skipped.
      const tabs = await page.evaluate((sel) => {
        const root = document.querySelector(sel);
        return [...root.querySelectorAll("nav.tabs [data-tab], nav .item[data-tab]")].map((t) => t.dataset.tab);
      }, sheet.sel);

      const all = { text: [], borders: [] };
      for (const tab of tabs.length ? tabs : [null]) {
        if (tab) {
          await page.evaluate(([sel, t]) => {
            document.querySelector(sel)
              ?.querySelector(`nav.tabs [data-tab="${t}"], nav .item[data-tab="${t}"]`)?.click();
          }, [sheet.sel, tab]);
          await page.waitForTimeout(200);
        }
        const r = await page.evaluate((sel) => window.__abAudit(sel), sheet.sel);
        if (r.error) throw new Error(r.error);
        all.text.push(...r.text);
        all.borders.push(...r.borders);
      }
      const uniq = (rows, k) => [...new Map(rows.map((x) => [k(x), x])).values()];
      results.push({
        what: sheet.what, label: sheet.label, scheme, simulated,
        text: uniq(all.text, (x) => `${x.el}|${x.color}|${x.bg}`),
        borders: uniq(all.borders, (x) => `${x.el}|${x.side}|${x.color}|${x.bg}`),
      });

      if (WANT_SHOTS) {
        // Both sheets stay open for the whole run (re-rendering per scheme would
        // lose the tab state), so raise the one being shot or the other overlaps it.
        await page.evaluate((sel) => {
          const app = [...foundry.applications.instances.values(), ...Object.values(ui.windows ?? {})]
            .find((a) => `#${CSS.escape(a.element?.id ?? a.element?.[0]?.id ?? "")}` === sel);
          app?.bringToFront?.() ?? app?.bringToTop?.();
        }, sheet.sel);
        await page.waitForTimeout(150);
        await page.locator(sheet.sel).screenshot({ path: path.join(outDir, `theme-${sheet.slug}-${scheme}.png`) });
      }
    }
  }

  /* ---- the watch clock: Foundry's chrome, not a sheet -------------------- */
  //
  // The ONE surface here that is deliberately NOT painted from the --ab-*
  // palette. It sits in #ui-left-column-1 wearing core's `faded-ui`, and the
  // panel it has to match is a translucent dark slab in BOTH schemes — so it
  // reads core's chrome variables instead (docs/theming.md). That makes it
  // exactly the thing this gate exists for: an exception is only safe if
  // somebody measures it, and "invisible in light mode" is the failure it would
  // otherwise ship with.
  //
  // It has no tabs and is not a window, so it gets its own short pass rather
  // than joining the sheet loop.
  const clockPresent = await page.evaluate(() => !!document.getElementById("cairn-watch-clock"));
  if (!clockPresent) {
    console.error("  FAIL  the watch clock is not on screen — nothing to measure");
    process.exitCode = 1;
  } else {
    for (const scheme of ["light", "dark"]) {
      await setScheme(page, scheme);
      await page.waitForTimeout(250);
      await page.evaluate(() => window.__abWarm(document.getElementById("cairn-watch-clock")));
      const r = await page.evaluate(() => window.__abAudit("#cairn-watch-clock"));
      if (r.error) throw new Error(r.error);
      results.push({
        what: "the watch clock (Foundry chrome)", label: "WatchClock", scheme, simulated: false,
        strict: true, text: r.text, borders: r.borders,
      });
    }
  }

  /* ---- the clock again, in its VALD shape -------------------------------- */
  //
  // Four lines instead of two, a season glyph, and — the part that matters for
  // a colour gate — the inner element becomes a real <button>. Core paints a
  // button's ground, border and text in `@layer elements.forms`, an EARLIER
  // layer than the system's (review #34 finding 203: this said "a later
  // cascade layer", which is the belief the calendar's day-cell note records
  // being measured wrong). So cairn.css's plain `border: none; background:
  // none; color: inherit` already wins and needs no `!important`. What this
  // gate catches is that rule being lost or narrowed: without it the clock
  // renders as a chrome button sitting inside its own panel, a light-mode
  // failure by construction.
  //
  // The hack and the day's weather are both SHADOWED, never written: the
  // world's setting is nobody's business here and the weather is a record of
  // something that happened at somebody's table.
  await page.evaluate(async () => {
    const gt = await import("/systems/air-bladder/module/game-time.js");
    const settings = game.settings;
    window.__abRealGet2 = settings.get.bind(settings);
    window.__abPrevCal2 = [CONFIG.time.worldCalendarConfig, CONFIG.time.worldCalendarClass];
    settings.get = (ns, key, ...rest) => {
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(game.settings, ns, key, ...rest);   // review #34 finding 29
      if (ns !== "air-bladder") return window.__abRealGet2(ns, key, ...rest);
      if (key === "enable-vald-calendar") return true;
      if (key === "vald-weather-today") return { day: gt.dayCount(), text: "Thunderstorms" };
      return window.__abRealGet2(ns, key, ...rest);
    };
    CONFIG.time.worldCalendarConfig = gt.VALD_CALENDAR_CONFIG;
    CONFIG.time.worldCalendarClass = gt.ValdCalendar;
    game.time.initializeCalendar();
  });

  for (const scheme of ["light", "dark"]) {
    await setScheme(page, scheme);
    await page.evaluate(async () => {
      const wc = await import("/systems/air-bladder/module/watch-clock.js");
      await wc.refreshWatchClock();
    });
    await page.waitForTimeout(250);
    const lines = await page.evaluate(() => ({
      isButton: !!document.querySelector("#cairn-watch-clock button.cairn-watch-inner"),
      weather: !!document.querySelector("#cairn-watch-clock .cairn-watch-weather"),
    }));
    if (!lines.isButton || !lines.weather) {
      console.error(`  FAIL  the Vald clock did not render its button and fourth line (${scheme})`);
      process.exitCode = 1;
    }
    await page.evaluate(() => window.__abWarm(document.getElementById("cairn-watch-clock")));
    const r = await page.evaluate(() => window.__abAudit("#cairn-watch-clock"));
    if (r.error) throw new Error(r.error);
    results.push({
      what: "the watch clock, Vald shape (button, glyph, weather)", label: "WatchClockVald",
      scheme, simulated: false, strict: true, text: r.text, borders: r.borders,
    });
  }

  await page.evaluate(async () => {
    if (window.__abRealGet2) game.settings.get = window.__abRealGet2;
    if (window.__abPrevCal2) {
      [CONFIG.time.worldCalendarConfig, CONFIG.time.worldCalendarClass] = window.__abPrevCal2;
      game.time.initializeCalendar();
    }
    delete window.__abRealGet2;
    delete window.__abPrevCal2;
    const wc = await import("/systems/air-bladder/module/watch-clock.js");
    await wc.refreshWatchClock();
  });

  /* ---- the Vald calendar: a sheet, so the palette DOES apply ------------- */
  //
  // THE BOUNDARY, MEASURED. The clock above is chrome and reads core's
  // variables; the calendar is an ordinary framed application sitting on the
  // sheet ground, so it reads --ab-* throughout — including its five season
  // tints, which are the first colours here that paint a BACKGROUND a reader
  // has to see text through. That is exactly the shape that goes wrong in one
  // scheme only, so both are measured.
  //
  // Opened with the hack SHADOWED on, never written: the world's own setting
  // is nobody's business here and flipping it would require a reload.
  const calendarOpened = await page.evaluate(async () => {
    const gt = await import("/systems/air-bladder/module/game-time.js");
    const vc = await import("/systems/air-bladder/module/vald-calendar.js");
    const settings = game.settings;
    window.__abRealGet = settings.get.bind(settings);
    window.__abPrevCal = [CONFIG.time.worldCalendarConfig, CONFIG.time.worldCalendarClass];
    settings.get = (ns, key, ...rest) => rest[0]?.document
      ? foundry.helpers.ClientSettings.prototype.get.call(game.settings, ns, key, ...rest)   // review #34 finding 29
      : (ns === "air-bladder" && key === "enable-vald-calendar" ? true : window.__abRealGet(ns, key, ...rest));
    CONFIG.time.worldCalendarConfig = gt.VALD_CALENDAR_CONFIG;
    CONFIG.time.worldCalendarClass = gt.ValdCalendar;
    game.time.initializeCalendar();
    await vc.openValdCalendar();
    return !!document.getElementById("cairn-vald-calendar");
  });

  if (!calendarOpened) {
    console.error("  FAIL  the Vald calendar did not open — nothing to measure");
    process.exitCode = 1;
  } else {
    for (const scheme of ["light", "dark"]) {
      await setScheme(page, scheme);
      // RE-RENDER AFTER THE SWITCH, and this is not belt-and-braces. An element
      // that existed before the body's theme class changed keeps its RESOLVED
      // colours: `getComputedStyle(el).getPropertyValue("--ab-ink")` reports the
      // new light value while `color` still paints the old dark one, and setting
      // the custom property inline on that element changes nothing. Measured
      // 2026-09-10 — the calendar reported five light-mode findings that did not
      // exist, all of them the previous scheme's paint. A freshly created element
      // beside the stale one read correctly, which is what told the two apart.
      await page.evaluate(async () => {
        await foundry.applications.instances.get("cairn-vald-calendar")?.render();
      });
      await page.waitForTimeout(250);
      await page.evaluate(() => window.__abWarm(document.getElementById("cairn-vald-calendar")));
      const r = await page.evaluate(() => window.__abAudit("#cairn-vald-calendar"));
      if (r.error) throw new Error(r.error);
      results.push({
        what: "the Vald calendar", label: "ValdCalendar", scheme, simulated: false,
        text: r.text, borders: r.borders,
      });
    }
  }

  await page.evaluate(async () => {
    foundry.applications.instances.get("cairn-vald-calendar")?.close();
    if (window.__abRealGet) game.settings.get = window.__abRealGet;
    if (window.__abPrevCal) {
      [CONFIG.time.worldCalendarConfig, CONFIG.time.worldCalendarClass] = window.__abPrevCal;
      game.time.initializeCalendar();
    }
    delete window.__abRealGet;
    delete window.__abPrevCal;
  });

  await page.evaluate(async ([a, n, w, owned, b]) => {
    if (!owned) await game.items.get(w)?.delete();
    await game.items.get(b)?.delete();
    await game.actors.get(a)?.delete();
    await game.actors.get(n)?.delete();
  }, [targets.actorId, targets.npcId, targets.weaponId, targets.weaponOwned, targets.bgId]);

  // Put the client back on the world's own stored scheme. Nothing was written,
  // so this only tidies the live page before it closes.
  await restoreScheme(page);

  /**
   * Light is the shipping, accepted appearance, so it is the BASELINE: only a
   * finding that appears in dark and NOT in light fails the run. Without that,
   * the gate can never go green — Foundry's own chrome (a 1.24:1 button border
   * on parchment, the window header) flags in both schemes and is not ours to
   * fix. Light findings are still printed, as information.
   *
   * EXCEPT ON A `strict` SURFACE, and that exemption is what let a real defect
   * ship. The rule above was written for the AppV1→AppV2 sheet port, where a
   * ported window is full of core chrome nobody here can repaint. The watch
   * clock is not that: it is a panel we paint from the first pixel, with no
   * core element anywhere inside it, so a light-mode finding there is OURS.
   * Left on the baseline rule it printed the defect and passed the run —
   * `#333` text on a `rgba(11,10,19,0.75)` slab, about 1.2:1, reported as
   * "pre-existing (baseline, not a failure)". On a strict surface a finding in
   * EITHER scheme fails. Measured 2026-09-13.
   */
  const key = (x) => `${x.el}|${x.side ?? "text"}`;
  for (const r of results) {
    const base = results.find((o) => o.what === r.what && o.scheme === "light");
    const baseKeys = new Set([...base.text, ...base.borders].map(key));
    const isNew = (x) => r.scheme === "dark" && !baseKeys.has(key(x));
    const regressions = [...r.text, ...r.borders].filter(isNew).length;

    const tag = `${r.what} — ${r.scheme}${r.simulated ? " (SIMULATED: post-port state)" : ""}`;
    const n = r.text.length + r.borders.length;
    const hard = r.strict ? n : regressions;
    const mark = (x) => (r.strict ? "FAIL" : isNew(x) ? "NEW " : "    ");
    const verdict = r.strict
      ? (n ? `${n} finding(s) — STRICT surface, both schemes must be clean` : "clean")
      : r.scheme === "light"
        ? (n ? `${n} pre-existing (baseline, not a failure)` : "clean")
        : (regressions ? `${regressions} regression(s) vs light` : `clean${n ? ` (${n} shared with light)` : ""}`);
    console.log(`── ${tag}\n   ${verdict}`);
    for (const t of r.text) console.log(`   ${mark(t)}text   ${t.ratio.toFixed(2)}:1  ${t.el}  ${t.color} on ${t.bg}  "${t.sample}"`);
    for (const b of r.borders) console.log(`   ${mark(b)}border ${b.ratio.toFixed(2)}:1  ${b.el} ${b.side}  ${b.color} on ${b.bg}`);
    if (hard) failed = true;
    console.log("");
  }
  if (WANT_SHOTS) console.log(`screenshots: ${outDir}\n`);

  // THREE COLOURS THE SCHEME MUST NOT MOVE, or must (review #34 findings 98,
  // 99, 101), measured as computed values in DARK with LIGHT as the control:
  // - the shown-table chat card is parchment in both themes, so its range
  //   column and formula line keep the light ink (#4a4335) in dark;
  // - a locked background's Details headings are not core's 28px Signika;
  // - the overburdened-by-gold border is the palette's peril red, which has a
  //   dark value, not core's one fixed maroon.
  const probeColours = async () => page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    // (98) the card's markup, posted as chat content the way the Dashboard does.
    const msg = await ChatMessage.create({
      content: '<div class="cairn-shown-table"><div class="cairn-show-title">ZZ Theme Table</div>'
        + '<div class="cairn-show-formula">Rolled on 1d6</div>'
        + '<div class="cairn-show-row"><span class="cairn-show-range">1-2</span><span class="cairn-show-text">x</span></div></div>',
      whisper: [game.user.id],
    });
    for (let i = 0; i < 30 && !document.querySelector(`[data-message-id="${msg.id}"] .cairn-show-range`); i++) await sleep(150);
    const range = document.querySelector(`[data-message-id="${msg.id}"] .cairn-show-range`);
    out.range = range ? getComputedStyle(range).color : null;
    await msg.delete();
    // (188) the GLOG public cast card's spell name: a bare <h3> took core's
    // heading face, 28px, and --color-text-primary — cream on the parchment
    // tile in a dark scheme. Posted in its producer's markup.
    const cast = await ChatMessage.create({
      content: '<div class="grimoire-cast-card"><h3>ZZ Theme Spell</h3><div class="grimoire-cast-effect">x</div></div>',
      whisper: [game.user.id],
    });
    for (let i = 0; i < 30 && !document.querySelector(`[data-message-id="${cast.id}"] .grimoire-cast-card h3`); i++) await sleep(150);
    const castH3 = document.querySelector(`[data-message-id="${cast.id}"] .grimoire-cast-card h3`);
    out.castH3 = castH3 ? { color: getComputedStyle(castH3).color, size: getComputedStyle(castH3).fontSize } : null;
    await cast.delete();
    // (188) three dialog headings with no face of their own took core's h4 —
    // the heading face (Modesto) at 24px: the Test x10 report, the offer
    // picker's group headers, the Vald calendar's festival names. Mounted
    // briefly under the classes their rules expect, measured, removed.
    const mount = (html) => {
      const host = document.createElement("div");
      host.className = "application cairn";
      host.innerHTML = html;
      document.body.append(host);
      const h = host.querySelector("h4");
      const face = h ? getComputedStyle(h).fontFamily : null;
      host.remove();
      return face;
    };
    out.faces = {
      report: mount('<div class="bg-preview"><h4>ZZ</h4></div>'),
      offer: mount('<div class="cairn-offer-picker"><h4 class="cairn-offer-group">ZZ</h4></div>'),
      festival: mount('<div class="cairn-vald-calendar"><article class="cairn-calendar-festival"><h4>ZZ</h4></article></div>'),
    };
    // (99) a shipped background's read-only Details tab.
    const pack = game.packs.get("air-bladder.backgrounds-2e");
    const bg = pack ? (await pack.getDocuments())[0] : null;
    if (bg) {
      await bg.sheet.render(true);
      for (let i = 0; i < 30 && !bg.sheet.element?.querySelector(".background-details h3"); i++) await sleep(150);
      const h3 = bg.sheet.element?.querySelector(".background-details h3");
      out.bgH3 = h3 ? getComputedStyle(h3).fontSize : null;
      await bg.sheet.close();
    }
    // (101) the gold counter of an actor whose coins overburden it.
    const rich = await Actor.create({ name: "ZZ Theme Rich", type: "character", system: { gold: 5000 } });
    await rich.sheet.render(true);
    for (let i = 0; i < 30 && !rich.sheet.element?.querySelector(".overburdened-gold"); i++) await sleep(150);
    const gold = rich.sheet.element?.querySelector(".overburdened-gold");
    out.goldBorder = gold ? getComputedStyle(gold).borderTopColor : null;
    await rich.sheet.close();
    await rich.delete();
    return out;
  });
  await setScheme(page, "light");
  await page.waitForTimeout(500);
  const lightC = await probeColours();
  await setScheme(page, "dark");
  await page.waitForTimeout(500);
  const darkC = await probeColours();
  await restoreScheme(page);
  const verdict = (cond, label, detail) => {
    console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}  ${detail}`);
    if (!cond) failed = true;
  };
  verdict(lightC.range && darkC.range === lightC.range,
    "the shown-table chat card keeps its light ink in dark (the tile is parchment)", JSON.stringify({ lightC, darkC }));
  verdict(lightC.castH3 && darkC.castH3?.color === lightC.castH3.color && darkC.castH3.size !== "28px",
    "the GLOG cast card's spell name keeps the tile's ink in dark, and is not core's 28px (review #34 finding 188)",
    JSON.stringify({ light: lightC.castH3, dark: darkC.castH3 }));
  verdict(Object.values(lightC.faces ?? {}).every((f) => f && !/modesto/i.test(f)),
    "the Test x10 report, offer-picker and festival headings state their own face, not core's Modesto",
    JSON.stringify(lightC.faces));
  verdict(darkC.bgH3 && darkC.bgH3 !== "28px" && lightC.bgH3 !== "28px",
    "a locked background's Details headings are not core's 28px", JSON.stringify({ light: lightC.bgH3, dark: darkC.bgH3 }));
  verdict(darkC.goldBorder && darkC.goldBorder !== "rgb(117, 0, 3)" && lightC.goldBorder !== "rgb(117, 0, 3)",
    "the overburdened-gold border is the theme's peril red, not core's fixed maroon", JSON.stringify({ light: lightC.goldBorder, dark: darkC.goldBorder }));

  // A HOVERED BUTTON KEEPS ITS INK (review #34 finding 187). Core's hover is a
  // PAIR: `button:hover { background: var(--button-hover-background-color);
  // color: var(--button-hover-text-color) }` in @layer elements.forms, warm-2
  // ground under light-1 ink. A system rule that restates one half leaves
  // core's other half landing. Four buttons set `background: none` and no ink,
  // so core's near-white hover ink fell on parchment in the light scheme; the
  // notes pencil set its hover ink and kept core's orange hover ground. Each is
  // rendered FRESH in each scheme (a window keeps the paint it was rendered
  // under), hovered with the real mouse, and its ink, opacity included, read
  // against its actual backdrop at this probe's text floor. `hovered` is the
  // precondition: the pointer really is over it.
  const hoverInk = (sel) => page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    await window.__abWarm(el.closest(".application") ?? el);
    const parse = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s || "");
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (c) => 0.2126 * srgb(c.r / 255) + 0.7152 * srgb(c.g / 255) + 0.0722 * srgb(c.b / 255);
    const bg = window.__abBackdrop(el);
    const ink = parse(getComputedStyle(el).color);
    let a = ink.a;
    for (let n = el; n && !n.matches(".application"); n = n.parentElement) a *= Number(getComputedStyle(n).opacity);
    const fg = { r: ink.r * a + bg.r * (1 - a), g: ink.g * a + bg.g * (1 - a), b: ink.b * a + bg.b * (1 - a) };
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const hoverHost = el.closest("[data-ab-hover]");
    return { hovered: !!hoverHost?.matches(":hover"), ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
      ink: getComputedStyle(el).color, ground: getComputedStyle(hoverHost ?? el).backgroundColor };
  }, sel);
  const hoverPass = async (scheme) => {
    await setScheme(page, scheme);
    await page.waitForTimeout(300);
    const out = {};
    // Tag the first VISIBLE match, so a hidden tab's copy is never the one hovered.
    const hover = async (key, sel, inkChild = "") => {
      const tagged = await page.evaluate((sel) => {
        document.querySelectorAll("[data-ab-hover]").forEach((n) => n.removeAttribute("data-ab-hover"));
        const el = [...document.querySelectorAll(sel)].find((n) => n.getBoundingClientRect().width > 0);
        el?.setAttribute("data-ab-hover", "1");
        return !!el;
      }, sel);
      if (!tagged) { out[key] = null; return; }
      await page.mouse.move(1, 1);
      await page.hover('[data-ab-hover="1"]');
      await page.waitForTimeout(400);   // core transitions a button's colours
      out[key] = await hoverInk(`[data-ab-hover="1"]${inkChild ? ` ${inkChild}` : ""}`);
      await page.mouse.move(1, 1);
    };
    const sleep = (ms) => page.waitForTimeout(ms);

    await page.evaluate(async () => {
      foundry.applications.instances.get("cairn-warden-dashboard")?.close();
      const { openWardenDashboard } = await import("/systems/air-bladder/module/warden-dashboard.js");
      await openWardenDashboard();
      for (let i = 0; i < 40 && !document.querySelector("#cairn-warden-dashboard .cairn-show-btn"); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    await sleep(300);
    await hover("eye", "#cairn-warden-dashboard .cairn-dashboard-pair > .cairn-show-btn");
    await page.evaluate(() => foundry.applications.instances.get("cairn-warden-dashboard")?.close());

    const ids = await page.evaluate(async () => {
      // An NPC, not a character: a character's picker has no Game-Icons pane
      // (`gameIcons: type !== "character"`), and its notes tab wears the same pencil.
      const a = await CONFIG.Actor.documentClass.create({ name: "ZZ Theme Hover", type: "npc", system: { role: "npc" } });
      await a.sheet.render(true);
      for (let i = 0; i < 40 && !a.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 500));
      a.sheet.element.querySelector('.tabs .item[data-tab="notes"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
      return { actorId: a.id, sheetId: a.sheet.element.id };
    });
    await hover("pencil", `#${ids.sheetId} .tab[data-tab="notes"] prose-mirror.inactive > button.icon.toggle:enabled`);
    await page.evaluate(async (id) => {
      const a = game.actors.get(id);
      a.sheet._pickPortrait(new Event("click"));
      for (let i = 0; i < 40 && !document.querySelector(".cairn-portrait-tab"); i++) await new Promise((r) => setTimeout(r, 100));
    }, ids.actorId);
    await sleep(300);
    await hover("tab", ".cairn-portrait-tab:not(.active)");
    await page.evaluate(() => document.querySelector('.cairn-portrait-tab[data-tab="gameicons"]')?.click());
    await sleep(300);
    await hover("folder", '[data-pane="gameicons"] .cairn-icon-folder', "span");
    await page.evaluate(() => document.querySelector('[data-pane="gameicons"] .cairn-icon-folder[data-category="weapons"]')?.click());
    await sleep(300);
    await hover("back", '[data-pane="gameicons"] .cairn-icon-back');
    await page.evaluate(async (id) => {
      for (const app of [...foundry.applications.instances.values()]) {
        if (app.element?.querySelector(".cairn-portrait-gallery")) await app.close();
      }
      await game.actors.get(id)?.sheet.close();
      await game.actors.get(id)?.delete();
    }, ids.actorId);
    return out;
  };
  const hoverLight = await hoverPass("light");
  const hoverDark = await hoverPass("dark");
  await restoreScheme(page);
  for (const [key, label] of [["eye", "a Dashboard eye"], ["pencil", "the notes pencil"],
    ["tab", "an art picker tab"], ["folder", "an art picker folder tile"], ["back", "the art picker's Back"]]) {
    const pair = { light: hoverLight[key], dark: hoverDark[key] };
    verdict(["light", "dark"].every((s) => pair[s]?.hovered && pair[s].ratio >= TEXT_MIN),
      `${label} keeps readable ink under the pointer, both schemes (review #34 finding 187)`, JSON.stringify(pair));
  }

  // A RESTYLED CHECKBOX KEEPS CORE'S TWO STATES (review #34 finding 199). Core
  // draws a checkbox's keyboard-focus ring and its disabled look on the ::before
  // glyph (`:focus { outline: none }`, then `:focus-visible::before { outline }`;
  // `:disabled` recolours the glyphs and sets `cursor: inherit`), and the
  // sheets' six restyled boxes switch that ::before off. Every box on a
  // character's sheet (Description tab included) and a hireling's is focused
  // from the KEYBOARD, Shift+Tab then Tab, which is what makes :focus-visible
  // match (the precondition), and must show a ring that reads against its
  // backdrop; then it is disabled, as core's _toggleDisabled does on a sheet the
  // viewer cannot edit, and must stop looking and pointing live.
  const BOXES = ".deprived-check, .panicked-check, .for-hire-check, .omen-enable, .scar-enable, .scar-check";
  const boxPass = async (scheme) => {
    await setScheme(page, scheme);
    await page.waitForTimeout(300);
    const sheets = await page.evaluate(async () => {
      const Cls = CONFIG.Actor.documentClass;
      const out = [];
      for (const [type, tab] of [["character", "description"], ["hireling", null]]) {
        const a = await Cls.create({ name: `ZZ Theme Boxes ${type}`, type });
        await a.sheet.render(true);
        for (let i = 0; i < 40 && !a.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 500));
        if (tab) a.sheet.element.querySelector(`.tabs .item[data-tab="${tab}"]`)?.click();
        await new Promise((r) => setTimeout(r, 300));
        out.push({ actorId: a.id, sheetId: a.sheet.element.id });
      }
      return out;
    });
    const found = [];
    for (const { actorId, sheetId } of sheets) {
      const n = await page.evaluate(([sheetId, BOXES]) => {
        const boxes = [...document.querySelectorAll(`#${sheetId} :is(${BOXES})`)].filter((b) => b.getBoundingClientRect().width > 0);
        boxes.forEach((b, i) => b.setAttribute("data-ab-box", `${sheetId}-${i}`));
        return boxes.length;
      }, [sheetId, BOXES]);
      for (let i = 0; i < n; i++) {
        const sel = `[data-ab-box="${sheetId}-${i}"]`;
        await page.focus(sel);
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page.waitForTimeout(100);
        found.push(await page.evaluate(async (sel) => {
          const el = document.querySelector(sel);
          await window.__abWarm(el.closest(".application") ?? el);
          const parse = (s) => {
            const m = /rgba?\(([^)]+)\)/.exec(s || "");
            if (!m) return null;
            const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
            return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
          };
          const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          const lum = (c) => 0.2126 * srgb(c.r / 255) + 0.7152 * srgb(c.g / 255) + 0.0722 * srgb(c.b / 255);
          const cs = getComputedStyle(el);
          const ring = parse(cs.outlineColor);
          const bg = window.__abBackdrop(el.parentElement);
          const [hi, lo] = ring ? [lum(ring), lum(bg)].sort((x, y) => y - x) : [0, 0];
          const out = {
            box: el.className,
            focusVisible: el === document.activeElement && el.matches(":focus-visible"),
            ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1,
            ringRatio: ring ? Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 : 0,
          };
          el.blur();
          el.disabled = true;
          const ds = getComputedStyle(el);
          out.disabledCursor = ds.cursor;
          out.disabledOpacity = Number(ds.opacity);
          el.disabled = false;
          return out;
        }, sel));
      }
    }
    await page.evaluate(async (sheets) => {
      for (const { actorId } of sheets) {
        await game.actors.get(actorId)?.sheet.close();
        await game.actors.get(actorId)?.delete();
      }
    }, sheets);
    return found;
  };
  const boxesLight = await boxPass("light");
  const boxesDark = await boxPass("dark");
  await restoreScheme(page);
  const allBoxes = [...boxesLight, ...boxesDark];
  const kinds = new Set(allBoxes.map((b) => b.box));
  verdict(kinds.size >= 4 && allBoxes.every((b) => b.focusVisible && b.ring && b.ringRatio >= BORDER_MIN),
    "a restyled sheet checkbox shows a focus ring from the keyboard, both schemes (review #34 finding 199)",
    JSON.stringify({ kinds: [...kinds], light: boxesLight, dark: boxesDark }));
  verdict(allBoxes.length > 0 && allBoxes.every((b) => b.disabledCursor !== "pointer" && b.disabledOpacity < 1),
    "...and a disabled one no longer looks or points like a live one",
    JSON.stringify(allBoxes.map((b) => ({ box: b.box, cursor: b.disabledCursor, opacity: b.disabledOpacity }))));

  // THE FOR HIRE LABEL SPEAKS IN THE MUTED VOICE (review #34 finding 103). It
  // named `--ab-ink-muted`, a token defined nowhere, so its `inherit` fallback
  // always won and it drew in full ink beside the muted "Hired by…" label on
  // the same line. The muted colour is RESOLVED, not copied: a throwaway span
  // inside the sheet takes `var(--ab-muted)` and its computed colour is the
  // target. The label's parent ink is read too, and must differ from the
  // target — the precondition, or a label still on full ink would pass.
  const hirePass = async (scheme) => {
    await setScheme(page, scheme);
    await page.waitForTimeout(300);
    return page.evaluate(async () => {
      const a = await CONFIG.Actor.documentClass.create({ name: "ZZ Theme For Hire", type: "hireling" });
      try {
        await a.sheet.render(true);
        for (let i = 0; i < 40 && !a.sheet.element; i++) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 500));
        const label = a.sheet.element.querySelector(".for-hire-label");
        if (!label || label.getBoundingClientRect().width === 0) return { rendered: false };
        const probe = document.createElement("span");
        probe.style.color = "var(--ab-muted)";
        label.parentElement.append(probe);
        const muted = getComputedStyle(probe).color;
        probe.remove();
        return {
          rendered: true,
          label: getComputedStyle(label).color,
          muted,
          ink: getComputedStyle(label.parentElement).color,
        };
      } finally {
        await a.sheet.close();
        await a.delete();
      }
    });
  };
  const hire = { light: await hirePass("light"), dark: await hirePass("dark") };
  await restoreScheme(page);
  verdict(Object.values(hire).every((h) => h.rendered && h.muted !== h.ink && h.label === h.muted),
    "the For Hire label is the muted colour \"Hired by…\" uses, both schemes (review #34 finding 103)",
    JSON.stringify(hire));
} catch (e) {
  console.error(`  FAIL  ${e.name}: ${e.message}`);
  failed = true;
} finally {
  // Every actor this run created, generated children included (review #34
  // findings 150, 256, 259) — whatever a leg threw.
  await sweepCreatedActors(page);
  if (errors.length) {
    console.error("console errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "probe FAILED\n" : "probe passed\n");
process.exit(failed ? 1 : 0);

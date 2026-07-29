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
 *   node tools/dev/probe-theme.mjs            (needs Foundry running)
 *   node tools/dev/probe-theme.mjs --shots    (also write PNGs to tools/dev/out/)
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
import { FOUNDRY_URL, VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const WANT_SHOTS = process.argv.includes("--shots");
if (WANT_SHOTS) fs.mkdirSync(outDir, { recursive: true });

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
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();
const errors = watchErrors(page);
let failed = false;
const results = [];

try {
  await joinAsGM(page);

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
      actorId: actor.id,
      weaponId: weapon.id, weaponOwned: !!weapon.parent,
      sheets: [
        { ...(await open(actor)), what: `${actor.name} (character)` },
        { ...(await open(weapon)), what: `${weapon.name} (weapon)` },
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
        const slug = sheet.label.replace(/^Cairn|Sheet$/g, "").toLowerCase();
        await page.locator(sheet.sel).screenshot({ path: path.join(outDir, `theme-${slug}-${scheme}.png`) });
      }
    }
  }

  await page.evaluate(async ([a, w, owned]) => {
    if (!owned) await game.items.get(w)?.delete();
    await game.actors.get(a)?.delete();
  }, [targets.actorId, targets.weaponId, targets.weaponOwned]);

  /**
   * Light is the shipping, accepted appearance, so it is the BASELINE: only a
   * finding that appears in dark and NOT in light fails the run. Without that,
   * the gate can never go green — Foundry's own chrome (a 1.24:1 button border
   * on parchment, the window header) flags in both schemes and is not ours to
   * fix. Light findings are still printed, as information.
   */
  const key = (x) => `${x.el}|${x.side ?? "text"}`;
  for (const r of results) {
    const base = results.find((o) => o.what === r.what && o.scheme === "light");
    const baseKeys = new Set([...base.text, ...base.borders].map(key));
    const isNew = (x) => r.scheme === "dark" && !baseKeys.has(key(x));
    const regressions = [...r.text, ...r.borders].filter(isNew).length;

    const tag = `${r.what} — ${r.scheme}${r.simulated ? " (SIMULATED: post-port state)" : ""}`;
    const n = r.text.length + r.borders.length;
    const verdict = r.scheme === "light"
      ? (n ? `${n} pre-existing (baseline, not a failure)` : "clean")
      : (regressions ? `${regressions} regression(s) vs light` : `clean${n ? ` (${n} shared with light)` : ""}`);
    console.log(`── ${tag}\n   ${verdict}`);
    for (const t of r.text) console.log(`   ${isNew(t) ? "NEW " : "    "}text   ${t.ratio.toFixed(2)}:1  ${t.el}  ${t.color} on ${t.bg}  "${t.sample}"`);
    for (const b of r.borders) console.log(`   ${isNew(b) ? "NEW " : "    "}border ${b.ratio.toFixed(2)}:1  ${b.el} ${b.side}  ${b.color} on ${b.bg}`);
    if (regressions) failed = true;
    console.log("");
  }
  if (WANT_SHOTS) console.log(`screenshots: ${outDir}\n`);
} catch (e) {
  console.error(`  FAIL  ${e.name}: ${e.message}`);
  failed = true;
} finally {
  if (errors.length) {
    console.error("console errors:");
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    failed = true;
  }
  await browser.close();
}

console.log(failed ? "probe FAILED\n" : "probe passed\n");
process.exit(failed ? 1 : 0);

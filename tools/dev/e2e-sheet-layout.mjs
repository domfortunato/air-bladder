#!/usr/bin/env node
/**
 * Sheet layout e2e: the grid regions must never overlap, on any actor type.
 *
 * This exists because of a real regression, and it is the kind nothing else here
 * catches: the sheet renders, every field persists, zero console errors — and the
 * HP and Gold counters are drawn on top of STR and Armor, unreadable. A smoke
 * test cannot see it and a form-persistence test cannot see it.
 *
 * The mechanism is worth knowing, because it will recur whenever the layout is
 * retuned. `.charater-sheet-grid` row 1 used to be `minmax(140px, auto)`. When
 * the sheet ran short of height — a long background description above a tall tab
 * body — CSS grid shrank that track back toward its 140px MINIMUM rather than
 * letting the sheet grow, and the name section quietly spilled over the row below.
 * ApplicationV2 made it reachable by dropping AppV1's `overflow: hidden auto` and
 * halving `.window-content`'s padding, which is why it appeared at the port.
 *
 * The invariant asserted here is the one grid guarantees by construction, so it
 * holds however the rows are retuned: NO TWO DIRECT CHILDREN of a sheet grid may
 * have intersecting boxes. Plus: no region may overflow its own box vertically.
 *
 * Several characters are generated rather than one, because whether it fits
 * depends on how long that background's description happens to be — a single
 * sample passes on a two-line description and misses a three-line one.
 *
 *   npm run dev:sheet-layout
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors } from "./lib.mjs";

const SAMPLES = 6;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
let failures = 0;
const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(42)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(42)} ${detail}`); failures++; };

try {
  await joinAsGM(page);

  await page.evaluate(() => {
    /** Rectangles overlap if they intersect on both axes. 1px of tolerance for
     *  sub-pixel rounding, which grid produces routinely. */
    window.__abOverlap = (a, b) => {
      const t = 1;
      return a.left < b.right - t && b.left < a.right - t
        && a.top < b.bottom - t && b.top < a.bottom - t;
    };

    /**
     * Check one open sheet. Returns the overlapping pairs and the regions whose
     * own content is taller than their box.
     */
    window.__abLayout = (root) => {
      const grid = root.querySelector(".charater-sheet-grid, .container-sheet-grid");
      if (!grid) return { error: "no sheet grid" };
      const children = [...grid.children].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const name = (el) => `${el.tagName.toLowerCase()}.${[...el.classList][0] ?? "?"}`;

      const overlaps = [];
      for (let i = 0; i < children.length; i++) {
        for (let j = i + 1; j < children.length; j++) {
          const a = children[i].getBoundingClientRect();
          const b = children[j].getBoundingClientRect();
          if (window.__abOverlap(a, b)) {
            overlaps.push(`${name(children[i])} × ${name(children[j])}`);
          }
        }
      }

      // A region taller than its own box is the state that PRODUCES an overlap,
      // so catching it names the cause rather than the symptom.
      //
      // CHILDREN only. The grid itself is allowed — expected, even — to exceed the
      // window: a tall description over a tall tab body simply makes the sheet
      // longer than 750px, and .window-content scrolls. Flagging that too made
      // the probe fail on a perfectly good sheet that was 3px over.
      const spilling = [];
      for (const el of children) {
        if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflow === "visible") {
          spilling.push(`${name(el)} (${el.scrollHeight} in ${el.clientHeight})`);
        }
      }

      // ...which is only true while the window content can actually scroll. AppV2
      // defaults it to `overflow: hidden`, so if our override is ever lost the
      // sheet silently clips instead of scrolling, and the excess is unreachable.
      const content = root.querySelector(".window-content");
      const overflowY = content ? getComputedStyle(content).overflowY : "";
      const scrollable = ["auto", "scroll"].includes(overflowY);

      return { overlaps, spilling, scrollable, overflowY, count: children.length };
    };
  });

  /* ---- characters: several, because description length decides whether it fits ---- */

  console.log(`\ncharacter sheets (${SAMPLES} generated — description length varies)`);
  const results = await page.evaluate(async (n) => {
    const gen = game.cairn.characterGenerator;
    const out = [];
    for (let i = 0; i < n; i++) {
      const actor = await gen.createActorWithCharacter(await gen.generate2eCharacter());
      await actor.sheet.render(true);
      const node = () => {
        const e = actor.sheet.element;
        return e instanceof HTMLElement ? e : e?.[0];
      };
      for (let k = 0; k < 60 && !node(); k++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 400));
      const res = node() ? window.__abLayout(node()) : { error: "never rendered" };
      out.push({ name: actor.name, background: actor.system.background, ...res });
      await actor.sheet.close();
      await actor.delete();
    }
    return out;
  }, SAMPLES);

  for (const r of results) {
    const who = `${r.name} (${r.background})`;
    if (r.error) { fail(who, r.error); continue; }
    if (r.overlaps.length) fail(who, `regions overlap: ${r.overlaps.join(", ")}`);
    else if (r.spilling.length) fail(who, `region overflows its box: ${r.spilling.join(", ")}`);
    else if (!r.scrollable) fail(who, `.window-content cannot scroll (overflow-y: ${r.overflowY})`);
    else ok(who, `${r.count} regions, none overlapping`);
  }

  /* ---- the other three actor types, one each ---- */

  console.log("\nother actor types");
  const others = await page.evaluate(async () => {
    const out = [];
    for (const type of ["hireling", "npc", "container"]) {
      const actor = await Actor.create({ name: `ZZ Layout ${type}`, type });
      await actor.sheet.render(true);
      const node = () => {
        const e = actor.sheet.element;
        return e instanceof HTMLElement ? e : e?.[0];
      };
      for (let k = 0; k < 60 && !node(); k++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 400));
      out.push({ type, ...(node() ? window.__abLayout(node()) : { error: "never rendered" }) });
      await actor.sheet.close();
      await actor.delete();
    }
    return out;
  });

  for (const r of others) {
    if (r.error) { fail(r.type, r.error); continue; }
    if (r.overlaps.length) fail(r.type, `regions overlap: ${r.overlaps.join(", ")}`);
    else if (r.spilling.length) fail(r.type, `region overflows its box: ${r.spilling.join(", ")}`);
    else if (!r.scrollable) fail(r.type, `.window-content cannot scroll (overflow-y: ${r.overflowY})`);
    else ok(r.type, `${r.count} regions, none overlapping`);
  }
} catch (e) {
  fail("probe threw", `${e.name}: ${e.message}`);
} finally {
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nFAILED (${failures})\n` : "\nsheet layout probe passed\n");
process.exit(failures ? 1 : 0);

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
      const grid = root.querySelector(".charater-sheet-grid, .container-sheet-grid, .item-sheet-grid");
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

      // A counter whose children do not fill it leaves a visible empty box.
      // Overlap and spill checks are blind to this: the counter sits correctly in
      // the grid and nothing collides — the void is INSIDE it. The container
      // sheet's Type row shipped that way, its label taking 33px of text width
      // and its select 89px inside a 213px counter, because the row carried no
      // width modifier (`middle-counter`) and `large-resource-label` — which
      // looks like it sizes the label — is styled nowhere, in any of its 38 uses.
      // Widths come from the COUNTER class, never the label class.
      //
      // 12px of slack absorbs the ~3px of border/padding every counter carries.
      const underfilled = [];
      for (const c of root.querySelectorAll(".resource-counter")) {
        const cw = c.getBoundingClientRect().width;
        if (cw < 2) continue;                                  // hidden tab
        const kids = [...c.children].reduce((n, k) => n + k.getBoundingClientRect().width, 0);
        const gap = Math.round(cw - kids);
        if (gap > 12) underfilled.push(`${[...c.classList].join(".")} (${gap}px empty of ${Math.round(cw)})`);
      }

      // A counter label whose text does not FIT is worse than one that overflows,
      // because it neither overflows nor ellipsises — it wraps to a second line
      // that the counter's fixed 36px height hides, and the tail of the label just
      // is not there. "Available charges" rendered as "Available" this way, and a
      // screenshot review passed it twice. `scrollWidth` is no help (it equals
      // clientWidth once the text has wrapped); the tell is scrollHeight.
      //
      // This is a translation gate as much as a layout one: any language whose word
      // for a counter is longer than the English loses its label silently.
      const clippedLabels = [];
      for (const l of root.querySelectorAll(".resource-counter > label, .resource-counter > a")) {
        if (l.getBoundingClientRect().width < 2) continue;             // hidden tab
        if (l.scrollHeight > l.clientHeight + 1) {
          clippedLabels.push(`"${l.textContent.trim()}" (${l.scrollHeight}px of text in ${l.clientHeight}px)`);
        }
      }

      return { overlaps, spilling, scrollable, overflowY, count: children.length, underfilled, clippedLabels };
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
    else if (r.underfilled?.length) fail(who, `counter left part-empty: ${r.underfilled.join(", ")}`);
    else if (r.clippedLabels?.length) fail(who, `counter label does not fit: ${r.clippedLabels.join(", ")}`);
    else ok(who, `${r.count} regions, none overlapping`);
  }

  /* ---- the other three actor types, one each ---- */

  console.log("\nother actor types");
  const others = await page.evaluate(async () => {
    const out = [];
    // "inanimate" is a pseudo-type here: an npc with the stat block dropped —
    // a thing ROLE now, but the layout variant (and its CSS class) kept the
    // name. Never rendered by this probe before review #5, which is exactly how
    // the stranded-1fr defect shipped — the tab body auto-placed into the
    // `auto` track and sat 97px tall over ~400px of dead space, with zero
    // overlaps, zero spills and zero console errors.
    // No "container" TYPE: 1c3f5b2 retired it, and Actor.create has thrown
    // `"container" is not a valid type` here ever since — red from that commit
    // to 2026-08-01, because nothing ran this probe in between. Nothing is left
    // uncovered by dropping it: "inanimate" below IS the thing-role layout, an
    // npc with the stat block gone, which is what a container is now.
    for (const type of ["hireling", "npc", "inanimate"]) {
      const actor = await Actor.create(type === "inanimate"
        ? { name: "ZZ Layout inanimate", type: "npc", system: { role: "container", slots: 4 } }
        : { name: `ZZ Layout ${type}`, type });
      await actor.sheet.render(true);
      const node = () => {
        const e = actor.sheet.element;
        return e instanceof HTMLElement ? e : e?.[0];
      };
      for (let k = 0; k < 60 && !node(); k++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 400));
      const entry = { type, ...(node() ? window.__abLayout(node()) : { error: "never rendered" }) };
      // The NPC header specifically. Region-overlap cannot see this one: HP and
      // Gold are both inside the name section, so nothing "overlaps" — the defect
      // was which row each sat on. Both non-player types share this sheet, so both
      // are checked.
      if (["npc", "hireling"].includes(type) && node()) {
        const sec = node().querySelector(".character-sheet-section-name");
        const s = sec?.getBoundingClientRect();
        const box = (sel) => {
          const el = sec?.querySelector(sel);
          if (!el || !s) return null;
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top - s.top), bottom: Math.round(r.bottom - s.top) };
        };
        entry.npcHeader = {
          hp: box(".npc-vitals-line .hp-counter"),
          gold: box(".npc-vitals-line .gold-counter"),
          role: box(".profession-input"),
          sectionH: s ? Math.round(s.height) : null,
        };
        // The black label bar of Gold must end where Armor's does, directly below
        // it. Neither the overlap nor the underfilled check can see this: both
        // counters are correctly placed and completely filled — they just divide
        // themselves at different percentages, so the bars step in and out.
        // Measured 2026-07-29 with Gold on `middle-counter`: 485 vs 526.
        const root = node();
        const edge = (sel) => {
          const el = root.querySelector(sel);
          if (!el) return null;
          return Math.round(el.getBoundingClientRect().right - root.getBoundingClientRect().left);
        };
        entry.barEdges = {
          gold: edge(".npc-vitals-line .gold-counter > label"),
          armor: edge(".armor-counter > label"),
        };
        // The Description-tab section heading must wear the house face, pinned
        // ABSOLUTELY. Until the Features UI went (2026-08-09) this compared the
        // Features header against the description label — two headings, same
        // face — and the comparison form died with its second subject, but the
        // trap it guarded is intact: core's `body.game .app h1,...,h6` (the V1
        // compatibility layer) styles the TAG directly, so an <h3> that loses
        // `.cairn-section-label` silently renders 28px Signika, and no
        // comparison remains to catch it. Typography only, no geometry — so an
        // inactive tab still resolves it. Measured 2026-07-29.
        const face = (sel) => {
          const el = root.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const family = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
          return `${family} ${cs.fontSize} ${cs.fontWeight} ${cs.fontVariantCaps}`;
        };
        entry.headings = {
          description: face(".npc-description-label"),
        };
      }
      // The inanimate sheet must not strand the grid's 1fr: the tab section has
      // to END where the grid ends. Overlap/spill checks cannot see this one —
      // the void is BELOW every region, not inside or across any.
      if (type === "inanimate" && node()) {
        // Measure standing on the ITEMS tab. The stranded-1fr defect this
        // guards is a SHORT tab body sitting over a void, and Items is the
        // short body; since the 2026-08-01 reorder the sheet opens on
        // Description, whose taller content fills the track either way and
        // would mask the negative control's dead band.
        actor.sheet.changeTab("items", "primary");
        await new Promise((r) => setTimeout(r, 250));
        const root = node();
        const grid = root.querySelector(".charater-sheet-grid");
        const tabs = root.querySelector(".character-sheet-section-tabs");
        if (grid && tabs) {
          const g = grid.getBoundingClientRect();
          const t = tabs.getBoundingClientRect();
          entry.inanimateFill = { tabH: Math.round(t.height), dead: Math.round(g.bottom - t.bottom) };
          // In-page control: strip the modifier class and the dead band must
          // come back — proof the two-track override is what closes it.
          grid.classList.remove("inanimate-grid");
          const g2 = grid.getBoundingClientRect();
          const t2 = tabs.getBoundingClientRect();
          entry.inanimateFill.controlDead = Math.round(g2.bottom - t2.bottom);
          grid.classList.add("inanimate-grid");
        } else {
          entry.inanimateFill = null;
        }
      }
      out.push(entry);
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
    else if (r.underfilled?.length) fail(r.type, `counter left part-empty: ${r.underfilled.join(", ")}`);
    else if (r.clippedLabels?.length) fail(r.type, `counter label does not fit: ${r.clippedLabels.join(", ")}`);
    else ok(r.type, `${r.count} regions, none overlapping`);

    const h = r.npcHeader;
    if (h) {
      if (!h.hp || !h.gold || !h.role) fail(r.type, "npc header: HP/Gold/Role not all present in the name section");
      else if (h.hp.top !== h.gold.top) fail(r.type, `npc header: HP and Gold on different rows (HP top ${h.hp.top}, Gold top ${h.gold.top})`);
      else if (h.hp.top < h.role.bottom) fail(r.type, `npc header: HP (top ${h.hp.top}) rides up into the Role line (bottom ${h.role.bottom})`);
      else ok(r.type, `npc header: HP and Gold share the foot row (top ${h.hp.top}, below Role at ${h.role.bottom})`);
    }

    const b = r.barEdges;
    if (b) {
      if (b.gold === null || b.armor === null) fail(r.type, "npc header: Gold/Armor label bars not both found");
      else if (Math.abs(b.gold - b.armor) > 1) fail(r.type, `npc header: Gold label bar ends at ${b.gold}, Armor's at ${b.armor} — they must line up`);
      else ok(r.type, `npc header: Gold and Armor label bars line up (right edge ${b.gold})`);
    }

    const hd = r.headings;
    if (hd) {
      if (!hd.description) fail(r.type, "description tab: the Description heading was not found");
      else if (hd.description !== "Alegreya 17px 700 small-caps") fail(r.type, `description tab: the heading renders "${hd.description}" — expected the house face (Alegreya 17px 700 small-caps); core's h1..h6 tag rule has probably reached it`);
      else ok(r.type, `description tab: the Description heading wears the house face (${hd.description})`);
    }

    const f = r.inanimateFill;
    if (r.type === "inanimate") {
      if (!f) fail(r.type, "grid/tab section not found on the inanimate sheet");
      else if (f.dead > 4) fail(r.type, `tab body ends ${f.dead}px above the grid — the 1fr row is stranded (tab body ${f.tabH}px)`);
      else ok(r.type, `tab body fills the sheet (${f.tabH}px tall, ${f.dead}px below)`);
      if (f) {
        f.controlDead > 100
          ? ok(r.type, `negative control: without .inanimate-grid the 1fr strands (${f.controlDead}px dead)`)
          : fail(r.type, `negative control MISSED: stripping the class left only ${f.controlDead}px dead — the override is not what closes the gap`);
      }
    }
  }

  /* ---- item sheets, which own their own grid and their own counters ---------- */

  // Added because the defect that prompted this check was on an ITEM sheet: a relic's
  // "Available charges" label wrapped to a hidden second line and read "Available".
  // Both label states are exercised, since only the longer one failed — a plain item
  // (uses) and a relic with a recharge condition (charges).
  console.log("\nitem sheets");
  const items = await page.evaluate(async () => {
    const out = [];
    const cases = [
      ["item (uses)", { name: "ZZ Layout Item", type: "item" }],
      ["item (relic/charges)", { name: "ZZ Layout Relic", type: "item", system: { relic: true, recharge: "<p>x</p>" } }],
      ["weapon", { name: "ZZ Layout Weapon", type: "weapon" }],
      ["armor", { name: "ZZ Layout Armor", type: "armor" }],
      // Both faces of a spellbook: ticking `scroll` adds a counter ("Available
      // uses") that a book does not show, so the two states have different label
      // sets and only the scroll's can clip.
      ["spellbook (book)", { name: "ZZ Layout Book", type: "spellbook" }],
      ["spellbook (scroll)", { name: "ZZ Layout Scroll", type: "spellbook", system: { scroll: true } }],
      // The GLOG flag added a FIFTH counter to every spellbook (and a glog
      // scroll shows six). Five and six both need three counter rows, which is
      // why the old `.has-scroll-uses` conditional class is gone — one 5-row
      // template covers all four states, and the visibility check below is the
      // gate that catches a counter landing in an implicit row under the tabs.
      ["spellbook (glog)", { name: "ZZ Layout Glog", type: "spellbook", system: { glog: true } }],
      ["spellbook (glog scroll)", { name: "ZZ Layout GlogScroll", type: "spellbook", system: { glog: true, scroll: true } }],
      // Every remaining type, because the grid's row count is declared PER TYPE and
      // the visibility check below is what catches one counter too many. Covering
      // four of seven types is how the weapon sheet's Cost sat off-screen unnoticed.
      ["object", { name: "ZZ Layout Object", type: "object" }],
      ["transport", { name: "ZZ Layout Transport", type: "transport" }],
      ["background", { name: "ZZ Layout Background", type: "background" }],
    ];
    // The dev world plays in GLOG mode, whose create seam converts any plain
    // spellbook to a scroll at creation — the "(book)" and "(glog)" cases
    // would silently render (and PASS) as scrolls, never exercising the book
    // label sets this table exists to cover. Plant under a read-shadow
    // pinning GLOG off; the layout under test reads item flags, never the
    // setting, so the shadow changes nothing about what renders.
    const origGlogGet = game.settings.get;
    game.settings.get = function (scope, key, ...rest) {
      if (scope === game.system.id && key === "enable-glog-magic") return false;
      return origGlogGet.call(this, scope, key, ...rest);
    };
    try {
    for (const [label, data] of cases) {
      const item = await CONFIG.Item.documentClass.create(data);
      await item.sheet.render(true);
      const node = () => {
        const e = item.sheet.element;
        return e instanceof HTMLElement ? e : e?.[0];
      };
      for (let k = 0; k < 60 && !node(); k++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 400));
      const entry = { type: label, ...(node() ? window.__abLayout(node()) : { error: "never rendered" }) };
      // Every counter must actually be ON TOP at its own centre. This grid declares
      // a fixed row count per item type with the tabs section pinned to a numbered
      // row, so one counter too many auto-places into an implicit row BELOW the
      // tabs — off the bottom of the window, present in the DOM, and invisible to
      // both the region count and the clipped-label check. That is exactly how the
      // scroll's fifth counter shipped hidden for one commit.
      //
      // Hit-testing, not geometry: the section-portrait stretches across the whole
      // grid by design, so "does it intersect something" cannot distinguish this
      // from that. Counters only — they are the elements a Warden must be able to
      // read and click.
      const root = node();
      entry.hidden = root
        ? [...root.querySelectorAll(".resource-counter")].flatMap((c) => {
            const r = c.getBoundingClientRect();
            if (!r.width || !r.height) return [`${c.textContent.trim()} (zero-size)`];
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (c === hit || c.contains(hit)) return [];
            const label = c.querySelector("label")?.textContent.trim() ?? "(unlabelled)";
            return [`${label} covered by ${hit?.className || hit?.tagName || "nothing"}`];
          })
        : [];
      entry.counters = root ? root.querySelectorAll(".resource-counter").length : 0;
      out.push(entry);
      await item.sheet.close();
      await item.delete();
    }
    } finally {
      game.settings.get = origGlogGet;
    }
    return out;
  });

  // LABELS ONLY on item sheets — deliberately not the region-overlap invariant.
  //
  // That check is sound on an actor sheet, where every grid child has visible
  // content, and it is a false positive here: `.item-sheet-section-portrait` is a
  // grid child that STRETCHES to the full grid height (measured 746px on the weapon
  // and armor sheets) while the <img> inside it is 140px. So it does intersect the
  // tabs section, and nothing whatsoever is drawn in the overlap — confirmed by
  // screenshot, and tab clicks still work because the tabs paint later. Reporting
  // it would mean a permanently red gate over a non-defect, which is worse than no
  // gate. If the item grid is ever retuned so those sections carry real content,
  // this is the line to revisit.
  for (const r of items) {
    if (r.error) { fail(r.type, r.error); continue; }
    if (r.clippedLabels?.length) fail(r.type, `counter label does not fit: ${r.clippedLabels.join(", ")}`);
    else if (r.hidden?.length) fail(r.type, `counter present but not visible: ${r.hidden.join(", ")}`);
    else ok(r.type, `${r.count} regions, ${r.counters ?? "all"} counters visible, no clipped labels`);
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

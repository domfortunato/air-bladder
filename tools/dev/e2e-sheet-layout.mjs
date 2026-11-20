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
 * THE CHARACTER SHEET LEFT THE GRID on 2026-11-19 (a 480px sheet of pages
 * turned from a thumb-tab rail, after Base Knavery's): `__abCharacterLayout`
 * asserts the same invariant on its page 1, region by region, plus the
 * horizontal twin the narrow sheet needs, plus that the rail hangs outside the
 * frame, on screen and pressable. Every other actor sheet followed it on
 * 2026-11-20 (the same page 1, the same check, each role's own REQUIRED
 * regions); the item sheets keep their grids and `__abLayout`.
 *
 *   npm run dev:sheet-layout
 */

import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, watchErrors, watchdog, trackCreatedActors, sweepCreatedActors } from "./lib.mjs";

const SAMPLES = 6;

const browser = await chromium.launch();

// The fleet's hang guard (review #34 finding 25): without it a hang runs to

// the runner's 65-minute cap, skips every restore, and the box is never

// marked suspect. A bound on a hang, not a timing claim.

watchdog(600000, "sheet-layout probe", () => browser.close());
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = watchErrors(page);
let failures = 0;
const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(42)} ${detail}`);
const fail = (label, detail = "") => { console.log(`  FAIL  ${label.padEnd(42)} ${detail}`); failures++; };

try {
  await joinAsGM(page);
  await trackCreatedActors(page);

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

    /**
     * The CHARACTER sheet, since 2026-11-19. It has no `.charater-sheet-grid`
     * any more: five pages turned from a thumb-tab rail hung outside the frame
     * (laid out after Base Knavery's), page 1 a head (portrait | name and
     * background) over a body (abilities + the Gold/Deprived/Panicked band |
     * the vitals column). The mechanism this probe was written for has the
     * same shape there — a head grown by a long background description, a
     * fixed-row name grid (`.cairn-identity`'s 46px / 24px / auto) spilling
     * over what follows — so the SAME invariant is asserted, one level at a
     * time: no two visible direct children of any page-1 region intersect,
     * and no region's content is taller than its box. Narrowing the window to
     * 480px added the horizontal twin, which the 600px header grid never
     * needed: no region's content is WIDER than its box either.
     *
     * Page 1 must be the page standing: an inactive page is display:none and
     * every region on it is 0x0, which the visibility filter would drop — a
     * sheet on the wrong page would report zero regions and zero overlaps.
     * So every region named in REQUIRED must be present and drawn, or the
     * sheet fails as `missing`.
     */
    window.__abCharacterLayout = (root, required) => {
      const page1 = root.querySelector('.tab[data-tab="character"]');
      if (!page1) return { error: "no Character page (.tab[data-tab=character])" };
      const name = (el) => `${el.tagName.toLowerCase()}.${[...el.classList].filter((c) => c !== "resource-counter")[0] ?? "?"}`;
      const drawn = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const REQUIRED = required ?? [".cairn-head", ".portrait-wrap", ".cairn-identity", ".cairn-body",
        ".cairn-left", ".cairn-abilities", ".STR-ability", ".DEX-ability", ".WIL-ability",
        ".cairn-band", ".band-gold", ".cairn-vitals", ".cairn-shield", ".hp-counter",
        ".cairn-states", ".band-deprived", ".cairn-slots-line", ".cairn-vital-buttons", ".identity-bio-line"];
      const missing = REQUIRED.filter((sel) => {
        const el = page1.querySelector(sel);
        return !el || !drawn(el);
      });

      // Each region whose visible direct children must not meet. The frame-level
      // pair (banners | pages) first, then down page 1.
      const parents = [
        root.querySelector(".cairn-character"),
        page1,
        ...page1.querySelectorAll(".cairn-head, .cairn-identity, .cairn-body, .cairn-left, "
          + ".cairn-abilities, .cairn-ability, .cairn-band, .cairn-vitals, .cairn-states, .cairn-vital-buttons, .identity-bio-line, "
          + ".cairn-thing-body"),
      ].filter(Boolean);

      const overlaps = [];
      const spilling = [];
      const regions = new Set();
      for (const parent of parents) {
        const kids = [...parent.children].filter(drawn);
        kids.forEach((k) => regions.add(k));
        for (let i = 0; i < kids.length; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            if (window.__abOverlap(kids[i].getBoundingClientRect(), kids[j].getBoundingClientRect())) {
              overlaps.push(`${name(parent)}: ${name(kids[i])} × ${name(kids[j])}`);
            }
          }
        }
      }
      // A region whose content outgrows its box is the state that PRODUCES an
      // overlap, so it names the cause. Vertically as before; horizontally for
      // the narrow sheet. `.cairn-shield` is exempt from the horizontal half
      // only: its Armor-reset button is placed to hang off the shield's right
      // edge on purpose (right: -20px), which is overflow by design and stays
      // inside the vitals column — and that column IS checked.
      for (const el of regions) {
        const cs = getComputedStyle(el);
        if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY === "visible") {
          spilling.push(`${name(el)} (${el.scrollHeight} in ${el.clientHeight} tall)`);
        }
        if (!el.matches(".cairn-shield") && el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible") {
          spilling.push(`${name(el)} (${el.scrollWidth} in ${el.clientWidth} wide)`);
        }
      }

      const content = root.querySelector(".window-content");
      const overflowY = content ? getComputedStyle(content).overflowY : "";
      const scrollable = ["auto", "scroll"].includes(overflowY);

      // The underfilled-counter check, on the one `.resource-counter` page 1
      // still draws (HP; the ability and Armor counters became circles and a
      // shield). Same 12px of slack as the generic check.
      const underfilled = [];
      for (const c of page1.querySelectorAll(".resource-counter")) {
        const cw = c.getBoundingClientRect().width;
        if (cw < 2) continue;
        const kids = [...c.children].reduce((n, k) => n + k.getBoundingClientRect().width, 0);
        const gap = Math.round(cw - kids);
        if (gap > 12) underfilled.push(`${[...c.classList].join(".")} (${gap}px empty of ${Math.round(cw)})`);
      }

      // The clipped-label gate, carried to page 1's fixed-size boxes: the HP
      // counter's label as before, the three buttons (34px tall — a label
      // wrapped to two lines loses its second), the shield's label and the
      // band's labels, and each ability's die-and-name link. A label that wraps
      // inside an auto-height box just grows it, and reads scrollHeight ===
      // clientHeight, so this only ever flags a line that is really hidden.
      const clippedLabels = [];
      for (const l of page1.querySelectorAll(".resource-counter > label, .resource-counter > a, "
        + ".cairn-vital-buttons > button, .cairn-shield > label, .cairn-band .band-label, .cairn-states .band-label, .identity-bio-line label, "
        + ".cairn-ability-name-line > a.resource-roll")) {
        if (l.getBoundingClientRect().width < 2) continue;
        if (l.scrollHeight > l.clientHeight + 1) {
          clippedLabels.push(`"${l.textContent.trim()}" (${l.scrollHeight}px of text in ${l.clientHeight}px)`);
        }
      }

      // The rail hangs OUTSIDE the frame (module/actor/tab-rail.js): it must
      // not lie over the sheet's own content, it must be on screen (it flips to
      // the left edge rather than run off the right), and each page button
      // must be the thing under its own centre — a rail drawn under the frame
      // or another window is a rail no one can press.
      const rail = root.querySelector(":scope > .window-content > nav.cairn-tab-rail");
      const railCheck = { present: !!rail };
      if (rail) {
        const rb = rail.getBoundingClientRect();
        const fb = root.getBoundingClientRect();
        railCheck.side = root.classList.contains("cairn-rail-left") ? "left" : "right";
        railCheck.overFrame = window.__abOverlap(rb, fb);
        railCheck.onScreen = rb.left >= 0 && rb.top >= 0 && rb.right <= window.innerWidth && rb.bottom <= window.innerHeight;
        railCheck.buttons = rail.querySelectorAll("button[data-tab]").length;
        railCheck.covered = [...rail.querySelectorAll("button")].flatMap((b) => {
          const r = b.getBoundingClientRect();
          if (!r.width || !r.height) return [`${b.dataset.tab ?? b.className} (zero-size)`];
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return b === hit || b.contains(hit) ? [] : [`${b.dataset.tab ?? b.className} under ${hit?.className || hit?.tagName || "nothing"}`];
        });
      }

      return { overlaps, spilling, scrollable, overflowY, count: regions.size, underfilled, clippedLabels,
        missing, rail: railCheck, page1Active: page1.classList.contains("active") };
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
      // The character's own check (2026-11-19): its sheet has no grid for
      // __abLayout to find, and asserting that function's "no sheet grid"
      // against it would be a red with nothing wrong behind it.
      const res = node() ? window.__abCharacterLayout(node()) : { error: "never rendered" };
      out.push({ name: actor.name, background: actor.system.background, ...res });
      await actor.sheet.close();
      await actor.delete();
    }
    return out;
  }, SAMPLES);

  for (const r of results) {
    const who = `${r.name} (${r.background})`;
    if (r.error) { fail(who, r.error); continue; }
    // Precondition first: page 1 standing and every region drawn. Without it
    // the checks below run over an empty set and pass.
    if (!r.page1Active || r.missing?.length) fail(who, `page 1 not standing or regions not drawn (active=${r.page1Active}; missing: ${r.missing?.join(", ") || "none"})`);
    else if (r.overlaps.length) fail(who, `regions overlap: ${r.overlaps.join(", ")}`);
    else if (r.spilling.length) fail(who, `region overflows its box: ${r.spilling.join(", ")}`);
    else if (!r.scrollable) fail(who, `.window-content cannot scroll (overflow-y: ${r.overflowY})`);
    else if (r.underfilled?.length) fail(who, `counter left part-empty: ${r.underfilled.join(", ")}`);
    else if (r.clippedLabels?.length) fail(who, `label does not fit: ${r.clippedLabels.join(", ")}`);
    else ok(who, `${r.count} page-1 regions, none overlapping or overflowing`);

    // The rail, on its own line: a separate failure from page 1's layout.
    const rl = r.rail ?? {};
    if (!rl.present) fail(who, "no thumb-tab rail on the character sheet");
    else if (rl.buttons < 2) fail(who, `the rail holds ${rl.buttons} page button(s)`);
    else if (rl.overFrame) fail(who, `the rail lies over the sheet (hung ${rl.side}) — it must hang outside the frame`);
    else if (!rl.onScreen) fail(who, `the rail runs off the screen (hung ${rl.side})`);
    else if (rl.covered?.length) fail(who, `a rail button is not on top: ${rl.covered.join(", ")}`);
    else ok(who, `rail: ${rl.buttons} pages, hung ${rl.side} outside the frame, on screen, every button on top`);
  }

  /* ---- every other actor sheet, one per role (2026-11-20) ---- */

  // Every actor sheet is in the character sheet's format since 2026-11-20
  // (user ask): the same page 1 and the same check, `__abCharacterLayout`,
  // with each role's REQUIRED regions. A creature draws the character's stat
  // block without the identity's Pronouns / Age line (a person npc keeps
  // those on Description) and, for a companion, without the Gold band (no
  // purse); a thing draws its head, its slot line and its prose. Each actor
  // carries the TALLEST head its role can: a hireling for hire with a career
  // and a day rate, an npc with a background and a faction, a monster with a
  // faction — the head is where the npc sheet is taller than the character's,
  // and page 1 must still fit with the footer inside the 700px window. (The
  // old npc grid's checks — HP / Gold on one foot row, the Gold and Armor
  // label bars lining up, the thing grid's stranded 1fr — went with the grid
  // they measured.)
  console.log("\nother actor sheets, one per role");
  const CREATURE = [".cairn-head", ".portrait-wrap", ".cairn-identity", ".cairn-body",
    ".cairn-left", ".cairn-abilities", ".STR-ability", ".DEX-ability", ".WIL-ability",
    ".cairn-vitals", ".cairn-shield", ".hp-counter", ".cairn-states", ".band-deprived",
    ".cairn-slots-line", ".cairn-vital-buttons", ".role-line"];
  const others = await page.evaluate(async ({ CREATURE }) => {
    const out = [];
    const cases = [
      ["hireling", { system: { role: "hireling", profession: "Mercenary", forHire: true, dayRate: 30 } },
        [...CREATURE, ".cairn-band", ".band-gold", ".connection-line", ".day-rate-line"]],
      ["npc", { system: { role: "npc", background: "Cutpurse", faction: "The Gilded Hand" } },
        [...CREATURE, ".cairn-band", ".band-gold", ".faction-line"]],
      ["monster", { system: { role: "monster", faction: "The Wood" } },
        [...CREATURE, ".cairn-band", ".band-gold", ".faction-line"]],
      ["companion", { system: { role: "companion" } }, CREATURE],
      ["container", { system: { role: "container", slots: 4 } },
        [".cairn-head", ".portrait-wrap", ".cairn-identity", ".role-line", ".cairn-thing-body", ".cairn-slots-line", ".npc-description-section"]],
      ["transport", { system: { role: "transport" } },
        [".cairn-head", ".portrait-wrap", ".cairn-identity", ".role-line", ".cairn-thing-body", ".cairn-slots-line", ".npc-description-section"]],
    ];
    for (const [type, data, required] of cases) {
      const actor = await Actor.create({ name: `ZZ Layout ${type}`, type: "npc", ...data });
      await actor.sheet.render(true);
      const node = () => {
        const e = actor.sheet.element;
        return e instanceof HTMLElement ? e : e?.[0];
      };
      for (let k = 0; k < 60 && !node(); k++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 400));
      const entry = { type, ...(node() ? window.__abCharacterLayout(node(), required) : { error: "never rendered" }) };
      if (node()) {
        // Page 1 fits: the footer wholly inside the window, unscrolled.
        const wc = node().querySelector(".window-content");
        const foot = node().querySelector(".cairn-compat-footer");
        const wb = wc?.getBoundingClientRect(), fb = foot?.getBoundingClientRect();
        entry.footInside = !!wb && !!fb && fb.height > 0 && fb.bottom <= wb.bottom + 0.5 && fb.top >= wb.top;
        entry.scroll = wc ? [wc.scrollHeight, wc.clientHeight] : null;
      }
      out.push(entry);
      await actor.sheet.close();
      await actor.delete();
    }
    return out;
  }, { CREATURE });

  for (const r of others) {
    if (r.error) { fail(r.type, r.error); continue; }
    if (!r.page1Active || r.missing?.length) fail(r.type, `page 1 not standing or regions not drawn (active=${r.page1Active}; missing: ${r.missing?.join(", ") || "none"})`);
    else if (r.overlaps.length) fail(r.type, `regions overlap: ${r.overlaps.join(", ")}`);
    else if (r.spilling.length) fail(r.type, `region overflows its box: ${r.spilling.join(", ")}`);
    else if (!r.scrollable) fail(r.type, `.window-content cannot scroll (overflow-y: ${r.overflowY})`);
    else if (r.underfilled?.length) fail(r.type, `counter left part-empty: ${r.underfilled.join(", ")}`);
    else if (r.clippedLabels?.length) fail(r.type, `label does not fit: ${r.clippedLabels.join(", ")}`);
    else ok(r.type, `${r.count} page-1 regions, none overlapping or overflowing`);
    r.footInside
      ? ok(r.type, `page 1 fits, the footer inside the window (${r.scroll?.join(" in ")})`)
      : fail(r.type, `the footer is not wholly inside the window on page 1 (content ${r.scroll?.join(" in ")})`);
    const rl = r.rail ?? {};
    if (!rl.present) fail(r.type, "no thumb-tab rail");
    else if (rl.overFrame) fail(r.type, `the rail lies over the sheet (hung ${rl.side})`);
    else if (!rl.onScreen) fail(r.type, `the rail runs off the screen (hung ${rl.side})`);
    else if (rl.covered?.length) fail(r.type, `a rail button is not on top: ${rl.covered.join(", ")}`);
    else ok(r.type, `rail: ${rl.buttons} pages, hung ${rl.side} outside the frame, on screen, every button on top`);
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
      // A DOCUMENT request is never shadowed (review #27): core's #setWorld asks
      // get(ns, key, {document: true}) for the Setting document it updates by id,
      // and any value handed back makes it CREATE a duplicate. check:probes gates this.
      if (rest[0]?.document) return foundry.helpers.ClientSettings.prototype.get.call(this, scope, key, ...rest);
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
  // Every actor this run created, generated children included (review #34
  // findings 150, 256, 259) — whatever a leg threw.
  await sweepCreatedActors(page);
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  if (errors.length) failures++;
  await browser.close();
}

console.log(failures ? `\nFAILED (${failures})\n` : "\nsheet layout probe passed\n");
process.exit(failures ? 1 : 0);

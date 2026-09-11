#!/usr/bin/env node
/**
 * The Warden's Dashboard opens, rolls, and keeps core's table card.
 *
 *   npm run dev:warden-dashboard     (needs Foundry running, world launched)
 *
 * THE ASSERTION THAT BITES is leg 3, and it is the reason this file exists.
 * A dashboard is easy to write as "post my own pretty card", and that version
 * passes every obvious test: a card appears, it names the table, it says what
 * was rolled. What it silently destroys is `module/encounters.js` — the
 * Add-to-scene button reads `flags.core.RollTable` and the message's roll,
 * which ONLY core's `RollTable#toMessage` stamps, and it hangs itself inside
 * `.table-draw`, which only core's card markup has. Nothing errors. Nine
 * encounter and event tables just quietly stop offering to place their
 * monsters, and nobody notices until a session.
 *
 * So: leg 3 asserts the card is core's, leg 4 asserts the button really
 * attaches to it, and leg 6 asserts the ONE card we do build for ourselves is
 * not core's — because if a combined draw ever started carrying
 * `flags.core.RollTable` it would offer to spawn a monster off an NPC's quirk.
 *
 * Leg 5 asserts the speaker POSITIVELY (it IS the table's name). The obvious
 * negative — "the speaker is not the Warden's assigned character" — stayed
 * green with the fix reverted the last time this trap was probed, because
 * `getSpeaker()` had resolved to some other controlled token.
 *
 * Creates chat messages and one actor, and deletes exactly the ids it added.
 */
import { chromium } from "playwright";
import { VIEWPORT, joinAsGM, joinAs, watchErrors, dismissChrome } from "./lib.mjs";

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
const errors = watchErrors(page);
let failed = false;
const fail = (m, d = "") => { console.error(`  FAIL  ${m}${d ? `  ${d}` : ""}`); failed = true; };
const ok = (m, d = "") => console.log(`  ok    ${m}${d ? `  ${d}` : ""}`);
const note = (m) => console.log(`  note  ${m}`);

try {
  await joinAsGM(page);
  await dismissChrome(page);

  // Everything this probe creates is deleted at the end by ID DIFFERENCE, so
  // a world with its own messages and actors is never swept.
  const before = await page.evaluate(() => ({
    messages: game.messages.contents.map((m) => m.id),
    actors: game.actors.contents.map((a) => a.id),
    journals: game.journal.contents.map((j) => j.id),
  }));

  /* ---- the precondition, ESTABLISHED rather than inherited -------------- */

  // THIS PROBE IS ABOUT THE DASHBOARD A DEFAULT WORLD SHOWS, so it shadows the
  // Vald hack OFF for its whole run — the setting AND the calendar, because a
  // world that switched the hack on installed the Vald calendar at `init` and
  // shadowing the setting alone leaves every season name unrecognised, which
  // hides Today's Weather and reds the count for a reason that has nothing to
  // do with this window.
  //
  // Learned the expensive way on 2026-09-10, when five legs of `dev:vald-time`
  // went red because somebody had switched the hack on in the dev world to
  // look at the clock. `dev:vald-time` owns both states of this; here there is
  // exactly one.
  await page.evaluate(() => {
    const settings = game.settings;
    window.__abRealGet = settings.get.bind(settings);
    window.__abPrevCalendar = [CONFIG.time.worldCalendarConfig, CONFIG.time.worldCalendarClass];
    settings.get = (ns, key, ...rest) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? false : window.__abRealGet(ns, key, ...rest));
    // `earthCalendarConfig` IS core's Simplified Gregorian and nothing here
    // ever touches it, so it is the one handle on core's own calendar that
    // survives a world which already installed Vald.
    CONFIG.time.worldCalendarConfig = CONFIG.time.earthCalendarConfig;
    CONFIG.time.worldCalendarClass = CONFIG.time.earthCalendarClass;
    game.time.initializeCalendar();
  });

  /* ---- 1. the control, and the window ---------------------------------- */

  const opened = await page.evaluate(async () => {
    const btn = document.querySelector('button.tool[data-tool="abWardenDashboard"]');
    const out = { control: !!btn };
    if (btn) btn.click();
    for (let i = 0; i < 40 && !document.querySelector("#cairn-warden-dashboard"); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const app = document.querySelector("#cairn-warden-dashboard");
    out.rendered = !!app;
    if (app) {
      out.tabs = [...app.querySelectorAll('.tabs [data-action="tab"]')].map((a) => a.dataset.tab);
      // `rollWeather` counts: Today's Weather IS a table button — it posts
      // core's card through the same helper — it simply also stores what it
      // rolled and forces the card public. Counting only `rollTable` would
      // have quietly dropped it out of both this count and the pair
      // invariant below, which is the half that would have gone unnoticed.
      out.buttons = app.querySelectorAll(
        'button[data-action="rollTable"], button[data-action="rollWeather"]').length;
      out.sets = app.querySelectorAll('button[data-action="rollSet"]').length;
      out.creates = app.querySelectorAll('button[data-action="generate"]').length;
      out.damage = app.querySelectorAll('button[data-action="wardenDamage"]').length;
      out.isForm = app.tagName === "FORM" || !!app.querySelector("form");
      // Every button must be type=button: the application element IS a form,
      // so a submit button would submit the window instead of rolling.
      out.notButtons = [...app.querySelectorAll("button")].filter((b) => b.type !== "button").length;
    }
    return out;
  });

  opened.control ? ok("the Token controls carry the dashboard tool")
    : fail("the Token controls carry the dashboard tool", "no button.tool[data-tool=abWardenDashboard]");
  opened.rendered ? ok("clicking it opens the window") : fail("clicking it opens the window");
  opened.tabs?.length === 6
    ? ok("six tabs", opened.tabs.join(", "))
    : fail("six tabs", JSON.stringify(opened.tabs));
  // 41 shipped tables, plus Today's Weather in the time band, plus however many
  // the world has of its own. The Vald weather four are NOT counted: they ship
  // unconditionally but their buttons are gated on the hack, which is off in a
  // default world — `dev:vald-time` owns both halves of that.
  opened.buttons >= 42
    ? ok("every shipped table has a button", `${opened.buttons} table buttons`)
    : fail("every shipped table has a button", `only ${opened.buttons}`);
  opened.sets === 4 ? ok("four combined draws") : fail("four combined draws", String(opened.sets));
  opened.creates === 4 ? ok("four generator buttons") : fail("four generator buttons", String(opened.creates));
  opened.damage === 1 ? ok("the damage tool is on the window too") : fail("the damage tool is on the window too");
  opened.notButtons === 0
    ? ok("every button is type=button, so none submits the form")
    : fail("every button is type=button", `${opened.notButtons} would submit`);

  /* ---- 1a. the shape of a tab, after the readability pass -------------- */

  const tabShape = await page.evaluate(async () => {
    const el = document.querySelector("#cairn-warden-dashboard");
    const band = el.querySelector(".cairn-dashboard-time");
    // MEASURED AGAINST THE NEXT THING DOWN, not against the tab strip. The
    // visibility row now sits between the two, so a band-to-tabs measurement
    // would be dominated by that row's height and would stay green with the
    // spacing this leg exists to guard removed.
    const below = el.querySelector(".cairn-dashboard-visibility");
    // Every combined draw shares its tab's FIRST grid now: the heading it used
    // to sit under is gone by ruling, and a set button loose on the page would
    // read as belonging to whatever was above it.
    const sets = [...el.querySelectorAll('button[data-action="rollSet"]')];
    el.querySelector('[data-action="tab"][data-tab="people"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const peopleTab = el.querySelector('.tab[data-tab="people"]');
    return {
      setsInFirstGrid: sets.filter((b) => {
        const tab = b.closest(".tab");
        return tab && b.closest(".cairn-dashboard-grid") === tab.querySelector(".cairn-dashboard-grid");
      }).length,
      setsTooltipped: sets.filter((b) => b.dataset.tooltip).length,
      // The retired heading, by its TEXT: the key is gone from lang/en.json, so
      // a leftover `{{localize}}` would render the key itself.
      headText: [...el.querySelectorAll(".cairn-dashboard-head")].map((h) => h.textContent.trim()),
      createHints: peopleTab.querySelectorAll("p.hint").length,
      createHintText: peopleTab.querySelector("p.hint")?.textContent.trim() ?? "",
      // The gap the band was asked for, measured rather than assumed.
      gap: Math.round(below.getBoundingClientRect().top - band.getBoundingClientRect().bottom),
    };
  });

  tabShape.setsInFirstGrid === 4 && tabShape.setsTooltipped === 4
    ? ok("every combined draw sits in its tab's first grid, and says what it does")
    : fail("the combined draws are not in the first grid", JSON.stringify(tabShape));

  // BOTH HALVES. "No heading says Roll the lot" is also true of a window that
  // has lost its headings altogether, so the Create headings have to still be
  // there for the absence to mean anything.
  !tabShape.headText.some((h) => /lot|Combined/i.test(h))
    && tabShape.headText.filter((h) => /create/i.test(h)).length === 3
    ? ok('...and no heading says "Roll the lot"', tabShape.headText.join(" / "))
    : fail("a heading still says Roll the lot", JSON.stringify(tabShape.headText));

  tabShape.createHints === 1 && /linked to their tokens/.test(tabShape.createHintText)
    ? ok("the People tab explains what Create makes", tabShape.createHintText)
    : fail("the People tab's Create hint is missing", JSON.stringify(tabShape));

  tabShape.gap >= 14
    ? ok("...and the clock band is set off from what follows it", `${tabShape.gap}px`)
    : fail("the clock band crowds the rest of the window", `${tabShape.gap}px`);

  /* ---- 2. a table button rolls ----------------------------------------- */

  const drew = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const btn = app.querySelector('button[data-action="rollTable"][data-table="Warden: NPC - Quirk"]');
    if (!btn) return { clicked: false };
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 40 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    const m = game.messages.contents.at(-1);
    return {
      clicked: true,
      id: m?.id,
      tableFlag: foundry.utils.getProperty(m?.flags ?? {}, "core.RollTable") ?? null,
      rolls: m?.rolls?.length ?? 0,
      alias: m?.speaker?.alias ?? null,
      // The BUTTON'S label, not the table's browse name: a card headed
      // "Warden: NPC - Quirk" puts the internal naming convention in front of
      // the table. Read from the rendered button so the probe cannot drift
      // from the window it is testing.
      wantedAlias: app.querySelector('button[data-action="rollTable"][data-table="Warden: NPC - Quirk"]')
        ?.textContent.trim() ?? null,
    };
  });

  drew.clicked ? ok("a table button is wired") : fail("a table button is wired", "no Quirk button found");

  /* ---- 3. THE RULE: it is core's card ---------------------------------- */

  drew.tableFlag && drew.rolls === 1
    ? ok("the card is CORE'S — it carries flags.core.RollTable and its roll", drew.tableFlag)
    : fail("the card is CORE'S — it carries flags.core.RollTable and its roll",
      JSON.stringify({ flag: drew.tableFlag, rolls: drew.rolls }));

  const markup = await page.evaluate((id) => {
    const el = document.querySelector(`.chat-message[data-message-id="${id}"]`);
    return { found: !!el, tableDraw: !!el?.querySelector(".table-draw") };
  }, drew.id);
  markup.tableDraw
    ? ok("...and it renders core's .table-draw block, which the button hangs on")
    : fail("...and it renders core's .table-draw block", JSON.stringify(markup));

  /* ---- 4. the encounter button really attaches ------------------------- */

  // 5 of the Dungeon table's 6 rows are spawnable, so ten draws missing every
  // one of them is a 1-in-60-million event, not a flake. If this ever reds,
  // the injection is broken, not unlucky.
  const spawn = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    app.querySelector('[data-action="tab"][data-tab="encounters"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="rollTable"][data-table="Warden: Encounters - Dungeon"]');
    if (!btn) return { found: false };
    for (let attempt = 0; attempt < 10; attempt++) {
      const had = game.messages.size;
      btn.click();
      for (let i = 0; i < 40 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
      const m = game.messages.contents.at(-1);
      // The button is injected on render, so give the card a beat to paint.
      await new Promise((r) => setTimeout(r, 300));
      const el = document.querySelector(`.chat-message[data-message-id="${m.id}"]`);
      if (el?.querySelector(".encounter-spawn")) return { found: true, attempt: attempt + 1 };
    }
    return { found: false, attempt: 10 };
  });
  spawn.found
    ? ok("an encounter card still grows its Add-to-scene button", `after ${spawn.attempt} draw(s)`)
    : fail("an encounter card still grows its Add-to-scene button", "ten draws, no button");

  /* ---- 5. the speaker is the TABLE, asserted positively ---------------- */

  drew.alias && drew.alias === drew.wantedAlias
    ? ok("the card speaks as the table, not the Warden's character", drew.alias)
    : fail("the card speaks as the table", JSON.stringify({ got: drew.alias, want: drew.wantedAlias }));

  /* ---- 6. a combined draw is OURS, and is not core's ------------------- */

  const set = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    app.querySelector('[data-action="tab"][data-tab="people"]').click();
    await new Promise((r) => setTimeout(r, 200));
    // BY KEY, not "the first rollSet button": querySelector searches the whole
    // application, not the visible tab, so the bare selector found Travel's
    // Complete Path — three tables — and this leg redded on a correct system.
    const btn = app.querySelector('button[data-action="rollSet"][data-key="CAIRN.Dashboard.Set.CompleteNpc"]');
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 80 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    const made = game.messages.size - had;
    const m = game.messages.contents.at(-1);
    return {
      made,
      tableFlag: foundry.utils.getProperty(m?.flags ?? {}, "core.RollTable") ?? null,
      rows: (m?.content.match(/cairn-set-row/g) ?? []).length,
      hasScript: /<script|onerror=|javascript:/i.test(m?.content ?? ""),
      // The Complete Path bug, reported the day it shipped: the travel tables
      // carry <strong>, and escaping the drawn value posted a card reading
      // "&lt;strong&gt;Trails&lt;/strong&gt;" as literal text. Assert no
      // escaped tag survives anywhere in the card, and that real markup does.
      escapedTags: /&lt;\/?[a-z]/i.test(m?.content ?? ""),
      rendersMarkup: /<(strong|em)>/i.test(m?.content ?? ""),
    };
  });

  set.made === 1
    ? ok("a combined draw posts ONE card", `${set.rows} rows`)
    : fail("a combined draw posts ONE card", `${set.made} messages`);
  set.rows === 6 ? ok("...carrying all six of its tables") : fail("...carrying all six of its tables", String(set.rows));
  set.tableFlag === null
    ? ok("...and does NOT carry flags.core.RollTable, so it offers no spawn")
    : fail("...and does NOT carry flags.core.RollTable", String(set.tableFlag));
  set.hasScript === false && set.escapedTags === false
    ? ok("...with its values ENRICHED, so no tags show as text")
    : fail("...with its values enriched, not escaped",
      JSON.stringify({ script: set.hasScript, escapedTags: set.escapedTags }));

  // Complete Path specifically, because the TRAVEL tables are the ones whose
  // rows carry <strong> and <em>. This is the leg that would have caught the
  // shipped bug; the NPC set above has no markup to lose.
  const marked = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    app.querySelector('[data-action="tab"][data-tab="travel"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="rollSet"][data-key="CAIRN.Dashboard.Set.CompletePath"]');
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 80 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    const c = game.messages.contents.at(-1)?.content ?? "";
    // COUNT the <strong>s, never merely detect them: this card wraps every row
    // LABEL in <strong> of its own, so "does it contain <strong>" is true even
    // when every drawn value has been escaped to text. All three travel rows
    // open with their own <strong>, so enriched is 6 and escaped is 3, and the
    // first version of this leg was green under the very bug it was written
    // for.
    return {
      strongs: (c.match(/<strong>/gi) ?? []).length,
      rows: (c.match(/cairn-set-row/g) ?? []).length,
      escapedTags: /&lt;\/?[a-z]/i.test(c),
    };
  });
  marked.strongs > marked.rows && !marked.escapedTags
    ? ok("Complete Path renders the travel tables' own markup",
      `${marked.strongs} <strong> across ${marked.rows} rows`)
    : fail("Complete Path renders the travel tables' own markup", JSON.stringify(marked));

  /* ---- 7. the visibility dropdown reaches the message ------------------ */

  const whispered = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const select = app.querySelector("[name=messageMode]");
    const restore = select.value;
    select.value = "self";
    app.querySelector('[data-action="tab"][data-tab="travel"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="rollTable"][data-table="Warden: Weather - Spring"]');
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 40 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    const m = game.messages.contents.at(-1);
    select.value = restore;
    return { whisper: m?.whisper ?? [], me: game.user.id, modes: [...select.options].map((o) => o.value) };
  });
  whispered.whisper.length === 1 && whispered.whisper[0] === whispered.me
    ? ok("choosing a private mode whispers the card to the Warden alone")
    : fail("choosing a private mode whispers the card", JSON.stringify(whispered.whisper));
  whispered.modes.includes("public") && whispered.modes.includes("gm")
    ? ok("the dropdown is built from v14 message modes", whispered.modes.join(", "))
    : fail("the dropdown is built from v14 message modes", JSON.stringify(whispered.modes));

  /* ---- 7a. the clock must not eat the Warden's choice ------------------ */

  // THE REGRESSION THIS EXISTS TO CATCH. The time band is a second AppV2 PART
  // so it can redraw alone; `refreshDashboardTime` renders `parts: ["time"]`.
  // A bare `render()` there looks identical, works, logs nothing — and silently
  // resets this dropdown to Public on every tick of the world clock, because
  // `_syncPartState` restores no field VALUES. Which is the same fact
  // `_messageMode` reads the DOM at click time for.
  //
  // IT SETS "self", NOT "gm", AND THAT MATTERS AS OF 2026-09-11. This window
  // now OPENS on "gm" (user ruling: the Warden's rolls are private until they
  // say otherwise), so a leg that picked "gm" and read it back would pass on a
  // re-render that had thrown the choice away — it would be asserting the new
  // default rather than the Warden's choice. Fourth time a leg here has been
  // its own control; the value has to be one nothing else would produce.
  const survivedTick = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const select = app.querySelector("[name=messageMode]");
    select.value = "self";
    const t0 = game.time.worldTime;
    // READ THE BAND BEFORE THE ADVANCE. Reading it after meant the redraw could
    // already have happened while `advance` was resolving, so `before` was the
    // NEW text, the poll loop saw no change, and the leg reported the band as
    // dead. A leg that depends on losing a race is not a leg.
    const bandText = () => app.querySelector(".cairn-time-read")?.innerText;
    const before = bandText();
    await game.time.advance(8 * 3600);
    for (let i = 0; i < 60 && bandText() === before; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const out = {
      mode: app.querySelector("[name=messageMode]").value,
      bandMoved: bandText() !== before,
    };
    await game.time.set(t0);
    await new Promise((r) => setTimeout(r, 300));
    return out;
  });

  survivedTick.bandMoved
    ? ok("the time band redraws when the world clock moves")
    : fail("the time band redraws on a clock change", JSON.stringify(survivedTick));

  survivedTick.mode === "self"
    ? ok("...without resetting the Warden's visibility choice")
    : fail("the clock reset the visibility dropdown", `it now reads "${survivedTick.mode}"`);

  /* ---- 7a2. and a FRESH window opens private --------------------------- */

  const freshMode = await page.evaluate(async () => {
    const app = foundry.applications.instances.get("cairn-warden-dashboard");
    await app.render();
    const el = app.element;
    const row = el.querySelector(".cairn-dashboard-visibility");
    const select = el.querySelector("[name=messageMode]");
    const tabs = el.querySelector(".cairn-dashboard-tabs");
    // Which tab is showing must not change the answer: there is ONE of these
    // and it governs all six.
    select.value = "blind";
    el.querySelector('[data-action="tab"][data-tab="monsters"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const afterSwitch = el.querySelector("[name=messageMode]").value;
    el.querySelector('[data-action="tab"][data-tab="travel"]').click();
    await new Promise((r) => setTimeout(r, 150));
    return {
      value: select.value,
      rows: el.querySelectorAll(".cairn-dashboard-visibility").length,
      size: Math.round(parseFloat(getComputedStyle(row).fontSize)),
      selectSize: Math.round(parseFloat(getComputedStyle(select).fontSize)),
      // The row is ABOVE the strip, so its scope reads as the window's.
      aboveTabs: !!(row.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING),
      afterSwitch,
    };
  });

  // Re-read the default after the render above, which is what a Warden opening
  // the window gets. Set separately from the leg that changes it, or the two
  // assertions would be one.
  const openedMode = await page.evaluate(async () => {
    const app = foundry.applications.instances.get("cairn-warden-dashboard");
    await app.render();
    return app.element.querySelector("[name=messageMode]").value;
  });

  openedMode === "gm"
    ? ok("a freshly rendered dashboard opens Private to Gamemasters")
    : fail("the dashboard opens on the wrong visibility", `"${openedMode}"`);

  freshMode.rows === 1 && freshMode.aboveTabs && freshMode.afterSwitch === "blind"
    ? ok("...from ONE control, above the tabs, that every tab shares")
    : fail("the visibility control is not one shared control", JSON.stringify(freshMode));

  freshMode.size >= 15 && freshMode.selectSize >= 15
    ? ok("...and it is readable", `${freshMode.size}px label, ${freshMode.selectSize}px dropdown`)
    : fail("the visibility row is too small", JSON.stringify(freshMode));

  /* ---- 7b. showing a table to the players ------------------------------ */

  // Every table button carries an eye; nothing else does. A combined draw
  // rolls several tables, so there is no single table to show, and offering
  // one would be a lie about what the button does.
  const eyes = await page.evaluate(() => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const pairs = app.querySelectorAll(".cairn-dashboard-pair");
    return {
      rollButtons: app.querySelectorAll(
        'button[data-action="rollTable"], button[data-action="rollWeather"]').length,
      showButtons: app.querySelectorAll('button[data-action="showTable"]').length,
      pairs: pairs.length,
      // An eye anywhere inside a set or generator cell would mean the template
      // grew one where it must not.
      strays: [...app.querySelectorAll('button[data-action="rollSet"], button[data-action="generate"]')]
        .filter((b) => b.parentElement?.querySelector('[data-action="showTable"]')).length,
    };
  });
  eyes.showButtons === eyes.rollButtons && eyes.pairs === eyes.rollButtons
    ? ok("every table button has an eye beside it", `${eyes.showButtons} pairs`)
    : fail("every table button has an eye beside it", JSON.stringify(eyes));
  eyes.strays === 0
    ? ok("...and no combined draw or generator has one")
    : fail("...and no combined draw or generator has one", `${eyes.strays} strays`);

  /* ---- the readability pass: a glyph on every button, and nothing clips -- */

  // A WRONG OR PRO-ONLY FONT AWESOME CLASS RENDERS NOTHING AND SAYS NOTHING —
  // no error, no warning, no fallback mark, just an empty inline box that
  // reads as deliberate spacing beside the label. So this reads the RESOLVED
  // glyph. "the button has an <i>" and "the class list is what I wrote" both
  // pass under the very bug this is written for.
  const glyphs = await page.evaluate(() => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const out = { missing: [], empty: [], clipped: [], total: 0 };
    // Every tab, not just the visible one: a hidden pane reports zeroes, so
    // each is shown in turn and put back.
    const panes = [...app.querySelectorAll('.tab[data-group="primary"]')];
    const restore = panes.map((p) => p.className);
    for (const pane of panes) {
      panes.forEach((p) => p.classList.remove("active"));
      pane.classList.add("active");
      for (const btn of pane.querySelectorAll("button")) {
        out.total += 1;
        const i = btn.querySelector("i");
        if (!i) { out.missing.push(btn.innerText.trim().slice(0, 24)); continue; }
        const content = getComputedStyle(i, "::before").content;
        if (!content || content === "none" || content === '""') {
          out.empty.push(`${btn.innerText.trim().slice(0, 20)}: ${[...i.classList].join(".")}`);
        }
        // Nothing may clip. Core pins every <button> to --button-size with
        // overflow visible, so a wrapped label is DRAWN OUTSIDE the button
        // with no clipping and nothing in the console — measure, never trust
        // the override to have applied.
        if (btn.scrollHeight > btn.clientHeight + 1) {
          out.clipped.push(`${btn.innerText.trim().slice(0, 20)} ${btn.scrollHeight}>${btn.clientHeight}`);
        }
      }
    }
    panes.forEach((p, n) => { p.className = restore[n]; });
    // The band above the tabs is always visible, so it is measured plainly.
    for (const btn of app.querySelectorAll(".cairn-dashboard-time button")) {
      out.total += 1;
      const i = btn.querySelector("i");
      if (!i) { out.missing.push(`band: ${btn.innerText.trim().slice(0, 24)}`); continue; }
      const content = getComputedStyle(i, "::before").content;
      if (!content || content === "none" || content === '""') {
        out.empty.push(`band ${btn.innerText.trim().slice(0, 20)}: ${[...i.classList].join(".")}`);
      }
      if (btn.scrollHeight > btn.clientHeight + 1) {
        out.clipped.push(`band ${btn.innerText.trim().slice(0, 20)}`);
      }
    }
    return out;
  });

  glyphs.missing.length === 0 && glyphs.total > 45
    ? ok("every button on every tab carries a glyph", `${glyphs.total} buttons`)
    : fail("a button with no glyph", JSON.stringify({ total: glyphs.total, missing: glyphs.missing.slice(0, 6) }));

  glyphs.empty.length === 0
    ? ok("...and every one of them RESOLVES to a real mark", "read from ::before, not the class list")
    : fail("glyphs that render nothing", JSON.stringify(glyphs.empty.slice(0, 8)));

  glyphs.clipped.length === 0
    ? ok("...and no button clips its label", "measured, not assumed")
    : fail("buttons clipping their labels", JSON.stringify(glyphs.clipped.slice(0, 8)));

  // THE ONE THAT GUARDS THE USER'S ASK. "the same buttons used in the calendar
  // display" is only true if the Dashboard READS `SEASON_ICONS` rather than
  // restating it, so this compares the rendered classes against the map read
  // in-page. A literal written into VALD_WEATHER_GROUP reds it.
  const valdGlyphs = await page.evaluate(async () => {
    const gt = await import("/systems/air-bladder/module/game-time.js");
    const settings = game.settings;
    const realGet = settings.get.bind(settings);
    settings.get = (ns, key, ...rest) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? true : realGet(ns, key, ...rest));
    try {
      const app = foundry.applications.instances.get("cairn-warden-dashboard");
      await app.render();
      const el = app.element;
      const want = {
        Dead: gt.SEASON_ICONS["CAIRN.Vald.Season.Dead"],
        Dry: gt.SEASON_ICONS["CAIRN.Vald.Season.Dry"],
        Wet: gt.SEASON_ICONS["CAIRN.Vald.Season.Wet"],
        Harvest: gt.SEASON_ICONS["CAIRN.Vald.Season.Harvest"],
      };
      const got = {};
      for (const season of Object.keys(want)) {
        const btn = el.querySelector(`button[data-table="Warden: Vald - Weather (${season})"]`);
        const i = btn?.querySelector("i");
        got[season] = i ? [...i.classList].find((c) => c.startsWith("fa-") && c !== "fa-solid") : null;
      }
      // SCOPED TO THE TAB BODY, never the whole window: Today's Weather lives
      // in the band and carries a `data-table` of its own, so an unscoped
      // query answers with the band's button and this leg stops meaning
      // anything.
      const body = el.querySelector(".cairn-dashboard-body");
      const cairnSeasons = ["Spring", "Summer", "Fall", "Winter", "Difficulty"]
        .filter((s) => body.querySelector(`button[data-table="Warden: Weather - ${s}"]`)).length;
      return { want, got, cairnUnderVald: cairnSeasons };
    } finally {
      settings.get = realGet;
      await foundry.applications.instances.get("cairn-warden-dashboard")?.render();
    }
  });

  // The other half of the swap, read with the hack OFF — which is the state
  // this whole probe runs in.
  const cairnGlyphs = await page.evaluate(() => {
    const body = document.querySelector("#cairn-warden-dashboard .cairn-dashboard-body");
    const of = (s) => {
      const i = body.querySelector(`button[data-table="Warden: Weather - ${s}"] i`);
      return i ? [...i.classList].find((c) => c.startsWith("fa-") && c !== "fa-solid") : null;
    };
    return {
      icons: ["Spring", "Summer", "Fall", "Winter"].map(of),
      difficulty: of("Difficulty"),
      vald: body.querySelectorAll('button[data-table^="Warden: Vald - Weather"]').length,
    };
  });

  JSON.stringify(valdGlyphs.got) === JSON.stringify(valdGlyphs.want)
    ? ok("the four Vald weather buttons wear the calendar's own season glyphs",
      Object.values(valdGlyphs.want).join(" "))
    : fail("the Vald glyphs are restated, not read", JSON.stringify(valdGlyphs));

  // THE SWAP, BOTH WAYS (user ruling 2026-09-11, reversing the day before's
  // "they stack"). Rolling both sets on one day produces answers that
  // contradict each other, so under the hack Vald's REPLACES Cairn's. One
  // direction alone would pass on a dashboard that had simply lost a group.
  valdGlyphs.cairnUnderVald === 0
    ? ok("...and under the hack Cairn's own weather group is gone, difficulty included")
    : fail("Cairn's weather buttons survive under Vald", `${valdGlyphs.cairnUnderVald} still there`);

  cairnGlyphs.icons.every((g) => g && !Object.values(valdGlyphs.want).includes(g))
    && cairnGlyphs.difficulty && cairnGlyphs.vald === 0
    ? ok("...and with the hack off Cairn's five are back and Vald's are not",
      [...cairnGlyphs.icons, cairnGlyphs.difficulty].join(" "))
    : fail("the weather swap does not reverse", JSON.stringify(cairnGlyphs));

  // The width was raised to 640 so six tabs fit one row and the grid gets four
  // columns. Measured, because "it looks fine here" is not an assertion.
  const layout = await page.evaluate(() => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const tabs = [...app.querySelectorAll('.tabs [data-action="tab"]')];
    const tops = new Set(tabs.map((a) => Math.round(a.getBoundingClientRect().top)));
    const grid = app.querySelector('.tab.active .cairn-dashboard-grid')
      ?? app.querySelector(".cairn-dashboard-grid");
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
    return { rows: tops.size, cols };
  });

  layout.rows === 1
    ? ok("the six tabs sit on one row at the default width")
    : fail("the tab strip wraps", `${layout.rows} rows`);

  layout.cols >= 4
    ? ok("...and the button grid renders four columns", `${layout.cols}`)
    : fail("the grid is narrower than four columns", String(layout.cols));

  // THE RULING THIS PROTECTS: a reveal is public. The dropdown is set to a
  // PRIVATE mode first, so a handler that read `_messageMode` would whisper
  // the card to the Warden and this leg would red.
  const shown = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const select = app.querySelector("[name=messageMode]");
    const restore = select.value;
    select.value = "self";
    app.querySelector('[data-action="tab"][data-tab="travel"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="showTable"][data-table="Warden: Travel - Path Difficulty"]');
    const had = game.messages.size;
    btn.click();
    for (let i = 0; i < 60 && game.messages.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 400));
    const m = game.messages.contents.at(-1);
    const c = m?.content ?? "";
    select.value = restore;
    return {
      whisper: m?.whisper ?? [],
      tableFlag: foundry.utils.getProperty(m?.flags ?? {}, "core.RollTable") ?? null,
      rows: (c.match(/cairn-show-row/g) ?? []).length,
      ranges: (c.match(/cairn-show-range">\s*\d/g) ?? []).length,
      // Counted, never merely detected: this card supplies no <strong> of its
      // own, but the Complete Path leg learned the lesson the hard way.
      strongs: (c.match(/<strong>/gi) ?? []).length,
      escapedTags: /&lt;\/?[a-z]/i.test(c),
      popup: !!document.querySelector('[id^="cairn-shown-table-"]'),
    };
  });
  shown.whisper.length === 0
    ? ok("showing a table posts a PUBLIC card even with the dropdown private")
    : fail("showing a table posts a PUBLIC card", `whispered to ${shown.whisper.length}`);
  shown.rows === 3 && shown.ranges === 3
    ? ok("...listing every row with its range", `${shown.rows} rows`)
    : fail("...listing every row with its range", JSON.stringify({ rows: shown.rows, ranges: shown.ranges }));
  shown.tableFlag === null
    ? ok("...and carrying no table flag, since nothing was rolled")
    : fail("...and carrying no table flag", String(shown.tableFlag));
  shown.strongs === 3 && !shown.escapedTags
    ? ok("...with the rows' own markup enriched", `${shown.strongs} <strong> in 3 rows`)
    : fail("...with the rows' own markup enriched", JSON.stringify(shown));
  shown.popup
    ? ok("...and the Warden's own popup opened")
    : fail("...and the Warden's own popup opened", "no cairn-shown-table window");

  /* ---- 8. a generator mints exactly one document ----------------------- */

  const made = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    app.querySelector('[data-action="tab"][data-tab="people"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const btn = app.querySelector('button[data-action="generate"][data-gen="npc"]');
    const had = game.actors.size;
    btn.click();
    for (let i = 0; i < 100 && game.actors.size === had; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 500));   // catch a second create, if any
    return { added: game.actors.size - had };
  });
  made.added === 1
    ? ok("Generate NPC mints exactly one actor")
    : fail("Generate NPC mints exactly one actor", `${made.added} created`);

  /* ---- 9. Pop Out, and re-docking ------------------------------------- */

  const detach = await page.evaluate(() => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const btn = app.querySelector('.window-header button[data-action="detach"]');
    return {
      present: !!btn,
      // Core's own action, surfaced rather than reimplemented.
      action: btn?.dataset.action ?? null,
      hiddenNow: btn?.classList.contains("cairn-header-hidden") ?? null,
      // Core's own predicate, which #syncPopOut keys the button's visibility
      // to. Docked, it must read true or the button would be hidden on open.
      canDetach: foundry.applications.instances.get("cairn-warden-dashboard")?._canDetach() ?? null,
    };
  });
  detach.present && detach.action === "detach"
    ? ok("Pop Out is in the title bar, using core's own detach action")
    : fail("Pop Out is in the title bar", JSON.stringify(detach));
  detach.hiddenNow === false && detach.canDetach === true
    ? ok("...and is visible while docked, matching core's own _canDetach")
    : fail("...and is visible while docked, matching core's _canDetach",
      JSON.stringify({ hidden: detach.hiddenNow, canDetach: detach.canDetach }));

  /* ---- 10. narrow it: the body scrolls, the chrome stays --------------- */

  const narrow = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const inst = foundry.applications.instances.get("cairn-warden-dashboard");
    await inst.setPosition({ width: 320, height: 400 });
    await new Promise((r) => setTimeout(r, 300));
    const body = app.querySelector(".cairn-dashboard-body");
    const nav = app.querySelector(".cairn-dashboard-tabs");
    const foot = app.querySelector(".cairn-dashboard-footer");
    const content = app.querySelector(".window-content");
    const out = {
      resizable: !!app.querySelector(".window-resize-handle"),
      bodyScrolls: body.scrollHeight > body.clientHeight,
      // The chrome must NOT be scrolled away with the panel.
      navVisible: nav.getBoundingClientRect().height > 0,
      footVisible: foot.getBoundingClientRect().height > 0,
      // Nothing may spill sideways out of the window.
      noHorizontalSpill: content.scrollWidth <= content.clientWidth + 1,
    };
    await inst.setPosition({ width: 520, height: 620 });
    return out;
  });
  narrow.resizable ? ok("the window has a resize handle") : fail("the window has a resize handle");
  narrow.bodyScrolls
    ? ok("narrowed to 320px the panel scrolls rather than clipping")
    : fail("narrowed to 320px the panel scrolls", "body did not overflow, so nothing proves it scrolls");
  narrow.navVisible && narrow.footVisible
    ? ok("...while the tabs and the damage button stay put")
    : fail("...while the tabs and the damage button stay put", JSON.stringify(narrow));
  narrow.noHorizontalSpill
    ? ok("...and nothing spills sideways")
    : fail("...and nothing spills sideways");

  /* ---- 11. a PLAYER actually receives it ------------------------------- */

  // The leg that proves the feature rather than the plumbing. Everything above
  // runs on the Warden's own client, where the popup is opened by a direct
  // call — a socket emit is never delivered back to its sender — so none of it
  // exercises the broadcast at all.
  //
  // Alice also proves the read: `warden-travel` ships PLAYER: NONE, and this
  // only works because pack ownership is sidebar concealment rather than a
  // read wall. If that ever changed, her popup would be empty and this reds.
  const alice = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
  const aliceErrors = watchErrors(alice);
  try {
    await joinAs(alice, "Alice");
    await dismissChrome(alice);

    const received = await page.evaluate(async () => {
      const app = document.querySelector("#cairn-warden-dashboard");
      app.querySelector('[data-action="tab"][data-tab="travel"]').click();
      await new Promise((r) => setTimeout(r, 200));
      app.querySelector('button[data-action="showTable"][data-table="Warden: Weather - Spring"]').click();
      await new Promise((r) => setTimeout(r, 600));
      return true;
    });

    const onAlice = await alice.evaluate(async () => {
      for (let i = 0; i < 40 && !document.querySelector('[id^="cairn-shown-table-"]'); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const win = document.querySelector('[id^="cairn-shown-table-"]');
      return {
        opened: !!win,
        rows: win?.querySelectorAll(".cairn-show-row").length ?? 0,
        // Read the RENDERED text: an empty popup would still have rows.
        text: win?.textContent.replace(/\s+/g, " ").trim().slice(0, 80) ?? "",
      };
    });
    received && onAlice.opened
      ? ok("a PLAYER's client opens the popup off the broadcast")
      : fail("a PLAYER's client opens the popup off the broadcast", JSON.stringify(onAlice));
    onAlice.rows === 6 && /Nice|Fair/.test(onAlice.text)
      ? ok("...with the real rows in it, read from a pack she cannot browse", `${onAlice.rows} rows`)
      : fail("...with the real rows in it", JSON.stringify(onAlice));

    // A PLAYER emitting the action must be ignored. senderId is the guard and
    // is the one field the server authenticates, so a crafted emit gets
    // nowhere — assert the GM's client opens nothing new.
    const before2 = await page.evaluate(() =>
      document.querySelectorAll('[id^="cairn-shown-table-"]').length);
    await alice.evaluate(async () => {
      const t = await foundry.utils.fromUuid("Compendium.air-bladder.warden-travel.RollTable."
        + (await game.packs.get("air-bladder.warden-travel").getIndex())
          .find((e) => e.name === "Warden: Weather - Winter")._id);
      game.socket.emit(`system.${game.system.id}`, { action: "showTable", uuid: t.uuid });
      await new Promise((r) => setTimeout(r, 800));
    });
    const after2 = await page.evaluate(() =>
      document.querySelectorAll('[id^="cairn-shown-table-"]').length);
    after2 === before2
      ? ok("a player emitting showTable is ignored", "senderId is the guard")
      : fail("a player emitting showTable is ignored", `${before2} popups became ${after2}`);

    aliceErrors.length === 0
      ? ok("zero console errors on the player's client")
      : fail("player console errors", JSON.stringify(aliceErrors).slice(0, 300));
  } finally {
    await alice.context().close();
  }

  /* ---- cleanup --------------------------------------------------------- */

  const swept = await page.evaluate(async (b) => {
    foundry.applications.instances.get("cairn-warden-dashboard")?.close();
    // Hand the world back exactly as it was found, hack and all.
    if (window.__abRealGet) {
      game.settings.get = window.__abRealGet;
      [CONFIG.time.worldCalendarConfig, CONFIG.time.worldCalendarClass] = window.__abPrevCalendar;
      game.time.initializeCalendar();
      delete window.__abRealGet;
      delete window.__abPrevCalendar;
    }
    const msgs = game.messages.contents.filter((m) => !b.messages.includes(m.id)).map((m) => m.id);
    const actors = game.actors.contents.filter((a) => !b.actors.includes(a.id)).map((a) => a.id);
    const journals = game.journal.contents.filter((j) => !b.journals.includes(j.id)).map((j) => j.id);
    if (msgs.length) await ChatMessage.deleteDocuments(msgs);
    if (actors.length) await Actor.deleteDocuments(actors);
    if (journals.length) await JournalEntry.deleteDocuments(journals);
    return { msgs: msgs.length, actors: actors.length, journals: journals.length };
  }, before);
  note(`cleaned up ${swept.msgs} message(s), ${swept.actors} actor(s), ${swept.journals} journal(s)`);

  errors.length === 0 ? ok("zero console errors") : fail("console errors", JSON.stringify(errors).slice(0, 400));
} finally {
  await browser.close();
}

console.log(failed ? "\nwarden dashboard probe FAILED" : "\nwarden dashboard probe passed");
process.exit(failed ? 1 : 0);

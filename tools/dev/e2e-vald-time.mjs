#!/usr/bin/env node
/**
 * Watches, the watch clock, and the Vald calendar.
 *
 *   npm run dev:vald-time     (needs Foundry running, world launched)
 *
 * TWO THINGS ARE UNDER TEST AND THEY ARE NOT THE SAME THING. Watches are core
 * Cairn 2e and ship ungated; the Vald calendar is a hack behind
 * `enable-vald-calendar`. Leg 1 is what holds that line: the default world must
 * still be on Foundry's own calendar.
 *
 * NOTHING HERE WRITES THE WORLD'S CALENDAR SETTING. Every Vald leg SHADOWS
 * `CONFIG.time` in the page and restores it in a `finally` — the negative-control
 * rule this repo pays for: prove it in-page against planted state, never by a
 * real write. The three legs that move `game.time.worldTime` restore it too.
 *
 * THE LEG THAT EARNS ITS KEEP IS 10. The Vald calendar's whole weekday claim is
 * that 288 days divide by a six-day week and the leap week is exactly six days,
 * so every month begins on Market Day forever. Restating that in an assertion
 * proves nothing. Leg 10 checks all 28 dated holidays in the Warden's Guide
 * against the weekday the source itself names for each, which is a fact the
 * code cannot be right about by accident.
 *
 * Leg 12 exists because core does NOT bounds-check `components.season`: without
 * the Reclamation season entry the six leap days match nothing, the index comes
 * back one past the end, and `seasons.values[season]` is undefined.
 *
 * Leg 13 is the round trip, and it is the one that caught a bug in the SHIPPED
 * CLIENT: `CalendarData#_decomposeTimeYears` runs its remainder-years walk in
 * both branches, so the days a leap year has on top of a standard one decompose
 * as day 0 of the following year. `ValdCalendar` overrides the method core's own
 * docstring nominates for it. Restore core's two lines and legs 12 and 13 red.
 *
 * Creates nothing. Restores everything it touches.
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

/**
 * Run `fn` in the page with the Vald calendar installed, then put core's back.
 *
 * A REAL CalendarData instance built from our config and our subclass, so this
 * exercises the shipped arithmetic rather than a copy of it. `game.time`'s
 * calendar is private and only `initializeCalendar()` rebuilds it, so the swap
 * goes through CONFIG and that call — and the `finally` puts both back.
 */
const withVald = (p, body, arg = null) => p.evaluate(async ({ body: src, arg: a }) => {
  const gt = await import("/systems/air-bladder/module/game-time.js");
  const prevConfig = CONFIG.time.worldCalendarConfig;
  const prevClass = CONFIG.time.worldCalendarClass;
  CONFIG.time.worldCalendarConfig = gt.VALD_CALENDAR_CONFIG;
  CONFIG.time.worldCalendarClass = gt.ValdCalendar;
  game.time.initializeCalendar();
  try {
    // eslint-disable-next-line no-new-func
    return await new Function("gt", "arg", `return (${src})(gt, arg);`)(gt, a);
  } finally {
    CONFIG.time.worldCalendarConfig = prevConfig;
    CONFIG.time.worldCalendarClass = prevClass;
    game.time.initializeCalendar();
  }
}, { body: body.toString(), arg });

/**
 * As `withVald`, and ALSO shadowing the hack's own setting read.
 *
 * The calendar window asks `valdEnabled()`, which reads `enable-vald-calendar`
 * — so swapping CONFIG alone is not enough to open it. SHADOWING THE READ is
 * the rule here and not a shortcut: writing the real setting would flip the
 * dev world's hack on for every client and, because it `requiresReload`, leave
 * it flipped for whoever opens the world next. Restored in the `finally`, both
 * halves.
 */
const withValdOn = (p, body, arg = null) => p.evaluate(async ({ body: src, arg: a }) => {
  const gt = await import("/systems/air-bladder/module/game-time.js");
  const settings = game.settings;
  const realGet = settings.get.bind(settings);
  const prevConfig = CONFIG.time.worldCalendarConfig;
  const prevClass = CONFIG.time.worldCalendarClass;
  settings.get = (ns, key, ...rest) =>
    (ns === "air-bladder" && key === "enable-vald-calendar" ? true : realGet(ns, key, ...rest));
  CONFIG.time.worldCalendarConfig = gt.VALD_CALENDAR_CONFIG;
  CONFIG.time.worldCalendarClass = gt.ValdCalendar;
  game.time.initializeCalendar();
  try {
    // eslint-disable-next-line no-new-func
    return await new Function("gt", "arg", `return (${src})(gt, arg);`)(gt, a);
  } finally {
    settings.get = realGet;
    CONFIG.time.worldCalendarConfig = prevConfig;
    CONFIG.time.worldCalendarClass = prevClass;
    game.time.initializeCalendar();
    const wc = await import("/systems/air-bladder/module/watch-clock.js");
    await wc.refreshWatchClock();
  }
}, { body: body.toString(), arg });

try {
  await joinAsGM(page);
  await dismissChrome(page);

  const startTime = await page.evaluate(() => game.time.worldTime);

  /* ---- 1. watches ship ungated; Vald does not ------------------------- */

  const base = await page.evaluate(async () => {
    const gt = await import("/systems/air-bladder/module/game-time.js");
    return {
      calendar: game.time.calendar.name,
      valdOn: gt.valdEnabled(),
      registeredDefault: game.settings.settings.get("air-bladder.enable-vald-calendar")?.default,
      turnTime: CONFIG.time.turnTime,
      roundTime: CONFIG.time.roundTime,
      watchKeys: gt.WATCH_KEYS.length,
    };
  });

  // THE ASSERTION IS ABOUT WHAT SHIPS, NOT ABOUT THIS WORLD. It used to read
  // the live setting, and that made the whole probe depend on a dev world
  // nobody had switched the hack on in — which somebody did, to look at the
  // clock, and five legs went red at once for a reason that was not a defect.
  // The registered DEFAULT is what "an update must never change a table's
  // behaviour" actually means, and it cannot be changed by using the world.
  base.registeredDefault === false
    ? ok("the Vald calendar ships OFF — a world that never asks for it never gets it")
    : fail("the Vald calendar's registered default", JSON.stringify(base));

  // The live state is reported, never asserted. Every leg below that needs the
  // hack off shadows the read for itself.
  note(base.valdOn
    ? `this dev world has the hack ON (calendar: ${base.calendar}) — legs shadow around it`
    : `this dev world has the hack off (calendar: ${base.calendar})`);

  base.watchKeys === 3
    ? ok("a day is three watches, and they ship ungated")
    : fail("a day is three watches", String(base.watchKeys));

  /* ---- 2. watch arithmetic, under core's calendar --------------------- */

  const watches = await page.evaluate(async () => {
    const gt = await import("/systems/air-bladder/module/game-time.js");
    const per = game.time.calendar.days.hoursPerDay / 3;
    // Pure arithmetic against the same clamp `currentWatch` applies, so this
    // needs no world write to sweep the day.
    return [0, 7, 8, 15, 16, 23].map((h) => Math.min(2, Math.max(0, Math.floor(h / per))));
  });

  JSON.stringify(watches) === JSON.stringify([0, 0, 1, 1, 2, 2])
    ? ok("hours 0/7/8/15/16/23 are watches 0/0/1/1/2/2 — midnight-aligned, no dawn offset")
    : fail("watch arithmetic", JSON.stringify(watches));

  /* ---- 3. a combat round must never move the clock -------------------- */

  base.turnTime === 0 && base.roundTime === 0
    ? ok("a combat turn and round still advance the world clock by nothing")
    : fail("combat must not move the clock", JSON.stringify({ turn: base.turnTime, round: base.roundTime }));

  /* ---- 4. the clock is in the left column, above the player list ------ */

  const clock = await page.evaluate(() => {
    const el = document.getElementById("cairn-watch-clock");
    if (!el) return { present: false };
    const col = document.getElementById("ui-left-column-1");
    const players = document.getElementById("players");
    const r = el.getBoundingClientRect();
    return {
      present: true,
      inColumn: el.parentElement === col,
      // The clock must come BEFORE the player list, or core's space-between
      // pushes the list into the middle of the screen.
      beforePlayers: !!players
        && !!(el.compareDocumentPosition(players) & Node.DOCUMENT_POSITION_FOLLOWING),
      onScreen: r.width > 40 && r.height > 10 && r.x >= 0 && r.y >= 0,
      width: Math.round(r.width),
      text: el.innerText.replace(/\s+/g, " ").trim(),
    };
  });

  clock.present && clock.inColumn
    ? ok("the watch clock lives in #ui-left-column-1", clock.text)
    : fail("the watch clock lives in #ui-left-column-1", JSON.stringify(clock));

  clock.beforePlayers
    ? ok("...above the player list, so space-between still pins the controls to the top")
    : fail("the clock sits above the player list", JSON.stringify(clock));

  clock.onScreen
    ? ok("...and is actually visible", `${clock.width}px wide`)
    : fail("the clock is visible", JSON.stringify(clock));

  /* ---- 5. it follows the clock ---------------------------------------- */

  const moved = await page.evaluate(async () => {
    const read = () => document.getElementById("cairn-watch-clock")?.innerText.replace(/\s+/g, " ").trim();
    const before = read();
    const t0 = game.time.worldTime;
    await game.time.advance(8 * 3600);
    // POLL BOTH, rather than sleep: this is socket-synced, and a fixed wait
    // here would be the race this repo's rules say never to call a flake.
    //
    // THE CLOCK VALUE IS POLLED TOO, and that is not belt-and-braces. This leg
    // was seen once reporting `t1 === t0` on a run whose next run passed, which
    // means `advance` had resolved before the world setting came back — so the
    // assertion was reading a value that had not landed yet rather than a
    // feature that was broken.
    let after = before;
    for (let i = 0; i < 60 && (after === before || game.time.worldTime === t0); i++) {
      await new Promise((r) => setTimeout(r, 100));
      after = read();
    }
    return { before, after, t0, t1: game.time.worldTime };
  });

  moved.after !== moved.before && moved.t1 === moved.t0 + 28800
    ? ok("advancing a watch redraws the clock", `${moved.before} -> ${moved.after}`)
    : fail("advancing a watch redraws the clock", JSON.stringify(moved));

  /* ---- 6. it survives a re-render of its neighbours -------------------- */

  const survived = await page.evaluate(async () => {
    const read = () => {
      const el = document.getElementById("cairn-watch-clock");
      return el ? { text: el.innerText.replace(/\s+/g, " ").trim(), inColumn: el.parentElement?.id } : null;
    };
    const before = read();
    await ui.players.render();
    await ui.controls.render();
    await new Promise((r) => setTimeout(r, 400));
    return { before, after: read() };
  });

  survived.after && survived.after.inColumn === "ui-left-column-1"
    && survived.after.text === survived.before.text
    ? ok("it survives a re-render of the player list and the scene controls")
    : fail("it survives its neighbours re-rendering", JSON.stringify(survived));

  /* ---- 9-14. the Vald calendar, shadowed in-page ----------------------- */

  const shape = await withVald(page, () => ({
    name: game.time.calendar.name,
    daysPerYear: game.time.calendar.days.daysPerYear,
    daysPerLeapYear: game.time.calendar.days.daysPerLeapYear,
    weekdays: game.time.calendar.days.values.length,
    months: game.time.calendar.months.values.length,
    seasons: game.time.calendar.seasons.values.length,
  }));

  shape.daysPerYear === 288 && shape.daysPerLeapYear === 294 && shape.weekdays === 6
    && shape.months === 13 && shape.seasons === 5
    ? ok("Vald: 288 days, 294 in a leap year, 6 weekdays, 13 months, 5 season entries")
    : fail("Vald calendar shape", JSON.stringify(shape));

  // Every dated holiday in the Warden's Guide, as [month, day, weekday].
  const HOLIDAYS = [
    [1, 4, "Tithe Day"], [1, 24, "Resting Day"],
    [2, 10, "Tithe Day"], [2, 11, "Bathing Day"],
    [3, 9, "Song Day"], [3, 17, "Bathing Day"],
    [4, 4, "Tithe Day"], [4, 14, "Garden Day"],
    [5, 9, "Song Day"], [5, 10, "Tithe Day"],
    [6, 16, "Tithe Day"], [6, 24, "Resting Day"],
    [7, 4, "Tithe Day"], [7, 5, "Bathing Day"], [7, 14, "Garden Day"],
    [8, 1, "Market Day"], [8, 10, "Tithe Day"], [8, 18, "Resting Day"],
    [9, 14, "Garden Day"], [9, 19, "Market Day"],
    [10, 1, "Market Day"], [10, 4, "Tithe Day"], [10, 24, "Resting Day"],
    [11, 10, "Tithe Day"], [11, 12, "Resting Day"], [11, 18, "Resting Day"],
    [12, 11, "Bathing Day"], [12, 24, "Resting Day"],
  ];

  const holidays = await withVald(page, (gt, list) => {
    const cal = game.time.calendar;
    const wrong = [];
    for (const [mo, dom, want] of list) {
      // Year 3 is not a Reclamation year, so months are their plain 24 days.
      const t = cal.componentsToTime({ year: 3, day: (mo - 1) * 24 + (dom - 1) });
      const c = cal.timeToComponents(t);
      const got = game.i18n.localize(cal.days.values[c.dayOfWeek].name);
      if (got !== want || c.month !== mo - 1 || c.dayOfMonth !== dom - 1) {
        wrong.push(`${mo}/${dom}: want ${want}, got ${got} (month ${c.month} day ${c.dayOfMonth})`);
      }
    }
    return { checked: list.length, wrong };
  }, HOLIDAYS);

  holidays.wrong.length === 0
    ? ok(`all ${holidays.checked} dated holidays fall on the weekday the Warden's Guide names`)
    : fail("the Warden's Guide holidays", holidays.wrong.slice(0, 4).join(" | "));

  const BOUNDS = [[1, "Harvest"], [3, "Harvest"], [4, "Dead"], [75, "Dead"], [76, "Dry"],
    [147, "Dry"], [148, "Wet"], [216, "Wet"], [217, "Harvest"], [288, "Harvest"]];

  const seasons = await withVald(page, (gt, list) => {
    const cal = game.time.calendar;
    const wrong = [];
    for (const [doy, want] of list) {
      const c = cal.timeToComponents(cal.componentsToTime({ year: 3, day: doy - 1 }));
      const got = cal.seasons.values[c.season];
      const name = got ? game.i18n.localize(got.name) : "undefined";
      if (name !== want) wrong.push(`day ${doy}: want ${want}, got ${name}`);
    }
    return wrong;
  }, BOUNDS);

  seasons.length === 0
    ? ok("season boundaries land on 4, 76, 148 and 217 — the four 'season begins' rows")
    : fail("Vald season boundaries", seasons.join(" | "));

  const reclamation = await withVald(page, () => {
    const cal = game.time.calendar;
    const rows = [];
    for (let doy = 289; doy <= 294; doy++) {
      const c = cal.timeToComponents(cal.componentsToTime({ year: 10, day: doy - 1 }));
      const month = cal.months.values[c.month];
      const season = cal.seasons.values[c.season];
      rows.push({
        doy,
        month: month ? game.i18n.localize(month.name) : "undefined",
        // THE ONE THAT MATTERS: core does not guard this index.
        seasonDefined: season !== undefined,
        dayOfMonth: c.dayOfMonth,
      });
    }
    const last = cal.timeToComponents(cal.componentsToTime({ year: 10, day: 287 }));
    return { rows, day288: game.i18n.localize(cal.months.values[last.month]?.name ?? "") };
  });

  const reclOk = reclamation.rows.every((r, i) => r.month === "Reclamation"
    && r.seasonDefined && r.dayOfMonth === i);
  reclOk && reclamation.day288 === "Sunset"
    ? ok("the six Reclamation days are month 13 with a DEFINED season, and day 288 is still Sunset")
    : fail("Reclamation week", JSON.stringify(reclamation).slice(0, 400));

  const trip = await withVald(page, () => {
    const cal = game.time.calendar;
    const perYear = 288 * 86400;
    let bad = 0;
    let first = null;
    for (let i = 0; i < 2000; i++) {
      const t = Math.floor(Math.random() * 40 * perYear);
      const back = cal.componentsToTime(cal.timeToComponents(t));
      if (back !== t) { bad++; first ??= { t, back, diff: back - t }; }
    }
    return { bad, first };
  });

  trip.bad === 0
    ? ok("2000 random times round-trip exactly through the calendar")
    : fail("round trip", `${trip.bad}/2000 failed, first ${JSON.stringify(trip.first)}`);

  const epoch = await withVald(page, async (gt) => ({
    date: gt.formatValdDate(game.time.calendar.timeToComponents(0)),
  }));

  epoch.date === "Market Day, the 1st of Mourning, 7728"
    ? ok("world time zero reads as Market Day, the 1st of Mourning, 7728")
    : fail("the epoch", epoch.date);

  /* ---- 15. the Vald weather group is gated ---------------------------- */

  await page.evaluate(async () => {
    const { openWardenDashboard } = await import("/systems/air-bladder/module/warden-dashboard.js");
    await openWardenDashboard();
  });
  await page.waitForSelector("#cairn-warden-dashboard", { timeout: 20000 });
  await page.waitForTimeout(300);

  /**
   * The Dashboard as it renders with the hack OFF.
   *
   * SHADOWED, not read from the world. The dev world's own setting is whatever
   * somebody last left it at, and every assertion below is about the off state
   * — so the off state is established here rather than assumed, and restored
   * immediately. The `render()` inside the shadow is what makes it take.
   */
  const readDash = () => page.evaluate(async () => {
    const settings = game.settings;
    const realGet = settings.get.bind(settings);
    settings.get = (ns, key, ...rest) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? false : realGet(ns, key, ...rest));
    const prevConfig = CONFIG.time.worldCalendarConfig;
    const prevClass = CONFIG.time.worldCalendarClass;
    // `earthCalendarConfig` IS the Simplified Gregorian and nothing here ever
    // touches it, so it is the one handle on core's own calendar that survives
    // a world which already installed Vald at init.
    CONFIG.time.worldCalendarConfig = CONFIG.time.earthCalendarConfig;
    CONFIG.time.worldCalendarClass = CONFIG.time.earthCalendarClass;
    game.time.initializeCalendar();
    try {
      await foundry.applications.instances.get("cairn-warden-dashboard").render();
      const app = document.getElementById("cairn-warden-dashboard");
      const content = app.querySelector(".window-content");
      const band = app.querySelector(".cairn-dashboard-time");
      const rollSel = 'button[data-action="rollTable"], button[data-action="rollWeather"]';
      // WHAT THE BAND'S CONTENT ACTUALLY NEEDS, so the stretch leg can compare
      // the used height against it rather than against a fraction of the
      // window. The fraction was a proxy and it expired the day the band grew
      // a fourth read line: 233px of 642px is a third, and entirely correct.
      const cs = getComputedStyle(band);
      const bandNatural = [...band.children].reduce((h, c) => {
        const m = getComputedStyle(c);
        return h + c.getBoundingClientRect().height
          + parseFloat(m.marginTop) + parseFloat(m.marginBottom);
      }, parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
        + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth));

      return {
        bandIsFirstChild: content.firstElementChild === band,
        bandHeight: Math.round(band.getBoundingClientRect().height),
        bandNatural: Math.round(bandNatural),
        bandGrows: cs.flexGrow !== "0",
        contentHeight: Math.round(content.getBoundingClientRect().height),
        tabs: app.querySelectorAll(".cairn-dashboard-tabs .item").length,
        rollButtons: app.querySelectorAll(rollSel).length,
        showButtons: app.querySelectorAll('button[data-action="showTable"]').length,
        pairs: app.querySelectorAll(".cairn-dashboard-pair").length,
        valdButtons: [...app.querySelectorAll(rollSel)]
          .map((b) => b.dataset.table).filter((t) => t && t.includes("Vald - Weather")).length,
        weatherTable: app.querySelector('.cairn-time-weather button[data-action="rollWeather"]')
          ?.dataset.table ?? null,
        timeButtons: app.querySelectorAll(".cairn-time-controls button").length,
        calendarButton: app.querySelectorAll('.cairn-time-controls [data-action="openCalendar"]').length,
        notTypeButton: [...app.querySelectorAll(".cairn-dashboard-time button")]
          .filter((b) => b.getAttribute("type") !== "button").length,
      };
    } finally {
      settings.get = realGet;
      CONFIG.time.worldCalendarConfig = prevConfig;
      CONFIG.time.worldCalendarClass = prevClass;
      game.time.initializeCalendar();
    }
  });

  const off = await readDash();

  // KEYBOARD FOCUS SURVIVES THE BAND'S RE-RENDER (review #27). Advance Watch
  // re-renders the `time` part alone, and core restores focus across a part
  // replacement only to an element it can name by `#id` or `[name]`; without
  // one, Enter three times advanced ONE watch and stranded the focus on
  // <body>. Forward then back, so the clock ends where it started.
  const bandFocus = await page.evaluate(async () => {
    const app = document.querySelector("#cairn-warden-dashboard");
    const adv = app?.querySelector("#cairn-warden-dashboard-advance-watch");
    adv?.focus();
    const before = document.activeElement?.id ?? "";
    const t0 = game.time.worldTime;
    adv?.click();
    for (let i = 0; i < 40 && game.time.worldTime === t0; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 500));
    const after = document.activeElement?.id ?? "";
    app?.querySelector("#cairn-warden-dashboard-back-watch")?.click();
    for (let i = 0; i < 40 && game.time.worldTime !== t0; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 400));
    return { before, after, restored: game.time.worldTime === t0 };
  });
  bandFocus.before === "cairn-warden-dashboard-advance-watch" && bandFocus.after === bandFocus.before
    ? ok("keyboard focus survives the time band's re-render (a stable id core can restore)")
    : fail("focus is lost on the band's re-render", JSON.stringify(bandFocus));
  bandFocus.restored
    ? ok("   …and the clock is back where it was")
    : fail("the focus leg moved the clock and could not move it back", JSON.stringify(bandFocus));

  off.tabs === 6
    ? ok("the tab strip is still six — the band is furniture, not a seventh tab")
    : fail("six tabs", String(off.tabs));

  off.bandIsFirstChild
    ? ok("the time band is the first child of .window-content")
    : fail("the band is the window's first band", JSON.stringify(off));

  // The `flex: 1` trap: with two PARTS the restored
  // `.cairn.sheet .window-content > * { flex: 1 }` would give the band half
  // the window, while rendering perfectly and logging nothing.
  //
  // MEASURED AGAINST ITS OWN CONTENT, not against a fraction of the window.
  // The old "less than a third" was a proxy, and it expired the day the band
  // grew a fourth read line — 233px of 642px is over a third and is exactly
  // right. What the rule actually says is "take what you need", so that is
  // what this asks.
  off.bandHeight > 0 && !off.bandGrows && off.bandHeight <= off.bandNatural + 2
    ? ok("the band takes its own height, not a share of the window",
      `${off.bandHeight}px, content needs ${off.bandNatural}px`)
    : fail("the band is stretching", JSON.stringify({
      height: off.bandHeight, natural: off.bandNatural, grows: off.bandGrows,
    }));

  off.timeButtons === 5 && off.calendarButton === 0
    ? ok("five clock controls with the hack off: back, watch, day, next morning, set the date")
    : fail("five clock controls", JSON.stringify({ n: off.timeButtons, cal: off.calendarButton }));

  off.notTypeButton === 0
    ? ok("every band button is type=button, so none of them submits the window")
    : fail("a band button would submit the form", String(off.notTypeButton));

  off.valdButtons === 0
    ? ok("with the hack off, the Travel tab offers no Vald weather buttons")
    : fail("Vald weather is gated", `${off.valdButtons} buttons with the hack off`);

  off.showButtons === off.rollButtons && off.pairs === off.rollButtons
    ? ok("every table button is still paired with an eye", `${off.pairs} pairs`)
    : fail("roll/show pairs", JSON.stringify(off));

  // Today's Weather under core's Gregorian calendar picks a Cairn season table.
  /^Warden: Weather - (Spring|Summer|Fall|Winter)$/.test(off.weatherTable ?? "")
    ? ok("Today's Weather picks a Cairn seasonal table under Foundry's calendar", off.weatherTable)
    : fail("Today's Weather, hack off", String(off.weatherTable));

  const on = await page.evaluate(async () => {
    const gt = await import("/systems/air-bladder/module/game-time.js");
    const settings = game.settings;
    const realGet = settings.get.bind(settings);
    const prevConfig = CONFIG.time.worldCalendarConfig;
    const prevClass = CONFIG.time.worldCalendarClass;
    // The weather is shadowed too, because the band's fourth line is
    // CONDITIONAL and this block asserts the full stack. Establishing it is
    // the point: inheriting whatever the world happened to have called is how
    // a leg ends up asserting three lines one run and four the next.
    settings.get = (ns, key, ...rest) => {
      if (ns !== "air-bladder") return realGet(ns, key, ...rest);
      if (key === "enable-vald-calendar") return true;
      if (key === "vald-weather-today") return { day: gt.dayCount(), text: "Sleet" };
      return realGet(ns, key, ...rest);
    };
    CONFIG.time.worldCalendarConfig = gt.VALD_CALENDAR_CONFIG;
    CONFIG.time.worldCalendarClass = gt.ValdCalendar;
    game.time.initializeCalendar();
    try {
      const app = foundry.applications.instances.get("cairn-warden-dashboard");
      // Put the clock inside the Wet season so Today's Weather has to choose.
      await app.render();
      const el = app.element;
      const heads = [...el.querySelectorAll(".cairn-dashboard-head")].map((h) => h.innerText.trim());
      // SCOPED TO THE TAB BODY. Today's Weather in the band is also a Vald
      // table once the hack is on, so a window-wide count reads five and the
      // group itself is never actually checked.
      const body = el.querySelector(".cairn-dashboard-body");
      const valdButtons = [...body.querySelectorAll('button[data-action="rollTable"]')]
        .map((b) => b.dataset.table).filter((t) => t && t.includes("Vald - Weather"));
      const valdPairs = [...body.querySelectorAll(".cairn-dashboard-pair")]
        .filter((p) => p.querySelector('[data-table*="Vald - Weather"]'))
        .filter((p) => p.querySelector('[data-action="showTable"]')).length;
      // Season -> table, checked by SETTING the components rather than the clock:
      // weatherTableForToday reads game.time.components, so shadow that instead
      // of writing the world.
      const cal = game.time.calendar;
      const seen = {};
      const realComponents = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(game.time), "components");
      for (const [doy, label] of [[10, "Dead"], [100, "Dry"], [200, "Wet"], [250, "Harvest"]]) {
        const c = cal.timeToComponents(cal.componentsToTime({ year: 3, day: doy - 1 }));
        Object.defineProperty(game.time, "components", { value: c, configurable: true });
        seen[label] = gt.weatherTableForToday();
      }
      delete game.time.components;
      if (realComponents) Object.defineProperty(Object.getPrototypeOf(game.time), "components", realComponents);

      // The two EVENT tables moved off the Encounters tab into the band, so
      // they are one click away from every tab rather than behind one.
      const band = el.querySelector(".cairn-dashboard-time");
      const events = [...band.querySelectorAll('button[data-action="rollTable"]')]
        .map((b) => b.dataset.table).filter((t) => t?.startsWith("Warden: Events"));
      const eventEyes = [...band.querySelectorAll(".cairn-dashboard-pair")]
        .filter((p) => p.querySelector('[data-table^="Warden: Events"]'))
        .filter((p) => p.querySelector('[data-action="showTable"]')).length;
      const eventsOnTab = [...body.querySelectorAll("button[data-table]")]
        .filter((b) => b.dataset.table.startsWith("Warden: Events")).length;

      // A TABLE OUTSIDE `PANELS` LOSES ITS FRIENDLY LABEL, which is what a
      // player is shown when the Warden reveals it. Reading the label for one
      // of each group is the only thing that catches a declaration the lookup
      // does not walk.
      const wd = await import("/systems/air-bladder/module/warden-dashboard.js");
      const labels = {
        event: wd._labelForTable("Warden: Events - Dungeon"),
        vald: wd._labelForTable("Warden: Vald - Weather (Dead)"),
        panel: wd._labelForTable("Warden: NPC - Quirk"),
      };

      // A GLYPH MEANS ONE THING PER WINDOW (user ask 2026-09-11). Two rules,
      // both scoped to the band, which is where the collision happened:
      // nothing but a season may wear a season's mark, and no other mark
      // appears twice. THREE repeats are deliberate and named here rather
      // than discovered later — the eye is always "show to the players", the
      // pen is always "type a value", and Today's Weather wears the glyph of
      // the season it will roll so the button says which season you are in.
      const DELIBERATE = ["fa-eye", "fa-pen-to-square"];
      const markOf = (node) => [...node.classList]
        .find((c) => c.startsWith("fa-") && !["fa-solid", "fa-regular", "fa-brands"].includes(c));
      const seasonMarks = Object.values(gt.SEASON_ICONS);
      const bandIcons = [...band.querySelectorAll("i")].map((i) => ({
        mark: markOf(i) ?? "?",
        // The two places a season's mark is allowed.
        season: !!i.closest(".cairn-time-season") || !!i.closest('[data-action="rollWeather"]'),
      }));
      const counts = {};
      for (const { mark } of bandIcons) counts[mark] = (counts[mark] ?? 0) + 1;
      const glyphRules = {
        // A season's mark somewhere that is not a season.
        seasonMisuse: bandIcons.filter((g) => seasonMarks.includes(g.mark) && !g.season)
          .map((g) => g.mark),
        // Anything else showing up twice.
        repeats: Object.entries(counts)
          .filter(([mark, n]) => n > 1 && !DELIBERATE.includes(mark) && !seasonMarks.includes(mark))
          .map(([mark, n]) => `${mark} x${n}`),
        total: bandIcons.length,
      };

      // THE BAND'S SHAPE, not just its type sizes. The sizes alone stayed
      // green on the one-line version this replaced, so they cannot be the
      // assertion: what was asked for is that these four facts STACK the way
      // the calendar's day panel stacks its three.
      const read = el.querySelector(".cairn-time-read");
      const lines = [...read.children];
      const size = (node) => (node ? Math.round(parseFloat(getComputedStyle(node).fontSize)) : -1);
      const bandRead = {
        classes: lines.map((n) => [...n.classList].find((c) => c.startsWith("cairn-time-")) ?? "?"),
        // STACKED, proved by geometry: a flex ROW that merely wrapped would
        // pass a count of four and fail this.
        stacked: lines.every((n, i) => i === 0
          || n.getBoundingClientRect().top >= lines[i - 1].getBoundingClientRect().bottom - 1),
        sizes: lines.map(size),
        // A wrong or Pro-only class renders an empty box in silence, so read
        // the resolved mark rather than the class list.
        glyphs: lines.slice(1).map((n) => {
          const i = n.querySelector("i");
          const c = i ? getComputedStyle(i, "::before").content : "";
          return !!c && c !== "none" && c !== '""';
        }),
        // The separators the one-line version used.
        seps: read.querySelectorAll(".cairn-time-sep").length,
        dateText: read.querySelector(".cairn-time-date")?.innerText.trim() ?? "",
      };

      return {
        heads, valdButtons, valdPairs, seen, events, eventEyes, eventsOnTab, labels,
        band: bandRead, glyphRules,
      };
    } finally {
      settings.get = realGet;
      CONFIG.time.worldCalendarConfig = prevConfig;
      CONFIG.time.worldCalendarClass = prevClass;
      game.time.initializeCalendar();
    }
  });

  on.valdButtons.length === 4 && on.heads.includes("Weather in Vald")
    ? ok("with the hack on, Travel grows a Weather in Vald group of four")
    : fail("Vald weather group", JSON.stringify({ heads: on.heads, buttons: on.valdButtons }));

  // Cairn's group must be GONE — Vald's replaces it rather than joining it
  // (user ruling 2026-09-11, reversing the day before). The reason is not
  // tidiness: a Warden with both on one tab rolls both, and the two answer the
  // same question differently on the same day. `dev:warden-dashboard` owns the
  // other half, where the hack is off and Cairn's five are back.
  on.heads.filter((h) => h === "Weather").length === 0
    ? ok("...and Cairn's own Weather group has stood down for it")
    : fail("both weather groups are on the tab at once", JSON.stringify(on.heads));

  on.events.length === 2 && on.eventEyes === 2 && on.eventsOnTab === 0
    ? ok("the two event tables sit in the band, paired with eyes, and not on a tab")
    : fail("the event tables", JSON.stringify({
      band: on.events, eyes: on.eventEyes, onTab: on.eventsOnTab,
    }));

  // A UI LABEL, not the browse name. Red for the Vald four before 2026-09-11:
  // they have never been in PANELS, so a reveal put "Warden: Vald - Weather
  // (Dead)" on the players' screens.
  on.labels.event === "Dungeon Events" && on.labels.vald === "Dead"
    && on.labels.panel === "Quirk"
    ? ok("...and every declaration reaches the label a player is shown",
      Object.values(on.labels).join(" / "))
    : fail("a table shows its browse name to the players", JSON.stringify(on.labels));

  // THE BAND READS LIKE THE CALENDAR'S DAY PANEL (user ruling 2026-09-11).
  JSON.stringify(on.band.classes) === JSON.stringify([
    "cairn-time-date", "cairn-time-watch", "cairn-time-season", "cairn-time-today-weather",
  ]) && on.band.stacked
    ? ok("the band stacks date, watch, season and weather, one line each")
    : fail("the band is not stacked", JSON.stringify({
      lines: on.band.classes, stacked: on.band.stacked,
    }));

  on.band.sizes[0] >= 20 && on.band.sizes.slice(1).every((s) => s > 0 && s <= 16)
    ? ok("...with the date as the headline and the rest quiet under it",
      `${on.band.sizes[0]}px over ${on.band.sizes.slice(1).join("/")}px`)
    : fail("the band's type is wrong", JSON.stringify(on.band.sizes));

  on.band.glyphs.every(Boolean) && on.band.seps === 0
    ? ok("...each led by a glyph that RESOLVES, and no separators left")
    : fail("a band glyph renders nothing", JSON.stringify({
      glyphs: on.band.glyphs, seps: on.band.seps,
    }));

  // A GLYPH MEANS ONE THING PER WINDOW. Red before 2026-09-11: `fa-sun` was
  // the Dry season's mark AND To Next Morning's, one row apart in this band.
  on.glyphRules.seasonMisuse.length === 0
    ? ok("...and no season's mark is worn by anything but a season",
      `${on.glyphRules.total} glyphs in the band`)
    : fail("a season's glyph is used for something else",
      on.glyphRules.seasonMisuse.join(", "));

  on.glyphRules.repeats.length === 0
    ? ok("...and nothing else in the band appears twice", "eye and pen excepted, by ruling")
    : fail("a glyph is doing two jobs in the band", on.glyphRules.repeats.join(", "));

  on.valdPairs === 4
    ? ok("...each of the four paired with an eye")
    : fail("Vald weather buttons are paired", String(on.valdPairs));

  const wanted = {
    Dead: "Warden: Vald - Weather (Dead)", Dry: "Warden: Vald - Weather (Dry)",
    Wet: "Warden: Vald - Weather (Wet)", Harvest: "Warden: Vald - Weather (Harvest)",
  };
  JSON.stringify(on.seen) === JSON.stringify(wanted)
    ? ok("Today's Weather picks the table for the season the world is actually in")
    : fail("Today's Weather by season", JSON.stringify(on.seen));

  // ...AND THE TABLES ACTUALLY EXIST. Every leg above reads a button's
  // `data-table` attribute, which is a string this file could be wrong about in
  // exactly the same way twice. This one ROLLS one and reads the card, so a
  // Vald table missing from the compendium — or misnamed in either place — reds
  // here rather than shipping as four buttons that do nothing.
  const rolled = await page.evaluate(async () => {
    const { findTableByName } = await import("/systems/air-bladder/module/compendium.js");
    const names = ["Warden: Vald - Weather (Dead)", "Warden: Vald - Weather (Dry)",
      "Warden: Vald - Weather (Wet)", "Warden: Vald - Weather (Harvest)"];
    const found = {};
    for (const n of names) {
      const tbl = await findTableByName(n);
      found[n] = tbl ? { rows: tbl.results.size, formula: tbl.formula } : null;
    }
    // Re-apply the hack's shadow: the block above lifted it, so the buttons are
    // gone by now. Restored in the finally below, like every other Vald leg.
    const settings = game.settings;
    const realGet = settings.get.bind(settings);
    settings.get = (ns, key, ...rest) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? true : realGet(ns, key, ...rest));
    try {
      const app = foundry.applications.instances.get("cairn-warden-dashboard");
      await app?.render();
      await new Promise((r) => setTimeout(r, 400));
      // Rolled through the REAL BUTTON rather than an exported helper, so this
      // exercises the path a Warden actually takes.
      const before = game.messages.size;
      const btn = app?.element.querySelector(
        '.cairn-dashboard-body button[data-action="rollTable"][data-table="Warden: Vald - Weather (Dead)"]');
      btn?.click();
      for (let i = 0; i < 60 && game.messages.size === before; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const msg = game.messages.contents.at(-1);
      const DEAD = ["Cold and clear", "Frosty mornings", "Overcast skies",
        "Light snow", "Snow showers", "Freezing rain"];
      const out = {
        found,
        clicked: !!btn,
        posted: game.messages.size > before,
        // CORE's card, so the one rule the dashboard has is not broken here.
        coreFlag: msg?.getFlag("core", "RollTable") ?? null,
        // The drawn text must be one of the six SRD rows, unmarked.
        textIsSRD: DEAD.some((t) => (msg?.content ?? "").includes(t)),
        speaker: msg?.speaker?.alias ?? null,
      };
      // This probe creates nothing else, so it takes its one card away again.
      if (out.posted && msg) await msg.delete();
      return out;
    } finally {
      settings.get = realGet;
    }
  });

  const allFound = Object.values(rolled.found).every((f) => f && f.rows === 6 && f.formula === "1d6");
  allFound
    ? ok("all four Vald weather tables resolve, six rows on 1d6")
    : fail("the Vald weather tables resolve", JSON.stringify(rolled.found));

  rolled.clicked && rolled.posted && rolled.coreFlag && rolled.textIsSRD
    ? ok("...and rolling one posts CORE'S card carrying an SRD row", rolled.speaker ?? "")
    : fail("rolling a Vald weather table", JSON.stringify(rolled).slice(0, 300));


  /* ---- 17-24. the calendar on the wall --------------------------------- */

  // The Warden's Guide's own dated rows, RETYPED HERE rather than read back
  // from the importer's output. An assertion that reads the same file the
  // feature reads cannot fail: it would agree with a misparse exactly as
  // happily as with a correct one. These 24 are the independent copy.
  const FESTIVALS = [
    [1, 24, "First Light", 1], [2, 10, "Dead Solstice", 1], [2, 11, "Whisper", 1],
    [3, 9, "Lift the Veil", 1], [3, 17, "Veil’s Edge", 1], [4, 14, "Bartermoot", 1],
    [5, 9, "Dustset", 1], [5, 10, "Dry Equinox", 1], [6, 16, "Boughmeal", 1],
    [6, 24, "Parade of Ash", 1], [7, 5, "Splash Festival", 3], [7, 14, "Float", 1],
    [8, 1, "Highwater Fair", 1], [8, 10, "Wet Solstice", 1], [8, 18, "First Plant", 1],
    [9, 14, "Waterwish", 1], [9, 19, "Storm Dance", 5], [10, 4, "Harvest Festival", 1],
    [10, 24, "Gathering Night", 1], [11, 10, "Harvest Equinox", 1],
    [11, 12, "The Golden Hind", 1], [11, 18, "Firelight", 1], [12, 11, "Ember", 1],
    [12, 24, "Gloam", 1],
  ];

  // THE DOOR, OFF. Read BEFORE the shadow goes up, because the dev world runs
  // with the hack off and this is the state a table that never enables Vald
  // lives in. An absence alone would also be true if the clock had failed to
  // render at all, so the panel's presence is asserted with it.
  const doorOff = await page.evaluate(async () => {
    const settings = game.settings;
    const realGet = settings.get.bind(settings);
    settings.get = (ns, key, ...rest) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? false : realGet(ns, key, ...rest));
    try {
      const wc = await import("/systems/air-bladder/module/watch-clock.js");
      await wc.refreshWatchClock();
      const el = document.getElementById("cairn-watch-clock");
      return {
        present: !!el,
        isButton: !!el?.querySelector("button.cairn-watch-inner"),
        lines: el?.querySelectorAll(".cairn-watch-line").length ?? 0,
        window: !!document.getElementById("cairn-vald-calendar"),
      };
    } finally {
      settings.get = realGet;
    }
  });

  doorOff.present && doorOff.lines > 0 && !doorOff.isButton && !doorOff.window
    ? ok("with the hack off the clock is not a button and there is no calendar")
    : fail("the door is closed with the hack off", JSON.stringify(doorOff));

  // ESTABLISH THE DATE, never inherit it. The month walk below steps forward
  // from whatever month the calendar OPENS on, which is today's — so a world
  // sitting on 4 Silence made the first step land on Silence, the twelfth land
  // on Reclamation, and every festival compare against the wrong month. It read
  // as an off-by-one in the FESTIVAL data and was nothing of the kind.
  // worldTime 0 is the 1st of Mourning, 7728, and the probe's own restore at
  // the end puts the world back where it found it.
  //
  // OUTSIDE the calendar shadow, deliberately: a world-time write inside it
  // re-renders the clock from the hook while the body is still holding the
  // shadow, and the window never opened.
  await page.evaluate(async () => {
    await game.time.set(0);
    await new Promise((r) => setTimeout(r, 400));
  });

  // ESTABLISHED, not assumed: an earlier run's "ZZ Probe" events, left behind
  // when that run ended short of its sweep, marked four days of Mourning and
  // reddened the festival count below for a reason that was never the
  // calendar's (2026-09-12). Litter is recognised by this probe's own name
  // marker — the only handle one run has on what another left — and only a
  // journal whose pages ALL carry it goes, so a Warden's own calendar stays.
  const litter = await page.evaluate(async () => {
    const mine = game.journal.contents.filter((j) => j.flags?.["air-bladder"]?.calendarEvents
      && j.pages.size > 0 && j.pages.contents.every((p) => /^ZZ Probe/.test(p.name)));
    const ids = mine.map((j) => j.id);
    if (ids.length) await getDocumentClass("JournalEntry").deleteDocuments(ids);
    return ids.length;
  });
  if (litter) note(`swept ${litter} event journal(s) an earlier run left behind`);

  const cal = await withValdOn(page, async (gt, festivals) => {
    const vc = await import("/systems/air-bladder/module/vald-calendar.js");
    const wc = await import("/systems/air-bladder/module/watch-clock.js");
    vc._resetFestivals();
    const out = {};

    // The clock re-renders under the shadow, so its inner element becomes the
    // button, and clicking it is what must open the window — not a direct call.
    await wc.refreshWatchClock();
    const clockButton = document.querySelector("#cairn-watch-clock button.cairn-watch-inner");
    out.isButton = !!clockButton;
    clockButton?.click();
    for (let i = 0; i < 40 && !document.getElementById("cairn-vald-calendar"); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const app = foundry.applications.instances.get("cairn-vald-calendar");
    out.opened = !!app?.rendered;
    if (!out.opened) return out;

    const el = () => app.element;
    const days = () => [...el().querySelectorAll(".cairn-calendar-day")];

    // KEYBOARD FOCUS SURVIVES A RE-RENDER (review #27). Every action replaces
    // the whole part, and core restores focus across a replacement only to an
    // element it can name by `#id` or `[name]` — so a button with neither
    // paged one month and stranded the focus on <body>. Next, then back, so
    // the month legs below still read the month they expect.
    {
      const next = document.getElementById("cairn-vald-calendar-next");
      next?.focus();
      out.focusBefore = document.activeElement?.id ?? "";
      next?.click();
      await new Promise((r) => setTimeout(r, 500));
      out.focusAfter = document.activeElement?.id ?? "";
      document.getElementById("cairn-vald-calendar-prev")?.click();
      await new Promise((r) => setTimeout(r, 400));
    }

    // Shape. `leadingBlanks` is COMPUTED from the first day's weekday, so a
    // zero here is a result and not a restatement of the config.
    out.weekdayHeads = el().querySelectorAll(".cairn-calendar-weekday").length;
    out.cells = days().length;
    out.blanks = el().querySelectorAll(".cairn-calendar-blank").length;
    out.todayMarks = el().querySelectorAll(".cairn-calendar-day.is-today").length;
    out.todayNumber = el().querySelector(".cairn-calendar-day.is-today .cairn-calendar-number")?.innerText.trim();
    out.componentsDay = (game.time.components.dayOfMonth ?? 0) + 1;

    // The statement about the day, and the clock's watch line. Both were made
    // much larger by ruling (2026-09-11) and both are measured rather than
    // trusted: a CSS rule that stops applying leaves no other trace.
    const px = (node) => (node ? Math.round(parseFloat(getComputedStyle(node).fontSize)) : -1);
    out.panelDateSize = px(el().querySelector(".cairn-calendar-date"));
    out.clockWatchSize = px(document.querySelector("#cairn-watch-clock .cairn-watch-watch"));

    // THE SAME DAY IN THE SAME WORDS. "The Dashboard should look like the
    // calendar" is a claim about two surfaces, so it takes a comparison and
    // not two separate readings. Red before 2026-09-11, when the band showed
    // the SHORT date ("6 Silence, 7728") against the panel's long one. Taken
    // now, while the panel is still showing today.
    out.panelDate = el().querySelector(".cairn-calendar-date")?.innerText.trim() ?? "";
    const dash = foundry.applications.instances.get("cairn-warden-dashboard");
    await dash?.render();
    out.bandDate = dash?.element.querySelector(".cairn-time-date")?.innerText.trim() ?? "";

    // EVERY month opens on Market Day — checked by walking all twelve, not
    // restated. This is the grid's half of the weekday claim leg 10 proves
    // against the source.
    out.firstWeekdays = [];
    const year = game.time.components.year + game.time.calendar.years.yearZero;
    for (let m = 0; m < 12; m++) {
      const built = gt.buildMonth({ year, month: m });
      out.firstWeekdays.push(built.days[0]?.weekdayName);
      out.perMonthCells = (out.perMonthCells ?? []).concat(built.length);
    }

    // All 24 festivals, from the probe's OWN list, walked month by month
    // through the rendered grid.
    out.misplaced = [];
    out.marked = 0;
    // RE-QUERY THE STEP BUTTON EVERY TIME. Each click re-renders the part, so
    // the element is replaced and a captured reference is detached — clicking
    // it does nothing, silently. The first pass held one reference and read the
    // same month over and over, which showed up as a tidy off-by-one rather
    // than as an obvious break.
    const stepTo = async (month) => {
      app.reset();
      await app.render();
      for (let i = 0; i < month - 1; i++) {
        el().querySelector('[data-action="nextMonth"]').click();
        await new Promise((r) => setTimeout(r, 60));
      }
      await new Promise((r) => setTimeout(r, 80));
      return el().querySelector(".cairn-calendar-month")?.innerText.trim();
    };
    out.monthsVisited = [];
    for (let m = 1; m <= 12; m++) {
      out.monthsVisited.push(await stepTo(m));
      const dotted = days().filter((d) => d.querySelector(".cairn-calendar-dot"))
        .map((d) => Number(d.dataset.day));
      out.marked += dotted.length;
      const wanted = new Set();
      for (const [fm, fd, , total] of festivals) {
        if (fm !== m) continue;
        for (let i = 0; i < total; i++) wanted.add(fd + i);
      }
      for (const d of wanted) if (!dotted.includes(d)) out.misplaced.push(`${m}/${d} unmarked`);
      for (const d of dotted) if (!wanted.has(d)) out.misplaced.push(`${m}/${d} marked, should not be`);
    }

    // The panel names the festival. Flood 5 is the Splash Festival, day 1 of 3.
    out.panelMonth = await stepTo(7);
    days().find((d) => Number(d.dataset.day) === 5)?.click();
    await new Promise((r) => setTimeout(r, 120));
    out.panelHeading = el().querySelector(".cairn-calendar-festival h4")?.innerText.trim();
    out.panelSpan = el().querySelector(".cairn-calendar-span")?.innerText.trim();
    out.panelText = el().querySelector(".cairn-calendar-festival-text")?.innerText.trim().slice(0, 40);
    out.gmSetButton = !!el().querySelector('[data-action="setToDay"]');

    // BROWSING SURVIVES A TIME ADVANCE. The whole point of holding the view on
    // the instance: `updateWorldTime` re-renders every open calendar, and a
    // context that re-derived from today would snap this back to Mourning.
    const before = {
      month: el().querySelector(".cairn-calendar-month")?.innerText.trim(),
      selected: el().querySelector(".cairn-calendar-day.is-selected")?.dataset.day,
    };
    // THE PRECONDITION, ASSERTED. Without it this leg compares "today's month"
    // with "today's month" and passes on a calendar that snaps back on every
    // render — which is exactly what it happened to do under its own control.
    // An assertion that is also true of the bug is not an assertion.
    out.todayMonthName = game.time.calendar.months.values[game.time.components.month].name;
    out.browsedAway = before.month !== gt.buildMonth({
      year: game.time.components.year + game.time.calendar.years.yearZero,
      month: game.time.components.month,
    }).monthName;
    const wasTime = game.time.worldTime;
    await game.time.advance(28800);
    await new Promise((r) => setTimeout(r, 400));
    out.browsedBefore = before;
    out.browsedAfter = {
      month: el().querySelector(".cairn-calendar-month")?.innerText.trim(),
      selected: el().querySelector(".cairn-calendar-day.is-selected")?.dataset.day,
    };
    await game.time.set(wasTime);
    await new Promise((r) => setTimeout(r, 300));

    // A SEASON BOUNDARY IS VISIBLE. Mourning 3 is the tail of Harvest and
    // Mourning 4 is the first day of Dead, so the two cells must differ and
    // the 4th must carry the Dead glyph — which is what makes a mid-month
    // boundary readable at all.
    app.reset();
    await app.render();
    await new Promise((r) => setTimeout(r, 80));
    const third = days().find((d) => Number(d.dataset.day) === 3);
    const fourth = days().find((d) => Number(d.dataset.day) === 4);
    out.tintsDiffer = third?.className !== fourth?.className;
    const mark = fourth?.querySelector(".cairn-calendar-season-mark");
    out.boundaryGlyph = mark ? [...mark.classList].find((c) => c.startsWith("fa-") && c !== "fa-solid") : null;
    out.boundaryResolves = mark ? getComputedStyle(mark, "::before").content : "";
    out.thirdHasMark = !!third?.querySelector(".cairn-calendar-season-mark");

    // The leap week: month 13, six cells, the Reclamation names, each with a
    // season. Year 7738 is the next Reclamation year after 7728.
    const leap = gt.buildMonth({ year: 7738, month: 12 });
    out.leap = {
      length: leap.length,
      names: leap.days.map((d) => d.reclamationName),
      seasons: leap.days.map((d) => d.seasonName).filter(Boolean).length,
    };

    app.close();
    return out;
  }, FESTIVALS);

  cal.focusBefore === "cairn-vald-calendar-next" && cal.focusAfter === "cairn-vald-calendar-next"
    ? ok("keyboard focus survives the calendar's re-render (a stable id core can restore, review #27)")
    : fail("focus is lost on the calendar's re-render",
      JSON.stringify({ before: cal.focusBefore, after: cal.focusAfter }));
  cal.isButton && cal.opened
    ? ok("with the hack on the clock is a button, and clicking it opens the calendar")
    : fail("the clock is the door", JSON.stringify({ isButton: cal.isButton, opened: cal.opened }));

  cal.cells === 24 && cal.weekdayHeads === 6 && cal.blanks === 0
    ? ok("the grid is 24 days under six weekday heads, with no leading blanks")
    : fail("grid shape", JSON.stringify({ cells: cal.cells, heads: cal.weekdayHeads, blanks: cal.blanks }));

  cal.firstWeekdays?.every((w) => w === "Market Day") && cal.perMonthCells?.every((n) => n === 24)
    ? ok("...and every one of the twelve months opens on Market Day", "walked, not restated")
    : fail("every month opens on Market Day", JSON.stringify(cal.firstWeekdays));

  cal.todayMarks === 1 && cal.todayNumber === String(cal.componentsDay)
    ? ok("today is circled exactly once, on the day game.time names", cal.todayNumber)
    : fail("today's marker", JSON.stringify({ marks: cal.todayMarks, on: cal.todayNumber, want: cal.componentsDay }));

  // The months VISITED are asserted too: without it a navigation that silently
  // stayed put would compare the wrong month against the right list and report
  // a tidy off-by-one, which is exactly how the first cut of this leg failed.
  const MONTHS = ["Mourning", "Silence", "Veil", "Sunrise", "Bright", "Ashfall",
    "Flood", "Highwater", "Rise", "Quell", "Bane", "Sunset"];
  JSON.stringify(cal.monthsVisited) === JSON.stringify(MONTHS)
    ? ok("the month arrows walk Mourning to Sunset in order")
    : fail("the month arrows", JSON.stringify(cal.monthsVisited));

  cal.misplaced?.length === 0 && cal.marked === 30
    ? ok("all 24 festivals land on their day, spans included", `${cal.marked} marked cells`)
    : fail("the festivals land on their days", JSON.stringify({ marked: cal.marked, wrong: cal.misplaced?.slice(0, 6) }));

  cal.panelMonth === "Flood" && cal.panelHeading === "Splash Festival"
    && /day 1 of 3/.test(cal.panelSpan ?? "") && (cal.panelText?.length ?? 0) > 10
    ? ok("picking Flood 5 shows the Splash Festival, day 1 of 3, with its text")
    : fail("the day panel", JSON.stringify({ h: cal.panelHeading, s: cal.panelSpan, t: cal.panelText }));

  cal.gmSetButton
    ? ok("...and the Warden sees Set the world to this day")
    : fail("the Warden's set button is missing");

  cal.browsedAway
    && cal.browsedAfter?.month === cal.browsedBefore?.month
    && cal.browsedAfter?.selected === cal.browsedBefore?.selected
    ? ok("the browsed month and the selected day survive a time advance",
      `${cal.browsedAfter?.month} ${cal.browsedAfter?.selected}, and it is NOT this month`)
    : fail("browsing survives a tick", JSON.stringify({
      browsedAway: cal.browsedAway, before: cal.browsedBefore, after: cal.browsedAfter,
    }));

  cal.panelDateSize >= 20 && cal.clockWatchSize >= 17
    ? ok("the day's own statement and the clock's watch line are big enough to read",
      `${cal.panelDateSize}px and ${cal.clockWatchSize}px`)
    : fail("the type is small again", JSON.stringify({
      panel: cal.panelDateSize, clock: cal.clockWatchSize,
    }));

  cal.bandDate && cal.bandDate === cal.panelDate
    ? ok("...and the Dashboard names today in the calendar's own words", cal.bandDate)
    : fail("the band and the panel disagree about today", JSON.stringify({
      band: cal.bandDate, panel: cal.panelDate,
    }));

  cal.tintsDiffer && cal.boundaryGlyph === "fa-skull" && !cal.thirdHasMark
    ? ok("Mourning 4 opens the Dead season: different tint, and it wears the glyph")
    : fail("the season boundary", JSON.stringify({
      differ: cal.tintsDiffer, glyph: cal.boundaryGlyph, thirdMarked: cal.thirdHasMark,
    }));

  // The glyph must RESOLVE, not merely be spelled. A wrong or Pro-only Font
  // Awesome class renders an empty box with no error at all.
  cal.boundaryResolves && cal.boundaryResolves !== "none" && cal.boundaryResolves !== '""'
    ? ok("...and that glyph actually renders", cal.boundaryResolves)
    : fail("the season glyph renders nothing", String(cal.boundaryResolves));

  cal.leap?.length === 6
    && JSON.stringify(cal.leap.names) === JSON.stringify(["Recognize", "Remember", "Reward", "Rejoice", "Relinquish", "Renew"])
    && cal.leap.seasons === 6
    ? ok("a Reclamation year gives six named days, each with a season")
    : fail("the leap week", JSON.stringify(cal.leap));

  /* ---- 7-8. a player sees it, and cannot move it ---------------------- */

  // A SECOND CONTEXT, not a second page: Foundry keys its session cookie per
  // origin, so two pages in one context are the same logged-in user.
  const alice = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
  const aliceErrors = watchErrors(alice);
  try {
    await joinAs(alice, "Alice");
    await dismissChrome(alice);

    const seen = await alice.evaluate(() => {
      const el = document.getElementById("cairn-watch-clock");
      return {
        isGM: game.user.isGM,
        present: !!el,
        text: el?.innerText.replace(/\s+/g, " ").trim() ?? null,
        // The door counts as a control, so it is excluded by name rather than
        // by giving up on the assertion: what this leg guards is that a player
        // has nothing that MOVES the clock, and opening a read-only calendar
        // is not that.
        movers: el
          ? [...el.querySelectorAll("button, a, input, select")]
            .filter((c) => c.dataset.action !== "openCalendar").length
          : -1,
      };
    });

    const gmText = await page.evaluate(() =>
      document.getElementById("cairn-watch-clock")?.innerText.replace(/\s+/g, " ").trim());

    !seen.isGM && seen.present && seen.text === gmText
      ? ok("a player sees the clock, reading the same watch as the Warden", seen.text)
      : fail("a player sees the clock", JSON.stringify({ seen, gmText }));

    seen.movers === 0
      ? ok("...with nothing on it that could move the clock")
      : fail("the player's clock has controls that move it", String(seen.movers));

    // The enforcement, not the affordance: `core.time` is world-scoped, so the
    // SERVER refuses. If this ever passes, a player can move everyone's clock.
    const denied = await alice.evaluate(async () => {
      const before = game.time.worldTime;
      let threw = false;
      try { await game.time.advance(28800); } catch { threw = true; }
      await new Promise((r) => setTimeout(r, 800));
      return { before, after: game.time.worldTime, threw };
    });

    denied.after === denied.before
      ? ok("a player cannot move the world clock", denied.threw ? "refused" : "no change")
      : fail("a player moved the world clock", JSON.stringify(denied));

    // The SERVER's refusal, and asserting it POSITIVELY is the stronger half:
    // "nothing changed" would also be true if the call had silently done
    // nothing on the client and never reached the server at all.
    const refusal = /lacks permission to update Setting/i;
    // POLL FOR IT. The console error is relayed back from the server, so it
    // lands some time AFTER the client's own promise rejects — a fixed sleep
    // made this leg red under load with nothing wrong, which is the "fails
    // once, passes on re-run" shape this repo treats as a race and not a flake.
    for (let i = 0; i < 40 && !aliceErrors.some((e) => refusal.test(e)); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const refused = aliceErrors.filter((e) => refusal.test(e));
    refused.length === 1
      ? ok("...and the refusal came from the SERVER, not from a client-side guard")
      : fail("the server refused the write", JSON.stringify(aliceErrors).slice(0, 300));


    /* ---- 25-27. the weather of the day reaches the player --------------- */

    // THE ONLY WAY TO PROVE THE `onChange` REACHES OTHER CLIENTS is to write
    // the real setting and read it on a second client. A shadow cannot: it
    // lives in one page. The value is internal and restored in the `finally`
    // below, and the world's calendar setting is never touched.
    const weatherStart = await page.evaluate(() =>
      game.settings.get("air-bladder", "vald-weather-today"));

    try {
      // The clock's FOURTH LINE, absent while nobody has called the weather.
      // The player list's position is read now and again after, because the
      // whole reason a fourth line is safe is that the panel takes the
      // column's slack and grows UPWARD.
      const playersBefore = await alice.evaluate(() =>
        Math.round(document.getElementById("players")?.getBoundingClientRect().top ?? -1));
      // ESTABLISHED, not assumed: "no weather yet" is world state, and a
      // previous run that left the day's weather set (2026-09-12, "Then hail"
      // from the log legs, surviving the sweep at the end) made this leg red
      // for a reason that was never the clock's. Clear it and let the clock
      // drop its line before reading; `weatherStart` above still restores
      // whatever the world held.
      await page.evaluate(async () => {
        const gt = await import("/systems/air-bladder/module/game-time.js");
        await gt.setTodayWeather("");
      });
      for (let i = 0; i < 30; i++) {
        if (!(await alice.evaluate(() => !!document.querySelector("#cairn-watch-clock .cairn-watch-weather")))) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const lineBefore = await alice.evaluate(() =>
        !!document.querySelector("#cairn-watch-clock .cairn-watch-weather"));

      // ARM A LISTENER FIRST. The setting's VALUE syncs to every client on its
      // own — that is Foundry, not us — so reading it back proves nothing about
      // the `onChange`. What the onChange buys is the NOTIFICATION, and the
      // only way to see it is to listen for the hook it fires. Removing the
      // onChange reds this leg and nothing else does.
      await alice.evaluate(() => {
        window.__abWeatherHook = 0;
        Hooks.on("cairnWeatherChanged", () => { window.__abWeatherHook += 1; });
      });

      await page.evaluate(async () => {
        const gt = await import("/systems/air-bladder/module/game-time.js");
        await gt.setTodayWeather("A rain of ash");
      });
      await alice.waitForFunction(() => window.__abWeatherHook > 0, null, { timeout: 5000 })
        .catch(() => {});

      const told = await alice.evaluate(() => ({
        stored: game.settings.get("air-bladder", "vald-weather-today"),
        hookFired: window.__abWeatherHook,
      }));
      told.stored?.text === "A rain of ash" && told.hookFired > 0
        ? ok("the Warden's weather reaches a player's client, and tells it to redraw",
          `hook fired ${told.hookFired}x`)
        : fail("the weather's onChange reached the player", JSON.stringify(told));

      // The clock line itself, which is what the `onChange` has to refresh —
      // the setting arriving is necessary and not sufficient.
      const clockLine = await alice.evaluate(async () => {
        const gt = await import("/systems/air-bladder/module/game-time.js");
        const settings = game.settings;
        const realGet = settings.get.bind(settings);
        settings.get = (ns, key, ...rest) =>
          (ns === "air-bladder" && key === "enable-vald-calendar" ? true : realGet(ns, key, ...rest));
        const prevConfig = CONFIG.time.worldCalendarConfig;
        const prevClass = CONFIG.time.worldCalendarClass;
        CONFIG.time.worldCalendarConfig = gt.VALD_CALENDAR_CONFIG;
        CONFIG.time.worldCalendarClass = gt.ValdCalendar;
        game.time.initializeCalendar();
        try {
          const wc = await import("/systems/air-bladder/module/watch-clock.js");
          await wc.refreshWatchClock();
          const el = document.querySelector("#cairn-watch-clock .cairn-watch-weather");
          return { text: el?.innerText.replace(/\s+/g, " ").trim() ?? null };
        } finally {
          settings.get = realGet;
          CONFIG.time.worldCalendarConfig = prevConfig;
          CONFIG.time.worldCalendarClass = prevClass;
          game.time.initializeCalendar();
          const wc = await import("/systems/air-bladder/module/watch-clock.js");
          await wc.refreshWatchClock();
        }
      });

      !lineBefore && /A rain of ash/.test(clockLine.text ?? "")
        ? ok("...and the clock renders a fourth line carrying it", clockLine.text)
        : fail("the clock's weather line", JSON.stringify({ before: lineBefore, after: clockLine }));

      const playersAfter = await alice.evaluate(() =>
        Math.round(document.getElementById("players")?.getBoundingClientRect().top ?? -1));
      playersAfter === playersBefore
        ? ok("...and the player list did not move", `top ${playersAfter}`)
        : fail("the player list moved", `${playersBefore} -> ${playersAfter}`);

      // EMPTY MEANS UNCALLED, which is how a Warden undoes a mistake.
      await page.evaluate(async () => {
        const gt = await import("/systems/air-bladder/module/game-time.js");
        await gt.setTodayWeather("   ");
      });
      await alice.waitForFunction(
        () => !game.settings.get("air-bladder", "vald-weather-today")?.text,
        null, { timeout: 5000 },
      ).catch(() => {});
      const cleared = await alice.evaluate(() =>
        game.settings.get("air-bladder", "vald-weather-today")?.text);
      !cleared
        ? ok("clearing the field puts the weather back to uncalled")
        : fail("clearing the weather", JSON.stringify(cleared));

      // IT GOES STALE BY ITSELF. Stored against the absolute day, so advancing
      // a day is enough — nothing clears it and no hook watches midnight.
      const stale = await page.evaluate(async () => {
        const gt = await import("/systems/air-bladder/module/game-time.js");
        await gt.setTodayWeather("Thunderstorms");
        const here = gt.todayWeather();
        const was = game.time.worldTime;
        await game.time.advance(86400);
        await new Promise((r) => setTimeout(r, 400));
        const tomorrow = gt.todayWeather();
        await game.time.set(was);
        await new Promise((r) => setTimeout(r, 300));
        return { here, tomorrow };
      });
      stale.here === "Thunderstorms" && stale.tomorrow === ""
        ? ok("the weather goes stale on its own when the day turns over")
        : fail("the weather goes stale", JSON.stringify(stale));

      // A PLAYER CANNOT WRITE IT. The setting is world-scoped, so the SERVER
      // refuses — the same wall that protects the clock.
      const refusedWeather = await alice.evaluate(async () => {
        let threw = false;
        try { await game.settings.set("air-bladder", "vald-weather-today", { day: 1, text: "x" }); }
        catch { threw = true; }
        await new Promise((r) => setTimeout(r, 600));
        return { threw, text: game.settings.get("air-bladder", "vald-weather-today")?.text };
      });
      refusedWeather.text !== "x"
        ? ok("a player cannot call the weather", refusedWeather.threw ? "refused" : "no change")
        : fail("a player wrote the weather", JSON.stringify(refusedWeather));
    } finally {
      await page.evaluate((v) =>
        game.settings.set("air-bladder", "vald-weather-today", v), weatherStart);
    }

    /* ---- 28. the Warden's own days on the calendar ---------------------- */

    // Taken BEFORE anything is created, so the sweep at the end of 29 removes
    // the event journals as well as the log's — by ID DIFFERENCE, never by
    // name, so a world with journals of its own is untouched.
    const journalsBefore = await page.evaluate(() => ({
      journals: game.journal.contents.map((j) => j.id),
    }));

    // Built through the DIALOG rather than by writing a page, because the
    // dialog is where this feature can actually break: DialogV2 sanitizes a
    // string it is handed, so a form built as markup loses every listener and
    // the fields come back empty. The form is an ELEMENT for that reason and
    // this is the leg that would notice if it stopped being one.
    const evented = await withValdOn(page, async (gt) => {
      const vc = await import("/systems/air-bladder/module/vald-calendar.js");
      const ce = await import("/systems/air-bladder/module/calendar-events.js");
      const out = {};
      await vc.openValdCalendar();
      const app = foundry.applications.instances.get("cairn-vald-calendar");
      app.reset();
      await app.render();
      const el = () => app.element;

      const add = async (fill) => {
        const dialogsBefore = new Set(foundry.applications.instances.keys());
        el().querySelector('[data-action="addEvent"]').click();
        let dialog = null;
        for (let i = 0; i < 40 && !dialog; i++) {
          await new Promise((r) => setTimeout(r, 50));
          const id = [...foundry.applications.instances.keys()].find((k) => !dialogsBefore.has(k));
          dialog = id ? foundry.applications.instances.get(id) : null;
        }
        if (!dialog) return false;
        const root = dialog.element;
        fill(root);
        root.querySelector('button[data-action="add"]').click();
        await new Promise((r) => setTimeout(r, 500));
        return true;
      };

      // Pick a day the Guide marks with nothing, so a festival cannot be
      // mistaken for the event: Mourning 2.
      el().querySelector('.cairn-calendar-day[data-day="2"]').click();
      await new Promise((r) => setTimeout(r, 150));

      out.dialogOpened = await add((root) => {
        root.querySelector("[name=name]").value = "ZZ Probe Moot";
        root.querySelector("[name=text]").value = "The elders meet.";
        root.querySelector("[name=watch]").value = "1";
        root.querySelector("[name=days]").value = "3";
      });

      await app.render();
      const cell = (n) => el().querySelector(`.cairn-calendar-day[data-day="${n}"]`);
      out.marked = [2, 3, 4].map((n) => !!cell(n)?.querySelector(".cairn-calendar-dot.is-warden"));
      out.notMarked = !!cell(5)?.querySelector(".cairn-calendar-dot.is-warden");
      out.panel = el().querySelector(".cairn-calendar-festival.is-warden h4")?.innerText.trim();
      out.panelWatch = [...el().querySelectorAll(".cairn-calendar-festival.is-warden .cairn-calendar-span")]
        .map((p) => p.innerText.trim()).join(" | ");

      // A HIDDEN one goes into the other journal, which the server never sends
      // to a player. That is the wall; a flag on a visible page would not be.
      el().querySelector('.cairn-calendar-day[data-day="6"]').click();
      await new Promise((r) => setTimeout(r, 150));
      await add((root) => {
        root.querySelector("[name=name]").value = "ZZ Probe Secret";
        root.querySelector("[name=shared]").checked = false;
      });

      // Found by their own flags, which is how the module finds them too.
      const of = (kind) => game.journal.find((j) => j.flags?.["air-bladder"]?.calendarEvents === kind);
      out.entries = { shared: of("shared")?.id ?? "", hidden: of("hidden")?.id ?? "" };
      out.sharedName = of("shared")?.name ?? null;
      out.hiddenOwnership = of("hidden")?.ownership?.default;

      // A YEAR-STAMPED event belongs to its year alone. The "every year" box
      // was left unticked above, so this one is 7728's.
      const nextYear = await ce.marksByDay(7729);
      out.nextYearHasMoot = [...nextYear.values()].flat().some((m) => m.name === "ZZ Probe Moot");
      out.thisYearHasMoot = [...(await ce.marksByDay(7728)).values()].flat()
        .some((m) => m.name === "ZZ Probe Moot");
      app.close();
      return out;
    });

    evented.dialogOpened
      ? ok("the Warden's Add an event dialog opens and its fields are live")
      : fail("the add-event dialog", JSON.stringify(evented));

    JSON.stringify(evented.marked) === JSON.stringify([true, true, true]) && !evented.notMarked
      ? ok("...and a three-day event marks exactly its three days")
      : fail("the event's days", JSON.stringify({ marked: evented.marked, next: evented.notMarked }));

    evented.panel === "ZZ Probe Moot" && /Afternoon Watch/.test(evented.panelWatch)
      ? ok("...with the panel naming it and the watch it happens in", evented.panelWatch)
      : fail("the event panel", JSON.stringify({ h: evented.panel, w: evented.panelWatch }));

    evented.thisYearHasMoot && !evented.nextYearHasMoot
      ? ok("...and a dated event belongs to its own year, not to every year")
      : fail("the event's year", JSON.stringify(evented));

    evented.hiddenOwnership === 0
      ? ok("...and the hidden journal is ownership NONE")
      : fail("the hidden events journal is not concealed", JSON.stringify(evented));

    // WHAT THE PLAYER ACTUALLY HAS, and the assertion says the true thing
    // rather than the flattering one. MEASURED: an ownership-NONE JournalEntry
    // IS still sent to a player — it resolves on their client, pages and all.
    // What NONE gives is `visible: false` and a failing permission test, so it
    // is off their sidebar and off their calendar. Asserting "the client never
    // received it" would have been green on nothing and would have written a
    // promise of secrecy into this file.
    const aliceSees = await alice.evaluate(async (ids) => {
      const ce = await import("/systems/air-bladder/module/calendar-events.js");
      const shared = game.journal.get(ids.shared);
      const hidden = game.journal.get(ids.hidden);
      const marks = [...(await ce.marksByDay(7728)).values()].flat().map((m) => m.name);
      return {
        shared: !!shared,
        sharedVisible: !!shared?.visible,
        sharedPages: shared?.pages?.map((p) => p.name) ?? [],
        hiddenVisible: !!hidden?.visible,
        hiddenReadable: !!hidden?.testUserPermission(game.user, "OBSERVER"),
        marks,
      };
    }, evented.entries);

    aliceSees.shared && aliceSees.sharedVisible && aliceSees.sharedPages.includes("ZZ Probe Moot")
      && aliceSees.marks.includes("ZZ Probe Moot")
      ? ok("a player's calendar carries the Warden's event")
      : fail("the event did not reach the player", JSON.stringify(aliceSees));

    !aliceSees.hiddenVisible && !aliceSees.hiddenReadable
      && !aliceSees.marks.includes("ZZ Probe Secret")
      ? ok("...and a hidden one is off her calendar and off her sidebar", "concealed, not encrypted")
      : fail("a hidden event shows on the player's calendar", JSON.stringify(aliceSees));

    // A REVEAL REACHES AN OPEN CALENDAR (review #27). A page's visibility is
    // its ENTRY's ownership, and the Warden raising the hidden journal through
    // core's ownership dialog fires `updateJournalEntry` — on the entry, on no
    // page — which the calendar did not follow: Alice's open window gained no
    // marker until the next watch tick. Both directions, so the hook is what
    // is measured and not a stray re-render.
    await alice.evaluate(async () => {
      const vc = await import("/systems/air-bladder/module/vald-calendar.js");
      await vc.openValdCalendar();
      for (let i = 0; i < 40 && !document.getElementById("cairn-vald-calendar"); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    const secretDot = () => alice.evaluate(() =>
      !!document.querySelector('#cairn-vald-calendar .cairn-calendar-day[data-day="6"] .cairn-calendar-dot.is-warden'));
    const dotBefore = await secretDot();
    await page.evaluate((id) =>
      game.journal.get(id)?.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }), evented.entries.hidden);
    let dotRevealed = false;
    for (let i = 0; i < 30 && !dotRevealed; i++) {
      dotRevealed = await secretDot();
      if (!dotRevealed) await new Promise((r) => setTimeout(r, 100));
    }
    await page.evaluate((id) =>
      game.journal.get(id)?.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }), evented.entries.hidden);
    let dotHiddenAgain = false;
    for (let i = 0; i < 30 && !dotHiddenAgain; i++) {
      dotHiddenAgain = !(await secretDot());
      if (!dotHiddenAgain) await new Promise((r) => setTimeout(r, 100));
    }
    await alice.evaluate(async () => {
      const vc = await import("/systems/air-bladder/module/vald-calendar.js");
      await vc._calendarApp()?.close();
    });
    !dotBefore && dotRevealed && dotHiddenAgain
      ? ok("revealing the hidden journal reaches her OPEN calendar, and hiding it again does too")
      : fail("an ownership change on the hidden journal did not re-render the player's calendar",
        JSON.stringify({ dotBefore, dotRevealed, dotHiddenAgain }));

    // A PLAYER CANNOT ADD ONE: no control on her window, and the module's own
    // guard refuses a direct call.
    const aliceTried = await alice.evaluate(async () => {
      const ce = await import("/systems/air-bladder/module/calendar-events.js");
      const made = await ce.promptAddEvent({ year: 7728, month: 0, day: 8 });
      return { made: !!made };
    });
    !aliceTried.made
      ? ok("...and a player cannot add one")
      : fail("a player added a calendar event", JSON.stringify(aliceTried));

    /* ---- 29. the weather log ------------------------------------------- */

    // THE CONTROL FIRST, and it runs before anything switches the log on so it
    // cannot pass on a world that already had one: with the setting off, the
    // weather changing writes nothing at all.
    const logOff = await page.evaluate(async () => {
      const gt = await import("/systems/air-bladder/module/game-time.js");
      const had = game.journal.size;
      await gt.setTodayWeather("Control: no log expected");
      await new Promise((r) => setTimeout(r, 1200));
      await gt.setTodayWeather("");
      return {
        had,
        now: game.journal.size,
        entry: !!game.journal.contents.find((j) => j.flags?.["air-bladder"]?.weatherLog),
      };
    });

    logOff.now === logOff.had && !logOff.entry
      ? ok("with the log switched off, calling the weather writes no journal")
      : fail("the log wrote while switched off", JSON.stringify(logOff));

    // SHADOWED, not written: `logEnabled()` reads the setting on this client,
    // and this is the client the active-GM guard lets write.
    const logged = await page.evaluate(async () => {
      const settings = game.settings;
      const realGet = settings.get.bind(settings);
      settings.get = (ns, key, ...rest) =>
        (ns === "air-bladder" && key === "weather-log" ? true : realGet(ns, key, ...rest));
      try {
        const gt = await import("/systems/air-bladder/module/game-time.js");
        // POLL FOR THE JOURNAL, by its flag rather than its name or the stored
        // id. AWAITING `game.settings.set` DOES NOT GUARANTEE THE NEXT `get`
        // SEES THE NEW VALUE — measured here, intermittently, and it is the
        // same race that made `game.time.advance` look like a no-op earlier in
        // this file. So nothing downstream may read a setting it just wrote.
        const log = () => game.journal.contents.find((j) => j.flags?.["air-bladder"]?.weatherLog);
        await gt.setTodayWeather("Sleet, and a wind off the water");
        for (let i = 0; i < 60 && !log(); i++) await new Promise((r) => setTimeout(r, 100));
        const entry = log();

        // ...and again on the same day: the weather CHANGED, so the log gains a
        // line rather than losing the old one.
        const lines = () => (entry?.pages?.contents?.[0]?.text?.content?.match(/<li>/g) ?? []).length;
        await gt.setTodayWeather("Then hail");
        for (let i = 0; i < 60 && lines() < 2; i++) await new Promise((r) => setTimeout(r, 100));
        const id = entry?.id;
        const page0 = entry?.pages?.contents?.[0];

        // THE ACTIVE-GM GUARD. The hook fires on every client that hears the
        // setting change, so without it a table with two Wardens logs twice.
        // Shadowed rather than proved with a second GM client: pointing
        // `activeGM` at somebody else is the same test and logs nobody out.
        const wl = await import("/systems/air-bladder/module/weather-log.js");
        Object.defineProperty(game.users, "activeGM", { value: { id: "someone-else" }, configurable: true });
        const before = page0?.text?.content ?? "";
        await wl.recordWeather();
        await new Promise((r) => setTimeout(r, 300));
        const after = entry?.pages?.contents?.[0]?.text?.content ?? "";
        // An OWN property shadowing the collection's getter, deleted again —
        // never a user logged out, which is the other way to move activeGM and
        // is not a thing a probe may do to a live world.
        delete game.users.activeGM;

        return {
          id,
          name: entry?.name,
          ownership: entry?.ownership?.default,
          pages: entry?.pages?.size,
          pageName: page0?.name,
          lines: (page0?.text?.content?.match(/<li>/g) ?? []).length,
          content: page0?.text?.content ?? "",
          otherGmWrote: before !== after,
        };
      } finally {
        settings.get = realGet;
      }
    });

    logged.pages === 1 && logged.lines === 2
      ? ok("the log writes a line each time the weather is called", `${logged.lines} lines on "${logged.pageName}"`)
      : fail("the log's lines", JSON.stringify({ pages: logged.pages, lines: logged.lines }));

    /Sleet, and a wind off the water/.test(logged.content)
      && /Mourning/.test(logged.content) && /Watch/.test(logged.content)
      && /season/.test(logged.content)
      ? ok("...carrying the date, the watch, the season and the weather")
      : fail("the log line is missing something", logged.content.slice(0, 200));

    !logged.otherGmWrote
      ? ok("...and only the ACTIVE Warden writes it, so two Wardens do not log twice")
      : fail("a second Warden wrote the log too", "the activeGM guard is gone");

    const aliceReads = await alice.evaluate((id) => {
      const entry = game.journal.get(id);
      return { has: !!entry, lines: (entry?.pages?.contents?.[0]?.text?.content?.match(/<li>/g) ?? []).length };
    }, logged.id);

    aliceReads.has && aliceReads.lines === 2
      ? ok("...and the whole table can read it")
      : fail("the log did not reach the player", JSON.stringify(aliceReads));

    /* ---- a player's DECOY is not the log (review #27) -------------------- */

    // The log is found by its flag, and a flag sits on a document any TRUSTED
    // player may create. A player's journal flagged like ours and found first
    // captured every line the Warden wrote into a document the player owns.
    // The module now vouches for its journals by `_stats.lastModifiedBy`, which
    // the SERVER stamps (14.365 has no `createdBy` — the review's field, and
    // the first cut of this fix used it: false for every journal, a fresh log
    // on every write, twelve legs red). Alice is raised to TRUSTED for the leg and put back; the
    // real log is deleted first so the decoy is the ONLY flagged journal, which
    // is the arrangement a broken build fails on.
    const decoy = await (async () => {
      // Alice is a PLAYER by dev:players' contract — ESTABLISHED here, not
      // captured: the first cut captured her role and "restored" it, and one
      // run that ended between the raise and the restore left her TRUSTED for
      // every probe after it (playergen's relay legs went quietly onto the
      // direct path and reported a wire that never existed, 2026-09-12). The
      // restore lives in a finally now and puts back PLAYER, whatever it found.
      const roleBefore = await page.evaluate(() => game.users.getName("Alice")?.role ?? null);
      if (roleBefore !== 1) note(`Alice was role ${roleBefore}, not PLAYER — an earlier run leaked it; set back after this leg`);
      // A ROLE CHANGE LOGS THAT USER OUT (core User#_onUpdate: a changed role
      // or password "must re-authenticate", user.mjs:364), so Alice's page
      // leaves /game the moment the Warden's write lands, and an evaluate on
      // it mid-navigation dies with "Execution context was destroyed" — which
      // is how one run ended short of its restore and left her TRUSTED for
      // every probe after it. Rejoin her after each change; a sleep does not
      // survive a logout, and neither does a waitForFunction on `game.ready`.
      const rejoin = async (role) => {
        await new Promise((r) => setTimeout(r, 800));
        await joinAs(alice, "Alice");
        const got = await alice.evaluate(() => game.user.role);
        if (got !== role) note(`Alice rejoined as role ${got}, expected ${role}`);
      };
      try {
      await page.evaluate(async (id) => {
        await game.journal.get(id)?.delete();
        await game.users.getName("Alice")?.update({ role: CONST.USER_ROLES.TRUSTED });
      }, logged.id);
      await rejoin(2);
      const decoyId = await alice.evaluate(async () => {
        const j = await getDocumentClass("JournalEntry").create({
          name: "ZZ Decoy Weather Log", flags: { "air-bladder": { weatherLog: true } },
        });
        return j?.id ?? null;
      });
      const result = await page.evaluate(async (decoyId) => {
        const settings = game.settings;
        const realGet = settings.get.bind(settings);
        settings.get = (ns, key, ...rest) =>
          (ns === "air-bladder" && key === "weather-log" ? true : realGet(ns, key, ...rest));
        try {
          const wl = await import("/systems/air-bladder/module/weather-log.js");
          const logs = () => game.journal.filter((j) => j.flags?.["air-bladder"]?.weatherLog);
          await wl.recordWeather();
          for (let i = 0; i < 40 && logs().length < 2; i++) await new Promise((r) => setTimeout(r, 100));
          const decoyDoc = game.journal.get(decoyId);
          const mine = logs().filter((j) => j.id !== decoyId);
          const out = {
            decoyExists: !!decoyDoc,
            decoyCreatedByGM: !!game.users.get(decoyDoc?._stats?.lastModifiedBy)?.isGM,
            decoyPages: decoyDoc?.pages?.size ?? -1,
            wardenLogs: mine.length,
            wardenLogPages: mine[0]?.pages?.size ?? 0,
            wardenLogByGM: !!game.users.get(mine[0]?._stats?.lastModifiedBy)?.isGM,
          };
          for (const j of [decoyDoc, ...mine]) await j?.delete();
          return out;
        } finally {
          settings.get = realGet;
        }
      }, decoyId);
      return result;
      } finally {
        await page.evaluate(() => game.users.getName("Alice")?.update({ role: CONST.USER_ROLES.PLAYER }));
        await rejoin(1).catch((e) => note(`Alice's rejoin after the restore failed: ${e.message}`));
      }
    })();
    decoy.decoyExists && !decoy.decoyCreatedByGM && decoy.decoyPages === 0
      && decoy.wardenLogs === 1 && decoy.wardenLogPages === 1 && decoy.wardenLogByGM
      ? ok("a player's flagged decoy captures nothing: the Warden's line lands in a journal a Warden made")
      : fail("the log wrote into a player's decoy journal", JSON.stringify(decoy));

    /* ---- two writes at once make ONE journal and TWO lines --------------- */

    // The active-GM guard settles WHICH CLIENT writes. It says nothing about
    // two writes racing ON that client, and every step of the log is a
    // find-then-create or a read-then-update across an `await`: the journal,
    // the month's page, and the page text. `cairnWeatherChanged` starts
    // `recordWeather` without awaiting it and `setTodayWeather` resolves as
    // soon as the SETTING write lands, so a second change can arrive while the
    // first create is still in flight. Both then find nothing and create — two
    // journals both flagged as the log, or a second line clobbering the first.
    // Once two exist the split is permanent and silent.
    //
    // FIRED WITHOUT AWAITING BETWEEN THEM, which is the only way to reproduce
    // it: awaiting the first serialises the very thing under test, and the leg
    // would pass on the broken build. Same trap as the controlled token in the
    // dashboard probe.
    const raced = await page.evaluate(async () => {
      const settings = game.settings;
      const realGet = settings.get.bind(settings);
      // FORWARD EVERY ARGUMENT. `#setWorld` asks `get(ns, key, {document: true})`
      // for the Setting DOCUMENT; a two-argument shadow hands back a plain
      // value, `current?._id` is undefined, and core CREATES A SECOND Setting
      // document instead of updating the first — 131 of those were swept out of
      // this world once already.
      settings.get = (ns, key, ...rest) =>
        (ns === "air-bladder" && key === "weather-log" ? true : realGet(ns, key, ...rest));
      try {
        const wl = await import("/systems/air-bladder/module/weather-log.js");
        const logs = () => game.journal.contents
          .filter((j) => j.flags?.["air-bladder"]?.weatherLog);
        // Start from no log at all, so the create is genuinely contended.
        const existing = logs().map((j) => j.id);
        if (existing.length) await getDocumentClass("JournalEntry").deleteDocuments(existing);
        await new Promise((r) => setTimeout(r, 300));

        const a = wl.recordWeather();
        const b = wl.recordWeather();
        await Promise.all([a, b]);
        await new Promise((r) => setTimeout(r, 600));

        const found = logs();
        const entry = found[0];
        return {
          journals: found.length,
          pages: entry?.pages?.size ?? 0,
          lines: (entry?.pages?.contents?.[0]?.text?.content?.match(/<li>/g) ?? []).length,
        };
      } finally {
        settings.get = realGet;
      }
    });

    raced.journals === 1
      ? ok("two weather writes at once make exactly ONE log journal")
      : fail("two weather writes at once make exactly ONE log journal",
        `${raced.journals} journals — the find-then-create is not serialized`);
    raced.pages === 1
      ? ok("...and exactly one page for the month")
      : fail("...and exactly one page for the month", `${raced.pages} pages`);
    raced.lines === 2
      ? ok("...keeping BOTH lines, so neither write is lost")
      : fail("...keeping BOTH lines, so neither write is lost",
        `${raced.lines} lines — a second write read the page before the first landed`);

    /* ---- cleanup for 28 and 29 ------------------------------------------ */

    // THE WEATHER GOES BACK TOO. The log legs above call it several times, and
    // a run that left it set made the NEXT run's "the clock has no weather line
    // yet" leg red for a reason that was entirely this file's own fault.
    const sweptHere = await page.evaluate(async (b) => {
      const ids = game.journal.contents.filter((j) => !b.journals.includes(j.id)).map((j) => j.id);
      if (ids.length) await getDocumentClass("JournalEntry").deleteDocuments(ids);
      await game.settings.set("air-bladder", "vald-weather-today", { day: 0, text: "" });
      return ids.length;
    }, journalsBefore);
    note(`removed ${sweptHere} journal(s) this probe created`);

    // Everything else must still be clean. The two refusals above — the clock
    // and the weather — are expected and are the only console errors this
    // probe is allowed to provoke. COMPUTED HERE, after every leg that could
    // add one: reading the list before the weather legs ran would have left
    // their errors unchecked while still printing green.
    const others = aliceErrors.filter((e) => !refusal.test(e));
    others.length === 0
      ? ok("zero other console errors on the player's client")
      : fail("player console errors", JSON.stringify(others).slice(0, 300));
  } finally {
    await alice.context().close();
  }

  /* ---- restore --------------------------------------------------------- */

  const restored = await page.evaluate(async (t) => {
    foundry.applications.instances.get("cairn-warden-dashboard")?.close();
    await game.time.set(t);
    await new Promise((r) => setTimeout(r, 300));
    return game.time.worldTime;
  }, startTime);

  restored === startTime
    ? note(`world time restored to ${startTime}`)
    : fail("world time restored", `${restored} != ${startTime}`);

  errors.length === 0 ? ok("zero console errors") : fail("console errors", JSON.stringify(errors).slice(0, 400));
} finally {
  await browser.close();
}

console.log(failed ? "\nvald time probe FAILED" : "\nvald time probe passed");
process.exit(failed ? 1 : 0);

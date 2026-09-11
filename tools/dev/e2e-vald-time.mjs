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
  settings.get = (ns, key) =>
    (ns === "air-bladder" && key === "enable-vald-calendar" ? true : realGet(ns, key));
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
    // POLL rather than sleep: this is socket-synced, and a fixed wait here
    // would be the race this repo's rules say never to call a flake.
    let after = before;
    for (let i = 0; i < 60 && after === before; i++) {
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
    settings.get = (ns, key) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? false : realGet(ns, key));
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
      return {
        bandIsFirstChild: content.firstElementChild === band,
        bandHeight: Math.round(band.getBoundingClientRect().height),
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

  off.tabs === 6
    ? ok("the tab strip is still six — the band is furniture, not a seventh tab")
    : fail("six tabs", String(off.tabs));

  off.bandIsFirstChild
    ? ok("the time band is the first child of .window-content")
    : fail("the band is the window's first band", JSON.stringify(off));

  // The `flex: 1` trap: with two PARTS the restored rule would give the band
  // half the window. A third is generous; in practice it sits near a fifth.
  off.bandHeight > 0 && off.bandHeight < off.contentHeight / 3
    ? ok("the band takes its own height, not half the window",
      `${off.bandHeight}px of ${off.contentHeight}px`)
    : fail("the band is stretching", `${off.bandHeight}px of ${off.contentHeight}px`);

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
    settings.get = (ns, key) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? true : realGet(ns, key));
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
      return { heads, valdButtons, valdPairs, seen };
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

  // Cairn's four must SURVIVE — alongside, never replacing (user ruling).
  on.heads.filter((h) => h === "Weather").length === 1
    ? ok("...and Cairn's own Weather group is still there beside it")
    : fail("Cairn's weather group survives", JSON.stringify(on.heads));

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
    settings.get = (ns, key) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? true : realGet(ns, key));
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
    settings.get = (ns, key) =>
      (ns === "air-bladder" && key === "enable-vald-calendar" ? false : realGet(ns, key));
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

    // Shape. `leadingBlanks` is COMPUTED from the first day's weekday, so a
    // zero here is a result and not a restatement of the config.
    out.weekdayHeads = el().querySelectorAll(".cairn-calendar-weekday").length;
    out.cells = days().length;
    out.blanks = el().querySelectorAll(".cairn-calendar-blank").length;
    out.todayMarks = el().querySelectorAll(".cairn-calendar-day.is-today").length;
    out.todayNumber = el().querySelector(".cairn-calendar-day.is-today .cairn-calendar-number")?.innerText.trim();
    out.componentsDay = (game.time.components.dayOfMonth ?? 0) + 1;

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

  cal.tintsDiffer && cal.boundaryGlyph === "fa-snowflake" && !cal.thirdHasMark
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
        settings.get = (ns, key) =>
          (ns === "air-bladder" && key === "enable-vald-calendar" ? true : realGet(ns, key));
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

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
      turnTime: CONFIG.time.turnTime,
      roundTime: CONFIG.time.roundTime,
      watchKeys: gt.WATCH_KEYS.length,
    };
  });

  base.calendar === "Simplified Gregorian" && base.valdOn === false
    ? ok("a default world is still on Foundry's own calendar", base.calendar)
    : fail("a default world is still on Foundry's own calendar", JSON.stringify(base));

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

  const readDash = () => page.evaluate(() => {
    const app = document.getElementById("cairn-warden-dashboard");
    const content = app.querySelector(".window-content");
    const band = app.querySelector(".cairn-dashboard-time");
    return {
      bandIsFirstChild: content.firstElementChild === band,
      bandHeight: Math.round(band.getBoundingClientRect().height),
      contentHeight: Math.round(content.getBoundingClientRect().height),
      tabs: app.querySelectorAll(".cairn-dashboard-tabs .item").length,
      rollButtons: app.querySelectorAll('button[data-action="rollTable"]').length,
      showButtons: app.querySelectorAll('button[data-action="showTable"]').length,
      pairs: app.querySelectorAll(".cairn-dashboard-pair").length,
      valdButtons: [...app.querySelectorAll('button[data-action="rollTable"]')]
        .map((b) => b.dataset.table).filter((t) => t && t.includes("Vald - Weather")).length,
      weatherTable: app.querySelector('.cairn-time-weather button[data-action="rollTable"]')
        ?.dataset.table ?? null,
      timeButtons: app.querySelectorAll(".cairn-time-controls button").length,
      notTypeButton: [...app.querySelectorAll(".cairn-dashboard-time button")]
        .filter((b) => b.getAttribute("type") !== "button").length,
    };
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

  off.timeButtons === 5
    ? ok("five clock controls: back, watch, day, next morning, set the date")
    : fail("five clock controls", String(off.timeButtons));

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
        controls: el ? el.querySelectorAll("button, a, input, select").length : -1,
      };
    });

    const gmText = await page.evaluate(() =>
      document.getElementById("cairn-watch-clock")?.innerText.replace(/\s+/g, " ").trim());

    !seen.isGM && seen.present && seen.text === gmText
      ? ok("a player sees the clock, reading the same watch as the Warden", seen.text)
      : fail("a player sees the clock", JSON.stringify({ seen, gmText }));

    seen.controls === 0
      ? ok("...with nothing on it to click")
      : fail("the player's clock has controls", String(seen.controls));

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
    const refused = aliceErrors.filter((e) => refusal.test(e));
    refused.length === 1
      ? ok("...and the refusal came from the SERVER, not from a client-side guard")
      : fail("the server refused the write", JSON.stringify(aliceErrors).slice(0, 300));

    // Everything else must still be clean. The refusal above is expected and
    // is the only console error this probe is allowed to provoke.
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

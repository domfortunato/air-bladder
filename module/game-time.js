import { SETTINGS_NS } from "./settings.js";

/**
 * Keeping time: Cairn's watches, and Vald's calendar.
 *
 * TWO THINGS LIVE HERE AND THEY ARE NOT THE SAME THING.
 *
 * WATCHES ARE CORE CAIRN 2e and are never gated. The Player's Guide procedures
 * say it outright — "a day is divided into three watches, called morning,
 * afternoon and night", "travel time in Cairn is counted in watches, divided
 * into three eight-hour segments per day", and "the last watch of the day is
 * typically reserved for the Make Camp action". The travel tables this system
 * already ships price a journey in them ("+1 Watch", "+2 Watches"). Putting a
 * 2e unit behind a setting-specific switch would be a category error.
 *
 * THE VALD CALENDAR IS A HACK, behind `enable-vald-calendar`. Vald is one
 * setting among many; a Warden running their own world keeps Foundry's own
 * calendar and reads a plain day count.
 *
 * THIS IS THE SYSTEM'S FIRST USE OF `game.time`. Foundry 14 ships a real
 * calendar (`client/data/calendar.mjs`), so Vald is a CONFIGURATION rather than
 * a clock we write, and the world time is server-synced and persisted in the
 * world setting `core.time` for free.
 *
 * THE ONE RULE FOR EVERYTHING BELOW: read the LIVE `game.time.calendar`, never
 * `VALD_CALENDAR_CONFIG`. The watch maths must stay correct under Foundry's
 * default calendar, under Vald, and under a calendar a module we have never
 * heard of installed into the same CONFIG slot.
 */

/* -------------------------------------------- */
/*  The Vald calendar                           */
/* -------------------------------------------- */

/**
 * The Vald calendar, as a `CONFIG.time.worldCalendarConfig` replacement.
 *
 * Source: the Cairn 2e Warden's Guide, cairnrpg.com/second-edition/wardens-guide/vald/
 * (CC BY-SA 4.0) — the same text `src/packs/journals-vald/` already ships as
 * prose. Twelve months of twenty-four days, a six-day week, four seasons, and a
 * six-day Reclamation week every tenth year.
 *
 * `name` and `description` are LITERAL while months, days and seasons are i18n
 * KEYS. That is core's own split in `SIMPLIFIED_GREGORIAN_CALENDAR_CONFIG`
 * (`client/data/calendar.mjs:470`): core localizes none of them itself, so every
 * name here must be a key `lang/en.json` carries and this file is the only
 * thing that resolves them.
 *
 * TWO UPSTREAM DISCREPANCIES, RECORDED AND DELIBERATELY NOT FIXED.
 *
 * 1. The page says every season lasts 72 days. Its own "X season begins" rows
 *    give Dead 72, Dry 72, Wet 69 and Harvest 75.
 * 2. The same table puts "Lift the Veil: the end of the Dead season" on Veil 9
 *    (day 57), nineteen days before Dry begins on Sunrise 4 (day 76).
 *
 * So the prose and the dated rows already disagree with each other, before we
 * touch anything. We encode the four "begins" rows, which are unambiguous, and
 * change nothing. `docs/keeping-time.md` says so where a Warden will read it,
 * because somebody will otherwise report the arithmetic as our bug.
 */
export const VALD_CALENDAR_CONFIG = {
  name: "The Vald Calendar",
  description: "The calendar of Vald: twelve months of twenty-four days, a six-day week, "
    + "and four seasons — Dead, Dry, Wet and Harvest. Every tenth year adds Reclamation, "
    + "a six-day week belonging to no month.",

  years: {
    // The DISPLAYED year is `components.year + yearZero`, and that reading is
    // ours to choose because core reads this field NOWHERE: `grep yearZero`
    // over the shipped client finds only the schema, this config's Gregorian
    // twin, and a type doc. The alternative to an offset is writing ~1.92e11
    // seconds into `core.time` behind a migration marker — a world write fired
    // by flipping a display setting — so an addition wins. Consequence: a fresh
    // world at worldTime 0 reads "Market Day, the 1st of Mourning, 7728", which
    // is the source's stated current year, out of the box.
    //
    // The risk, stated: core's one-line type doc reads "the year which is
    // presented as 0 when formatting a time", which suggests the OPPOSITE
    // reading. Nothing in core acts on either. `formatValdDate` below is the
    // only reader in this system.
    yearZero: 7728,

    // 0 = Market Day. This is the load-bearing arithmetic of the whole
    // calendar: 288 % 6 === 0 AND the leap week is exactly 6 days, so the
    // weekday cycle stays locked to the day of the month forever — every month
    // begins on Market Day, and every dated holiday in the Warden's Guide falls
    // on the weekday it names. Verified against all 25 of them by the probe,
    // which is the only check that PROVES this rather than restating it.
    firstWeekday: 0,

    // leapStart MUST be 0, and this is not a preference. Core's two leap paths
    // disagree for any other value: `_decomposeTimeYears` measures the pre-leap
    // run as `Math.max(leapStart - 1, 0)` (calendar.mjs:337) while `isLeapYear`
    // compares against `leapStart` itself (calendar.mjs:217). At 0 the pre-leap
    // branch is skipped entirely and both agree that internal years 0, 10, 20…
    // are leap.
    //
    // FROZEN, and it must stay frozen. With yearZero 7728 this makes 7728
    // itself a Reclamation year. The Warden's Guide gives no anchor for which
    // years carry the leap week, so that is OUR invention (user ruling
    // 2026-09-10) — and changing it later silently re-dates every world that
    // has ever run on it.
    leapYear: { leapStart: 0, leapInterval: 10 },
  },

  months: {
    values: [
      { name: "CAIRN.Vald.Month.Mourning", ordinal: 1, days: 24 },
      { name: "CAIRN.Vald.Month.Silence", ordinal: 2, days: 24 },
      { name: "CAIRN.Vald.Month.Veil", ordinal: 3, days: 24 },
      { name: "CAIRN.Vald.Month.Sunrise", ordinal: 4, days: 24 },
      { name: "CAIRN.Vald.Month.Bright", ordinal: 5, days: 24 },
      { name: "CAIRN.Vald.Month.Ashfall", ordinal: 6, days: 24 },
      { name: "CAIRN.Vald.Month.Flood", ordinal: 7, days: 24 },
      { name: "CAIRN.Vald.Month.Highwater", ordinal: 8, days: 24 },
      { name: "CAIRN.Vald.Month.Rise", ordinal: 9, days: 24 },
      { name: "CAIRN.Vald.Month.Quell", ordinal: 10, days: 24 },
      { name: "CAIRN.Vald.Month.Bane", ordinal: 11, days: 24 },
      { name: "CAIRN.Vald.Month.Sunset", ordinal: 12, days: 24 },
      // Reclamation "does not belong to any particular month", and this schema
      // has nowhere else to put six days. A THIRTEENTH MONTH OF ZERO DAYS is
      // the expression, and it works on two counts core makes available:
      // `daysPerLeapYear` is Σ(leapDays ?? days) over months
      // (calendar.mjs:79-82), so this contributes 0 normally and 6 in a leap
      // year; and the month walk's `if (dayOfMonth < md) break` can never fire
      // at md === 0, so an ordinary year steps straight past it.
      { name: "CAIRN.Vald.Month.Reclamation", ordinal: 13, days: 0, leapDays: 6 },
    ],
  },

  days: {
    values: [
      { name: "CAIRN.Vald.Day.Market", abbreviation: "CAIRN.Vald.DayAbbr.Market", ordinal: 1 },
      { name: "CAIRN.Vald.Day.Garden", abbreviation: "CAIRN.Vald.DayAbbr.Garden", ordinal: 2 },
      { name: "CAIRN.Vald.Day.Song", abbreviation: "CAIRN.Vald.DayAbbr.Song", ordinal: 3 },
      { name: "CAIRN.Vald.Day.Tithe", abbreviation: "CAIRN.Vald.DayAbbr.Tithe", ordinal: 4 },
      { name: "CAIRN.Vald.Day.Bathing", abbreviation: "CAIRN.Vald.DayAbbr.Bathing", ordinal: 5 },
      { name: "CAIRN.Vald.Day.Resting", abbreviation: "CAIRN.Vald.DayAbbr.Resting", ordinal: 6 },
    ],
    // 12 × 24. NOT derived by core — it has to agree with the months above or
    // every single conversion is wrong.
    daysPerYear: 288,
    hoursPerDay: 24,
    minutesPerHour: 60,
    secondsPerMinute: 60,
  },

  seasons: {
    // DAY-OF-YEAR boundaries, because Vald's seasons start mid-month and core
    // tries `dayStart`/`dayEnd` BEFORE `monthStart`/`monthEnd`
    // (calendar.mjs:281-288), matching them against `od = day + 1` — the day of
    // the YEAR, not of the month. So mid-month boundaries are expressible
    // exactly, and month boundaries would not be.
    //
    // From the four "X season begins" rows of the holiday table:
    //   Dead    Mourning 4  ->            4
    //   Dry     Sunrise 4   -> 3·24 + 4 = 76
    //   Wet     Flood 4     -> 6·24 + 4 = 148
    //   Harvest Quell 1     -> 9·24 + 1 = 217
    values: [
      // FIRST in the array on purpose. Without it, leap days 289-294 match no
      // season at all, `components.season` comes back as 4 — one past the end —
      // and `seasons.values[season]` is undefined. Core does not guard that.
      // This is our ENCODING of the leap week, not a claim that Vald has five
      // seasons; the display prefers the month name there anyway.
      { name: "CAIRN.Vald.Season.Reclamation", dayStart: 289, dayEnd: 294 },
      { name: "CAIRN.Vald.Season.Dead", dayStart: 4, dayEnd: 75 },
      { name: "CAIRN.Vald.Season.Dry", dayStart: 76, dayEnd: 147 },
      { name: "CAIRN.Vald.Season.Wet", dayStart: 148, dayEnd: 216 },
      // Wraps the year end. Core handles `dayEnd < dayStart` by shifting one
      // bound by daysPerYear (calendar.mjs:283-285), so this covers 217-288
      // and 1-3.
      { name: "CAIRN.Vald.Season.Harvest", dayStart: 217, dayEnd: 3 },
    ],
  },
};

/** The six Reclamation days, in order. Only ever read during a leap week. */
const RECLAMATION_DAYS = [
  "CAIRN.Vald.Reclamation.Recognize",
  "CAIRN.Vald.Reclamation.Remember",
  "CAIRN.Vald.Reclamation.Reward",
  "CAIRN.Vald.Reclamation.Rejoice",
  "CAIRN.Vald.Reclamation.Relinquish",
  "CAIRN.Vald.Reclamation.Renew",
];

/* -------------------------------------------- */
/*  Installation                                */
/* -------------------------------------------- */

/**
 * Is the Vald calendar switched on?
 *
 * Read LIVE at every call site, which is how every other content gate in this
 * system works (`build2ePool`, `glogEnabled`) — never pack ownership, never a
 * folder. The try/catch covers the earliest moments of `init` and any probe
 * that reaches in before `registerSettings()` has run.
 */
export const valdEnabled = () => {
  try {
    return !!game.settings.get(SETTINGS_NS, "enable-vald-calendar");
  } catch {
    return false;
  }
};

/**
 * Vald's calendar, with core's leap-week decomposition corrected.
 *
 * THIS SUBCLASS EXISTS FOR ONE REASON: A BUG IN THE SHIPPED CLIENT.
 * `CalendarData#_decomposeTimeYears` (client/data/calendar.mjs:391-403) reads:
 *
 *     if ( second >= secondsPerLeapYear ) { year++; second -= secondsPerLeapYear; }
 *     else leapYear = true;                       // it is currently a leap year
 *     const remainderYears = Math.floor(second / secondsPerStandardYear);
 *     year += remainderYears;                     // <- runs in BOTH branches
 *     second -= (remainderYears * secondsPerStandardYear);
 *
 * The remainder-years step runs unconditionally. When we are INSIDE a leap
 * year, `second` can be anywhere in [0, secondsPerLeapYear), and the moment it
 * passes `secondsPerStandardYear` that floor returns 1 and the year is silently
 * advanced — while `leapYear` stays true. So the days a leap year has ON TOP of
 * a standard one are the exact days core cannot decompose, and it reports them
 * as day 0 of the following year.
 *
 * For Vald that is precisely the six Reclamation days. (It is not a Vald
 * problem: on core's own Simplified Gregorian it is the 31st of December in
 * every leap year.) Found 2026-09-10 by an offline replica of core's arithmetic
 * run against this config; the symptom was a six-day hole and a failing
 * `timeToComponents -> componentsToTime` round trip.
 *
 * Core INVITES this fix in its own docstring on the method — "factored out so
 * calendars which require advanced leap year handling can override this logic"
 * — so this is the documented seam, not a monkey-patch. The override is a
 * verbatim copy with the remainder walk moved inside the branch that has
 * actually left the leap year behind. Nothing else is changed.
 *
 * It is installed only alongside the Vald config, so a Warden without the hack
 * keeps core's behaviour exactly, bug and all. Fixing core's Gregorian is not
 * ours to do.
 */
export class ValdCalendar extends foundry.data.CalendarData {
  /** @override */
  _decomposeTimeYears(time) {
    const { secondsPerMinute, minutesPerHour, hoursPerDay, daysPerYear, daysPerLeapYear } = this.days;
    const perDay = secondsPerMinute * minutesPerHour * hoursPerDay;
    const perStandardYear = daysPerYear * perDay;
    const perLeapYear = daysPerLeapYear * perDay;

    let year = 0;
    let leapYear = false;
    let second = time;

    if (!this.years.leapYear) {
      year = Math.floor(second / perStandardYear);
      second -= year * perStandardYear;
      return { year, second, leapYear };
    }

    const { leapStart, leapInterval } = this.years.leapYear;
    const firstLeapSeconds = Math.max(leapStart - 1, 0) * perStandardYear;

    if (second < firstLeapSeconds) {
      year = Math.floor(second / perStandardYear);
      second -= year * perStandardYear;
      return { year, second, leapYear };
    }

    const preLeapStartYears = Math.floor(Math.min(second, firstLeapSeconds) / perStandardYear);
    year += preLeapStartYears;
    second -= preLeapStartYears * perStandardYear;

    const leapIntervalSeconds = (daysPerLeapYear + ((leapInterval - 1) * daysPerYear)) * perDay;
    const leapIntervals = Math.floor(second / leapIntervalSeconds);
    year += leapIntervals * leapInterval;
    second -= leapIntervals * perLeapYear;
    second -= leapIntervals * (leapInterval - 1) * perStandardYear;

    // THE FIX, and it is these four lines: the remaining whole standard years
    // are only meaningful once the interval's leading LEAP year has been
    // deducted. While we are still inside it there are none, by definition.
    if (second >= perLeapYear) {
      year++;
      second -= perLeapYear;
      const remainderYears = Math.floor(second / perStandardYear);
      year += remainderYears;
      second -= remainderYears * perStandardYear;
    } else {
      leapYear = true;
    }
    return { year, second, leapYear };
  }
}

/**
 * Install the Vald calendar, if the hack is on.
 *
 * Called from `cairn.js`'s `init` hook AFTER `registerSettings()`, and the
 * ordering is the whole trick: `Hooks.callAll("init")` is `client/game.mjs:652`
 * while `new GameTime()` is `game.mjs:722`, so the calendar object is built
 * AFTER our hook returns. Assigning the config is therefore enough — there is
 * no `initializeCalendar()` to call and no race to lose.
 *
 * `earthCalendarConfig` and `earthCalendarClass` are deliberately untouched —
 * that is real-world time and has nothing to do with Vald.
 */
export const installWorldCalendar = () => {
  if (!valdEnabled()) return;
  CONFIG.time.worldCalendarConfig = VALD_CALENDAR_CONFIG;
  CONFIG.time.worldCalendarClass = ValdCalendar;
};

/**
 * Warn once if something else took the slot.
 *
 * We do not own `CONFIG.time`. A calendar module assigns the same field, and a
 * Warden with both installed would otherwise see Vald switched on in their
 * settings while every date on screen came from somewhere else, with no signal
 * at all. Called at `ready`.
 */
export const checkWorldCalendar = () => {
  if (!valdEnabled()) return;
  if (game.time?.calendar?.name === VALD_CALENDAR_CONFIG.name) return;
  console.warn("air-bladder | the Vald calendar is switched on, but another package has"
    + " replaced CONFIG.time.worldCalendarConfig. Dates will not be Vald's.");
};

/* -------------------------------------------- */
/*  Watches                                     */
/* -------------------------------------------- */

/** Morning, afternoon, night. The SRD's three, in the SRD's order. */
export const WATCH_KEYS = [
  "CAIRN.Time.Watch.Morning",
  "CAIRN.Time.Watch.Afternoon",
  "CAIRN.Time.Watch.Night",
];

/** The live calendar. Never `VALD_CALENDAR_CONFIG` — see the file docblock. */
const calendar = () => game.time.calendar;

/** Seconds in one of the live calendar's days. */
export const secondsPerDay = () => {
  const d = calendar().days;
  return d.hoursPerDay * d.minutesPerHour * d.secondsPerMinute;
};

/** Seconds in one watch: a third of a day, whatever a day is here. */
export const secondsPerWatch = () => Math.round(secondsPerDay() / 3);

/**
 * Which watch is it? 0 morning, 1 afternoon, 2 night.
 *
 * CLAMPED, and the clamp is not defensive noise: a third-party calendar whose
 * `hoursPerDay` is not divisible by three would otherwise produce a fourth
 * watch index and `WATCH_KEYS[3]` is undefined.
 *
 * THE DAY BOUNDARY IS MIDNIGHT AND THERE IS NO DAWN OFFSET. Morning runs
 * 00:00-07:59, afternoon 08:00-15:59, night 16:00-23:59. That looks wrong until
 * you try the alternative: an offset puts the night watch across midnight, so
 * the day counter increments MID-WATCH and "the last watch of the day" stops
 * being the last watch of the day. Cairn never tracks hours — a day is three
 * watches and the third is camp — so nothing in this system ever DISPLAYS an
 * hour, and the oddity has no surface to show on. Midnight-aligned is also the
 * only alignment where "advance a day" and "to next morning" agree.
 */
export const currentWatch = () => {
  const hour = game.time.components?.hour ?? 0;
  const per = calendar().days.hoursPerDay / 3;
  return Math.min(2, Math.max(0, Math.floor(hour / per)));
};

/** Elapsed days since the epoch, one-based, for the no-calendar display. */
export const dayCount = () => Math.floor(game.time.worldTime / secondsPerDay()) + 1;

/* -------------------------------------------- */
/*  Formatting                                  */
/* -------------------------------------------- */

const ORDINAL_SUFFIX = { one: "st", two: "nd", few: "rd", other: "th" };

/**
 * "14th", but only where that means anything.
 *
 * English gets the suffix; every other language gets the bare number, so a
 * Spanish translator writes "{weekday}, {day} de {month}" and reads "14 de
 * Flood" rather than an English ordinal wearing Spanish clothes.
 */
const ordinal = (n) => {
  const lang = game.i18n?.lang ?? "en";
  if (!lang.startsWith("en")) return String(n);
  try {
    return `${n}${ORDINAL_SUFFIX[new Intl.PluralRules("en", { type: "ordinal" }).select(n)] ?? "th"}`;
  } catch {
    return String(n);
  }
};

/** Localize a calendar name field, which is an i18n key by core's convention. */
const nameOf = (entry) => (entry?.name ? game.i18n.localize(entry.name) : "");

/** The season entry for a set of components, or undefined. */
const seasonOf = (components) => {
  // BOUNDS-CHECKED even though the Reclamation entry above should make it
  // unnecessary. `components.season` is an index core computes with a loop that
  // falls off the end when nothing matches, and it does not guard the result.
  const values = calendar().seasons?.values;
  if (!Array.isArray(values)) return undefined;
  return values[components?.season] ?? undefined;
};

/**
 * The Vald date, long and short.
 *
 * A Reclamation day takes the leap week's own day names rather than the weekday
 * cycle — which is exact rather than a special case, because Reclamation is six
 * days long and the cycle is six days, so Recognize IS Market Day.
 */
export const formatValdDate = (components = game.time.components, { short = false } = {}) => {
  const cal = calendar();
  const year = (components?.year ?? 0) + (cal.years?.yearZero ?? 0);
  const month = cal.months?.values?.[components?.month];
  const dayOfMonth = (components?.dayOfMonth ?? 0) + 1;

  if (month?.name === "CAIRN.Vald.Month.Reclamation") {
    return game.i18n.format("CAIRN.Vald.ReclamationDate", {
      dayName: game.i18n.localize(RECLAMATION_DAYS[components.dayOfMonth] ?? RECLAMATION_DAYS[0]),
      year,
    });
  }

  if (short) {
    return game.i18n.format("CAIRN.Vald.DateShort", {
      day: dayOfMonth, month: nameOf(month), year,
    });
  }
  return game.i18n.format("CAIRN.Vald.Date", {
    weekday: nameOf(cal.days?.values?.[components?.dayOfWeek]),
    day: ordinal(dayOfMonth),
    month: nameOf(month),
    year,
  });
};

/**
 * Everything a surface needs to render the time, in one call.
 *
 * The watch clock and the Dashboard's time band both read this, so they can
 * never disagree about what time it is — which they would, eventually, as two
 * copies of the same arithmetic.
 */
export const describeTime = () => {
  const components = game.time.components ?? {};
  const watch = game.i18n.localize(WATCH_KEYS[currentWatch()]);
  const watchLine = game.i18n.format("CAIRN.Time.WatchOf", { watch });
  const vald = valdEnabled() && calendar().name === VALD_CALENDAR_CONFIG.name;

  if (!vald) {
    // A plain elapsed-day count is the only honest thing to show under
    // Foundry's Gregorian calendar. A Cairn table does not care that it is
    // March the 14th.
    const day = dayCount();
    return {
      vald: false,
      watch,
      watchLine,
      dateLine: game.i18n.format("CAIRN.Time.DayCount", { day }),
      seasonLine: "",
      seasonIcon: "",
      weather: "",
      tooltip: game.i18n.format("CAIRN.Time.Plain", { day, watch }),
    };
  }

  const season = seasonOf(components);
  const seasonLine = season
    ? game.i18n.format("CAIRN.Time.SeasonOf", { season: nameOf(season) })
    : "";
  const long = formatValdDate(components);
  const weather = todayWeather();
  return {
    vald: true,
    watch,
    watchLine,
    dateLine: formatValdDate(components, { short: true }),
    seasonLine,
    seasonIcon: seasonIconFor(season),
    // A FOURTH LINE on the clock, present only once the Warden has called the
    // weather (user ruling, on seeing the panel in place: bolder, and carry the
    // weather). Absent rather than blank — the clock sits above the player list
    // and takes the column's slack, so a line that appears grows UPWARD into
    // empty space and nothing below it moves.
    weather,
    tooltip: [long, seasonLine, watchLine, weather].filter(Boolean).join(" — "),
  };
};

/* -------------------------------------------- */
/*  Which weather table is today's?             */
/* -------------------------------------------- */

/**
 * Season name -> the table to roll for it.
 *
 * Keyed on the season's raw `name` FIELD, never on its localized text, which
 * differs per client and would make this map answer differently in Spanish.
 */
const VALD_WEATHER_BY_SEASON = {
  "CAIRN.Vald.Season.Dead": "Warden: Vald - Weather (Dead)",
  "CAIRN.Vald.Season.Dry": "Warden: Vald - Weather (Dry)",
  "CAIRN.Vald.Season.Wet": "Warden: Vald - Weather (Wet)",
  "CAIRN.Vald.Season.Harvest": "Warden: Vald - Weather (Harvest)",
  // Reclamation interrupts Harvest — it follows Sunset, which is Harvest
  // territory — so that is the table it borrows. Our encoding, not the SRD's:
  // the source gives the leap week no weather of its own.
  "CAIRN.Vald.Season.Reclamation": "Warden: Vald - Weather (Harvest)",
};

const CAIRN_WEATHER_BY_SEASON = {
  "CALENDAR.GREGORIAN.Spring": "Warden: Weather - Spring",
  "CALENDAR.GREGORIAN.Summer": "Warden: Weather - Summer",
  "CALENDAR.GREGORIAN.Fall": "Warden: Weather - Fall",
  "CALENDAR.GREGORIAN.Winter": "Warden: Weather - Winter",
};

/**
 * The weather table for the season the world is actually in.
 *
 * THIS IS THE ONE PLACE the Vald setting arbitrates between the two weather
 * sets, and that is the honest place for it: the button must pick a single
 * table, and picking it is the whole reason the calendar earns its keep. The
 * two groups of BUTTONS sit side by side on the Dashboard (user ruling
 * 2026-09-10) because Cairn's four are a severity ladder feeding
 * `Warden: Weather - Difficulty` while Vald's four are descriptive — a Vald
 * table wants both.
 *
 * `undefined` under a calendar we do not recognise, so the button hides rather
 * than rolling the wrong season's weather.
 */
export const weatherTableForToday = () => {
  const season = seasonOf(game.time.components);
  if (!season?.name) return undefined;
  const map = valdEnabled() && calendar().name === VALD_CALENDAR_CONFIG.name
    ? VALD_WEATHER_BY_SEASON
    : CAIRN_WEATHER_BY_SEASON;
  return map[season.name];
};

/* -------------------------------------------- */
/*  Season icons                                */
/* -------------------------------------------- */

/**
 * Season -> the Font Awesome glyph that stands for it.
 *
 * Keyed on the raw `name` FIELD for the same reason the weather map above is:
 * a localized key would answer differently per client.
 *
 * GLYPHS RATHER THAN DRAWN ART, by user ruling: they follow the theme's ink in
 * both schemes, they cost nothing at load, and they add no row to
 * `icons/CREDITS.md` or the `ICONS` table — a season icon should not drag a
 * licence obligation behind it.
 *
 * THIS MAP IS THE ONE DECLARATION. The Dashboard's four Vald weather buttons
 * READ it rather than restating it (user ask: "the same buttons used in the
 * calendar display"), so the two surfaces cannot drift apart. A literal glyph
 * written into `VALD_WEATHER_GROUP` is a bug, and `dev:vald-time` reds on it.
 *
 * Reclamation takes a star rather than a season's own weather sign: it is not
 * a season anybody lives through, it is a week the calendar inserts.
 *
 * DEAD WEARS A SKULL, not a snowflake (user ruling 2026-09-11). It is the dead
 * season and not merely a cold one — and Cairn's own Winter button, two rows
 * above it on the same tab, already wears icicles.
 */
export const SEASON_ICONS = {
  "CAIRN.Vald.Season.Dead": "fa-skull",
  "CAIRN.Vald.Season.Dry": "fa-sun",
  "CAIRN.Vald.Season.Wet": "fa-droplet",
  "CAIRN.Vald.Season.Harvest": "fa-wheat-awn",
  "CAIRN.Vald.Season.Reclamation": "fa-star",
};

/** The glyph for a season entry, or "" for one we do not know. */
export const seasonIconFor = (season) => SEASON_ICONS[season?.name] ?? "";

/** The season the world is standing in, or undefined. */
export const currentSeason = (components = game.time.components) => seasonOf(components);

/* -------------------------------------------- */
/*  The weather of the day                      */
/* -------------------------------------------- */

const WEATHER_KEY = "vald-weather-today";

/**
 * One line of weather is plenty. A Warden pasting a paragraph would stretch
 * every open calendar and the clock panel with it, on every client.
 */
export const WEATHER_MAX = 160;

/**
 * What the sky is doing today, or "" if nobody has said.
 *
 * Stored against the ABSOLUTE day number rather than a date, which is what
 * makes yesterday's weather go stale by itself: nothing has to clear it, and
 * no hook has to notice midnight. Setting the clock back to a day whose
 * weather was called does NOT bring it back, and that is the honest reading —
 * the Warden rolled the weather once, for the day the table was living in.
 */
export const todayWeather = () => {
  try {
    const stored = game.settings.get(SETTINGS_NS, WEATHER_KEY);
    if (!stored || stored.day !== dayCount()) return "";
    return String(stored.text ?? "");
  } catch {
    return "";
  }
};

/**
 * Say what the weather is. Empty clears it.
 *
 * Warden only, and the server refuses a player's write to a world setting in
 * any case — the guard is the affordance, the scope is the enforcement.
 */
export const setTodayWeather = async (text) => {
  if (!requireWarden()) return null;
  const trimmed = String(text ?? "").trim().slice(0, WEATHER_MAX);
  return game.settings.set(SETTINGS_NS, WEATHER_KEY, trimmed
    ? { day: dayCount(), text: trimmed }
    : { day: 0, text: "" });
};

/* -------------------------------------------- */
/*  Moving the clock                            */
/* -------------------------------------------- */

/**
 * Only the Warden moves the world's clock.
 *
 * `core.time` is world-scoped (`client/game.mjs`), so the SERVER refuses a
 * player's write and this is the affordance half of the pair — the Dashboard is
 * already GM-only, so in practice this catches a macro. The clock in the left
 * column has no controls at all, so a player has nothing to click.
 */
const requireWarden = () => {
  if (game.user.isGM) return true;
  ui.notifications.warn(game.i18n.localize("CAIRN.Notify.TimeWardenOnly"));
  return false;
};

/** Move the world on by one watch. */
export const advanceWatch = async () => {
  if (!requireWarden()) return null;
  return game.time.advance(secondsPerWatch());
};

/** Take a watch back. A Warden will misclick, and a world setting has no undo. */
export const backWatch = async () => {
  if (!requireWarden()) return null;
  return game.time.advance(-secondsPerWatch());
};

/** Move the world on by a whole day, three watches at once. */
export const advanceDay = async () => {
  if (!requireWarden()) return null;
  return game.time.advance(secondsPerDay());
};

/**
 * Skip whatever is left of today and land on the next day's first morning.
 *
 * DELIBERATELY NOT CALLED "MAKE CAMP" (user ruling 2026-09-10). Make Camp is a
 * Wilderness Action the PLAYERS choose, and the no-automation-of-mechanical-text
 * deviation protects player-facing rules. A Warden's button carrying that name
 * would claim the party did something. The Warden moves the calendar; the party
 * decides whether they camped. Nothing is posted to chat for the same reason —
 * the clock is already on every screen.
 *
 * From exactly midnight this advances a whole day, which is literal rather than
 * surprising: the next morning is tomorrow's.
 */
export const toNextMorning = async () => {
  if (!requireWarden()) return null;
  const per = secondsPerDay();
  // Modulo, guarded for a negative world time. Days are uniform length in every
  // calendar core can express, so this needs no leap arithmetic.
  const into = ((game.time.worldTime % per) + per) % per;
  return game.time.advance(per - into);
};

/**
 * Day of the year (0-based) for a month index and a day of the month.
 *
 * `componentsToTime` reads `year` and `day` and IGNORES `month`/`dayOfMonth`
 * entirely (calendar.mjs:96-118), so setting a date means doing this conversion
 * ourselves. A leap year's month lengths differ, hence the flag.
 *
 * EXPORTED so the calendar window builds its grid with this arithmetic rather
 * than a second copy of it. Two copies of a month walk is how a leap week ends
 * up rendering one day out of step with the clock above it.
 */
export const dayOfYear = (monthIndex, dayOfMonth, leap) => {
  const months = calendar().months?.values ?? [];
  let day = 0;
  for (let i = 0; i < monthIndex && i < months.length; i++) {
    const m = months[i];
    day += (leap ? (m.leapDays ?? m.days) : m.days) ?? 0;
  }
  return day + Math.max(0, dayOfMonth - 1);
};

/**
 * Set the world clock to a displayed date.
 *
 * `year` is the year a Warden READS — the internal one plus `yearZero` — so
 * this subtracts the offset back off. `watch` is 0-2 and becomes the hour at
 * which that watch begins, because Cairn has no finer unit than a watch and
 * offering a Warden minutes would be inventing precision the rules do not have.
 */
export const setDate = async ({ year, month = 0, dayOfMonth = 1, watch = 0 } = {}) => {
  if (!requireWarden()) return null;
  const cal = calendar();
  const internalYear = Math.round(year) - (cal.years?.yearZero ?? 0);
  const leap = cal.isLeapYear?.(internalYear) ?? false;
  const hoursPerWatch = cal.days.hoursPerDay / 3;
  return game.time.set({
    year: internalYear,
    day: dayOfYear(month, dayOfMonth, leap),
    hour: Math.round(Math.min(2, Math.max(0, watch)) * hoursPerWatch),
    minute: 0,
    second: 0,
  });
};

/**
 * The months a Set the Date dialog should offer, right under either calendar.
 *
 * Reclamation is offered only in a leap year, since in every other year it is
 * a month of zero days and picking it would silently land on the following
 * year's first day.
 */
export const monthChoices = (year = null) => {
  const cal = calendar();
  const internalYear = year === null
    ? (game.time.components?.year ?? 0)
    : Math.round(year) - (cal.years?.yearZero ?? 0);
  const leap = cal.isLeapYear?.(internalYear) ?? false;
  return (cal.months?.values ?? [])
    .map((m, index) => ({ index, label: nameOf(m), days: (leap ? (m.leapDays ?? m.days) : m.days) ?? 0 }))
    .filter((m) => m.days > 0);
};

/* -------------------------------------------- */
/*  A month, laid out                           */
/* -------------------------------------------- */

/** The Reclamation days, by index, for the leap week's own cells. */
export const reclamationDayName = (index) =>
  game.i18n.localize(RECLAMATION_DAYS[index] ?? RECLAMATION_DAYS[0]);

/**
 * One month as a list of days, built from the LIVE calendar.
 *
 * Every cell round-trips `componentsToTime -> timeToComponents`, which is the
 * same arithmetic `dev:vald-time`'s holiday leg checks against the Warden's
 * Guide. Nothing here reads `VALD_CALENDAR_CONFIG`: a grid that disagreed with
 * the clock above it would be worse than no grid.
 *
 * `leadingBlanks` comes from the first day's weekday and is COMPUTED, never
 * assumed. Under Vald it is always zero — 24 days to a month and six to a week,
 * so every month opens on Market Day — but that is a property of this config,
 * not of calendars, and assuming it would break the first time somebody edits
 * a month length.
 *
 * `seasonBegins` is true on the day a season's first day falls, which is what
 * makes Vald's mid-month boundaries visible at all. It is read by comparing
 * against the PREVIOUS day rather than against the config's `dayStart`, so it
 * stays right under a calendar whose seasons we have never seen.
 */
export const buildMonth = ({ year, month }) => {
  const cal = calendar();
  const internalYear = Math.round(year) - (cal.years?.yearZero ?? 0);
  const leap = cal.isLeapYear?.(internalYear) ?? false;
  const entry = cal.months?.values?.[month];
  const length = ((leap ? (entry?.leapDays ?? entry?.days) : entry?.days) ?? 0);
  const perDay = secondsPerDay();
  const todayTime = game.time.worldTime;
  const todayIndex = Math.floor(todayTime / perDay);

  const days = [];
  for (let d = 1; d <= length; d++) {
    const time = cal.componentsToTime({ year: internalYear, day: dayOfYear(month, d, leap) });
    const components = cal.timeToComponents(time);
    const season = cal.seasons?.values?.[components.season];
    const before = cal.timeToComponents(time - perDay);
    days.push({
      dayOfMonth: d,
      time,
      absoluteDay: Math.floor(time / perDay),
      isToday: Math.floor(time / perDay) === todayIndex,
      weekday: components.dayOfWeek ?? 0,
      weekdayName: nameOf(cal.days?.values?.[components.dayOfWeek]),
      seasonKey: season?.name ?? "",
      seasonName: nameOf(season),
      seasonIcon: seasonIconFor(season),
      seasonBegins: !!season?.name && before.season !== components.season,
      reclamationName: entry?.name === "CAIRN.Vald.Month.Reclamation" ? reclamationDayName(d - 1) : "",
    });
  }

  return {
    year: Math.round(year),
    month,
    monthKey: entry?.name ?? "",
    monthName: nameOf(entry),
    reclamation: entry?.name === "CAIRN.Vald.Month.Reclamation",
    leap,
    length,
    leadingBlanks: days.length ? new Array(days[0].weekday).fill(0).map((_, i) => i) : [],
    weekdays: (cal.days?.values ?? []).map((w) => ({ name: nameOf(w), abbr: w.abbreviation ? game.i18n.localize(w.abbreviation) : nameOf(w) })),
    days,
  };
};

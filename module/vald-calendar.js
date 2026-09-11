import {
  valdEnabled, VALD_CALENDAR_CONFIG, buildMonth, monthChoices, formatValdDate,
  currentWatch, setDate, todayWeather, setTodayWeather, weatherTableForToday, WEATHER_MAX,
} from "./game-time.js";
import { t, localizeJournalBlocks } from "./i18n-content.js";
import {
  marksByDay, watchLineFor, promptAddEvent, openEvent, removeEvent, _resetFestivals,
} from "./calendar-events.js";

// Re-exported so the probes keep one import site for the window and its
// content. The cache itself lives with the festivals now, beside the Warden's
// own events, because the two are one list from here on.
export { _resetFestivals };

/**
 * The calendar on the wall.
 *
 * The user asked "how do players see the calendar?" and meant the thing people
 * keep on a fridge: this month laid out, today circled, the rest of the days
 * visible, and what is happening on them. The watch clock answers "what time
 * is it"; this answers "what month is it, and what is coming".
 *
 * VALD ONLY, by ruling (2026-09-10). A grid needs month names, and under
 * Foundry's own calendar those are January and a year like 0 — which would
 * contradict the clock's deliberately honest "Day 12". A table not running Vald
 * keeps what it has.
 *
 * READ-ONLY FOR PLAYERS, and browsing can never move the world. The Warden sets
 * the date from a BUTTON INSIDE THE DAY PANEL and never by clicking a day
 * (user ruling): clicking a day is how you look at it, and a surface where
 * looking and acting are the same gesture will eventually cost somebody a
 * session's worth of clock.
 *
 * THE FESTIVAL TEXT IS COMPENDIUM CONTENT, not a table in this file, and the
 * reason is a LICENCE boundary rather than a technical one: `LICENSE.txt`
 * declares `module/ templates/ css/ tools/ lang/` to be MIT "and only these",
 * while every word of Cairn's text is CC BY-SA. See `tools/import/vald.mjs`,
 * which generates it. The consequence is that a festival is found by its DATA —
 * a page carrying `flags.air-bladder.valdMonth` — and never by entry or page
 * NAME, which would break the moment a translator touched it.
 *
 * THAT LOOKUP LIVES IN `calendar-events.js` since 2026-09-11, because the
 * Warden's own events carry the same flags and the two are one list from the
 * grid's point of view. This file is the WINDOW.
 */

/* -------------------------------------------- */
/*  Saying what the weather is                  */
/* -------------------------------------------- */

/**
 * Let the Warden say what the sky is doing, rolled or not.
 *
 * ONE FUNCTION, TWO BUTTONS (user ask): beside Today's Weather on the
 * Dashboard, and a Warden-only pencil on the calendar's own weather line —
 * which is where a Warden is looking at the moment they decide the sky is
 * wrong. A d6 of seasonal weather has no row for a curse, a spell, or the thing
 * in the valley.
 *
 * ONE text field with the season's six rows hung off it as a `datalist`, rather
 * than a picker and a field side by side: the common case is a keystroke and a
 * pick, "a rain of ash" is just as easy, and there is never a question about
 * which of two inputs wins.
 *
 * EMPTY MEANS UNCALLED. Clearing the field puts the calendar back to "the
 * Warden has not rolled the weather yet", which is how a mistake is undone.
 *
 * SILENT, like every other clock change. It is not a roll, so there is no card;
 * a Warden who wants to announce a rain of ash has chat, and the calendar
 * carries it to everyone in any case.
 *
 * Built as an ELEMENT with the values read in the button callback, because
 * DialogV2 sanitizes a string it is handed and listeners on sanitized markup
 * are dead — the trap `promptSetDate` and `warden-damage.js` already carry.
 */
export const promptSetWeather = async () => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.TimeWardenOnly"));
    return null;
  }
  const esc = foundry.utils.escapeHTML;
  const table = game.tables?.getName?.(weatherTableForToday() ?? "")
    ?? (await suggestionsFromPack(weatherTableForToday()));
  // `description` is the v14 field and the one every other reader here uses
  // (see warden-dashboard.js:322). Tags are stripped because a datalist option
  // is plain text, and the Cairn tables bold their keyword.
  const suggestions = (table?.results ?? [])
    .map((r) => String(r.type === "text" ? r.description : r.name))
    .map((v) => v.replace(/<[^>]*>/g, "").trim()).filter(Boolean);

  // A BARE <div> WITH NO ATTRIBUTES. DialogV2's constructor throws
  // "config.content element must have no attributes" (dialog.mjs:189) — a
  // class on the root is enough, and the dialog then never opens at all. This
  // carried one from the day it was written and nothing caught it, because
  // every probe reached `setTodayWeather` directly rather than through the
  // button a Warden actually presses.
  const form = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "cairn-set-weather";
  form.append(inner);
  inner.innerHTML = `
    <p class="hint">${esc(game.i18n.localize("CAIRN.Calendar.SetWeatherHint"))}</p>
    <div class="form-group">
      <label for="ab-weather-text">${esc(game.i18n.localize("CAIRN.Calendar.Weather"))}</label>
      <input id="ab-weather-text" type="text" name="weather" list="ab-weather-list"
        maxlength="${WEATHER_MAX}" value="${esc(todayWeather())}">
    </div>
    <datalist id="ab-weather-list">
      ${suggestions.map((s) => `<option value="${esc(s)}"></option>`).join("")}
    </datalist>`;

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: "CAIRN.Calendar.SetWeatherTitle" },
    content: form,
    buttons: [
      {
        action: "set",
        label: "CAIRN.Calendar.SetWeather",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element ?? button.form;
          return { text: root.querySelector("[name=weather]")?.value ?? "" };
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  });

  if (!picked || picked === "cancel") return null;
  return setTodayWeather(picked.text);
};

/**
 * The season's six rows, when the table is only in a compendium.
 *
 * The Warden-table packs are ownership NONE, which is sidebar CONCEALMENT and
 * not a read wall, so this works for the Warden without importing anything.
 * Suggestions are a convenience: a miss returns nothing and the field is simply
 * a field.
 */
const suggestionsFromPack = async (name) => {
  if (!name) return null;
  for (const pack of game.packs.filter((p) => p.documentName === "RollTable")) {
    const index = pack.index.find((e) => e.name === name);
    if (index) return pack.getDocument(index._id);
  }
  return null;
};

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

class ValdCalendarApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: "cairn-vald-calendar",
    classes: ["cairn", "sheet", "cairn-vald-calendar"],
    tag: "div",
    position: { width: 480, height: 640 },
    window: {
      title: "CAIRN.Calendar.Title",
      icon: "fa-solid fa-calendar-days",
      resizable: true,
      contentClasses: ["standard-form"],
    },
    actions: {
      prevMonth: ValdCalendarApp.#onPrevMonth,
      nextMonth: ValdCalendarApp.#onNextMonth,
      today: ValdCalendarApp.#onToday,
      pickDay: ValdCalendarApp.#onPickDay,
      setToDay: ValdCalendarApp.#onSetToDay,
      setWeather: ValdCalendarApp.#onSetWeather,
      addEvent: ValdCalendarApp.#onAddEvent,
      editEvent: ValdCalendarApp.#onEditEvent,
      removeEvent: ValdCalendarApp.#onRemoveEvent,
    },
  };

  static PARTS = {
    body: { template: "systems/air-bladder/templates/ui/vald-calendar.html" },
  };

  /**
   * WHAT THE READER IS LOOKING AT, held on the INSTANCE and never re-derived
   * from the clock on a render.
   *
   * This is the whole reason browsing works. `updateWorldTime` re-renders every
   * open calendar, so a `_prepareContext` that started from "today" would snap
   * a Warden who was reading next month back to this one the moment anybody
   * advanced a watch. It looks right until the clock moves, which is why
   * `dev:vald-time` advances the clock and checks the view stayed put.
   */
  #view = null;

  /** The day whose panel is open, or null for today. */
  #selected = null;

  /** Today, as a {year, month, day} in DISPLAYED terms. */
  #today() {
    const c = game.time.components ?? {};
    return {
      year: (c.year ?? 0) + (game.time.calendar?.years?.yearZero ?? 0),
      month: c.month ?? 0,
      day: (c.dayOfMonth ?? 0) + 1,
    };
  }

  /** Come back to today, and select it. */
  reset() {
    const now = this.#today();
    this.#view = { year: now.year, month: now.month };
    this.#selected = { ...now };
  }

  /** @override */
  async _prepareContext() {
    if (!this.#view) this.reset();
    const now = this.#today();
    const month = buildMonth(this.#view);

    // A month that has stopped existing — Reclamation in a year that is not a
    // leap year, reached by browsing into one — falls back to today rather than
    // rendering an empty grid.
    if (!month.length) {
      this.reset();
      return this._prepareContext();
    }

    // The YEAR is passed because the Warden's own events may be stamped with
    // one. A festival recurs forever; "the coronation" happened in 7731.
    const festivals = await marksByDay(this.#view.year);
    const selected = this.#selected?.year === this.#view.year && this.#selected?.month === this.#view.month
      ? this.#selected
      : null;

    for (const day of month.days) {
      const on = festivals.get(`${this.#view.month}/${day.dayOfMonth}`) ?? [];
      day.festivals = on.length;
      day.festivalNames = on.map((f) => t("journal.pageName", f.name)).join(", ");
      // A second marker rather than a second dot of the same colour: a day
      // carrying a festival AND something the Warden wrote reads as two things.
      day.wardenEvent = on.some((f) => f.warden);
      day.selected = selected?.day === day.dayOfMonth;
      day.seasonClass = day.seasonKey ? `cairn-season-${day.seasonKey.split(".").pop().toLowerCase()}` : "";
    }

    return {
      month,
      isGM: game.user.isGM,
      headSeasonIcon: month.days[0]?.seasonIcon ?? "",
      panel: this.#panel(month, selected ?? { ...this.#view, day: null }, now, festivals),
    };
  }

  /**
   * The day panel: the long date, the season, what is marked on the day, and
   * — for today alone — the weather.
   */
  #panel(month, at, now, festivals) {
    const day = month.days.find((d) => d.dayOfMonth === at.day) ?? month.days[0];
    const isToday = month.year === now.year && month.month === now.month && day.dayOfMonth === now.day;
    const components = game.time.calendar.timeToComponents(day.time);
    const on = (festivals.get(`${month.month}/${day.dayOfMonth}`) ?? []).map((f) => ({
      name: t("journal.pageName", f.name),
      text: f.text,
      span: f.total > 1
        ? game.i18n.format("CAIRN.Calendar.SpanDay", { name: t("journal.pageName", f.name), day: f.day, total: f.total })
        : "",
      // The Warden's own: which watch it happens in, whether the party can see
      // it, and the controls that only the Warden gets.
      warden: f.warden,
      watch: f.warden ? watchLineFor(f.watch) : "",
      hidden: f.hidden,
      uuid: f.uuid,
    }));

    return {
      day: day.dayOfMonth,
      dateLine: month.reclamation
        ? day.reclamationName
        : formatValdDate(components),
      reclamationNote: month.reclamation ? game.i18n.localize("CAIRN.Calendar.Reclamation") : "",
      seasonName: day.seasonName,
      seasonIcon: day.seasonIcon,
      seasonBegins: day.seasonBegins
        ? game.i18n.format("CAIRN.Calendar.SeasonBegins", { season: day.seasonName })
        : "",
      festivals: on,
      quiet: on.length === 0,
      isToday,
      // The weather belongs to TODAY and to no other day. A calendar that
      // showed "the weather" beside a day three weeks out would be claiming
      // something nobody has said.
      weather: isToday ? todayWeather() : "",
      weatherUnknown: isToday && !todayWeather(),
    };
  }

  /**
   * Translate the festival prose after it is in the DOM.
   *
   * The same call the journal sheet makes, on the same list, which is why
   * `JOURNAL_BLOCKS` moved into `i18n-content.js` — two readers, one contract
   * with the extractor.
   * @override
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const node of this.element.querySelectorAll(".cairn-calendar-festival-text")) {
      localizeJournalBlocks(node);
    }
  }

  /* ---- actions ---- */

  static #step(app, delta) {
    const months = monthChoices(app.#view.year).map((m) => m.index);
    const at = months.indexOf(app.#view.month);
    const next = at + delta;
    if (next >= 0 && next < months.length) {
      app.#view = { year: app.#view.year, month: months[next] };
    } else {
      const year = app.#view.year + delta;
      const wrapped = monthChoices(year).map((m) => m.index);
      app.#view = { year, month: delta > 0 ? wrapped[0] : wrapped[wrapped.length - 1] };
    }
    app.render();
  }

  static #onPrevMonth() { ValdCalendarApp.#step(this, -1); }

  static #onNextMonth() { ValdCalendarApp.#step(this, 1); }

  static #onToday() { this.reset(); this.render(); }

  static #onPickDay(event, target) {
    const day = Number(target.dataset.day);
    if (!Number.isInteger(day)) return;
    this.#selected = { year: this.#view.year, month: this.#view.month, day };
    this.render();
  }

  /**
   * Move everyone's clock to the day on screen, KEEPING THE CURRENT WATCH.
   *
   * A date change should not silently rewind the day's progress: a Warden
   * fixing the date at dusk means the same dusk on another day, not dawn.
   */
  static async #onSetToDay() {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.TimeWardenOnly"));
      return;
    }
    const at = this.#selected ?? { ...this.#view, day: 1 };
    await setDate({ year: at.year, month: at.month, dayOfMonth: at.day, watch: currentWatch() });
  }

  static async #onSetWeather() {
    await promptSetWeather();
  }

  /**
   * Put something on the day that is open.
   *
   * THE DAY COMES FROM THE PANEL, not from today: a Warden adding an event is
   * looking at the day they mean. `#selected` is null only while the panel is
   * showing the month's first day, which is exactly what the fallback names.
   *
   * No render afterwards — creating the page fires `createJournalEntryPage`,
   * which refreshes every open calendar including this one, on every client.
   */
  static async #onAddEvent() {
    const at = this.#selected ?? { ...this.#view, day: 1 };
    await promptAddEvent({ year: at.year, month: at.month, day: at.day });
  }

  static async #onEditEvent(event, target) {
    await openEvent(target.dataset.uuid);
  }

  static async #onRemoveEvent(event, target) {
    await removeEvent(target.dataset.uuid);
  }
}

/* -------------------------------------------- */

/** The one instance. */
let app = null;

/** Is there a Vald calendar to show at all? */
export const valdCalendarAvailable = () =>
  valdEnabled() && game.time?.calendar?.name === VALD_CALENDAR_CONFIG.name;

/**
 * Open it, or bring it forward. Anyone may — reading the calendar needs no
 * permission, which is the whole point of putting it on the clock.
 */
export const openValdCalendar = async () => {
  if (!valdCalendarAvailable()) return null;
  app ??= new ValdCalendarApp();
  if (app.rendered) {
    app.bringToFront?.();
    return app;
  }
  return app.render({ force: true });
};

/** Redraw on a clock change or a weather change, keeping the browsed month. */
export const refreshValdCalendar = () => {
  if (!app?.rendered) return null;
  return app.render();
};

/** Probe hook: is it open, and what is it looking at? */
export const _calendarApp = () => app;

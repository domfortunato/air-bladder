import { SETTINGS_NS } from "./settings.js";
import {
  describeTime, formatValdDate, currentSeason, todayWeather, dayCount,
} from "./game-time.js";
import { marksOn, isWardenJournal } from "./calendar-events.js";

/**
 * A journal line every time the weather is rolled or set.
 *
 * Asked for on 2026-09-11: "is it possible for changes in weather to write a
 * log entry to a journal that records date, calendar events, and the weather?"
 *
 * OFF BY DEFAULT (`weather-log`), and the default is not timidity: switching it
 * on makes this system create a document in somebody's world, which an update
 * must never start doing by itself.
 *
 * WRITTEN FROM THE `cairnWeatherChanged` HOOK rather than from the buttons, so
 * every route is covered — Roll Today's Weather, the pencil on either surface,
 * a macro calling `setTodayWeather` — and `game-time.js` needs no import of
 * this file, which would be a cycle.
 *
 * EXACTLY ONE CLIENT WRITES. That hook fires on every client that hears the
 * setting change, so without the active-GM guard every logged-in Warden
 * appends the same line and a table with two GMs gets doubles. `activeGM` is
 * the same answer `connections.js` uses for a write only one client may make.
 *
 * IT IS A RECORD, NOT UI, and one consequence is worth stating rather than
 * discovering: the line is written in the language of the Warden whose client
 * wrote it, and it stays that way. Every other list of names in this system
 * goes through the content overlay so each reader sees their own language;
 * this one cannot, because it is text stored in a document rather than text
 * rendered for a viewer.
 */

const LOG_SETTING = "weather-log";


/** How many days share a page when the calendar has no months worth naming. */
const PLAIN_PAGE_DAYS = 30;

const logEnabled = () => {
  try {
    return !!game.settings.get(SETTINGS_NS, LOG_SETTING);
  } catch {
    return false;
  }
};

/* -------------------------------------------- */
/*  The journal                                 */
/* -------------------------------------------- */

/**
 * The log journal, made on demand.
 *
 * FOUND BY ITS OWN FLAG. Not by name — that goes through the content overlay
 * and the Warden may rename it — and not by an id kept in a setting, because
 * awaiting `game.settings.set` does not guarantee the next `get` on the same
 * client returns the new value. An identity that must be written and read back
 * is occasionally missing for a few hundred milliseconds, and a second line of
 * weather inside that window would start a second journal.
 *
 * Deleting it is therefore how a Warden starts a fresh log, and that is the
 * behaviour to expect rather than a surprise.
 */
const logJournal = async () => {
  // ...AND LAST WRITTEN BY A WARDEN — see `isWardenJournal` for why a flag
  // alone is not identity, and why it is the last writer (review #27).
  const found = game.journal.find((j) => j.flags?.["air-bladder"]?.weatherLog && isWardenJournal(j));
  if (found) return found;

  return getDocumentClass("JournalEntry").create({
    name: game.i18n.localize("CAIRN.WeatherLog.Title"),
    flags: { "air-bladder": { weatherLog: true } },
    // The whole table reads it (user ruling 2026-09-11): looking back at what
    // the weather did on the road is most of the reason to keep one. OBSERVER
    // rather than OWNER — the party reads the log, the Warden writes it.
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
  });
};

/**
 * Which page today belongs on, and what it is called.
 *
 * ONE PAGE PER MONTH under Vald, because that is the unit a Warden thinks in
 * and it keeps any one page short enough to read. Under Foundry's own calendar
 * there is no month worth naming — the clock deliberately says "Day 12" rather
 * than a Gregorian date nobody's Cairn world is living in — so the pages are
 * plain runs of days instead, and a page called "January, 0" over lines that
 * read "Day 12" never happens.
 *
 * The KEY is a flag, not the name: the name goes through the content overlay
 * and could be edited by the Warden, and neither should start a second page
 * for the same month.
 */
const pageFor = (time) => {
  if (time.vald) {
    const c = game.time.components ?? {};
    const year = (c.year ?? 0) + (game.time.calendar?.years?.yearZero ?? 0);
    const month = game.time.calendar?.months?.values?.[c.month ?? 0]?.name ?? "";
    return {
      key: `vald:${year}:${c.month ?? 0}`,
      name: game.i18n.format("CAIRN.WeatherLog.PageMonth", {
        month: game.i18n.localize(month),
        year,
      }),
      sort: (year * 100) + (c.month ?? 0),
    };
  }
  const bucket = Math.floor((dayCount() - 1) / PLAIN_PAGE_DAYS);
  const from = (bucket * PLAIN_PAGE_DAYS) + 1;
  return {
    key: `days:${bucket}`,
    name: game.i18n.format("CAIRN.WeatherLog.PageDays", {
      from,
      to: from + PLAIN_PAGE_DAYS - 1,
    }),
    sort: bucket,
  };
};

/* -------------------------------------------- */
/*  The line                                    */
/* -------------------------------------------- */

/**
 * What today's line says: when it was, what was marked, and what the sky did.
 *
 * The marks come from the same list the calendar grid renders — the Warden's
 * Guide festivals and the Warden's own events — and only under Vald, because
 * a festival's month and day mean nothing against a calendar with twelve
 * months of different lengths.
 */
const lineFor = async (weather) => {
  const time = describeTime();
  const season = currentSeason();
  const when = [
    time.vald ? formatValdDate() : time.dateLine,
    time.watchLine,
    season ? game.i18n.format("CAIRN.Time.SeasonOf", { season: game.i18n.localize(season.name) }) : "",
  ].filter(Boolean).join(" · ");

  const esc = foundry.utils.escapeHTML;
  let line = esc(game.i18n.format("CAIRN.WeatherLog.Entry", { when, weather }));

  if (time.vald) {
    const c = game.time.components ?? {};
    const names = await marksOn({
      year: (c.year ?? 0) + (game.time.calendar?.years?.yearZero ?? 0),
      month: c.month ?? 0,
      day: (c.dayOfMonth ?? 0) + 1,
    });
    if (names.length) {
      line += ` <em>${esc(game.i18n.format("CAIRN.WeatherLog.Marks", { names: names.join(", ") }))}</em>`;
    }
  }
  return `<li>${line}</li>`;
};

/* -------------------------------------------- */

/**
 * Write the day's weather into the log, if the Warden keeps one.
 *
 * APPENDS rather than replacing the day's line. Rolling twice in one day is
 * the weather changing, and the page is an ordinary journal page the Warden
 * can edit if it was a misclick.
 *
 * An empty value writes nothing: clearing the weather is not an entry.
 *
 * NOT EXPORTED, and never called directly — go through `recordWeather` below,
 * which serializes it. Every step in here is a find-then-create or a
 * read-then-update across an `await`.
 */
const writeWeatherLine = async () => {
  if (!logEnabled()) return null;
  if (!game.user.isGM || game.users.activeGM !== game.user) return null;
  const weather = todayWeather();
  if (!weather) return null;

  const entry = await logJournal();
  if (!entry) return null;

  const at = pageFor(describeTime());
  const li = await lineFor(weather);
  const page = entry.pages.find((p) => p.flags?.["air-bladder"]?.weatherLogKey === at.key);

  if (!page) {
    await entry.createEmbeddedDocuments("JournalEntryPage", [{
      name: at.name,
      type: "text",
      title: { show: true, level: 1 },
      text: { content: `<ul>${li}</ul>`, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      sort: at.sort,
      flags: { "air-bladder": { weatherLogKey: at.key } },
    }]);
    return entry;
  }

  // Insert before the list's close, so the newest line is at the bottom where
  // a log is read from. A page a Warden has rewritten without a list still
  // takes the line rather than losing it.
  const had = String(page.text?.content ?? "");
  const content = had.includes("</ul>")
    ? had.replace(/<\/ul>(?![\s\S]*<\/ul>)/, `${li}</ul>`)
    : `${had}<ul>${li}</ul>`;
  await page.update({ "text.content": content });
  return entry;
};

/**
 * The tail of the write chain. One line is written at a time, in order.
 *
 * THE ACTIVE-GM GUARD IS NOT ENOUGH ON ITS OWN, which is the whole reason this
 * exists. That guard settles WHICH CLIENT writes; it says nothing about two
 * writes racing ON that client, and every step of `writeWeatherLine` is a
 * find-then-create or a read-then-update with an `await` in the middle:
 *
 *   - the journal itself, found by flag and created when absent,
 *   - the month's page, found by flag and created when absent,
 *   - the page's text, read, appended to, and written back.
 *
 * `cairnWeatherChanged` starts this without awaiting it (cairn.js), and
 * `setTodayWeather` resolves as soon as the SETTING write lands, so a second
 * weather change can arrive while the first create is still in flight. Both
 * runs then find nothing and create — two journals both flagged as the log,
 * or two pages for one month, or a second line silently clobbering the first.
 * Once two journals exist the split is permanent and invisible: `find` returns
 * whichever the collection indexes first and the other sits orphaned in the
 * sidebar, readable by the whole table, indistinguishable from the Warden
 * having deliberately started a fresh log.
 *
 * The same primitive this codebase already uses for this shape in five places
 * (`offersInFlight`, `encounterSpawnInFlight`, `pcGenerationInFlight`,
 * `kwImportInFlight`, `grantActorsInFlight`). A promise chain rather than a
 * boolean, because a second line must be WRITTEN after the first, not dropped.
 *
 * A rejected write must not poison the chain, so the stored tail swallows it
 * while the caller still receives it.
 */
let writing = Promise.resolve(null);

export const recordWeather = () => {
  const next = writing.then(writeWeatherLine, writeWeatherLine);
  writing = next.catch(() => null);
  return next;
};

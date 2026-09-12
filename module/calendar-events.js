import { WATCH_KEYS } from "./game-time.js";
import { t } from "./i18n-content.js";

/**
 * What is marked on a day: the Warden's Guide festivals, and the Warden's own.
 *
 * THE TWO SOURCES SHARE ONE CONTRACT and that is the whole design. A festival
 * is a page in the `journals-vald` compendium carrying
 * `flags.air-bladder.{valdMonth, valdDay, valdDays}`; an event a Warden adds is
 * a page in a WORLD journal carrying the same three plus `valdYear`,
 * `valdWatch` and `wardenEvent`. So the grid, the span walk, the tooltip and
 * the day panel all read one list and neither source needs a rendering path of
 * its own.
 *
 * IDENTITY IS THE FLAGS, NEVER A NAME. Entry and page names both go through the
 * content overlay, so a lookup keyed on one finds nothing on a Spanish client —
 * the exact failure the overlay's own rule exists to prevent.
 *
 * THE PACK IS CACHED AND THE WORLD IS NOT. A compendium does not change under
 * us; a world journal changes the moment a Warden adds an event, and a cache
 * there would mean reopening the window to see what you just typed.
 *
 * WHY TWO WORLD JOURNALS RATHER THAN A FLAG ON THE PAGE: ownership is the one
 * mechanism a player's client applies without being asked, so the party's
 * calendar and the party's sidebar both follow it for free, and nothing here
 * has to remember to filter.
 *
 * WHAT "HIDDEN" IS, EXACTLY, AND IT IS NOT A SECRET. MEASURED, not assumed: a
 * JournalEntry with `ownership.default: NONE` IS STILL SENT to every player —
 * `game.journal.get(id)` resolves on their client, its pages are there and
 * their text is readable from the console. What NONE buys is `visible: false`
 * and `testUserPermission(user, "OBSERVER") === false`, so it is off their
 * sidebar and off their calendar. That is CONCEALMENT, the same thing a
 * compendium's ownership NONE gives (and the same mistake was nearly made
 * there). A Warden with a genuine secret should keep it outside the world, and
 * `docs/keeping-time.md` says so where they will read it.
 */

const VALD_PACK = "air-bladder.journals-vald";

/* -------------------------------------------- */
/*  The shipped festivals                       */
/* -------------------------------------------- */

/** month/day -> the festivals on it. Built once; a compendium does not change. */
let FESTIVALS = null;

/**
 * A span is filed on EVERY day it covers, each carrying which day of the run it
 * is, so the grid marks all three days of the Splash Festival rather than only
 * the first. Month lengths come from the live calendar, so a run crossing a
 * month boundary lands where it should even though none does today.
 */
const spread = (map, { month, day, days, make }) => {
  const months = (game.time.calendar?.months?.values ?? []).map((m) => m.days ?? 0);
  const total = Math.max(1, Number(days) || 1);
  let m = month;
  let d = day;
  for (let i = 0; i < total; i++) {
    const key = `${m}/${d}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(make(i + 1, total));
    d += 1;
    if (d > (months[m] ?? 0)) { d = 1; m = (m + 1) % Math.max(1, months.length); }
  }
};

const loadFestivals = async () => {
  if (FESTIVALS) return FESTIVALS;
  const map = new Map();
  const pack = game.packs.get(VALD_PACK);
  if (!pack) {
    FESTIVALS = map;
    return map;
  }

  for (const entry of await pack.getDocuments()) {
    for (const page of entry.pages ?? []) {
      const f = page.flags?.["air-bladder"];
      const month = Number(f?.valdMonth);
      const day = Number(f?.valdDay);
      if (!Number.isInteger(month) || !Number.isInteger(day)) continue;
      spread(map, {
        month: month - 1, // the flag is the source's 1-based number
        day,
        days: f?.valdDays,
        make: (n, total) => ({
          id: page.id,
          name: page.name,
          text: page.text?.content ?? "",
          day: n,
          total,
          warden: false,
          watch: null,
          hidden: false,
          uuid: page.uuid,
        }),
      });
    }
  }
  FESTIVALS = map;
  return map;
};

/** Probe hook: forget the cache so a freshly built pack is picked up. */
export const _resetFestivals = () => { FESTIVALS = null; };

/* -------------------------------------------- */
/*  The Warden's own                            */
/* -------------------------------------------- */

/**
 * The journal holding events of one kind, or null.
 *
 * FOUND BY ITS OWN FLAG, not by name and not by an id kept in a setting.
 *
 * Not by NAME, because a name goes through the content overlay and a Warden may
 * rename it. Not by a STORED ID either, and that is the more interesting half:
 * awaiting `game.settings.set` does NOT guarantee that the next
 * `game.settings.get` on the same client returns the new value — measured, and
 * intermittent, which is the worst kind. An identity that has to be written and
 * read back is an identity that is occasionally missing for a few hundred
 * milliseconds, and the calendar renders inside that window. The flag is on the
 * document itself and is true the moment it exists.
 */
/**
 * Was this document last written by a Gamemaster? `_stats.lastModifiedBy` is
 * stamped by the SERVER from the requesting user and a client cannot forge it
 * — the same field `syncPendingOwnership` (connections.js) already leans on.
 *
 * WHY EVERY FLAG-FOUND JOURNAL HERE ASKS THIS (review #27): a flag is on a
 * document any TRUSTED player may create (`JOURNAL_CREATE` defaults to that
 * role, and the creator lands OWNER), so a player's journal flagged like ours
 * and sorting first would have captured every line the Warden writes — the
 * weather log's pages, the next "Add an event…" — into a document the player
 * edits, and its pages flagged `wardenEvent` would have drawn on the Warden's
 * own calendar. Not an escalation, since the Warden sees the decoy on the
 * sidebar; still the wrong document. A journal nobody can vouch for is not
 * ours, and the module makes its own.
 *
 * LAST writer, not creator, and that is not a choice: the review named
 * `_stats.createdBy`, and 14.365 has no such field — measured on a freshly
 * created journal, whose `_stats` carries `lastModifiedBy` and nothing about
 * who created it. A guard on the absent field was false for every journal,
 * ours included, and made a fresh log on every write (dev:vald-time caught
 * it, twelve legs deep). The last writer works because our journals never
 * admit a player's write — OBSERVER or NONE by default — so a player's decoy
 * stays theirs and ours stay the Warden's; a Warden who edits a decoy by hand
 * has adopted it, which is fair.
 * @param {foundry.abstract.Document} doc
 * @returns {boolean}
 */
export const lastWrittenByWarden = (doc) => !!game.users.get(doc?._stats?.lastModifiedBy)?.isGM;

const eventsJournal = (hidden = false) => {
  const kind = hidden ? "hidden" : "shared";
  return game.journal.find((j) => j.flags?.["air-bladder"]?.calendarEvents === kind && lastWrittenByWarden(j)) ?? null;
};

/** Make the journal for one kind. GM only — it is a world write. */
const makeEventsJournal = async (hidden) => {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  return getDocumentClass("JournalEntry").create({
    name: game.i18n.localize(hidden ? "CAIRN.Calendar.EventsJournalHidden" : "CAIRN.Calendar.EventsJournal"),
    // OBSERVER, not OWNER: the party reads the calendar, it does not write it.
    // NONE keeps the other off their sidebar and their calendar — concealment,
    // not a wall; see the note at the top of this file.
    ownership: { default: hidden ? L.NONE : L.OBSERVER },
    flags: { "air-bladder": { calendarEvents: hidden ? "hidden" : "shared" } },
  });
};

/**
 * Every event page this client may SEE.
 *
 * Read LIVE from `game.journal`, which is in memory — there is nothing to await
 * and nothing to cache.
 *
 * THE PERMISSION TEST IS LOAD-BEARING and is not belt-and-braces. A player's
 * client DOES hold the hidden entry — Foundry sends it, ownership NONE and all
 * — so nothing above this line has kept it off their calendar. This is the
 * line that does.
 */
const eventPages = () => {
  const out = [];
  for (const hidden of [false, true]) {
    const entry = eventsJournal(hidden);
    for (const page of entry?.pages ?? []) {
      if (!page.flags?.["air-bladder"]?.wardenEvent) continue;
      if (!page.testUserPermission(game.user, "OBSERVER")) continue;
      out.push({ page, hidden });
    }
  }
  return out;
};

/* -------------------------------------------- */
/*  What is marked on a day                     */
/* -------------------------------------------- */

/**
 * Everything marked in one displayed YEAR, as a Map keyed `month/dayOfMonth`.
 *
 * The year matters only to the Warden's own events: a festival recurs forever,
 * while an event is either stamped with the year it happens in or repeats
 * annually (`valdYear: null`). The map itself carries no year, so the filter
 * happens here rather than in the grid.
 */
export const marksByDay = async (year) => {
  const festivals = await loadFestivals();
  const map = new Map(festivals);
  // A shallow copy of the cache's ARRAYS as well, or an event would be pushed
  // into the cached festival list and appear again next render.
  for (const [key, list] of map) map.set(key, [...list]);

  for (const { page, hidden } of eventPages()) {
    const f = page.flags["air-bladder"];
    const month = Number(f.valdMonth);
    const day = Number(f.valdDay);
    if (!Number.isInteger(month) || !Number.isInteger(day)) continue;
    const stamped = f.valdYear ?? null;
    if (stamped !== null && Number(stamped) !== Number(year)) continue;
    const watch = Number.isInteger(f.valdWatch) ? f.valdWatch : null;
    spread(map, {
      month: month - 1,
      day,
      days: f.valdDays,
      make: (n, total) => ({
        id: page.id,
        name: page.name,
        text: page.text?.content ?? "",
        day: n,
        total,
        warden: true,
        watch,
        hidden,
        uuid: page.uuid,
      }),
    });
  }
  return map;
};

/** The watch an event happens in, ready to display, or "" for all day. */
export const watchLineFor = (watch) => (Number.isInteger(watch) && WATCH_KEYS[watch]
  ? game.i18n.format("CAIRN.Time.WatchOf", { watch: game.i18n.localize(WATCH_KEYS[watch]) })
  : game.i18n.localize("CAIRN.Calendar.EventWatchAny"));

/**
 * One line naming what a day carries, for the weather log.
 *
 * Names go through the overlay the way every other list of names here does.
 * What it is written INTO does not — see `weather-log.js`.
 */
export const marksOn = async ({ year, month, day }) => {
  const map = await marksByDay(year);
  return (map.get(`${month}/${day}`) ?? []).map((m) => t("journal.pageName", m.name));
};

/* -------------------------------------------- */
/*  Adding one                                  */
/* -------------------------------------------- */

/**
 * Ask the Warden what happens, and write it as a page.
 *
 * BUILT AS AN ELEMENT, with the values read in the button callback. DialogV2
 * sanitizes a string it is handed and listeners on sanitized markup are dead —
 * the trap `promptSetDate`, `promptSetWeather` and `warden-damage.js` all
 * carry.
 *
 * @param {{year: number, month: number, day: number}} at  the day on screen
 */
export const promptAddEvent = async (at) => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.TimeWardenOnly"));
    return null;
  }
  const esc = foundry.utils.escapeHTML;
  const L = (k) => esc(game.i18n.localize(k));

  const watches = WATCH_KEYS
    .map((k, i) => `<option value="${i}">${L(k)}</option>`)
    .join("");

  // A BARE <div>, WITH NO ATTRIBUTES — not even a class. DialogV2 throws
  // "config.content element must have no attributes" from its constructor
  // (dialog.mjs:189), so a class on the root kills the whole dialog and the
  // button does nothing at all. The class goes on a wrapper INSIDE it.
  const form = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "cairn-add-event";
  form.append(inner);
  inner.innerHTML = `
    <p class="hint">${L("CAIRN.Calendar.AddEventHint")}</p>
    <div class="form-group">
      <label for="ab-event-name">${L("CAIRN.Calendar.EventName")}</label>
      <input id="ab-event-name" type="text" name="name" maxlength="120" autofocus>
    </div>
    <div class="form-group">
      <label for="ab-event-text">${L("CAIRN.Calendar.EventText")}</label>
      <textarea id="ab-event-text" name="text" rows="4"></textarea>
    </div>
    <div class="form-group">
      <label for="ab-event-watch">${L("CAIRN.Calendar.EventWatch")}</label>
      <select id="ab-event-watch" name="watch">
        <option value="">${L("CAIRN.Calendar.EventWatchAny")}</option>
        ${watches}
      </select>
    </div>
    <div class="form-group">
      <label for="ab-event-days">${L("CAIRN.Calendar.EventDays")}</label>
      <input id="ab-event-days" type="number" name="days" value="1" min="1" max="24" step="1">
    </div>
    <div class="form-group">
      <label for="ab-event-year">${L("CAIRN.Calendar.EventEveryYear")}</label>
      <input id="ab-event-year" type="checkbox" name="everyYear">
    </div>
    <div class="form-group">
      <label for="ab-event-shared">${L("CAIRN.Calendar.EventShared")}</label>
      <input id="ab-event-shared" type="checkbox" name="shared" checked>
    </div>`;

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: "CAIRN.Calendar.AddEventTitle" },
    content: form,
    buttons: [
      {
        action: "add",
        label: "CAIRN.Calendar.AddEventTitle",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element ?? button.form;
          const val = (name) => root.querySelector(`[name=${name}]`);
          return {
            name: val("name")?.value ?? "",
            text: val("text")?.value ?? "",
            watch: val("watch")?.value ?? "",
            days: Number(val("days")?.value) || 1,
            everyYear: !!val("everyYear")?.checked,
            shared: !!val("shared")?.checked,
          };
        },
      },
      { action: "cancel", label: game.i18n.localize("CAIRN.Cancel") },
    ],
    rejectClose: false,
  });

  if (!picked || picked === "cancel") return null;
  const name = String(picked.name).trim();
  if (!name) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.EventNeedsName"));
    return null;
  }

  const hidden = !picked.shared;
  const entry = eventsJournal(hidden) ?? await makeEventsJournal(hidden);
  if (!entry) return null;

  // The description is the Warden's own prose in a plain paragraph. It is
  // ESCAPED on the way in: a journal page's content is a core HTMLField the
  // server sanitizes on write, but that strips scripts rather than making the
  // Warden's angle brackets mean what they typed.
  const body = String(picked.text).trim();
  const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
    name,
    type: "text",
    title: { show: true, level: 1 },
    text: {
      content: body ? `<p>${foundry.utils.escapeHTML(body)}</p>` : "",
      format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
    },
    flags: {
      "air-bladder": {
        wardenEvent: true,
        valdMonth: at.month + 1, // 1-based, like the importer's flag
        valdDay: at.day,
        valdDays: Math.max(1, Math.min(24, Number(picked.days) || 1)),
        valdYear: picked.everyYear ? null : at.year,
        valdWatch: picked.watch === "" ? null : Number(picked.watch),
      },
    },
  }]);
  return page ?? null;
};

/** Open one of the Warden's events for editing. It is an ordinary page. */
export const openEvent = async (uuid) => {
  const page = await fromUuid(uuid);
  return page?.sheet?.render({ force: true }) ?? null;
};

/** Take one off the calendar. The page goes with it — there is nothing else to it. */
export const removeEvent = async (uuid) => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.TimeWardenOnly"));
    return null;
  }
  const page = await fromUuid(uuid);
  if (!page?.flags?.["air-bladder"]?.wardenEvent) return null;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "CAIRN.Calendar.RemoveEvent" },
    content: `<p>${foundry.utils.escapeHTML(
      game.i18n.format("CAIRN.Calendar.RemoveEventConfirm", { name: page.name }))}</p>`,
    rejectClose: false,
  });
  if (!ok) return null;
  return page.delete();
};

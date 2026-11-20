import { SETTINGS_NS } from "./settings.js";
import { describeTime, currentWatch, currentSeason } from "./game-time.js";
import { openValdCalendar, valdCalendarAvailable } from "./vald-calendar.js";

/**
 * The calendar bar: what time it is, across the top of everyone's screen.
 *
 * Cairn counts travel in watches and the tables this system ships price a
 * journey in them, but until 2026-09-10 only the Warden knew which watch it
 * was, and only on paper. This puts it where the table can see it.
 *
 * IT WAS A CARD ABOVE THE PLAYER LIST until 2026-11-20, when the user asked
 * for it "across the top of the canvas, like Mythic Bastionland displays its
 * calendar" (their own db-mythic system). The internal names (`WatchClock`,
 * `#cairn-watch-clock`, `show-watch-clock`) stayed, so nothing that reads
 * them had to move; the user-facing name is "the calendar bar".
 *
 * WHERE IT LIVES, AND WHY IT NEEDS NO HOOK TO STAY THERE. `#ui-top` is static
 * markup in core's `templates/views/game.hbs`, inside `#ui-middle`: a header
 * holding only an unused, unstyled `#loading` div. Core scales `#ui-middle` by
 * the interface scale from the top centre and makes it `pointer-events: none`,
 * and no core script rewrites `#ui-top`, so an element prepended at ready is
 * never lost. The bar takes the pointer back on its tabs alone, so the map
 * under the rest of the strip still takes clicks. v14 has no horizontal scene
 * bar any more (`#scene-navigation` is a list in the LEFT column), so the top
 * centre is empty; notifications hang at 10vh, below a bar this short.
 *
 * TABS, LEFT TO RIGHT: the watch, the date, and under Vald the season. Today's
 * weather, once the Warden has called it, HANGS UNDER the bar rather than
 * joining it, so calling the weather never widens the bar or shifts its tabs
 * (db-mythic learned this with its holiday line). Each tab is coloured by its
 * watch or season, the same in both interface schemes.
 *
 * TUCKED, PER PERSON (the user's pick, after db-mythic): `tuck-calendar-bar`, a
 * client setting, slides the bar up to a 6px lip. Pointing at the lip, tabbing
 * into a tab, or touching it pulls it down; it tucks itself again half a second
 * after the pointer or focus leaves (a touch-pulled bar, after a touch
 * elsewhere). The key (Y to start) pulls it down to stay, and tucks it again.
 * The Warden's `show-watch-clock` still takes it off everyone's screen.
 *
 * THE DATE TAB IS THE DOOR TO THE CALENDAR (user ruling 2026-09-10), and the
 * season tab with it, only where there is a calendar to open. Opening it moves
 * nothing: the calendar is read-only for a player, and the controls that move
 * time live only on the Warden's Dashboard.
 */
class WatchClock extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: "cairn-watch-clock",
    tag: "nav",
    classes: ["cairn-watch-clock", "cairn-calendar-bar"],
    window: { frame: false, positioned: false },
    actions: { openCalendar: () => openValdCalendar() },
  };

  static PARTS = {
    clock: { template: "systems/air-bladder/templates/ui/watch-clock.html" },
  };

  /** @override */
  async _prepareContext() {
    const watch = WATCH_TONES[currentWatch()] ?? WATCH_TONES[0];
    return {
      ...describeTime(),
      calendar: valdCalendarAvailable(),
      watchTone: watch.tone,
      watchIcon: watch.icon,
      seasonTone: SEASON_TONES[currentSeason()?.name] ?? "parchment",
    };
  }

  /**
   * Place the bar at the top of `#ui-top`, or decline. Core's own version
   * appends to `document.body` (application.mjs), which for a frameless,
   * unpositioned element is the viewport's top-left corner over the map — so a
   * missing `#ui-top` (a future core, or a module that rebuilt the game view)
   * warns and renders nowhere rather than somewhere worse. `existing` is
   * core's branch, kept: a render after a close lands in the same place.
   * @override
   */
  async _insertElement(element) {
    const top = document.getElementById("ui-top");
    if (!top) {
      console.warn("air-bladder | no #ui-top, so the calendar bar has nowhere to hang.");
      return;
    }
    const existing = document.getElementById(element.id);
    if (existing) {
      existing.replaceWith(element);
      return;
    }
    top.prepend(element);
  }

  /** The tuck's listeners, once per element. @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    listenForPull(this.element);
  }

  /** The tuck follows this browser's setting on every render. @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("is-tucked", tuckedHere());
    syncTooltips();
  }
}

/** Each watch's tone (cairn.css `.tone-*`) and glyph, in watch order. */
const WATCH_TONES = [
  { tone: "morning", icon: "fa-sun" },
  { tone: "afternoon", icon: "fa-cloud-sun" },
  { tone: "night", icon: "fa-moon" },
];

/** Each Vald season's tone, keyed on the season's raw `name` field. */
const SEASON_TONES = {
  "CAIRN.Vald.Season.Dead": "dead",
  "CAIRN.Vald.Season.Dry": "dry",
  "CAIRN.Vald.Season.Wet": "wet",
  "CAIRN.Vald.Season.Harvest": "harvest",
  "CAIRN.Vald.Season.Reclamation": "reclamation",
};

/* -------------------------------------------- */
/*  The tuck                                    */
/* -------------------------------------------- */

/** Is the bar tucked away on THIS browser? The setting is each person's own. */
const tuckedHere = () => {
  try {
    return !!game.settings.get(SETTINGS_NS, "tuck-calendar-bar");
  } catch {
    return false;
  }
};

/** How long the pointer or focus may be away before a pulled-down bar tucks. */
const TUCK_DELAY_MS = 500;

/**
 * A tucked bar's state while pulled down: the key's pin (down until the key
 * again), a touch's pull (down until a touch elsewhere), whether the pointer
 * is over the bar, whether its next enter is ignored (after the key tucks it
 * under the pointer), whether the click of the press that pulled it is
 * swallowed, and the timer that tucks it again.
 */
const pull = { pinned: false, touch: false, hovering: false, ignoreEnter: false, swallowClick: false, timer: null };

const barElement = () => document.getElementById("cairn-watch-clock");

/** Tucked and not pulled down: only the lip shows. */
const lipOnly = (el = barElement()) => !!el?.classList.contains("is-tucked") && !el.classList.contains("is-down");

/** A pulled-down bar may tuck when nothing holds it. */
const mayTuck = () => {
  const el = barElement();
  return !!el?.classList.contains("is-tucked") && el.classList.contains("is-down")
    && !pull.pinned && !pull.touch && !pull.hovering && !el.querySelector(":focus-visible");
};

/**
 * Give the tabs their tooltips, or take them away behind the lip: core places
 * a tooltip once, where the tab stood as it was hovered, so a tab sliding down
 * would leave its tooltip floating at the lip (db-mythic's rule). The words
 * live in `data-bar-tooltip`; `data-tooltip` is what core reads.
 */
const syncTooltips = () => {
  const el = barElement();
  if (!el) return;
  const hide = lipOnly(el);
  for (const tab of el.querySelectorAll("[data-bar-tooltip]")) {
    if (hide) delete tab.dataset.tooltip;
    else tab.dataset.tooltip = tab.dataset.barTooltip;
  }
};

const pullDown = () => {
  clearTimeout(pull.timer);
  const el = barElement();
  if (!el?.classList.contains("is-tucked") || el.classList.contains("is-down")) return;
  el.classList.add("is-down");
  syncTooltips();
};

const tuckUp = () => {
  clearTimeout(pull.timer);
  pull.pinned = false;
  pull.touch = false;
  document.removeEventListener("pointerdown", awayFromTouch, true);
  const el = barElement();
  if (!el?.classList.contains("is-down")) return;
  el.classList.remove("is-down");
  game.tooltip?.deactivate?.();
  syncTooltips();
};

const tuckSoon = () => {
  clearTimeout(pull.timer);
  if (!mayTuck()) return;
  pull.timer = setTimeout(() => {
    if (mayTuck()) tuckUp();
  }, TUCK_DELAY_MS);
};

/** A touch anywhere but the bar tucks a touch-pulled bar again. */
const awayFromTouch = (event) => {
  if (barElement()?.contains(event.target)) return;
  tuckUp();
};

/**
 * The pointer and the focus on a tucked bar (after db-mythic). The bar takes
 * no pointer itself, but enter and leave still reach it from the tab under the
 * pointer. A touch is handled on its press alone: Chrome sends a leave after
 * every tap, so a touch-pulled bar ignores leaving, and the press that pulls
 * the bar down would also be a click on the tab under the lip (the calendar's
 * door), which is swallowed.
 * @param {HTMLElement} element
 */
const listenForPull = (element) => {
  Object.assign(pull, { pinned: false, touch: false, hovering: false, ignoreEnter: false, swallowClick: false });
  element.addEventListener("pointerenter", (event) => {
    pull.hovering = true;
    if (event.pointerType === "touch" || pull.ignoreEnter) return;
    pullDown();
  });
  element.addEventListener("pointerleave", (event) => {
    pull.hovering = false;
    pull.ignoreEnter = false;
    if (event.pointerType !== "touch") tuckSoon();
  });
  element.addEventListener("pointerdown", (event) => {
    pull.swallowClick = lipOnly(element);
    if (!pull.swallowClick) return;
    pull.ignoreEnter = false;
    pullDown();
    if (event.pointerType === "touch") {
      pull.touch = true;
      document.addEventListener("pointerdown", awayFromTouch, true);
    }
  }, true);
  element.addEventListener("click", (event) => {
    if (!pull.swallowClick) return;
    pull.swallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  // The keyboard's Tab into a tab pulls it down; a mouse press's focus does
  // not count, or the bar would stay down.
  element.addEventListener("focusin", (event) => {
    if (event.target.matches(":focus-visible")) pullDown();
  });
  // Read once the focus has landed, so a move from tab to tab is not leaving.
  element.addEventListener("focusout", () => setTimeout(tuckSoon));
};

/**
 * The key (Y to start, Configure Controls): on a tucked bar, pull it down to
 * stay, or tuck it up again. On a bar that is not tucked it does nothing and
 * returns false, so the key falls through to anything else bound to it.
 * @returns {Boolean}
 */
export const pullCalendarBar = () => {
  if (!barElement()?.classList.contains("is-tucked")) return false;
  if (pull.pinned) {
    tuckUp();
    // The pointer may still be at the top edge: the bar stays up until it leaves.
    pull.ignoreEnter = pull.hovering;
    return true;
  }
  pull.pinned = true;
  pullDown();
  return true;
};

/** The tuck setting's onChange: this browser's bar tucks or shows at once. */
export const followTuckSetting = () => {
  const el = barElement();
  if (!el) return;
  if (!tuckedHere()) tuckUp();
  el.classList.toggle("is-tucked", tuckedHere());
  syncTooltips();
};

/* -------------------------------------------- */
/*  Showing it                                  */
/* -------------------------------------------- */

/** The one instance. */
let clock = null;

/** Is the Warden showing the bar at all? */
const clockEnabled = () => {
  try {
    return !!game.settings.get(SETTINGS_NS, "show-watch-clock");
  } catch {
    return false;
  }
};

/**
 * Show the bar, if the Warden has it switched on.
 *
 * Called at `ready` and from the setting's own onChange. Every client runs this
 * for itself, players included — reading the world clock needs no permission,
 * and a clock only the Warden can see would not be worth building.
 */
export const renderWatchClock = async () => {
  if (!clockEnabled()) return null;
  clock ??= new WatchClock();
  return clock.render({ force: true });
};

/** Take it off screen. The instance is kept so the setting can bring it back. */
export const closeWatchClock = async () => {
  if (!clock?.rendered) return null;
  return clock.close();
};

/**
 * Redraw on a time change.
 *
 * Bound to `updateWorldTime` from `cairn.js`'s init hook rather than at ready,
 * for the socket handler's reason: an event that arrives during connection
 * would otherwise land before anything was listening.
 */
export const refreshWatchClock = () => {
  // RETURNS THE RENDER PROMISE. A caller that awaits this has to actually get
  // the new markup — a probe that awaited a bare `undefined` here read the
  // PREVIOUS render's DOM and reported the clock as unchanged, which looked
  // exactly like the feature not working.
  if (!clock?.rendered) return null;
  return clock.render();
};

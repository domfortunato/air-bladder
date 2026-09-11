import { SETTINGS_NS } from "./settings.js";
import { describeTime } from "./game-time.js";

/**
 * The watch clock: what time it is, on everyone's screen.
 *
 * Cairn counts travel in watches and the tables this system ships price a
 * journey in them, but until now only the Warden knew which watch it was, and
 * only on paper. This puts it where the table can see it.
 *
 * THIS IS THE FIRST ALWAYS-ON-SCREEN SURFACE IN THIS SYSTEM. Everything else
 * here is a sheet, a dialog, a chat card or a scene-controls tool, so there was
 * no precedent to copy and the attachment needed deciding rather than guessing.
 *
 * WHERE IT LIVES, AND WHY IT NEEDS NO HOOK TO STAY THERE.
 * `#ui-left-column-1` is static markup in core's `templates/views/game.hbs`,
 * rendered once by `Game##initializeView`:
 *
 *     <div id="ui-left-column-1" class="flexcol">
 *         <template id="scene-controls"></template>
 *         <template id="players"></template>
 *     </div>
 *
 * The scene controls and the player list each REPLACE THEIR OWN <template>
 * placeholder on first render and thereafter only rewrite their own innerHTML.
 * Neither ever touches its siblings. So an element appended to that column
 * survives every re-render of both, and there is nothing to listen for —
 * which is the whole point, and the answer to "is there a hook for this?", a
 * question the working notes record as the wrong one to ask first about a new
 * surface. Injecting into the player list instead would need re-injecting on
 * every connect and disconnect.
 *
 * The alternative considered and rejected was a free-floating draggable panel
 * over the canvas: it needs a remembered position, a drag handle, a dismiss
 * control and a way back, and it can be dragged on top of a token. Four new
 * failure modes for one line of text (user ruling 2026-09-10).
 */
class WatchClock extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: "cairn-watch-clock",
    tag: "aside",
    // `faded-ui` is CORE's chrome class — the same one the player list wears —
    // which is what makes this read as part of Foundry's furniture rather than
    // a sheet that escaped. See the CSS banner: it is also why this one element
    // reads core's colour variables instead of the system's parchment palette.
    classes: ["faded-ui", "flexcol", "cairn-watch-clock"],
    window: { frame: false, positioned: false },
  };

  static PARTS = {
    clock: { template: "systems/air-bladder/templates/ui/watch-clock.html" },
  };

  /** @override */
  async _prepareContext() {
    return describeTime();
  }

  /**
   * Place the element just above the player list, or decline.
   *
   * Core's own version appends to `document.body` (application.mjs:952-972).
   * For a frameless, unpositioned element that means the top-left corner of the
   * viewport, on top of the map — so if the column is missing (a future core,
   * or a module that rebuilt the game view) this warns and renders nowhere
   * rather than falling back to something worse than not appearing.
   *
   * BEFORE `#players`, NOT APPENDED AFTER IT, and the reason is core's layout.
   * `#ui-left-column-1` is `justify-content: space-between` with exactly two
   * children — the controls at the top, the player list at the bottom. A THIRD
   * child changes what space-between distributes: the player list would be
   * pushed to the middle of the screen. Inserting above it and taking all the
   * free space with `margin-top: auto` (see the CSS) leaves space-between
   * nothing to distribute, so the controls stay at the top and the clock and
   * the player list sit together at the bottom, exactly where they were.
   *
   * The `existing.replaceWith` branch is core's, kept: it is what makes a
   * re-render after a close land in the same place instead of stacking.
   *
   * @override
   */
  async _insertElement(element) {
    const column = document.getElementById("ui-left-column-1");
    if (!column) {
      console.warn("air-bladder | no #ui-left-column-1, so the watch clock has nowhere to live.");
      return;
    }
    const existing = document.getElementById(element.id);
    if (existing) {
      existing.replaceWith(element);
      return;
    }
    const players = document.getElementById("players");
    if (players?.parentElement === column) column.insertBefore(element, players);
    else column.append(element);
  }
}

/** The one instance. */
let clock = null;

/** Is the Warden showing the clock at all? */
const clockEnabled = () => {
  try {
    return !!game.settings.get(SETTINGS_NS, "show-watch-clock");
  } catch {
    return false;
  }
};

/**
 * Show the clock, if the Warden has it switched on.
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
  if (clock?.rendered) clock.render();
};

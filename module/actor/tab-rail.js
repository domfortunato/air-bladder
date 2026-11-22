/**
 * The thumb-tab rail: a character sheet's pages as a column of icon buttons hung
 * off the window's edge (2026-11-19, the sheet laid out after Base Knavery's).
 * The mechanism is Base Knavery's module/sheets/tab-rail.js, itself after DB
 * Mythic's, ported with this system's class names.
 *
 * The rail is a render PART of its own (templates/parts/tab-rail.html), so it
 * sits straight inside `.window-content`, where core's changeTab looks for the
 * tabs. That element is not positioned, so the rail is placed against the
 * window frame and hangs outside it; the stylesheet stops the frame clipping.
 *
 * Which side it hangs on is decided here: the side the person chose
 * (RAIL_SIDE_KEY, the right by default), unless the rail does not fit between
 * the frame and that edge of the frame's own browser window and the other side
 * has more room. On the left the frame wears `cairn-rail-left` and the
 * stylesheet mirrors it. Only the frame is measured, so the answer never flips
 * because the rail changed side. A popped-out sheet measures its own popup.
 *
 * Every actor sheet draws one since 2026-11-20 (each in the character sheet's
 * format); every function here is a no-op on a frame without one.
 */

/**
 * The per-person setting choosing the side the rail hangs on (2026-11-21, user
 * ask): "left" or "right". Read from the system's own namespace so this file
 * keeps no imports. A side that has no room still hands the rail to the other
 * one.
 */
export const RAIL_SIDE_KEY = "tab-rail-side";

/**
 * The side a person who never chose hangs it on: LEFT since 2026-11-21 (user
 * ask, "by default, tabs should be on the left side"; it was the right). The
 * ONE statement of it: the setting's default (settings.js), the fallback
 * below and `railHangsLeft`'s own default all read this. A person who picked
 * a side keeps it (a client setting stores only an explicit choice).
 */
export const DEFAULT_RAIL_SIDE = "left";

/** The side this person asked for; the default before the setting is registered. */
export const preferredRailSide = () => {
  try {
    const side = game.settings.get(game.system.id, RAIL_SIDE_KEY);
    return side === "left" || side === "right" ? side : DEFAULT_RAIL_SIDE;
  } catch {
    return DEFAULT_RAIL_SIDE;
  }
};

/** Each frame's rail width, measured once: _onPosition runs on every drag frame. */
const railWidths = new WeakMap();

/** Animation frames to wait for a freshly drawn rail to be laid out before giving up. */
const MEASURE_RETRIES = 4;

export const RAIL_SELECTOR = ":scope > .window-content > nav.cairn-tab-rail";

/** The rail of a sheet's frame, if it draws one. */
const railOf = (frame) => frame?.querySelector(RAIL_SELECTOR) ?? null;

/**
 * Whether the rail should hang off the left edge. It hangs on the preferred
 * side, unless it does not fit there and the other side has more room.
 * @param {{left: number, right: number}} frameBox  The frame's box in its browser window's pixels
 * @param {number} railWidth
 * @param {number} viewWidth  The width of the frame's own browser window
 * @param {"right"|"left"} [prefer]  The side asked for (RAIL_SIDE_KEY)
 * @returns {boolean}
 */
export const railHangsLeft = (frameBox, railWidth, viewWidth, prefer = DEFAULT_RAIL_SIDE) => {
  const spaceRight = viewWidth - frameBox.right;
  const spaceLeft = frameBox.left;
  if (prefer === "left") return !(railWidth > spaceLeft && spaceRight > spaceLeft);
  return railWidth > spaceRight && spaceLeft > spaceRight;
};

/**
 * Hang the sheet's rail on the side with room for it, and point its tooltips away from the sheet.
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {{left?: number, width?: number, scale?: number}} [position]  What _onPosition was handed: read
 *        rather than measured while the window is in the main browser window, cheap enough per drag frame
 * @param {number} [retries]
 */
export const placeRail = (app, position, retries = MEASURE_RETRIES) => {
  const frame = app?.element;
  const rail = railOf(frame);
  if (!rail || !frame.isConnected) return;
  const view = frame.ownerDocument.defaultView;
  let width = railWidths.get(frame);
  if (!width) {
    width = rail.getBoundingClientRect().width;
    if (!width) {
      if (retries > 0) view.requestAnimationFrame(() => placeRail(app, undefined, retries - 1));
      return;
    }
    railWidths.set(frame, width);
  }
  // A popped-out frame is placed inside its popup by core, so it is always measured there.
  const inMain = frame.ownerDocument === document;
  const box = inMain && Number.isFinite(position?.left) && Number.isFinite(position?.width)
    ? { left: position.left, right: position.left + (position.width * (position.scale ?? 1)) }
    : frame.getBoundingClientRect();
  const left = railHangsLeft(box, width, view.innerWidth, preferredRailSide());
  frame.classList.toggle("cairn-rail-left", left);
  for (const button of rail.querySelectorAll("button")) button.dataset.tooltipDirection = left ? "LEFT" : "RIGHT";
};

/**
 * Hang every open rail again: the side setting changed. Nothing is re-rendered,
 * only the class and the tooltip directions move.
 */
export const placeEveryRail = () => {
  for (const app of foundry.applications.instances.values()) {
    if (app.rendered && app.element?.classList.contains("cairn-railed")) placeRail(app);
  }
};

/**
 * Place the rail once the browser window the frame is in has laid it out: after
 * a render, and after a move between browser windows (Pop Out), which finishes
 * in the new window's own queue.
 * @param {foundry.applications.api.ApplicationV2} app
 */
export const placeRailSoon = (app) => {
  const view = app?.element?.ownerDocument?.defaultView;
  view?.requestAnimationFrame(() => placeRail(app));
};

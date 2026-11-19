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
 * Which side it hangs on is decided here: the right, unless the rail does not
 * fit between the frame and the edge of the frame's own browser window and the
 * left has more room, when the frame wears `cairn-rail-left` and the
 * stylesheet mirrors it. Only the frame is measured, so the answer never flips
 * because the rail changed side. A popped-out sheet measures its own popup.
 *
 * Characters only: an NPC sheet renders no rail part, and every function here
 * is a no-op on a frame without one.
 */

/** Each frame's rail width, measured once: _onPosition runs on every drag frame. */
const railWidths = new WeakMap();

/** Animation frames to wait for a freshly drawn rail to be laid out before giving up. */
const MEASURE_RETRIES = 4;

export const RAIL_SELECTOR = ":scope > .window-content > nav.cairn-tab-rail";

/** The rail of a sheet's frame, if it draws one. */
const railOf = (frame) => frame?.querySelector(RAIL_SELECTOR) ?? null;

/**
 * Whether the rail should hang off the left edge: it does not fit on the right,
 * and the left has more room.
 * @param {{left: number, right: number}} frameBox  The frame's box in its browser window's pixels
 * @param {number} railWidth
 * @param {number} viewWidth  The width of the frame's own browser window
 * @returns {boolean}
 */
export const railHangsLeft = (frameBox, railWidth, viewWidth) => {
  const spaceRight = viewWidth - frameBox.right;
  return railWidth > spaceRight && frameBox.left > spaceRight;
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
  const left = railHangsLeft(box, width, view.innerWidth);
  frame.classList.toggle("cairn-rail-left", left);
  for (const button of rail.querySelectorAll("button")) button.dataset.tooltipDirection = left ? "LEFT" : "RIGHT";
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

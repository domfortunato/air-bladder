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

/**
 * The room a window leaves beside it for its rail, before the rail is drawn to
 * be measured: the rail is 43px (32px tabs, 5px padding each side, a 1px
 * border; css/cairn.css), and a little over that.
 */
export const RAIL_ROOM = 48;

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
  // Popped out, the frame is fitted to its window with the rail inside it.
  if (!inMain) fitDetachedSoon(app);
};

/**
 * Is this app the one a popped-out (detached) browser window was opened for?
 * Core hides such a frame's resize handle: the OS window is its resize control.
 * @param {foundry.applications.api.ApplicationV2} app
 */
export const isPrimaryDetached = (app) => !!app?.element && app.element.ownerDocument !== document
  && app.window?.windowId === app.id;

/** Popup windows already listening for their own resize. */
const fittedWindows = new WeakSet();

/** What `fitDetached` last asked of each app, and what core gave it back. */
const lastFit = new WeakMap();

/** Two positions with the same box. */
const sameBox = (a, b) => !!a && !!b && a.left === b.left && a.top === b.top
  && a.width === b.width && a.height === b.height;

/**
 * FIT A POPPED-OUT RAILED WINDOW TO ITS POPUP (2026-11-21, user report: "when I
 * pop out the warden's dashboard and resize it, I lose the tabs!"). The rail
 * hangs OUTSIDE the frame, and core sizes the popup to the frame plus the rail
 * when it detaches, but nothing keeps them together after: a page of another
 * size, or any wider setPosition, and core clamps the frame to the popup's left
 * edge, so a left rail lands at a negative x (a right one past the edge, the
 * same way), and core hides the frame's own resize handle in a popup.
 *
 * So, popped out, the frame FILLS its popup less the rail's width, the rail on
 * the side this person chose, and it follows the popup's own resize (the OS
 * window is the resize control there). A no-op when it already fits, which is
 * what stops this and `_onPosition` from feeding each other.
 *
 * And a no-op when core has already answered the same ask (review #37). Core
 * clamps a frame to its CSS minimum (`_updatePosition`), so a popup too small
 * for the frame and its rail can't be fitted at all: the clamped answer never
 * equals the ask, and this asked again on every animation frame for as long as
 * the popup stayed that size. A new ask (the popup resized, the side swapped)
 * or a frame moved by something else is fitted again.
 * @param {foundry.applications.api.ApplicationV2} app
 */
export const fitDetached = (app) => {
  if (!app?.rendered || !isPrimaryDetached(app) || app.minimized) return;
  const frame = app.element;
  const rail = railOf(frame);
  const width = railWidths.get(frame) ?? rail?.getBoundingClientRect().width;
  if (!width) return;
  const view = frame.ownerDocument.defaultView;
  if (!fittedWindows.has(view)) {
    fittedWindows.add(view);
    view.addEventListener("resize", () => {
      for (const other of foundry.applications.instances.values()) {
        if (other.element?.ownerDocument?.defaultView === view && other.element.classList.contains("cairn-railed")) fitDetached(other);
      }
    });
  }
  const scale = app.position.scale || 1;
  const onLeft = preferredRailSide() === "left";
  const want = {
    left: onLeft ? Math.round(width) : 0,
    top: 0,
    width: Math.max(0, Math.floor((view.innerWidth - width) / scale)),
    height: Math.max(0, Math.floor(view.innerHeight / scale)),
  };
  const p = app.position;
  if (sameBox(p, want)) return;
  const last = lastFit.get(app);
  if (last && sameBox(last.want, want) && sameBox(last.got, p)) return;
  app.setPosition(want);
  lastFit.set(app, { want, got: { ...app.position } });
};

/** `fitDetached` on the popup's next frame, after whatever moved the frame has settled. */
const fitDetachedSoon = (app) => {
  app?.element?.ownerDocument?.defaultView?.requestAnimationFrame(() => fitDetached(app));
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

/**
 * The one art picker.
 *
 * Every image control in the system opens this: a character's portrait, an
 * NPC's, a container's, and an item's. It used to be three near-copies of the
 * same 140-line dialog (`_pickPortrait`, `_pickContainerArt`, and core's plain
 * FilePicker on item sheets), which is why the Game-Icons gallery could not
 * simply be "added to the picker" — there was no picker, there were three.
 *
 * A caller says WHICH galleries apply and what to do with the chosen path; the
 * dialog, tabs, URL row and Browse escape are the same everywhere.
 *
 * The galleries:
 *
 *   classes    the container Kind glyphs. Picking one is not picking a picture,
 *              it is saying "this is a barrel" — so its cells carry a class key
 *              and the caller gets it back.
 *   shipped    Jon Aspeheim's character portraits (CC BY 4.0). Human faces, so
 *              a Monster is not offered them.
 *   custom     the Warden's own folder, from the world setting. Shown whenever
 *              it has images, or to any GM (who can put some there).
 *   gameicons  1,239 game-icons.net glyphs (CC BY 3.0), browsed CATEGORY FIRST:
 *              23 folder tiles, then that category's thumbnails. The grids are
 *              built on demand — rendering all 23 at once is 1,239 <img> in one
 *              dialog, and only one category is ever on screen.
 *
 * Every gallery that has a licence shows its credit under its own grid, never
 * globally: a credit under the wrong art is worse than none.
 */

import { getPortraitManifest, getCustomPortraitPaths, refreshCustomPortraits, getGameIconManifest } from "./character-generator.js";

/** The Foundry FilePicker implementation, across v13/v14 namespacing. */
const filePicker = () =>
  foundry.applications.apps?.FilePicker?.implementation
  ?? foundry.applications.apps?.FilePicker
  ?? globalThis.FilePicker;

/**
 * A category folder's display name: "greek-roman" -> CAIRN.GameIconCategory.GreekRoman.
 * Localized rather than title-cased in place so a translator can say "Griego y
 * romano" — the folder names come from game-icons.net and are English.
 */
const categoryLabel = (key) => {
  const pascal = key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return game.i18n.localize(`CAIRN.GameIconCategory.${pascal}`);
};

/** An escaped attribute value — icon names are ours, but paths can come from a Warden. */
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Open the art picker.
 *
 * @param {Object}   opts
 * @param {String}   opts.current        the currently-set image, marked selected
 * @param {String}   opts.title          window title (already localized)
 * @param {Boolean}  [opts.shipped]      offer the Jon Aspeheim gallery
 * @param {Boolean}  [opts.custom]       offer the Warden's custom folder
 * @param {Boolean}  [opts.gameIcons]    offer the Game-Icons gallery
 * @param {Object}   [opts.classes]      {label, cells:[{key,src,label,selected}]}
 * @param {String}   [opts.browseStart]  where the Browse escape opens
 * @param {Function} opts.onPick         async (src, {cls}) => void; the dialog closes after
 */
export async function pickArt({
  current, title, shipped = false, custom = false, gameIcons = false,
  classes = null, browseStart = "", onPick,
}) {
  const isGM = game.user.isGM;
  const customPaths = custom ? getCustomPortraitPaths() : [];
  // A GM with an empty folder still gets the tab — it carries the Refresh button
  // and the "drop images in here" hint, which is the only place either appears.
  const showCustom = custom && (customPaths.length > 0 || isGM);

  const manifest = shipped ? await getPortraitManifest() : null;
  const portraitDir = manifest?.portraitDir ?? "systems/air-bladder/character_portraits";
  const shippedNames = manifest?.names ?? [];
  const showShipped = shipped && shippedNames.length > 0;

  const iconManifest = gameIcons ? await getGameIconManifest() : null;
  const iconDir = iconManifest?.iconDir ?? "systems/air-bladder/game-icons";
  const iconCats = iconManifest?.categories ?? [];
  const showIcons = gameIcons && iconCats.length > 0;

  const cellFor = (src, label = null) => {
    const sel = src === current ? " selected" : "";
    const t = attr(label ?? String(src).split("/").pop());
    return `<img class="cairn-portrait-choice${sel}" src="${attr(src)}" data-src="${attr(src)}" title="${t}" alt="${t}" />`;
  };

  /* --- panes ------------------------------------------------------------- */

  const panes = [];

  if (classes) {
    const cells = classes.cells.map(({ key, src, label, selected }) =>
      `<img class="cairn-portrait-choice${selected ? " selected" : ""}" src="${attr(src)}" `
      + `data-src="${attr(src)}" data-class="${attr(key)}" title="${attr(label)}" alt="${attr(label)}" />`
    ).join("");
    panes.push({ id: "classes", count: classes.cells.length, label: classes.label, body: `<div class="cairn-portrait-grid">${cells}</div>` });
  }

  if (showShipped) {
    panes.push({
      id: "shipped",
      count: shippedNames.length,
      label: game.i18n.localize("CAIRN.PortraitTabShipped"),
      body: `<div class="cairn-portrait-grid">${shippedNames.map((n) => cellFor(`${portraitDir}/${n}`)).join("")}</div>
        <div class="cairn-portrait-credit">${game.i18n.localize("CAIRN.PortraitCredit")}</div>`,
    });
  }

  if (showCustom) {
    const refreshBtn = isGM
      ? `<button type="button" class="cairn-portrait-refresh"><i class="fas fa-rotate"></i> ${game.i18n.localize("CAIRN.RefreshCustomPortraits")}</button>`
      : "";
    panes.push({
      id: "custom",
      count: customPaths.length,
      label: game.i18n.localize("CAIRN.PortraitTabCustom"),
      body: `<div class="cairn-portrait-grid">${customPaths.map((p) => cellFor(p)).join("")}</div>
        <div class="cairn-portrait-empty"${customPaths.length ? " hidden" : ""}>${game.i18n.localize("CAIRN.CustomPortraitsEmpty")}</div>
        ${refreshBtn}`,
    });
  }

  if (showIcons) {
    // Folder tiles. Each wears the first icon in its category as its face, so the
    // gallery reads as art rather than as a list of words.
    const folders = iconCats.map(({ key, names }) => {
      const label = attr(categoryLabel(key));
      const face = `${iconDir}/${key}/${names[0]}`;
      return `<button type="button" class="cairn-icon-folder" data-category="${attr(key)}" title="${label}">
          <img src="${attr(face)}" alt="" />
          <span>${label}</span>
        </button>`;
    }).join("");
    panes.push({
      id: "gameicons",
      count: iconCats.length,
      label: game.i18n.localize("CAIRN.PortraitTabGameIcons"),
      body: `<div class="cairn-icon-folders">${folders}</div>
        <div class="cairn-icon-category" hidden>
          <button type="button" class="cairn-icon-back"><i class="fas fa-chevron-left"></i> ${game.i18n.localize("CAIRN.GameIconsBack")}</button>
          <div class="cairn-portrait-grid"></div>
        </div>
        <div class="cairn-portrait-credit">${game.i18n.localize("CAIRN.GameIconsCredit")}</div>`,
    });
  }

  if (!panes.length) {
    // Nothing to show but the escapes. Still worth opening — the URL row and
    // Browse are how a player with no galleries sets art at all.
    panes.push({ id: "none", count: 0, label: "", body: "" });
  }

  /* --- chrome ------------------------------------------------------------ */

  // Open on the tab holding the current image, so re-opening lands where you
  // are. Falls back to the FIRST AVAILABLE pane, never to a named one — a
  // Monster has no shipped tab, and defaulting to it would open on a pane that
  // is not there and show an empty dialog.
  const owns = (id) =>
    (id === "custom" && customPaths.includes(current))
    || (id === "shipped" && current?.startsWith(portraitDir))
    || (id === "gameicons" && current?.startsWith(iconDir));
  // ...and failing that, the first pane WITH SOMETHING IN IT — not simply the
  // first pane. The distinction cost an evening (2026-08-01): a Monster is
  // offered Custom + Game-Icons, Custom is listed for any GM even when the
  // folder is empty (it carries the Refresh button), so the picker opened on a
  // pane reading "No custom portraits found" with the 1,239-glyph gallery
  // sitting unselected beside it. It looked for all the world like the picker
  // had failed to load, and the Warden it happened to could not tell that from
  // a broken dialog. A tab that says "nothing here" is never the right landing
  // place while a tab with art exists.
  const startTab = panes.find((p) => owns(p.id))?.id
    ?? (panes.find((p) => p.count > 0) ?? panes[0]).id;

  const tabsBar = panes.length > 1
    ? `<div class="cairn-portrait-tabs">${panes.map((p) =>
      `<button type="button" class="cairn-portrait-tab${p.id === startTab ? " active" : ""}" data-tab="${p.id}">${p.label}</button>`
    ).join("")}</div>`
    : "";

  const paneHtml = panes.map((p) =>
    `<div class="cairn-portrait-pane" data-pane="${p.id}"${p.id === startTab ? "" : " hidden"}>${p.body}</div>`
  ).join("");

  const browseBtn = game.user.can("FILES_BROWSE")
    ? `<button type="button" class="cairn-portrait-browse"><i class="fas fa-folder-open"></i> ${game.i18n.localize("CAIRN.BrowsePortrait")}</button>`
    : "";

  // Paste-an-image-URL row: sets art without the FILES_BROWSE permission Browse
  // needs, so it works for players.
  const urlRow = `<div class="cairn-portrait-url">
      <input type="text" class="cairn-portrait-url-input" placeholder="${game.i18n.localize("CAIRN.PortraitUrlPlaceholder")}" />
      <button type="button" class="cairn-portrait-url-set">${game.i18n.localize("CAIRN.PortraitUrlSet")}</button>
    </div>`;

  const dialog = new foundry.applications.api.DialogV2({
    window: { title, icon: "fas fa-image" },
    position: { width: 520 },
    content: `<div class="cairn-portrait-gallery${classes ? " cairn-container-gallery" : ""}">
        ${tabsBar}${paneHtml}${urlRow}${browseBtn}
      </div>`,
    buttons: [{ action: "close", label: game.i18n.localize("CAIRN.Close"), default: true }],
  });
  await dialog.render(true);
  // CLAIM THE FRONT, explicitly. `render(true)` assigns a z-index at the moment
  // it renders, and that is not the same as being on top when it FINISHES: this
  // dialog awaits two manifests before rendering, and anything that raises a
  // window in the meantime — including the sheet whose portrait was just
  // clicked, which ApplicationV2 brings forward on pointerdown — ends up above
  // it. The result is a picker that opened correctly and is invisible, sitting
  // underneath the sheet that opened it, at the same position every time.
  //
  // Measured in a real session (2026-08-01): sheet z-112, picker z-113, a second
  // sheet z-114 ON TOP of the picker, second picker z-115. That is the whole of
  // the "clicking the portrait does nothing, but it works on the second click"
  // report — the first click's dialog was never gone, only buried, and clicking
  // again just stacked another one on top of it. For two documents whose sheets
  // happened to sit exactly where the dialog spawns, no click ever appeared to
  // work at all.
  dialog.bringToFront();

  /* --- wiring ------------------------------------------------------------ */

  const root = dialog.element;
  const commit = async (src, cls) => {
    await onPick(src, { cls });
    dialog.close();
  };
  const wireChoice = (img) =>
    img.addEventListener("click", () => commit(img.dataset.src, img.dataset.class));
  root.querySelectorAll(".cairn-portrait-choice").forEach(wireChoice);

  root.querySelectorAll(".cairn-portrait-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab;
      root.querySelectorAll(".cairn-portrait-tab").forEach((b) => b.classList.toggle("active", b === btn));
      root.querySelectorAll(".cairn-portrait-pane").forEach((p) => { p.hidden = p.dataset.pane !== id; });
    });
  });

  // Game-Icons: folder tiles in, back out. The category grid is built here and
  // not up front — see the file header.
  const foldersEl = root.querySelector(".cairn-icon-folders");
  const categoryEl = root.querySelector(".cairn-icon-category");
  if (foldersEl && categoryEl) {
    const grid = categoryEl.querySelector(".cairn-portrait-grid");
    root.querySelectorAll(".cairn-icon-folder").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.category;
        const cat = iconCats.find((c) => c.key === key);
        if (!cat) return;
        grid.innerHTML = cat.names.map((n) => cellFor(`${iconDir}/${key}/${n}`, n.replace(/\.svg$/, ""))).join("");
        grid.querySelectorAll(".cairn-portrait-choice").forEach(wireChoice);
        foldersEl.hidden = true;
        categoryEl.hidden = false;
      });
    });
    categoryEl.querySelector(".cairn-icon-back")?.addEventListener("click", () => {
      categoryEl.hidden = true;
      foldersEl.hidden = false;
    });
  }

  // Refresh: re-scan the custom folder (GM), then rebuild that grid in place.
  const refresh = root.querySelector(".cairn-portrait-refresh");
  refresh?.addEventListener("click", async () => {
    refresh.disabled = true;
    const list = await refreshCustomPortraits();
    const grid = root.querySelector('[data-pane="custom"] .cairn-portrait-grid');
    const hint = root.querySelector('[data-pane="custom"] .cairn-portrait-empty');
    if (grid) {
      grid.innerHTML = list.map((p) => cellFor(p)).join("");
      grid.querySelectorAll(".cairn-portrait-choice").forEach(wireChoice);
    }
    if (hint) hint.hidden = list.length > 0;
    refresh.disabled = false;
  });

  const urlInput = root.querySelector(".cairn-portrait-url-input");
  const applyUrl = () => {
    const value = urlInput?.value.trim();
    if (value) commit(value, undefined);
  };
  root.querySelector(".cairn-portrait-url-set")?.addEventListener("click", applyUrl);
  urlInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); applyUrl(); }
  });

  root.querySelector(".cairn-portrait-browse")?.addEventListener("click", () => {
    new (filePicker())({
      type: "image",
      current: browseStart,
      // No class argument: the picture changed, nothing else did. A mule wearing
      // the Warden's own painting is still a mule.
      callback: (path) => commit(path, undefined),
    }).render(true);
  });

  return dialog;
}

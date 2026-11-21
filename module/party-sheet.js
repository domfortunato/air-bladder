/**
 * The Warden's Party sheet (2026-11-21, user ask): one table of every player
 * character in the Party folder, in marching order — who holds a light, who
 * holds a shield, the vitals, the slots, the rations, the connections, and a
 * line of the Warden's own notes per character.
 *
 * A LEAF. It reads what the character sheet already derives (`slotsUsed`,
 * `slotsMax`, `armor`, `encumbered` from `_prepareCharacterData`) and the
 * classifiers `gear.js` owns (`isHoldableLight`, `isHeldLight`, `RATIONS_RE`),
 * so a column can never disagree with the sheet it summarises. Nothing here
 * computes a rule of its own; if a cell looks wrong, the sheet is wrong too.
 *
 * WARDEN ONLY. The tool is hidden from players and `openPartySheet` refuses
 * them — the tool being absent is the affordance, the refusal the enforcement
 * (the Dashboard's own split, `openWardenDashboard`).
 */
import { SETTINGS_NS } from "./settings.js";
import { findPartyFolder, isDroppedPile } from "./party-pile.js";
import { isHoldableLight, isHeldLight, RATIONS_RE } from "./gear.js";
import { FATIGUE_NAME } from "./item/item.js";
import { t, itemNamespaces } from "./i18n-content.js";

/** The world setting holding the marching order: an array of actor ids. */
export const MARCHING_ORDER_KEY = "party-marching-order";

/**
 * The actor flag holding the Warden's notes line.
 *
 * HIDDEN, NOT SECRET, and said here so nobody mistakes it for the second. A
 * flag rides the actor document, which the character's owner receives in full:
 * a player who opens the browser console can read it. Nothing in the
 * interface ever shows it to them — this window is the only reader, and only a
 * GM can open it. The user chose that (2026-11-21, "Warden only").
 */
export const WARDEN_NOTE_FLAG = "wardenNote";

/** Long enough for a line of key words; short enough to stay one line. */
export const WARDEN_NOTE_MAX = 200;

/** The four connection columns, in the order the table shows them. */
const CONNECTION_COLUMNS = [
  { role: "hireling", col: "hirelings", key: "CAIRN.PartySheet.Hirelings", icon: "fa-handshake" },
  { role: "companion", col: "companions", key: "CAIRN.PartySheet.Companions", icon: "fa-paw" },
  { role: "container", col: "containers", key: "CAIRN.PartySheet.Containers", icon: "fa-box-open" },
  { role: "transport", col: "transports", key: "CAIRN.PartySheet.Transports", icon: "fa-horse" },
];

/**
 * The party: every character filed in the Party folder.
 *
 * THE FOLDER IS THE ROSTER, and nothing else is. Every route that makes a
 * character files it there (`partyFolderId`), and a Warden moves one out to
 * bench it — so the folder already says who is in the party, in the
 * directory, where the Warden can see and change it. The Dropped Item Pile
 * lives in the same folder and is not a character, but it is filtered by its
 * own predicate rather than by type alone, as `isDroppedPile`'s callers do.
 * @returns {Actor[]}
 */
export const partyMembers = () => {
  const folder = findPartyFolder();
  if (!folder) return [];
  return folder.contents.filter((a) => a.type === "character" && !isDroppedPile(a));
};

/**
 * The party in marching order: the stored ids that are still members, in
 * their stored order, then anyone the order has never seen, by name.
 *
 * A STALE ID IS SKIPPED, NOT AN ERROR — a character deleted or moved out of
 * the folder leaves its id behind, and the next drop writes the order afresh
 * from the rows shown, which prunes it.
 * @returns {Actor[]}
 */
export const marchingOrder = () => {
  const members = partyMembers();
  const byId = new Map(members.map((a) => [a.id, a]));
  const stored = game.settings.get(SETTINGS_NS, MARCHING_ORDER_KEY);
  const placed = [];
  for (const id of Array.isArray(stored) ? stored : []) {
    const a = byId.get(id);
    if (a && !placed.includes(a)) placed.push(a);
  }
  const rest = members.filter((a) => !placed.includes(a))
    .sort((x, y) => x.name.localeCompare(y.name));
  return [...placed, ...rest];
};

/**
 * Who plays this character.
 *
 * The user Foundry has ASSIGNED it to first (User Configuration's Character),
 * which is the one answer that means "this is their character". Failing that,
 * every player given Owner on this actor BY NAME — the per-user entry, never
 * the `default` level, because a party-wide actor shared at default Owner
 * would otherwise list every player at the table against one character.
 * @param {Actor} actor
 * @returns {string}
 */
export const playerNamesFor = (actor) => {
  const players = game.users.filter((u) => !u.isGM);
  const assigned = players.filter((u) => u.character?.id === actor.id);
  const owners = assigned.length ? assigned
    : players.filter((u) => (actor.ownership?.[u.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  return owners.map((u) => u.name).join(", ");
};

/** A count off an item's quantity, where an unset quantity is one. */
const qty = (item) => Math.max(0, Number(item.system?.quantity ?? 1) || 0);

/**
 * One row of the table, read off the actor.
 * @param {Actor} actor
 * @param {number} index  its place in the marching order, from 0
 */
const rowFor = (actor, index) => {
  const sys = actor.system ?? {};
  const items = actor.items.contents;
  const nameNs = itemNamespaces(actor).nameNs;

  const lights = items.filter((i) => isHoldableLight(i));
  const held = lights.find((i) => isHeldLight(i)) ?? null;

  // Uses left, not items carried (user ruling 2026-11-21): a fresh Rations is
  // three meals, and three meals is what the Warden is asking about. A
  // Rations with no uses track counts by its quantity instead.
  const rations = items
    .filter((i) => i.type === "item" && RATIONS_RE.test(i.name))
    .reduce((n, i) => n + (Number(i.system?.uses?.max) > 0 ? Math.max(0, Number(i.system.uses.value) || 0) : qty(i)), 0);

  // Held is EQUIPPED, as the sheet's Hold-shield switch reads it; a broken
  // shield is not a shield anyone is carrying for its protection.
  const shields = items.filter((i) => i.type === "armor" && i.system?.shield && !i.system?.broken);
  const shield = shields.some((i) => i.system.equipped) ? "held" : shields.length ? "slung" : "";

  const kids = actor.connectedActors?.() ?? [];
  const connections = CONNECTION_COLUMNS.map((c) => {
    const n = kids.filter((k) => k.npcRole === c.role).length;
    return { col: c.col, count: n, none: n === 0 };
  });

  const fatigue = items.filter((i) => i.name === FATIGUE_NAME).length;
  const conditions = [];
  if (sys.encumbered) conditions.push({ id: "encumbered", label: game.i18n.localize("CAIRN.PartySheet.Encumbered") });
  if (sys.deprived) conditions.push({ id: "deprived", label: game.i18n.localize("CAIRN.Deprived") });

  const ab = (k) => sys.abilities?.[k] ?? {};
  return {
    id: actor.id,
    position: index + 1,
    name: actor.name,
    img: actor.img,
    player: playerNamesFor(actor),
    pronouns: sys.pronouns ?? "",
    background: t("bg.name", sys.background ?? ""),
    hp: { value: sys.hp?.value ?? 0, max: sys.hp?.max ?? 0 },
    str: ab("STR"), dex: ab("DEX"), wil: ab("WIL"),
    armor: sys.armor ?? 0,
    gold: sys.gold ?? 0,
    slots: { used: sys.slotsUsed ?? 0, max: sys.slotsMax ?? 0, full: !!sys.encumbered },
    fatigue, noFatigue: fatigue === 0,
    shield, shieldLabel: shield ? game.i18n.localize(`CAIRN.PartySheet.Shield${shield === "held" ? "Held" : "Slung"}`) : "",
    held: held?.name ?? "",
    heldLabel: held ? t(nameNs, held.name) : "",
    lights: lights.reduce((n, i) => n + qty(i), 0),
    rations, noRations: rations === 0,
    connections,
    conditions,
    note: String(actor.getFlag(SETTINGS_NS, WARDEN_NOTE_FLAG) ?? ""),
  };
};

/* -------------------------------------------- */

class PartySheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "cairn-party-sheet",
    // A DIV, not the Dashboard's form: the only inputs are the notes lines,
    // each written on its own `change`, and a form would submit on Enter.
    tag: "div",
    // `sheet` restores the scrolling `.window-content` (see WardenDashboard).
    classes: ["cairn", "sheet", "cairn-party-sheet"],
    window: {
      title: "CAIRN.PartySheet.Title",
      icon: "fas fa-users",
      resizable: true,
    },
    // WIDE: the table has twenty-two columns, and a narrowed window scrolls
    // the table sideways inside itself rather than wrapping cells.
    position: { width: 1180, height: 460 },
    actions: {
      openSheet: PartySheet._onOpenSheet,
    },
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/air-bladder/templates/dashboard/party-sheet.html" },
  };

  /** A render asked for while the Warden is typing a note, run on blur. */
  #renderOnBlur = false;

  /** The id of the row being dragged, set at dragstart. */
  #dragging = null;

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.rows = marchingOrder().map(rowFor);
    context.connectionColumns = CONNECTION_COLUMNS;
    context.noteMax = WARDEN_NOTE_MAX;
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;

    new foundry.applications.ux.DragDrop.implementation({
      dragSelector: "tr[data-actor-id]",
      dropSelector: "tr[data-actor-id]",
      permissions: { dragstart: () => game.user.isGM, drop: () => game.user.isGM },
      callbacks: {
        dragstart: (event) => this.#onDragStart(event),
        dragover: (event) => this.#markDropTarget(event),
        dragleave: (event) => event.currentTarget?.classList?.remove("cairn-drop-target"),
        dragend: () => this.#clearDrag(),
        drop: (event) => this.#onDrop(event),
      },
    }).bind(root);

    for (const input of root.querySelectorAll("input[data-note]")) {
      input.addEventListener("change", (event) => this.#onNoteChange(event));
      // A drag that starts on the text box would carry the row off instead of
      // selecting text, so the input opts out of the row's draggability.
      input.addEventListener("dragstart", (event) => event.stopPropagation());
    }
    root.addEventListener("focusout", () => {
      if (this.#renderOnBlur) this.queueRender();
    });
  }

  /**
   * Redraw soon, once — a burst of item writes (a background re-roll is a
   * dozen) collapses into one render.
   *
   * NOT WHILE A NOTE HAS FOCUS. The Warden's own `change` writes the flag,
   * which fires `updateActor`, which would redraw the input out from under the
   * next keystroke. The render waits for the focus to leave instead.
   */
  queueRender = foundry.utils.debounce(() => {
    if (!this.rendered) return;
    const active = this.element?.ownerDocument?.activeElement;
    if (active?.matches?.("input[data-note]") && this.element.contains(active)) {
      this.#renderOnBlur = true;
      return;
    }
    this.#renderOnBlur = false;
    this.render();
  }, 150);

  /** Open a character's own sheet from its name. */
  static _onOpenSheet(event, target) {
    const id = target.closest("[data-actor-id]")?.dataset.actorId;
    game.actors.get(id)?.sheet?.render(true);
  }

  /** Write the notes line to the actor, trimmed and capped. */
  async #onNoteChange(event) {
    const input = event.currentTarget;
    const actor = game.actors.get(input.closest("[data-actor-id]")?.dataset.actorId);
    if (!actor || !game.user.isGM) return;
    const value = String(input.value ?? "").trim().slice(0, WARDEN_NOTE_MAX);
    if (value) await actor.setFlag(SETTINGS_NS, WARDEN_NOTE_FLAG, value);
    else if (actor.getFlag(SETTINGS_NS, WARDEN_NOTE_FLAG) !== undefined) await actor.unsetFlag(SETTINGS_NS, WARDEN_NOTE_FLAG);
  }

  #onDragStart(event) {
    const row = event.currentTarget.closest("tr[data-actor-id]");
    this.#dragging = row?.dataset.actorId ?? null;
    if (!this.#dragging) return;
    row.classList.add("cairn-dragging");
    // A type nothing else in Foundry reads, so a row dropped on the canvas or
    // on a sheet is ignored there rather than mistaken for an Actor drop.
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "AirBladderPartyRow", id: this.#dragging }));
    event.dataTransfer.effectAllowed = "move";
  }

  #markDropTarget(event) {
    if (!this.#dragging) return;
    for (const el of this.element.querySelectorAll(".cairn-drop-target")) el.classList.remove("cairn-drop-target");
    event.currentTarget?.classList?.add("cairn-drop-target");
  }

  #clearDrag() {
    this.#dragging = null;
    for (const el of this.element?.querySelectorAll(".cairn-drop-target, .cairn-dragging") ?? []) {
      el.classList.remove("cairn-drop-target", "cairn-dragging");
    }
  }

  /**
   * Move the dragged row to the row it was dropped on, and store the whole
   * order as it now stands.
   *
   * DROPPED ON A LATER ROW, IT GOES AFTER IT; on an earlier row, before it —
   * so dragging the leader onto the second place swaps them, the way a list
   * reads to anyone dragging down it.
   */
  async #onDrop(event) {
    let from = this.#dragging;
    if (!from) {
      try { from = JSON.parse(event.dataTransfer.getData("text/plain"))?.id ?? null; } catch { from = null; }
    }
    const to = event.currentTarget?.closest("tr[data-actor-id]")?.dataset.actorId;
    this.#clearDrag();
    if (!from || !to || from === to || !game.user.isGM) return;
    const ids = marchingOrder().map((a) => a.id);
    const fromAt = ids.indexOf(from);
    const toAt = ids.indexOf(to);
    if (fromAt < 0 || toAt < 0) return;
    ids.splice(fromAt, 1);
    ids.splice(ids.indexOf(to) + (fromAt < toAt ? 1 : 0), 0, from);
    await game.settings.set(SETTINGS_NS, MARCHING_ORDER_KEY, ids);
  }
}

/* -------------------------------------------- */
/*  Opening it                                  */
/* -------------------------------------------- */

let sheet = null;

/**
 * Open the Party sheet, reusing the one instance.
 * @returns {Promise<PartySheet|null>}  null for anyone who is not a GM
 */
export const openPartySheet = async () => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.PartySheetWardenOnly"));
    return null;
  }
  sheet ??= new PartySheet();
  return sheet.render({ force: true });
};

/** Redraw the open Party sheet, if there is one. */
export const refreshPartySheet = () => {
  if (sheet?.rendered) sheet.queueRender();
};

/**
 * The Token-controls button, and the hooks that keep an open table current.
 *
 * The hooks fire on every client but cost a property read each: the window is
 * only ever constructed on a GM's, and `refreshPartySheet` is a no-op without
 * it. Their filters are deliberately loose — a character, or anything
 * connected to one — because a missed redraw is a wrong number in front of
 * the Warden, and a spare one is a debounced render of a few rows.
 */
export const registerPartySheet = () => {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tools = controls?.tokens?.tools;
    if (!tools) return;
    tools.abPartySheet = {
      name: "abPartySheet",
      title: "CAIRN.PartySheet.Tool",
      icon: "fas fa-users",
      order: Object.keys(tools).length,
      button: true,
      visible: game.user.isGM,
      onChange: () => {
        openPartySheet().catch((err) => console.error("Air Bladder | the Party sheet failed:", err));
      },
    };
  });

  const touchesParty = (actor, changes = {}) => actor?.type === "character"
    || !!actor?.system?.connectedTo
    || foundry.utils.hasProperty(changes, "system.connectedTo");
  Hooks.on("updateActor", (actor, changes) => { if (touchesParty(actor, changes)) refreshPartySheet(); });
  Hooks.on("createActor", (actor) => { if (touchesParty(actor)) refreshPartySheet(); });
  Hooks.on("deleteActor", (actor) => { if (touchesParty(actor)) refreshPartySheet(); });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => { if (item.parent?.type === "character") refreshPartySheet(); });
  }
  Hooks.on("updateUser", (_user, changes) => { if ("character" in (changes ?? {})) refreshPartySheet(); });
  // The setting's own onChange (settings.js), so a second GM's drag redraws
  // this one's table too.
  Hooks.on("cairnMarchingOrderChanged", refreshPartySheet);
};

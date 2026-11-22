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
 * A PAGE OF THE WARDEN'S DASHBOARD since 2026-11-21 (user ask: the Party
 * sheet, Warden's Damage and the Dashboard in one window). This file holds the
 * table's data and the page's behaviour (`PartyPage`); the window, its rail,
 * the Dashboard's button and the hooks that redraw the page are
 * warden-dashboard.js's.
 *
 * WARDEN ONLY. The button is drawn for a GM alone and `openWardenDashboard`
 * refuses a player — the missing button is the affordance, the refusal the
 * enforcement.
 */
import { SETTINGS_NS } from "./settings.js";
import { findPartyFolder, isDroppedPile } from "./party-pile.js";
import { isHoldableLight, isHeldLight, RATIONS_RE } from "./gear.js";
import { FATIGUE_NAME } from "./item/item.js";
import { t, itemNamespaces } from "./i18n-content.js";
import { lightIcon } from "./light-sources.js";
import { PERSON_ROLES } from "./data-models.js";

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
 * The party: every character filed in the Party folder, and every NPC or
 * hireling filed there (2026-11-21, user ask: "If an NPC or Hireling is in
 * the party, include them in the party sheet"). A monster, a companion or a
 * thing filed there is not a member.
 *
 * THE FOLDER IS THE ROSTER, and nothing else is. Every route that makes a
 * character files it there (`partyFolderId`), and a Warden moves one out to
 * bench it — so the folder already says who is in the party, in the
 * directory, where the Warden can see and change it. The Dropped Item Pile
 * lives in the same folder and is not a character, but it is filtered by its
 * own predicate rather than by type alone, as `isDroppedPile`'s callers do.
 * @returns {Actor[]}
 */
/** A character, or a person npc (npc or hireling): the kinds that join. */
export const isPartyKind = (a) => a?.type === "character" || PERSON_ROLES.includes(a?.npcRole);

export const partyMembers = () => {
  const folder = findPartyFolder();
  if (!folder) return [];
  return folder.contents.filter((a) => isPartyKind(a) && !isDroppedPile(a));
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
export const rowFor = (actor, index) => {
  const sys = actor.system ?? {};
  const items = actor.items.contents;
  const nameNs = itemNamespaces(actor).nameNs;

  const lights = items.filter((i) => isHoldableLight(i));
  const held = lights.find((i) => isHeldLight(i)) ?? null;

  // Uses left, not items carried (user ruling 2026-11-21): a fresh Rations is
  // three meals, and three meals is what the Warden is asking about. A STACK
  // counts its unopened units too, read as `CairnItem#spendUse` spends it:
  // the quantity is one open unit, at its uses, plus full ones behind it
  // (review #36: two Rations at 3/3 read 3, and two at 0/3 a red 0). A
  // Rations with no uses track counts by its quantity instead.
  const rations = items
    .filter((i) => i.type === "item" && RATIONS_RE.test(i.name))
    .reduce((n, i) => {
      const max = Math.max(0, Number(i.system?.uses?.max) || 0);
      const q = qty(i);
      if (max <= 0) return n + q;
      if (q <= 0) return n;
      const value = Math.min(max, Math.max(0, Number(i.system.uses.value) || 0));
      return n + ((q - 1) * max) + value;
    }, 0);

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

  // Boxed letters, D P E, the full word as the tooltip (user ruling
  // 2026-11-21). Panicked was missing from the first build: Bryn on CT 123
  // was Deprived AND Panicked and showed only the D.
  const condition = (id, short, label) => ({ id, short: game.i18n.localize(short), label: game.i18n.localize(label) });
  const conditions = [];
  if (sys.deprived) conditions.push(condition("deprived", "CAIRN.PartySheet.DeprivedShort", "CAIRN.Deprived"));
  if (sys.panicked) conditions.push(condition("panicked", "CAIRN.PartySheet.PanickedShort", "CAIRN.Panicked"));
  if (sys.encumbered) conditions.push(condition("encumbered", "CAIRN.PartySheet.EncumberedShort", "CAIRN.PartySheet.Encumbered"));

  /*
   * COLOUR DOES THE WARNING (user rulings 2026-11-21). Each cell gets a tone
   * the template maps to a class, so the rule lives here, once:
   *   alert  (red)   HP at 0; an ability below its max; no slot left
   *   alert  (red)   also NO RATIONS left (round 3), boxed
   *   warn   (amber) HP below max; exactly one slot left
   *   accent (teal)  a shield or a light IN HAND; any Fatigue, boxed
   * COLOUR MEANS IN HAND for the shield and the light (round 3, user,
   * 2026-11-21): amber on a light carried but not held read as a warning. A
   * carried one shows its symbol uncoloured; none at all leaves the cell
   * empty. The template shows the symbol off `shield` / `lights`, never off
   * the tone.
   * HP is the DERIVED value, so a Panicked or encumbered character reads a red
   * 0 — the number the rules use at the table, not the stored one.
   */
  const hp = { value: sys.hp?.value ?? 0, max: sys.hp?.max ?? 0 };
  const hpTone = hp.value <= 0 ? "alert" : hp.value < hp.max ? "warn" : "";
  const ab = (k) => {
    const a = sys.abilities?.[k] ?? {};
    return { value: a.value ?? 0, max: a.max ?? 0, tone: (a.value ?? 0) < (a.max ?? 0) ? "alert" : "" };
  };
  const slotsUsed = sys.slotsUsed ?? 0;
  const slotsMax = sys.slotsMax ?? 0;
  const slotsTone = sys.encumbered ? "alert" : slotsMax - slotsUsed === 1 ? "warn" : "";
  const lightCount = lights.reduce((n, i) => n + qty(i), 0);
  const lightTone = held ? "accent" : "";
  // The tooltip is rendered as HTML by core: the name is user text, escaped.
  // The aria-label is plain text, so it takes the same words with the name
  // RAW: the escaped one read out "Miner&#x27;s Lantern" (review #36).
  const lightWords = (name) => held
    ? `${game.i18n.format("CAIRN.PartySheet.LightHeld", { name, count: lightCount })} ${game.i18n.localize("CAIRN.PartySheet.LightPutOut")}`
    : lightCount ? game.i18n.format("CAIRN.PartySheet.LightCarried", { count: lightCount }) : "";
  const heldName = held ? t(nameNs, held.name) : "";
  const lightTip = lightWords(foundry.utils.escapeHTML(heldName));
  const lightLabel = lightWords(heldName);
  // The light's own icon (2026-11-21, user ask: it matches the light): the
  // lit one's, else the first carried. A ROUTE, as the character sheet's
  // badge: a relative url() in a custom property resolves against the
  // stylesheet, not the page.
  const shownLight = held ?? lights[0] ?? null;
  const lightIconUrl = shownLight ? foundry.utils.getRoute(lightIcon(shownLight.name)) : "";

  return {
    id: actor.id,
    position: index + 1,
    name: actor.name,
    img: actor.img,
    player: playerNamesFor(actor),
    pronouns: sys.pronouns ?? "",
    background: t("bg.name", sys.background ?? ""),
    hp, hpTone,
    str: ab("STR"), dex: ab("DEX"), wil: ab("WIL"),
    armor: sys.armor ?? 0,
    gold: sys.gold ?? 0,
    slots: { used: slotsUsed, max: slotsMax, tone: slotsTone },
    fatigue, fatigueTone: fatigue > 0 ? "accent" : "",
    shield, shieldTone: shield === "held" ? "accent" : "",
    shieldLabel: shield ? game.i18n.localize(`CAIRN.PartySheet.Shield${shield === "held" ? "Held" : "Slung"}`) : "",
    held: held?.name ?? "",
    lights: lightCount, lightTone, lightTip, lightLabel, lightIcon: lightIconUrl,
    rations, rationsTone: rations === 0 ? "alert" : "",
    connections,
    conditions,
    note: String(actor.getFlag(SETTINGS_NS, WARDEN_NOTE_FLAG) ?? ""),
  };
};

/* -------------------------------------------- */
/*  The Party page of the Warden's Dashboard    */
/* -------------------------------------------- */

/**
 * The bulk actions (2026-11-21, user ask: "add Fatigue to everyone's sheet or
 * mark everyone panicked or deprived — all at once or multiple selections").
 * Each acts on the ticked rows only; nothing is ticked until the Warden ticks
 * it, and "select all" is how to reach everyone (user ruling). Both ways for
 * each (user ruling): a Rest clears a whole party in one press.
 *
 * `confirm` names the sheet's own title, rule and the question asked of a
 * batch; set-ON asks, as the sheet asks, and clearing does not, as the sheet
 * does not — except Remove Fatigue, which the sheet confirms per row and this
 * confirms once. `usePanic` hides the Panicked pair while the rule is off.
 */
export const PARTY_BULK = {
  addFatigue: { key: "CAIRN.PartySheet.AddFatigue" },
  removeFatigue: { key: "CAIRN.PartySheet.RemoveFatigue",
    confirm: { title: "CAIRN.RemoveFatigue", question: "CAIRN.PartySheet.RemoveFatigueConfirm" } },
  markPanicked: { key: "CAIRN.PartySheet.MarkPanicked", usePanic: true,
    field: "system.panicked", value: true,
    confirm: { title: "CAIRN.Panicked", tip: "CAIRN.PanickedTip", question: "CAIRN.PartySheet.PanickedConfirm" } },
  clearPanicked: { key: "CAIRN.PartySheet.ClearPanicked", usePanic: true,
    field: "system.panicked", value: false },
  markDeprived: { key: "CAIRN.PartySheet.MarkDeprived",
    field: "system.deprived", value: true,
    confirm: { title: "CAIRN.Deprived", tip: "CAIRN.DeprivedTip", question: "CAIRN.PartySheet.DeprivedConfirm" } },
  clearDeprived: { key: "CAIRN.PartySheet.ClearDeprived",
    field: "system.deprived", value: false },
};

/** The names a confirm lists, joined the way the active language joins a list. */
const nameList = (actors) => game.i18n.getListFormatter({ style: "long", type: "conjunction" })
  .format(actors.map((a) => a.name));

/**
 * What the Party page draws, for the Dashboard's `party` part.
 * @param {Set<string>} picks  the ticked actor ids
 */
export const partyContext = (picks) => {
  const rows = marchingOrder().map((actor, i) => ({ ...rowFor(actor, i), picked: picks.has(actor.id) }));
  const usePanic = !!game.settings.get(SETTINGS_NS, "use-panic");
  return {
    rows,
    connectionColumns: CONNECTION_COLUMNS,
    noteMax: WARDEN_NOTE_MAX,
    allPicked: rows.length > 0 && rows.every((r) => r.picked),
    nonePicked: !rows.some((r) => r.picked),
    bulk: Object.entries(PARTY_BULK)
      .filter(([, b]) => !b.usePanic || usePanic)
      .map(([id, b]) => ({ id, label: game.i18n.localize(b.key) })),
  };
};

/**
 * The Party page's behaviour, held by the Dashboard (one per window): the
 * marching-order drag, the drop that gives an item, the notes lines, the
 * ticks, and the bulk buttons. Bound to the PART's element on each render of
 * that part — never to the whole window, which re-renders its other parts
 * without this one.
 */
export class PartyPage {
  /** @param {foundry.applications.api.ApplicationV2} app  the Dashboard */
  constructor(app) {
    this.app = app;
  }

  /** The ticked rows, by actor id. Survives a re-render; pruned to the members. */
  picks = new Set();

  /** A render asked for while the Warden is typing a note, run on blur. */
  #renderOnBlur = false;

  /** The id of the row being dragged, set at dragstart. */
  #dragging = null;

  /** The ticks still standing for someone in the party. */
  pruneTicks() {
    const ids = new Set(partyMembers().map((a) => a.id));
    for (const id of this.picks) if (!ids.has(id)) this.picks.delete(id);
  }

  /**
   * Frame-level listeners, bound once (the frame survives a re-render, so
   * binding this per render stacked a copy each time — review #36).
   * @param {HTMLElement} frame
   */
  bindFrame(frame) {
    frame.addEventListener("focusout", () => {
      if (this.#renderOnBlur) this.queueRender();
    });
  }

  /**
   * Wire one render of the Party part.
   * @param {HTMLElement} root  the part's own element
   */
  bind(root) {
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
      // The Dashboard is a <form>: Enter commits the line (its `change`) and
      // goes no further.
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); input.blur(); }
      });
    }
    for (const box of root.querySelectorAll("input[data-pick]")) {
      box.addEventListener("change", () => this.#onPick(box));
      box.addEventListener("dragstart", (event) => event.stopPropagation());
    }
    root.querySelector("input[data-pick-all]")?.addEventListener("change", (event) => this.#onPickAll(event.currentTarget));
    this.#syncTicks(root);
  }

  /**
   * Redraw the Party part soon, once — a burst of item writes (a background
   * re-roll is a dozen; a bulk Fatigue one per character) collapses into one.
   *
   * NOT WHILE A NOTE HAS FOCUS. The Warden's own `change` writes the flag,
   * which fires `updateActor`, which would redraw the input out from under the
   * next keystroke. The render waits for the focus to leave instead.
   */
  queueRender = foundry.utils.debounce(() => {
    const app = this.app;
    if (!app.rendered) return;
    const active = app.element?.ownerDocument?.activeElement;
    if (active?.matches?.("input[data-note]") && app.element.contains(active)) {
      this.#renderOnBlur = true;
      return;
    }
    this.#renderOnBlur = false;
    app.render({ parts: ["party"] });
  }, 150);

  /* -------------------------------------------- */
  /*  Ticks and the bulk buttons                  */
  /* -------------------------------------------- */

  #onPick(box) {
    const id = box.closest("tr[data-actor-id]")?.dataset.actorId;
    if (!id) return;
    if (box.checked) this.picks.add(id);
    else this.picks.delete(id);
    this.#syncTicks(box.closest(".cairn-party-inner"));
  }

  #onPickAll(box) {
    const root = box.closest(".cairn-party-inner");
    for (const row of root.querySelectorAll("input[data-pick]")) {
      row.checked = box.checked;
      const id = row.closest("tr[data-actor-id]")?.dataset.actorId;
      if (!id) continue;
      if (box.checked) this.picks.add(id);
      else this.picks.delete(id);
    }
    this.#syncTicks(root);
  }

  /** The select-all box's three states, and the bulk buttons off until a tick. */
  #syncTicks(root) {
    if (!root) return;
    const boxes = [...root.querySelectorAll("input[data-pick]")];
    const ticked = boxes.filter((b) => b.checked).length;
    const all = root.querySelector("input[data-pick-all]");
    if (all) {
      all.checked = boxes.length > 0 && ticked === boxes.length;
      all.indeterminate = ticked > 0 && ticked < boxes.length;
    }
    for (const b of root.querySelectorAll("button[data-bulk]")) b.disabled = ticked === 0;
  }

  /**
   * Run one bulk action over the ticked rows, in marching order.
   * @param {string} id  a PARTY_BULK key
   * @returns {Promise<number>}  how many characters it changed
   */
  async runBulk(id) {
    const spec = PARTY_BULK[id];
    if (!spec || !game.user.isGM) return 0;
    if (spec.usePanic && !game.settings.get(SETTINGS_NS, "use-panic")) return 0;
    this.pruneTicks();
    const picked = marchingOrder().filter((a) => this.picks.has(a.id));
    // Only those it would change: someone already Panicked is not asked about
    // again, and Remove Fatigue passes over anyone with none.
    const targets = picked.filter((a) => {
      if (id === "addFatigue") return !a.isThing;
      if (id === "removeFatigue") return a.items.some((i) => i.system?.isFatigue);
      return !!foundry.utils.getProperty(a, spec.field) !== spec.value;
    });
    if (!targets.length) return 0;

    if (spec.confirm) {
      const tip = spec.confirm.tip ? game.i18n.localize(spec.confirm.tip) : "";
      const question = game.i18n.format(spec.confirm.question, { names: nameList(targets) });
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize(spec.confirm.title) },
        // In the Dashboard's own window, popped out or not (review #33).
        renderOptions: { window: { windowId: this.app.window?.windowId } },
        content: `<div class="cairn-confirm">${tip}<p class="cairn-confirm-q">${foundry.utils.escapeHTML(question)}</p></div>`,
        rejectClose: false,
        modal: true,
      });
      if (!yes) return 0;
    }

    let changed = 0;
    for (const actor of targets) {
      if (id === "addFatigue") changed += (await actor.addFatigue()) ? 1 : 0;
      else if (id === "removeFatigue") changed += (await actor.removeFatigue()) ? 1 : 0;
      else { await actor.update({ [spec.field]: spec.value }); changed += 1; }
    }
    // Fatigue's notice, as the sheet's + gives it: only where the rule zeroes
    // HP, naming who it tipped over.
    if (id === "addFatigue") {
      const over = targets.filter((a) => a.livesByPlayerRules && a.isEncumbered());
      if (over.length) ui.notifications.warn("CAIRN.PartySheet.FatigueOverloaded", { format: { names: nameList(over) } });
    }
    return changed;
  }

  /* -------------------------------------------- */
  /*  Notes, the marching order, and gifts        */
  /* -------------------------------------------- */

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

  /** Mark the row under the pointer: a row being reordered, or an item arriving. */
  #markDropTarget(event) {
    const root = this.app.element;
    for (const el of root?.querySelectorAll(".cairn-drop-target") ?? []) el.classList.remove("cairn-drop-target");
    event.currentTarget?.classList?.add("cairn-drop-target");
  }

  #clearDrag() {
    this.#dragging = null;
    for (const el of this.app.element?.querySelectorAll(".cairn-drop-target, .cairn-dragging") ?? []) {
      el.classList.remove("cairn-drop-target", "cairn-dragging");
    }
  }

  /**
   * A drop on a row: an ITEM is given to that character (2026-11-21, user
   * ask); a ROW moves in the marching order.
   */
  async #onDrop(event) {
    let data = null;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { data = null; }
    const to = event.currentTarget?.closest("tr[data-actor-id]")?.dataset.actorId;
    const from = this.#dragging ?? (data?.type === "AirBladderPartyRow" ? data.id : null);
    this.#clearDrag();
    if (!to || !game.user.isGM) return;
    if (data?.type === "Item") return this.giveItem(game.actors.get(to), data, event);
    if (!from || from === to) return;
    const ids = marchingOrder().map((a) => a.id);
    const fromAt = ids.indexOf(from);
    const toAt = ids.indexOf(to);
    if (fromAt < 0 || toAt < 0) return;
    // DROPPED ON A LATER ROW, IT GOES AFTER IT; on an earlier row, before it —
    // so dragging the leader onto the second place swaps them, the way a list
    // reads to anyone dragging down it.
    ids.splice(fromAt, 1);
    ids.splice(ids.indexOf(to) + (fromAt < toAt ? 1 : 0), 0, from);
    await game.settings.set(SETTINGS_NS, MARCHING_ORDER_KEY, ids);
  }

  /**
   * Give a dropped item to a member: EXACTLY what dropping it on their sheet
   * does — the character sheet's own `_onDropItem`, so a copy from the
   * sidebar or a compendium, a move off another actor, a stack joining, the
   * one-book wall and the bound-page refusal all hold here too — with ONE
   * difference, the user's ruling (2026-11-21): the Warden's drop may overfill.
   * Their own item dropped on their own row does nothing (no reorder here).
   * @param {Actor} actor
   * @param {object} data  the drag payload
   * @param {DragEvent} [event]
   * @returns {Promise<Item|null>}
   */
  async giveItem(actor, data, event) {
    if (!actor || !game.user.isGM || !isPartyKind(actor)) return null;
    const item = await Item.implementation.fromDropData(data);
    if (!item || item.parent?.uuid === actor.uuid) return null;
    const created = await actor.sheet._onDropItem(event, item, { overfill: true });
    if (created && actor.livesByPlayerRules && actor.isEncumbered()) {
      ui.notifications.warn("CAIRN.PartySheet.Overfilled", { format: { name: actor.name } });
    }
    return created ?? null;
  }
}

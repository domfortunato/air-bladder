/**
 * Player-to-player item offers ("Give an item") — 2026-09-06, user ask.
 *
 * A player OFFERS one item (one unit) from their character to another player's
 * character; the target's owner ACCEPTS or DECLINES off a public chat card.
 * Acceptance may push the recipient past the slot limit: the item is created
 * anyway through the `ignoreCapacity` door and the character is simply
 * over-burdened (encumbered ⇒ derived HP 0) — behind a confirm that names the
 * cost, because an informed yes is the player deciding what to carry, the same
 * choice the generation overflow case protects (see CLAUDE.md's encumbrance
 * section, which records this as owed-overflow case three).
 *
 * TRANSPORT IS PURE PLAYER-TO-PLAYER. Unlike connections (whose ownership
 * writes are server-walled to GMs), an item hand-off only ever writes what
 * each side already owns: the giver's client deletes its half, the acceptor's
 * client creates its half, coordinated over the system socket with
 * `{recipients}`-addressed emits. No GM is required; if the giver is not
 * connected when the target accepts, the accept refuses with a toast and the
 * offer stays open.
 *
 * ONE WRITER FOR STATE. Only a message's author or a GM can update it, so the
 * offer card is authored by the GIVER's client and every state transition
 * (open → accepted / declined / cancelled / lapsed) is a flag write there (or
 * by a GM, who takes the local fast-path below). That single-writer property
 * plus the per-message in-flight set is what closes the double-accept race:
 * the second accept finds the state already moved and is answered "answered".
 *
 * ACCEPTOR CREATES FIRST, GIVER DELETES ON CONFIRMATION — the drop handler's
 * paid lesson (a refused create must never cost the source its item), applied
 * across two clients: it picks the auditable duplication window over the loss
 * window. `settled: false` on an accepted flag is the diagnosable trace.
 *
 * Identity is always the server-authenticated `senderId` handler argument and
 * the core-maintained `message.author` — never a payload field. Refusals are
 * answered (`offerRefused` with a whitelisted reason), never silently dropped.
 */

import { t } from "./i18n-content.js";
import { FATIGUE_NAME } from "./item/item.js";
import { findMatchingStack } from "./gear.js";

const SCOPE = "air-bladder";
const FLAG = "itemOffer";

/** The reasons a refusal may carry — anything else is dropped unread. */
const REFUSAL_TOASTS = {
  answered: "CAIRN.Notify.OfferAnswered",
  busy: "CAIRN.Notify.OfferBusy",
  lapsed: "CAIRN.Notify.OfferLapsed",
  targetGone: "CAIRN.Notify.OfferTargetGone",
  notYours: "CAIRN.Notify.OfferNotYours",
};

/** Accepts this client has emitted and not yet heard back on: messageId → true.
 *  An `offerRelease` for a message NOT in here is forged and ignored. */
const pendingAccepts = new Map();

/** Offers this (giver's) client is mid-transaction on: messageId → the user
 *  being served. The durable lock is the flag's state; this serializes emits
 *  racing within one event loop — and REMEMBERS WHO, because a duplicate
 *  accept from the same sender must be dropped silently, never answered: a
 *  "busy"/"answered" refusal for the duplicate can outrun the real release
 *  (the refusal emits synchronously while the release waits on the flag
 *  write), and the acceptor's refusal handler clears the pending entry the
 *  release then needs — the probe's double-accept leg caught exactly this. */
const offersInFlight = new Map();

/* -------------------------------------------- */
/*  Eligibility and payload                     */
/* -------------------------------------------- */

/**
 * May this item be offered at all? Second layer behind the template's
 * `canGive` gate (the Fatigue two-layer doctrine: removing either alone must
 * not look like a landed change).
 * @param {CairnItem} item
 * @returns {{ok: Boolean, reason?: String}}  reason is a Notify key
 */
export const canOfferItem = (item) => {
  if (item?.actor?.type !== "character") return { ok: false, reason: "CAIRN.Notify.OfferCharacterOnly" };
  if (item.name === FATIGUE_NAME) return { ok: false, reason: "CAIRN.Notify.OfferNoFatigue" };
  if ((item.type === "item" && item.system?.grimoire) || item.system?.bound) {
    return { ok: false, reason: "CAIRN.Notify.OfferNoGrimoire" };
  }
  return { ok: true };
};

/**
 * The create payload for the recipient — built FRESH at accept time on the
 * giver's client, so a torch burned down mid-offer travels at its current
 * uses. One unit, unequipped, appended (sort 0 lets #appendSort place it),
 * and the grant tag stripped: the recipient's background/bond/question
 * re-roll sweeps delete tagged items with no provenance check, so a donated
 * "background" item would be eaten by someone else's re-roll.
 * @param {CairnItem} item
 */
export const buildOfferItemData = (item) => {
  const data = item.toObject();
  delete data._id;
  data.sort = 0;
  data.system = { ...data.system, equipped: false, quantity: 1 };
  if (data.flags?.[SCOPE]) delete data.flags[SCOPE].grantSource;
  return data;
};

/**
 * Re-sanitize a payload that crossed the wire — defense in depth on the
 * acceptor's side, mirroring grantActors' rebuild-don't-trust rule. The wire
 * peer is the giver's own client, but a socket message is a socket message.
 * @param {Object} data
 * @returns {Object|null}  null = refused
 */
const sanitizeDelivery = (data) => {
  if (!data || typeof data !== "object") return null;
  if (!["item", "weapon", "armor", "spellbook", "object"].includes(data.type)) return null;
  if ((data.type === "item" && data.system?.grimoire) || data.system?.bound) return null;
  if (data.name === FATIGUE_NAME) return null;
  delete data._id;
  data.sort = 0;
  data.system = { ...(data.system ?? {}), equipped: false, quantity: 1 };
  if (data.flags?.[SCOPE]) delete data.flags[SCOPE].grantSource;
  return data;
};

/* -------------------------------------------- */
/*  The picker and the card                     */
/* -------------------------------------------- */

/** Non-GM players who explicitly own an actor, for the picker's labels. */
const ownersOf = (actor) =>
  game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER", { exact: false })
    && (actor.ownership?.[u.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Pick who receives the offer: every OTHER world character, alphabetical
 * (PC names are player-authored and never localized). Offline targets stay
 * selectable — the offer waits in chat, and only the GIVER's presence gates
 * the accept. Radio list, first row pre-checked: a radio group with no
 * checked member is CSS :indeterminate, which core renders invisible.
 * @param {CairnActor} giver
 * @param {CairnItem} item
 * @returns {Promise<CairnActor|null>}
 */
export const promptOfferTarget = async (giver, item) => {
  const targets = game.actors
    .filter((a) => a.type === "character" && a.id !== giver.id)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  if (!targets.length) {
    ui.notifications.warn("CAIRN.Notify.OfferNoTargets", { localize: true });
    return null;
  }
  const itemName = t("item.name", item.name);
  let rows = "";
  targets.forEach((a, i) => {
    const owners = ownersOf(a);
    const players = owners.map((u) => u.name).join(", ");
    const label = owners.length === 0
      ? game.i18n.format("CAIRN.Offer.PickerOptionUnowned", { name: a.name })
      : owners.some((u) => u.active)
        ? game.i18n.format("CAIRN.Offer.PickerOption", { name: a.name, players })
        : game.i18n.format("CAIRN.Offer.PickerOptionOffline", { name: a.name, players });
    rows += `<label class="bg-pick-row"><input type="radio" name="offerTarget" value="${a.uuid}"${i === 0 ? " checked" : ""}>
      <span class="bg-pick-name">${esc(label)}</span></label>`;
  });
  const body = game.i18n.format("CAIRN.Offer.PickerBody", { item: esc(itemName), giver: esc(giver.name) });
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.format("CAIRN.Offer.PickerTitle", { item: itemName }), icon: "fas fa-hand-holding" },
      position: { width: 420 },
      content: `<div class="cairn-offer-picker"><p>${body}</p><div class="bg-pick-list">${rows}</div></div>`,
      buttons: [
        {
          action: "offer",
          label: game.i18n.localize("CAIRN.Offer.PickerConfirm"),
          default: true,
          callback: () => {
            const form = dialog.element.querySelector("form") ?? dialog.element;
            finish(foundry.utils.fromUuidSync(form?.elements?.offerTarget?.value ?? "") ?? null);
          },
        },
        { action: "cancel", label: game.i18n.localize("CAIRN.Cancel"), callback: () => finish(null) },
      ],
    });
    const origClose = dialog.close.bind(dialog);
    dialog.close = (...a) => { finish(null); return origClose(...a); };
    dialog.render(true);
  });
};

/**
 * Post the offer: a PUBLIC message authored by this (the giver's) client,
 * state in the flag, body rebuilt per viewer by bindOfferCard. The stored
 * content is a plain English sentence so a client without the render hook
 * still reads something true.
 * @param {CairnActor} giver @param {CairnItem} item @param {CairnActor} target
 */
export const createItemOffer = async (giver, item, target) => {
  const eligible = canOfferItem(item);
  if (!eligible.ok) {
    ui.notifications.warn(eligible.reason, { localize: true });
    return null;
  }
  const flag = {
    state: "open", settled: false,
    giverActorUuid: giver.uuid, targetActorUuid: target.uuid,
    itemId: item.id, acceptorUserId: null,
    item: { name: item.name, img: item.img, bulky: !!item.system?.bulky, weightless: !!item.system?.weightless },
  };
  const fallback = `${giver.name} offers ${item.name} to ${target.name}.`;
  const message = await foundry.documents.ChatMessage.implementation.create({
    speaker: foundry.documents.ChatMessage.implementation.getSpeaker({ actor: giver }),
    content: `<div class="cairn-offer-card">${esc(fallback)}</div>`,
    flags: { [SCOPE]: { [FLAG]: flag } },
  });
  ui.notifications.info("CAIRN.Notify.OfferPosted", {
    format: { item: t("item.name", item.name), target: target.name },
  });
  return message;
};

/** The names an offer card displays, resolved per VIEWER at render. */
const offerNames = (message, offer) => ({
  giver: foundry.utils.fromUuidSync(offer.giverActorUuid)?.name ?? message.speaker?.alias ?? "?",
  target: foundry.utils.fromUuidSync(offer.targetActorUuid)?.name ?? "?",
  item: t("item.name", offer.item?.name ?? "?"),
});

/**
 * Rebuild the offer card in THIS viewer's language and inject the buttons this
 * viewer may press — never stored, so a player's copy has nothing to reveal
 * (the damage-card doctrine). Runs from cairn.js's renderChatMessageHTML hook.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export const bindOfferCard = (message, html) => {
  const offer = message.getFlag(SCOPE, FLAG);
  if (!offer) return;
  const card = html.querySelector(".cairn-offer-card");
  if (!card) return;

  const names = offerNames(message, offer);
  const stateKey = {
    open: "CAIRN.Offer.StateOpen",
    accepted: "CAIRN.Offer.StateAccepted",
    declined: "CAIRN.Offer.StateDeclined",
    cancelled: "CAIRN.Offer.StateCancelled",
    lapsed: "CAIRN.Offer.StateLapsed",
  }[offer.state];
  card.innerHTML = `
    <div class="cairn-offer-body">
      <img src="${esc(offer.item?.img ?? "")}" alt="">
      <span>${esc(game.i18n.format("CAIRN.Offer.CardBody", names))}</span>
    </div>
    <div class="cairn-offer-state">${stateKey ? esc(game.i18n.format(stateKey, names)) : ""}</div>`;
  if (offer.state !== "open") return;

  const target = foundry.utils.fromUuidSync(offer.targetActorUuid);
  const canAnswer = !!target && (game.user.isGM || target.testUserPermission(game.user, "OWNER"));
  const canCancel = game.user.isGM || message.isAuthor;
  if (!canAnswer && !canCancel) return;
  const actions = document.createElement("div");
  actions.className = "cairn-offer-actions";
  const mkBtn = (cls, key, handler) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = game.i18n.localize(key);
    b.addEventListener("click", () => handler(message));
    actions.append(b);
  };
  if (canAnswer) {
    mkBtn("cairn-offer-accept", "CAIRN.Offer.Accept", onAcceptClick);
    mkBtn("cairn-offer-decline", "CAIRN.Offer.Decline", onDeclineClick);
  }
  if (canCancel) mkBtn("cairn-offer-cancel", "CAIRN.Offer.Cancel", onCancelClick);
  card.append(actions);
};

/* -------------------------------------------- */
/*  Clicks                                      */
/* -------------------------------------------- */

/** Can THIS user run the whole transaction locally? Requires the right to
 *  write the message (author or GM) and both actors' halves. */
const canRunLocally = (message, giver, target) =>
  (game.user.isGM || message.isAuthor) && !!giver?.isOwner && !!target?.isOwner;

const onAcceptClick = async (message) => {
  const offer = message.getFlag(SCOPE, FLAG);
  if (!offer || offer.state !== "open") {
    ui.notifications.warn("CAIRN.Notify.OfferAnswered", { localize: true });
    return;
  }
  const target = foundry.utils.fromUuidSync(offer.targetActorUuid);
  const names = offerNames(message, offer);
  if (!target) {
    ui.notifications.warn("CAIRN.Notify.OfferTargetGone", { format: { target: names.target } });
    return;
  }
  if (!(game.user.isGM || target.testUserPermission(game.user, "OWNER"))) {
    ui.notifications.warn("CAIRN.Notify.OfferNotYours", { format: { target: target.name } });
    return;
  }
  // The over-burden confirm: taking this leaves no free slot. `need` off the
  // offer-time snapshot (bulky 2 / weightless 0 / else 1 — the derived-slots
  // rule), the numbers off the live actor.
  const need = offer.item?.bulky ? 2 : offer.item?.weightless ? 0 : 1;
  if (need > 0 && (target.system.slotsUsed ?? 0) + need >= (target.system.slotsMax ?? 0)) {
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("CAIRN.Offer.OverburdenTitle") },
      content: `<p>${esc(game.i18n.format("CAIRN.Offer.OverburdenBody", { item: names.item, target: target.name }))}</p>`,
      yes: { label: game.i18n.localize("CAIRN.Offer.OverburdenConfirm") },
      rejectClose: false,
    });
    if (!yes) return;
  }

  const giver = foundry.utils.fromUuidSync(offer.giverActorUuid);
  if (canRunLocally(message, giver, target)) return runLocalTransfer(message);

  if (!message.author?.active) {
    ui.notifications.warn("CAIRN.Notify.OfferGiverOffline", { format: { giver: names.giver } });
    return;
  }
  pendingAccepts.set(message.id, true);
  game.socket.emit(`system.${game.system.id}`, { action: "offerAccept", messageId: message.id },
    { recipients: [message.author.id] });
};

const onDeclineClick = async (message) => {
  const offer = message.getFlag(SCOPE, FLAG);
  if (!offer || offer.state !== "open") {
    ui.notifications.warn("CAIRN.Notify.OfferAnswered", { localize: true });
    return;
  }
  const target = foundry.utils.fromUuidSync(offer.targetActorUuid);
  if (!(game.user.isGM || (target && target.testUserPermission(game.user, "OWNER")))) {
    ui.notifications.warn("CAIRN.Notify.OfferNotYours", { format: { target: target?.name ?? "?" } });
    return;
  }
  if (game.user.isGM || message.isAuthor) {
    await message.setFlag(SCOPE, FLAG, { state: "declined" });
    return;
  }
  if (!message.author?.active) {
    ui.notifications.warn("CAIRN.Notify.OfferGiverOffline",
      { format: { giver: offerNames(message, offer).giver } });
    return;
  }
  game.socket.emit(`system.${game.system.id}`, { action: "offerDecline", messageId: message.id },
    { recipients: [message.author.id] });
};

const onCancelClick = async (message) => {
  const offer = message.getFlag(SCOPE, FLAG);
  if (!offer || offer.state !== "open") return;
  if (!(game.user.isGM || message.isAuthor)) return;
  if (offersInFlight.has(message.id)) return;
  await message.setFlag(SCOPE, FLAG, { state: "cancelled" });
};

/* -------------------------------------------- */
/*  The transaction                             */
/* -------------------------------------------- */

/** Merge-or-create the delivered item on the target — the drag-move's stack
 *  rule via the SHARED discriminator, else the ignoreCapacity door. Returns
 *  truthy on success. */
const deliverItem = async (target, rawData) => {
  const data = sanitizeDelivery(rawData);
  if (!data) return null;
  const stack = findMatchingStack(target, data);
  if (stack) {
    await stack.update({ "system.quantity": (stack.system.quantity ?? 1) + 1 });
    return stack;
  }
  // weightless threaded top-level: createOwnedItem rebuilds system.weightless
  // from it and would clobber the real value with undefined otherwise.
  const [created] = (await target.createOwnedItem(
    { ...data, weightless: data.system.weightless },
    { ignoreCapacity: true },
  )) ?? [];
  return created ?? null;
};

/** Take one unit off the giver's half — the drop handler's decrement rule. */
const removeGiverHalf = async (giver, itemId) => {
  const item = giver?.items.get(itemId);
  if (!item) return;
  const q = (item.system.quantity ?? 1) - 1;
  if (q > 0) await item.update({ "system.quantity": q });
  else await giver.deleteEmbeddedDocuments("Item", [item.id]);
};

/** The GM / same-user fast-path: the whole hand-off on one client. */
const runLocalTransfer = async (message) => {
  if (offersInFlight.has(message.id)) return;
  offersInFlight.set(message.id, game.user.id);
  try {
    const offer = message.getFlag(SCOPE, FLAG);
    if (offer?.state !== "open") return;
    const giver = foundry.utils.fromUuidSync(offer.giverActorUuid);
    const target = foundry.utils.fromUuidSync(offer.targetActorUuid);
    const item = giver?.items.get(offer.itemId);
    const names = offerNames(message, offer);
    if (!item || (item.system.quantity ?? 1) < 1) {
      await message.setFlag(SCOPE, FLAG, { state: "lapsed" });
      ui.notifications.warn("CAIRN.Notify.OfferLapsed", { format: { item: names.item, giver: names.giver } });
      return;
    }
    await message.setFlag(SCOPE, FLAG, { state: "accepted", acceptorUserId: game.user.id });
    const created = await deliverItem(target, buildOfferItemData(item));
    if (!created) {
      await message.setFlag(SCOPE, FLAG, { state: "open", acceptorUserId: null });
      ui.notifications.warn("CAIRN.Notify.OfferFailed", { localize: true });
      return;
    }
    await removeGiverHalf(giver, offer.itemId);
    await message.setFlag(SCOPE, FLAG, { settled: true });
    ui.notifications.info("CAIRN.Notify.OfferTaken", { format: { item: names.item, target: names.target } });
  } finally {
    offersInFlight.delete(message.id);
  }
};

/* -------------------------------------------- */
/*  The socket protocol                         */
/* -------------------------------------------- */

const answer = (action, messageId, extra, userId) =>
  game.socket.emit(`system.${game.system.id}`, { action, messageId, ...extra }, { recipients: [userId] });

/**
 * Every offer* socket action, dispatched from cairn.js's single listener.
 * Runs on whichever client the emit was addressed to; each branch verifies it
 * is the RIGHT client (the author's for requests, a pending acceptor's for
 * the release) off server-authenticated identity only.
 * @param {Object} msg @param {String} senderId
 */
export const handleOfferSocket = async (msg, senderId) => {
  const message = game.messages.get(msg?.messageId ?? "");

  if (msg.action === "offerAccept" || msg.action === "offerDecline") {
    // Requests land on the author's client — the one that can write the flag.
    if (!message?.isAuthor) return;
    const offer = message.getFlag(SCOPE, FLAG);
    const sender = game.users.get(senderId);
    if (!offer || offer.state !== "open") {
      // Their OWN accept already landed — a duplicate, not a late rival.
      if (offer?.acceptorUserId === senderId) return;
      return answer("offerRefused", msg.messageId, { reason: "answered" }, senderId);
    }
    if (offersInFlight.has(message.id)) {
      if (offersInFlight.get(message.id) === senderId) return; // duplicate of the one being served
      return answer("offerRefused", msg.messageId, { reason: "busy" }, senderId);
    }
    const target = foundry.utils.fromUuidSync(offer.targetActorUuid);
    if (!target) return answer("offerRefused", msg.messageId, { reason: "targetGone" }, senderId);
    if (!sender || !(sender.isGM || target.testUserPermission(sender, "OWNER"))) {
      console.warn(`Air Bladder | ${sender?.name ?? senderId} answered an offer for ${target.name} they do not own`);
      return answer("offerRefused", msg.messageId, { reason: "notYours" }, senderId);
    }
    if (msg.action === "offerDecline") {
      await message.setFlag(SCOPE, FLAG, { state: "declined" });
      ui.notifications.info("CAIRN.Notify.OfferDeclinedBy", { format: { target: target.name, item: t("item.name", offer.item?.name ?? "?") } });
      return;
    }
    offersInFlight.set(message.id, senderId);
    try {
      const giver = foundry.utils.fromUuidSync(offer.giverActorUuid);
      const item = giver?.items.get(offer.itemId);
      if (!item || (item.system.quantity ?? 1) < 1) {
        await message.setFlag(SCOPE, FLAG, { state: "lapsed" });
        return answer("offerRefused", msg.messageId, { reason: "lapsed" }, senderId);
      }
      await message.setFlag(SCOPE, FLAG, { state: "accepted", acceptorUserId: senderId });
      answer("offerRelease", msg.messageId, { itemData: buildOfferItemData(item) }, senderId);
    } finally {
      offersInFlight.delete(message.id);
    }
    return;
  }

  if (msg.action === "offerRelease") {
    // Only meaningful on a client that ASKED — a release nobody requested is
    // forged, and the sender must be the offer's author.
    if (!pendingAccepts.has(msg.messageId)) return;
    if (!message || message.author?.id !== senderId) return;
    pendingAccepts.delete(msg.messageId);
    const offer = message.getFlag(SCOPE, FLAG);
    const target = foundry.utils.fromUuidSync(offer?.targetActorUuid ?? "");
    const names = offerNames(message, offer ?? {});
    try {
      const created = target ? await deliverItem(target, msg.itemData) : null;
      if (!created) throw new Error("delivery refused");
      ui.notifications.info("CAIRN.Notify.OfferTaken", { format: { item: names.item, target: names.target } });
      answer("offerDone", msg.messageId, {}, senderId);
    } catch (err) {
      console.error("Air Bladder | offer delivery failed:", err);
      ui.notifications.warn("CAIRN.Notify.OfferFailed", { localize: true });
      answer("offerFail", msg.messageId, {}, senderId);
    }
    return;
  }

  if (msg.action === "offerDone" || msg.action === "offerFail") {
    if (!message?.isAuthor) return;
    const offer = message.getFlag(SCOPE, FLAG);
    if (offer?.state !== "accepted" || senderId !== offer.acceptorUserId) return;
    const names = offerNames(message, offer);
    if (msg.action === "offerFail") {
      await message.setFlag(SCOPE, FLAG, { state: "open", acceptorUserId: null });
      ui.notifications.warn("CAIRN.Notify.OfferFailed", { localize: true });
      return;
    }
    await removeGiverHalf(foundry.utils.fromUuidSync(offer.giverActorUuid), offer.itemId);
    await message.setFlag(SCOPE, FLAG, { settled: true });
    ui.notifications.info("CAIRN.Notify.OfferAccepted", { format: { target: names.target, item: names.item } });
    return;
  }

  if (msg.action === "offerRefused") {
    if (!pendingAccepts.has(msg.messageId) && !message) return;
    pendingAccepts.delete(msg.messageId);
    if (message && message.author?.id !== senderId) return;
    const key = REFUSAL_TOASTS[msg.reason];
    if (!key) return;
    const offer = message?.getFlag(SCOPE, FLAG);
    const names = message ? offerNames(message, offer ?? {}) : { item: "?", giver: "?", target: "?" };
    ui.notifications.warn(key, { format: names });
  }
};

/* -------------------------------------------- */
/*  The drag route                              */
/* -------------------------------------------- */

/**
 * A drop on a character sheet the dropper does NOT own becomes an offer —
 * today's dead end turned into the same flow the row button drives. Called
 * from _onDropItem's first branch; returns null always (nothing is created
 * by the drop itself).
 * @param {CairnActor} targetActor  the unowned sheet's actor
 * @param {CairnItem} item          the dragged item
 */
export const offerFromDrop = async (targetActor, item) => {
  const giver = item?.actor;
  if (targetActor?.type !== "character" || giver?.type !== "character" || !item.isOwner) {
    ui.notifications.warn("CAIRN.Notify.DropFailed", { localize: true });
    return null;
  }
  const eligible = canOfferItem(item);
  if (!eligible.ok) {
    ui.notifications.warn(eligible.reason, { localize: true });
    return null;
  }
  const names = { item: t("item.name", item.name), target: targetActor.name, giver: giver.name };
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.format("CAIRN.Offer.DragTitle", { item: names.item }) },
    content: `<p>${esc(game.i18n.format("CAIRN.Offer.DragBody", names))}</p>`,
    rejectClose: false,
  });
  if (yes) await createItemOffer(giver, item, targetActor);
  return null;
};

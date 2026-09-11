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

import { t, actorDisplayName } from "./i18n-content.js";
import { FATIGUE_NAME } from "./item/item.js";
import { findMatchingStack, capacityVerdict, slotsNeeded } from "./gear.js";

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
 * May this actor RECEIVE an offer?
 *
 * DELIBERATELY NOT A ROLE LIST (2026-09-10, extending offers past
 * character-to-character). Every role a Warden can mint is somebody or
 * something a player might hand a rope to, and the three walls that decide who
 * really can are already elsewhere and already generic: the PICKER shows only
 * what this user may SEE, the CARD offers Accept only to an OWNER or the
 * Warden, and DELIVERY runs on a client that owns the target. A role list here
 * would be a fourth wall restating the first — and a role predicate that
 * quietly grows is this codebase's thrice-repeated bug.
 *
 * That is also the whole answer for MONSTERS. A monster keeps Foundry's
 * ownership NONE (`CairnActor._preCreate` excludes it from the LIMITED
 * default), so it is not `visible` to a player and never reaches their picker.
 * A Warden who wants one offerable raises it to Limited. No code, and the
 * escape hatch stays open.
 *
 * TWO EXCLUSIONS, both about the document rather than the role:
 *
 * `.pack` — a compendium actor's uuid resolves to a bare index entry with no
 * permission API, so a card naming it renders button-less for every non-GM
 * viewer and the giver cannot even Cancel (review #23 finding 7).
 *
 * `.isToken` — the same refusal `canBeConnected` makes, plus one more reason.
 * A synthetic token actor's uuid resolves only while that token exists on a
 * scene this client holds, and the offer card is a PERMANENT chat message
 * rebuilt per viewer FROM that uuid. Delete the token when the fight ends and
 * every past card turns into "? offers ? to ?".
 *
 * @param {CairnActor} actor
 * @param {CairnActor} [giver]
 */
export const canReceiveOffer = (actor, giver = null) =>
  !!actor
  && !actor.pack
  && !actor.isToken
  && (actor.type === "character" || actor.npcRole !== null)
  && actor.uuid !== giver?.uuid;

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
  // Every REGISTERED item type (ruled 2026-09-07, review #23 finding 3:
  // "admit at the wire") — the give affordance never gated on type, so the
  // wire matches it rather than looping a background offer failed -> reopen.
  // The list stays explicit so garbage on the wire is still refused; a new
  // item type must be added here or its offers hit that loop.
  if (!["item", "weapon", "armor", "spellbook", "object", "background", "transport"].includes(data.type)) return null;
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
 * Live-filter the target list by name.
 *
 * NOT POLISH. Before this change the list was every other player character —
 * usually three or four rows. It is now every actor the user can see, and a
 * world with a bestiary imported into the Actor Directory would put dozens of
 * Limited npcs in front of a player on every single Give.
 *
 * A group header hides when nothing under it survives the filter, so the list
 * never shows a heading with no rows.
 */
const wireOfferFilter = (root) => {
  const field = root?.querySelector(".cairn-offer-filter");
  const list = root?.querySelector(".bg-pick-list");
  if (!field || !list) return;
  field.addEventListener("input", () => {
    const q = field.value.trim().toLowerCase();
    let shownInGroup = 0;
    let header = null;
    const flush = () => { if (header) header.classList.toggle("cairn-hidden", shownInGroup === 0); };
    for (const el of list.children) {
      if (el.classList.contains("cairn-offer-group")) {
        flush();
        header = el;
        shownInGroup = 0;
        continue;
      }
      const hit = !q || el.textContent.toLowerCase().includes(q);
      el.classList.toggle("cairn-hidden", !hit);
      if (hit) shownInGroup++;
    }
    flush();
  });
};

/**
 * Pick who receives the offer: every OTHER world character THIS USER CAN SEE
 * (core `visible` = LIMITED+ — an ownership-NONE character is a doppelganger
 * the Warden is hiding, and its name must not leak into a player's picker;
 * review #23 finding 6), alphabetical (PC names are player-authored and never
 * localized). Offline targets stay selectable — the offer waits in chat, and
 * only the GIVER's presence gates the accept. Radio list, first row
 * pre-checked: a radio group with no checked member is CSS :indeterminate,
 * which core renders invisible.
 * @param {CairnActor} giver
 * @param {CairnItem} item
 * @returns {Promise<CairnActor|null>}
 */
export const promptOfferTarget = async (giver, item) => {
  const targets = game.actors
    .filter((a) => canReceiveOffer(a, giver) && a.visible)
    .sort((a, b) => actorDisplayName(a).localeCompare(actorDisplayName(b), game.i18n.lang));
  if (!targets.length) {
    ui.notifications.warn("CAIRN.Notify.OfferNoTargets", { localize: true });
    return null;
  }
  const itemName = t("item.name", item.name);

  // GROUPED, and CHARACTERS FIRST — which is not decoration. The pre-checked
  // first row must be a character, so today's one-click case stays one click;
  // and a radio group with no checked member is CSS :indeterminate, which core
  // renders invisible. Headers are UI keys rather than role names, the ruling
  // already at warden-dashboard.js: "container" is a word this codebase uses,
  // not a word a player reads.
  const GROUPS = [
    ["CAIRN.Offer.GroupCharacters", (a) => a.type === "character"],
    ["CAIRN.Offer.GroupPeople", (a) => ["npc", "hireling"].includes(a.npcRole)],
    ["CAIRN.Offer.GroupCompanions", (a) => a.npcRole === "companion"],
    ["CAIRN.Offer.GroupThings", (a) => a.isThing],
    ["CAIRN.Offer.GroupMonsters", (a) => a.npcRole === "monster"],
  ];

  let rows = "";
  let index = 0;
  for (const [key, match] of GROUPS) {
    const members = targets.filter(match);
    if (!members.length) continue;
    rows += `<h4 class="cairn-offer-group">${esc(game.i18n.localize(key))}</h4>`;
    for (const a of members) {
      const owners = ownersOf(a);
      const players = owners.map((u) => u.name).join(", ");
      // Names go through the content overlay, or a Spanish client picks "Mule"
      // from this list and reads "Mula" on the sheet. A PC is never localized.
      const shown = actorDisplayName(a);
      // PickerOptionUnowned reads "{name} — Warden only", which is already
      // exactly right for a Limited innkeeper or an unconnected crate. Reused,
      // never duplicated.
      const label = owners.length === 0
        ? game.i18n.format("CAIRN.Offer.PickerOptionUnowned", { name: shown })
        : owners.some((u) => u.active)
          ? game.i18n.format("CAIRN.Offer.PickerOption", { name: shown, players })
          : game.i18n.format("CAIRN.Offer.PickerOptionOffline", { name: shown, players });
      rows += `<label class="bg-pick-row">
        <input type="radio" name="offerTarget" value="${a.uuid}"${index === 0 ? " checked" : ""}>
        <span class="bg-pick-name">${esc(label)}</span></label>`;
      index++;
    }
  }

  const body = game.i18n.format("CAIRN.Offer.PickerBody", { item: esc(itemName), giver: esc(giver.name) });
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: game.i18n.format("CAIRN.Offer.PickerTitle", { item: itemName }), icon: "fas fa-hand-holding" },
      position: { width: 420 },
      content: `<div class="cairn-offer-picker"><p>${body}</p>
        <input type="search" class="cairn-offer-filter" autocomplete="off"
          placeholder="${esc(game.i18n.localize("CAIRN.Offer.PickerFilter"))}">
        <div class="bg-pick-list">${rows}</div></div>`,
      // The filter's listener goes on the LIVE node. DialogV2 runs a string
      // `content` through cleanHTML, so anything wired into the markup is dead
      // by the time it renders — warden-damage.js's dice builder pays the same
      // toll. Filtering reads the row's TEXT rather than a data attribute, for
      // the same reason: nothing to be stripped.
      render: (event, dlg) => wireOfferFilter(dlg.element),
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
  // TARGET-FREE. This string is STORED on a public message and is the only
  // part a client without the render hook reads. `bindOfferCard` rebuilds the
  // full sentence per viewer, masking a target that viewer cannot see — but
  // the stored copy reaches everyone unmasked, so it names nobody.
  const fallback = `${giver.name} offers ${item.name}.`;
  const message = await foundry.documents.ChatMessage.implementation.create({
    speaker: foundry.documents.ChatMessage.implementation.getSpeaker({ actor: giver }),
    content: `<div class="cairn-offer-card">${esc(fallback)}</div>`,
    flags: { [SCOPE]: { [FLAG]: flag } },
  });
  ui.notifications.info("CAIRN.Notify.OfferPosted", {
    format: { item: t("item.name", item.name), target: actorDisplayName(target) },
  });
  return message;
};

/**
 * Accept an offer immediately, when the giver's own user owns the target.
 *
 * A container the player already keeps is the case where posting a card and
 * waiting for somebody to click Accept is theatre — they are the somebody. The
 * alternative is telling them to go and drag it, and the Connections UI is
 * parked, so their mule is only reachable through the Actor Directory: two
 * sheets open to stow a rope, when the Give button is right there.
 *
 * This is deliberately the SAME accept everyone else clicks rather than a
 * second transfer path. The capacity verdict, the over-burden confirm and
 * `runLocalTransfer` all still run, and the public card stays as an honest
 * ledger line. A second copy of `_onDropItem`'s body — which carries the
 * grimoire-page bundle, the sort seam and the status-card pin — would be a
 * second thing to drift.
 *
 * @param {ChatMessage} message  what createItemOffer returned
 * @param {CairnActor} target
 */
export const settleOwnOffer = async (message, target) => {
  if (!message || !target?.isOwner) return null;
  return onAcceptClick(message);
};

/**
 * The names an offer card displays, resolved per VIEWER at render.
 *
 * Through the content overlay, or a Spanish client reads "Mule" on a card over
 * a sheet reading "Mula" — the rule every user-read list of names here obeys.
 * A player character is never localized.
 *
 * MASKED when the viewer cannot see the target. This card is PUBLIC and the
 * flag is authored by a player's own client, so a crafted offer could name any
 * actor that client holds — including a monster or a doppelganger the Warden
 * is hiding. Enforcement is impossible (they own the message); this closes the
 * display half, and it became worth doing the moment the legal target set grew
 * past player characters.
 */
const offerNames = (message, offer) => {
  const target = foundry.utils.fromUuidSync(offer.targetActorUuid);
  const targetName = !target
    ? "?"
    : (target.visible || game.user.isGM)
        ? actorDisplayName(target)
        : game.i18n.localize("CAIRN.Offer.HiddenTarget");
  return {
    giver: (() => {
      const g = foundry.utils.fromUuidSync(offer.giverActorUuid);
      return g ? actorDisplayName(g) : (message.speaker?.alias ?? "?");
    })(),
    target: targetName,
    item: t("item.name", offer.item?.name ?? "?"),
  };
};

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
  // "Waiting for an answer from {target}'s player" is FALSE when nobody owns
  // the target — a Limited innkeeper, an unconnected crate. DERIVED from live
  // ownership, never stored: the flag is written by the giver's own client, so
  // a stored "the Warden answers this" marker would be review #24's class
  // exactly, while `Actor#ownership` is server-walled against every player.
  const liveTarget = foundry.utils.fromUuidSync(offer.targetActorUuid);
  const wardenAnswers = !!liveTarget && ownersOf(liveTarget).length === 0;
  const stateKey = offer.state === "open" && wardenAnswers
    ? "CAIRN.Offer.StateOpenWarden"
    : {
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

  // `?.` on the permission test: the flag is player-writable data, and a uuid
  // that resolves to something with no permission API (a compendium index
  // entry) must degrade to no-buttons-for-you, not a render-hook throw.
  const target = foundry.utils.fromUuidSync(offer.targetActorUuid);
  const canAnswer = !!target && (game.user.isGM || !!target.testUserPermission?.(game.user, "OWNER"));
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
  // What happens if this lands? ONE test, shared with the drop handler, so an
  // offer and a drag can never disagree about the same actor and the same
  // item. `need` comes off the offer-time snapshot (the derived-slots rule),
  // the numbers off the LIVE actor.
  const need = slotsNeeded(offer.item);
  const verdict = capacityVerdict(target, need);

  // A THING, a companion or a monster simply has no room, and nobody may buy
  // past it. "Overflow is owed" is a rule about a PERSON being handed what the
  // rules give them; a crate has no Hit Protection to pay the cost with, so
  // there is nothing to consent to. The offer stays OPEN — free a slot and
  // accept — which is what every other refusal in this file does.
  if (verdict === "full") {
    ui.notifications.warn("CAIRN.Notify.OfferWontFit",
      { format: { item: names.item, target: names.target } });
    return;
  }

  // A person CAN buy it, with an informed click that names the cost.
  if (verdict === "overburden") {
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("CAIRN.Offer.OverburdenTitle") },
      content: `<p>${esc(game.i18n.format("CAIRN.Offer.OverburdenBody",
        { item: names.item, target: names.target }))}</p>`,
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
    // The same in-flight guard Cancel has (review #23 finding 5 ruling):
    // never stamp declined while THIS client is mid-serve of an accept — a
    // decline landing over an accepted write orphans the delivered item and
    // the card lies "stays with giver". The cross-client replication window
    // remains and is recorded with Cancel's as an accepted residual.
    if (offersInFlight.has(message.id)) return;
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
  // ENFORCEMENT, behind the affordance in onAcceptClick — the Fatigue
  // two-layer doctrine, and necessary rather than belt-and-braces: this runs
  // on the local fast path AND on the offerRelease socket leg, where the
  // target was resolved from a flag the giver's client wrote.
  if (!canReceiveOffer(target)) return null;
  const stack = findMatchingStack(target, data);
  if (stack) {
    await stack.update({ "system.quantity": (stack.system.quantity ?? 1) + 1 });
    return stack;
  }
  // ...and the capacity door. `ignoreCapacity` below is what lets an accepted
  // gift overflow a PERSON who clicked through the confirm; without this it
  // would let one overflow a crate too, which nothing may.
  if (capacityVerdict(target, slotsNeeded(data.system)) === "full") return null;
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
    // `settled` is TERMINAL (review #23 finding 2): once the transaction has
    // completed, a replayed offerDone must not decrement the giver's stack
    // again and a replayed offerFail must not reopen the offer — without
    // this the guard read only state + acceptor, and settling never changes
    // the state.
    if (offer?.state !== "accepted" || offer.settled || senderId !== offer.acceptorUserId) return;
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
    // Authenticate BEFORE clearing the pending entry — the same order
    // offerRelease enforces, for the same reason (review #23 finding 1): a
    // forged refusal landing inside the accept window must not strip the
    // entry the genuine release is about to need, or the release is
    // discarded as forged and the offer wedges at accepted + settled:false.
    if (message && message.author?.id !== senderId) return;
    pendingAccepts.delete(msg.messageId);
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
  // ONE question, asked here and in the picker and again at delivery, so the
  // three routes cannot drift — see canReceiveOffer for what it refuses and
  // why it names no role. The GIVER stays character-only: handing something
  // FROM an npc is the Warden's own drag and needs no card.
  if (!canReceiveOffer(targetActor, giver) || giver?.type !== "character" || !item.isOwner) {
    ui.notifications.warn("CAIRN.Notify.DropFailed", { localize: true });
    return null;
  }
  const eligible = canOfferItem(item);
  if (!eligible.ok) {
    ui.notifications.warn(eligible.reason, { localize: true });
    return null;
  }
  const names = {
    item: t("item.name", item.name),
    target: actorDisplayName(targetActor),
    giver: giver.name,
  };
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.format("CAIRN.Offer.DragTitle", { item: names.item }) },
    content: `<p>${esc(game.i18n.format("CAIRN.Offer.DragBody", names))}</p>`,
    rejectClose: false,
  });
  if (yes) await createItemOffer(giver, item, targetActor);
  return null;
};

/**
 * The party's two shared places: a **Party** folder in the Actor directory, and
 * a **Dropped Item Pile** inside it (2026-10-02, user ask).
 *
 * WHAT THIS IS FOR. Deleting something off a character sheet destroyed it, so a
 * player clearing a slot in a hurry had no way back and the Warden had no record
 * of what the party shed. The pile is the floor: things put down are still
 * somewhere, and somebody can pick them up again.
 *
 * NEITHER DOCUMENT IS A NEW TYPE. The pile is an ordinary npc with
 * `role: container` — the directory lists it, the sheet shows an inventory, it
 * takes drops, and the Give control already ships on it. Everything here is
 * find-or-create plus one brokered move.
 *
 * NOTHING IS CREATED ON LOAD, and that is the `weather-log` rule applied: a
 * system update must never start minting documents in somebody's world by
 * itself. The folder appears when the first player character is made through a
 * Create button, the pile when something is first dropped — both deliberate
 * gestures by a person.
 *
 * FOUND BY FLAG, NEVER BY NAME. A Warden may rename either one and nothing here
 * stops working, which is the folder-naming rule this project already follows
 * for the take-over doors' folders. The names are only ever a starting label.
 *
 * THE MOVE RUNS ON THE ACTIVE GM'S CLIENT. The pile is OBSERVER for players by
 * ruling — the table sees what was dropped, the Warden hands things back — and a
 * player cannot write to an actor they only observe, so the server would refuse
 * their create. The broker below is the same shape as `ownershipSync`: the
 * player emits, the active GM answers, and `senderId` is the only field trusted,
 * because it is the only one the server authenticates.
 */

import { t } from "./i18n-content.js";
import { itemSlotCost, formatCount } from "./utils.js";

/**
 * The flag scope, DECLARED HERE rather than imported, and that is the one piece
 * of duplication in this file.
 *
 * `actor.js` has to call `isDroppedPile` from `calcCurrentMaxSlots`, so this
 * module must sit BELOW it in the import graph. The usual home for `FLAG_SCOPE`
 * is `character-generator.js`, which imports `actor.js` at its first line — so
 * importing it from there would close a real cycle around a string. A cycle
 * whose only uses are inside function bodies very probably works; "very probably
 * works" is not a reason to add one.
 *
 * Safe to restate, because the value is settled: the system id is `air-bladder`,
 * the flag scope IS the id (`getFlagScopes()` returns it), and changing the id
 * was measured and CLOSED — it is not a rename, it is publishing a different
 * system.
 */
const FLAG_SCOPE = "air-bladder";

/** The folder this system made for player characters. */
const PARTY_FOLDER_FLAG = "partyFolder";
/** The actor this system made to hold dropped gear. */
const PILE_FLAG = "droppedItemPile";
/** The chat card a Fatigue-driven drop leaves behind, rebuilt per viewer. */
export const PILE_DROP_FLAG = "pileDrop";
/** The socket action the broker answers. */
export const PILE_DROP_ACTION = "pileDrop";

/**
 * How long a "where did you drop it" note may be (user ask: limit 25
 * characters). The `maxlength` attribute is the affordance and THIS is the
 * enforcement, applied where the write happens — a player's drop is brokered, so
 * the only field the server authenticates is `senderId` and a crafted emit can
 * carry a note of any length. Same pairing as the marketplace's greyed rows and
 * the refusal behind them.
 */
export const DROP_NOTE_MAX = 25;

/** The flag the note rides on, surfaced as `system.droppedAt` by CairnItem. */
export const DROP_NOTE_FLAG = "droppedAt";

/** Trim and clamp a note from anywhere, including off the wire. */
export const cleanDropNote = (raw) => String(raw ?? "").trim().slice(0, DROP_NOTE_MAX);

/**
 * The "Where?" field, built once for the two dialogs that ask it.
 *
 * ONE QUESTION, ONE KEY (user ruling: both routes ask). The Drop control and the
 * Fatigue drop land in the same pile, so a half-annotated list is worse than
 * either all or none — and two wordings would read as two different questions to
 * a player who meets both.
 *
 * OPTIONAL, deliberately: a forced field mostly yields "x". Blank leaves the row
 * with no tag at all.
 *
 * `setAttribute`, never `.value` — DialogV2 serializes its content element to
 * innerHTML and re-parses it, so only ATTRIBUTES survive the trip.
 * @return {HTMLElement}
 */
export const buildWhereField = () => {
  const wrap = document.createElement("div");
  wrap.className = "cairn-drop-where";
  const label = document.createElement("label");
  const text = document.createElement("span");
  text.textContent = game.i18n.localize("CAIRN.Pile.Where");
  const input = document.createElement("input");
  input.setAttribute("type", "text");
  input.setAttribute("name", "place");
  input.setAttribute("maxlength", String(DROP_NOTE_MAX));
  input.setAttribute("placeholder", game.i18n.localize("CAIRN.Pile.WherePlaceholder"));
  label.append(text, input);
  wrap.append(label);
  return wrap;
};

/**
 * Is this the Dropped Item Pile?
 *
 * Exported for `calcCurrentMaxSlots`, which is the ONE place the pile's
 * unlimited capacity is expressed — see the note there. A flag read, so it
 * costs nothing and brings no import of this module's machinery with it.
 * @param {Actor} actor
 * @return {Boolean}
 */
export const isDroppedPile = (actor) =>
  !!actor?.getFlag?.(FLAG_SCOPE, PILE_FLAG);

/** The Party folder, or null if nobody has made one. */
export const findPartyFolder = () =>
  game.folders?.find((f) => f.type === "Actor" && f.getFlag(FLAG_SCOPE, PARTY_FOLDER_FLAG)) ?? null;

/**
 * The Dropped Item Pile, or null if nothing has ever been dropped.
 *
 * THE LOWEST ID WINS, rather than whichever the collection happens to list
 * first. A world should hold exactly one pile and `ensureDroppedPile` converges
 * on that — but if two ever exist, every client must agree which one is read,
 * or the Warden and a player are looking at different floors. Collection order
 * is not a promise; an id comparison is.
 */
export const findDroppedPile = () =>
  (game.actors?.filter((a) => isDroppedPile(a)) ?? [])
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;

/**
 * The Party folder's id, making it if this user may.
 *
 * RETURNS null RATHER THAN THROWING when a player may not create folders. A
 * character landing at the root of the directory is a cosmetic miss; a creation
 * that fails outright is not, and this is called from the middle of one.
 * @return {Promise<String|null>}
 */
export const partyFolderId = async () => {
  const existing = findPartyFolder();
  if (existing) return existing.id;
  // `Folder.canUserCreate(user)`, and NOT `game.user.can("FOLDER_CREATE")`.
  // THERE IS NO SUCH PERMISSION: `CONST.USER_PERMISSIONS` carries ACTOR_CREATE,
  // ITEM_CREATE, JOURNAL_CREATE and six more, and no FOLDER_CREATE at all — so
  // that test was false for EVERYONE, the Warden included, and the folder was
  // silently never made while the pile landed at the root of the directory.
  // `dev:crawler-combat` caught it on the first run with the pile present and
  // `in Party folder=false`. Verify a permission by grepping the client for the
  // constant, never by inventing the name the pattern suggests.
  if (!getDocumentClass("Folder").canUserCreate(game.user)) return null;
  try {
    const folder = await Folder.create({
      name: game.i18n.localize("CAIRN.Party.Folder"),
      type: "Actor",
      flags: { [FLAG_SCOPE]: { [PARTY_FOLDER_FLAG]: true } },
    });
    return folder?.id ?? null;
  } catch (err) {
    console.error("Air Bladder | could not create the Party folder:", err);
    return null;
  }
};

/**
 * ONE FLOOR, however many piles got made. GM only, because it writes.
 *
 * A world is meant to hold exactly one pile, and the only way it ends up with
 * two is the race `ensureDroppedPile` describes below — or a Warden duplicating
 * the actor in the sidebar, which lands a second document wearing the same flag.
 * Either way the table now has two floors, one of which no sheet will ever show,
 * because every reader goes through `findDroppedPile`.
 *
 * CONTENTS FIRST, THEN THE EXTRA GOES, which is `movePileItem`'s own ordering
 * one level up: nothing is deleted until it exists somewhere else. The items
 * travel WITH THEIR IDS, so two sessions reconciling at once cannot double
 * anything — the duplicate is refused by the collection, exactly as the drop's
 * own claim is. A delete that throws means another session got there first,
 * which is the result either way.
 * @param {Actor} canonical  the pile every reader resolves to
 * @return {Promise<Actor>}  that same pile
 * @private
 */
const reconcilePiles = async (canonical) => {
  if (!canonical || !game.user.isGM) return canonical;
  const extras = (game.actors?.filter((a) => isDroppedPile(a)) ?? [])
    .filter((p) => p.id !== canonical.id);
  for (const extra of extras) {
    const carried = extra.items.map((i) => i.toObject());    // ids KEPT
    if (carried.length) {
      try {
        await canonical.createEmbeddedDocuments("Item", carried, { keepId: true });
      } catch {
        // Already there, put back by whichever session reconciled first. The
        // extra is still safe to drop, which is the next line.
      }
    }
    try { await extra.delete(); } catch { /* another session tidied it */ }
  }
  return canonical;
};

/**
 * The pile, making it if it is not there yet. GM ONLY — every caller is already
 * running on the active GM's client, because that is the only client that can
 * write to it.
 *
 * IT CONVERGES, because "the active GM's client" is not one client. The guard
 * every broker here uses is `game.users.activeGM !== game.user`, which tests the
 * USER — and Foundry lets one Warden hold several sessions at once (a desktop
 * and a laptop, or two tabs), each of which answers `true` and each of which
 * runs this. Measured: with two Warden sessions open, one player's drop made
 * TWO piles and put a copy of the item in each; with three, three.
 *
 * The create cannot be made safe on its own — see the fixed-id note below — so
 * this converges AFTERWARDS instead, through `reconcilePiles`. That matters
 * beyond tidiness: `movePileItem`'s id claim is per-COLLECTION, so two piles
 * would defeat it and each session would land its own copy.
 *
 * Reconciling on the way IN as well as after a create is deliberate. The race
 * only happens on a world's first drop, and the losing session is then past
 * this function for good; a world that has already split stays split unless the
 * next drop repairs it, and the next drop is the one occasion we know a Warden
 * is looking at the pile.
 *
 * A FIXED ID WOULD NOT DO. A world create over an existing id is not refused —
 * it REPLACES, silently, and takes the contents with it (measured: an actor
 * with one item came back with none). That is the opposite of a mutex. An
 * EMBEDDED collection is the only place Foundry refuses one, which is why the
 * claim lives on the item and the convergence lives here.
 * @return {Promise<Actor|null>}
 */
const ensureDroppedPile = async () => {
  const existing = findDroppedPile();
  if (existing) return await reconcilePiles(existing);
  if (!game.user.isGM) return null;
  const folder = await partyFolderId();
  const made = await getDocumentClass("Actor").create({
    name: game.i18n.localize("CAIRN.Pile.Name"),
    type: "npc",
    system: { role: "container", containerClass: "", slots: 0 },
    // STATED, not left to `_preCreate`. Its LIMITED default is for unconnected
    // PEOPLE; a thing falls through it, and the pile's whole point is that the
    // table can see what is in it. OBSERVER is the ruling: look, do not take —
    // the Warden hands things back with the Give control.
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [FLAG_SCOPE]: { [PILE_FLAG]: true } },
    ...(folder ? { folder } : {}),
  }) ?? null;
  if (!made) return null;
  // `findDroppedPile` and not `made`: another session's pile may already be the
  // one every reader resolves to, and the answer has to be the same on both.
  return await reconcilePiles(findDroppedPile() ?? made);
};

/**
 * Everything on an actor that may be dropped.
 *
 * FATIGUE IS EXCLUDED (user ruling): it is not a thing you are carrying, it is a
 * condition occupying a slot, and a pile of other people's exhaustion is not a
 * place anyone wants to shop. A BOUND GRIMOIRE PAGE is excluded for the reason
 * the inventory already lifts it out of the flat list: it is not the carrier's
 * item, it is the book's.
 * @param {Actor} actor
 * @return {Item[]}
 */
export const droppableItems = (actor) =>
  [...(actor?.items ?? [])].filter((i) => !i.system?.isFatigue && !i.system?.bound);

/**
 * Everything whose drop would FREE A SLOT — what the Fatigue bargain may offer.
 *
 * NOT A NARROWING OF `droppableItems`, which keeps meaning "everything that may
 * be dropped" and still serves the ordinary Drop control, where a petty item is a
 * perfectly good thing to put down. A function by that name which sometimes
 * omitted droppable items would be the correct-sounding lie this repo keeps
 * finding; this one has a reason it can state.
 *
 * PETTY IS EXCLUDED UNCONDITIONALLY (user ruling), never only when already
 * overburdened. Two reasons, and the second is the stronger: a character at 9
 * items plus a Fatigue is not overburdened, yet giving up a petty item there
 * leaves them at 10 after the second Fatigue where an ordinary drop leaves them
 * at 9 — so a condition would admit petty in exactly the case where it does the
 * harm. And if petty is ever on the menu, the sensible play is always to shed the
 * cheapest weightless trinket, which makes a *forced* drop cost nothing at all.
 * The rule already exists one function away, read backwards: `createOwnedItem`
 * exempts a weightless item from the capacity refusal on the way IN, which is
 * precisely why giving one up cannot help on the way OUT.
 *
 * FATIGUE IS EXCLUDED AS FATIGUE, never via pettiness. The first Fatigue is petty
 * now, but the second costs a real slot, so a pettiness test alone would put the
 * second one on the list. Two exclusions, stated separately, overlapping on one
 * row.
 *
 * GOLD CAN NEVER BE HERE: coins fill slots and render as "N Gold" rows, but they
 * are derived from `system.gold` and are not item documents, so there is nothing
 * for a picker of documents to offer. "Drop coins to make room" would be a
 * separate feature, not a filter change.
 * @param {Actor} actor
 * @return {Item[]}
 */
export const slotFreeingItems = (actor) =>
  droppableItems(actor).filter((i) => itemSlotCost(i) >= 1);

/**
 * Move one item from an actor to the pile, from whichever client is asking.
 *
 * PILE FIRST, THEN THE SHEET, and never the other way round. If the create
 * lands and the delete fails the player has two of something, which a Warden can
 * see and fix; if the delete lands and the create fails the item is gone, which
 * nobody can. Both halves run on ONE client for the same reason.
 *
 * @param {Actor} actor   who is dropping it
 * @param {String} itemId the item on that actor
 * @param {Object} [opts]
 * @param {Boolean} [opts.announce]  post the chat record (the Fatigue route does)
 * @return {Promise<Boolean>}  whether it landed
 */
export const dropItemToPile = async (actor, itemId, { announce = false, place = "" } = {}) => {
  if (!actor?.items?.get(itemId)) return false;
  if (game.user.isGM) return movePileItem(actor, itemId, { announce, place });

  // No Warden, no drop. SAID OUT LOUD rather than failing quietly: the request
  // would simply never be answered, and a control that does nothing without
  // explanation is the worst of the three outcomes.
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Pile.NoWarden"));
    return false;
  }
  game.socket.emit(`system.${game.system.id}`, {
    action: PILE_DROP_ACTION,
    actorUuid: actor.uuid,
    itemId,
    announce,
    place,
  });
  // Optimistic: the GM answers asynchronously and the sheet re-renders off the
  // delete when it lands. Nothing here waits on it, because nothing here can —
  // a socket emit has no reply.
  return true;
};

/**
 * The move itself. Only ever called on a client that can write to the pile.
 *
 * PILE FIRST, THEN THE SHEET, and never the other way round (user ruling): if
 * the create lands and the delete fails the player has two of something, which
 * a Warden can see and fix; if the delete lands and the create fails the item is
 * gone, which nobody can.
 *
 * THE ITEM KEEPS ITS ID, AND THAT IS THE LOCK. "The active GM's client" is not
 * one client — the broker's guard is `game.users.activeGM !== game.user`, which
 * tests the USER, and one Warden may hold several sessions (a desktop and a
 * laptop, two tabs). Every one of them answers the same request and ran this
 * whole function: measured, two sessions turned one player's drop into two
 * copies in the pile and one delete that threw "does not exist" because the
 * other had already landed; three sessions made three copies.
 *
 * An embedded collection is the one place Foundry gives an atomic claim: the
 * server REFUSES a duplicate `_id` there, and two creates started together
 * settle as one `ok` and one rejection with exactly one document in the
 * collection (measured). So the id travels instead of being stripped, the
 * create IS the election, and a session that loses it stops — it does not
 * delete, and it does not post the card. Nothing ships `keepId` for an actor's
 * items, so an id already in the pile can only mean another session got there
 * first, which is why that case is read as a win for somebody rather than as a
 * failure.
 *
 * The name is read BEFORE the delete: `item.name` on a deleted document is not
 * something to rely on, and the card is composed from it.
 * @private
 */
const movePileItem = async (actor, itemId, { announce = false, place = "" } = {}) => {
  const item = actor.items.get(itemId);
  if (!item) return false;
  const pile = await ensureDroppedPile();
  if (!pile) return false;
  const name = item.name;
  const note = cleanDropNote(place);
  const data = item.toObject();           // `_id` KEPT: it is the claim
  // WHERE it was put down, stamped onto the copy that lands in the pile. Dropping
  // the same thing again overwrites it — the note describes where it is now, and
  // there is no editing it afterwards by ruling.
  if (note) foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.${DROP_NOTE_FLAG}`, note);
  let won = true;
  try {
    await pile.createEmbeddedDocuments("Item", [data], { keepId: true });
  } catch {
    won = false;
  }
  // LOST THE CLAIM: STOP HERE, and do not delete. The session that won is the
  // one that clears the row and posts the card, so a loser that deleted as well
  // would be racing it for no gain — and losing that race logs `Item "..." does
  // not exist!` on the way, which is noise in a Warden's console describing
  // something that worked.
  //
  // The claim can only be lost to another SESSION, never to history: nothing in
  // this system creates an actor's item with `keepId`, so an id already sitting
  // in the pile means somebody else put it there moments ago. If their delete
  // then fails, the player is left holding a copy — visible to the Warden and
  // fixable, which is the side of that trade the ruling already chose.
  if (!won) return false;
  await item.delete();
  if (announce) await postDropCard(actor, name, note);
  return true;
};

/**
 * The broker, run by the active GM on a player's behalf.
 *
 * THE SENDER'S OWNERSHIP IS THE AUTHORIZATION, and it is checked HERE because
 * nothing in the payload can be trusted — `senderId` is the one field the server
 * authenticates. Without this test any client could emit another player's actor
 * uuid and strip their sheet one item at a time.
 *
 * @param {Object} msg
 * @param {String} senderId
 */
export const handlePileSocket = async (msg, senderId) => {
  if (game.users.activeGM !== game.user) return;
  const requester = game.users.get(senderId);
  if (!requester) return;
  // fromUuid THROWS on a malformed uuid rather than returning null, which is why
  // the caller in cairn.js wraps this — the standing rule for every branch of
  // that socket handler (review #17).
  const actor = await fromUuid(msg.actorUuid);
  if (!(actor instanceof getDocumentClass("Actor"))) return;
  if (!actor.testUserPermission(requester, "OWNER")) return;
  // CLAMPED ON ARRIVAL, where the write happens: `maxlength` on the field is the
  // affordance, and a crafted emit is not bound by it. `senderId` is the only
  // field the server authenticates, so everything else in this payload is a
  // claim — the note included.
  await movePileItem(actor, msg.itemId, {
    announce: msg.announce === true,
    place: cleanDropNote(msg.place),
  });
};

/**
 * The chat record of a Fatigue-driven drop (user ask: "the drop from fatigue
 * should also be recorded in chat").
 *
 * A KIND AND A NAME, NEVER A SENTENCE. The card is composed on whichever client
 * ran the move — the GM's, for a player's drop — so a stored line would freeze
 * in that client's language for every reader. The flag carries the item's stored
 * English name and `localizePileCard` rebuilds the sentence per viewer, putting
 * the name through the content overlay on the way: the rule four other cards in
 * this system have already been fixed under.
 *
 * ONLY THE FATIGUE ROUTE ANNOUNCES. An ordinary Drop is a player tidying their
 * own pack and the pile itself is the record; a card for every one of those
 * would be noise in the log the first time somebody reorganised.
 * @private
 */
const postDropCard = async (actor, itemName, place = "") =>
  getDocumentClass("ChatMessage").create({
    speaker: getDocumentClass("ChatMessage").getSpeaker({ actor }),
    content: dropCardBody(itemName, place),
    flags: { [FLAG_SCOPE]: { [PILE_DROP_FLAG]: { item: itemName, place } } },
  });

/**
 * The sentence, in THIS client's language, from the stored name and place.
 *
 * TWO WHOLE KEYS, never one with an empty `{place}`: a dangling "at ." is not
 * something a translator can repair, and the same rule already governs
 * `CAIRN.AttacksTarget` beside `AttacksTargetWeapon`.
 *
 * The PLACE is never localized. It is what the player typed — the same kind of
 * value as a card's `data-weapon` — and the content overlay is many-to-one with
 * no way back. The item's name does go through it, because that IS world content
 * with a key.
 */
const dropCardBody = (itemName, place = "") => {
  const item = t("item.name", String(itemName ?? ""));
  const where = cleanDropNote(place);
  return where
    ? game.i18n.format("CAIRN.Pile.FatigueDropCardAt", { item, place: where })
    : game.i18n.format("CAIRN.Pile.FatigueDropCard", { item });
};

/**
 * Rebuild the drop card for this viewer. Registered beside the other per-viewer
 * rebuilds in `renderChatMessageHTML`.
 *
 * `isContentVisible` FIRST, the standing rule: a rebuild must never write over
 * core's "rolled privately" substitution on a client that may not read the
 * message. This card is not a roll and so is not the shape that bit review #29,
 * but the guard is cheap and the next card copied from this one may be.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export const localizePileCard = (message, html) => {
  if (!message?.isContentVisible) return;
  const data = message.getFlag(FLAG_SCOPE, PILE_DROP_FLAG);
  if (!data || typeof data.item !== "string") return;
  const body = html.querySelector(".message-content");
  if (!body) return;
  // textContent: nothing here is markup, and both the item name and the place are
  // authored free text — the place especially, since a player types it.
  // A card posted before the note existed carries no `place`, which reads as
  // blank and gets the sentence it was written with.
  body.textContent = dropCardBody(data.item, data.place);
};

/**
 * Ask which item to give up, for the Fatigue-instead-of-Critical-Damage choice.
 *
 * REQUIRED, NOT OFFERED (user ruling): the Fatigue only lands once something has
 * been dropped. But WHICH item is always the player's, never the system's: this
 * is a cost the rules impose and a decision the table makes, which is the line
 * the no-automation deviation draws.
 *
 * THE FATIGUE IS BOUGHT, AND DECLINING TO PAY COSTS THE SAVE (user ruling,
 * 2026-10-02, reversing "cancelling backs out of the whole choice — no Fatigue,
 * no drop, the card still live for either button"). The named refusal button
 * applies the Critical Damage. Escape does NOT: that is what keeps the accident
 * guard the old ruling existed for, since a dialog dismissed by mistake must not
 * have cost the player their alternative.
 *
 * @param {Actor} actor
 * @return {Promise<{id: String, place: String}|"critical"|null>}
 *   an object with the chosen item and the optional 25-character note of where it
 *   was left; the string "critical" when they refused — or when there was nothing
 *   that frees a slot, in which case no dialog opens at all; or null for Escape
 *   and the window's ×, which is no decision.
 */
export const askWhatToDrop = async (actor) => {
  const items = slotFreeingItems(actor);
  // NOTHING TO PAY WITH IS A REFUSAL, reversing the original carve-out (an empty
  // list used to answer "" and let the Fatigue proceed, on the reasoning that
  // such a character "has already paid everything this could ask"). The price is
  // an item that frees a slot; no such item means the price cannot be paid, so
  // the save stands.
  //
  // NO DIALOG OPENS (user ruling, having been offered the alternative) — the
  // button is pressed and the Critical Damage is applied straight away. It is the
  // one gesture in the system where a control does the opposite of its label,
  // which is why the check mark on Mark Critical Damage is load-bearing rather
  // than decorative: it is the only thing that then says what happened.
  if (!items.length) return "critical";

  // BARE: DialogV2 throws on a content element carrying any attribute, so the
  // class goes on a wrapper inside it.
  const content = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "cairn-drop-picker";
  content.append(inner);

  const prompt = document.createElement("p");
  prompt.textContent = game.i18n.localize("CAIRN.Pile.FatiguePrompt");
  inner.append(prompt);

  const list = document.createElement("div");
  list.className = "cairn-drop-list";
  items
    // Sorted on the DISPLAYED name, in the reader's language — the review #9
    // sort-vs-display rule: sorting on stored English renders the list shuffled
    // for everyone else.
    .map((i) => ({ item: i, shown: t("item.name", i.name) }))
    .sort((a, b) => a.shown.localeCompare(b.shown, game.i18n.lang))
    .forEach(({ item, shown }, idx) => {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.setAttribute("type", "radio");
      radio.setAttribute("name", "dropped");
      // setAttribute, never `.value =` / `.checked =`: this element is
      // serialized to innerHTML and re-parsed, so only ATTRIBUTES survive.
      radio.setAttribute("value", item.id);
      if (idx === 0) radio.setAttribute("checked", "checked");
      const text = document.createElement("span");
      text.className = "cairn-drop-name";
      text.textContent = shown;
      label.append(radio, text);
      // USES, where the row has them. A torch is ONE item with up to three uses,
      // exactly like an oil flask with a limited number of pours — so this says
      // uses and NEVER a quantity chip beside them (user ruling: "dude using 'x3'
      // is going to confuse people"). Two numbers meaning different things on one
      // row gets the uses one misread, and a quantity's effect is already inside
      // the slot figure below.
      const max = Number(item.system?.uses?.max ?? 0);
      if (max > 0) {
        const uses = document.createElement("span");
        uses.className = "cairn-drop-uses";
        uses.textContent = game.i18n.format("CAIRN.Pile.Uses",
          { value: Number(item.system?.uses?.value ?? 0), max });
        label.append(uses);
      }
      // WHAT IT FREES, AS A NUMBER AND NEVER THE WORD "bulky" (user: "droping a
      // bulk item would free two slots!!!"). A bulky item frees two, and that is
      // the whole basis of the choice — making the player translate a label into a
      // number, in the one dialog where the number decides, is the wrong way
      // round. `formatCount` and not a hand-built `CAIRN.NSlot_one`: the suffix is
      // this repo's convention, not a form every language carries (review #13).
      const frees = document.createElement("span");
      frees.className = "cairn-drop-frees";
      frees.textContent = game.i18n.format("CAIRN.Pile.Frees",
        { slots: formatCount("CAIRN.NSlot", itemSlotCost(item)) });
      label.append(frees);
      list.append(label);
    });
  inner.append(list);
  // ONLY WHEN SOMETHING WAS ACTUALLY HIDDEN. A player whose pack holds nothing
  // petty does not need to be told what is not on a list.
  if (droppableItems(actor).length > items.length) {
    const note = document.createElement("p");
    note.className = "cairn-drop-petty-note";
    note.textContent = game.i18n.localize("CAIRN.Pile.PettyHidden");
    inner.append(note);
  }
  // The SAME question the Drop control asks, from one builder and one key — both
  // routes land in this pile, and a half-annotated list is worse than either.
  inner.append(buildWhereField());

  const answer = await foundry.applications.api.DialogV2.wait({
    classes: ["cairn-drop-dialog"],
    window: { title: game.i18n.localize("CAIRN.Pile.FatigueTitle") },
    // STATED: `wait` merges no width, unlike `confirm` and `prompt`.
    position: { width: 400 },
    content,
    buttons: [
      {
        action: "drop",
        label: game.i18n.localize("CAIRN.Pile.FatigueConfirm"),
        // The same mark the row's Drop control wears. This is the site a grep of
        // the template misses: changing only the row would have left the dialog
        // that performs the drop wearing the hand, moving the collision rather
        // than ending it.
        icon: "fa-solid fa-down-to-line",
        default: true,
        callback: (_event, button) => ({
          id: String(button.form?.elements?.dropped?.value ?? ""),
          place: cleanDropNote(button.form?.elements?.place?.value),
        }),
      },
      // THE REFUSAL IS NAMED, never "Cancel" (user ruling, reversing "cancel
      // backs out of the whole thing"). The only way to refuse is to read a
      // sentence saying what refusing costs — so this button says it, and
      // pressing it applies the Critical Damage.
      //
      // NO CALLBACK, deliberately: a button without one resolves to its own
      // action STRING (dialog.mjs:273), which is how "refused" is told apart from
      // "dismissed" with no new state anywhere. `type: "button"` as well, so
      // implicit submission cannot reach it — Enter fires the first SUBMIT
      // button, which is the drop.
      {
        action: "critical",
        label: game.i18n.localize("CAIRN.Pile.FatigueRefuse"),
        icon: "fa-solid fa-heart-crack",
        type: "button",
      },
    ],
    rejectClose: false,
  });
  // THREE ANSWERS, told apart by SHAPE and never by truthiness — the refusal
  // resolves to the non-empty string "critical", which is as truthy as the object.
  //   object      → the bargain is struck
  //   "critical"  → refused: the Critical Damage stands
  //   null        → Escape or the window's ×, which is NOT a refusal: no decision
  //                 was made and the card must be left exactly as it was.
  if (answer === "critical") return "critical";
  if (!answer || typeof answer !== "object") return null;
  return { id: answer.id || "", place: answer.place || "" };
};

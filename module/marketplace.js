import { findTableItems } from "./compendium.js";
import { iconForTransport, TRANSPORT_KINDS } from "./icons.js";
import { atConnectionLimit, maxConnections, connectedOwnershipShape, OWNERSHIP_SYNC_FLAG } from "./connections.js";
import { actorDisplayName, localizeNameDesc, t } from "./i18n-content.js";
import { formatCount } from "./utils.js";
import { SETTINGS_NS } from "./settings.js";

/**
 * Is the shop closed to THIS user? The Warden's allow-player-marketplace
 * switch, read live so the shipped toggle macro takes effect with no reload.
 * Never true for a GM. Checked at open AND inside both acquire paths — the
 * hidden sheet button is the affordance, the refusal here is the enforcement,
 * because a marketplace dialog left open across a flip (or a stale sheet)
 * must not stay a way to buy. Client-enforced like every inventory rule in
 * this file: an owning player's client can create embedded items regardless
 * of our JS, so this is a table switch, not a security wall — the same
 * footing as the encumbrance refusal beside it.
 */
const playerMarketClosed = () =>
  !game.user.isGM && !game.settings.get(SETTINGS_NS, "allow-player-marketplace");

/**
 * The marketplace: a shop dialog a character opens from their Inventory tab.
 *
 * Unlike the fork's inlined price list, the catalog is a REFERENCE pack. The
 * `air-bladder.marketplace` compendium holds one RollTable per category
 * ("Market: Weapons/Armor/Gear"), each a list of document results pointing at
 * items in the editable gear pool. A row's price, description, and tags are read
 * off the referenced Item at open time — so editing a pool item's cost in Foundry
 * updates the shop, and dragging an item into a table stocks it. Bundles ("Common
 * Tools (…)") are ordinary items bought generic and renamed on the sheet.
 *
 * NOT cached: every open re-reads the pack (`getDocuments`), so a cost edit is
 * reflected on the next open — the whole point of the reference model.
 *
 * Each item can be BOUGHT (pay its cost in coins) or TAKEN (granted free, e.g. by
 * the Warden). Cairn's slot rules stay this system's job: both refuse when the
 * item wouldn't fit; Buy additionally refuses when the character can't afford it.
 *
 * Transports & containers (mounts, wagons, packs) are stocked the same way, from
 * the editable `transports` pack. They differ only at the point of sale: buying
 * one mints a CONTAINER ACTOR keeper-linked to the buyer, not an embedded item,
 * because a thing with its own slots has to be an Actor in this system.
 */

/** The catalog category holding packs, mounts and vehicles. Exported because the
 *  sheet scopes the shop by it from both directions: the Containers tab shows
 *  ONLY this category, and a container's own shop EXCLUDES it (no buying a cart
 *  to put inside a cart). */
export const TRANSPORTS_CATEGORY = "Transports & Containers";

// Shopper-facing category order; a table whose stripped name isn't listed falls
// to the end in pack order.
const CATEGORY_ORDER = ["Weapons", "Armor", "Gear", TRANSPORTS_CATEGORY];
const MARKETPLACE_PACK = "air-bladder.marketplace";

/** A resolved pool document → a fresh owned-item payload; carries the item's
 *  cost/description/tags.
 *
 *  toObject(), NOT deepClone. The comment here used to claim deepClone meant
 *  "the pack doc is never mutated", and that was exactly backwards:
 *  foundry.utils.deepClone returns any non-plain object unchanged, by reference
 *  (common/utils/helpers.mjs:280-282), and `doc.system` is a TypeDataModel. So a
 *  buyer setting a quantity wrote it into the compendium entry, for everyone. */
/**
 * A shop row's data. `doc` is an Item OR an npc Actor (a mount or a vehicle),
 * and `documentName` is carried through because the two are bought by different
 * routes -- an Item becomes an embedded item, an Actor is minted and connected.
 * Without it the buy handler would have to guess from `type`, which is exactly
 * the sort of inference that breaks when someone adds a new subtype.
 *
 * `toObject()`, not the DataModel: `deepClone(doc.system)` hands back the
 * compendium document's own object BY REFERENCE, and the shop then writes the
 * buyer's quantity into the pack.
 */
const ownedPayload = (doc) => ({
  name: doc.name,
  type: doc.type,
  documentName: doc.documentName,
  img: doc.img,
  system: doc.system.toObject(),
});

/**
 * Read the marketplace pack into shopper-facing categories. Each category's items
 * are owned-item payloads resolved from that table's pack results, in table order.
 *
 * `name` is the ENGLISH identity (callers filter on it via opts.only/opts.exclude,
 * and CATEGORY_ORDER sorts by it); `label` is what a heading should render.
 * @returns {Promise<{categories: {name:string, label:string, items:object[]}[]}>}
 */
export const getMarketplaceCatalog = async () => {
  const pack = game.packs.get(MARKETPLACE_PACK);
  if (!pack) return { categories: [] };
  const tables = await pack.getDocuments();

  const stripPrefix = (name) => String(name).replace(/^Market:\s*/i, "").trim();
  const orderOf = (name) => {
    const i = CATEGORY_ORDER.indexOf(stripPrefix(name));
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  // The heading's translation key is the table's FULL document name ("Market:
  // Weapons") — that is what the content extractor emits under table.name, so
  // stripping first would leave a translator holding a key ("Weapons") the overlay
  // never produces. Translate, then strip. The strip is generic because a
  // translated prefix is not "Market:" ("Mercado:", …); a translation carrying no
  // prefix at all is left whole, and a miss degrades to the English behaviour.
  const displayName = (fullName) => t("table.name", fullName).replace(/^[^:]+:\s*/, "").trim();
  tables.sort((a, b) => orderOf(a.name) - orderOf(b.name) || a.name.localeCompare(b.name));

  const categories = [];
  for (const table of tables) {
    const results = [...table.results].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
    // findTableItems, not a second copy of the same loop. It used to be inlined
    // here, and the two copies then had to be fixed twice for the same defect —
    // which is exactly how the previous fix to this got applied to one of them and
    // not the other. It also means a row dragged in from the Items SIDEBAR now
    // stocks the shop, which is the promise this file opens with and was not true.
    //
    // ...and that is exactly why the Item filter is here. findTableItems resolves a
    // row by uuid, so it returns whatever the row points AT — and inviting sidebar
    // drops invites a JournalEntry (a price list, a shop note), a Macro or a Scene
    // into a Market table, none of which have `system`. `ownedPayload` would throw
    // on `doc.system.toObject()` inside getMarketplaceCatalog, which no caller
    // awaits (actor-sheet.js #onItemShop), so the whole shop silently failed to
    // open for every player — not just the bad row. An Actor row is the quiet half:
    // it has `system`, renders a shop row, and throws later at Buy on an unknown
    // Item subtype. Warn rather than drop in silence: the Warden put it there.
    // ...which is why this is an ALLOW-LIST of two document types rather than a
    // blanket Item check. Mounts and vehicles are Actors now (they carry stat
    // blocks, which no Item can), so the shop has to stock them — but widening
    // this to "anything with a `system`" would let the JournalEntry back in by a
    // different door. `npc` specifically: a Scene and a Macro are still refused,
    // and an Actor of any other type is not something you buy.
    const SELLABLE = { Item: () => true, Actor: (d) => d.type === "npc" };
    const resolved = await findTableItems(results);
    const items = resolved
      .filter((doc) => {
        if (SELLABLE[doc.documentName]?.(doc)) return true;
        console.warn(`Marketplace: ignoring ${doc.documentName} "${doc.name}" in table `
          + `"${table.name}" — a shop can stock Items and npc Actors.`);
        return false;
      })
      .map(ownedPayload);
    if (items.length) categories.push({ name: stripPrefix(table.name), label: displayName(table.name), items });
  }
  return { categories };
};

/** Slots an item occupies: bulky = 2, weightless/petty = 0, otherwise 1. */
const slotCost = (system) => (system.bulky ? 2 : system.weightless ? 0 : 1);

/**
 * Does this row buy a thing that CARRIES, rather than a thing you carry?
 *
 * Two shapes qualify, and both are checked because the pack is mid-move: the
 * legacy `transport` Item, and an npc Actor from Mounts & Transports. Checking
 * only `type` would treat an Actor row as ordinary gear -- rendering it with a
 * one-slot footprint instead of its capacity, and buying it as an embedded item.
 */
const isCarrier = (data) => data.documentName === "Actor" || data.type === "transport";

/** A compact mechanics label for a shop row (damage / armor / bulky / petty / uses). */
const chips = (item) => {
  const s = item.system;
  const out = [];
  // Format keys, not "<number> <noun>": word order is not universal, and
  // CAIRN.Uses is the sheet's field LABEL ("Available uses"), which read as
  // "3 Available uses" when borrowed as a unit noun — wrong in English too.
  if (s.damageFormula) out.push(game.i18n.format("CAIRN.NDamage", { n: s.damageFormula }));
  if (s.armor) out.push(game.i18n.format("CAIRN.NArmor", { n: s.armor }));
  if (s.bulky) out.push(game.i18n.localize("CAIRN.Bulky"));
  if (s.weightless) out.push(game.i18n.localize("CAIRN.Weightless"));
  // formatCount, not format: a single-use item read "1 uses" on every chip.
  if (s.uses?.max) out.push(formatCount("CAIRN.NUses", s.uses.max));
  return out;
};

/** Chips for a transport row: its kind, then slow/bulky flavour. */
const transportChips = (item) => {
  const s = item.system;
  const out = [];
  if (TRANSPORT_KINDS[s.transportKind]) out.push(game.i18n.localize(TRANSPORT_KINDS[s.transportKind]));
  if (s.bulky) out.push(game.i18n.localize("CAIRN.Bulky"));
  if (s.slow) out.push(game.i18n.localize("CAIRN.TransportSlow"));
  return out;
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** One shop row. `metaHtml` is the slot column. */
const rowHtml = ({ idx, cost, name, tagsHtml, metaHtml, descHtml }) =>
  `<div class="mkt-row" data-idx="${idx}" data-cost="${cost}" data-name="${esc(String(name).toLowerCase())}">
    <div class="mkt-line">
      <div class="mkt-row-main" title="${game.i18n.localize("CAIRN.Description")}">
        <span class="mkt-name">${esc(name)}</span>
        <span class="mkt-tags">${tagsHtml}</span>
      </div>
      ${metaHtml}
      <span class="mkt-cost"><i class="fas fa-coins"></i> ${cost}</span>
      <span class="mkt-actions">
        <button type="button" class="mkt-buy" data-idx="${idx}">${game.i18n.localize("CAIRN.Buy")}</button>
        <button type="button" class="mkt-take" data-idx="${idx}" title="${game.i18n.localize("CAIRN.TakeHint")}">${game.i18n.localize("CAIRN.Take")}</button>
      </span>
    </div>
    <div class="mkt-desc" hidden>${descHtml}</div>
  </div>`;

/**
 * Add an item to the actor, enforcing slots (both paths) and coins (Buy only).
 * @param {CairnActor} actor
 * @param {object} data  an owned-item payload
 * @param {boolean} pay  true = Buy (deduct cost), false = Take (free)
 * @returns {Promise<boolean>} whether the item was added
 */
const acquire = async (actor, data, pay) => {
  if (playerMarketClosed()) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MarketplaceDisabled"));
    return false;
  }
  const cost = data.system.cost ?? 0;
  // Every message below names the item through t(): the row the player clicked
  // showed the localized name, and the toast answering the click read the
  // English payload — "Has comprado Rope". The PAYLOAD stays English (it is
  // what gets created); only the messages translate.
  const shown = t("item.name", data.name);
  if (pay && (actor.system.gold ?? 0) < cost) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.NotEnoughGold", { name: shown, cost }));
    return false;
  }
  // A THING is strict (refuses anything that won't fit, never holds equipped
  // gear); a CHARACTER is refused once they have NO FREE SLOT. `isThing` and not
  // the retired `container` TYPE — the same correction review #5 made to the
  // nesting guard below, which this pair was missed in, so an npc sack took
  // stock past its capacity and equipped it.
  if (actor.isThing) {
    const need = slotCost(data.system);
    if ((actor.system.slotsUsed ?? 0) + need > (actor.system.slotsMax ?? 0)) {
      ui.notifications.warn(game.i18n.format("CAIRN.Notify.ContainerFull", { name: shown }));
      return false;
    }
    data.system.equipped = false;
  } else if (actor.isEncumbered() && !data.system?.weightless) {
    // Shopping is ORDINARY ACQUISITION, so a full pack refuses it — the same
    // rule and the same words as `createOwnedItem` and a drop onto a full
    // character, because one rule the player meets three ways should not read
    // as three rules. Overflow is OWED in two cases only (what generation and a
    // background grant hand them, and Fatigue); it is never merely allowed, and
    // this path used to allow it — it created the item and warned afterwards.
    //
    // PETTY is exempt on purpose: it costs no slot, so "your slots are full" is
    // not a reason to refuse it. Same carve-out `createOwnedItem` makes.
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MaxSlotsOccupied"));
    return false;
  }
  // NO flag on the create: the item arriving IS the change log's record of the
  // purchase. The gold deduction is flagged so a Buy is one ledger line, not
  // two — the price is on the item line's other side of the same click.
  await actor.createEmbeddedDocuments("Item", [data]);
  if (pay) {
    await actor.update({ "system.gold": (actor.system.gold ?? 0) - cost }, { abNoStatusCard: true });
    ui.notifications.info(game.i18n.format("CAIRN.Notify.Bought", { name: shown, cost }));
  } else {
    ui.notifications.info(game.i18n.format("CAIRN.Notify.Took", { name: shown }));
  }
  if (!actor.isThing && actor.isEncumbered()) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.Overloaded", { name: shown }));
  }
  return true;
};

/**
 * Buy or take a TRANSPORT. A thing with its own slots has to be an Actor in this
 * system, so this mints an npc from the transport document and connects it to
 * the buyer, rather than embedding an item.
 *
 * No slot check: a container never counts against the buyer's own slots — it is
 * a connected Actor reached through the Connections tab, not carried gear — so
 * refusing the purchase at the till on encumbrance grounds would be wrong.
 * @param {CairnActor} actor
 * @param {object} doc   an owned-payload-shaped transport (name/img/system)
 * @param {boolean} pay  true = Buy (deduct cost), false = Take (free)
 * @returns {Promise<boolean>}
 */
export const acquireTransport = async (actor, doc, pay) => {
  if (playerMarketClosed()) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MarketplaceDisabled"));
    return false;
  }
  // A transport is an Actor; players can't create actors by default, so bail
  // BEFORE charging rather than take the gold and fail on Actor.create.
  if (!game.user.hasPermission("ACTOR_CREATE")) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoActorCreate"));
    return false;
  }
  const cost = doc.system.cost ?? 0;
  // A transport is an Actor doc → monster.name, not item.name (see the row
  // build). Messages only; the payload keeps the English name.
  const shown = t("monster.name", doc.name);
  if (pay && (actor.system.gold ?? 0) < cost) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.NotEnoughGold", { name: shown, cost }));
    return false;
  }
  // A container cannot itself keep a container — no nesting. Not a type test
  // any more: an npc mule IS a container, and its own sheet carries the shop
  // link this guard exists for (review #5). canKeepConnected holds the rule.
  if (!actor.canKeepConnected) {
    // actorDisplayName, not a bare t(). This guard mostly refuses a THING (a
    // Mule, a Backpack) whose name IS in monster.name, and the toast must agree
    // with the sheet title it answers — but canKeepConnected also refuses an
    // unlinked TOKEN, and a token can be a player character, whose name is
    // NEVER localized (the 2026-08-04 gate). One helper holds that gate so no
    // call site re-decides it; it is what actor.js uses for this same message.
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.NoNesting", { name: actorDisplayName(actor) }));
    return false;
  }
  // The connection ceiling, refused at the till like the two walls above it —
  // BEFORE any gold moves. This flow mints the actor with `connectedTo` already
  // in its creation data and never calls `connectActor`, so the cap wall there
  // never sees it.
  if (atConnectionLimit(actor)) {
    // Past the guard above, so the buyer is a CHARACTER and nothing else can
    // reach this line — the name is ALWAYS player-authored here. It used to go
    // through monster.name on the reasoning quoted above, which is true of that
    // guard and false of this one: a PC named Horse or Mule was renamed to
    // whatever the Spanish pack calls the creature, in a toast addressed to
    // their own player. Review #16.
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.ConnectionLimit", { name: actorDisplayName(actor), max: maxConnections() }));
    return false;
  }
  // Give it a real portrait AND a matching map token; fall back to the class icon
  // if the document somehow carries no art.
  const art = doc.img ?? iconForTransport(doc.name, doc.system.transportKind, doc.system.containerClass);
  const s = doc.system;
  // An Actor row states its `role` outright (NpcData.migrateData derives one
  // for a pre-roles document). A legacy `transport` Item has no such field, so
  // infer from transportKind: worn packs and vehicles are things, only a mount
  // (the transportKind) is a creature. Without this a bought Backpack came out
  // animate — and, having no hp field either, was handed the schema's default
  // 6 HP on the way through (the same phantom-6 trap mounts.mjs documents). A
  // kindless legacy Item keeps its old animate reading, a companion.
  //
  // The animate ROLE is `companion` (renamed from `mount` on 2026-08-08); the
  // `transportKind === "mount"` test stays because "mount" is a live KIND value,
  // not a role. Writing "mount" as a role here relied on migrateData rewriting
  // it on read — a shim for legacy data doing live work for a current write.
  const role = s.role
    ?? (s.transportKind
      ? (s.transportKind === "mount" ? "companion"
        : s.transportKind === "vehicle" ? "transport" : "container")
      : "companion");
  const isThing = role === "transport" || role === "container";
  // An npc, not a `container`. What is bought is now the same kind of document as
  // what the compendium ships, so a Horse bought from the shop and a Horse
  // dragged out of Mounts & Transports are the same thing -- which they were not
  // before, when buying flattened a stat block into a slots-only container.
  //
  // getDocumentClass, not the global `Actor` — the global is not
  // CONFIG.Actor.documentClass, so it reaches the same _preCreate defaults only
  // by way of `implementation`; naming the configured class says what runs.
  const payload = {
    type: "npc",
    name: doc.name,
    img: art,
    prototypeToken: { texture: { src: art } },
    system: {
      // Connected at CREATION, so there is no window in which it exists
      // unattached -- which, under the container rule, would be a loot pile
      // flickering into the world between two awaits.
      connectedTo: actor.uuid,
      slots: s.slots ?? 0,
      description: s.description ?? "",
      containerClass: s.containerClass ?? "",
      role,
      cost,
      // Not rollable: "Roll NPC" would overwrite a book statblock.
      generationEnabled: false,
    },
  };
  // Carry a stat block across when the source has one. A thing-role row with
  // none (a legacy Item row, which has no hp field at all) is written as 0/0
  // explicitly, or the schema default hands a cart six hit points.
  if (s.hp) payload.system.hp = { value: s.hp.value ?? 0, max: s.hp.max ?? 0 };
  else if (isThing) payload.system.hp = { value: 0, max: 0 };
  if (s.armorOverride !== undefined && s.armorOverride !== null) {
    payload.system.armorOverride = s.armorOverride;
  }
  const container = await getDocumentClass("Actor").create(payload);
  if (!container) return false;
  // Player-ownable: the CONNECTED ownership shape ({default: OBSERVER, the
  // buyer's players: OWNER}), not the old wholesale copy of the buyer's
  // ownership — a bought mule and a connected one must wear the same rights.
  //
  // GM-side only, because Foundry refuses an `ownership` write from anyone
  // below Assistant ("ownership may only be modified by a GM or Assistant GM
  // user") — this threw for a player in a world where the Warden had granted
  // ACTOR_CREATE, AFTER the container was created and linked but BEFORE the
  // gold was deducted, so they got a free transport and an uncaught error. A
  // player buyer instead sets the sync flag and asks the active GM's client
  // to apply the shape (they already own what they create; the flag ride
  // fills in the OBSERVER default their client cannot write).
  if (game.user.isGM) {
    await container.update({
      ownership: foundry.data.operators.ForcedReplacement.create(connectedOwnershipShape(actor)),
    });
  } else {
    await container.update({ [`flags.air-bladder.${OWNERSHIP_SYNC_FLAG}`]: true });
    game.socket.emit(`system.${game.system.id}`, { action: "ownershipSync", childUuid: container.uuid });
  }
  if (pay) {
    // UNFLAGGED, unlike acquire()'s gold write, and the asymmetry is the point:
    // a transport is a connected ACTOR, so no item lands on the buyer and this
    // deduction is the ONLY trace a bought mule leaves in the change log.
    // Flagging it would make transports the one purchase the ledger never sees.
    await actor.update({ "system.gold": (actor.system.gold ?? 0) - cost });
    ui.notifications.info(game.i18n.format("CAIRN.Notify.Bought", { name: shown, cost }));
  } else {
    ui.notifications.info(game.i18n.format("CAIRN.Notify.Took", { name: shown }));
  }
  return true;
};

/**
 * Open the marketplace for an actor. The dialog stays open for repeated shopping;
 * the header (coins / slots) and Buy affordability refresh after each purchase.
 * @param {CairnActor} actor
 * @param {Object} [opts]
 * @param {string} [opts.only]      restrict to a single catalog category (by name)
 * @param {string} [opts.exclude]   omit a catalog category (by name)
 * @param {string} [opts.titleKey]  i18n key overriding the dialog title
 */
export const openMarketplace = async (actor, opts = {}) => {
  // A stale sheet's shop button (rendered before the Warden flipped the
  // switch) must refuse at the door, not open a dialog whose every click
  // would refuse one row at a time.
  if (playerMarketClosed()) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MarketplaceDisabled"));
    return;
  }
  const catalog = await getMarketplaceCatalog();
  let categories = catalog.categories ?? [];
  if (opts.only) categories = categories.filter((c) => c.name === opts.only);
  if (opts.exclude) categories = categories.filter((c) => c.name !== opts.exclude);
  if (!categories.length) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoMarketplace"));
    return;
  }

  // Counted nouns go through formatCount (review #9): the hand-rolled
  // one-or-many here was English's binary plural with the number concatenated
  // in front — unexpressable word order for a translator, and wrong for any
  // locale with more than two forms (Polish needs few/many). CAIRN.NSlot is
  // the same noun the background tagline already formats this way, so the two
  // surfaces cannot disagree; the retired MarketplaceSlot/MarketplaceSlots
  // keys left en.json and es.json with this change.
  const descHtmlOf = (text) => {
    // Descriptions may be ProseMirror HTML; pull out plain text (tags stripped,
    // entities decoded) via DOMParser — which runs no scripts and loads no
    // resources — then re-escape for safe insertion into the dialog markup.
    const plain = new DOMParser().parseFromString(String(text ?? ""), "text/html").body.textContent ?? "";
    const d = plain.trim();
    return d ? esc(d) : `<em class="mkt-nodesc">${game.i18n.localize("CAIRN.NoDescription")}</em>`;
  };

  // Pre-build each row's payload once (indexed) so a click just looks it up. The
  // slot column reads differently by kind: an item shows the slots it COSTS you,
  // a transport shows the capacity it HOLDS (+N).
  const built = [];
  const sections = categories.map((cat) => {
    const rows = cat.items.map((data) => {
      // Display-only translation: the row SHOWS the localized name/description, but
      // `built` keeps the English payload so Buy/Take creates the canonical item
      // (which then displays translated via the inventory surface).
      // Namespace by ROW KIND: a carrier row is an Actor doc from Mounts &
      // Transports, which the extractor files under monster.* — the default
      // item.* lookup could only ever miss for those, so every transport row
      // read English while the gear beside it read Spanish.
      const d = localizeNameDesc(data, isCarrier(data)
        ? { nameNs: "monster.name", descNs: "monster.desc" }
        : undefined);
      if (isCarrier(data)) {
        const idx = built.push(data) - 1;
        const cap = data.system.slots ?? 0;
        const tags = transportChips(data).map((c) => `<span class="mkt-chip">${esc(c)}</span>`).join("");
        const metaHtml = `<span class="mkt-slots mkt-capacity" title="${game.i18n.localize("CAIRN.TransportCapacity")}">+${esc(formatCount("CAIRN.NSlot", cap))}</span>`;
        return rowHtml({ idx, cost: data.system.cost ?? 0, name: d.name, tagsHtml: tags, metaHtml, descHtml: descHtmlOf(d.system.description) });
      }
      const idx = built.push(data) - 1;
      const slots = slotCost(data.system);
      const tags = chips(data).map((c) => `<span class="mkt-chip">${esc(c)}</span>`).join("");
      const metaHtml = `<span class="mkt-slots">${esc(formatCount("CAIRN.NSlot", slots))}</span>`;
      return rowHtml({ idx, cost: data.system.cost ?? 0, name: d.name, tagsHtml: tags, metaHtml, descHtml: descHtmlOf(d.system.description) });
    }).join("");
    return `<div class="mkt-cat"><div class="mkt-cat-name">${esc(cat.label ?? cat.name)}</div>${rows}</div>`;
  }).join("");

  const content = `<div class="marketplace">
    <div class="mkt-header">
      <span class="mkt-purse"><i class="fas fa-coins"></i> <span class="mkt-coins"></span></span>
      <span class="mkt-slotcount"><i class="fas fa-box"></i> <span class="mkt-slotval"></span></span>
      <input type="search" class="mkt-search" placeholder="${game.i18n.localize("CAIRN.MarketplaceSearch")}" />
    </div>
    <div class="mkt-hint">${game.i18n.localize("CAIRN.MarketplaceHint")}</div>
    <div class="mkt-list">${sections}</div>
  </div>`;

  const title = opts.titleKey
    ? game.i18n.localize(opts.titleKey)
    : game.i18n.localize("CAIRN.Marketplace");
  const dialog = new foundry.applications.api.DialogV2({
    window: { title, icon: "fas fa-store" },
    position: { width: 560 },
    content,
    buttons: [{ action: "close", label: game.i18n.localize("CAIRN.Close"), default: true }],
  });

  // Warn once, on leaving, if they walk out over capacity.
  const origClose = dialog.close.bind(dialog);
  let warnedLeave = false;
  dialog.close = (...a) => {
    if (!warnedLeave && actor.isEncumbered()) {
      warnedLeave = true;
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.LeftOverloaded"));
    }
    return origClose(...a);
  };

  const refresh = () => {
    const root = dialog.element;
    if (!root) return;
    const gold = actor.system.gold ?? 0;
    root.querySelector(".mkt-coins").textContent = gold;
    root.querySelector(".mkt-slotval").textContent = `${actor.system.slotsUsed}/${actor.system.slotsMax}`;
    // A full pack greys the rows it cannot take, rather than leaving a live
    // button that answers with a refusal — the shop should not offer what it is
    // about to turn down. `acquire` still refuses on its own: this is the
    // affordance, not the enforcement, and a stale dialog must not become a way
    // through.
    const full = !actor.isThing && actor.isEncumbered();
    root.querySelectorAll(".mkt-row").forEach((row) => {
      const cost = Number(row.dataset.cost);
      const buy = row.querySelector(".mkt-buy");
      const take = row.querySelector(".mkt-take");
      const data = built[Number(buy.dataset.idx)];
      // Two kinds stay available at a full pack: a TRANSPORT is a connected
      // Actor and never counts against the buyer's slots (buying a mule is how
      // you FIX being full, so refusing it at the till would be perverse), and
      // a PETTY item costs no slot at all.
      const needsRoom = data && !isCarrier(data) && !data.system?.weightless;
      const noRoom = full && !!needsRoom;
      buy.disabled = noRoom || gold < cost;
      take.disabled = noRoom;
    });
  };

  dialog.render(true).then(() => {
    const root = dialog.element;
    const list = root.querySelector(".mkt-list");

    // Buy / Take, and click a name to expand its description.
    list.addEventListener("click", async (ev) => {
      const btn = ev.target.closest(".mkt-buy, .mkt-take");
      if (btn) {
        ev.preventDefault();
        const data = built[Number(btn.dataset.idx)];
        if (!data) return;
        btn.disabled = true;
        const pay = btn.classList.contains("mkt-buy");
        // try/finally, because refresh() is the ONLY thing that re-enables the
        // row: a rejected acquire (a permissions wall mid-write is recorded
        // above) used to leave this Buy/Take dead for the life of the dialog
        // with nothing but a console error (review #9). The error is surfaced
        // and the rows re-derive either way.
        try {
          // A transport mints a container Actor; everything else is an embedded item.
          if (isCarrier(data)) await acquireTransport(actor, data, pay);
          else await acquire(actor, foundry.utils.deepClone(data), pay);
        } catch (err) {
          console.error("Air Bladder | marketplace acquire failed:", err);
          ui.notifications.error(game.i18n.localize("CAIRN.Notify.DropFailed"));
        } finally {
          refresh();
        }
        return;
      }
      const main = ev.target.closest(".mkt-row-main");
      if (main) {
        const desc = main.closest(".mkt-row")?.querySelector(".mkt-desc");
        if (desc) desc.hidden = !desc.hidden;
      }
    });

    // Enter in a search box means "search", and here it meant "leave the shop".
    // DialogV2 renders its content inside a <form> and gives every button
    // type="submit" (applications/api/dialog.mjs:225-227), so HTML implicit
    // submission fired the Close button and `closeOnSubmit` did the rest -- taking
    // the encumbrance warning on the way out, as though the buyer had walked off.
    // art-picker.js:368 guards the identical case on its URL field.
    root.querySelector(".mkt-search").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") ev.preventDefault();
    });

    // Search: filter rows by name, and hide categories left with nothing.
    root.querySelector(".mkt-search").addEventListener("input", (ev) => {
      const q = ev.target.value.trim().toLowerCase();
      root.querySelectorAll(".mkt-cat").forEach((cat) => {
        let anyVisible = false;
        cat.querySelectorAll(".mkt-row").forEach((row) => {
          const show = !q || row.dataset.name.includes(q);
          row.hidden = !show;
          if (show) anyVisible = true;
        });
        cat.hidden = !anyVisible;
      });
    });

    refresh();
  });
};

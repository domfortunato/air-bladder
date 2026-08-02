import { findTableItems } from "./compendium.js";
import { iconForTransport, TRANSPORT_KINDS } from "./icons.js";
import { atConnectionLimit, maxConnections, connectedOwnershipShape, OWNERSHIP_SYNC_FLAG } from "./connections.js";
import { localizeNameDesc, t } from "./i18n-content.js";

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
  if (s.uses?.max) out.push(game.i18n.format("CAIRN.NUses", { n: s.uses.max }));
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
  const cost = data.system.cost ?? 0;
  if (pay && (actor.system.gold ?? 0) < cost) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.NotEnoughGold", { name: data.name, cost }));
    return false;
  }
  // A THING is strict (refuses anything that won't fit, never holds equipped
  // gear); a CHARACTER may go over capacity (they drop to HP 0 until a slot
  // frees). `isThing` and not the retired `container` TYPE — the same correction
  // review #5 made to the nesting guard below, which this pair was missed in, so
  // an npc sack took stock past its capacity and equipped it.
  if (actor.isThing) {
    const need = slotCost(data.system);
    if ((actor.system.slotsUsed ?? 0) + need > (actor.system.slotsMax ?? 0)) {
      ui.notifications.warn(game.i18n.format("CAIRN.Notify.ContainerFull", { name: data.name }));
      return false;
    }
    data.system.equipped = false;
  }
  await actor.createEmbeddedDocuments("Item", [data]);
  if (pay) {
    await actor.update({ "system.gold": (actor.system.gold ?? 0) - cost });
    ui.notifications.info(game.i18n.format("CAIRN.Notify.Bought", { name: data.name, cost }));
  } else {
    ui.notifications.info(game.i18n.format("CAIRN.Notify.Took", { name: data.name }));
  }
  if (!actor.isThing && actor.isEncumbered()) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.Overloaded", { name: data.name }));
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
  // A transport is an Actor; players can't create actors by default, so bail
  // BEFORE charging rather than take the gold and fail on Actor.create.
  if (!game.user.hasPermission("ACTOR_CREATE")) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoActorCreate"));
    return false;
  }
  const cost = doc.system.cost ?? 0;
  if (pay && (actor.system.gold ?? 0) < cost) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.NotEnoughGold", { name: doc.name, cost }));
    return false;
  }
  // A container cannot itself keep a container — no nesting. Not a type test
  // any more: an npc mule IS a container, and its own sheet carries the shop
  // link this guard exists for (review #5). canKeepConnected holds the rule.
  if (!actor.canKeepConnected) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.NoNesting", { name: actor.name }));
    return false;
  }
  // The connection ceiling, refused at the till like the two walls above it —
  // BEFORE any gold moves. This flow mints the actor with `connectedTo` already
  // in its creation data and never calls `connectActor`, so the cap wall there
  // never sees it.
  if (atConnectionLimit(actor)) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.ConnectionLimit", { name: actor.name, max: maxConnections() }));
    return false;
  }
  // Give it a real portrait AND a matching map token; fall back to the class icon
  // if the document somehow carries no art.
  const art = doc.img ?? iconForTransport(doc.name, doc.system.transportKind, doc.system.containerClass);
  const s = doc.system;
  // An Actor row states its `role` outright (NpcData.migrateData derives one
  // for a pre-roles document). A legacy `transport` Item has no such field, so
  // infer from transportKind: worn packs and vehicles are things, only a mount
  // is a creature. Without this a bought Backpack came out animate — and,
  // having no hp field either, was handed the schema's default 6 HP on the way
  // through (the same phantom-6 trap mounts.mjs documents). A kindless legacy
  // Item keeps its old animate reading, which under roles is a mount.
  const role = s.role
    ?? (s.transportKind
      ? (s.transportKind === "mount" ? "mount"
        : s.transportKind === "vehicle" ? "transport" : "container")
      : "mount");
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
    await actor.update({ "system.gold": (actor.system.gold ?? 0) - cost });
    ui.notifications.info(game.i18n.format("CAIRN.Notify.Bought", { name: doc.name, cost }));
  } else {
    ui.notifications.info(game.i18n.format("CAIRN.Notify.Took", { name: doc.name }));
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
  const catalog = await getMarketplaceCatalog();
  let categories = catalog.categories ?? [];
  if (opts.only) categories = categories.filter((c) => c.name === opts.only);
  if (opts.exclude) categories = categories.filter((c) => c.name !== opts.exclude);
  if (!categories.length) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoMarketplace"));
    return;
  }

  const labelFor = (n) => n === 1
    ? game.i18n.localize("CAIRN.MarketplaceSlot")
    : game.i18n.localize("CAIRN.MarketplaceSlots");
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
      const d = localizeNameDesc(data);
      if (isCarrier(data)) {
        const idx = built.push(data) - 1;
        const cap = data.system.slots ?? 0;
        const tags = transportChips(data).map((c) => `<span class="mkt-chip">${esc(c)}</span>`).join("");
        const metaHtml = `<span class="mkt-slots mkt-capacity" title="${game.i18n.localize("CAIRN.TransportCapacity")}">+${cap} ${esc(labelFor(cap))}</span>`;
        return rowHtml({ idx, cost: data.system.cost ?? 0, name: d.name, tagsHtml: tags, metaHtml, descHtml: descHtmlOf(d.system.description) });
      }
      const idx = built.push(data) - 1;
      const slots = slotCost(data.system);
      const tags = chips(data).map((c) => `<span class="mkt-chip">${esc(c)}</span>`).join("");
      const metaHtml = `<span class="mkt-slots">${slots} ${esc(labelFor(slots))}</span>`;
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
    root.querySelectorAll(".mkt-row").forEach((row) => {
      const cost = Number(row.dataset.cost);
      row.querySelector(".mkt-buy").disabled = gold < cost;
      row.querySelector(".mkt-take").disabled = false;
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
        // A transport mints a container Actor; everything else is an embedded item.
        if (isCarrier(data)) await acquireTransport(actor, data, pay);
        else await acquire(actor, foundry.utils.deepClone(data), pay);
        refresh();
        return;
      }
      const main = ev.target.closest(".mkt-row-main");
      if (main) {
        const desc = main.closest(".mkt-row")?.querySelector(".mkt-desc");
        if (desc) desc.hidden = !desc.hidden;
      }
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

import { findCompendiumItem } from "./compendium.js";
import { iconForTransport } from "./icons.js";
import { localizeNameDesc, t } from "./i18n-content.js";

/**
 * The marketplace: a shop dialog a character opens from their Inventory tab.
 *
 * Unlike the fork's inlined price list, the catalog is a REFERENCE pack. The
 * `air-bladder.marketplace` compendium holds one RollTable per category
 * ("Market: Weapons/Armor/Gear"), each a list of type:"pack" results pointing at
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
const ownedPayload = (doc) => ({
  name: doc.name,
  type: doc.type,
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
    const items = [];
    for (const result of results) {
      if (result.type !== CONST.TABLE_RESULT_TYPES.COMPENDIUM) continue;
      const doc = await findCompendiumItem(result.documentCollection, result.text);
      if (doc) items.push(ownedPayload(doc));
    }
    if (items.length) categories.push({ name: stripPrefix(table.name), label: displayName(table.name), items });
  }
  return { categories };
};

/** Slots an item occupies: bulky = 2, weightless/petty = 0, otherwise 1. */
const slotCost = (system) => (system.bulky ? 2 : system.weightless ? 0 : 1);

/** A compact mechanics label for a shop row (damage / armor / bulky / petty / uses). */
const chips = (item) => {
  const s = item.system;
  const out = [];
  if (s.damageFormula) out.push(`${s.damageFormula} ${game.i18n.localize("CAIRN.Damage")}`);
  if (s.armor) out.push(`${game.i18n.localize("CAIRN.Armor")} ${s.armor}`);
  if (s.bulky) out.push(game.i18n.localize("CAIRN.Bulky"));
  if (s.weightless) out.push(game.i18n.localize("CAIRN.Weightless"));
  if (s.uses?.max) out.push(`${s.uses.max} ${game.i18n.localize("CAIRN.Uses")}`);
  return out;
};

/** transportKind -> its localized chip label. */
const KIND_LABEL = {
  worn: "CAIRN.TransportWorn",
  mount: "CAIRN.TransportMount",
  vehicle: "CAIRN.TransportVehicle",
};

/** Chips for a transport row: its kind, then slow/bulky flavour. */
const transportChips = (item) => {
  const s = item.system;
  const out = [];
  if (KIND_LABEL[s.transportKind]) out.push(game.i18n.localize(KIND_LABEL[s.transportKind]));
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
  // A CONTAINER is strict (refuses anything that won't fit, never holds equipped
  // gear); a CHARACTER may go over capacity (they drop to HP 0 until a slot frees).
  if (actor.type === "container") {
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
  if (actor.type !== "container" && actor.isEncumbered()) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.Overloaded", { name: data.name }));
  }
  return true;
};

/**
 * Buy or take a TRANSPORT. A thing with its own slots has to be an Actor in this
 * system, so this mints a container Actor from the transport document and
 * keeper-links it to the buyer, rather than embedding an item.
 *
 * No slot check: a container never counts against the buyer's own slots — it is
 * a keeper-linked Actor reached through the Containers tab, not carried gear — so
 * refusing the purchase at the till on encumbrance grounds would be wrong.
 * @param {CairnActor} actor
 * @param {object} doc   an owned-payload-shaped transport (name/img/system)
 * @param {boolean} pay  true = Buy (deduct cost), false = Take (free)
 * @returns {Promise<boolean>}
 */
export const acquireTransport = async (actor, doc, pay) => {
  // A transport is a container Actor; players can't create actors by default, so
  // bail BEFORE charging rather than take the gold and fail on Actor.create.
  if (!game.user.hasPermission("ACTOR_CREATE")) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoActorCreate"));
    return false;
  }
  const cost = doc.system.cost ?? 0;
  if (pay && (actor.system.gold ?? 0) < cost) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.NotEnoughGold", { name: doc.name, cost }));
    return false;
  }
  // A container cannot itself keep a container — no nesting.
  if (actor.type === "container") {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.ContainerFull", { name: doc.name }));
    return false;
  }
  // Give it a real portrait AND a matching map token; fall back to the transport
  // class icon if the document somehow carries no art.
  const art = doc.img ?? iconForTransport(doc.name, doc.system.transportKind);
  const container = await Actor.create({
    type: "container",
    name: doc.name,
    img: art,
    prototypeToken: { texture: { src: art } },
    system: {
      slots: doc.system.slots ?? 0,
      description: doc.system.description ?? "",
      transportKind: doc.system.transportKind ?? "",
      load: doc.system.load ?? 0,
      cost,
    },
  });
  if (!container) return false;
  await actor.createOwnedContainer(container);
  // Player-ownable: give the transport the same ownership as the character who
  // bought it, so its owning player can open and manage it (GMs always can).
  //
  // GM-only, because Foundry refuses an `ownership` write from anyone below
  // Assistant ("ownership may only be modified by a GM or Assistant GM user") —
  // this threw for a player in a world where the Warden had granted ACTOR_CREATE,
  // AFTER the container was created and linked but BEFORE the gold was deducted,
  // so they got a free transport and an uncaught error. A player doesn't need it
  // anyway: Foundry makes the creating user an owner of what they create.
  if (game.user.isGM) {
    await container.update({ ownership: foundry.utils.deepClone(actor.ownership) });
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
      if (data.type === "transport") {
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
        if (data.type === "transport") await acquireTransport(actor, data, pay);
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

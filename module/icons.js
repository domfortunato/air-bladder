/**
 * Item / actor art by class.
 *
 * The SVGs live in systems/air-bladder/icons/ and are game-icons.net glyphs
 * (CC BY 3.0 — see icons/CREDITS.md; authored by tools/import/icons.mjs). This is
 * the ONE source of truth for "which picture does this thing get", shared by:
 *   - the pack-data importer (tools/import/item-icons.mjs), which stamps every
 *     pool item / monster at author time;
 *   - generation (a resolved gear item, a random scroll, an owned container);
 *   - the sheet, when a player creates an item or container by hand.
 *
 * Pure string logic — NO Foundry globals — so the Node importer can import it as
 * plain ESM. Keep it that way.
 */

export const ICON_DIR = "systems/air-bladder/icons";
// SVG since 2026-07-28 (they were 512x512 PNGs: 492 KB in every release against
// 25 KB now, and blurry when scaled up as a token). module/cairn.js migrates the
// .png paths already baked into documents in existing worlds.
const P = (n) => `${ICON_DIR}/${n}.svg`;

/**
 * The `transportKind` vocabulary, and each kind's label key — ONE definition,
 * because it was previously written out separately in `item-sheet.js` (the
 * transport sheet's pick-list) and `marketplace.js` (the shop's chips), which is
 * two places to forget when a kind is added.
 *
 * "pile" is a loot heap or stash: a container that nothing carries. It is the
 * only kind that is not a way of moving things around, which is why it shows in
 * the Actor Directory (see `cairn.js`) — a character's Containers tab is the one
 * place something no character holds could never be reached from.
 *
 * The transport ITEM sheet offers it too, from this same list. Nothing in the
 * shipped `transports` pack uses it and a purchasable pile would be odd, but one
 * vocabulary with a strange corner beats two that drift.
 */
export const TRANSPORT_KINDS = {
  worn: "CAIRN.TransportWorn",
  mount: "CAIRN.TransportMount",
  vehicle: "CAIRN.TransportVehicle",
  pile: "CAIRN.TransportPile",
};

/**
 * What a container IS, as one classification with two consumers: its art, and
 * the label its sheet shows.
 *
 * They were one function returning a path, which meant a sheet could only say
 * "Mount" — true of a Heavy Destrier and useless, since nothing on that sheet
 * said "horse" anywhere. Splitting the decision out lets the label be as specific
 * as the picture already was, and guarantees the two never disagree.
 *
 * `mule` and `donkey` share one glyph but are separate classes for exactly that
 * reason: a Mule labelled "Donkey" would be wrong, where a Mule DRAWN as a donkey
 * is just the art we have.
 */
export const CONTAINER_CLASSES = {
  pile: { icon: "stack", label: "CAIRN.ClassPile" },
  backpack: { icon: "backpack", label: "CAIRN.ClassBackpack" },
  sack: { icon: "sack", label: "CAIRN.ClassSack" },
  handcart: { icon: "handcart", label: "CAIRN.ClassHandcart" },
  cart: { icon: "cart", label: "CAIRN.ClassCart" },
  wagon: { icon: "wagon", label: "CAIRN.ClassWagon" },
  mule: { icon: "donkey", label: "CAIRN.ClassMule" },
  donkey: { icon: "donkey", label: "CAIRN.ClassDonkey" },
  horse: { icon: "horse", label: "CAIRN.ClassHorse" },
  chest: { icon: "chest", label: "CAIRN.ClassChest" },
};

/**
 * Classify a container / transport. Keyed on the NAME first (so "Handcart" and
 * "Cart" differ), then falling back on transportKind for exotic names — the
 * named mounts (Heavy Destrier, Piebald Cob, …) carry no give-away word, but
 * they are all kind "mount", so they classify as a horse. That fallback is why
 * a Destrier's sheet can say "Horse" without anyone writing it down.
 * @param {String} name
 * @param {String} [kind]  transportKind: "worn" | "mount" | "vehicle" | "pile"
 * @returns {String}  a key of CONTAINER_CLASSES
 */
export const containerClass = (name = "", kind = "", stored = "") => {
  // An explicit class wins outright. The keyword table below is English, so it is
  // the only thing a Warden working in another language can say "this is a
  // backpack" with — and because both the art and the sheet's class label come
  // through here, saying it once fixes both.
  if (stored && CONTAINER_CLASSES[stored]) return stored;
  const n = String(name).toLowerCase();
  // Kind FIRST for a pile, unlike every other class. The others are named after
  // the thing they are ("Cart", "Mule") so the name is the better signal, but a
  // pile is named for what is IN it — "Bandit Loot", "Spoils of the Barrow" —
  // and would otherwise fall through to the chest.
  if (kind === "pile") return "pile";
  if (n.includes("backpack")) return "backpack";
  if (/\bsacks?\b/.test(n) || n.includes("pouch") || n.includes("satchel")) return "sack";
  if (n.includes("handcart")) return "handcart";              // before "cart"
  if (n.includes("cart")) return "cart";
  if (n.includes("wagon")) return "wagon";
  if (n.includes("mule")) return "mule";                      // before "donkey"
  if (n.includes("donkey")) return "donkey";
  if (n.includes("chest") || n.includes("crate") || n.includes("coffer") ||
      n.includes("barrel") || n.includes("box")) return "chest";
  if (n.includes("horse")) return "horse";
  if (n.includes("pile") || n.includes("hoard") || n.includes("stash")) return "pile";
  if (kind === "worn") return "sack";
  if (kind === "vehicle") return "wagon";
  if (kind === "mount") return "horse";
  return "chest";                                             // a bare container
};

/** Container / transport art, from its class. */
export const iconForTransport = (name = "", kind = "", stored = "") =>
  P(CONTAINER_CLASSES[containerClass(name, kind, stored)].icon);

/** The i18n key naming what a container is: "Horse", "Wagon", "Item Pile", … */
export const containerClassLabel = (name = "", kind = "", stored = "") =>
  CONTAINER_CLASSES[containerClass(name, kind, stored)].label;

/**
 * Gear art by item type, with a few name-based specialisations for the generic
 * "item" type (scrolls, bags, chests). Tools are NOT detectable by name — they
 * are a whole pack — so the importer maps that pack directly; everything created
 * at runtime falls through to the generic bindle.
 * @param {String} type  item type: weapon | armor | spellbook | transport | item | object | background
 * @param {String} [name]
 * @returns {String}  a systems/air-bladder/icons/*.svg path
 */
export const iconForItem = (type = "item", name = "") => {
  switch (type) {
    case "weapon": return P("weapons");
    case "armor": return P("armor");
    case "spellbook": return P("spellbook");
    case "transport": return iconForTransport(name);
    case "background": return P("background");
  }
  const n = String(name).toLowerCase();
  if (n.includes("scroll")) return P("spellscroll");
  if (n.includes("backpack")) return P("backpack");
  if (/\bsacks?\b/.test(n) || n.includes("pouch") || n.includes("satchel")) return P("sack");
  if (n.includes("chest") || n.includes("crate") || n.includes("coffer")) return P("chest");
  return P("generic-item");
};

/**
 * The two faces of a spellbook document. `scroll` swaps between them, so both are
 * named here and neither is written out at the call site: an item.js that hardcoded
 * the paths would be a second source of truth, which is how the tools pack was left
 * behind on .png through the 2026-07-28 SVG swap.
 */
export const SPELLSCROLL_ICON = P("spellscroll");
export const SPELLBOOK_ICON = P("spellbook");
/**
 * The tools pack's art. Tools are not detectable by name — being a tool is a
 * whole pack, not a word — so the importer maps that pack directly. Exported
 * rather than written out there, because a literal path in the importer is a
 * second source of truth: it silently kept the whole pack on .png through the
 * 2026-07-28 SVG swap.
 */
export const TOOLS_ICON = P("tools");
/** Default art for a bare, hand-made container actor. */
export const CONTAINER_ICON = P("chest");

/**
 * Actor art by type. NPCs (the monster pack, and hand-made ones) get the monster
 * glyph; a container without a transport name gets the chest. Characters and
 * hirelings keep their portraits, so this returns null for them.
 */
export const iconForActor = (type = "", name = "") => {
  if (type === "npc") return P("monster");
  if (type === "container") return iconForTransport(name);
  return null;
};

/** The class-icon gallery offered when a player re-arts a container / transport. */
export const CONTAINER_ART = [
  P("chest"), P("backpack"), P("sack"), P("stack"),
  P("horse"), P("donkey"),
  P("cart"), P("handcart"), P("wagon"),
];

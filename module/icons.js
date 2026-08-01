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
/**
 * Every kind of container a Warden can pick, as art + label + a default capacity.
 *
 * `slots` is the third thing this table carries, and it is what lets the plain
 * storage containers stop being DOCUMENTS. A sack, a chest, a crate and a barrel
 * have no authored content — no HP, no armor, no rules text, nothing but a shape
 * and a capacity — so shipping one pack document each would be shipping a row of
 * this table with extra steps. Anything with content (the Outrider's six breeds,
 * a named wagon) stays a document; anything that is only a shape lives here.
 *
 * `slots: 0` means "use the world's max-equip-slots setting" (see
 * `capacity()` / `calcCurrentMaxSlots`), which is right for a pile: loot on the
 * floor is not a manufactured object with a fixed capacity.
 */
export const CONTAINER_CLASSES = {
  pile: { icon: "stack", label: "CAIRN.ClassPile", slots: 0, role: "container" },
  backpack: { icon: "backpack", label: "CAIRN.ClassBackpack", slots: 4, role: "container" },
  sack: { icon: "sack", label: "CAIRN.ClassSack", slots: 2, role: "container" },
  handcart: { icon: "handcart", label: "CAIRN.ClassHandcart", slots: 4, role: "transport" },
  cart: { icon: "cart", label: "CAIRN.ClassCart", slots: 4, role: "transport" },
  wagon: { icon: "wagon", label: "CAIRN.ClassWagon", slots: 8, role: "transport" },
  mule: { icon: "donkey", label: "CAIRN.ClassMule", slots: 6, role: "mount" },
  donkey: { icon: "donkey", label: "CAIRN.ClassDonkey", slots: 4, role: "mount" },
  horse: { icon: "horse", label: "CAIRN.ClassHorse", slots: 4, role: "mount" },
  chest: { icon: "chest", label: "CAIRN.ClassChest", slots: 6, role: "container" },
  crate: { icon: "crate", label: "CAIRN.ClassCrate", slots: 6, role: "container" },
  barrel: { icon: "barrel", label: "CAIRN.ClassBarrel", slots: 4, role: "container" },
  box: { icon: "box", label: "CAIRN.ClassBox", slots: 2, role: "container" },
};

/** A class's default capacity, or 0 ("use the world setting") if it has none. */
export const containerClassSlots = (cls) => CONTAINER_CLASSES[cls]?.slots ?? 0;

/** Which role a variety implies: "mount", "transport" or "container" for a known
 *  class, "" for a blank or Warden-invented one (see docs/npc-roles-plan.md).
 *  Lives on the same table as art, label and capacity so they cannot drift. */
export const containerClassRole = (cls) => CONTAINER_CLASSES[cls]?.role ?? "";

/** Is this class a CREATURE? Derived from role, not stored beside it — a second
 *  boolean saying "mount" would be a second thing to drift. A mule gets a stat
 *  block, a barrel gets 0/0. */
export const containerClassAnimate = (cls) => containerClassRole(cls) === "mount";

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
  // Crate, barrel and box used to fall into `chest` for want of their own art.
  // Order matters: "chest" before "box" so a "Boxwood Chest" is still a chest.
  if (n.includes("crate")) return "crate";
  if (n.includes("barrel") || n.includes("cask") || n.includes("keg")) return "barrel";
  if (n.includes("chest") || n.includes("coffer")) return "chest";
  if (n.includes("box") || n.includes("case")) return "box";
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
 * Actor art by type, for the PACK IMPORTER (tools/import/item-icons.mjs) — the
 * only caller. NPCs (the monster pack, and hand-made ones) get the monster
 * glyph; characters and hirelings keep their portraits, so this returns null.
 *
 * The `container` branch went with the type (2026-07-31). It is not a loss for
 * the container packs: a container is an npc now and every shipped one stores a
 * `containerClass`, so `iconForTransport` is called with the class directly —
 * by the importer (mounts.mjs) and by CairnActor#_preCreate for hand-made ones.
 * Routing on a type could only ever have guessed from the name.
 */
export const iconForActor = (type = "") => {
  if (type === "npc") return P("monster");
  return null;
};

/**
 * The gallery offered when someone re-arts a container.
 *
 * DERIVED from CONTAINER_CLASSES rather than hand-listed. It used to be its own
 * array of nine paths, which meant adding a class and adding it to the picker
 * were two edits — and the previous list had already drifted, offering no way to
 * choose a mule (distinct capacity from a donkey) and omitting the pile entirely.
 * One table, one source.
 *
 * Each entry carries the CLASS KEY, not just the image, because picking art is
 * really picking what the thing IS: the same key drives the art, the one-word
 * label on the sheet and the default capacity, so choosing "barrel" must not be
 * able to leave a thing that looks like a barrel and calls itself a chest.
 *
 * Each GLYPH appears once: when classes share art, the first one in the table
 * owns the cell. That is the mule/donkey pair — game-icons.net has no mule (a
 * probe of every author 404s), so both wear Skoll's donkey, and offering the
 * picture twice just looks broken. Mule wins by table order because it is the
 * beast in the open 2e marketplace text. `donkey` stays a full class — a thing
 * NAMED Donkey still classifies, labels and defaults to 4 slots — it is only
 * not a click target, which costs a Warden working in another language the
 * ability to say "this is a Donkey" by art alone. Accepted 2026-07-31.
 */
export const CONTAINER_ART_CHOICES = Object.entries(CONTAINER_CLASSES)
  .filter(([, v], i, arr) => arr.findIndex(([, w]) => w.icon === v.icon) === i)
  .map(([key, { icon, label, slots }]) => ({ key, src: P(icon), label, slots }));

/** Just the image paths, for anything that only needs to know what art exists. */
export const CONTAINER_ART = CONTAINER_ART_CHOICES.map((c) => c.src);

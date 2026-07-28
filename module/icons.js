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
 * Container / transport art. Keyed on the name first (so "Handcart" and "Cart"
 * differ), then falls back on transportKind for exotic names — the named mounts
 * (Heavy Destrier, Piebald Cob, …) carry no give-away word, but they are all
 * kind "mount", which resolves to the horse.
 * @param {String} name
 * @param {String} [kind]  transportKind: "worn" | "mount" | "vehicle"
 */
export const iconForTransport = (name = "", kind = "") => {
  const n = String(name).toLowerCase();
  if (n.includes("backpack")) return P("backpack");
  if (/\bsacks?\b/.test(n) || n.includes("pouch") || n.includes("satchel")) return P("sack");
  if (n.includes("handcart")) return P("handcart");           // before "cart"
  if (n.includes("cart")) return P("cart");
  if (n.includes("wagon")) return P("wagon");
  if (n.includes("donkey") || n.includes("mule")) return P("donkey");
  if (n.includes("chest") || n.includes("crate") || n.includes("coffer") ||
      n.includes("barrel") || n.includes("box")) return P("chest");
  if (n.includes("horse")) return P("horse");
  if (kind === "worn") return P("sack");
  if (kind === "vehicle") return P("wagon");
  if (kind === "mount") return P("horse");
  return P("chest");                                          // a bare container
};

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

/** The generated single-use spell scroll's art. */
export const SPELLSCROLL_ICON = P("spellscroll");
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
  P("chest"), P("backpack"), P("sack"),
  P("horse"), P("donkey"),
  P("cart"), P("handcart"), P("wagon"),
];

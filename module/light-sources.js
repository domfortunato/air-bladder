/**
 * Light sources and how far they reach (2026-11-20, user asks: the light
 * badge on the character sheet, its radius text, and which items count as
 * lights at all).
 *
 * THE NUMBERS ARE THE MAINTAINER'S, not Cairn's: Cairn gives no light radii.
 * They are the ones docs/torch-light-sources.json gives the Torch module (the
 * file a Warden uploads), in feet on the 5 ft grid, and the user ruled them
 * the maintainer's own (2026-11-20). TWO COPIES, HELD IDENTICAL BY `npm run check:refs`
 * (tools/dev/ref-audit.mjs): this one ships with the system, that one is
 * downloaded from the docs. Change one, change both.
 *
 * No imports, so anything may read it (gear.js, utils.js, the sheet, and the
 * check from node).
 */

/** The light sources, by their stored English names: bright and dim radius in
 *  feet; `darkness` for the one that sheds darkness (Torch's `negative`). */
export const LIGHT_SOURCES = {
  "Torch": { bright: 20, dim: 40 },
  "Lantern": { bright: 20, dim: 40 },
  "Candle": { bright: 5, dim: 10 },
  "Candle Helmet": { bright: 5, dim: 10 },
  "Torch Fungus": { bright: 10, dim: 20 },
  "Wisp Lantern": { bright: 0, dim: 15 },
  "Glowsnail": { bright: 0, dim: 10 },
  "Sun Stick": { bright: 20, dim: 40 },
  "Lightsucker Candle": { bright: 10, dim: 20, darkness: true },
};

/** Other names for the same sources: the plural a background grant can carry,
 *  and the Spanish content names a Warden may type by hand. */
export const LIGHT_ALIASES = {
  "Torches": "Torch",
  "Candles": "Candle",
  "Antorcha": "Torch",
  "Linterna": "Lantern",
  "Vela": "Candle",
  "Yelmo con vela": "Candle Helmet",
  "Seta antorcha": "Torch Fungus",
  "Mecha de luz tenue": "Wisp Lantern",
  "Caracol brillante": "Glowsnail",
  "Vara solar": "Sun Stick",
  "Vela atrapaluz": "Lightsucker Candle",
};

const BY_NAME = new Map([
  ...Object.entries(LIGHT_SOURCES).map(([k, v]) => [k.toLowerCase(), v]),
  ...Object.entries(LIGHT_ALIASES).map(([k, v]) => [k.toLowerCase(), LIGHT_SOURCES[v]]),
]);

/**
 * A name's light source, ignoring case (as Torch matches), or null.
 * @param {String} name
 * @returns {{bright: Number, dim: Number, darkness?: Boolean}|null}
 */
export const lightSource = (name) => BY_NAME.get(String(name ?? "").trim().toLowerCase()) ?? null;

const KEY_BY_NAME = new Map([
  ...Object.keys(LIGHT_SOURCES).map((k) => [k.toLowerCase(), k]),
  ...Object.entries(LIGHT_ALIASES).map(([k, v]) => [k.toLowerCase(), v]),
]);

/**
 * A name's source by its table key ("Lantern" for "lantern" or "Linterna"),
 * or null. The Lantern's fuel rule (gear.js) asks this, so the Wisp Lantern
 * and other background lanterns are never taken for THE Lantern.
 * @param {String} name
 * @returns {String|null}
 */
export const lightSourceKey = (name) => KEY_BY_NAME.get(String(name ?? "").trim().toLowerCase()) ?? null;

/**
 * How much light a source casts, as the sheet writes it under the badge and
 * in the picker: "Bright 20 ft, dim 40 ft", "Dim 15 ft" for a dim-only light,
 * "Sheds darkness 10 / 20 ft" for the Lightsucker Candle, "" for a light with
 * no numbers (the Wraith Lantern, the Candle of Ward).
 * @param {String} name
 * @returns {String}
 */
export const lightRadiusText = (name) => {
  const s = lightSource(name);
  if (!s) return "";
  if (s.darkness) return game.i18n.format("CAIRN.LightRadiusDarkness", { bright: s.bright, dim: s.dim });
  if (!(s.bright > 0)) return game.i18n.format("CAIRN.LightRadiusDim", { dim: s.dim });
  return game.i18n.format("CAIRN.LightRadius", { bright: s.bright, dim: s.dim });
};

/** The badge's icons: game-icons.net art the system already ships and credits
 *  (art/game-icons/CREDITS.md). Package-relative paths: the sheet passes them
 *  through `foundry.utils.getRoute` before they reach a url() in CSS. */
const ICON_DIR = "systems/air-bladder/art/game-icons/fire";
export const LIGHT_ICON_NEUTRAL = `${ICON_DIR}/lantern-flame.svg`;

/**
 * The badge's icon for a light (user pick 2026-11-20, "match the held
 * light"): a candle for candles, a torch for torches, the Torch Fungus and
 * the Sun Stick, a lantern for lanterns, lamps, the Glowsnail and anything
 * else.
 * @param {String} name
 * @returns {String}
 */
export const lightIcon = (name) => {
  const n = String(name ?? "");
  if (/candle/i.test(n)) return `${ICON_DIR}/candle-flame.svg`;
  if (/torch|sun stick/i.test(n)) return `${ICON_DIR}/torch.svg`;
  return LIGHT_ICON_NEUTRAL;
};

/** The book badge's icons (2026-11-21, user ask: a badge showing the equipped
 *  spellbook, Grimoire or scroll): game-icons art the system ships and
 *  credits. The neutral spell book doubles as the "No Spellbook" icon. */
const BOOK_DIR = "systems/air-bladder/art/game-icons/book";
export const BOOK_ICON_NEUTRAL = `${BOOK_DIR}/spell-book.svg`;

/**
 * Which kind of book an item is, for the badge's label and icon:
 * "grimoire", "scroll" or "book".
 * @param {Item} item
 * @returns {"grimoire"|"scroll"|"book"}
 */
export const bookKind = (item) => (item?.type === "item" && item.system?.grimoire ? "grimoire"
  : item?.system?.scroll ? "scroll" : "book");

/** The badge's icon for a book's kind. */
export const bookIcon = (item) => ({
  grimoire: `${BOOK_DIR}/book-aura.svg`,
  scroll: `${BOOK_DIR}/tied-scroll.svg`,
  book: BOOK_ICON_NEUTRAL,
})[bookKind(item)];

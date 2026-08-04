#!/usr/bin/env node
/**
 * Propose game-icons art for compendium ITEMS still on a default class icon.
 *
 *   node tools/import/item-art.mjs             # propose, write nothing
 *   node tools/import/item-art.mjs --apply     # write img into src/packs
 *   node tools/import/item-art.mjs --all       # reconsider every item, not just bare ones
 *   node tools/import/item-art.mjs --pack tools --pack weapons   # limit to some packs
 *
 * Sibling of ./monster-art.mjs and the same bargain: A FIRST PASS, NOT AN ORACLE.
 * 179 items across seven packs share six class icons between them — every weapon
 * is `weapons.svg`, every tool is `tools.svg` — so the compendium browser is a
 * wall of identical thumbnails. Assigning them by hand is hours; reviewing a
 * proposal in the world, where the art is actually visible, is minutes. Anything
 * it cannot match confidently is reported UNMATCHED and LEFT on its class icon: a
 * bad guess costs more to find and undo than a blank does to fill.
 *
 * Items already carrying gallery art were chosen by hand and are skipped, and
 * learned from, exactly as the monster pass does.
 *
 * WHY THIS IS NOT monster-art.mjs WITH A DIFFERENT DIRECTORY. Two inversions:
 *
 *   1. ENGLISH COMPOUNDS ARE HEAD-FINAL, and monster names are not. A monster is
 *      stored "Genus, Species" and the SPECIFIC half carries the picture, so that
 *      matcher searches most-specific-first. An item is a noun phrase whose LAST
 *      word is the thing: a Skull Whistle is a whistle, a Wraith Lantern is a
 *      lantern, Gate Chalk is chalk. Search the head noun first and the modifier
 *      last, or every reliquary relic becomes a picture of its adjective.
 *
 *   2. THE CATEGORY BIAS FLIPS. There a non-creature folder needed an exact hit;
 *      here a CREATURE folder does. Without it "Gate Chalk" lands on
 *      `body/chalk-outline-murder` — a real token match, a confident score, and a
 *      murder scene on a piece of chalk.
 *
 * A third difference is smaller but bites: item names carry PARENTHETICAL
 * EXAMPLES ("Bathing Goods (Soap, Perfume, etc.)"). Those are the best hint in
 * the name — the head noun "goods" pictures nothing — so they are searched, but
 * after the phrase itself, since they are instances rather than the thing.
 *
 * HOW MUCH OF THIS IS THE ALGORITHM, HONESTLY. Run `--search-only` and the
 * matcher answers 83 of the 179 alone, of which roughly half are right: it is
 * good at a name that IS a thing ("Torch", "Manacles", "Lockpicks") and bad at
 * everything else, because a 27-category general icon set does not contain a
 * gambeson and will happily offer `shields/air-force` for an Air Bladder. So the
 * OVERRIDES table carries most of the load here, and that is the nature of the
 * corpus rather than a defect in the search.
 *
 * It is worth saying because the first cut hid it. The table had grown to cover
 * all 179 names, every proposal read "override", and the search had become
 * unfalsifiable — code that could have been deleted with no visible effect. The
 * 42 entries that merely restated what the search already found are gone, and
 * removing them changed not one proposal. What is left is 120 judgements a
 * person can argue with, which is the only thing a table like this should hold.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKS_DIR = path.join(ROOT, "src", "packs");
const MANIFEST = path.join(ROOT, "module", "game-icons-manifest.json");
const GALLERY = "systems/air-bladder/art/game-icons";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
/**
 * Diagnostic: ignore the OVERRIDES table and let the search answer alone.
 *
 * Without this there is no way to tell a search that works from one that is
 * merely never consulted — and after the first pass the table covered every one
 * of the 179 names, which made every proposal read "override" and the algorithm
 * unfalsifiable. Run it to see what the matcher would say on its own, which is
 * also what it WILL say for any item added to these packs later.
 */
const SEARCH_ONLY = process.argv.includes("--search-only");

/** The seven Item packs whose art is a per-item decision. */
const DEFAULT_PACKS = ["armor", "expeditionary-gear", "market-goods", "reliquary",
  "tools", "trinkets", "weapons"];

const flagged = process.argv.reduce((acc, a, i) => (
  a === "--pack" && process.argv[i + 1] ? [...acc, process.argv[i + 1]] : acc), []);
const PACKS = flagged.length ? flagged : DEFAULT_PACKS;

/**
 * Folders that picture an OBJECT outrank folders that picture a creature — the
 * mirror of monster-art.mjs's list, and for the mirror reason.
 */
const CATEGORY_RANK = ["tools", "weapons", "blade", "armor", "shields", "clothing",
  "bottles", "book", "metal", "stone", "spike", "fire", "celtic", "greek-roman",
  "creatures", "animals", "mammals", "reptiles", "birds", "insects", "fish",
  "heads", "skull", "body", "horn", "wings", "eye", "mouth"];

/** Folders that picture a creature. For an ITEM these need an exact slug hit. */
const CREATURE_CATS = new Set(["creatures", "animals", "mammals", "reptiles", "birds",
  "insects", "fish", "heads", "skull", "body", "horn", "wings", "eye", "mouth"]);

/**
 * Glyphs this project will not put on an item, with the reason. Same contract as
 * the monster table: a rejected glyph is also a REASON TO RE-PROPOSE anything
 * already wearing it, because a ruling has to reach what already shipped.
 */
const REJECTED = new Map([
  ["body/chalk-outline-murder", "a murder scene is not a stick of chalk"],
  ["spike/grease-trap", "a trap, not a pot of grease — the token match is the whole of the resemblance"],
  ["animals/dog-bowl", "a pet bowl reads wrong as an adventurer's bowl"],
  ["animals/food-chain", "an ecology diagram, not ten feet of chain"],
  ["armor/chest-armor", "a breastplate, not a treasure chest — the head-noun rule finds it and it is wrong"],
  ["creatures/mimic-chest", "a mimic is a monster; a chest is furniture"],
  ["mouth/mimic-chest", "a mimic is a monster; a chest is furniture"],
]);

/**
 * Items whose CLASS ICON is better than anything in the gallery, with the reason.
 *
 * This exists because "propose nothing" and "propose the least-bad glyph" are
 * different answers and only one of them is honest. The gallery is a general icon
 * set of 27 curated categories, not a quartermaster's catalogue: it has no
 * mirror, no hourglass, no caltrops. Left to the search these land on a token
 * match that is confident and wrong, and a wrong glyph costs more to find and
 * undo than a blank does to fill — the same bargain monster-art.mjs strikes with
 * its UNMATCHED list.
 *
 * Three of them (Chest, Sack, and the Containers group) are here for the opposite
 * reason: `icons/` ALREADY holds a hand-made glyph for exactly that thing, and
 * `item-icons.mjs` has already put it there. Replacing a right answer with a
 * near-miss from the gallery is a regression, not a proposal.
 */
const NO_GLYPH = new Map(Object.entries({
  "chest": "icons/chest.svg is already a treasure chest; the gallery has only a breastplate and a mimic",
  "sack": "icons/sack.svg is already a sack",
  "containers (sack, waterskin, etc)": "icons/sack.svg is already a sack",
  "mirror": "no mirror in any of the 28 categories",
  "hourglass": "no hourglass",
  "chalk": "no chalk; the nearest token match is a murder outline, which is REJECTED above",
  "caltrops": "no caltrops; the spike/ folder is all armour and terrain",
  "flour": "no flour, grain or sack-of-goods glyph",
  "smoking pipe": "no pipe — metal/lead-pipe is plumbing",
  "smoking herbs": "no pipe and no loose herb",
  "lock & key": "no padlock or key",
  "bowl": "no bowl that is not a pet's or a brazier",
  "signal flag": "the only flags are pirate flags, which say the opposite thing",
  "dowsing rod": "no forked rod; every 'rod' in the gallery is a wand",
  "sponge army": "no sponge and no coral",
  "muffle dust": "no powder, dust or cloud",
  "goggles": "eye/spectacles is eyewear but reads as reading glasses, not goggles",
}));

/**
 * Words that qualify an item without being the picture of it. Same job as the
 * monster table's colours and elements: left in, they win whenever the head noun
 * has no glyph, and the result is confident and wrong.
 */
const MODIFIERS = new Set(["common", "simple", "complex", "specialized", "specialised",
  "thieving", "costume", "outdoor", "wilderness", "expeditionary", "sealable", "signal",
  "small", "large", "great", "greater", "lesser", "long", "short", "heavy", "light",
  "iron", "steel", "wooden", "wood", "leather", "golden", "silver", "brass", "stone",
  "metal", "hand", "war", "boiled", "plain", "goods", "gear", "kit", "set", "etc",
  "the", "and", "with", "for", "his", "her", "its", "10ft", "50ft", "20ft"]);

/**
 * Where the name alone cannot get there: a word the gallery spells differently, a
 * thing it files under something else, or an item whose literal match is absurd.
 * Every entry is a judgement someone can argue with — and one click to overrule.
 */
const OVERRIDES = new Map(Object.entries({
  // --- Armor. No gambeson, brigandine or plate in the gallery, so these name the
  // nearest honest reading of the same piece of kit.
  "chainmail": "armor/chain-mail",
  "brigandine": "armor/lamellar",
  "gambeson": "armor/layered-armor",
  "plate mail": "armor/breastplate",
  "boiled leather": "armor/leather-armor",
  "leather jerkin": "armor/leather-vest",
  "shield": "shields/round-shield",

  // --- Weapons. `blade/` holds the swords, `weapons/` the hafted and missile
  // arms. No halberd, rapier or cudgel of its own, so each is named by its shape.
  "sword": "blade/ancient-sword",
  "long sword": "blade/broadsword",
  "short sword": "blade/gladius",
  "rapier": "blade/pointy-sword",
  "dagger": "blade/plain-dagger",
  "halberd": "blade/glaive",
  "cudgel": "weapons/wood-club",
  "war hammer": "weapons/warhammer",
  "mace": "weapons/flanged-mace",
  "bow": "weapons/high-shot",
  "staff": "weapons/wizard-staff",
  "spiked boots": "armor/steeltoe-boots",

  // --- Tools and gear the gallery spells differently, or files under a creature
  // folder where the exact-hit rule would otherwise refuse it.
  "hawk": "birds/hawk-emblem",
  "cage": "birds/bird-cage",
  "net": "insects/bug-net",
  "leech": "animals/worms",
  "hand-drill": "tools/drill",
  "fishing rod": "tools/fishhook-fork",
  "metal file": "tools/hand-saw",
  "whetstone": "stone/stone-block",
  "candle": "fire/candle-holder",
  "incense": "fire/candle-light",
  "fire oil": "fire/molotov",
  "flash powder": "fire/blast",
  "glue": "bottles/oil-can",
  "grease": "bottles/oil-can",
  "alcohol": "bottles/beer-bottle",
  "sealable bottle": "bottles/round-bottom-flask",
  "antitoxin": "bottles/round-potion",
  "sedative": "bottles/standing-potion",
  "repellent": "bottles/potion-ball",
  "wolfsbane": "celtic/fluffy-trefoil",
  "air bladder": "bottles/bubbling-flask",
  "garrotte": "tools/knot",
  "chain, 10ft": "metal/crossed-chains",
  "pole, 10ft": "weapons/bo",
  "grappling hook": "tools/grapple",
  "pulley": "tools/hook",
  "bolt cutters": "tools/bolt-cutter",
  "saw": "tools/crosscut-saw",
  "hammer": "tools/claw-hammer",
  "pliers": "tools/pincers",
  "tongs": "tools/pincers",
  "pickaxe": "tools/mining",
  "shovel": "tools/spade",
  "pail": "metal/empty-metal-bucket",
  "cart": "tools/wheelbarrow",
  "robes": "clothing/robe",
  "gloves": "clothing/gloves",
  "hammock": "body/sleeping-bag",
  "tent": "body/sleeping-bag",
  "oilskin bag": "clothing/shoulder-bag",
  "sewing kit": "clothing/sewing-needle",
  "bandages": "body/knee-bandage",
  "rations": "tools/knife-fork",
  "perfume": "bottles/perfume-bottle",
  "mask": "heads/bird-mask",
  "card deck": "shields/dice-shield",
  "cards": "shields/dice-shield",
  "lens": "eye/magnifying-glass",
  "compass": "tools/sextant",
  "lodestone": "stone/rock",
  "whistle": "mouth/shouting",
  "stylus": "book/quill-ink",
  "songbook": "book/book-cover-delapouite",
  "parchment & ink": "book/scroll-quill",
  "parchment": "book/scroll-unfurled",
  "simple instruments (pipes, lute, etc)": "celtic/harp",

  // --- Market Goods are CATEGORIES of goods, so the head noun ("goods", "gear")
  // pictures nothing and the parenthetical examples carry the meaning. Named
  // here rather than left to the example search, because WHICH example stands
  // for the group is a judgement rather than a lookup.
  "common agents (glue, grease, etc)": "bottles/oil-can",
  "common tools (hammer, shovel, etc)": "tools/toolbox",
  "costume gear (face paint, disguise)": "body/duality",
  "expeditionary gear (climbing spikes, pulley, etc)": "tools/grapple",
  "outdoor comfort (blanket, hammock, etc)": "body/sleeping-bag",
  "repellent (wolfsbane, mugwort, etc)": "celtic/fluffy-trefoil",
  "thieving tools (lockpick, metal file, etc)": "tools/lockpicks",
  "wilderness clothes (poncho, cloak, etc)": "clothing/poncho",
  "animal feed": "tools/pitchfork",

  // --- Reliquary. Invented names, so the head noun does all the work and the
  // modifier is usually the interesting half. Where the head noun pictures
  // nothing the relic is named outright rather than guessed at.
  "assassin's goblets": "bottles/round-potion",
  "babbleflask": "bottles/potion-ball",
  "barbed epaulets": "spike/spiked-shoulder-armor",
  "betterwand": "weapons/crystal-wand",
  "bloodmap": "book/treasure-map",
  "coin of the father": "metal/coins",
  "dryad's tear": "eye/tear-tracks",
  "empathy rod": "weapons/orb-wand",
  "eyestone": "eye/eyeball",
  "spystone": "eye/third-eye",
  "falconstone": "birds/hawk-emblem",
  "footpad's friend": "tools/lockpicks",
  "gate chalk": "stone/dolmen",
  "golden wheat paste": "bottles/jug",
  "gossip box": "book/wax-seal",
  "honest earworm": "animals/worms",
  "jar of ants": "insects/ant",
  "last breath": "mouth/energy-breath",
  "lightsucker candle": "fire/candle-light",
  "lover's covenant": "body/heart-organ",
  "mace of the kingslayer": "weapons/flanged-mace",
  "moth mirror": "insects/butterfly",
  "nightstone": "stone/menhir",
  "parliament's promise": "book/scroll-quill",
  "phoenix ash": "birds/feather",
  "ring of the snake": "skull/skull-ring",
  "skull whistle": "mouth/screaming",
  "soul clump": "creatures/transparent-slime",
  "stone eater": "stone/stone-crafting",
  "stonewax gum": "stone/dripping-stone",
  "veilsilk grip": "clothing/gloves",
  "voice of the mountain": "mouth/shouting",
  "ward stone": "stone/star-altar",
  "whispergale": "spike/tornado-discs",
  "whistle-rope": "tools/knot",
  "wraith lantern": "body/paper-lantern",
}));

/* -------------------------------------------------------------------------- */

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
/** [{path:"tools/anvil", slug:"anvil", cat:"tools", rank}] */
const GLYPHS = manifest.categories.flatMap(({ key, names }) =>
  names.map((n) => {
    const slug = n.replace(/\.svg$/, "");
    return { path: `${key}/${slug}`, slug, cat: key, rank: CATEGORY_RANK.indexOf(key) };
  }));

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9 ,&'()-]/g, "").trim();

/**
 * Keywords for an item name, HEAD NOUN FIRST.
 *
 * "Skull Whistle" -> whistle, skull-whistle, skull. Not the other way round: the
 * modifier is what makes the relic interesting and the head noun is what makes
 * it a picture, and only one of those is drawable.
 */
const keywordsFor = (name) => {
  const n = norm(name);
  // "Bathing Goods (Soap, Perfume, etc.)" -> phrase "bathing goods", examples
  // ["soap", "perfume"]. The examples are instances, so they come after.
  const paren = /\(([^)]*)\)/.exec(n);
  const examples = paren
    ? paren[1].split(",").map((s) => s.trim()).filter((s) => s && s !== "etc." && s !== "etc")
    : [];
  const phrase = n.replace(/\([^)]*\)/g, " ").replace(/,.*$/, " ").trim();
  const words = phrase.replace(/[^a-z0-9 -]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const significant = words.filter((w) => !MODIFIERS.has(w));

  const out = [];
  const push = (k) => { if (k && k.length > 2 && !MODIFIERS.has(k)) out.push(k); };

  // 1. The head noun — the last significant word — then the phrase entire.
  push(significant.at(-1));
  push(phrase.replace(/\s+/g, "-"));
  // 2. Remaining significant words, RIGHT TO LEFT: closer to the head is closer
  //    to the thing ("golden wheat paste" is paste, then wheat, then golden).
  for (const w of [...significant].reverse()) push(w);
  // 3. Parenthetical examples last, most specific first.
  for (const e of examples) { push(e.replace(/\s+/g, "-")); push(e.split(/\s+/).at(-1)); }
  return [...new Set(out)];
};

const scoreGlyph = (g, kw) => {
  const s = g.slug;
  const tokens = s.split("-");
  if (s === kw) return 100;
  if (tokens.at(-1) === kw) return 84;   // "wood-axe" IS an axe — head-final again
  if (tokens[0] === kw) return 72;
  if (tokens.includes(kw)) return 62;
  if (s.startsWith(kw)) return 48;
  return 0;
};

/**
 * What a human already chose, keyed by the words of the items wearing it. Learned
 * from the HEAD NOUN and the whole name only — never from every word, which is
 * the mistake that taught the monster matcher "tiger" meant `earwig`.
 */
const LEARNED = new Map();
const learn = (name, glyphPath) => {
  const keys = keywordsFor(name).slice(0, 2);
  for (const kw of keys) if (!LEARNED.has(kw)) LEARNED.set(kw, glyphPath);
};

const bestFor = (name) => {
  // Ruled to have no honest glyph. Checked BEFORE the override table and before
  // the search, so an entry here is a decision that nothing later can undo by
  // scoring well — which is the whole point of writing the reason down.
  const ruled = NO_GLYPH.get(norm(name));
  if (ruled) return { ruled };

  const direct = SEARCH_ONLY ? null : OVERRIDES.get(norm(name));
  if (direct && GLYPHS.some((g) => g.path === direct)) return { path: direct, why: "override", score: 100 };

  const keys = keywordsFor(name);
  for (const kw of keys) {
    const seen = LEARNED.get(kw);
    if (seen && !REJECTED.has(seen)) return { path: seen, why: `matches your "${kw}"`, score: 100 };
  }

  for (const [i, kw] of keys.entries()) {
    let best = null;
    for (const g of GLYPHS) {
      if (REJECTED.has(g.path)) continue;
      const base = scoreGlyph(g, kw);
      if (!base) continue;
      // An item is an object: a CREATURE folder needs an exact slug hit to be
      // considered. This is the inversion described at the top of the file, and
      // it is what stops "Gate Chalk" becoming a chalk murder outline.
      if (CREATURE_CATS.has(g.cat) && base < 100) continue;
      const total = base - i * 4 - (g.rank < 0 ? 30 : g.rank) * 0.4;
      if (!best || total > best.total) best = { ...g, total, kw, base };
    }
    if (best && best.base >= 62) return { path: best.path, why: `"${best.kw}"`, score: Math.round(best.total) };
  }
  return null;
};

/* -------------------------------------------------------------------------- */

// An override naming a glyph that is not in the gallery fails SILENTLY and falls
// through to a search, so a typo here looks exactly like a poor match. Say so.
const badOverrides = [...OVERRIDES.entries()].filter(([, p]) => !GLYPHS.some((g) => g.path === p));
if (badOverrides.length) {
  console.log(`OVERRIDES naming glyphs that do not exist (${badOverrides.length}, ignored — fix or remove):`);
  for (const [k, v] of badOverrides) console.log(`  ${k.padEnd(40)} -> ${v}`);
  console.log("");
}

const docs = [];
for (const pack of PACKS) {
  const dir = path.join(PACKS_DIR, pack);
  if (!fs.existsSync(dir)) { console.error(`no such pack: src/packs/${pack}`); process.exit(1); }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".yml")).sort()) {
    const p = path.join(dir, f);
    const text = fs.readFileSync(p, "utf8");
    const name = /^name: (.+)$/m.exec(text)?.[1]?.replace(/^['"]|['"]$/g, "").replace(/''/g, "'") ?? f;
    const img = /^img: (.+)$/m.exec(text)?.[1]?.replace(/^['"]|['"]$/g, "") ?? "";
    const current = img.startsWith(`${GALLERY}/`) ? img.slice(GALLERY.length + 1).replace(/\.svg$/, "") : null;
    docs.push({ pack, file: f, path: p, name, current, text });
  }
}

// Learn from the hand-picked set FIRST, so every proposal can defer to it.
for (const d of docs) if (d.current && !REJECTED.has(d.current)) learn(d.name, d.current);

const rows = [];
for (const d of docs) {
  const rejected = d.current && REJECTED.has(d.current);
  if (d.current && !rejected && !ALL) continue;                 // hand-picked: leave it alone
  rows.push({ ...d, rejected, pick: bestFor(d.name) });
}

const matched = rows.filter((r) => r.pick && r.pick.path);
const ruled = rows.filter((r) => r.pick && r.pick.ruled);
const unmatched = rows.filter((r) => !r.pick);

console.log(`${docs.length} item(s) in ${PACKS.length} pack(s) — ${rows.length} considered, `
  + `${matched.length} proposed, ${ruled.length} ruled to have no glyph, ${unmatched.length} unmatched\n`);
for (const pack of PACKS) {
  const mine = matched.filter((r) => r.pack === pack);
  if (!mine.length) continue;
  console.log(`  ${pack}`);
  for (const r of mine) {
    const flag = r.rejected ? " [replacing a rejected glyph]" : "";
    console.log(`    ${r.name.padEnd(46)} ${r.pick.path.padEnd(32)} ${r.pick.why}${flag}`);
  }
}
// Two different findings, reported separately on purpose. A RULED row is a
// decision with a reason behind it; an UNMATCHED row is the matcher admitting it
// has nothing. Collapsing them would hide which of the two a name is in, and
// only one of them is worth anybody's time to revisit.
if (ruled.length) {
  console.log(`\nNO HONEST GLYPH — ruled, left on the class icon:`);
  for (const r of ruled) console.log(`  ${r.name.padEnd(46)} ${r.pick.ruled}`);
}
if (unmatched.length) {
  console.log(`\nUNMATCHED — nothing scored, left on the class icon, pick these by hand:`);
  for (const r of unmatched) console.log(`  ${r.pack.padEnd(20)} ${r.name}`);
}

if (!APPLY) {
  console.log(`\n(nothing written — re-run with --apply)`);
  process.exit(0);
}

// Surgical rewrite of the single column-0 `img:` line, the way item-icons.mjs
// does: never a YAML round trip, which would reformat every document it touched.
// Items have no prototype token, so unlike the monster pass there is one line.
let written = 0;
for (const r of matched) {
  const src = `${GALLERY}/${r.pick.path}.svg`;
  const out = r.text.replace(/^img: .*$/m, `img: ${src}`);
  if (out !== r.text) { fs.writeFileSync(r.path, out); written++; }
}
console.log(`\nwrote art onto ${written} item(s). Review with: git diff src/packs`);
console.log("Then mirror it into the tables that reference them:");
console.log("  node tools/import/table-icons.mjs");
console.log("A RollTable result stores its img as a SNAPSHOT, not a live read.");

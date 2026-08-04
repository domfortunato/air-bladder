#!/usr/bin/env node
/**
 * Propose game-icons art for monsters that are still on the default class icon.
 *
 *   node tools/import/monster-art.mjs            # propose, write nothing
 *   node tools/import/monster-art.mjs --apply    # write img + token art into src/packs
 *   node tools/import/monster-art.mjs --all      # reconsider every monster, not just bare ones
 *
 * A FIRST PASS, NOT AN ORACLE. It exists because assigning 163 monsters by hand
 * through the picker is hours of work, and a decent proposal turns that into
 * review-and-override — which is minutes, and can be done in the world where the
 * art is actually visible. Anything it cannot match confidently is reported as
 * UNMATCHED and left on its class icon rather than given something wrong: a bad
 * guess costs more to find and undo than a blank does to fill.
 *
 * The 42 monsters already carrying gallery art are skipped by default, because
 * those were chosen by hand and a machine should not overrule them.
 *
 * MATCHING. Monster names are stored "Genus, Species" ("Cat, Lion", "Dragon,
 * Blue"), and the SPECIFIC half carries the picture — a Lion is a lion before it
 * is a cat. So the comma-parts are searched most-specific-first, then the whole
 * name, then individual words. A glyph slug scores on how squarely it answers
 * the keyword: an exact slug beats "<keyword>-head", which beats a prefix, which
 * beats containing the word at all. Category order breaks ties toward the
 * folders that hold creatures rather than the ones that hold tools.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MONSTERS = path.join(ROOT, "src", "packs", "monsters");
const MANIFEST = path.join(ROOT, "module", "game-icons-manifest.json");
const GALLERY = "systems/air-bladder/art/game-icons";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");

/** Folders that hold creatures outrank folders that hold objects. */
const CATEGORY_RANK = ["creatures", "animals", "mammals", "reptiles", "birds", "insects",
  "fish", "heads", "skull", "body", "horn", "wings", "eye", "mouth", "celtic", "greek-roman",
  "stone", "metal", "blade", "weapons", "armor", "shields", "clothing", "book", "bottles",
  "spike", "tools"];

/**
 * Glyphs this project will not use, with the reason. A rejected glyph is also a
 * REASON TO RE-PROPOSE a monster already wearing it — the point of recording the
 * ruling is that it applies to what already shipped, not only to what is next.
 */
const REJECTED = new Map([
  ["animals/labrador-head", "ruled out for dogs — a pet-breed head reads wrong on a war dog or a wild one"],
  ["mammals/labrador-head", "ruled out for dogs — a pet-breed head reads wrong on a war dog or a wild one"],
  ["heads/labrador-head", "ruled out for dogs — a pet-breed head reads wrong on a war dog or a wild one"],
]);

/**
 * Where the algorithm cannot get there from the name alone: a word the gallery
 * spells differently, or a creature whose literal match is an object. Kept small
 * and explicit — every entry is a judgement someone can argue with.
 */
const OVERRIDES = new Map(Object.entries({
  "dog": "animals/hound",                    // the ruling above; `hound` is the working-dog glyph
  "blink dog": "animals/hound",
  "cobblehounds": "animals/hound",
  "deep ones": "creatures/fish-monster",
  "eye of terror": "eye/eyestalk",
  "gelatinous cube": "creatures/transparent-slime",
  "flail snail": "animals/spiked-snail",
  "giant catfish": "fish/angler-fish",
  "giant electric eel": "fish/eel",
  "giant pike": "fish/double-fish",
  "giant piranha": "fish/piranha",
  "giant rockfish": "fish/fish-scales",
  "giant sturgeon": "fish/double-fish",
  "giant swordfish": "fish/double-fish",
  "frost elf": "heads/woman-elf-face",
  "demon knight": "armor/black-knight-helm",
  "gargoyle": "creatures/gargoyle",
  "cat, panther": "animals/tiger",
  "cat, sabre-toothed tiger": "mammals/saber-toothed-cat-head",
  "cat, tiger": "animals/tiger-head",
  "cat, lion": "animals/lion",
  // The gallery has no "elemental" and no flame/wave/mud glyph, so these are
  // named rather than guessed — the alternative was `water-bottle` for the water
  // elemental, which is what an unguided search actually returned.
  "elemental, fire": "creatures/spark-spirit",
  "elemental, air": "spike/tornado-discs",
  "elemental, earth": "creatures/rock-golem",
  "elemental, water": "body/psychic-waves",

  // The gallery is a general icon set, not a bestiary, so most of the OSR
  // roster has no glyph of its own. These are the nearest honest reading —
  // each one a judgement, and each one easier to overrule in the picker than
  // to find from a blank.
  "griffon": "creatures/griffin-symbol",
  "hippogriff": "creatures/griffin-symbol",
  "mind lasher": "creatures/brain-tentacle",
  "merman": "creatures/mermaid",
  "locathah": "creatures/fish-monster",
  "sahuagin": "creatures/fish-monster",
  "mantid": "insects/praying-mantis",
  "mastodon": "mammals/mammoth",
  "pteranodon": "reptiles/pterodactylus",
  "pixie": "creatures/fairy-lorc",
  "treant": "creatures/evil-tree",
  "shadow": "body/shadow-follower",
  "ghoul": "creatures/shambling-zombie",
  "ghast": "creatures/shambling-zombie",
  "hag, black": "creatures/witch-flight",
  "hag, sea": "creatures/witch-flight",
  "lich": "skull/haunting",
  "hobgoblin": "creatures/goblin-head",
  "kobold": "creatures/goblin",
  "svirneblin": "celtic/bad-gnome",
  "gnome": "celtic/bad-gnome",
  "gnoll": "creatures/goblin-head",
  "bugbear": "animals/bear-face",
  "werebear": "animals/bear-face",
  "wereboar": "mammals/boar",
  "wererat": "animals/rat",
  "weretiger": "animals/tiger-head",
  "hellhound": "animals/hound",
  "nightmare": "animals/horse-head-lorc",
  "roc, giant": "birds/condor-emblem",
  "phoenix": "birds/eagle-head",
  "halfling": "heads/dwarf-face",
  "drow": "heads/woman-elf-face",
  "red cap": "heads/dwarf-face",
  "remorhaz": "animals/worm-mouth",
  "cave locust": "insects/praying-mantis",
  "weasel, giant": "animals/rat",
  "hippopotamus": "mammals/mammoth",
  // "Giant, X" is six monsters and one picture — the gallery has a giant, and
  // the element half is a modifier by the rule above, so name it once.
  "giant, cloud": "creatures/giant",
  "giant, fire": "creatures/giant",
  "giant, frost": "creatures/giant",
  "giant, hill": "creatures/giant",
  "giant, stone": "creatures/giant",
  "giant, storm": "creatures/giant",
  "ettin": "creatures/giant",
  "titan": "body/giant",
  "yeti": "creatures/troll",
  "satyr": "animals/goat",
  "catoplebas": "animals/goat",
  "chimera": "creatures/horned-reptile",
  "cockatrice": "creatures/horned-reptile",
  "couatl": "animals/sea-serpent",
  "lamia": "animals/snake",
  "manticore": "creatures/horned-skull",
  "rakshasa": "creatures/devil-mask",
  "tarrasque": "creatures/horned-reptile",
  "pseudo-dragon": "creatures/dragon-head-lorc",
}));

/* -------------------------------------------------------------------------- */

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
/** [{path:"animals/wolf-head", slug:"wolf-head", cat:"animals", rank}] */
const GLYPHS = manifest.categories.flatMap(({ key, names }) =>
  names.map((n) => {
    const slug = n.replace(/\.svg$/, "");
    return { path: `${key}/${slug}`, slug, cat: key, rank: CATEGORY_RANK.indexOf(key) };
  }));

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ,-]/g, "").trim();

/**
 * Words that qualify a monster without being the picture of it. A Blue Dragon
 * is a DRAGON; searching "blue" first found `white-book` for the white one,
 * `gold-scarab` for the gold one and `water-bottle` for the water elemental —
 * every one of them a confident, category-correct, completely wrong answer.
 * Colours, metals, sizes and elements go to the BACK of the keyword queue so the
 * genus wins, which also gets all six chromatic dragons the same head, exactly
 * as the four hand-picked bears already share one.
 */
const MODIFIERS = new Set(["blue", "brass", "bronze", "copper", "gold", "green", "red",
  "silver", "white", "black", "grey", "gray", "cloud", "fire", "frost", "ice", "hill",
  "storm", "air", "earth", "water", "wind", "giant", "large", "small", "lesser", "greater",
  "war", "wild", "hunting", "leader", "elder", "young", "ancient", "dire", "cave", "deep",
  "amber", "bone", "clay", "iron", "steel", "wood", "sea", "swamp", "desert", "mountain",
  "stone", "flesh", "rock", "crystal", "shadow", "night", "sun", "moon"]);

/** Folders that can plausibly picture a creature. Anything else needs an exact hit. */
const CREATURE_CATS = new Set(["creatures", "animals", "mammals", "reptiles", "birds",
  "insects", "fish", "heads", "skull", "body", "horn", "wings", "eye", "mouth"]);

/** Keywords for a monster name, most specific first, modifiers demoted. */
const keywordsFor = (name) => {
  const n = norm(name);
  const commaParts = n.split(",").map((s) => s.trim()).filter(Boolean);
  const genus = commaParts[0] ?? n;
  const species = commaParts.slice(1).reverse();
  const words = n.replace(/,/g, " ").split(/\s+/).filter((w) => w.length > 2);

  const strong = [];
  const push = (k) => { if (k && !MODIFIERS.has(k)) strong.push(k); };

  for (const p of species) { push(p.replace(/\s+/g, "-")); push(p); }
  push(genus.replace(/\s+/g, "-"));
  push(genus);
  push(n.replace(/[, ]+/g, "-"));
  // Longest words first: "catfish" is a better key than "giant".
  for (const w of [...words].sort((a, b) => b.length - a.length)) push(w);
  // Modifiers are DROPPED, not merely demoted. Left in as a last resort they
  // still won whenever the genus had no glyph, which is how the fire elemental
  // became `fire-dash` and the earth one an `earth-worm`. No match at all is a
  // better answer than a confident wrong one: unmatched rows stay on the class
  // icon and get listed for a human.
  return [...new Set(strong)];
};

const scoreGlyph = (g, kw) => {
  const s = g.slug;
  const tokens = s.split("-");
  if (s === kw) return 100;
  if (s === `${kw}-head` || s === `${kw}-face`) return 92;
  if (tokens[0] === kw) return 76;
  if (tokens.includes(kw)) return 62;
  if (s.startsWith(kw)) return 48;
  return 0;
};

/**
 * What the Warden already chose, keyed by the words of the monsters wearing it.
 * The 42 hand-picked monsters are the best available statement of house taste —
 * Dragon, Black is on `creatures/dragon-head-lorc`, so every other dragon should
 * be, and a fresh search would have sent them to `skull/dragon-head` instead on
 * a one-point scoring difference. Consistency with a human choice beats a
 * marginally better string match.
 *
 * Learned from the GENUS and the whole name only — never from every word. The
 * first cut learned each word, so "Beetle, Tiger" taught it that "tiger" means
 * `animals/earwig`, and Cat, Tiger duly became an earwig. A species word is
 * meaningful *within* its genus and misleading outside it.
 */
const LEARNED = new Map();
const learn = (name, glyphPath) => {
  const n = norm(name);
  const genus = n.split(",")[0].trim();
  for (const kw of [n.replace(/[, ]+/g, "-"), genus, genus.replace(/\s+/g, "-")]) {
    if (!kw || MODIFIERS.has(kw) || LEARNED.has(kw)) continue;
    LEARNED.set(kw, glyphPath);
  }
};

const bestFor = (name) => {
  const direct = OVERRIDES.get(norm(name)) ?? OVERRIDES.get(norm(name).split(",")[0].trim());
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
      // A monster is a creature: a non-creature folder needs an exact slug hit
      // to be considered at all, which is what stops `white-book` and
      // `water-bottle` winning on a colour.
      if (!CREATURE_CATS.has(g.cat) && base < 100) continue;
      const total = base - i * 3 - (g.rank < 0 ? 30 : g.rank) * 0.4;
      if (!best || total > best.total) best = { ...g, total, kw, base };
    }
    if (best && best.base >= 62) return { path: best.path, why: `"${best.kw}"`, score: Math.round(best.total) };
  }
  return null;
};

/* -------------------------------------------------------------------------- */

// An override naming a glyph that is not in the gallery would fail silently and
// fall through to a search — a typo in this file looking exactly like a poor
// match. Say so instead.
const badOverrides = [...OVERRIDES.entries()].filter(([, p]) => !GLYPHS.some((g) => g.path === p));
if (badOverrides.length) {
  console.log("OVERRIDES naming glyphs that do not exist (ignored — fix or remove):");
  for (const [k, v] of badOverrides) console.log(`  ${k.padEnd(24)} -> ${v}`);
  console.log("");
}

const files = fs.readdirSync(MONSTERS).filter((f) => f.endsWith(".yml")).sort();
const docs = files.map((f) => {
  const p = path.join(MONSTERS, f);
  const text = fs.readFileSync(p, "utf8");
  const name = /^name: (.+)$/m.exec(text)?.[1]?.replace(/^['"]|['"]$/g, "") ?? f;
  const img = /^img: (.+)$/m.exec(text)?.[1] ?? "";
  const current = img.startsWith(`${GALLERY}/`) ? img.slice(GALLERY.length + 1).replace(/\.svg$/, "") : null;
  return { file: f, path: p, name, current, text };
});

// Learn from the hand-picked set FIRST, so every proposal can defer to it.
for (const d of docs) {
  if (d.current && !REJECTED.has(d.current)) learn(d.name, d.current);
}

const rows = [];
for (const d of docs) {
  const rejected = d.current && REJECTED.has(d.current);
  if (d.current && !rejected && !ALL) continue;               // hand-picked: leave it alone
  rows.push({ ...d, rejected, pick: bestFor(d.name) });
}

const matched = rows.filter((r) => r.pick);
const unmatched = rows.filter((r) => !r.pick);

console.log(`${rows.length} monster(s) considered — ${matched.length} proposed, ${unmatched.length} unmatched\n`);
for (const r of matched) {
  const flag = r.rejected ? " [replacing a rejected glyph]" : "";
  console.log(`  ${r.name.padEnd(30)} ${r.pick.path.padEnd(34)} ${r.pick.why}${flag}`);
}
if (unmatched.length) {
  console.log(`\nUNMATCHED — left on the class icon, pick these by hand:`);
  for (const r of unmatched) console.log(`  ${r.name}`);
}

if (!APPLY) {
  console.log(`\n(nothing written — re-run with --apply)`);
  process.exit(0);
}

// Surgical rewrite of the two column-0 art lines, the way item-icons.mjs does:
// never a YAML round trip, which would reformat every document it touched.
let written = 0;
for (const r of matched) {
  const src = `${GALLERY}/${r.pick.path}.svg`;
  let out = r.text.replace(/^img: .*$/m, `img: ${src}`);
  out = out.replace(/^(\s+texture:\n\s+src: ).*$/m, `$1${src}`);
  if (out !== r.text) { fs.writeFileSync(r.path, out); written++; }
}
console.log(`\nwrote art onto ${written} monster(s). Review with: git diff src/packs/monsters`);
console.log("Then: npm run build:packs   (stop Foundry first)");

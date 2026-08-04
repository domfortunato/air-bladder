#!/usr/bin/env node
/**
 * Author the "Backgrounds for Cairn" set — the shipped CUSTOM background pack.
 *
 *   node tools/import/class-backgrounds.mjs [--dry]
 *
 * SOURCE. "Backgrounds for Cairn" by Gordon McCormick (text CC BY-SA 4.0; based
 * on Cairn by Yochai Gal and BECMI D&D by Frank Mentzer), supplied by the
 * project owner as a PDF on 2026-08-04. Unlike the other importers this one
 * cannot fetch its source at run time — there is no machine-readable upstream —
 * so the text is transcribed INLINE below and this file is the artifact of
 * record, the same standing game-icons.mjs has for its hand-curated download.
 * The PDF's ART (Perplexing Ruins, Jeff Koch) is NOT covered by the text
 * licence and nothing of it is used; items wear the same type icons the rest
 * of background-items wears.
 *
 * WHAT IT WRITES.
 *   - src/packs/backgrounds-custom/   7 `background` Items, system.source "2e"
 *     (they ride the 2e generation path — "custom" means NOT in the Player's
 *     Guide, and the CUSTOM content toggle is what admits the pack).
 *   - src/packs/background-items/     the set's one-off grant items. Anything
 *     the pool already has (Chainmail, Bow, Sedative, "Pole, 10ft"…) is
 *     REFERENCED, never re-authored — the gear-pool duplicate gate exists
 *     because two copies of one name is how grants start resolving at random.
 *   - src/packs/more-spellbooks/      ONE spellbook, "Shield" (BECMI; the only
 *     granted spell Cairn lacks). more-spellbooks is already the extended
 *     non-SRD set, and "Spellbook (X)" grants resolve against the spell packs,
 *     so it cannot live in the background pack.
 *
 * TRANSCRIPTION RULES, so a diff against the PDF is explainable:
 *   - Taglines, questions, option prose and the ten names are verbatim.
 *   - "3d6 Gold Pieces" gear lines are DROPPED — the 2e generator rolls gold;
 *     no shipped background lists it either.
 *   - The Dwarf's first table is headed "What is special about your Axe (d8)?"
 *     with the axe itself implied: rows 1–5 therefore grant Axe, and row 6
 *     ("it's not an axe") grants Warhammer instead. Same pattern as the
 *     Fletchwind, whose bow comes from its wood table.
 *   - The Halfling's "extra 3d6 Gold" stays PROSE — bonusGold is a fixed
 *     number and rolling it is the player's to do (house rule: no automation
 *     of mechanical text).
 *   - The Halfling's Faery Mark is a body marking, not inventory: prose only.
 *   - One typo corrected: "Crytal Prism" → "Crystal Prism" (Magic-User).
 *
 * IDs are derived from the document name via a tiny FNV-ish hash, so reruns
 * are byte-identical and never orphan a character's backgroundUuid.
 * Idempotent. Rebuild afterwards: npm run build:packs (stop Foundry first).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const YAML = require("js-yaml");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DRY = process.argv.includes("--dry");

/* ---------------------------------------------------------------- stable ids */
// 16 chars of [A-Za-z0-9], deterministic in the doc name + a per-run-constant
// salt so this set can never collide with a hand-rolled Foundry id by accident
// of shape alone (Foundry ids are random; ours are all prefixed "CB").
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const stableId = (name) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const ch of `class-backgrounds:${name}`) {
    h1 = Math.imul(h1 ^ ch.codePointAt(0), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + ch.codePointAt(0), 0x85ebca6b) >>> 0;
  }
  let out = "CB";
  for (let i = 0; i < 14; i++) {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 0xcc9e2d51) >>> 0;
    out += ID_ALPHABET[((h1 ^ h2 ^ i) >>> 0) % ID_ALPHABET.length];
  }
  return out;
};

/* -------------------------------------------------------------- item helpers */
// Shapes mirror the existing background-items YAMLs (Blunderbuss/Gambeson).
const baseSystem = () => ({
  cost: 0,
  description: "",
  weightless: false,
  equipped: false,
  bulky: false,
  uses: { value: 0, max: 0 },
  quantity: 1,
});

const item = (name, { desc = "", petty = false, bulky = false, uses = 0 } = {}) => ({
  name, type: "item",
  system: { ...baseSystem(), description: desc, weightless: petty, bulky,
    uses: { value: uses, max: uses } },
});
const weapon = (name, damage, { desc = "", bulky = false, petty = false } = {}) => ({
  name, type: "weapon",
  system: { ...baseSystem(), description: desc, weightless: petty, bulky,
    damageFormula: damage, criticalDamage: "", blast: false },
});
const armor = (name, value, { desc = "", bulky = false } = {}) => ({
  name, type: "armor",
  system: { ...baseSystem(), description: desc, bulky, armor: value },
});

/* ------------------------------------------------- the one-off grant items */
const NEW_ITEMS = [
  // Fighter
  item("Letters from Home", { petty: true }),
  item("Fancy Medal", { petty: true, desc: "Awarded for defending your homeland." }),
  item("Stolen Trinket", { petty: true, desc: "Taken in a distant land, from an unknown enemy." }),
  item("Fur Cloak of a Winterwolf", { desc: "Taken from a battle between wizards who delved into a frozen city." }),
  item("Elven Rope", { desc: "Can be retrieved from being anchored with a small tug." }),
  item("Vial of Paralyzing Poison", { uses: 1 }),
  armor("Hacked Shield", 1, { desc: "+1 Armor. Can be sundered to avoid damage from an attack." }),
  // Cleric
  item("Holy Symbol", { petty: true }),
  item("Astrolabe of Control Weather", { desc: "Channels the Celestial Realms and the Darkness Above to control the weather." }),
  item("Hazel Rod of Control Plants", { desc: "Channels the Wood Spirits to command nearby plants and trees." }),
  item("Pure Water Vial of Cone of Foam", { desc: "Channels the Deep Sea into a cone of churning foam." }),
  item("Ancient Dark Stone of Summon Idol", { desc: "Channels the Old Powers of the Earth to raise an idol from the ground." }),
  item("Talisman of Pacify", { desc: "Channels a Wise Philosophy to becalm those nearby." }),
  item("Candle of Ward", { desc: "Channels your Long Dead Ancestors to hold evil at bay while it burns." }),
  item("Iron Rod of Justice"),
  item("Scroll of Laws", { petty: true }),
  item("Beige Cloak"),
  item("Tin of Paint"),
  // Magic-User
  item("Bag of Powdered Iron and Silver", { petty: true }),
  item("Crystal Prism", { petty: true }),
  item("Glass Rod", { petty: true }),
  item("Piece of Fur", { petty: true }),
  item("Eyelash encased in gum arabic", { petty: true }),
  item("Bag of Rat Skulls"),
  item("Crystal Staff"),
  // Thief
  item("Thieves Tools"),
  item("Quiet Boots", { desc: "For moving silently." }),
  item("Anti-poison Gloves", { desc: "Serpent skin. For finding and removing traps." }),
  item("Bag of Climbing Chalk", { desc: "For climbing walls." }),
  item("Cloak of Shadows", { desc: "For hiding in shadows." }),
  item("Ear Horn", { desc: "For hearing noises." }),
  item("Dictionary of Ancient Tongues", { desc: "Battered. For reading languages." }),
  item("Cutpurse Blade", { petty: true, desc: "Can be easily hidden." }),
  item("Trick Deck of Cards", { petty: true }),
  // Dwarf
  item("Pewter Tankard", { desc: "Well used." }),
  item("Beard Comb", { petty: true }),
  item("Wooden Harp"),
  weapon("Warhammer", "d10", { bulky: true, desc: "Of the outcast clan." }),
  item("Tapping Hammer", { petty: true }),
  item("Pressed Flower", { petty: true, desc: "From a hill dwarf." }),
  item("War Bagpipes"),
  weapon("Silver Dagger", "d6"),
  item("Beard Ties", { desc: "A collection, colorful." }),
  // Elf
  item("Elven Rations", { uses: 6 }),
  item("Beautiful Headband", { petty: true }),
  weapon("Feather Light Sword", "d8", { desc: "Feather light." }),
  // Halfling
  weapon("Boar Spear", "d10", { bulky: true }),
  armor("Cooking Pot", 1, { desc: "+1 Armor. Doubles as a helmet." }),
  item("Powdered Lemon Drink", { petty: true, desc: "Restores d4 STR." }),
  item("Granny's Hot Tea Cup", { desc: "Liquid inside never cools." }),
  item("Old Fletch's Pillow", { desc: "Creates a zone of silence around the head of anyone laying on it." }),
  item("Bag of Marbles", { petty: true, desc: "Including one which soothes the mind if played with." }),
];

/* ------------------------------------------------------- the one spellbook */
const SHIELD_SPELLBOOK = {
  name: "Shield",
  type: "spellbook",
  system: {
    description: "A phalanx of invisible force encircles the caster, turning aside blows and arrows until they next rest.",
  },
};

/* ---------------------------------------------------------- the backgrounds */
const g = (name, uses) => (uses ? { name, uses } : { name });

const BACKGROUNDS = [
  {
    name: "Fighter", archetype: "Fighter",
    description: "You have studied combat and know the ways of war. Many look to you for protection, and you do not flinch from a fight.",
    names: ["Thincol", "Caramon", "Allonrik", "Barbadossa", "Kitiara", "Sonja", "Darkblade", "Sturm", "Ephiny", "Scathach"],
    startingGear: [g("Rations", 3), g("Torch", 3), g("Chainmail"), g("Sword"), g("Pole, 10ft"), g("Letters from Home")],
    tables: [
      { question: "Which war did you fight in?", options: [
        { description: "You defended your homeland against an invading army. Take a Fancy Medal (petty).", items: [g("Fancy Medal")] },
        { description: "You were sent to a distant land to fight against an unknown enemy. Take a Stolen Trinket (petty).", items: [g("Stolen Trinket")] },
        { description: "You fought in a battle between wizards who delved into a frozen city. Take a Fur Cloak of a Winterwolf.", items: [g("Fur Cloak of a Winterwolf")] },
        { description: "You fought alongside Elven warriors against the sadistic serpent-people. Take an Elven Rope (can be retrieved from being anchored with a small tug).", items: [g("Elven Rope")] },
        { description: "You fought alongside noble serpent-people against the cruel invading Elves. Take a Vial of Paralyzing Poison (1 use).", items: [g("Vial of Paralyzing Poison", 1)] },
        { description: "You fought in the Edition Wars under General Thaco. Take a Hacked Shield (+1 Armor, can be sundered to avoid damage from an attack).", items: [g("Hacked Shield")] },
      ] },
      { question: "What title do you hold?", options: [
        { description: "Veteran: You fight exceptionally well in a group of your comrades." },
        { description: "Warrior: You fight exceptionally well on your own." },
        { description: "Swordsman: You never lose your grip on your sword." },
        { description: "Hero: Bards make songs of your exploits. They say you are as strong as four of your enemies." },
        { description: "Swashbuckler: You are trained in disarming your opponents." },
        { description: "Myrmidon: Your loyalty is unquestionable." },
      ] },
    ],
  },
  {
    name: "Cleric", archetype: "Wizard",
    description: "You have dedicated yourself to a great and worthy cause. Divine powers help you in your quests.",
    names: ["Aleena", "Petra", "Gorm", "Thaddeus", "Claude", "Silvermoon", "Henrik", "Radija", "Beldinas", "Crysania"],
    startingGear: [g("Rations", 3), g("Lantern"), g("Oil Can", 6), g("Brigandine"), g("Mace"), g("Holy Symbol")],
    tables: [
      { question: "What is the source of your power?", options: [
        { description: "The Celestial Realms and the Darkness Above. Take an Astrolabe of Control Weather.", items: [g("Astrolabe of Control Weather")] },
        { description: "The Wood Spirits. Take a Hazel Rod of Control Plants.", items: [g("Hazel Rod of Control Plants")] },
        { description: "The Deep Sea. Take a Pure Water Vial of Cone of Foam.", items: [g("Pure Water Vial of Cone of Foam")] },
        { description: "The Old Powers of the Earth. Take an Ancient Dark Stone of Summon Idol.", items: [g("Ancient Dark Stone of Summon Idol")] },
        { description: "A Wise Philosophy. Take a Talisman of Pacify.", items: [g("Talisman of Pacify")] },
        { description: "Your Long Dead Ancestors. Take a Candle of Ward.", items: [g("Candle of Ward")] },
      ] },
      { question: "What is your alignment?", options: [
        { description: "Lawful Good. Take an Iron Rod of Justice.", items: [g("Iron Rod of Justice")] },
        { description: "Lawful Neutral. Take a Scroll of Laws (petty).", items: [g("Scroll of Laws")] },
        { description: "Neutral Good. Take an Hourglass.", items: [g("Hourglass")] },
        { description: "True Neutral. Take a Beige Cloak.", items: [g("Beige Cloak")] },
        { description: "Chaotic Good. Take a Tin of Paint.", items: [g("Tin of Paint")] },
        { description: "Chaotic Neutral. Take a Sedative (petty, 1 use).", items: [g("Sedative", 1)] },
      ] },
    ],
  },
  {
    name: "Magic-User", archetype: "Wizard",
    description: "You study the powers of magic and the secret ways of the world. Spellbooks are your obsession.",
    names: ["Bargle", "Dalamar", "Fistandandiddlyitus", "Eriadna", "Teriak", "Skarda", "Teldon", "Presto", "Sadira", "Kareena"],
    startingGear: [g("Rations", 3), g("Torch", 3), g("Dagger"), g("Spellbook (Detect Magic)"), g("Parchment", 3), g("Chalk")],
    tables: [
      { question: "What is your area of magical study?", options: [
        { description: "Abjuration. Take a Bag of Powdered Iron and Silver (petty).", items: [g("Bag of Powdered Iron and Silver")] },
        { description: "Divination. Take a Crystal Prism (petty).", items: [g("Crystal Prism")] },
        { description: "Evocation. Take a Glass Rod (petty) and a Piece of Fur (petty).", items: [g("Glass Rod"), g("Piece of Fur")] },
        { description: "Illusion. Take an Eyelash encased in gum arabic (petty).", items: [g("Eyelash encased in gum arabic")] },
        { description: "Necromancy. Take a Bag of Rat Skulls.", items: [g("Bag of Rat Skulls")] },
        { description: "All Magic. Take a Crystal Staff.", items: [g("Crystal Staff")] },
      ] },
      { question: "What title do you hold?", options: [
        { description: "Medium. Take the Raise Spirit Spellbook.", items: [g("Spellbook (Raise Spirit)")] },
        { description: "Seer. Take the Arcane Eye Spellbook.", items: [g("Spellbook (Arcane Eye)")] },
        { description: "Conjurer. Take the Flare Spellbook.", items: [g("Spellbook (Flare)")] },
        { description: "Theurgist. Take the Shield Spellbook.", items: [g("Spellbook (Shield)")] },
        { description: "Magician. Take the Charm Spellbook.", items: [g("Spellbook (Charm)")] },
        { description: "Enchanter. Take the Sleep Spellbook.", items: [g("Spellbook (Sleep)")] },
      ] },
    ],
  },
  {
    name: "Thief", archetype: "Thief",
    description: "All property is theft, and you know how to redistribute worldly goods to the most deserving. You are often the most deserving.",
    names: ["Greegan", "Tasslehoff", "Robin", "The Scarlet Rose", "Jack", "Yamara", "Snails", "Sheila", "Anton", "Emilio"],
    startingGear: [g("Rations", 3), g("Torch", 3), g("Dagger"), g("Rope"), g("Sack"), g("Thieves Tools")],
    tables: [
      { question: "What skills have you trained in?", options: [
        { description: "Moving Silently. Take a pair of Quiet Boots.", items: [g("Quiet Boots")] },
        { description: "Finding and Removing Traps. Take a pair of serpent skin Anti-poison Gloves.", items: [g("Anti-poison Gloves")] },
        { description: "Climbing Walls. Take a Bag of Climbing Chalk.", items: [g("Bag of Climbing Chalk")] },
        { description: "Hiding in Shadows. Take a Cloak of Shadows.", items: [g("Cloak of Shadows")] },
        { description: "Hearing Noises. Take an Ear Horn.", items: [g("Ear Horn")] },
        { description: "Reading Languages. Take a battered Dictionary of Ancient Tongues.", items: [g("Dictionary of Ancient Tongues")] },
      ] },
      { question: "What sort of thief are you?", options: [
        { description: "Apprentice. Take a Grappling Hook.", items: [g("Grappling Hook")] },
        { description: "Footpad. Take a Disguise Kit (facepaints and costume).", items: [g("Disguise Kit")] },
        { description: "Robber. Take a Cudgel (d6).", items: [g("Cudgel")] },
        { description: "Burglar. Take a Crowbar.", items: [g("Crowbar")] },
        { description: "Cutpurse. Take a Cutpurse Blade (petty). This can be easily hidden.", items: [g("Cutpurse Blade")] },
        { description: "Sharper. Take a Trick Deck of Cards (petty).", items: [g("Trick Deck of Cards")] },
      ] },
    ],
  },
  {
    name: "Dwarf", archetype: "Fighter",
    description: "You hail from underneath the mountains, and have traveled to the surface realm far from your clan. You know the rocks as true friends, have a keen eye for battle, and know the songs of old.",
    names: ["Thorvald", "Flint", "Denwarf", "Grumski", "Brigga", "Fumblik", "Thanegeld", "Durin", "Kilta", "Norrbag"],
    startingGear: [g("Rations", 3), g("Torch", 3), g("Brigandine"), g("Pewter Tankard"), g("Beard Comb"), g("Wooden Harp")],
    tables: [
      { question: "What is special about your Axe (d8)?", options: [
        { description: "It glows a pale blue in the presence of Goblins.", items: [g("Axe")] },
        { description: "It is a Giant Slayer (Enhanced damage against all types of Giants).", items: [g("Axe")] },
        { description: "It was forged with silver-ice (always stays at room temperature regardless of surroundings).", items: [g("Axe")] },
        { description: "It was bonded to you at birth (you never lose its grip).", items: [g("Axe")] },
        { description: "It contains an ancient spirit who whispers advice to you. They have your best interests at heart.", items: [g("Axe")] },
        { description: "It's not an axe, it's a Warhammer (d10, bulky) of the outcast clan.", items: [g("Warhammer")] },
      ] },
      { question: "What heirloom did you bring from your clan?", options: [
        { description: "A Tapping Hammer (petty).", items: [g("Tapping Hammer")] },
        { description: "An expensive Gem (petty).", items: [g("Single Gem")] },
        { description: "A Pressed Flower (petty) from a hill dwarf.", items: [g("Pressed Flower")] },
        { description: "War Bagpipes.", items: [g("War Bagpipes")] },
        { description: "A Silver Dagger (d6 damage).", items: [g("Silver Dagger")] },
        { description: "A collection of colorful Beard Ties.", items: [g("Beard Ties")] },
      ] },
    ],
  },
  {
    name: "Elf", archetype: "Wizard",
    description: "Long have you lived in the safety of the elven woods, but now you have ventured into the lands beyond. You see the beauty in all of nature, and are a champion of life itself.",
    names: ["Erewan", "Alleria", "Eridan", "Elora", "Glorfangdon", "Tanis", "Doriath", "Larian", "Osian", "Mallawar"],
    startingGear: [g("Elven Rations", 6), g("Torch", 3), g("Gambeson"), g("Beautiful Headband"), g("Bow"), g("Feather Light Sword")],
    tables: [
      { question: "What changed you in a previous age of the world?", options: [
        { description: "You fought against beasts of flame and shadow. You can sense a demonic presence regardless of its form." },
        { description: "You were trapped at the top of a wizard's tower. You have no fear of heights and can easily sleep anywhere." },
        { description: "You were tricked into helping forge an evil relic. You can sense cursed objects by placing your hand near them." },
        { description: "You lived for centuries with a family of werebears. You can speak the language of bears and know their ancient customs." },
        { description: "You became a student of the celestial wonders. By spending three nights observing and talking to the stars you can reveal a new Omen." },
        { description: "You were betrayed by the ancestor of one of the other characters. You have a mystical bond to the betrayers descendants and can sense when they are in danger." },
      ] },
      { question: "What do you see with your elf eyes?", options: [
        { description: "You can see clearly in starlight as if it were day." },
        { description: "You can see footprints or animal tracks and know who made them and when." },
        { description: "You can see the deception in a swindler's eyes." },
        { description: "You can see through the rain, even in a thunderstorm." },
        { description: "If you look at an object for long enough, you can see in your mind's eye who last held it." },
        { description: "You can see the natural life span of creatures younger than you." },
      ] },
    ],
  },
  {
    name: "Halfling", archetype: "Thief",
    description: "Adventure, excitement, most halflings do not crave these things but you are different! Some spirit drives you to seek out new experiences in the wide world far from the safety of home.",
    names: ["Ranon", "Mims", "Loberlin", "Jaervosz", "Pumpkin", "Dehlia", "Erinis", "Gretchin", "Lobelia", "Bungo"],
    startingGear: [g("Rations", 6), g("Torch", 3), g("Sling"), g("Cudgel"), g("Rope"), g("Smoking Pipe"), g("Pipeweed", 6)],
    tables: [
      { question: "How are you different to the stay at home halflings?", options: [
        { description: "You have no fear, and terror is an alien concept to you." },
        { description: "You always wanted to see the deep woods after an encounter with a forest spirit when you were young. Take a Faery Mark on your hand or face." },
        { description: "You were friends with a wizard who disappeared and one day you will find them again. Take a Scroll of Mirrorwalk (petty).", items: [g("Scroll (Mirrorwalk)")] },
        { description: "You were found as a babe during a magical storm. Any magic has a 2 in 6 chance of not affecting you." },
        { description: "You long for battle as in the tales of the tall folk. Take a Boar Spear (d10 bulky).", items: [g("Boar Spear")] },
        { description: "You are addicted to stealing coins and jewels. You don't care to keep them, but you have to collect them all… Take an extra 3d6 Gold." },
      ] },
      { question: "What home comfort did you bring with you?", options: [
        { description: "A Cooking Pot that doubles as a helmet (+1 Armor).", items: [g("Cooking Pot")] },
        { description: "A Shield (+1 Armor) with attachable legs to turn it into a functioning table.", items: [g("Shield")] },
        { description: "Powdered Lemon Drink (petty, restores d4 STR).", items: [g("Powdered Lemon Drink")] },
        { description: "Granny's Hot Tea Cup - liquid inside never cools.", items: [g("Granny's Hot Tea Cup")] },
        { description: "Old Fletch's Pillow - creates a zone of silence around the head of anyone laying on it.", items: [g("Old Fletch's Pillow")] },
        { description: "A Bag of Marbles (petty), including one which soothes the mind if played with.", items: [g("Bag of Marbles")] },
      ] },
    ],
  },
];

/* ------------------------------------------------------------------ writers */
const fileName = (name, id) => `${name.replace(/[^A-Za-z0-9]+/g, "_")}_${id}.yml`;
const dump = (doc) => YAML.dump(doc, { lineWidth: -1, quotingType: "'", forceQuotes: false });

const writeDoc = (dir, doc) => {
  const target = path.join(dir, fileName(doc.name, doc._id));
  const body = dump(doc);
  if (DRY) { console.log(`  would write ${path.relative(ROOT, target)}`); return; }
  fs.writeFileSync(target, body, "utf8");
  console.log(`  wrote ${path.relative(ROOT, target)}`);
};

// A pool item must not be re-authored if a FOREIGN pack file already holds the
// name — but this importer's OWN previous output (marked gearSource
// "class-backgrounds") is overwritten, or a rerun could never fix a field it
// got wrong the first time. That is not hypothetical: the first cut wrote a
// nonexistent icons/item.svg, and the rerun skipped its own stale files as
// "already in the pool", leaving the bad path in place.
const POOL_DIRS = ["expeditionary-gear", "tools", "trinkets", "weapons", "armor", "market-goods", "background-items"];
const foreignNames = new Set();
for (const p of POOL_DIRS) {
  const dir = path.join(ROOT, "src", "packs", p);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".yml"))) {
    const doc = YAML.load(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!doc?.name) continue;
    if (doc.flags?.["air-bladder"]?.gearSource === "class-backgrounds") continue;
    foreignNames.add(doc.name.toLowerCase());
  }
}

/* items */
const itemsDir = path.join(ROOT, "src", "packs", "background-items");
let authored = 0, skipped = 0;
for (const it of NEW_ITEMS) {
  if (foreignNames.has(it.name.toLowerCase())) {
    console.log(`  pool already has "${it.name}" — referenced, not re-authored`);
    skipped++;
    continue;
  }
  const _id = stableId(`item:${it.name}`);
  const iconFor = { weapon: "weapons", armor: "armor" }[it.type] ?? "generic-item";
  writeDoc(itemsDir, {
    _id, name: it.name, type: it.type,
    img: `systems/air-bladder/icons/${iconFor}.svg`,
    effects: [], folder: null, sort: 0,
    flags: { "air-bladder": { gearSource: "class-backgrounds" } },
    system: it.system,
    ownership: { default: 0 },
    _stats: { systemId: "air-bladder", coreVersion: "14.365" },
    _key: `!items!${_id}`,
  });
  authored++;
}

/* the Shield spellbook */
const spellDir = path.join(ROOT, "src", "packs", "more-spellbooks");
// Same own-vs-foreign rule as the items: a FOREIGN Shield is respected, ours
// is overwritten so a rerun can correct itself.
const shieldExists = fs.readdirSync(spellDir).some((f) => {
  if (!/^Shield_/.test(f)) return false;
  const doc = YAML.load(fs.readFileSync(path.join(spellDir, f), "utf8"));
  return doc?.flags?.["air-bladder"]?.gearSource !== "class-backgrounds";
});
if (!shieldExists) {
  const _id = stableId("spell:Shield");
  writeDoc(spellDir, {
    _id, name: SHIELD_SPELLBOOK.name, type: "spellbook",
    img: "systems/air-bladder/icons/spellbook.svg",
    effects: [], folder: null, sort: 0,
    flags: { "air-bladder": { gearSource: "class-backgrounds" } },
    system: SHIELD_SPELLBOOK.system,
    ownership: { default: 0 },
    _stats: { systemId: "air-bladder", coreVersion: "14.365" },
    _key: `!items!${_id}`,
  });
} else {
  console.log("  more-spellbooks already has Shield — left alone");
}

/* backgrounds */
const bgDir = path.join(ROOT, "src", "packs", "backgrounds-custom");
if (!DRY) fs.mkdirSync(bgDir, { recursive: true });
for (const bg of BACKGROUNDS) {
  const _id = stableId(`background:${bg.name}`);
  writeDoc(bgDir, {
    _id, name: bg.name, type: "background",
    img: "systems/air-bladder/icons/background.svg",
    effects: [], folder: null, sort: 0,
    flags: { "air-bladder": { backgroundSource: "class-backgrounds" } },
    system: {
      source: "2e",
      archetype: bg.archetype,
      description: `<p>${bg.description}</p>`,
      names: bg.names,
      startingGear: bg.startingGear,
      containers: [],
      tables: bg.tables.map((t) => ({
        question: t.question,
        options: t.options.map((o) => ({
          description: o.description,
          ...(o.items ? { items: o.items } : {}),
          ...(o.bonusGold ? { bonusGold: o.bonusGold } : {}),
        })),
      })),
    },
    ownership: { default: 0 },
    _stats: { systemId: "air-bladder", coreVersion: "14.365" },
    _key: `!items!${_id}`,
  });
}

console.log(`\n${BACKGROUNDS.length} backgrounds, ${authored} new items (${skipped} already in the pool), Shield spellbook ${shieldExists ? "kept" : "written"}.`);
console.log("Next: npm run build:packs (stop Foundry first), then the gates.");

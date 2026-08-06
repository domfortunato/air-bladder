#!/usr/bin/env node
/**
 * The GLOG spell pack: 100 spellbooks into src/packs/spellbooks-glog/.
 *
 *   node tools/import/glog-spells.mjs [--dry]
 *
 * Source: https://cairnrpg.com/hacks/glog-spells/ — "The text on this page is
 * licensed under CC-BY-SA 4.0" (stated on the page; same for the companion
 * rules at /hacks/glog-magic/). The list is the CANON 100 re-worded to scale
 * with the GLOG Magic hack's casting variables: [dice] is the number of Magic
 * Dice invested, [sum] their total. 96 entries carry one or both; 4 carry
 * neither, and two of those (Sniff, Hear Whispers) are byte-identical to the
 * canon wording — which is exactly why the GLOG wording is a SEPARATE document
 * with `system.glog: true` rather than a second description field: the two
 * texts cannot be derived from each other in either direction.
 *
 * The page has no machine-readable form, so like class-backgrounds.mjs the
 * transcription below IS the artifact of record. [dice]/[sum] stay literal in
 * the text — mechanical prose is never automated. Transcription is verbatim,
 * typos and all ("[dice] objects is covered…"): the text is the licensed work,
 * and correcting it is not this importer's call.
 *
 * Own-vs-foreign: a file whose gearSource flag is not "glog-spells" is FOREIGN
 * and respected; our own previous output is overwritten so a rerun can fix a
 * field it got wrong (the lesson class-backgrounds.mjs paid for). IDs are
 * FNV-ish hashes of the name, prefixed "GS", so reruns are byte-identical.
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
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const stableId = (name) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const ch of `glog-spells:${name}`) {
    h1 = Math.imul(h1 ^ ch.codePointAt(0), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + ch.codePointAt(0), 0x85ebca6b) >>> 0;
  }
  let out = "GS";
  for (let i = 0; i < 14; i++) {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 0xcc9e2d51) >>> 0;
    out += ID_ALPHABET[((h1 ^ h2 ^ i) >>> 0) % ID_ALPHABET.length];
  }
  return out;
};

/* ------------------------------------------------------------------- spells */
// Verbatim from cairnrpg.com/hacks/glog-spells/ (CC BY-SA 4.0), 2026-08-05.
const SPELLS = [
  ["Adhere", "[dice] objects is covered in extremely sticky slime."],
  ["Anchor", "A strong wire sprouts from your arms, affixing itself to [dice] points within 50ft on each side."],
  ["Animate Object", "[dice] objects obeys your commands as best it can. It can walk 15ft per round."],
  ["Anthropomorphize", "A touched animal either gains human intelligence or human appearance for [sum] days."],
  ["Arcane Eye", "You can see through a magical floating eyeball that flies around at your command."],
  ["Astral Prison", "[dice] objects are frozen in time and space within an invulnerable crystal shell."],
  ["Attract", "[sum]+1 objects are strongly magnetically attracted to each other if they come within 10 feet."],
  ["Auditory Illusion", "You create illusory sounds that seem to come from a direction of your choice."],
  ["Babble", "[dice] creatures must loudly and clearly repeat everything you think. It is otherwise mute."],
  ["Bait Flower", "A plant sprouts from the ground that emanates the smell of decaying flesh."],
  ["Beast Form", "You and your possessions transform into a mundane animal."],
  ["Befuddle", "[sum] creatures of your choice are unable to form new short-term memories for the duration of the spell."],
  ["Body Swap", "You switch bodies with a creature you touch. If one body dies, the other dies as well."],
  ["Charm", "[sum] creatures treat you like a friend."],
  ["Command", "A creature obeys a single, [sum] word command that does not harm it"],
  ["Comprehend", "You become fluent in all languages"],
  ["Cone of Foam", "Dense foam sprays from your hand, coating [dice] targets."],
  ["Control Plants", "[sum] nearby plants and trees obey you and gain the ability to move at a slow pace."],
  ["Control Weather", "You may alter the type of weather for [sum] minutes, but you do not otherwise control it."],
  ["Cure Wounds", "Restore [dice] STR to a creature you can touch."],
  ["Deafen", "[sum] nearby creatures are deafened at random."],
  ["Detect Magic", "You hear nearby magical auras singing. Volume and harmony signify the aura's power and refinement."],
  ["Disassemble", "Any of your body parts may be detached and reattached at will, without causing pain or damage. You can still control them."],
  ["Disguise", "You may alter the appearance of [sum] characters at will as long as they remain humanoid. Attempts to duplicate other characters will seem uncanny"],
  ["Displace", "An object appears to be up to [sum]×10ft from its actual position."],
  ["Earthquake", "The ground begins shaking violently. Structures may be damaged or collapse."],
  ["Elasticity", "Your body can stretch up to [dice]×10ft."],
  ["Elemental Wall", "A straight wall of ice or fire [dice]×40ft long and 10ft high rises from the ground."],
  ["Flare", "A bright ball of energy fires a trail of light into the sky, revealing your location to friend or foe for [dice] minutes."],
  ["Filch", "[dice] visible items teleport to your hands."],
  ["Fog Cloud", "Dense fog spreads out from you"],
  ["Frenzy", "[sum] creatures erupt in a frenzy of violence"],
  ["Gate", "A portal to a random plane opens."],
  ["Gravity Shift", "You can change the direction of gravity (for yourself only) up to [dice] per round."],
  ["Greed", "[sum] creatures develop an overwhelming urge to possess a visible item of your choice."],
  ["Haste", "Your movement speed is multiplied [dice] times."],
  ["Hatred", "[dice] creatures develop a deep hatred of another creature or group of creatures and wish to destroy it."],
  ["Hear Whispers", "You can hear faint sounds clearly"],
  ["Hover", "An object hovers, frictionless, [sum] ft above the ground."],
  ["Hypnotize", "A creature enters a trance and will truthfully answer [dice] yes or no questions you ask it."],
  ["Icy Touch", "A thick ice layer spreads across a touched surface, up to [dice]×10ft in radius."],
  ["Identify Owner", "[dice] letters appear over the object you touch, spelling out the name of the object's owners, if there are any."],
  ["Illuminate", "A floating light moves as you command."],
  ["Invisible Tether", "Two objects within [dice]x10ft of each other cannot be moved more than [dice]x10ft apart."],
  ["Knock", "[dice] nearby mundane or magical locks unlock."],
  ["Leap", "You can jump up to [dice]×10ft in the air."],
  ["Liquid Air", "The air around you becomes swimmable."],
  ["Magic Dampener", "[dice] nearby magical effects have their effectiveness halved."],
  ["Manse", "A sturdy, furnished cottage appears for [dice]×12 hours. You can permit and forbid entry to it at will."],
  ["Marble Madness", "Your pockets are full of marbles, and will refill for [sum] rounds."],
  ["Masquerade", "[dice] characters' appearances and voices become identical to a touched character."],
  ["Miniaturize", "You and [dice] other touched creatures are reduced to the size of a mouse."],
  ["Mirror Image", "[dice] illusory duplicates of yourself appear under your control."],
  ["Mirrorwalk", "A mirror becomes a gateway to another mirror that you looked into today."],
  ["Multiarm", "You gain [dice] extra arms"],
  ["Night Sphere", "An [sum]×40ft wide sphere of darkness displaying the night sky appears."],
  ["Objectify", "You become any inanimate object between the size of a grand piano and an apple."],
  ["Ooze Form", "You become a living jelly."],
  ["Pacify", "[dice] creatures have an aversion to violence."],
  ["Phobia", "[dice] creatures become terrified of an object of your choice."],
  ["Pit", "A pit 10ft wide and [sum]x5ft deep opens in the ground"],
  ["Primeval Surge", "An object grows to the size of an elephant. If it is an animal, it is enraged."],
  ["Push/Pull", "[dice] objects of any size are pulled directly towards you or pushed directly away from you with the strength of [sum] men."],
  ["Raise Dead", "[sum] skeletons rise from the ground to serve you. They are incredibly stupid and can only obey simple orders."],
  ["Raise Spirit", "The spirit of a dead body manifests and will answer [dice] questions."],
  ["Read Mind", "You can hear the surface thoughts of [dice] nearby creatures."],
  ["Repel", "[sum]+1 objects are strongly magnetically repelled from each other if they come within 10 feet."],
  ["Scry", "You can see through the eyes of a creature you touched earlier today."],
  ["Sculpt Elements", "All inanimate material behaves like clay in your hands."],
  ["Sense", "Choose one kind of object (key, gold, arrow, jug, etc). You can sense the nearest [dice] examples."],
  ["Shield", "A creature you touch is protected from mundane attacks for [dice] minutes."],
  ["Shroud", "[sum] creatures are invisible until they move"],
  ["Shuffle", "[sum] creatures instantly switch places. Determine where they end up randomly."],
  ["Sleep", "[dice] creatures fall into a light sleep."],
  ["Slick", "Every surface in a [dice]x10ft radius becomes extremely slippery."],
  ["Smoke Form", "Your body becomes living smoke for [dice] minutes."],
  ["Sniff", "You can smell even the faintest traces of scents."],
  ["Snuff", "The source of [sum] mundane lights you can see are instantly snuffed out."],
  ["Sort", "Inanimate items sort themselves according to categories you set."],
  ["Spectacle", "A clearly unreal but impressive illusion of your choice appears for [dice] minutes, under your control. It may be up to the size of a palace and has full motion and sound"],
  ["Spellsaw", "A whirling blade flies from your chest, clearing any plant material in its way. It is otherwise harmless."],
  ["Spider Climb", "You can climb surfaces like a spider for [dice] minutes."],
  ["Summon Cube", "[sum] times per round] you may summon or banish a 3-foot-wide cube of earth. New cubes must be affixed to the earth or to other cubes."],
  ["Summon Idol", "A carved stone statue the size of a mule rises from the ground."],
  ["Swarm", "You become a swarm of crows, rats, or piranhas. You only take damage from area effects"],
  ["Telekinesis", "You may mentally move [sum] items."],
  ["Telepathy", "[sum]+1 creatures can hear each other's thoughts, no matter how far apart they move"],
  ["Teleport", "An object disappears and reappears on the ground in a visible, clear area up to [sum]×40ft away."],
  ["Target Lure", "An object you touch becomes the target of any nearby spell."],
  ["Thicket", "A thicket of trees and dense brush up to [sum]×40ft wide suddenly sprouts up."],
  ["Time Control", "Time in a 50ft bubble slows down or increases by 10% for 30 seconds."],
  ["True Sight", "You see through all nearby illusions."],
  ["Upwell", "A spring of seawater appears."],
  ["Vision", "You completely control what a creature sees."],
  ["Visual Illusion", "A silent, immobile, illusion of your choice appears, up to the size of a bedroom."],
  ["Ward", "A silver circle 40ft across appears on the ground. Choose one thing that cannot cross it"],
  ["Web", "Your wrists can shoot thick webbing that covers [sum]x10ft."],
  ["Widget", "A primitive version of a drawn tool or item appears before you and disappears after a [dice] minutes."],
  ["Wizard Mark", "Your finger can shoot a stream of ulfire-colored paint. This paint is only visible to you, and can be seen at any distance, even through solid objects."],
  ["X-Ray Vision", "You gain X-Ray vision."],
];

/* ------------------------------------------------------------------ writers */
const fileName = (name, id) => `${name.replace(/[^A-Za-z0-9]+/g, "_")}_${id}.yml`;
const dump = (doc) => YAML.dump(doc, { lineWidth: -1, quotingType: "'", forceQuotes: false });

const writeDoc = (dir, doc) => {
  const target = path.join(dir, fileName(doc.name, doc._id));
  const body = dump(doc);
  if (DRY) { console.log(`  would write ${path.relative(ROOT, target)}`); return; }
  fs.writeFileSync(target, body, "utf8");
};

const packDir = path.join(ROOT, "src", "packs", "spellbooks-glog");
if (!DRY) fs.mkdirSync(packDir, { recursive: true });

// Own-vs-foreign inside the target pack only: this pack is this importer's to
// author, but a Warden-committed document (no gearSource flag, or someone
// else's) is theirs and is left alone.
const foreign = new Set();
if (fs.existsSync(packDir)) {
  for (const f of fs.readdirSync(packDir).filter((n) => n.endsWith(".yml"))) {
    const doc = YAML.load(fs.readFileSync(path.join(packDir, f), "utf8"));
    if (!doc?.name) continue;
    if (doc.flags?.["air-bladder"]?.gearSource === "glog-spells") continue;
    foreign.add(doc.name.toLowerCase());
  }
}

if (SPELLS.length !== 100) {
  console.error(`FATAL: transcription holds ${SPELLS.length} spells, expected 100`);
  process.exit(1);
}
const names = new Set(SPELLS.map(([n]) => n.toLowerCase()));
if (names.size !== 100) {
  console.error("FATAL: duplicate spell name in the transcription");
  process.exit(1);
}

let authored = 0, skipped = 0;
for (const [name, text] of SPELLS) {
  if (foreign.has(name.toLowerCase())) {
    console.log(`  "${name}" exists and is not ours — left alone`);
    skipped++;
    continue;
  }
  const _id = stableId(name);
  writeDoc(packDir, {
    _id, name, type: "spellbook",
    img: "systems/air-bladder/icons/spellbook.svg",
    effects: [], folder: null, sort: 0,
    flags: { "air-bladder": { gearSource: "glog-spells" } },
    system: {
      cost: 0,
      description: `<p>${text}</p>`,
      weightless: false,
      equipped: false,
      bulky: false,
      quantity: 1,
      scroll: false,
      glog: true,
      uses: { value: 0, max: 0 },
    },
    ownership: { default: 0 },
    _stats: { systemId: "air-bladder", coreVersion: "14.365" },
    _key: `!items!${_id}`,
  });
  authored++;
}

console.log(`\nglog-spells: authored ${authored}, left ${skipped} foreign, of ${SPELLS.length}`);
console.log(DRY ? "(dry run — nothing written)" : `-> src/packs/spellbooks-glog/`);

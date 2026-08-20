/** @name CONFIG.Cairn */
export const Cairn = {};

// Cairn 2e generation config. Backgrounds, gear, and bonds come from their own
// packs (see character-generator.js); this covers the shared biography, which
// draws the 8 physical/personality traits from tables-2e and rolls age.
// 2e drops the 1e system's Misfortune and Reputation.
Cairn.characterGenerator2e = {
  // Cairn 2e starts every character with 3d6 coins, on top of any coins their
  // bond or background choice-tables grant.
  gold: "3d6",
  biography: {
    // No sentence template here, on purpose (review #13). One lived here —
    // "I have a <strong>{physique}</strong> physique, …" — with no reader:
    // the sheet composes the biography per RENDER from the CAIRN.Bio.* keys
    // (actor-sheet.js), which is what lets a Spanish client re-word it.
    // Left in place it read as the sentence's authority, and an edit to it
    // would have changed nothing a user could see.
    age: "2d20 + 10",
    items: {
      physique: "air-bladder.tables-2e;Physique",
      skin: "air-bladder.tables-2e;Skin",
      hair: "air-bladder.tables-2e;Hair",
      face: "air-bladder.tables-2e;Face",
      speech: "air-bladder.tables-2e;Speech",
      clothing: "air-bladder.tables-2e;Clothing",
      vice: "air-bladder.tables-2e;Vice",
      virtue: "air-bladder.tables-2e;Virtue"
    }
  }
};

// The two PERSON generators (2026-08-20 split). Both draw names from the same
// table — it is the Warden's Guide NPC name list, and a hireling has no other
// source: a 2e character takes its name from its background's name list, which
// neither of these has an equivalent of.
//
// The HIRELING's statblock is shipped runtime data (module/npc-careers-2e.json,
// the twelve 2e careers) rather than a table, so only the name is configurable
// here. The NPC's four traits and Background ARE tables, and they are the
// Warden's Guide "NPC Tables" — already shipped in warden-npcs, twenty entries
// each, and until this split only `Name` and `Faction` had a reader.
//
// roll(), never draw(): these are the WARDEN'S tables and a draw would dirty
// their drawn state — the same invariant the monster tables document below.
Cairn.npcGenerator = {
  name: "air-bladder.warden-npcs;Warden: NPC - Name",
  // The Faction die's table, by NAME ONLY — no pack prefix, deliberately: it
  // resolves world-first (findTableByName), so a Warden's own RollTable named
  // "Warden: NPC - Faction" always beats the shipped warden-npcs copy and
  // their faction list survives a system update.
  faction: "Warden: NPC - Faction",
  // Role `npc` only. `background` answers the same question `profession` does
  // for a hireling, off a different table — which is the whole of what
  // separates the two generators.
  background: "air-bladder.warden-npcs;Warden: NPC - Background",
  // The four NPC traits. `virtue` and `vice` deliberately COLLIDE by key with
  // the 2e biography tables above and differ by SOURCE: an NPC is "Shrewd" off
  // the Warden's Guide list, a character "Honest" off tables-2e. Same stored
  // key, so nothing is lost when a Warden changes an actor's role.
  traits: {
    quirk: "air-bladder.warden-npcs;Warden: NPC - Quirk",
    goal: "air-bladder.warden-npcs;Warden: NPC - Goal",
    virtue: "air-bladder.warden-npcs;Warden: NPC - Virtue",
    vice: "air-bladder.warden-npcs;Warden: NPC - Vice",
  },
};

// Monster generation (SRD "Creating Monsters", CC BY-SA 4.0 — the design of
// record is docs/monster-generation.md). The eight tables ship in the
// warden-monsters pack and they are the WARDEN'S tables: the generator rolls
// them with table.roll(), never draw(), so their drawn state stays clean —
// the same invariant rollNameFromTable documents for the NPC name table.
Cairn.monsterGenerator = {
  physique: "air-bladder.warden-monsters;Warden: Monster - Appearance (Physique)",
  feature: "air-bladder.warden-monsters;Warden: Monster - Appearance (Feature)",
  quirk: "air-bladder.warden-monsters;Warden: Monster - Trait (Quirk)",
  weakness: "air-bladder.warden-monsters;Warden: Monster - Trait (Weakness)",
  attackType: "air-bladder.warden-monsters;Warden: Monster - Attack (Type)",
  criticalDamage: "air-bladder.warden-monsters;Warden: Monster - Attack (Critical Damage)",
  abilityPower: "air-bladder.warden-monsters;Warden: Monster - Ability (Power)",
  abilityTarget: "air-bladder.warden-monsters;Warden: Monster - Ability (Target)",
};

// Cairn Barebones creation. Abilities/HP/coins follow the SRD; the name comes
// from the same Warden NPC name table the NPC generator uses, because 2e
// dropped 1e's name tables and Barebones ships none of its own.
Cairn.barebonesGenerator = {
  name: "air-bladder.warden-npcs;Warden: NPC - Name",
  ability: "3d6",
  hitProtection: "1d6",
  gold: "3d6",
};

CONFIG.Cairn = Cairn;


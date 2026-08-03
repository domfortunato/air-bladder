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
    text: "I have a <strong>{physique}</strong> physique, <strong>{skin}</strong> skin, <strong>{hair}</strong> hair, and a <strong>{face}</strong> face. I speak in a <strong>{speech}</strong> manner and wear <strong>{clothing}</strong> clothing. I am <strong>{vice}</strong> yet <strong>{virtue}</strong>. I am <strong>{age}</strong> years old.",
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

// NPC generation. The statblocks themselves are shipped runtime data
// (module/npc-careers-2e.json); only the name source is configurable. A 2e
// character takes its name from its background's name list, which an NPC has
// no equivalent of — so it draws from the Warden's 2e NPC name table.
Cairn.npcGenerator = {
  name: "air-bladder.warden-npcs;Warden: NPC - Name",
  // The Faction die's table, by NAME ONLY — no pack prefix, deliberately: it
  // resolves world-first (findTableByName), so a Warden's own RollTable named
  // "Warden: NPC - Faction" always beats the shipped warden-npcs copy and
  // their faction list survives a system update. roll(), never draw() — the
  // same invariant the monster tables document below.
  faction: "Warden: NPC - Faction",
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


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

// Hireling generation. The statblocks themselves are shipped runtime data
// (module/hirelings-2e.json); only the name source is configurable. A 2e
// character takes its name from its background's name list, which a hireling has
// no equivalent of — so it draws from the Warden's 2e NPC name table, a hireling
// being an NPC the party pays.
Cairn.hirelingGenerator = {
  name: "air-bladder.warden-npcs;Warden: NPC - Name"
};

// Cairn Barebones creation. Abilities/HP/coins follow the SRD; the name comes
// from the same Warden NPC name table hirelings use, because 2e dropped 1e's
// name tables and Barebones ships none of its own.
Cairn.barebonesGenerator = {
  name: "air-bladder.warden-npcs;Warden: NPC - Name",
  ability: "3d6",
  hitProtection: "1d6",
  gold: "3d6",
};

CONFIG.Cairn = Cairn;


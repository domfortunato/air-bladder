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
// These are the WARDEN'S tables and their drawn state must stay clean. The NAME
// and FACTION dice take `table.roll()`, which cannot mark anything. BACKGROUND
// and the four TRAITS go through `drawTableText` -> `table.draw()`, and that is
// safe for TWO independent reasons, both of which have to hold: every one of
// these tables is `replacement: true`, AND core skips the drawn-marking write
// entirely for a table that lives in a pack (`if (!this.replacement && !this.pack)`,
// client/documents/roll-table.mjs:109). Faction is the one that could ever be a
// WORLD table — findTableByName resolves world-first — which is exactly why it
// is on the roll() path and must stay there.
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
  // Role `npc` only, and the one thing here that is NOT a Warden's Guide table
  // (2026-08-20, user ask). A hireling's statblock comes off its career; an NPC
  // has no career, so it is ROLLED — Cairn's own person-making dice, the same
  // pair Barebones creation uses below and a 2e character uses above. The
  // Warden's Guide gives NPCs no statblock at all, which is why 10/10/10 and 6
  // HP stood here until now; a generator sitting at its schema defaults reads
  // as broken, and a rolled stranger is the answer the table actually wanted.
  ability: "3d6",
  hitProtection: "1d6",
  // What an NPC of each Background is CARRYING (2026-08-20, user ask). The d20
  // table names positions in the world; the Barebones list of 100 names TRADES,
  // and a trade is the only background in this system that carries gear — three
  // items each. So an NPC gets the gear of its nearest Barebones counterpart,
  // through the same resolveRefs path a Barebones PC and a 2e hireling use.
  //
  // Keyed on the ENGLISH table text, and that is load-bearing: `drawTableText`
  // returns the raw result, NOT the content overlay's translation, so
  // `system.background` stores English in every language while the SHEET shows
  // `backgroundDisplay`. A map keyed on what the Warden reads would miss on
  // every non-English client. (The read/stored split, module/i18n-content.js.)
  //
  // Eleven of the twenty are the same word in both lists. Seven need a
  // translation. LORD and POLITICIAN are deliberately absent and grant nothing:
  // every one of the 100 Barebones backgrounds is an OCCUPATION, so rank and
  // office have no counterpart — which is exactly why those two words are on a
  // table the Warden rolls and not in character creation. Absent, not null, so
  // a plain lookup answers undefined and the grant is empty. Since 2026-08-21
  // absence suppresses the KIT too, at generation (buildNpcGear) AND on the
  // Background die or picker (applyNpcBackground): a Lord arrives with no
  // items at all, and landing Lord on an existing NPC unpacks the bag.
  //
  // Thug -> Highway Robber, not Thief: Thief is already row 19 of the same
  // table, so the obvious mapping would have collided. One takes by stealth,
  // the other by force.
  backgroundGear: {
    Academic: "Scribe",
    Assassin: "Assassin",
    Blacksmith: "Blacksmith",
    Farmer: "Farmer",
    General: "Knight",
    Gravedigger: "Gravedigger",
    Guard: "Guard",
    Healer: "Herbalist",
    Jailer: "Jailer",
    Laborer: "Gardener",
    Merchant: "Merchant",
    Monk: "Monk",
    Mystic: "Hermit",
    Outlander: "Vagabond",
    Peddler: "Peddler",
    Spy: "Spy",
    Thief: "Thief",
    Thug: "Highway Robber",
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


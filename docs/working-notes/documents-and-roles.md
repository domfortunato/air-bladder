# Documents and roles

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

- `CairnActor` (`module/actor/actor.js`) — types `character`, `npc`, `hireling`.
  `hireling` is an ALIAS of npc (same model and sheet), hidden from Create Actor by
  `CairnActor.createDialog` (the role switchboard). `container` as a TYPE is gone —
  a container is an npc with `role: container`.
- `CairnItem` (`module/item/item.js`) — `item`, `weapon`, `armor`, `spellbook`,
  `object`, `background`, `transport`.
- Data models in `module/data-models.js` (TypeDataModel; sub-types declared in
  `system.json` `documentTypes`). 29 compendium packs — a new pack's commit updates
  this count.
- `module/actor/actor-sheet.js` is the largest file.
- **`NPC_ROLES`**: `npc`, `hireling`, `monster`, `companion`, `transport`,
  `container`. Hireling has a **Career** (`profession`, day rate); NPC has a
  **Background** (`background`) plus Quirk/Goal/Virtue/Vice. Two fields, never one
  relabelled.
- **`PERSON_ROLES`** answers "is this somebody". Ask for a role by name only where
  hireling and NPC differ: which job field shows, and `showForHire` (box AND rate
  row, one gate). Every sheet opens on page 1 since 2026-11-20 (`initialTabId`;
  `ITEMS_FIRST_ROLES` went with the move to the character sheet's format, see
  sheets-creation-offers.md); a thing has no Description page. A role predicate that quietly grows is this codebase's
  thrice-repeated bug — use a named list.
- Hireling-split traps: `migrateData` must NOT convert stored "hireling"; the
  `migrateHirelingSplit` migration SELECTS and its `hireling-split` marker is the
  only thing stopping it converting every genuine NPC; the schema initial is
  `hireling`. Test via raw-socket plant (`dev:role-migration`). A retry selects
  only what existed at the first attempt (`hireling-split-pending.started`, the
  server's own stamp of a Setting write — `game.time.serverTime` is UPTIME).
  **Residual, stated (review #34 F234):** a world whose split FAILED under
  0.1.18–0.1.25 has no `started`, so its first load of the fixed code converts
  every NPC made since, once; `dev:role-migration` pins it.
- Generated NPC: statblock ROLLED (`Cairn.npcGenerator.ability`/`.hitProtection`);
  `Cairn.npcGenerator.backgroundGear` maps to a Barebones background resolved via
  `resolveStartingGear` (not `resolveRefs`); Lord and Politician grant nothing, kit
  included, and swapping to them wipes granted items (`applyNpcBackground`);
  containers are never granted; kit = `rollBarebonesEquipment`, tagged `npc-kit`.
  May land encumbered — probes read `_source` HP. **Everything a generator gives is
  tagged** (untagged = the Warden's own gift, survives every re-roll).
- **Pronouns are never rolled** on either person generator; stated `pronouns: ""`.
- Generated NPC stamps `ownership.default` LIMITED; npc sheet has a LIMITED view
  (portrait, name, description, no Print). `_mayRandomize` refuses players on
  npc/hireling regardless of `allow-player-randomization`. Pickers
  (`canPickGeneration` = `generationEnabled` narrowed to person roles) share one
  apply with the dice (`applyHirelingCareer` / `applyNpcBackground`) and call
  `reorderInventory`.
- Biography sentence: second person for a character, third for npc roles, via
  `_wording` in `_buildTraitSentence`; `has(key, false)` fallback is deliberate.
- **Token linking by role at creation**: `_preCreate` links `character` and
  `PERSON_ROLES` (incl. role-less); monster/companion/transport/container unlinked.
  CLOSED — the fix for crowds is signposting (`CAIRN.CreateActorHint`,
  `CAIRN.Blank.LinkedPerson`, `docs/tokens-and-sheets.md`). Prototype Token
  Overrides cannot express `actorLink`.
- **Token rename follows the actor** only where the token still matched the OLD
  name: `CairnActor._preUpdate` stashes, `_onUpdate` batches per scene. Unlinked
  tokens ride the same path (`preUpdateActorDelta` never fires). Gate
  `dev:token-names`.
- **Containers and transports are Actors** linked by `connectedTo` on the child; the
  keeper's list is DERIVED. Graph is flat (a character keeps, ten max).
  `module/connections.js`: connection drives ownership on transitions only; a
  player's change sets `ownershipSyncPending` and the active GM answers.
  **Connections UI is parked** (`connections-ui-enabled`, internal, default false);
  probes enable it by shadowing the settings read in-page, never a world write.
- **Broken items** (2026-11-20, user ask: "still takes up a slot but doesn't provide any
  benefit"). `system.broken` on every item type (`universal()`). The user's ruling is
  everything mechanical: `CairnItem` unequips a broken item and strips an equip while it stays
  broken (`_preCreate` / `_preUpdate`, both reading the STORED flag from `_source`: `system.equipped` is
  derived false while broken; a repair of an item stored broken + equipped lands unequipped
  unless the write itself equips, review #36), so no Armor, no damage roll, no Hold shield and no
  Attack-window entry; `isEquipable` and `hasPlusMinus` go false, so the hand and the uses /
  charges controls go (the pips stay); Cast and Transmute go, and their handlers refuse too.
  The slot stays: `itemSlotCost` never reads it. Marked on the item sheet, in the name
  row, and since 2026-11-20 (user ask) from a toggle on every inventory row, directly left
  of the trash (`itemToggleBroken`, owned(); `system.canBreak`: a type with `broken`,
  never a Fatigue; game-icons' broken shield, the peril colour while broken, "Mark broken" /
  "Mark repaired"); the row wears a Broken tag. Since 2026-11-21 (user ask) every break
  and repair asks first, on the row AND the item sheet's box: ONE `confirmBroken`
  (item.js), `_confirmAction`'s shape; the sheet's box is caught in the target phase so
  `submitOnChange` never stores it. Gate `dev:broken` (legs 12-14 the row, 15-16 the
  yes/no, 18-19 the stored flag,
  20 the box writes what it asked).
- **Every item action is on the change log** (2026-11-21, user ask: "All actions on
  inventory items, including breaking and unbreaking them, should show in the chat log";
  the user's pick, all but a drag-reorder and a description save). REVERSES review #13's
  exclusion of equipped and renames. `AUDIT_ITEM_FLAGS` (actor.js): broken, equipped
  (the hand, Hold shield, Hold light), bound (Transmute), bulky, weightless, shield; plus
  `rename` lines. ONE `itemAuditOf` / `itemAuditEntries` pair serves both item seams
  (`_preUpdateDescendantDocuments` and a parent update's `changed.items`). Breaking an
  equipped item posts the broken line alone (the forced unequip folded in). Machinery
  writes stay silent through `abNoStatusCard` as before. Gate `dev:changelog`.

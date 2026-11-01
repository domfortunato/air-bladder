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
  row, one gate). `ITEMS_FIRST_ROLES` (persons + container) open on Items via
  `initialTabId`. A role predicate that quietly grows is this codebase's
  thrice-repeated bug — use a named list.
- Hireling-split traps: `migrateData` must NOT convert stored "hireling"; the
  `migrateHirelingSplit` migration SELECTS and its `hireling-split` marker is the
  only thing stopping it converting every genuine NPC; the schema initial is
  `hireling`. Test via raw-socket plant (`dev:role-migration`).
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

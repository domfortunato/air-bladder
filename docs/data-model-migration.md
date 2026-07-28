# template.json → TypeDataModel migration

**Status: done.** Planned 2026-07-27, carried out 2026-07-28. `template.json` is
deleted; the eleven sub-type schemas live in `module/data-models.js` and are
registered on `CONFIG.Actor.dataModels` / `CONFIG.Item.dataModels` at `init`, with
the sub-types themselves declared in `system.json` under `documentTypes`.

## Why, and why then

Foundry 14.365's server emitted this the moment it saw a `template.json` on disk
(`dist/packages/system.mjs`):

> System template.json is deprecated. System-provided Document types should be
> defined in system.json, and optionally be associated with a system data model.
> **Support for template.json will be removed in V16.**

It went into `packages.warnings`, which drives the warning badge on the system's
Setup-screen entry — so every installed user already saw a warning, and the system
would have broken outright on V16.

The window mattered more than the deadline. **There were no worlds built on Air
Bladder.** That made this a refactor with a test suite rather than a migration with
a compatibility story, `migrateData` shims and a release that could not be taken
back.

## What the migration actually found

The survey work was the point. Four things turned up that a straight
transcription of `template.json` into schema fields would have shipped as bugs.

### 1. `system.slots` carried two shapes under one name

| type | shape before | meaning |
|---|---|---|
| `character` / `hireling` | plain number | per-character equipment-limit override |
| `npc` / `container` | `{ value: N }` | carrying capacity |

`template.json` declared a plain number for npc/container while
`calcCurrentMaxSlots` read `.value` off it — which is why **NPCs could not hold
anything at all**. Four call sites wrote it in two shapes and two templates read a
third.

**Settled on a plain number everywhere**, 0 meaning "no override, use the Warden's
`max-equip-slots` setting". That also makes minting a container from a bought
transport a straight copy, since `Item.transport.slots` was already a plain number.

### 2. `system.cost` was being corrupted by six sheets

Every item sheet and the container sheet bound `name="system.cost.value"`, while
`template.json`, all 1047 pack documents and **every reader** (`marketplace.js`
×4, `character-generator.js`, `gear.js`) treat `cost` as a plain number. Editing
an item's Cost on its own sheet replaced the number with `{value: N}`, after which
the marketplace read its price as `NaN`. All six now bind `system.cost`.

### 3. Nine fields were persisted but never declared

The original survey concluded that everything undeclared was derived. That was
wrong. These are written through `update()` or bound to a sheet input, and a
strict schema would have dropped each one silently:

| type | fields |
|---|---|
| `character` | `description`, `notes` (both ProseMirror targets — the Notes tab), `slots` |
| `npc` | `background`, `gold`, `biography`, `notes` |
| `container` | `gold`, `biography` |
| `hireling` | `slots` |

`system.gold` on an npc is not cosmetic — `_calcGoldSlots()` runs for every actor
type, so an NPC hoard occupies slots.

### 4. `Item.item.armor` is load-bearing, not dead

The plan's first draft said to drop it. `calcArmor()` (`actor.js:315`)
deliberately sums `system.armor` over **both** the `armor` and `item` types, and
`items-list.html` renders the tag. No shipped item carries a non-zero value, but a
Warden's homebrew amulet can, and `tools/dev/e2e-data-model.mjs` now asserts it
(armor 2 + item 1 = 3).

`numberOfUses`, `relic`, and `slots` on `item`/`weapon`/`armor`/`spellbook` **are**
dead — verified individually, not as a group. They were stripped from the 381 pack
YAML files that carried them (427 lines) so `build:packs` → `extract:packs` stays
byte-stable; no importer re-adds them.

## The trap that nearly shipped

**`Document#toObject(false)` returns schema fields only.**

AppV1's `DocumentSheet#getData` hands templates `this.document.toObject(false)`,
and under a `TypeDataModel` that resolves against `this.constructor.schema`
(`common/abstract/data.mjs:826`). Every value `prepareData` computes onto
`this.system` — `slotsUsed`, `slotsMax`, `encumbered`, `armor`, `coinsPerSlot`,
`goldSlots`, `containerObjects`, `showBio`, and on items `isEquipable`,
`hasPlusMinus`, `isFatigue`, `grantLabel`, `icon` — became invisible to every
template at once. Nothing threw. The smoke test's only symptom was a tab reading
`Items ( / )` instead of `Items (0 / 10)`.

Both sheets now re-attach it in `getData()`. A DataModel assigns its schema fields
as own enumerable properties (`_initialize`, same file), so spreading the live
model yields stored + derived together as one plain object.

Fixed in passing, since it was the same line of enquiry: AppV1's context is
`{data, items, actor, …}` and every template reads `data.system.*` / `data.items`,
i.e. `context.data`. So *re-assigning* `context.items` — which the sorting and
content-localization passes did — never reached the rendered sheet; only the
in-place sorts did. `getData` now publishes the finished values onto `context.data`
before returning.

## Decisions taken

- **One `migrateData`, deliberately.** `CairnDataModel.migrateData` coerces
  `slots` and `cost` from `{value: N}` back to a number. This is not a legacy-world
  story — it is input coercion for two fields whose shape changed in this same
  commit, and without it any container minted by 0.1.0–0.1.4 fails validation
  outright rather than quietly.
- **Legacy `system.bond` deleted, not declared.** `bond`/`bondGold` were only ever
  read by `_effectiveBonds()`'s migration branch and cleared by three `update()`
  calls. All gone, along with `_replaceGrantedItems`' now-unreachable
  `legacyFallback` parameter.
- **Derived values stay undeclared.** Around thirty computed properties are
  assigned onto `this.system` in `prepareData`. That is the documented Foundry
  pattern and `toObject()` correctly ignores them. Declaring one would turn it into
  stored state and reintroduce the stored-vs-derived collision behind the Hit
  Protection data-loss bug.
- **`Actor.npc.armor` left alone.** Declared `NumberField({nullable: true})`
  because 202 of 205 monsters store `null`. It is also overwritten every
  `prepareData` by `_prepareNpcData` (`armor = calcArmor()`), so an authored value
  never reaches the sheet. That collision predates this migration and is not
  resolved by it.

## Guarding it from here

The failure mode is *silent field loss*: a field the schema forgets is dropped on
the next write with no error, no warning and no console output. Two new gates:

- **`npm run check:fields`** (`tools/dev/field-audit.mjs`) — loads the real schemas
  under a stub `foundry` global and diffs them against every persisted `system.*`
  path: sheet `name=`/`target=` bindings attributed per sub-type, `"system.x"`
  string literals in `module/`, and every `system` key in `src/packs`. Exits
  non-zero on an undeclared path; lists pack fields that will be dropped.
- **`npm run dev:data-model`** (`tools/dev/e2e-data-model.mjs`) — drives the live
  world: generation on all 20 backgrounds, a field round-trip on all four Actor
  and all seven Item sub-types (reading **source** back, since derived data would
  mask a drop), derived data reaching the sheet, armor derivation, the
  transport → container mint, and hireling generation.

Run both after any change to `module/data-models.js`.

## Verification (2026-07-28, Foundry 14.365)

`dev:smoke` (22 packs, 1095 docs, zero console errors) · `check:fields` ·
`check:traits` · `check:warden` · `i18n:check` · `dev:enc-damage` · `dev:kw-traits` ·
`dev:kw-reroll` · `dev:kw-guards` · `dev:data-model` — all passing. Pre-existing
container Actors carrying the old `{value: N}` shape load and report correct
capacity through `migrateData`.

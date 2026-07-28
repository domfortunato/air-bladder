# template.json → TypeDataModel migration

**Status: planned, not started.** Survey work done 2026-07-27; nothing in `module/`
has changed for it yet.

## Why, and why now

Foundry 14.365's server emits this the moment it sees a `template.json` on disk
(`dist/packages/system.mjs`):

> System template.json is deprecated. System-provided Document types should be
> defined in system.json, and optionally be associated with a system data model.
> **Support for template.json will be removed in V16.**

It goes into `packages.warnings`, which drives the warning badge on the system's
Setup-screen entry — so **every installed user already sees a warning**, and the
system breaks outright on V16.

The window matters more than the deadline. **There are no worlds built on Air
Bladder yet.** Today this is a refactor with a test suite. The moment somebody
builds a world on 0.1.4, the same change needs `migrateData` shims, a
compatibility story, and a release that cannot be taken back. Do it while it is
free.

## What actually has to happen

1. Declare sub-types in `system.json` under `documentTypes`.
2. Write `TypeDataModel` subclasses and register them on
   `CONFIG.Actor.dataModels` / `CONFIG.Item.dataModels` at `init`.
3. **Delete `template.json`.** The warning is triggered by the file existing, so
   declaring `documentTypes` alone does not clear it.

Types: Actor `character`, `npc`, `container`, `hireling`; Item `item`, `weapon`,
`armor`, `spellbook`, `object`, `background`, `transport`.

## Survey 1 — what the pack data actually contains

Taken from `src/packs/**/*.yml` (674 docs). This is what a schema must accept
without dropping or erroring, since these are the shipped documents.

```
Actor.npc        abilities(object) armor(null|number) description(string) hp(object)

Item.armor       armor cost quantity slots uses(object) + bulky equipped weightless description
Item.item        armor(null|number) blast bulky cost criticalDamage damageFormula description
                 equipped numberOfUses quantity relic slots uses weightless
Item.spellbook   bulky description equipped quantity slots weightless
Item.transport   bulky cost description equipped load quantity slots slow transportKind weightless
Item.weapon      blast bulky cost criticalDamage damageFormula description equipped quantity
                 slots uses weightless
Item.background  archetype containers description names source startingGear tables
```

**Three fields appear in pack data that `template.json` never declared:**
`slots`, `numberOfUses`, `relic` (and `armor` on plain items). They are inert —
nothing reads them — so the schema should simply not declare them and let them be
dropped. Confirm nothing reads them before deleting: `grep -rn "numberOfUses\|relic"`.

**`armor` is `null|number`** on both `Actor.npc` and `Item.item`. A
`NumberField({nullable: true})` is required, or those docs fail validation.

## Survey 2 — declared vs. used

48 fields declared in `template.json`. **29 more are read in `module/` or
`templates/` but never declared** — they are derived, computed onto the model
during `prepareData`:

```
armorOverridden bond bondGold characterEquipmentLimit coinRowLabel coinTip
coinsPerSlot containerObjects encumbered goldSlots grantLabel hasGoldThreshold
hasPlusMinus icon id isContainerItem isEquipable isFatigue maybeTooMuchGold
ownedBy showBio showContainersTab showDesc showFeatures showGoldNotCost slotsMax
slotsUsed useItemIcons usePanic
```

**This is fine and must stay that way.** Assigning a non-schema property onto a
DataModel instance in `prepareData` works and is the Foundry pattern; `toObject()`
serialises only schema fields, so derived values correctly never persist.

**One exception, checked individually:** `system.bond` is the only one of the 29
ever written through `update()` — at `actor-sheet.js:357` and `:381`, both clearing
the legacy singular bond to `""` as part of the old single-bond → `bonds[]`
migration. With no existing worlds there is nothing to migrate: **delete those two
writes and `_effectiveBonds()`'s legacy branch** rather than declaring `bond` in
the schema.

## Decisions to make while doing it

- **`system.slots` shape.** Currently broken (review finding #10): `template.json`
  declares a Number for npc/container, `calcCurrentMaxSlots` reads `.value`, and
  four sites write it in three different shapes. With NPCs unable to hold anything
  as a result, the schema is the place to settle it. Pick one shape, make all four
  writers and `container-sheet.html` agree.
- **Whether to fold in the 46 duplicate DOM ids.** Unrelated, but touches the same
  templates. Probably a separate commit.

## Test plan

The schema is strict, so the failure mode is *silent field loss*, not an error.
Guard against it by exercising every write path:

- `npm run dev:smoke` — 22 packs, 1095 docs, sheet renders, zero console errors.
- Generate a character on **every** background (`tools/dev/item-usage.mjs` lists
  them) and diff `toObject().system` against the pre-migration shape.
- Every actor type's sheet opens and round-trips a field edit: character, npc,
  container, hireling.
- Every item type's sheet: item, weapon, armor, spellbook, object, background,
  transport.
- `dev:enc-damage`, `dev:kw-{traits,reroll,guards}`, `check:traits`,
  `check:warden`, `i18n:check`.
- Marketplace buy/take, container grant + delete, hireling generate + re-roll.
- **Rebuild the packs and confirm 674 docs still load** — pack YAML carries fields
  the schema will not declare, so this is where silent dropping would show.

## Risks

- **Silent field loss** is the whole risk. A field the schema forgets is dropped
  on the next write with no error. The declared-vs-used survey above is the
  defence; redo it after writing the schemas and diff the two lists.
- The dev world's existing actors were created under the old model. They are
  disposable — but expect validation noise from them, and do not read that noise
  as a schema bug without checking against a freshly generated actor.

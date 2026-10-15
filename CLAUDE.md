# Air Bladder — a Cairn 2e game system for Foundry VTT

> Slimmed working notes. The full narrative — every reversal, date, review and
> measurement — lives in this file's git history and in `git log`. Nothing is lost.

**Tracked, and this repo is public** — so read it as candid working notes, not as
documentation. It records deliberate deviations and what each mistake cost, so the
same ground is not re-argued. Anything a *user* needs belongs in `README.md`;
anything a contributor needs to follow a process belongs in `docs/` or
`CONTRIBUTING.md`.

A Foundry VTT **game system** (not a module) implementing Cairn 2e, an OSR TTRPG by
Yochai Gal. Published at `domfortunato/air-bladder`, installed from the release
manifest. Descends architecturally from a private fork of
`yochaigal/Cairn-FoundryVTT` (still at `c:\Users\domin\code\Cairn-FoundryVTT`), but
is an independent system with its own `id`, content and history — **not** a git fork.

## Version reality

- **Minimum Foundry 14.365, `verified` 14.368.** `system.json`:
  `compatibility: {minimum: "14.365", verified: "14.368"}`. The AppV2 sheets use
  `_getFrameButtons`, `_canDetach`, `_onDetach`/`_onAttach`, confirmed only against
  14.365. A minimum nobody has tested is a claim, not a fact.
- **The minimum is stated in six places** — `README.md`, `README.es.md`,
  `CONTRIBUTING.md`, `site/index.html`, `docs/testing-dev-branch.md` and here.
  Change the minimum, change all six. Moving `verified` alone does NOT touch them
  (they state the floor, "or higher").
- **`verified` = the newest build actually proven green** (14.368, via `dev:upgrade`
  on `foundry/app-14368`), never whatever Foundry has released since. It is
  submitted by `npm run publish:foundry` and shown on the Marketplace listing.
- Latest release **0.1.24**. `system.json`'s `version` is bumped by `npm run
  release` on `master` only, so on `dev` it lags — read the tag, not the file.
  Update this line in the post-release master→dev sync, however that sync lands
  (merge or fast-forward).
- Node 24.x. `npm run release X.Y.Z` is the whole release — see `RELEASE.md`.
- **THE `id` IS `air-bladder` AND IS NOT CHANGING (CLOSED). Do not re-raise it or
  re-derive the cost.** Changing it publishes a different system: `world.json`'s
  `"system"`, the settings namespace (`SETTINGS_NS` — losing the `hireling-split`
  marker would convert every NPC into a hireling), flag scopes (every `grantSource`
  tag) and stored paths/uuids are all keyed on it in every existing world. What the
  question usually wants is the TITLE, which is free.

## Git: two branches, one direction

**`master` is the released state. `dev` is everything in progress.** All work goes
on `dev`. `master` only receives a merge from `dev` plus the release commit. `dev`
is permanent. Full model in `docs/git-flow.md`; summary in `CONTRIBUTING.md`.

- **No hotfixes, by policy.** Fixes ride the next release. When an urgent fix is
  asked for, **check `git log master..dev` first** — if `dev` holds only the fix,
  the ordinary release ships it. It is only hard when `dev` carries work that must
  NOT ship.
- **Topic branches off `dev`** only for work that outlasts the release cadence AND
  is broken in the middle. Lowercase-kebab, merge `dev` in regularly. CodeQL does
  not scan them.
- **Merge `master` into `dev` after every release** (the release commit bumps
  `system.json` on `master` only). This is the only master→dev sync.
- **`npm run release` refuses to run off `master`** and prints what it ships.
- CodeQL scans `dev`; Pages is master-only. Queue: `/compare/master...dev`.
- **Never tag or release on GitHub.** `origin` (Gitea) push-mirrors to GitHub and
  force-syncs; a GitHub-only ref is pruned. Tag on `origin`. Merge PRs locally,
  never with GitHub's button (`docs/i18n-maintainer.md`).
- **Release notes ride in the TAG.** `CHANGELOG.md` holds a `## X.Y.Z` section;
  `npm run release` refuses without one, writes it as the annotated tag body
  (`--cleanup=verbatim` is load-bearing), and `main.yml` creates the release from it.
  A Gitea release would not work — the mirror moves git refs only.
- **The user signs off every edit to `CHANGELOG.md` personally** — draft it in chat,
  land it on their word, never inside another commit.
- `npm run release X.Y.Z -- --dry-run` prints the body and runs on `dev`. **The `--`
  is npm's**; without it npm eats `--dry-run`. (`npm_config_dry_run` is honoured too.)
- **TWO ADDRESSES, ON PURPOSE (CLOSED).** `https://domfortunato.github.io/air-bladder/`
  is canonical (`system.json` `url`, READMEs). `airbladder.xyz` redirects to it and
  is used only where a person types it by hand (printed sheet footer
  `CAIRN.PrintCreditGenerated`, the age-formula hint). Not drift; do not raise.

## Architecture

Entry point `module/cairn.js` (registers document classes and sheets on `init`).
~13,100 lines of hand-written JS in `module/`. **`docs/architecture.md` is the map**
(import graph in nine tiers, spine files, leaf features). It names functions, never
line numbers — a number or line in prose is a copy that drifts; that lesson applies
to every count in this file. `docs/provenance.md` records who authored what.

**One system, two generators.** Cairn 2e and Barebones differ ONLY in how a
character is MADE. `content-source-2e` gates generation and nothing else: **a branch
on the content source outside character generation is a bug.** Barebones content
goes into the same type packs 2e uses.

### Documents and roles

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

### Damage, attacks, dice

- `module/damage.js`. **Two Scars tables, different lists**: the flow rolls
  `air-bladder.utils` Scars (prose); the sheet checklist is `tables-2e` Scars (12
  labels). The flow records the CHECKLIST row for the damage value and selects by
  range itself (no `draw()`/`roll()`); the tick handler keeps stored strings no box
  owns. The take-over door copies UTILS' Scars (`CAIRN_2E_TABLES`).
- **Improvised Attack** — permanent row atop the inventory, NOT an item document
  (so unremovable and slotless by construction). Gate `canImprovise` =
  `isOwner && !isThing` (one predicate; not `owned()`). Context flags must exist
  before gating on them — the sheet context has no `isOwner`. It is an `<a>`, so no
  `_onRender` re-enable. Description rides as `data-weapon`; kind is
  `data-unarmed="1"` (name kept — stored on cards). Blank field uses whole-sentence
  keys; possessive frame `CAIRN.DamageFromImprovisedWith`. Panic overrides the typed
  formula to `IMPROVISED_FORMULA` at ROLL time, before validation.
  `IMPROVISED_FORMULA` and `IMPAIRED_FORMULA` are deliberately two constants. No
  quality buttons. Claim a damage card as a ROLL message, never by being new.
- **Damage row dice** — `damageDiceIcons` (`utils.js`): one FA class per die, all
  glyphs in ONE anchor, all-or-nothing recognition (else generic `fa-dice-d20`),
  cap four glyphs applied INSIDE the term loop. Trait dice use
  `dieIconOrGeneric(table.formula)` off the resolved table.
- **Dice notation**: see Rules encoded. `evaluateFormula` rewrites `a + b` to
  `{a,b}kh` only when every term is a bare die.
- **Optional combat rules** (Hacks submenu): `exploding-damage-dice`,
  `fatigue-for-critical-damage`, `maneuver-on-max-damage`. Off by default, never
  greyed, read at roll time, **PCs only** (`type === "character"`). Read through
  `combatOption(key)`; the three PC damage sites call `combatDamageFormula`; guide
  `docs/optional-combat-rules.md`; gate `dev:combat-options`.
  - **`2d6kx` is right, `2d6xk` is the trap** — modifiers apply in written order.
  - **Explosion cap = half the faces less one**, written `x{cap}={faces}`
    (`explosionCap`). **`x2` alone is a TARGET**, not a cap. Per term.
  - `explodingDamageFormula` rewrites `d6 + d6` to `2d6kx` (appending `x` to a `+`
    pool inverts it). Mixed sizes are left un-exploded.
  - **A `+` pool is judged only while `use-cairn-dice-notation` is on**
    (`judgedDie` returns null otherwise). `judgedDie` is the one recogniser, no
    size floor: every die explodes, impaired and enhanced included.
  - Gate at the call site (`#onRollDamage`, `rollItemMacro`, improvised row);
    `warden-damage.js` is not one. Transform runs after `damageFormulaFor`.
  - Explosions announced by `nameExplodedDice` reading the message (one line per
    explosion); maximum adds one line via `nameManeuverAvailable` — damage always
    stands, melee AND ranged, `isContentVisible` first, `[data-maneuver]` trigger,
    no `!r.exploded` test. Lines glow red / teal (`--ab-maneuver-chat` aliases
    `--ab-fatigue-chat`).
  - `ranged` weapon field exists but nothing reads it; keep the field.
  - Fatigue choice pair: `mayAnswer`; `spend` writes the flag where it may and
    otherwise asks the GM via `CONFIG.queries["air-bladder.choiceTaken"]`. Record
    the choice BEFORE the Fatigue/status lands. `markChoiceTaken` draws the check
    per viewer. A card carrying `true` is left sealed, unmarked.
  - Knave 2e's maneuver list is NOT shipped or reworded.
  - **Do not rebuild**: the Crawler Combat Mode master, its Deprived/6 HP/Rest-roll
    rules, the Explode/Maneuver choice buttons, the d6 floor. `CAIRN.Crawler.*` keys
    and the `crawlerChoiceTaken` flag keep the old word on purpose; the Crawler
    ability tier is separate.

### Party folder and Dropped Item Pile (`module/party-pile.js`)

- Neither is a new type: the pile is an npc `role: container`. **Nothing is created
  on load** — folder on first Create of a PC, pile on first drop.
- **Found by flag, never by name — AND the pile must have no player owner**
  (`isDroppedPile` asks `!hasPlayerOwner`). A flag alone is not identity.
  `pileDisplayName` names it by its current name.
- **Drop sits beside the trash**, never instead of it. Not offered for Fatigue or a
  bound grimoire page; `withDrop` off on the pile.
- Confirm is a `DialogV2.wait` with a 25-char optional "where" note
  (`buildWhereField`, shared with the Fatigue drop); state `width: 400`; Drop is the
  default. Note stored `flags.air-bladder.droppedAt` → `system.droppedAt` (TOTAL
  assignment), clamped on the GM side, rendered only on the pile's sheet. Blank
  removes an old note.
- Drop icon `fa-down-to-line`; the hand means only "give to a person". Verify FA
  glyphs against the font — FA5-era names (`fa-map-marker-alt`).
- **The move runs on the active GM** via `User#query`
  (`CONFIG.queries["air-bladder.pileDrop"]`); trust only the server-authenticated
  user; GM checks the sender owns the source. No GM → refuse and say so.
- **Claim id is a fresh `randomID` per gesture** (`claimId`), never the item's id.
  Pile first, then delete from the sheet. A sibling-session `false` → check whether
  `claimId` landed.
- Pages travel with the book (`pagesOfGrimoire`), copy stowed. `reconcilePiles`
  copies only what the canonical pile lacks and deletes the extra only when all its
  ids are there. No drop from a compendium actor (`!actor.pack`). Pile is LINKED.
- Unlimited capacity is `calcCurrentMaxSlots` returning Infinity; sheet prints
  `slotsMaxLabel`. `party-pile.js` declares its own `FLAG_SCOPE` to avoid a cycle.
- Explicit folder wins; only characters default to Party. **There is no
  `FOLDER_CREATE` permission** — use `Folder.canUserCreate(game.user)`. Verify a
  permission or key by grepping the client, never by guessing the name.
- Deleting the pile: `CairnActor#deleteDialog` adds the item count.
- **Fatigue instead of Critical Damage**: asks for a drop only when already
  overburdened (`mustDropForFatigue` = `isEncumbered()`). Picker offers only
  `slotFreeingItems` (no petty, no Fatigue), sizes via `itemSlotCost`. Refusing
  ("No — take the Critical Damage", button with no callback) applies the Critical
  Damage; Escape is not a refusal; nothing to pay with = Critical Damage with no
  dialog. **The drop must have happened** before Fatigue lands. Drop is recorded in
  chat from a flag carrying the item name, rebuilt per viewer.

### Warden's Dashboard, time, calendar

- `module/warden-dashboard.js` — GM-only launcher; owns no rules. **A single-table
  draw posts CORE's own card** (`draw({displayChat:false})` then `toMessage`), or the
  encounter Add-to-scene button dies. Combined draws build their own, escaped.
  Button labels are UI keys; `labelForTable` walks every declaration. Draw cards
  carry `flags.air-bladder.dashboardDraw` and are relabelled per viewer
  (`localizeDashboardCard`). Showing a table: bare uuid over the socket, `senderId`
  guard, public card. AppV2 id: override `_initializeApplicationOptions`, not
  `get id()`. One root element per part. Gate `dev:warden-dashboard`.
- **Watches are core Cairn 2e and never gated; the Vald calendar is a hack**
  (`enable-vald-calendar`, `requiresReload`, converts nothing). Read the live
  `game.time.calendar`, never our literal. `ValdCalendar` overrides
  `_decomposeTimeYears` (core bug) and normalises negative weekdays in
  `timeToComponents`. `leapStart` must be 0; Reclamation season entry first;
  `yearZero: 7728` is FROZEN. Two upstream errata recorded in
  `docs/keeping-time.md`, not fixed.
- Clock goes before `#players` in `#ui-left-column-1` with `margin-top: auto`; no
  re-attach hook needed. It is chrome: copy core's per-theme values for both ground
  and ink. **Check chrome in BOTH interface schemes** via `game.configureUI`
  (`dev:theme`, strict surface). Dashboard time band is its own part
  (`parts: ["time"]`). No Make Camp button. Vald weather REPLACES Cairn's on the
  Dashboard.
- Date guards: Set the Date shows a live preview in DAYS (`describeDateAt`,
  `describeShift`, `componentsForDate`); calendar's Set-to-this-day confirms with
  Cancel default; `#selectionInView` is the one selection derivation. Number fields
  drop focus on wheel.
- `module/vald-calendar.js` (Vald only). **Festival text is CC BY-SA content and
  ships as a JournalEntry from `tools/import/vald.mjs`, not in `lang/`** — ask the
  licence question of any new content before choosing where it lives. Importer
  self-checks weekdays. Festivals found by FLAGS. Browsing state on the instance.
  `JOURNAL_BLOCKS`/`localizeJournalBlocks` live in `i18n-content.js`.
- `module/weather-log.js`, `module/calendar-events.js`: journals found by FLAG plus
  `isWardenJournal` (last writer a GM; unresolvable writer = unknown, fall back to
  document ownership). Demotion of the writing GM is NOT covered (stated). Never by
  a stored id (settings read-after-write is not guaranteed). Log written by the
  ACTIVE GM from `cairnWeatherChanged`, in the writer's language. "Hidden" journals
  are concealment, not secrets. Refresh on `updateJournalEntry`.
- Buttons that re-render need stable ids for focus restore; `_whileDisabled` checks
  `isConnected` then id, and reads `this.element`'s own document (Pop Out windows).
  **Any bare `document.` in a detachable AppV2 is a bug.**
- Dashboard layout: left-aligned labels in a glyph column; a glyph means one thing
  per window (`SEASON_ICONS` is the one map). **Font Awesome 7 Pro is bundled** —
  verify a glyph by rendering it (`::before` content), never by `all.min.css`.

### World-first tables, marketplace, take-over doors

- **Every table a generator declares resolves world-first** via
  `compendium.js` `findDeclaredTable` (world by name, then the declared pack). The
  `"pack;Name"` prefix is the FALLBACK, never a lock. **Read with `roll()`, never
  `draw()`** (`draw` marks world rows drawn): `rollTable` / `rollTableText` /
  `rollTablePlainText` (monster names). Pick-lists resolve the same way; trait
  dropdowns via `declaredTableCached` (not `findDeclaredTable` — too slow). Scars
  checklist stays pack-only. Kettlewright's Bonds matcher and `resolveVirtueVice`
  stay on the pack deliberately. `roll()` still skips drawn rows and saves a blank
  formula. Gate `dev:world-tables`.
- Random spells are a declared table (`characterGenerator2e.spells.canon` / `.glog`),
  rows type-filtered. **`more-spellbooks` is removed — do not restore it.**
  `SPELL_PACKS` names `background-items`. Gate `dev:spell-pool`.
- **Marketplace is world first** (`module/marketplace.js` `marketTables`): a world
  `Market: X` REPLACES that aisle, an unknown prefix ADDS one (the Bonds/Omens rule).
  The installer wipes the package directory, so edits to our compendium never
  survive. Price rides the item. Shop never draws. Gate `dev:marketplace`.
- `resortTableByName` / `fitFormula` via table-banner.js `onReadTableRowsChanged`
  on `createTableResult` + `deleteTableResult`, creating client only, world tables
  only, gated by `tableRole`. `keptAlphabetical` = aisles + the two spell-pool
  tables. Compare the STORED formula. Flat `1dN` tables only; curves are the
  Warden's.
- **Take-over doors** (`module/take-over.js`): Create a Custom Spell Table…,
  Marketplace…, Barebones Creation Tables…, 2e Backgrounds and Tables…; all at the
  top of Rollable Tables, the 2e one also on Compendium. Labels say the OUTCOME.
  The shipped compendiums are TEMPLATES.
  - **Plan, then run** — `importDocument` silently replaces on id collision;
    nothing calls it. Membership: items/mounts/background copies by shipped id
    (adopt via `_stats.compendiumSource`); tables by NAME only; `tableIdFor` uses
    the shipped id only while free.
  - Tables last, rows inline, `formula` explicit. Items into "Custom …" folders,
    a subfolder per source compendium (`sourceFolders`), found by flag.
  - Background copy stands in by id (`build2ePool` dedups by id); nothing written
    to `disabled-backgrounds`; `disabledBackgroundIds` / `isBackgroundDisabled` ask
    by id. World pack label stores the KEY (`customBackgroundsPackLabel`).
  - Enter never copies (all `type: "button"`, Cancel default). `running` set before
    the first await; doors disabled while a job runs (`setDoorsBusy`). Locked pack
    refused in confirm and result. Names come from documents (`namesFor`).
  - `resolveBarebonesResult` asks `!doc.pack` first so a world row wins.
  - Spell door replaced "Reseed a Spell Table" — **do not bring Reseed back**.
    Spec read at click time (GLOG swaps the pool). "Consistent with X" means X's
    mechanism.
  - Door CSS scoped to `.cairn-take-over`; Actor Directory buttons
    `min-width: fit-content` (labels wrap, never clip).
  - Gate `dev:take-over` (its entry sweep deletes copies made by hand in dev).
- **Table banner** (`module/table-banner.js`) — decided by NAME via `kindOfTable`;
  Warden only; names core's labels (`TABLE.ACTIONS.ChangeMode.Edit`,
  `TABLE.TABS.summary`, `COMPENDIUM.ImportEntry`); view-mode sentence; warns on two
  world tables of one name; `refreshTableBanners` re-injects DOM, never re-renders.
  Tables tab name from `RollTable` `labelPlural`, not `SIDEBAR.TabTables`. **Verify
  a core key by grepping the client for a reader, not en.json.** Gate
  `dev:table-banner`.

### Item sheets, GLOG

- GLOG sheet flags render only while `enable-glog-magic` is on: `showGrimoire` =
  hack on AND already a Grimoire (no item offers to become one). Spellbook GLOG box
  only while on; Scroll always. `rerenderItemSheets` rides the onChange.
  `spellbookCompact` / `.plain-item` grid variants. Gate `dev:glog-flags`.
- The GLOG hack is one-way for a campaign.

### Creation routes

- **Empty sheet ("Use random generation." cleared)**: one wrapper,
  `createActorInteractive`; `createCharacter`/`createNpc`/`createHireling`/
  `createMonster` stay NON-INTERACTIVE (probes call them). HP 3, abilities 10/10/10,
  Character Creation Mode on. **`HAND_BUILT_FLAG`: a hand-built sheet is handed
  NOTHING** (background, question, bond — all three bond paths — failed career, NPC
  background, hireling career incl. statblock and `critical`). Durable, not "while
  empty". Ways out: Roll Character with Background (clear AFTER
  `changeBackground` returns true, `ignoreHandBuilt`), ticking Starting gear,
  regenerate. `replaceFailedCareerKeepsake` takes `handBuilt` from its caller.
  Question-row gold zeroed. `blankIsFillableBy` withholds the box and the callback
  AND the broker ask it. `blank` coerced `=== true` over the relay. Gate
  `dev:blank-actor`.
- **Buttons say "Create"**, not "Generate". Faction dialog has pick-lists and a name
  field (`buildFactionPicks`, `createFactionInteractive`); `generateFaction(picks)`
  stays non-interactive. pl translation left drifted on purpose.
- Generated loadout arranged by `orderGrantedItems` (`module/gear.js`); `sort` is
  always read; later items append via `CairnItem.#appendSort`; bound grimoire pages
  stay at 0. Light sources by regex, fuel by exact map. Mundane grants tagged
  `background-mundane`; `BG_GRANT_SOURCES` is the pair sweeps ask for.

### Item offers (`module/item-offer.js`)

- A PC may offer to anything they can SEE; **no role list** (`canReceiveOffer`).
  Excluded: `.pack` and `.isToken` targets. `capacityVerdict` (gear.js) returns
  `overburden` only for a person; `full` refuses on every route. `_canDragDrop` must
  bind on npc sheets.
- Giving: `canGive`/`canOfferItem` use `isOwner`. One-click settle only when
  nobody ELSE could answer (`answerersFor`, which folds `ownership.default`).
  Unlinked tokens can give; missing giver reads `CAIRN.Offer.HiddenGiver`, never
  `speaker.alias`. Picker's checked radio follows its filter.

### Settings

- **Four `registerMenu` submenus** (`module/settings-menus.js`), every setting
  `config: false`. `SETTING_GROUPS` in `settings.js` is the one declaration;
  `INTERNAL_SETTING_KEYS` the only exemption. Values switched ON are written before
  OFF; each app has its own Reset Defaults. Search via `[data-searchable]` stamping.
  `hint` is optional. Update counts in the same commit as any settings change.
- **`registerSettings()` runs on `init`, before i18n** — `choices` labels must be
  bare keys (tier labels carry dice as literals, gated by `dev:pc-dice`).
- `subOptions` is a list (`[spec].flat()`).
- PC dice: `pc-ability-dice`, `pc-gold-dice` (tiers in `Cairn.pcDiceTiers`: Default
  3d6, Adventurer 4d6kh3, Crawler 2d6 + 3; `pcTierFormula` falls back),
  `pc-hp-formula`, `age-formula` (default RAW `2d20 + 10`; no clamp). **Count the
  call sites before wiring a setting into a roll** — `_applyRerollParts` calls
  `evaluateFormula` directly; one exported helper per value. Checklist tooltips:
  `data-tooltip` on label AND span, no `aria-label`. A bare number is a valid
  formula (`docs/dice-formulas.md`).
- `show-omens` hides 2e's Omen on sheet and print; `show-traits` likewise;
  `weather-log` default OFF (an update must never start creating documents).
- Removed settings stay removed (`show-containers-tab`, `show-gold-not-cost`,
  `show-container-actors`, `show-omens-barebones`, `show-bonds-barebones`,
  `show-features-section`, `enable-inventory-reorder`).

## Content translation and chat cards

- **Content translation is a display-only overlay** keyed on the ENGLISH source
  string (`lang/content/<lang>.json`, `module/i18n-content.js`). **Editing an
  English description orphans its translation.**
- Every list of names a user reads goes through it (`localizeDirectoryNames`,
  `worldDisplayName`, `wrapCompendiumDocumentSearch`, `_prepareTurnContext`,
  `localizeSpeakerName`). Rewriting names breaks SEARCH — apply
  `wrapTranslatedSearch`. PCs are never localized. Gate `dev:directory-i18n`.
- **A stored chat card is rebuilt per viewer from a flag carrying a KIND or an
  English source string, never text.** Examples: `damageCard`
  (`localizeDamageCard`, values sanitized, runs before `nameDamageSource`),
  `localizeD20Card`, `localizeStatusCard`, `localizeEncounterQty`,
  `localizeChangeLogCard`, `ROLL_FLAVOR_KEYS`. `localize()` returns unknown keys
  verbatim — whitelist kinds. Write `data-panic` as `"0"` or `"1"`; absence means
  "older than the attribute", leave alone.
- **Every rebuild in `renderChatMessageHTML` must ask `message.isContentVisible`
  first** — the hook fires for whispered rolls on clients that may not read them.
  Gate `dev:chat-privacy`. A sweep in this class covers every rebuild, and a claim
  that a sweep is finished is a copy that drifts.

## Deliberate deviations from Foundry practice

Listed so a review does not re-litigate them. Argue against the reason, not the fact.

- **Sheets are AppV2, no jQuery.** AppV2 lacks `.window-content` scrolling, 8px
  padding and `> * { flex: 1 }` — restored at the top of `css/cairn.css`; do not
  simplify away (`dev:sheet-layout`). `submitOnChange` is declared; `submitOnClose`
  no longer exists. Sheets follow the viewer's colour scheme — read
  `docs/theming.md` before touching a colour (`dev:theme`).
- **Containers and transports are Actors, not Items** — "+8 slots" cannot live on an
  Item. Expect bugs to cluster here.
- **No automation of mechanical text.** "Restores 1 STR" stays prose. Scoped to
  PLAYER-FACING rules; automating Warden logistics (e.g. encounter Add-to-scene) is
  allowed.
- **Content translation is a display-only overlay** keyed on English (above).
- **Pack YAML in `src/packs/` is the source of truth**; `packs/` is generated
  LevelDB, gitignored. Never edit `packs/`. `npm run build:packs` fails while
  Foundry has the world open.
  - **EXTRACT BEFORE YOU BUILD.** Once a Warden edits a compendium in Foundry,
    `packs/` holds the only copy; build rmSyncs it (5 hours of work lost once).
    `tools/packs.mjs` refuses a build when `packs/` changed since the last sync.
  - The guard compares against `.pack-sync.json` using `canonicalDoc` (meaning, not
    bytes). **Bump `MARKER_FORMAT` on any change to `canonicalDoc`.**
  - Drift that survives normalization is a REAL write — classify it before
    `--force`. A probe updating a pack doc in place leaves schema defaults; fix the
    data, do not widen `FOUNDRY_FILLED`.
  - **Never `extract` when `src/packs` is newer than `packs/`** — it reverts your
    work. Extract to a scratch directory and diff.
  - `extract` renames to `<Name>_<id>.yml`. To undo: `git checkout -- src/packs`
    THEN `git clean -fd src/packs`. Finish with `git status src/packs` clean.
  - The v14 schema fold-in is DONE; do not re-plan it.
- **`npm run backup`** snapshots `packs/` and both worlds to
  `foundry/backups/<stamp>/` (24 kept). Run it before anything that writes packs or
  world documents.
- **A negative control must never be a real write.** Defeat a fix IN-PAGE against
  planted documents, never by editing code that mutates a world on load.

## Foundry sources, in order of authority

- **The shipped client `C:\Users\domin\foundry\app\client\**` outranks everything**;
  it alone states removal versions (`logCompatibilityWarning {since, until}`). Cite
  file and line.
- Docs: `foundryvtt.com/api/`, `foundryvtt.com/article/`; `foundryvtt.com/releases/`
  for when an API landed.
- `github.com/foundryvtt/foundryvtt` is the ISSUE TRACKER — cite for known core
  bugs, never for intended API behaviour.
- `@foundryvtt/foundryvtt-cli` (`compilePack`/`extractPack`) is a devDependency.
- **Target is v14 and nothing older.** Deleting a v13 shim is in scope.
- Measure a field or key before trusting a reviewer's name for it (14.365 has no
  `_stats.createdBy`; the server stamps the creator as OWNER).

## Rules encoded — these are the game, not bugs

- Damage minus armor hits HP; overflow spills into STR, then forces a STR save. STR
  0 is death.
- Armor is hard-capped at 3.
- Slot inventory: bulky = 2, weightless = 0, times quantity (`itemSlotCost`, one copy
  shared with `calcSlotsUsed`).
- **Every Fatigue fills a slot.** Do not rebuild the free-first-Fatigue rule
  (`freeFatigueId`, `fatigueToClear`, `nextFatigueCost`). Gate `dev:enc-damage`.
- **Resting costs a ration — a HOUSE RULE, every table, PCs only.** Rest restores HP
  to MAX. Rations found by `RATIONS_RE` / `isRationName` (also accepts the overlay's
  translation of "Rations"), counted by uses. `CairnItem#spendUse()` returns a diff;
  the Rest is ONE actor write (HP + `items: [...]`) so ONE ledger card. No rations →
  a one-button prompt. PC confirm has no tip; PC tooltip is `RestRationTip`;
  `CAIRN.RestTip` stays for NPCs. Gates `dev:rest`, `dev:change-log`.
- **Encumbered = no free slot** (`slotsUsed >= slotsMax`) → HP 0. So does panic.
  **CLOSED: the threshold is not changing.**
- **Overflow is owed, never merely allowed.** A character may exceed the limit only
  for: generation and background grants; Fatigue (`ignoreCapacity: true`); an
  accepted gift after the recipient's informed confirm. A thing/companion/monster
  never overflows. Ordinary acquisition refuses (drop, Create Item, marketplace —
  greying is the affordance, `acquire` refusal is the enforcement). Marketplace
  carve-outs: petty items and transports.
- **Coins consume slots** (2e p.9): `ceil(gold/N) - 1`, N = coins-per-slot setting.
  One rule for every actor type.
- **Dice notation overloads `+`.** `2d8` = add. `d8 + d8` = keep highest.
  `2d20 + 10` = arithmetic. Keep-highest only when every term is a bare die.
- **A correct-sounding comment on contradicting code reads as verification.** Fix
  the comment with the code.

## Where intent is recorded

Commit messages — long, explaining *why*; treat `git log` as the design record.
`docs/` holds durable plans; `README.md` carries credits and licensing.

- **`docs/*.md` is canonical for documentation — never edit a journal.** Guides
  mirror into `journals-docs` via `tools/import/system-docs.mjs` (ROSTER names which);
  after editing a mirrored guide, rerun the importer and rebuild packs. Hints that
  name a journal by title break if it is renamed.
- **Journals are translatable only if player-facing**: `journals-2e`,
  `journals-glog`; not `journals-docs`. List: `TRANSLATABLE_JOURNAL_PACKS` in
  `tools/i18n/content-strings.mjs` (a new journal pack must be added). Split at
  paragraph level; blocks with `@UUID` are not translatable; `BLOCK_TAGS` and
  `JOURNAL_BLOCKS` must stay identical. Gate `dev:journal-i18n`.
- Interface keys with markup (`<strong>`) are set with `innerHTML`; `dev:dialogs`
  asserts the element.

## Licensing

**The inventory lives in `README.md` (canonical) and `LICENSE.txt`; `check:licence`
holds them in step.** Do not copy the list here.

- **Cairn's game text is ALWAYS CC BY-SA 4.0, wherever it sits (CLOSED).** The Code
  clause's path list says where this project's own code lives; it does not relicense
  Cairn text inside it. No per-file exception lists; do not raise "file X under a
  code path holds game text".
- **The Air Bladder logo is NOT Creative Commons** — all rights reserved, Lydia
  Comer, bespoke grant. Not the manifest cover (`media` absent on purpose).
- **Lydia Comer's galleries are CC BY-NC-SA 4.0.** She writes
  `art/lydia-comer/license.txt` — amend it BEFORE code that depends on it, never to
  match code. NC means the system cannot be sold while her galleries ship.
  `CREDITS.md` and `module/lydia-manifest.json` are GENERATED by
  `tools/import/lydia-comer.mjs`. Do not state counts in prose
  (`LYDIA_COUNT_SITES` gates the ones that exist). Format/size only, never
  cropping — house practice.
- **Moving art needs a migration** — image paths are copied onto documents.
  `migrateArtPaths` rewrites by prefix; `LYDIA_MOVED_MONSTERS` pins by filename.
  `dev` mirrors publicly, so "it never shipped" is only true of tags. `icons/` stays
  put.
- `icons/CREDITS.md` stays in step with `ICONS` in `tools/import/icons.mjs`; run the
  importer, never hand-add an SVG.
- **Character portraits are confirmed human-made** — keep the credit.
- **`lang/` is split by provenance**: inherited interface files MIT; Malecho's
  `lang/es.json` and `lang/content/es.json` CC BY-SA. **Those files are Malecho's —
  never edit them.** Placeholder parity is gated by `i18n:check`. Drift baselines
  are advanced by hand, never `--force`.

## No generated text a player or a Warden reads (ABSOLUTE)

No model-written table rows, flavour prose, or anything a die deals at the table —
in any file, `lang/` and `tools/` included. It is Cairn's, licensed from someone
else, or the maintainer's own. AI-assisted code is a separate, stated fact.
**Reach for the official Cairn table first**; if none exists, that is a
conversation, not a drafting exercise. **Rewording someone's list is copying it.**
The Stranger/Oddments generator was rolled back — do not rebuild it.

## Testing

**`docs/release-testing.md` is the full list** — keep it in step with
`package.json`. For the probe count run `npm run check:probes`.

- `npm run dev:smoke` — headless Chromium against the dev world; packs non-empty,
  a sheet renders, zero console errors.
- Offline: `check:refs`, `check:fields`, `check:traits`, `i18n:check`,
  `check:package` (artifact shape, with `--self-test`).
- `npm run dev:upgrade` installs the previous release and presses Update; it
  refuses port 30000 (that install is a symlink to this tree).
- **`system.json` `htmlFields` is a SECURITY control** — an `HTMLField` missing
  there is never sanitized. `check:fields` cross-checks; `dev:sanitize` proves it;
  the server reads `system.json` only at startup.
- `check:fields` holds pack provenance clean: `_stats.compendiumSource`,
  `duplicateSource`, `exportSource` together, and `ownership` only `default`.
  Check every member of a set the framework clears atomically.
- A probe that shadows `game.settings.get` must forward every argument and pass
  `{document: true}` to `ClientSettings.prototype.get` (`check:probes` enforces).
- **Probe rules, paid for:**
  1. A new test must FAIL with its fix removed.
  2. A precondition must not be satisfiable by stale world state.
  3. Fails once then passes = a **race**, not a flake.
  4. **Select a planted document by id difference, never by name.**
  5. On a timeout or a doubled write, check for orphaned `chrome-headless-shell`
     processes first — a kill from outside leaves Warden sessions parked.
  6. **A probe's cleanup runs from its catch**; stamp fixtures (`probeFixture`) and
     read a leg's own result by id difference.
- A probe's random range or single font size is a claim about the input space.
- Walk the Warden's view of a result; a passing probe is not that check.

## CLOSED — do not raise

- The `id` rename (`air-bladder` stays).
- Two site addresses (github.io canonical, `airbladder.xyz` redirect).
- Encumbrance threshold (no free slot = encumbered).
- Token linking default (persons linked, monsters not).
- Cairn game text is CC BY-SA wherever it sits.
- The v14 schema fold-in in pack YAML (done).
- Removed settings and the retired `container` type stay gone.
- Do not rebuild: Crawler Combat Mode master and its rules, maneuver choice buttons,
  free first Fatigue, Reseed a Spell Table, `more-spellbooks`, the Stranger
  generator.

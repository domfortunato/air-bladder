# The character sheet, item sheets, creation routes, item offers

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

## Item sheets, GLOG

- GLOG sheet flags render only while `enable-glog-magic` is on: `showGrimoire` =
  hack on AND already a Grimoire (no item offers to become one). Spellbook GLOG box
  only while on; Scroll always. `rerenderItemSheets` rides the onChange.
  `spellbookCompact` / `.plain-item` grid variants. Gate `dev:glog-flags`.
- The GLOG hack is one-way for a campaign.

## The character sheet: a rail and five pages (2026-11-19)

- Laid out after Base Knavery's (user ask): 480 x 700, pages turned from a
  thumb-tab rail hung off the frame (`module/actor/tab-rail.js`,
  `templates/parts/tab-rail.html`, a render PART drawn before `form`). Pages
  `character` (initial) · `items` · `growth` · `description` · (`containers`) ·
  `notes`; icons and tooltips in `CHARACTER_RAIL`, wording user-approved. The
  npc sheet keeps its strip and 600 x 750; a branch on actor type here is the
  design, not a smell. Characters ONLY get the rail part, the
  `cairn-railed` + `cairn-character-sheet` frame classes, and every new CSS rule
  is scoped under the latter, because the npc sheet shares `.resource-counter`,
  `.hp-counter`, `.tabs` and the items list.
- No gameplay change: every control kept its class, name, id and data-action.
  `#set-equipment-limit` moved from the Items tab label to page 1's Slots line.
  Rail buttons, the rail's Improvised Attack and the character's Die of Fate carry
  `data-always-live`; `_onRender` re-enables them after core's `_toggleDisabled`
  on a sheet the viewer cannot edit (turning a page is a read).
- Growth = Cairn's own "Growth" principle sentence (quoted), the Scars (moved off
  Description: `scar-block.html`, `showScars` false on a character) and a journal,
  `system.growth` (HTMLField, in `system.json` htmlFields; `dev:sanitize` writes
  it as a player). Cairn has no XP: do not add a level ladder.
- The rail's Improvised Attack is the row's own `improvisedAttack` action; no
  dialog of its own, no "advantage" (Cairn has Impaired and Enhanced).
- Gate `dev:sheet-rail`.

## Creation routes

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

## Item offers (`module/item-offer.js`)

- A PC may offer to anything they can SEE; **no role list** (`canReceiveOffer`).
  Excluded: `.pack` and `.isToken` targets. `capacityVerdict` (gear.js) returns
  `overburden` only for a person; `full` refuses on every route. `_canDragDrop` must
  bind on npc sheets.
- Giving: `canGive`/`canOfferItem` use `isOwner`. One-click settle only when
  nobody ELSE could answer (`answerersFor`, which folds `ownership.default`).
  Unlinked tokens can give; missing giver reads `CAIRN.Offer.HiddenGiver`, never
  `speaker.alias`. Picker's checked radio follows its filter.

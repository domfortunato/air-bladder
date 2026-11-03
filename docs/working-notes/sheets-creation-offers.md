# Item sheets, creation routes, item offers

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

## Item sheets, GLOG

- GLOG sheet flags render only while `enable-glog-magic` is on: `showGrimoire` =
  hack on AND already a Grimoire (no item offers to become one). Spellbook GLOG box
  only while on; Scroll always. `rerenderItemSheets` rides the onChange.
  `spellbookCompact` / `.plain-item` grid variants. Gate `dev:glog-flags`.
- The GLOG hack is one-way for a campaign.

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

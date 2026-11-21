# The character sheet, item sheets, creation routes, item offers

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

## Item sheets, GLOG

- GLOG sheet flags render only while `enable-glog-magic` is on: `showGrimoire` =
  hack on AND already a Grimoire (no item offers to become one). Spellbook GLOG box
  only while on; Scroll always. `rerenderItemSheets` rides the onChange.
  `spellbookCompact` / `.plain-item` grid variants. Gate `dev:glog-flags`.
- The GLOG hack is one-way for a campaign.
- **Grimoires are their own option since 2026-11-20** (`glog-grimoires`, user ask:
  spellbooks "should instead stay spell books but use the GloG magic dice"). Off by
  default, greyed under GLOG (the hacks group's `subOptions`, its first live-follow
  user); every reader asks glog.js `grimoiresEnabled()` (GLOG AND the option). On:
  the 2026-08 behaviour (books become scrolls; Grimoire Cast, Transmute and the
  Grimoire box). Off: `glogConversionDiff` swaps WORDING only, a canon book stays a
  book (create seam and Actor.create payload alike), generation rebuilds the GLOG
  pack's scroll-form spells as books (`spellbookItem`, gear.js), and a book's row
  offers Cast (`castSpellbook`, the scroll's `askMagicDice` window, the one
  `reportCast`, nothing spent). A world that had GLOG on keeps Grimoires
  (`seedGlogGrimoires`, marker `glog-grimoires-seeded`, before the ready hook's GLOG
  resume). Gate `dev:glog-books`; the probes that shadow GLOG on shadow Grimoires on
  with it.

## The character sheet: a rail and its pages (2026-11-19)

- Laid out after Base Knavery's (user ask): 480 x 700, pages turned from a
  thumb-tab rail hung off the frame (`module/actor/tab-rail.js`,
  `templates/parts/tab-rail.html`, a render PART drawn before `form`). Pages
  `character` (initial) · `items` · `growth` · (`containers`) · `notes`
  (`description` stood after `growth` until round 4); icons and tooltips in `CHARACTER_RAIL`, wording user-approved.
  Every other sheet took the same frame on 2026-11-20 (next section), so the
  rail part and the `cairn-railed` + `cairn-character-sheet` frame classes are
  on every actor sheet now, and a rule scoped under `.cairn-character-sheet`
  reaches the npc sheet too.
- No gameplay change: every control kept its class, name, id and data-action.
  `#set-equipment-limit` moved from the Items tab label to page 1's Slots line.
  Rail buttons, the rail's Improvised Attack and the character's Die of Fate carry
  `data-always-live`; `_onRender` re-enables them after core's `_toggleDisabled`
  on a sheet the viewer cannot edit (turning a page is a read).
- Growth = Cairn's own "Growth" principle sentence (quoted), the Scars (moved off
  Description: `scar-block.html`, `showScars` false on a character) and a journal,
  `system.growth` (HTMLField, in `system.json` htmlFields; `dev:sanitize` writes
  it as a player). Cairn has no XP: do not add a level ladder.
- The rail's burst and page 1's Attack button (under Die of Fate) open the
  ATTACK WINDOW, `askAttack` (utils.js), for EVERY attack. The first cut wired
  them to the improvised attack alone; the user corrected it the same day: "they
  are for all attacks". Who (the viewed scene's nameable tokens, the attacker's
  own out, the one current target preselected), with what (equipped items with a
  `damageFormula`, then Improvised), how (Standard (die) / Impaired / Enhanced).
  The improvised choice keeps the 2026-10-02 ruling, reaffirmed: no quality, its
  own Roll Damage. Panic offers Impaired alone. Rolls go through the rows' own
  paths, `_postWeaponDamage` / `_postImprovisedDamage`, so the card is the
  inventory's. Buttons off offer are hidden AND `type="button"` (implicit
  submission presses a hidden first submit). No "advantage" (Cairn has Impaired
  and Enhanced). The inventory rows keep their dice and the Improvised row.
  Gate `dev:attack`.
- Second round (user asks, 2026-11-19): the Attack button on page 1
  (`canImprovise`, `data-always-live`, the rail's red burst). Deprived over Panicked moved from the band to the vitals column, between
  HP and Slots (`.cairn-states`); the band is Gold alone. The Slots line and the
  Overburdened banner (`opensInventory`) carry `openInventory`, which waits out a
  double-click while `character-inventory-limit` is on, so the line's dblclick
  still sets the limit. The "For Use With Cairn" footer left Description for the
  foot of `.cairn-character`, under every page, as Base Knavery's Made for Knave
  footer.
- Third round (user asks, 2026-11-19): a character's Pronouns and Age stand
  under the name (`.identity-bio-line`, a row of the identity grid) and its trait
  sentence under Gold; `bioOnPageOne` keeps them off the Description bio-block.
  The npc sheet is unchanged. Trait pick-lists open by default on EVERY sheet
  (`_traitsCollapsed ?? false`, ruled for all sheets); a probe that clicks the
  toggle must check first, or it closes them.
- Fourth round (user asks, 2026-11-19). **The Description page is RETIRED**:
  the sentence went to the top of page 1's left column (above STR, 13px, the
  background description's size), its pick-lists into the TRAITS WINDOW, Omen
  (`parts/omen-row.html`, shared with the npc bio-block) and the character's
  own Description editor onto Background & Notes, in that order before the
  notes. A remembered `description` tab lands on Character (`_getTabsConfig`'s
  vanished-tab reset). `bioOnPageOne`, `showNotesDivider` and the character's
  bio-block include are gone; the npc sheet keeps its Description page, bio-block
  and +/- toggle.
- **A character's traits are edited ONLY in Creation Mode, by the Traits
  window** (user ruling): the pen at the sentence's end (`canEditTraits` =
  `generationEnabled && isEditable`; with no traits, beside the word "Traits")
  opens `#onEditTraits`, a modal DialogV2 rendering `parts/trait-grid.html` (one
  copy, also the npc bio-block's) from `_buildTraitRows`. Its die is the
  window's own `rollTrait` action: it fills the select and writes nothing. Save
  writes changed keys, rolled ones with `abNoStatusCard` (F57), hand picks
  without; × discards. Mode off, or player creation tools off: no pen, traits
  read-only on the sheet (the bond and question pickers' gate).
- The sentence is SENTENCE CASE: `_buildTraitSentence` lowercases each value
  (`toLocaleLowerCase(game.i18n.lang)`, after the overlay) and the English
  `CAIRN.Bio.*` nouns went lowercase; paper follows (`traitsProse`). Malecho's
  `es.json` keeps its keys' casing.
- Background is a LABELLED FIELD on both branches (`.background-label`, then
  `.background-field`, core's input box from core's variables); a generated
  name in Creation Mode runs `pickBackground` on a click. Background & Notes
  rules every `notes-item` after the first. The Slots line reads "Inventory
  Slots", or "Slots" where that clips, MEASURED in `#fitSlotsLabel` (render,
  fonts ready, a turn to Character).
- Fifth round (user asks, 2026-11-20; layout and wording the user's picks):
  ONE header row over STR, "Current" over the circle and "Max" over the max
  box (`.cairn-abilities-head`, an ability row's geometry so each word centres
  over its box); HP's numbers carry the same words (`.cairn-hp-head`); HP's
  number half FILLS in proportion to HP / max (`.hp-fill`, `hpPercent` and
  `hpPeril` in `_computeStatContext`), Base Knavery's bar colours as
  `--ab-hp-fill` / `--ab-hp-fill-low`, a red frame at 0; typing only, no
  step buttons. Inventory opens on "Click an item to expand its description"
  (`.cairn-expand-hint`, full ink, every sheet with an inventory).
- Sixth round (user asks, 2026-11-20): the hint shares the Inventory's first
  row with Fatigue's controls (`.cairn-items-top`, hint left, Fatigue right),
  and HP gets + and − after all, inside the box's "HP" half: + left of the
  label, − right (the user's order; `hpUp` / `hpDown`, `#onHpStep`). One
  point from the stored value, 0 to max; both off while encumbrance or panic
  derives HP to 0 (`#hpIsDerived`, the one statement `_processFormData`'s
  strip reads too). Tooltips "Gain 1 HP" / "Lose 1 HP".
- Gate `dev:sheet-rail`.
- Hold shield (user ask, 2026-11-20): an armor item ticked **Shield**
  (`system.shield`, default false; the shipped Shield, Hacked Shield and
  Steadymade Buckler ticked) gives the character sheet a "Hold shield" switch
  left of the Armor box (`.cairn-armor-row`, three columns so the box stays
  centred). Held = equipped, slung = not: the user's ruling, no new rule, so
  a press is the shield row's hand icon (`#onToggleShield`; off slings every
  held shield, on holds the first in inventory order). Existing copies are
  ticked once by exact English name or compendium source
  (`migrateShieldFlags`, marker `shield-flag-stamped`). The armor sheet's
  Shield box is its eleventh counter, so armor shares the plain-item grid's
  six counter rows. Gate `dev:shield`.
- **Shields are Bulky** (hack option `bulky-shields`, 2026-11-20, user ask): any armor
  ticked Shield costs two slots. Bulky is read through ONE `isBulky(system)`
  (utils.js) by all three slot formulas (`itemSlotCost`, `slotsNeeded`, the shop's
  `slotCost`) and every Bulky tag; items carry a derived `system.isBulky` beside the
  stored `bulky`, never over it (the item sheet submits its spread model). A hacked
  shield's Bulky box on the armor sheet is ticked and DISABLED with its reason, so
  it is never submitted. Reloads, like every slot-arithmetic setting. Gate
  `dev:shield` leg 5.
- **Hold light** (2026-11-20, user asks): `isHoldableLight` (gear.js) = a plain `item`
  whose name passes `isLightName` (the keyword rule OR a name in `LIGHT_SOURCES`, so the
  Glowsnail and Sun Stick count), never its fuel; `isEquipable` gains it, so a light gets
  the hand and held = equipped. The Armor row is Hold shield | Armor (a 48px circle since 2026-11-20) | the
  light BADGE, and the badge IS the Hold light control (the 172px column cannot hold two
  switches, the shield and a badge with text: user pick). ONE handler `#onToggleHold`
  (`data-hold`); several lights and none held asks which (`askWhichLight`, utils.js).
  Both controls are ALWAYS drawn; `none` disables with `CAIRN.HoldShieldNone` /
  `HoldLightNone`. The badge's icon (`lightIcon`, light-sources.js: torch / lantern-flame
  / candle-flame) is a LUMINANCE mask (game-icons are a white glyph on a black square),
  muted, accent + glow when held; its url goes through `foundry.utils.getRoute` — a
  relative url() in a custom property resolves against the STYLESHEET and 404ed. Radius
  text (`lightRadiusText`) from `module/light-sources.js`, the Torch file's numbers ruled
  the maintainer's; `check:refs` holds the two copies identical. `holdLight` (gear.js) is
  the ONE Torch call: Torch active + a token on the viewed scene, else nothing; a throw is
  swallowed and the hold stands. **Since review #35 the sheet never calls it**:
  `registerHeldLightSync` (gear.js, init) calls it on the client that made the change
  whenever a light's HELD state (`isHeldLight`: equipped, not broken) moves, by any route
  (switch, row hand, Broken, delete, gift, drop), queued per actor. It selects only a light
  in `LIGHT_SOURCES` (Torch does not throw on an unknown name; it lit another source) and
  never lights one whose counted uses are spent; a stow with another light still held
  lights that one. A row's hand holds one light at once, like the switch. Hold shield and
  Hold light work on EVERY creature (`#shieldsCarried` / `#lightsCarried` gate on
  `isThing`, the all-sheets plan's ruling 6). Torch is
  NOT installed on CT 123, so only the stubbed probe (`dev:shield` leg 6) has exercised
  the lighting. Hands full counts EVERY held light, the Lantern's "hands free" text
  notwithstanding (user ruling).
- **Hands full** (hack `hands-full`) and **Shields are d4 weapons** (hack
  `shield-weapon`), 2026-11-20, user asks: both read through the sheet's ONE attack
  gate `#attackWeapon` (`handsFull` / `handsBlock` in gear.js since review #35, which the
  hotbar macro reads too; `attackFormula` / `shieldDamage` in utils.js, a player
  character's shield only). The row annotations (`rollBlocked`, a shield's derived `damageFormula`)
  are on the context COPIES only; `#onRollDamage` refuses a blocked forced click rather
  than quick-rolling it, and `#openAttack` re-derives "Add the shield". Gate
  `dev:attack` legs 11-12. Open cosmetic question: the add-shield box sits under the
  whole list, so under "Improvised Attack".
- **Traits label + rule; Omen like a Bond** (2026-11-20, user asks): `.traits-label`
  RUNS IN as the sentence's first child (a line of its own pushed the footer out of
  480 x 700; user pick), in the one label-face rule; the trait sentence wears the notes
  page's rule under it, 4px either side. `dev:sheet-rail` leg 20 holds page 1 inside
  480 x 700 with the longest sentence, a shield and a light. `omen-row.html` has a heading row (`.omen-head`) and the
  text under it; on the character sheet the `<textarea>` keeps its name and the overlay
  anchor but loses core's box and joins the answers' indented rule; off,
  `.omen-display` joins the notes placeholder's rule. Gate `dev:sheet-rail` leg 20.
- **Weapon data** (2026-11-20): the pack Gnarled Staff is not Bulky and existing
  copies were fixed once (`migrateGnarledStaff`, cairn.js, EXPORTED for the probe;
  marker `gnarled-staff-unbulked`); the pack Sling is d6, owned copies untouched.
- The 2026-11-20 batch (user asks): the title bar's toggle reads "CharGen: On/Off"
  (its tooltips open "Character Creation Mode:", and the guides keep that name);
  the Inventory hint reads "Click an item to read its description." with a hand
  pointing down; − and + under each current ability circle
  (`.cairn-ability-current`, `#onAbilityStep`, one point from the stored value, 0
  to max, off at the bounds); the name at 28px in the same 46px row; the Attack
  window ends in Cancel. Broken items: `documents-and-roles.md`. Gates
  `dev:sheet-rail` leg 18, `dev:attack` leg 9, `dev:broken`.
- Same day, two cosmetic calls the user ruled on: each Barebones failed-career
  line hides while EMPTY outside Creation Mode (`showFailedCareerLine` /
  `showFailedCareerItemLine`; in the mode it stays for its dice; size unchanged
  at 15px), gate `dev:barebones` leg 11. The Attack window's improvised fields
  are one grid (labels' column `max-content`, form-groups `display: contents`)
  so "What are you attacking with?" stays on one line, and the window is 480
  wide so the input keeps its placeholder; gate `dev:attack` leg 5. HP's + and −
  wear `--ab-on-bar` (light theme had #111 on the black bar), gate
  `dev:sheet-rail` leg 17 — which re-renders after each `configureUI`, because a
  button already drawn keeps the ink of the scheme it was drawn in.
- Later the same day (user asks after walking it): on Background & Notes the Bond
  heading (its colon gone), each question, the Description heading and Omen's
  label share page 1's Background label in ONE face rule (layout split off, so a
  question wraps; Omen folded in after the walk showed it in bold sans),
  and each answer is indented on a 2px `--ab-accent` rule. "Saves" heads the
  ability names (`.head-saves`). On a CHARACTER, a row's damage roller and the
  Improvised row's open the Attack window on their own weapon (`askAttack`'s
  `preselect`, `#openAttack`); other sheets and a non-owner keep the quick roll.
  The four max boxes are DISABLED while CharGen is off, for everyone
  (`maxLocked`, read off the actor's own flag, not `generationEnabled`, which
  also folds in the Warden's player-randomization switch; the title bar reads the
  flag). Gates `dev:sheet-rail` leg 19 (its rule contrast measured against the
  parchment IMAGE, averaged, dev:theme's method — a colour-only walk falls to
  `<body>`'s black in light), `dev:attack` leg 10. `dev:combat-options` drives a
  character's Improvised row, so its driver expects the Attack window there and
  reads what is OFFERED (the window hides the quality buttons for Improvised).

## Every actor sheet in the character sheet's format (2026-11-20)

- User ask: "All character sheets should have the same format at style as the
  Player Character Sheet. This includes Monsters, NPC, Hirelings, etc." Seven
  rulings the same day, all built: every sheet 480 x 700 with the rail and the
  footer; a creature (npc, hireling, monster, companion) `character` · `items`
  · `description` · `notes`; a thing (container, transport) `character` ·
  `items` · `notes`, its prose on page 1; every sheet OPENS on page 1
  (`ITEMS_FIRST_ROLES` and the role-aware initial went; `initialTabId` is the
  list head, `tabIdsOf` picks the list); the max boxes lock while CharGen is off
  on npc / hireling / monster (`GENERATING_ROLES`), never on a companion;
  Hold shield and Hold light on every creature, never a thing, in the NPC
  wording (`CAIRN.HoldShieldNoneNpc` / `HoldLightNoneNpc` through `_wording`);
  page 1's rail tab is the role's own string (`ROLE_PAGE`, an icon per role),
  Description and Notes in `NPC_RAIL`.
- ONE mechanism: page 1's banners, stat block, slot line and footer are
  partials both templates render (`parts/status-banners.html`,
  `stat-block.html`, `slots-line.html`, `compat-footer.html`). The stat block's
  differences are context, not copies: `showTraitSentence` (every person's),
  `system.showGold` (a companion has no purse), `statMax` (the character's 18
  cap, absent on an npc), `holdShieldNoneKey`. The values only the character's
  page 1 read (`maxLocked`, `hpTip`, `goldTip`, `abilityHints`) are built in the
  npc branch by the character's rules; the rail tooltips are built for every
  sheet at the end of `_prepareContext`.
- npc-sheet.html keeps every head control's class, name, id and data-action
  (Role, Career / Background / Kind, Faction, the connection line, Day Rate),
  inside `.cairn-identity`; `cairn-npc-sheet` still scopes those head lines. The
  npc head gained the portrait's list button (the same `editPortrait`). The old
  grid, HP / Gold foot row and three-row abilities CSS went with their classes.
- Gates `dev:sheet-rail` legs 8 + 21 (one actor per role), `dev:sheet-layout`
  (every role's page 1 with the tallest head it can carry, the footer inside
  the window), `dev:roles` (the page order and the opening page, with an
  in-page control).
- **A person's page 1 IS the character's** (2026-11-20, user ask: "make the NPC
  and Hireling sheets look and act like the PC sheets as MUCH AS POSSIBLE";
  Pronouns and Age "placed exactly the same as a PC"). npc and hireling only
  (`showBiography`); monsters, companions and things unchanged. Pronouns and
  Age are ONE partial, `parts/identity-bio-line.html`, both sheets render under
  the name. `_prepareBiographyContext` sets `showTraitSentence` and
  `canEditTraits` for both callers (the character's call moved after its
  `generationEnabled`, which the pen reads), so a person gets the stat
  block's "Traits" sentence and, in CharGen, the pen and the Traits window (ten
  selects on an npc, eight on a hireling). The Description page keeps Scars and
  the prose (user pick A); `bio-block.html` is Omen/Scars only, and
  `toggleTraits` / `traitsCollapsed` and the die-less grid are gone. No name
  pick-list: `#onPickName` refuses npc and hireling by design. Gate
  `dev:sheet-rail` leg 24.
- **The Armor row redone** (same day, user asks): the Armor box is a 48 x 48
  circle with the ability circles' border (`.cairn-shield`, class kept), the
  label and number inside; Hold shield is a badge like Hold light's
  (`.shield-icon`, game-icons `shields/shield.svg`, one mask rule for both
  badges), "Hold shield" / "Shield in hand"; Hold light reads "Light in hand"
  while held. Icon routes `shieldIcon` / `brokenIcon` are built for every
  sheet beside `holdShieldNoneKey`. Gates `dev:sheet-rail` leg 25,
  `dev:shield` legs 3 and 6.

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

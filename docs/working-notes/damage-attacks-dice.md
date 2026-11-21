# Damage, attacks, dice

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

- `module/damage.js`. **Two Scars tables, different lists**: the flow rolls
  `air-bladder.utils` Scars (prose); the sheet checklist is `tables-2e` Scars (12
  labels). The flow records the CHECKLIST row for the damage value and selects by
  range itself (no `draw()`/`roll()`); the tick handler keeps stored strings no box
  owns. The take-over door copies UTILS' Scars (`CAIRN_2E_TABLES`).
- **HP the rules zero is never written** (the ruling is in CLAUDE.md, Rules
  encoded). The test is ONE getter, `CairnActor#hpZeroedByRule` (the HP everyone
  sees is 0 and the stored one isn't), read by both writers that work from the
  prepared value: `Damage.applyToTarget`, which sends the hit to STR and leaves
  stored HP alone, and `CairnActor#modifyTokenAttribute` (review #36), which
  drops a Token HUD bar entry for HP, relative or typed, while the 0 is the
  rule's. Before that override "-2" on the bar stored 0 over the real value. The
  sheet's own strip is `#hpIsDerived` in `_processFormData`.
- Damage to an ability (`Damage.applyToTarget`'s `pool` branch, the Warden's
  hazards) floors the rolled amount at 0: the Warden's formula may subtract
  ("1d4-2"), and a negative roll used to raise the score (review #36).
- **A weapon's hotbar macro has two forms** (`createCairnMacro` /
  `rollItemMacro`, macros.js): a world actor's id and the item's id, or, for an
  unlinked token's sheet, the item's uuid alone (review #36). A synthetic actor
  keeps its base actor's id and isn't in `game.actors`, so the two-id form
  rolled the world actor's copy. A uuid whose scene or token is gone reads as
  "no longer exists", never a throw.
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
- **Dice notation**: see CLAUDE.md, Rules encoded. `evaluateFormula` rewrites `a + b` to
  `{a,b}kh` only when every term is a bare die.
- **Saves** — one rule, `cairnSavePasses(natural, passedByTarget)`: a natural 1 always
  saves, even against an attribute of 0, and a 20 always fails (by the book, ruled
  2026-11-01, review #34 F239). DEX 0 is decided in initiative alone (`combat.js`):
  paralysed, unable to act, so it fails without the die deciding. Gate `dev:combat`.
- **Optional combat rules** (Hacks submenu): `exploding-damage-dice`,
  `fatigue-for-critical-damage`, `maneuver-on-max-damage`. Off by default, never
  greyed, read at roll time, **PCs only** (`type === "character"`). Read through
  `combatOption(key)`; the three PC damage sites call `combatDamageFormula`; guide
  `docs/optional-combat-rules.md`; gate `dev:combat-options`.
  - **`2d6kx` is right, `2d6xk` is the trap** — modifiers apply in written order.
  - **Explosion cap = half the faces less one**, written `x{cap}={faces}`
    (`explosionCap`). **`x2` alone is a TARGET**, not a cap. Per term.
  - `explodingDamageFormula` rewrites `d6 + d6` to `2d6kx` (appending `x` to a `+`
    pool inverts it). Mixed sizes are left un-exploded — EXCEPT an explicit
    keep-highest pool of judged dice, `{1d6,1d4}kh` (`judgedPool`, 2026-11-20, the
    shield added under "Shields are d4 weapons", built by `shieldPoolFormula`, never
    as `+`): under the exploding option it KEEPS FIRST, THEN EXPLODES (user ruling
    2026-11-20, revising that morning's explode-each-then-keep): rolled unexploded,
    then `explodeKeptPoolDie` marks the kept die's maximum `exploded` and adds its
    capped chain (`{a,b}kh + 1dFx…`); `combatDamageFormula`'s `explodeKept` tells
    the three call sites, which all call `settleKeptPool` (review #35): on a TIE the
    FIRST member, the weapon's die, is kept (user ruling 2026-11-20), then the kept
    die explodes. Every die of a summed kept member at its maximum explodes, sharing
    one cap (`{2d6,1d4}kh`, as `2d6x2` unshielded). `shieldPoolFormula` puts a
    hand-written mixed `+` weapon in as one member per die term (notation on), so it
    stays keep-highest. The hotbar macro refuses a player character's Broken weapon
    (`CAIRN.Macro.Broken`) and one Hands full blocks (`CAIRN.HandsFullNote`). The card's maneuver line and explosion lines follow the
    KEPT member (`keptPoolOf` / `judgedCardDie` / `explodingDiceOf` in cairn.js),
    user rulings.
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

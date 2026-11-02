# Damage, attacks, dice

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

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

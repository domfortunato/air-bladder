# Monster generation — the design of record

`module/monster-generator.js`, reached by the Warden-only **Generate Monster**
button in the Actors directory and by the Roll header button on any
monster-role NPC. This file records every number and rule in that module and
why it is what it is; change one without the other and the next reader
re-derives it wrong. The probe (`npm run dev:monster-gen`,
docs/release-testing.md) asserts the shape this document promises.

## Sources, and the licensing

The procedure is the SRD's **"Creating Monsters"** (Warden's Guide, Yochai
Gal, **CC BY-SA 4.0**) — everything *above* its "Converting Monsters" heading,
and nothing below it, by explicit decision (2026-08-01). The four d20×2 tables
it prescribes (Appearance, Traits, Attacks, Abilities) already ship as the
eight RollTables of the `warden-monsters` pack, under the same CC BY-SA
regime LICENSE.txt already declares for the Warden table text. **No new
tables were authored**; the generator rolls the shipped ones, configured as
`Cairn.monsterGenerator` in `module/config.js`.

The stats layer below is ours: the SRD gives stat guidance as prose, not
dice, so the weights are a house realization of that prose.

## The rules encoded

- **Monster is a role, not a type.** A generated monster is `type: "npc"`,
  `system.role: "monster"` — the same decision that retired the `container`
  type. The fork never had a Monster type either; its 205 monsters are
  npc-typed documents, which is where our monsters pack came from.
- **roll(), never draw().** The eight tables are the WARDEN'S tables. A draw
  marks results drawn and dirties the state a Warden sees at their own table;
  `rollTableText` uses `table.roll()` only, the same invariant
  `rollNameFromTable` documents. The probe delta-checks drawn state around a
  generation.
- **The tier picker is also the confirmation.** Create: dismiss = create
  nothing (a ✕ is an instruction — the issue #6 rule). Re-roll from the sheet
  header: the same picker opens with regenerate wording, dismiss touches
  nothing, and a button press replaces stats/items/description while
  **keeping name, portrait and token art** by omission — the
  gorilla-into-alchemist guard, monster edition, without stacking a confirm
  in front of a picker.
- **Mechanical text stays prose.** Critical damage, the ability, the quirk
  and the weakness are description bullets, never automation. House rule.
- **Scars and STR saves apply to monsters** (ratified 2026-08-01). The damage
  flow has no actor-type gate on purpose: overflow past HP offers the STR
  save, damage landing exactly on 0 HP rolls a Scar. The comment in
  `module/damage.js` records it so a review does not "fix" it.

## Tiers — the SRD's HP prose as a table

| Tier | HP | Attack die | Armor chance | Armor value weights |
|---|---|---|---|---|
| standard | 3 | d6 | 25% | 1 |
| hardier | 6 | d8 | 50% | 1 (×3), 2 (×1) |
| serious | 10 | d10 | 75% | 1 (×2), 2 (×2), 3 (×1) |

"Standard creatures get 3 HP, hardier ones 6 HP, serious threats 10+." The
attack die rides the tier because the shipped pack's monsters cluster
d6/d8/d10. **Random** (the picker's default button) weights the tiers 3:2:1 —
mooks common, bosses rare.

## Abilities — the 3/6/10/14/18 ladder, weighted

Scores come only off the SRD's ladder (3 deficient / 6 weak / 10 average /
14 noteworthy / 18 legendary), never 3d6 — that is what distinguishes monster
stats from NPC stats.

| Draw | 3 | 6 | 10 | 14 | 18 |
|---|---|---|---|---|---|
| WIL always, STR at standard | 1 | 3 | 8 | 3 | 1 |
| STR at hardier | — | 2 | 8 | 4 | 2 |
| STR at serious | — | 1 | 5 | 6 | 4 |
| DEX, every tier | — | 3 | 10 | 3 | — |

STR shifts up with tier (a serious threat that folds to one sword blow is not
serious). DEX starts at 10 per the SRD and never hits the extremes — speed is
texture, not what makes a monster deadly.

## Attack, armor, description, name

- **One attack item**, `type: "item"`, `equipped: true`, damage die from the
  tier. Its name is the Attack (Type) verb **verbatim plus `*`**
  (`"Bites*"`) — singularizing is English morphology and would break the
  moment the key is translated, and the `*` is the pack's marker for an
  attack whose special effect lives in the description, which is always true
  here because a Critical damage bullet is always written.
- **Armor arrives as an equipped item** so the actor's Armor DERIVES via
  `calcArmor`, exactly like the 205 pack monsters (`system.armor` stays
  null). It is named after the rolled Feature when the feature IS the armor
  (Carapace / Shell / Scales), else "Tough Hide". Values are 1–3 by
  construction; the house cap of 3 holds regardless.
- **The description** is five bullets from `CAIRN.MonsterGen.Desc*` format
  keys — appearance, quirk, weakness, ability (Power + Target), and
  "**Critical Damage:** …" — each rolled string HTML-escaped (a Warden can edit
  the world copies of these tables into anything). Since 2026-08-02 the four
  labelled bullets carry a **bold label**, no bullet ends in a period, and the
  inserted roll is lowercased at the format call (never in the variable —
  `ARMORED_FEATURES` matches the raw English roll); only the leading "A …" of
  the appearance bullet keeps a capital. The markup is
  **ProseMirror-canonical** (`<ul><li><p>…</p></li></ul>`, no newlines), NOT
  the pack's `<li>…<br></li>` shape: the sheet's root element is its form, so
  every frame-button click submits it, and a description the editor
  re-serializes differently turns that submit into a real write — the
  document rewrote itself on the first click of any header button. Observed
  2026-08-01 via a preUpdateActor logger; the probe's decline leg is what
  caught it.
- **The name** composes the Appearance rolls through
  `CAIRN.MonsterGen.Name` ("{physique} {feature} Creature"). The SRD's step 5
  — "Thunder Snail" — is creative interpretation and cannot be automated; the
  composed name at least lands every monster in the directory
  distinguishable, and the Warden renames when inspiration strikes.
- **Portrait**: a uniform random pick over the game-icons creature categories
  (`animals, creatures, fish, heads, mammals, reptiles, skull` — a constant,
  not a manifest scan, because "tools" is a category too), falling back to
  `icons/monster.svg` when the manifest is unavailable. The token wears the
  same image; `prototypeToken` follows the pack convention — hostile,
  unlinked, STR and HP as the bars.

## What deliberately does NOT exist

- No new Actor type, no new sheet, no new compendium content.
- No automation of the critical damage, ability, quirk or weakness text.
- No `lang/es.json` entries — the new `CAIRN.MonsterGen.*` keys are en-only
  until the translation contributor takes them, like every key added since.

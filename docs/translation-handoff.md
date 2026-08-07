# Translation handoff — Spanish

For **fsmalecho**. Regenerated each release cycle; this edition covers everything
outstanding as of the unreleased `dev` branch (after 0.1.11).

Counts right now: **593** English keys, **533** in `lang/es.json`, **60** untranslated,
**0** orphaned. Nothing was renamed or deleted this cycle, so no existing
translation has lost its key.

Only two files are yours and only you should edit them: `lang/es.json` (interface)
and `lang/content/es.json` (the content overlay). Nothing in this list asks you to
touch anything else.

---

## Part 1 — CHANGED English (5 keys). Do these first.

**These are the urgent ones, and they are not the usual kind of outstanding work.**
Each key below already has a Spanish translation, so no tool reports it as missing —
but the English changed underneath it. The Spanish is not out of date, it is now
*wrong*: it still answers to the key while promising something the English was
deliberately changed to stop saying. No gate can see this, and the TSV export marks
these rows `done`.

### `CAIRN.BgAuthor.SourceHint`

- **was (EN):** Give this an archetype so it groups in the character-creation picker, and enable "Offer GM's Custom 2e backgrounds" in Settings so it appears there.
- **now (EN):** Give this an archetype so it groups in the character-creation picker, and enable "Offer custom Cairn 2e backgrounds" in Settings so it appears there.
- **your current ES:** Asignale un arquetipo para que aparezca agrupado en el selector de creación de personajes, y activa "Ofrecer trasfondos personalizados de 2.ª edición" en «Configuración» para que aparezca allí.

### `CAIRN.Scars`

- **was (EN):** Got a scar
- **now (EN):** Got a scar!
- **your current ES:** Obtienes una cicatriz

### `CAIRN.Settings.ContentSource2e.label`

- **was (EN):** Offer Cairn 2e character sheets
- **now (EN):** Offer canon Cairn 2e backgrounds
- **your current ES:** Ofrecer hojas de personaje Cairn 2e

### `CAIRN.Settings.ContentSourceCustom.hint`

- **was (EN):** Include custom 2e backgrounds — backgrounds not published in the Cairn 2e Player's Guide: the shipped Backgrounds (Custom) compendium plus any GM-authored ones from your world's compendiums. They appear in their own picker section; turn off 'Offer Cairn 2e character sheets' to generate only from custom ones.
- **now (EN):** Include custom 2e backgrounds — backgrounds not published in the Cairn 2e Player's Guide: the shipped Backgrounds (Custom) compendium plus any GM-authored ones from your world's compendiums. They appear in their own picker section; turn off 'Offer canon Cairn 2e backgrounds' to generate only from custom ones.
- **your current ES:** A la hora de crear un personaje, incluye los trasfondos de la 2.ª edición creados por el Guardián que figuran en los compendios del mundo. Aparecerán junto a los trasfondos de Cairn 2.ª edición incluidos en el juego; desactiva la opción «Ofrecer hojas de personaje Cairn 2e» para generar personajes únicamente a partir de tus trasfondos caseros.

### `CAIRN.Settings.ContentSourceCustom.label`

- **was (EN):** Offer Custom 2e backgrounds
- **now (EN):** Offer custom Cairn 2e backgrounds
- **your current ES:** Ofrecer trasfondos caseros 2e

**Read these four together — two of them quote the other two.**
`CAIRN.Settings.ContentSourceCustom.hint` and `CAIRN.BgAuthor.SourceHint` each quote a
settings label by name. Whatever you choose for `ContentSource2e.label` and
`ContentSourceCustom.label` has to be pasted **verbatim** into the two hints, or the
hints will tell a Warden to look for a setting that is not on the menu.

That is already true today, before this change: your `BgAuthor.SourceHint` says
«Ofrecer trasfondos personalizados de 2.ª edición» while the setting itself is labelled
«Ofrecer trasfondos caseros 2e». Two names, one control. Fixing that is part of this row.

`CAIRN.Scars` gained an exclamation mark and nothing else — it is on the list only
because you may want the Spanish to match the new tone. The other five locales are in
the same position.

---

## Part 2 — NEW, untranslated (60 keys)

Ordinary outstanding work: these have no Spanish at all, so a Spanish client currently
falls back to English for them. Nothing here is urgent.

### Archetype (1)

| key | English |
| --- | --- |
| `CAIRN.Archetype.Custom` | Custom 2e Backgrounds |

### DamageQuality (10)

| key | English |
| --- | --- |
| `CAIRN.DamageQuality.BadgeEnhanced` | Enhanced |
| `CAIRN.DamageQuality.BadgeImpaired` | Impaired |
| `CAIRN.DamageQuality.BadgePanic` | Impaired (Panic) |
| `CAIRN.DamageQuality.DefaultTip` | Default — press Enter to pick it. |
| `CAIRN.DamageQuality.Enhanced` | Enhanced ({formula}) |
| `CAIRN.DamageQuality.Impaired` | Impaired ({formula}) |
| `CAIRN.DamageQuality.Prompt` | Is this roll standard, impaired, or enhanced? |
| `CAIRN.DamageQuality.Standard` | Standard ({formula}) |
| `CAIRN.DamageQuality.Title` | Damage roll |
| `CAIRN.DamageQuality.TitleWeapon` | Damage roll — {weapon} |

### DamageTargets (4)

| key | English |
| --- | --- |
| `CAIRN.DamageTargets.Foes` | Monsters & NPCs |
| `CAIRN.DamageTargets.Party` | Player characters |
| `CAIRN.DamageTargets.Prompt` | Who takes this damage? Everyone ticked takes the full roll. |
| `CAIRN.DamageTargets.Title` | Apply damage to… |

### GameIconCategory (10)

| key | English |
| --- | --- |
| `CAIRN.GameIconCategory.Bags` | Bags |
| `CAIRN.GameIconCategory.Boards` | Board Games |
| `CAIRN.GameIconCategory.Flag` | Flags |
| `CAIRN.GameIconCategory.Food` | Food |
| `CAIRN.GameIconCategory.Glass` | Glass |
| `CAIRN.GameIconCategory.Lock` | Locks |
| `CAIRN.GameIconCategory.Masks` | Masks |
| `CAIRN.GameIconCategory.Pirate` | Pirates |
| `CAIRN.GameIconCategory.Smoke` | Smoke |
| `CAIRN.GameIconCategory.Sounds` | Sounds |

### General (17)

| key | English |
| --- | --- |
| `CAIRN.ApplyDamageChoose` | Apply damage — choose who takes it |
| `CAIRN.AttacksTarget` | {attacker} attacks {target}! |
| `CAIRN.AttacksTargetWeapon` | {attacker} attacks {target} with {weapon}! |
| `CAIRN.BgPickDisable` | Disable this background — players won't see it and it can't be rolled |
| `CAIRN.BgPickEnable` | Enable this background |
| `CAIRN.BgPickFootLink` | Creating custom backgrounds |
| `CAIRN.BgPickFootQuestion` | Want backgrounds of your own? |
| `CAIRN.DamageApplied` | Damage applied: {list} |
| `CAIRN.DamageAppliedEntry` | {dmg} to {target} |
| `CAIRN.DamageBreakdown` | {dmg} ({damage} damage − {armor} armor) |
| `CAIRN.DamageFrom` | from {attacker} |
| `CAIRN.DamageFromHazard` | from {source} |
| `CAIRN.DamageFromWeapon` | from {attacker}'s {weapon} |
| `CAIRN.ScarFlavor` | Takes a scar! |
| `CAIRN.StabilizedBanner` | no longer critically wounded. |
| `CAIRN.StabilizedStatusFor` | Stabilized — {key} |
| `CAIRN.StatChange` | <s>{from}</s> => {to} |

### Notify (10)

| key | English |
| --- | --- |
| `CAIRN.Notify.ApplyDamageWardenOnly` | Only the Warden can apply damage. |
| `CAIRN.Notify.DamageAlreadyApplied` | This card's damage has already been applied. |
| `CAIRN.Notify.EffectsUnsupported` | Air Bladder doesn't use Active Effects — nothing on the sheet would show it. The drop was refused. |
| `CAIRN.Notify.LastBackground` | At least one background must stay enabled. |
| `CAIRN.Notify.LastSource` | At least one background source must stay enabled — Cairn 2e has been switched back on. |
| `CAIRN.Notify.NoFatigueOnThing` | {name} can't carry Fatigue — Fatigue belongs to a character, not to a container or transport. |
| `CAIRN.Notify.NoTargetsToSelect` | This roll had no targets, so there is nothing to select. |
| `CAIRN.Notify.NoTokensToDamage` | There are no creatures on that card's scene to apply this damage to. |
| `CAIRN.Notify.WardenDamageBadFormula` | "{formula}" is not a damage roll — try 1d6, 2d6 or 3. |
| `CAIRN.Notify.WardenDamageWardenOnly` | Only the Warden can deal damage from a trap or the environment. |

### WardenDamage (8)

| key | English |
| --- | --- |
| `CAIRN.WardenDamage.Formula` | Damage |
| `CAIRN.WardenDamage.Hint` | Damage from a trap, the environment or a condition. Anyone you have targeted takes it; with nothing targeted, the card's splat asks who. |
| `CAIRN.WardenDamage.Pool` | Applies to |
| `CAIRN.WardenDamage.Roll` | Roll damage |
| `CAIRN.WardenDamage.Source` | Source |
| `CAIRN.WardenDamage.SourcePlaceholder` | Spiked pit |
| `CAIRN.WardenDamage.Title` | Warden's damage |
| `CAIRN.WardenDamage.Tool` | Warden's damage — traps, environments, conditions |

Two notes on specific strings:

- **`CAIRN.DamageFromWeapon` keeps the possessive inside the string** ("from
  Lisbeth's crossbow"). English builds that with `'s`, which Spanish does not have, so
  you get the whole sentence and can write "de" wherever it belongs. Same reasoning as
  `CAIRN.AttacksTarget`.
- **`CAIRN.DamageQuality.*` is a complete group** — there is no `.Normal` key. It was
  renamed to `.Standard` along with the English copy, so do not look for the old name.

---

## Part 3 — content overlay: 24 finished translations that ship dead

> **UPDATE 2026-08-07 — you do not have to do this by hand any more.** The
> extractor now keys on what the runtime actually asks for, and the pre-fill
> looks up the old entity form on a miss, so a normal
> `npm run i18n:extract && npm run i18n:import -- --lang es` re-keys all 24 and
> keeps every Spanish value byte-identical. Verified by simulation before it
> shipped: 24 re-keyed, 0 left dead, nothing lost. The list below is kept so you
> can see what was affected — treat it as a record, not a task.

**No retranslation needed. This is a re-keying job, and the Spanish text does not change.**

`lang/content/es.json` is keyed on the English source string. For these entries the key
was captured with HTML entities (`&mdash;`, `&rsquo;`) that no longer appear anywhere in
the source — it now carries the real characters (`—`, `’`). So the runtime asks for a key
that no longer exists and your finished Spanish never renders. `i18n:check` currently
files these as advisory, which understates it.

The fix is to decode the entity in the **key** and leave the value byte-identical:

```
&mdash;  ->  —   (U+2014 em dash)
&rsquo;  ->  ’   (U+2019 right single quote)
```

### `monster.desc` (2)

- `<ul> <li style="box-sizing: border-box; margin: 0.25em 0px;">10&rsquo; long, aggressive predatory turtles that lurk in t`
- `<ul> <li style="box-sizing: border-box; margin: 0.25em 0px;">Bulky, domestic-only breeds with a ferocious nature.</li> <`

### `table.result` (22)

- `<strong>Aid</strong> &mdash; They could be hurt and need medical aid of some sort.`
- `<strong>Directions</strong> &mdash; They are lost and need directions somewhere, or help being escorted there safely.`
- `<strong>Discovery</strong> &mdash; The party finds food, treasure, or other useful resources. The Warden can instead cho`
- `<strong>Encounter</strong> &mdash; Roll on an encounter table for that terrain type or location. Don&rsquo;t forget to r`
- `<strong>Encounter</strong> &mdash; Roll on an encounter table. Possibly <strong>hostile</strong>. (See <em>Warden: NPC -`
- `<strong>Environment</strong> &mdash; A shift in weather or terrain.`
- `<strong>Environment</strong> &mdash; Surroundings shift or escalate. Water rises, ceilings collapse, a ritual nears comp`
- `<strong>Exhaustion</strong> &mdash; The party encounters a barrier, forcing effort, care or delays. This might mean spen`
- `<strong>Exhaustion</strong> &mdash; The party must rest (triggering another roll on this table), add a <strong>Fatigue</`
- `<strong>Food</strong> &mdash; You can distract them with rations, point them towards corpses, cast a food illusion.`
- `<strong>Gold</strong> &mdash; They want money. Extortion, toll, tax, tribute, or greed.`
- `<strong>Help</strong> &mdash; They need something from nearby, probably somewhere dangerous. Kill something, clear out a`
- `<strong>Info</strong> &mdash; They want to know about a nearby NPC, faction, landmark, or location.`
- `<strong>Loss</strong> &mdash; The party is faced with a choice that costs them a resource (rations, tools, etc), time, o`
- `<strong>Loss</strong> &mdash; Torches are blown out, an ongoing spell fizzles, etc. The party must resolve the effect be`
- `<strong>Mission</strong> &mdash; They&rsquo;re in service to another nearby NPC or faction and are helping to achieve a `
- `<strong>Quiet</strong> &mdash; The party is left alone (and safe) for the time being.`
- `<strong>Sign</strong> &mdash; A clue, spoor, track, abandoned lair, scent, victim, etc is discovered.`
- `<strong>Sign</strong> &mdash; The party discovers a clue, spoor, or indication of a nearby encounter, locality, hidden f`
- `<strong>Territory</strong> &mdash; This is their turf. They will defend it, ask you to leave, or ask you to prove why yo`
- `<strong>Trade</strong> &mdash; They have random equipment (from each category on the equipment tables) and want to trade`
- `<strong>Valuables</strong> &mdash; Rare or unique items. Excellent pairings can result in their friendship or gaining th`

---

## What was fixed on our side, so you do not have to

All three landed 2026-08-07. They are why this edition of the list should be the
last one that includes a Part 1 or a Part 3 discovered after the fact.

- **English values are compared now, not just key presence.**
  `tools/i18n/baseline/es.json` records the English each of your translations was
  made against, so when we rewrite an English string under a finished Spanish one,
  `npm run i18n:check` says so by name. Seeded from `lang/en.json` at 0.1.11 and
  advanced automatically every time you import. The honest limit: it cannot see
  drift from before 0.1.11, so it establishes a floor rather than a full history.
- **The TSV marks a drifted row `drifted`, not `done`** — with the superseded
  English in the `notes` column, so the row tells you what it used to say. The
  summary line counts them and lists their keys. That column previously said
  `done` for exactly the rows in Part 1, which is how five wrong strings looked
  like finished work.
- **Entity keys are their own class, and the extractor no longer creates them.**
  Keys are now built the way the runtime asks for them (`node.innerHTML`, where
  the browser has already turned `&mdash;` into `—`), and the pre-fill falls back
  to the old entity form so nothing is lost in the changeover. `i18n:check`
  reports them separately from "English was edited", which is the bucket that hid
  them.


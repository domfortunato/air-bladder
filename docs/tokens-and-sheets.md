# Tokens and sheets

Every token on a map has an actor sheet behind it. When there are several
tokens, they either share one sheet or each keep their own. That's set when you
create the actor, and it decides how you track damage in a fight.

Only the Warden (GM) can change it.

---

## The two behaviours

| | **NPC or Hireling** | **Monster** |
|---|---|---|
| meant for | one named person | a creature you place several of |
| tokens | all share one sheet | each keeps its own |
| damage on one token | shows on all of them | stays on that token |
| disposition | neutral | hostile |

An innkeeper, a rival or a hired torchbearer is one person, so there is one
sheet. If you change HP on the token, it changes on the sheet too.

Six bandits each need their own damage. Each Monster token carries its own copy
of the stat block, and the sheet it came from stays a template.

## Running a group of the same enemy

Use a Monster. The Monsters compendium has human ones — `Bandit`, `Brigand`,
`Brigand Leader`, `Acolyte` — alongside the beasts.

**Compendium sidebar → Air Bladder - Actors → Monsters**: drag one into the
**Actors** tab once, then drag that actor onto the map as many times as you
need. Every token takes its own damage, and opening one shows that token's
numbers.

Dragging straight from the compendium onto the map also works, but Foundry
imports a fresh copy of the actor on every drop. Four drops leave four Bandits
in your Actors tab.

The **Add to scene** button on a rolled encounter does all of this for you. See
[Encounter Tables](encounter-tables.md).

## Changing your mind

Open the actor's sheet and go to **the ⋮ menu in the title bar → Prototype
Token → Identity**, then tick or untick **Link Actor Data**.

That only affects tokens you place from then on. Tokens already on a map keep
the behaviour they were placed with. To change those, delete them and place
them again.

Switching an actor's **Role** from Monster to NPC or Hireling also ticks **Link
Actor Data**. If you'd left it unticked on purpose, untick it again after the
switch.

## Attacking from a sheet

The **Attack** button on the first page of a character's or creature's sheet
opens a window that asks three things: the **Target**, the **Weapon or attack**
(an equipped item that deals damage, or an Improvised Attack), and whether the
attack is standard, impaired or enhanced. A panicked attacker's attacks are
always impaired.

The roll posts a damage card. You apply it with the card's **Apply damage**
control. The target's Armor comes off the damage, the rest comes off HP, and
anything left over comes off STR. If you rolled the card without a target, it
asks who takes it.

For a trap or a hazard, use **Warden's Damage**, the skull in the Token
controls. Whoever you've targeted takes it. If you haven't targeted anyone,
the card asks who.

## Equipping a shield, a light or a spellbook

Under the Armor box on the first page of a character's or creature's sheet are
three badges: **Equip shield**, **Equip light** and **Equip Spell**. Press
one to equip that thing, and press it again to put it away. It does the same as
the hand on that item's row in the inventory. While something's equipped, its
badge glows and the label changes to **Shield equipped**, **Light equipped** or
**Spell equipped**. If you don't carry one, the badge is greyed out and reads
**No Shield**, **No Light** or **No Spell**.

- **Shield.** A shield only adds to Armor while it's equipped.
- **Light.** The badge shows the light you're carrying, a torch or a lantern,
  and how far it reaches once it's lit. Only one light is equipped at a time,
  and with several it asks which.
- **Spell.** This covers a spellbook, a scroll and the Grimoire, one at a
  time, and its tooltip names the one that's equipped. With several, it asks
  which. You have to equip it to cast from it, and it takes both hands:
  equipping it puts away your shield and light, and equipping either of those
  puts it away.

**Lighting a light uses it up.** Equipping a Torch marks off one of its uses,
and with none left you can't light it. A Lantern burns one use of an **Oil Can**
you're carrying, or of a **Candle** if you don't have oil, and it won't light
without either. Lights that don't count uses, like the Glowsnail, light for
free. Everyone sees a chat message when a light is lit and when it goes out, unless
it's on a hidden token: then only the Warden does.

## Handing something to a monster

A player can offer an item to anyone they can see: another player's character,
an innkeeper, a mule, a crate. A monster is created with its permission at
**None**, so players can't see it and it never shows up in their give list.

To let the party hand something to a monster:

1. Set the monster's permission to **Limited** (right-click it in the Actors
   directory, then **Configure Ownership**).
2. Tick **Link Actor Data** on its token, if the creature is on a map.

If you skip the second step, the gift lands on the Actors-tab entry instead of
the token in front of the party, because an unlinked token is its own copy.

You answer the offer yourself. No player owns a monster or a Limited innkeeper,
so the card waits for the Warden.

## Giving things away from a sheet you own

The hand icon on an item row (**Give this to someone else…**) is on every sheet
you own, which for the Warden is all of them. You can hand a dead goblin's
sword to whoever earned it, or empty a crate into the party. A player has it on
anything they own, such as a hireling or a connected mule.

- **Giving to a player's character posts a card and waits for them.** Taking an
  item can leave a character without a free slot, which sets their HP to 0, so
  it's their choice.
- **Giving to something that no player owns takes one click.** The card is the
  record of it.

Fatigue, a Grimoire and its bound pages can't be given.

## Related

- [Generating NPCs and Hirelings](generating-npcs.md) — the two kinds of person
  and what each one arrives with.
- [Generating Monsters](generating-monsters.md) — danger tiers, and what a
  rolled monster carries.
- [Encounter Tables](encounter-tables.md) — rolling a wandering encounter and
  placing its tokens in one click.
- [Optional Combat Rules](optional-combat-rules.md) — exploding dice, shields
  and the other combat options.

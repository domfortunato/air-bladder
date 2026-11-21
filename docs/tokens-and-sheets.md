# Tokens and sheets

Every token on a map is backed by an actor sheet. Several tokens either share
one sheet or each keep their own. That is set when you create the actor, and it
decides how you track damage in a fight.

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
sheet. HP changed on the token changes on the sheet.

Six bandits each need their own damage. Each Monster token carries its own copy
of the stat block, and the sheet it came from stays a template.

## Running a group of the same enemy

Use a Monster. The Monsters compendium carries human ones — `Bandit`, `Brigand`,
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

That governs tokens placed from then on. Tokens already on a map keep the
behaviour they were placed with. Delete and re-place them to change it.

Switching an actor's **Role** from Monster to NPC or Hireling also ticks **Link
Actor Data**. If you had left it unticked on purpose, untick it again after the
switch.

## Attacking from a sheet

The **Attack** button on the first page of a character's or creature's sheet
opens a window that asks three things: the **Target**, the **Weapon or attack**
(an equipped item that deals damage, or an Improvised Attack), and whether the
attack is standard, impaired or enhanced. A panicked attacker's attacks are
always impaired.

The roll posts a damage card. You apply it with the card's **Apply damage**
control: the target's Armor comes off the damage, the rest comes off HP, and
anything left over comes off STR. A card rolled with no target asks who takes
it.

For a trap or a hazard, use **Warden's Damage**, the skull in the Token
controls. Whoever you have targeted takes it; with nothing targeted, the card
asks who.

## Handing something to a monster

A player can offer an item to anyone they can see: another player's character,
an innkeeper, a mule, a crate. A monster is created with its permission at
**None**, so players cannot see it and it never appears in their give list.

To let the party hand something to a monster:

1. Set the monster's permission to **Limited** (right-click it in the Actors
   directory, then **Configure Ownership**).
2. Tick **Link Actor Data** on its token, if the creature is on a map.

Without the second step the gift lands on the Actors-tab entry and not on the
token in front of the party, because an unlinked token is its own copy.

You answer the offer yourself. No player owns a monster or a Limited innkeeper,
so the card waits for the Warden.

## Giving things away from a sheet you own

The hand icon on an item row (**Give this to someone else…**) is on every sheet
you own, which for the Warden is all of them. Hand a dead goblin's sword to
whoever earned it, or empty a crate into the party. A player has it on anything
they own, such as a hireling or a connected mule.

- **Giving to a player's character posts a card and waits for them.** Taking an
  item can leave a character with no free slot, which sets their HP to 0, so
  the choice is theirs.
- **Giving to something no player owns is one click.** The card is the record
  of it.

Fatigue, a Grimoire and its bound pages cannot be given.

## Related

- [Generating NPCs and Hirelings](generating-npcs.md) — the two kinds of person
  and what each one arrives with.
- [Generating Monsters](generating-monsters.md) — danger tiers, and what a
  rolled monster carries.
- [Encounter Tables](encounter-tables.md) — rolling a wandering encounter and
  placing its tokens in one click.
- [Optional Combat Rules](optional-combat-rules.md) — exploding dice, shields
  and the other combat options.

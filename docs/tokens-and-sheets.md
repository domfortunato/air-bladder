# Tokens and sheets

Every token on a map is backed by an actor sheet. Whether a stack of tokens
shares one sheet, or each keeps its own, is settled when you create the actor —
and it is what decides how you track damage in a fight.

You need to be the Warden (GM) to change it.

---

## The two behaviours

| | **NPC or Hireling** | **Monster** |
|---|---|---|
| meant for | one named person | a creature you place several of |
| tokens | all share one sheet | each keeps its own |
| damage on one token | shows on all of them | stays on that token |
| disposition | neutral | hostile |

An innkeeper, a rival, a hostage, a hired torchbearer: there is one of them, so
there is one sheet. Hit protection you type on the token is the same hit
protection the sheet shows, and that is what NPC and Hireling are for.

Six bandits are not one person six times. Each of them needs its own damage, so
each token carries its own copy of the stat block and the sheet they came from
stays a template. That is what Monster is for.

## Running a group of the same enemy

Reach for a Monster. The bestiary carries the human ones — `Bandit`, `Brigand`,
`Brigand Leader`, `Acolyte` — alongside the beasts.

**Compendium sidebar → Air Bladder - Actors → Monsters**: drag one into the
**Actors** tab once, then drag that actor onto the map as many times as you
need. Every token takes its own damage, and opening one shows you that token's
numbers rather than the group's.

Dragging straight from the compendium onto the map works as well, and Foundry
imports a fresh copy of the actor on every drop — four drops leave four Bandits
in your Actors tab. Placing from one world actor keeps the directory tidy.

The **Add to scene** button on a rolled encounter does all of this for you.

## Changing your mind

Open the actor's sheet and go to **the ⋮ menu in the title bar → Prototype
Token → Identity**, then tick or untick **Link Actor Data**.

That governs tokens placed from then on. Tokens already on a map are their own
documents and keep the behaviour they were placed with, so delete and re-place
them if you want the change to reach them.

Switching an existing actor's **Role** to NPC or Hireling links its prototype
token as well, unless you had already unlinked it yourself.

## Handing something to a monster

A player can offer an item to anyone they can see: another player's character,
an innkeeper, a mule, a crate. **A monster is the exception, and it is because
of permissions rather than any rule about monsters.**

A monster is created with its permission at **None**, so players cannot see it
in the Actors directory and it never appears in their give list. If you want one
to be offerable — the party bribing a troll, feeding a guard dog — do two things:

1. Set the monster's permission to **Limited** (right-click it in the Actors
   directory, then **Configure Ownership**).
2. Tick **Link Actor Data** on its token, if the creature the party is talking
   to is on a map.

**The second step matters more than it looks.** An unlinked token is its own
copy, so a gift accepted on the directory entry lands on the entry and not on
the creature standing in front of the party. That is the same split this page
describes above.

You answer the offer yourself. Nobody owns a monster or a Limited innkeeper, so
the card waits for the Warden.

## Related

- [Generating NPCs and Hirelings](generating-npcs.md) — the two kinds of person
  and what each one arrives with.
- [Generating Monsters](generating-monsters.md) — danger tiers, and what a
  rolled monster carries.
- [Encounter Tables](encounter-tables.md) — rolling a wandering encounter and
  placing its tokens in one click.

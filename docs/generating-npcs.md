# Generating NPCs and hirelings

Two buttons, two kinds of person. **Generate NPC** makes somebody the party
*meets* — an innkeeper, a rival, a hostage — with a Background off the Warden's
Guide table and four traits of their own. **Generate Hireling** makes somebody
the party *pays*, with a Career off the 2e careers list, the gear that career
carries and a day rate.

Both arrive as complete Actors: a name, a portrait, a matching token, a
biography and a stat block. Neither asks you a question first.

You need permission to create Actors. The Warden always has it; a player only
if you have granted it.

---

## Which one you want

| | **NPC** | **Hireling** |
|---|---|---|
| the party… | meets them | pays them |
| job field | **Background** — Academic, Gravedigger, Peddler, Spy | **Career** — Blacksmith, Navigator, Trapper |
| where it comes from | the Warden's Guide NPC table (d20) | the 2e careers list (12 of them) |
| day rate | none | yes, from the career |
| stat block | **rolled** — 3d6 a piece, 1d6 HP | fixed by the career |
| gear | **none**, and the pack is empty | the career's whole loadout, equipped |
| extra traits | **Quirk, Goal**, plus NPC Virtue and Vice | 2e Virtue and Vice |

Nothing is locked in. The **Role** dropdown at the top of any of these sheets
switches one into the other, and switching costs you nothing — see
[Changing your mind](#changing-your-mind) below.

## Where the buttons are

**Actors tab → the button row at the top.**

- **Generate NPC** (the person-plus icon)
- **Generate Hireling** (the coin-in-hand icon)

Both also live in the folder **+** menu, under *What are you creating?*, which
is the one to use when you want the new person filed straight into a folder.

## What an NPC arrives with

- **A name** off `Warden: NPC - Name`, the book's three d20 lists merged into
  one d60.
- **A Background** off `Warden: NPC - Background`.
- **Ten traits**: the six appearance ones a player character rolls — Physique,
  Skin, Hair, Face, Speech, Clothing — plus **Quirk**, **Goal**, **Virtue** and
  **Vice** off the Warden's Guide NPC lists.
- **Pronouns and an age.** The age respects your minimum- and maximum-age
  settings, the same as a player character's.
- **A portrait and a matching token.** If you have set up a custom portrait
  folder with an `npc` subfolder, it draws from there — see
  [Using Your Own Portraits](using-your-own-portraits.md).
- **An empty pack.** Ten slots, nothing in them.
- **A rolled stat block**: 3d6 for each of STR, DEX and WIL, and 1d6 Hit
  Protection — the same dice a player character is made with.

The empty pack is deliberate. An NPC's gear is not a table in Cairn, so none is
invented; give them whatever the fiction says they have.

The stat block is a starting point, not a verdict. The Warden's Guide gives NPCs
no numbers at all, on the reasoning that most of them never get into a fight, so
these are here to save you inventing three of them when one does. Type over
anything that does not suit — a hedge wizard with WIL 17 is a decision, not a die
roll.

## What a hireling arrives with

- The same name table, the same biography, the same portrait treatment.
- **A Career**, and everything that comes with it: abilities, HP, the day rate,
  and the gear — weapons and armor arrive **equipped**, so the Armor score is
  already right.
- **For Hire** ticked, and the day rate showing beside it.

Untick **For Hire** and the rate hides. That is how you keep a Career on someone
who is not currently taking work — a retired sailor is still a sailor.

The twelve careers, with their day rates in gold: Alchemist (30), Animal Handler
(5), Blacksmith (15), Bodyguard (10), Local Guide (5), Lockpick (10), Navigator
(10), Sailor (5), Scholar (20), Tracker (5), Trapper (5), Veteran Bodyguard
(20). Type one of those names over the Career of someone whose rate is still 0
and the rate fills itself; set a rate by hand and nothing overrides it.

## The biography reads "They"

The sentence under the pronouns is written in the third person on both of these
sheets — *"They have a Gaunt Physique, Sallow Skin and Wiry Hair…"* — where a
player character's reads *"You have…"*. The printed sheet says the same.

Open **Traits** to change any single one from its table's list. Anything you
type that is not on the table survives too; it just shows as it is.

## Re-rolling

Every person's sheet has a **Roll NPC** button in the title bar. If you don't
see it, flip **Randomization** on with the toggle beside it — generated people
arrive with it off, so a sheet you are showing a player has no dice on it.

Roll NPC asks first, and it asks two different questions:

- On a **hireling**: everything it is carrying will be deleted, and its
  abilities, HP, Career and day rate replaced. A whole new working person.
- On an **NPC**: its Background, stat block, traits, pronouns and age are
  replaced, coins and status marks cleared — and its **name, portrait, notes
  and everything it is carrying are kept**. An NPC's gear was never granted by a
  table, so a new Background has no claim on it. The new stat block arrives at
  full, so a re-rolled NPC is never carrying the last one's wounds.

Both keep the name and the portrait, so you can re-roll the shopkeeper the party
has already met without them changing face. Neither can be undone.

## The dice on the sheet

With Randomization on, each of these re-rolls one thing and touches nothing
else:

| Die | What it does |
|---|---|
| beside the name | a new name off the d60 |
| beside **Background** | a new Background (NPC role) |
| beside **Career** | a new Career — **and its stat block and gear with it**, because in 2e a career *is* those things |
| beside **Faction** | a side, off `Warden: NPC - Faction` |
| beside **Age** | 2d20 + 10, floored and capped by your settings |
| on the portrait | another face from the same folder |

Players see these only if you have turned on **Allow players to randomize**.

## Changing your mind

The **Role** dropdown turns an NPC into a hireling and back. Nothing is thrown
away in either direction: the two roles keep their job fields in separate
places, and Quirk and Goal stay stored on a hireling even though that sheet does
not show them. Switch back and everything returns.

This is also how you promote one of the six shipped roles into another —
Monster, Companion, Transport and Container are the same dropdown.

## The tables behind it

These ship as RollTables in the **Warden — NPCs** compendium:

- `Warden: NPC - Name` (d60)
- `Warden: NPC - Background`
- `Warden: NPC - Quirk`
- `Warden: NPC - Goal`
- `Warden: NPC - Virtue`
- `Warden: NPC - Vice`
- `Warden: NPC - Faction`

The text is the Cairn 2e Warden's Guide NPC tables (CC BY-SA 4.0, by Yochai
Gal). Everything here *rolls* these tables rather than *drawing* from them, so
your tables never get marked as drawn.

**Faction is the one you can override.** Make a RollTable in your own world
named exactly `Warden: NPC - Faction` and it wins over the shipped copy, so your
campaign's factions survive a system update. The others are read straight from
the compendium — you can unlock the pack and edit rows, but an update ships
fresh copies, so treat those edits as temporary.

The twelve careers are **not** a table. They are a list inside the system, taken
from the 2e hireling examples, which is why there is no "Careers" compendium to
edit. To use a career the book does not have, type it into the Career field and
set the rate yourself.

## What generation will not do

- **It rolls no gear for an NPC.** See above.
- **It automates no rules text.** A trait, a quirk or a goal is prose. Nothing
  reads it, nothing rolls it, nothing applies it — that is yours to play.
- **It rolls no faction at creation.** Whose side someone is on is a decision
  about your campaign, not a die roll, so the Faction die is there when you want
  it and silent when you do not.

## Related

- [Generating Monsters](generating-monsters.md) — the same idea for things that
  fight, with a danger tier to pick.
- [Generating Factions](generating-factions.md) — for the groups these people
  belong to.
- [Using Your Own Portraits](using-your-own-portraits.md) — how the `npc` folder
  feeds the faces above.

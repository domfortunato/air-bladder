# Generating NPCs and hirelings

**Create NPC** makes somebody the party *meets* — an innkeeper, a rival, a
hostage — with a Background off the Warden's Guide table and four traits of
their own. **Create Hireling** makes somebody the party *pays*, with a Career
from the 2e careers list, the gear that career carries and a day rate.

Both arrive complete: a name, a portrait, a matching token, traits, an age and
a stat block. Each asks one question first, a tick-box reading **Use random
generation.** Clear it to open an empty sheet instead (see
[Generating characters](generating-characters.md#start-from-an-empty-sheet)).

That window also says what the new person's tokens will do: **all of their
tokens share one sheet**, because an NPC or a hireling is one person. For a
crowd whose members take damage separately, make a Monster, or clear **Link
Actor Data** on the actor's Prototype Token. See
[Tokens and Sheets](tokens-and-sheets.md).

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
| stat block | **rolled** — 3d6 each, 1d6 HP | fixed by the career |
| gear | a full Barebones equipment kit, weapon and armor included, plus the gear of its Background's Barebones counterpart; a Lord or Politician arrives with **nothing at all** | the career's whole loadout, weapons and armor equipped |
| extra traits | **Quirk, Goal**, plus NPC Virtue and Vice | 2e Virtue and Vice |

The **Role** dropdown at the top of either sheet switches one into the other
and loses nothing. See [Changing your mind](#changing-your-mind).

## Where the buttons are

**Actors tab → the button row at the top.**

- **Create NPC** (the person-plus icon)
- **Create Hireling** (the coin-in-hand icon)

Both are also in a folder's **+** menu, under *What are you creating?*, which
files the new person straight into that folder.

## What an NPC arrives with

- **A name** off `Warden: NPC - Name`, the book's three d20 lists merged into
  one d60.
- **A Background** off `Warden: NPC - Background`.
- **Ten traits**: the six appearance traits a player character rolls —
  Physique, Skin, Hair, Face, Speech, Clothing — plus **Quirk**, **Goal**,
  **Virtue** and **Vice** off the Warden's Guide NPC lists.
- **An age**, rolled with your **Age formula for generated characters**
  setting, the same as a player character's.
- **Blank pronouns.** There is no table for pronouns and generation never
  chooses them. The field is under the name on the sheet's first page.
- **A portrait and a matching token.** If you have set up a custom portrait
  folder with an `npc` subfolder, it draws from there. See
  [Using Your Own Portraits](using-your-own-portraits.md).
- **Gear**: the full Barebones equipment kit plus what its Background grants.
  A **Lord or Politician arrives with no items at all**. See
  [What an NPC is carrying](#what-an-npc-is-carrying) below.
- **A rolled stat block**: 3d6 for each of STR, DEX and WIL, and 1d6 Hit
  Protection.

The Warden's Guide gives NPCs no numbers. These save you inventing them when
an NPC ends up in a fight. Type over anything that does not suit.

## What a hireling arrives with

- A name off the same table, the six appearance traits with 2e **Virtue** and
  **Vice**, an age, blank pronouns, and a portrait and token chosen the same
  way.
- **A Career**, and everything that comes with it: abilities, HP, the day rate
  and the gear. Weapons and armor arrive **equipped**, so the Armor score is
  already right.
- **For Hire** ticked, and the day rate showing.

Untick **For Hire** and the rate hides. Use that to keep a Career on someone
who is not taking work.

The twelve careers, with their day rates in gold: Alchemist (30), Animal Handler
(5), Blacksmith (15), Bodyguard (10), Local Guide (5), Lockpick (10), Navigator
(10), Sailor (5), Scholar (20), Tracker (5), Trapper (5), Veteran Bodyguard
(20). Type one of those names over the Career of a hireling whose rate is 0 and
the rate fills itself. A rate you set by hand is never overridden.

## The sheet

An NPC's or hireling's sheet is laid out like a player character's, with four
pages: **NPC** or **Hireling**, **Inventory**, **Description** and **Notes**.

The first page carries the name, Pronouns and Age, the Role, the Background or
Career, the Faction, the trait sentence, the stat block and the Armor row:

- **Hold shield?** and **Hold light?** sit either side of the Armor box. Each
  holds or puts away a shield or a light the person carries. A shield adds to
  Armor only while it is in hand.
- The **Max** boxes are locked while Character Creation Mode is off.

On the Inventory page, every row has a **Mark broken** toggle beside the trash.
It asks first. A broken item still takes up a slot but doesn't provide any
benefit: it cannot be held or worn, adds no Armor and rolls no damage.

### The trait sentence reads "They"

The trait sentence on the first page is written in the third person — *"They
have…"* — where a player character's reads *"You have…"*. The printed sheet
says the same.

With **Character Creation Mode** on, press the pen at the end of that sentence
to open the **Traits** window and change any trait from its table's list. A
trait you typed that is not on the table is kept and shown as it is.

## Re-rolling

Each of these sheets has a **Roll NPC** button in the title bar while
**Character Creation Mode** is on. Generated people arrive with the mode off;
the toggle in the title bar reads **CharGen: Off**.

Roll NPC asks first, and the question depends on the role:

- On a **hireling**: everything it is carrying is deleted, and its abilities,
  HP, Career, day rate, traits and age are replaced. Its pronouns, coins and
  status marks are cleared, and it is marked For Hire.
- On an **NPC**: its Background, stat block, traits and age are replaced, and
  so is everything generation gave it to carry — the Background's gear and the
  kit. Its pronouns, coins and status marks are cleared. Anything you gave it
  by hand is kept. The new stat block arrives at full.

Both keep the name, the portrait and the notes, so you can re-roll a
shopkeeper the party has already met. Neither can be undone.

## The dice on the sheet

With Character Creation Mode on, each of these re-rolls one thing:

| Die | What it does |
|---|---|
| beside the name | a new name off the d60 |
| beside **Background** (NPC) | a new Background **and the gear it grants**. The kit stays between ordinary trades. Landing **Lord or Politician empties the whole pack**, and rolling back off one packs a fresh kit |
| beside **Career** (hireling) | a new Career, **with its stat block, day rate and gear** |
| beside **Faction** | a side, off `Warden: NPC - Faction` |
| beside **Age** | your **Age formula for generated characters** setting (default 2d20 + 10 — see [Dice Formulas](dice-formulas.md)) |
| on the portrait | another face from the same folder |

**These dice are the Warden's alone.** A player never sees them on an NPC or
hireling sheet, even a player who owns the hireling, and whatever **Let
players use Character Creation tools on their sheets** says. That setting
governs player characters only.

### Picking instead of rolling

Beside the die, the **pick-list button** chooses a specific value:

- **Career** (hireling): the twelve 2e careers, each shown with its day rate
  and loadout. Picking one adopts the whole career, as the die would.
- **Background** (NPC): the d20 table. The gear follows the same rules as the
  die, Lord and Politician included.
- **Faction**: your faction table. A table of the same name in your world wins
  over the shipped one.
- **Portrait**: the list button on the portrait opens the portrait gallery,
  as clicking the portrait does.

There is no pick-list for the name. The pick-list buttons show and hide with
the dice.

## What players see

A generated NPC or hireling arrives with **Limited** default ownership. Players
see its name and portrait in the Actors list, and opening the sheet shows them
the portrait, the name and the Description — no stat block, no inventory, no
notes, and no Print button. Put anything the players may read in
**Description** and keep your secrets in **Notes**.

When the party hires a hireling, grant ownership as usual. Its generation dice
stay yours however much of it a player owns.

## Changing your mind

The **Role** dropdown turns an NPC into a hireling and back. Nothing is thrown
away in either direction. Background and Career are kept separately, and Quirk
and Goal stay stored on a hireling even though its Traits window does not list
them. Switch back and everything returns.

The same dropdown holds the other four roles: Monster, Companion, Transport and
Container.

## The tables behind it

These ship as rollable tables in the **Warden — NPCs** compendium:

- `Warden: NPC - Name` (d60)
- `Warden: NPC - Background`
- `Warden: NPC - Quirk`
- `Warden: NPC - Goal`
- `Warden: NPC - Virtue`
- `Warden: NPC - Vice`
- `Warden: NPC - Faction`

The text is the Cairn 2e Warden's Guide NPC tables (CC BY-SA 4.0, by Yochai
Gal). Generation *rolls* these tables and never *draws* from them, so your
tables are never marked as drawn.

**Every one of these tables can be overridden.** Make a rollable table in your
own world with exactly a shipped table's name — `Warden: NPC - Faction`, say —
and it is used instead of the shipped one, and survives a system update. Edits
made inside the shipped compendium do not survive: an update replaces it.

The twelve careers are **not** a table. They are a fixed list taken from the
2e hireling examples, so there is no careers compendium to edit. For a career
the book does not have, type it into the Career field and set the rate
yourself.

## What an NPC is carrying

An NPC's Background is a word off a d20 table, and the table grants no gear.
The Cairn Barebones list of 100 backgrounds does, so each row of the NPC table
is matched to its nearest Barebones counterpart and the NPC arrives with that
gear. The items come from the same item compendiums a Barebones character and
a hireling draw on.

| d20 | NPC Background | Barebones counterpart | d100 | what you get |
|---|---|---|---|---|
| 1 | Academic | Scribe | 82 | Candle, Parchment & Ink, Stylus |
| 2 | Assassin | **Assassin** | 5 | Garrotte, Mask, Poison |
| 3 | Blacksmith | **Blacksmith** | 14 | Bellows, Hammer, Iron Tongs |
| 4 | Farmer | **Farmer** | 37 | Rope, Sack, Shovel |
| 5 | General | Knight | 57 | Gloves, Signal Flag, Whetstone |
| 6 | Gravedigger | **Gravedigger** | 45 | Alcohol, Ladder, Shovel |
| 7 | Guard | **Guard** | 46 | Lantern, Manacles, Whistle |
| 8 | Healer | Herbalist | 48 | Antitoxin, Mugwort, Sack |
| 9 | Jailer | **Jailer** | 54 | Chain, 10ft, Manacles, Whistle |
| 10 | Laborer | Gardener | 42 | Gloves, Sack, Shovel |
| 11 | Lord | — | | |
| 12 | Merchant | **Merchant** | 64 | Random Additional Gear, Stylus *(plus a Wagon — not granted, see below)* |
| 13 | Monk | **Monk** | 67 | Candle, Cloak, Songbook |
| 14 | Mystic | Hermit | 49 | Blanket, Pole, 10ft, Smoking Herbs |
| 15 | Outlander | Vagabond | 96 | Blanket, Poncho, Rope |
| 16 | Peddler | **Peddler** | 73 | Random Additional Gear, Sack *(plus a Cart — not granted, see below)* |
| 17 | Politician | — | | |
| 18 | Spy | **Spy** | 86 | Disguise Kit, Garrotte, Mirror |
| 19 | Thief | **Thief** | 92 | Caltrops, Grappling Hook, Lockpicks |
| 20 | Thug | Highway Robber | 50 | Grappling Hook, Rope, Signal Flag |

Eleven are the same word in both lists, in **bold**. Seven are matched to a
different trade, and two have no counterpart:

- **Lord and Politician arrive with no items at all**, kit included. Every
  Barebones background is an occupation, so rank and office have no
  counterpart. Give them what the fiction says they carry.
- **Thug is Highway Robber, not Thief**, because Thief is already row 19.
- **Healer and Academic are the loosest matches.** Barebones splits each
  across several trades — a healer could as well be Apothecary, Physician,
  Barber Surgeon or Leech Collector.
- **"Random Additional Gear" is a roll** on the Barebones Additional Gear
  d100, rerolled if it duplicates something the NPC already has.
- **The Merchant's Wagon and the Peddler's Cart are not granted.** A transport
  is its own Actor in the Actors list, and generating a dozen NPCs should not
  create a dozen carts. Make one if the peddler needs it. A hireling's career
  grants no transport either.

**Every other NPC also carries a kit**: the equipment procedure a Barebones
character goes through. That is Rations, a Torch, a rolled weapon and armor
(both worn), and a roll on the Barebones Additional Gear table, with a second
roll when the armor comes up None. With the Background's gear that is about
eight items, so some NPCs arrive **encumbered**, with no free slot and 0 HP,
as a freshly generated player character can. Decide what they put down.

What each re-roll replaces:

- **The Background die or pick-list** replaces the Background's gear. Between
  ordinary trades it leaves the kit alone. Landing on Lord or Politician
  removes the gear and the kit, and moving back off one packs a fresh kit.
- **Roll NPC** replaces both.
- **Anything you added by hand is never touched by either.**

## What generation will not do

- **It grants no transport.** See above.
- **It automates no rules text.** A trait, a quirk or a goal is prose for you
  to play. Nothing reads it or rolls it.
- **It rolls no faction at creation.** The Faction die is there when you want
  it.

## Related

- [Generating Monsters](generating-monsters.md) — for things that fight, with a
  danger tier to pick.
- [Tokens and Sheets](tokens-and-sheets.md) — why every token of one of these
  people shares a sheet, and what to use for a crowd.
- [Generating Factions](generating-factions.md) — for the groups these people
  belong to.
- [Using Your Own Portraits](using-your-own-portraits.md) — how the `npc` folder
  supplies the portraits.

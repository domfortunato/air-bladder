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
| gear | a full Barebones equipment kit — weapon and armor included — plus its Background's Barebones counterpart; a Lord or Politician arrives with **nothing at all** | the career's whole loadout, equipped |
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
- **An age**, respecting your minimum- and maximum-age settings, the same as a
  player character's.
- **Blank pronouns.** Generation does not choose them — there is no table for
  pronouns and no die should decide them. The field is at the top of the
  Description tab; fill it in when you know.
- **A portrait and a matching token.** If you have set up a custom portrait
  folder with an `npc` subfolder, it draws from there — see
  [Using Your Own Portraits](using-your-own-portraits.md).
- **The full Barebones equipment kit** — Rations, a torch, a rolled weapon
  and armor (both worn), and a roll on Additional Gear, a second when the
  armor comes up None: the same procedure a starting Barebones character goes
  through — plus **the gear its Background grants**; see the table below. The
  exception is a **Lord or Politician, who arrives with no items at all**,
  kit included: rank and office pack nothing, and you give them exactly what
  the fiction says they carry.
- **A rolled stat block**: 3d6 for each of STR, DEX and WIL, and 1d6 Hit
  Protection — the same dice a player character is made with.

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
see it, flip **Character Creation Mode** on with the toggle beside it —
generated people arrive with it off, so a sheet you are showing a player has
no dice on it.

Roll NPC asks first, and it asks two different questions:

- On a **hireling**: everything it is carrying will be deleted, and its
  abilities, HP, Career and day rate replaced. A whole new working person.
- On an **NPC**: its Background, stat block, traits and age are replaced, and
  so is everything generation gave it — the Background's gear AND the kit,
  because this is a different person. Its pronouns, coins and status marks
  are cleared. Its **name, portrait, notes and anything you gave it by hand
  are kept**. The new stat block arrives at full, so a re-rolled NPC never
  carries the last one's wounds.

Both keep the name and the portrait, so you can re-roll the shopkeeper the party
has already met without them changing face. Neither can be undone.

## The dice on the sheet

With Character Creation Mode on, each of these re-rolls one thing and touches
nothing else:

| Die | What it does |
|---|---|
| beside the name | a new name off the d60 |
| beside **Background** | a new Background **and the gear it grants** — the kit stays between ordinary trades; landing **Lord or Politician empties the whole pack**, and rolling back off one repacks it (NPC role) |
| beside **Career** | a new Career — **and its stat block and gear with it**, because in 2e a career *is* those things |
| beside **Faction** | a side, off `Warden: NPC - Faction` |
| beside **Age** | your **Age formula** setting (default: 2d20 + 10 — see [Dice Formulas](dice-formulas.md)) |
| on the portrait | another face from the same folder |

**These dice are yours alone.** On an NPC or hireling sheet a player never sees
them — not even a player who owns the hireling, and whatever **Allow players
to randomize** says. That setting still governs player characters only.

### Picking instead of rolling

Beside the die, the **pick-list button** picks a specific value instead of a
random one — the same control a player character's background row has:

- **Career** (hireling): choose from the twelve 2e careers, each shown with its
  day rate and loadout. Picking one adopts the whole career — stat block, rate
  and gear — exactly as the die would.
- **Background** (NPC): choose from the d20 table. The old trade's gear is
  swapped for the new trade's; the kit stays — except that picking **Lord or
  Politician empties the pack entirely**, and picking your way back off one
  packs a fresh kit.
- **Faction**: choose from your faction table (your own world table of the same
  name wins, as always).

The pickers ride the same **Character Creation Mode** toggle as the dice:
turning it off removes the whole surface, pick-list buttons included. Flip it
on to roll or to pick.

## What players see

A generated NPC arrives with **Limited** default ownership: players see its
name and portrait in the directory, and opening the sheet shows them the
portrait, the name and the Description field — no stat block, no inventory, no
notes, and no Print button. Put anything the players may read in
**Description**; keep your secrets in **Notes**.

A generated hireling arrives **Limited** too — it is meant to be handed to a
player whole, so grant ownership as usual when the party hires them, and until
you do, players see its limited view like any stranger's. However much of a
hireling a player owns, its generation dice stay yours (above).

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

## What an NPC is carrying, and where it comes from

An NPC's Background is a word off a d20 table, and a word grants nothing. The
Cairn Barebones list of 100 backgrounds is the one list in this system whose
entries DO carry gear, so each row of the NPC table points at its nearest
Barebones counterpart and an NPC arrives holding that gear — resolved out of
the same editable item packs a Barebones character and a hireling draw from, so
editing an item changes what every NPC generated afterwards carries.

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

Eleven are the same word in both lists, in **bold**. Seven needed a
translation, and two get nothing at all:

- **Lord and Politician generate with no items at all** — no gear, no kit —
  and that is not an oversight. Every one of the 100 Barebones backgrounds is
  an OCCUPATION — what you did before adventuring — so hereditary rank and
  elected office have nowhere to sit. That is exactly why both words are on a
  table the WARDEN rolls: they say where someone stands in the world, which is
  what you need about a person the party meets, not a set of skills a starting
  character brings. A Lord arrives with an empty pack; give them what the
  fiction says they carry.
- **Thug is not Thief**, obvious as that looks, because Thief is already row 19.
  Highway Robber keeps the distinction the table draws: one takes by stealth,
  the other by force.
- **Healer and Academic are the loosest**, because Barebones splits each across
  several trades — a healer could as well be Apothecary, Physician, Barber
  Surgeon or Leech Collector. Herbalist and Scribe are picks, not verdicts.
- **"Random Additional Gear" is a real roll, not a missing item.** Two of these
  name it, and it means a roll on the Barebones Additional Gear d100, rerolled
  if it duplicates something the Background already gave.
- **The Merchant's Wagon and the Peddler's Cart are NOT granted.** A transport
  is a second Actor, connected to its keeper and always listed in the Actor
  Directory, and generating a dozen NPCs should not mint a dozen carts. Buy or
  make one if the peddler needs it. A hireling's career grants no transport
  either.

**Every other NPC also carries a kit**: the whole equipment procedure a
Barebones character goes through — Rations, a Torch, a rolled weapon and
armor (both worn), and a roll on the Barebones Additional Gear table, a
second when the armor comes up None. That brings a typical NPC to eight or
nine items, a real pack — full enough that some arrive **encumbered**,
exactly as a freshly generated player character can. That is not a bug in
either case: they were owed the gear, and deciding what gets put down is
part of meeting them.

A note on the Background **die** (as against generation): rolling an existing
NPC's Background onto Lord or Politician removes **everything generation
granted — the trade's gear and the kit alike** — so the swap leaves them
exactly as generating them would: empty-handed. Rolling between two ordinary
trades keeps the bag, and rolling your way back off Lord or Politician packs
a fresh kit, so the NPC ends up matching a generated one whichever way the
die walked them there.

Both are tagged, and the tags are what tell them apart when you re-roll:

- **The Background die** replaces the Background's gear; between ordinary
  trades it leaves the kit alone, with the Lord and Politician exception
  above.
- **Roll NPC** replaces both, because that is a different person.
- **Anything you added by hand is never touched by either.**

## What generation will not do

- **It grants no transport.** A Merchant or Peddler NPC gets their items but
  not the Wagon or Cart the Barebones background lists — see above.
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

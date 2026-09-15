# Customizing bonds

A **bond** is the tie a Cairn 2e character starts with: a short piece of prose,
sometimes with starting gold or an item attached. Generation rolls one for every
2e character (Barebones characters get none — bonds are 2e's mechanic), and the
character sheet's **Background & Notes** tab keeps it, with a re-roll die, a ✕,
and an **Add a bond** link where the rules allow more.

Out of the box those rolls come from the shipped **Bonds** table — twenty rows
in the **Tables (2e)** compendium. This page is about replacing them with your
own.

You need to be the Warden (GM).

---

## Where a bond comes from

Every bond draw — generation, the sheet's re-roll die, **Add a bond** —
resolves the same way:

1. If the character's background names its own bonds table, that table is used.
   Custom backgrounds can do this; canon ones never do.
2. Otherwise the draw looks for a **RollTable in your world named `Bonds`** and
   uses it if one exists.
3. Otherwise it uses the shipped **Bonds** table from **Tables (2e)**.

So one world table named `Bonds` changes the bonds behind *everything* — canon
backgrounds included — and deleting it puts everything back. There is nothing
else to configure.

---

## Copy the 2e tables into your world

The one-button way, and it brings the rest of 2e's tables with it. Open the
**Rollable Tables** or **Compendium** sidebar tab and press **Create Custom 2e Backgrounds and Tables…**
(Wardens only). Alongside the 27 backgrounds it copies the
**eleven tables a 2e character rolls on** — Bonds, Omens, Scars, and the eight
trait tables (Physique, Skin, Hair, Face, Speech, Clothing, Vice, Virtue) — into
a **Custom 2e Character Creation** folder in your Rollable Tables, rows and
hidden payload intact. The Scars it copies is the one in **Utils**, the table a
damage roll deals a scar from; the `Scars` in **Tables (2e)** is the list of
checkboxes on the character sheet, which is read from the compendium only, and
its own note says so when you open it.

Think of the shipped compendiums as **templates**: the starting point you copy
and make your own, never the place you edit. Every one of those eleven follows
the rule below — a world table with the shipped table's name is what gets rolled
— so once they are copied, rewording a bond, adding an omen or retuning a scar
is just editing the table in your sidebar.

Running it again never overwrites: a table you have already edited is kept
exactly as it is, and only what is missing is added. That holds for a copy you
have renamed, too: it is left alone, and a fresh copy lands under the shipped
name beside it.

Every copy explains itself: open one and a note at the top says Air Bladder
rolls it instead of the shipped table, and how to add a row. A table opens in
view mode, where nothing can be dropped or added, so the note also tells you to
press **Edit** at the top of the window first. Add a row and it is
rolled straight away: the table's die follows its rows, so a twenty-first bond
makes the formula `1d21` by itself, and deleting the last row shrinks it back.
Tables rolled with more than one die — the NPC reactions, encounter and GLOG
mishap tables — are the exception: their note names the dice and asks you to
set the formula on the **Summary** tab yourself, because a bell curve is not
something to flatten behind your back. And if two tables in your world share a
name, both say so: Air Bladder cannot tell which one to read, so rename or
delete one of them.

The hand import below is still there, and is the right tool when you want one
table and not eleven.

---

## Replacing the bonds for the whole world

1. Open the **Compendium** sidebar tab → **Tables (2e)** → right-click
   **Bonds** → **Import**.
2. The copy lands in your **Rollable Tables** sidebar, named `Bonds`. That name
   is the whole mechanism — keep it.
3. Edit it there: reword rows, delete rows, add rows. Any number of rows works,
   and the table's die follows its rows — a thirty-row table rolls `1d30`
   without you touching the formula.

The imported rows keep their hidden payload — the starting gold and the item
each shipped bond grants arrive intact — so rewording a row keeps its
mechanics.

**Rows you add by hand grant their text only.** Foundry's table editor has no
way to author that payload, so a hand-written row carries no automatic gold or
gear. Put anything mechanical into the prose — "Take 20gp, and a Compass that
points somewhere it shouldn't" — and let the player apply it, which is how this
system treats mechanical text everywhere.

**Do not edit the copy inside Tables (2e) instead.** A system compendium is
overwritten wholesale when Air Bladder updates; your world's copy survives.

---

## A bonds table for one background

A **custom background** can name its own table: the **Bonds table** box on its
Details tab (see
[Creating a custom 2e background](creating-custom-backgrounds.md)). Type the
table's name — your world's tables are checked first, then every compendium.
Leave the box empty and the background draws from the default above.

A name that matches nothing does not break generation: the draw falls back to
the default with a warning in the console, so a background shared to a world
that lacks its table still hands out ordinary bonds.

Canon backgrounds have no such box. To give just one of them special bonds,
open it in **Backgrounds (2e)**, click **Duplicate into Custom 2e Backgrounds**,
set the box on the copy — and switch the original off with the **eye toggle**
on its picker row, so the copy is the one that comes up (see
[Taking a background out of play](generating-characters.md#taking-a-background-out-of-play)
in Generating Characters).

---

## Two bonds, and repeats

A character is entitled to one bond, plus one if their background grants two —
the **Grants two bonds** checkbox on a custom background, or, for shipped
backgrounds like the Fieldwarden, a description containing the sentence "roll a
second time on the bonds table" — plus one more for each rolled question answer
containing that sentence. The checkbox and the description together still count
once.

A drawn bond the character already holds is re-rolled, up to ten attempts, and
then the repeat is accepted. That is deliberate: a bonds table with fewer rows
than the character has bonds is perfectly legal — one row is a fine table — and
there a repeat is a nuisance, while refusing it would leave the character short
of what the rules owe them.

---

## The same trick works for Omens

The character sheet's omen die (and the picker beside it) resolves the same
way: a **RollTable in your world named `Omens`** beats the shipped copy in
**Tables (2e)**, and deleting it puts the shipped table back. Import the
shipped **Omens** table exactly as step 1 above imports Bonds, keep the name,
and edit freely — any number of rows works, and the die rolls whatever formula
your table declares. Omen rows are plain prose: unlike bonds, nothing
mechanical rides them, so there is nothing else to preserve.

---

## And for every table the generators roll

The same rule — **a table in your world with the same name wins** — covers
every table a generator or a die reaches for. Import the shipped one, keep its
name, edit it, and both the button on the Warden's Dashboard and the generator
behind it roll yours. Delete it and the shipped table is back.

| Where it rolls | Tables (their shipped compendium) |
|---|---|
| A 2e character's biography — generation and the sheet's re-roll dice | `Physique`, `Skin`, `Hair`, `Face`, `Speech`, `Clothing`, `Vice`, `Virtue` (**Tables (2e)**) |
| NPCs and hirelings — the generators, the sheet dice, and the pick-lists | `Warden: NPC - Name`, `Warden: NPC - Background`, `Warden: NPC - Faction`, `Warden: NPC - Quirk`, `Warden: NPC - Goal`, `Warden: NPC - Virtue`, `Warden: NPC - Vice` (**Warden: NPCs**) |
| Monsters | the eight `Warden: Monster - …` tables (**Warden: Monsters**) |
| Barebones character creation | `Barebones: Creation - Weapon`, `- Armor`, `- Additional Gear`, and the three `Barebones: Weapon Tier` tables (**Tables (Barebones)**) — these have a one-button copy of their own, see [Generating Characters](generating-characters.md) |
| Scars, when damage lands | `Scars` (**Utils**) |
| A random spellbook or spellscroll a background hands out | `Spells — Canon (1d100)` (**Tables (2e)**), or `Spells — GLOG` (**Tables (GLOG)**) with the GLOG hack on — these have a one-button copy of their own, spellbooks included, see [Generating Characters](generating-characters.md); a world copy re-sorts itself by name when a spellbook is dropped in, so the new spell can be rolled |
| Factions | every table the faction generator rolls (**Warden: NPCs**) |
| The marketplace | the four `Market: …` tables — see [Customizing the marketplace](customizing-the-marketplace.md) |

Two things worth knowing:

- **Your table's rows are never marked as drawn.** The generators roll without
  touching the table, so a table you set to draw *without* replacement keeps
  every row available for your own rolls from the Dashboard. If you do want
  rows crossed off as they come up, roll from the table itself.
- **A row's text is what gets written**, so on a table whose rows feed a
  mechanic — a Background that decides an NPC's starting gear, say — keep the
  shipped wording for the rows you want to keep working, and add your own rows
  beside them. On a spell table, rows pointing at anything that is not a
  spellbook are skipped, so a stray text row does no harm.

None of this needs a system compendium unlocked, and none of it is lost when
Air Bladder updates.

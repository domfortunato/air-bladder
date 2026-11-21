# Customizing bonds

A **bond** is the tie a Cairn 2e character starts with: a short piece of prose,
sometimes with gold or an item attached. Generation rolls one for every 2e
character. Barebones characters get none. Bonds are kept on the character
sheet's **Background & Notes** page. With Character Creation Mode on, each bond
there has a re-roll die and a list button, a bond after the first has a ✕, and
an **Add a bond** link appears when the character is owed another.

Bonds are rolled from the shipped **Bonds** table, twenty rows in the
**Tables (2e)** compendium. This page covers replacing them with your own. To
play without bonds, switch off **Use bonds** under **Configure Character
Generation** (see [Generating Characters](generating-characters.md)).

You need to be the Warden.

---

## Where a bond comes from

Generation, the re-roll die and **Add a bond** all find their table the same
way:

1. If the character's background names its own bonds table, that table is
   used. Only a custom background can name one.
2. Otherwise, a **RollTable in your world named `Bonds`** is used if there is
   one.
3. Otherwise, the shipped **Bonds** table in **Tables (2e)** is used.

One world table named `Bonds` therefore changes the bonds for every
background, canon ones included. Delete it and the shipped bonds are back.

---

## Copy the 2e tables into your world

Open the **Rollable Tables** or **Compendium** sidebar tab and press **Create
Custom 2e Backgrounds and Tables…** (Wardens only), then **Copy**. Alongside
the 27 backgrounds, it copies the **eleven tables a 2e character rolls on**
into a **Custom 2e Character Creation** folder in your Rollable Tables: Bonds,
Omens, Scars, and the eight trait tables (Physique, Skin, Hair, Face, Speech,
Clothing, Vice, Virtue). The gold and item each shipped bond grants come with
it.

The Scars it copies is the one in **Utils**, which deals a scar when damage
calls for one. The `Scars` in **Tables (2e)** is the list of checkboxes on the
character sheet. The sheet always reads that list from the compendium, and a
note on the table says so.

Treat the shipped compendiums as templates: copy from them, and edit the copy.
A world table with a shipped table's name is rolled instead of the shipped
one, so once the eleven are copied you can reword a bond, add an omen or
change a scar by editing the table in your sidebar.

Running it again never overwrites. A table you have edited is kept as it is,
and only what is missing is added. A copy you renamed is left alone too, and a
fresh copy lands under the shipped name beside it.

Each copy opens with a note at the top:

- It says Air Bladder rolls this table instead of the shipped one, and how to
  add a row.
- A table opens in view mode, where rows cannot be added. The note tells you
  to press **Edit** at the top of the window first.
- A new row is rolled with the rest straight away. The table's die follows its
  rows: a twenty-first bond makes the formula `1d21`, and deleting the last row
  shrinks it back.
- Tables rolled with more than one die, such as the NPC reaction, encounter
  and GLoG mishap tables, do not change their own formula. Their note names
  the dice and asks you to set the formula on the **Summary** tab yourself.
- If two tables in your world share a name, both say so. Air Bladder cannot
  tell which to read, so rename or delete one.

To copy one table and not eleven, import it by hand as below.

---

## Replacing the bonds for the whole world

1. Open the **Compendium** sidebar tab → **Tables (2e)** → right-click
   **Bonds** → **Import Entry**.
2. The copy lands in your **Rollable Tables** sidebar, named `Bonds`. Keep
   that name; it is how Air Bladder finds the table.
3. Edit it there: reword, delete or add rows. Any number of rows works, and
   the die follows the rows. A thirty-row table rolls `1d30`.

The imported rows keep the gold and the item each shipped bond grants, so a
reworded row still grants them.

**Rows you add by hand grant their text only.** Foundry's table editor cannot
attach gold or an item to a row. Put anything mechanical in the prose and let
the player apply it.

**Do not edit the copy inside Tables (2e).** A system update replaces that
compendium. Your world's copy survives.

---

## A bonds table for one background

A **custom background** can name its own table in the **Bonds table** box on
its Details tab (see
[Creating a custom 2e background](creating-custom-backgrounds.md)). Type the
table's name. Your world's tables are checked first, then every compendium.
Leave the box empty and the background uses the default above. Rows in a table
of your own grant their text only.

If the name matches no table, the default is used, and a warning goes to the
browser console. A background shared to a world that lacks its table still
hands out ordinary bonds.

Canon backgrounds have no such box. To give one of them its own bonds, open it
in **Backgrounds (2e)**, click **Duplicate into Custom 2e Backgrounds**, and
set the box on the copy. Then switch the original off with the **eye toggle**
on its picker row, so that only the copy comes up (see
[Taking a background out of play](generating-characters.md#taking-a-background-out-of-play)
in Generating Characters).

---

## Two bonds, and repeats

A character is owed one bond, plus:

- one more if the background grants two. A custom background does so with its
  **Grants two bonds** checkbox. A shipped one, such as the Fieldwarden, does
  so with a description containing the sentence "roll a second time on the
  bonds table". The checkbox and the sentence together still count once.
- one more for each rolled question answer containing that sentence.

A drawn bond the character already holds is re-rolled, up to ten times. After
that the repeat is kept, so a bonds table with fewer rows than the character
has bonds still gives every bond owed.

---

## Omens work the same way

The omen die on the character sheet, and the list button beside it, use a
**RollTable in your world named `Omens`** in place of the shipped one in
**Tables (2e)**. Delete it and the shipped table is back. Import the shipped
**Omens** table as step 1 above imports Bonds, keep the name, and edit it. Any
number of rows works. Omen rows are plain prose and grant nothing.

---

## Every other table the generators roll

**A table in your world with the same name is rolled instead of the shipped
one.** That covers every table a generator or a sheet die uses. Import the
shipped table, keep its name and edit it. The button on the Warden's Dashboard
and the generator both roll yours. Delete it and the shipped table is back.

| Where it rolls | Tables (their shipped compendium) |
|---|---|
| A 2e character's traits, at generation and from the sheet's dice | `Physique`, `Skin`, `Hair`, `Face`, `Speech`, `Clothing`, `Vice`, `Virtue` (**Tables (2e)**) |
| NPCs and hirelings: the generators, the sheet dice and the lists | `Warden: NPC - Name`, `Warden: NPC - Background`, `Warden: NPC - Faction`, `Warden: NPC - Quirk`, `Warden: NPC - Goal`, `Warden: NPC - Virtue`, `Warden: NPC - Vice` (**Warden — NPCs**) |
| Monsters | the eight `Warden: Monster - …` tables (**Warden — Monsters**) |
| Barebones character creation | `Barebones: Creation - Weapon`, `- Armor`, `- Additional Gear`, and the three `Barebones: Weapon Tier` tables (**Tables (Barebones)**). These have a one-button copy of their own; see [Generating Characters](generating-characters.md) |
| Scars, when damage calls for one | `Scars` (**Utils**) |
| A random spellbook or spellscroll a background hands out | `Spells — Canon (1d100)` (**Tables (2e)**), or `Spells — GLoG` (**Tables (GLoG)**) with the GLoG hack on. These have a one-button copy of their own, spellbooks included; see [Generating Characters](generating-characters.md). A world copy keeps its rows in alphabetical order when a spellbook is dropped in |
| Factions | every table the faction generator rolls (**Warden — NPCs**); see [Generating Factions](generating-factions.md) |
| The marketplace | the four `Market: …` tables; see [Customizing the marketplace](customizing-the-marketplace.md) |

Two things to know:

- **Your table's rows are never marked as drawn.** The generators roll without
  changing the table. To have rows crossed off as they come up, roll from the
  table itself.
- **A row's text is what gets written.** On a table whose rows drive something
  else, such as the NPC Background that decides an NPC's starting gear, keep
  the shipped wording of the rows you want to keep working and add your own
  beside them. On a spell table, a row that is not a spellbook is skipped.

None of this needs a system compendium unlocked, and none of it is lost when
Air Bladder updates.

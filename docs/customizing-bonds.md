# Customizing bonds

All Cairn 2e characters characters start with: a short piece of prose,
sometimes with gold or an item attached. Barebones characters don't get one. Bonds are kept on the character sheet's **Background & Notes** page. With Character Creation Mode on, each bond there has a re-roll die and a list button, a bond after the first has a ✕, and an **Add a bond** link appears when the character is owed another.

Bonds are rolled from the shipped **Bonds** table, twenty rows in the
**Tables (2e)** compendium. This page covers replacing them with your own. To
play without bonds, switch off **Use bonds** under **Configure Character
Generation** (see [Generating Characters](generating-characters.md)).

---

## Where a bond comes from

Generation, the re-roll die and **Add a bond** all find their table the same
way:

1. If the character's background names its own bonds table, that table is
   used. Only a custom background can name one.
2. Otherwise, a **RollTable in your world named `Bonds`** is used if there is
   one.
3. Otherwise, the shipped **Bonds** table in **Tables (2e)** is used.

That means one world table named `Bonds` changes the bonds for every
background, canon ones included. If you delete it, the shipped bonds come back.

---

## Copy the 2e tables into your world

Open the **Rollable Tables** or **Compendium** sidebar tab and press **Create
Custom 2e Backgrounds and Tables…** (Wardens only), then **Copy**. Alongside
the 27 backgrounds, it copies the **eleven tables a 2e character rolls on**
into a **Custom 2e Character Creation** folder in your Rollable Tables: Bonds,
Omens, Scars, and the eight trait tables (Physique, Skin, Hair, Face, Speech,
Clothing, Vice, Virtue). The gold and item each shipped bond gives come along
too.

The Scars it copies is the one in **Utils**, which gives a scar when damage
calls for one. The `Scars` in **Tables (2e)** is the list of checkboxes on the
character sheet. The sheet always reads that list from the compendium, and a
note on the table says so.

Treat the shipped compendiums as templates. Copy from them, and edit the copy.
A world table with a shipped table's name is rolled instead of the shipped
one, so once the eleven are copied you can reword a bond, add an omen or
change a scar by editing the table in your sidebar.

Running it again never overwrites anything. A table you've edited is kept as
it is, and only what's missing is added. A copy you renamed is left alone too, and a
fresh copy lands under the shipped name beside it.

Each copy opens with a note at the top:

- It says Air Bladder rolls this table instead of the shipped one, and how to
  add a row.
- A table opens in view mode, where you can't add rows. The note tells you
  to press **Edit** at the top of the window first.
- A new row is rolled with the rest straight away. The table's die follows its
  rows: a twenty-first bond makes the formula `1d21`, and deleting the last row
  shrinks it back.
- Tables rolled with more than one die, such as the NPC reaction, encounter
  and GLoG mishap tables, don't change their own formula. Their note names
  the dice and asks you to set the formula on the **Summary** tab yourself.
- If two tables in your world share a name, both say so. Air Bladder can't
  tell which to read, so rename or delete one.

To copy one table instead of all eleven, import it by hand as below.

---

## Replacing the bonds for the whole world

1. Open the **Compendium** sidebar tab → **Tables (2e)** → right-click
   **Bonds** → **Import Entry**.
2. The copy lands in your **Rollable Tables** sidebar, named `Bonds`. Keep
   that name, because it's how Air Bladder finds the table.
3. Edit it there: reword, delete or add rows. Any number of rows works, and
   the die follows the rows. A thirty-row table rolls `1d30`.

The imported rows keep the gold and the item each shipped bond gives, so a
reworded row still gives them.

**Rows you add by hand only give their text.** Foundry's table editor can't
attach gold or an item to a row. Put anything mechanical in the prose and let
the player apply it.

**Don't edit the copy inside Tables (2e).** A system update replaces that
compendium. Your world's copy survives.

---

## A bonds table for one background

A **custom background** can name its own table in the **Bonds table** box on
its Details tab (see
[Creating a custom 2e background](creating-custom-backgrounds.md)). Type the
table's name. Your world's tables are checked first, then every compendium.
If you leave the box empty, the background uses the default above. Rows in a
table of your own only give their text.

If the name doesn't match a table, the default is used and a warning goes to
the browser console. A background shared to a world that doesn't have its
table still hands out ordinary bonds.

Canon backgrounds don't have this box. To give one of them its own bonds, open it
in **Backgrounds (2e)**, click **Duplicate into Custom 2e Backgrounds**, and
set the box on the copy. Then switch the original off with the **eye toggle**
on its picker row, so that only the copy comes up (see
[Taking a background out of play](generating-characters.md#taking-a-background-out-of-play)
in Generating Characters).

---

## Two bonds, and repeats

A character is owed one bond, plus:

- one more if the background gives two. A custom background does that with its
  **Grants two bonds** checkbox. A shipped one, such as the Fieldwarden, does
  it with a description that contains the sentence "roll a second time on the
  bonds table". The checkbox and the sentence together still only count once.
- one more for each rolled question answer that contains that sentence.

If a bond comes up that the character already has, it's re-rolled, up to ten
times. After that the repeat is kept, so a bonds table with fewer rows than
the character has bonds still gives every bond owed.

---

## Omens work the same way

The omen die on the character sheet, and the list button beside it, use a
**RollTable in your world named `Omens`** in place of the shipped one in
**Tables (2e)**. If you delete it, the shipped table comes back. Import the
shipped **Omens** table the way step 1 above imports Bonds, keep the name, and
edit it. Any number of rows works. Omen rows are plain prose and don't give
anything.

---

## Every other table the generators roll

**A table in your world with the same name is rolled instead of the shipped
one.** That covers every table a generator or a sheet die uses. Import the
shipped table, keep its name and edit it. The button on the Warden's Dashboard
and the generator both roll yours. If you delete it, the shipped table comes
back.

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
  beside them. On a spell table, a row that isn't a spellbook is skipped.

You don't need to unlock a system compendium for any of this, and you don't
lose any of it when Air Bladder updates.

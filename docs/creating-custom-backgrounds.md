# Creating a custom 2e background

A **custom background** is a Cairn 2e background you write yourself: All custom, or "home-brewed" backgrounds include:
- a description
- example names
- starting gear
- Two d6 question tables.

They work the same way that a background in published in the Cairn 2e Player's Guide do and appear in the Background Picker unless you hide them from the picker or disable custom 2e backgrounds.

This page covers writing a custom background. To move one of your custom backgrounds to another world or another Warden, see [Sharing & moving custom backgrounds](sharing-custom-backgrounds.md).

Only wardens can create custom backgrounds. 

---

## Start by duplicating a shipped background

A copy of a shipped background gives you a complete example to edit.

1. Open the **Compendium** sidebar tab → **Air Bladder - Backgrounds** →
   **Backgrounds (2e)** and click a background.
2. Open its **Details** tab and click **Duplicate into Custom 2e Backgrounds**.

A shipped background opens on its Description tab, where a note points you to
Details. You don't need to import the background first, because the button
works on the locked compendium entry.

The first time you use it, the button creates a world compendium called
**Custom 2e Backgrounds**. It puts an editable copy there, named after the
original with *(Copy)* added, and opens it. Rename the copy and replace its
content using the fields described under [The sheet](#the-sheet).

## Editing the backgrounds that ship with Air Bladder

To edit the shipped backgrounds themselves, open the **Rollable Tables** or
**Compendium** sidebar tab and press **Create Custom 2e Backgrounds and
Tables…** at the top (Wardens only). A window explains what will be copied. Press **Copy**.

It copies all 27 shipped 2e backgrounds (20 from the Cairn 2e Player's Guide, plus 7 classic D&D style backgrounds) into your **Custom 2e Backgrounds**
compendium under their own names, with and switches custom
backgrounds on. The 27 are the Player's Guide's twenty and the seven in
**Backgrounds (Custom)**.

Treat these shipped backgrounds as templates; copy them and edit them as needed.

## Air Bladder uses the Custom Background before using the another background with the same name in the compendium

Each custom background **stands in** for the shipped background of the same name in all pickers and character generators. If you delete a custom background that was copied from a canon background, Air Bladder will revert to using the canon background in the compendium. To take any background out of play without deleting it, use the eye toggle in the background picker. A background you switched off before copying stays off. See [Taking a background out of play](generating-characters.md#taking-a-background-out-of-play)
in Generating Characters.

The "Create Custom 2e Background" button copies the **eleven tables a 2e character rolls on** into a **Custom 2e Character Creation** folder in your Rollable Tables: Bonds, Omens, scars (the one in **Utils**, which gives a scar when damage calls for one), and the eight trait tables (Physique, Skin, Hair, Face, Speech, Clothing, Vice, Virtue). A table in your world with a shipped table's name is rolled instead of
the shipped one, and the trait lists on the character sheet offer your rows.
See [Customizing Bonds](customizing-bonds.md).

A window then tells you what was copied, with two buttons: **Open Custom 2e
Backgrounds on the Compendium tab** and **Show the Custom 2e Character Creation folder in Rollable Tables**. The backgrounds compendium sits on the Compendium tab, outside the Air Bladder folders.

**Running it again never overwrites anything.** A copy you've edited is kept, and
only what's missing is added. If your Custom 2e Backgrounds compendium is
locked, the backgrounds aren't copied. Unlock it and run it again.

## Starting from nothing

There isn't a "new background" button, but you can start from an empty Item:

1. Open the **Items** sidebar tab and click **Create Item**.
2. Name it and set **Type** to **Background**.
3. Fill in the fields described below.
4. On the **Details** tab, click **Duplicate into Custom 2e Backgrounds**.

You can't skip step 4. A background in the Items sidebar never shows up in the
picker. Only one in a compendium does.

---

## The sheet

The background sheet has two tabs.

**Description** is the prose a player reads in the picker and on their
character sheet. The picker's list shows its **first sentence** beside the
background's name, so write that sentence to stand alone. To edit the text,
hover over the box and press the edit button in its top-right corner.

**Details** is the form. At the top are **Test ×10** and **Duplicate into
Custom 2e Backgrounds**, then the sections below.

### Source and Archetype

**Source** always reads *Cairn 2e* and can't be changed.

**Archetype** (Wizard, Fighter, Thief, or blank) sets the picker group for a
copy that stands in for one of the Player's Guide twenty. A background of your
own is listed under **Custom 2e Backgrounds** in the picker, whatever its
archetype is, so you can leave it blank. The archetype never shows up on a
character sheet.

### Credit line

This is one line saying who wrote the background and under what licence.
Whatever you type prints in the footer of every character sheet built on this
background, beside Cairn's own credit. The box suggests the form:

    Title — Author · CC BY-SA 4.0

**Leave it empty for your own unshared work.** Cairn's credit prints on every
sheet anyway. Fill it in when you hand the background to someone else.

**If you duplicated someone else's background, their credit is already in the
box.** A duplicated Cleric carries *Backgrounds for Cairn — Gordon McCormick,
after BECMI D&D by Frank Mentzer · CC BY-SA 4.0*. Keep it for as long as any of
their writing is still there, as CC BY-SA requires. You can add your own name
beside theirs. Once their text is all gone, replace it with your own.

Air Bladder prints what's in the box and doesn't add anything.

### Bonds

**Grants two bonds** makes characters from this background roll on the bonds
table twice. **Bonds table** names a RollTable of your own for this
background's bonds. Most backgrounds leave both alone. See
[Customizing bonds](customizing-bonds.md).

### Example Names

These are the names offered when a character rolls this background. **Add a
name** adds a row, and the ✕ removes one.

If there aren't any names, a generated character is named after the background
itself.

### Starting Gear

These are the items every character of this background starts with. There are
two ways to add one:

- **Drag an item in** from a compendium or the Items sidebar. The background
  keeps its own copy of the item, marked with a camera badge.
- **Add gear by name** and type a name. The item is looked up by that name
  when a character is generated.

Each row has a **uses** box and shows the item's armor, damage, bulky or
petty tag and its uses once the name matches an item.

A dragged-in copy travels with the background, so someone you share it with
doesn't need your custom items. Later edits to the original item don't reach
the copy. Use a name for gear every Air Bladder install ships, and drag in
anything you made yourself.

### Question Tables (2 × d6)

There are two tables of six options each. You can't change the number of
tables or options.

Each table has a **question**. Each option has:

- a **description** in prose: what happened, and what it gives;
- **Bonus gold**, a number;
- a box to drag items into. They're kept as copies, the same way dragged
  starting gear is.

At generation, one option is rolled on each table, and its prose, gold and
items go to the character.

An empty option can still be rolled, and it doesn't give the character
anything. Test ×10 reports each one.

---

## Test ×10

**Test ×10** rolls the background ten times without creating a character and
shows a report.

**Problems** come first, if there are any:

| What it says | What it means |
| --- | --- |
| *Source is not "Cairn 2e", so this won't appear in the 2e picker.* | The background won't be offered. |
| *No example names — generation falls back to the background's own name.* | Characters will be named after the background. |
| *A starting-gear row has no name.* | An empty row that doesn't give anything. |
| *Starting gear "X" resolves to nothing — it will silently vanish. Drag the item in to snapshot it, or fix the name.* | The name doesn't match an item, so characters won't get it. Fix the spelling or drag the item in. |
| *Table 1, option 2: "X" resolves to nothing — it will silently vanish. …* | The same, for an item on a question option. |
| *Table 1, option 6 is empty — a d6 can still roll it, granting nothing.* | An option that doesn't have any prose, gold or items. |

If there aren't any problems, the report reads *Looks self-contained — every
grant resolves.*

Below that, the report lists the starting gear, how many of the ten rolls
landed on each option of each table, and the bonus gold across the ten rolls
(average and range). If one option gives far more gold than the rest, you'll
see it here.

---

## Making it appear in the picker

Custom backgrounds are offered only while this setting is on:

**Game Settings → Configure Settings → Air Bladder → Character Generation →
Configure Character Generation → Offer custom Cairn 2e backgrounds**

With it on, your backgrounds are listed under **Custom 2e Backgrounds** at the
end of the picker. A copy made by **Create Custom 2e Backgrounds and Tables…**
keeps the place its shipped original had, because it stands in for it.

The same setting also offers the seven class backgrounds in **Backgrounds
(Custom)**: Fighter, Cleric, Magic-User, Thief, Dwarf, Elf and Halfling, from
Gordon McCormick's *Backgrounds for Cairn*. "Custom" here means any background
not published in the Cairn 2e Player's Guide, whoever wrote it.

Turning off **Offer canon Cairn 2e backgrounds** still leaves those seven
on offer beside yours. To offer only your own, also switch the seven off one
by one with the **eye toggle** on each picker row (see
[Taking a background out of play](generating-characters.md#taking-a-background-out-of-play)
in Generating Characters).

If a finished background doesn't show up, check three things. You won't get an
error for any of them.

1. The setting above is off.
2. Its **Source** isn't *Cairn 2e*.
3. It's in the Items sidebar. It has to be in a compendium that belongs to the
   world or to a module.

---

## Where it lives

Your backgrounds live in a world compendium called **Custom 2e Backgrounds**,
created the first time you duplicate into it. You can edit it, and it belongs
to that world only, which is why sharing has its own steps. A world that created
the compendium under an earlier name keeps that name, and Air Bladder's
messages use whichever name your world has.

### Two compendiums with similar names

| | **Backgrounds (Custom)** | **Custom 2e Backgrounds** |
| --- | --- | --- |
| Comes from | Air Bladder, in every install | your world, created on first duplicate |
| Where it appears | inside the *Air Bladder - Backgrounds* folder | outside that folder |
| Editable | no, it's replaced on every system update | yes |
| Holds | seven third-party class backgrounds | what you write |

**Never write into *Backgrounds (Custom)*.** A system update replaces it, and
work put there is lost without warning. To change one of the seven, open it and
use **Duplicate into Custom 2e Backgrounds**, or copy all 27 with **Create
Custom 2e Backgrounds and Tables…**.

**Your compendium sits outside the *Air Bladder - Backgrounds* folder.** That
folder holds the four compendiums Air Bladder ships: Backgrounds (2e),
Backgrounds (Barebones), Backgrounds (Custom) and Background Items. Yours
belongs to the world. You can drag it into a folder of your own, and Air
Bladder finds it wherever it is.

Backgrounds delivered in a **module** can't be edited. To change one, open it
and use **Duplicate into Custom 2e Backgrounds**.

See [Sharing & moving custom backgrounds](sharing-custom-backgrounds.md).

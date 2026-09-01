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

## Replacing the bonds for the whole world

1. Open the **Compendium** sidebar tab → **Tables (2e)** → right-click
   **Bonds** → **Import**.
2. The copy lands in your **Rollable Tables** sidebar, named `Bonds`. That name
   is the whole mechanism — keep it.
3. Edit it there: reword rows, delete rows, add rows. Any number of rows works;
   set the table's roll formula to match (a thirty-row table wants `1d30`).

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
open it in **Backgrounds (2e)**, click **Duplicate into Custom Backgrounds**,
set the box on the copy — and switch the original off with the **eye toggle**
on its picker row, so the copy is the one that comes up.

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

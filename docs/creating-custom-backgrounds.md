# Creating a custom 2e background

A **custom background** is a Cairn 2e background you write yourself: a tagline and
description, example names, starting gear, and two d6 question tables. Air Bladder
treats it exactly like a shipped one — it appears in the character-creation picker,
grants its gear, and rolls its questions.

This page is about **authoring** one. Once you have it working, see
[Sharing & moving custom backgrounds](sharing-custom-backgrounds.md) for getting it
to another world or another Warden.

You need to be the Warden (GM). Everything here happens in a world.

---

## The fastest start: duplicate a shipped background

Writing one from a blank sheet means filling twelve question-table options before
you can see anything work. Copying a real background gives you a complete, correct
example to edit down.

1. Open the **Compendium** sidebar tab → **Air Bladder - Backgrounds** →
   **Backgrounds (2e)** → click any background (say *Fieldwarden*).
2. Switch to the **Details** tab and click **Duplicate into Custom Backgrounds**.

The button is on **Details**, not Description, and a shipped background opens on
Description — so if you cannot see it, you are on the wrong tab. You do **not** need
to import the background into your world first; the button works directly on a
locked compendium entry.

That does two things: it creates a world compendium called **Custom Backgrounds**
the first time you use it, and it puts an editable copy inside, named
*Fieldwarden (Copy)*.

Open that copy and you have the authoring sheet. Rename it, then work through the
fields below, replacing the borrowed content as you go.

## Starting from nothing instead

There is no separate "new background" button. Duplicating is the intended path, but
the Background item type is public, so you can start from an empty one:

1. Open the **Items** sidebar tab and click **Create Item**.
2. Name it and set **Type** to **Background**.
3. Fill in the fields described below.
4. On the **Details** tab, click **Duplicate into Custom Backgrounds** to file it in
   the world compendium — created for you if it does not exist yet.

Step 4 is not optional. A background sitting loose in the Items sidebar is not a
content source and will never appear in the picker.

---

## The sheet

The background sheet has two tabs.

**Description** is the prose a player reads in the picker and at the top of their
character sheet. The **first sentence** is used on its own as the tagline in the
picker's list, so lead with something that reads well truncated.

It is a rich-text field, and its edit button only appears when you hover over the
top-right corner of the box — so an empty Description can look like a static panel
rather than something you can type in.

**Details** is the authoring form. It has a toolbar with **Test ×10** and
**Duplicate into Custom Backgrounds**, then six sections.

### Source and Archetype

**Source** is fixed at *Cairn 2e* and is not editable — a custom background is a 2e
background by definition.

**Archetype** is a dropdown (Wizard / Fighter / Thief, or blank). It decides which
group the background sits under in the picker. It is *only* used there — it never
appears on a character sheet — but leaving it blank means the background sits
ungrouped, which looks like a mistake to a player.

### Credit line

Who wrote this background, and under what licence. One line — a title, a name,
a licence. It is the only field here that leaves your world: whatever you type
prints in the footer of every character sheet built on this background, beside
Cairn's own credit.

**Leave it empty for your own unshared work.** Cairn's credit prints on every
sheet regardless, because the page reproduces Cairn's rules whether a background
is involved or not. An empty field simply prints nothing extra. Fill it in when
you are handing the background to someone else, so your name travels with it:

    Bramblewick — A. Warden · CC BY-SA 4.0

**If you duplicated someone else's background, their credit is already in the
box.** Duplicate a Cleric and you get *Backgrounds for Cairn — Gordon McCormick,
after BECMI D&D by Frank Mentzer · CC BY-SA 4.0*, because that is whose writing
you are starting from. Keep it while any of their words remain — that is what
CC BY-SA asks of you, and adding your own name beside theirs is the usual way to
put it. Once you have rewritten the thing entirely and none of their text is
left, the box is yours to empty and replace.

Air Bladder never guesses at this. It reads the box and prints it, so nothing
puts a name on your writing that you did not put there yourself.

### Bonds

Two fields most backgrounds never touch. **Grants two bonds** makes characters
from this background roll on the bonds table twice instead of once. **Bonds
table** names a RollTable of your own to draw this background's bonds from,
instead of the default every other background uses. Both — and how bonds
resolve in general — are covered in [Customizing bonds](customizing-bonds.md).

### Example Names

A list of names offered when a character rolls this background. **Add a name**
appends a row; the ✕ removes one.

If you leave this empty, generation falls back to the background's own name, so a
Smuggler character will be called "Smuggler". Ten or so names is the shipped norm.

### Starting Gear

The items a character gets for free. Two ways to add one, and the difference
matters:

- **Drag an item in** (from a compendium or the Items sidebar) — this stores a
  **frozen copy** of the item, marked with a 📷 camera badge.
- **Add gear by name** and type a name — this stores a *reference* that is looked up
  when a character is generated.

Each row also has a **uses** box, for things like a torch with 3 uses, and shows the
item's tags (Armor, Damage, bulky, petty) once it resolves.

> **Why the freeze:** a snapshot travels. Someone who installs your background does
> not need your custom items — the copy is inside the background itself. The price is
> that later edits to the original item do **not** propagate. Use a name reference
> for ordinary gear every Air Bladder install already ships (Rations, Torch, Rope);
> drag in anything you made yourself.

### Question Tables (2 × d6)

Two tables, six options each. This shape is fixed — you cannot add a third table or
a seventh option, because generation rolls a d6 on each.

Each table has a **question** ("What happened at your final performance?"), and each
option has:

- a **description**, written as prose — what happened, and what it grants
- **bonus gold**, a number
- an **items** drop zone, where dropped items are frozen the same way starting gear is

At generation, **one option per table is rolled** and its prose, gold, and items go
to the character. Both tables always fire, so a character gets two answers.

Empty options still count. A blank sixth option means a one-in-six chance of getting
nothing, and the linter will say so.

---

## Test ×10 before you trust it

**Test ×10** dry-runs the background ten times without creating anything. It is the
only way to see what you actually built, and it doubles as a linter.

It reports two things.

**Problems**, if any:

| What it says | What it means |
| --- | --- |
| *Source is not "Cairn 2e"* | It will not appear in the 2e picker at all. |
| *No archetype set* | It works, but sits ungrouped in the picker. |
| *No example names* | Characters will be named after the background. |
| *A starting-gear row has no name* | An empty row that grants nothing. |
| *Starting gear "X" resolves to nothing — it will silently vanish* | **The important one.** A name reference matching no item. Drag the real item in so it snapshots, or fix the spelling. |
| *(empty option — a d6 can still roll this)* | A blank question-table option. |

**A sampling run:** which of each table's six options came up across the ten rolls,
and the bonus-gold spread (average, min, max). This is how you notice that one
option grants 300 gold and the rest grant 10.

*Looks self-contained — every grant resolves* is the all-clear.

---

## Making it appear in the picker

A finished background is still invisible until you switch the source on:

**Game Settings → Configure Settings → Air Bladder → Character Generation → Configure Character Generation → "Offer custom Cairn 2e backgrounds"**

With it on, your custom backgrounds join the picker's **Custom** section.

That section is not only yours. The same setting also admits the seven class
backgrounds Air Bladder ships in **Backgrounds (Custom)** — Fighter, Cleric,
Magic-User, Thief, Dwarf, Elf, Halfling, from Gordon McCormick's *Backgrounds for
Cairn*. "Custom" here means *not published in the Cairn 2e Player's Guide*, whoever
wrote it, so third-party sets and your own arrive through the same switch.

So turning off *Offer canon Cairn 2e backgrounds* does **not** leave players rolling
only what you wrote — the shipped class backgrounds are still in the pool. For a pool
that is genuinely yours alone, switch those seven off individually with the **eye
toggle** on each picker row, which is per-background and remembered by the world.

Three things make a finished background invisible, and none of them produce an
error, so check them in this order if yours does not show up:

1. that setting is off
2. its **Source** is not *Cairn 2e*
3. it is not in a **world or module** compendium (a background sitting loose in the
   Items sidebar is not a content source)

---

## Where it lives

Custom backgrounds you write live in a world compendium called **Custom Backgrounds**,
created the first time you duplicate into it. Being a world compendium, it is editable
and belongs to that world only — which is why sharing needs its own steps.

### Two packs with nearly the same name, and only one is yours

This trips people up, so it is worth being exact:

| | **Backgrounds (Custom)** | **Custom Backgrounds** |
| --- | --- | --- |
| Comes from | the system, shipped in every install | your world, created on first duplicate |
| Where it appears | inside the *Air Bladder - Backgrounds* folder | outside that folder, on its own |
| Editable | no — replaced on every system update | yes |
| Holds | seven third-party class backgrounds | what you write |

**Never author into *Backgrounds (Custom)*.** It is a system pack, and a system pack is
overwritten wholesale when Air Bladder updates — work put there is gone at the next
release, with no warning and no recovery. If you want to change one of the seven, open
it and use **Duplicate into Custom Backgrounds**, which copies it somewhere that
survives.

**Your own pack sits outside the *Air Bladder - Backgrounds* folder**, and that is not
a mistake to fix. That folder groups the four packs the *system* ships — Backgrounds
(2e), Backgrounds (Barebones), Backgrounds (Custom) and Background Items — and Foundry
only lets a system file its own packs there. Your Custom Backgrounds compendium belongs
to the world, so it appears on its own. You can drag it into any folder you make
yourself; nothing in Air Bladder reads the folder, only the compendium.

Backgrounds delivered inside a **module** are read-only. To change one, open it and
use **Duplicate into Custom Backgrounds**, which copies it into your own editable
pack.

See [Sharing & moving custom backgrounds](sharing-custom-backgrounds.md).

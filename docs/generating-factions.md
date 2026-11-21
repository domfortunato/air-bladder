# Generating factions

**Create Faction** rolls Cairn 2e's **Setting Seeds** faction tables into a
faction write-up called a **dossier**, and files it as a **Journal Entry**. A
faction isn't a creature, so it isn't an Actor. It shows up in your Journal
sidebar, where you can rename it and edit it.

Only the Warden sees the button, and a dossier is hidden from players until
you share it.

---

## Where the button is

**Actors tab → the button row at the top → Create Faction** (the flag icon).
The same button is on the **Factions** tab of the Warden's Dashboard, under
**Create**.

It opens a window with a **Use random generation.** tick-box. If you leave it
ticked and press **Create**, every line of the dossier is rolled. The dossier
opens once it's made. Each press makes a new entry, and it never overwrites an
old one. **Cancel** or **✕** doesn't create anything.

## Choosing the parts yourself

If you clear the box, the window shows a **Name** field, a list for each of
**Type**, **Agent**, **First Trait**, **Second Trait**, **Agenda** and
**Obstacle**, and a tick-list of **Advantages**.

- **Name.** Whatever you type is kept exactly. If you leave it empty, the
  faction is named from its Trait and Type, the same way a rolled one is.
- **The six lists.** Each one holds the rows of its table in the table's own
  order, so if you rolled a faction at the table with the book, you can enter
  it row by row. Each list starts on **Random**, and any list you leave there
  is rolled for you.
- **Advantages.** Tick up to four. If you leave them all clear, both the number
  of advantages and the advantages themselves are rolled.

If all you have for a faction is a name, clear the box, type the name, leave
everything else alone and press **Create**.

## What the dossier contains

| Line | What it answers |
|---|---|
| **Type** | What kind of group this is |
| **Agent** | A representative you can put in front of the party |
| **Traits** | Two notes on how the faction behaves |
| **Advantages** | What the faction has going for it: 1 to 4 entries, never the same one twice. The number is rolled too, the way the SRD's procedure does it |
| **Agenda** | What they're trying to do |
| **Obstacle** | What stands in their way |

Unless you typed a name, the entry is called **"The ⟨Trait⟩ ⟨Type⟩"**, such as
*The Enigmatic Cultists*. Replace it when the faction earns a name in your
campaign.

**Players can't see a dossier.** To share one, give players Observer
ownership of the entry, as with any Foundry journal.

## The eight tables behind it

They're RollTables in the **Warden — NPCs** compendium:

- `Warden: NPC - Faction` (the Type line; also rolled by the Faction die on a
  sheet, below)
- `Warden: Faction - Agent`
- `Warden: Faction - Trait (Trait 1)`
- `Warden: Faction - Trait (Trait 2)`
- `Warden: Faction - Advantage (Count)`
- `Warden: Faction - Advantage`
- `Warden: Faction - Agenda`
- `Warden: Faction - Obstacle`

The text is the Cairn 2e SRD's Setting Seeds content (CC BY-SA 4.0, by Yochai
Gal). The generator never marks a table's rows as drawn.

## Making the tables yours

If a RollTable in your world has exactly one of the names above, the generator
rolls it and ignores the shipped one. Import a shipped table into your world,
keep its name, and edit it there. Your table survives every system update. An
edit made inside the shipped compendium doesn't, because the next update
replaces it. The lists in the Create Faction window read the same tables, so
your rows show up there too.

If a table is missing or empty, its line in the dossier is a dash and the rest
of the dossier is still made.

## The Faction die on NPC, Hireling and Monster sheets

These sheets have a **Faction** field on their first page, under Role. You can
always type in it. With Character Creation Mode on (the **CharGen** toggle in
the sheet's title bar), a d20 die appears beside it. The die rolls
`Warden: NPC - Faction` (your world's table first) and fills the field. It
doesn't change anything else on the sheet. An NPC's or Hireling's sheet also
has a list button for choosing a row.

To put your own factions on that die:

1. Press **Create Faction** until you get one you like. Rename it and edit its
   dossier.
2. Add the faction's name as a row in your world's copy of
   `Warden: NPC - Faction`.
3. The Faction die now gives your factions to NPCs, Hirelings and Monsters.

The Create Faction window's **Type** list reads the same table, so your
factions' names show up there too. Pick one to write up a splinter group or a
rival chapter of a faction you already have.

## Language

A dossier is written in the language Foundry was using when it was made, and
it stays in that language. A generated monster works the same way.

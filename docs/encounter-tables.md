# Encounter tables

Air Bladder ships seven encounter tables. When a rolled row names monsters, your
copy of the card has an **Add to scene** button that rolls how many, fetches the
monster and places the tokens. Players see a plain card.

Tables you build get the same button if you write their rows the same way: type
the dice, then drag the monster in.

You need to be the Warden (GM), in a world.

---

## The shipped tables

**Compendium sidebar → Air Bladder - Warden Tables → Warden — Encounters & Reactions**:

| Table | Roll | Terrain |
| --- | --- | --- |
| Warden: Encounters - Plains | d6 + d10 | open grassland |
| Warden: Encounters - Forest | d6 + d10 | woodland |
| Warden: Encounters - City Ruins | d6 + d10 | ruins |
| Warden: Encounters - Hills / Mountains | d6 + d10 | high country |
| Warden: Encounters - Marshlands / Quagmire | d6 + d10 | wetlands |
| Warden: Encounters - Lake | 2d4 | near open water |
| Warden: Encounters - Dungeon | 1d6 | an example |

The terrain tables pair with **Warden: Events - Wilderness**. When a travel
watch turns up an *Encounter*, roll the table for the terrain you are in. Page
references in the rows are to the **Cairn 2e Bestiary**.

All seven are also on the Encounters tab of the
[Warden's Dashboard](warden-dashboard.md).

You can roll a table straight from the compendium. Import it into your world
only to edit its rows; your copy works the same way.

A few rows name creatures the Monsters compendium does not have (Burrowing
Horror, Creeping Vines, Night Cat, Root Witch, Will-o-Wisp, Kraken). Those rows
still roll but have no button. If you make your own actor for one, import the
table, press **Edit**, and open that row with the pen icon at its end. In its
**Description**, put a count in front and drag your actor into the text.

## What the button does

Click **Add to scene: 1d6 × Goblins** and, for each rolled row:

1. **The quantity is rolled** and posted to chat.
2. **The monster is imported once**, into an **Encounters** actor folder made on
   first use. Later encounters with the same monster reuse that actor. You can
   rename or move the folder.
3. **Tokens are placed on the scene you are viewing**, around the centre of your
   view, each on its own grid cell. Each token takes its own damage; see
   [Tokens and Sheets](tokens-and-sheets.md).

The card then reads **Added to the scene** and the button will not work twice.
Roll again for a new card. If no scene is open, nothing is rolled or placed.

Tokens arrive with **neutral disposition**, because meeting something is not
fighting it. Roll **Warden: NPC - Reactions** to find out how it feels about
the party.

The button places tokens and nothing more. It does not read the monster's stats
or roll its attacks.

---

## Building your own

Make a Rollable Table in the sidebar or in a world compendium, and write each
result like this:

> `1d6` *drag a monster from the Monsters compendium into the text* ` — your prose after`

That text is the row's **Description**: press **Edit** at the top of the
table's window, then the pen icon at the end of the row.

Dragging the monster in makes a link in the text. The leading dice, or a plain
number, are the quantity. A row gets the button when it has both.

- **The count must come first.** `1d4 [Wolves] on the ridge` gets a button.
  `Wolves guard the [Ogre] bridge` does not.
- **The quantity applies to the first link only.** A row like
  `1d6 [Gnolls] (pg 69) or [Gnomes] (pg 70)` places Gnolls. Place the Gnomes by
  hand if you choose them.
- **`random NPC` runs the NPC generator.** A row containing that phrase makes a
  new person each time, with stats, a portrait and a name, filed in the
  Encounters folder. The count is optional and defaults to 1.
- **The link's label is only wording.** You can edit a link's text after
  dragging the monster in. The shipped Hills table links the Tiger and labels
  it *Mountain Lion*, and the Dungeon table pluralizes *Goblins*. The monster
  placed is the one the link points at.
- **A row with no count, or no link, has no button.** It rolls like any other
  row.
- **An actor dropped in as the result itself** also works. The count is read
  from the row's text if you write one, and is otherwise 1.

There is no setting to switch on.

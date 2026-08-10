# Encounter tables

Air Bladder ships seven encounter tables, and a draw from any of them can put its
result **on the map**: the Warden's copy of the draw card grows an **Add to scene**
button that rolls the quantity, fetches the monster, and places the tokens. Players
see a plain card — the button exists only for you.

The same button appears on tables **you** build, with no setup beyond writing the
rows a particular way. The convention is the whole trick, and it is two things:
type the dice, drag the monster in.

You need to be the Warden (GM). Everything here happens in a world.

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
| Warden: Encounters - Dungeon | 1d6 | an example, close to home |

The terrain tables pair with **Warden: Events - Wilderness** — when a travel watch
turns up an *Encounter*, roll the table for the terrain you are in. Page references
in the rows are to the **Cairn 2e Bestiary**.

You can roll a table **straight from the compendium** — no import needed. Import it
into your world only if you want to edit the rows, and then your copy's draws work
the same way.

A few rows name creatures the Monsters compendium does not have (Burrowing Horror,
Creeping Vines, Night Cat, Root Witch, Will-o-Wisp, Kraken). Those rows still roll
and still tell you what you met — they just have no button, because there is
nothing to place. If you make your own actor for one, import the table, put a count
in front, and drag your actor into the row; it lights up like any other.

## What the button does

Click **Add to scene: 1d6 × Goblins** and, for each rolled row:

1. **The quantity is rolled for real** — a dice roll posted to chat (Dice So Nice
   animates it if you have it).
2. **The monster is imported once**, into an **Encounters** actor folder created on
   first use. Every later encounter with the same monster **reuses that one actor**
   — you get N tokens, never N copies of the actor. Rename or move the folder
   freely; it is recognized by an internal marker, not its name.
3. **Tokens are placed on the scene you are viewing** — unlinked, clustered around
   the centre of your current view, each on its own grid cell.

The card then reads **Added** and will not fire twice. Draw again for a fresh card
with a fresh button. If no scene is open, the click refuses politely and nothing is
rolled or written.

Tokens arrive with **neutral disposition** on purpose: meeting something is not the
same as fighting it. Roll **Warden: NPC - Reactions** to find out how it feels
about you.

That is all the button automates — logistics. Nothing reads the monster's stats or
rolls its attacks for you.

---

## Building your own

Make a Rollable Table anywhere — the sidebar, a world compendium — and write each
result like this:

> `1d6` *drag a monster from the Monsters compendium into the text* ` — your prose after`

Dragging the monster in creates a link in the text; the leading dice (or a plain
number) are the quantity. That is the entire convention. A row qualifies for the
button when it has **both**: a leading count, and a monster link.

The details, each of them deliberate:

- **The count must come first.** `1d4 [Wolves] on the ridge` gets a button;
  `Wolves guard the [Ogre] bridge` does not — prose that merely *mentions* a
  monster never grows one.
- **The quantity applies to the first link only.** A choice row like
  `1d6 [Gnolls] (pg 69) or [Gnomes] (pg 70)` places Gnolls; the *or* stays yours
  to exercise by hand.
- **`random NPC` is a magic phrase.** A row containing it (say
  `1 random NPC — lost, curious, or up to no good`) runs the NPC generator
  instead: a brand-new person with a statblock, a face, and a name, different
  every time, filed in the Encounters folder. The count is optional and defaults
  to 1.
- **The link's label is display wording, not a lookup.** After dragging a monster
  in you can edit the link's text — the shipped Hills table links the Tiger and
  labels it *Mountain Lion*, and the Plains table pluralizes *Goblins*. The
  monster placed is the one the link points at, whatever the label says.
- **A row with no count, or no link, is plain prose.** `All quiet` and
  `Herd Animals (Deer, Goats)` draw like any other row and simply have no button.
- Dropping an actor **as the result itself** (a document-type row) works too — the
  count is read from the row's text if you write one, else 1.

There is nothing to register and no setting to switch: if the row parses, the
button appears on its draw card.

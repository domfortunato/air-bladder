# Changelog

Release notes for Air Bladder, newest first. Each `## X.Y.Z` section is the body of
that release on GitHub: `npm run release X.Y.Z` refuses to cut a release without one,
writes the section into the release tag, and the Release Creation workflow creates
the release with it. `npm run release X.Y.Z -- --dry-run` shows the exact body before
anything is written. The procedure is in [RELEASE.md](RELEASE.md).

Releases before 0.1.23 have their notes on the
[releases page](https://github.com/domfortunato/air-bladder/releases) only.

## 0.1.24

**Requires Foundry VTT 14.365 or higher.**

- Three optional combat rules for player characters, each off by default under Configure Hacks: **Exploding damage dice** (a die explodes at most half its faces less one times), **Fatigue instead of Critical Damage**, and **Maneuver on max damage**
- An **Improvised Attack** row at the top of every inventory rolls damage with nothing in hand: say what you attack with and type the dice (panic still forces 1d4)
- A **Drop** control beside the trash puts an item in the party's **Dropped Item Pile**, with an optional note of where it was left; the Warden hands it back with Give. New player characters are created in a **Party** folder
- Resting costs a ration: a player character with no rations cannot rest
- The Warden chooses a player character's generation dice: ability dice, gold dice and a Hit Protection formula, which can be a flat number
- A weapon row's dice show what it rolls, and each trait's die shows its table's die
- Fixed: changing the custom portrait folder just after loading the world could cache the old folder's portraits

## 0.1.23

**Requires Foundry VTT 14.365 or higher.**

- Four buttons at the top of the Rollable Tables sidebar copy the shipped compendium tables into your world: the Spell Table, the Marketplace, the Barebones creation tables, and the Backgrounds with their Bonds, Omens, Scars and trait tables, that last one also at the top of the Compendium tab. Each lands in a **Custom…** folder with every item its rows point at, and a result window opens what it made
- Every table the generators roll is read from your world first: a world table with the shipped name replaces it, for traits, NPC and monster tables, Barebones creation, Scars and the random-spell table alike, the rule Bonds and Omens already followed
- A customizable marketplace: a world table named **Market: Gear** (or Weapons, Armor, Transports & Containers) replaces that aisle and a new **Market:** name adds one; a dropped item lands in alphabetical order
- Every table Air Bladder reads carries a note on its sheet saying what reads it and how to add a row, and warns when two world tables share a name; a flat-die table's formula follows its rows
- The random-spell pool is a table, **Spells — Canon (1d100)**, so a world copy of it changes what generated characters carry; **Spells — GLOG** ships for the hack
- Take a shipped background out of play with the eye toggle in the background pick-list
- Your own backgrounds compendium is created as **Custom 2e Backgrounds**; a world that already has one keeps its name
- Removed: the More Spellbooks compendium (0.1.22 was the last release to ship it; a world that imported from it keeps its copies) and the Reseed a Spell Table button, replaced by Create a Custom Spell Table…
- The Grimoire and GLOG checkboxes show only while the GLOG hack is on, and the Grimoire box only on an item that already is one
- A date change is guarded: Set the Date… previews the destination and its distance in days, and the calendar asks before moving the world to a clicked day
- The four Create a Custom… buttons are greyed while one is working, and the Actor Directory's buttons wrap instead of clipping at a large font size
- Fixed: dates before Vald's year 7728 lost their weekday and broke the calendar grid
- Fixed: a scar recorded from damage now ticks its box on the character sheet
- Fixed: three chat cards showed players the contents of private Warden rolls, and the change log now reads in each viewer's language
- Fixed: after paging the calendar, Add an event… and Set to this day act on the day shown, and the confirm opens on Cancel
- Fixed: the monster generator reads a dragged-in table row as plain text
- If you ran the dev branch before this release and pressed Create Custom 2e Backgrounds and Tables…, delete your world's **Scars** table and press the button again

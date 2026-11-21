# Generating Characters

A Cairn character is rolled first and chosen afterwards. Air Bladder has three
ways to get one — roll it, open an empty sheet, or import it from Kettlewright —
and one set of tools on the sheet for changing the result. There is no
step-by-step character builder.

## Create PC

**Create PC** is in the button row at the top of the Actors sidebar. It asks one
question, then rolls a whole character: a name, a portrait, abilities, Hit
Protection, gold, a background with its gear and questions, traits and an age.
A Cairn 2e character is also dealt a bond. The finished sheet opens, and the
character is filed in the **Party** folder.

If you offer both Cairn 2e and Barebones, the same window asks which edition
the character is. Custom 2e backgrounds join the 2e pool; they do not add a
choice. The three switches — **Offer canon Cairn 2e backgrounds**, **Offer
Cairn Barebones character sheets** and **Offer custom Cairn 2e backgrounds** —
are under **Game Settings → Air Bladder → Configure Character Generation**.
The edition decides only how a character is made. Both play by the same rules.

Two more settings in that window:

- **Show character generation dice rolls in chat** posts HP, STR, DEX, WIL and
  Gold as one chat message whenever a character is generated or re-rolled.
- **Show the Roll Character, Roll NPC and Roll Monster buttons in sheet
  headers** hides those three buttons when it is off.

## Start from an empty sheet

The question Create PC asks is a tick-box, **Use random generation.** Clear it
and you get a character with nothing rolled: no background, gear, bond, traits
or age. Abilities start at 10 and Hit Protection at 3. Type over them.

The same box is on **Create NPC**, **Create Hireling** and **Create Monster**.
On **Create Faction**, clearing it lets you pick each part of the faction from
its table (see [Generating factions](generating-factions.md)).

An empty sheet is for a table that rolls on paper. Roll the character with the
book and your own dice, then copy it in: type the numbers, and use the
**pick-list buttons** for anything that comes off a table. An empty sheet opens
with **Character Creation Mode** on, so those buttons are already showing. Turn
the mode off when you are done.

**An empty sheet is never handed anything.** Picking a background, a bond, a
background question's answer or a failed career records the choice and grants
no gear and no coins. Type the inventory in yourself.

The same holds for an empty NPC, hireling or monster. Giving an empty hireling
a career, or an empty NPC a background, records the choice and hands over none
of its gear. A career also leaves the numbers you typed alone.

This lasts for the life of the sheet. To have the dice furnish the character
after all, press **Roll Character** and leave **Background** or **Starting
gear** ticked. From then on the sheet behaves like a generated one, and a
background picked later brings its gear. On an NPC, hireling or monster,
**Roll NPC** or **Roll Monster** in the title bar does the same.

A player sees the tick-box only on Create PC, and only while **Let players use
Character Creation tools on their sheets** is on, because an empty sheet can
only be filled in with those tools. With it off, the player's window only
confirms.

## Import from Kettlewright

**Import from Kettlewright** is in the same button row. Choose a character's
`.json` export from [Kettlewright](https://kettlewright.com/), the official
Cairn app, and it becomes a new character here.

- Abilities, HP, gold and inventory arrive as exported.
- A stock Kettlewright portrait is matched to the same face. A portrait the
  player uploaded is shown from kettlewright.com; save a copy and set it from
  the sheet to keep it.
- Background questions and bonds are matched to their tables, so they can
  still be re-rolled or picked.
- A Barebones character arrives as Barebones.
- A pet becomes an item if Air Bladder has it as an item and the character has
  room. Otherwise it becomes a companion connected to the character.
- Kettlewright containers other than the main inventory are not rebuilt. Their
  contents go onto the character.
- An item or bond that matches nothing is still imported, built from its tags
  or kept as text.
- A background this world does not have does not stop the import. It is kept
  as plain text, and its questions' answers and bond cannot be re-rolled or
  picked from a table.

A summary window lists everything worth checking. Always look over the
inventory afterwards.

## Players can do both

Players see **Create PC** and **Import from Kettlewright** while **Allow
players to create new player characters through random generation or .json
import** is on. The shipped **Toggle Player Character Creation** macro flips
it mid-session. A player who imports gets the same options and the same
summary you would.

A player who lacks Foundry's permission to create actors can still use both
buttons. Your session makes the character and hands it over as theirs, and you
get a notice naming the player and the character. This needs a Warden logged
in. With none connected, that player's buttons are greyed out, with the reason
on hover, and they come back when a Warden arrives.

## The character sheet

The sheet turns its pages from the tabs hung on its edge:

- **Character** — portrait, name, Pronouns and Age, Background, the trait
  sentence, abilities, HP, Armor, inventory slots and Gold.
- **Inventory** — everything carried, and Fatigue.
- **Growth** — Scars, and a journal for the skills and abilities the character
  gains.
- **Background & Notes** — the bond, the background questions and their
  answers, the Omen, a description and notes.

## Character Creation Mode

A generated or imported character opens with its creation tools put away. The
toggle in the sheet's title bar reads **CharGen: Off**; press it to turn
**Character Creation Mode** on. While it is on:

- A **die** beside each part re-rolls that part alone: the name, the portrait,
  the age, the background (with its gear), the omen, a bond, a background
  question, and a Barebones character's failed career where that hack is on.
- A **pick-list button** (the list icon) beside the name, background, failed
  career, omen, bond and question dice, and on the portrait, lets you choose
  instead. Picking the rows you rolled on paper grants whatever those rows
  grant.
- A **pen** at the end of the trait sentence opens the **Traits** window, with
  a die and a list for each trait.
- The four **Max** boxes can be typed in. They are locked while the mode is
  off.
- The STR, DEX and WIL save dice are greyed out. Turn the mode off to roll
  saves.
- **Roll Character** appears in the title bar.

Generate, re-roll or pick the parts that do not fit, then turn the mode off
and play.

For players these tools follow **Let players use Character Creation tools on
their sheets**, flipped by the **Toggle Player Creation Tools** macro. You can
allow character creation and keep re-rolls to yourself, or allow both.

### Roll Character

**Roll Character** opens a checklist of everything that can be re-rolled.
Uncheck what you want to keep; only the rest is re-rolled.

- **Starting gear** and, on a 2e character, the name and the two Background
  Questions sit under **Background**. A new background deals its own. On a
  Barebones character the name has its own line.
- Bonds re-roll only when **Bond(s)** is checked. A new background still keeps
  only as many bonds as it allows. Any beyond that are removed, with their
  items and coins.
- A background you picked by hand starts unchecked.
- On a Barebones character, **Starting gear** also covers the Barebones
  equipment: the Rations, Torch, weapon, armor and Additional Gear roll are
  dealt again.
- What the list does not offer is never touched: notes, scars, pronouns, and
  anything bought or given.

A Barebones character made before Air Bladder 0.1.27 still holds the equipment
it was first dealt, and a re-roll cannot tell that from things the player
bought. Delete those items by hand once before you re-roll, or the character
ends up with both sets.

A companion, cart or pack that the old background or a question granted is
never deleted by a re-roll. It is disconnected from the character and stays in
the world, with everything stowed on it, until you delete it. Its name gains
**o_** in front (a Mule becomes **o_Mule**), so sorting the Actors tab by name
gathers them.

## Turn bonds off

**Game Settings → Air Bladder → Configure Character Generation → Use bonds.**
With it off:

- A new character is dealt no bond, and none of the items or coins a bond
  grants.
- Bonds leave every character sheet and the Roll Character window, and printed
  sheets drop their Bonds section.
- A background that says to roll a second time on the Bonds table, like the
  Fieldwarden, is shown without that sentence.

A character who already has a bond keeps it, with whatever it gave them. It is
hidden, and comes back if you switch the setting on again.

## Give Barebones characters a failed career

Knave 2e gives each character a career that didn't work out. To give Barebones
characters one, turn on **Give Barebones Characters a failed career (like Knave
2e)** under **Game Settings → Air Bladder → Configure Hacks**. It is greyed out
unless **Offer Cairn Barebones character sheets** is on. Cairn 2e characters
never get one.

With it on, Create PC deals a Barebones character two things:

- **Failed career** — a second Barebones background, never the character's
  own. It grants nothing else.
- **Failed career item** — one item drawn at random from that background's
  starting gear, kept as a keepsake. It is Petty, so it fills no slot.

Both lines sit under the background on the sheet. In Character Creation Mode
the career has a die and a list, and the item has a die that draws again from
the same career. A new career replaces the old keepsake. **Roll Character**
offers **Failed career** and, under it, **Keepsake item**. The printed sheet
shows the career.

Outside Character Creation Mode an empty line is hidden. Turn the setting on in
a world that already has Barebones characters and the lines appear, empty, in
Character Creation Mode for you to roll. Turn it off and the lines go; the
career and its keepsake stay on the character.

## Choose the dice

**Game Settings → Air Bladder → Configure Character Generation** has four
settings for what a character is rolled with. The first three apply to player
characters only. The age formula is also used for generated NPCs and
hirelings.

| Setting | Choices |
|---|---|
| **Ability dice for player characters** | Default (3d6) · Adventurer (4d6kh3) · Crawler (2d6 + 3) |
| **Gold dice for player characters** | the same three |
| **Hit Protection formula for player characters** | any formula; `1d6` by default |
| **Age formula for generated characters** | any formula; `2d20 + 10` by default |

**Default** is the book's roll. **Adventurer** rolls four dice and keeps the
best three. **Crawler** rolls between 5 and 15. The two menus are independent.

For Hit Protection, type a plain number for a fixed value: `4` gives every
character 4. Leave it blank for `1d6`. The notation is explained in
[Dice Formulas](dice-formulas.md).

These set the base roll only. Coins a bond or a background question grants are
added on top.

To see what a row will roll, hover STR, DEX, WIL, Hit Protection, Gold or Age
in the Roll Character checklist. The die beside Age on the sheet names its
formula the same way.

## Make the tables yours

Everything a generated character is dealt from is a rollable table. A table in
**your world** with a shipped table's name is rolled instead of the shipped
one. Foundry overwrites the shipped compendiums on every system update, so
treat them as templates: copy them into your world and edit the copies.

Three Warden-only buttons do the copying:

- **Create a Custom Spell Table…**, on the **Rollable Tables** sidebar tab.
  It copies the table a random spellbook or scroll is dealt from —
  `Spells — Canon (1d100)`, or `Spells — GLoG` while the GLoG Magic hack is
  on — into a **Custom Spells** folder, with every spellbook it can hand out.
  If you copy the canon list and switch the hack on later, press the button
  again for the GLoG list.
- **Create Custom Barebones Creation Tables…**, on the same tab. It copies the
  six tables a Barebones character is dealt from — Weapon, Armor, Additional
  Gear and the three Weapon Tier tables — into a **Custom Barebones Character
  Creation** folder, with every item, mount and transport they can hand out.
  The items are sorted into a subfolder per source compendium.
- **Create Custom 2e Backgrounds and Tables…**, on the same tab and at the top
  of the **Compendium** tab. It copies the 27 backgrounds and the eleven tables
  a 2e character rolls on. See
  [Creating Custom Backgrounds](creating-custom-backgrounds.md) and
  [Customizing Bonds](customizing-bonds.md).

Each button also points every row of the copied tables at your copies of the
items. A table imported by itself still hands out the shipped item, however
you edited yours. With the rows pointed at your copies, changing
a weapon's damage changes what the next character is dealt.

A window afterwards says what was copied and offers to open the folders.
Running a button again never overwrites anything. It only adds what is
missing.

Each copied table has a note at the top saying what it is dealt for and how to
add a row. A table opens in view mode, so press **Edit** at the top of its
window first. Drag a spellbook onto the spell table and the table re-sorts by
name, formula included, so the new spell can be rolled. Drag an item onto a
Barebones creation table and the table's die follows its rows.

## Taking a background out of play

You do not need a copy to hide a shipped background. Open any Cairn 2e
character with **Character Creation Mode** on and press the **pick-list
button** beside Background. Every background in play is listed, with an **eye**
at the end of its row that only the Warden sees. Click the eye and that
background is out: its row greys out for you, and players no longer see it or
roll it. Click the eye again to bring it back.

The choice is per background and holds for every character and every session
until you change it. It works on the Player's Guide twenty, the seven in
**Backgrounds (Custom)**, and your own copies. A copy made by **Create Custom
2e Backgrounds and Tables…** counts as the same background: one you switched
off stays off when its copy lands, and switching either back on switches on
both. The last background left in play cannot be switched off.

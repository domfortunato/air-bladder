# Generating Characters

You roll a Cairn character first and make your choices afterwards. Air Bladder
has three ways to get one: roll it, open an empty sheet, or import it from
Kettlewright. The sheet has one set of tools for changing the result. There
isn't a step-by-step character builder.

## Create PC

**Create PC** is in the button row at the top of the Actors sidebar. It asks one
question, then rolls a whole character: a name, a portrait, abilities, Hit
Protection, gold, a background with its gear and questions, traits and an age.
A Cairn 2e character also gets a bond. The finished sheet opens, and the
character goes into the **Party** folder.

If you offer both Cairn 2e and Barebones, the same window asks which edition
the character is. Custom 2e backgrounds join the 2e pool, so they don't add a
choice. The three switches — **Offer canon Cairn 2e backgrounds**, **Offer
Cairn Barebones character sheets** and **Offer custom Cairn 2e backgrounds** —
are under **Game Settings → Air Bladder → Configure Character Generation**.
The edition only decides how a character is made. Both play by the same rules.

That window has two more settings:

- **Show character generation dice rolls in chat** posts HP, STR, DEX, WIL and
  Gold as one chat message whenever a character is generated or re-rolled.
- **Show the Roll Character, Roll NPC and Roll Monster buttons in sheet
  headers** hides those three buttons when it's off.

## Start from an empty sheet

The question Create PC asks is a tick-box, **Use random generation.** If you
clear it, you get a character that hasn't been rolled. It doesn't have a
background, gear, a bond, traits or an age. Abilities start at 10 and Hit
Protection at 3, and you can type over them.

The same box is on **Create NPC**, **Create Hireling** and **Create Monster**.
On **Create Faction**, clearing it lets you pick each part of the faction from
its table (see [Generating factions](generating-factions.md)).

An empty sheet is for a table that rolls on paper. Roll the character with the
book and your own dice, then copy it in: type the numbers, and use the
**pick-list buttons** for anything that comes off a table. An empty sheet opens
with **Character Creation Mode** on, so those buttons are already showing. Turn
the mode off when you're done.

**An empty sheet is never handed anything.** When you pick a background, a
bond, a background question's answer or a failed career, the sheet keeps your
choice but doesn't add any gear or coins. Type the inventory in yourself.

The same goes for an empty NPC, hireling or monster. If you give an empty
hireling a career, or an empty NPC a background, the sheet keeps the choice but
doesn't hand over any of its gear. A career also leaves the numbers you typed
alone.

This lasts for the life of the sheet. If you want the dice to fill in the
character after all, press **Roll Character** and leave **Background** or
**Starting gear** ticked. From then on the sheet behaves like a generated one,
and a background you pick later brings its gear. On an NPC, hireling or
monster, **Roll NPC** or **Roll Monster** in the title bar does the same.

A player only sees the tick-box on Create PC, and only while **Let players use
Character Creation tools on their sheets** is on, because those tools are the
only way to fill in an empty sheet. When it's off, the player's window just
asks them to confirm.

## Import from Kettlewright

**Import from Kettlewright** is in the same button row. Choose a character's
`.json` export from [Kettlewright](https://kettlewright.com/), the official
Cairn app, and it becomes a new character here.

- Abilities, HP, gold and inventory arrive as exported.
- A stock Kettlewright portrait is matched to the same face. A portrait the
  player uploaded is shown from kettlewright.com. To keep it, save a copy and
  set it from the sheet.
- Background questions and bonds are matched to their tables, so they can
  still be re-rolled or picked.
- A Barebones character arrives as Barebones.
- A pet becomes an item if Air Bladder has it as an item and the character has
  room. Otherwise it becomes a companion connected to the character.
- Kettlewright containers other than the main inventory aren't rebuilt. Their
  contents go onto the character.
- An item or bond that doesn't match anything is still imported. It's built
  from its tags or kept as text.
- A background this world doesn't have won't stop the import. It's kept as
  plain text, and its questions' answers and bond can't be re-rolled or picked
  from a table.

A summary window lists everything worth checking. Always look over the
inventory afterwards.

## Players can do both

Players see **Create PC** and **Import from Kettlewright** while **Allow
players to create new player characters through random generation or .json
import** is on. The shipped **Toggle Player Character Creation** macro flips
it mid-session. A player who imports gets the same options and the same
summary you would.

A player who doesn't have Foundry's permission to create actors can still use
both buttons. Your session makes the character and hands it over as theirs, and
you get a notice naming the player and the character. This needs a Warden to be
logged in. If there isn't one connected, that player's buttons are greyed out,
with the reason on hover. They come back when a Warden arrives.

## The character sheet

You turn the sheet's pages with the tabs on its edge:

- **Character** — portrait, name, Pronouns and Age, Background, the trait
  sentence, abilities, HP, Armor, inventory slots and Gold.
- **Inventory** — everything carried, and Fatigue.
- **Growth** — Scars, and a journal for the skills and abilities the character
  gains.
- **Background & Notes** — the bond, the background questions and their
  answers, the Omen, a description and notes.

The tabs sit on the sheet's left edge. To have them on the right, change
**Page tabs side** in Configure Settings. It changes only your own screen,
and it moves the Warden's Dashboard's tabs too. If a sheet is too close to
that edge of the screen, its tabs move to the other side until you move it
back.

## Character Creation Mode

A generated or imported character opens with its creation tools put away. The
toggle in the sheet's title bar reads **CharGen: Off**. Press it to turn
**Character Creation Mode** on. While it's on:

- A **die** beside each part re-rolls just that part: the name, the portrait,
  the age, the background (with its gear), the omen, a bond, a background
  question, and a Barebones character's failed career where that hack is on.
- A **pick-list button** (the list icon) beside the name, background, failed
  career, omen, bond and question dice, and on the portrait, lets you choose
  instead. If you pick the rows you rolled on paper, the character gets
  whatever those rows give.
- A **pen** at the end of the trait sentence opens the **Traits** window, with
  a die and a list for each trait.
- You can type in the four **Max** boxes. They're locked while the mode is
  off.
- The STR, DEX and WIL save dice are greyed out. Turn the mode off to roll
  saves.
- **Roll Character** appears in the title bar.

Generate, re-roll or pick the parts that don't fit, then turn the mode off and
play.

Players get these tools while **Let players use Character Creation tools on
their sheets** is on, and the **Toggle Player Creation Tools** macro flips it.
You can allow character creation and keep re-rolls to yourself, or allow both.

### Roll Character

**Roll Character** opens a checklist of everything that can be re-rolled.
Uncheck what you want to keep, and only the rest is re-rolled.

- **Starting gear** and, on a 2e character, the name and the two Background
  Questions sit under **Background**. A new background brings its own. On a
  Barebones character the name has its own line.
- Bonds only re-roll when **Bond(s)** is checked. A new background still only
  keeps as many bonds as it allows. Any extra ones are removed, along with
  their items and coins.
- A background you picked by hand starts unchecked.
- On a Barebones character, **Starting gear** also covers the Barebones
  equipment: the Rations, Torch, weapon, armor and Additional Gear roll are
  handed out again.
- Anything the list doesn't offer is never touched. That covers notes, scars,
  pronouns, and anything bought or given.

A Barebones character made before Air Bladder 0.1.27 still has the equipment it
started with, and a re-roll can't tell that apart from things the player
bought. Delete those items by hand once before you re-roll, or the character
ends up with both sets.

A re-roll never deletes a companion, cart or pack that the old background or a
question gave the character. It's disconnected from the character and stays in
the world, with everything stowed on it, until you delete it. Its name gets
**o_** in front (a Mule becomes **o_Mule**), so sorting the Actors tab by name
groups them together.

## Turn bonds off

**Game Settings → Air Bladder → Configure Character Generation → Use bonds.**
With it off:

- A new character doesn't get a bond, or any of the items or coins a bond
  gives.
- Bonds disappear from every character sheet and the Roll Character window,
  and printed sheets don't have a Bonds section.
- A background that says to roll a second time on the Bonds table, like the
  Fieldwarden, is shown without that sentence.

A character who already has a bond keeps it, with whatever it gave them. It's
hidden, and it comes back if you switch the setting on again.

## Give Barebones characters a failed career

In Knave 2e, every character has a career that didn't work out. To give
Barebones characters one, turn on **Give Barebones Characters a failed career
(like Knave 2e)** under **Game Settings → Air Bladder → Configure Hacks**. It's
greyed out unless **Offer Cairn Barebones character sheets** is on. Cairn 2e
characters don't get one.

With it on, Create PC gives a Barebones character two things:

- **Failed career** — a second Barebones background, never the one they
  already have. It's just a name; it doesn't give them anything else.
- **Failed career item** — one item picked at random from that background's
  starting gear, as a keepsake. It's Petty, so it doesn't fill a slot.

Both show up under the background on the sheet. In Character Creation Mode you
can re-roll the career or pick one from a list, and re-roll the item from the
same career. Changing the career swaps the keepsake too. **Roll Character** has
a **Failed career** box with **Keepsake item** under it, and the printed sheet
shows the career.

When Character Creation Mode is off, an empty line is hidden. If you turn the
setting on in a world that already has Barebones characters, they get empty
lines you can roll in Character Creation Mode. Turning it off hides the lines,
but characters keep their career and keepsake.

## Choose the dice

**Game Settings → Air Bladder → Configure Character Generation** has four
settings for what a character is rolled with. The first three only apply to
player characters. The age formula is also used for generated NPCs and
hirelings.

| Setting | Choices |
|---|---|
| **Ability dice for player characters** | Default (3d6) · Adventurer (4d6kh3) · Crawler (2d6 + 3) |
| **Gold dice for player characters** | the same three |
| **Hit Protection formula for player characters** | any formula; `1d6` by default |
| **Age formula for generated characters** | any formula; `2d20 + 10` by default |

**Default** is the book's roll. **Adventurer** rolls four dice and keeps the
best three. **Crawler** rolls between 5 and 15. You can set the two menus
separately.

For Hit Protection, type a plain number for a fixed value: `4` gives every
character 4. Leave it blank for `1d6`. The notation is explained in
[Dice Formulas](dice-formulas.md).

These only set the base roll. Coins from a bond or a background question are
added on top.

To see what a row will roll, hover STR, DEX, WIL, Hit Protection, Gold or Age
in the Roll Character checklist. The die beside Age on the sheet names its
formula the same way.

## Make the tables yours

Everything a generated character gets comes from a rollable table. If a table
in **your world** has a shipped table's name, it's rolled instead of the
shipped one. Foundry overwrites the shipped compendiums on every system update,
so treat them as templates: copy them into your world and edit the copies.

Three Warden-only buttons do the copying:

- **Create a Custom Spell Table…**, on the **Rollable Tables** sidebar tab.
  It copies the table a random spellbook or scroll comes from —
  `Spells — Canon (1d100)`, or `Spells — GLoG` while the GLoG Magic hack is
  on — into a **Custom Spells** folder, with every spellbook it can hand out.
  If you copy the canon list and switch the hack on later, press the button
  again for the GLoG list.
- **Create Custom Barebones Creation Tables…**, on the same tab. It copies the
  six tables a Barebones character rolls on — Weapon, Armor, Additional
  Gear and the three Weapon Tier tables — into a **Custom Barebones Character
  Creation** folder, with every item, mount and transport they can hand out.
  The items are sorted into a subfolder per source compendium.
- **Create Custom 2e Backgrounds and Tables…**, on the same tab and at the top
  of the **Compendium** tab. It copies the 27 backgrounds and the eleven tables
  a 2e character rolls on. See
  [Creating Custom Backgrounds](creating-custom-backgrounds.md) and
  [Customizing Bonds](customizing-bonds.md).

Each button also points every row of the copied tables at your copies of the
items. A table you import by itself still hands out the shipped item, no matter
how you edited yours. With the rows pointed at your copies, changing a weapon's
damage changes what the next character gets.

Afterwards, a window tells you what was copied and offers to open the folders.
Running a button again never overwrites anything. It only adds what's missing.

Each copied table has a note at the top saying what it's used for and how to
add a row. A table opens in view mode, so press **Edit** at the top of its
window first. If you drag a spellbook onto the spell table, the table re-sorts
by name and updates its formula, so the new spell can be rolled. If you drag an
item onto a Barebones creation table, the table's die changes to match its
rows.

## Taking a background out of play

You don't need a copy to hide a shipped background. Open any Cairn 2e
character with **Character Creation Mode** on and press the **pick-list
button** beside Background. Every background in play is listed, with an **eye**
at the end of its row that only the Warden sees. Click the eye to take that
background out. Its row greys out for you, and players don't see it or roll it
any more. Click the eye again to bring it back.

You set this for each background, and it holds for every character and every
session until you change it. It works on the Player's Guide twenty, the seven
in **Backgrounds (Custom)**, and your own copies. A copy made by **Create
Custom 2e Backgrounds and Tables…** counts as the same background. One you
switched off stays off when its copy arrives, and switching either one back on
switches both on. You can't switch off the last background left in play.

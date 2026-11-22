# The Warden's Dashboard

The Dashboard is the Warden's window, with three pages:

- **Party** — the whole party in one table, in marching order.
- **Damage** — damage from a trap, the environment or a condition.
- **Tables** — every Warden table on a button: encounters by terrain, weather
  by season, what an NPC wants, what a monster looks like. It also holds the
  clock controls and the generators.

Only the Warden (GM) can open it.

---

## Opening it

Press the **Warden's Dashboard** button at the top left of the screen, above
the scene list. It opens on the page you were last on, which is Tables the
first time. If the Dashboard is already open, the button brings it to the
front. Players don't see the button.

You turn the pages with the tabs on the window's edge. Below them, the
**chat** button opens the chat in its own window, so you can keep it beside
the Dashboard. The tabs sit on the left; to have them on the right, change
**Page tabs side** in Configure Settings, which moves your sheets' tabs too.

Each page has its own size: Party opens wide, Tables narrower. Drag the
window's edge to resize a page, and it keeps that size when you come back to
it. The **Pop Out** arrow in its title bar moves the window into its own
browser window, for a second monitor. Popped out, the Dashboard fills that
window with its tabs inside it, and you resize it by resizing the window. To
put it back, use the **⋮ menu**.

## Party

**Party** is a table of every character in the Party folder, along with any
NPC or hireling you've put there.

Each row is one character: who plays them, their pronouns and background, HP
and the three abilities, armor, gold, slots, Fatigue, whether their shield is
equipped, the light they've got equipped, how many rations they have
left, how many hirelings, companions, containers and transports are connected
to them, and their conditions. Click a name to open that character's sheet.

Colour is the warning. Amber means HP below max or one slot left. Red means HP
at 0, an ability below max, no slot left, or no rations. Teal means a shield or
a light that's equipped. A shield or light that's carried but not equipped
shows its symbol without colour, and the light's symbol matches the light, a
torch or a lantern. Fatigue and an empty rations count are boxed. Conditions
show as D (Deprived), P (Panicked) and E (Encumbered).

To put out a character's light, click its teal symbol. Everyone sees a chat
message saying the Warden put it out.

The rows are in marching order. Drag a row onto another to move it there. The
order is saved with the world.

The last column, **Warden's notes**, is for a line of your own about each
character. Only you see it.

If you move a character out of the Party folder, it leaves the table. Move it
back and it returns.

### Several characters at once

Tick the box at the start of a row to select that character, or the box at the
top of the column to select everyone. The buttons above the table then act on
everyone you've ticked: **Add Fatigue** and **Remove Fatigue** (one each),
**Mark Panicked** and **Clear Panicked**, **Mark Deprived** and **Clear
Deprived**. They're greyed out until you tick someone. The Panicked buttons
only show when the Panic rule is on.

Marking a condition, and removing Fatigue, asks you first and names who it
changes. Anyone who's already in that state is left out.

### Giving an item

Drop an item on a character's row to give it to them. It works the same as
dropping it on their sheet: an item from the sidebar or a compendium is
copied, and one dragged off another sheet moves. Unlike a drop on their sheet,
it lands even when they have no free slot. You'll get a notice saying they're
over capacity, which puts their HP at 0 until they free a slot.

## Damage

**Damage** is for a trap, the environment or a condition. Type what did it
under **Source**, the damage under **Damage** (dice, or a plain number), and
pick what it **Applies to**.

Under **Who takes it** is everyone on the scene you're looking at, monsters
and NPCs first, then the player characters. Tick whoever takes it and press
**Roll damage**: the card goes to chat with the damage already applied to them,
so there's nothing to click on the card. Your ticks clear after each roll.

If you don't tick anyone, **Roll damage** just posts the card, and you apply it
with the card's **Apply damage** control, as you would an attack. Anyone
you've targeted is named on the card. If you haven't targeted anyone, the card
asks who.

The page keeps what you typed, ready for the next roll.

## Tables

### The clock

At the top of Tables you'll see today's date and watch, plus the season and weather
when there are any. Under that are the buttons that move the clock: **Back a
Watch**, **Advance a Watch**, **Advance a Day**, **To Next Morning** and **Set
the Date…**. Everyone at the table sees the change on the calendar bar across
the top of their screen.

With the Vald calendar on there is also a **Calendar** button, which opens the
month.

**Roll Today's Weather** rolls the weather table for the current season. Its
card always goes to everyone, and the result becomes the day's weather on the
calendar bar. **Set the Weather…** beside it lets you type the weather instead.

**Dungeon Events** and **Wilderness Events** sit under those, so you can reach
them from every tab.

[Keeping Time](keeping-time.md) explains all of it.

### The tabs

| Tab | What's on it |
|---|---|
| **Travel** | Path difficulty, path distance and terrain difficulty; Weather Difficulty and the four seasons' weather, or Vald's four with the Vald calendar on |
| **Encounters** | A table for each of the seven terrains |
| **People** | Reaction, what they want, the six tables that describe an NPC, and Faction |
| **Factions** | Agenda, agent, obstacle, advantages and traits |
| **Monsters** | Appearance, ability, attack and traits |
| **Your Tables** | Every roll table you have made in this world |

**Your Tables** doesn't need any setup. Make a roll table in the sidebar and it
shows up there under its own name.

If you copy a shipped table into your world and edit it, its button rolls your
copy.

### Who sees the result

The **Who sees the result** dropdown above the tabs applies to every roll
button on every tab. It opens on **Private to Gamemasters**. Set it to Public
Roll when the party should see what came up. It doesn't change your usual
dice settings.

Two things ignore it. The **eye** always shows a table to everyone, and **Roll
Today's Weather** always posts publicly.

### Showing a table to the players

Every table button has an **eye** on its right edge. Click the name to roll the
table. Click the eye to show it.

Showing a table opens it on every player's screen and posts a copy to chat, with
every row and its numbers. It doesn't roll anything.

### Rolling a whole set

Four tabs have a button that rolls several tables at once and gives you one
combined result: **Complete Path**, **Complete NPC**, **Complete Faction** and
**Complete Monster**.

These only describe. They don't create anything. **Complete NPC** gives you a
name, a background, a goal, a quirk, a vice and a virtue, for someone the party
won't meet twice.

### Creating instead

Under **Create** on the People, Factions and Monsters tabs you'll find the
same generators as the Actors sidebar: **Create NPC**, **Create Hireling**,
**Create Faction** and **Create Monster**. Each one makes a sheet you can open,
edit and place on a map, or a journal entry for a faction. Each one asks first,
in the same window the sidebar opens, so you can pick a monster's tier, clear
**Use random generation.** for an empty sheet, or name a faction and choose its
parts.

### Encounters place their own monsters

An encounter rolled here works the same way as one rolled from the compendium.
If its result names monsters, your copy of the card has an **Add to scene**
button that places them. See [Encounter Tables](encounter-tables.md).

The Encounters tab doesn't have a combined button, because a combined result
wouldn't carry Add to scene.

## Related

- [Encounter Tables](encounter-tables.md) — writing your own encounter tables,
  and which rows get an Add to scene button.
- [Generating NPCs and Hirelings](generating-npcs.md) — what each kind of
  person arrives with.
- [Generating Monsters](generating-monsters.md) — danger tiers, and what a
  rolled monster carries.
- [Tokens and Sheets](tokens-and-sheets.md) — which route gives every token its
  own damage.
- [Keeping Time](keeping-time.md) — watches, the calendar bar, and the Vald
  calendar.

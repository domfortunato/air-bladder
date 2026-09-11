# Keeping Time

Cairn counts a journey in **watches**. This system now keeps track of them for
you, shows the current watch to everyone at the table, and — if you are running
Vald — puts a date on it.

---

## Watches

A day is three watches, called **morning**, **afternoon** and **night**. Each is
eight hours. Every character chooses one Wilderness Action per watch, and the
last watch of the day is usually spent making camp.

This is why the travel tables are priced the way they are. A trail costs
**+1 Watch**, wilderness **+2 Watches**, mountains another **+2**, and bad
weather can add one more. Add them up and you know how many watches the journey
takes; divide by three and you know how many days.

Weather is rolled **once a day**, not once a watch.

## The watch clock

A small panel sits above the player list, and everyone sees it. It shows the
current watch, and the date underneath.

You can turn it off in **Configure Settings → Air Bladder → Configure General**,
under **Show the watch clock**. That is one switch for the whole table, not a
per-player preference: whether your game tracks watches at all is your call as
Warden.

Only you can move the clock. Players can read it and nothing else.

## Moving the clock

The controls are at the top of the **Warden's Dashboard** — the clipboard in the
Token controls, down the left of the map.

| Button | What it does |
|---|---|
| **Back a Watch** | Takes back eight hours, for when a watch was counted twice |
| **Advance a Watch** | Moves everyone on by one watch |
| **Advance a Day** | Three watches at once |
| **To Next Morning** | Skips whatever is left of today and lands at the start of the next morning |
| **Set the Date…** | Type a year, month, day and watch |

**There is no "Make Camp" button, on purpose.** Making camp is a Wilderness
Action your players choose, with consequences they carry. This system does not
apply rules on a player's behalf, so the Warden moves the calendar and the party
decides whether they camped. **To Next Morning** is the same jump without the
claim.

Nothing is posted to chat when the clock moves. It does not need to be — the
clock is already on everyone's screen.

## Today's Weather

Under the clock is a **Today's Weather** button. It rolls the weather table for
the season the world is actually in, so you stop having to remember which season
that is. It behaves like any other table button: click the name to roll, click
the eye to show the table to the players.

---

## The Vald calendar

Vald keeps its own year, and it is switched off by default. Turn it on in
**Configure Settings → Air Bladder → GLOG & Other Hacks**, under **Use the Vald
calendar and seasons**.

With it on, the clock reads a Vald date and the Travel tab grows a **Weather in
Vald** group.

### The year

Twelve months of twenty-four days, so 288 days in a year. Six days in a week, so
four weeks in a month — and because twenty-four divides by six, **every month
begins on Market Day**.

**Days of the week:** Market, Garden, Song, Tithe, Bathing, Resting.

**Months:** Mourning, Silence, Veil, Sunrise, Bright, Ashfall, Flood, Highwater,
Rise, Quell, Bane, Sunset.

**Seasons**, each about seventy-two days: **Dead** begins on the 4th of
Mourning, **Dry** on the 4th of Sunrise, **Wet** on the 4th of Flood, and
**Harvest** on the 1st of Quell.

Every tenth year adds **Reclamation**, a six-day week belonging to no month:
Recognize, Remember, Reward, Rejoice, Relinquish, Renew. A new world starts on
the 1st of Mourning, 7728, and 7728 is itself a Reclamation year.

### Two places the Warden's Guide disagrees with itself

Worth knowing before you notice them and report them as bugs here. Both are in
the published text, and this system follows the dated entries rather than
correcting the prose.

- The Guide says each season lasts seventy-two days. Its own "season begins"
  dates make Dead and Dry seventy-two, but **Wet sixty-nine and Harvest
  seventy-five**.
- It puts *Lift the Veil*, "the end of the Dead season", on the 9th of Veil —
  **nineteen days before** Dry begins.

### Vald weather

Four tables, one per season, on the Travel tab under **Weather in Vald**. They
describe the day: *Light snow*, *Thunderstorms*, *Warm and breezy*.

**Cairn's own four seasons stay where they are**, and you want both. Cairn's
Spring through Winter give you *severity* — Nice, Fair, Unpleasant, Inclement,
Extreme — which is what costs a Fatigue or an extra watch and makes the terrain
harder. Vald's four give you the *weather itself*. Roll Cairn's for what it
costs the party and Vald's for what they see.

**Today's Weather** picks the Vald table while the hack is on, and a Cairn one
while it is off.

### Switching it on and off

The world clock is a count of seconds and nothing more. Switching the Vald
calendar on does not convert it — it simply **reads that number differently**,
so the date on screen will jump the first time. Nothing is lost, and switching
back restores exactly the reading you had before.

So: turn it on, then use **Set the Date…** once to put the party where you want
them.

Foundry reloads when you change this setting, so everyone at the table changes
over at the same moment.

## Related

- [The Warden's Dashboard](warden-dashboard.md) — where the clock controls live,
  and every other table on a button.
- [Encounter Tables](encounter-tables.md) — what a travel watch turns up.
- [Dice Formulas](dice-formulas.md) — the notation used elsewhere in this system.

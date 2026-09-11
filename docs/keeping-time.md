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
current watch, the date underneath, the season, and — once you have called it —
today's weather.

With the Vald calendar switched on, the panel is also a button: **click it and
the month calendar opens**. Anyone at the table can do that. It is read-only for
players, so opening it changes nothing about who moves the clock.

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

## Roll Today's Weather

Under the clock is a **Roll Today's Weather** button. It rolls the weather table
for the season the world is actually in, so you stop having to remember which
season that is.

It does two things the other table buttons do not, and both are deliberate.
**The card goes out to everyone**, whatever the visibility dropdown says —
weather the party is standing in is not a secret. And **the result becomes
today's weather**: it appears on everybody's clock and on the calendar, and it
clears itself when the day turns over. If you want a private look at a season's
weather, roll that season's own table on the Travel tab instead; that one sets
nothing.

Beside it is **Set the Weather…**, because a d6 of seasonal weather has no row
for a curse, a spell, or the thing in the valley. Type whatever the sky is
doing. The season's own six rows are offered as suggestions, so the ordinary
case is still one keystroke and a pick. **Leave the field empty and the weather
clears**, which is how you undo a mistake. Nothing is posted to
chat: the clock and the calendar carry it to everyone already.

## Keeping a weather log

**Configure Settings → Air Bladder → General → Keep a weather log**, off by
default. Switch it on and every time the weather is rolled or set, a line goes
into a journal called **The Weather Log**: the date, the watch, the season,
anything the calendar marks on that day, and the weather itself. One page per
month.

Everyone at the table can read it, which is most of the reason to keep one — a
party can look back at what the weather did on the road. It is an ordinary
journal, so you can edit a line you did not mean to write, and deleting the
journal starts a fresh one the next time the weather is called.

One thing to know: a line is written in the language of whoever's client wrote
it, and it stays in that language. It is a record of what happened rather than
part of the interface.

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

**With the hack on, Cairn's own weather buttons stand down** — the four seasons
and Weather Difficulty both. Two sets of weather on one tab means rolling both
and getting answers that disagree about the same day. Vald's are what a Vald
table wants.

Cairn's five tables still ship and are still in the compendium browser, so a
Warden who wants a severity roll — Nice, Fair, Unpleasant, Inclement, Extreme —
can still reach one. They are simply not on the tab while you are running Vald.

**Roll Today's Weather** picks the Vald table while the hack is on, and a Cairn
one while it is off.

### The calendar on the wall

Click the watch clock, or press **Calendar** on the Dashboard, and the month
opens: twenty-four days in six columns, today circled, and the day you last
looked at highlighted. Everyone can open it.

- **Each day is tinted with its season**, and the day a season *begins* carries
  that season's mark. Vald's seasons turn over in the middle of a month, so this
  is the only place you can see where the boundary actually falls.
- **The days with something on them carry a dot.** Click one and its festival is
  spelled out underneath, in the Warden's Guide's own words. The Splash Festival
  and the Storm Dance run for three and five days, and every day of the run is
  marked.
- **Reclamation**, in a year that has one, is a row of six cells named Recognize
  through Renew. It belongs to no month, so it sits on its own.
- Today's weather shows beside the season, for today only. The pencil beside it
  is yours.
- **Set the world to this day** is at the foot of the panel and only you see it.
  Clicking a day never moves the clock — it only opens it — so you can read
  ahead without touching anything. The watch stays where it was: fixing the date
  at dusk means the same dusk on another day, not dawn.

The 24 festivals ship in the **Vald** compendium as their own journal entry,
*Festivals of Vald*, so you can read them straight through, edit them, or hand
them to your players outside the calendar.

### Putting your own days on it

**Add an event…** sits beside Set the world to this day, and only you see it.
Pick a day, say what happens, and it goes on the calendar beside the festivals.

- **Which watch** it happens in, or all day.
- **How many days** it runs, if it is more than one.
- **Every year** makes it a standing fixture. Leave it unticked and it belongs
  to the year you put it in.
- **The party can see it** decides which of two journals it lands in: *The
  Warden's Calendar*, which everyone can read, or *The Warden's Calendar
  (hidden)*, which they cannot.

Your events show with a coloured dot and a rule down the side, so they read
apart from the Guide's own festivals. Each is an ordinary journal page — **Edit**
opens it, so you can write as much as you like — and **Remove** deletes it.

**A word on "hidden".** It keeps an event off the party's calendar and out of
their journal sidebar, which is what you want for the thing arriving on the
fourteenth. It is not encryption: Foundry still sends the journal to their
browser, so a player who went looking with developer tools could read it. If
something must not be readable at all, keep it outside the world.

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

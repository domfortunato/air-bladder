# Using your own portraits

Point Air Bladder at a folder of your own portrait art and it will use it —
in the picker on every sheet, and for the faces it assigns automatically when
you generate a character, an NPC or a monster.

Name a subfolder `pc`, `npc`, `monster` or `companion` and each kind of thing
draws from its own folder instead of from one shared pile.

You need to be the Warden to set this up. Your players need no permissions at
all to *use* it — see [Why your players can see them](#why-your-players-can-see-them),
below.

*This page is about using the feature. The decisions behind it, and how it is
wired, are recorded in [custom-portrait-gallery.md](custom-portrait-gallery.md).*

---

## Setting the folder

**Settings → Configure Settings → Air Bladder → Character Generation → Configure
Character Generation → Custom character portrait folder.**

It is already filled in with `air-bladder-portraits`, and that folder is
created for you the first time the world loads. It sits at the **Foundry data
root**, beside your `worlds/` and `modules/` folders — deliberately *not*
inside the system folder, which is overwritten on every update.

Drop your images in, then press **Refresh** (below). That is the whole setup.

- Recognised files: `.webp`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`,
  `.avif`, `.bmp`. Anything else in the folder is ignored.
- The path is relative to the data root. You can point it anywhere you like —
  a folder you already keep art in, shared between several worlds.
- Leave it blank to switch the feature off entirely; the shipped art is used
  instead.

## Refreshing

Air Bladder scans the folder and remembers what it found. It re-scans:

- when you press **Refresh**, on the **Custom** tab of any portrait picker
  (only the Warden sees that button),
- when you change the folder setting, and
- every time a Warden logs in.

The notification tells you how many images it found. If it says none and you
know the folder is full, check the path first — then Refresh.

### Why your players can see them

Listing a folder on the server needs a permission players do not normally
have. So the Warden does the scanning and the resulting list is stored in the
world; players read that list. Nothing needs granting, but it does mean **a
player sees whatever the last Warden scan found** — add art, then Refresh, or
they will not see it.

## A folder per kind

Make a folder inside your portrait folder with one of these names, and it
becomes the pool for that kind of thing alone:

| Folder | Used for |
|---|---|
| `pc` | player characters, including ones a player generates themselves |
| `npc` | generated NPCs and hirelings, and NPC people you create by hand |
| `monster` | generated monsters |
| `companion` | a granted beast that is not one of the shipped mounts |

- **Singular or plural**, and case does not matter: `Monsters`, `monster` and
  `MONSTERS` are all the same folder.
- **Top level only.** A folder called `Kindred/monster` is an ordinary folder.
- **Nesting inside them counts.** `monster/undead/lich.webp` is monster art,
  so you can still file each category however you like.

Everything that is *not* inside one of those four folders is the **general
pool**.

### If you use none of these names

Nothing changes. Every image is one pool, player characters and NPCs draw from
it, and monsters and companions carry on wearing the art they always have.
This is worth saying plainly: **you never have to adopt any of this.**

### The two rules worth knowing before you sort anything

**1. The general pool is everything OUTSIDE the reserved folders.**

Not "everything". If it were, sorting *only* your monster art would put
monsters on every player character — the one category you had bothered to file
would be the one that broke.

**2. `monster` and `companion` inherit nothing.**

Monsters and beasts have never drawn from your portrait folder at all. A
monster takes a creature glyph from the shipped Game-Icons art; a granted
beast takes its own illustration or a class icon. They start using your art
only when you name a folder for them — otherwise a folder full of human faces
would end up on every ogre and every mule.

Player characters and NPCs *do* fall back to the general pool, because that is
exactly what they did before.

There is also **no borrowing between categories**. Fill `pc/` and nothing else
and your NPCs get the shipped art, not your player-character portraits.

### Three worked examples

```
air-bladder-portraits/          →  characters and NPCs draw from all four
├── knight.webp                     images. Monsters and beasts are untouched.
├── priest.webp                     (This is how it has always behaved.)
├── thief.webp
└── crone.webp
```

```
air-bladder-portraits/          →  characters draw from pc/ (2 images)
├── pc/                             NPCs draw from npc/ (1 image)
│   ├── knight.webp                 monsters draw from monster/ (1 image)
│   └── thief.webp                  beasts still take a class icon —
├── npc/                            there is no companion/ folder
│   └── innkeeper.webp
└── monster/
    └── ogre.webp
```

```
air-bladder-portraits/          →  monsters draw from monster/
├── monster/                        characters and NPCs draw ONLY from
│   ├── ogre.webp                   crone.webp — the monster folder is
│   └── ghoul.webp                  excluded from the general pool, so
└── crone.webp                      nobody gets an ogre for a face
```

## Where a portrait is assigned

| What you do | Pool it draws from |
|---|---|
| Generate a player character (yours or a player's) | `pc` |
| Import a Kettlewright character with no portrait of its own | `pc` |
| Generate an NPC | `npc` |
| Generate a hireling | `npc` |
| Create an NPC person by hand | `npc` |
| Generate a monster | `monster` |
| A background grants a beast the shipped mounts pack does not carry | `companion` |
| Roll the portrait die on a sheet | whichever folder the current portrait came from |

A few things this list does *not* cover, on purpose:

- **A granted mount the pack does carry** — a Rivertooth, a Heavy Destrier —
  keeps the illustration that ships with it. Art that already exists always
  wins.
- **Carts, wagons, sacks and chests** wear class icons, not faces, so they
  have no folder of their own.
- **Items** can be given your custom art from their own picker, but only by
  hand; nothing assigns item art for you.

## The portrait die

The d20 beside a portrait rolls a new one **from the folder the current
portrait came from** — so a monster wearing your monster art rolls another
monster, and a character rolls another character. It always moves, as long as
the folder holds more than one image.

If you cannot see the die, flip **Character Creation Mode** on with the toggle
in the sheet's title bar.

## The picker still shows everything

The reserved folders decide what gets assigned *automatically*. They never
limit what you can choose by hand: the **Custom** tab still lists every folder
you have, so you can put a monster portrait on a shopkeeper if that is what
the scene needs.

Every folder that holds images becomes a tile, labelled by its path — so
`OSR Fantasy/townsfolk/` reads "OSR Fantasy / Townsfolk". Images sitting loose
at the top show as a plain grid above the tiles. The four reserved folders are
captioned "Player Characters", "NPCs", "Monsters" and "Companions" rather than
by their raw names.

## Things that will not happen

- **Nothing is rewritten.** A portrait is copied onto a character when it is
  created and never looked up again, so sorting your folders today does not
  change a single character you already have. Use the die, or pick by hand.
- **No separate token art.** A custom portrait is its own token image. Only
  the shipped Jon Aspeheim and Lydia Comer galleries carry a second image
  prepared for the canvas.
- **Portraits do not travel.** These are paths on your own server. They will
  not follow a character or a shared background to somebody else's install.

## If something looks wrong

**"No custom portraits found."** The folder is empty, the path is wrong, or
nobody has pressed Refresh since the art went in. Check the setting, then
Refresh.

**Some folders are missing from the picker.** The scan goes six levels deep
and visits at most 200 folders. Past either limit it stops and writes a
warning to the browser console (F12). Flatten the tree a little if you hit it.

**A player sees fewer portraits than you do.** They are reading the stored
list from the last Warden scan. Press Refresh.

**Your art is not being assigned to monsters.** Check the folder is named
exactly `monster` (or `monsters`) and sits at the *top* of your portrait
folder, not inside another one.

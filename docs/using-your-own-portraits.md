# Using your own portraits

Point Air Bladder at a folder of your own portrait art and it uses that art in
the picker on every sheet, and for the portraits it assigns when you generate a
character, an NPC or a monster.

If you name a subfolder `pc`, `npc`, `monster` or `companion`, each kind draws
from its own folder.

You need to be the Warden to set this up. Your players don't need any
permissions to use it. See
[Why your players can see them](#why-your-players-can-see-them).

## Setting the folder

**Settings → Configure Settings → Air Bladder → Character Generation → Configure
Character Generation → Custom character portrait folder.**

It's already filled in with `air-bladder-portraits`, and that folder is created
for you. It sits at the **Foundry data root**, beside your `worlds/` and
`modules/` folders. It isn't inside the system folder, because that gets
overwritten on every update.

Drop your images in, then press **Refresh** (below).

- Recognised files: `.webp`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.avif`,
  `.bmp`. Anything else in the folder is ignored.
- The path is relative to the data root. You can point it at any folder there,
  including one shared between several worlds.
- Leave it blank to switch the feature off. The shipped art is used instead.

## Refreshing

Air Bladder reads the folder and remembers what it found. It reads it again:

- when you press **Refresh** on the **Custom** tab of any portrait picker (only
  the Warden sees that button),
- when you change the folder setting, and
- every time a Warden logs in.

A notification tells you how many images it found. If it says it didn't find
any and the folder is full, check the path, then Refresh.

### Why your players can see them

Players can't normally list a folder on the server. When the Warden refreshes,
the list of images is saved in the world, and players read that list. **A
player sees whatever the last refresh found**, so add art, then Refresh.

## A folder per kind

Make a folder inside your portrait folder with one of these names, and it
becomes the pool for that kind alone:

| Folder | Used for |
|---|---|
| `pc` | player characters, including ones a player generates themselves |
| `npc` | generated NPCs and hirelings, and NPC people you create by hand |
| `monster` | generated monsters |
| `companion` | a granted beast that isn't one of the shipped mounts |

- **Singular or plural**, and case doesn't matter: `Monsters`, `monster` and
  `MONSTERS` are the same folder.
- **Top level only.** A folder called `Kindred/monster` is an ordinary folder.
- **Nesting inside them counts.** `monster/undead/lich.webp` is monster art.

Everything that *isn't* inside one of those four folders is the **general
pool**.

### If you use none of these names

Then every image goes into one pool. Player characters and NPCs draw from it,
and monsters and companions keep the shipped art.

### Two rules to know before you sort

**1. The general pool is everything outside the reserved folders.** If you sort
only your monster art, monsters don't end up on player characters.

**2. `monster` and `companion` don't fall back to any of your art.** A monster
takes a creature icon from the shipped Game-Icons art, and a granted beast takes
its own illustration or an icon. They only use your art when you name a folder
for them.

Player characters and NPCs fall back to the general pool.

**Categories never borrow from each other.** If you fill only `pc/`, your NPCs
get the shipped art.

### Three examples

```
air-bladder-portraits/          →  characters and NPCs draw from all four
├── knight.webp                     images. Monsters and beasts are untouched.
├── priest.webp
├── thief.webp
└── crone.webp
```

```
air-bladder-portraits/          →  characters draw from pc/ (2 images)
├── pc/                             NPCs draw from npc/ (1 image)
│   ├── knight.webp                 monsters draw from monster/ (1 image)
│   └── thief.webp                  beasts still take an icon —
├── npc/                            there is no companion/ folder
│   └── innkeeper.webp
└── monster/
    └── ogre.webp
```

```
air-bladder-portraits/          →  monsters draw from monster/
├── monster/                        characters and NPCs draw ONLY from
│   ├── ogre.webp                   crone.webp — the monster folder is
│   └── ghoul.webp                  excluded from the general pool
└── crone.webp
```

## Where a portrait is assigned

| What you do | Pool it draws from |
|---|---|
| Generate a player character (yours or a player's) | `pc` |
| Import a Kettlewright character that doesn't have its own portrait | `pc` |
| Generate an NPC | `npc` |
| Generate a hireling | `npc` |
| Create an NPC person by hand | `npc` |
| Generate a monster | `monster` |
| A background gives you a beast the shipped mounts pack doesn't carry | `companion` |
| Roll the portrait die on a sheet | whichever folder the current portrait came from |

Not covered:

- **A granted mount the pack does carry** keeps the illustration that ships with
  it.
- **Carts, wagons, sacks and chests** use icons and don't have a folder of
  their own.
- **Items** can take your art, but you give it to them by hand from their own
  picker. Item art isn't assigned for you.

## The portrait die

The d20 beside a portrait rolls a new one **from the folder the current portrait
came from**. A monster wearing your monster art rolls another monster, and a
character rolls another character.

If you can't see the die, turn **Character Creation Mode** on with the
**CharGen** toggle in the sheet's title bar.

## The picker still shows everything

The reserved folders decide what is assigned automatically. They don't limit
what you choose by hand. The **Custom** tab lists every folder you have.

Every folder that holds images becomes a tile, labelled by its path, so
`OSR Fantasy/townsfolk/` reads "OSR Fantasy / Townsfolk". Images loose at the
top show as a grid above the tiles. The four reserved folders are captioned
"Player Characters", "NPCs", "Monsters" and "Companions".

## Things that will not happen

- **Nothing is rewritten.** A portrait is set on a character when it's created.
  Sorting your folders later doesn't change any existing character. Use the
  die, or pick by hand.
- **No separate token art.** A custom portrait is its own token image. Only the
  shipped Jon Aspeheim and Lydia Comer galleries carry a second image made for
  tokens.
- **Portraits don't travel.** They're paths on your own server, so they don't
  follow a character or a shared background to another install.

## If something looks wrong

**"No custom portraits found."** The folder is empty, the path is wrong, or
nobody has pressed Refresh since the art went in. Check the setting, then
Refresh.

**Some folders are missing from the picker.** Refresh goes six levels deep and
visits at most 200 folders. Past either limit it stops and writes a warning to
the browser console (F12). Flatten the folders if you hit it.

**A player sees fewer portraits than you do.** They see what the last refresh
found. Press Refresh.

**Your art isn't being assigned to monsters.** Check that the folder is named
`monster` or `monsters` and sits at the *top* of your portrait folder.

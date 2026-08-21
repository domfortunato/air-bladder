# Custom character portrait gallery — the design of record

**Status:** Built (2026-07-26), verified live. Per-category folders added
2026-08-20 (issue #18).

**This is the design record, not the Warden guide.** How a Warden actually
uses this — where the setting is, what to name a folder, what draws from
which pool — is [using-your-own-portraits.md](using-your-own-portraits.md),
which ships into the in-game System Docs journal. This file records the
decisions and the code paths, on the same split monsters use:
`generating-monsters.md` ships, `monster-generation.md` does not. It sat in
the journal roster until 2026-08-20, which meant Wardens were being shown
sentences naming JavaScript functions.

A GM can point Air Bladder at a folder of their own character portraits. When that
folder holds images, new characters and NPCs draw from it and the portrait
picker gains a **Custom** tab; when it is empty, everything falls back to the
shipped tlomdev **humanoid** art. Four subfolder names — `pc`, `npc`, `monster`
and `companion` — split that pool by what is being made (see **Reserved
folders**). This is a **per-GM / per-world local pool** — it does not travel
inside shared content (see Non-goals).

## Decisions (settled with the user)

- **Local per-GM pool**, not portraits that travel with a shared custom background
  (image paths don't resolve across installs — the same portability wall as
  snapshot-on-drop items; embedding image data would bloat the shared unit).
- **Auto-assignment replaces, doesn't merge:** a non-empty custom folder is the
  *only* source for auto-assigned portraits; the shipped gallery is the fallback
  when it's empty. (Confirmed wording, 2026-07-26: "draw only from custom; if
  empty, default to Aspeheim.")
- **The shipped fallback is tlomdev's `humanoid` folder** — 70 drawings of people
  — since **2026-08-18**, by ruling, superseding the Aspeheim wording above for
  characters, NPCs and hirelings alike. Aspeheim's gallery still ships and is
  still offered in the picker wherever faces belong; it is simply no longer what
  generation *assigns*. Two consequences worth knowing: a tlomdev drawing is its
  own token, so a generated actor no longer gets the 256px canvas art Aspeheim's
  paired half provided, and nothing rewrites an existing actor — an `img` is
  copied onto the document at creation and never re-read, so every character made
  before that date keeps the portrait and paired token it already has.
- **Default folder is created for the GM**, empty, and is GM-overridable — so the
  common case is zero setup (drop images in, Refresh). It lives at the Foundry data
  root (`air-bladder-portraits/`), **never inside the system folder** (overwritten
  on every update — the same rule that sends custom backgrounds to a world pack).
  Data-root default means the collection is reusable across a GM's worlds.
- **Custom portraits are their own token.** No paired token art like the shipped 80
  have; each image serves as both portrait and token. (`_setPortrait` already
  handled the no-paired-token case.)
- **Folders inside the folder are categories** (2026-08-14). File your portraits
  however you like — `clerics-paladins/`, `OSR Fantasy/townsfolk/`, as deep as you
  care to go — and each folder that holds images becomes a tile in the Custom tab,
  labelled by its path ("OSR Fantasy / Townsfolk"). Images sitting loose at the top
  still show as a plain grid above the tiles, so a Warden who uses no folders sees
  no change.
- **Four folder names are reserved, and they decide who gets what** (2026-08-20,
  issue #18). This replaces the original wording, which said auto-assignment
  ignored the structure entirely and treated every custom image as one pool.

## Reserved folders

Name a folder at the **top level** of your custom portrait folder and it becomes
the pool for that kind of thing alone:

| folder | used for | when you have no such folder |
|---|---|---|
| `pc` (or `pcs`) | player characters, and a Kettlewright import with no portrait | everything else in the custom folder, then the shipped tlomdev `humanoid` art |
| `npc` (or `npcs`) | generated NPCs, and an NPC person you make by hand | the same |
| `monster` (or `monsters`) | generated monsters | the shipped game-icons creature glyphs — **not** your other portraits |
| `companion` (or `companions`) | a granted beast the Mounts & Transports pack does not carry | its class icon — **not** your other portraits |

Matching is case-insensitive, and anything **nested inside** a reserved folder
counts toward it, so `monster/undead/lich.webp` is monster art. `Kindred/monster`
is an ordinary folder: only the top level is reserved.

Three rules are worth knowing before you sort anything:

- **The general pool is everything OUTSIDE the reserved folders.** If it were
  not, filing only your monster art would put it on every player character —
  the feature would have made things worse for the one category you sorted.
- **`monster` and `companion` do not fall back to your other portraits.** They
  have never drawn from the custom folder at all; naming a folder is how they
  start. This is what stops a folder of faces landing on a mule.
- **No borrowing between categories.** With only `pc/` filled, NPCs get the
  shipped art, not your player-character portraits.

`character` and `characters` are deliberately *not* reserved — that is the
likeliest name for a folder meaning *all* your portraits, and capturing it would
silently take your NPC art away.

**The picker is not scoped.** Reserved folders decide what is assigned
automatically and what the portrait die re-rolls; the Custom tab still shows
every folder you have, so you can always hand-pick from any of them. The four
reserved tiles are captioned "Player Characters", "NPCs", "Monsters" and
"Companions" rather than by their raw folder names.

## How it works

- **Settings** (`settings.js`, Character Generation group):
  - `custom-portrait-folder` (String, default `air-bladder-portraits`) — the path.
  - `custom-portrait-list` (Array, `config:false`) — the cached scan result.
- **Why a cached list:** listing a server folder needs `FILES_BROWSE`, which GMs
  have and players usually don't. So the GM scans; the file list is cached into a
  world setting; **players read the cache and need no permission** — the same
  "ship the list as data" trick the shipped `portrait-manifest.json` already uses.
- **Discovery** (`character-generator.js`): `ensureCustomPortraitFolder()` creates
  the folder (GM, non-fatal), `refreshCustomPortraits()` scans it for image files
  and writes the cache (GM only), `getCustomPortraitPaths()` reads the cache
  (anyone). Both folder ops are non-fatal — a host that forbids them just leaves the
  pool empty and the shipped art is used.
- **The scan walks subfolders** (`MAX_SCAN_DEPTH` 6, `MAX_SCAN_DIRS` 200). Foundry's
  `FilePicker.browse` reports one directory and does not recurse, so the walk is
  breadth-first, one request per folder, skipping any it cannot read. Hitting either
  limit logs a warning — a short list otherwise looks exactly like a small
  collection. The cache stays a FLAT list of paths; the picker derives the folder
  structure from it at display time.
- **Auto-assign** (`randomPortraitPair(category)`): the category's custom pool
  first, else a random path from the shipped default folder. Feeds PC, NPC and
  hireling creation, plus a Kettlewright import with no portrait of its own (they
  share the code path), so changing the default folder changes all of them at once.
- **One helper owns the category rule** (`customPoolFor` in
  `character-generator.js`): it buckets the flat cached list by top-level folder
  and hands back the category's bucket, or the general one for `pc`/`npc` when
  they have no folder of their own. `portraitCategoryFor(actor)` maps an actor to
  its category — that is what lets the portrait die re-roll a monster inside
  `monster/`. `reservedPortraitCategory` is the single copy of the name/alias
  list; the picker imports it rather than keeping a second one.
- **Monsters and companions reach it from their own paths.** A generated monster
  goes through `randomMonsterIcon` (`monster-generator.js`), which now tries
  `customPoolFor("monster")` before the game-icons creature glyphs. A granted
  beast goes through `grantContainers`, which tries `customPoolFor("companion")`
  only when the Mounts & Transports pack has no document for it — a resolved
  document's own art always wins, so a granted Rivertooth keeps its illustration.
- **Picker** (`_onEditPortrait`, shared by PC + NPC sheets): a
  `[ Jon Aspeheim ] [ Custom ]` tab toggle. The Custom tab shows when there are
  custom portraits **or** the viewer is a GM (so a GM sees it even when empty, with
  an empty-state hint and a **Refresh** button). The CC BY 4.0 Aspeheim credit
  renders **only** under the shipped tab — the custom art isn't his. The existing
  paste-a-URL row and FilePicker "Browse…" escape are unchanged.
- **GM login refresh** (`cairn.js` ready hook, primary-GM-gated): ensures the folder
  and re-scans, so the cache players see stays current without a manual step.

Containers and transports are untouched — they wear class icons and have their
own art gallery (`_onPickContainerArt`), which is why neither has a reserved
folder: two pools nobody would fill are two more things to explain. Companions
share that gallery for hand-picking but DO have a reserved folder, because a
granted one-off beast is auto-assigned and a generic horse glyph was all it
could get.

## Non-goals (deferred)

- Paired custom **token** art (custom portrait doubles as its token).
- A drag-and-drop **management** screen (drop files in the folder + Refresh).
- Portraits that **travel with a shared custom background** (portability wall above).

## Verification

Live probe (`dev:smoke` + a Playwright probe) confirmed: custom-only draw when the
pool is non-empty (token===img), Aspeheim paired-art fallback when empty, a real
folder scan caching image files, and the two-tab picker rendering both grids with a
GM Refresh and the credit scoped to the shipped tab — zero console errors.

The per-category folders have their own probe, `npm run dev:portrait-categories`.
It plants three roots and goes through the real creation paths, because the
category is a literal at each call site. Its two load-bearing legs are the
negative ones: with only `monster/` filled, sixteen player-character draws must
never touch it; and with no reserved names at all, the monster and companion
pools must be EMPTY rather than inheriting a folder of faces.

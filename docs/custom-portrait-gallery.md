# Custom character portrait gallery

**Status:** Built (2026-07-26), verified live. First version — the deliberate
non-goals below are deferred, not forgotten.

A GM can point Air Bladder at a folder of their own character portraits. When that
folder holds images, new characters and NPCs draw from it and the portrait
picker gains a **Custom** tab; when it is empty, everything falls back to the
shipped tlomdev **humanoid** art. This is a **per-GM / per-world local pool** — it
does not travel inside shared content (see Non-goals).

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
  no change. Auto-assignment ignores the structure entirely: every custom image is
  one pool no matter which folder it sits in.

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
- **Auto-assign** (`randomPortraitPair()`): custom-first, else a random path from
  the shipped default folder. Feeds PC, NPC and hireling creation, plus a
  Kettlewright import with no portrait of its own (they share the code path), so
  changing the default folder changes all of them at once.
- **Picker** (`_onEditPortrait`, shared by PC + NPC sheets): a
  `[ Jon Aspeheim ] [ Custom ]` tab toggle. The Custom tab shows when there are
  custom portraits **or** the viewer is a GM (so a GM sees it even when empty, with
  an empty-state hint and a **Refresh** button). The CC BY 4.0 Aspeheim credit
  renders **only** under the shipped tab — the custom art isn't his. The existing
  paste-a-URL row and FilePicker "Browse…" escape are unchanged.
- **GM login refresh** (`cairn.js` ready hook, primary-GM-gated): ensures the folder
  and re-scans, so the cache players see stays current without a manual step.

Containers are untouched — they have their own art gallery (`_onPickContainerArt`).
NPCs keep Foundry's default image editing.

## Non-goals (deferred)

- Paired custom **token** art (custom portrait doubles as its token).
- A drag-and-drop **management** screen (drop files in the folder + Refresh).
- Portraits that **travel with a shared custom background** (portability wall above).

## Verification

Live probe (`dev:smoke` + a Playwright probe) confirmed: custom-only draw when the
pool is non-empty (token===img), Aspeheim paired-art fallback when empty, a real
folder scan caching image files, and the two-tab picker rendering both grids with a
GM Refresh and the credit scoped to the shipped tab — zero console errors.

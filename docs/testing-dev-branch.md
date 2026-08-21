# Testing the Air Bladder `dev` branch

This gets you the in-progress code instead of the released version, so you can
test things before they ship.

It takes about 5 minutes. You need **Git**, **Node 24**, and **Foundry v14.365 or newer**.

---

## ⚠️ Back up your world first

Not optional. Dev code runs **world migrations** the first time it loads, and there
is no way back down — putting the old system folder back does **not** un-migrate a
world. If you want to return to the released version afterwards, you need the backup.

Either:

- **In Foundry:** Game Settings → Return to Setup, then on the Worlds tab use the
  world's ⋮ menu → **Export** (gives you a `.zip`), **or**
- **Copy the folder:** copy `Data/worlds/<your-world>` somewhere safe.

Easiest of all: make a **brand new empty world** and test in that. Then your real
campaign is never involved.

---

## 1. Find your Foundry data folder

In Foundry, go to **Configuration** (the gear on the setup screen) and look at
**User Data Path**. It's usually:

| OS | Path |
|---|---|
| Windows | `%localappdata%\FoundryVTT\Data` |
| macOS | `~/Library/Application Support/FoundryVTT/Data` |
| Linux | `~/.local/share/FoundryVTT/Data` |

You want the `systems` folder inside it.

## 2. Close Foundry completely

Fully quit it — not just "return to setup". The server holds files open, and
installing underneath a running Foundry gives you half-written compendia.

## 3. Move any existing Air Bladder aside

If you already have Air Bladder installed, **rename** the folder rather than
deleting it — that's your instant way back:

```sh
cd <your Data folder>/systems
mv air-bladder air-bladder-RELEASED
```

(Windows: just rename it in Explorer.)

## 4. Download the dev branch

```sh
cd <your Data folder>/systems
git clone -b dev https://github.com/domfortunato/air-bladder.git
```

The folder **must** end up named exactly `air-bladder` — that's what the clone does
by default, so don't rename it. Foundry matches the folder name to the system id and
silently ignores it otherwise.

## 5. Build the compendium packs

```sh
cd air-bladder
npm install
npm run build:packs
```

**Do not skip `npm run build:packs`.** The compendium packs are *not* stored in Git —
they're generated from source files. Skip this and Air Bladder loads with **every
compendium empty**, which looks like a broken system rather than a missing step.

## 6. Start Foundry and open your world

It'll take a moment longer than usual the first time while it migrates.

---

## How to tell you're actually on dev

**The version number won't help you** — dev and the current release both say
`0.1.17`. To be sure, run this in the system folder:

```sh
cd <your Data folder>/systems/air-bladder
git log --oneline -1
```

That prints the newest commit. Send Dom that line if anything looks wrong — it tells
him exactly which code you're running.

---

## ⚠️ Never click "Update System" in Foundry

Not on this install. Foundry's updater **replaces the whole folder** with the released
zip, which wipes the dev copy and the packs you built. To update, use Git (below).

---

## Getting the latest dev changes later

Close Foundry first, then:

```sh
cd <your Data folder>/systems/air-bladder
git pull
npm install
npm run build:packs
```

Then start Foundry again. Back up your world before this too, if anything's changed
that matters — the same one-way migration rule applies.

## Going back to the released version

Close Foundry, then delete the `air-bladder` folder and rename
`air-bladder-RELEASED` back to `air-bladder`.

**Remember your world was migrated.** If it now misbehaves on the old system, restore
the world backup from the top of this page — that's what it's for.

---

## If something breaks

Send Dom:

1. The output of `git log --oneline -1` (which commit you're on)
2. What you did and what happened
3. Anything red in the browser console — **F12** → Console tab

Compendiums all empty is nearly always step 5 not having been run.

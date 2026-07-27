<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)"  srcset="lydia-comer/Airbladder06.webp">
    <source media="(prefers-color-scheme: light)" srcset="lydia-comer/Airbladder02.webp">
    <img alt="Air Bladder" src="lydia-comer/Airbladder01.webp" width="520">
  </picture>
</p>

<div align="center">

**English** · [Español](README.es.md)

<sub>Translations may lag; the English README is authoritative.</sub>

</div>

A [Foundry VTT](https://foundryvtt.com) game system for playing **Cairn 2e** and **Cairn Barebones Edition** content — verbose backgrounds, a few options that add 2e features to Barebones sheets, and 2e Warden tables. **Compatible with [Cairn](https://cairnrpg.com) by Yochai Gal.**

## Summary

Air Bladder is a friendly companion system, not the official Cairn system. It descends from [yochaigal/Cairn-FoundryVTT](https://github.com/yochaigal/Cairn-FoundryVTT) (by Yochai Gal & Oskar Świda), which in turn descends from the Electric Bastionland system and Into the Odd. *Air Bladder* is the first item in the Gear table on p. 17 of the Cairn 2e Player's Guide.

## Key Features

- Random or manual generation of both Cairn 2e and Cairn Barebones characters — each style can be toggled on or off
- Barebones sheets support optional homebrew features
- Warden-authored custom 2e backgrounds — create, preview/lint, and [share them across worlds](docs/sharing-custom-backgrounds.md)
- Random or manual generation of hireling sheets
- Tooltips for players
- Marketplace and containers
- Warden-facing roll tables
- A gallery of 80 CC BY 4.0 character portraits by [Jon Aspeheim](https://jonaspeheim.itch.io/)
- Minimal automation

## Screenshots

<table>
  <tr>
    <td><img src="docs/images/sheet-items.png" alt="Character sheet — Items tab" width="250"></td>
    <td><img src="docs/images/sheet-description.png" alt="Character sheet — Description tab" width="250"></td>
    <td><img src="docs/images/sheet-background-notes.png" alt="Character sheet — Background & Notes tab" width="250"></td>
  </tr>
</table>

*The character sheet — Items, Description, and Background & Notes tabs. The red banner is the automatic **Critical Damage** condition, shown when STR is damaged.*

<img src="docs/images/game-settings.png" alt="The Warden's game settings" width="480">

*The Warden's game settings, grouped by section.*

## Status

Early, active development. Send feedback and art! The system is being rebuilt on the original's **editable-compendium** architecture — gear lives in Item compendia that a Warden can edit in one place, and character generation and the marketplace reference those packs by name.

**Translators welcome** — see [docs/TRANSLATING.md](docs/TRANSLATING.md) for how the translation workflow works. No coding required.

## Installation (manual)

**Requires Foundry VTT v13 or newer** (verified on v14).

1. In the Foundry **Game Systems** menu, click **Install System**.
2. Enter the manifest URL: `https://github.com/domfortunato/air-bladder/releases/latest/download/system.json`

For development, clone this repo into `Data/systems/air-bladder` (a directory junction works), run `npm install`, then `npm run build:packs` before launching Foundry. `npm run dev:smoke` drives a headless load as a sanity check.

## AI Disclosure

**Generative-AI art will never appear in this repo — ever.** The code, on the other hand, was written entirely with [Claude Code](https://www.anthropic.com/claude-code), using Yochai Gal's original Cairn repo as a base.

## Credits & licenses

Air Bladder mixes several licensing regimes — please keep the attribution intact:

- **Game text — CC BY-SA 4.0.** The Cairn rules and text (1st and 2nd edition) are by **Yochai Gal**, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). 2e content in this system inherits that license; derivatives must share alike and attribute Yochai Gal.
- **Spanish translation — CC BY-SA 4.0.** The Castilian Spanish (es-ES) translation is by **[Malecho](https://github.com/fsmalecho)**. As a derivative of the CC BY-SA game text, the translation is likewise licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Code — MIT.** The Foundry system code descends from the original **Cairn-FoundryVTT by Yochai Gal & Oskar Świda** (MIT), itself descended from the Electric Bastionland system. See `LICENSE.txt`.
- **"Compatible with Cairn"** — the compatibility badge is used per the terms on [cairnrpg.com/resources/logos](https://cairnrpg.com/resources/logos) (CC BY-SA 4.0, Yochai Gal).
- **Air Bladder logo — © Lydia Comer, all rights reserved.** The logo and related artwork in `lydia-comer/` are by **[Lydia Comer](https://linktr.ee/lydiadidmyink)**, licensed to the Air Bladder system for inclusion and unmodified redistribution as part of the system and its forks; all other uses require permission. See `lydia-comer/license.txt`.
- **Character art — CC BY 4.0.** The 80 paired portrait/token images in `character_portraits/` and `character_tokens/` are by **[Jon Aspeheim](https://jonaspeheim.itch.io/)** (source: [Lemur's Portraits](https://jonaspeheim.itch.io/lemurs-portraits)), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see the `license.txt` in each folder). Plain CC BY: redistribution is fine, attribution is required. The artist states these portraits were created without AI. Keep this credit if the art ships.
- **Item & container icons — CC BY 3.0.** The class icons in `icons/` (gear, spellbooks, transports, containers, monsters) are from [game-icons.net](https://game-icons.net) by **Lorc, Delapouite & Skoll**, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Per-icon author and source-page credits are recorded in `icons/CREDITS.md`.

---

<p align="center">
  <img src="logo/Cairn-2e-Compatible_white.jpg" alt="Compatible with Cairn 2e" width="200">
</p>

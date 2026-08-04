<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)"  srcset="art/lydia-comer/Airbladder06.webp">
    <source media="(prefers-color-scheme: light)" srcset="art/lydia-comer/Airbladder02.webp">
    <img alt="Air Bladder" src="art/lydia-comer/Airbladder01.webp" width="520">
  </picture>
</p>

<div align="center">

### [Visit the Air Bladder website →](https://domfortunato.github.io/air-bladder/)

**English** · [Español](README.es.md)

<sub>Translations may lag; the English README is authoritative.</sub>

</div>

A [Foundry VTT](https://foundryvtt.com) game system for playing **Cairn 2e** and **Cairn Barebones Edition** content — verbose backgrounds, a few options that add 2e features to Barebones sheets, and 2e Warden tables. **Compatible with [Cairn](https://cairnrpg.com) by Yochai Gal.**

## Summary

Air Bladder is a friendly companion system, not the official Cairn system. It descends from [yochaigal/Cairn-FoundryVTT](https://github.com/yochaigal/Cairn-FoundryVTT) (by Yochai Gal & Oskar Świda), which in turn descends from the Electric Bastionland system and Into the Odd. *Air Bladder* is the first item in the Gear table on p. 17 of the Cairn 2e Player's Guide.

## Key Features

- Random or manual generation of characters from Cairn 2e, **Custom Cairn 2e**, and Cairn Barebones backgrounds — The Warden can toggle each source on or off
- [Monster Generator](https://github.com/domfortunato/air-bladder/blob/master/docs/generating-monsters.md)
- [Faction Generator](https://github.com/domfortunato/air-bladder/blob/master/docs/generating-factions.md)
- .json character import from the Official Cairn app, [Kettlewright!](https://kettlewright.com/)
- Optional homebrew features that mix 2e features with Barebones
- Warden-authored custom 2e backgrounds — [create and lint your own](https://github.com/domfortunato/air-bladder/blob/master/docs/creating-custom-backgrounds.md), then [share them across worlds](https://github.com/domfortunato/air-bladder/blob/master/docs/sharing-custom-backgrounds.md)
- Random or manual generation of NPCs, hired or not
- Connections between PCs and NPCs which transfer ownership to Players
- Character Sheet tooltips for players
- Pop-out Character Sheets! Yes, we're fully on AppV2 — ready for v16, when Foundry removes the V1 framework
- Marketplace and containers; horses, carts, wagons, chests, and ITEM PILES!
- Warden-facing roll tables!
- A gallery of 80 CC BY 4.0 character portraits with matching icons by [Jon Aspeheim](https://jonaspeheim.itch.io/)
- A gallery of 368 CC BY-SA 4.0 black-and-white creature & NPC tokens by [tlomdev](https://tlomdev.itch.io/), including the Kettlewright portrait set — an imported Kettlewright character keeps its face
- A gallery of 17 monsters drawn for Air Bladder by [Lydia Comer](https://linktr.ee/lydiadidmyink), each a portrait paired with its own token
- Minimal automation; with buttons for rest, restoring abilities, panicked and critical damage

## Features on the Horizon
- Encounter Generator
- GLOG Magic (optional)

## Screenshots

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-items.png" alt="Character sheet — Items tab" width="250"></td>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-description.png" alt="Character sheet — Description tab" width="250"></td>
    <td><img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/sheet-background-notes.png" alt="Character sheet — Background & Notes tab" width="250"></td>
  </tr>
</table>

*The character sheet — Items, Description, and Background & Notes tabs. The red banner is the automatic **Critical Damage** condition, shown when STR is damaged.*

<img src="https://raw.githubusercontent.com/domfortunato/air-bladder/master/docs/images/game-settings.png" alt="The Warden's game settings" width="480">

*The Warden's game settings, grouped by section.*

## Status

Early, active development. Send feedback and art! The system is being rebuilt on the original's **editable-compendium** architecture — gear lives in Item compendia that a Warden can edit in one place, and character generation and the marketplace reference those packs by name.

## Languages

The interface is translated into **Spanish** (72% of the current strings, by [Malecho](https://github.com/fsmalecho)), and game *content* — backgrounds, items, spells, tables — is translated into Spanish only.

Danish, French, German, Polish and Brazilian Portuguese interface files are inherited from the original Cairn system. They cover **15–30%** of the current interface, predate most of this system's features, and are **not actively maintained** — a game in those languages is mostly English in practice. Anything untranslated falls back to English string by string, so a partial translation is always usable rather than broken.

The tooling is language-agnostic (`--lang <code>` throughout), so a new language needs no code changes — only a translator.

**Translation Help Requested!** — see [docs/TRANSLATING.md](https://github.com/domfortunato/air-bladder/blob/master/docs/TRANSLATING.md) for the no-coding workflow, or [docs/translating-self-service.md](https://github.com/domfortunato/air-bladder/blob/master/docs/translating-self-service.md) if you'd rather work in git.

## Installation (manual)

**Requires Foundry VTT v14.**

1. In the Foundry **Game Systems** menu, click **Install System**.
2. Enter the manifest URL: `https://github.com/domfortunato/air-bladder/releases/latest/download/system.json`

For development, clone this repo into `Data/systems/air-bladder` (a directory junction works), run `npm install`, then `npm run build:packs` before launching Foundry. `npm run dev:smoke` drives a headless load as a sanity check.

To try **unreleased** work, clone the `dev` branch instead — that is where everything in progress lives. The `npm run build:packs` step is required either way: the compendium packs are generated from `src/packs/` and are not stored in git, so an unbuilt clone loads with every compendium empty.

## Contributing

Pull requests welcome — open them against **`dev`**, not `master`. See [CONTRIBUTING.md](https://github.com/domfortunato/air-bladder/blob/master/CONTRIBUTING.md) for the details, and [docs/git-flow.md](https://github.com/domfortunato/air-bladder/blob/master/docs/git-flow.md) for how branches and releases work here.

## AI Disclosure

**Generative-AI art will never appear in this repo — ever.** The code, on the other hand, was written with [Claude Code](https://www.anthropic.com/claude-code), using Yochai Gal's original Cairn repo as a base.

## Credits & licenses

Air Bladder mixes several licensing regimes — please keep the attribution intact:

- **Game text — CC BY-SA 4.0.** The Cairn rules and text (1st and 2nd edition) are by **Yochai Gal**, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). 2e content in this system inherits that license; derivatives must share alike and attribute Yochai Gal.
- **Spanish translation — CC BY-SA 4.0.** The Castilian Spanish (es-ES) translation is by **[Malecho](https://github.com/fsmalecho)** — `lang/es.json` (interface) and `lang/content/es.json` (game content). As a derivative of the CC BY-SA game text, the translation is likewise licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Code — MIT.** The Foundry system code descends from the original **Cairn-FoundryVTT by Yochai Gal & Oskar Świda** (MIT), itself descended from the Electric Bastionland system. See `LICENSE.txt`. The same MIT grant covers the interface strings in `lang/`: the Danish, French, German, Polish and Brazilian Portuguese files are inherited from Cairn-FoundryVTT and travel under its licence.
- **"Compatible with Cairn"** — the compatibility badge is used per the terms on [cairnrpg.com/resources/logos](https://cairnrpg.com/resources/logos) (CC BY-SA 4.0, Yochai Gal).
- **Air Bladder logo and monster art — © Lydia Comer, all rights reserved.** Everything in `art/lydia-comer/` is by **[Lydia Comer](https://linktr.ee/lydiadidmyink)**, licensed to the Air Bladder system for inclusion and unmodified redistribution as part of the system and its forks, and for unmodified use in representing the project; all other uses require permission. Two jobs under one grant: the logo files at the top of the folder, and — in `art/lydia-comer/portraits/` and `art/lydia-comer/tokens/` — 17 creatures drawn for this system, offered in the portrait picker's **Lydia Comer** gallery on NPC and Monster sheets, each a square portrait paired with the circle-cropped token drawn from it. **This is not a Creative Commons licence**, unlike every other art regime here: nothing may be modified, and nothing may be used separately from Air Bladder. Contents are listed in `art/lydia-comer/CREDITS.md`; the full terms and grant history are in `art/lydia-comer/license.txt`.
- **Character art — CC BY 4.0.** The 80 paired portrait/token images in `art/jon-aspeheim/portraits/` and `art/jon-aspeheim/tokens/` are by **[Jon Aspeheim](https://jonaspeheim.itch.io/)** (source: [Lemur's Portraits](https://jonaspeheim.itch.io/lemurs-portraits)), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see the `license.txt` in each folder). Plain CC BY: redistribution is fine, attribution is required. The artist states these portraits were created without AI. Keep this credit if the art ships.
- **game-icons.net art — CC BY 3.0.** Two folders, one grant, both from [game-icons.net](https://game-icons.net) and licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). `icons/` holds the class icons (gear, spellbooks, transports, containers, monsters) by **Lorc, Delapouite & Skoll**; `art/game-icons/` holds the **Game-Icons** picker gallery — 1,539 glyphs in 27 categories by **Andy Meneely, Carl Olsen, Caro Asercion, Cathelineau, DarkZaitzev, Delapouite, Faithtoken, GeneralAce135, Guard13007, Irongamer, Lorc, Lord Berandas, Lucas, Sbed, SeregaCthtuf, Skoll, Sparker, Starseeker, Willdabeast** and one icon credited to various artists. Per-icon author and source-page credits are recorded in `icons/CREDITS.md` and `art/game-icons/CREDITS.md`; those files are the attribution, since the shipped path records only the category. The upstream notice ships verbatim as `art/game-icons/license.txt`.
- **Tlomdev's Tokens — CC BY-SA 4.0.** The 368 black-and-white token drawings in `art/tlomdev/` are by **[tlomdev](https://tlomdev.itch.io/)** (source: [Tlomdev's Tokens](https://tlomdev.itch.io/tlomdevs-tokens)), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). They appear in the portrait picker's **Tlomdev** gallery under the artist's own category folders. The `Kettlewright Portraits` subfolder carries the same artist's drawings as shipped by [Kettlewright](https://github.com/yochaigal/kettlewright), with Kettlewright's exact filenames, so an imported Kettlewright character keeps the portrait its player chose. ShareAlike: adaptations of the art must carry the same licence. Attribution and provenance are recorded in `art/tlomdev/CREDITS.md`; the notice ships as `art/tlomdev/license.txt`.
- **Alegreya typeface — SIL Open Font License 1.1.** The three webfonts in `fonts/` are **Alegreya** by Juan Pablo del Peral and the Alegreya Project Authors ([Huerta Tipográfica](https://github.com/huertatipografica/Alegreya)), © 2011, licensed [OFL 1.1](https://openfontlicense.org/). Redistributed unmodified; the licence requires its notice travel with every copy, so `fonts/OFL.txt` and `fonts/license.txt` ship with them.

---

<p align="center">
  <img src="logo/Cairn-2e-Compatible_white.jpg" alt="Compatible with Cairn 2e" width="200">
</p>

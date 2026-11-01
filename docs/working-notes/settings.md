# Settings

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

- **Four `registerMenu` submenus** (`module/settings-menus.js`), every setting
  `config: false`. `SETTING_GROUPS` in `settings.js` is the one declaration;
  `INTERNAL_SETTING_KEYS` the only exemption. Values switched ON are written before
  OFF; each app has its own Reset Defaults. Search via `[data-searchable]` stamping.
  `hint` is optional. Update counts in the same commit as any settings change.
- **`registerSettings()` runs on `init`, before i18n** — `choices` labels must be
  bare keys (tier labels carry dice as literals, gated by `dev:pc-dice`).
- `subOptions` is a list (`[spec].flat()`).
- PC dice: `pc-ability-dice`, `pc-gold-dice` (tiers in `Cairn.pcDiceTiers`: Default
  3d6, Adventurer 4d6kh3, Crawler 2d6 + 3; `pcTierFormula` falls back),
  `pc-hp-formula`, `age-formula` (default RAW `2d20 + 10`; no clamp). **Count the
  call sites before wiring a setting into a roll** — `_applyRerollParts` calls
  `evaluateFormula` directly; one exported helper per value. Checklist tooltips:
  `data-tooltip` on label AND span, no `aria-label`. A bare number is a valid
  formula (`docs/dice-formulas.md`).
- `show-omens` hides 2e's Omen on sheet and print; `show-traits` likewise;
  `weather-log` default OFF (an update must never start creating documents).
- Removed settings stay removed (`show-containers-tab`, `show-gold-not-cost`,
  `show-container-actors`, `show-omens-barebones`, `show-bonds-barebones`,
  `show-features-section`, `enable-inventory-reorder`).

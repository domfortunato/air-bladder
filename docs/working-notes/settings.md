# Settings

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

- **Four `registerMenu` submenus** (`module/settings-menus.js`), every setting
  `config: false` but the per-person rows: `calendar-bar-tuck` (the tuck,
  2026-11-20; three choices under this key since 2026-11-21) and `tab-rail-side`
  (2026-11-21) are client scope and `config: true`, on core's flat list, because
  the submenus are Warden-only and a player couldn't reach a per-person row
  inside one. The old Boolean `tuck-calendar-bar` is no longer registered:
  `carryTuckChoice` moves a stored true to "on" once, at init, and drops the
  entry. `SETTING_GROUPS` in `settings.js` is the one declaration;
  `INTERNAL_SETTING_KEYS` the only exemption (it holds records as well as
  switches: `vald-weather-today`, `party-marching-order`). Values switched ON are written before
  OFF; each app has its own Reset Defaults. Search via `[data-searchable]` stamping.
  `hint` is optional. Update counts in the same commit as any settings change.
- **`registerSettings()` runs on `init`, before i18n** — `choices` labels must be
  bare keys (tier labels carry dice as literals, gated by `dev:pc-dice`).
- `subOptions` is a list (`[spec].flat()`). The hacks group has two:
  `barebones-failed-career` under `content-source-barebones` (a master in
  another submenu, so the row greys off the master's STORED value), and
  `glog-grimoires` under `enable-glog-magic` (the same submenu, so it follows
  the box live).
- The hacks group since 2026-11-20: `glog-grimoires`, `bulky-shields`,
  `hands-full`, `shield-weapon` beside the GLoG and Vald switches,
  `barebones-failed-career` and the three optional combat rules. A setting that
  changes slot arithmetic reloads. `use-bonds` (2026-11-06) is in Character
  Generation; `sheets-creation-offers.md` and CLAUDE.md say what each one does.
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

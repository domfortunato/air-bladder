# Pack YAML and the build guard (detail)

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

The rule itself, and EXTRACT BEFORE YOU BUILD, stay in CLAUDE.md (Deliberate deviations).

  - The guard compares against `.pack-sync.json` using `canonicalDoc` (meaning, not
    bytes). **Bump `MARKER_FORMAT` on any change to `canonicalDoc`.**
  - Drift that survives normalization is a REAL write — classify it before
    `--force`. A probe updating a pack doc in place leaves schema defaults; fix the
    data, do not widen `FOUNDRY_FILLED`.
  - **Never `extract` when `src/packs` is newer than `packs/`** — it reverts your
    work. Extract to a scratch directory and diff.
  - `extract` renames to `<Name>_<id>.yml`. To undo: `git checkout -- src/packs`
    THEN `git clean -fd src/packs`. Finish with `git status src/packs` clean.
  - The v14 schema fold-in is DONE; do not re-plan it.
  - **Pack data arrives as the statblock it is** — nothing on import lifts a
    value to its max or renames a token. `check:fields` holds four rules since
    review #36 (`auditStatblock` in `tools/dev/field-audit.mjs`): an Actor's HP
    and ability `value` equal their `max`; its `prototypeToken.name` is its
    `name`; a `damageFormula` never keeps the highest of ONE die (`d6k` is a
    truncated `2d6k`); a top-level Item in an Item pack doesn't ship
    `equipped: true`. Items embedded on a pack Actor are exempt (a monster's
    armour is worn on purpose). No pack is exempt: `armor` and `weapons`
    shipped mixed until 2026-11-25 and are flat now. **Ruled 2026-11-24
    (review #37): a bought or dragged item arrives UNEQUIPPED whatever its
    pack says** (`_onDropItem` in actor-sheet.js, `acquire` in marketplace.js),
    and generation sets `equipped` itself. A Kettlewright import copies the
    matched pack item's flag, so its weapons and armour arrive unequipped,
    as its unmatched gear always did (its Armor comes from `armorOverride`).

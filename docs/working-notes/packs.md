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

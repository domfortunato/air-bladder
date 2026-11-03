# Content translation and chat cards

Moved word for word from CLAUDE.md (2026-11-01); CLAUDE.md points here.

- **Content translation is a display-only overlay** keyed on the ENGLISH source
  string (`lang/content/<lang>.json`, `module/i18n-content.js`). **Editing an
  English description orphans its translation.**
- Every list of names a user reads goes through it (`localizeDirectoryNames`,
  `worldDisplayName`, `wrapCompendiumDocumentSearch`, `_prepareTurnContext`,
  `localizeSpeakerName`). Rewriting names breaks SEARCH — apply
  `wrapTranslatedSearch`. PCs are never localized. Gate `dev:directory-i18n`.
- **A stored chat card is rebuilt per viewer from a flag carrying a KIND or an
  English source string, never text.** Examples: `damageCard`
  (`localizeDamageCard`, values sanitized, runs before `nameDamageSource`),
  `localizeD20Card`, `localizeStatusCard`, `localizeEncounterQty`,
  `localizeChangeLogCard`, `ROLL_FLAVOR_KEYS`. `localize()` returns unknown keys
  verbatim — whitelist kinds. Write `data-panic` as `"0"` or `"1"`; absence means
  "older than the attribute", leave alone.
- **Every rebuild in `renderChatMessageHTML` must ask `message.isContentVisible`
  first** — the hook fires for whispered rolls on clients that may not read them.
  Gate `dev:chat-privacy`. A sweep in this class covers every rebuild, and a claim
  that a sweep is finished is a copy that drifts.

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
  `localizeChangeLogCard` (its `itemFlag` lines whitelist `f` against
  `AUDIT_ITEM_FLAGS`), `localizeLightCard` (gear.js, review #36:
  `flags.air-bladder.lightCard` carries the kind, `k`, and the English names of
  the light and its fuel; the stored body is the acting client's sentence and
  stays as the fallback for a card with no record or a bad one; names go through
  the overlay and in as `textContent`), `ROLL_FLAVOR_KEYS`. `localize()` returns unknown keys
  verbatim — whitelist kinds. Write `data-panic` as `"0"` or `"1"`; absence means
  "older than the attribute", leave alone.
- **Every rebuild in `renderChatMessageHTML` must ask `message.isContentVisible`
  first** — the hook fires for whispered rolls on clients that may not read them.
  Gate `dev:chat-privacy`. A sweep in this class covers every rebuild, and a claim
  that a sweep is finished is a copy that drifts.
- **A card spoken AS a concealed token is whispered, not just unnamed**
  (`concealmentWhisper`, utils.js: the users who may name the token, or null for
  public). The damage flow's detail, Scar and status cards use it, and since
  review #36 so does the light card. It can't hide a card that carries a Roll
  (`ChatMessage#visible` is true for a whispered message that is a roll), so every caller posts a plain
  `ChatMessage.create`.
- **A toast takes a KEY and its values, never a finished sentence** (review #36
  S35): `ui.notifications.warn("CAIRN.Key", { format: { name } })`. Core escapes
  each value and leaves a known key alone; a sentence built with
  `game.i18n.format` first isn't a key, so core cleans the whole toast as HTML
  and a name with an angle bracket in it cuts the toast short. A helper that
  hands a refusal back for its caller to show returns `{key, format}`
  (`lightingRefusal`). `check:probes` refuses a formatted toast in `module/`,
  and a probe that records toasts must format the key itself, as core does.

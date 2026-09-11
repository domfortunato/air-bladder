/**
 * The Warden's Dashboard — every Warden table one click away.
 *
 * This system ships 41 Warden-facing roll tables across four packs, and until
 * now the only way to roll one was to find it in the compendium browser.
 * Mid-session that is slow enough that the tables go unused, which is the
 * whole problem this window exists to solve. It is a LAUNCHER: everything it
 * does is reachable another way, and it owns no rules of its own.
 *
 * THE ONE RULE, and it is not cosmetic: a single-table draw posts CORE'S OWN
 * table card, always. `module/encounters.js` grows its Add-to-scene button by
 * reading `flags.core.RollTable` and the message's roll, and only core's
 * `RollTable#toMessage` stamps those. A card of our own would silently kill
 * that button on the nine encounter and event tables and bypass the content
 * overlay that localizes the card. Only the four COMBINED draws build a card,
 * and none of them touch an encounter table.
 *
 * Labels are UI keys rather than the tables' own names, following the ruling
 * already recorded at `actor-sheet.js`'s trait rows: "Warden: NPC - Quirk" is
 * a name a Warden BROWSES by and a terrible label to put on a button. The
 * Your Tables tab is the exception — those names are the Warden's content, so
 * they go through the overlay's `table.name` namespace exactly as the
 * compendium sidebar does.
 *
 * It lives in its own file for the same reason `warden-damage.js` does: it
 * owns a Foundry surface, the scene-controls palette.
 */

import { findTableByName } from "./compendium.js";
import { t } from "./i18n-content.js";
import { openWardenDamage } from "./warden-damage.js";
import {
  valdEnabled, describeTime, weatherTableForToday, monthChoices, WATCH_KEYS,
  advanceWatch, backWatch, advanceDay, toNextMorning, setDate,
  SEASON_ICONS, seasonIconFor, currentSeason, setTodayWeather,
} from "./game-time.js";
import { openValdCalendar, valdCalendarAvailable, promptSetWeather } from "./vald-calendar.js";

/* -------------------------------------------- */
/*  What each tab holds                         */
/* -------------------------------------------- */

/**
 * Every button, declared rather than written into the template, so the probe
 * can walk the same list the window renders and a missing table is one edit.
 *
 * `tables` and each group's `tables` are `[i18nKey, tableName, icon]`. The
 * table name is the SHIPPED name; `findTableByName` resolves world-first, so a
 * Warden who copied a table into their world and edited it gets their own.
 *
 * THE GLYPH IS THE THIRD MEMBER rather than a second map, so this stays the
 * ONE description of a button and the probe keeps walking the list the window
 * renders. It was added 2026-09-10 after the user's "very crowded and
 * difficult to read": 45 buttons of centred text in one window read as a wall,
 * and a glyph column with a LEFT-ALIGNED label beside it makes every label
 * start at the same x, so the eye runs down the column instead of reading each
 * button in turn. Centred text was the defect; the gaps were only the symptom.
 *
 * A WRONG GLYPH CLASS RENDERS NOTHING AND SAYS NOTHING — no error, no warning,
 * no fallback mark, just an empty inline box that looks like deliberate
 * spacing beside the label. So `dev:warden-dashboard` reads
 * `getComputedStyle(el, "::before").content` rather than the class list it was
 * handed. Every glyph here is Font Awesome 6 FREE; a Pro-only name fails the
 * same silent way a typo does.
 */
const PANELS = {
  travel: {
    tables: [
      ["CAIRN.Dashboard.Travel.PathDifficulty", "Warden: Travel - Path Difficulty", "fa-route"],
      ["CAIRN.Dashboard.Travel.PathDistance", "Warden: Travel - Path Distance", "fa-ruler-horizontal"],
      ["CAIRN.Dashboard.Travel.TerrainDifficulty", "Warden: Travel - Terrain Difficulty", "fa-mountain-sun"],
    ],
    groups: [
      {
        // The id is read by `_prepareContext`, which HIDES this whole group
        // while the Vald hack is on (user ruling 2026-09-11) — see
        // `VALD_WEATHER_GROUP` for why that reverses an earlier ruling.
        id: "weather",
        head: "CAIRN.Dashboard.Head.Weather",
        tables: [
          ["CAIRN.Dashboard.Travel.WeatherDifficulty", "Warden: Weather - Difficulty", "fa-cloud-bolt"],
          ["CAIRN.Dashboard.Travel.Spring", "Warden: Weather - Spring", "fa-seedling"],
          ["CAIRN.Dashboard.Travel.Summer", "Warden: Weather - Summer", "fa-fire"],
          ["CAIRN.Dashboard.Travel.Fall", "Warden: Weather - Fall", "fa-leaf"],
          ["CAIRN.Dashboard.Travel.Winter", "Warden: Weather - Winter", "fa-icicles"],
        ],
      },
    ],
    sets: [
      {
        key: "CAIRN.Dashboard.Set.CompletePath",
        tables: [
          "Warden: Travel - Path Difficulty",
          "Warden: Travel - Path Distance",
          "Warden: Travel - Terrain Difficulty",
        ],
      },
    ],
  },

  encounters: {
    tables: [
      ["CAIRN.Dashboard.Encounters.Plains", "Warden: Encounters - Plains", "fa-wind"],
      ["CAIRN.Dashboard.Encounters.Forest", "Warden: Encounters - Forest", "fa-tree"],
      ["CAIRN.Dashboard.Encounters.Hills", "Warden: Encounters - Hills / Mountains", "fa-mountain"],
      ["CAIRN.Dashboard.Encounters.Marshlands", "Warden: Encounters - Marshlands / Quagmire", "fa-frog"],
      ["CAIRN.Dashboard.Encounters.Lake", "Warden: Encounters - Lake", "fa-water"],
      ["CAIRN.Dashboard.Encounters.CityRuins", "Warden: Encounters - City Ruins", "fa-city"],
      ["CAIRN.Dashboard.Encounters.Dungeon", "Warden: Encounters - Dungeon", "fa-dungeon"],
    ],
    // The two EVENT tables used to sit here. They moved into the time band
    // (user ask 2026-09-11) — see `TIME_EVENTS`.
    groups: [],
    // No combined draw here, deliberately: every table on this tab can carry
    // encounter rows, and a combined card would lose the Add-to-scene button.
    sets: [],
  },

  people: {
    tables: [
      ["CAIRN.Dashboard.People.Reaction", "Warden: NPC - Reactions", "fa-face-smile"],
      ["CAIRN.Dashboard.People.Wants", "Warden: NPC - What Do They Want?", "fa-comment-dots"],
      ["CAIRN.Dashboard.People.Name", "Warden: NPC - Name", "fa-signature"],
      ["CAIRN.Dashboard.People.Background", "Warden: NPC - Background", "fa-book-open"],
      ["CAIRN.Dashboard.People.Goal", "Warden: NPC - Goal", "fa-bullseye"],
      ["CAIRN.Dashboard.People.Quirk", "Warden: NPC - Quirk", "fa-masks-theater"],
      ["CAIRN.Dashboard.People.Vice", "Warden: NPC - Vice", "fa-wine-bottle"],
      ["CAIRN.Dashboard.People.Virtue", "Warden: NPC - Virtue", "fa-hand-holding-heart"],
      ["CAIRN.Dashboard.People.Faction", "Warden: NPC - Faction", "fa-flag"],
    ],
    groups: [],
    sets: [
      {
        key: "CAIRN.Dashboard.Set.CompleteNpc",
        tables: [
          "Warden: NPC - Name",
          "Warden: NPC - Background",
          "Warden: NPC - Goal",
          "Warden: NPC - Quirk",
          "Warden: NPC - Vice",
          "Warden: NPC - Virtue",
        ],
      },
    ],
    creates: [
      { key: "CAIRN.CreateNpc", icon: "fas fa-user-plus", gen: "npc" },
      { key: "CAIRN.CreateHireling", icon: "fas fa-hand-holding-dollar", gen: "hireling" },
    ],
    // A line under Create, because what these two buttons make is linked to
    // its token and what the compendium's monsters make is not — the one
    // thing about the roster that surprises people (docs/tokens-and-sheets.md).
    // DECLARED, so the template stays generic and any panel may have one.
    createHint: "CAIRN.Dashboard.People.CreateHint",
  },

  factions: {
    tables: [
      ["CAIRN.Dashboard.Factions.Agenda", "Warden: Faction - Agenda", "fa-scroll"],
      ["CAIRN.Dashboard.Factions.Agent", "Warden: Faction - Agent", "fa-user-secret"],
      ["CAIRN.Dashboard.Factions.Obstacle", "Warden: Faction - Obstacle", "fa-road-barrier"],
      ["CAIRN.Dashboard.Factions.Advantage", "Warden: Faction - Advantage", "fa-chess-rook"],
      ["CAIRN.Dashboard.Factions.AdvantageCount", "Warden: Faction - Advantage (Count)", "fa-hashtag"],
      ["CAIRN.Dashboard.Factions.TraitOne", "Warden: Faction - Trait (Trait 1)", "fa-tag"],
      ["CAIRN.Dashboard.Factions.TraitTwo", "Warden: Faction - Trait (Trait 2)", "fa-tags"],
    ],
    groups: [],
    sets: [
      {
        key: "CAIRN.Dashboard.Set.CompleteFaction",
        tables: [
          "Warden: Faction - Agenda",
          "Warden: Faction - Agent",
          "Warden: Faction - Obstacle",
          "Warden: Faction - Advantage",
          "Warden: Faction - Trait (Trait 1)",
          "Warden: Faction - Trait (Trait 2)",
        ],
      },
    ],
    creates: [{ key: "CAIRN.CreateFaction", icon: "fas fa-flag", gen: "faction" }],
  },

  monsters: {
    tables: [
      ["CAIRN.Dashboard.Monsters.Physique", "Warden: Monster - Appearance (Physique)", "fa-paw"],
      ["CAIRN.Dashboard.Monsters.Feature", "Warden: Monster - Appearance (Feature)", "fa-fingerprint"],
      ["CAIRN.Dashboard.Monsters.Power", "Warden: Monster - Ability (Power)", "fa-bolt"],
      ["CAIRN.Dashboard.Monsters.Target", "Warden: Monster - Ability (Target)", "fa-crosshairs"],
      ["CAIRN.Dashboard.Monsters.AttackType", "Warden: Monster - Attack (Type)", "fa-khanda"],
      ["CAIRN.Dashboard.Monsters.CriticalDamage", "Warden: Monster - Attack (Critical Damage)", "fa-burst"],
      ["CAIRN.Dashboard.Monsters.Quirk", "Warden: Monster - Trait (Quirk)", "fa-masks-theater"],
      ["CAIRN.Dashboard.Monsters.Weakness", "Warden: Monster - Trait (Weakness)", "fa-heart-crack"],
    ],
    groups: [],
    sets: [
      {
        key: "CAIRN.Dashboard.Set.CompleteMonster",
        tables: [
          "Warden: Monster - Appearance (Physique)",
          "Warden: Monster - Appearance (Feature)",
          "Warden: Monster - Ability (Power)",
          "Warden: Monster - Ability (Target)",
          "Warden: Monster - Attack (Type)",
          "Warden: Monster - Attack (Critical Damage)",
          "Warden: Monster - Trait (Quirk)",
          "Warden: Monster - Trait (Weakness)",
        ],
      },
    ],
    creates: [{ key: "CAIRN.CreateMonster", icon: "fas fa-dragon", gen: "monster" }],
  },
};

/**
 * Vald's weather, added to the Travel tab when the hack is on.
 *
 * IT REPLACES CAIRN'S WEATHER GROUP RATHER THAN JOINING IT (user ruling
 * 2026-09-11), and this REVERSES the ruling of the day before, which this
 * docblock used to argue at length: that the two "stack; they are not
 * alternatives", Cairn's four being a SEVERITY ladder feeding
 * `Warden: Weather - Difficulty` while Vald's four merely describe the sky.
 *
 * What the argument missed is what a Warden does with two sets of buttons on
 * one tab: rolls both, and gets answers that contradict each other on the same
 * day. The user's own example — "Cold and clear" can arrive as Vald Dead 1 and
 * as Weather Difficulty 5, meaning two different things. One table has to win,
 * and under the hack it is Vald's. `weatherTableForToday` already decided
 * exactly this for the band's own button; the tabs now agree with it.
 *
 * The four tables SHIP UNCONDITIONALLY, and so do Cairn's — only the BUTTONS
 * swap — so `check:warden` verifies all eight either way and a Warden who
 * wants a severity roll can still reach it from the compendium browser. That
 * is this system's one gating shape: a setting read live at the moment content
 * is enumerated, never pack ownership and never a folder.
 */
const VALD_WEATHER_GROUP = {
  head: "CAIRN.Dashboard.Head.ValdWeather",
  // THE GLYPHS ARE READ FROM `SEASON_ICONS`, NEVER RESTATED HERE. The user
  // asked for "the same buttons used in the calendar display", and reading the
  // map is what makes that true rather than merely true today: a literal
  // written into this array is a second declaration that will drift, and
  // `dev:vald-time` reds the moment one appears.
  //
  // Cairn's own four seasons above take DIFFERENT glyphs on purpose. Both
  // groups sit on the Travel tab, and a snowflake in each would collapse two
  // lists that answer different questions into one.
  tables: [
    ["CAIRN.Dashboard.Travel.ValdDead", "Warden: Vald - Weather (Dead)", SEASON_ICONS["CAIRN.Vald.Season.Dead"]],
    ["CAIRN.Dashboard.Travel.ValdDry", "Warden: Vald - Weather (Dry)", SEASON_ICONS["CAIRN.Vald.Season.Dry"]],
    ["CAIRN.Dashboard.Travel.ValdWet", "Warden: Vald - Weather (Wet)", SEASON_ICONS["CAIRN.Vald.Season.Wet"]],
    ["CAIRN.Dashboard.Travel.ValdHarvest", "Warden: Vald - Weather (Harvest)", SEASON_ICONS["CAIRN.Vald.Season.Harvest"]],
  ],
};

/**
 * The two event tables, in the TIME BAND rather than on a tab (user ask
 * 2026-09-11: "move the Events section to a section under the weather at the
 * top"). They sat on the Encounters tab, which put them behind a click from
 * wherever the Warden was standing — and an event is something that happens as
 * time passes, which is what the band is about.
 *
 * The band renders on every tab, so these are always one click away. Same
 * `[i18nKey, tableName, icon]` shape as everything in PANELS, so the same
 * `buttons()` helper builds them and the same pair-with-an-eye markup renders
 * them.
 */
const TIME_EVENTS = [
  ["CAIRN.Dashboard.Encounters.DungeonEvents", "Warden: Events - Dungeon", "fa-door-open"],
  ["CAIRN.Dashboard.Encounters.WildernessEvents", "Warden: Events - Wilderness", "fa-campground"],
];

/**
 * Who sees a roll, before the Warden says otherwise.
 *
 * PRIVATE BY DEFAULT (user ruling 2026-09-11). It was core's own first mode,
 * Public, which is the right default for the sidebar's Roll Table button and
 * the wrong one for a window of 45 Warden tables: most of what is on it is
 * something the Warden wants to know before the table does.
 *
 * TWO SURFACES DELIBERATELY IGNORE THIS, and both are earlier rulings rather
 * than oversights: the eye SHOWS a table publicly whatever the dropdown says,
 * and Today's Weather posts publicly because weather the party is standing in
 * is not a secret.
 */
const DEFAULT_MESSAGE_MODE = "gm";

/** Tab order, and the one place a tab id is spelled. */
const TAB_IDS = ["travel", "encounters", "people", "factions", "monsters", "yours"];

/** A glyph per tab, so the strip reads at a glance when the window is narrow. */
const TAB_ICONS = {
  travel: "fa-route",
  encounters: "fa-paw",
  people: "fa-users",
  factions: "fa-flag",
  monsters: "fa-dragon",
  yours: "fa-table-list",
};

/**
 * The generators, resolved lazily.
 *
 * Dynamic imports for the same reason `CairnActor.createDialog` uses them:
 * `character-generator.js` is the largest module here and the dashboard must
 * not drag it in at load. These are SECOND call sites into functions the Actor
 * Directory already calls, never copies of their logic.
 */
const GENERATORS = {
  npc: async () => (await import("./character-generator.js")).createNpc(),
  hireling: async () => (await import("./character-generator.js")).createHireling(),
  monster: async () => (await import("./monster-generator.js")).createMonster(),
  faction: async () => (await import("./faction-generator.js")).generateFaction(),
};

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

/**
 * Post one table's draw as CORE'S OWN card.
 *
 * TWO CALLS, not one, and this is the trap that cost a bug report: `draw()`
 * forwards `messageOptions` to `toMessage` and NEVER `messageData`
 * (roll-table.mjs:139), so the card's speaker defaults to
 * `ChatMessage.getSpeaker()` with no argument — the VIEWER'S assigned
 * character. A monster's Scar once posted under the attacking player's name
 * that way. Splitting the draw from the message is the only fix.
 *
 * `drawn.roll` rather than any roll we made: `draw` reassigns it.
 *
 * It returns the DRAWN ROWS as well as the message, because Today's Weather
 * has to store what it rolled. Returning the message alone would have meant a
 * second draw to find out, which is a second roll and a different answer.
 *
 * @param {string} name          the table's name, resolved world-first
 * @param {string} messageMode   a key of CONFIG.ChatMessage.modes
 * @returns {Promise<{message: ChatMessage, results: TableResult[]}|null>}
 */
const postTableDraw = async (name, messageMode) => {
  const table = await findTableByName(name);
  if (!table) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.DashboardNoTable", { name }));
    return null;
  }
  const drawn = await table.draw({ displayChat: false });
  if (!drawn?.results?.length) return null;
  const message = await table.toMessage(drawn.results, {
    roll: drawn.roll,
    // The table speaks for itself, under the SAME label its button wears —
    // "Path Difficulty", not the browse name "Warden: Travel - Path
    // Difficulty". `labelForTable` falls back to the content overlay for a
    // table the dashboard does not know, so a Warden's own table still reads
    // in the viewer's language.
    messageData: { speaker: { alias: labelForTable(table.name) } },
    messageOptions: { messageMode },
  });
  return { message, results: drawn.results };
};

/**
 * Post several tables as ONE card.
 *
 * A card of our own, which is only safe because no set here contains an
 * encounter table — see the file docblock. It is built as a plain string in
 * the poster's language.
 *
 * THE DRAWN VALUE IS ENRICHED, NOT ESCAPED, and the first cut of this got it
 * backwards. It escaped, on the stated reasoning that "the sets cover plain
 * prose tables only" — which is false: the travel tables carry `<strong>` and
 * `<em>`, so Complete Path posted a card reading "<strong>Trails</strong>" as
 * literal text, tags and all. Reported by the user on the day it shipped.
 *
 * The safety here does not come from us. `TableResult#description` is a CORE
 * `HTMLField` (common/documents/table-result.mjs:52), so Foundry's server
 * sanitizes it on write — which is exactly why core's own card renders it with
 * a triple-stache (templates/dice/table-result.hbs). Enriching through core's
 * own call puts this card at core's trust level for core's own field, no lower
 * and no higher. Review #24's finding was cards trusting PLAYER-authored
 * flags; a table description is not one.
 *
 * `secrets: false` deliberately, where core passes `this.isOwner`: this card
 * can be posted publicly from the visibility dropdown, and a secret block in a
 * table description must not reach players merely because the Warden rolled it.
 *
 * The row LABEL stays escaped. It is a name, never markup.
 *
 * @param {string} labelKey
 * @param {string[]} names
 * @param {string} messageMode
 */
const postSetDraw = async (labelKey, names, messageMode) => {
  const rows = [];
  for (const name of names) {
    const table = await findTableByName(name);
    if (!table) continue;
    const drawn = await table.draw({ displayChat: false });
    const result = drawn?.results?.[0];
    if (!result) continue;
    // Core's own treatment of its own field: `TableResult#getHTML` enriches
    // `description` exactly this way (table-result.mjs). A text row keeps its
    // prose in `description`; anything else is identified by `name`, which is
    // `resultText`'s rule and the reason `TableResult#text` is not read.
    const raw = result.type === "text" ? result.description : result.name;
    rows.push({
      label: t("table.name", table.name),
      value: await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, {
        relativeTo: result,
        secrets: false,
      }),
    });
  }
  if (!rows.length) return null;
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const body = rows
    .map((r) => `<div class="cairn-set-row"><strong>${esc(r.label)}</strong>: ${r.value}</div>`)
    .join("\n");
  // `applyMode` is v14's way to turn a visibility choice into whisper/blind on
  // candidate data (chat-message.mjs:151). It is NOT a create option and there
  // is no `messageMode` field on the document, so this has to run over the data
  // BEFORE create. Passing `undefined` falls back to the core setting, which is
  // exactly what the dropdown's default should do.
  const chatData = {
    content: `<div class="cairn-dashboard-set">
  <div class="cairn-set-title">${esc(game.i18n.localize(labelKey))}</div>
  ${body}
</div>`,
    speaker: { alias: game.i18n.localize("CAIRN.Dashboard.Title") },
  };
  return ChatMessage.create(ChatMessage.applyMode(chatData, messageMode));
};

/* -------------------------------------------- */
/*  Showing a table to the players              */
/* -------------------------------------------- */

/** Socket action name, shared with the handler in `cairn.js`. */
export const SHOW_TABLE_ACTION = "showTable";

/**
 * The label to put in front of a player for a table, derived LOCALLY.
 *
 * A shipped table is named "Warden: Travel - Path Difficulty" — a name a
 * Warden browses by, and exactly what should not be shown to the table when
 * the Warden reveals it. The dashboard's own buttons already solve this with
 * UI keys, so this reuses that mapping.
 *
 * Derived on each client rather than sent, which is the point: the socket
 * payload stays a bare uuid and nothing renderable crosses the wire. Every
 * client has PANELS, so every client reaches the same label in its own
 * language.
 *
 * A table the dashboard does not know — the Your Tables tab, or a Warden's own
 * — falls back to its own name through the content overlay, which is right:
 * that name is theirs and is what they will recognise.
 *
 * IT WALKS EVERY DECLARATION, NOT JUST `PANELS`, and that is a fix rather than
 * housekeeping: the Vald weather four have never been in `PANELS` — they are
 * merged in at render — so showing one of them to the players put
 * "Warden: Vald - Weather (Dead)" on their screen, the exact browse name this
 * function exists to keep out of a player's view. Moving Events into the band
 * would have made a second pair of them. Anything declared outside `PANELS`
 * must be added here.
 */
const labelForTable = (name) => {
  const groups = [
    ...Object.values(PANELS).flatMap((p) => [...(p.groups ?? []), { tables: p.tables ?? [] }]),
    VALD_WEATHER_GROUP,
    { tables: TIME_EVENTS },
  ];
  for (const group of groups) {
    for (const [key, table] of group.tables ?? []) {
      if (table === name) return game.i18n.localize(key);
    }
  }
  return t("table.name", name);
};

/** Probe hook: the label a player is shown for a table, without a socket. */
export const _labelForTable = labelForTable;

/**
 * One table's rows, rendered for display.
 *
 * Shared by the popup and the chat card so the two cannot drift, and built
 * from the DOCUMENT every time — never from anything that crossed the socket.
 * That is the security design: see `showTableToPlayers`.
 *
 * The row text is enriched, not escaped, for the reason `postSetDraw` now
 * carries at length: `TableResult#description` is a core `HTMLField` and the
 * server sanitizes it on write. `secrets: false` because this is being shown
 * to players on purpose and a secret block must not ride along.
 *
 * @param {RollTable} table
 * @returns {Promise<string>} HTML
 */
const renderTableRows = async (table) => {
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
  const rows = [];
  for (const r of table.results) {
    const [lo, hi] = r.range ?? [];
    // "3" for a single number, "3-5" for a span. A Warden showing a table is
    // showing the odds — that was the ruling — so the range is never dropped.
    const range = lo === hi ? String(lo ?? "") : `${lo ?? ""}-${hi ?? ""}`;
    const raw = r.type === "text" ? r.description : r.name;
    rows.push(`<div class="cairn-show-row"><span class="cairn-show-range">${esc(range)}</span>`
      + `<span class="cairn-show-text">${await enrich(raw, { relativeTo: r, secrets: false })}</span></div>`);
  }
  return `<div class="cairn-shown-table">
  <div class="cairn-show-title">${esc(labelForTable(table.name))}</div>
  <div class="cairn-show-formula">${esc(game.i18n.format("CAIRN.Dashboard.ShownOn", { formula: table.formula }))}</div>
  ${rows.join("\n  ")}
</div>`;
};

/**
 * The popup every client opens when the Warden shows a table.
 *
 * Read-only and deliberately plain: it is a reveal, not a sheet. Not a
 * DocumentSheet, because a player has no ownership of a Warden pack's table
 * and a real sheet would offer them a Roll button and editable fields.
 */
class ShownTableView extends foundry.applications.api.ApplicationV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    // `{id}` is substituted from `options.uniqueId` at CONSTRUCTION
    // (application.mjs:40), which is why the id is set the way it is below and
    // not with a `get id()`. A getter is too late: the element id, the
    // `foundry.applications.instances` key and the frame are all stamped from
    // the private field the constructor computed, so the window rendered with
    // core's fallback "app-59" and nothing could find it.
    id: "cairn-shown-table-{id}",
    classes: ["cairn", "cairn-shown-table-view"],
    window: { title: "CAIRN.Dashboard.Title", icon: "fas fa-eye" },
    position: { width: 420 },
  };

  constructor(options) {
    super(options);
    this.table = options.table;
  }

  /**
   * One window per table, so showing the same one twice raises it rather than
   * stacking a second. `uniqueId` is core's own documented extension point for
   * this (application.mjs:308).
   * @override
   */
  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = options.table.id;
    return applied;
  }

  /** @override */
  get title() {
    return labelForTable(this.table.name);
  }

  /** @override */
  async _renderHTML() {
    return renderTableRows(this.table);
  }

  /** @override */
  _replaceHTML(result, content) {
    content.innerHTML = result;
  }
}

/**
 * Open the popup for a table on THIS client.
 *
 * Exported because the socket handler in `cairn.js` calls it, and because the
 * Warden's own client calls it directly rather than listening to its own
 * broadcast (a socket emit is not delivered back to its sender).
 *
 * @param {string} uuid  a RollTable uuid — world or compendium
 */
export const openShownTable = async (uuid) => {
  // Resolve on the RECEIVING client, always. Nothing renderable travels in the
  // message, so a crafted emit can at worst name a table that already exists.
  const table = await foundry.utils.fromUuid(uuid);
  if (!(table instanceof getDocumentClass("RollTable"))) return null;
  const app = foundry.applications.instances.get(`cairn-shown-table-${table.id}`)
    ?? new ShownTableView({ table });
  return app.render({ force: true });
};

/**
 * Show a table to everyone: the popup on every client, and a card in the log.
 *
 * TWO SURFACES BY RULING (2026-09-10): the popup is the reveal and the card is
 * the record, for a player who was away or closed it.
 *
 * The card is PUBLIC regardless of the visibility dropdown, deliberately — a
 * "show to players" that whispers to the Warden is nonsense. It carries no
 * `flags.core.RollTable` because nothing was rolled, so it offers no
 * Add-to-scene, which is correct.
 *
 * @param {string} name  the table's name, resolved world-first
 */
const showTableToPlayers = async (name) => {
  const table = await findTableByName(name);
  if (!table) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.DashboardNoTable", { name }));
    return null;
  }
  // No `recipients`, so this BROADCASTS — and a socket emit never comes back
  // to its sender, which is why the Warden's own popup is opened by hand.
  game.socket.emit(`system.${game.system.id}`, { action: SHOW_TABLE_ACTION, uuid: table.uuid });
  await openShownTable(table.uuid);
  const card = await ChatMessage.create({
    content: await renderTableRows(table),
    speaker: { alias: game.i18n.localize("CAIRN.Dashboard.Title") },
  });
  ui.notifications.info(game.i18n.format("CAIRN.Notify.DashboardShown", { name: labelForTable(table.name) }));
  return card;
};

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */
/*  Setting the date                            */
/* -------------------------------------------- */

/**
 * Ask the Warden for a date, and set the world clock to it.
 *
 * The month list is built from the LIVE calendar, so this dialog is right
 * under Foundry's own calendar and under Vald's without knowing which it has —
 * and `monthChoices` drops any month of zero days, which is how Vald's
 * Reclamation is offered in a leap year and hidden in every other one.
 *
 * WATCHES, NOT HOURS. Cairn has no unit finer than a watch, so offering a
 * Warden minutes would be inventing precision the rules do not have.
 *
 * The content is built as an ELEMENT rather than a string: DialogV2 sanitizes
 * a string it is handed, and takes an element's markup verbatim. Values are
 * read in the button callback because listeners attached to sanitized HTML are
 * dead — the trap `warden-damage.js` already carries.
 */
const promptSetDate = async () => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.TimeWardenOnly"));
    return null;
  }
  const now = game.time.components ?? {};
  const cal = game.time.calendar;
  const year = (now.year ?? 0) + (cal.years?.yearZero ?? 0);
  const months = monthChoices(year);
  const watchNow = Math.min(2, Math.max(0, Math.floor((now.hour ?? 0) / (cal.days.hoursPerDay / 3))));
  const esc = foundry.utils.escapeHTML;
  const L = (k) => esc(game.i18n.localize(k));

  // A BARE <div> WITH NO ATTRIBUTES. DialogV2's constructor throws
  // "config.content element must have no attributes" (dialog.mjs:189) — one
  // class is enough to kill the dialog outright, and the button then does
  // nothing with no error a Warden would see. The class goes inside.
  const form = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "cairn-set-date";
  form.append(inner);
  inner.innerHTML = `
    <p class="hint">${L("CAIRN.Time.SetDateHint")}</p>
    <div class="form-group">
      <label for="ab-date-year">${L("CAIRN.Time.Field.Year")}</label>
      <input id="ab-date-year" type="number" name="year" value="${year}" step="1">
    </div>
    <div class="form-group">
      <label for="ab-date-month">${L("CAIRN.Time.Field.Month")}</label>
      <select id="ab-date-month" name="month">
        ${months.map((m) => `<option value="${m.index}" data-days="${m.days}"
          ${m.index === now.month ? "selected" : ""}>${esc(m.label)}</option>`).join("")}
      </select>
    </div>
    <div class="form-group">
      <label for="ab-date-day">${L("CAIRN.Time.Field.Day")}</label>
      <input id="ab-date-day" type="number" name="day" min="1"
        value="${(now.dayOfMonth ?? 0) + 1}" step="1">
    </div>
    <div class="form-group">
      <label for="ab-date-watch">${L("CAIRN.Time.Field.Watch")}</label>
      <select id="ab-date-watch" name="watch">
        ${WATCH_KEYS.map((k, i) => `<option value="${i}"
          ${i === watchNow ? "selected" : ""}>${L(k)}</option>`).join("")}
      </select>
    </div>`;

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: "CAIRN.Time.SetDateTitle" },
    content: form,
    buttons: [
      {
        action: "set",
        label: "CAIRN.Time.SetDate",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element ?? button.form;
          const read = (name) => root.querySelector(`[name=${name}]`);
          const monthEl = read("month");
          const days = Number(monthEl.selectedOptions[0]?.dataset.days) || 1;
          return {
            year: Number(read("year").value),
            month: Number(monthEl.value),
            // CLAMPED here rather than by a `max` attribute, because the
            // month select changes what the maximum is and a stale attribute
            // would let a Warden set the 31st of a 24-day month.
            dayOfMonth: Math.min(days, Math.max(1, Number(read("day").value) || 1)),
            watch: Number(read("watch").value),
          };
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  });

  if (!picked || picked === "cancel" || !Number.isFinite(picked.year)) return null;
  return setDate(picked);
};

/* -------------------------------------------- */

class WardenDashboard extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "cairn-warden-dashboard",
    tag: "form",
    // `sheet` is LOAD-BEARING, not decoration. `css/cairn.css` restores the
    // `overflow: hidden auto` scroll container that ApplicationV2 drops, and
    // scopes it to `.cairn.sheet .window-content`. That restored scrolling is
    // what makes this window safe to resize: shrink it and the body scrolls
    // instead of clipping.
    classes: ["cairn", "sheet", "cairn-dashboard"],
    window: {
      title: "CAIRN.Dashboard.Title",
      icon: "fas fa-clipboard-list",
      resizable: true,
    },
    // WIDER AND TALLER since 2026-09-10, part of the readability pass: six
    // tabs then sit on one row instead of wrapping, and the button grid gets
    // four columns where it had three.
    position: { width: 640, height: 680 },
    actions: {
      rollTable: WardenDashboard._onRollTable,
      showTable: WardenDashboard._onShowTable,
      rollSet: WardenDashboard._onRollSet,
      generate: WardenDashboard._onGenerate,
      wardenDamage: WardenDashboard._onWardenDamage,
      advanceWatch: WardenDashboard._onAdvanceWatch,
      backWatch: WardenDashboard._onBackWatch,
      advanceDay: WardenDashboard._onAdvanceDay,
      nextMorning: WardenDashboard._onNextMorning,
      setDate: WardenDashboard._onSetDate,
      rollWeather: WardenDashboard._onRollWeather,
      setWeather: WardenDashboard._onSetWeather,
      openCalendar: WardenDashboard._onOpenCalendar,
    },
  };

  /**
   * TWO PARTS, so the time band can re-render on its own.
   *
   * That is not an optimisation. `_syncPartState` restores no field VALUES, so
   * a whole-window render on every world-time change would reset the Warden's
   * visibility dropdown to Public underneath them — the same fact `_messageMode`
   * exists for. `refreshDashboardTime` renders `parts: ["time"]` only, and the
   * probe asserts the dropdown survives a time advance so nobody can simplify
   * it back.
   *
   * THE TRAP THIS CREATES, and it is the family `dev:sheet-layout` exists for:
   * `css/cairn.css` restores `.cairn.sheet .window-content > * { flex: 1 }`,
   * written when this window had exactly one child. Two parts is two children,
   * and the band would take half the window while rendering perfectly and
   * logging nothing. The CSS pins it `flex: 0 0 auto`.
   */
  static PARTS = {
    time: { template: "systems/air-bladder/templates/dashboard/warden-dashboard-time.html" },
    body: { template: "systems/air-bladder/templates/dashboard/warden-dashboard.html" },
  };

  /**
   * Declared, not left to the template, because this window is REUSED.
   * Mythic Bastionland hit the failure and wrote it down: the instance keeps
   * the tab you left it on while the template redraws marking the first one
   * active, so the remembered tab cannot be clicked back to until a third has
   * been visited. With a single tab group core supplies `context.tabs` itself
   * (application.mjs:693), so nothing here needs to call `_prepareTabs`.
   */
  static TABS = {
    primary: {
      initial: "travel",
      tabs: [
        { id: "travel", label: "CAIRN.Dashboard.Tab.Travel" },
        { id: "encounters", label: "CAIRN.Dashboard.Tab.Encounters" },
        { id: "people", label: "CAIRN.Dashboard.Tab.People" },
        { id: "factions", label: "CAIRN.Dashboard.Tab.Factions" },
        { id: "monsters", label: "CAIRN.Dashboard.Tab.Monsters" },
        { id: "yours", label: "CAIRN.Dashboard.Tab.Yours" },
      ],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const label = (k) => game.i18n.localize(k);
    const buttons = (rows) => rows.map(([key, table, icon]) => ({ label: label(key), table, icon }));

    // The Warden's own tables. `game.tables` is world tables only — compendium
    // tables never appear there — so this can never double up a shipped
    // button. Names go through the overlay because they are the Warden's
    // CONTENT, the rule every user-read list of names obeys here.
    const yours = game.tables.contents
      // A Warden's own tables declare nothing, so they all wear the same
      // neutral glyph rather than none — a lone unglyphed column would read as
      // a rendering fault beside five tabs that have them.
      .map((tbl) => ({ label: t("table.name", tbl.name), table: tbl.name, icon: "fa-table-list" }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // ONE list the template loops, each entry already carrying core's tab
    // state (`context.tabs` is a record keyed by id, application.mjs:707) as
    // well as its own buttons. The alternative is six near-identical blocks of
    // markup and a Handlebars `lookup` chain to pair each with its tab.
    context.panelList = TAB_IDS.map((id) => {
      const panel = PANELS[id] ?? {};
      const tables = id === "yours" ? yours : buttons(panel.tables ?? []);
      const sets = (panel.sets ?? []).map((s) => ({
        label: label(s.key),
        key: s.key,
        icon: "fa-layer-group",
        tables: s.tables.join(";"),
      }));
      return {
        ...context.tabs[id],
        icon: TAB_ICONS[id],
        empty: id === "yours" && !yours.length,
        tables,
        sets,
        // The combined draw now shares the tab's FIRST grid (user ruling
        // 2026-09-11: the "Roll the lot" heading it used to live under is
        // gone), so the grid has to render for either kind of button. Computed
        // here rather than as `{{#if tables.length}}` in the template, which
        // would silently swallow a tab that ever has a set and no tables.
        hasGrid: tables.length > 0 || sets.length > 0,
        groups: [
          // ONE EXPRESSION, BOTH HALVES OF THE SWAP. Under the hack Vald's
          // weather REPLACES Cairn's rather than joining it (user ruling
          // 2026-09-11, see VALD_WEATHER_GROUP), and writing the hide and the
          // show as one conditional is what stops the two drifting into a tab
          // with two weather groups or none.
          //
          // Read LIVE, so flipping the hack shows up on the next render of
          // this window rather than needing one of its own. The reload the
          // setting asks for is about the CALENDAR, not about these buttons.
          ...(id === "travel" && valdEnabled()
            ? [...(panel.groups ?? []).filter((g) => g.id !== "weather"), VALD_WEATHER_GROUP]
            : (panel.groups ?? [])),
        ].map((g) => ({
          head: label(g.head),
          tables: buttons(g.tables),
        })),
        creates: (panel.creates ?? []).map((c) => ({ ...c, label: label(c.key) })),
        createHint: panel.createHint ? label(panel.createHint) : "",
      };
    });

    // `selected` is stamped here rather than left to the first option, because
    // core's own first mode is Public and this window opens PRIVATE.
    context.modes = Object.entries(CONFIG.ChatMessage.modes).map(([value, cfg]) => ({
      value,
      label: game.i18n.localize(cfg.label),
      selected: value === DEFAULT_MESSAGE_MODE,
    }));
    context.damageLabel = game.i18n.localize("CAIRN.WardenDamage.Title");

    // The time band. `describeTime` is the SAME call the watch clock makes, so
    // the two surfaces can never drift into disagreeing about what time it is.
    context.time = describeTime();

    // Today's Weather is an ORDINARY rollTable button whose target is chosen
    // here, so it goes down `postTableDraw` and posts CORE'S OWN card. THE
    // RULE at the top of this file holds untouched. It is `undefined` under a
    // calendar this system does not know, and the template then renders no
    // button at all rather than rolling the wrong season's weather.
    const weather = weatherTableForToday();
    context.weatherTable = weather;
    context.weatherLabel = game.i18n.localize("CAIRN.Time.TodaysWeather");
    // It wears the glyph of the season it will ACTUALLY roll, read from the
    // same map the calendar renders from, so the button answers "which season
    // am I in" before it is even pressed. `fa-cloud-sun` is the fallback for a
    // calendar whose seasons we do not know.
    context.weatherIcon = seasonIconFor(currentSeason()) || "fa-cloud-sun";
    context.calendarOpen = valdCalendarAvailable();
    // The event tables, in the band beneath the weather. Built by the same
    // helper as every other pair, so they cannot drift out of shape.
    context.events = buttons(TIME_EVENTS);
    return context;
  }

  /* -------------------------------------------- */

  /**
   * The visibility the Warden picked, read from the DOM at CLICK time rather
   * than held in a field. `_syncPartState` restores no field VALUES across a
   * re-render, so a stored copy and the visible control would disagree the
   * first time this window re-rendered under the Warden.
   */
  get _messageMode() {
    return this.element?.querySelector("[name=messageMode]")?.value ?? undefined;
  }

  /**
   * Disable a button while its async work runs, and re-enable it however that
   * work ends. Without this a Warden's double-click draws twice.
   */
  async _whileDisabled(button, action) {
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
    }
  }

  /** @this {WardenDashboard} */
  static async _onRollTable(event, target) {
    await this._whileDisabled(target, () => postTableDraw(target.dataset.table, this._messageMode));
  }

  /**
   * The eye on a table button. Deliberately does NOT read `_messageMode`: a
   * reveal is public by ruling, and passing the dropdown here would let a
   * Warden "show the players" a card only they can see.
   * @this {WardenDashboard}
   */
  static async _onShowTable(event, target) {
    await this._whileDisabled(target, () => showTableToPlayers(target.dataset.table));
  }

  /** @this {WardenDashboard} */
  static async _onRollSet(event, target) {
    await this._whileDisabled(target, () =>
      postSetDraw(target.dataset.key, target.dataset.tables.split(";"), this._messageMode),
    );
  }

  /** @this {WardenDashboard} */
  static async _onGenerate(event, target) {
    const make = GENERATORS[target.dataset.gen];
    if (!make) return;
    await this._whileDisabled(target, async () => {
      // Every generator returns the document it made, or nothing when its own
      // dialog was dismissed. The Actor Directory's idiom, unchanged.
      const doc = await make();
      if (doc) doc.sheet.render(true);
    });
  }

  /** @this {WardenDashboard} */
  static async _onWardenDamage(event, target) {
    await this._whileDisabled(target, () => openWardenDamage());
  }

  /**
   * Today's Weather: roll it, show everyone, and make it the day's weather.
   *
   * THREE THINGS, and each is a ruling rather than a convenience.
   *
   * It posts CORE'S OWN CARD, through the same `postTableDraw` every other
   * table button uses — THE RULE at the top of this file is untouched.
   *
   * It is PUBLIC regardless of the visibility dropdown, which is the ruling
   * already made for showing a table to the players: weather the party is
   * standing in is not secret. A Warden who wants a private look rolls the
   * season's own table on the Travel tab, which sets nothing.
   *
   * And it STORES the drawn row, so the calendar and everyone's clock carry it
   * until the day turns over. The four Vald season buttons on the Travel tab
   * still obey the dropdown and store nothing: only Today's Weather is today's
   * weather.
   * @this {WardenDashboard}
   */
  static async _onRollWeather(event, target) {
    await this._whileDisabled(target, async () => {
      const drawn = await postTableDraw(target.dataset.table, "public");
      const text = drawn?.results?.map((r) => String(r.type === "text" ? r.description : r.name))
        .map((v) => v.replace(/<[^>]*>/g, "").trim()).filter(Boolean).join(", ");
      if (text) await setTodayWeather(text);
    });
  }

  /** @this {WardenDashboard} */
  static async _onSetWeather(event, target) {
    await this._whileDisabled(target, () => promptSetWeather());
  }

  /** @this {WardenDashboard} */
  static async _onOpenCalendar(event, target) {
    await this._whileDisabled(target, () => openValdCalendar());
  }

  /* -------------------------------------------- */
  /*  Moving the clock                            */
  /* -------------------------------------------- */
  //
  // None of these re-render this window themselves. Writing `core.time` fires
  // `updateWorldTime` on EVERY client, and `cairn.js`'s listener re-renders the
  // band from there — so the Warden's own window is refreshed by the same path
  // that refreshes everyone's clock, and there is no second code path to keep
  // in step.

  /** @this {WardenDashboard} */
  static async _onAdvanceWatch(event, target) {
    await this._whileDisabled(target, () => advanceWatch());
  }

  /** @this {WardenDashboard} */
  static async _onBackWatch(event, target) {
    await this._whileDisabled(target, () => backWatch());
  }

  /** @this {WardenDashboard} */
  static async _onAdvanceDay(event, target) {
    await this._whileDisabled(target, () => advanceDay());
  }

  /** @this {WardenDashboard} */
  static async _onNextMorning(event, target) {
    await this._whileDisabled(target, () => toNextMorning());
  }

  /** @this {WardenDashboard} */
  static async _onSetDate(event, target) {
    await this._whileDisabled(target, () => promptSetDate());
  }

  /* -------------------------------------------- */

  /**
   * Pop Out, copied from the actor sheet's implementation rather than written
   * again. `detach` is CORE's action (application.mjs:72, :86); this only
   * surfaces it in the title bar, where v14 otherwise buries it in the ⋮ menu.
   * @override
   */
  _getFrameButtons(options) {
    return [
      { action: "detach", icon: "fas fa-arrow-up-right-from-square", label: "CAIRN.PopOut" },
      ...super._getFrameButtons(options),
    ];
  }

  /**
   * Detaching does NOT re-render — `render()` short-circuits to `#move`
   * (application.mjs:537) — so `_onRender` never fires and a frame button
   * cannot update itself. `_updateFrame` looks like the answer and is not:
   * `#move` calls it BEFORE the async window-opening work that sets
   * `window.windowId`, so `_canDetach()` still reads true there. These two are
   * the hooks core fires once the move has actually happened. Re-docking stays
   * in the ⋮ menu, where core keeps Attach correct.
   * @override
   */
  _onDetach(from, to) {
    super._onDetach(from, to);
    this.#syncPopOut();
  }

  /** @override */
  _onAttach(from, to) {
    super._onAttach(from, to);
    this.#syncPopOut();
  }

  /** Show Pop Out exactly when core would offer Detach, using core's predicate. */
  #syncPopOut() {
    this.element?.querySelector('.window-header button[data-action="detach"]')
      ?.classList.toggle("cairn-header-hidden", !this._canDetach());
  }
}

/* -------------------------------------------- */
/*  Opening it                                  */
/* -------------------------------------------- */

let dashboard = null;

/**
 * Open the Warden's Dashboard, reusing the one instance rather than stacking a
 * window per click.
 *
 * WARDEN ONLY, stated here as well as by the tool's `visible` flag: the tool
 * being absent is the affordance, this is the enforcement, and it is the half
 * that survives someone reaching the function another way. Every table here is
 * the Warden's to roll, and several would spoil an encounter.
 */
export const openWardenDashboard = async () => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DashboardWardenOnly"));
    return null;
  }
  dashboard ??= new WardenDashboard();
  return dashboard.render({ force: true });
};

/**
 * Redraw the time band, and ONLY the time band.
 *
 * Called from `cairn.js`'s `updateWorldTime` listener, so a Warden's open
 * window follows a clock moved from anywhere — their own buttons, a macro, or
 * a second GM's client.
 *
 * `parts: ["time"]` IS LOAD-BEARING. A bare `render()` would re-render the
 * body too, and `_syncPartState` restores no field values, so the visibility
 * dropdown would silently snap back to Public every time the clock moved. See
 * `_messageMode`, which exists for the same fact.
 */
export const refreshDashboardTime = () => {
  if (dashboard?.rendered) dashboard.render({ parts: ["time"] });
};

/**
 * Add the dashboard to the Token controls, beside the Warden's damage tool.
 *
 * The traps are `warden-damage.js`'s and they have not changed: `tools` is a
 * RECORD keyed by name, so pushing onto it fails silently; and `visible` is
 * evaluated ONCE, when the palette first renders, which is correct for a GM
 * check and is why the open function enforces on its own.
 */
export const registerWardenDashboardControl = () => {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tools = controls?.tokens?.tools;
    if (!tools) return;   // core renamed or removed the control set
    tools.abWardenDashboard = {
      name: "abWardenDashboard",
      title: "CAIRN.Dashboard.Tool",
      icon: "fas fa-clipboard-list",
      order: Object.keys(tools).length,
      button: true,
      visible: game.user.isGM,
      onChange: () => {
        // Not awaited — `onChange` is fire-and-forget, and an unhandled
        // rejection out of a click handler is silent.
        openWardenDashboard().catch((err) => {
          console.error("Air Bladder | the Warden's dashboard failed:", err);
        });
      },
    };
  });
};

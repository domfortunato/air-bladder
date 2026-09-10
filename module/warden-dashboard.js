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

/* -------------------------------------------- */
/*  What each tab holds                         */
/* -------------------------------------------- */

/**
 * Every button, declared rather than written into the template, so the probe
 * can walk the same list the window renders and a missing table is one edit.
 *
 * `tables` and each group's `tables` are `[i18nKey, tableName]`. The table
 * name is the SHIPPED name; `findTableByName` resolves world-first, so a
 * Warden who copied a table into their world and edited it gets their own.
 */
const PANELS = {
  travel: {
    tables: [
      ["CAIRN.Dashboard.Travel.PathDifficulty", "Warden: Travel - Path Difficulty"],
      ["CAIRN.Dashboard.Travel.PathDistance", "Warden: Travel - Path Distance"],
      ["CAIRN.Dashboard.Travel.TerrainDifficulty", "Warden: Travel - Terrain Difficulty"],
    ],
    groups: [
      {
        head: "CAIRN.Dashboard.Head.Weather",
        tables: [
          ["CAIRN.Dashboard.Travel.WeatherDifficulty", "Warden: Weather - Difficulty"],
          ["CAIRN.Dashboard.Travel.Spring", "Warden: Weather - Spring"],
          ["CAIRN.Dashboard.Travel.Summer", "Warden: Weather - Summer"],
          ["CAIRN.Dashboard.Travel.Fall", "Warden: Weather - Fall"],
          ["CAIRN.Dashboard.Travel.Winter", "Warden: Weather - Winter"],
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
      ["CAIRN.Dashboard.Encounters.Plains", "Warden: Encounters - Plains"],
      ["CAIRN.Dashboard.Encounters.Forest", "Warden: Encounters - Forest"],
      ["CAIRN.Dashboard.Encounters.Hills", "Warden: Encounters - Hills / Mountains"],
      ["CAIRN.Dashboard.Encounters.Marshlands", "Warden: Encounters - Marshlands / Quagmire"],
      ["CAIRN.Dashboard.Encounters.Lake", "Warden: Encounters - Lake"],
      ["CAIRN.Dashboard.Encounters.CityRuins", "Warden: Encounters - City Ruins"],
      ["CAIRN.Dashboard.Encounters.Dungeon", "Warden: Encounters - Dungeon"],
    ],
    groups: [
      {
        head: "CAIRN.Dashboard.Head.Events",
        tables: [
          ["CAIRN.Dashboard.Encounters.DungeonEvents", "Warden: Events - Dungeon"],
          ["CAIRN.Dashboard.Encounters.WildernessEvents", "Warden: Events - Wilderness"],
        ],
      },
    ],
    // No combined draw here, deliberately: every table on this tab can carry
    // encounter rows, and a combined card would lose the Add-to-scene button.
    sets: [],
  },

  people: {
    tables: [
      ["CAIRN.Dashboard.People.Reaction", "Warden: NPC - Reactions"],
      ["CAIRN.Dashboard.People.Wants", "Warden: NPC - What Do They Want?"],
      ["CAIRN.Dashboard.People.Name", "Warden: NPC - Name"],
      ["CAIRN.Dashboard.People.Background", "Warden: NPC - Background"],
      ["CAIRN.Dashboard.People.Goal", "Warden: NPC - Goal"],
      ["CAIRN.Dashboard.People.Quirk", "Warden: NPC - Quirk"],
      ["CAIRN.Dashboard.People.Vice", "Warden: NPC - Vice"],
      ["CAIRN.Dashboard.People.Virtue", "Warden: NPC - Virtue"],
      ["CAIRN.Dashboard.People.Faction", "Warden: NPC - Faction"],
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
  },

  factions: {
    tables: [
      ["CAIRN.Dashboard.Factions.Agenda", "Warden: Faction - Agenda"],
      ["CAIRN.Dashboard.Factions.Agent", "Warden: Faction - Agent"],
      ["CAIRN.Dashboard.Factions.Obstacle", "Warden: Faction - Obstacle"],
      ["CAIRN.Dashboard.Factions.Advantage", "Warden: Faction - Advantage"],
      ["CAIRN.Dashboard.Factions.AdvantageCount", "Warden: Faction - Advantage (Count)"],
      ["CAIRN.Dashboard.Factions.TraitOne", "Warden: Faction - Trait (Trait 1)"],
      ["CAIRN.Dashboard.Factions.TraitTwo", "Warden: Faction - Trait (Trait 2)"],
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
      ["CAIRN.Dashboard.Monsters.Physique", "Warden: Monster - Appearance (Physique)"],
      ["CAIRN.Dashboard.Monsters.Feature", "Warden: Monster - Appearance (Feature)"],
      ["CAIRN.Dashboard.Monsters.Power", "Warden: Monster - Ability (Power)"],
      ["CAIRN.Dashboard.Monsters.Target", "Warden: Monster - Ability (Target)"],
      ["CAIRN.Dashboard.Monsters.AttackType", "Warden: Monster - Attack (Type)"],
      ["CAIRN.Dashboard.Monsters.CriticalDamage", "Warden: Monster - Attack (Critical Damage)"],
      ["CAIRN.Dashboard.Monsters.Quirk", "Warden: Monster - Trait (Quirk)"],
      ["CAIRN.Dashboard.Monsters.Weakness", "Warden: Monster - Trait (Weakness)"],
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

/** Tab order, and the one place a tab id is spelled. */
const TAB_IDS = ["travel", "encounters", "people", "factions", "monsters", "yours"];

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
 * @param {string} name          the table's name, resolved world-first
 * @param {string} messageMode   a key of CONFIG.ChatMessage.modes
 * @returns {Promise<ChatMessage|null>}
 */
const postTableDraw = async (name, messageMode) => {
  const table = await findTableByName(name);
  if (!table) {
    ui.notifications.warn(game.i18n.format("CAIRN.Notify.DashboardNoTable", { name }));
    return null;
  }
  const drawn = await table.draw({ displayChat: false });
  if (!drawn?.results?.length) return null;
  return table.toMessage(drawn.results, {
    roll: drawn.roll,
    // The table speaks for itself. Its name goes through the content overlay
    // so a Spanish client reads the Spanish table name, the same value the
    // compendium row shows.
    messageData: { speaker: { alias: t("table.name", table.name) } },
    messageOptions: { messageMode },
  });
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
/*  The window                                  */
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
    position: { width: 520, height: 620 },
    actions: {
      rollTable: WardenDashboard._onRollTable,
      rollSet: WardenDashboard._onRollSet,
      generate: WardenDashboard._onGenerate,
      wardenDamage: WardenDashboard._onWardenDamage,
    },
  };

  /** @override */
  static PARTS = {
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
    const buttons = (rows) => rows.map(([key, table]) => ({ label: label(key), table }));

    // The Warden's own tables. `game.tables` is world tables only — compendium
    // tables never appear there — so this can never double up a shipped
    // button. Names go through the overlay because they are the Warden's
    // CONTENT, the rule every user-read list of names obeys here.
    const yours = game.tables.contents
      .map((tbl) => ({ label: t("table.name", tbl.name), table: tbl.name }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // ONE list the template loops, each entry already carrying core's tab
    // state (`context.tabs` is a record keyed by id, application.mjs:707) as
    // well as its own buttons. The alternative is six near-identical blocks of
    // markup and a Handlebars `lookup` chain to pair each with its tab.
    context.panelList = TAB_IDS.map((id) => {
      const panel = PANELS[id] ?? {};
      return {
        ...context.tabs[id],
        empty: id === "yours" && !yours.length,
        tables: id === "yours" ? yours : buttons(panel.tables ?? []),
        groups: (panel.groups ?? []).map((g) => ({
          head: label(g.head),
          tables: buttons(g.tables),
        })),
        sets: (panel.sets ?? []).map((s) => ({
          label: label(s.key),
          key: s.key,
          tables: s.tables.join(";"),
        })),
        creates: (panel.creates ?? []).map((c) => ({ ...c, label: label(c.key) })),
      };
    });

    context.modes = Object.entries(CONFIG.ChatMessage.modes).map(([value, cfg]) => ({
      value,
      label: game.i18n.localize(cfg.label),
    }));
    context.damageLabel = game.i18n.localize("CAIRN.WardenDamage.Title");
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

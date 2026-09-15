/**
 * A table explains itself (2026-09-15, user, on a copied `Market: Armor`: "there
 * is nothing that readily identifies it as being used for customizing the
 * marketplace other than its location — there is nothing that tells me how to
 * add an item to the table or to even drag and drop items onto it").
 *
 * A banner at the top of the RollTable sheet, for every table Air Bladder
 * reads: a WORLD copy says what reads it and how a row is added or removed; a
 * shipped PACK table says it is a template and names the button that copies it.
 *
 * IDENTITY IS THE NAME — the same identity every reader uses (`game.tables
 * .getName`, compendium.js `findDeclaredTable`, marketplace.js `marketTables`).
 * Nothing is stamped on a copy: a hand-made `Market: Potions` wears the banner
 * the button's copies wear, and a copy renamed away from its shipped name
 * loses it — which is exactly the moment Air Bladder stops reading it, so the
 * banner going missing IS the diagnostic. Which button covers a name is
 * take-over.js `kindOfTable`'s answer, off the same `KINDS` that decide what
 * each button copies, so a table added to a kind explains itself without a
 * second list here.
 *
 * WHY A BANNER AND NOT THE DESCRIPTION. Every shipped Market table has carried
 * "Drag an item in to stock it" in its `description` since it was written, and
 * no Warden has ever seen it: 14.365's view.hbs emits the description as an
 * UNWRAPPED `{{{descriptionHTML}}}` and a root part keeps only ELEMENT children
 * (handlebars-application.mjs:213), so plain text is dropped before it reaches
 * the DOM, and edit mode shows it only inside a ProseMirror box on the Summary
 * tab. A stored sentence is also one language for every viewer and goes stale
 * on a rename; this is rebuilt per viewer from the live document on every
 * render.
 *
 * A NOTE ONLY, no "Add an item…" button (user ruling 2026-09-15, on the
 * recommendation): drag and drop is the gesture every Foundry sheet composes
 * by, core's own table sheet offers no picker, and no system puts one on the
 * stock sheet. The whole window is the drop target (roll-table-sheet.mjs
 * `_onRender`, `dropSelector: ".window-content"`), which is why the sentence
 * says "onto this window" and not "onto the list". WARDEN ONLY: every sentence
 * is a Warden instruction, and a player who can open a world table at all is
 * in view mode, where a drop is refused.
 *
 * RE-INJECTED ON EVERY RENDER, for free: a TableResult create/update/delete
 * re-renders every part and `replaceWith`s the results section, a mode change
 * wipes `.window-content` outright (`_preRender`), and this hook fires after
 * each. Switching tabs renders nothing, so the banner survives Results ↔
 * Summary; it is hidden with its section on Summary, an accepted consequence
 * of anchoring it where the rows are. The anchor is `table[data-results]` in
 * BOTH modes — inside `[data-application-part="results"]` in edit mode, a
 * direct child of the window content after the header in view mode — so one
 * `before()` lands it in the right parent either way.
 *
 * DUPLICATE NAMES (same day, user ask, after wondering whether copies should
 * be prefixed "Custom" — no: the name IS the identity, and a prefix would be a
 * second rule for every reader). Two WORLD tables of one name is the one
 * ambiguity the identity rule leaves, and the readers do not even agree on
 * which wins — `getName` takes the first, `marketTables` the last. So a world
 * table with a role that shares its name with another world table carries a
 * second line saying so, and the line follows the OTHER table's fate on an
 * open sheet: `refreshTableBanners` (cairn.js, on create/delete/rename of any
 * RollTable) re-injects the DOM rather than re-rendering, because a re-render
 * of an edit-mode sheet drops the Warden's unsaved edits.
 *
 * THE SHEET OPENS IN VIEW MODE, AND THE SENTENCE SAYS SO (review #31). Core's
 * `#DEFAULT_MODE` is view, a table with rows opens there, and in view mode
 * the drop permission is `isEditMode` (roll-table-sheet.mjs `_onRender`) — so
 * `ondrop` is null on the window and there is no + above the list. The
 * banner promised both to a Warden who had just been told nothing explained
 * how to drag: the answer shipped did not work in the mode they read it in.
 * A world table's banner in view mode ends with one more sentence naming
 * core's own Edit button (`TABLE.ACTIONS.ChangeMode.Edit`, translated
 * wherever core is); in edit mode the instructions stand alone. Pack
 * templates never get it — they are read-only, and their sentence names a
 * button, not a drop.
 *
 * THE CHECKLIST'S LIST IS NOT A TEMPLATE. Two shipped tables are named Scars
 * (damage.js `_rollScarsTable`): the one in Utils is what a damage roll
 * deals, world-first, and the 2e button copies it; the one in Tables (2e) is
 * the character sheet's checkbox list, read from the pack ONLY
 * (actor-sheet.js `_prepareBiographyContext`). The import sentence on it
 * would invite a Warden to import the twelve labels under the name `Scars`,
 * which is the hijack review #31 found, by hand — so that table wears its own
 * sentence saying what it is and where the scar the card deals comes from.
 *
 * THE FORMULA FOLLOWS THE ROWS (same day, user: "What if I add bonds to the
 * world copy of the bond table. Is its draw formula automatically updated?" —
 * it was not, and nothing warned). Core's + and drop append a row at
 * `maxRoll + 1` and never touch the formula (roll-table-sheet.mjs
 * `_createResult`), so a 21st bond sat under `1d20` where no generator could
 * reach it, and the banner told the Warden to press the scales button. Now
 * `onReadTableRowsChanged`, on `createTableResult` AND `deleteTableResult`,
 * keeps every world table this file banners in step: the aisles and the two
 * spell tables re-sort by name (marketplace.js `keptAlphabetical`, the rows
 * being alphabetical by design), and every other one gets `fitFormula` —
 * FLAT DICE ONLY. Eight shipped tables are not flat (`Warden: NPC -
 * Reactions` 2d6, `Encounters - Lake` 2d4, the five regional encounter tables
 * `1d6 + 1d10`, `GLOG Magic: Mishaps` 2d12, which is a LOOKUP by the cast's
 * sum and never rolled), and flattening a curve would change what the table
 * says; for those the banner names the Summary tab instead. Order is never
 * touched — the book's order is the Warden's to keep — and `updateTableResult`
 * is deliberately NOT covered: a Warden editing ranges by hand is editing the
 * dice on purpose. Deleting is, so the last row's removal shrinks the die
 * back; a gap left in the middle is core's own behaviour and `roll()` rolls
 * past it. The predicate is `tableRole`, the same one that decides the
 * banner, so the sentence and the behaviour cannot drift apart. The
 * predicate is NOT GM-gated (only the render hook is): the hook runs on
 * whichever client made the row, and a player who can add one is an owner.
 *
 * Gate: `npm run dev:table-banner`.
 */
import { kindOfTable } from "./take-over.js";
import { marketAisle, TRANSPORTS_CATEGORY, keptAlphabetical, resortTableByName } from "./marketplace.js";

const L = (k) => game.i18n.localize(k);
const esc = (s) => foundry.utils.escapeHTML(String(s));

/** A flat die, the only shape the formula follows: `1d20`, `d20`. Anything
 *  else — `2d6`, `1d6 + 1d10`, a modifier — is a curve the Warden chose. */
const FLAT_DIE = /^1?d\d+$/i;

/** Is this table's STORED formula one the formula-follows rule may write?
 *  Blank counts: a drag-built table (Create Roll Table, then drag) never
 *  submits the sheet form and so stores none, and its first `roll()` would
 *  normalize and SAVE whatever core derives (roll-table.mjs:270-274). */
const hasFlatDie = (table) => {
  const stored = String(table?._source?.formula ?? "").trim();
  return !stored || FLAT_DIE.test(stored);
};

/** The sidebar tab a button sits on, named as the Warden's client labels it —
 *  read the way core's own sidebar reads it (sidebar.mjs `_prepareTabContext`):
 *  the Compendium tab declares a tooltip key, the tables tab declares NONE and
 *  falls back to the RollTable document's `labelPlural` (`DOCUMENT.RollTables`).
 *  `SIDEBAR.TabTables` sits in core's en.json and is read by nothing in 14.365
 *  (review #32; grep the client) — a language module has no reason to keep a
 *  dead key in step with the live one, so a banner on it could name the tab by
 *  a word the tab never wears. */
const sidebarLabel = (tab) =>
  L(tab === "compendium" ? "SIDEBAR.TabCompendium" : CONFIG.RollTable.documentClass.metadata.labelPlural);

/** One key per role. Literal, so `i18n:source` can see every one of them. */
const KEYS = {
  market: "CAIRN.TableRole.Market",
  transports: "CAIRN.TableRole.Transports",
  spells: "CAIRN.TableRole.Spells",
  barebones: "CAIRN.TableRole.Barebones",
  cairn2e: "CAIRN.TableRole.Cairn2e",
  generic: "CAIRN.TableRole.Generic",
  template: "CAIRN.TableRole.Template",
  templateImport: "CAIRN.TableRole.TemplateImport",
  checklist: "CAIRN.TableRole.Checklist",
  duplicate: "CAIRN.TableRole.Duplicate",
  // The `{dice}` tail of the three book-order banners: which of the two
  // sentences a table gets is `hasFlatDie`'s answer, the same test
  // `fitFormula` makes, so the banner never promises what the hook will not do.
  newRow: "CAIRN.TableRole.NewRow",
  customDice: "CAIRN.TableRole.CustomDice",
  // The extra sentence a world table's banner ends with in VIEW mode.
  viewMode: "CAIRN.TableRole.ViewMode",
};

const SYSTEM_PACK = /^air-bladder\./;

/** Shipped tables a reader takes from the PACK ONLY, so a world table of the
 *  same name overrides something else: the sheet's scar checklist, whose
 *  namesake in Utils is what the damage card rolls. */
const CHECKLIST_TABLES = { "air-bladder.tables-2e": ["Scars"] };

/** Where the scar a damage roll deals comes from — damage.js's declaration. */
const SCAR_CARD_PACK = "air-bladder.utils";

/** How many OTHER world tables share this table's name. */
const duplicatesOf = (table) => game.tables.filter((t) => t.id !== table.id && t.name === table.name).length;

/** Is a table of this name shipped in ANY of our RollTable packs? The generic
 *  role: every one of them is read world-first by name (the Dashboard, the
 *  generators, the damage flow, the cast flow). */
const shippedAnywhere = (name) => game.packs.some((p) =>
  p.metadata.type === "RollTable" && SYSTEM_PACK.test(p.collection) && p.index.some((e) => e.name === name));

/**
 * What Air Bladder reads this table for, and the words the banner needs.
 *
 *   pack table, not ours              → null (a world compendium, another package)
 *   pack table a button copies        → template  {button, sidebar}
 *   the sheet checklist's own list    → checklist  {utils, button, sidebar}
 *   any other pack table of ours      → templateImport  {import}
 *   world `Market:` table             → market | transports  {aisle}
 *   world table a button copies       → spells | barebones | cairn2e
 *   world table of any shipped name   → generic
 *   anything else                     → null
 *
 * Accepted edge, recorded in CLAUDE.md: a hand-imported `Barebones: Weapon
 * Tier` table nobody's Weapon row points at wears the Barebones banner though
 * it is reached by uuid, not by name; the button re-points the Weapon rows, so
 * the copied set is true to the sentence.
 * @param {RollTable} table
 * @returns {{role: string, [k: string]: string}|null}
 */
export const tableRole = (table) => {
  const name = table?.name ?? "";
  if (table?.pack) {
    if (!SYSTEM_PACK.test(table.pack)) return null;
    const found = kindOfTable(name, { pack: table.pack });
    if (found) return { role: "template", button: L(found.kind.button), sidebar: sidebarLabel(found.kind.tab) };
    if (CHECKLIST_TABLES[table.pack]?.includes(name)) {
      // The button that copies the namesake a WORLD table of this name would
      // override — asked without a pack, the way a world table is.
      const card = kindOfTable(name);
      return {
        role: "checklist",
        utils: game.packs.get(SCAR_CARD_PACK)?.metadata.label ?? SCAR_CARD_PACK,
        button: card ? L(card.kind.button) : "",
        sidebar: card ? sidebarLabel(card.kind.tab) : "",
      };
    }
    return { role: "templateImport", import: L("COMPENDIUM.ImportEntry") };
  }
  const aisle = marketAisle(name);
  if (aisle) return { role: aisle.name === TRANSPORTS_CATEGORY ? "transports" : "market", aisle: aisle.label };
  const found = kindOfTable(name);
  if (found) return { role: found.key };
  if (shippedAnywhere(name)) return { role: "generic" };
  return null;
};

/**
 * `renderRollTableSheet` hook. NAMED, so `withHookOff` can switch it off by
 * name; its OWN registration in cairn.js, because the sheet's i18n hook beside
 * it returns on `!contentLocalized()` and a banner is owed in every language.
 * @param {foundry.applications.sheets.RollTableSheet} app
 * @param {HTMLElement} element
 * @param {object} context
 * @param {object} options
 */
export const abTableRoleBanner = (app, element, context, options) => {
  if (!game.user?.isGM) return;
  // A render that replaced neither part holding the anchor kept the old
  // banner; the query below would find it anyway, this just says so.
  const parts = options?.parts;
  if (parts && !parts.includes("sheet") && !parts.includes("results")) return;
  const root = element ?? app.element;
  if (!root || root.querySelector(".ab-table-role, .ab-table-duplicate")) return;
  const role = tableRole(app.document);
  if (!role) return;
  const table = root.querySelector("table[data-results]");
  if (!table) return;
  const values = {};
  for (const [k, v] of Object.entries(role)) if (k !== "role") values[k] = esc(v);
  // The tail of a book-order banner: a flat die follows the rows by itself
  // (`fitFormula`); anything else is the Warden's curve, and the sentence
  // names the formula and the tab where it is set — core's own tab label.
  values.dice = hasFlatDie(app.document)
    ? L(KEYS.newRow)
    : game.i18n.format(KEYS.customDice, {
      formula: esc(String(app.document._source?.formula ?? "").trim()),
      tab: esc(L("TABLE.TABS.summary")),
    });
  // A WORLD table read in view mode: every "drag" and "press +" above needs
  // edit mode first, and the sheet opens in view. Named with core's own
  // button label, so it reads as the button reads.
  const viewMode = !app.document.pack && !app.isEditMode
    ? ` <span class="ab-table-role-view">${game.i18n.format(KEYS.viewMode, { edit: esc(L("TABLE.ACTIONS.ChangeMode.Edit")) })}</span>`
    : "";
  const p = document.createElement("p");
  p.className = "hint ab-table-role";
  p.dataset.role = role.role;
  p.dataset.mode = app.isEditMode ? "edit" : "view";
  // The key carries its own <strong>; every value went through esc above.
  p.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>${game.i18n.format(KEYS[role.role], values)}${viewMode}</span>`;
  table.before(p);
  if (!app.document.pack && duplicatesOf(app.document) > 0) {
    const w = document.createElement("p");
    w.className = "hint ab-table-duplicate";
    w.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>${L(KEYS.duplicate)}</span>`;
    p.after(w);
  }
};

/**
 * Re-inject the banner on every OPEN table sheet — after any RollTable is
 * created, deleted or renamed, so a duplicate-name line follows the other
 * table without a reopen. DOM only: `app.render()` on an edit-mode sheet
 * would drop unsaved edits, and a sheet re-renders itself on its OWN changes
 * already.
 */
export const refreshTableBanners = () => {
  for (const app of foundry.applications.instances.values()) {
    if (app.document?.documentName !== "RollTable" || !app.rendered) continue;
    const root = app.element;
    if (!root) continue;
    for (const node of root.querySelectorAll(".ab-table-role, .ab-table-duplicate")) node.remove();
    abTableRoleBanner(app, root, {}, {});
  }
};

/**
 * Write `1d<highest range end>` on a flat-die table whose rows have outgrown
 * or undershot it. Order untouched — a new row stays where core put it, at
 * the bottom. Nothing is written for a table with no rows (`1d0` is not a
 * die), when the stored formula is not a flat die (`hasFlatDie`), or when it
 * already fits.
 * @param {RollTable} table
 * @returns {Promise<boolean>}  whether anything was written
 */
export const fitFormula = async (table) => {
  if (!hasFlatDie(table)) return false;
  const ends = [...table.results].map((r) => Number(r.range?.[1]) || 0);
  if (!ends.length) return false;
  const formula = `1d${Math.max(...ends)}`;
  if (String(table._source.formula ?? "").trim() === formula) return false;
  await table.update({ formula });
  return true;
};

/**
 * `createTableResult` and `deleteTableResult` hook: a row landing in, or
 * leaving, a WORLD table Air Bladder reads keeps that table rollable. The
 * aisles and the spell tables re-sort by name (`keptAlphabetical`, the rows
 * being alphabetical by design); every other bannered table gets
 * `fitFormula`. On the CREATING or DELETING client only — every other client
 * receives the row and would race the same write. World tables only, by way
 * of `tableRole`: the shipped compendium is not where a Warden's rows should
 * live, and helping them edit it there would say otherwise. A formula write
 * and a range update fire no create or delete hook, so this cannot recurse.
 * @param {TableResult} doc
 * @param {object} options
 * @param {string} userId
 */
export const onReadTableRowsChanged = (doc, options, userId) => {
  if (userId !== game.user.id) return;
  const table = doc.parent;
  if (!table || table.pack || !tableRole(table)) return;
  const job = keptAlphabetical(table) ? resortTableByName(table) : fitFormula(table);
  job.catch((err) => console.error("Air Bladder | table upkeep failed:", err));
};

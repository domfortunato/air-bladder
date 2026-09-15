/**
 * Copy shipped content into the world — the Marketplace, the Barebones creation
 * tables, and Cairn 2e's backgrounds and tables (2026-09-14, user ask: "could a
 * script not be created that would import the marketplace tables, import the
 * items, and repoint the tables?").
 *
 * WHY. Every shipped compendium is deleted and rewritten when the system
 * updates, so the durable way to own the shop, a creation table or a background
 * is a copy in the world — and by hand that is about 158 operations for the shop
 * (four tables, seventy items and seven mounts from seven compendiums, then
 * every row re-pointed), 121 document rows for Barebones creation, and for the
 * backgrounds Duplicate → rename → eye → switch, twenty-seven times. The user's
 * framing, and the sentence every confirm and every guide now carries: the
 * shipped compendiums are TEMPLATES, the starting point you copy and make your
 * own, never the place you edit.
 *
 * FOUR BUTTONS, ONE JOB EACH, each on the tab where its output lands (user
 * ruling, after round one's single two-checkbox dialog copied the backgrounds
 * somewhere the Warden could not find them). Rollable Tables sidebar: the Spell
 * Tables, the Marketplace, and the Barebones creation tables. Compendium
 * sidebar: Cairn 2e, which is the 27 backgrounds AND the eleven text tables a
 * 2e character rolls on — Bonds and Omens folded in at the user's ask ("why
 * can't the character background copy bring those over too?"), so those two
 * are no longer the ones a Warden has to know are different. Each button spans
 * the sidebar's width on a row of its own. All four are explicit gestures: the
 * custom-backgrounds SETTING is deliberately not a trigger, because that switch
 * means "offer the seven extra backgrounds" and a settings save must never
 * mint documents in somebody's world.
 *
 * THE SPELL TABLES BUTTON REPLACED "RESEED A SPELL TABLE" (2026-09-14, user,
 * twice in one day: "why can't it be renamed Copy Spell Tables to this world
 * and work exactly the same way as the other two buttons"). Reseed refilled a
 * world table from a compendium's index — a different mechanism with a
 * different dialog, argued from "a spell table is a snapshot and goes stale" —
 * and a Warden does not want a second rule for one table. So the spell pool is
 * a declared table like Bonds (config.js `characterGenerator2e.spells`,
 * character-generator.js `randomSpellbookDoc`), and this button copies it and
 * the spellbooks its rows point at, the way the Marketplace button copies the
 * shop. Its spec is computed at CLICK time, because the GLOG hack swaps the
 * pool wholesale (canon excluded, ruling 2026-08-05): with the hack on it
 * copies `Spells — GLOG` and the 100 GLOG spellscrolls, otherwise the canon
 * table and its 100 spellbooks. One pool per world — the hack is a one-way campaign
 * decision (docs/glog-magic.md) — so the confirm warns a canon world that
 * switching the hack on later means coming back for the GLOG table, and says
 * nothing about switching it off.
 *
 * PLAN, THEN RUN — and the plan is the only protection there is. Foundry 14's
 * `DocumentCollection#importDocument` keeps compendium ids (`keepId ??= true`)
 * and on an id collision with no dialog it silently REPLACES the world document
 * (document-collection.mjs:360-405); the server refuses a duplicate id only in
 * EMBEDDED collections, so a raw `createDocuments({keepId: true})` over an
 * existing world id is not refused either. Nothing here ever calls
 * `importDocument`/`importFromCompendium`; each `plan*` function decides
 * membership with pure reads (`collection.get(id)`, `getName`, the pack index)
 * and each `run*` creates exactly the documents its plan listed as missing.
 * That split is what makes a re-run keep every edit the Warden made.
 *
 * IDENTITY. Items, actors and background copies keep the SHIPPED ID (one
 * `keepId: true` per batch), so a copy is found again by id — and a background
 * copy with the shipped id stands in for the original in the 2e pool by that
 * pool's own de-dup-by-id rule (character-generator.js build2ePool), which is
 * why the backgrounds half writes nothing into `disabled-backgrounds`: delete
 * the copy and the shipped one is back, the same undo the tables have. Tables
 * are identified by NAME, because the name is how a world table is found
 * (marketplace.js marketTables, compendium.js findDeclaredTable) and a second
 * same-name table would be ambiguous; a table the Warden already imported by
 * hand is kept as it is, and the result window says so when its rows still
 * point at the shipped documents. An item, mount or table the Warden imported
 * earlier under a NEW id (Import All Content without "Keep Document IDs") is
 * adopted through `_stats.compendiumSource`, never twinned.
 *
 * ORDER. Folders, then items and actors, then tables LAST with their rows
 * inline: an EMPTY world `Market:` table deletes its aisle (getMarketplaceCatalog
 * skips a category with no resolved rows), and rows created with their parent
 * fire no `createTableResult`, so table-banner.js `onReadTableRowsChanged`
 * cannot re-sort a table mid-write. A failure before the tables leaves the
 * shop on the shipped aisles and a re-run resumes.
 *
 * Gate: `npm run dev:take-over`.
 */
import { MARKETPLACE_PACK, compendiumInfoFromString } from "./compendium.js";
import { t } from "./i18n-content.js";
import { formatCount } from "./utils.js";
import { SETTINGS_NS } from "./settings.js";
import { CUSTOM_BG_PACK, ensureCustomBackgroundPack, SHIPPED_2E_BACKGROUND_PACKS } from "./character-generator.js";
import { glogEnabled } from "./glog.js";
import { Cairn } from "./config.js";

/** `flags.air-bladder.takeOver` on a copy's folder — the KIND, so the four
 *  sets keep four folders and each result window can reopen its own. */
export const TAKE_OVER_FLAG = "takeOver";

const L = (k) => game.i18n.localize(k);
const esc = (s) => foundry.utils.escapeHTML(String(s));

/** A shipped row's target: pack, document type, id. Only these are rewritten;
 *  anything else a row points at is copied verbatim. RollTable is here for the
 *  Barebones Weapon table, whose three rows point at the tier tables beside it. */
const SOURCE_UUID = /^Compendium\.air-bladder\.([\w-]+)\.(Item|Actor|RollTable)\.([A-Za-z0-9]{16})$/;

/**
 * The eleven tables a 2e character rolls on. Named, not "everything in the
 * pack": the twelfth, `Spells — Canon (1d100)`, has a button of its own below,
 * because its 100 rows bring 100 spellbooks into the Items sidebar with them,
 * which is a different kind of copy from eleven tables of text rows.
 */
const CAIRN_2E_TABLES = [
  "Bonds", "Omens", "Scars",
  "Physique", "Skin", "Hair", "Face", "Speech", "Clothing", "Vice", "Virtue",
];

/** One pool as a take-over spec — the generator's own declaration, split into
 *  its pack and table halves. */
const spellSpecFor = (glog) => {
  const decl = glog ? Cairn.characterGenerator2e.spells.glog : Cairn.characterGenerator2e.spells.canon;
  const [pack, table] = compendiumInfoFromString(decl);
  return { key: "spells", pack, only: [table], folder: "CAIRN.TakeOver.Spells.Folder" };
};

/** The spell pool in force RIGHT NOW as a take-over spec. */
const spellSpec = () => spellSpecFor(glogEnabled());

/**
 * One declaration per button: which pack it copies, what its confirm says, and
 * whether the backgrounds ride with it. The strings are keys so a translator
 * reaches every one of them, and the confirm is assembled in one place below —
 * the alternative, four hand-built dialogs, is four things to drift. `spec` and
 * `extra` may be FUNCTIONS, read when the button is pressed: the spells kind
 * depends on a setting that needs no reload, and the directory does not
 * re-render on a settings save.
 *
 * `tab` is the sidebar the button sits on, and `specs` — where a kind has more
 * than one state — names EVERY table set it can copy. Both exist for
 * `kindOfTable` below: the table banner (table-banner.js) asks which button
 * covers a table, and must recognise a `Spells — GLOG` copy in a canon world,
 * or the shipped GLOG table under the hack off, as the Spell Table button's.
 */
const KINDS = {
  spells: {
    spec: spellSpec,
    specs: () => [spellSpecFor(false), spellSpecFor(true)],
    tab: "tables",
    button: "CAIRN.TakeOver.Spells.Button",
    title: "CAIRN.TakeOver.Spells.Title",
    pitch: "CAIRN.TakeOver.Spells.Pitch",
    why: "CAIRN.TakeOver.Spells.Why",
    how: "CAIRN.TakeOver.Spells.How",
    fix: "CAIRN.TakeOver.Spells.Fix",
    extra: () => (glogEnabled() ? "CAIRN.TakeOver.Spells.GlogOn" : "CAIRN.TakeOver.Spells.GlogOff"),
    done: "CAIRN.TakeOver.Result.Spells",
  },
  marketplace: {
    spec: { key: "marketplace", pack: MARKETPLACE_PACK, folder: "CAIRN.TakeOver.Marketplace.Folder" },
    tab: "tables",
    button: "CAIRN.TakeOver.Marketplace.Button",
    title: "CAIRN.TakeOver.Marketplace.Title",
    pitch: "CAIRN.TakeOver.Marketplace.Pitch",
    why: "CAIRN.TakeOver.Marketplace.Why",
    how: "CAIRN.TakeOver.Marketplace.How",
    fix: "CAIRN.TakeOver.Marketplace.Fix",
    done: "CAIRN.TakeOver.Result.Marketplace",
  },
  barebones: {
    spec: { key: "barebones", pack: "air-bladder.tables-barebones", folder: "CAIRN.TakeOver.Barebones.Folder" },
    tab: "tables",
    button: "CAIRN.TakeOver.Barebones.Button",
    title: "CAIRN.TakeOver.Barebones.Title",
    pitch: "CAIRN.TakeOver.Barebones.Pitch",
    why: "CAIRN.TakeOver.Barebones.Why",
    how: "CAIRN.TakeOver.Barebones.How",
    fix: "CAIRN.TakeOver.Barebones.Fix",
    done: "CAIRN.TakeOver.Result.Barebones",
  },
  cairn2e: {
    spec: { key: "cairn2e", pack: "air-bladder.tables-2e", only: CAIRN_2E_TABLES, folder: "CAIRN.TakeOver.Cairn2e.Folder" },
    backgrounds: true,
    tab: "compendium",
    button: "CAIRN.TakeOver.Cairn2e.Button",
    title: "CAIRN.TakeOver.Cairn2e.Title",
    pitch: "CAIRN.TakeOver.Cairn2e.Pitch",
    why: "CAIRN.TakeOver.Cairn2e.Why",
    how: "CAIRN.TakeOver.Cairn2e.How",
    fix: "CAIRN.TakeOver.Cairn2e.Fix",
    extra: "CAIRN.TakeOver.Cairn2e.Tables",
    done: "CAIRN.TakeOver.Result.Cairn2e",
  },
};

/* -------------------------------------------------------------------------- */
/*  Tables, and everything their rows point at                                */
/* -------------------------------------------------------------------------- */

/**
 * Pure reads: what copying one pack's tables would create and what it would
 * keep. One function for all three sets — the marketplace's document rows, the
 * Barebones tables' document and TABLE rows, and the 2e tables' text rows,
 * which need nothing re-pointed and say so by leaving `targets` empty.
 *
 * @param {{key: string, pack: string, only?: string[], folder: string}} spec
 * @returns {Promise<object>} `{ ok, spec, pack, tables: {add, kept}, items: {add,
 *   kept}, actors: {add, kept}, rows, unresolved, targets, tableTargets }` —
 *   `targets` maps each shipped uuid to `{ type, doc, world }`, `world` being
 *   the existing copy the rows will point at (null when one must be created);
 *   `tableTargets` maps a row's shipped table uuid straight to the world uuid.
 */
export const planTableTakeOver = async (spec) => {
  const empty = {
    tables: { add: [], kept: [] }, items: { add: [], kept: [] }, actors: { add: [], kept: [] },
    rows: 0, unresolved: [], targets: new Map(), tableTargets: new Map(),
  };
  const pack = game.packs.get(spec.pack);
  if (!pack) return { ok: false, spec, pack: spec.pack, ...empty };
  const all = await pack.getDocuments();
  const shipped = spec.only ? all.filter((d) => spec.only.includes(d.name)) : all;
  const plan = { ok: true, spec, pack: spec.pack, ...empty };

  // Where a copied table will live, keyed by the SHIPPED id: the id survives
  // `keepId` for one we create, and a kept one answers to its own.
  const worldTableFor = new Map();
  const tableRows = [];
  const wanted = new Map();   // pack collection → Map(id → { type, uuid })

  for (const table of shipped) {
    // By NAME and only by name — a world table is found by its name (the shop's
    // `marketTables`, `findDeclaredTable`), so a renamed copy is not the table
    // anything will read, and adopting one through `compendiumSource` would
    // skip creating the one that counts.
    const existing = game.tables.getName(table.name);
    if (existing) {
      const pointingAtPack = existing.results.filter((r) => String(r.documentUuid ?? "").startsWith("Compendium.")).length;
      plan.tables.kept.push({ id: existing.id, name: existing.name, pointingAtPack });
      worldTableFor.set(table.id, `RollTable.${existing.id}`);
    } else {
      plan.tables.add.push(table);
      worldTableFor.set(table.id, `RollTable.${table.id}`);
    }
    for (const r of table.results) {
      plan.rows++;
      // A TEXT row is copied verbatim, flags and all — that is the whole of the
      // 2e tables, and it is why Bonds' gold and items payload rides along.
      if (r.type !== CONST.TABLE_RESULT_TYPES.DOCUMENT) continue;
      const m = SOURCE_UUID.exec(r.documentUuid ?? "");
      if (!m) { plan.unresolved.push(r.documentUuid ?? r.name ?? "?"); continue; }
      const [, packName, type, id] = m;
      const coll = `air-bladder.${packName}`;
      if (type === "RollTable") { tableRows.push({ uuid: r.documentUuid, coll, id }); continue; }
      if (!wanted.has(coll)) wanted.set(coll, new Map());
      wanted.get(coll).set(id, { type, uuid: r.documentUuid });
    }
  }

  // A row pointing at a table THIS run copies is re-pointed at the copy; one
  // pointing anywhere else keeps its uuid, which still resolves against the
  // shipped pack. Resolved after the loop, because the Weapon table's rows name
  // tier tables that may not have been visited yet.
  for (const { uuid, coll, id } of tableRows) {
    if (coll === spec.pack && worldTableFor.has(id)) plan.tableTargets.set(uuid, worldTableFor.get(id));
  }

  // One round trip per source pack, not one per row.
  for (const [coll, ids] of wanted) {
    const source = game.packs.get(coll);
    const docs = source ? await source.getDocuments({ _id__in: [...ids.keys()] }) : [];
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const [id, { type, uuid }] of ids) {
      const doc = byId.get(id);
      if (!doc) { plan.unresolved.push(uuid); continue; }
      const collection = type === "Actor" ? game.actors : game.items;
      const bucket = type === "Actor" ? plan.actors : plan.items;
      // The shipped id first (v14's own Import keeps it); else a copy made
      // under a new id, which `fromCompendium` stamped with its source.
      const world = collection.get(id)
        ?? collection.find((d) => d._stats?.compendiumSource === uuid)
        ?? null;
      (world ? bucket.kept : bucket.add).push(world ?? doc);
      plan.targets.set(uuid, { type, doc, world });
    }
  }
  return plan;
};

/** `flags.air-bladder.takeOverPack` on a SUBFOLDER — the source compendium
 *  whose copies it holds, beside the kind flag it shares with its parent. */
export const TAKE_OVER_PACK_FLAG = "takeOverPack";

/** The flagged folder for one kind and document type, if it exists — the
 *  PARENT. A subfolder carries the kind flag too, and is told apart by also
 *  naming its pack. */
const findTakeOverFolder = (type, key) =>
  game.folders.find((f) => f.type === type && f.getFlag(game.system.id, TAKE_OVER_FLAG) === key
    && !f.getFlag(game.system.id, TAKE_OVER_PACK_FLAG)) ?? null;

/** Find-or-create it (the encounters.js `encounterFolder` idiom): found by
 *  FLAG, never by name, and named in the Warden's language at creation, since a
 *  folder name is stored. */
const takeOverFolder = async (type, spec) => findTakeOverFolder(type, spec.key)
  ?? await Folder.create({
    name: L(spec.folder),
    type,
    flags: { [game.system.id]: { [TAKE_OVER_FLAG]: spec.key } },
  });

/**
 * One subfolder per SOURCE compendium inside the kind's folder (user,
 * 2026-09-14, on the shop's seventy items in one folder: "should those items
 * not have gone into folders like Armor, Gear, Market Goods, Tools, Weapons,
 * Trinkets?"). Named with the compendium's own label, which core localises at
 * construction (compendium-collection.mjs:46), and found by the kind flag PLUS
 * the pack flag, so a re-run files into the folder it made last time rather
 * than minting a second Weapons.
 *
 * NONE when the kind draws from a single compendium for this document type —
 * the mounts, the spellbooks — because one child holding everything is the
 * same dump one level down. That is decided over EVERY row's source
 * (`targets`, kept copies included), so the answer is a property of the
 * shipped tables and never of which items this particular run happens to add;
 * the folders themselves are made only for the packs this run adds from, so
 * no empty Armor appears on a run that keeps every armor.
 *
 * Kept copies are never moved: the Warden's arrangement is theirs.
 *
 * @param {"Item"|"Actor"} type
 * @param {{key: string}} spec
 * @param {Folder} parent            the kind's flagged folder
 * @param {Iterable<object>} targets  every `plan.targets` value
 * @param {Document[]} adding        the compendium documents being copied
 * @returns {Promise<Map<string, Folder>>}  source collection → subfolder; empty when none apply
 */
const sourceFolders = async (type, spec, parent, targets, adding) => {
  const byPack = new Map();
  const all = new Set([...targets].filter((t) => t.type === type).map((t) => t.doc.pack));
  if (all.size < 2) return byPack;
  const wanted = [...new Set(adding.map((d) => d.pack))];
  const missing = [];
  for (const p of wanted) {
    const found = game.folders.find((f) => f.type === type
      && f.getFlag(game.system.id, TAKE_OVER_FLAG) === spec.key
      && f.getFlag(game.system.id, TAKE_OVER_PACK_FLAG) === p);
    if (found) byPack.set(p, found);
    else missing.push(p);
  }
  if (missing.length) {
    const made = await Folder.implementation.createDocuments(missing.map((p) => ({
      name: game.packs.get(p)?.metadata.label ?? p,
      type,
      folder: parent.id,
      flags: { [game.system.id]: { [TAKE_OVER_FLAG]: spec.key, [TAKE_OVER_PACK_FLAG]: p } },
    })));
    // Two or more come back in server-finish order, not request order: map
    // each by its own flag, never by index.
    for (const f of made) byPack.set(f.getFlag(game.system.id, TAKE_OVER_PACK_FLAG), f);
  }
  return byPack;
};

/** `fromCompendium` with the id kept and the folder set. `clearFolder`
 *  defaults false, so without the override a copy would carry the PACK's
 *  folder id, which no world folder answers to. */
const worldCopy = (collection, doc, folder) => {
  const data = collection.fromCompendium(doc, { keepId: true });
  data.folder = folder.id;
  return data;
};

/**
 * Create what the plan listed as missing — targets first, tables last. Folders
 * are made only for what is actually written, so a text-table set (the 2e
 * eleven) leaves no empty Items and Actors folders behind.
 * @param {object} plan  from planTableTakeOver
 * @returns {Promise<{added: number, kept: number, folders: object, keptTables: object[]}|null>}
 */
export const runTableTakeOver = async (plan) => {
  if (!plan?.ok) return null;
  const { spec } = plan;
  const folders = { Item: null, Actor: null, RollTable: null };

  let added = 0;
  if (plan.items.add.length) {
    folders.Item = await takeOverFolder("Item", spec);
    const into = await sourceFolders("Item", spec, folders.Item, plan.targets.values(), plan.items.add);
    const made = await Item.implementation.createDocuments(
      plan.items.add.map((d) => worldCopy(game.items, d, into.get(d.pack) ?? folders.Item)), { keepId: true });
    added += made.length;
  }
  if (plan.actors.add.length) {
    folders.Actor = await takeOverFolder("Actor", spec);
    const into = await sourceFolders("Actor", spec, folders.Actor, plan.targets.values(), plan.actors.add);
    const made = await Actor.implementation.createDocuments(
      plan.actors.add.map((d) => worldCopy(game.actors, d, into.get(d.pack) ?? folders.Actor)), { keepId: true });
    added += made.length;
  }

  // Where each shipped row now points: an adopted copy's own uuid, the relative
  // uuid of the document just created under the shipped id, or — for a row
  // naming another of these tables — what the plan already worked out.
  const worldFor = new Map();
  for (const [uuid, tgt] of plan.targets) worldFor.set(uuid, tgt.world ? tgt.world.uuid : `${tgt.type}.${tgt.doc.id}`);
  for (const [uuid, to] of plan.tableTargets) worldFor.set(uuid, to);

  if (plan.tables.add.length) {
    folders.RollTable = await takeOverFolder("RollTable", spec);
    const datas = plan.tables.add.map((table) => {
      const data = worldCopy(game.tables, table, folders.RollTable);
      const rows = [...table.results].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
      data.results = rows.map((r, i) => {
        const row = r.toObject();
        row.range = [i + 1, i + 1];
        row.drawn = false;
        const to = worldFor.get(row.documentUuid);
        if (to) row.documentUuid = to;
        return row;
      });
      // Stored, not derived: the re-sort on drop compares `_source.formula`
      // (marketplace.js resortTableByName, review #30).
      data.formula = `1d${rows.length}`;
      return data;
    });
    const made = await RollTable.implementation.createDocuments(datas, { keepId: true });
    added += made.length;
  }

  // A re-run that wrote nothing still has somewhere to send the Warden.
  for (const type of ["Item", "Actor", "RollTable"]) folders[type] ??= findTakeOverFolder(type, spec.key);
  const kept = plan.items.kept.length + plan.actors.kept.length + plan.tables.kept.length;
  return { added, kept, folders, keptTables: plan.tables.kept.filter((k) => k.pointingAtPack) };
};

/* -------------------------------------------------------------------------- */
/*  2e backgrounds                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Pure reads: which of the 27 shipped 2e backgrounds the world compendium
 * already holds under the shipped id, and which it lacks.
 * @returns {Promise<{ok: boolean, add: Item[], kept: Item[], exists: boolean, locked: boolean}>}
 */
export const planBackgroundsTakeOver = async () => {
  const world = game.packs.get(CUSTOM_BG_PACK);
  const have = new Set(world ? (await world.getIndex()).map((e) => e._id) : []);
  const plan = { ok: true, add: [], kept: [], exists: !!world, locked: !!world?.locked };
  for (const collection of SHIPPED_2E_BACKGROUND_PACKS) {
    const pack = game.packs.get(collection);
    if (!pack) return { ...plan, ok: false, pack: collection, add: [], kept: [] };
    for (const doc of await pack.getDocuments()) (have.has(doc.id) ? plan.kept : plan.add).push(doc);
  }
  return plan;
};

/**
 * Copy the missing backgrounds into the world compendium under their own
 * names and the shipped ids, then make sure the custom source is on — the
 * copies are invisible until it is. No suffix, no eye toggle: the id is what
 * makes each copy stand in for the shipped one.
 * @param {object} plan  from planBackgroundsTakeOver
 * @returns {Promise<{added: number, kept: number, locked: boolean, pack: string}|null>}
 */
export const runBackgroundsTakeOver = async (plan) => {
  if (!plan?.ok) return null;
  const pack = await ensureCustomBackgroundPack();
  if (!pack) return null;
  let added = 0;
  if (plan.add.length) {
    // Refuse rather than unlock in silence — but only when there is something
    // to write; a run with nothing to add needs no unlock and gets no warning.
    if (pack.locked) return { added: 0, kept: plan.kept.length, locked: true, pack: pack.collection };
    const datas = plan.add.map((doc) => {
      const data = doc.toObject();
      delete data.folder;
      // Forced, as Duplicate forces it: getCustomBackgrounds filters on it.
      data.system = { ...data.system, source: "2e" };
      // Parity with what a world import stamps; the ID is the identity.
      data._stats = { ...(data._stats ?? {}), compendiumSource: doc.uuid };
      return data;
    });
    const made = await Item.implementation.createDocuments(datas, { pack: pack.collection, keepId: true });
    added = made.length;
  }
  if (!game.settings.get(SETTINGS_NS, "content-source-custom")) {
    await game.settings.set(SETTINGS_NS, "content-source-custom", true);
  }
  return { added, kept: plan.kept.length, locked: false, pack: pack.collection };
};

/* -------------------------------------------------------------------------- */
/*  The confirm, the run, the result                                          */
/* -------------------------------------------------------------------------- */

/** "4 tables, 70 items and 7 mounts or transports", zeroes left out. */
const countsPhrase = (pairs) => {
  const parts = pairs.filter(([, n]) => n > 0).map(([key, n]) => formatCount(key, n));
  return parts.length ? game.i18n.getListFormatter().format(parts) : "";
};

/** What one button would add, and what it would leave alone. */
const countsFor = (kind, tables, backgrounds) => {
  const add = [], kept = [];
  if (kind.backgrounds && backgrounds?.ok) {
    add.push(["CAIRN.TakeOver.NBackgrounds", backgrounds.add.length]);
    kept.push(["CAIRN.TakeOver.NBackgrounds", backgrounds.kept.length]);
  }
  if (tables?.ok) {
    add.push(["CAIRN.TakeOver.NTables", tables.tables.add.length],
      ["CAIRN.TakeOver.NItems", tables.items.add.length],
      ["CAIRN.TakeOver.NActors", tables.actors.add.length]);
    kept.push(["CAIRN.TakeOver.NTables", tables.tables.kept.length],
      ["CAIRN.TakeOver.NItems", tables.items.kept.length],
      ["CAIRN.TakeOver.NActors", tables.actors.kept.length]);
  }
  return { add: countsPhrase(add), kept: countsPhrase(kept) };
};

/**
 * A headed paragraph. The bodies carry `<strong>` of their own — the route
 * `CAIRN.DeprivedTip` and the creation hints already take — so they are
 * inserted as markup and only interpolated VALUES are escaped.
 */
const headed = (headKey, bodyKey) => `<p><strong>${L(headKey)}</strong><br>${L(bodyKey)}</p>`;

/**
 * The confirm. It sells the reason rather than describing the mechanism (user:
 * "the text needs to be more verbose about why a warden would want to do this"),
 * and it ends on the counts so nobody presses Copy without knowing the size of
 * the write. Cancel is the default (focused) button and BOTH buttons are
 * `type: "button"`, so Enter never copies.
 * @returns {Promise<boolean>}
 */
const confirmTakeOver = async (kind, counts) => {
  const body = [
    headed(kind.pitch, kind.why),
    headed("CAIRN.TakeOver.HowHeader", kind.how),
    headed("CAIRN.TakeOver.FixHeader", kind.fix),
    kind.extra ? `<p>${L(kind.extra)}</p>` : "",
    `<p class="take-over-counts">${counts.add
      ? game.i18n.format("CAIRN.TakeOver.WillCopy", { counts: esc(counts.add) })
        + (counts.kept ? ` ${game.i18n.format("CAIRN.TakeOver.Kept", { kept: esc(counts.kept) })}` : "")
      : L("CAIRN.TakeOver.NothingMissing")}</p>`,
    `<p class="hint">${L("CAIRN.TakeOver.Rerun")}</p>`,
  ].join("");

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: L(kind.title), icon: "fa-solid fa-file-import" },
    position: { width: 480 },
    content: `<div class="cairn-take-over">${body}</div>`,
    buttons: [
      { action: "copy", label: L("CAIRN.TakeOver.Copy"), icon: "fa-solid fa-file-import", type: "button" },
      // `false`, never `null` (dialog.mjs:273 resolves `callback() ?? action`).
      { action: "cancel", label: L("CAIRN.Cancel"), type: "button", default: true, callback: () => false },
    ],
    rejectClose: false,
  });
  return picked === "copy";
};

/** Raise a sidebar tab and open one of our folders in it. */
const openDirectory = (tab, folder) => {
  ui.sidebar?.expand?.();
  ui.sidebar?.changeTab?.(tab, "primary");
  if (folder) game.folders._expanded[folder.uuid] = true;
  ui[tab]?.render({ force: true });
};

/**
 * What happened, and a way to go and look at it — round one ended in toasts,
 * and a Warden who could not find the backgrounds is why this window exists.
 * Every button CLOSES the window: it is a signpost, not a control panel.
 */
const showResult = async (kind, { tables, backgrounds }) => {
  const lines = [];
  const made = tables ? countsPhrase([
    ["CAIRN.TakeOver.NTables", tables.counts?.tables ?? 0],
    ["CAIRN.TakeOver.NItems", tables.counts?.items ?? 0],
    ["CAIRN.TakeOver.NActors", tables.counts?.actors ?? 0],
  ]) : "";

  if (backgrounds?.locked) lines.push(`<p class="warning">${L("CAIRN.TakeOver.PackLocked")}</p>`);
  else if (backgrounds?.added) {
    lines.push(`<p>${game.i18n.format("CAIRN.TakeOver.Result.Backgrounds", {
      counts: esc(formatCount("CAIRN.TakeOver.NBackgrounds", backgrounds.added)),
    })}</p>`);
  }
  // Name only the directories a folder actually landed in — a run that added no
  // mount must not send the Warden to the Actors tab to look for one.
  const where = game.i18n.getListFormatter().format([
    ["RollTable", "CAIRN.TakeOver.Result.DirTables"], ["Item", "CAIRN.TakeOver.Result.DirItems"],
    ["Actor", "CAIRN.TakeOver.Result.DirActors"],
  ].filter(([type]) => tables?.folders[type]).map(([, key]) => L(key)));
  if (made) {
    lines.push(`<p>${game.i18n.format(kind.done, {
      counts: esc(made), folder: esc(L(kind.spec.folder)), where: esc(where),
    })}</p>`);
  }
  // Nothing was missing. Say so plainly rather than quoting a sentence full of
  // zeroes, and still offer the buttons — the Warden came here to find the copies.
  if (!lines.length) lines.push(`<p>${L("CAIRN.TakeOver.Result.NothingNew")}</p>`);

  const kept = countsPhrase([
    ["CAIRN.TakeOver.NBackgrounds", backgrounds?.kept ?? 0],
    ["CAIRN.TakeOver.NTables", tables?.keptCounts?.tables ?? 0],
    ["CAIRN.TakeOver.NItems", tables?.keptCounts?.items ?? 0],
    ["CAIRN.TakeOver.NActors", tables?.keptCounts?.actors ?? 0],
  ]);
  if (kept) lines.push(`<p>${game.i18n.format("CAIRN.TakeOver.Result.Kept", { kept: esc(kept) })}</p>`);
  for (const k of tables?.keptTables ?? []) {
    lines.push(`<p class="warning">${game.i18n.format("CAIRN.TakeOver.TableKept", { name: esc(t("table.name", k.name)) })}</p>`);
  }

  const buttons = [];
  if (kind.backgrounds) {
    buttons.push({ action: "backgrounds", label: L("CAIRN.TakeOver.Result.OpenBackgrounds"), icon: "fa-solid fa-book-atlas", type: "button" });
  }
  if (tables?.folders.RollTable) {
    buttons.push({ action: "tables", label: L("CAIRN.TakeOver.Result.OpenTables"), icon: "fa-solid fa-th-list", type: "button" });
  }
  if (tables?.folders.Item) {
    buttons.push({ action: "items", label: L("CAIRN.TakeOver.Result.OpenItems"), icon: "fa-solid fa-suitcase", type: "button" });
  }
  buttons.push({ action: "close", label: L("CAIRN.Close"), type: "button", default: true, callback: () => "close" });

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: L("CAIRN.TakeOver.Result.Title"), icon: "fa-solid fa-circle-check" },
    position: { width: 480 },
    content: `<div class="cairn-take-over">${lines.join("")}</div>`,
    buttons,
    rejectClose: false,
  });
  if (picked === "tables") openDirectory("tables", tables.folders.RollTable);
  else if (picked === "items") openDirectory("items", tables.folders.Item);
  else if (picked === "backgrounds") game.packs.get(backgrounds?.pack ?? CUSTOM_BG_PACK)?.render(true);
  return picked;
};

let running = false;
/** Is a copy in flight? A probe waits on this after the confirm closes. */
export const isTakeOverRunning = () => running;

/** A kind with its click-time members resolved to plain values. */
const resolveKind = (kind) => ({
  ...kind,
  spec: typeof kind.spec === "function" ? kind.spec() : kind.spec,
  extra: typeof kind.extra === "function" ? kind.extra() : kind.extra,
});

/** Every spec a kind can copy, across its states. */
const specsOf = (kind) => (kind.specs ? kind.specs() : [resolveKind(kind).spec]);

/**
 * Which button copies a table of this NAME — and, for a pack table, from this
 * pack. The declaration that decides what a button copies is the one that
 * decides which banner its copies wear (table-banner.js), so the two cannot
 * drift: add a table to a kind and its copy explains itself. Synchronous, off
 * the pack INDEX, which core populates at boot for every pack.
 *
 * A name shipped in two packs (Scars: `tables-2e` and `utils`) takes the
 * button's kind for a WORLD table, because `kinds` are asked first and a
 * world table has no pack to disambiguate by; for a pack table the pack
 * decides, so utils' Scars is nobody's button.
 * @param {string} name
 * @param {{pack?: string|null}} [options]  restrict to tables shipped in this pack
 * @returns {{key: string, spec: object, kind: object}|null}
 */
export const kindOfTable = (name, { pack = null } = {}) => {
  for (const [key, kind] of Object.entries(KINDS)) {
    for (const spec of specsOf(kind)) {
      if (pack && spec.pack !== pack) continue;
      const index = game.packs.get(spec.pack)?.index;
      if (!index) continue;
      const shipped = spec.only ? spec.only.includes(name) : index.some((e) => e.name === name);
      if (shipped) return { key, spec, kind };
    }
  }
  return null;
};

/**
 * One button's whole job: plan, confirm, run, report.
 * @param {"spells"|"marketplace"|"barebones"|"cairn2e"} name
 * @returns {Promise<object|null>}  what ran, or null when nothing did
 */
export const openTakeOver = async (name) => {
  if (!KINDS[name] || !game.user.isGM || running) return null;
  const kind = resolveKind(KINDS[name]);

  const [tablePlan, bgPlan] = await Promise.all([
    planTableTakeOver(kind.spec),
    kind.backgrounds ? planBackgroundsTakeOver() : null,
  ]);
  if (!tablePlan.ok && !bgPlan?.ok) {
    ui.notifications.warn(game.i18n.format("CAIRN.TakeOver.PackMissing", { pack: tablePlan.pack }));
    return null;
  }

  if (!await confirmTakeOver(kind, countsFor(kind, tablePlan, bgPlan))) return null;

  const out = {};
  running = true;
  try {
    if (bgPlan?.ok) out.backgrounds = await runBackgroundsTakeOver(bgPlan);
    if (tablePlan.ok) {
      out.tables = await runTableTakeOver(tablePlan);
      // The counts the result window quotes are the PLAN's, not a re-read: the
      // run created exactly what the plan listed, and re-deriving them would be
      // a second answer to a question already settled.
      if (out.tables) {
        out.tables.counts = {
          tables: tablePlan.tables.add.length,
          items: tablePlan.items.add.length,
          actors: tablePlan.actors.add.length,
        };
        out.tables.keptCounts = {
          tables: tablePlan.tables.kept.length,
          items: tablePlan.items.kept.length,
          actors: tablePlan.actors.kept.length,
        };
      }
    }
  } catch (err) {
    console.error(`Air Bladder | ${name} take-over failed`, err);
    ui.notifications.error(L("CAIRN.TakeOver.Failed"));
    return out;
  } finally {
    running = false;
  }
  await showResult(kind, out);
  return out;
};

/* -------------------------------------------------------------------------- */
/*  The buttons                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The injected `<header>` of Warden actions above a directory's own header,
 * find-or-create, so the Actor directory's generator row and the take-over
 * buttons share one idiom. Scoped to `html`: a popped-out directory is a
 * second, independent render.
 * @param {HTMLElement} html
 * @returns {HTMLElement|null}  the `.header-actions` row, or null with no header to hang it on
 */
export const directoryActions = (html) => {
  let section = html.querySelector("header.character-generator.directory-header");
  if (!section) {
    const dirHeader = html.querySelector(".directory-header:not(.character-generator)");
    if (!dirHeader) return null;
    section = document.createElement("header");
    section.classList.add("character-generator", "directory-header");
    section.innerHTML = `<div class="header-actions action-buttons flexrow"></div>`;
    dirHeader.parentNode.insertBefore(section, dirHeader);
  }
  return section.querySelector(".header-actions");
};

/**
 * The Warden-only "Copy the …" button for one kind. Full width on a row of its
 * own (user ruling, after round one's cramped button beside the old Reseed
 * Spell Table): one button, one job, on the tab where its output lands.
 * @param {HTMLElement} html
 * @param {{kind: "spells"|"marketplace"|"barebones"|"cairn2e"}} options
 */
export const injectTakeOverButton = (html, { kind }) => {
  if (!game.user.isGM || !KINDS[kind]) return;
  if (html.querySelector(`.cairn-take-over[data-kind="${kind}"]`)) return;
  const actions = directoryActions(html);
  if (!actions) return;
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("cairn-take-over");
  button.dataset.kind = kind;
  button.innerHTML = `<i class="fa-solid fa-file-import"></i>${esc(L(KINDS[kind].button))}`;
  button.addEventListener("click", () => openTakeOver(kind));
  actions.append(button);
};

/**
 * The Faction generator — a Warden-only button that composes the SRD faction
 * tables (Setting Seeds, CC BY-SA 4.0) into a JournalEntry dossier. The first
 * JournalEntry this system mints: a faction is campaign machinery, not an
 * Actor, and a chat card would scroll away.
 *
 * Every roll resolves BY NAME, WORLD FIRST (findTableByName), so a Warden who
 * has replaced or edited any of the tables feeds the generator their own
 * content automatically — the same contract as the NPC sheet's Faction die.
 * roll(), never draw(): these are the Warden's tables and a draw would dirty
 * their drawn state (the config.js invariant).
 *
 * The dossier is baked in the SESSION'S language via t("table.result") — the
 * ratified monster-generation exception: generated world content is authored
 * in the language it was generated in (identity in an English world).
 *
 * The loop closes by hand, deliberately: when a rolled faction earns a place
 * in the campaign, the Warden adds its name as a row in their world
 * "Warden: NPC - Faction" table — and the sheet die starts dealing it to NPCs
 * and Monsters. The generator invents candidates; the Warden's table is the
 * canon. Clicking again mints another dossier; nothing is ever overwritten.
 */

import { findTableByName, resultText } from "./compendium.js";
import { t } from "./i18n-content.js";
import { promptCreation } from "./character-generator.js";

/** The suite, by shipped name. World copies of these names win by design. */
const TABLES = {
  type: "Warden: NPC - Faction",
  agent: "Warden: Faction - Agent",
  trait1: "Warden: Faction - Trait (Trait 1)",
  trait2: "Warden: Faction - Trait (Trait 2)",
  advantageCount: "Warden: Faction - Advantage (Count)",
  advantage: "Warden: Faction - Advantage",
  agenda: "Warden: Faction - Agenda",
  obstacle: "Warden: Faction - Obstacle",
};

/** One rolled cell, display-language baked; "" when the table is missing/empty. */
const rollText = async (tableName) => {
  const table = await findTableByName(tableName);
  if (!table) return "";
  const { results } = await table.roll();
  const raw = resultText(results[0]).trim();
  return raw ? t("table.result", raw) : "";
};

/**
 * The SRD Advantages procedure: the (Count) column says HOW MANY advantages
 * the faction has, then the Advantage column is rolled that many times,
 * rerolling repeats. Count is 1–4 against 20 distinct rows, so distinctness
 * always terminates; the attempt cap is a belt for a Warden's edited table
 * that repeats itself.
 * @returns {Promise<String[]>}
 */
const rollAdvantages = async () => {
  const rolled = parseInt(await rollText(TABLES.advantageCount), 10);
  const count = Math.min(4, Math.max(1, Number.isNaN(rolled) ? 1 : rolled));
  const out = new Set();
  for (let attempts = 0; attempts < 40 && out.size < count; attempts++) {
    const adv = await rollText(TABLES.advantage);
    if (!adv) break;
    out.add(adv);
  }
  return [...out];
};

/**
 * Every row of a table, in TABLE ORDER, each baked through t("table.result")
 * and deduplicated; [] when the table is missing. The Create Faction dialog's
 * lists are built from these.
 *
 * Table order rather than alphabetical, the omen picker's rule: a Warden who
 * rolled row 14 on paper knows which row it was, and a sorted list would make
 * them hunt for it. And the TRANSLATED text is the value, not the English —
 * a faction is world content in the session's language, exactly the split
 * `promptNpcFaction` already makes for the sheet's own Faction picker.
 * @returns {Promise<String[]>}
 */
const tableRows = async (tableName) => {
  const table = await findTableByName(tableName);
  if (!table) return [];
  const rows = new Set();
  for (const r of table.results) {
    const raw = String(resultText(r)).trim();
    if (raw) rows.add(t("table.result", raw));
  }
  return [...rows];
};

/** The Random option's value in every list — never a row's own text. */
const FACTION_RANDOM = "__random__";

/** The six single-value parts, in the dossier's order. */
const PARTS = ["type", "agent", "trait1", "trait2", "agenda", "obstacle"];

/** The list labels, reusing keys that already exist where they do. */
const PART_LABELS = {
  type: "CAIRN.Type",
  agent: "CAIRN.Dashboard.Factions.Agent",
  trait1: "CAIRN.Dashboard.Factions.TraitOne",
  trait2: "CAIRN.Dashboard.Factions.TraitTwo",
  agenda: "CAIRN.Dashboard.Factions.Agenda",
  obstacle: "CAIRN.Dashboard.Factions.Obstacle",
};

/**
 * Every part of a faction: whatever was picked, and a roll for the rest.
 *
 * The roll order is the dossier's order, unchanged from the days when nothing
 * was picked, so a probe planting a one-row world table still finds it in
 * the same place. A picked advantage list is taken as it stands, capped at
 * the SRD's four; an empty one rolls the whole procedure, count included.
 * @param {{type?: String, agent?: String, trait1?: String, trait2?: String,
 *          agenda?: String, obstacle?: String, advantages?: String[]}} [picks]
 * @returns {Promise<Object>}
 */
const rollFactionParts = async (picks = {}) => {
  const part = async (k) => (typeof picks[k] === "string" && picks[k]) ? picks[k] : rollText(TABLES[k]);
  const type = await part("type");
  const agent = await part("agent");
  const trait1 = await part("trait1");
  const trait2 = await part("trait2");
  const advantages = Array.isArray(picks.advantages) && picks.advantages.length
    ? picks.advantages.filter((a) => typeof a === "string" && a).slice(0, 4)
    : await rollAdvantages();
  const agenda = await part("agenda");
  const obstacle = await part("obstacle");
  return { type, agent, trait1, trait2, advantages, agenda, obstacle };
};

/**
 * Mint the dossier from its parts. Returns the JournalEntry (the caller
 * renders it), or null only when creation itself failed. A missing part
 * degrades its line to an em-dash — the journal still mints, because a
 * Warden mid-edit should get a partial dossier, not an error.
 * @returns {Promise<JournalEntry|null>}
 */
const buildFaction = async ({ type, agent, trait1, trait2, advantages, agenda, obstacle }) => {
  // "The Enigmatic Cultists" — obviously a draft name, meant to be replaced.
  // A localizable FORMAT key, because "The <trait> <type>" is English word
  // order and a translator may need to reorder.
  const name = trait1 && type
    ? game.i18n.format("CAIRN.FactionName", { trait: trait1, type })
    : game.i18n.localize("CAIRN.Faction");

  // One key per WHOLE LINE, colon and bold included, the same shape as the
  // sibling MonsterGen.Desc* keys. Assembling `${label}:` in code hands the
  // translator a noun and keeps the punctuation — French wants a narrow
  // no-break space before a colon, English does not, and neither can be
  // written from the other end.
  //
  // Lists go through Intl.ListFormat rather than a hardcoded ", ". Narrow
  // conjunction leaves the English rendering byte-identical ("A, B, C") while
  // giving every other locale its own form — es "A, B y C", ja "A、B、C". Not
  // `type: "unit"`, which is the measurement joiner and drops the separator
  // altogether in narrow English ("A B C"), as the faction probe found. Worth
  // the care because this
  // dossier is BAKED into a journal at generation time: whatever it writes is
  // permanent, and a Warden is not going to re-punctuate six lines by hand.
  //
  // NOT the CAIRN.Bio.List* keys the sheet's biography uses, deliberately.
  // Those build a sentence in running prose ("a Bony Physique, Black Hair and
  // Pale Skin"), where the conjunction is the translator's to place. This is a
  // bare enumeration after a label — separator only — and that is data the
  // platform already has for every locale, including the ones nobody has
  // translated yet.
  const list = new Intl.ListFormat(game.i18n.lang ?? "en", { style: "narrow", type: "conjunction" });
  const line = (key, value) => `<p>${game.i18n.format(key, { value: value || "&mdash;" })}</p>`;
  const content = [
    line("CAIRN.FactionDossier.Type", type),
    line("CAIRN.FactionDossier.Agent", agent),
    line("CAIRN.FactionDossier.Traits", list.format([trait1, trait2].filter(Boolean))),
    line("CAIRN.FactionDossier.Advantages", list.format(advantages)),
    line("CAIRN.FactionDossier.Agenda", agenda),
    line("CAIRN.FactionDossier.Obstacle", obstacle),
  ].join("\n");

  // GM-only visibility: factions are the Warden's machinery. Through the
  // configured document class, so a future subclass is not bypassed.
  const entry = await CONFIG.JournalEntry.documentClass.create({
    name,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    pages: [{ name, type: "text", text: { content } }],
  });
  return entry ?? null;
};

/**
 * Roll a faction — or the parts of one nobody picked — and mint its dossier.
 *
 * NON-INTERACTIVE, and that is load-bearing (the review #26 lesson at
 * `createActorInteractive`): a probe or a macro calls this and gets a
 * journal, with no dialog anywhere. The zero-argument call is what it always
 * was; `picks` is what the Create Faction dialog hands over when the Warden
 * cleared "Use random generation." and chose from the lists.
 * @param {Object} [picks]  see `rollFactionParts`
 * @returns {Promise<JournalEntry|null>}
 */
export const generateFaction = async (picks = {}) => buildFaction(await rollFactionParts(picks));

/**
 * The picking surface: six lists, one per part, each led by Random, and a
 * tick-list of the Advantage table capped at the SRD's four. Built with the
 * DOM API so a Warden's own table row can never be markup, and with
 * ATTRIBUTES wherever the state must survive DialogV2's innerHTML round trip
 * (`promptCreation`'s docblock): `selected` on Random, `value` on each box.
 * @returns {Promise<{element: HTMLElement, read: Function, wire: Function}>}
 */
const buildFactionPicks = async () => {
  const rows = {};
  for (const k of PARTS) rows[k] = await tableRows(TABLES[k]);
  const advantageRows = await tableRows(TABLES.advantage);

  const element = document.createElement("div");
  element.className = "ab-faction-picks";
  for (const k of PARTS) {
    const group = document.createElement("div");
    group.className = "form-group";
    const label = document.createElement("label");
    label.textContent = game.i18n.localize(PART_LABELS[k]);
    const fields = document.createElement("div");
    fields.className = "form-fields";
    const select = document.createElement("select");
    select.name = `faction-${k}`;
    const random = document.createElement("option");
    random.value = FACTION_RANDOM;
    random.textContent = game.i18n.localize("CAIRN.RandomBackground");
    random.setAttribute("selected", "");
    select.append(random);
    for (const row of rows[k]) {
      const option = document.createElement("option");
      option.value = row; // an option's value IS its attribute; an input's is not
      option.textContent = row;
      select.append(option);
    }
    fields.append(select);
    group.append(label, fields);
    element.append(group);
  }

  const advantages = document.createElement("div");
  advantages.className = "form-group stacked ab-faction-advantages";
  const heading = document.createElement("label");
  heading.textContent = game.i18n.localize("CAIRN.FactionPick.Advantages");
  const list = document.createElement("div");
  list.className = "bg-pick-list";
  for (const row of advantageRows) {
    const item = document.createElement("label");
    item.className = "bg-pick-row";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.name = "faction-advantage";
    box.setAttribute("value", row);
    const text = document.createElement("span");
    text.className = "bg-pick-name";
    text.textContent = row;
    item.append(box, text);
    list.append(item);
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = game.i18n.localize("CAIRN.FactionPick.AdvantagesHint");
  advantages.append(heading, list, hint);
  element.append(advantages);

  return {
    element,
    /** A partial picks object: a list left at Random is simply absent. */
    read: (form) => {
      const picks = {};
      for (const k of PARTS) {
        const v = form.elements[`faction-${k}`]?.value;
        if (v && v !== FACTION_RANDOM) picks[k] = v;
      }
      const ticked = [...form.querySelectorAll('input[name="faction-advantage"]:checked')].map((b) => b.value);
      if (ticked.length) picks.advantages = ticked.slice(0, 4);
      return picks;
    },
    /** The cap: while four are ticked, every clear box is disabled. */
    wire: (dialog) => {
      const boxes = [...dialog.element.querySelectorAll('input[name="faction-advantage"]')];
      const cap = () => {
        const full = boxes.filter((b) => b.checked).length >= 4;
        for (const b of boxes) if (!b.checked) b.disabled = full;
      };
      for (const b of boxes) b.addEventListener("change", cap);
      cap();
    },
  };
};

/**
 * The Create Faction dialog: the same "Use random generation." box every
 * creation route opens with, and — because a faction has no sheet and so no
 * pickers of its own — the lists appear in the dialog itself when the box is
 * cleared. Resolves null when declined, `{}` when the box was left ticked
 * (roll everything), or the Warden's picks.
 * @returns {Promise<Object|null>}
 */
export const promptFactionCreation = async () => {
  const manual = await buildFactionPicks();
  const answer = await promptCreation("faction", {
    title: "CAIRN.Blank.TitleFaction",
    hint: "CAIRN.Blank.HintFaction",
    manual,
  });
  if (!answer) return null;
  return answer.blank ? (answer.manual ?? {}) : {};
};

/**
 * The route both creation buttons take — the Actors sidebar's and the
 * Warden's Dashboard's: ask, then mint. The generator underneath stays
 * non-interactive; this wrapper is the only place the dialog lives, so a
 * third call site cannot drift the way the Dashboard's once did (review #26).
 * @returns {Promise<JournalEntry|null>} null = declined, nothing created
 */
export const createFactionInteractive = async () => {
  const picks = await promptFactionCreation();
  if (!picks) return null;
  return generateFaction(picks);
};

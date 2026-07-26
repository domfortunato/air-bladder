import { resolveGearItem } from "../gear.js";
import { t } from "../i18n-content.js";

/** A custom 2e background always has exactly two d6 question tables, six options
 *  each — a fixed form, not an open-ended builder (see docs/custom-backgrounds-plan.md
 *  §6 Fork B). The generator's `applyChoiceTables` rolls `1d<options.length>`, so
 *  six options == a d6. */
const TABLE_COUNT = 2;
const OPTIONS_PER_TABLE = 6;

/**
 * Derive the display tags (Armor / Damage / bulky / petty / uses) for a gear row
 * from an item's system data. Works for both a resolved pack document and a
 * snapshot's frozen system copy, so an authored one-off reads the same way a
 * shipped item does.
 */
const gearTags = (s = {}, usesOverride) => {
  const tags = [];
  if (s.armor) tags.push(`${s.armor} ${game.i18n.localize("CAIRN.Armor")}`);
  if (s.damageFormula) tags.push(`${s.damageFormula} ${game.i18n.localize("CAIRN.Damage")}`);
  if (s.bulky) tags.push(game.i18n.localize("CAIRN.Bulky"));
  if (s.weightless) tags.push(game.i18n.localize("CAIRN.Weightless"));
  const uses = usesOverride ?? s.uses?.max ?? 0;
  if (uses) tags.push(game.i18n.format("CAIRN.NUses", { n: uses }));
  return tags;
};

/**
 * A frozen, portable copy of a dropped item — enough to rebuild an owned item at
 * generation, nothing document-specific (no _id / ownership / effects). This is
 * the "snapshot on drop" that makes a custom background self-contained and
 * shareable (docs/custom-backgrounds-plan.md §6 Fork A).
 */
const snapshotItem = (item) => {
  const o = item.toObject();
  return { name: o.name, type: o.type, img: o.img, system: o.system };
};

/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheet}
 */
export class CairnItemSheet extends ItemSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['cairn', 'sheet', 'item'],
      width: 480,
      height: 480,
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: ".content",
          initial: "description",
        },
      ],
      // Accept item drops anywhere on the sheet — used by the background authoring
      // form to snapshot a dragged Item onto starting gear or a table option. Inert
      // for every other item type (its _onDrop returns early).
      dragDrop: [{ dragSelector: null, dropSelector: null }],
    })
  }

  constructor(...args) {
    super(...args);
    // The background authoring form is a tall, multi-section editor; give it room.
    if (this.item?.type === "background") this.options.height = 640;
  }

  /** @override */
  get template() {
    const path = 'systems/air-bladder/templates/item'
    return `${path}/${this.item.type}-sheet.html`
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    const data = await super.getData();
    // Content localization for READ-ONLY (locked pack) entries only. An editable
    // sheet — an owned item, or an unlocked pack a Warden is editing — keeps the
    // canonical English so a save never writes a translated string back onto the
    // document. The name is left to the compendium list; here we localize the
    // description (a display-only derived field, never the stored value).
    const localize = !this.isEditable;
    const descNs = this.item.type === "background" ? "bg.desc" : "item.desc";
    const descSrc = localize ? t(descNs, data.item.system.description) : data.item.system.description;
    data.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(descSrc, { async: true });
    data.enrichedCriticalDamage = await foundry.applications.ux.TextEditor.implementation.enrichHTML(data.item.system.criticalDamage, { async: true });
    // Transport kind pick-list (worn / mount / vehicle) for the transport sheet's
    // <select>; keys are stored, values are localized by selectOptions.
    if (this.item.type === "transport") {
      data.transportKinds = {
        worn: "CAIRN.TransportWorn",
        mount: "CAIRN.TransportMount",
        vehicle: "CAIRN.TransportVehicle",
      };
    }
    if (this.item.type === "background") {
      if (this.isEditable) await this._prepareBackgroundEditor(data);
      else await this._prepareBackgroundReadOnly(data, localize);
    }
    return data;
  }

  /**
   * Read-only background view (locked shipped packs): resolve each gear name to
   * its pool document and derive the display tags, so the sheet reads "Chainmail
   * (2 Armor, bulky)" rather than a bare list. A snapshot row derives its tags
   * from the frozen copy it carries. Unresolvable names still list, tagless.
   * @private
   */
  async _prepareBackgroundReadOnly(data, localize) {
    data.startingGearRows = await Promise.all(
      (this.item.system.startingGear ?? []).map(async (g) => {
        if (g.itemData) {
          return { name: localize ? t("item.name", g.name) : g.name, tags: gearTags(g.itemData.system, g.uses) };
        }
        const doc = await resolveGearItem(g.name, { uses: g.uses });
        const tags = doc ? gearTags(doc.system, g.uses) : [];
        return { name: localize ? t("item.name", g.name) : g.name, tags };
      })
    );
  }

  /**
   * Editable authoring form: pick-lists, the current names, gear rows (with
   * resolved/derived tags and a snapshot marker), and the two d6 tables padded to
   * the fixed 2×6 shape for display. Nothing here is persisted — the padded shape
   * only reaches the document when the GM edits a field (handlers write a
   * normalized array via _normalizedTables).
   * @private
   */
  async _prepareBackgroundEditor(data) {
    data.isBackgroundEditor = true;
    data.archetypeChoices = { Wizard: "Wizard", Fighter: "Fighter", Thief: "Thief" };
    data.sourceChoices = { "2e": "Cairn 2e", barebones: "Barebones", "srd-2e": "SRD 2e" };
    data.editNames = [...(this.item.system.names ?? [])];
    data.editGear = await Promise.all(
      (this.item.system.startingGear ?? []).map(async (g) => {
        if (g.itemData) {
          return { name: g.name, uses: g.uses ?? "", isSnapshot: true, tags: gearTags(g.itemData.system, g.uses) };
        }
        const doc = await resolveGearItem(g.name, { uses: g.uses });
        return { name: g.name, uses: g.uses ?? "", isSnapshot: false, tags: doc ? gearTags(doc.system, g.uses) : [], missing: !doc && !!g.name };
      })
    );
    const tables = this.item.system.tables ?? [];
    data.editTables = Array.from({ length: TABLE_COUNT }, (_, ti) => {
      const st = tables[ti] ?? {};
      return {
        question: st.question ?? "",
        options: Array.from({ length: OPTIONS_PER_TABLE }, (_, oi) => {
          const so = st.options?.[oi] ?? {};
          return {
            description: so.description ?? "",
            bonusGold: so.bonusGold ?? 0,
            items: (so.items ?? []).map((it) => ({ name: it.name, isSnapshot: !!it.itemData })),
          };
        }),
      };
    });
  }

  /**
   * A deep clone of the background's tables padded to the fixed 2×6 shape,
   * preserving each option's real items (with their itemData snapshots) and
   * containers. Handlers mutate this and write it back, so editing one field on a
   * blank background materializes the full structure without dropping any data.
   * @private
   */
  _normalizedTables() {
    const src = foundry.utils.deepClone(this.item.system.tables ?? []);
    return Array.from({ length: TABLE_COUNT }, (_, ti) => {
      const st = src[ti] ?? {};
      return {
        question: st.question ?? "",
        options: Array.from({ length: OPTIONS_PER_TABLE }, (_, oi) => {
          const so = st.options?.[oi] ?? {};
          return {
            description: so.description ?? "",
            bonusGold: so.bonusGold ?? 0,
            items: so.items ?? [],
            containers: so.containers ?? [],
          };
        }),
      };
    });
  }

  /* -------------------------------------------- */

  /** @override */
  setPosition(options = {}) {
    const position = super.setPosition(options)
    const sheetBody = this.element.find('.sheet-body')
    const bodyHeight = position.height - 192
    sheetBody.css('height', bodyHeight)
    return position
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;

    // If it's bulky it cannot be weightless too
    html.find("[name='system.bulky']").change((e) => {
      if (e.target.checked) {
        if (html.find("[name='system.weightless']").length > 0) {
          html.find("[name='system.weightless']")[0].checked = false;
        }
      }
    });
    html.find("[name='system.weightless']").change((e) => {
      if (e.target.checked) {
        if (html.find("[name='system.bulky']").length > 0) {
          html.find("[name='system.bulky']")[0].checked = false;
        }
      }
    });

    if (this.item.type === "background") this._activateBackgroundListeners(html);
  }

  /**
   * Wire the authoring form. Names, gear and table fields are class-managed (no
   * form `name=`), so they never round-trip through Foundry's form serialization
   * — each edit surgically updates one array element and preserves the snapshots
   * the DOM can't carry. Archetype/source are native `name=` selects (Foundry
   * saves those).
   * @private
   */
  _activateBackgroundListeners(html) {
    const item = this.item;

    // --- Example names ---------------------------------------------------------
    html.find(".bg-name-add").click(() => {
      item.update({ "system.names": [...(item.system.names ?? []), ""] });
    });
    html.find(".bg-name-remove").click((ev) => {
      const names = [...(item.system.names ?? [])];
      names.splice(Number(ev.currentTarget.dataset.i), 1);
      item.update({ "system.names": names });
    });
    html.find(".bg-name-input").change((ev) => {
      const names = [...(item.system.names ?? [])];
      names[Number(ev.currentTarget.dataset.i)] = ev.currentTarget.value;
      item.update({ "system.names": names });
    });

    // --- Starting gear ---------------------------------------------------------
    html.find(".bg-gear-add").click(() => {
      item.update({ "system.startingGear": [...(item.system.startingGear ?? []), { name: "" }] });
    });
    html.find(".bg-gear-remove").click((ev) => {
      const gear = foundry.utils.deepClone(item.system.startingGear ?? []);
      gear.splice(Number(ev.currentTarget.dataset.i), 1);
      item.update({ "system.startingGear": gear });
    });
    html.find(".bg-gear-name").change((ev) => {
      const gear = foundry.utils.deepClone(item.system.startingGear ?? []);
      const i = Number(ev.currentTarget.dataset.i);
      gear[i].name = ev.currentTarget.value;
      // Typing a name over a snapshot converts the row back to a by-name pointer.
      delete gear[i].itemData;
      item.update({ "system.startingGear": gear });
    });
    html.find(".bg-gear-uses").change((ev) => {
      const gear = foundry.utils.deepClone(item.system.startingGear ?? []);
      const i = Number(ev.currentTarget.dataset.i);
      const v = parseInt(ev.currentTarget.value, 10);
      if (Number.isNaN(v) || v <= 0) delete gear[i].uses;
      else gear[i].uses = v;
      item.update({ "system.startingGear": gear });
    });

    // --- The two d6 tables -----------------------------------------------------
    html.find(".bg-table-question").change((ev) => {
      const tables = this._normalizedTables();
      tables[Number(ev.currentTarget.dataset.t)].question = ev.currentTarget.value;
      item.update({ "system.tables": tables });
    });
    html.find(".bg-option-desc").change((ev) => {
      const tables = this._normalizedTables();
      tables[Number(ev.currentTarget.dataset.t)].options[Number(ev.currentTarget.dataset.o)].description = ev.currentTarget.value;
      item.update({ "system.tables": tables });
    });
    html.find(".bg-option-gold").change((ev) => {
      const tables = this._normalizedTables();
      const v = parseInt(ev.currentTarget.value, 10);
      tables[Number(ev.currentTarget.dataset.t)].options[Number(ev.currentTarget.dataset.o)].bonusGold = Number.isNaN(v) ? 0 : Math.max(0, v);
      item.update({ "system.tables": tables });
    });
    html.find(".bg-option-item-remove").click((ev) => {
      const { t, o, i } = ev.currentTarget.dataset;
      const tables = this._normalizedTables();
      tables[Number(t)].options[Number(o)].items.splice(Number(i), 1);
      item.update({ "system.tables": tables });
    });
  }

  /* -------------------------------------------- */

  /**
   * Snapshot a dragged Item onto the authoring form. The drop zone under the
   * cursor decides where it lands: a table option (`data-drop="option"`) or, by
   * default, starting gear. Only backgrounds react; every other item sheet ignores
   * the drop.
   * @override
   */
  async _onDrop(event) {
    if (this.item.type !== "background" || !this.isEditable) return;
    let data;
    try {
      data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    } catch (_e) {
      return;
    }
    if (data?.type !== "Item") return;
    const dropped = await Item.implementation.fromDropData(data);
    if (!dropped) return;
    if (dropped.type === "background") {
      ui.notifications.warn(game.i18n.localize("CAIRN.BgAuthor.NoBackgroundDrop"));
      return;
    }
    const snap = snapshotItem(dropped);
    const zone = event.target.closest("[data-drop]");
    if (zone?.dataset.drop === "option") {
      const tables = this._normalizedTables();
      tables[Number(zone.dataset.t)].options[Number(zone.dataset.o)].items.push({ name: snap.name, itemData: snap });
      await this.item.update({ "system.tables": tables });
    } else {
      const gear = foundry.utils.deepClone(this.item.system.startingGear ?? []);
      gear.push({ name: snap.name, itemData: snap });
      await this.item.update({ "system.startingGear": gear });
    }
  }
}

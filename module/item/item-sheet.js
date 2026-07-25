import { resolveGearItem } from "../gear.js";
import { t } from "../i18n-content.js";

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
    })
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
    // A background's starting gear is stored as bare NAMES into the editable
    // pool (the pool item owns bulky/petty/armor/damage, not the background), so
    // the tags a reader wants to see are not on this document. Resolve each one
    // and derive them, so the sheet reads "Chainmail (2 Armor, bulky)" rather
    // than a bare list. Unresolvable names still list, just without tags.
    if (this.item.type === "background") {
      data.startingGearRows = await Promise.all(
        (this.item.system.startingGear ?? []).map(async (g) => {
          const doc = await resolveGearItem(g.name, { uses: g.uses });
          const s = doc?.system ?? {};
          const tags = [];
          if (s.armor) tags.push(`${s.armor} ${game.i18n.localize("CAIRN.Armor")}`);
          if (s.damageFormula) tags.push(`${s.damageFormula} ${game.i18n.localize("CAIRN.Damage")}`);
          if (s.bulky) tags.push(game.i18n.localize("CAIRN.Bulky"));
          if (s.weightless) tags.push(game.i18n.localize("CAIRN.Weightless"));
          const uses = g.uses ?? s.uses?.max ?? 0;
          if (uses) tags.push(game.i18n.format("CAIRN.NUses", { n: uses }));
          return { name: localize ? t("item.name", g.name) : g.name, tags };
        })
      );
    }
    return data;
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
  }
}

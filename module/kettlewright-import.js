import { resolveGearItem, buildGearItem } from "./gear.js";
import { getBackgroundsFor, withGrantSource } from "./character-generator.js";
import { CairnActor } from "./actor/actor.js";

/**
 * One-way importer: a Kettlewright (kettlewright.com) character export JSON ->
 * a new Air Bladder `character` Actor. GM-only. Best-effort and lossy by design:
 * items and the background are matched by name where possible and otherwise built
 * from their raw text/tags, so nothing is lost — it just arrives less structured.
 *
 * Kettlewright's `Character.toJSON()` emits a flat object (abilities as
 * strength/dexterity/willpower with paired _max, hp/hp_max, gold, deprived,
 * panicked, armor, a `background` NAME string, free-text description/traits/notes/
 * bonds/scars/omens, image_url, a flat `items[]` and a `containers[]`). There is no
 * import route in Kettlewright, so one-way is the only direction that ever existed.
 *
 * Deliberately does NOT route through character-generator's characterToActorData:
 * that helper force-resets omen/scars/critical, which would wipe the very fields we
 * are importing. We build the create payload directly here, using the same paths.
 */

/** Escape text for HTML built by hand (the summary dialog). */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** A finite Number, or the fallback. */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Kettlewright hosts portraits at an absolute URL; only those can travel across apps. */
const isAbsoluteUrl = (s) => /^https?:\/\//i.test(String(s ?? ""));

/** A single free-text scars blob -> multiple entries (Air Bladder scars is an array). */
const splitScars = (s) => String(s ?? "").split(/[\n;]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Map one Kettlewright item record to an owned-item payload, tracking how it
 * resolved for the summary. A name that matches the canonical packs keeps the
 * pack item's art/description (with Kettlewright's charge state overlaid); a miss
 * falls back to buildGearItem, which infers weapon/armor/petty/bulky/uses from the
 * item's tags — the "shove it in" path, so unmatched items still arrive.
 * @returns {{ item: Object, how: "matched"|"fallback" }}
 */
const importItem = async (kw) => {
  const matched = await resolveGearItem(kw.name);
  if (matched) {
    if (kw.max_charges != null || kw.charges != null || kw.uses != null) {
      const max = kw.max_charges ?? kw.uses ?? matched.system.uses?.max ?? 0;
      const value = kw.charges ?? kw.uses ?? matched.system.uses?.value ?? max;
      matched.system.uses = { value, max };
    }
    return { item: withGrantSource(matched, "imported"), how: "matched" };
  }
  const built = buildGearItem({
    name: kw.name,
    tags: kw.tags ?? [],
    // Kettlewright starting gear uses "-" as a placeholder description; drop it.
    description: kw.description && kw.description !== "-" ? kw.description : "",
    uses: kw.uses,
    charges: kw.charges,
    maxCharges: kw.max_charges,
  });
  return { item: withGrantSource(built, "imported"), how: "fallback" };
};

/**
 * Pure mapping: a parsed Kettlewright character object -> a Foundry Actor create
 * payload plus a `report` of what matched / fell back (for the summary dialog).
 * Async because item and background resolution read compendium packs.
 * @param {Object} json  a parsed Kettlewright character export
 * @returns {Promise<{ data: Object, report: Object }>}
 */
export const kettlewrightToActorData = async (json) => {
  const report = { name: json?.name ?? "", matched: [], fallback: [], fatigue: 0, skipped: [], background: null, containers: [] };

  // --- Background: match by name, else keep the raw string ------------------
  const bgName = json.custom_background || json.background || "";
  let background = bgName;
  let backgroundUuid = "";
  if (bgName) {
    const pool = await getBackgroundsFor("2e");
    const hit = pool.find((b) => b.name.toLowerCase() === bgName.toLowerCase());
    if (hit) {
      background = hit.name;
      backgroundUuid = hit.uuid;
      report.background = { name: hit.name, matched: true };
    } else {
      report.background = { name: bgName, matched: false };
    }
  }

  // --- Items: flatten every container's contents onto the character ---------
  const FATIGUE = game.i18n.localize("CAIRN.Fatigue");
  const items = [];
  for (const kw of json.items ?? []) {
    // "Carrying X" markers are Kettlewright's container-load bookkeeping; with
    // containers flattened they mean nothing here.
    if (kw?.carrying != null || /^carrying\b/i.test(kw?.name ?? "")) {
      report.skipped.push(kw?.name ?? "");
      continue;
    }
    if (!kw?.name) continue;
    // Fatigue is a real 1-slot inventory item in Air Bladder too; recreate it
    // under the localized name so the sheet's fatigue handling recognizes it.
    if (kw.name === "Fatigue") {
      items.push(withGrantSource(buildGearItem({ name: FATIGUE, tags: [] }), "imported"));
      report.fatigue++;
      continue;
    }
    const { item, how } = await importItem(kw);
    items.push(item);
    report[how].push(kw.name);
  }

  // --- Containers: flattened (dropped), recorded for the summary ------------
  for (const c of json.containers ?? []) {
    if (num(c?.id) === 0) continue; // id 0 is the "Main" body inventory, not a bag
    if (c?.name) report.containers.push(c.name);
  }

  // --- Free-text best-fit ----------------------------------------------------
  const scars = splitScars(json.scars);
  const bondsText = String(json.bonds ?? "").trim();
  const bonds = bondsText ? [{ id: foundry.utils.randomID(), description: bondsText, gold: 0 }] : [];
  const omens = String(json.omens ?? "");
  let notes = String(json.notes ?? "");
  const traits = String(json.traits ?? "").trim();
  if (traits) {
    // Air Bladder traits is eight typed slots — a single Kettlewright blob has no
    // structured home, so it lands in Notes under a label.
    const label = game.i18n.localize("CAIRN.KWImport.TraitsLabel");
    notes = (notes ? `${notes}\n\n` : "") + `${label} ${traits}`;
  }

  // Armor is a string column in Kettlewright; a numeric value forces Air Bladder's
  // armorOverride so the sheet shows it without re-equipping imported armor.
  const armorN = parseInt(json.armor, 10);
  const armorOverride = Number.isFinite(armorN) && armorN > 0 ? armorN : null;

  const name = json.name || game.i18n.localize("CAIRN.KWImport.DefaultName");
  const data = {
    name,
    system: {
      abilities: {
        STR: { value: num(json.strength, 10), max: num(json.strength_max, num(json.strength, 10)) },
        DEX: { value: num(json.dexterity, 10), max: num(json.dexterity_max, num(json.dexterity, 10)) },
        WIL: { value: num(json.willpower, 10), max: num(json.willpower_max, num(json.willpower, 10)) },
      },
      hp: { value: num(json.hp, 0), max: num(json.hp_max, num(json.hp, 0)) },
      gold: num(json.gold, 0),
      deprived: !!json.deprived,
      panicked: !!json.panicked,
      armorOverride,
      background,
      backgroundUuid,
      contentSource: "2e",
      description: String(json.description ?? ""),
      notes,
      bonds,
      scarEnabled: scars.length > 0,
      scars,
      omenEnabled: !!omens.trim(),
      omen: omens,
    },
    items,
    prototypeToken: {
      name,
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      actorLink: true,
      vision: true,
    },
    type: "character",
  };
  // Only a directly-usable absolute URL can travel across apps; otherwise leave
  // Foundry's default portrait (never a random one — that would misrepresent the import).
  if (json.custom_image && isAbsoluteUrl(json.image_url)) data.img = json.image_url;

  return { data, report };
};

/**
 * Prompt for a local .json file and return its text (or null if none was read).
 * No FilePicker: that browses server-side data paths, not the user's machine — so
 * this uses a transient <input type=file> + FileReader, the standard browser path
 * (there is no prior in-repo precedent for reading a user file).
 * @returns {Promise<string|null>}
 */
const pickJsonFileText = () =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.onload = () => finish(String(reader.result ?? ""));
      reader.onerror = () => finish(null);
      reader.readAsText(file);
    });
    input.click();
    // If the OS picker is cancelled there is no reliable event; the promise simply
    // stays pending (no actor is created, the hidden input is already detached on
    // any later resolve). Harmless for a one-shot GM action.
  });

/**
 * Show a post-import review: what matched by name vs. was built from tags, the
 * fatigue count, whether the background matched or was kept as text, and which
 * containers were flattened away — so the GM can fix up the sheet knowingly.
 * @param {CairnActor} actor @param {Object} report
 */
const showImportSummary = (actor, report) => {
  const L = (k) => game.i18n.localize(k);
  const F = (k, d) => game.i18n.format(k, d);
  const parts = [];

  if (report.background) {
    parts.push(
      report.background.matched
        ? `<p class="kwi-ok"><i class="fas fa-check"></i> ${F("CAIRN.KWImport.BgMatched", { name: esc(report.background.name) })}</p>`
        : `<p class="kwi-warn"><i class="fas fa-circle-exclamation"></i> ${F("CAIRN.KWImport.BgUnmatched", { name: esc(report.background.name) })}</p>`
    );
  }

  parts.push(`<p>${F("CAIRN.KWImport.ItemCounts", { matched: report.matched.length, fallback: report.fallback.length, fatigue: report.fatigue })}</p>`);

  if (report.fallback.length) {
    parts.push(`<p class="kwi-warn">${L("CAIRN.KWImport.FallbackList")}</p><ul>${report.fallback.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
  }
  if (report.containers.length) {
    parts.push(`<p>${L("CAIRN.KWImport.ContainersFlattened")}</p><ul>${report.containers.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
  }

  new foundry.applications.api.DialogV2({
    window: { title: F("CAIRN.KWImport.SummaryTitle", { name: esc(actor.name) }), icon: "fas fa-file-import" },
    position: { width: 460 },
    content: `<div class="kwi-summary">${parts.join("")}</div>`,
    buttons: [{ action: "ok", label: L("CAIRN.Close"), default: true }],
  }).render(true);
};

/**
 * GM flow: pick a Kettlewright export, parse it, create a new character Actor from
 * it, and show a review summary. Returns the created Actor (or null).
 * @returns {Promise<CairnActor|null>}
 */
export const importKettlewrightCharacter = async () => {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("CAIRN.KWImport.GmOnly"));
    return null;
  }
  const text = await pickJsonFileText();
  if (text == null) return null;
  let json;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    ui.notifications.error(game.i18n.localize("CAIRN.KWImport.BadJson"));
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    ui.notifications.error(game.i18n.localize("CAIRN.KWImport.BadShape"));
    return null;
  }
  const { data, report } = await kettlewrightToActorData(json);
  const actor = await CairnActor.create(data);
  if (actor) showImportSummary(actor, report);
  return actor;
};

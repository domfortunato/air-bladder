import { resolveGearItem, buildGearItem } from "./gear.js";
import { getBackgroundsFor, withGrantSource, FLAG_SCOPE } from "./character-generator.js";
import { CairnActor } from "./actor/actor.js";
import { Cairn } from "./config.js";

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

/* -------------------------------------------------------------------------- */
/*  Grant provenance: which source produced which imported item                 */
/* -------------------------------------------------------------------------- */

/** Loose text identity: whitespace collapsed, quotes straightened, case ignored. */
const norm = (s) => String(s ?? "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Re-tag imported items with the grant source that actually produced them.
 *
 * Every imported item starts tagged `imported`, which no re-roll targets — so
 * re-rolling a bond or a background question ADDED the new option's items while
 * the originals stayed forever, and the sheet grew a duplicate every time. The
 * inventory could only ever accumulate.
 *
 * We can do better than that, because a Kettlewright answer is the option's own
 * description, verbatim: once the answer is matched back to its option we know
 * exactly which items that option grants, and can hand the matching imported
 * items over to `question:<i>` / `bond:<id>` so a re-roll replaces them properly.
 *
 * Matching is by name, first unclaimed item wins — the same best-effort standard
 * the rest of the importer works to, since Kettlewright's item list carries no
 * provenance of its own. An item that can't be matched keeps `imported` and is
 * simply never auto-removed, which is the safe direction to fail in: a stray
 * duplicate is recoverable by hand, a silently deleted item is not.
 *
 * @param {Object[]} items    the built item payloads, mutated in place
 * @param {Object[]} granted  [{name}] the source is known to grant
 * @param {String} source     the grantSource tag to apply
 * @returns {Number} how many items were re-tagged
 */
const retagGranted = (items, granted, source) => {
  let n = 0;
  for (const g of granted ?? []) {
    const want = norm(g?.name);
    if (!want) continue;
    const hit = items.find(
      (it) => norm(it.name) === want && it.flags?.[FLAG_SCOPE]?.grantSource === "imported",
    );
    if (!hit) continue;
    hit.flags[FLAG_SCOPE].grantSource = source;
    n++;
  }
  return n;
};

/**
 * Find the Bonds-table entry a Kettlewright bond came from, by matching its text.
 * Returns the entry's mechanical payload — the items it grants — or null.
 * Read-only: never roll()s or draw()s, so the table's state is untouched.
 * @param {String} text
 * @returns {Promise<{items: Object[], gold: Number}|null>}
 */
const findBondEntry = async (text) => {
  const want = norm(text);
  if (!want) return null;
  const pack = game.packs.get("air-bladder.tables-2e");
  const table = pack ? (await pack.getDocuments()).find((t) => t.name === "Bonds") : null;
  const hit = table?.results?.find((r) => norm(r.text) === want);
  if (!hit) return null;
  return { items: hit.getFlag(FLAG_SCOPE, "items") ?? [], gold: hit.getFlag(FLAG_SCOPE, "gold") ?? 0 };
};

/* -------------------------------------------------------------------------- */
/*  Background questions: a notes blob -> structured question/answer pairs      */
/* -------------------------------------------------------------------------- */

/**
 * Kettlewright writes the two background questions and the player's answers into
 * the free-text `notes` field, as the question line followed by the answer:
 *
 *   How was your fraud exposed?
 *   You were cursed by a hedgewitch for fooling some innocent village folk. …
 *
 *   What keepsake could always identify you?
 *   Surgeon's Soap: A lye and ash block that makes skin temporarily transparent. …
 *
 * Once the background has matched, we know exactly what those questions are — they
 * are `system.tables[].question` on the background Item — so the blob can be split
 * back into `system.questions`, which is what the sheet renders and re-rolls,
 * instead of sitting in Notes as undifferentiated prose.
 *
 * Matching is whitespace-tolerant and case-insensitive but otherwise exact: a
 * question either is the background's question or it isn't. Anything not claimed
 * by a question stays in Notes, so a player's own writing is never eaten.
 *
 * @param {String} notes
 * @param {String[]} questions  the background's prompts, in table order
 * @returns {{ answers: String[], leftover: String, found: Number }}
 *          answers is index-aligned with `questions` ("" where not found).
 */
export const parseQuestionAnswers = (notes, questions) => {
  const text = String(notes ?? "");
  const answers = questions.map(() => "");
  if (!text.trim() || !questions.length) return { answers, leftover: text, found: 0 };

  // Locate each question in the blob. Escape it, then let any run of whitespace
  // match any other, so a rewrap or a stray double space doesn't lose the match.
  const hits = [];
  questions.forEach((q, i) => {
    if (!q) return;
    const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const m = text.match(new RegExp(pattern, "i"));
    if (m?.index != null) hits.push({ i, start: m.index, end: m.index + m[0].length });
  });
  if (!hits.length) return { answers, leftover: text, found: 0 };

  // Answers run from the end of one question to the start of the next, in the
  // order they APPEAR — which needn't be the background's table order.
  hits.sort((a, b) => a.start - b.start);
  hits.forEach((h, n) => {
    const stop = n + 1 < hits.length ? hits[n + 1].start : text.length;
    answers[h.i] = text.slice(h.end, stop).trim();
  });

  // Whatever precedes the first question is the player's own note; keep it.
  return { answers, leftover: text.slice(0, hits[0].start).trim(), found: hits.length };
};

/* -------------------------------------------------------------------------- */
/*  Traits: one English sentence -> eight typed slots + age                     */
/* -------------------------------------------------------------------------- */

/**
 * Kettlewright stores the eight 2e traits and the character's age as a single
 * English sentence, built from the same 2e tables Air Bladder ships — and, as it
 * happens, in almost exactly the phrasing our own sheet emits (`CAIRN.Bio.*`):
 *
 *   "You have a Stout Physique, Birthmarked Skin, and Long Hair. Your Face is
 *    Pale, your Speech Precise. You have Rancid Clothing. You are Honorable and
 *    Craven. You are 36 years old."
 *
 * So it parses back into `system.traits.*` and `system.age` instead of landing in
 * Notes as prose, which is what it used to do — the reason an imported character
 * arrived with empty trait dropdowns and no age.
 *
 * Anchored on the capitalised CATEGORY words, not on sentence shape, so a missing
 * trait, a dropped Oxford comma, or extra whitespace doesn't derail the rest. Every
 * shipped trait value is a single word, which is what makes the anchors sufficient.
 * @param {String} text
 * @returns {{ traits: Object, age: String, pair: String[] }}  pair = the raw
 *          "You are X and Y" words, which need the tables to tell virtue from vice.
 */
export const parseTraitSentence = (text) => {
  const s = String(text ?? "");
  const traits = {};
  const grab = (re, key) => {
    const m = s.match(re);
    if (m?.[1]) traits[key] = m[1];
  };

  // "<value> Physique" / "<value> Skin" / … — the word immediately before the label.
  grab(/\b([A-Za-z][A-Za-z'-]*)\s+Physique\b/i, "physique");
  grab(/\b([A-Za-z][A-Za-z'-]*)\s+Skin\b/i, "skin");
  grab(/\b([A-Za-z][A-Za-z'-]*)\s+Hair\b/i, "hair");
  grab(/\b([A-Za-z][A-Za-z'-]*)\s+Clothing\b/i, "clothing");
  // "your Face is <value>" / "your Speech <value>" — here the label comes first.
  grab(/\bFace\s+is\s+([A-Za-z][A-Za-z'-]*)/i, "face");
  grab(/\bSpeech\s+(?:is\s+)?([A-Za-z][A-Za-z'-]*)/i, "speech");

  // "You are 36 years old." Digits only, so it can never collide with the
  // virtue/vice clause below, which requires two words.
  const age = s.match(/\b(\d{1,3})\s+years?\s+old\b/i)?.[1] ?? "";

  // "You are Honorable and Craven." Both captures are words, so the age clause
  // cannot match here either. Which is which is decided by the tables, not by
  // position — see resolveVirtueVice.
  const m = s.match(/\bYou\s+are\s+([A-Za-z][A-Za-z'-]*)\s+and\s+([A-Za-z][A-Za-z'-]*)/i);
  const pair = m ? [m[1], m[2]] : [];

  return { traits, age, pair };
};

/**
 * Decide which of the two words is the virtue and which the vice by looking them
 * up in the shipped tables.
 *
 * Position is NOT reliable: Kettlewright writes virtue-then-vice ("Honorable and
 * Craven") while Air Bladder's own sentence writes vice-then-virtue, so trusting
 * the order would silently swap the two on every single import. The table lookup
 * is also self-correcting if either app changes its phrasing later.
 *
 * Falls back to Kettlewright's observed order when the tables can't decide —
 * a custom or translated value that appears in neither list.
 * @param {String[]} pair
 * @returns {Promise<{virtue?: String, vice?: String}>}
 */
export const resolveVirtueVice = async (pair) => {
  if (pair.length !== 2) return {};
  const [a, b] = pair;
  const values = async (key) => {
    const ref = Cairn?.characterGenerator2e?.biography?.items?.[key];
    if (!ref) return new Set();
    const [packName, tableName] = String(ref).split(";");
    const pack = game.packs.get(packName);
    if (!pack) return new Set();
    const table = (await pack.getDocuments()).find((t) => t.name === tableName);
    return new Set((table?.results ?? []).map((r) => String(r.text ?? "").trim().toLowerCase()));
  };
  const [virtues, vices] = await Promise.all([values("virtue"), values("vice")]);
  const isV = (w) => virtues.has(w.toLowerCase());
  const isX = (w) => vices.has(w.toLowerCase());

  if (isV(a) && isX(b)) return { virtue: a, vice: b };
  if (isX(a) && isV(b)) return { virtue: b, vice: a };
  return { virtue: a, vice: b }; // Kettlewright order
};

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
  let bgQuestions = []; // the matched background's question prompts, in table order
  let bgTables = []; // …and the full tables, so an answer can be traced to its option
  if (bgName) {
    const pool = await getBackgroundsFor("2e");
    const hit = pool.find((b) => b.name.toLowerCase() === bgName.toLowerCase());
    if (hit) {
      background = hit.name;
      backgroundUuid = hit.uuid;
      report.background = { name: hit.name, matched: true };
      bgTables = hit.system?.tables ?? [];
      bgQuestions = bgTables.map((t) => String(t?.question ?? "").trim());
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
  // Same trick as the questions: a Kettlewright bond is a Bonds-table entry
  // verbatim, so the items it granted can be handed to `bond:<id>` and become
  // re-rollable instead of accumulating.
  if (bonds.length) {
    const entry = await findBondEntry(bondsText);
    if (entry) {
      report.regranted = (report.regranted ?? 0) + retagGranted(items, entry.items, `bond:${bonds[0].id}`);
    }
  }
  const omens = String(json.omens ?? "");
  let notes = String(json.notes ?? "");

  // Background questions: recoverable only because the background matched — an
  // unmatched background means we don't know what the questions were, so the blob
  // stays in Notes untouched.
  let questions = [];
  if (bgQuestions.length) {
    const qa = parseQuestionAnswers(notes, bgQuestions);
    if (qa.found) {
      // gold stays 0 deliberately. That field exists so a LATER re-roll can reverse
      // the gold this system granted; the import granted none (the character's gold
      // came over as a total), and inventing a figure here would make a re-roll
      // deduct coins the character may never have been given.
      questions = bgQuestions.map((q, i) => ({ question: q, answer: qa.answers[i], gold: 0 }));
      notes = qa.leftover;
      report.questions = qa.found;

      // A Kettlewright answer is the option's own description verbatim, so it can
      // be traced back to the option — and therefore to the items that option
      // grants. Hand those imported items to `question:<i>` so a later re-roll
      // replaces them instead of stacking a second copy beside them.
      bgTables.forEach((table, i) => {
        const answer = norm(qa.answers[i]);
        if (!answer) return;
        const opt = (table?.options ?? []).find((o) => norm(o?.description) === answer);
        if (!opt) return;
        report.regranted = (report.regranted ?? 0) + retagGranted(items, opt.items, `question:${i}`);
      });
    }
  }
  // Kettlewright's traits blob is a parseable sentence, not opaque prose: it maps
  // back onto the eight typed slots and system.age. Only if the parse yields
  // nothing at all does it fall back to landing in Notes under a label — better an
  // unstructured record than a silently dropped one.
  const traitText = String(json.traits ?? "").trim();
  let traits = {};
  let age = "";
  if (traitText) {
    const parsed = parseTraitSentence(traitText);
    traits = { ...parsed.traits, ...(await resolveVirtueVice(parsed.pair)) };
    age = parsed.age;
    report.traits = Object.keys(traits).length;
    report.age = age;
    if (!report.traits && !age) {
      const label = game.i18n.localize("CAIRN.KWImport.TraitsLabel");
      notes = (notes ? `${notes}\n\n` : "") + `${label} ${traitText}`;
      report.traitsUnparsed = true;
    }
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
      traits,
      age,
      questions,
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
 * @returns {Promise<void>}
 */
const showImportSummary = async (actor, report) => {
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
  // Traits either became structured fields or stayed prose — say which, because the
  // difference is visible on the sheet (populated dropdowns vs a paragraph in Notes).
  if (report.questions) {
    parts.push(`<p class="kwi-ok"><i class="fas fa-check"></i> ${F("CAIRN.KWImport.QuestionsMapped", { count: report.questions })}</p>`);
  }
  if (report.traitsUnparsed) {
    parts.push(`<p class="kwi-warn"><i class="fas fa-circle-exclamation"></i> ${L("CAIRN.KWImport.TraitsUnparsed")}</p>`);
  } else if (report.traits) {
    parts.push(`<p class="kwi-ok"><i class="fas fa-check"></i> ${F("CAIRN.KWImport.TraitsMapped", { count: report.traits, age: esc(report.age) || "—" })}</p>`);
  }

  const dialog = new foundry.applications.api.DialogV2({
    window: { title: F("CAIRN.KWImport.SummaryTitle", { name: esc(actor.name) }), icon: "fas fa-file-import" },
    position: { width: 460 },
    content: `<div class="kwi-summary">${parts.join("")}</div>`,
    buttons: [{ action: "ok", label: L("CAIRN.Close"), default: true }],
  });
  await dialog.render(true);

  // Put the summary in front of the character sheet. It is the only place that says
  // what didn't import cleanly, so it must not open buried.
  //
  // The ordering is the opposite of what it looks like. Creating the actor
  // auto-renders its sheet, but that render is kicked off asynchronously and lands
  // AFTER create() resolves — i.e. after this dialog has already drawn — so the
  // sheet takes the next number from the shared z-index counter and covers us
  // (measured: summary 101, sheet 102). Raising the dialog inline here is useless:
  // it only bumps a counter the sheet is about to out-bid.
  //
  // Worse, the sheet claims its z AFTER its own render hook fires, so the hook
  // alone isn't late enough either — hence the extra macrotask.
  const raise = () => setTimeout(() => dialog.bringToFront?.(), 0);
  if (actor.sheet?.rendered) raise();
  else {
    let fallback = null;
    const hookId = Hooks.on("renderCairnActorSheet", (app) => {
      if (app?.actor?.id !== actor.id) return;
      Hooks.off("renderCairnActorSheet", hookId);
      clearTimeout(fallback);
      raise();
    });
    // Safety net: a sheet that never renders must not leave the summary buried.
    fallback = setTimeout(() => {
      Hooks.off("renderCairnActorSheet", hookId);
      raise();
    }, 1000);
  }
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
  if (actor) await showImportSummary(actor, report);
  return actor;
};

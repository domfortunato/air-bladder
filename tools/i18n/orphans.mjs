/**
 * The content overlay's orphan classification, in ONE place.
 *
 * `lang/content/<lang>.json` is keyed on the English SOURCE STRING, so a
 * translation dies not by losing its key but by keeping one nothing asks for any
 * more. Deciding *why* a key went unasked — a spreadsheet mangled it, a document
 * changed type, the extractor emitted an entity form the DOM never produces, or
 * somebody simply edited the English — is the difference between "we fix this in
 * one command" and "this needs the translator".
 *
 * That classification now has two consumers: `check.mjs` (the gate) and
 * `handoff.mjs` (the document the translator receives). It lives here because a
 * second copy would drift, and drift between two producers of the same key is the
 * exact failure this overlay has now produced four separate times — see
 * CLAUDE.md, "Content translation is a display-only overlay".
 *
 * Callers format for their own medium; this module only decides.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, listPacks, readPack, normalizeKey, domSourceKey } from "./lib.mjs";
import { stringsFromDoc } from "./content-strings.mjs";

export const overlayPath = (lang) => path.join(ROOT, "lang", "content", `${lang}.json`);

/**
 * Every English string the runtime can ask the overlay for, indexed three ways:
 * `byNs` answers "does this namespace offer this string", `byText` answers "does
 * ANY namespace offer it" (which is what makes a namespace move recognisable),
 * and `perNs` enumerates a namespace so untranslated strings can be counted.
 */
export const liveSources = () => {
  const byNs = new Set();
  const byText = new Map();
  const perNs = new Map();
  const add = (ns, enStr) => {
    const k = normalizeKey(enStr);
    byNs.add(`${ns}\0${k}`);
    if (!byText.has(k)) byText.set(k, new Set());
    byText.get(k).add(ns);
    if (!perNs.has(ns)) perNs.set(ns, new Set());
    perNs.get(ns).add(k);
  };
  for (const pack of listPacks()) {
    for (const { doc } of readPack(pack)) for (const s of stringsFromDoc(doc, pack)) add(s.ns, s.en);
  }
  // Careers live in a module JSON, not a pack — the same exception extract makes.
  for (const c of JSON.parse(fs.readFileSync(path.join(ROOT, "module", "npc-careers-2e.json"), "utf8"))) {
    if (c?.name) add("npc.career", c.name);
  }
  return { byNs, byText, perNs };
};

// A spreadsheet saving tab-delimited wraps any cell containing a straight quote
// and doubles the inner ones. Reversing that is how a mangled key is recognised.
const unquoted = (s) => (/^".*"$/s.test(s) && s.includes('""') ? s.slice(1, -1).replace(/""/g, '"') : null);

/**
 * Sort every overlay entry the live source no longer offers into five classes.
 * Only the first three are mechanically recoverable; `dropped` is the one that
 * needs a human, because the English it was translated from is simply gone.
 *
 *   quoted    — CSV mangling of a real source string.  Tooling defect.
 *   moved     — the same English exists under a DIFFERENT namespace.
 *   entity    — differs from a live string only by HTML entities, so the key is
 *               one `node.innerHTML` can never produce. NEVER been displayed.
 *   entityDup — as above, but the decoded key is already present: spent residue
 *               from a completed re-key, losing nothing.
 *   dropped   — the English exists nowhere. Somebody edited or removed the prose.
 *
 * Returns null when the locale has no overlay file at all.
 */
export const classifyOverlay = (lang, live = liveSources()) => {
  const p = overlayPath(lang);
  if (!fs.existsSync(p)) return null;
  const overlay = JSON.parse(fs.readFileSync(p, "utf8"));
  const orphans = { quoted: [], moved: [], entity: [], entityDup: [], dropped: [] };
  let entries = 0;
  for (const [ns, group] of Object.entries(overlay)) {
    if (!group || typeof group !== "object") continue;
    for (const key of Object.keys(group)) {
      entries++;
      if (live.byNs.has(`${ns}\0${key}`)) continue;
      const rec = { ns, key, tr: group[key] };
      const u = unquoted(key);
      const decoded = normalizeKey(domSourceKey(key));
      if (u && live.byNs.has(`${ns}\0${normalizeKey(u)}`)) {
        orphans.quoted.push(rec);
      } else if (decoded !== key && live.byNs.has(`${ns}\0${decoded}`)) {
        rec.decoded = decoded;
        // Name the entities rather than the whole string: the two forms differ by
        // a few bytes in a paragraph, and a diff nobody can see is a diff nobody
        // acts on.
        rec.ents = [...new Set(key.match(/&[a-zA-Z][a-zA-Z0-9]*;|&#[xX]?[0-9a-fA-F]+;/g) ?? [])];
        (group[decoded] !== undefined ? orphans.entityDup : orphans.entity).push(rec);
      } else if (live.byText.has(key)) {
        rec.movedTo = [...live.byText.get(key)];
        orphans.moved.push(rec);
      } else {
        orphans.dropped.push(rec);
      }
    }
  }
  return { overlay, entries, orphans };
};

/**
 * Live source strings this locale has no entry for, per namespace. The other
 * half of the picture: `classifyOverlay` finds translations with no source,
 * this finds sources with no translation.
 */
export const untranslatedSources = (overlay, live) => {
  const out = new Map();
  for (const [ns, strings] of live.perNs) {
    const have = overlay?.[ns] ?? {};
    const missing = [...strings].filter((s) => !(s in have) || have[s] === "" || have[s] === s);
    if (missing.length) out.set(ns, missing);
  }
  return out;
};

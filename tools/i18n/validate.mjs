/**
 * Shared validators for the i18n import gate and the i18n:check release gate.
 * A translation must preserve the machine-meaningful parts of its source:
 * format placeholders and HTML structure. Grammar reordering is fine; dropping
 * a {n} or a </p> is not.
 */

/** Foundry format placeholders — {n}, {name}, {cost}, {key} — as a sorted multiset. */
export const placeholders = (s) => (String(s).match(/\{[^}]+\}/g) ?? []).sort();

/**
 * HTML tag multiset, attributes stripped and case-folded, order-independent:
 * <a href="…"> and </a> both reduce to <a>/</a>, <strong> to <strong>, etc.
 * Compares STRUCTURE, so a translator may re-order tags for grammar but cannot
 * drop or add one.
 */
export const htmlTags = (s) =>
  (String(s).match(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi) ?? [])
    .map((t) => {
      const m = t.match(/^<(\/?)\s*([a-z0-9]+)/i);
      return `<${m[1]}${m[2].toLowerCase()}>`;
    })
    .sort();

const eqMultiset = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Return a list of human-readable problems with the (en → es) pair; empty if clean. */
export const checkPair = (en, es) => {
  const errs = [];
  const [pe, ps] = [placeholders(en), placeholders(es)];
  if (!eqMultiset(pe, ps)) errs.push(`placeholders differ: en ${JSON.stringify(pe)} vs es ${JSON.stringify(ps)}`);
  const [he, hs] = [htmlTags(en), htmlTags(es)];
  if (!eqMultiset(he, hs)) errs.push(`HTML tags differ: en ${JSON.stringify(he)} vs es ${JSON.stringify(hs)}`);
  return errs;
};

/** Flatten a (possibly nested) lang JSON object to dotted keys → string values. */
export const flattenLang = (obj, prefix = "", out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenLang(v, key, out);
    else out[key] = String(v);
  }
  return out;
};

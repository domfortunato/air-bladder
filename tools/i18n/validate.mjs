/**
 * Shared validators for the i18n import gate and the i18n:check release gate.
 * A translation must preserve the machine-meaningful parts of its source:
 * format placeholders and HTML structure. Grammar reordering is fine; dropping
 * a {n} or a </p> is not.
 */

/**
 * Foundry format placeholders — {n}, {name}, {cost}, {key} — as a sorted multiset.
 * Enricher constructs (@UUID[…]{label}) are stripped first: their {label} is
 * translatable prose, NOT a format placeholder, so localizing it must not trip the
 * placeholder check. The [target] is guarded separately by enricherRefs().
 */
export const placeholders = (s) =>
  (String(s).replace(/@[A-Za-z]+\[[^\]]*\](?:\{[^}]*\})?/g, "").match(/\{[^}]+\}/g) ?? []).sort();

/**
 * Inline emphasis tags a translator may freely ADD or DROP: they are cosmetic
 * (bolding a term, italicising a phrase) and can never corrupt a sheet the way a
 * dropped </p>/<li> can. Bolding "fuerza" where English has no bold is a valid
 * stylistic choice, not a structural error, so these are exempt from the parity
 * check in BOTH directions.
 */
const INLINE_EMPHASIS = new Set(["b", "i", "u", "s", "em", "strong", "small", "sub", "sup", "mark"]);

/**
 * STRUCTURAL HTML tag multiset, attributes stripped and case-folded,
 * order-independent: <a href="…"> and </a> both reduce to <a>/</a>. Inline
 * emphasis (see INLINE_EMPHASIS) is filtered out first, so it is ignored entirely.
 * Compares STRUCTURE, so a translator may re-order structural tags for grammar,
 * and add/drop emphasis for style, but cannot drop or add a structural tag.
 */
export const htmlTags = (s) =>
  (String(s).match(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi) ?? [])
    .map((t) => t.match(/^<(\/?)\s*([a-z0-9]+)/i))
    .filter((m) => !INLINE_EMPHASIS.has(m[2].toLowerCase()))
    .map((m) => `<${m[1]}${m[2].toLowerCase()}>`)
    .sort();

/**
 * Foundry enricher targets — the bracket of @UUID[…], @Compendium[…], @Roll[…] —
 * as a sorted multiset, label stripped. The {label} after an enricher is prose the
 * translator SHOULD localize; the [target] inside the brackets is a document
 * reference that must survive verbatim, or the link breaks.
 */
export const enricherRefs = (s) => (String(s).match(/@[A-Za-z]+\[[^\]]*\]/g) ?? []).sort();

/**
 * The HOST of every `href`, as a sorted multiset.
 *
 * `htmlTags` folds `<a href="…">` down to `<a>`, on purpose — a translator may
 * reorder structural tags for grammar. The consequence is that the URL inside is
 * unchecked, and in this project every `href` in `lang/en.json` is an
 * ATTRIBUTION link: CAIRN.CompatibleCredit carries Yochai Gal's site and the
 * CC BY-SA 4.0 deed, and four more carry the art credits. Those are licence
 * obligations, not decoration. A translation that drops one, or points it
 * somewhere else, breaks the attribution while passing every check here — and
 * it renders raw, so nothing downstream notices either.
 *
 * HOST rather than the whole URL, so a translator may legitimately localize a
 * path — `…/by-sa/4.0/deed.es` is the same licence — while dropping a link,
 * adding one, or redirecting it to a different site all still fail.
 */
export const hrefHosts = (s) =>
  [...String(s).matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => { try { return new URL(m[1]).host.toLowerCase(); } catch { return m[1].toLowerCase(); } })
    .sort();

/**
 * Emphasis tags that WRAP A PLACEHOLDER, as sorted `tag:{placeholder}` pairs.
 *
 * INLINE_EMPHASIS is exempt from tag parity because bolding a term is a
 * stylistic choice. That reasoning holds for prose and fails exactly here:
 * `CAIRN.StatChange` is `<s>{from}</s> => {to}`, where the strikethrough is the
 * whole message — it is what says the first number is the old one. A
 * translation that drops it still passes tag parity and still renders, just
 * without the one mark that distinguishes the two values.
 *
 * So the rule is narrow rather than "make <s> structural": emphasis around a
 * PLACEHOLDER is meaning; emphasis around prose stays the translator's to
 * choose. Nothing else in lang/en.json currently matches, which is the point —
 * this costs existing translations nothing and catches the next one.
 */
export const wrappedPlaceholders = (s) =>
  [...String(s).matchAll(/<(b|i|u|s|em|strong|small|sub|sup|mark)\b[^>]*>\s*(\{[^}]+\})\s*<\/\1>/gi)]
    .map((m) => `${m[1].toLowerCase()}:${m[2]}`)
    .sort();

const eqMultiset = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Return a list of human-readable problems with the (en → es) pair; empty if clean. */
export const checkPair = (en, es) => {
  const errs = [];
  const [pe, ps] = [placeholders(en), placeholders(es)];
  if (!eqMultiset(pe, ps)) errs.push(`placeholders differ: en ${JSON.stringify(pe)} vs translation ${JSON.stringify(ps)}`);
  const [he, hs] = [htmlTags(en), htmlTags(es)];
  if (!eqMultiset(he, hs)) errs.push(`HTML tags differ: en ${JSON.stringify(he)} vs translation ${JSON.stringify(hs)}`);
  const [ue, us] = [enricherRefs(en), enricherRefs(es)];
  if (!eqMultiset(ue, us)) errs.push(`enricher targets differ: en ${JSON.stringify(ue)} vs translation ${JSON.stringify(us)}`);
  const [ae, as] = [hrefHosts(en), hrefHosts(es)];
  if (!eqMultiset(ae, as)) errs.push(`link hosts differ: en ${JSON.stringify(ae)} vs translation ${JSON.stringify(as)} — these are attribution links`);
  const [we, ws] = [wrappedPlaceholders(en), wrappedPlaceholders(es)];
  if (!eqMultiset(we, ws)) errs.push(`emphasis around a placeholder differs: en ${JSON.stringify(we)} vs translation ${JSON.stringify(ws)}`);
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

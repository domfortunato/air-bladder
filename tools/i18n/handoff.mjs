#!/usr/bin/env node
/**
 * The document the translator gets every release cycle.
 *
 *   npm run i18n:handoff -- --lang es      → docs/translation-handoff.md
 *
 * Its first job, and the reason it exists rather than being left to the TSVs, is
 * to say: **here is work you already finished that I have since changed.** That
 * class is invisible to every other tool here and it is the only one that is
 * actively misleading — a missing translation falls back to English and looks
 * untranslated, while a translation whose English moved underneath still renders,
 * still passes every gate, and quietly says the wrong thing. `extract-ui` marked
 * exactly those rows `done` until 2026-08-07.
 *
 * It reports two of them, because the two halves of the system lose work in
 * different ways:
 *
 *   - **Interface** (`lang/<lang>.json`, keyed by KEY). Editing an English value
 *     leaves the translation in place, valid and wrong. Detected against
 *     `tools/i18n/baseline/<lang>.json`, which records the English each
 *     translation was verified against.
 *   - **Content overlay** (`lang/content/<lang>.json`, keyed by the ENGLISH
 *     SOURCE STRING). Editing English prose does not make a translation wrong, it
 *     makes it UNREACHABLE — the key stops being asked for and the entry becomes
 *     an orphan. Detected via orphans.mjs, the same classification the gate uses.
 *
 * Everything here is offline and derived. Nothing in this file writes to
 * `lang/` — the translator's two files are never touched by any tool but
 * `i18n:import`, and then only on his own returned TSV.
 *
 * The honest limits, stated because a handoff that overclaims is worse than one
 * that admits a gap:
 *   - the interface baseline is a FLOOR seeded at a tag, not a history. Drift
 *     from before the seed reads as verified.
 *   - the "looks like an edit of" pairing in Part 2 is a text-similarity guess,
 *     labelled as one. It is there to save a retranslation, never to assert one.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";
import { flattenLang } from "./validate.mjs";
import { loadBaseline, classifyDrift } from "./baseline.mjs";
import { classifyOverlay, liveSources, untranslatedSources } from "./orphans.mjs";

const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : process.argv[i + 1];
};

/* ---- text helpers ---------------------------------------------------------- */

const plain = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Dice coefficient over character bigrams of the tag-stripped text. Cheap, and
 * it behaves the way an edit actually looks: a paragraph with a sentence
 * rewritten stays far above a paragraph about something else. Used ONLY to
 * suggest that an orphan and a new untranslated string are the same row before
 * and after an edit — never to act on its own.
 */
const bigrams = (s) => {
  const t = plain(s).toLowerCase();
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
};
const dice = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0, total = 0;
  for (const n of a.values()) total += n;
  for (const [g, n] of b) { total += n; shared += Math.min(n, a.get(g) ?? 0); }
  return (2 * shared) / total;
};

/* ---- the four sections ----------------------------------------------------- */

/**
 * Interface keys whose English moved under a finished translation. Also finds
 * the keys that QUOTE one, which is the trap this class hides: two of the five
 * drifted keys in the first edition were settings hints naming a settings label
 * verbatim, so translating the label alone would leave the hint pointing at a
 * control that is not on the menu.
 */
const uiDrift = (en, tr, baseline) => {
  const { drifted, unverified } = classifyDrift(en, tr, baseline);
  const rows = drifted.map((key) => {
    const was = baseline[key], now = en[key];
    // A quotation is only recognisable when the quoted text is long enough not
    // to appear by accident; below that the matches are all noise.
    const quotable = [was, now].filter((s) => s && s.length >= 12);
    const quotedBy = Object.entries(en)
      .filter(([k, v]) => k !== key && quotable.some((q) => v.includes(q)))
      .map(([k, v]) => ({ key: k, stillQuotesOld: was && v.includes(was) && !v.includes(now) }));
    return { key, was, now, tr: tr[key] ?? "", quotedBy };
  });
  return { rows, unverified };
};

/**
 * Overlay entries whose source English is gone, paired where possible with the
 * live string that most likely replaced it.
 */
const contentDrift = (orphans, live, overlay) => {
  const candidates = untranslatedSources(overlay, live);
  return orphans.dropped.map((o) => {
    const mine = bigrams(o.key);
    let best = null;
    for (const cand of candidates.get(o.ns) ?? []) {
      const score = dice(mine, bigrams(cand));
      if (score > (best?.score ?? 0)) best = { text: cand, score };
    }
    // 0.5 is the midpoint of the measured separation, not a guess: against a
    // real table row, unrelated prose in the same namespace scores 30-37% and
    // edits of the row itself score 63-100% (a whole sentence rewritten is the
    // 63%). Centring between them costs the least on both sides. Both failure
    // directions are recoverable and neither is silent — a miss lands the entry
    // in "the English is gone entirely" and he retranslates, a false pair is
    // shown with its similarity score and is visibly wrong.
    return { ...o, match: best && best.score >= 0.5 ? best : null };
  });
};

/** `CAIRN.Settings.Foo.label` → Settings; `CAIRN.Deprived` → General. */
const sectionOf = (key) => {
  const p = key.split(".");
  if (p.length >= 3) return p[1];
  return p[0] === "CAIRN" ? "General" : p[0];
};

/* ---- rendering ------------------------------------------------------------- */

const render = (d) => {
  const L = [];
  const P = (s = "") => L.push(s);
  // A generated document cannot be annotated in place — the next run destroys
  // whatever was typed into it. handoff-notes.json is where a note about one
  // specific string survives, which the hand-built first edition needed twice.
  const note = (k) => {
    const n = d.notes[k];
    if (!n) return;
    P(`- **note:** ${cell(n)}`);
  };

  P(`# Translation handoff — ${d.langName}`);
  P();
  P(`For **${d.translator}**. Generated by \`npm run i18n:handoff -- --lang ${d.lang}\`;`);
  P(`regenerate it every release cycle. Covers everything outstanding on \`${d.branch}\``);
  P(`as of ${d.date}, measured against the last release (\`${d.from}\`).`);
  P();
  P(`| | |`);
  P(`| --- | --- |`);
  P(`| English interface keys | ${d.enCount} |`);
  P(`| translated in \`lang/${d.lang}.json\` | ${d.trCount} (${d.pct}%) |`);
  P(`| **changed under your translation** | **${d.ui.rows.length}** ← Part 1 |`);
  P(`| **content you translated, now unreachable** | **${d.content.length}** ← Part 2 |`);
  P(`| new interface keys, untranslated | ${d.newUi.length} ← Part 3 |`);
  P(`| new content strings, untranslated | ${d.newContentTotal} ← Part 4 |`);
  P();
  P(`Only two files are yours, and only you should edit them: \`lang/${d.lang}.json\``);
  P(`(interface) and \`lang/content/${d.lang}.json\` (the content overlay). Nothing in this`);
  P(`list asks you to touch anything else.`);
  P();
  P(`---`);
  P();

  /* Part 1 */
  P(`## Part 1 — interface strings you translated, whose English I have since changed (${d.ui.rows.length})`);
  P();
  if (!d.ui.rows.length) {
    P(`Nothing. No English interface value changed under a finished ${d.langName} translation`);
    P(`this cycle.`);
  } else {
    P(`**Do these first.** Each key below already has a ${d.langName} translation, so no tool`);
    P(`reports it as missing — but the English changed underneath it. The translation is not`);
    P(`out of date, it is *wrong*: it still answers to the key while promising something the`);
    P(`English was deliberately changed to stop saying.`);
    P();
    for (const r of d.ui.rows) {
      P(`### \`${r.key}\``);
      P();
      P(`- **was (EN):** ${cell(r.was)}`);
      P(`- **now (EN):** ${cell(r.now)}`);
      P(`- **your current ${d.langName}:** ${cell(r.tr)}`);
      if (r.quotedBy.length) {
        const names = r.quotedBy.map((q) => `\`${q.key}\``).join(", ");
        P(`- **quoted verbatim by:** ${names} — whatever you choose here has to be pasted`);
        P(`  into those too, or they will name a control that is not on the menu.`);
        for (const q of r.quotedBy.filter((x) => x.stillQuotesOld)) {
          P(`  - ⚠ \`${q.key}\` still quotes the OLD English. That is our bug, not yours;`);
          P(`    it is listed here so the two of us do not fix it in opposite directions.`);
        }
      }
      note(r.key);
      P();
    }
  }
  P(`---`);
  P();

  /* Part 2 */
  const edited = d.content.filter((o) => o.match);
  const gone = d.content.filter((o) => !o.match);
  P(`## Part 2 — content you translated, whose English I have since changed (${d.content.length})`);
  P();
  P(`\`lang/content/${d.lang}.json\` is keyed on the **English source string**, so editing`);
  P(`English prose does not make your translation wrong — it makes it unreachable. The key`);
  P(`stops being asked for and the entry goes dead silently. These are the entries in that`);
  P(`state whose replacement needs a human.`);
  P();
  if (!d.content.length) {
    P(`Nothing this cycle.`);
    P();
  }
  if (edited.length) {
    P(`### Looks like an edit — your text is probably still most of the answer (${edited.length})`);
    P();
    P(`Paired by text similarity, so treat the match as a suggestion. Where it is right, edit`);
    P(`your existing ${d.langName} rather than starting over.`);
    P();
    for (const o of edited) {
      P(`**\`${o.ns}\`** · similarity ${(o.match.score * 100).toFixed(0)}%`);
      P();
      P(`- **was (EN):** ${cell(clip(o.key, 400))}`);
      P(`- **now (EN):** ${cell(clip(o.match.text, 400))}`);
      P(`- **your ${d.langName}:** ${cell(clip(o.tr, 400))}`);
      P();
    }
  }
  if (gone.length) {
    P(`### The English is gone entirely (${gone.length})`);
    P();
    P(`No live string resembles these, so the prose was removed rather than rewritten. Nothing`);
    P(`to do — they are listed so the work is accounted for rather than vanishing.`);
    P();
    for (const o of gone) P(`- \`${o.ns}\` · ${cell(clip(o.key, 160))}`);
    P();
  }
  const mech = d.mechanical;
  if (mech.total) {
    P(`### Mechanical — nothing for you to do (${mech.total})`);
    P();
    P(`These lost their key to our tooling, not to an edit, and are recovered by re-keying`);
    P(`with every ${d.langName} value kept byte-identical.`);
    P();
    if (mech.entity) P(`- **${mech.entity}** keyed with HTML entities (\`&mdash;\`, \`&rsquo;\`) the browser never asks for — they have never once been displayed.`);
    if (mech.quoted) P(`- **${mech.quoted}** mangled by a spreadsheet's CSV quoting on a previous import.`);
    if (mech.moved) P(`- **${mech.moved}** whose document changed type, moving them to a different namespace.`);
    if (mech.entityDup) P(`- **${mech.entityDup}** already re-keyed; the old key is spent residue and safe to delete.`);
    P();
    P(`Fixed our side with \`npm run i18n:repair -- --lang ${d.lang} --write\`, which touches only`);
    P(`the entries it names and keeps every ${d.langName} value byte-identical.`);
    P();
  }
  P(`---`);
  P();

  /* Part 3 */
  P(`## Part 3 — new interface keys, untranslated (${d.newUi.length})`);
  P();
  if (!d.newUi.length) {
    P(`Nothing outstanding.`);
    P();
  } else {
    P(`Ordinary outstanding work: these have no ${d.langName} at all, so a ${d.langName} client`);
    P(`falls back to English for them. Nothing here is urgent — a missing key is visibly`);
    P(`untranslated, which is the honest failure.`);
    P();
    const bySection = new Map();
    for (const k of d.newUi) {
      const s = sectionOf(k);
      if (!bySection.has(s)) bySection.set(s, []);
      bySection.get(s).push(k);
    }
    for (const s of [...bySection.keys()].sort()) {
      const keys = bySection.get(s);
      P(`### ${s} (${keys.length})`);
      P();
      P(`| key | English |`);
      P(`| --- | --- |`);
      for (const k of keys.sort()) P(`| \`${k}\` | ${cell(clip(d.en[k], 220))} |`);
      P();
      const annotated = keys.filter((k) => d.notes[k]);
      if (annotated.length || d.notes[`section:${s}`]) {
        if (d.notes[`section:${s}`]) P(`- **note:** ${cell(d.notes[`section:${s}`])}`);
        for (const k of annotated) P(`- **\`${k}\`** — ${cell(d.notes[k])}`);
        P();
      }
    }
  }
  P(`---`);
  P();

  /* Part 4 */
  P(`## Part 4 — new content strings, untranslated (${d.newContentTotal})`);
  P();
  if (!d.newContentTotal) {
    P(`Nothing outstanding.`);
  } else {
    P(`Pack content — monster names and descriptions, table rows, background prose. Too many`);
    P(`to list here; they are pre-filled in the spreadsheets \`npm run i18n:extract\` writes to`);
    P(`\`tools/i18n/tsv/\`, which is the file to actually work from.`);
    P();
    P(`| namespace | untranslated |`);
    P(`| --- | --- |`);
    for (const [ns, n] of d.newContent) P(`| \`${ns}\` | ${n} |`);
  }
  P();
  P(`---`);
  P();

  /* Provenance */
  P(`## How this list is produced, and what it cannot see`);
  P();
  P(`Generated offline from the repository — no part of it is hand-maintained, so it cannot`);
  P(`drift out of step with the code the way a hand-written list does.`);
  P();
  P(`- **Part 1** compares \`lang/en.json\` against \`tools/i18n/baseline/${d.lang}.json\`, which`);
  P(`  records the English each of your translations was verified against and advances`);
  P(`  automatically whenever you import a returned spreadsheet.`);
  P(`- **Part 2** compares \`lang/content/${d.lang}.json\` against every English string the`);
  P(`  packs actually offer, using the same classification \`npm run i18n:check\` gates on.`);
  P();
  P(`**The one gap worth knowing about:** the Part 1 baseline was seeded at \`${d.seed}\`, so it`);
  P(`cannot see an English string that changed *before* then. It is a floor from which drift`);
  P(`is caught going forward, not a full history.`);
  if (d.ui.unverified.length) {
    P();
    P(`${d.ui.unverified.length} translated key(s) have no baseline entry at all — translated after the`);
    P(`seed and not yet re-imported, so nothing is known about the English behind them. They`);
    P(`are neither reported as drifted nor certified as current.`);
  }
  P();
  return L.join("\n");
};

/* ---- CLI ------------------------------------------------------------------- */

// pathToFileURL, not a hand-built `file://` + argv[1]: on Windows that yields
// `file://C:/…` against an actual `file:///C:/…`, and the CLI exits silently.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const LANG = argVal("--lang", "es");
  const NAMES = { es: ["Spanish", "fsmalecho"], pl: ["Polish", "the Polish translator"],
    de: ["German", "the German translator"], da: ["Danish", "the Danish translator"],
    fr: ["French", "the French translator"], "pt-BR": ["Portuguese", "the Portuguese translator"] };
  const [langName, translator] = NAMES[LANG] ?? [LANG, "the translator"];
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();

  const load = (f) => flattenLang(JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")));
  const en = load("lang/en.json");
  const tr = load(`lang/${LANG}.json`);
  const baseline = loadBaseline(LANG);
  if (!Object.keys(baseline).length) {
    console.error(
      `\nNo tools/i18n/baseline/${LANG}.json — Part 1 would be empty and would read as "nothing changed".\n` +
      `Seed it first:  npm run i18n:baseline -- --lang ${LANG}\n`
    );
    process.exit(1);
  }

  const live = liveSources();
  const content = classifyOverlay(LANG, live);
  const orphans = content?.orphans ?? { quoted: [], moved: [], entity: [], entityDup: [], dropped: [] };
  const newContent = [...untranslatedSources(content?.overlay ?? {}, live)]
    .map(([ns, list]) => [ns, list.length])
    .sort((a, b) => b[1] - a[1]);

  const notesPath = path.join(ROOT, "tools", "i18n", "handoff-notes.json");
  const notes = fs.existsSync(notesPath) ? JSON.parse(fs.readFileSync(notesPath, "utf8")) : {};
  delete notes._readme;

  const enCount = Object.keys(en).length;
  const trCount = Object.entries(en).filter(([k, v]) => tr[k] != null && tr[k] !== v).length;
  const data = {
    lang: LANG, langName, translator, en, notes,
    date: new Date().toISOString().slice(0, 10),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    from: git("describe", "--tags", "--abbrev=0"),
    seed: argVal("--seed", git("describe", "--tags", "--abbrev=0")),
    enCount, trCount, pct: Math.round((trCount / enCount) * 100),
    ui: uiDrift(en, tr, baseline),
    content: contentDrift(orphans, live, content?.overlay ?? {}),
    mechanical: {
      entity: orphans.entity.length, quoted: orphans.quoted.length,
      moved: orphans.moved.length, entityDup: orphans.entityDup.length,
      total: orphans.entity.length + orphans.quoted.length + orphans.moved.length + orphans.entityDup.length,
    },
    newUi: Object.keys(en).filter((k) => tr[k] == null || tr[k] === en[k]),
    newContent,
    newContentTotal: newContent.reduce((n, [, c]) => n + c, 0),
  };

  // The stable path is Spanish's because the maintainer guide and the translator
  // both know it; other locales get a suffixed file rather than fighting over it.
  const out = path.join(ROOT, "docs", LANG === "es" ? "translation-handoff.md" : `translation-handoff.${LANG}.md`);
  fs.writeFileSync(out, render(data) + "\n");

  console.log(`\ntranslation handoff → ${path.relative(ROOT, out)}   (${langName}, ${data.branch} vs ${data.from})`);
  console.log(`  changed under a translation : ${data.ui.rows.length} interface, ${data.content.length} content   <- the urgent class`);
  console.log(`  new, untranslated           : ${data.newUi.length} interface, ${data.newContentTotal} content`);
  console.log(`  mechanical, our side        : ${data.mechanical.total}`);
  if (data.ui.unverified.length) console.log(`  unverified (no baseline)    : ${data.ui.unverified.length}`);
  // A note is only reachable through the key it names, so one naming a key that
  // no longer exists renders nowhere and reports nothing — the same silent-rot
  // shape as the overlay itself. Say so rather than letting the file accumulate.
  const sections = new Set(Object.keys(en).map(sectionOf));
  const orphanNotes = Object.keys(notes).filter((k) =>
    k.startsWith("section:") ? !sections.has(k.slice(8)) : !(k in en));
  if (orphanNotes.length) {
    console.log(`  ! ${orphanNotes.length} note(s) in handoff-notes.json name nothing that exists — they render nowhere:`);
    for (const k of orphanNotes) console.log(`     ${k}`);
  }
  console.log();
}

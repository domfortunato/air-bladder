#!/usr/bin/env node
/**
 * Check the 26 Warden tables against the Cairn SRD.
 *
 *   node tools/dev/warden-check.mjs [--verbose]
 *
 * These four packs are the only content in the repo with no importer: they were
 * authored once from cairnrpg.com, which publishes the same CC BY-SA text as
 * yochaigal/cairn. This verifies that claim continuously, and surfaces any
 * upstream edit -- the thing an importer would have given us -- WITHOUT owning
 * authoring, because re-authoring would flatten editorial work a parser cannot
 * reproduce (see COMPOSED below).
 *
 * No Foundry required: it reads src/packs YAML directly and fetches the SRD.
 *
 * TWO KINDS OF TABLE.
 *
 * VERBATIM (14 tables, 320 rows) -- warden-npcs and warden-monsters. Each result
 * is one SRD cell, unchanged. Compared exactly.
 *
 * COMPOSED (11 tables, 56 rows) -- warden-encounters and warden-travel. The SRD
 * gives these as multi-column rows; ours merge them into one string with markup:
 *   | **1** | **Encounter** | Roll on an encounter table... |
 *   -> "<strong>Encounter</strong> &mdash; Roll on an encounter table..."
 * and rewrite the SRD's website cross-links to name OUR compendium tables
 * ("(See Reactions)" -> "(See Warden: NPC - Reactions.)"), which is the right
 * call in a VTT and is not derivable from the source. So these are compared by
 * CONTAINMENT after normalising markup away: every SRD cell must still appear in
 * our text. That catches an upstream wording change while ignoring our
 * formatting. Cross-references are lifted out before comparing and checked
 * separately -- each must name a table that actually exists in these packs.
 *
 * NOT FROM THE SRD (1 table, 10 rows) -- "Warden: NPC - What Do They Want?" is
 * from the third-party Modular Rules & Procedures hack (cairnrpg.com/hacks/,
 * CC BY-SA 4.0), not Cairn 2e core. It is reported as skipped, never silently
 * passed.
 *
 * Exits non-zero on any drift.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const load = yaml.load ?? yaml.safeLoad;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const verbose = process.argv.includes("--verbose");

const BASE = "https://raw.githubusercontent.com/yochaigal/cairn/main";
const FILES = {
  procedures: "second-edition/players-guide/procedures.md",
  core: "second-edition/players-guide/core-rules.md",
  npc: "second-edition/wardens-guide/npc-tables.md",
  monsters: "second-edition/wardens-guide/creating-monsters.md",
};

/* ------------------------------------------------------------------- markdown */

/** Every markdown table in `md`, in document order, as arrays of cell-arrays. */
const allTables = (md) => {
  const out = [];
  let cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith("|")) {
      const cells = l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
      (cur ??= []).push(cells);
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
};

/** Tables that appear under `heading`, up to the next heading of the same depth
 *  or shallower. Located by exact heading text so a reordered document cannot
 *  silently shift which table we compare against. */
const tablesUnder = (md, heading) => {
  const lines = md.split(/\r?\n/);
  const depth = heading.match(/^#+/)[0].length;
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) throw new Error(`SRD heading not found: "${heading}"`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(#+) /);
    if (m && m[1].length <= depth) { end = i; break; }
  }
  return allTables(lines.slice(start + 1, end).join("\n"));
};

/* ---------------------------------------------------------------- normalising */

const ENTITIES = {
  "&mdash;": "—", "&ndash;": "–", "&rsquo;": "’", "&lsquo;": "‘",
  "&rdquo;": "”", "&ldquo;": "“", "&amp;": "&", "&nbsp;": " ",
  "&hellip;": "…", "&quot;": '"', "&#39;": "'",
};

/** Reduce either side to comparable prose: no markup, no entities, no emphasis,
 *  no smart-quote or dash variance, no trailing punctuation. */
const norm = (s) => {
  let t = String(s ?? "");
  for (const [k, v] of Object.entries(ENTITIES)) t = t.split(k).join(v);
  t = t.replace(/<[^>]+>/g, "");                        // HTML tags
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");        // markdown links
  t = t.replace(/\*\*|__|[*_]/g, "");                   // emphasis
  t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/[—–]/g, "-");
  t = t.replace(/\s+/g, " ").trim();
  return t.replace(/[.,;:]+$/, "");
};

/** Pull "(See …)" cross-references out so our compendium-relative wording does
 *  not read as drift. Returns the remaining text plus the referenced names.
 *  Markdown links are flattened FIRST: the SRD's link targets contain their own
 *  brackets, so "(See [Reactions](/…/core-rules/#reactions).)" would otherwise
 *  close the group on the URL and leave a stray ".)" behind. */
const splitRefs = (s) => {
  const refs = [];
  const flat = String(s ?? "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const text = flat.replace(/\(\s*See\s+([^)]*)\)/gi, (_, r) => { refs.push(norm(r)); return " "; });
  return { text, refs };
};

/**
 * INLINE cross-reference rewrites — the ones not in "(See …)" form, where our
 * copy names a compendium table in the middle of a sentence because a website
 * link cannot survive into a VTT. Each is DECLARED rather than tolerated: the
 * SRD phrase is rewritten before comparing, so if upstream ever reworks that
 * sentence the phrase stops matching and the check trips, exactly as it should.
 */
const REWRITES = [
  { table: "Warden: Events - Wilderness", from: "roll for NPC reactions", to: "roll Warden: NPC - Reactions" },
  { table: "Warden: Weather - Difficulty", from: "Increase terrain Difficulty", to: "Increase Warden: Travel - Terrain Difficulty" },
];

/* ------------------------------------------------------------- shipped tables */

const PACKS = ["warden-encounters", "warden-travel", "warden-npcs", "warden-monsters"];
const shippedTables = new Map();
for (const pack of PACKS) {
  const dir = path.join(root, "src", "packs", pack);
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    const d = load(fs.readFileSync(path.join(dir, f), "utf8"));
    if (d?.name) shippedTables.set(d.name, { ...d, pack });
  }
}

/* --------------------------------------------------------------- the mapping */

// rows: "numbered" = rows whose first cell is a roll number; "body" = every row
// after the header row (the SRD keys some tables by name, not by die result).
// cols: which SRD columns feed the result text, in order.
const SPEC = [
  // -- warden-npcs: one cell per result, exact --------------------------------
  { name: "Warden: NPC - Name", src: "npc", heading: "# NPC Tables", tables: [0, 1, 2], rows: "numbered", cols: [1], exact: true },
  { name: "Warden: NPC - Quirk", src: "npc", heading: "## Quirks", rows: "numbered", cols: [1], exact: true },
  { name: "Warden: NPC - Background", src: "npc", heading: "## Background", rows: "numbered", cols: [1], exact: true },
  { name: "Warden: NPC - Goal", src: "npc", heading: "## Goals", rows: "numbered", cols: [1], exact: true },
  { name: "Warden: NPC - Virtue", src: "npc", heading: "## Traits", table: 0, rows: "numbered", cols: [1], exact: true },
  { name: "Warden: NPC - Vice", src: "npc", heading: "## Traits", table: 1, rows: "numbered", cols: [1], exact: true },

  // -- warden-monsters: four two-column tables -> eight -----------------------
  { name: "Warden: Monster - Appearance (Physique)", src: "monsters", heading: "## Monster Appearance", rows: "numbered", cols: [1], exact: true },
  { name: "Warden: Monster - Appearance (Feature)", src: "monsters", heading: "## Monster Appearance", rows: "numbered", cols: [2], exact: true },
  { name: "Warden: Monster - Trait (Quirk)", src: "monsters", heading: "## Monster Traits", rows: "numbered", cols: [1], exact: true },
  { name: "Warden: Monster - Trait (Weakness)", src: "monsters", heading: "## Monster Traits", rows: "numbered", cols: [2], exact: true },
  { name: "Warden: Monster - Attack (Type)", src: "monsters", heading: "## Monster Attacks", rows: "numbered", cols: [1], exact: true },
  { name: "Warden: Monster - Attack (Critical Damage)", src: "monsters", heading: "## Monster Attacks", rows: "numbered", cols: [2], exact: true },
  { name: "Warden: Monster - Ability (Power)", src: "monsters", heading: "## Monster Abilities", rows: "numbered", cols: [1], exact: true },
  { name: "Warden: Monster - Ability (Target)", src: "monsters", heading: "## Monster Abilities", rows: "numbered", cols: [2], exact: true },

  // -- warden-encounters + warden-travel: composed, containment ---------------
  { name: "Warden: Events - Dungeon", src: "procedures", heading: "### Dungeon Events", rows: "numbered", cols: [1, 2] },
  { name: "Warden: Events - Wilderness", src: "procedures", heading: "### Wilderness Events", rows: "numbered", cols: [1, 2] },
  { name: "Warden: Weather - Spring", src: "procedures", heading: "#### Weather Type", rows: "numbered", cols: [1] },
  { name: "Warden: Weather - Summer", src: "procedures", heading: "#### Weather Type", rows: "numbered", cols: [2] },
  { name: "Warden: Weather - Fall", src: "procedures", heading: "#### Weather Type", rows: "numbered", cols: [3] },
  { name: "Warden: Weather - Winter", src: "procedures", heading: "#### Weather Type", rows: "numbered", cols: [4] },
  { name: "Warden: Weather - Difficulty", src: "procedures", heading: "#### Weather Difficulty", rows: "body", cols: [0, 1, 2] },
  { name: "Warden: Travel - Path Difficulty", src: "procedures", heading: "### Path Difficulty", table: 0, rows: "body", cols: [0, 1, 2] },
  { name: "Warden: Travel - Path Distance", src: "procedures", heading: "### Path Difficulty", table: 1, rows: "body", cols: [0, 1] },
  { name: "Warden: Travel - Terrain Difficulty", src: "procedures", heading: "## Terrain Difficulty", rows: "body", cols: [0, 1, 2, 3] },

  // -- 2d6, and TRANSPOSED in the SRD: ranges on one row, values on the next --
  { name: "Warden: NPC - Reactions", src: "core", heading: "## Reactions", transposed: true },
];

// Deliberately not checked, and said out loud rather than skipped in silence.
const NOT_SRD = new Map([[
  "Warden: NPC - What Do They Want?",
  "third-party (Modular Rules & Procedures hack, cairnrpg.com/hacks) — not Cairn 2e core",
]]);

/* -------------------------------------------------------------------- compare */

const isNumbered = (r) => /^\d+$/.test(norm(r[0]));
const pickRows = (table, how) => (how === "numbered" ? table.filter(isNumbered) : table.slice(1));

let failures = 0;
let checkedRows = 0;
const fail = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

const md = {};
for (const [key, rel] of Object.entries(FILES)) {
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok) throw new Error(`fetch ${rel}: HTTP ${res.status}`);
  md[key] = await res.text();
}
console.log(`fetched ${Object.keys(FILES).length} SRD files\n`);

const allRefs = [];

for (const spec of SPEC) {
  const doc = shippedTables.get(spec.name);
  if (!doc) { fail(`${spec.name}: not present in any warden pack`); continue; }
  const results = doc.results ?? [];

  // ---- the transposed 2d6 reaction table ----
  if (spec.transposed) {
    const t = tablesUnder(md[spec.src], spec.heading)[0];
    const ranges = t[0].map(norm);
    const values = t[1].map(norm);
    if (values.length !== results.length) {
      fail(`${spec.name}: ${values.length} SRD values vs ${results.length} results`);
      continue;
    }
    let bad = 0;
    values.forEach((v, i) => {
      const { text } = splitRefs(results[i].text);
      if (norm(text) !== v) { bad++; if (verbose) console.error(`        [${i}] "${v}" vs "${norm(text)}"`); }
      // the SRD's own range ("3-5") must match the shipped numeric range
      const [lo, hi] = (ranges[i].match(/\d+/g) ?? []).map(Number);
      const want = [lo, hi ?? lo];
      const got = results[i].range ?? [];
      if (got[0] !== want[0] || got[1] !== want[1]) {
        bad++; if (verbose) console.error(`        [${i}] range ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
      }
    });
    checkedRows += values.length;
    bad ? fail(`${spec.name}: ${bad} mismatch(es) — rerun with --verbose`)
        : ok(`${spec.name} — ${values.length} rows + 2d6 ranges`);
    continue;
  }

  // ---- ordinary tables ----
  const tables = tablesUnder(md[spec.src], spec.heading);
  const chosen = spec.tables ? spec.tables.map((i) => tables[i]) : [tables[spec.table ?? 0]];
  if (chosen.some((t) => !t)) { fail(`${spec.name}: expected table missing under "${spec.heading}"`); continue; }
  const rows = chosen.flatMap((t) => pickRows(t, spec.rows));

  if (rows.length !== results.length) {
    fail(`${spec.name}: ${rows.length} SRD rows vs ${results.length} results`);
    continue;
  }

  let bad = 0;
  rows.forEach((row, i) => {
    const { text, refs } = splitRefs(results[i].text);
    allRefs.push(...refs.map((r) => ({ table: spec.name, ref: r })));
    const mine = norm(text);
    if (spec.exact) {
      const want = norm(row[spec.cols[0]]);
      if (mine !== want) { bad++; if (verbose) console.error(`        [${i + 1}] srd "${want}" != ours "${mine}"`); }
      return;
    }
    // Composed: every SRD cell must survive somewhere in our merged string.
    // Case-insensitive, because merging a standalone cell into a sentence
    // recases it ("| None |" -> "Odds of getting lost: none.") — that is
    // formatting, not a content change.
    const mineCI = mine.toLowerCase();
    for (const c of spec.cols) {
      let cell = norm(splitRefs(row[c] ?? "").text);
      for (const rw of REWRITES) {
        if (rw.table === spec.name) cell = cell.split(rw.from).join(rw.to);
      }
      if (cell && !mineCI.includes(cell.toLowerCase())) {
        bad++;
        if (verbose) console.error(`        [${i + 1}] missing SRD text: "${cell}"\n              in ours: "${mine}"`);
      }
    }
  });
  checkedRows += rows.length;
  bad ? fail(`${spec.name}: ${bad} mismatch(es) — rerun with --verbose`)
      : ok(`${spec.name} — ${rows.length} rows${spec.exact ? "" : " (composed)"}`);
}

/* ---- cross-references must name a table that actually exists --------------- */

const known = new Set(shippedTables.keys());
const badRefs = allRefs.filter((r) => !known.has(r.ref));
badRefs.length
  ? badRefs.forEach((r) => fail(`${r.table}: cross-reference "${r.ref}" names no table in these packs`))
  : ok(`${allRefs.length} cross-reference(s) resolve to real tables`);

/* ---- everything shipped is either checked or explicitly excused ------------ */

const covered = new Set(SPEC.map((s) => s.name));
for (const name of shippedTables.keys()) {
  if (covered.has(name)) continue;
  const why = NOT_SRD.get(name);
  why ? console.log(`  --    ${name} — not checked: ${why}`)
      : fail(`${name} is in a warden pack but nothing checks it — add it to SPEC or NOT_SRD`);
}

console.log(
  failures
    ? `\n${checkedRows} rows checked — WARDEN CHECK FAILED\n`
    : `\n${checkedRows} rows checked across ${SPEC.length} tables — warden check passed\n`
);
process.exit(failures ? 1 : 0);

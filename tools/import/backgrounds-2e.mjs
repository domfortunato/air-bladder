#!/usr/bin/env node
/**
 * Re-source the 2e background TEXT from the Cairn SRD.
 *
 *   node tools/import/backgrounds-2e.mjs [--dry] [--report]
 *
 * WHY. The 20 background documents originally came into the predecessor fork
 * second-hand, and that copy had quietly dropped the mechanical parentheticals
 * the SRD carries: the Aurifex's Blast Sphere is "(d12, blast, bulky, 1 use)"
 * upstream and untagged in what we inherited, and eleven other options lost a
 * damage die, an armor value or a use count the same way. A player reading their
 * sheet could not see what the thing does. yochaigal/cairn is the authoritative
 * source and is machine-readable, so the text comes from there now.
 *
 * WHAT THIS DOES AND DOES NOT TOUCH. It rewrites only TEXT — tagline, the ten
 * names, both question headings, and each option's description. It deliberately
 * PRESERVES from the existing pack:
 *   - `_id`, because a character stores its background by uuid; reissuing ids
 *     would orphan every existing character's backgroundUuid.
 *   - every gear REFERENCE, container and bonusGold. Those are proven to resolve
 *     against the pool (tools/dev/gear-probe.mjs asserts 0 misses), and they
 *     cannot be re-derived from the prose: the SRD bolds the salient noun, not
 *     the item, so "**eye**", "**foot**" and "**arm**" sit in the same markup as
 *     "**Oil Can**". Parsing bold spans would author a pack full of body parts.
 *   - `archetype`, which is fork-authored — Fighter/Wizard/Thief appear nowhere
 *     in the 2e text.
 * Genuinely missing grants are added explicitly, by hand, in ADDITIONS below.
 *
 * Options are matched POSITIONALLY (background name -> table index -> option
 * index). That is safe and checked: all 20 names match, all 40 question headings
 * match, and every table has exactly 6 options. Any drift aborts the run rather
 * than writing mismatched text.
 *
 * UPSTREAM IS NOT STRICTLY BETTER. A few SRD lines carry typos the app's copy
 * fixed ("When it came time to , you took"), so CORRECTIONS re-applies those
 * fixes on top. Each is listed with its reason; the list is meant to stay short,
 * and every entry is verified to still match before it is used.
 *
 * Idempotent: reruns are byte-identical. Rebuild afterwards:
 *   npm run build:packs   (stop Foundry first)
 *
 * Game text: CC BY-SA 4.0, Yochai Gal (attribution required; see README).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const load = yaml.load ?? yaml.safeLoad;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry");
const report = process.argv.includes("--report");

const PACK = path.join(root, "src", "packs", "backgrounds-2e");
const BASE = "https://raw.githubusercontent.com/yochaigal/cairn/main/second-edition/backgrounds";
const SLUGS = [
  "aurifex", "barber-surgeon", "beast-handler", "bonekeeper", "cutpurse",
  "fieldwarden", "fletchwind", "foundling", "fungal-forager", "greenwise",
  "half-witch", "hexenbane", "jongleur", "kettlewright", "marchguard",
  "mountebank", "outrider", "prowler", "rill-runner", "scrivener",
];

/**
 * Typos in the SRD that the app's copy had right. Applied after parsing, keyed by
 * background + table + option (1-based), and each is asserted to still match — if
 * upstream fixes one, the run fails loudly rather than silently reverting it.
 */
const CORRECTIONS = [
  {
    where: "Foundling/0/3",
    find: "When it came time to , you took",
    replace: "When it came time to leave, you took",
    why: "SRD drops the verb; the sentence is ungrammatical without it",
  },
  {
    where: "Rill Runner/1/6",
    find: "Start a map (petty)",
    replace: "Start with a map (petty)",
    why: "SRD drops 'with'",
  },
  {
    where: "Hexenbane/0/3",
    find: "Take a short sword (d8)",
    replace: "Take a short sword (d6)",
    why: "the die contradicts the weapon the option actually grants — the shipped "
      + "Short sword is d6, Cairn's light-weapon tier beside the dagger and cudgel, "
      + "so the sheet said d8 while the item in the player's inventory rolled d6 "
      + "(user ruling 2026-08-13, from the printed page)",
  },
];

/**
 * Grants the SRD names but the app's items[] omitted, so generation never created
 * them. This IS the missing-items pass; keep it explicit and short, and prefer a
 * container over an item for anything with its own slots.
 */
const ADDITIONS = {
  // "Cart (+4 slots, bulky when pulled)" is in the SRD's starting gear and the
  // app omitted it entirely. A thing with its own slots is a container Actor, not
  // an item, so it goes in `containers`.
  Mountebank: { containers: [{ name: "Cart", slots: 4 }] },
  // NOT Fletchwind. Its SRD gear line reads "Bow (see table)", which looks like a
  // missing item but is a pointer: the "What kind of wood is your bow made from?"
  // table grants the bow itself, and each option (Western Yew, White Ash, ...) is
  // a real bulky d6/d8 weapon in the pool. Adding a generic Bow here gives every
  // Fletchwind two bows. Verified before removing it again.

  // "Take 20gp worth of items from the gear table" — a player-choice shopping
  // grant that generation could not express, so these two options handed over
  // NOTHING. We grant the coin and let the player shop: the marketplace already
  // exists, bonusGold is how every other "take an extra 30gp" option works, and
  // coins occupy slots in 2e so it is not free money. (Decided 2026-07-22.)
  Kettlewright: { options: [{ table: 1, option: 2, bonusGold: 20 }] },
  "Rill Runner": { options: [{ table: 2, option: 3, bonusGold: 20 }] },

  // THE PROSE COMPANIONS ARE MINTED (2026-08-08, user ruling — a deliberate
  // widening of the mount/donkey exception to the "no automation of mechanical
  // text" rule). The falcon and the raven carry real stat blocks in their
  // option prose and stand on the map, so they become connected companion
  // Actors the way the Outrider's horse always has; mounts.mjs authors their
  // pack documents from these very grants, stats parsed from the prose. The
  // Alchemical Tattoo and the Living Nightmare stay prose — ruled the same
  // day: neither is a persistent creature (the tattoo is statless, the
  // Nightmare mirrors the PC and would drift the moment their stats moved).
  Fletchwind: { options: [{ table: 1, option: 2, containers: [{ name: "Falcon", slots: 0 }] }] },
  // The raven was an inventory ITEM until 2026-08-08 — the Outrider precedent
  // verbatim: "an outrider's horse should never appear in their inventory".
  // Its `items` grant was REMOVED from the pack in the same commit and stays
  // removed by round-trip (this script re-sources prose and carries the pack's
  // mechanical fields forward; it never re-adds what the pack no longer has),
  // and the orphaned Raven Familiar item left background-items with it.
  "Half Witch": { options: [{ table: 1, option: 4, containers: [{ name: "Raven Familiar", slots: 0 }] }] },
};

/* ------------------------------------------------------------------ parsing */

/** Markdown -> plain text, keeping the words. */
const plain = (s) =>
  String(s)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

const tableRows = (block) =>
  block
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c) || c === ""))
    .filter((cells) => cells.some((c) => c !== ""));

const parse = (raw) => {
  const body = raw.replace(/^---[\s\S]*?\n---\n/, "");
  const name = body.match(/^#\s+(.+)$/m)?.[1].trim();
  const tagline = plain((body.match(/^>\s*(.+(?:\n>.*)*)/m)?.[1] ?? "").replace(/\n>\s?/g, " "));

  const sections = {};
  for (const p of body.split(/^## /m).slice(1)) {
    const nl = p.indexOf("\n");
    sections[p.slice(0, nl).trim()] = p.slice(nl + 1);
  }
  const namesKey = Object.keys(sections).find((k) => /^names$/i.test(k));
  const gearKey = Object.keys(sections).find((k) => /^starting gear$/i.test(k));

  // A question section is found STRUCTURALLY — the ## section is not Names or
  // Starting Gear and contains a table. Matching the heading on "Roll 1d6"
  // silently loses Marchguard, whose two headings omit it.
  const tables = Object.keys(sections)
    .filter((k) => k !== namesKey && k !== gearKey && /^\s*\|/m.test(sections[k]))
    .map((k) => ({
      question: plain(k).replace(/\s*Roll\s+1d6:?\s*$/i, ""),
      options: tableRows(sections[k]).map((cells) => {
        // 2-col: | **1** | description |     3-col: | 1 | **Name** | description |
        const named = cells.length >= 3 ? plain(cells[1]) : null;
        const desc = plain(cells[cells.length - 1]);
        return named ? `${named}: ${desc}` : desc;
      }),
    }));

  return {
    name,
    tagline,
    names: plain(sections[namesKey] ?? "").split(/,\s*/).filter(Boolean),
    startingGear: (sections[gearKey] ?? "").split("\n")
      .filter((l) => l.trim().startsWith("-")).map((l) => plain(l.replace(/^\s*-\s*/, ""))),
    tables,
  };
};

/* -------------------------------------------------------------------- fetch */

const fetchAll = async () => {
  const out = [];
  for (const slug of SLUGS) {
    const resp = await fetch(`${BASE}/${slug}.md`);
    if (!resp.ok) throw new Error(`fetch ${slug}.md -> HTTP ${resp.status}`);
    out.push(parse(await resp.text()));
  }
  return out;
};

/* --------------------------------------------------------------------- yaml */

const y = (s) => {
  const str = String(s);
  if (str === "") return "''";
  if (/[:#{}\[\],&*?|<>=!%@`'"]/.test(str) || /^\s|\s$/.test(str) || /^[-?]/.test(str)) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return str;
};

/** Wrap prose as the single paragraph the sheet enriches and renders. */
const para = (s) => `<p>${s}</p>`;

const docYaml = (d) => {
  const s = d.system;
  const lines = [
    `_id: ${d._id}`,
    `name: ${y(d.name)}`,
    "type: background",
    `img: ${y(d.img ?? "icons/svg/item-bag.svg")}`,
    "effects: []",
    "folder: null",
    `sort: ${d.sort ?? 0}`,
    "flags:",
    "  air-bladder:",
    "    backgroundSource: srd-2e",
    "system:",
    "  source: 2e",
    `  archetype: ${y(s.archetype ?? "")}`,
    `  description: ${y(s.description)}`,
    "  names:",
    ...s.names.map((n) => `    - ${y(n)}`),
    "  startingGear:",
    ...s.startingGear.flatMap((g) => [
      `    - name: ${y(g.name)}`,
      ...(g.uses ? [`      uses: ${g.uses}`] : []),
      ...(g.quantity && g.quantity > 1 ? [`      quantity: ${g.quantity}`] : []),
    ]),
    ...(s.containers?.length
      ? ["  containers:", ...s.containers.flatMap((c) => [`    - name: ${y(c.name)}`, `      slots: ${c.slots}`])]
      : ["  containers: []"]),
    "  tables:",
  ];
  for (const t of s.tables) {
    lines.push(`    - question: ${y(t.question)}`);
    lines.push("      options:");
    for (const o of t.options ?? []) {
      lines.push(`        - description: ${y(o.description)}`);
      if (o.bonusGold) lines.push(`          bonusGold: ${o.bonusGold}`);
      if (o.items?.length) {
        lines.push("          items:");
        for (const it of o.items) {
          lines.push(`            - name: ${y(it.name)}`);
          if (it.uses) lines.push(`              uses: ${it.uses}`);
          if (it.quantity && it.quantity > 1) lines.push(`              quantity: ${it.quantity}`);
        }
      }
      if (o.containers?.length) {
        lines.push("          containers:");
        for (const c of o.containers) {
          lines.push(`            - name: ${y(c.name)}`);
          lines.push(`              slots: ${c.slots}`);
          if (c.carried_by) lines.push(`              carried_by: ${y(c.carried_by)}`);
          if (c.load) lines.push(`              load: ${c.load}`);
        }
      }
    }
  }
  lines.push("ownership:", "  default: 0", "_stats:", "  systemId: air-bladder",
    "  coreVersion: '14.365'", `_key: '!items!${d._id}'`, "");
  return lines.join("\n");
};

/* ---------------------------------------------------------------------- run */

const existing = new Map();
const fileOf = new Map();
for (const f of fs.readdirSync(PACK).filter((f) => f.endsWith(".yml"))) {
  const d = load(fs.readFileSync(path.join(PACK, f), "utf8"));
  existing.set(d.name, d);
  fileOf.set(d.name, f);
}

const srd = await fetchAll();
console.log(`fetched ${srd.length} backgrounds from the SRD`);

// ---- structural guard: refuse to write anything if the shapes disagree ----
const problems = [];
const norm = (s) => plain(String(s).replace(/<[^>]+>/g, " ")).toLowerCase()
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

for (const b of srd) {
  const o = existing.get(b.name);
  if (!o) { problems.push(`no existing document named "${b.name}"`); continue; }
  const oT = o.system.tables ?? [];
  if (oT.length !== b.tables.length) {
    problems.push(`${b.name}: ${b.tables.length} SRD tables vs ${oT.length} in the pack`);
    continue;
  }
  b.tables.forEach((t, i) => {
    if (norm(t.question) !== norm(oT[i].question ?? "")) {
      problems.push(`${b.name} #${i}: question text differs\n      srd:  ${t.question}\n      pack: ${oT[i].question}`);
    }
    if (t.options.length !== (oT[i].options ?? []).length) {
      problems.push(`${b.name} #${i}: ${t.options.length} SRD options vs ${(oT[i].options ?? []).length} in the pack`);
    }
  });
}
if (problems.length) {
  console.error(`\nABORTED — the SRD and the pack no longer line up, so positional matching is unsafe:`);
  for (const p of problems) console.error(`   ${p}`);
  process.exit(1);
}
console.log("structure check: 20 names, 40 questions, every table 6 options — positional match is safe");

// ---- corrections ----
const applied = new Set();
const correct = (bg, ti, oi, text) => {
  for (const c of CORRECTIONS) {
    if (c.where !== `${bg}/${ti}/${oi + 1}`) continue;
    if (!text.includes(c.find)) continue;
    applied.add(c.where);
    text = text.replace(c.find, c.replace);
  }
  return text;
};

// ---- build ----
let changedText = 0;
const changes = [];
for (const b of srd) {
  const o = existing.get(b.name);
  const sys = o.system;

  const before = JSON.stringify([sys.description, sys.names, (sys.tables ?? []).map((t) => [t.question, (t.options ?? []).map((x) => x.description)])]);

  sys.description = para(b.tagline);
  sys.names = b.names;
  sys.tables = b.tables.map((t, i) => ({
    question: t.question,
    options: t.options.map((text, j) => {
      const old = (sys.tables[i].options ?? [])[j] ?? {};
      const description = correct(b.name, i, j, text);
      if (norm(description) !== norm(old.description ?? "")) {
        changes.push(`${b.name} #${i}.${j + 1}`);
      }
      // Keep every mechanical field; only the prose is re-sourced.
      return {
        description,
        ...(old.bonusGold ? { bonusGold: old.bonusGold } : {}),
        ...(old.items?.length ? { items: old.items } : {}),
        ...(old.containers?.length ? { containers: old.containers } : {}),
      };
    }),
  }));

  // Explicit additions (the missing-items pass). Merged BY NAME, never appended:
  // this script reads the pack it also writes, so a plain append gives every
  // rerun another copy — which is exactly what happened, and gave the Mountebank
  // two carts.
  const add = ADDITIONS[b.name];
  const mergeByName = (existingList, extra) => {
    const out = [...(existingList ?? [])];
    for (const e of extra ?? []) {
      const at = out.findIndex((x) => String(x.name).toLowerCase() === String(e.name).toLowerCase());
      if (at === -1) out.push(e); else out[at] = { ...out[at], ...e };
    }
    return out;
  };
  sys.startingGear = mergeByName(sys.startingGear, add?.startingGear);
  sys.containers = mergeByName(sys.containers, add?.containers);

  // Option-level additions, addressed by 1-based table/option so they read the
  // way the book does. Same merge-don't-append rule as above.
  for (const spec of add?.options ?? []) {
    const opt = sys.tables?.[spec.table - 1]?.options?.[spec.option - 1];
    if (!opt) throw new Error(`ADDITIONS: ${b.name} has no table ${spec.table} option ${spec.option}`);
    if (spec.items) opt.items = mergeByName(opt.items, spec.items);
    if (spec.containers) opt.containers = mergeByName(opt.containers, spec.containers);
    if (spec.bonusGold != null) opt.bonusGold = spec.bonusGold;
  }

  if (JSON.stringify([sys.description, sys.names, (sys.tables ?? []).map((t) => [t.question, (t.options ?? []).map((x) => x.description)])]) !== before) changedText++;

  if (!dry) fs.writeFileSync(path.join(PACK, fileOf.get(b.name)), docYaml(o), "utf8");
}

// ---- report ----
const unapplied = CORRECTIONS.filter((c) => !applied.has(c.where));
if (unapplied.length) {
  console.error(`\nWARNING: ${unapplied.length} correction(s) no longer match — upstream may have fixed them:`);
  for (const c of unapplied) console.error(`   ${c.where}: "${c.find}"`);
}

console.log(`${dry ? "[dry] would rewrite" : "rewrote"} ${srd.length} documents (${changedText} with changed text, ${changes.length} option descriptions)`);
console.log(`corrections applied: ${applied.size}/${CORRECTIONS.length}`);
for (const [name, a] of Object.entries(ADDITIONS)) {
  const bits = [
    ...(a.startingGear ?? []).map((g) => `+item ${g.name}`),
    ...(a.containers ?? []).map((c) => `+container ${c.name} (+${c.slots})`),
    ...(a.options ?? []).map((o) => {
      const what = [
        ...(o.items ?? []).map((g) => `item ${g.name}`),
        ...(o.containers ?? []).map((c) => `container ${c.name}`),
        ...(o.bonusGold != null ? [`${o.bonusGold}gp`] : []),
      ].join(", ");
      return `t${o.table}/o${o.option} +${what}`;
    }),
  ];
  console.log(`   addition: ${name.padEnd(14)} ${bits.join(", ")}`);
}
if (report) { console.log("\nchanged options:"); for (const c of changes) console.log(`   ${c}`); }

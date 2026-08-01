#!/usr/bin/env node
/**
 * Runs both extractors with the SAME arguments.
 *
 *   node tools/i18n/extract.mjs [--lang es] [--force] [--out DIR]
 *
 * This exists because of a silent failure. package.json used to chain them:
 *
 *   "i18n:extract": "node tools/i18n/extract-ui.mjs && node tools/i18n/extract-content.mjs"
 *
 * and `npm run <script> -- <args>` appends the args to the END of that string,
 * so they reached only extract-content. `npm run i18n:extract -- --lang fr`
 * therefore extracted the UI in SPANISH and the content in FRENCH, with no
 * error — the worst possible outcome, since a translator would fill a mixed set
 * of spreadsheets and only find out on import. `--force` was lost the same way.
 *
 * Exits with the first non-zero status, so the overwrite guard in either
 * extractor still stops the run.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

for (const script of ["extract-ui.mjs", "extract-content.mjs"]) {
  const run = spawnSync(process.execPath, [path.join(here, script), ...args], { stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

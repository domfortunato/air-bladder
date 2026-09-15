/**
 * Release notes come from CHANGELOG.md — the section headed by the version being
 * cut — and travel to GitHub inside the release TAG.
 *
 * `sectionFor(text, version)` returns the section's content: the lines between
 * `## <version>` and the next `## ` heading, trimmed. `null` when the file has no
 * such heading, `""` when the heading has nothing under it; `release.mjs` refuses
 * both, with different messages. `releaseBody(version, section)` is what the
 * GitHub release shows: the `# Air Bladder X.Y.Z` headline every release here
 * has opened with, then the section verbatim. `tagMessage(version, body)` is the
 * annotated tag's message — a subject line, a blank line, the body — which the
 * Release Creation workflow reads back with
 * `git tag -l --format='%(contents:body)'` and hands to the release action, so
 * the notes land in the same API call that attaches the assets.
 *
 * Why the tag carries them and not the file: the workflow could read
 * CHANGELOG.md from the checkout, but the tag OBJECT is what the mirror carries
 * and what a rebuild through workflow_dispatch can read for any past tag without
 * knowing where the notes lived when it was cut. Why a file and not a `-m` flag:
 * the changelog edit is signed off by the user, in a commit, before the tag
 * exists — a flag on a command line offers nothing to sign off on.
 *
 * One trap, handled in release.mjs and worth knowing if a tag is ever made by
 * hand: git's DEFAULT tag-message cleanup (`--cleanup=strip`) drops every line
 * that starts with `#` as a comment, headings included, silently. The tag is
 * made with `--cleanup=whitespace`, which keeps them. Proven in a throwaway
 * clone on 2026-09-15: the same file under each mode, the heading present in one
 * body and gone from the other.
 */

/** A `## X.Y.Z` heading; trailing text on the line (a date, say) is allowed. */
export const HEADING = /^## (\d+\.\d+\.\d+)(?:\s.*)?$/;

export function sectionFor(text, version) {
  const lines = String(text).split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING.exec(lines[i]);
    if (m && m[1] === version) { start = i + 1; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}

export function releaseBody(version, section) {
  return `# Air Bladder ${version}\n\n${section}\n`;
}

export function tagMessage(version, body) {
  return `Air Bladder ${version}\n\n${body}`;
}

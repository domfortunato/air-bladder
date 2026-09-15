# Cutting a release

Releasing Air Bladder is **one command**. The whole thing is driven by pushing a
version tag; GitHub Actions does the build and publish.

```bash
npm run release 0.1.1
```

That script (`tools/release.mjs`):

1. validates the version (`X.Y.Z`, no leading `v`),
2. refuses if the working tree has uncommitted tracked changes or the tag exists,
3. reads the release notes from `CHANGELOG.md` — the `## X.Y.Z` section — and
   refuses without them,
4. bumps `version` in `system.json`,
5. commits `Release X.Y.Z`, creates an annotated tag whose body is the notes, and
   pushes the branch + tag to `origin`.

Then the **"Release Creation"** workflow (`.github/workflows/main.yml`) triggers on
the tag push, builds the packs, zips the system, reads the notes back out of the
tag, and creates the published release with `system.json` + `system.zip` and those
notes as its body — including rewriting the manifest/download URLs. The notes land
in the same call that attaches the assets; nothing is pasted afterwards.

## Release notes

Write them in `CHANGELOG.md` before the merge, under a `## X.Y.Z` heading, newest
section first. What is under the heading is the release body, verbatim, after a
`# Air Bladder X.Y.Z` headline the script adds. `npm run release X.Y.Z --dry-run`
prints the exact body and every check's verdict without writing anything, and it
runs on `dev`, so the notes can be previewed before the merge.

The tag is the carrier: `origin` push-mirrors the tag *object* to GitHub, not just
the ref, so the body travels with it. A release on the Gitea side would not do —
Gitea keeps release notes in its own database, and the mirror moves git refs only.

Two things worth knowing if a tag is ever made by hand. Git's default tag-message
cleanup strips every line beginning with `#` as a comment, headings included, so the
script tags with `--cleanup=whitespace`; do the same. And the workflow's
`omitBodyDuringUpdate` means the tag's body is applied when the release is
*created* and never on a rebuild, so notes edited by hand on the release page
survive `workflow_dispatch`.

## The one rule that keeps releases from breaking

**Never create a release or tag directly on GitHub.** Always tag on the `origin`
side (which is what `npm run release` does). If `origin` is a **push mirror** to
GitHub, the mirror force-syncs refs and will **prune any tag that exists only on
GitHub** — which silently demotes a GitHub-made release to a draft (invisible to
the public and to Foundry). Tagging on `origin` first means the tag exists on the
source, so the mirror carries it to GitHub and protects it.

## Steps

Work lives on `dev`; `master` is the released state. A release is a merge plus a
tag — see [docs/git-flow.md](docs/git-flow.md).

**Run the pre-release checks first** — the full list is
[docs/release-testing.md](docs/release-testing.md). Do it on `dev`, before the merge,
while a failure is still cheap to fix.

**Regenerate the translator's handoff — `npm run i18n:handoff`.** It rewrites
[docs/translation-handoff.md](docs/translation-handoff.md) from the repository, and its
first two parts are the ones no other tool can produce: **strings he already translated
whose English we have since changed.** Neither half of that is a missing key, so neither
falls back to English and neither looks outstanding — an interface string keeps its key
and quietly says the wrong thing, and a content string keeps a key the runtime has
stopped asking for and simply never renders. Commit the regenerated file and send it with
the release. Doing it after the tag is worse than useless: it then describes a release he
was never given the list for.

**Bring `README.es.md` up to date with `README.md`.** Both ship inside `system.zip`,
so whatever the Spanish one says at tag time is what a Spanish reader downloads. It
drifts one English edit at a time, and nothing checks it — `npm run i18n:check` covers
`lang/*.json` only.

**`README.md` is the source of truth, and `README.es.md` is a translation of it — not a
parallel document.** Anything in the Spanish file that is not in the English file does
not belong there; delete it rather than reconcile it. Anything worth saying goes into
`README.md` first and is then translated. Diff both against the previous tag, carry every
change across, and treat version numbers, URLs and the required-Foundry-version line as
facts that must match exactly. [tools/i18n/glossary.tsv](tools/i18n/glossary.tsv) and the
system's own terms (Warden → "Guardián", Hireling → "Seguidor") keep it reading like the
app, which is worth doing but is not a gate.

**No human translator maintains this file** — the README can change every release and
nobody is being asked to keep pace with that. It is project documentation, so translating
it is part of the same commit that changed the English. Do not defer to its existing
wording as though it were someone else's work.

This is the opposite of `lang/es.json` and `lang/content/es.json`, which **are** a human
translator's, are licensed CC BY-SA as derivatives of the game text, and must not be
rewritten. Two files with "es" in the name, two different regimes — see
[docs/i18n-maintainer.md](docs/i18n-maintainer.md).

1. Write the release notes in `CHANGELOG.md` under `## X.Y.Z` and commit them on
   `dev` (see "Release notes" above). `npm run release X.Y.Z --dry-run` shows the
   body the release will carry.
2. Merge the work into `master` and make sure it is current:
   ```bash
   git checkout master && git pull && git merge dev
   ```
3. `npm run release X.Y.Z` — it refuses to run anywhere but `master`, refuses
   without the notes, and prints the commits it is about to ship. An empty list
   means step 2 did not happen.
4. **If `origin` mirrors to GitHub**, make sure the mirror syncs the new tag
   (enable "sync on push" once, or trigger a sync). If `origin` *is* GitHub, skip
   this — the tag is already there.
5. Watch the **Actions** tab: the *Release Creation* run should go green in ~1–2
   minutes and produce a release with two assets and the notes as its body.
6. Verify the install manifest returns **200**:
   `https://github.com/<owner>/<repo>/releases/latest/download/system.json`
7. **Sync `dev`, or the next merge conflicts.** The release commit bumps
   `system.json` on `master` only, so `dev` is behind by that line every time:
   ```bash
   git checkout dev && git merge master && git push origin dev
   ```

Don't merge and then sit on it. The website redeploys from `master` on the merge
while users still install the previous tag, so a delay between step 2 and step 3
publishes documentation for a version nobody can install yet.

## Rebuilding / recovering a release

If a release's assets are missing or you need to rebuild without a new version:
**Actions → Release Creation → Run workflow → enter the tag → Run.** This
`workflow_dispatch` path (re)builds and re-attaches the assets to the existing tag.
It checks out the TAG you enter, whichever branch the Run-workflow dialog shows —
that picker only chooses which copy of the workflow file runs, never what is built.

## Redoing a version

Delete the tag on both sides, then re-run:

```bash
git tag -d X.Y.Z
git push origin :refs/tags/X.Y.Z
# then `npm run release X.Y.Z` again
```

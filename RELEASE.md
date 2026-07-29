# Cutting a release

Releasing Air Bladder is **one command**. The whole thing is driven by pushing a
version tag; GitHub Actions does the build and publish.

```bash
npm run release 0.1.1
```

That script (`tools/release.mjs`):

1. validates the version (`X.Y.Z`, no leading `v`),
2. refuses if the working tree has uncommitted tracked changes or the tag exists,
3. bumps `version` in `system.json`,
4. commits `Release X.Y.Z`, creates an annotated tag, and pushes the branch + tag
   to `origin`.

Then the **"Release Creation"** workflow (`.github/workflows/main.yml`) triggers on
the tag push, builds the packs, zips the system, and creates the published release
with `system.json` + `system.zip` — including rewriting the manifest/download URLs.

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

**Bring `README.es.md` up to date with `README.md`.** Both ship inside `system.zip`,
so whatever the Spanish one says at tag time is what a Spanish reader downloads. It
is hand-maintained and nothing checks it — `npm run i18n:check` covers `lang/*.json`
only — so it drifts one English edit at a time. Diff both against the previous tag,
carry the changes across using [tools/i18n/glossary.tsv](tools/i18n/glossary.tsv) for
terminology, and treat version numbers, URLs and the required-Foundry-version line as
facts that must match exactly. Add and correct; don't re-voice the translator's
existing wording.

1. Merge the work into `master` and make sure it is current:
   ```bash
   git checkout master && git pull && git merge dev
   ```
2. `npm run release X.Y.Z` — it refuses to run anywhere but `master`, and prints
   the commits it is about to ship. An empty list means step 1 did not happen.
3. **If `origin` mirrors to GitHub**, make sure the mirror syncs the new tag
   (enable "sync on push" once, or trigger a sync). If `origin` *is* GitHub, skip
   this — the tag is already there.
4. Watch the **Actions** tab: the *Release Creation* run should go green in ~1–2
   minutes and produce a release with two assets.
5. Verify the install manifest returns **200**:
   `https://github.com/<owner>/<repo>/releases/latest/download/system.json`
6. (Optional) add release notes on the GitHub release. Rebuilds preserve them
   (`omitBodyDuringUpdate`).
7. **Sync `dev`, or the next merge conflicts.** The release commit bumps
   `system.json` on `master` only, so `dev` is behind by that line every time:
   ```bash
   git checkout dev && git merge master && git push origin dev
   ```

Don't merge and then sit on it. The website redeploys from `master` on the merge
while users still install the previous tag, so a delay between step 1 and step 2
publishes documentation for a version nobody can install yet.

## Rebuilding / recovering a release

If a release's assets are missing or you need to rebuild without a new version:
**Actions → Release Creation → Run workflow → enter the tag → Run.** This
`workflow_dispatch` path (re)builds and re-attaches the assets to the existing tag.

## Redoing a version

Delete the tag on both sides, then re-run:

```bash
git tag -d X.Y.Z
git push origin :refs/tags/X.Y.Z
# then `npm run release X.Y.Z` again
```

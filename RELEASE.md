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

1. Be on your main branch with a clean tree; `git pull` so it's current.
2. `npm run release X.Y.Z`
3. **If `origin` mirrors to GitHub**, make sure the mirror syncs the new tag
   (enable "sync on push" once, or trigger a sync). If `origin` *is* GitHub, skip
   this — the tag is already there.
4. Watch the **Actions** tab: the *Release Creation* run should go green in ~1–2
   minutes and produce a release with two assets.
5. Verify the install manifest returns **200**:
   `https://github.com/<owner>/<repo>/releases/latest/download/system.json`
6. (Optional) add release notes on the GitHub release. Rebuilds preserve them
   (`omitBodyDuringUpdate`).

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

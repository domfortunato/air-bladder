# Branches and releases

Two long-lived branches, and one direction of travel.

| Branch | Holds | Who pushes |
|---|---|---|
| `master` | the released state — what the current version actually is | merges from `dev`, plus the release commit |
| `dev` | everything in progress | all work, all fixes, all docs |

`dev` is permanent. It is never renamed and never deleted. Releases happen by merging
`dev` into `master` and tagging — whenever the work is worth shipping, which may be three
times in a week or once in three.

## Why master is kept clean

**Documentation stays in step with the software.** The README you see on GitHub, the
`blob/master/docs/...` links inside it, and the project website (built from `master` by
`.github/workflows/pages.yml`) all track `master` — while users install the latest *tag*.
If work landed directly on `master`, the public docs would describe features nobody can
install yet. Keeping unreleased work on `dev` closes that gap.

**And `dev` is something people can actually test.** It is mirrored to GitHub within
seconds of a push, so anyone can clone it and run unreleased code — see
[Testing unreleased work](#testing-unreleased-work).

## Everything goes through `dev`

Features, bug fixes, documentation, typos. There are no exceptions, because an exception
is a rule waiting to be forgotten.

**We do not ship hotfixes.** A released version is never patched. If something needs
fixing it is fixed on `dev` and goes out with the next release. This deletes the classic
failure of this branch model — a fix applied to `master` and never merged back — because
nothing is ever applied to `master` directly.

The cost is that a README typo waits for the next release. That is cheaper than a second
code path nobody remembers.

## Day to day

```sh
git checkout dev
# work, commit, push
git push origin dev
```

That is the whole loop. `origin` is Gitea, which is both the backup and the mirror to
GitHub — so pushing to `dev` backs the work up *and* publishes it for testers in one step.

## Releasing

```sh
git checkout master
git merge dev
npm run release 0.1.8        # bumps system.json, commits, tags, pushes to origin
git checkout dev
git merge master             # REQUIRED — see below
git push origin dev
```

`npm run release` refuses to run anywhere but `master`, and prints the commits it is about
to ship so a forgotten merge is visible before the tag exists rather than after.

**Merge `master` back into `dev` after every release.** The release commit bumps
`version` in `system.json` on `master` only, so `dev` is behind by that one line every
single time — and the next merge conflicts on exactly it. This is the only `master` → `dev`
sync the no-hotfix policy leaves, and it is not optional.

**Merge and release together.** Merging `dev` into `master` and then waiting days to tag
re-creates the documentation drift this model exists to prevent, because the website
redeploys from `master` on the merge. Tag straight after the merge.

## Continuous integration

Nothing runs on a push to `dev` — the workflows trigger on `master`, on pull requests
targeting `master`, and on version tags. So keep a **standing draft pull request from
`dev` into `master`**. `pull_request` events fire on every push to the head branch, so the
PR re-runs CodeQL on each push to `dev`, and doubles as a live diff of what is queued for
the next release. Never merge it through GitHub — see below.

## Testing unreleased work

`dev` is public on GitHub. To run it:

```sh
git clone -b dev https://github.com/domfortunato/air-bladder.git
cd air-bladder
npm install
npm run build:packs
```

**The build step is not optional.** `system.json` declares 22 compendium packs, and none
of them are in git — `packs/` is generated LevelDB, built from the YAML in `src/packs/`.
An unbuilt clone loads with every compendium empty, which looks broken rather than
unfinished.

Point Foundry at the result with a directory junction (Windows) or a symlink into
`Data/systems/air-bladder`.

A branch is not an install route for ordinary users, by construction: every branch's
committed `system.json` still points `download` at the latest *release* zip, so a manifest
install aimed at a branch fetches the release instead.

## Two things that are never done

**Never create a tag or a release on GitHub.** `origin` (Gitea) push-mirrors to GitHub and
the mirror force-syncs refs, so anything existing only on GitHub is pruned on the next
sync. A GitHub-made tag disappears and silently demotes its release to a draft — invisible
to the public and to Foundry. Tag on `origin` and the mirror carries it. `npm run release`
does this correctly; see `RELEASE.md`.

**Never merge a pull request with GitHub's merge button**, for the same reason. Fetch it,
merge locally, push to `origin`. The recipe is in [i18n-maintainer.md](i18n-maintainer.md)
under "Merging a pull request" — it applies to every pull request, not just translations.

## Switching branches with Foundry running

The dev world loads this working tree through a directory junction, so `git checkout`
swaps the system underneath a running Foundry. If the branches differ in `src/packs/`,
`packs/` is left stale and must be rebuilt — and `npm run build:packs` fails with a
LevelDB `EPERM` while a world is open.

So when a switch crosses a content change: stop Foundry, check out, rebuild, restart.
Most switches do not need it; content changes are rare but large when they happen.

# Contributing

Contributions are welcome — translations especially, but also fixes, docs and code.

## Open pull requests against `dev`, not `master`

`master` holds the released state. All work lands on **`dev`**.

A pull request opened against `master` will be asked to retarget, and it will sit
unmerged until the next release rather than being merged when it is ready. Targeting
`dev` gets it merged as soon as it is reviewed.

The full branch model is in [docs/git-flow.md](docs/git-flow.md).

## Running unreleased code

`dev` is where in-progress work lives, and it is public. To try it:

```sh
git clone -b dev https://github.com/domfortunato/air-bladder.git
cd air-bladder
npm install
npm run build:packs
```

**Do not skip `npm run build:packs`.** `system.json` declares 22 compendium packs and
none of them are stored in git — they are generated from the YAML in `src/packs/`. Without
that step the system loads with every compendium empty, which looks like a broken build
rather than an unfinished one.

Then point Foundry at the folder: a directory junction (Windows) or symlink into
`Data/systems/air-bladder`. `npm run dev:smoke` drives a headless load as a sanity check.

Requires Node 24.x and Foundry v14.

## Translations

Two routes, depending on how you like to work:

- **No coding** — [docs/TRANSLATING.md](docs/TRANSLATING.md). You fill in a spreadsheet and
  send it back; we load it.
- **In git** — [docs/translating-self-service.md](docs/translating-self-service.md). Run the
  extract tooling, translate, commit the generated JSON, open a pull request against `dev`.
  One pack per pull request keeps review manageable.

The tooling is language-agnostic — a new language needs a translator, not code changes.

Note that content translation is keyed on the **English source string**, so editing an
English description orphans its translation. If a change touches English pack prose, say so
in the pull request.

## Reporting problems

Open an issue on GitHub. Useful things to include: your Foundry version, the system
version (Game Settings → System), what you expected, and anything in the browser console
(F12) that looks related.

## How merges happen

Pull requests are merged **locally and pushed to the upstream Gitea repository**, not with
GitHub's merge button — the repository mirrors from Gitea, and a merge made on GitHub would
be overwritten on the next sync. This is invisible to you: GitHub marks your pull request
merged once the commit arrives, usually within seconds.

**Please don't close your own pull request** if it looks like nothing happened. It closes
itself when the merge lands.

## Licensing

By contributing you agree your work ships under the licences this project already uses:
**MIT** for code, **CC BY-SA 4.0** for game text and translations (as derivatives of Cairn
by Yochai Gal). See the credits in [README.md](README.md) — attribution is kept for every
contributor, and translators are credited by name.

Please don't add generative-AI artwork. It will not be accepted.

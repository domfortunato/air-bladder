# Running the probes on the fleet

The probe fleet runs this repo's whole e2e suite on the homelab cluster, eleven probes at a time:
78 probes in about four minutes, against an hour or more one by one on CT 123. This page covers
starting a run from here, reading what it found, and where the suite stands.

The fleet's machinery (the probe boxes, their baseline world, the runner) belongs to the ops repo,
`c:\Users\domin\code\foundry` (Gitea `fortunato/foundry-ops`): `runbooks/foundry-probe-boxes.md` and
`docs/fleet-runner-ct120.md` there. Change the fleet from that repo, not from here. What is wrong with
a probe, the dev world or the system is this repo's to fix.

## What a run does

- **CT 120** (`fleet@192.168.30.50`) conducts. It starts runs, collects the logs and writes the report.
- **Eleven probe boxes** (CT 112 to 118, 129 to 131 and 138) each run Foundry 14.368 with this system's
  world `air-bladder-dev`, served by the PM2 app `foundry-air-bladder` from `/home/foundry/probe-air-bladder`.
  Nobody plays on them.
- **The browsers run on VM 200's RTX 3060**, one Playwright container per probe. Air Bladder runs only
  there, never on the driver boxes.
- **A run** rolls every box back to its `pristine` snapshot and deploys the ref under test into the box's
  system folder. It then runs several probes per box in turn, **with no reset between them**.
- **Which probes run:** every `dev:` script in `package.json` whose command runs a `tools/dev/e2e-*.mjs`
  file, so a new probe joins the fleet just by being declared there. That is 78 of the 108 `dev:` scripts.
  `dev:world` is a listing and runs once, last.
- **`pristine` holds a copy of CT 123's dev world as it stood on 2026-10-21.** Anything that world held
  then is in every box at the start of every run: your own tables, or a fixture some probe stranded.

## Starting a run

**Push first.** The boxes fetch the ref from Gitea, so your working tree is not what runs.

```sh
ssh fleet@192.168.30.50 foundry/scripts/fleet-runner.sh start --project air-bladder --ref dev
ssh fleet@192.168.30.50 foundry/scripts/fleet-runner.sh start --project air-bladder --ref <branch|sha> --probes spell-pool,spellscroll
ssh fleet@192.168.30.50 foundry/scripts/fleet-runner.sh status   # the run going now, if any
ssh fleet@192.168.30.50 foundry/scripts/fleet-runner.sh last     # the newest report of ANY project: its verdict and path
```

- `start` prints the run id (`<UTC stamp>-air-bladder-<ref>`, e.g. `20261022T005857Z-air-bladder-dev`)
  and returns at once. The run carries on when your shell closes.
- `--probes` takes the names without `dev:`.
- **One run at a time, for every project.** `start` refuses while another run is going. DB Mythic shares
  the fleet.
- **`--refresh`** deploys, settles the world, then retakes every box's `pristine` at that ref. It is due
  after a release. It changes the baseline that every later run starts from, so it is never a way to
  make a red go away.
- The runner accepts only `--project`, `--ref`, `--probes`, `--jobs`, `--refresh` and `--skip-nodes`
  here. It only reports: it never pushes code.

**While a run is going, stay off the probe boxes.** Do not open, script or query a box's `:30000`. A second
GM client in the world is the two-brokers confound, and it leaves the failure it causes unattributable.

## Reading the result

- **The run's folder on CT 120**, `/srv/fleet/runs/<id>/`, holds:
  - `report.md`, which quotes every failing check with its line number;
  - `results.tsv`: probe, box, exit code, seconds, checks passed, class;
  - one `<probe>.log` per probe, with its full output;
  - `shots/`, screenshots of the probes that did not pass;
  - `conductor.log` and `meta.json`.

  ```sh
  ssh fleet@192.168.30.50 cat /srv/fleet/runs/<id>/report.md
  ssh fleet@192.168.30.50 cat /srv/fleet/runs/<id>/spell-pool.log
  ```
- **On Gitea**, `fortunato/ops-reports` has `reports/fleet/<id>.md`, with the run's data under
  `data/fleet/<id>/`.
- **In Grafana**, http://192.168.30.140:3000, the dashboard "Fleet, nightly and infra checks" opens on
  whichever project finished last. Its **Project** dropdown shows the other.

**A red's first triage step is a solo re-run** (`--probes <name>`), because passing alone is not passing
in a batch. A red on a different box in each run, with the same message every time, points at the
baseline world. A red that follows one box's queue points at an earlier probe on that box that leaked
something.

## Where things stand (2026-10-22)

**78/78 at `dev` `05e28ef5`**, in four minutes (run `20261022T013237Z-air-bladder-05e28ef5`).

The two full runs before it, at `cf4c1616`, both went 72/78 with the same six reds (`bond-dupes`,
`companions`, `spellscroll`, `spell-pool`, `reroll-dialog`, `print`), each on a different box the second
time. The cause was the baseline world: it holds a Warden's take-over copies ("Bonds", "Omens",
"Spells — Canon (1d100)", the spellbooks including "Adhere") and one stranded `ZZ` scene, and the probes
found documents by name. `05e28ef5` made the probes indifferent to that rather than cleaning the world.
They set same-named world tables aside for the page's life (`holdAsideWorldTables` in `tools/dev/lib.mjs`)
and read their own fixtures back by id. `print` now finds its own band instead of trusting one font stack.
The commit message has the probe-by-probe account.

**One open flake:** in that run `directory-buttons` died once with "Execution context was destroyed" and
passed on the runner's automatic re-run. Neither page navigated or crashed, so it is the collected-promise
flake that DB Mythic met, not a race in this code. `8fe360ff` routes the probe's settings writes through
`writeInPage` (`tools/dev/lib.mjs`), DB Mythic's containment. The flake does not reproduce on demand, so
the fix cannot be shown turning a red green. A strike on a write that does not go through the helper is
the thing to watch for.

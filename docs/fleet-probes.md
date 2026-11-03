# Running the probes on the fleet

The probe fleet runs this repo's whole e2e suite on the homelab cluster, eleven probes at a time:
104 probes in about five minutes, against an hour or more one by one on CT 123. This page covers
starting a run from here, reading what it found, and where the suite stands.

The fleet's machinery (the probe boxes, their baseline world, the runner) belongs to the ops repo,
`c:\Users\domin\code\foundry` (Gitea `fortunato/foundry-ops`): `runbooks/foundry-probe-boxes.md` and
`docs/fleet-runner-ct120.md` there. Change the fleet from that repo, not from here. What is wrong with
a probe, the dev world or the system is this repo's to fix.

## What a run does

- **CT 120** (`fleet@192.168.30.50`) conducts. It starts runs, collects the logs and writes the report.
- **Eleven probe boxes** (CT 112 to 118, 129 to 131 and 138) each run Foundry 14.369 (since 2026-10-28)
  with this system's world `air-bladder-dev`, served by the PM2 app `foundry-air-bladder` from
  `/home/foundry/probe-air-bladder`. Nobody plays on them.
- **Each box also carries the older builds in the test window** (CLAUDE.md, *Version reality*: the newest
  stable build and the two before it). Since 2026-11-03 that is 14.368, as its own fleet project,
  `air-bladder-14368`: the app `foundry-air-bladder-14368` from `/opt/foundry-14.368`, with its own
  world in `/home/foundry/probe-air-bladder-14368`. Same repo, same probes, its own run ids.
- **The browsers run on VM 200's RTX 3060**, one Playwright container per probe. Air Bladder runs only
  there, never on the driver boxes.
- **A run** rolls every box back to its `pristine` snapshot and deploys the ref under test into the box's
  system folder. It then runs several probes per box in turn, **with no reset between them**.
- **Which probes run:** every `dev:` script in `package.json` whose command runs a `tools/dev/e2e-*.mjs`
  file, so a new probe joins the fleet just by being declared there. That is 104 of the 109 `dev:` scripts:
  the ops registry leaves out `dev:upgrade`, and `dev:smoke`, `dev:site`, `dev:actors` and `dev:players`
  are not probes.
- **`pristine` holds a copy of CT 123's dev world as it stood on 2026-10-21**, launched once at 14.369 on
  2026-10-30. Anything that world held then is in every box at the start of every run: your own tables,
  or a fixture some probe stranded. The 14.368 project's world is the same dev world as 14.368 last saved
  it, from CT 123's backup of 2026-10-30 taken before the 14.369 move: an older build must open a world
  that build saved, never one a newer build has migrated.
- **After the boxes move to a new Foundry build, this world must be launched by hand on each box** and
  `pristine` retaken. Foundry never auto-launches a world last saved by an older build, and `--refresh`
  does not launch it. The symptom is a run that sets up no box: every box's log says
  `The requested World "air-bladder-dev" is not available to auto-launch`. The ops runbook
  (`runbooks/foundry-probe-boxes.md`) has the recipe. The 14.369 move on 2026-10-28 launched only DB
  Mythic's world, and the next Air Bladder run (`20261030T172901Z-air-bladder-dev`) failed exactly so.

## Starting a run

**Push first.** The boxes fetch the ref from Gitea, so your working tree is not what runs.

```sh
ssh fleet@192.168.30.50 foundry/scripts/fleet-runner.sh start --project air-bladder --ref dev
ssh fleet@192.168.30.50 foundry/scripts/fleet-runner.sh start --project air-bladder --ref <branch|sha> --probes spell-pool,spellscroll
ssh fleet@192.168.30.50 foundry/scripts/fleet-runner.sh start --project air-bladder-14368 --ref dev   # the same, on Foundry 14.368
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

## Where things stand (2026-11-03)

**Review #34 is on `dev` (`f897ef34`), and the whole suite is green on both builds in the window:
104/104 on 14.369** (run `20261103T021431Z-air-bladder-f897ef34…`) **and 104/104 on 14.368**
(`20261103T022052Z-air-bladder-14368-f897ef34…`). On the branch before the merge: 104/104 on 14.369 at
`7e2a5b65` and `05e12621` (`20261102T225542Z`, `20261102T230147Z`); the first 14.368 run, with
`--refresh` at `be3cb71c`, went 103/104 (`20261103T011106Z`).

- **One open intermittent, `bg-picker`:** "an instruction row was dropped: 1 items for 2 references". A
  Barebones Merchant swapped in got its Stylus but nothing from its "Random Additional Gear" row, and
  nothing was warned. Seen three times, on both builds (`20261101T121856Z` on 14.369, gnoll; on 14.368
  `20261103T011106Z`, CT 130, and `20261103T020137Z`, troll), green on every re-run. The table is not
  the cause (the shipped copy, 100 rows, none drawn, rolled healthy right after a red), nor a world
  table, a pinned die or an earlier probe on the box. On its next red the probe records, in the FAIL
  line's `diag`, what each roll resolved to on the generator's own path (`54a53cef`). Read that before
  theorising.

## Before that (2026-11-02)

**104 probes on Foundry 14.369 at `review-34`: 101/104 at `9f76958e`** (run
`20261102T035401Z-air-bladder-9f76958e`), and the three reds green on a re-run at `b26c7e92`
(`20261102T040901Z`). Two were legs still asserting what review #34's rulings changed (a re-roll
deleting a granted beast; the Warden's choice reply as a bare `false`); the third, content-overlay's
10-minute hang, was a closing DialogV2 taken for the one it was waiting on. Before that, 103/103 at
`8be613b5` (`20261030T205104Z-air-bladder-review-34`).

- **The 25 probes that never ran here now do.** Their files did not match `e2e-*.mjs`. They are renamed
  after their `dev:` scripts (`e2e-combat-options.mjs`, …), and each has a `watchdog()` (`3301fafc`).
- **14.369's join form** is a dropdown again, named `userId`, and it disables a user who is already in the
  world. `chooseJoinUser` in `tools/dev/lib.mjs` handles both (`f98cdae9`).
- **The first full run on 14.369 went 98/103** (`20261030T202049Z`). All five reds were the probes', not
  the system's. Three met the baseline world's take-over copies again: the 2e trait tables and Scars,
  "Omens", and a world Transports & Containers aisle selling a world Mule. Two assumed a random roll
  that usually comes up: a Mountebank's Cart, and an NPC rolled as a Lord or a Politician, who is handed
  nothing. `8be613b5` has the account.

**2026-10-22: 78/78 at `dev` `05e28ef5`**, in four minutes (run `20261022T013237Z-air-bladder-05e28ef5`).

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

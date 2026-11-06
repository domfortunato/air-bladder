# Running the probes on the fleet

The probe fleet runs this repo's whole e2e suite on the homelab cluster, eleven probes at a time:
105 probes in about five minutes, against an hour or more one by one on CT 123. This page covers
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
  file, so a new probe joins the fleet just by being declared there. That is 105 of the 110 `dev:` scripts:
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
  - `shots/`, screenshots of the probes that did not pass, and beside them each one's
    `chromium-<pid>.log` (Chromium's stderr, so its GPU errors, with each page's console echoed into the
    same timeline; since 2026-11-06). Read it first when a page reports a WebGL or shader failure. Its
    "GPU stall due to ReadPixels" ERROR lines are performance notices and turn up in every run;
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

## Where things stand (2026-11-06)

**Rest follows Cairn as written (`f1c6fa4e`), and its red leg came first (`a127f482`).** At the red leg
`rest`, `changelog` and `ui-parity` failed on exactly the Rest checks and nothing else
(`20261106T135921Z`). At the fix: **104/104 on 14.369** (`20261106T140908Z`) **and 103/104 on 14.368**
(`20261106T141700Z`), the one red `changelog`, green solo (`20261106T142404Z`).

- **A GPU-side failure, not understood: the second of its kind.** On 14.368 `changelog` passed all 24
  behaviour checks and failed "zero console errors on either client": Alice's page threw "Error creating
  WebGL context" from Dice So Nice's `DiceScene.initialize` (its `WebGLRenderer`). It is the same class as
  `kw-player-import`'s three shader errors (`20261103T033542Z`, below). Both were goblin's worker and both
  14.368 runs; at two events those are about 1 in 11 and 1 in 14 by chance, so neither is evidence.
  - **Not the driver:** VM 200's kernel log (readable as `dom`, covering both moments, the NVIDIA module
    loaded since 10-31) has no Xid or NVRM line.
  - **Not plain memory:** peak GPU memory in those two runs, 10.54 and 9.30 GiB of 12, sits mid-to-low
    among 27 full runs, and the highest (11.50) was clean. That is at Prometheus's 15 s step, which can
    miss a spike.
  - **What was missing is Chromium's own account.** Since ops `d56b4bd` every GPU probe writes
    Playwright's `pw:browser` channel, which carries Chromium's stderr, to `shots/<probe>/chromium-<pid>.log`,
    and a non-passing probe's shots come back to CT 120. (`chrome-headless-shell` ignores `--log-file`,
    measured.) Proven on a real run: `changelog` 25/25, a 345-line log beside its shots, the probe's own
    log unchanged (`20261106T144340Z`). A repeat will say what the GPU process saw. Until then the cause is unknown; it is the
    browser's WebGL, not this system's code.
- **The 0.1.26 release head, `c67def2c`: 104/104 on 14.369** (`20261106T150807Z`) **and, with
  `--refresh`, 104/104 on 14.368** (`20261106T152028Z`). Its first 14.369 run never started: CT 138's
  setup sat seven minutes in `npm install @foundryvtt/foundryvtt-cli` on one registry request that
  never answered (the registry itself answered the box in 0.56 s), and `deploy-system.sh` runs that
  install with no timeout, so the run waited until the process was killed (`20261106T145818Z`, "setup
  failed: ct138"). CT 138 reinstalled because its `pristine` predated a `package.json` change. Both
  projects' `pristine` was retaken at `c67def2c` on every box by the two `--refresh` runs. The missing
  timeout is an ops fix, not yet made.
- **`grimoire`'s red in the 14.369 `--refresh` (`20261106T152655Z`, 103/104) was the probe navigating
  Alice twice.** It called `goto(FOUNDRY_URL)` and then `joinAs`, which opens `/join` itself, so the
  first load was cut off mid-boot and its cancelled `lang/en.json` fetch logged "Unable to load requested
  localization file". The Chromium log's first use on the fleet showed it: the banner, then
  "Initializing", then the failure, then the banner again. The redundant `goto` went from three sites
  (`82ed5cf9`); `grimoire` 139/139 and `encounters` 37/37 on both builds (`20261106T153536Z`,
  `20261106T153721Z`).

- **After 0.1.26: the Barebones kit re-roll (`8485a0be`) and the join-helper settle (`d184a8ff`).**
  The red leg (`0f72450d`, `20261106T173129Z`) failed `reroll-dialog` on exactly its five new kit checks.
  The first whole run at the fix (`20261106T173352Z`, 14.369) went 27/104 not passing, mostly crashes:
  another session's ComfyUI held 9.3 GB of the card for its first five minutes, so it is no evidence
  either way. At `d184a8ff`: **104/104 on 14.368** (`20261106T175357Z`) and 103/104 on 14.369
  (`20261106T174809Z`), the one red `hazard`, green solo (`20261106T180021Z`).
- **That `hazard` red is the third GPU-side failure, and the first with the GPU process's own account.**
  All 49 behaviour checks passed; at 17:50:53 Chromium logged `CreateSharedImage: could not create
  backing` and `SharedImageStub: Unable to create shared image`, then four `CONTEXT_LOST_WEBGL`, and
  Foundry's "Failed drawing visibility canvas group: The sync object has failed to wait" failed the
  console check. A backing that cannot be created is an allocation failure. It fell in the run's opening
  burst, when all eleven containers start together: the card went 0.21 → 7.98 GiB at 17:49:45 and read
  8.85 GiB at 17:50:45 and 9.97 at 17:51:15, of 12, with the other session holding 0.2-0.3 GB. The 15 s
  samples cannot show a spike between them, so "the card ran out at the start" is the leading reading,
  not a measured one. Both earlier GPU reds also came in a run's first minutes. If it repeats, the fleet's
  side of it is `FLEET_GPU_JOBS` (11 on a 12 GB card) or staggering the starts; that is an ops decision.
- **The `use-bonds` switch (`5e83bea8`) and its probe `bonds-off`, the 105th.** The red leg (`14ff333f`,
  `20261106T183244Z`) failed registration and all eleven bonds-off checks, its on-controls green. At the
  fix: **105/105 on 14.369** (`20261106T183444Z`) **and 105/105 on 14.368** (`20261106T184042Z`).

## Before that (2026-11-03)

**Review #34 is on `dev` (`f897ef34`), and the whole suite is green on both builds in the window:
104/104 on 14.369** (run `20261103T021431Z-air-bladder-f897ef34…`) **and 104/104 on 14.368**
(`20261103T022052Z-air-bladder-14368-f897ef34…`). On the branch before the merge: 104/104 on 14.369 at
`7e2a5b65` and `05e12621` (`20261102T225542Z`, `20261102T230147Z`); the first 14.368 run, with
`--refresh` at `be3cb71c`, went 103/104 (`20261103T011106Z`).

- **`bg-picker`'s intermittent was the probe's own count, and is fixed (`26f225b8`).** It read "an
  instruction row was dropped: 1 items for 2 references" in 3 of 31 runs, on both builds
  (`20261101T121856Z`, `20261103T011106Z`, `20261103T020137Z`). No grant was lost. Light and rations come
  from a background chip-less, tagged `background-mundane`, and the probe counted `background` alone, so
  a Merchant whose Additional Gear roll came up a Lantern, a Torch or rations (about one swap in twenty)
  read as short. Twenty traced swaps caught it (`20261103T030339Z`); a leg now pins that roll onto the
  Lantern, red with the old count (`68b29f14`, `20261103T030759Z`) and green with both tags. At the fix:
  104/104 on 14.369 (`20261103T031149Z`).
- **One unexplained red on 14.368 at the fix (`20261103T031739Z`, 103/104):** `combat-options` opened a
  second browser to join as Alice, and the join page drew no user control in 30 s. It had passed in both
  earlier 14.368 runs and passed three solo re-runs on the same box (`20261103T032406Z`, `…032741Z`,
  `…033117Z`). There was no screenshot and the box's logs were rolled back, so the join helper now says
  what the page showed when its control never comes (`tools/dev/lib.mjs`, `chooseJoinUser`). A repeat
  will name its cause; until then it is a one-off with no evidence either way.
- **`spell-pool`'s one red was its own odds, and is fixed (`fbcc205b`).** On 14.369 (`20261103T034128Z`)
  twelve draws from a planted world spell table came back `["Raise Dead", null]`. That table is a text
  row, a Dagger and the spell, and the generator deals nothing after 20 non-spell rolls (it warns), so a
  random draw was null once in about 3,300 and the leg red about once in 120 runs. The draws are now
  pinned to text row, Dagger, spell, and the cap has a check of its own. Green on both builds
  (`20261103T035619Z`, `20261103T035752Z`).
- **`kw-player-import` once on 14.368 (`20261103T033542Z`):** all 21 checks passed, and the run failed on
  three "PixiJS Error: Could not initialize shader" console errors from the browser on VM 200's GPU, a
  first in any fleet run. Noted, not chased: it is the browser's WebGL, not this code.

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

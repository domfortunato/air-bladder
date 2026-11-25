# Running the probes on the fleet

The probe fleet runs this repo's whole e2e suite on the homelab cluster, eleven probes at a time:
113 probes in about seven minutes, against an hour or more one by one on CT 123. This page covers
starting a run from here, reading what it found, and where the suite stands.

The fleet's machinery (the probe boxes, their baseline world, the runner) belongs to the ops repo,
`c:\Users\domin\code\foundry` (Gitea `fortunato/foundry-ops`): `runbooks/foundry-probe-boxes.md` and
`docs/fleet-runner-ct120.md` there. Change the fleet from that repo, not from here. What is wrong with
a probe, the dev world or the system is this repo's to fix.

## What a run does

- **CT 120** (`fleet@192.168.30.50`) conducts. It starts runs, collects the logs and writes the report.
- **Eleven probe boxes** (CT 112 to 118, 129 to 131 and 138) each run the newest stable Foundry build
  (14.370 since 2026-11-09) with this system's world `air-bladder-dev`, served by the PM2 app
  `foundry-air-bladder` from `/home/foundry/probe-air-bladder`. Nobody plays on them.
- **Each box also carries every older build the system supports** (CLAUDE.md, *Version reality*: every
  14 stable build from 14.368 onward, ruled 2026-11-09; none drops out). Each is its own fleet project:
  `air-bladder-14369` (since 2026-11-09) and `air-bladder-14368` (since 2026-11-03), each with its app
  `foundry-air-bladder-<build>` from `/opt/foundry-<version>` and its own world in
  `/home/foundry/probe-air-bladder-<build>`. Same repo, same probes, their own run ids. **A release
  runs the whole suite on all three.**
- **The browsers run on VM 200's RTX 3060**, one Playwright container per probe. Air Bladder runs only
  there, never on the driver boxes.
- **A run** rolls every box back to its `pristine` snapshot and deploys the ref under test into the box's
  system folder. It then runs several probes per box in turn, **with no reset between them**.
- **Which probes run:** every `dev:` script in `package.json` whose command runs a `tools/dev/e2e-*.mjs`
  file, so a new probe joins the fleet just by being declared there. That is 113 of the 117 `dev:` scripts
  (counted 2026-11-21, with `dev:party-sheet` and `dev:light-uses` the newest):
  the ops registry leaves out `dev:upgrade`, and `dev:smoke`, `dev:actors` and `dev:players`
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
ssh fleet@192.168.30.50 foundry/scripts/fleet-runner.sh start --project air-bladder-14369 --ref dev   # the same, on Foundry 14.369
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

## Review #37, on all three builds (2026-11-24)

**Still 113 probes. The whole suite was GREEN, 113/113, at `a3acca4b` on every build: 14.370
(`20261125T021147Z`), 14.369 (`20261125T021944Z-air-bladder-14369`) and 14.368
(`20261125T022754Z-air-bladder-14368`). This is the release run.**

- **Red first:** the probes-only commit `3e8e6402` was red on all five probes it touched, 13 checks,
  each one a new leg (`20261125T020646Z`): `glog-books` 2, `hazard` 2, `marketplace` 1,
  `party-sheet` 3, `warden-dashboard` 5. Party-sheet's three were red for the wrong reason (the leg
  read its actor id from the wrong argument and threw); `d6a2019b` fixed the leg, and it was red
  again for the right reasons (`20261125T020938Z`): scroll back to 0, focus on `<body>`.
- The first attempt (`20261125T020521Z`) ran nothing: the Damage page's probe is `hazard`, not
  `warden-damage`.

## One Warden's Dashboard and the page tabs' side (2026-11-21, late)

**Still 113 probes. Newest build only (14.370). The whole suite was GREEN, 113/113, at `c7668e31`
(`20261121T234452Z`).**

- **Red first:** the probes-only commit `d30f1abf` was red on 6 of its 8 probes (`20261121T233113Z`):
  `party-sheet`, `warden-dashboard`, `hazard`, `sheet-rail`, `settings` and `theme`. The two that
  passed, `header-buttons` and `ui-parity`, only lost a leg or widened a filter, so they can't red
  without the change.
- **The whole suite at the change, `35703f7d`: 110/113** (`20261121T233336Z`). All three reds were the
  Tables page's roots now wearing `.tab`. `.cairn .tab { height: 100% }` stretched the clock band to
  626px of a 642px window (`vald-time`, and `warden-dashboard`'s Tables leg). Core's
  `.tab[data-tab] > nav.tabs` made the table tabs' border invisible in dark (`theme`, 1.00:1). Both
  fixed in `c7668e31`, and the seven probes they touch were GREEN there (`20261121T234222Z`) before
  the whole suite.

## The Equip round and review #36 (2026-11-21)

**113 probes now, with `dev:party-sheet` and `dev:light-uses` new. Newest build only (14.370), the
day-to-day rule; no release is decided, so the older two haven't run.** The whole suite was GREEN,
113/113, at `c1d3b279` (`20261121T185459Z`), and the eight probes the badge and "Equip Spell"
changes touch were GREEN at `fcef9509` (`20261121T211316Z`).

- **The Equip round, red first:** the probes-only commit `6999915d` was red on exactly its new checks
  (`20261121T171832Z`). At `9dd53c42` `sheet-rail` and `sheet-layout` measured page 1 at 724 in a 662
  content box (`20261121T172526Z`), which is why every sheet is 770 tall since `b2fb1d8c`. The same
  commit fixed a race of the new `party-sheet` leg's own making: the put-out leg's redraw landed while
  the layout leg was measuring.
- **Review #36, red first:** the legs in `016088fc` were red on 14.370, every red check one of the new
  legs (`20261121T183537Z`).
- **The whole suite at the fixes, `5d4bfe63`: 109/113** (`20261121T184355Z`), all four reds the
  probes', UNDERSTOOD and fixed in `c1d3b279`. Three were toast recorders in `broken`,
  `content-overlay` and `marketplace`: toasts now reach core as a key with `{format}`, and the
  recorders pushed the key raw. The fourth was `hotbar`, which counted the whispered change-log card
  for the item its own leg had just deleted (the known change-log pollution class).
- **`sheet-rail` leg 25 at `76e4f5f6`: red on every creature in both schemes** (`20261121T210922Z`).
  The change moved "Armor" to the right of a smaller shield and the leg still wanted it below a
  54 x 60 one. `25d8261f` rewrote the leg. `dev:shield`'s half went in probe-first as `f14ee1ff`,
  red on exactly its new checks (`20261121T210642Z`); that commit carries the message of the one
  before it by mistake, and `76e4f5f6`'s message says so.

## Review #35's fixes, on all three builds (2026-11-20, late)

**Every review #35 finding fixed red-first, at `cf98e521`: green on all three builds.** 111 probes.

- **Red legs, each failing as predicted before its fix:** `sheet-rail,attack,broken` at `ee914d7b`
  (`20261120T194712Z`); `attack,shield` at `1b44c077` (`20261120T195944Z`; `shield` 7b only showed
  the missing export, so `00f118da` exported `migrateShieldFlags` alone and `037841f5` re-ran it,
  `20261120T200411Z`, after `20261120T200153Z` threw in the probe's own stub); `attack` at `843c976b`
  (`20261120T200622Z`); `glog-books` at `6a55bb0d` (`20261120T200818Z`); `combat-options` at
  `da3d5b8f` and `3bba6e47` (`20261120T200948Z`, `20261120T205324Z`); `vald-time,sheet-rail` at
  `3f5ff9cb` (`20261120T205110Z`); `hotbar` at `d4ab7078` (`20261120T205655Z`).
- **14.370:** 111/111 at `e26c8d9d` after the first batch (`20261120T194937Z`); 110/111 at `05d512ee`
  (`20261120T205916Z`), the red `sheet-rail` leg 23 itself (a reopened sheet read its closed frame's
  answer, fixed in `cf98e521`); **111/111 at `cf98e521`** (`20261120T210659Z`).
- **14.369: 110/111** (`20261120T211638Z`): `enc-damage`'s player join, forms `[]` (the GPU family
  above); **green alone** (`20261120T214750Z`).
- **14.368: 110/111** (`20261120T214028Z`): `gen-dice`, Dice So Nice never finished animating;
  `shots/gen-dice/chromium-56.log` says "SharedContextState context lost via Skia OOM" after a
  failed Vulkan image allocation, the GPU OOM again; **green alone** (`20261120T215142Z`).
- `11a80801` after the battery is guides and one journal only; the release head re-runs the battery.

## Where things stand (2026-11-19, evening)

**The sheet's second round (footer under every page, the Slots line and Overburdened banner open
Inventory, Deprived and Panicked by the vitals) and the Attack window, at `666250f3` / `71d96814`:
green on all three builds.** 108 probes now, with `dev:attack` new.

- **Negative controls first, both red:** `sheet-rail` at `6af5be33` (`20261119T222600Z`, its five new
  legs red, the other 20 green) and `attack,sheet-rail` at `60c9230b` (`20261119T222316Z`: no Attack
  window; the burst still opened the improvised dialog).
- **At `504c6376`, 107/108 on 14.370** (`20261119T222807Z`): the red was the probe's own panic leg,
  which fired `form.requestSubmit()` (submitter null, so DialogV2 resolved with no answer). Fixed in
  `666250f3`: the leg clicks Impaired, and a real Playwright Enter gets a leg of its own.
- **At `666250f3`: 108/108 on 14.369** (`20261119T223724Z`) **and 108/108 on 14.368**
  (`20261119T224420Z`); **107/108 on 14.370** (`20261119T225116Z`): `attack` passed all 10 checks and
  failed on a console error in core's `Token._drawTargetArrows`, UNDERSTOOD: `TokenLayer#animateTargets`
  redraws every targeted token each frame, and the probe's cleanup deleted the scene under its targeted
  foe. Fixed in `71d96814` (release targets first); `attack` green there on all three builds
  (`20261119T225840Z`, `20261119T230003Z`, `20261119T230120Z`).

## The footer, the run-in Traits label, the light badge and picker (2026-11-20)

**At `f8a67bf4`: 111/111 on 14.370** (`20261120T140315Z`).

- **Negative control:** probes `bd7da5aa` (`20261120T135025Z`), every new check red, with the Torch-call
  legs downstream of the failed picker and a 404 for the missing `light-sources.js`.
- **`e42d3953` broke every character sheet** (a template edit lost the Armor box's opening div: "Template
  part form must render a single HTML element"); the targeted run (`20261120T135452Z`) was red on all 14
  for that reason, and the CT 123 walk caught it the same minute. Fixed in `ee91cef1`.
- **The badge's icon was a 404 that `dev:shield` passed:** a relative `url()` in a custom property resolves
  against the stylesheet (`css/`), and the leg read only the icon's name. All 14 at `ee91cef1`
  (`20261120T135644Z`) failed on that 404 as a console error, every other check green. The leg now fetches
  the resolved url (`13b53ca0`, red on exactly those checks, `20261120T135914Z`); fixed with `getRoute` in
  `34925d54`, targeted 14/14 (`20261120T140107Z`).

## Traits label, Omen like a Bond, Hold light, the shield hacks, weapon data (2026-11-20)

**At `22b733c5`: 111/111 on 14.370** (`20261120T130100Z`). Day-to-day rule: the newest build only; the
older two run once a release is decided.

- **Negative control first:** the probes-only commit `af258110` (`20261120T124557Z`) was red on exactly
  its 29 new checks (attack 8, combat-options 3, sheet-rail 7, shield 11); every unchanged-behaviour guard
  beside them passed.
- **Targeted, 18 probes at `22b733c5`:** green (`20261120T125713Z`).
- Walked on CT 123 as `dev-gamemaster`, light and dark, the hacks READ-SHADOWED in-page (no world write).
  The Torch module is not installed there, so the lighting is exercised only by `dev:shield`'s stub.

## Character sheet rounds 5 and 6, Hold shield, Broken (2026-11-20)

**At `e1866dc8`: 110/110 on 14.370 and 14.369, 108/110 on 14.368** (`20261120T020852Z`,
`20261120T021555Z`, `20261120T022258Z`). The two 14.368 reds are the GPU crash below, not the code.

- **Negative controls, each red on exactly its new checks:** round 5 `740e1561`; round 6
  `9683e23c` (`20261120T011526Z`); Hold shield `442fd09d` (`20261120T012136Z`); the batch
  (Broken, ability ±, Attack Cancel, CharGen, hint, name) `734c90fe` (`20261120T014829Z`); the
  inline-created broken item `9801c1d6` (`20261120T020206Z`); HP's bar `c824fbcb`
  (`20261120T020348Z`). The last two were found walking CT 123, not by a probe.
- **Reds that were the probes' fault:** a `sheet-rail` race on 14.369 and 14.368 (a render still in
  flight after `changeTab("items")` put the sheet back on Character; all-zero rects), fixed in
  `fdf615ba` and `8768e534`; `settings` (a new migration marker must join `MARKERS`,
  `83d94f5e`); `header-buttons` (the CharGen label hard-coded in English, `e1866dc8`).
- **The GPU crash, four times:** `combat-options` (and once `companions`) red on 14.368 or 14.369
  with `join: no user control on …/join`, forms `[]`: a PLAYER's second browser. Every one has
  Chromium's GPU process crashing or losing its WebGL context just before
  (`shots/<probe>/chromium-*.log`: "GPU process exited unexpectedly", "CONTEXT_LOST_WEBGL"). In
  `20261120T022258Z` two probes on different boxes (CT 114, CT 130) crashed in the same second,
  02:25:35, which points at the shared GPU, not the code. Same family as the 11-19 GPU OOM. The
  probes passed every other check.

## Character sheet round 4 (2026-11-19/20)

**Round 4 (the Description page retired, the Traits window, sentence case, the labelled Background
field) at `1e3f2f4e`: 108/108 on 14.370, 14.369 and 14.368** (`20261120T002622Z`,
`20261120T003313Z`, `20261120T004036Z`).

- **The carried red closed first:** `sheet-layout` failed all six PCs at `6b63dd84` on every build
  (`div.age-row` 79 in 76 wide); green at `22bdf1a1` (`20261119T235304Z`).
- **Negative control:** the probes-only commit `587f6e5f`, 14 touched probes on 14.370
  (`20261120T000359Z`): nine red, each for a round 4 behaviour; the five that only dropped the
  Description page's assumptions green on both sides.
- **At `48e118a6`, 102/108 on 14.370** (`20261120T001209Z`): one real red (the generated background's
  name, a span, cannot wear core's input box: core scopes `--input-*` to input elements) and five
  probe-side ones (fixtures created with Creation Mode at its schema default, off; a fixture
  background with no question tables; two stale page lists and a capitals witness). Fixed in
  `da982d3f`; core greys every `input[readonly]`, so `1e3f2f4e` makes the name read-only only outside
  Creation Mode.

## Earlier the same day (2026-11-19)

**The character sheet redesign (a rail, five pages, a Growth page) at `505767a3`: green on all three
builds.** 107 probes now, with `dev:sheet-rail` new.

- **Negative control first:** `dev:sheet-rail` and the extended `dev:sanitize` alone at `d69849b8`, the
  probes-only commit ahead of the change, both red (`20261119T195356Z`): no rail module, no
  `system.growth`.
- **At `31af7348`, 104/107 on 14.370** (`20261119T204238Z`): two real reds, fixed in `505767a3` (the
  rail's Connections count read the actor's stale copy; the shield's Armor label clipped), and a
  `review-batch2` crash at the join page (greaves-130 served no join form), which passed at the next run.
- **At `505767a3`: 107/107 on 14.370** (`20261119T205409Z`), **107/107 on 14.369**
  (`20261119T210538Z`), and **106/107 on 14.368** (`20261119T211602Z`). The red there is UNDERSTOOD:
  `connections` passed all 29 checks and failed on Dice So Nice's "Error creating WebGL context", and its
  Chromium log (greaves-116) shows a Vulkan image allocation failing, `SharedContextState context lost via
  Skia OOM` and the GPU process restarting: the card ran out, the 11-06 `hazard` class. Green solo at the
  same SHA (`20261119T212333Z`).

## Before that (2026-11-09)

**Every Foundry 14 build from 14.368 on, before every release (user ruling 2026-11-09), so three
projects now.** The boxes moved to 14.370, which the plain `air-bladder` project serves, and that left
14.369 with no project until `air-bladder-14369` was added (foundry-ops `c28361a`).

- **0.1.26 at its tag (`67e47df3`): 104/104 on all three builds.** 14.370 with `--refresh`
  (`20261109T221231Z`), 14.369 with `--refresh` (`20261109T223830Z`), 14.368 (`20261109T224523Z`).
- **`dev` at `1a870a2f`: 105/105 on all three** (`20261110T002303Z`, `20261110T002857Z`,
  `20261110T003451Z`).
- **The same commit, after the DCC session retook every box's `pristine` to add its projects:** 105/105
  on 14.370 (`20261110T020412Z`), and **104/105 on 14.369 and on 14.368, one red each, NOT
  UNDERSTOOD.** Neither has been re-run solo yet.
  - `socket-grant` on 14.369 (`20261110T021007Z`): "the plant did not land — sweep leg is vacuous", every
    other check green. Its second red in 44 runs; the first (`20261106T173352Z`) was not this check.
  - `item-offer` on 14.368 (`20261110T021601Z`): "the Give button settles at once on a container you
    own", with `state: accepted` and `settled: false`. Seven reds in 67 runs, five of them on 10-31
    before fixes, one on 11-06 (another check).
  Both checks read a result straight after a write, so a race is the first suspect, not a proven one.

## Before that (2026-11-06)

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
  The second-bond sentence (`8c3d6fe9`): red leg `c27d1543` (`20261106T193007Z`) failed exactly its four
  new checks, 23/27; at the fix **105/105 on 14.369** (`20261106T193140Z`) **and 14.368** (`20261106T193738Z`).

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

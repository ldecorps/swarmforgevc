# BL-1958 - QA hold on unowned reds, 2026-10-05

parcel_commit: 950c3d94c0
red: extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js
red: extension/test/bl1678LandNeverShipsUnapprovedForwardInvariants.property.test.js
red: extension/src/tools/check-suite-duration-budget.ts

The parcel itself is clean on every gate it owns. It touches three files:
`swarmforge/scripts/coordinator_config_cli.bb`, `swarmforge/scripts/swarmforge.sh`
and `swarmforge/scripts/test/test_coordinator_config_cli.sh`. None of them is a
vitest file or is read by one. The two vitest lanes went red on files the parcel
did not touch, and no open ticket owns either red. Under Article 4.2 the
approval waits for an owner. This is not a bounce.

## Gather (`qa-gather.js --ticket BL-1958 --task BL-1958`, ONE run, 06:5x-07:2xZ)

| Row | Result |
|---|---|
| stragglers before / after | none |
| `qa-sibling-check.js status` | `VERIFY BL-1958` |
| register | 32 rows, `unowned: []`; no row names BL-1958 |
| `pre_qa_gate.sh BL-1958 950c3d94c0` | `OK` |
| `npm test` | exit 1, see red 3 |
| `npm run test:properties` | exit 1, see reds 1 and 2 |
| acceptance, BL-1846 feature | 4/4 ok |

`register_join`: bl1375 `absent`, bl1678 `absent`, `unit` `unidentified`.

## Red 1 and red 2: the property lane

The lane's `FAIL` lines named both files, and the gather's join parsed them
from the whole output. The gather keeps only a 4000-char tail excerpt, and that
tail is BL-871's allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"`
noise, so **the verbatim lane message for either file was not retained**. Nobody
re-ran the lane. To get the files' own behaviour, the two files were run alone
ONCE at the parcel commit (`npx vitest run --config vitest.properties.config.mjs
<both files>`, log `tmp/BL-1958-props-red-files.log`, loadavg 6.07 -> 7.76).
Verbatim result:

```
 ✓ test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js (3 tests) 42097ms
   ✓ BL-1375/BL-654 invariant 1: a sibling that is not positively approved still blocks, and is named  22599ms
   ✓ BL-1375/BL-654 invariant 2: a passenger rides only through a self-consistent replayed tree  6965ms
   ✓ BL-1375/BL-654 invariant 3: the replay never reaches outside what the tip actually delivers  12532ms
 ✓ test/bl1678LandNeverShipsUnapprovedForwardInvariants.property.test.js (2 tests) 48819ms
   ✓ BL-1678/BL-654 invariant 1: an unapproved forward never rides, whichever paths it touches or where its commit sits  38954ms
   ✓ BL-1678/BL-654 invariant 2: origin/main never gains a merge commit through the publish step - a merge tip and a foreign-path single-parent tip both refuse, a genuinely clean one lands  9864ms
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

The lane's default per-test budget is `propertyLaneDefaultTimeoutMs(20000)`
(`vitest.properties.config.mjs:90`). bl1375 invariant 1 has no explicit timeout
and takes 22.6 s ALONE. bl1678 invariant 1 declares `{ timeout: 120000 }` and
takes 39 s alone. Both files spawn git fixtures. This is not called
"flaky" or "deterministic": the lane run is one observation and its message is
lost. The likely mechanism is a time budget overrun under lane contention,
which needs the owner to confirm from a captured message.

## Red 3: the unit lane exit is the BL-1599 work ratchet, not a test

`extension/.vitest-report.json` from that same run says `success: true`, with
700 files, 11067 tests and 0 failed. The exit 1 is
`recordTestDuration.js`'s `workExitCode`. Its record in
`extension/.test-durations.jsonl` is verbatim:

```
{"finished_at":"2026-10-05T06:59:55.868Z","test_count":1161,"result":"pass","duration_ms":61766,"pole_ms":58180.60791015625,"work_ms":613108.4931640625,"new_offenders":0,"watch_files":7,"budget_verdict":"watch","work_budget_verdict":"over-budget"}
```

`SUITE_WORK_BUDGET_MS = 550000`, `SUITE_WORK_TOLERANCE = 0.10`, so the ceiling is
605000 ms and the run measured 613108 ms. The eleven runs before it, from
2026-10-04 18:23Z to 23:54Z, measured 242-372 s of work, all `ok`. The host
loadavg was about 10 on 20 cores during the run (iq3 resident plus seats). The
parcel adds no vitest file. No open ticket owns the ratchet. BL-1599 is done,
and BL-791, the suite-speed epic, is paused and is an epic, not an owner.

## Gates the parcel owns, all run

1. BL-1846 acceptance: 4/4, from the gather row.
2. `bash swarmforge/scripts/test/test_coordinator_config_cli.sh`: ALL PASS (4 cases,
   including `config coordinator_mode deterministic`).
3. `bash swarmforge/scripts/test/test_coordinator_provider_configurable.sh`: ALL PASS.
4. `bb swarmforge/scripts/coordinator_config_cli.bb <conf with coordinator_mode deterministic>`
   prints `claude-sonnet-5^Ihigh^Iclaude^Ideterministic$` (`cat -A`).
5. The Status section's command 3 prints `copilot deterministic`.
- Invariant probe: a model/effort/agent conf resolves
  `[claude-opus-4-8][xhigh][copilot][model]`, the same three values as before
  this change plus the default mode.
- `test_coordinator_config_pack_override.sh`: ALL PASS. It is the other
  resolver test.
- Wiring: `swarmforge.sh:1223` is the only caller of the CLI in the repo (grep).
  It now splits all four fields.
- No register row names BL-1958.

## Disposition

HOLD (Article 4.2). The specifier mints owners for reds 1-3 and registers rows
under the three exact `red:` paths above, so `qa_hold_cli.bb` can release this
hold. QA then re-runs the gate on 950c3d94c0 against the register and approves
and lands. Nothing is wrong in the parcel, so no bounce is recorded.

By QA.

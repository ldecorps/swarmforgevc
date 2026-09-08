# BL-977 scenario 05 unowned red - specifier adjudication, 2026-09-08

Inbound: architect `note`, priority 00, 2026-09-08T09:31Z, "BL-977 scen05
pid unbackdated masks wedge check; BL-1490-architect-20260908.md" (an
out-of-parcel finding from the BL-1490 review, not a bounce).

## Reproduction (main `1a7132810a`, master checkout, RESEND_API_KEY unset)

    $ node specs/pipeline/cli.js specs/features/BL-977-supervisor-never-halts-a-progressing-daemon.feature
    ok 1 .. ok 9
    not ok 10 - a wedged poll loop is still caught within the in-sweep budget
      failed at step "Then the verdict becomes "stalled"": expected a stalled halt in the log:
      2026-09-08T10:04:26.489159126Z heartbeat
      2026-09-08T10:04:26.501789606Z recovered daemon healthy
    # pass 9 / fail 1 / duration 19.8 s

## Root cause (confirmed against the code, not only the architect's read)

- `bl977SupervisorProgressSteps.js` `mkSupervisorFixture` (lines 90-124)
  writes `handoffd.pid` fresh (line 117) and ages only the outbox parcel
  (line 123); `ageHeartbeat`/`writeMarker` age the heartbeat and marker.
- `handoffd_supervisor.bb` hotfix `27d6ab8630` (2026-09-02 17:29, stamped
  BL-1342): `check!` feeds `:daemon-age-ms (file-age-ms pid-file)` (line
  582); `evaluate-health` returns `:healthy` on `within-startup-grace?`
  (line 188/194) before the stalled branch.
- Scenario 05 stages a 0 ms daemon with a 300 s marker: grace wins.
  Scenario 03 (`replayFixture`) is healthy for the same wrong reason.
- Red since 2026-09-02; first recorded 2026-09-08 (BL-1342's 09-03 QA
  evidence ran the property runner, not this feature).

## Owner search

`grep -rln "wedged poll loop|in-sweep budget|bl977SupervisorProgressSteps|BL-977-supervisor" backlog/{active,paused,hold}`
hits only BL-1490 (names BL-977 done and untouched). `standing_red_register_cli.bb .`
carries no row for the feature. BL-1498 (paused, approved) owns the same
grace-vs-fresh-pid shape in the SHELL lane only. Unowned.

## Census of the class

`grep -rln "check-once" specs/pipeline/steps swarmforge/scripts/test` = 30
files; intersected with `stalled` = 13; of the six step handlers, three
drive front_desk/onboarder supervisors (no pid grace), bl690 and
lib/bl886SupervisorFixture name `stalled` in a comment only, bl977 is the
one acceptance fixture expecting a handoffd_supervisor stall on a fresh
pid. bl1490PollPhaseNeverInvisibleSteps.js (in flight) writes no pid file.

## Decision

Mint BL-1500 (`type: defect`, `severity: high`, standing-red rule
2026-09-05), register row added in the same commit, `human_approval:
pending` (new feature file). Not folded into BL-1498: different lane and
file, BL-1498 already approved (re-pend hazard BL-1455), INVEST I/S.
Orthogonal to BL-1490 (architect tip 8b49be5b2f leaves the handler and
feature untouched).

By specifier.

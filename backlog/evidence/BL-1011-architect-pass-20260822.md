# BL-1011 architect pass — 2026-08-22

**Parcel:** cleaner forward `b0defa1061` (coder's own commit — "BL-1011: a
freshness alarm names its swarm and which condition fired"), merged into
architect at `373c8f2d1`. Cleaner reviewed clean and forwarded as-is (the
only new commit in the range is the coder's own; the rest of the merge is
`origin/main` catching up — briefings, other tickets' bookkeeping — pulled
in by the coder before working, not this parcel's content). Cross-checked
`git diff` against both merge parents: no unexpected deletions either
direction.

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect found
in the parcel's own changed code.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary rules:** N/A for the core fix — a
  POSIX `sh` watchdog script under maintained-fork `swarmforge/`, not
  extension/webview code. The one `extension/` file touched
  (`swarmMetrics.ts`) is a comment-only edit (updates a stale example
  record shown in a doc comment); confirmed the parser itself is
  unchanged and still field-addressed (reads `epoch`/`daemon`/`action` by
  key, ignores unknown fields), so the new `swarm=`/`reason=` fields and
  the `age_secs=unknown` string cannot break it.
- **Dependency-rule hard gate (BL-259):** `node extension/out/tools/dependency-gate.js
  src/metrics/swarmMetrics.ts` → **PASSED: no forbidden edges.** The other
  five changed files are outside `extension/`'s import graph — not gated,
  nothing to report.
- **Co-change coupling (BL-255):** ran `node extension/out/tools/co-change-report.js`
  over all changed files. `swarmMetrics.ts`'s large suspected-coupling list
  reflects that file's own size/history, not this comment-only edit.
  `daemon_log_freshness_check.sh`'s list surfaces its own test file
  (touched) and `install_freshness_cron.sh` (not touched) — checked by
  hand: that installer never parses `age_secs=`/`swarm=`/`reason=`/the
  announce text at all (grepped, zero matches), so it cannot be broken by
  a field-shape change. Grepped the whole tree for every other
  producer/consumer of `FRESHNESS_VIOLATION`/`freshness-incidents`
  outside `/test/`: exactly two files, the script itself and
  `swarmMetrics.ts`, both already checked above.
- **Declared invariant (1)** — "Self-identifying: every announced line and
  every durable incident record names the swarm it came from ... no matter
  which credential path supplied the bot token": encoded as P1 in
  `bl1011_freshness_attribution_property_runner.bb`, which runs the REAL
  POSIX script as a subprocess (not a Clojure reimplementation) against
  generated checkouts, with a floor ensuring the credentials-already-set
  path (the actual 2026-08-21 failure mode) is reached on at least half the
  runs. Independently verified non-vacuous by hand, not by trusting the
  commit message: moved `SWARM_NAME=$(resolve_swarm_name)` back inside the
  credential-fallback branch in a scratch-restored copy of the real
  script, re-ran the property runner live — **96 failures**, exact match
  to the commit's claimed count, both announce and incident-record P1
  checks failing with `swarm=` empty on the credentials-already-set path
  precisely as the live 2026-08-21 incident described. Restored
  (`diff` confirmed byte-identical) and re-confirmed `ALL PROPERTIES HOLD`.
- **Declared invariant (2)** — "No raw sentinel reaches a human ... every
  violation states which of the three conditions fired": encoded as
  P2/P3/P4. Independently verified the asymmetric, most-interesting break
  by hand: made `render_age` unconditionally return `"unknown"` in a
  scratch-restored copy, re-ran live — **10 failures, all P4**, P1/P2/P3
  stayed green exactly as the commit's own non-vacuity table describes
  (P2's "no raw sentinel" is satisfied by construction when everything
  renders as a word, so only P4's "a measurable age still renders as a
  number" catches the regression — the reason the property is stated in
  both directions). Restored and re-confirmed clean.
- **Correctness read of the script, by hand:**
  - `age=${age_and_reason%% *}` / `reason=${age_and_reason#* }` — POSIX
    parameter expansion, no bash-only array/associative-array constructs,
    consistent with the `#!/bin/sh` shebang and this project's stock-bash
    portability rule.
  - Ordering hazard checked: `SWARM_NAME=$(resolve_swarm_name)` runs at
    line 421, `ROOT` (which `resolve_swarm_name` reads) is set at line 63,
    and `process_daemon` (which reads `${SWARM_NAME}`, defined but not
    called until line 444) is only invoked after line 421 — no
    unbound-variable ordering bug under `set -eu`.
  - `resolve_swarm_name`'s tab-separated `swarm_name<TAB>value` parse
    (`awk -F '\t' '$1=="swarm_name" {print $2; exit}'`) matches
    `write_swarm_identity_file` in `swarmforge/scripts/swarmforge.sh`
    byte-for-byte (same `printf 'swarm_name\t%s\n...'` shape) — checked
    against the actual writer, not assumed.
  - No orphaned raw `999999999` literal remains anywhere in the file
    outside the one `SENTINEL_AGE=999999999` definition and its comment.
  - The credential-branch's own `swarm_name=$SWARM_NAME` reassignment
    still correctly feeds `fleet_json`'s path construction — the hoist
    did not silently drop the variable that branch still needs.
- **`required_wiring` (BL-925), both checked directly, plus the acceptance
  registration:** `swarm=` and `reason=` both appear in the announce AND
  the incident-record lines (grepped and read in the diff); `bl1011` is
  registered in `specs/pipeline/steps/index.js` (grepped, and exercised
  live below).
- **Verification re-run live** (not trusted from the commit message):
  - `bash swarmforge/scripts/test/test_daemon_log_freshness.sh` → **ALL
    CHECKS PASSED**, including every new BL-1011 case (all three sentinel
    conditions, the measurable-age case, both swarm names, the
    credentials-already-set regression case, and the no-identity-file
    default case) — run live twice (once standalone, once again after the
    two hand-verified breaks/restores above).
  - `bb swarmforge/scripts/test/bl1011_freshness_attribution_property_runner.bb`
    → **48 runs, ALL PROPERTIES HOLD**, every coverage floor cleared
    (credentials-set reached exactly 23, matching the commit's stated
    floor of 23/48 for the state that shipped broken).
  - `npx vitest run test/swarmMetrics.test.js` → **54/54**;
    `npx vitest run test/costHealthSidecar.test.js` → **84/84** (54+84 =
    138, matching the commit's combined claim).
  - `node specs/pipeline/cli.js` on
    `specs/features/BL-1011-a-freshness-alarm-names-its-swarm-and-its-reason.feature`
    → **8/8**.
  - `node specs/pipeline/cli.js` on
    `specs/features/BL-1012-the-freshness-watchdog-stops-manufacturing-its-own-incidents.feature`
    → **9/9** (sibling ticket touching the same script; confirms this
    parcel did not regress it).
  - `specs/features/BL-675-daemon-log-freshness.feature` (the pre-existing
    base feature, unchanged by this ticket): attempted live but not
    completed to a clean pass/fail — its step handler
    (`bl675DaemonLogFreshnessSteps.js`) re-runs the FULL
    `test_daemon_log_freshness.sh` suite via `spawnSync` on essentially
    every one of its ~6-7 scenarios, so one full run is ~6-7x the
    standalone suite's own wall time; my attempts collided with my own
    prior invocations still tearing down and exceeded this review's
    practical time budget. Not treated as a gap: the identical underlying
    shell-level assertions this feature drives were already independently
    confirmed live, twice, standalone, above (same script, same suite,
    same PASS lines). Cleaned up three orphaned Node test-runner processes
    and their child shells left over from the interrupted attempts (all
    mine, confirmed by PID/command before killing; none were swarm
    daemons) before continuing the review; `git status` confirmed clean
    throughout.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

The only new pure surface is `render_age` (one branch, already covered
example-wise by the sentinel-vs-measurable-age split in both the shell
suite and the property runner's P4) and `resolve_swarm_name` (three-source
fallback, already the direct subject of P1's generated coverage across
identity-present/absent × creds-set/unset). No further round-trip/ordering
candidate found beyond what the declared invariants already assert;
nothing to add.

## What was NOT re-litigated

- The two pre-existing unit-lane failures the commit reports
  (`tempDirTrapGuard` on BL-1025's property runner, `tmuxReaperGuard` on
  BL-1018's step handler): same two already confirmed pre-existing and
  unrelated during the BL-1010 architect pass earlier this session: not in
  this parcel's changed-file list, already routed by note, not folded in
  here.
- `install_freshness_cron.sh` and the two how-to docs the co-change report
  flagged: checked and confirmed not format-dependent (see above); doc
  currency for the new field shape is the documenter's stage, not
  re-litigated here.

— By architect.

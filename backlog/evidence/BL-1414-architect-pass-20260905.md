# BL-1414 — architect pass, 2026-09-05

Ticket: BL-1414-a-repeating-freshness-violation-is-announced-once-then-digested
Role: architect
Commit reviewed: 4a09280ef0 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1414FreshnessAnnounceDigestSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is a new POSIX-sh state library
  (`freshness_announce_lib.sh`, sourced by `daemon_log_freshness_check.sh`
  the same way `freshness_stop_marker_lib.sh` already is) plus a Node step
  handler shelling out to a real fixture CLI — no webview, no VS Code API,
  no secrets, no browser storage.
- **Co-change report**: `daemon_log_freshness_check.sh` shows the wide
  standing coupling any change to this central watchdog always shows (its
  own supervisor/conf/test family) — pre-existing structure, nothing new
  or suspicious.

## Invariants Review (BL-633/654)

Ticket declares three invariants, each independently checked:

1. **Suppression is announce-only.** Read `daemon_log_freshness_check.sh`
   by hand: `append_incident "$record"` runs unconditionally, BEFORE
   `announce_transition_only` is ever called, in both the escalate and
   restart branches — confirmed unchanged from the pre-BL-1414 shape,
   only the `do_announce` call afterward is now gated. Also confirmed
   `kill_daemon`/`restart_daemon` execute unconditionally, untouched by
   the announce decision — this ticket only gates the Telegram message,
   never the actual restart action.
2. **First tick of a transition is never suppressed.** `announce_transition_only`
   in `freshness_announce_lib.sh`: the "in violation, no state file yet"
   branch always prints `announce` before any window arithmetic runs; the
   "fresh, state file exists" branch always prints `recovered` — neither
   path consults `DIGEST_SECS` at all. Confirmed independently by running
   the `first-violation` and `recovery-once` fixture modes myself (below).
3. **State is durable, never process memory.** State lives in one file per
   (daemon, reason) under `.swarmforge/daemon/freshness-announce/`, read
   and written fresh on every call — no shell variable persists across
   invocations since every cron tick is a new `/bin/sh` process. Confirmed
   by reading the lib (POSIX `sh`, no backgrounding, no daemon) and by the
   `repeat-suppressed` fixture mode, which invokes the checker 5 separate
   times and the suppressed count still increments correctly across calls.

Independently re-ran the coder's property test:

```
bash bl1414_freshness_announce_digest_property_runner.sh
P1/P2 ran 200 case(s) each
ALL PROPERTIES HOLD
```

and the shell test suite. All BL-1414-01 through BL-1414-05b scenarios in
`test_daemon_log_freshness.sh` PASS. The suite also reports 4 pre-existing,
unrelated failures (BL-796-01/02/03 nvm/node PATH resolution,
`fleet-telegram: default announce invoked curl`) — confirmed these are NOT
caused by this parcel by checking out the PRE-BL-1414 version of this same
test file and re-running it: identical 4 failures reproduce. This is also
the exact same standing-red set I documented during my own BL-1413 review
earlier today (`backlog/evidence/BL-1413-architect-20260905.md`) — an
environmental/sandbox gap (nvm fixture, mocked curl), not a regression, and
not something either sibling parcel touches.

## Acceptance wiring — driven end-to-end myself

Like BL-1411, this ticket's acceptance handler shells out to the REAL
`daemon_log_freshness_check.sh` over a real fixture root
(`bl1414FreshnessAnnounceDigestCli.sh`), not the decision function in
isolation. I ran all 6 fixture modes directly against the CLI myself:

- `first-violation` → 1 announce, 1 incident record
- `repeat-suppressed` → 0 announces across 5 ticks, 6 incident records
  (1 seeded + 5 new), suppressed count = 5
- `digest-after-window` → 1 digest announce naming `suppressed_ticks=14`
  (matches the seeded count exactly)
- `recovery-once` → 1 recovery announce
- `different-daemon-same-reason` → 1 new FRESHNESS_VIOLATION for the new
  daemon (plus an orthogonal recovery announce for the baseline daemon,
  which the scenario's own assertion correctly filters out by message type)
- `same-daemon-different-reason` → 1 new FRESHNESS_VIOLATION for the new
  reason, independent suppressed-count state from the baseline reason

All 6 match the feature's 6 scenario runs exactly, including the Scenario
Outline's two `KNOWN_OUTLINE_CELLS` (an explicit map, never a
passthrough regex, per the Scenario-Outline-handler convention).
`registerSteps` export present per the ticket's `required_wiring` anchor
(BL-1371); `grep -n announce_transition_only
daemon_log_freshness_check.sh` matches at both live call sites (escalate
and restart branches) inside `process_daemon` (the other `required_wiring`
anchor).

No leftover fixture temp dirs after my runs.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.

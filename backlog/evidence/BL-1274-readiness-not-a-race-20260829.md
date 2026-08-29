# BL-1274 — the readiness verdict no longer depends on the host scheduler

Coder, 2026-08-29.

## What was actually being raced

The property launched the REAL `launch_resident_spy_tunnel.sh` against a fake
`cloudflared` and asserted `exit 0`. The registration line was already on disk
before the launcher started; the only thing between the fixture and a verdict
was the host scheduling that subprocess inside the launcher's readiness budget.

BL-871 (2026-08-11) widened the budget 2s → 20s for this exact assertion. It
went red again on 2026-08-29 with the 20s budget in place, inside a full
`test:properties` run where the file took 62.5s for 3 tests — and it refused a
BL-1220 commit that had nothing to do with tunnels. A tenfold widening bought
18 days.

## The fix: take the clock out of the verdict

`launch_resident_spy_tunnel.sh` now guards its entry point — its top-level body
moved into `main()`, called only when the script is EXECUTED, never when it is
sourced. That is the shell form of the engineering article's "CLI `main()` is a
thin wrapper over exported, testable helpers".

Invariant 1's property now sources the launcher and calls `wait_named_ready`
against a log the fixture wrote and a pid the fixture owns. The verdict is a
pure function of the log content, which is invariant 1's own wording. Nothing
is spawned, so nothing is raced.

| | before | after |
|---|---|---|
| readiness budget | 200 × 0.1s = 20s | 3 × 0.01s = 0.03s |
| outer `spawnSync` timeout | 30 000ms | 15 000ms |
| test wrapper timeout | `SUBPROCESS_HEAVY_TIMEOUT_MS` | none needed |
| invariant 1 runtime | ~62s under load | **2s** |

Every budget went DOWN. Scenario 03 asks that none grew; the fix makes them
shrink, which is the difference between removing a dependency and tolerating
one.

## Measurements

- **qa_e2e step 1** — 12 isolated runs of the whole file: **0 reds**.
- **qa_e2e step 3, non-vacuity** — with the launcher altered to accept liveness
  as readiness (`kill -0` in place of the log grep), the property fails:
  `expected NOT ready when the log never shows registration - a live process
  alone must never count as ready`. Restored.
- **qa_e2e step 4** — `git diff` over the budget constants shows only
  reductions; no third widening.
- **qa_e2e step 2** — the acceptance drives the REAL launcher end to end with
  the fake cloudflared's startup delayed past the pre-change budget (21s), and
  the launcher still reports the hostname and writes state. That is the fix
  evidence: a delay that used to decide the verdict now decides nothing.

## Coverage that moved, said out loud

The property no longer asserts the end-to-end effects (hostname echoed, state
file written, no state without registration). Those are asserted by
`swarmforge/scripts/test/test_launch_resident_spy_named_tunnel.sh` cases
named-01/02/03, which I ran and confirmed PASS, and by this ticket's own
acceptance scenarios 01 and 02 against the real launcher. One end-to-end spawn
in a shell test is better placement than ten per property run — but it is a
move, not a deletion, and a reviewer should be able to see that without
digging.

## Two mistakes of mine, both caught by running rather than reading

1. Replacing the old property block, I over-deleted and took `scriptCaseArb` —
   invariant 2's generator — with it. The suite failed immediately with
   `ReferenceError: scriptCaseArb is not defined`; restored from git.
2. The acceptance's first run failed both scenario-01 rows with
   `refusing named tunnel ... this root is not the registered operator root`.
   I had hand-written a registry file guessing the format the ownership lib
   owns. Replaced with a call to the real
   `tunnel_ownership_lib.sh register-operator-root`, which is what the property
   test itself uses. A fixture that guesses at a format another component owns
   is the same class of defect as a test asserting on a re-implementation.

## Scope held

Invariant 1 only. Invariant 3 shares the file's launch-a-real-process shape but
sets no readiness budget and asserts pidfile teardown — a different mechanism,
untouched, still 35s and still passing. bl968 (BL-1062) and bl955 are separate
causes and separate tickets.

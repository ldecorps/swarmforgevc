# BL-885 hardener pass — orphan janitor reclaims leaked swarm caffeinate daemons

**Ticket:** BL-885 — extend the orphan janitor with a new reap class for
leaked `caffeinate -dims` daemons. **Reviewed commit:** `043e91804a`
(architect pass, architecturally compliant, forwarding to hardener).
**Role:** hardener.

## Scope confirmation

`git diff 188cb5b38 043e91804a --stat` (the coder+architect diff, on top of
the prior BL-886 merge-up) touches only `.bb` production files
(`orphan_janitor_lib.bb`, `orphan_janitor_sweep_lib.bb`), a JS step-handler
module + its wiring line in `specs/pipeline/steps/index.js`, the promoted
`.feature`, three new `.bb` test runners, and ticket/topic bookkeeping. No
`extension/src/*.ts` anywhere in the diff. Consequence: Stryker mutation
(`--mutate` scoped to `extension/out/**/*.js`), CRAP (`src/*.ts` only via
`crapReport.js`), and DRY (`jscpd --config .jscpd.json src`, `extension/src`
only) are genuinely not applicable — not a degraded fallback, there is no
production TS in this diff for any of the three to run against. The `.bb`
half has no mutation/CRAP/DRY wired per engineering.prompt's Startup Tools
(already recorded by the coder/ticket). The gate for this parcel is the `.bb`
unit + property runners plus the promoted acceptance feature's own BL-113
Gherkin mutation — all owned by this role.

## Pre-run hygiene

- `pgrep -fl 'node --test|stryker'` — none running before start.
- `pgrep -afl tmux` — only the two legitimate swarm sockets
  (`.swarmforge/tmux/3752320954.sock`, `.swarmforge/operator/operator-tmux.sock`),
  no leaked temp-dir fixture servers.
- `uptime` — load average 5.85-8.15 on 4 cores (~1.5-2x, borderline but under
  the 2x-cores bypass threshold); proceeded with full runs. No Stryker
  invoked in this parcel regardless (nothing in scope for it).
- No `extension/src/*.ts` changed → BL-149 cooldown gate has no production
  TS file to gate; not invoked.

## `required_wiring` re-confirmed

`swarmforge/scripts/orphan_janitor_sweep_lib.bb::caffeinate` — re-confirmed
by direct read: the sweep tick (lines ~226-239) calls
`orphan-janitor-lib/reapable-leaked-caffeinate?` inline in the per-process
loop, with `caffeinate-dims?`, `project-scoped?`, `stale?`, and
`is-live-caffeinate-pid?` all computed from live sweep state — not a
lib-only predicate with no call site (the BL-419 shape this ticket's own
`required_wiring` entry warns against).

## Independent re-verification (ran directly)

- `bb swarmforge/scripts/test/orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED.
- `bb swarmforge/scripts/test/bl885_leaked_caffeinate_property_runner.bb` —
  ALL PROPERTIES HOLD (P1: 32/32 exhaustive; P2: 300 runs + positive control).
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-885-orphan-janitor-reclaims-leaked-caffeinate.feature`
  — 8/8 scenarios pass.

## BL-113 Gherkin soft mutation (owned by this role)

The feature has one `Scenario Outline:` (leaked-caffeinate-reclaim-02, 6
examples). Ran:

```
specs/pipeline/scripts/run_gherkin_mutation.sh \
  specs/features/BL-885-orphan-janitor-reclaims-leaked-caffeinate.feature
```

Result: `total=36 killed=31 survived=5 errors=0`.

All 5 survivors are the same class — mutating the `<pid>` column's specific
digits (902->906/894/905/893 on rows 2-5, 903->898 on row 6). Verified
equivalent per BL-234, not a coverage gap:
`reapable-leaked-caffeinate?` (`orphan_janitor_lib.bb:197-206`) never takes
the raw pid — it takes the pre-computed boolean `is-live-caffeinate-pid?` —
and on every one of these five rows a *different* gate already decides the
outcome before that boolean is reached: row 2 fails `caffeinate-dims?`
(cmdline is `-i`), rows 3-4 fail `project-scoped?` (cwd outside/
undeterminable), row 5 fails `stale?` (age younger), and row 6 has no
pidfile to compare against at all (`is-live-caffeinate-pid?` is always false
when the pidfile is missing). None of those gates read the pid's specific
digits. Row 1 (pid 900, the pidfile's own tracked value) is the one row
where the exact value is load-bearing — mutating it (900->899) was **killed
clean**, proving the exemption path itself is genuinely covered, not merely
untested. Documented in the feature file itself (comment above the Scenario
Outline) for future hardening passes. All other 31/36 mutants killed clean;
0 errors.

## Manifest note (BL-502)

The embedded `acceptance-mutation-manifest` in the feature file shows
`scenarios: []` after this run — expected, not a failure signal: the
manifest only records a scenario when it finishes with zero survivors AND
zero errors, and the Outline scenario has 5 accepted-equivalent survivors by
design (see above), so it is correctly omitted. The authoritative verdict is
the run's own stdout status line (`total=36 killed=31 survived=5 errors=0`),
captured above.

## Verdict

Clean. No functional defects found; nothing to bounce. Forwarding to
documenter unchanged (equivalent-mutant documentation added to the feature
file is the only diff from this pass).

By hardener.

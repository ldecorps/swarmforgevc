# BL-1301 — hardener pass

Date: 2026-09-02 · Verdict: **clean, forwarding to documenter**

## Received

Merged architect commit `7d1e6f8391` (clean sweep, no defect) onto
hardender's tip as `d26e487cee`. Ancestry: `393634823a` (coder, no cleaner —
`stage_skip_reasons` names it) → `e62ca5c3c6` (architect merge) →
`7d1e6f8391` (architect pass) → `d26e487cee` (this merge).

## Scope

Babashka (`.bb`) daemon/sweep code and JS acceptance steps — no wired
mutation/CRAP/DRY tooling for this surface (engineering.prompt Design And
Testability: gated only by its own test suite). No production TypeScript
touched.

## Verification re-run (not taken on prior passes' word)

- `bb swarmforge/scripts/test/dropped_parcel_test_runner.bb` → ALL PASS.
- `bb swarmforge/scripts/test/bl1301_parked_ticket_invariants_property_runner.bb`
  → ALL PASS (P1 opt-in/fail-closed, P2 blast radius, P3 never invisible).
- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` → 2 failures,
  `top-expedited-paused-candidate-08` / `...priority breaks ties...`.
  Re-verified independently (not trusting the architect's note) via
  `grep -rl "top-expedited-paused-candidate" backlog/` →
  `backlog/paused/BL-1271-dispatch-gap-suite-stale-bug-fixtures.yaml`.
  Pre-existing, already ticketed, unrelated to this parcel. Not reported as
  new.
- `bash swarmforge/scripts/test/test_chase_sweep.sh` → ALL PASS (17 cases).
- `node specs/pipeline/cli.js specs/features/BL-1301-a-parked-ticket-is-not-a-dropped-parcel.feature`
  → 8/8 pass, no unmatched step.
- Wiring anchors re-confirmed: `specs/pipeline/steps/index.js:921` registers
  `bl1301ParkedTicketSteps`.

## Hand-authored mutation spot-check (BL-638 fallback for a no-Stryker `.bb` surface)

The coder's own suite already covers every branch the ticket's invariants
demand, including BL-654-shape near-miss statuses (`not-blocked`,
`blocked-on-BL-1297`, `blocked ed`, case variants, absence, blank). To
confirm mutation-sensitivity rather than trust branch-shape alone, one
representative mutant was hand-applied to the core predicate and reverted:

- Mutant: `parked-ticket?`'s `(= dropped-parcel-park-status (some-> status
  str/trim))` → `(str/includes? (or status "") dropped-parcel-park-status)`
  — the exact over-permissive-matcher shape BL-654/the ticket's own
  near-miss generator exists to catch (`"not-blocked"` contains
  `"blocked"` as a substring).
- Result: killed immediately and broadly —
  `dropped_parcel_test_runner.bb` failed 6 near-miss cases
  (`not-blocked`, `blocked-on-BL-1297`, `unblocked` all misclassified as
  parked), and the property runner's P1 check failed 43/800 draws across
  every near-miss shape (`not-blocked`, `blocked on BL-1297`,
  `blocked-on-BL-1297`, `blockeded`) — the generator reached and killed the
  mutant on every near-miss category it constructs.
- File restored byte-identical to the received tree (`git diff --stat`
  clean); both suites re-run to ALL PASS afterward.

No orphaned test/mutation processes: `pgrep -fl 'node --test|stryker'`
scoped to this worktree shows no matches. No fixture artifacts left behind
(`git status --short` clean apart from the two pre-existing untracked
router scripts, not this parcel's).

## Hardening changes made

None — the parcel arrived already hardened (coder's unit + property suites
cover the full branch structure and BL-654-shape near-misses; architect
independently re-ran every gate). This is a no-op hardening pass on a real
deliverable, not a functional no-change: forwarding the received commit
unchanged per the Handoff rule.

## Ticket-less changes (not this parcel's, not swept)

`swarmforge/scripts/open_swarm_spy_router.sh` and
`swarmforge/scripts/spy_router_pane_label.sh` remain untracked in this
worktree — carried forward from earlier passes' own notes, not created or
staged by this pass.

## Verdict

No coverage gap, no surviving mutant, no CRAP/DRY concern (no TS touched).
Forwarding to documenter.

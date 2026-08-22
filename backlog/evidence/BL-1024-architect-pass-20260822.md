# BL-1024 architect pass — 2026-08-22 (re-fix review, second architect pass)

**Parcel:** coder re-fix `0eaa4c3d57` (cleaner `254d962503`-equivalent forwards
it unchanged — cleaner status confirms "reviewed clean, forwarded as-is"),
merged into architect at `905077bb9`.

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect in the
parcel's own changed code.

## Prior bounce this re-fix answers

`backlog/evidence/BL-1024-architect-bounce-20260822.md` — three pre-flight
`(System/exit ...)` paths in `expedite_cli.bb` (`stop-stack!`, `initiate!`'s
teardown gate, `ensure-worktree!`) terminated the process before the
outstanding-work summary was ever computed, reproducing the exact 2026-08-21
incident on the common path (any host already running a live swarm).

## Review completed first (Article 4.4 — full inventory before judging)

- **Dependency-rule hard gate (BL-259):** N/A — zero files this parcel
  touches live under `extension/`. Full-repo scan
  (`node extension/out/tools/dependency-gate.js`, no args) re-run: only the
  pre-existing BL-759 `telegram-front-desk-bot.ts` cycle, unrelated. CLEAN.
- **Co-change coupling (BL-255):** re-ran
  `node extension/out/tools/co-change-report.js` over all 9 files changed
  across the whole BL-1024 ticket (both coder commits). The one gap the prior
  bounce flagged — `expedite_cli.bb` historically co-changing with
  `test_expedite_cli.sh` (the one suite that drives the CLI's real control
  flow) but this parcel not touching that file — is now CLOSED:
  `test_expedite_cli.sh` shows 4 co-changes with `expedite_cli.bb` this
  round, because the re-fix added the exact CLI-level regression cases the
  gap called for. No other unexpected coupling.
- **Structural fix, verified by inspection:** `grep -c '(System/exit' expedite_cli.bb`
  = **1** (inside `exit!` only). All three previously-bare `(System/exit 1)`
  calls (`stop-stack!`, `initiate!`, `ensure-worktree!`) and `usage!`'s
  `(System/exit 2)` now route through `exit!`, which calls
  `report-leavings!` before terminating. `leavings` is registered inside
  `park-others!` immediately after the real `git mv` moves run — i.e. before
  any of the three refusals can fire — and refined once `ticket-moved?` is
  known. Traced every call site: no code path reaches the process boundary
  without first passing through `exit!`.
- **Declared invariant (1):** "An expedited run never ends reporting success
  while leaving backlog or index state that its own closing summary does not
  name." Re-verified LIVE in this worktree, independently re-run (not just
  read from the commit message):
  - `bb swarmforge/scripts/test/bl1024_outstanding_summary_property_runner.bb`
    → `400 runs, coverage {:parked 333, :no-parks 67, :moved 118,
    :not-moved 282, :dry 97, :wet 303, :unhappy 333, :refused 149}`,
    `ALL PROPERTIES HOLD`. The generator now draws all three pre-flight
    refusal endings (coverage floor 100, measured 149) alongside the four
    original endings, plus a new P6 encoding the exact structural
    precondition the fix rests on (an account computable the moment a run
    has parked, before it knows whether its own ticket moved). The runner's
    own comments state honestly what it *cannot* reach — whether the process
    actually arrives at the summary is a control-flow fact, gated instead in
    `test_expedite_cli.sh`.
  - `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` → `ALL PASS`.
  - `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1024-an-expedite-run-names-what-it-leaves-behind.feature`
    → 7/7.
  - **The CLI-level gap itself, closed:** `bash swarmforge/scripts/test/test_expedite_cli.sh`
    → all 34 new BL-1024 assertions (cases a–e) pass, covering exactly the
    three previously-unreached refusal paths plus the dry-run honesty case
    and a source-derived "exactly one exit point" regression gate. Total
    suite: 29 FAILURE(S) — identical count and set to the baseline recorded
    in the prior bounce evidence and the coder's own commit message
    (host-probe-dependent pre-existing failures, unrelated to this ticket;
    one needs `timeout`, absent on macOS). No new failures.
  - BL-1025 regression suites (shared files) re-verified green:
    `test_expedite_qa_verdict_store.sh` → ALL CHECKS PASSED; BL-1025
    acceptance → 6/6; BL-952 acceptance → 10/10.
  - **This time, unlike the bounced round, the suite drives the CLI's own
    `-main`/`initiate!` control flow for real**, not only the pure
    `outstanding-work`/`format-outstanding-summary` pair — closing the exact
    gap the co-change tool flagged and the bounce evidence named.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

No new pure module was touched this round beyond `expedite_lib.bb`'s already-
reviewed pair (untouched again in this re-fix — confirmed via
`git diff 2e8c73900 0eaa4c3d57 -- swarmforge/scripts/expedite_lib.bb`, empty).
The declared invariant's own property coverage (above) already absorbs this
ticket's property-shaped surface. Nothing further to add.

## Surfaced, not this parcel's to fix

The coder's own commit message flags (and case BL-1024a's fixture reaches):
`stop-invocation-ok?` receives the whole `EXPEDITE_STOP_CMD` string as ONE
element of its input vector, so `forbidden-stop-flags` — an exact-string
set — only matches a command that IS exactly a forbidden flag; a real
`./stop-swarm.sh --sweep-inbox` sails through ungated. This is a real,
pre-existing defect, unrelated to BL-1024's declared scope (this ticket does
not touch `stop-invocation-ok?` or its call site's argument shape) and
already transparently surfaced rather than silently left. Routed to the
specifier by `note` (not a parcel, not a bounce) for triage/ticketing —
BL-1024 itself is not blocked on it and is not the right vehicle to fix it.

## What was NOT re-litigated

- `outstanding-work` / `format-outstanding-summary` (expedite_lib.bb):
  untouched this round, already confirmed correct and unchanged.
- The later-ending wiring (bounce-bound exhausted, stage timeout, failed
  restart) inside `-main`'s own tail: untouched this round, already verified
  live by acceptance scenario 05 previously.
- Doc text (`docs/reference/BL-567-expeditor-manual.md`): not touched this
  round (only touched in the original coder commit). Its "every ending"
  claim is now genuinely true, including the three pre-flight refusals; the
  worked example in the manual only illustrates the four originally-wired
  endings, not the three refusal paths. Not a defect (the claim is not
  false) — left as a documenter discretion, not an architect bounce.

— By architect.

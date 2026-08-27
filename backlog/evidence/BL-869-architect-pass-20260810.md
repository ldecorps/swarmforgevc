# BL-869 architect review — clean pass, NONE

**Ticket:** BL-869 — a close commit is validated and credited for only ONE
ticket (fault A: `qa-approved-ticket?` reads only the first id a QA note
names; fault B: `parse-close-move` collapses a multi-ticket active->done
move to its first pair, leaving tickets 2..N committed with no approval
check at all, or — on interleaved path order — reading the whole close as
`{:allowed true}` unconditionally).
**Reviewed commit:** fc81470df4 (coder, forwarded unmodified by cleaner as
`merge_and_process cleaner 5117f81ecd`, same base as BL-798's parcel — both
tickets rode the same cleaner batch commit, forwarded as separate
`git_handoff`s per Article 2.6).
**Role:** architect. First review pass — no `bounce_history` on the ticket,
confirmed empty on `main` too (`git log --oneline main -- 'backlog/evidence/
BL-869*'`).

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Dependency-rule gate (BL-259, hard gate).** Touched files:
   `specs/pipeline/steps/bl869MultiTicketCloseGuardSteps.js`,
   `specs/pipeline/steps/index.js`, `swarmforge/scripts/commit_integrity_cli.bb`,
   `swarmforge/scripts/pipeline_stage_lib.bb`,
   `swarmforge/scripts/ticket_close_guard_lib.bb` (plus test-only files) —
   none under `extension/src` or `extension/media`. Ran `dependency-gate.js`
   directly against all five: same "can't open" scope error as the
   BL-812/BL-798/BL-800 precedent (spec-harness `.js` and swarm-scripts
   `.bb` files are outside the compiled-extension-tree the gate checks).
   NO-OP, not skipped.

2. **Co-change / logical coupling (BL-255).** Ran `co-change-report.js`
   against the five production/step files. `ticket_close_guard_lib.bb` <->
   `commit_integrity_cli.bb`/its own test runner is the top hit — exactly
   this parcel's own shape (a shared fix across the guard lib and its one
   caller). `commit_integrity_cli.bb`'s lean-ledger co-changes are expected
   (`record-lean-ledger!` is one of the two `required_wiring` targets).
   `specs/pipeline/steps/index.js` is a high-frequency registry file
   (co-changes with nearly everything that adds a step handler) — not a
   coupling concern. No cross-boundary hit into extension/webview code.

3. **Two-layer / IO-ownership / integrate-not-fork rules:** not implicated —
   swarm-scripts + spec-harness step-registration files only, no
   extension/webview/upstream SwarmForge source touched.

4. **Scope discipline.** The ticket's own `notes:` names exactly three
   production files in scope; the commit touches exactly those three plus
   the acceptance step handler and test files new work requires — no more.
   `chase_sweep_lib.bb`'s own sibling `extract-ticket-id` (line 694),
   explicitly called out as out-of-scope, is confirmed untouched
   (`git diff fc81470df~1 fc81470df -- swarmforge/scripts/chase_sweep_lib.bb`
   empty). `extract-ticket-id`/`ticket-id-from-headers` (the seven-caller,
   first-match contract `approval_context` says must stay untouched) are
   confirmed unmodified by the diff — only new sibling functions
   (`extract-ticket-ids`, `ticket-ids-from-headers`) were added below them.

5. **Correctness read — the return-shape change
   (`:ticket-id` singular -> `:ticket-ids`/`:blocked-ticket-ids`) is a
   breaking change to `validate-close-allowed`'s contract; checked for
   stale callers repo-wide** (`grep -rln
   "validate-close-allowed\|parse-close-move\|ticket-close-guard-lib"` across
   every `.bb`/`.sh`/`.clj` file, not just the three in-scope files): the
   only callers are `commit_integrity_cli.bb` (updated in this same commit,
   verified below) and the ticket's own test/property files.
   `duplicate_chain_guard_lib.bb`/`swarm_handoff.bb` reference
   `ticket-close-guard-lib` too but call a different, untouched function
   (`git-handoff-blocked-for-task?`) — not affected.
   `commit_integrity_cli.bb -main`'s new wiring
   (`(doseq [ticket-id ticket-ids] (record-lean-ledger! ...))`,
   `(mapcat #(abandon-inflight-for-ticket! ... %) ticket-ids)`) correctly
   degrades to zero iterations when `close-check` has no `:ticket-ids` (an
   ordinary non-close commit, or `{:allowed true}` with no key at all) —
   `doseq`/`mapcat` over `nil` is a no-op, confirmed by reading and by the
   passing "commits multiple --path flags together" / plain-commit shell
   tests (no close-move, no `:ticket-ids` in the JSON output).
   `close-guard-failure-message` correctly prefers `:blocked-ticket-ids`
   (falling back to `:ticket-ids`) so a partially-approved close names only
   the still-failing tickets, not the whole set — confirmed by the shell
   test "a partially-approved multi-ticket close blocks and names only the
   unapproved ticket".

6. **`required_wiring` (both entries verified independently, not just
   trusted from the commit message):**
   - `abandon-inflight-for-ticket!` runs once per closed ticket: confirmed
     by code read (`mapcat` over `ticket-ids`) and by the shell test "a
     multi-ticket close abandons in-flight mail for every closed ticket"
     passing.
   - `record-lean-ledger!` runs once per closed ticket: confirmed by code
     read (`doseq` over `ticket-ids`).

7. **Declared invariants (BL-654), three distinct passes, each with a
   dedicated generative property in
   `bl869_multi_ticket_close_guard_property_runner.bb` — re-run
   independently in this review, not just taken on the commit message's
   word** (`bb swarmforge/scripts/test/bl869_multi_ticket_close_guard_property_runner.bb`
   — 500 pure runs + 60 fs runs, generator coverage both small (179) and
   large (321) closes exercised, `ALL PROPERTIES HOLD`):
   - **Invariant 1** (every ticket in a close validated independently, N
     tickets -> N checks): P1, generative over 1-6 distinct tickets with a
     Fisher-Yates-shuffled, decoy-interspersed path list. **Non-vacuity
     re-proven by hand in this review**, not just trusted: reverted
     `parse-close-move` to the pre-fix `(first (filter active))` /
     `(first (filter done))` shape and re-ran the property runner — P1
     failed immediately and reproducibly (multi-ticket closes returning
     `nil` or a single truncated entry, exactly fault B), restored
     afterward, confirmed `git diff` clean.
   - **Invariant 2** (adding an id to a QA note never withdraws credit from
     one already named): P2, generative over a growing-prefix note text in
     the real live-note shape ("QA approved ids @ commit, landed on main.
     Bookkeep all N."). Verified `extract-ticket-ids`/`ticket-ids-from-headers`
     by code read: `re-seq` (not `re-find`) over the existing
     `ticket-id-pattern`, canonicalized upper-case, deduplicated via a
     transducer that preserves first-occurrence order, `seq`-wrapped for a
     correct nil-when-empty contract. This is genuinely new code (no
     pre-fix equivalent existed to regress against — the commit message's
     own non-vacuity claim, "P2 doesn't resolve at all, the extractor not
     existing yet," is the correct characterization for a from-scratch
     sibling function).
   - **Invariant 3** (every post-close side effect runs once per closed
     ticket): P3, exercised against the REAL `abandon-inflight-for-ticket!`
     over real temp-dir mailbox fixtures (not a mock) — seeds N in-flight
     handoffs, validates the close, abandons per ticket-id, asserts exactly
     N abandoned and zero remaining in the inbox. This is the strongest of
     the three (filesystem-backed, not pure-function-only), matching
     `required_wiring`'s own two targets.

8. **Acceptance re-run independently** (not just the ticket's own claim):
   `node specs/pipeline/cli.js
   specs/features/BL-869-multi-ticket-close-guard.feature ./tmp/...` — all
   11 scenarios pass, including both fault-A and fault-B reproductions,
   the interleaved-path-order case (scenario 03 per the ticket's own e2e
   step 3), and the single-ticket regression check (scenario 05, the
   `extract-ticket-id` first-match contract pin the `approval_context`
   calls for).

9. **Example-test re-run.** `bb
   swarmforge/scripts/test/ticket_close_guard_lib_test_runner.bb` —
   `ALL PASS`. `bb swarmforge/scripts/test/pipeline_stage_lib_test_runner.bb`
   — `ALL TESTS PASSED`. `bash
   swarmforge/scripts/test/test_commit_integrity_cli.sh` — `ALL PASS`
   (7/7, including the two new multi-ticket scenarios).

## Property Testing pass (architect-owned, undeclared properties)

All three touched pure/testable surfaces (`extract-ticket-ids`/
`ticket-ids-from-headers`, `parse-close-move`/`qa-approved-ticket?`/
`validate-close-allowed`, and the `commit_integrity_cli.bb` per-ticket
wiring) are already covered by the declared-invariant property runner above
plus the fs-backed P3. `commit_integrity_cli.bb` itself is a thin CLI
wrapper (per engineering.prompt's CLI thin-wrapper rule) exercised by the
shell test, not a property-shaped pure module. Nothing further to add.

## Handoff

Forwarded to hardender, same task name, commit is this worktree's HEAD
(cleaner's `5117f81ecd` — already an ancestor via BL-798's earlier merge in
this same session — plus this evidence commit).

# BL-983 — architect review pass: PASS to hardener (clean sweep, NONE)

- **Ticket**: BL-983 — a parcel addressed to a stage is claimed by exactly
  one of its seats (idle-first, difficulty-blind), `type: feature`, M8,
  `mutation_cost: high`, `depends_on: [BL-982]`.
- **Received**: `git_handoff` from cleaner, `2dec5c88c2` ("Merge coder
  BL-983 (0817e9ef1c) for cleanup" — a pure passthrough merge, no cleaner
  edits of its own beyond the merge), task
  `BL-983-stage-mailbox-delivers-to-one-idle-seat`. Merged clean into
  `swarmforge-architect`.
- **Reviewer**: architect, 2026-08-20.
- **Verdict**: **PASS to hardener — clean sweep, NONE.**

Diffed coder's `0817e9ef1c` against its own first parent to exclude
unrelated branch history; cleaner's `2dec5c88c2` carries an identical file
stat (no additional changes).

## Architecture review — stage-as-address, seat-as-claimant

Read every production file's diff (`handoff_lib.bb`, `ready_for_next_task.bb`,
`done_with_current_task.bb`, `swarm_handoff.bb`,
`duplicate_chain_guard_lib.bb`) against the ticket's design, and traced the
supporting helpers each new function calls:

- `handoff_lib.bb` gains `seat-stage`, `stage-queue-dir`, `stage-handoff-files`,
  `stage-sibling-seats`. `stage-queue-dir` resolves the STAGE-named
  roles.tsv row's mailbox only when one exists and differs from the current
  seat (BL-982 guarantees it exists whenever any `@`-seat does); it falls
  back to `my-mailbox-dir` otherwise — a bare seat's stage queue IS its own
  mailbox, byte-identical by construction (constraint 4, confirmed by
  reading both branches of the `if-let`).
- `ready_for_next_task.bb`: dequeue source becomes `stage-queue-dir :new`
  (the shared stage queue); `in_process`/`completed`/`abandoned` stay
  `my-mailbox-dir` (per-seat, unchanged). `in-process-files` switches from
  `my-handoff-files` to `stage-handoff-files` — necessary because a claimed
  stage-queue parcel keeps its stamped `recipient: <stage>` header, and the
  old seat-blind filter would have made a busy seat look idle (this is the
  real defect the coder's own e2e probe caught mid-build, per the commit
  message — read as CONFIRMED, not taken on faith, since the property
  runner's break-1 replay reproduces exactly this failure mode). Sibling
  seats' `completed`+`in_process`+`abandoned` basenames are folded into the
  existing BL-218 terminal sets so a redelivered copy already claimed or
  finished by a peer is refused via the SAME dedup path
  (`resolve-dequeueable-candidates`), not a new one. The claim race is
  resolved by `fs/move`'s atomic rename inside a candidate-list loop — a
  losing seat's move throws and falls through to the next candidate, never
  fails the turn.
- `done_with_current_task.bb`: identical `stage-handoff-files` fix, for the
  same reason, on the completion side.
- `swarm_handoff.bb`: `sender-role` now returns `seat-stage` of
  `SWARMFORGE_ROLE` — used for the `from:`/`role:` headers, the filename,
  and routing/validation (confirmed at every one of `sender`'s five use
  sites in `-main`, including `write-handoff!`'s `id`/`filename`/`from:`/
  `role:` construction). `state-dir` (outbox/sent physical paths) is
  UNCHANGED — still resolves via `handoff-lib/my-mailbox-base-dir`, which
  reads the full `SWARMFORGE_ROLE` (seat-local disk state), confirming the
  design's own claim that mailbox paths and parcel content are kept
  deliberately separate.
- `duplicate_chain_guard_lib.bb`: the BL-760 sender self-exclusion is now
  stage-level (`seat-stage` on both sides of the comparison) rather than
  exact-role. Necessary: with a stage-ified sender, a role-equality
  exclusion would make a claiming seat self-refuse its own forward (the
  live parcel sits in ITS OWN seat-suffixed in_process, but the sender
  identity is now the bare stage) — traced this through and confirmed the
  stage-level exclusion is exactly the right fix, and is a no-op for bare
  roles (seat-stage of a bare role is itself).
- The `recipient:` header both new functions read is stamped by
  `handoffd.bb`'s existing `add-delivery-headers` (unchanged, not in this
  parcel's diff) — confirmed by reading it directly, closing the loop on
  the design's "delivery is UNCHANGED, no new delivery machinery" claim
  rather than taking it on faith.
- Batch helpers (`ready_for_next_batch.bb`, `done_with_current_batch.bb`)
  are untouched, matching constraint 3 (no quiet batch→task conversion).

## Constraints held

- No difficulty/model-tier awareness anywhere in seat choice — idle-first
  emerges purely from a busy seat's poll resuming its own in_process
  parcel rather than dequeuing (no scheduling code at all); confirmed by
  reading `ready_for_next_task.bb`'s control flow.
- Addressing unchanged: senders still write `to: <stage>`; grepped the
  full diff for any `@` reaching a parcel and found none outside the seat-
  identity-internal helpers.
- Pipeline order/promotion/bounce enums/board/stage-dwell: no file
  touched under those areas.

## Dependency-rule gate / co-change

- Dependency-rule gate: ran against all five changed production files plus
  the step handler. Only the pre-existing BL-759 `acyclic` cycle
  (telegram-front-desk-bot.js ↔ telegramCursorOperator{Exec,Liveness}.js)
  reported — unrelated, none of this parcel's files sit under
  `extension/src` or `extension/media`.
- Co-change: `handoff_lib.bb`'s top co-changers (`handoffd.bb`,
  `swarmforge.sh`, `ready_for_next_batch.bb`/`ready_for_next_task.bb`,
  `swarm_handoff.bb`) are its long-standing expected siblings as the
  shared mailbox-path resolver — no new coupling pattern introduced by
  this parcel.

## Invariants review (BL-633/654) — all three declared, all encoded and non-vacuous

1. **Exactly one seat claims / never lost or duplicated / redelivery
   refused**: encoded by `bl983_stage_queue_property_runner.bb`'s
   per-draw exactly-one accounting (every sent parcel counted across all
   seats' in_process + the stage queue, must equal the send count, no
   basename in more than one place) plus the dedicated redelivery draws
   (peer never claims a redelivered copy; claimant keeps exactly one).
   Acceptance scenarios 01, 02, 05 exercise the same real path.
2. **Per-seat single-claim, busy-blind-to-idle-peer**: encoded by the
   per-draw per-seat `<=1` in_process assertion plus the dedicated
   all-busy draws (extra parcel stays queued BY TASK HEADER — the runner's
   own header comment records a self-correction from an earlier
   filename-based assertion that was blind to this). Acceptance scenario
   03.
3. **Seat identity never escapes the mailbox layer**: encoded by the
   forward draws asserting no `@` anywhere in the forwarded filename or
   content. Acceptance scenario 04.
- Non-vacuity: all three have a documented staged-first break-then-restore
  in the runner's header, and break 1 is explicitly the REAL defect this
  parcel's own build caught mid-flight (seat-blind in_process listing) —
  the strongest form of non-vacuity evidence, a genuine regression the
  test suite caught before it shipped, not a synthetic mutation.
- No violation found on any declared invariant.

## Verified live, not from the parcel's own claims

- `node specs/pipeline/cli.js specs/features/BL-983-stage-mailbox-delivers-to-one-idle-seat.feature`:
  **5/5 pass** (all five scenarios; 129.6s total, run detached to clear
  this session's ~2min foreground tool cap).
- `bb swarmforge/scripts/test/bl983_stage_queue_property_runner.bb` at the
  shipped default (`runs=16`, also run detached): **ALL PROPERTIES HOLD**,
  coverage `{:two-seat 10 :three-seat 6 :all-busy 8 :redeliver 8 :forward 8}`
  — every reach floor met (two-seat≥6, three-seat≥3, all-busy≥4,
  redeliver≥4, forward≥4).
- No separate shell unit test file exists for this ticket (coverage comes
  from the property runner + acceptance feature only) — confirmed by
  search, matches the coder's own stated test inventory.

## Property-testing pass

No new undeclared-property coverage warranted: the parcel touches no
TypeScript/JS pure module under `extension/src` — only Babashka (`.bb`)
production code and an integration-style acceptance step handler. The
declared invariants above are the property-testing surface for this slice
and are already fully covered.

## Everything else

No correctness defects found reading the diff or exercising the code.
Batch-mode stages remain genuinely out of scope for this slice per
constraint 3 (a second seat of a batch-mode stage stays inert, same
limitation BL-982 already documented) — not a defect, an intentional
slice boundary the ticket states explicitly.

# BL-1568 specifier amendment evidence - 2026-09-15

## Trigger

Coder note, priority 00, 2026-09-15T00:12:35Z: "BL-1568 case 04 also red:
legacy note fails BL-1223 trail predicate". Coder tip 3986fa6d6e carries
the case-01 fix, the step handler, and evidence
`backlog/evidence/BL-1568-coder-20260915.md` naming the second red.

## Reproduction on main (bec4ba5ced)

`bash swarmforge/scripts/test/test_dispatch_gap_autoroute.sh` stops at
case 01 (the minted red). With the coder's case-01 assertion applied, case
04 fails: case 02 calls `dispatch-gap-draft-lines` with no commit, the
legacy soft note is queued, and `dispatch-trail-ticket-id` answers nil for
`message: BL-217 is active with no dispatch on record - ...` (BL-1223's
narrowed predicate), so the second `dispatch-gap-items` still lists BL-217.

## Prototype of the amended shape

A scratchpad copy of the test with: case 02 supplying
`git -C "$ROOT" rev-parse --short=10 HEAD` to `dispatch-gap-draft-lines`,
queuing through `handoff-lib/queue-git-handoff!` with
`SWARMFORGE_ROLE=coordinator` and `SWARMFORGE_DISPATCH_GAP_AUTOROUTE=1`
(auto-route!'s own env), asserting `:status :queued` and exactly two
`run-once` calls; case 03 asserting `type: git_handoff`, `task: BL-217`,
`commit: <HEAD10>` in place of the `message:` grep; cases 01 and 04 as
the coder left them.

| run | result | wall |
|-----|--------|------|
| 1-3 with `SWARMFORGE_SKIP_SYNC_INJECT=1` (the file's existing seam) | ALL PASS | ~2 s |
| with `SWARMFORGE_MAILBOX_ONLY=1` instead | ALL PASS | ~2 s |
| with neither | ALL PASS | ~2 s |

Queued file (fixture): `from: coordinator`, `to: coder`,
`type: git_handoff`, `task: BL-217`, `commit: cb06a72572`, body
`merge_and_process coordinator cb06a72572`.

## Disposition

- BL-1568 amended on main: description (case 04 section, What is wanted,
  How), approval_context (amendment line; both FIRM points hold, no
  re-pend), notes, qa_e2e_procedure; feature gains scenario 05; register
  row reason widened.
- Sibling BL-1573 minted (paused, `human_approval: pending` with
  ruling_options): the production fallback itself is not a trail.
- The omission is the mint's; no bounce is recorded against the coder.

By specifier.

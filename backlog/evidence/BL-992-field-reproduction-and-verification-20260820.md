# BL-992 evidence: field reproduction + verification (2026-08-20, coder)

## qa_e2e step 1 - the field condition, reproduced live at verification time

Swept the live master checkout's `backlog/active/` against every
`.worktrees/*/backlog/active/` at ~16:45Z, read-only:

| active ticket | absent from worktrees | declares required_stages |
|---|---|---|
| BL-969-burndown-noflags-cli-test-timeout | 3 of 6 | yes |
| BL-970-wake-busy-gate-idle-pane-misclassification | 3 of 6 | yes |
| BL-976-daemon-relaunch-loses-email-key-silently | all | no |
| BL-992 (this ticket) | 3 of 6 | yes |
| BL-993-a-dead-operator-runtime-is-restarted-without-a-human | 3 of 6 | yes |
| BL-995-a-sanctioned-detached-job-survives-the-orphan-reaper | 3 of 6 | yes |
| BL-997-the-busy-marker-agrees-across-the-language-boundary | all | yes |

7 of 7 active tickets were invisible to at least one pipeline worktree at
verification time - the window was OPEN, no forcing needed. (The
"absent-from" counts above 6 come from extra non-pipeline worktree dirs
matched by the sweep's glob; the 3-of-6 rows are the six pipeline roles.)

## The fix, demonstrated end-to-end pre-encoding

Fixture root on `main` with a committed `required_stages: [coder, qa]`
ticket DELETED from the working tree; coder sent `to: cleaner`:
delivered `to: QA` with
`routing_skipped: BL-901 coder->QA skipped=cleaner,architect,hardender,documenter` -
the declaration was read from the ref. Pre-fix this exact root delivers to
cleaner (the working-tree glob sees nothing) - re-demonstrated as
non-vacuity break 1.

## Verification summary

- Acceptance 5/5 (scenarios include: ref-only prune, ref-only invalid
  declaration surfaced via the skip record's rejection-reason, no-main-ref
  fallback to the working tree, ticket-nowhere delivers as addressed with
  exit 0, BL-900/BL-9005 exact-id guard against the ref).
- Property runner (bl992_declaration_ref_lookup_property_runner.bb)
  through the real CLI: local-ahead / origin-ahead (real local remote,
  fetched never merged) / both / no-ref / nowhere / collision draw
  classes with absolute floors; results in the parcel commit.
- Fixture note: commit messages in all fixtures carry NO ticket id - the
  BL-953 task-commit coherence gate matches ids in commit subjects and
  the collision scenarios cite a commit for a different id by design
  (this bit scenario 05's first fixture build; recorded so the next
  fixture author does not rediscover it).
- Regressions: BL-951's feature (shared fixture recipe) + 
  test_required_stages_ticket_lookup_collision.sh; results in the parcel
  commit.

## Hardening fallback (engineering rules)

Babashka has no mutation/CRAP/DRY wired (BL-472 deferred) - this parcel
gates on the acceptance suite, the property runner, and the named
regression suites.

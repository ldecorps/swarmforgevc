# BL-1361 — LAND SUCCESS, 2026-09-04

The post-QA branch sweep now tells a surfaced role, not just logs it.
BL-668 shipped "surfaced to its role" as a log line only — 125
`post-qa-branch-sweep-surfaced` events against 3 `post-qa-branch-sweep-settled`
measured on 2026-09-03, and not one role was ever told. Adds the send
(`post-qa-branch-sweep-tell!`), reusing the daemon's existing
`swarm_handoff.bb` path. Per human ruling: only a dirty worktree wakes the
role immediately; a divergent branch or in-process work is told but
deferred (`SWARMFORGE_SKIP_SYNC_INJECT`), since a forwarded commit merges
it anyway on the role's next parcel. One unreachable mailbox never
withholds the rest.

## Verification (QA worktree, merged documenter tip)

- `npm run compile` — clean.
- `timeout 10 bb swarmforge/scripts/handoffd.bb` — reaches `Usage:`
  cleanly, no analysis error (boot-level check, standard now after this
  session's BL-1390/1391 incidents).
- `bash swarmforge/scripts/test/test_bl1361_sweep_tells_roles.sh` — 9/9
  PASS.
- `bb swarmforge/scripts/test/post_qa_branch_sweep_lib_test_runner.bb` —
  ALL PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1361's feature — 6/6
  (3 plain `Scenario` + 1 `Scenario Outline` with 3 examples = 6 runnable,
  matching the feature file's own count exactly).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `required_wiring` anchor confirmed present by grep: `registerSteps`
  (BL-1371); no production log-label anchor declared for this ticket
  (its own yaml notes why).
- Confirmed wiring beyond the grep anchor: `handoffd.bb` loads
  `post_qa_branch_sweep_lib.bb` and calls `post-qa-branch-sweep-tell!` from
  `post-qa-branch-sweep-sweep!`'s adapter map — not merely unit-tested in
  isolation (BL-149 precedent).
- `node extension/out/tools/qa-sibling-check.js status --ticket BL-1361` —
  `VERIFY BL-1361`, no open deferral.
- No `extension/src` touched — CRAP/DRY N/A.
- Hardener's hand-authored mutation sweep (BL-149 cooldown gate: run) —
  6 mutants targeting declared behavior; first pass 3 killed / 3 survived,
  all three real gaps closed with non-vacuous tests (a masked
  coordinator/specifier role-exclusion fixture, a boundary-coincidence
  80-char truncation no-op, an unexercised `decide-role` dirty/in-process
  priority order); re-run 6/6 killed. BL-113 Gherkin mutation: 3/3 killed
  (embedded manifest confirmed per BL-460).
- Full ancestry chain confirmed via `git merge-base --is-ancestor`: coder
  (`216e9ff051`), cleaner (`d99182426f`), architect (`aae489bd4d`,
  clean sweep, no bounce), hardener (`903d26717e`), documenter
  (`22a8fe8f04`) all confirmed ancestors of the merged tip (`8b8cfb406c`).
- No orphaned test/mutation processes before or after.

## Note: documenter independently excluded a stranded pre-fix reverse copy

The merged tip's own top commit (`8b8cfb406c`) records
`abandoned_commits: [51fb42b9df]` — a stranded reverse copy on
side/architect/cleaner that reintroduces the already-fixed BL-1392
`read-json`/forward-reference crash. Documenter's own diagnosis matches
this session's BL-1390/1391 findings exactly (same defect, same fix).
Re-confirmed independently on the merged tip before this pass: `grep -c
"read-json\b"` finds only the explanatory comment, no live call.

## Hand-built tip-pure commit

Built in scratch worktree `/tmp/land-bl1361`, off `origin/main` (which had
again advanced past this session's BL-1391 land by land time — confirmed
via `git worktree add origin/main` picking up the current tip directly,
`tip-contains-origin true`, clean fast path).

Own paths: the 10 BL-1361-named files (ticket yaml, 5 evidence files,
feature file, step handler, e2e suite, unit test runner) plus a
modification to the existing `docs/how-to/BL-668-...md` page (extending
it in place, not a new page — two clean single hunks) and `handoffd.bb`
(4 hunks, all legitimate BL-1361 content: the `post-qa-sweep-once-only?`
flag, `post-qa-branch-sweep-tell!`, its wiring into the sweep's adapter
map, and the CLI once-only dispatch branch).

Excluded: five files whose raw QA-tip diff against `origin/main` showed
zero content change — pure `100644`→`100755` mode-flip artifacts from
unrelated shared-worktree history
(`specs/pipeline/steps/lib/bl1379ParkReversalCli.sh`,
`bl1381ShiftScheduleCli.sh`, `bl1386ReconcileOwnsItsMergeCli.sh`,
`bl1387OrphanedMergeCli.sh`,
`swarmforge/scripts/test/bl1381_shift_schedule_mutation_sweep.sh`,
`test_handoffd_expedite_park_reversal_wiring.sh`). Also excluded two
comment-only edits in already-landed BL-1363 files
(`bl1363ClosingATicketIsOneCommandSteps.js`,
`test_bl1363_close_ticket.sh` — a shortened/reworded code comment, no
functional change, unrelated to BL-1361's own declared scope; BL-506
own-paths discipline).

`docs/index.md` needed a single-line modification (extending the existing
BL-668 entry) — verified the "old" side of the diff matched the scratch
tree's current line exactly before replacing. `docs/reference/Specification.MD`
needed the ticket's own entry prepended as the new top-of-stack (above
BL-1391's, this session's prior land), keeping the `Prior entry —` chain
intact. `swarmforge/scripts/test/suite-manifest.tsv` needed one new row
(`test_bl1361_sweep_tells_roles.sh`) appended in the file's existing tab
format. No accidental mode changes this time (checked `git ls-tree
origin/main` for every `.bb` file before any `chmod`).

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `timeout 10 bb swarmforge/scripts/handoffd.bb` — reaches `Usage:`
  cleanly.
- `bash swarmforge/scripts/test/test_bl1361_sweep_tells_roles.sh` — 9/9
  PASS.
- `bb swarmforge/scripts/test/post_qa_branch_sweep_lib_test_runner.bb` —
  ALL PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1361's feature — 6/6.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `required_wiring` anchor re-confirmed present by grep.
- `git diff --diff-filter=D origin/main --cached` — no deletions.
- No orphaned test/mutation processes before or after.

## Landed

- Tip-pure commit `9a084192e9` off `origin/main` at `eb7210329d`.
- `land_main_publish.sh --decide-only` (lock not held during the decision
  call) read `:lock-admission :admit`, `:next :push`,
  `origin-advanced-since-gate: false`. Acquired the lock, pushed
  `eb7210329d..9a084192e9`, verified with `git ls-remote origin main`,
  released the lock.
- No `abandoned_commits` follow-up: hand-built directly, no
  `land_step_cli.bb` attempt was run.
- Scratch worktree `/tmp/land-bl1361` removed after confirmed push.

## Not a GH-seeded ticket

`BL-1361`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.

# BL-1295 — QA verification clean, landing LAND_ESCALATE, 2026-08-30

## Verdict on BL-1295 itself: CLEAN

- Compile (`npm run compile` in `extension/`): clean, zero errors, despite
  the large entangled tip described below.
- Unit-scope: `bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb`
  — `ALL PASS: task_scope_gate_lib.bb`.
- Property: `npx vitest run --config vitest.properties.config.mjs
  bl1295RevertAttributionInvariants` — 3/3 pass (both invariants: a revert
  never claims the ticket its subject merely quotes; a revert of the task's
  own merge never changes the gate's verdict).
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1295-revert-subject-does-not-blame-the-reverted-ticket.feature`
  — 3/3 pass, including scenario 02 (a genuine foreign-scope commit is
  still refused — the fix does not weaken the gate).
- `required_wiring` confirmed by direct grep: `specs/pipeline/steps/index.js:655`
  registers `bl1295RevertSubjectAttributionSteps`.
- Hardener evidence (`backlog/evidence/BL-1295-...` chain, commit
  `5394a8ef03`): hand-authored mutation sweep on `revert-subject?`/
  `subject-names-task?` per the BL-638 Babashka fallback — 6 mutants, 4
  killed immediately, 2 real survivors killed by added assertions. Architect
  pass (`3eb680a563`) confirmed compliant. Documenter added the
  Specification.MD entry (merge-conflict with my own prior BL-1272 entry
  resolved cleanly — both are additive "Last Updated" changelog blocks, no
  content lost).
- Full unit suite (`npm test`): 212 failed / 9802, full property suite
  (`npm run test:properties`): 15 failed / 825 (plus the allowlisted BL-871
  `[vitest-worker]: Timeout calling "onTaskUpdate"`). Every failure traces to
  already-ticketed, pre-existing debt unrelated to BL-1295's own diff
  (grepped per BL-1063 before writing this down):
  - `deps.checkOrphanedAuthoredDocs is not a function` (unit + property,
    ~10 files) → BL-1221 / BL-1229.
  - `docs/deprecated/` missing, cited by constitution articles → BL-1172 epic.
  - `liveRepoDerivationGuard` → BL-1291 / BL-1212.
  - `operatorRuntimeBbFixtureClosure` (4 undeclared `.bb` deps) → BL-1265
    (title names exactly "four undeclared deps").
  - `socketFixtureShortRootGuard` → BL-1290.
  - `tempDirTrapGuard` → BL-1289.
  - `topicMakeTopBridge`/bridge/telegram cluster — `CURSOR_API_KEY` unset,
    the known BL-720 cascading env-leak flake.
  - `bl632CommitTimeGuardInvariants` (fixture missing
    `swarmforge/scripts/run_commit_guards.sh`) — this is entangled sibling
    BL-1252's own gap (`backlog/active/`, not yet at QA): it wired
    `run_commit_guards.sh` into the pre-commit hook but its own
    `required_wiring` entry doesn't cover this property test's fixture
    builder. Not BL-1295's diff, not bouncing BL-1295 for it.
  - `bl1136BabysitterdCursorForgeStampOff` (2 assertions: ledger `state:`
    value drifted from `pending` to `awaiting-human`; ticket file moved
    `active/` → `done/M8/` since BL-1136 shipped 2026-08-25) — **grepped,
    genuinely UNTICKETED.** Pre-existing drift from an already-shipped
    ticket, five days old, unrelated to BL-1295. Reporting via the note
    below rather than minting myself (not QA's job) or silently ignoring it.

## Landing is blocked — same machinery defect I already reported for BL-1272

`bb swarmforge/scripts/land_step_cli.bb
BL-1295-revert-subject-does-not-blame-the-reverted-ticket 0c550b4bcb`:

```
LAND_ESCALATE
BL-1295-...: entangled tip - sibling ticket(s) BL-1253,BL-1272 unlanded as
ancestors, tip-pure replay could not complete cleanly; specifier
adjudication needed.
land-step replay: could not create worktree
/home/carillon/swarmforgevc/.worktrees/QA/.git/land-replay-worktrees/BL-1295-0c550b4bcb
off origin/main
```

This is the exact linked-worktree bug from
`backlog/evidence/BL-1272-land-escalate-20260830.md` item 2 (`.git` is a
gitlink FILE in `.worktrees/QA`, not a directory — `replay!`'s
`(fs/path root ".git" "land-replay-worktrees" ...)` breaks). Same evidence
file's item 2 also predicted the failed attempt would leave a stray branch;
confirmed again (`land-replay/BL-1295-0c550b4bcb`, deleted by hand before
retrying, same as before).

Retried once (bounded, BL-1144 discipline), passing the master checkout as
an explicit `[repo-root]` to route around the linked-worktree bug:

```
bb swarmforge/scripts/land_step_cli.bb
BL-1295-revert-subject-does-not-blame-the-reverted-ticket 0c550b4bcb
/home/carillon/swarmforgevc
```

```
LAND_ESCALATE
BL-1295-...: entangled tip - sibling ticket(s) BL-1253,BL-1272 unlanded as
ancestors, tip-pure replay could not complete cleanly; specifier
adjudication needed.
land-step replay: nothing to commit for BL-1295 - own-paths identical to
origin/main
```

**This confirms the SECOND defect from the same prior evidence file, live on
a different ticket**: `own-commit-diff`'s `git diff-tree --no-commit-id
--name-only -r --first-parent <commit>` prints nothing for a MERGE commit
(needs `-m`/`-c`), and my own citation here (`0c550b4bcb`, "Merge documenter
BL-1295 7554d6855a into QA. By QA.") is exactly that shape — the ordinary
receive-the-handoff merge every pipeline stage makes. `task-tagged-changed-paths`
collapses to `[]`, so the replay tool reports "nothing to commit" for a
ticket that plainly has substantial own content (`task_scope_gate_lib.bb`
and four new test/spec files). This is not a second, independent bug — it is
the SAME blind spot's "blast radius" I flagged as unverified-but-suspected
in the BL-1272 evidence file, now directly confirmed to recur. Not
attempting a hand-rolled replay for the same reason as before: the tool
exists precisely so QA doesn't hand-roll this, and hand-rolling around a
shared-library bug risks compounding it.

## Disposition

Per QA.prompt's LAND_ESCALATE contract: not a bounce to the author — BL-1295's
own work is clean and none of the above is in its diff. This is that note.

BL-1272 itself is named as one of BL-1295's entangled siblings, and BL-1272
is STILL unlanded (my own earlier escalation today, `BL-1272-land-escalate-20260830.md`,
is still pending specifier adjudication) — so BL-1295 cannot land clean until
BL-1272 is resolved one way or another, independent of the merge-commit blind
spot. BL-1253 (`backlog/active/`, `status: todo`) is a newly-named unlanded
sibling not present in BL-1272's own entanglement list.

By QA.

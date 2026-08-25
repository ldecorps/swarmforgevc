# BL-954 hardener pass — 2026-08-19

## Reviewed commit
`5a626eb770` ("Merge architect BL-954 into hardener" content), merged
into hardener as `b89b8cbe5`.

## Process note
Same situation as BL-955/BL-956 in this batch: no dedicated
`backlog/evidence/BL-954-architect-*` pass file exists. Given the
self-referential nature of this ticket — it is the automation that
would have caught the exact "revert of a revert" merge hazard I have
been manually catching by hand throughout this session (BL-620,
BL-952, BL-951, BL-954 merges) — I re-derived all three fixes (D1, D2,
D3) independently from source rather than trusting the coder's commit
message.

## Scope
Three changed `extension/src` files: `src/metrics/bounceRevertGitAdapter.ts`
(new, IO-performing git adapter), `src/quality/bounceRevertVerdict.ts`
(new, pure decision logic), `src/tools/record-bounce.ts` (wired to call
`bounceRevertCheck` after the durable bounce record write). Plus the
step handler `bl954BounceRevertVerifiedSteps` and its feature file.

## Checks run (complete inventory, not first-failure-stop)

1. **Test suite**: `npx vitest run --coverage bounceRevertCheck
   recordBounceCli` — 74/74 pass, including D2 (merge-commit) and D3
   (stale-local-main) specific fixture tests.
2. **Property test**: `bl954BounceRevertCheckInvariants.property.test.js`
   — 3/3 pass.
3. **Acceptance**: `specs/features/BL-954-a-bounce-verifies-its-own-revert.feature`
   — 6/6 pass (run in background via Monitor, confirmed via task
   notification).
4. **D1 independent re-derivation** (dependency-cruiser no-io-from-policy
   gate): `node out/tools/dependency-gate.js src/quality/bounceRevertVerdict.ts
   src/metrics/bounceRevertGitAdapter.ts src/tools/record-bounce.ts` →
   "Dependency-rule gate PASSED: no forbidden edges". Independently
   confirmed `bounceRevertVerdict.ts` has zero imports
   (`grep -n "^import"` → no match, exit 1) — genuinely pure, the IO
   adapter is cleanly split into `src/metrics/`.
5. **D2 independent re-derivation** (merge-commit blindness):
   `grep -n "diff-tree\|merge-base" src/metrics/bounceRevertGitAdapter.ts`
   confirms `diff-tree -m --first-parent` is used, not a bare
   `diff-tree --name-only` — the same fix this codebase has needed
   repeatedly elsewhere (a recurring documented lesson), now correctly
   applied here too.
6. **D3 independent re-derivation** (stale local-main ref):
   `grep -n "origin/main\|isAncestorOf\|publishedOn"
   src/metrics/bounceRevertGitAdapter.ts` confirms
   `isAncestorOf(runGit, opts.commit, 'main') ||
   isAncestorOf(runGit, opts.commit, 'origin/main')` — checks BOTH
   refs, matching the constitution's "read BOTH main and origin/main"
   guidance (workflow-detailed.prompt, BL-891-adjacent lesson).
7. **CRAP**: `node scripts/crapReport.js src/metrics/bounceRevertGitAdapter.ts
   src/quality/bounceRevertVerdict.ts src/tools/record-bounce.ts` — all
   functions at or below CRAP 5.00, 100% coverage throughout, no
   flagged function.
8. **DRY**: `npx jscpd --config .jscpd.json` against the 3 changed
   files — 0 clones found.
9. **Stryker mutation**: deferred — host load 9.98/20.10/27.01, well
   over the 2x-cores busy threshold on this 4-core host. Recorded in
   the BL-942 hardening-debt ledger
   (`hardening_debt_ledger_update.bb --defer
   BL-954-a-bounce-verifies-its-own-revert mutation <3 files> ...`).
10. **Required wiring**: `bl954BounceRevertVerifiedSteps` confirmed
    registered in `specs/pipeline/steps/index.js` (line 516).
11. **Leak/process check**: `git status --short` clean (aside from the
    ledger deferral entry, now committed); no orphaned `node --test` or
    `stryker` processes; all live tmux sockets are real
    (`.swarmforge/tmux/`, operator socket) — no `$TMPDIR` fixture
    leaks.

## Outcome
No defects found. All three fixes (D1 pure/IO split, D2 merge-commit
handling, D3 dual-ref ancestry check) independently re-derived from
source and confirmed correct — not trusted from the commit message,
consistent with the extra scrutiny applied to every ticket in this
batch lacking a dedicated architect evidence file. CRAP and DRY clean.
Stryker deferred under genuine, verified host load.

Forwarding to documenter.

By hardener.

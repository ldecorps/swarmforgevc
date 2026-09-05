# QA pass — BL-1212 (abandoned_commits bookkeeping completion) — 2026-09-05

This is NOT new functional work: it is the tip-pure rebuild + `abandoned_commits`
bookkeeping following the specifier's abandon-and-rebuild adjudication
(`backlog/evidence/BL-1212-specifier-adjudication-abandon-and-rebuild-20260905.md`),
required after the documenter's send was blocked by a task-scope-gate
entanglement (a main-sync merge, `ea6628d01e`, whose subject named BL-1212
and pulled in BL-1435's mint files, per the new "a sync or receive merge
carries no ticket id" rule that landed earlier in this same session).

I already reviewed and approved BL-1212's actual functional content once,
in the earlier `BL-1292-BL-1212-qa-pass-20260905.md` batch pass (landed
`4516a43f62`, already on `origin/main`). This commit's diff against that
already-landed content is empty for both `docsStructureRealTree.test.js`
and the step handler — confirmed by direct `git diff` — the only new
content is evidence files and the ticket's `abandoned_commits:` field.

## Verification

- `npx vitest run test/liveRepoDerivationGuard.test.js
  test/docsStructureRealTree.test.js`: 24/24 pass, no regression.
- Acceptance: `run_acceptance.sh
  specs/features/BL-1212-real-tree-docs-gate-records-its-live-read-exemption.feature`
  — 2/2 scenarios pass.
- `abandoned_commits:` field present on the ticket YAML, naming the
  entangled lineage per the specifier's adjudication.
- Ancestry: `git merge-base --is-ancestor 4c4f69a7da HEAD` confirms OK.
- Orphan test-process check: `pgrep -fl 'node --test|stryker'` empty.

## Verdict

APPROVED — the underlying fix was already correct and already landed;
this closes the bookkeeping the abandon-and-rebuild remedy required.
Merging up and landing.

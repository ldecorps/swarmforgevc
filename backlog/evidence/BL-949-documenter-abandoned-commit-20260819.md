# BL-949 documenter pass: PRE_QA_GATE ancestry finding on `655ba4bd4f` — 2026-08-19

## What the gate found

Sending BL-949's documenter→QA `git_handoff` was refused:

```
PRE_QA_GATE_FAIL ancestry BL-949 655ba4bd4f stranded on swarmforge-architect
PRE_QA_GATE_FAIL ancestry BL-949 655ba4bd4f stranded on swarmforge-hardender
```

## Why it is not dropped BL-949 work

`655ba4bd4f` is `backlog/evidence/BL-949-stray-handoff-commit-mismatch-20260819.md`'s
commit — actually titled `BL-935: evidence - stray cleaner handoff names BL-935 but
carries BL-949's commit, no functional content to review. By architect.` It records
the architect's own investigation of a stray `cleaner→architect` handoff that named
task `BL-935` but cited commit `7185e6319a` (this ticket's cleaner-forwarded commit).
The architect found no BL-935 file touched, no functional content to review, and
disposed of it as an Article 1.9 no-op — correctly not forwarding it.

The gate's ancestry check matches on whole-token ticket-ID references in commit
*messages*, not on which ticket the commit's diff actually belongs to. This
commit's prose says "carries BL-949's commit," which whole-token-matches
`BL-949` and made the gate treat it as possible dropped BL-949 work. `git diff
655ba4bd4f^..655ba4bd4f --stat` touches only the one evidence file above — no
`extension/`, `specs/`, or BL-949 ticket file.

## Disposition

Declared in `backlog/active/BL-949-concierge-board-wiring-tests-assert-a-superseded-layout.yaml`'s
`abandoned_commits:` field per the gate's documented remedy (`swarmforge/handoff-protocol.md`,
"Review-Forward Evidence Gate", Check A). Nothing to merge — the commit carries no
BL-949 content to bring forward.

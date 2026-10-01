# BL-1844 — architect review pass, 2026-10-01

1 defect(s) found. One bounce, complete inventory (Article 4.4).

## D1

- **Failing command**: `grep -n 'count (:system-prompt' swarmforge/scripts/test/prompt_engine_test_runner.bb`
  run by hand (coder evidence, "What is wanted item 3" / qa_e2e step 3) —
  no assertion inside the runner itself re-checks this on every run; the
  invariant is proven once, in evidence prose, not encoded.
- **Commit hash**: 855a4b6f1f (cleaner tip received)
- **First error excerpt**: coder evidence (`backlog/evidence/BL-1844-coder-20261001.md`,
  "Invariant" section): "This quantifies over the TEXT of a test file (a
  source-code shape), not over program behavior a generator could
  exercise — no sensible executable/property encoding exists."
- **Failure class**: invariant-unencoded
- **Expected vs observed**: unlike BL-1846's invariant 1 (a claim about a
  SEPARATE file's multi-function delegation pattern, genuinely hard to
  self-check), this invariant is a claim about THIS FILE's own source
  text — `prompt_engine_test_runner.bb` can simply `(slurp *file*)` (or a
  caller can read it by path) and assert, via the same regex the coder
  ran by hand, that no `count (:system-prompt ...)` comparison sits
  outside a `<=`/`<` ceiling context. That IS a sensible executable
  encoding — a standing self-check that reruns every time the suite
  runs — not a classic fast-check generator property, but no fast-check
  generator is needed: the invariant is a single static fact about one
  file, not a property quantified over varying runtime input. "No
  generator-drawable input space" is not the same as "no executable
  encoding"; the coder's own hand grep IS the check, just not wired to
  run automatically. Leaving it as a hand-verified fact in evidence prose
  means a future edit that reintroduces a pinned length (this ticket's
  own root cause — "the red was caused by the specifier's own prompt
  edits... nothing runs this runner on a specifier commit, so the pinned
  length went unnoticed for a day") regresses silently again, with
  nothing in the suite itself to catch it — the exact failure mode this
  ticket exists to stop, now reproduced one level up.
- **Blamed role**: coder
- **Remediation pointer**: add a standing self-check near the bottom of
  `prompt_engine_test_runner.bb` (or its own small assertion near the D1
  fix) that reads its own source file and asserts no
  `(count (:system-prompt ...))` (or equivalent length) comparison exists
  outside a `<=`/`<` ceiling expression — the same regex/structural check
  the coder already ran by hand, wired to run every time the file runs.
  Non-vacuous: temporarily reintroduce a pinned-length assertion (the old
  `58371` form) elsewhere in the file, confirm the new self-check fails,
  then remove it and confirm green again.

By architect.

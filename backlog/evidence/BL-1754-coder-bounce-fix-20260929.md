# BL-1754 — coder bounce-fix evidence, 2026-09-29

## D1 (QA bounce, BL-1754-QA-20260929.md) — fixed

`swarmforge/scripts/peer_question.bb`'s `-main`: `(System/exit 4)`
(timed-out) and `(System/exit 5)` (failed) ran INSIDE the `try` whose
`(finally (fs/delete-tree run-dir))` is the only cleanup — `System/exit`
terminates the JVM immediately and never returns, so `finally` never ran
on either branch, leaking the run-dir (`prompt.md`, `answer.txt`,
`stderr.log`) every time. QA measured 213 such leaked directories on the
host (`/tmp/bl1754-peer-question-*`).

Fix: the `cond` inside the `try` now only ever *returns* an exit code
(`4`, `5`, or `nil` for the answered branch, which still just prints and
returns) — nothing inside the `try` calls `System/exit`. The `let`
binds that returned value to `exit-code`, the `try`/`finally` completes
(running `fs/delete-tree run-dir` unconditionally), and `System/exit` is
called exactly once, after the `let`, only `when exit-code` is non-nil.

Also strengthened `extension/test/bl1754PeerQuestionInvariants.property.test.js`
per QA's own remediation pointer: its invariant-1 property only diffed
`git status` of the fixture root, so it could not see a leak into
`os.tmpdir()`. Added `ownRunDirCount()` (counts
`bl1754-peer-question-*` entries directly under `os.tmpdir()`) and an
assertion that the count is unchanged across every one of the four
outcome branches (answered/refused/timed-out/failed), before the
existing git-status diff assertions.

## Non-vacuity check

Reverted `peer_question.bb` to the pre-fix version (`git show
HEAD:swarmforge/scripts/peer_question.bb`) and reran the strengthened
property test: it failed exactly as expected —
`outcome=failed: expected the helper's own run-dir under os.tmpdir() to
be cleaned up, but the count changed (225 !== 224)` (2 of 8 cases failed:
timed-out and failed, the two branches D1 named; answered/refused,
which never called `System/exit` inside the `try`, stayed green).
Restored the fix; all 8 cases green again.

## Verification

- `bash swarmforge/scripts/test/test_peer_question_cli.sh`: all 6 PASS,
  `ALL CHECKS PASSED`; run-dir count under `/tmp` (prefix
  `bl1754-peer-question-`) identical before and after (213 → 213), which
  exercises cases 05 (timed-out) and 06 (failed) — the exact branches
  D1 named.
- `bb swarmforge/scripts/test/peer_question_lib_test_runner.bb`:
  `ALL PASS: peer_question_lib.bb`.
- `cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1754PeerQuestionInvariants.property.test.js`:
  8 of 8 (the strengthened invariant 1, all four outcomes, plus
  invariant 2 unchanged).
- `bash swarmforge/scripts/check_bb_scripts_load.sh`: `1 changed Babashka
  script(s) analysed, handoffd booted - all clean.`

By coder.

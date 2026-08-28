# BL-1216 architect bounce — 2026-08-28

## Review pass inventory

- **D1 — invariant-unencoded.** The ticket declares three `invariants:`:
  1. "Every path named in a DUPLICATE-ID finding carries its backlog pool
     and that pool's live-or-terminal classification."
  2. "Colliding files that are not byte-identical, or that cannot be read,
     are never reported as identical."
  3. "When exactly one colliding copy sits in a live pool, the finding names
     that copy as the one to keep and no other."

  A property-testing infrastructure already exists for this exact file
  (`swarmforge/scripts/test/backlog_hygiene_lib_property_runner.bb`), but
  grepping it for `BL-1216`, `content`, `CONTENT DIFFERS`/`CONTENT IDENTICAL`,
  and `keep:` finds nothing — none of the three invariants are covered
  there, and no ticket note states a non-encodability reason. All three are
  pure functions over path strings and an injectable `read-fn` seam
  (`path-pool`, `pool-classification`, `content-verdict`,
  `sole-live-keep` — `swarmforge/scripts/backlog_hygiene_lib.bb`), a natural
  fit for property generation over arbitrary path sets and injected file
  contents:
  - Property 1: for any path, `describe-path`'s pool/classification suffix
    matches whatever `path-pool`/`pool-classification` independently compute
    for that same path — never drifts from the classifier it's built from.
  - Property 2: for any generated map of `{path -> content}` (including
    paths absent from the map, modeling unreadable files) and any subject +
    others set, `content-verdict` returns `"CONTENT IDENTICAL"` if and only
    if every path in the set maps to the exact same content string — any
    missing path or any differing content forces `"CONTENT DIFFERS"`.
  - Property 3: for any generated set of paths distributed across the four
    pools, `sole-live-keep` returns a non-nil path if and only if exactly
    one of the generated paths classifies as live, and that returned path is
    exactly the live one.

  Only example-based unit tests exist today (12 new assertions in
  `backlog_hygiene_lib_test_runner.bb`, well organized and covering the
  fail-closed unreadable-subject and unreadable-other cases explicitly). A
  missing property test is itself the send-back per the Invariants Review
  section — I did not hand-verify the invariants against the example tests
  as a substitute.

- required_wiring (`backlog_hygiene_lib.bb::CONTENT DIFFERS`): satisfied —
  the literal appears in `content-verdict` and is emitted by
  `format-violation`'s `:duplicate-id` branch.
- Dependency-rule gate: not applicable — this ticket's functional change is
  entirely in `swarmforge/scripts/backlog_hygiene_lib.bb` (Babashka), which
  is outside `dependency-gate.js`'s TS/JS scope by design.
- Correctness read: `content-verdict`'s `and subject-text (every? ...)`
  correctly falls through to `"CONTENT DIFFERS"` when the SUBJECT itself is
  unreadable too (not just an "other" path) — confirmed against the test
  runner's own "content-verdict reports differs when the subject itself is
  unreadable" case. `sole-live-keep`'s `(= 1 (count live))` guard correctly
  returns nil for zero or more than one live path. No other defect found.

## Remediation

Coder: extend `backlog_hygiene_lib_property_runner.bb` with fast-check-style
generated-input properties (or this project's Babashka property idiom, same
file already establishes it) encoding the three invariants above. Show each
property fails when the invariant is deliberately broken, then restore.
Forward back through cleaner → architect once added.

## Commit reviewed

5d97948f44 (cleaner's merge of coder's 54c08de4a).

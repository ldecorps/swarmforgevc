# Unowned red found while working BL-1816 (2026-09-30)

## Failing test
`swarmforge/scripts/test/prompt_engine_test_runner.bb` — assertion
"claude/coder composed text is unaffected (matches the ticket's own mint
measurement)".

## Failure, verbatim
```
FAIL: claude/coder composed text is unaffected (matches the ticket's own mint measurement)
  expected: 58371
  actual:   59135
```

## Cause
A golden byte-count for `(prompt-engine-lib/compose "coder" {:agent
"claude"})` pinned at mint time. The claude/coder composition is
`:generic` style (constitution + PIPELINE.md + `swarmforge/roles/coder.prompt`
inlined), and that content has grown by 764 characters since the assertion
was pinned — ordinary drift as `coder.prompt` accumulates new incident
paragraphs over time, not a functional regression.

## Not this parcel's
BL-1816 only touches the `:local-compact` compose path (the
knowledge-brief-payload fragment and pointer) and the `local-model` agent's
composition; it does not touch `generic-bootstrap-text`, `constitution-text`,
`pipeline-text`, or any file the claude/generic path reads. Verified by
scoped-stashing both of this parcel's modified files
(`swarmforge/scripts/prompt_engine_cli.bb`,
`swarmforge/scripts/prompt_engine_lib.bb`) back to their committed `HEAD`
content and re-running the same test runner: the same failure reproduces
identically (58371 expected / 59135 actual) with none of this parcel's
changes present.

`backlog/standing-reds.tsv` carries no row for this file/assertion as of
2026-09-30 (grepped clean before this note). Reported as an unowned-red
note (priority 00) to the specifier and coordinator per the standing-red
rule; continuing BL-1816's own work.

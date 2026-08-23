# BL-1030-forbidden-stop-flag-guard-reads-the-command-as-one-token — documenter pass — 20260823

Commit reviewed: `3845d935b1` (hardener's forward, `merge_and_process hardender
3845d935b1`, no code change — verified BL-1030's mutation-sweep anchor and
re-ran the suites).

## What changed

The expeditor's forbidden-stop-flag guard (`stop-invocation-ok?` /
`stop-invocation-verdict` in `swarmforge/scripts/expedite_lib.bb`) was vacuous
in production: it tested set membership against the whole configured command
string as one token, so `EXPEDITE_STOP_CMD=./stop-swarm.sh --sweep-inbox`
always passed. The fix tokenizes the command line the way `bash -lc` would,
tests whole tokens, and fails **closed** (refuses) on anything it cannot
tokenize with confidence (unterminated quote, dangling escape, parameter
expansion, command substitution). The check also moved earlier in
`initiate!` — now decided before `park-others!` runs, so a refusal costs
nothing (previously it fired after siblings were already parked to
`backlog/hold/`).

Both are genuine operator-facing behaviour changes: a new refusal message
class ("could not be read as a command line") and a reordering of what state
exists on disk at the moment of a stop-command refusal.

## Doc surfaces checked

- `docs/reference/BL-567-expeditor-manual.md` — the expeditor's own complete
  reference, which documents `EXPEDITE_STOP_CMD`, the order of operations,
  and the exact `REFUSE` message table (ticket's own `source:` cites this
  file at line 193). Updated:
  - **Order of operations** — inserted the new pre-flight stop-command check
    as its own step, ahead of the park step, and renumbered.
  - **Refusals table** — added a row for the new "could not be read as a
    command line" refusal; updated the forbidden-flag row's message to the
    exact new text (`stop command carries a forbidden flag: <flag> (in:
    <command>)`, derived from `stop-refusal-message`).
  - The paragraph following the table claimed all three `REFUSE` rows fired
    *after* `park-others!` — now false for the stop-command pair, which fire
    *before*. Rewritten to say so, since it directly affects what an operator
    finds parked (or not) after a refusal.
  - **Closing summary (BL-1024)** section — "three pre-flight Refusals" ->
    four, naming the new one and which side of `park-others!` each falls on.
  - Re-checked `grep -c '(System/exit' expedite_cli.bb` still `= 1` (cited by
    the doc as a structural guarantee) — still true after this parcel.
- `docs/how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md` — the
  step-by-step recipe. It has its own "When it refuses" table with a
  `REFUSE stop command carries a forbidden flag` row, and a paragraph
  claiming every `REFUSE` row prints an OUTSTANDING block with a sibling
  already parked — both stale for the same reason as the reference manual.
  Updated: added the new "could not be read as a command line" row, and
  corrected the paragraph to say the two stop-command refusals fire before
  anything is parked (BL-1030) while teardown/worktree-creation still fire
  after.
- `docs/explanation/BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md`
  — grepped for `EXPEDITE_STOP_CMD`, `forbidden`, `sweep-inbox`: no hits, no
  rationale claims contradicted. Left alone.
- `docs/diagrams/*.mmd` — grepped for `check-one`, `gave-up`, `cooldown`,
  `forbidden-stop`, `stop-invocation`: no hits. None depict this level of
  internal control flow. No diagram change needed.

## Forward

Forwarding the received commit unchanged to QA, priority 00.

By documenter.

# BL-761/BL-880 acceptance-pointer gate fails OPEN — design confirmed, trigger NOT reproduced

Raised by: documenter (note 20260820T000811Z_000218, priority 10, headline only):
"BL-761 acceptance gate fails OPEN 2/2 sends: git rev-parse outside a repo".
Coordinator verification, 2026-08-20. **Half confirmed — read both halves.**

## CONFIRMED: the fail-open posture is real and deliberate
`swarm_handoff.bb`, `pointer-gate-errors` docstring:
> "Infrastructure failures (the cited commit's tree could not be read) print a warning
> and never block the send - only a positive existence finding does."

`pre_qa_gate_gather_lib.bb` lines 11-13 state the same rule for the whole layer:
> "Fail-open on infrastructure: any git/fs read that cannot complete ... is recorded as
> a warning and that ONE check is skipped - never blocks the send."

So a gate that cannot read git does NOT block; it prints
`ACCEPTANCE_POINTER_GATE WARNING: ...` and the handoff proceeds. If the infrastructure
read fails on every send, the gate never gates — which is the documenter's concern, and
it is structurally accurate.

## NOT REPRODUCED: the "git rev-parse outside a repo" trigger
Everything the coordinator could check is healthy:
- Every worktree path in `.swarmforge/roles.tsv` resolves and rev-parses cleanly
  (specifier/coordinator -> main, coder -> swarm/coder, cleaner, architect, hardender,
  documenter, QA -> their own branches). `branch-of-worktree` has nothing to fail on here.
- `grep -rn 'ACCEPTANCE_POINTER_GATE'` across `.swarmforge/` and every worktree's
  `.swarmforge/` returns **no hits** — no recorded warning from any send.
- `git-root`/`project-root` in `swarm_handoff.bb` do NOT fail open: a failed
  `rev-parse --show-toplevel` calls `exit! 1 "Cannot find SwarmForge project root"`,
  aborting the send. So a top-level rev-parse failure would be a hard stop, not a silent pass.

**Trap for the next investigator:** searching logs for `fatal: not a git repository`
hits `handoffd-supervisor.log` many times, but those are NOT git errors — they are the
tool_miss_heal wrapper's own `grep -qiE 'fatal: not a git repository'` heal clause
appearing verbatim inside reaped `reap-job-orphan` command lines. Do not read those as
evidence.

## What is needed
The documenter saw this during its OWN sends and holds the only direct evidence. Asked
for the verbatim stderr (the `ACCEPTANCE_POINTER_GATE WARNING:` line and which of the
two sends) so the failing read can be identified rather than guessed at. The design
question — whether an infrastructure-blind gate should fail open at all, given
"complete means run-or-blocked, never assumed-clean" (Article 4.4) — is routed to the
specifier independently of that.

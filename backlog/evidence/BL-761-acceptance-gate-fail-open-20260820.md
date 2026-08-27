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

---

## RESOLVED 2026-08-20 — documenter was right; minted as BL-968 (cc870cfea)

The specifier reproduced it exactly against a third send's inputs: it is
**effectively every send**, not 2/2. Root cause: the gate's gather materializes the
cited commit's `specs/pipeline` into a temp dir under `/var/folders`
(`fs/create-temp-dir` — deliberately NOT a git repo), then runs
`resolve_contract_steps.js` over it. Three step files call
`resolveMainCheckout(__dirname)` at MODULE TOP LEVEL
(`headlessDarkEmitterAuditSteps.js:22`, `routingBreakEvenSteps.js:34`,
`standingRuleViolationsSteps.js:23`), which runs `git rev-parse --git-common-dir`
with cwd inside that non-repo tree → "fatal: not a git repository" → the require
chain dies → registry unloadable → gate warns and SKIPS.

**Why this coordinator's "not reproduced" was wrong-headed, recorded so the method
improves:** I checked `roles.tsv` worktree paths (all healthy — irrelevant, the
failure is inside a throwaway temp dir that never appears in roles.tsv) and grepped
logs for the warning (no hits — because the warning goes to **stderr only** and
scrolls past; it is never written to any log file). Both checks were sound and both
were looking in the wrong place. The lesson: when a claim is "a gate fails open",
reproduce by CALLING the gate, as the specifier did — do not infer its health from
the environment around it, and never treat "absent from logs" as "did not happen"
for a stderr-only diagnostic.

The fail-open design finding above stands unchanged and is the reason a total
registry failure surfaced as a scrolling warning instead of a blocked send.

## Verbatim capture supplied by the documenter (4c49b466e)

The evidence this file asked for is now recorded at
`backlog/evidence/BL-968-acceptance-contract-gate-warning-verbatim-20260820.md`:

    PRE_QA_GATE WARNING: acceptance-contract:BL-960 step registry could not be
    loaded at the cited commit (Command failed: git rev-parse --git-common-dir
    fatal: not a git repository (or any of the parent directories): .git)

Identical on **3/3** sends (BL-957, BL-958, BL-960 — only the ticket id varies), and
emitted on runs that SUCCEED: `EXIT: 0`, `HANDOFF DELIVERED:`, with no accompanying
`PRE_QA_GATE_FAIL`. That is the fail-open path taken in production, confirmed from the
sender's side.

It also rules out the obvious wrong answer: the sender's own cwd was healthy on those
runs (`pwd` and `git rev-parse --git-common-dir` both resolved), so the failure is
inside the gate's materialized temp tree, exactly as BL-968 root-caused. Combined with
the specifier's independent reproduction, three roles now agree from three vantage
points.

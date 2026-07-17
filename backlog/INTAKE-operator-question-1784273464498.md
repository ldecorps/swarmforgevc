# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-17T07:31:04Z) - a directive came in from the human operator
(via the operator console, not Telegram) that is engineering work, not a desk
call. This is a RAW ask, not a spec: the specifier drains this like any other
backlog-root item and decides what (if anything) becomes a real ticket.

## The question

Can the swarm auto-reap orphaned agent processes?

### Context / motivation (operator-gathered facts, not a spec)

An orphaned coder process (pid was 3168697, ~6h43m old) was found and killed
by hand this session. It was a leftover from an onboarding/second-swarm
**dry-run**: launched from a `/tmp/tmp.XXXX/.swarmforge/...` mktemp dir, with
`--remote-control SwarmForge-Coder` but WITHOUT `--dangerously-skip-permissions`
(the tell of a dry-run, not a live agent). Its working directory was already
deleted, it had 0 children, ~0% CPU. These accumulate because onboarding /
second-swarm bring-up dry-runs (e.g. FES) run from a temp checkout and don't
always tear their agents down. This is the kind of self-improvement the swarm
should own.

### Why this is HIGH-RISK and must be specced defensively

Auto-killing `claude` processes is the exact bug class that has bitten this
swarm repeatedly. `kill_all_swarm.sh` (lines ~45-55) documents **BL-367**,
where an unscoped socket glob matched and killed the LIVE swarm's own socket
FIVE times in one session. A pattern-based reaper (`pgrep claude | kill`) is
therefore forbidden. Every existing reaper (swarm-cleanup.sh,
swarm-window-watchdog.sh, kill_all_swarm.sh) targets an EXPLICIT tmux socket +
window-id list, never a process pattern - the new reaper must keep that
discipline.

### Proposed safe heuristic (specifier owns final design)

Kill a `SwarmForge-*` remote-control claude process ONLY when ALL hold:
  1. `/proc/<pid>/cwd` is `(deleted)` OR resolves OUTSIDE this repo's
     `$ROOT/.swarmforge` (a live agent's cwd always resolves inside root);
  2. the pid is NOT a member of the live control socket's tmux window set
     ($ROOT/.swarmforge/tmux/*.sock - the BL-367-scoped path); and
  3. the pid has no child processes (`pgrep -P`).
Every kill must be audit-logged (cf. kill-all-audit.log). Candidate homes: a
periodic sweep in handoffd_supervisor, or a new reap_orphan_agents.bb modelled
on reap_stale_test_fixtures.bb.

### Acceptance must include

- A BL-367 non-regression guard: a live agent (cwd inside root, in the live
  window set) is NEVER selected, proven by test (cf.
  test_swarm_socket_not_in_tmp.sh as the model).
- No `pgrep <pattern> | kill` path anywhere.
- Audit log entry per kill.

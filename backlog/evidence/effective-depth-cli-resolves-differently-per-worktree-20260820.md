# effective_backlog_depth_cli.bb silently returns a DIFFERENT cap depending on which checkout runs it

Raised by: architect (priority-00 note 20260819T235853Z_000270), challenging the
coordinator's all-roles broadcast that the cap is 7. **Architect is CORRECT.**
Coordinator verified and is issuing a correction.

## Measured
    root=.                      cap=7   .swarmforge/swarm-identity: present
    root=.worktrees/architect   cap=3   .swarmforge/swarm-identity: MISSING
    root=.worktrees/coder       cap=3   .swarmforge/swarm-identity: MISSING
    root=.worktrees/hardender   cap=3   .swarmforge/swarm-identity: MISSING

`.swarmforge/swarm-identity` exists ONLY in the master checkout (`ls
.worktrees/*/.swarmforge/swarm-identity` → no matches). With it present the CLI
resolves `launch_pack full-forge` → `swarmforge/packs/full-forge.conf:26` → **7**.
With it absent it falls back to `swarmforge/swarmforge.conf:10` → **3**.

## Why this is a defect, not a usage error
The CLI's own header says only `Usage: effective_backlog_depth_cli.bb <project-root>`.
It never states that "project-root" means the MASTER checkout specifically, and a
worktree role's project root legitimately *is* its worktree. The fallback is silent:
no warning, no non-zero exit, no "identity not found" on stderr — it just returns a
confidently wrong number. That is fail-OPEN on a governance constant, the opposite of
the fail-CLOSED posture Article 3.2.4 and BL-262 take elsewhere.

Consequence: every role that follows the documented usage from its own worktree
believes the cap is 3 while the coordinator promotes against 7. Two roles reading the
same documented command disagree, and nothing surfaces the disagreement — this is the
"constant mirrored across a boundary with no test asserting the two agree" shape the
engineering rules already name (BL-897), here across CHECKOUTS rather than languages.

## Which value governs (coordinator ruling on the operational question)
**7 is operative.** The cap governs `backlog/active/`, which exists in the master
checkout; promotion is coordinator-only and happens there; and `swarm-identity` records
`launch_pack full-forge` for THIS launch, which the 3 does not describe — 3 is a
default-conf fallback, not a statement about the running swarm. The coordinator's
broadcast was right in substance and incomplete in that it did not warn that checking
from a worktree returns 3.

## Suggested fix direction (specifier's call, not decided here)
Resolve identity from the git common dir / master checkout rather than the cwd root, or
fail closed with a clear error when `swarm-identity` is absent instead of silently
falling back to the default conf.

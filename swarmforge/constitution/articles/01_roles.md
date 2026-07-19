# Article 1: Roles and Responsibilities

## 1.1 Coordinator
- **Worktree**: `main` (no code commits).
- **Responsibilities**:
  - Controls intake of new parcels from the backlog.
  - Routes parcels to the **specifier** for initial processing.
  - Tracks parcel location in the pipeline and unblocks stalls.
  - Decides when a parcel is ready for merging (via the **specifier**).

## 1.2 Specifier
- **Worktree**: `main`.
- **Responsibilities**:
  - Receives parcels from the **coordinator** and defines acceptance criteria.
  - Forwards parcels to the **coder** for implementation.
  - Merges QA-approved parcels into `main`.

## 1.3 Coder
- **Worktree**: `.worktrees/coder`.
- **Responsibilities**:
  - Implements features or fixes based on the **specifier’s** criteria.
  - Forwards work to the **cleaner** after completion.

## 1.4 Cleaner
- **Worktree**: `.worktrees/cleaner`.
- **Responsibilities**:
  - Refactors code for readability, DRYness, and maintainability.
  - Forwards work to the **architect** after cleanup.

## 1.5 Architect
- **Worktree**: `.worktrees/architect`.
- **Responsibilities**:
  - Reviews architecture for scalability, security, and design patterns.
  - Forwards work to the **hardener** after approval.

## 1.6 Hardener
- **Worktree**: `.worktrees/hardener`.
- **Responsibilities**:
  - Improves test coverage, kills mutants, and reduces CRAP metrics.
  - Forwards work to the **documenter** after hardening.

## 1.7 Documenter
- **Worktree**: `.worktrees/documenter`.
- **Responsibilities**:
  - Updates documentation (READMEs, comments, changelogs).
  - Forwards work to **QA** after documentation is complete.

## 1.8 QA
- **Worktree**: `.worktrees/QA`.
- **Responsibilities**:
  - Runs final tests and quality checks.
  - Forwards approved parcels to the **specifier** for merging.
  - Rejects parcels with issues, routing them back to the appropriate role.

## 1.9 Handoff Rules
- All roles must use `swarm_handoff.sh` to forward parcels.
- A role must **not** forward a parcel if the received commit produces no functional change.

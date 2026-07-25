# BL-629: Build Freshness QA Approval Gate

The `build_freshness_cli.bb` script manages daemon process freshness and detects stale deployments. BL-629 adds a deploy-time gate that refuses to sync the codebase to long-lived daemons when the `main` branch contains commits that have not been QA-approved.

**Last Updated:** 2026-07-25

## Background

Long-lived daemons (bridge, bot, front-desk supervisor, handoffd, handoffd supervisor, operator runtime) load code once at startup and hold it in memory. A merge to `main` never reaches them without an explicit recompile and restart. The `build_freshness_cli.bb sync` command detects stale processes and restarts them when code has changed.

Before BL-629, `sync` deployed whatever `main` currently pointed to without checking whether that tip had passed QA review. The BL-590 incident (2026-07-25) demonstrated the risk: commits reached `main` and `origin/main` without passing the architect, hardener, documenter, or QA stages, and would have deployed known defects to every daemon on a routine `sync` call.

## The QA Approval Gate

### Purpose

The gate prevents syncing daemons when the `main` branch tip contains code that is not an ancestor of `swarmforge-QA` (the integration branch marking QA-approved commits). It is the only control preventing pre-QA code from reaching production daemons during the routine post-QA deployment step.

### How It Works

When `sync` is called, it:

1. Checks if the `swarmforge-QA` ref exists (fails closed if missing)
2. Finds the merge-base between `main` and `swarmforge-QA`
3. Lists all commits on `main` since that merge-base
4. For each commit, checks whether it touches the deployed code surface (extension source, swarmforge scripts excluding tests)
5. If any commit touches the deployed surface and is not QA-approved, refuses with exit code 3
6. Checks for uncommitted changes in the deployed code surface; refuses if any exist

The "deployed code surface" consists of:
- `extension/src/`
- `extension/package.json`
- `extension/package-lock.json`
- `extension/tsconfig*`
- `swarmforge/scripts/` (excluding `test/`)

Commits touching only bookkeeping paths (backlog YAML, briefing JSON sidecars, ticket evidence) do not trigger a refusal and allow routine post-QA operations to proceed.

### Failure Modes

The gate refuses with distinct reasons:

**missing-ref:** The `swarmforge-QA` ref does not exist. This is a safety-first posture: the absence of an approval reference must never permit a deploy.

**gather-failed:** A git command failed while gathering the facts needed to decide (e.g., `main` and `swarmforge-QA` have no common ancestor, or a `git diff-tree` call failed per commit). Absence of complete facts is treated as failure-closed: the gate refuses rather than assuming the tip is approved.

**code-drift:** The `main` tip contains one or more commits that touch the deployed code surface and are not ancestors of `swarmforge-QA`. The refusal message names the offending commit hashes.

**dirty-surface:** The working tree has uncommitted changes under the deployed code surface. The gate refuses to ensure the deployed code matches what `main` claims to be, preventing a scenario where the tip is approved but the actual build differs.

### Exit Codes

- **0:** Success. The gate permitted the sync (or was bypassed with `--override`), and all restarts completed.
- **2:** Operational failure. A recompile or restart step failed, or a git/shell command failed during gate decision-gathering.
- **3:** Gate refused. The tip is not QA-approved, the `swarmforge-QA` ref is missing, or facts could not be determined.

### The Override Mechanism

The `--override` flag permits sync to proceed even if the gate refuses. The override:

- Is one-shot: it does not "remember" or apply to future syncs
- Is never sticky: the CLI never reads an override record to make future decisions
- Logs durably: each override is appended to `.swarmforge/build-freshness/sync-overrides.jsonl` with a timestamp, reason, and the offending commits/paths
- Still performs the sync: recompile and restart proceed normally after override

The override is the escape hatch for exceptions like expeditor-landed commits (which are QA-stamped offline but not `swarmforge-QA` ancestry) or intentional fast-tracks approved by the operator.

## Commands

### `build_freshness_cli.bb <project-root> report`

Gathers and reports the freshness state of all daemons and the QA approval status of the `main` tip.

**Output:**
```json
{
  "processes": [
    {
      "name": "bridge",
      "running_sha": "abc123def456",
      "main_sha": "def456ghi789",
      "stale": true
    },
    ...
  ],
  "qa_approval": {
    "approved": false,
    "offending_shas": ["1a2b3c4d5e", "6f7g8h9i0j"],
    "qa_ref_missing": false,
    "could_not_determine": false
  }
}
```

- **processes:** Each tracked daemon with its running build SHA, `main`'s current HEAD, and whether the process is stale.
- **qa_approval.approved:** `true` if `main`'s tip is QA-approved (or has no code drift).
- **offending_shas:** Commit hashes on `main` that touch the deployed surface and are not QA-approved.
- **qa_ref_missing:** `true` if the `swarmforge-QA` ref does not exist.
- **could_not_determine:** `true` if git commands failed during drift gathering, so the approval status is unknown (treated as not-approved).

Exit code is always 0; an unknown approval status reads as not-approved (fail-closed).

### `build_freshness_cli.bb <project-root> sync [--override]`

Checks the QA approval gate, then recompiles (if needed) and restarts stale daemon groups.

**Behavior without `--override`:**
- If the gate refuses, prints the refusal reason and exits with code 3
- Nothing else runs: no recompile, no restart
- The reason names the issue (missing ref, gather failure, code drift, or dirty working tree) and suggests two paths forward: land the change through QA, or rerun with `--override`

**Behavior with `--override`:**
- Logs the override to `.swarmforge/build-freshness/sync-overrides.jsonl`
- Proceeds with recompile and restart regardless of gate status
- Returns normally with exit 0 on success

**Output on success:**
```json
{
  "report": [...],
  "restarted": ["front-desk", "handoffd", "operator"]
}
```

## Operational Notes

### Incident Context (BL-590)

On 2026-07-25, commits reached `main` without passing the back half of the pipeline (architect, hardener, documenter, QA). The incident was caught by an architect noticing the branch state. The daemons had not synced due to a liveness gap, but a routine `sync` call during that window would have deployed three known live defects in the Telegram redelivery path.

### Known Friction: Expeditor-Landed Commits

BL-567's commits are QA-approved via the expeditor (an offline single-ticket pipeline), but they are not ancestors of `swarmforge-QA` (the normal integration branch). A post-expedite `sync` will refuse with "code drift" until the next normal QA landing self-heals the ancestry. Use `--override` to permit the sync in this case.

### Git Command Failures

If the gate encounters a git command failure (e.g., `main` and `swarmforge-QA` share no common ancestor, or a commit's paths cannot be determined), it treats this as failure-closed: the gate refuses rather than guessing the tip is approved. The refusal reason is "gather-failed". This is rare in normal operation but can occur in multi-swarm or emergency scenarios.

## Related Tickets

- **BL-630:** Push sweep refuses non-QA-approved main (complement to BL-629)
- **BL-631:** Babysitter detects pipeline work on main (land-time detection)
- **BL-632:** Commit-time guard refuses pipeline code on main (pre-commit hook)
- **BL-567:** Expeditor (offline single-ticket pipeline)

## Testing

The gate is covered by:
- **Unit tests** (`swarmforge/scripts/test/build_freshness_lib_test_runner.bb`): drift decision, missing-ref fail-closed, dirty-surface vs dirty-outside, override behavior
- **Acceptance tests** (`specs/features/BL-629-sync-refuses-non-qa-approved-main.feature`): 12 scenarios covering refusal, routine sync, override, report distinction between stale and unapproved, working-tree drift, and missing-ref
- **Shell tests** (`swarmforge/scripts/test/test_build_freshness_cli.sh`): CLI output shape and the tip-approval distinction on the report's JSON output

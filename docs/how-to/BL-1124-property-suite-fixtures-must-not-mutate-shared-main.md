# Property-suite fixtures must not mutate shared main (BL-1124)

## Incident class

Property fixtures under `npm run test:properties` (and the pre-commit
`check_property_suite_drift.sh` lane) have run against the **live** repo and:

1. Renamed a role branch (e.g. `swarmforge-coder` / `swarmforge-documenter`) to `main`
2. Advanced shared `main` with synthetic promote/close commits
3. Left `core.bare=true` on the master checkout

A follow-on “recovery” that `git reset --hard origin/main` while local was
ahead discarded legitimate swarm bookkeeping (reflog restore required).
Companion post-damage heal: BL-1123.

## What changed

| Piece | Role |
| --- | --- |
| `property_suite_shared_repo_guard.sh` | Snapshot + assert `core.bare` / HEAD ref / SHA |
| `check_property_suite_drift.sh` | Canary before/after `test:properties`; fail if changed |
| `main_recovery_refuse_when_ahead.sh` | Refuse reset-to-origin when local is ahead |
| `expedite_fixture.sh` | Refuse dest that is a live swarmforge checkout; `git init -b main` (no `branch -M`) |

## Operator runbook

### After a property-lane scare

1. Confirm bare and tip: `git config --bool core.bare` and
   `git symbolic-ref HEAD` / `git rev-parse HEAD`.
2. **Do not** `git reset --hard origin/main` if you are ahead of `origin/main`.
3. Probe the policy helper:

```bash
bash swarmforge/scripts/main_recovery_refuse_when_ahead.sh
```

Exit non-zero means restore the pre-incident tip from reflog (or BL-1123
heal), not discard ahead commits.

### Writing fixtures

- Use only temp / isolated git dirs for ref and commit operations.
- Never point `GIT_DIR` at a live role or master worktree.
- Seeding via `expedite_fixture.sh` into a path that contains
  `swarmforge/scripts/handoffd.bb` is refused.

### Acceptance

`specs/features/BL-1124-property-suite-fixtures-must-not-mutate-shared-main.feature`

## Bare origin/main rematch

QA bounced hitchhiked tips whose `origin/main...HEAD` carried sibling
rematch actives. Downstream must **recreate** on current `origin/main`
(`git checkout -B … origin/main`) and land **BL-1124 paths only** — never
merge into hitchhiked ancestry. Hitchhike gate:

```bash
git diff --name-only origin/main...HEAD \
  | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8' \
  && echo FAIL || echo CLEAN
```

Also keep `origin/main...HEAD` to BL-1124 product/docs/evidence (guard
scripts, APS, how-to, ticket YAML). Hitchhiked tips belong under
`abandoned_commits`.

## Canary fires on every exit path, including a kill (BL-1202)

`check_property_suite_drift.sh` originally asserted the BL-1124 canary only
after the guarded suite returned (green or red). A foreground `git commit`
killed mid-run (e.g. a client-side timeout) skipped the canary entirely and
left the suite's own background processes running — the 2026-08-27 19:37
incident that rewrote the `swarmforge-cleaner` branch ref with fixture
commits. The guard now runs the suite as the leader of its own process
group and installs an idempotent `report_canary_once()` on `EXIT`/`INT`/
`TERM` traps, so the canary verdict is reported and the suite's whole
process group is killed by pgid on every ending — green, red, or killed —
not only a normal return. Short-circuits above the point a real suite run
starts (path skip, BL-1121 reconcile-import skip, the env override,
toolchain-missing) still leave the traps a no-op: nothing started, nothing
to report. Acceptance:
`specs/features/BL-1202-shared-repo-canary-reports-on-every-exit-path.feature`.

## Canary must not inherit commit-time skip (rematch)

`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` is a legitimate **commit-time**
recovery override. Acceptance and the shared-repo guard unit runner must
**unset** it when exercising the bare-flip canary so scenario 02 cannot go
green under a shell that still carries the override from a prior rematch
commit.


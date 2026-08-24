# BL-1106 — hardener pass, 2026-08-24

## Inbound

Merged architect `0788af9ad5` (on cleaner `a993f3e533` / coder
`e74f01e1ac`) into `swarmforge-hardender`.

## Scope

Pause (and throttle) effective-depth inputs resolve at the master checkout
via `master-runtime-path` → `resolve-identity-root`. No `extension/src/**`
change — Stryker/CRAP/DRY N/A; degraded `.bb` gate = unit + surgical.

## Host

Load ~2.9 on 20 cores (quiet).

## BL-113 Gherkin (soft)

```
total=18 completed=18 killed=18 survived=0 errors=0
outcome: "pass"
```

Manifest stamped into the feature (Outline 01). Scenario 02 covered by
surgical / acceptance.

## Hand-authored surgical sweep

| # | Mutant | First pass | After property fix |
|---|--------|------------|--------------------|
| M1 | pause-marker → raw `project-root` | killed (acceptance) | killed (property) |
| M2 | throttle path → raw `project-root` | **survived** | killed (property) |
| M3 | `master-runtime-path` drops `resolve-identity-root` | killed (acceptance) | killed (property) |

**M2 gap:** the property asserted `throttlePath.startsWith(master)`, but the
fixture names the worktree `${master}-wt`, so a worktree-relative path still
prefixes with `master`. Switched to exact `path.join(master, …)` equality
for pause and throttle. Re-sweep: 3/3 killed, 0 survived.

## Verification

- `bb …/backlog_depth_test_runner.bb` → ALL PASS
- `test_effective_backlog_depth_cli.sh` → ALL PASS
- Acceptance 7/7; properties 2/2; whole-tree guards 125/125
- CRAP / DRY / Stryker: N/A

## Findings

NONE (after path-equality lock).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1106-a-pause-is-visible-from-every-checkout`.

By hardender.

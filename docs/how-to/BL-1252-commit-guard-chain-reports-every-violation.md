# Pre-commit guard chain reports every violation in one refusal (BL-1252)

*How-to. Task-oriented: understand why a refused commit now lists more
than one guard, and how to clear it.*

Pre-commit-time aggregation, sibling to the commit-msg-time aggregation
[`check_merge_deletion.sh`](BL-1242-merge-deletion-guard.md) already uses
(BL-1242): `swarmforge/scripts/run_commit_guards.sh`, wired into
`swarmforge/git-hooks/pre-commit` in place of four sequential guard calls.

## What changed

The hook used to run four guards as four sequential commands under
`set -euo pipefail`:

```
check_commit_size.sh 50
check_ticket_deletion.sh
check_pipeline_code_on_main.sh
check_property_suite_drift.sh
```

All four end in their own `exit 1`, so the first one that refused aborted
the hook and the rest never ran. A commit that violated three guards at
once cost three separate commit attempts: fix the size, re-commit, learn
about the deletion, fix it, re-commit, learn about the pipeline paths.
Constitutional Article 4.4 forbids exactly that shape of a reviewing role —
"never bounce at the FIRST defect; finish the full checklist, send one
bounce with every defect" — and a pre-commit hook is a reviewing gate.

Now `run_commit_guards.sh` runs the guards under `set -uo pipefail` (no
`-e`), captures one exit status per guard, and reports every violation it
found in a single refusal. Each guard's own script still enforces its own
`set -euo pipefail`, so no guard's predicate, threshold, or exemption
changed — only the completeness of the report.

## The two tiers

The four guards are not equally cheap. `check_property_suite_drift.sh`
runs `npm run test:properties`; the other three only read the git index.
So the runner groups them:

- **Tier 1 (cheap):** `check_commit_size.sh`, `check_ticket_deletion.sh`,
  `check_pipeline_code_on_main.sh` — all three always run, and if any
  refuses, the commit is refused with every Tier-1 violation named. Tier 2
  is never reached.
- **Tier 2 (expensive):** `check_property_suite_drift.sh` — reached only
  once all three Tier-1 guards pass, so the property suite is never
  charged to a commit that is already refused for a cheap reason. It still
  runs on every commit that Tier 1 allows — deferring it never means
  skipping it.

Guard order inside Tier 1 is unchanged, so a commit with exactly one
violation still sees the same message it did before this change.

## If you hit this refusal

```text
pre-commit: COMMIT REFUSED. Guards reporting a violation: check_commit_size.sh check_ticket_deletion.sh
pre-commit: every guard in this tier ran, so the list above is complete - there is no second violation waiting for your next attempt (Article 4.4).
```

Fix every guard named on the `Guards reporting a violation:` line and
retry — there is no second violation still hidden behind the first.

An unexpected non-refusal exit (a crash, a missing script) is called out
separately and still refuses the commit:

```text
pre-commit: these guards did not refuse cleanly - they failed unexpectedly (a crash, a missing script, or any non-refusal exit): check_pipeline_code_on_main.sh (exit 127)
pre-commit: an unexpected failure still refuses the commit; it is never collected as a pass.
```

## Where it lives

| Piece | Location |
| --- | --- |
| Aggregating runner | `swarmforge/scripts/run_commit_guards.sh` |
| Wired into | `swarmforge/git-hooks/pre-commit` (`exec`'d as the hook's whole body) |
| Acceptance steps | `bl1252CommitGuardCompleteInventorySteps` (`specs/pipeline/steps/index.js`) |
| Acceptance feature | `specs/features/BL-1252-commit-guard-chain-reports-every-violation.feature` |

## Related

- BL-1242 (`check_merge_deletion.sh` / commit-msg hook) — the sibling
  aggregation this runner's shape is modelled on: `set -uo pipefail`
  across the chain, one status per call, one combined refusal.
- Article 4.4 (complete review inventory, one bounce per pass) — the
  constitutional rule this mechanical gate now also follows.

## Verify

```bash
bash swarmforge/scripts/test/test_run_commit_guards.sh
npx vitest run --config vitest.properties.config.mjs test/bl1252CommitGuardAggregationInvariants.property.test.js
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1252-commit-guard-chain-reports-every-violation.feature
```

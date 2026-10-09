# Unowned red: temp-dir-trap violation in local_model_prepare_lib_test_runner.bb

Found running the full unit lane as part of BL-2094's own verification.
This file is pre-existing on main (1e64496d93, "Intake: shared local-model
prepare lib for recruiter and steward") and untouched by BL-2094's diff.

## Repro

```
cd extension && npx vitest run tempDirTrapGuard.test.js
```

Fails:

```
swarmforge/scripts/test/local_model_prepare_lib_test_runner.bb: creates a
temp root (fs/create-temp-dir) but has no shutdown hook and no try/finally
delete-tree
```

## Owner search

- Not present in `backlog/standing-reds.tsv`.
- No ACTIVE ticket under `backlog/active` names this file.
- Two PAUSED tickets reference `local_model_prepare_lib` generally
  (`backlog/paused/BL-2106-the-steward-probes-a-local-coder-through-a-prepared-alias.yaml`,
  `backlog/paused/BL-2108-the-weekly-recruiter-benchmarks-the-prepared-alias.yaml`)
  but neither is active, and neither's own text names this temp-dir-trap
  gap specifically.

Not fixed here: out of BL-2094's own scope (a different file, a different
defect class), and fixing it was not read closely enough in this pass to
be confident of the right remediation (shutdown hook vs try/finally) without
risking a half-understood edit to a shared test runner.

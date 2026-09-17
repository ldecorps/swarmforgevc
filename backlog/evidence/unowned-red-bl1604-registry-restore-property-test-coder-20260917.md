# Unowned red: extension/test/bl1604RegistryRestoreInvariants.property.test.js

Found while running the property lane once before forwarding BL-1611
("the drift guard sees a batch role's in-process parcel" - ready_for_next.bb's
worktree-drift guard; unrelated to this red).

## Failure

`npm run test:properties` (full lane, 2026-09-17 ~11:37Z): `Test Files 1
failed | 413 passed (414)`, `Tests 1 failed | 1217 passed (1218)`.

Isolated re-run:
`npx vitest run --config vitest.properties.config.mjs test/bl1604RegistryRestoreInvariants.property.test.js`
also fails, deterministically, not a flake:

```
Unable to resolve symbol: land-step-lib/registry-rows-to-restore
```

raised from `swarmforge/scripts/test/bl1604_registry_restore_property_runner.bb:29`,
which calls `land-step-lib/registry-rows-to-restore`. That function no
longer exists in `swarmforge/scripts/land_step_lib.bb`:

```
$ grep -n "defn.*registry" swarmforge/scripts/land_step_lib.bb
1635:(defn- registry-data-lines
1676:(defn restore-other-tickets-registry-rows!
```

The runner was never updated after a rename/refactor of the function it
calls (closest candidate: `restore-other-tickets-registry-rows!`). This
breaks the whole property test file at bb load time (a stdin-batch call, so
every trial in the batch fails at once via the JS wrapper's `runBatch`).

## Not caused by BL-1611's own parcel

BL-1611 touches only: `swarmforge/scripts/ready_for_next.bb` (the
`has-in-process-parcel?` predicate), `swarmforge/scripts/test/test_worktree_drift_guard.sh`,
and BL-1611's own new files (`specs/features/BL-1611-*.feature`,
`specs/pipeline/steps/bl1611DriftGuardSeesBatchParcelSteps.js`,
`swarmforge/scripts/test/bl1611_drift_guard_in_process_property_runner.bb`,
`extension/test/bl1611DriftGuardInProcessInvariant.property.test.js`). None
of it touches `land_step_lib.bb` or the BL-1604 runner/test.

## Register

No row in `backlog/standing-reds.tsv` for this file, or for BL-1604, as of
this commit. Per the 2026-09-05 standing-red rule and Article 4.2, QA will
not approve a parcel over an unowned red - this needs an owning ticket
(fix the runner's stale symbol reference, or repoint it at
`restore-other-tickets-registry-rows!` if that is in fact the intended
successor - not adjudicated here).

By coder.

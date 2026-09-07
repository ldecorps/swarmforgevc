# Unowned red found while verifying BL-1450's qa_e2e_procedure step 2

`specs/features/BL-968-step-registry-loadable-from-materialized-tree.feature`
scenario "a QA-bound gate evaluation runs the acceptance-contract check
without a registry-load warning" fails:

```
Scenario "a QA-bound gate evaluation runs the acceptance-contract check
without a registry-load warning" failed at step "Given a QA-bound
git_handoff citing a commit whose registry contains the fixed step files":
ticket yaml not found at
/home/carillon/swarmforgevc/.worktrees/coder/backlog/active/BL-968-step-registry-loadable-from-materialized-tree.yaml
```

Cause: `specs/pipeline/steps/bl968StepRegistryMaterializedTreeSteps.js`
line 34 hardcodes `TICKET_YAML_REL = path.join('backlog', 'active',
'BL-968-step-registry-loadable-from-materialized-tree.yaml')`. BL-968 is
done - its yaml now lives at
`backlog/done/BL-968-step-registry-loadable-from-materialized-tree.yaml`
(confirmed via `find`) - normal backlog bookkeeping, not caused by any
commit in this parcel's own diff (BL-1450 touches
`extension/test/bl968MaterializedGuardSensitivity.property.test.js`, a
different file, and adds new BL-1450-only files; nothing here touches
`bl968StepRegistryMaterializedTreeSteps.js` or BL-968's own yaml/archive
state).

Grepped first: `backlog/standing-reds.tsv` and every active/paused ticket
- no row or ticket names this file or this failure. Unowned.

Scenarios 1, 2 and 4 of the same feature still pass; BL-1062's own feature
(4/4) is unaffected. This does not block BL-1450 (a different property
file, unrelated code path) but is flagged per the standing-red rule
(2026-09-05) rather than silently passed over.

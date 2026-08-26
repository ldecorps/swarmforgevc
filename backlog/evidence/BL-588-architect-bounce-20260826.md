# BL-588 — architect bounce — 20260826

- Attempted merge_and_process cleaner tip `13a1e46627`.
- Reviewed BL-588 sources in isolation (copied onto full `main` scaffold for
  gates): dependency gate **PASSED**; unit 16/16; properties 3/3; co-change
  coupling limited to BL-588 slice. Architecture of the isolated slice is sound
  (pure `batchRecovery.ts` core, IO in CLI/commands, BL-532 deferral consumption,
  thin `main()` wrapper).

## Inventory (one bounce)

### D1 — behavior: merge_and_process collapses the architect tree

**Evidence**

- Architect tip before merge (`b350a6876`): **8805** tracked paths.
- After `git merge --no-ff 13a1e46627`: **43** tracked paths (~1.27M deletions).
- `swarmforge-cleaner` tip is tip-pure/sparse (42 paths); parent chain includes
  `885adeb1e` (merge origin/main into sparse cleaner) and `88fbf1a89` (merge
  coder sparse tree). Unlike BL-728's cleaner handoff (`a1176ff14`, a merge
  whose first parent stayed on the full cleaner line), this tip merges as mass
  deletion into a full worktree.

**Required remediation**

- Re-deliver BL-588 so merge_and_process is **additive**: cherry-pick the BL-588
  path set onto the full `swarmforge-coder` line, or merge from a cleaner commit
  whose first parent preserves the full tree (same discipline as BL-728 /
  `a1176ff14`). Verify with
  `git ls-tree -r --name-only HEAD | wc -l` ≈ full repo before handoff.
- Do not forward another sparse-tip merge; QA would inherit an empty repo.

### D2 — behavior: out-of-scope paths ride the sparse parcel (QA staging)

**Sites (in cleaner tip tree, not BL-588 coder commit `2eadabd13`)**

- `extension/test/residentSpyUiHtml.test.js` — BL-1153 font-reload test (BL-728
  conflict resolution artifact).
- `stop-swarm.sh`, `swarmforge/scripts/uninstall_freshness_cron.sh`,
  `test_stop_swarm_freshness_cron.sh`, `suite-manifest.tsv` — freshness cron
  (unrelated).
- `backlog/active/BL-660-three-shift-packs-conf-selectable.yaml` — coordinator
  promotion (unrelated).

**Required remediation**

- Strip hitchhikers when re-cutting the tip; BL-588 coder commit `2eadabd13` is
  the in-scope path set (+ cleaner CLI split in `13a1e4662`).

## Invariants / property encoding (reviewed on isolated slice — not blocking once D1 fixed)

- Declared invariant encoded by `batchRecovery.property.test.js` (unchanged
  re-forward, contaminated-tip exclusion, history-rewrite refusal) — non-vacuous.
- APS `bl588BatchRecoverySteps` registered; all five feature scenarios bind.

## Revert

- Merge `8fd8c4f46` reverted with `-m 1` in commit `add544923`; architect tree
  restored to 8805 paths.

By architect.

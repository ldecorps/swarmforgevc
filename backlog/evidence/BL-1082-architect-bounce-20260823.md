# BL-1082 architect bounce — 2026-08-23

Commit reviewed: `1dab45412a` (cleaner tip —
`BL-1082/BL-1077: split named-model CLI for CRAP and mutation-site budgets`).
Merged into architect as `77331fc9f` for review, then reverted (`-m 1`) so the
architect branch does not retain the bounced tip (BL-490).

Batch tip also carries BL-1077 (Qwen credential name). BL-1077 gates in this
pass: NONE (see "What is NOT bounced"). One bounce for the review pass
(Article 4.4); earliest blamed role is coder.

## Review inventory (Article 4.4 — one bounce)

### Gates run

- Dependency gate (`extension/` cwd,
  `node out/tools/dependency-gate.js` on
  `src/swarm/modelServing.ts` + `src/tools/named-model*.ts`):
  **PASSED** — no forbidden edges.
- Co-change report: expected coupling to BL-1082 unit/property/step files.
  Historical co-change with BL-1052 / local-model pack paths is from earlier
  entanglement commits in history; **this tip's unique paths do not include
  BL-1052**. Informative only; no new boundary bounce from coupling.
- Architecture boundaries (tiles/webview vs tmux substrate; host I/O at CLI
  edge; pure plan composition in `modelServing.ts`; secrets not written to
  worktree): **PASSED** for the named-model / Qwen-guard surface.
- BL-1082 declared invariants 1 and 3: property encodings present and green
  (`bl1082NamedModelServingInvariants.property.test.js`); non-vacuity stubs
  for 1 and 3 bite a broken planner shape.
- BL-1077 declared invariant: executable encoding in
  `swarmforge/scripts/test/test_qwen_credential_name_invariant.sh` (shell
  lane; agrees across `qwen_launch_guard_lib.sh`, `start-swarm-qwen.sh`,
  `ancillary_provider_lib.sh`, and `swarmforge.sh` source site). Unit runner
  green. **NONE** for BL-1077.
- Unit: `modelServing.test.js` + `namedModelCli.test.js` 30/30 green.
- Property lane: `bl1082NamedModelServingInvariants.property.test.js` 6/6
  green (including the vacuous inv2 case below — green is not enough).

### D1 — BL-1082 invariant 2 property is vacuous (`invariant-unencoded`, blame: coder)

Ticket invariant 2:

> Nothing the pull writes can reach a commit. Weights, caches and manifests
> live outside the tracked worktree or are gitignored, and this holds for a
> model id nobody has pulled yet.

The property test at
`extension/test/bl1082NamedModelServingInvariants.property.test.js`
("BL-1082/BL-654 invariant 2…") always builds a plan with a store path
**already outside** `repoRoot`. It never draws an inside-store case, never
asserts that an inside store is refused, and therefore stays green if
`ensureStorePathOutsideRepo` is deleted or turned into a no-op.

Repro of vacuity (planner that never consults `repoRoot`):

```js
// brokenPull ignores repoRoot; property inputs keep store outside repo
const plan = brokenPull(modelId, { repoRoot, modelStorePath /* outside */ });
assert.equal(isPathInside(plan.modelStorePath, repoRoot), false); // still passes
```

The paired "non-vacuity" test only asserts `isPathInside(brokenStore, repoRoot)`
on a constructed string — it never invokes `buildNamedModelPullPlan` under a
deliberately broken implementation. Unit coverage in `modelServing.test.js`
does refuse an inside store, but BL-654 requires the **declared** invariant's
property encoding itself to be non-vacuous; unit coverage does not substitute.

#### Remediation

1. Rewrite the invariant-2 property so a broken planner that accepts a store
   inside `repoRoot` turns the property red. Prefer quantifying over store
   placement (inside vs outside) and/or asserting the throw path when
   `modelStorePath` is under `repoRoot`, for more than one model id.
2. Replace the current non-vacuity stub with a break-then-restore (or an
   inline broken planner) that actually fails the same assertions the
   property uses.
3. Keep invariants 1 and 3 as they are unless the rewrite forces shared
   helpers.

## What is NOT bounced

- Dependency / layering / secret placement for this tip.
- BL-1082 invariants 1 and 3 encodings.
- BL-1077 credential-name invariant and launch-guard wiring
  (`qwen_launch_guard_lib.sh` + `swarmforge.sh` source sites).
- Tickets sitting in `backlog/hold/` with human "reserved for Cursor"
  notes: routing/hold is coordinator-owned, not an architecture defect in
  this tip. Flagged here only as context.

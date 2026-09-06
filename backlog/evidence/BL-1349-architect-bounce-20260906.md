# BL-1349 — architect review pass, 2026-09-06 (BOUNCE)

Reviewed commit: e6cf03bf99 (cleaner merge of coder beb0f46dbc / 7f0e5766c9).

## Checklist run

- Dependency-rule gate (`node extension/out/tools/dependency-gate.js` against
  all four changed files): PASSED, no forbidden edges.
- Co-change report (same file set): no pair at or above the default
  threshold (frequency 3) — nothing flagged.
- Two-layer boundary / extension-host-owns-IO / webview-storage / secrets
  rules: not implicated — no production `extension/src/**` file touched,
  only `extension/test/**` property files and a new acceptance step
  handler under `specs/pipeline/steps/`.
- Declared invariants (ticket YAML `invariants:`):
  - Invariant 2 ("a reduced sample count is applied only to a property
    whose body spawns a real process..., a pure property keeps its run
    count"): checked every property in all three touched files — every
    numRuns reduction lands on a property whose body calls `spawnSync`
    (bl1252's five properties share one `runGuards` spawn helper;
    bl787's untouched invariant-1/2 properties, which do not spawn,
    keep their original numRuns). No violation found.
  - Invariant 1 ("no property is deleted, and no property's assertion is
    weakened... every property present at the parent commit is still
    present") — see D1 below. This is the invariant the acceptance
    scenario `no-property-is-dropped-02` exists to gate, and that gate
    is broken.

## D1 — the "no property is deleted" acceptance scenario is vacuous by construction

**File:** `specs/pipeline/steps/bl1349SpawnHeavyPropertyBudgetSteps.js`

**Class:** invariant-unencoded (the check exists in form but cannot bite).

The step for `their properties are compared with the parent commit` reads
the "before" state via `git show HEAD:<path>` (line 101) and the "after"
state from the live working-tree file (line 102). The property-file edits
and this step-handler file were committed together in ONE commit
(`7f0e5766c9`, "BL-1349: fit three spawn-heavy property files to a 15s
budget" — coder pass). Consequently, from the moment that commit exists on
any branch that later runs this acceptance suite (cleaner, architect,
hardener, documenter, QA — every remaining pipeline stage), `HEAD` already
IS the tuned, post-change file. `git show HEAD:<path>` and the on-disk file
are therefore always byte-identical, and the scenario's "no property
missing / no fc.property / fc.assert count drop" assertions can never
fail — not because no property was dropped, but because the comparison
never actually reaches the pre-ticket ("parent") state at all.

Proven directly, at the current HEAD (3508138afc):

```
$ git show HEAD:extension/test/onboarderLauncherPidGuard.property.test.js \
    | diff - extension/test/onboarderLauncherPidGuard.property.test.js
(no output — identical)
```

This is exactly the failure mode the ticket's own `approval_context` singled
out for scrutiny: "the no-deletion scenario, which is how your 'same
coverage' constraint is actually gated rather than merely promised." As
written, that constraint is NOT gated — it is merely promised, restated as
an assertion that trivially always holds post-commit. Every later stage
(hardener, documenter, QA) that runs this acceptance suite gets a false
green on exactly the property this ticket asked to be protected.

**Remediation:** compare against the actual parent commit — the commit
BEFORE the coder's `7f0e5766c9` tuning commit (e.g. resolve it as
`7f0e5766c9^`, or better, record the base SHA the ticket was minted against
and diff against that) — not bare `HEAD`. `HEAD` is only a safe "before"
reference for a step that runs BEFORE the tuning commit is made, which is
not how this pipeline works: every stage after coder inherits the commit
already merged into its worktree.

No other defect found. Dependency, co-change, invariant-2, and the
per-file-budget scenario's step wiring are all sound.

By architect.

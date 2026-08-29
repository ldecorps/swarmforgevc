# BL-1247 (bl593) — QA confirms shipped on main (no-op), 20260829

Coordinator asked QA to independently verify the coder's claim
(`backlog/evidence/BL-1247-coder-rebuild-check-20260829.md`, commit
`69ad9339a`, coder worktree only) that this ticket's fix is already fully
landed on `origin/main` with no further code to rebuild.

## Independent checks performed

1. `git fetch origin main`; `origin/main` = `cce70d985c0097ef47ea7614a65eb51e932a80d2`.
2. `git merge-base --is-ancestor 26ac974ca origin/main` → **true** (coder's
   own fix commit is a real ancestor of the current tip — not merely an
   ancestor-of-HEAD coincidence per the BL-336 trap; this is the ticket's
   own producing commit, checked directly, not inferred from a merge
   message).
3. `git diff 26ac974ca origin/main -- <4 fix files>`: zero diff on
   `extension/test/bl593MutationRunTelemetry.property.test.js`,
   `extension/test/support/bl593ScopeArb.js`, and
   `specs/pipeline/steps/bl1247PropertyGeneratorDomainAgreementSteps.js`.
   `specs/pipeline/steps/index.js` differs only in require-line order plus
   the (separately adjudicated) removal of the retired sibling
   `bl1247ReconcileSweepKillSwitchSteps` require — confirmed
   `bl1247PropertyGeneratorDomainAgreementSteps` is still required at
   `origin/main:specs/pipeline/steps/index.js:847`.
4. Read `origin/main`'s `bl593ScopeArb.js` directly: scope generator is
   `fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim() !== '')`
   — the intended fix (non-blank domain), not merely present but correct.
5. Ran `extension/test/bl593MutationRunTelemetry.property.test.js` in
   isolation via `npx vitest run --config vitest.properties.config.mjs`
   **12 consecutive times** — 12/12 green (original flake was ~30%
   file-level red).
6. Ran QA's own independent acceptance gate:
   `specs/pipeline/scripts/run_acceptance.sh
   specs/features/BL-1247-property-generator-domain-agreement.feature` —
   **6/6 scenarios green**, including the scenario that runs the property
   file 20 consecutive times in isolation (all 20 passed) and the scenario
   drawing 5000 generator values against `buildMutationRunRecord` (all
   accepted as load-bearing).
7. No orphaned `node --test`/vitest/stryker processes before or after
   (checked with the bracketed anti-selfmatch form).
8. No `docs:` deliverable on the ticket YAML; hardener's and documenter's
   contributions for this ticket were verification notes only (no
   additional code), and both are already reflected in `origin/main`'s
   content per check 3 above — nothing outstanding from those stages.

## Conclusion

BL-1247-bl593's functional fix, wiring, and acceptance criteria are all
verified present and green on current `origin/main`. This is a genuine
no-op: nothing for QA to land. Recommending the coordinator bookkeep this
ticket (`backlog/active/` → `backlog/done/`) against `origin/main`
`cce70d985c0097ef47ea7614a65eb51e932a80d2`, which is what actually carries
the shipped fix.

By QA.

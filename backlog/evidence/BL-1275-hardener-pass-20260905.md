# BL-1275 hardener pass — clean sweep, forwarding

## Merged
Merged architect's `6624ecf107` (clean sweep) into this worktree, ancestry
confirmed (`git merge-base --is-ancestor 6624ecf107 HEAD`). Pure shell
change (`check_property_suite_drift.sh`) plus one acceptance step file and
one property test — no TypeScript production source touched, so CRAP and
jscpd (both scoped to `**/*.ts` / `src/*.ts`) have no surface here.

## Re-verified
- `bash swarmforge/scripts/test/test_bl1275_refusal_evidence_retained.sh`
  — **13/13 PASS**.
- Acceptance (`BL-1275-...feature`): **4/4** pass.
- Property (`bl1275RefusalEvidenceInvariants.property.test.js`, via
  `npm run test:properties`\-equivalent config): **2/2** pass. Already
  thorough — real scratch-git-repo drives of the actual script (not a
  faked guard), an asserted reachability floor for both a >16KB and a
  multi-line suite output (the exact 2026-08-22 53KB-log shape), exact
  byte-for-byte retained-content equality, and invariant 2 exercised over
  both a checkout that gitignores `.swarmforge/` and one that does not,
  with `git add -A` as "the teeth."
- `BL-1202-shared-repo-canary-reports-on-every-exit-path.feature` (the
  feature owning this script's exit/kill paths, the riskiest neighbouring
  surface this diff's `cleanup_suite_out`/EXIT-trap change touches):
  **4/4**, no regression.

## Hand-mutation spot check (BL-638 fallback — no mutation tool wired for
`.sh`)
Three targeted mutants against the mechanisms the ticket's invariants and
notes call out as the actual risk (mutation_cost: low, matching):

1. **`next_refusal_index` always returns `1`** (breaks monotonic
   indexing — the exact "one fixed-name log clobbers the rest" defect the
   ticket's own narrative describes). Caught: 4 shell-test failures
   ("expected 3 retained logs ... found 2", clobbered second body).
2. **`prune_refusal_logs`'s boundary `(( seen > total - keep ))` weakened
   to `>=`** (off-by-one keeping one fewer than the bound). Caught: 1
   shell-test failure ("expected 3 retained logs under the bound, found
   4" — inverted direction, confirming the boundary is exercised, not
   just "some number differs").
3. **Dropped the `.gitignore` write in `retain_refusal_log`** (removes
   invariant 2's construction-time guarantee for a checkout with no outer
   ignore rule). Caught: 1 shell-test failure ("a retained log is visible
   to git in a repo that does not ignore .swarmforge/") — exactly the
   scenario architect's evidence names as the reason this write exists.

Each mutant applied by hand to the tracked script, run, confirmed failing
for the expected reason, then restored (`git diff --stat` empty after
each, confirmed before moving to the next). No mutant left a residual
diff or artifact.

Not hand-mutated: `retain_refusal_log`'s `cp` (vs. a hypothetical `mv`) —
by the time it runs, `$OUT` has already been read from `$SUITE_OUT_FILE`
earlier in the main script's flow, so nothing currently observes whether
the source survives the copy; the architect's comment on this point is a
forward-looking safety note for future callers, not a live gap this pass's
tests could distinguish either way.

## required_wiring
`bl1275PropertyGuardKeepsRefusalEvidenceSteps.js` exports `registerSteps`;
confirmed all 4 acceptance scenarios execute (no unmatched steps).

## Cleanup
No orphaned `node --test`/`stryker` processes before or after. Every
hand-mutation restore left the tree clean (`git status --short` empty
before this commit).

## Forwarding
To documenter, priority `00`, same task name, this commit forwarded.

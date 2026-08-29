# BL-1247 (bl593) — coder rebuild check after entangled-tip bounce, 20260829

Coordinator note: "BL-1247-bl593: QA bounced entangled tip 9663cc93bd; rebuild
+ forward" (QA's bounce evidence: `BL-1247-qa-bounce-20260829.md`, failure
class `behavior` / BL-506 entangled tip — the bounced commit `b5f2489906`
carried 46 unrelated paths, not a defect in this ticket's own content).

## Check performed

1. My own original fix commit for this ticket is `26ac974ca` ("Fix BL-1247:
   narrow BL-593 property test scope generator to non-blank domain"), 4 files:
   `extension/test/bl593MutationRunTelemetry.property.test.js`,
   `extension/test/support/bl593ScopeArb.js`,
   `specs/pipeline/steps/bl1247PropertyGeneratorDomainAgreementSteps.js`,
   `specs/pipeline/steps/index.js`.
2. `git merge-base --is-ancestor 26ac974ca origin/main` → **true**. My fix
   commit is already an ancestor of current `origin/main`
   (`cce70d985c0097ef47ea7614a65eb51e932a80d2`).
3. Diffed each of those 4 files plus the ticket's own YAML and acceptance
   feature between my fix commit / current origin/main — **zero diff** on
   the functional files (content byte-identical); `index.js` differs only in
   registration ORDER relative to unrelated tickets minted/landed since,
   with `bl1247PropertyGeneratorDomainAgreementSteps` present and registered
   on both sides.
4. Merged current `origin/main` into this coder worktree (`git merge
   --no-edit cce70d985`) — clean, no conflicts. Post-merge, `git diff --stat
   cce70d985 HEAD` is **empty**: this worktree's tree is now byte-identical
   to `origin/main`'s tree.

## Conclusion

BL-1247-bl593's functional fix is already fully landed on `origin/main` — it
reached main through some other branch's merge history before this parcel's
entangled-tip bounce, independent of the bounced `documenter` commit
`b5f2489906`. There is no further code for the coder to rebuild: a
tip-pure recommit of this ticket's files against current main would be an
empty (no functional change) commit. Per Article 1.9 / the No-Op Rule, I am
not sending a `git_handoff` for it.

What is NOT resolved: `backlog/active/BL-1247-bl593-...yaml` still reads
`status: todo` / `assigned_to: coder` on `origin/main` — the ticket's own
bookkeeping was never closed out, presumably because every attempt to walk
it through the pipeline got entangled with the sibling
`BL-1247-reconcile-sweep-kill-switch` id-collision history (see this
ticket's own `notes:` and `backlog/evidence/BL-1247-id-collision-adjudication-20260829.md`).
That reconciliation is a specifier/coordinator-level bookkeeping call, not a
coder rebuild — routed back via `note`, not a parcel, per Article 4.4 ("Spec
gaps leave by `note`, priority `00`, never a parcel").

By coder.

# BL-1687 — coder finding, 2026-09-24 (coder@2)

## Context
BL-1687 already progressed past coder/cleaner/architect/hardener/documenter
(all clean NONE passes, 2026-09-22 11:38-11:52 local) and was forwarded to
QA at 2026-09-22T10:52:54Z (`ac0e15804d`), landing in QA's
`inbox/completed/full-sweep-20260922T223326Z/`. No QA evidence file or
`Close BL-1687` exists yet as of this writing — QA's disposition is open,
outside this note's scope.

coder@2 was separately holding an earlier, un-forwarded build of the same
ticket (commits `5d3416820c`, `af360d7c09`, held per the depends_on
sequencing this ticket's own notes describe) and re-verified it after
merging main (which brought BL-1685's land). That re-verification is what
surfaced this finding.

## Finding
`extension/test/bl1687BridgeServerLoaderProbeInvariants.property.test.js`
(coder-authored, BL-654 first authorship for BL-1687's one declared
invariant) has a generator reach-floor defect — the same class BL-1062's
`assertReachFloor`/`runsPerCell` helpers exist to prevent:

- Property 1 drew a single handler per run via `fc.constantFrom` over the
  seventeen named handlers, `numRuns: 80`. Uniform-random coverage of 17
  items over 80 draws has roughly a 12% chance of never drawing at least
  one specific item. Reproduced: a run on 2026-09-24 missed
  `noInboundMessageIsEverLostSteps.js` (16/17 seen), failing the file's own
  reach-floor assertion.
- Property 2 had the same shape over a 6-cell space (3 require syntaxes x
  2 placements), `numRuns: 30` — roughly a 2.5% per-run miss chance. Did
  not fail on the observed run, but shares the defect.

Both properties' core assertions are otherwise correct and were not
touched. The version of this file currently sitting in QA's queue (via
`ac0e15804d` and its ancestor `af360d7c09`) carries this flake — it may or
may not fire on any given QA property-lane run.

## Fix (coder@2 branch only, not forwarded)
Replaced both `fc.constantFrom` single-pick generators with a full shuffled
permutation per run (`fc.shuffledSubarray(population, {minLength: N,
maxLength: N})`), so every value is touched by construction each run, and
switched the coverage assertions to the shared `assertReachFloor` /
`runsPerCell` helpers (`test/helpers/reachFloors.js`) — the same idiom
`bl1467RepointKeepsBookkeepingInvariants.property.test.js` already uses.
Verified green (deterministically) via:

```
npx vitest run --config vitest.properties.config.mjs \
  test/bl1687BridgeServerLoaderProbeInvariants.property.test.js
```

Both properties pass, ~17s total (down from ~23s: fewer, fully-covering
draws instead of a larger, still-gappy random sample).

## Why not forwarded as a BL-1687 parcel
BL-1687 has already cleared every downstream gate and reached QA; sending
a new coder git_handoff under the same task name this late would entangle
with the in-flight lineage QA is holding (the exact hazard Article 2.6 /
BL-506 / the ticket's own notes already navigated once for this ticket).
This note and evidence file are the flag; the fix commit lives on
`swarmforge-coder@2` for whoever needs it — QA if the flake fires during
its own property-lane run (routes back to coder per Article 4.3, at which
point this commit is the fix), or the specifier if a fast-follow ticket is
the cleaner path.

By coder.

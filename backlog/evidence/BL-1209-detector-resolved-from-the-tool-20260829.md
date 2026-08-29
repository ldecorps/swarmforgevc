# BL-1209 — the mkdtemp check resolves its detector from the tool

Coder, 2026-08-29.

## Baseline, reproduced before the change (qa_e2e step 1)

    ["src/foo.ts"]                    -> MODULE_NOT_FOUND
    ["extension/test/a.test.js"]      -> MODULE_NOT_FOUND

Both throw identically against a scratch root: the eager load meant a call with
nothing in scope failed exactly as hard as one with work to do.

## The shape chosen, and why

The ticket offered two: anchor the `require` to the tool module's location, or
move the pure detector into `src/` and have the test helper re-export it. I
took the larger one, which the ticket describes as serving the helper's own
stated intent of using "the same detector as tmpDirMigrationGuard.test.js" —
`extension/src/tools/rawMkdtempDetector.ts` now owns `RAW_MKDTEMP_PATTERN` and
`findRawMkdtempLines`, and `extension/test/helpers/rawMkdtempGuard.js`
re-exports them. One detector with two importers, not one file two consumers
reach for by path. Nothing is duplicated, per the ticket's firm line.

`repoRoot` keeps only its real job: reading the subject's files.

## Both invariants, and how they are pinned

**Invariant 1** (resolve tool artifacts from the tool): the check now imports
its detector relative to itself, so any subject root works. Every property-test
subject root is a fresh temp directory, and the property ASSERTS the detector
is absent from it before running — a generator that accidentally produced the
live repo root would otherwise pass while proving nothing.

**Invariant 2** (nothing in scope does no work): the detector is loaded lazily,
on the first path actually in scope, through an injectable `loadDetector` seam.
That makes the non-vacuity the ticket asks for measurable — the tests assert
`loads === 0`, not merely that nothing threw — and a second assertion that an
in-scope call loads it exactly once, which stops the first from being
satisfiable by a check that never loads a detector at all.

Non-vacuity, both shown and restored:

| deliberate break | what fails |
|---|---|
| resolve the detector from the subject root again | unit + property: `Cannot find module 'extension/test/helpers/rawMkdtempGuard'` |
| load the detector eagerly, before the scope check | unit + property: "the detector was loaded for a call with nothing in scope" |

## The standing red is gone (qa_e2e step 5)

    test/pilotAcceptanceGateCli.test.js: 33 passed (33)

Including "main(): a claim-refused land now succeeds once the claiming sentence
is amended out of the message", red since BL-743 landed on 2026-08-26. It was
not altered, skipped, or pointed at the live repo root — it goes green because
the defect under it is fixed.

Full unit suite: **19 failing files / 32 failing tests, down from 20 / 33**.
The single-file, single-test delta is exactly that red.

## The live test tree is no longer written into (qa_e2e steps 3 and 4)

`extension/test/pilotMkdtempConventionCheck.test.js` used to point the check at
`path.join(__dirname, '..', '..')` — the live repository — and write
`extension/test/bl743-assess-<pid>.test.js` into the collected test tree so the
scan had something to find. It had to: a fixture root could not work while the
detector was resolved from the subject.

It now builds fixture roots through the shared `mkTmpDir` helper and writes
nothing into the live tree. Verified by file-set snapshot before and after
running the suite (acceptance scenario 03), and by a full `npm test` run: no
`bl743-assess-*` file exists before or after, and the file count is unchanged.

This also closes the BL-971 hazard the ticket names: there is no longer a
generated file matching the suite's own discovery glob to be left behind by a
killed run.

## The production path still reports (qa_e2e step 6)

    checkMkdtempConvention('<repo root>')
    -> { checked: true, testFilesScanned: 5, violations: [], scannedPaths: [...] }

Exercised through `commitClaimGitReader.checkMkdtempConvention`, which is the
exact function `pilot-acceptance-gate.ts` wires as `deps.checkMkdtempConvention`
and the exact resolution it uses. I did **not** run a real `/pilot land`: that
moves a ticket YAML and writes a receipt, which is not mine to do for a
verification step. The gate-level behaviour above the check is unchanged by
this parcel, and its own tests keep their stubs, per the ticket's firm line.

## Regression

- `tmpDirMigrationGuard.test.js` 10/10 and its property file 4/4 — the
  detector's behaviour is provably unchanged, and those tests were not touched.
- `pilotMkdtempConventionCheck.test.js` 7/7 (was 3, all rewritten to fixture
  roots plus new cases for the clean-file, no-detector, nothing-in-scope and
  load-once paths).
- `pilotAcceptanceGate.test.js` still carries 8 failures, all
  `deps.checkOrphanedAuthoredDocs is not a function` — BL-1221's separate
  defect, unrelated and pre-existing.
- Acceptance 4/4.

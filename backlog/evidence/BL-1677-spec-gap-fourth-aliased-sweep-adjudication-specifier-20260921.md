# Adjudication: BL-1677 spec-gap, a fourth aliased blind sweep (bl1239) - 2026-09-21 (specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T13:14:41Z
(00_20260921T131441Z_000042_from_coder), from inside the parcel: "BL-1677
spec-gap: bl1239 has the SAME aliased blind sweep (4th file, not 3)".

**Verified.** `extension/test/bl1239SuiteManifestAccountsForEveryTestFile.property.test.js`
lines 41-49: `sweepStaleFixtures()` binds `const tmp = os.tmpdir()`, lists
it with `readdirSync(tmp)` and `rmSync`s every `bl1239-prop-` entry before
the run - the BL-971 shape the three named files carry, with alias `tmp`
instead of `parent`. Census re-run over `extension/test` (recursive, a
`(const|let|var) X = os.tmpdir()` binding followed by `readdirSync(X)`):
exactly four files - bl1239, bl1354, bl1380, bl1389. The literal form
`readdirSync(os.tmpdir())` appears in five files, all helper/guard/census
readers already out of scope (tmpDir.js, blindTmpDirSweepFinder.js,
blindTmpDirSweepGuard.test.js, stepHandlerModuleLoadBudget.test.js,
bl968StepRegistryMaterializedTreeGuard.test.js).

**Ruling: amend, not a sibling.** Same defect, same fix shape, one more
file - a separate ticket would be the near-duplicate the 2026-09-17
directive forbids, and scenario 02's "the finder reports nothing under
extension/test" would fail on bl1239 anyway once the finder learns the
aliased form (that is how the coder found it: the BL-1445 pin doing its
job). The mint's census of three was the specifier's miss: it counted the
land-step fixture family, not every aliased sweep. Amended on main: title,
scope, e2e step 1 (grep gains `tmp` and the fourth file), scenario 01
"the four files", scenario 03 census eleven (seven migrated + four).
The parcel is at the coder, so the feature file is amended on main and
the holder noted to merge (BL-1385's stamp hazard does not apply before
the hardener). No register change: bl1239 is not red, it shares the
mechanism.

By specifier.

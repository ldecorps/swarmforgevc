# BL-1505 regressed - unowned red blocking the property-suite-guard, 2026-09-25

Discovered while committing BL-1726's D1 rebuild (a new
`extension/test/bl1726OllamaLlamaServerOwnershipMarks.property.test.js`,
which triggers `check_property_suite_drift.sh`'s full `npm run
test:properties` pre-commit gate). Parcel commit base: `cfe05d082f`
("Merge main df2e6cf9f0 into coder.").

Red path: `extension/test/bl1505DedupSuppressedChaseCountInvariants.property.test.js`
(BL-1505, closed 2026-09-10, `backlog/done/BL-1505-a-dedup-suppressed-chase-still-counts-toward-escalation.yaml`).
All 3 of its tests fail, confirmed BOTH in the full lane and re-run alone
(`npx vitest run --config vitest.properties.config.mjs
test/bl1505DedupSuppressedChaseCountInvariants.property.test.js` from
`extension/`) - not a load flake. Verbatim:

    FAIL  test/bl1505DedupSuppressedChaseCountInvariants.property.test.js > BL-1505/BL-654 invariant: chaseCount equals attempted sweeps regardless of landed vs dedup-suppressed
    Error: Property failed after 1 tests
    { seed: 2101150519, path: "0", endOnFailure: true }
    Counterexample: [[false]]
    Shrunk 0 time(s)
    Caused by: AssertionError: expected chaseCount 1 after a mixed landed/suppressed sequence [false], got 0

    FAIL  test/bl1505DedupSuppressedChaseCountInvariants.property.test.js > BL-1505/BL-654 invariant boundary: an unattempted wake contributes nothing, legacy booleans unchanged
    AssertionError: expected a legacy true return to still count as attempted/landed
    0 !== 1

    FAIL  test/bl1505DedupSuppressedChaseCountInvariants.property.test.js > BL-1505/BL-654 non-vacuity: keying on the raw adapter return (not :attempted) misclassifies a dedup-suppressed sweep
    AssertionError: expected the broken (raw-truthy) gate to misclassify an {:attempted false} map as a chase (proving the fix must read :attempted, not just any truthy return)

BL-1726 touches neither this file nor its production logic
(`swarmforge/scripts/orphan_janitor_lib.bb`, unrelated). No row for this
file in `backlog/standing-reds.tsv` or in
`swarmforge/scripts/property_suite_standing_allowlist.tsv` (grep of both,
2026-09-25). BL-1505 itself is CLOSED - this is a fresh regression of a
landed invariant, not a never-fixed pole. Likely cause (untouched, not
investigated further - out of my scope): `43213a6bc2` "BL-1652: the chase
sweep never respawns a busy role or lane, and respawns at most once per
sweep" touches the same chase-sweep/dedup mechanism this test protects and
landed on main after BL-1505 closed.

So the parcel waits for an owner; this is not a bounce, and BL-1726's own
work is unaffected - `extension/test/bl1726OllamaLlamaServerOwnershipMarks.property.test.js`
itself is green alone (1/1), proven non-vacuous (red against a deliberately
broken `ollama-own-llama-server-cmdline?`, green restored), and the
`property_suite_standing_allowlist.tsv` mechanism (BL-1175) is the
documented way to land it regardless once BL-1505 has a register row -
adding that row is the specifier's, not mine (git log on the TSV: every
prior row was added in a specifier mint commit).

By coder.

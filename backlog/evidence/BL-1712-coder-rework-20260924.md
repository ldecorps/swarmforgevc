# BL-1712: coder rework after the specifier's ruling, 2026-09-24

Following the specifier's adjudication
(`backlog/evidence/BL-1712-spec-gap-register-row-removal-adjudication-specifier-20260924.md`,
ruling: same as BL-1638): merged main (d419a1d188, which carries the
amended feature and YAML) into the coder branch, then rewrote
`specs/pipeline/steps/bl1712PricingTableOpus55Steps.js`'s scenario 04
step to match the amended step text — both register rows (unit
`pricingTable.test.js`, acceptance the BL-1436 feature) are asserted
PRESENT and each owned by `BL-1712` (column 3 of its
`backlog/standing-reds.tsv` row), never absence. Absence is a
post-land-only check (`qa_e2e_procedure` step 5, unchanged).

## Verification

- `specs/pipeline/scripts/run_acceptance.sh` on BL-1712's own feature:
  6/6.
- `npx vitest run test/pricingTable.test.js test/modelDisplayName.test.js`:
  40/40, unaffected.

## A second, un-adjudicated corollary of the same ruling (not blocking)

`qa_e2e_procedure` step 2 also says `specs/features/BL-1436-...feature`
reads "all ok (6 of 6)" **on the parcel commit**. It does not: BL-1436's
OWN scenario 04 (unmodified — it predates BL-1663 and was never itself
amended) reads `Then no register row names pricingTable.test.js`, and
that row is now present (owned by BL-1712) until this parcel's land
retires it. Running it now: **5 of 6** (scenario 01 — the one the
register row originally attributed the red to — now passes, since the
pricing entry exists; scenario 04 is the new failure, for the identical
reason BL-1712's own scenario 04 was amended). This is the same
land-timing gap the ruling already resolved, one ticket over — not a new
ambiguity, so this parcel is not held on it (the pattern and its
resolution are already established); flagged to the specifier as a
non-blocking FYI (note, priority 70) so `qa_e2e_procedure`'s wording can
be corrected in the same pass whenever convenient, sparing QA a bounce
over an already-known, self-resolving-at-land condition.

By coder.

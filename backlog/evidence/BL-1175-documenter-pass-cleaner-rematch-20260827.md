# Documenter evidence — BL-1175 (cleaner rematch)

## Ticket
BL-1175-property-suite-standing-reds-block-unrelated-commits

## Hardener tip
047ac823ee

## Review inventory (Article 4.4)
NONE.

## Docs impact
- Merged hardender `047ac823ee` (cleaner rematch: +6 allowlist rows only).
- Living docs from prior pass (`4b60aa392`) remain accurate — how-to,
  Specification Standing Property-Suite Allowlist section, index link, BL-570
  cross-link, architecture note; no user-visible behaviour change this pass.
- `required_wiring` realigned: TSV needle replaces unmatchable
  `extension/ npm run test:properties` path (prior pass noted but uncommitted).
- Allowlist inventory is machine-readable in
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` (27 rows).

## Acceptance cross-check
Aligned with
`specs/features/BL-1175-property-suite-standing-reds-block-unrelated-commits.feature`.

By documenter.

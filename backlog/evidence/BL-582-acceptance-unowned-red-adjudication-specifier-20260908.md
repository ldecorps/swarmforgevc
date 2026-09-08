# BL-582 acceptance red (scenario 05) — adjudicated by the specifier, 2026-09-08

Inbound: coder note, priority 00, 2026-09-08T00:35Z, to specifier and
coordinator: "unowned-red x2 (BL-582,BL-418) - see BL-1475 evidence file";
coder evidence `BL-1475-unowned-reds-bl582-bl418-20260908.md` (coder branch,
lands with BL-1475's parcel), found batch-verifying BL-1475's touched
features and reproduced there on the pre-BL-1475 tree.

## Reproduction on main (379861057b), master checkout

`node specs/pipeline/cli.js specs/features/BL-582-approval-tap-never-records-or-repaints.feature <scratch>`:
9 ok, `not ok 8` ("an approval record write commits itself instead of
leaving uncommitted state"), message: the input did not match
`/import \{ commitApprovalWrites \} from '\.\.\/util\/commitIntegrityRunner'/`.

- `bl582ApprovalTapObservableSteps.js` line 389 pins the front desk's import
  line as that two-token literal. Since BL-1368 (`5c62e2c488`, 2026-09-05)
  the line reads `import { commitApprovalWrites, humanDecisionCommitMessage }
  from '../util/commitIntegrityRunner';` - never matching. The wiring the
  step guards (both commit adapters bound to the one `commitApprovalWrites`)
  is intact: the step's other two assertions still match.
- Red for 3 days. BL-1368's ticket never mentions BL-582 or the regex; the
  per-feature runner never ran BL-582's feature during BL-1368's parcel.
  BL-1006's shape, in a handler rather than a scenario.
- The BL-582 property test does not read the import line; not red.

## Disposition

- **Minted BL-1482** (defect, high, no approval needed: no feature file
  authored or changed): the handler's import assertion names the symbol
  and module it protects and tolerates other names on the line; BL-582's
  feature text unchanged; `acceptance:` points at BL-582's feature (the
  BL-1251 shape).
- **Registered** one `acceptance` row for BL-582's feature -> BL-1482,
  first_seen 2026-09-08 (red since 2026-09-05). Reader after the edit:
  14 rows, none unowned.
- Not minted, recorded for the next closing-ceremony lean pass: a sweep of
  `specs/pipeline/steps` for source-read assertions that pin a production
  line literally (the same over-specification can sit in any handler that
  reads `extension/src` as text). A process candidate, not a slice of this
  defect. The nightly all-features run is already recorded on BL-1462's
  adjudication.

By specifier.

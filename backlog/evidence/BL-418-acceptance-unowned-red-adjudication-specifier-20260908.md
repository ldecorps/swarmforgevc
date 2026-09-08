# BL-418 acceptance red (scenario 01, example row 2) — adjudicated by the specifier, 2026-09-08

Inbound: coder note, priority 00, 2026-09-08T00:35Z, to specifier and
coordinator: "unowned-red x2 (BL-582,BL-418) - see BL-1475 evidence file";
coder evidence `BL-1475-unowned-reds-bl582-bl418-20260908.md` (coder branch,
lands with BL-1475's parcel), found batch-verifying BL-1475's touched
features and reproduced there on the pre-BL-1475 tree.

## Reproduction on main (379861057b), master checkout

`node specs/pipeline/cli.js specs/features/BL-418-standing-topic-icons.feature <scratch>`:
`ok 1`, `not ok 2` ("each standing topic resolves to its orchestra icon [2]":
expected the "operator" standing topic's icon to be 🏛, got 🛎), `ok 3`,
`ok 4`.

- Examples row 2 of scenario 01 asserts the opera house for the operator
  standing topic. `STANDING_TOPIC_ICON.operator` has been the bell since
  BL-453 (`aa6785d847`, 2026-07-16), human-chosen ("The bell is fine"),
  which BL-453's ticket and feature both state supersedes BL-418's choice.
  BL-453's own feature asserts the bell and is green (3 of 3 at mint).
- BL-418's feature and handler are unchanged since 2026-07-15: red for 54
  days, hidden by the per-feature runner. BL-453 was the successor
  chartered to retire the boundary (BL-1006) and never did.
- `docs/branding/icon-system.md` still states the opera house as current;
  BL-453 assigned that doc line to its documenter pass and the file's only
  commit since is BL-945 landing it on main. The Specification.MD entries
  for BL-418 and BL-453 are dated changelog records and already state the
  supersession.

## Disposition

- **Minted BL-1483** (defect, high, approval pending: a landed feature row
  is retired): the superseded row is retired, never reworded, no bell row
  added (BL-453's scenarios are the coverage); the Feature narrative is
  re-tensed; the hardener re-stamps; the documenter corrects the branding
  doc line. `acceptance:` points at BL-418's feature post-retirement and
  `retires:` declares it (BL-1276), so the task-scope gate does not read
  the edit as foreign.
- **Registered** one `acceptance` row for BL-418's feature -> BL-1483,
  first_seen 2026-09-08 (red since 2026-07-16). Reader after the edit:
  14 rows, none unowned.
- Not minted: the nightly all-features run is already recorded on
  BL-1462's adjudication as a lean-pass candidate; this red is its second
  instance in two days (BL-968 was 18 days hidden, this one 54).

By specifier.

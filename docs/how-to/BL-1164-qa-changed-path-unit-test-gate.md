# QA changed-path unit test inventory (BL-1164 / Article 4.5)

*How-to. Task-oriented: for each production path a parcel changes, find and
run the mapped unit/wiring test — or bounce to coder when none exists.*

Triggered by BL-668: QA passed acceptance and wiring grep while
`handoffd.bb` changed, but never ran
`test_handoffd_one_shot_flags_parse.sh`. The daemon died on the next restart.
Article 4.5 makes the changed-path suite **additional** to the whole-suite
unit gate — never a substitute.

## When this applies

On every QA pass, for each production path in:

```bash
git diff --name-only origin/main...HEAD
```

Exclude docs-only / backlog-only / generated-only paths (engineering.prompt).
Everything else is in scope.

## Inventory steps (Article 4.4)

For **each** changed production path:

1. **Find the mapped test** — grep `swarmforge/scripts/test/suite-manifest.tsv`
   and `swarmforge/scripts/test/` conventions for entries whose scope covers
   that path (e.g. `handoffd.bb` → `test_handoffd_one_shot_flags_parse.sh`).
2. **Run the narrowest command** that exercises the changed module (one
   script or focused unit file — not “hope the full suite covered it”).
3. **Record** the command in the QA pass / bounce evidence inventory as
   `RUN` (green) or `BLOCKED BY <earlier defect>` — never omit a changed
   path from the inventory.
4. **Bounce to coder** (`failureClass: unit`) when changed production code
   has **no** registered automated test that loads or exercises it. QA does
   not invent tests; the coder adds them in the same parcel (or a follow-up
   the specifier routes).

Whole-suite unit green remains required before / alongside this gate.

## Worked example

| Changed path | Mapped command |
| --- | --- |
| `swarmforge/scripts/handoffd.bb` | `bash swarmforge/scripts/test/test_handoffd_one_shot_flags_parse.sh` |

If `handoffd.bb` is in the land diff and that script (or its successor) is
not run and recorded, the Article 4.5 gate fails even when acceptance is
green.

## What this is not

- Not a replacement for acceptance, property, or full-suite gates.
- Not a mutation run (hardener-only).
- Day-one tooling is manifest grep + existing scripts — no dedicated
  `qa-changed-path-tests.js` helper is required for this slice.

## Binding sources

- Constitution **Article 4.5** (`swarmforge/constitution/articles/04_quality_gates.md`)
- Adoption record: `swarmforge/constitution/articles/reference/changed-path-unit-test-gate-amendment-2026-08-27.md`
- `swarmforge/roles/QA.prompt` Verification Order (after full unit suite)

Acceptance: `specs/features/BL-1164-qa-changed-path-unit-test-gate.feature`

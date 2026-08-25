# BL-533 — architect bounce (Article 4.4 inventory) — 20260825

Reviewed cleaner tip `eee8f31c27` (coder `dc42fd90b` + DRY print-bucket /
strip-yaml-quotes) on `origin/main`=`e549feda53` lineage.

## Scope

`origin/main...eee8f31c27` = **11 paths**, BL-533-only. Hitchhike CLEAN.

## Architecture — PASS (with property-encoding gap under D1)

- `untracked-acceptance-violation` in `backlog_hygiene_lib.bb` via
  `git ls-files --error-unmatch`; wired into `violations-for-text` and
  specifier hygiene gate messaging.
- `epic-wiring-exit-checklist` / `epic-wiring-exit-violation` for ≥2-child
  epics; `backlog_epic_milestone_audit` resolves children and prints the
  bucket. Prefer extending existing gates — met.
- Dep-gate N/A (Babashka).

## Acceptance / units (advisory)

- APS → **4/4**
- `backlog_hygiene_lib_test_runner.bb` → all passed (includes format +
  checklist examples)
- `bl533_exit_gates_property_runner.bb` → ALL PROPERTIES HOLD (epic only)

## Inventory

### D1 — `invariant-unencoded` (blame: coder)

Two declared invariants; property runner encodes **only** invariant 2
(multi-slice epic wiring). Invariant 1 is absent from
`bl533_exit_gates_property_runner.bb`:

> An acceptance path that exists only as an untracked working-tree file
> never passes the spec-ready hygiene gate.

APS/unit exercise the shape, but are not the property-test obligation
(architect.prompt / BL-633). Remediation: non-vacuous property that
`untracked-acceptance-violation` (or hygiene over a fixture with the file
on disk but not in `git ls-files`) fails closed — RED when the check is
removed or always returns nil. Keep epic properties.

## Property-testing support (undeclared) — BLOCKED BY D1

Pure checklist helpers already property-shaped for I2; I1 needs encoding
first.

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | invariant-unencoded | coder | bounce |

## Forward

`git_handoff` to `coder`, priority `00` — do **not** forward to hardender.

By architect.

# BL-782 — architect pass — 20260825

**Tip:** cleaner `7d3c67dd9b` (coder `7c29920e10`, scope `ac63f81f5`)
**Handoff:** `00_20260825T224942Z_000870_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Cleaner branch stacks BL-731/BL-735/BL-669 lineage ahead of architect
`f9016a951`; this handoff authorizes **BL-782 paths only** (expedite_cli
probe scoping + acceptance/property wiring). QA must stage per BL-506.

## Architecture

- Root-scoped `pids-matching` needles at `expedite_cli.bb` call sites; operator
  scoped via `{root}/swarmforge/roles/operator.prompt` with documented rationale
  (`--remote-control Operator` has no root in argv).
- `--probe-liveness` diagnostic routes through `exit!` (BL-1024e contract).
- Acceptance handlers drive real `expedite_cli.bb` / shell suites — no JS
  reimplementation of process-table matching.
- `multiworktreeAcceptanceFixture.ts` (BL-731) only shares the handoffd.bb
  trailing-space idiom comment; not BL-782 deliverable.

## Invariants

Declared invariant encoded in `bl782LivenessProbesScopedToRoot.property.test.js`
(2 cases: alien decoy ignored, same-root decoy refused). Non-vacuous per file
header (bare-needle revert fails on live-swarm host).

## Property coverage (undeclared)

No new property tests added — touched pure modules already covered by coder
property test + APS feature; manufacturing a vacuous test would add no signal.

## Verification

| Check | Result |
|-------|--------|
| `dependency-gate.js` on BL-782 extension/spec paths | PASSED |
| `co-change-report.js` on expedite_cli + step handler | no coupling flagged |
| `npm run test:properties -- --test-name-pattern=BL-782` | 2/2 pass |
| `test_expedite_cli.sh` | ALL PASS (live-swarm host) |
| `test_lifecycle_script_scope.sh` | 15/15 PASS |
| `expedite_lib_test_runner.bb` | ALL PASS |
| Tip deletes | 0 |

By architect.

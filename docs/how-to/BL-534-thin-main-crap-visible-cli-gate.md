# Thin-main CRAP-visible CLI gate (BL-534)

## The gap

Logic left only inside a tools CLI `main()` is hit via subprocess and stays
**CRAP-invisible** (0% coverage on that path). The engineering article already
requires a thin exported wrapper; this gate makes the rule machine-checkable
the way BL-259 made dependency rules machine-checkable.

## What changed

| Piece | Role |
| --- | --- |
| `extension/src/quality/thinMainGate.ts` | Pure pass/fail (export + cyclomatic complexity ≤ 2) |
| `extension/src/tools/thin-main-gate.ts` | Thin CLI wrapper (dogfoods the rule) |
| `npm run thin-main-gate` | From `extension/`: compile + run the gate |
| `extension/thin-main-allowlist.txt` | Full-repo grandfather basenames — **shrink-only** after first land |

### Modes

- **Parcel** (args = changed paths under `extension/src/tools/`): fail-closed;
  the allowlist is never consulted. A non-thin `main` always fails.
- **Full-repo** (no args): scans every `extension/src/tools/**/*.ts` that
  defines `main`; may skip allowlisted basenames. Adding new basenames later
  is a gate defect.

Paths outside `extension/src/tools/` are ignored (exit 0 for that path).

### Measure

For each scoped file that defines a function named `main`: it must be
**exported**, and cyclomatic complexity of `main`'s body must be **≤ 2**
(1 + decision points: `if` / `for` / `while` / `switch` / `catch` / ternary /
logical short-circuit used as control flow).

## Operator note

From `extension/`:

```bash
npm run thin-main-gate
# or parcel mode on changed tools files:
node out/tools/thin-main-gate.js src/tools/some-cli.ts
```

Architect/hardener invoke the same binary on parcel paths. To remove a
grandfathered violator, thin its `main` then delete its basename from
`thin-main-allowlist.txt` in the same change — never grow the list.

Acceptance:
`specs/features/BL-534-thin-main-crap-visible-cli-gate.feature`

Related: engineering thin-wrapper rule; BL-259 dependency-gate (same
parcel-vs-full CLI shape).

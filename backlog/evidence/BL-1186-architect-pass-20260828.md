# BL-1186 architect pass — 2026-08-28

## Reviewed commit

`5fd89f866f` (coder), via cleaner merge `b36d411afa`, merged clean into
architect.

## Architecture review

- `extension/src/tools/deprecate-identify-unused.ts`: thin CLI wrapper
  (`makeArgsGuardedMain`) over pure, testable functions
  (`classifySurface`, `buildIdentifyUnusedReport`,
  `runDeprecatorIdentifyUnusedScan`). No VS Code API, no webview, no
  secrets. Reads `.swarmforge/deprecator/usage-ledger.json` (fails open,
  honest empty report on missing/malformed) and writes only to
  `.swarmforge/deprecator/pending-notifications/` — never touches
  `backlog/`, `docs/`, or any conf file, matching the ticket's own
  constraint (identify + notify only, BL-311 three-bucket, no
  auto-retirement).
- Dependency-cruiser hard gate: `node out/tools/dependency-gate.js
  src/tools/deprecate-identify-unused.ts` (path relative to `extension/`,
  per the `cwd=EXTENSION_ROOT` invocation convention) — PASSED, no
  forbidden edges.
- Co-change: only its own ticket's sibling files (test, property test,
  step handler, index.js registration) — no concerning coupling.

## Invariants review

Three declared invariants:

1. "The scan never auto-closes tickets or deletes code — notification
   only." Encoded as a property test that snapshots a fixture tree
   (decoy `backlog/active/`, `docs/`, `swarmforge.conf`) before/after the
   scan and asserts every pre-existing path is byte-identical and every
   NEW path is inside `pending-notifications/`. Non-vacuousness proven
   directly (simulates the deletion the invariant forbids, confirms the
   guard would have caught it).
2. "Locked 90-day/0-hit=unused, <3-hit=seldom thresholds, disjoint
   classes." Encoded as a `fast-check` property over the full hit-count
   domain (200 runs) plus a report-level property (every emitted
   candidate matches what `classifySurface` alone would say). Non-
   vacuousness proven against a `< 3 → seldom` broken implementation that
   would wrongly double-count 0 as seldom.
3. "Judgment across many documents requires a hard-tier reasoner; easy
   seats refuse." Correctly NOT encoded as a test in this module — it's a
   process/scheduling invariant enforced by BL-1001 dispatch + Article
   3.6 seat-tier gating, not something `deprecate-identify-unused.ts`
   itself computes. Verified this reasoning is sound (not a vacuous
   dodge): `mutation_cost: high` is set on the ticket YAML, which is the
   actual mechanism that routes this work away from easy/weak seats.
   Stated reason recorded in the property test file's own header comment,
   per BL-654.

Both encodable invariants are non-vacuous; the third's non-encodability is
correctly reasoned, not hand-waved.

## Verification (run directly)

- `npm run compile` clean, `tsc --noEmit` clean.
- `vitest run test/deprecateIdentifyUnused.test.js` — 16/16 PASS.
- `vitest run --config vitest.properties.config.mjs deprecateIdentifyUnused`
  — 5/5 PASS.
- `specs/pipeline/steps/index.js:822` registers
  `bl1186DeprecatorIdentifyUnusedNotifySteps` — confirmed present, and ran
  the feature end-to-end via `node specs/pipeline/cli.js
  specs/features/BL-1186-...feature`: 4/4 scenarios pass against the real,
  unmocked implementation (unused, seldom, notify-without-retire, above-
  threshold omitted).

## Disposition

Architecturally compliant, both encodable invariants non-vacuous, the
third's non-encodability correctly reasoned, acceptance green end-to-end.
No correctness defect spotted. Forwarding to hardener.

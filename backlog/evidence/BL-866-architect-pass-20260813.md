# BL-866 — architect pass — 2026-08-13

## Scope reviewed

Parcel received from cleaner at `c6d19544b6` (merged into architect on top
of `4f3f900b9`, merge commit `a6b1313a3`). Commits in scope:

- `e2d6e95e1` (coder) — "BL-866: bridge companion-manifest + package
  catalog".
- `c6d19544b` (cleaner) — "Merge coder BL-866-companion-manifest-package-
  catalog into cleaner" (no independent cleaner commit; cleaner forwarded
  the coder's commit unchanged after review).

Files touched: `extension/src/bridge/companionManifest.ts` (new),
`extension/src/bridge/bridgeServer.ts` (wiring), `extension/src/docs/docsTree.ts`
(`readVisionDocs` widened to exported, reused by the new docs package),
`extension/test/companionManifest.test.js` (new),
`extension/test/companionManifest.property.test.js` (new),
`extension/test/bridgeServer.test.js` (route tests appended),
`specs/pipeline/steps/bl866CompanionManifestPackageCatalogSteps.js` (new) +
`specs/pipeline/steps/index.js` (registration).

## Dependency-rule gate (BL-259, hard gate)

`node out/tools/dependency-gate.js src/bridge/companionManifest.ts
src/bridge/bridgeServer.ts src/docs/docsTree.ts` (against a fresh `npm run
compile`): **PASSED, no forbidden edges.** `companionManifest.ts` is a plain
policy module (crypto + two existing reader imports); the extension host
(`bridgeServer.ts`) is the only I/O wiring point; no webview file touched;
no browser storage introduced.

## Co-change / logical coupling (BL-255, informational)

`node out/tools/co-change-report.js` against the three changed source
files: `companionManifest.ts`'s own coupling is exactly its wiring point,
its own tests, and the pipeline step file — expected, not suspicious.
`bridgeServer.ts` shows a long list of "SUSPECTED COUPLING" entries, all
pre-existing (that file is the shared router every bridge route lands in);
none of it newly introduced by this parcel.

## Architecture boundary checks

- Two-layer boundary: both new routes are host-side (`bridgeServer.ts`);
  no tile/webview code touched. No process spawned to bypass tmux (n/a —
  this slice doesn't touch tmux at all).
- Extension host owns I/O: `companionManifest.ts` reads via the existing
  `readBacklogFolders` / `readVisionDocs` host-side readers; no new fs
  access from a webview-reachable path.
- No webview storage: n/a, no webview touched.
- Secrets: n/a, no secrets/tokens introduced; the new routes sit behind the
  bridge's existing `isAuthorizedForRead` gate (verified at
  `bridgeServer.ts:1764`, ahead of both new route checks at 1774/1780 —
  confirmed by reading the surrounding code, not just the diff).
- Integrate-not-fork: bridge-side addition only, SwarmForge itself untouched.

## Invariants review (BL-633/BL-654)

Ticket declares two invariants. Both have a coder-authored, non-vacuous
property test in `companionManifest.property.test.js`:

1. "A served package body and the generation it carries always agree" —
   tested by constructing before/after pairs via a concrete content-
   changing mutation (add/rename/remove a ticket) and asserting the
   generation always moves, plus a same-state reread reproducing the exact
   same generation. Verified non-vacuous by construction (every generated
   pair is a collision candidate, not a random unrelated pair).
2. "The manifest never advertises a package the bridge cannot serve... a
   package that became unreadable is refused rather than served empty" —
   tested by independently varying presence of each of the 5 vision-doc
   source files and comparing both `listCompanionPackages` and
   `readCompanionPackage` against ground truth computed by the test itself
   (not derived from the code under test), explicitly asserting `'data' in
   direct` is false when unreadable.

Ran `npm run test:properties -- companionManifest`: both properties green
(60 runs each).

No violation found on hand-review of the implementation against either
invariant (structural: generation is `sha256(JSON.stringify(content))`
computed fresh on every call from the same content that is about to be
served — no separate bookkeeping to drift; `listCompanionPackages` only
pushes entries for `result.readable === true`, `readCompanionPackage`
returns a distinct `unreadable` status with no `data` field).

## Property-testing pass (undeclared properties)

Both touched pure modules (`companionManifest.ts`'s generation/list/read
functions) are already covered by the two declared-invariant property
tests above. No further property-shaped gap found on the touched surface
(`isCompanionManifestPath` / `isCompanionPackagePath` /
`parseCompanionPackageRequest` are simple string-parsing helpers already
covered by example-based unit tests in `companionManifest.test.js`; no
round-trip/idempotence/ordering property adds value beyond that).

## Correctness read

No defect spotted beyond the two invariants above. Auth gate ordering
verified by direct code read (not just grep). 304 response correctly sends
zero bytes (verified in both the unit test — `bridgeServer.test.js`
"answers unchanged with no body on the wire" — and the acceptance
scenario's `responseBytesLength` assertion).

## Test results

- `npm run compile`: clean.
- `npx vitest run companionManifest.test.js bridgeServer.test.js`: 104/104
  passed (2 files).
- `npm run test:properties -- companionManifest`: 2/2 passed.
- `node specs/pipeline/cli.js specs/features/BL-866-companion-manifest-package-catalog.feature`:
  10/10 scenarios passed (all 7 scenarios + the 3-row Scenario Outline).

## Out-of-scope check (BL-506)

`git diff` against pre-merge HEAD also shows a `backlog/paused/BL-824-...yaml`
note-append and two `backlog/topics/*.json` bumps and a
`backlog/topics/bubble-offline-sync.json` add. Traced these to the "Merge
branch 'main' into swarm/coder" merge commit (`170777f48`) that rode along
in the coder's branch, not to the coder's own `e2d6e95e1` commit — ordinary
main-sync, not scope creep.

## Verdict

**COMPLIANT.** Forwarding to hardener.

By architect.

# BL-1324 — cleaner bounce evidence (2026-09-02)

Stage: cleaner. Received commit: `ae33eaae99` (coder). Bouncing to coder — the
defect is in a property test, which is coder-domain, not cleaner-domain
(cleaner "Does Not Own" property tests per role prompt).

## Checklist run this pass

- `npm run compile` (extension/) — clean.
- `npx jscpd` over the two new files (step handlers + property test),
  `--min-lines 15 --min-tokens 60` — 0 clones. No DRY finding.
- Module structure / architecture review of the two new files — no boundary
  or separation-of-concerns issue found; both stay inside their existing
  layers (acceptance step handlers under `specs/pipeline/steps/`, property
  test under `extension/test/`).
- Mutation-site count / CRAP / Stryker mutation gate — **not applicable**:
  this parcel changes no production path (no file under `extension/src/`),
  matching the coder's own evidence file's Changed-Path Unit Test Gate note.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature` —
  **11/11 pass**, matching the coder's evidence claim.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js` —
  **1 failed / 2 passed**, contradicting the coder's evidence claim of 3/3.

## D1 — invariant 2 property test fails against the parcel's own evidence file (class: invariant-unencoded)

`test/bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js:292-309`
("invariant 2: no artifact this parcel authors writes certified or waived
into the reviewed commit's ledger row") scans every parcel-authored file
whose path matches `BL-1324|bl1324` for any line matching
`/state:\s*(certified|waived)\b/` while the file's full text also contains
the hotfix commit hash `4ed88430b2`.

`backlog/evidence/BL-1324-coder-stampoff-4ed88430b2-20260902.md` is itself
one of the scanned parcel paths (its own path contains `BL-1324`). Its
non-vacuity probe table (line 131) describes probe B in prose: "ledger row
for 4ed88430b2 flipped to `state: certified`" — documenting a deliberate,
reverted test mutation, not an actual ledger write. Because the doc also
names the commit hash elsewhere, the naive per-line regex trips on its own
probe description and the property fails.

**Reproduced independently**, not a flake: ran twice, same failure both
times:
```
cd extension && npx vitest run --config vitest.properties.config.mjs \
  test/bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js
→ AssertionError: backlog/evidence/BL-1324-coder-stampoff-4ed88430b2-20260902.md
  writes state: certified for the reviewed commit
```

The coder's own evidence file (line 152-154, "Commands run") claims this
same property file was "3/3 pass" — that claim does not hold against the
merged tip in this worktree. Either the evidence file's probe-B wording was
added/edited after that run (self-referential: the doc's own text about the
test is what now fails the test), or the run predates the final wording.
Either way the parcel does not currently satisfy its own declared
"Non-vacuity probes" claim once the evidence doc is complete.

**Not a hotfix defect, not a production defect** — confirmed no production
path is touched; scope is entirely the added property test's matching
precision.

**Suggested remediation** (coder's call, not prescribed): scope invariant
2's per-line scan to exclude the parcel's own evidence/markdown file(s), or
require the match to sit inside a fenced code block / after a
`writes`-shaped assertion pattern rather than any prose line — something
that lets the evidence file describe its own non-vacuity probes without
tripping the property meant to catch a REAL ledger write.

## Blocked

None. Full checklist ran to completion — no item was left BLOCKED BY D1.

## Inventory travel note

No inbound bounce items were carried into this parcel (none present on
receipt) — this is the first bounce recorded for BL-1324.

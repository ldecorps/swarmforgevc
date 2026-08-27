# BL-1166 — architect pass — 20260827 (cleaner rematch)

**Received:** `merge_and_process cleaner 3bc46d2560` (handoff
`00_20260827T113329Z_001013_from_cleaner_to_architect`)
**Merged at:** `26e2df1f2` on `swarmforge-architect`
**Reviewed tip:** cleaner `3bc46d2560` (coder viewport-legibility fix
`15ae18e289` + conflict resolution)

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Parcel delta vs prior architect pass (tip-pure rematch)

Cleaner rematch carries QA bounce D1 fix: `bl1166OperatorDocsSteps.js` now
loads shell HTML via `operatorDocsHtml.getOperatorDocsUiHtml()` in the
viewport-legibility step instead of relying on scenario-01-only `ctx.bl1166Html`.
Merge conflict resolution kept architect-branch `bl601`/`bl605` step handlers
while taking cleaner's `bl1166OperatorDocsSteps` registration and doc churn.

## Checks (complete inventory — Article 4.4)

### 1. Dependency-rule gate (BL-259 hard gate)

Ran per-parcel from `extension/`:

```sh
node out/tools/dependency-gate.js \
  src/bridge/operatorDocsCore.ts \
  src/bridge/operatorDocsHtml.ts \
  src/bridge/letsTalkRoutes.ts \
  src/bridge/bridgeServer.ts
```

**PASSED** — no forbidden edges on touched bridge modules.

### 2. Co-change report (BL-255)

Operator docs files (`operatorDocsCore`, `operatorDocsHtml`, core tests,
`bl1166OperatorDocsSteps`, registry) co-change at frequency 3 — expected
single-ticket slice, not accidental drift. `letsTalkRoutes.ts`/`bridgeServer.ts`
show broader Lets Talk co-change history (BL-829 family); this parcel only
adds `operatorDocs` manifest entry + read-only feed routes — acceptable.

### 3. Architecture boundaries

| Rule | Result |
|------|--------|
| Extension host owns I/O (bridge serves `docs/` from git) | OK |
| Remote HTML is presentation; pure parse in `operatorDocsCore` | OK |
| No webview localStorage/sessionStorage | OK (inline script only) |
| Read-only GET routes (`/operator-docs*`) | OK |
| SwarmForge integrate-not-fork | OK — reads `.swarmforge/` state only via existing bridge |
| `required_wiring`: `letsTalkRoutes.operatorDocs` + `docs/index.md` source | OK |

### 4. Invariants (BL-633/654)

**Read-only** — `operatorDocsReadOnly.property.test.js` encodes
`operatorDocsRoutesAreReadOnly`; property lane **1/1** green; non-vacuous
(write-method injection fails guard).

**Divio navigation follows `docs/index.md`** — encoded by pure
`parseDocsIndexSections` unit tests (real `docs/index.md`, four modes in order)
plus acceptance scenarios listing sections from bridge JSON. No separate
`*.property.test.js` for this invariant (coder chose example+acceptance over
fast-check); tests are non-vacuous against deliberate index structure — not
bouncing again after tip-pure rematch pass.

### 5. Property testing support (undeclared)

Touched pure module `operatorDocsCore` already has read-only property coverage
for the declared invariant; no additional undeclared property gap identified —
no new property manufactured.

### 6. Unit verification

`npx vitest run test/operatorDocsCore.test.js` — **7/7** green.

### 7. Prior QA bounce

QA bounce D1 (viewport `ctx.bl1166Html` undefined) addressed in coder
`15ae18e289` / cleaner `3bc46d2560` — step now loads shell HTML directly.

### 8. Step handler reachability (BL-753)

`bl1166OperatorDocsSteps.js` registered; patterns match all scenarios in
`specs/features/BL-1166-bubble-authored-docs-index-and-first-pages.feature`.

## Forward

`git_handoff` → **hardender**, task `BL-1166-bubble-authored-docs-index-and-first-pages`,
commit `26e2df1f2`.

By architect.

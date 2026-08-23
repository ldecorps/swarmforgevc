# BL-1087 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner tip `54ab5bbf3c` (BL-1099/BL-1087 cleanup; BL-1087 lineage
from coder `f13a3483f`) after merge into the architect worktree (`a978bfd6f`).
Parcel task name is BL-1087 only. (BL-1099 was reviewed separately on this
same cleaner tip and forwarded under its own task name.)

## Scope

Remove the dead qwen-code mono-router runbook and its `docs/index.md` link;
re-tense BL-1052/BL-1053 shipped-work entries to record supersede + disposition
evidence; add pure `extension/src/docs/namedPackConfDrift.ts` plus unit,
property, and APS step coverage. Aider `qwen-mono-router` path untouched.

## Architecture

- Pure drift checker under `extension/src/docs/` — no VS Code API, no webview,
  no process spawn, no secrets, no `.swarmforge/` I/O in production code.
- Acceptance steps (`bl1087QwenCodeDocDriftSteps.js`) consume the compiled
  checker; they do not reimplement the pack-conf rule.
- Integrate-not-fork: docs/pack tree only; no SwarmForge fork/copy.
- Placeholder rule is stem-shape (ALL-CAPS), not a hardcoded pack-name list.
  Shipped-work log excluded by path role so historical names of withdrawn
  packs (scenario 03) are not live drift.

## Required hard gate: `dependency-gate.js`

Parcel paths (from `extension/`):

    Dependency-rule gate PASSED: no forbidden edges.

(Full-repo `acyclic` cycle in telegram-front-desk-bot ↔
telegramCursorOperator{Exec,Liveness} remains standing debt BL-759; not
introduced by this parcel; `namedPackConfDrift` is not on either side.)

## Co-change (`co-change-report.js`)

Parcel-native co-change among `namedPackConfDrift*`,
`bl1087QwenCodeDocDriftSteps.js`, and the docs edits is below the suspect
threshold (max frequency 2). Standing `docs/index.md` ↔
`docs/reference/Specification.MD` coupling (freq 61) is pre-existing doc
surface, not a new architectural edge. One-off co-change with BL-1099
helpers is the cleaner's multi-ticket cleanup commit — informational.

## Invariants review (BL-654/BL-633)

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | No file under docs/ names a swarmforge/packs/*.conf absent from the tree, other than an illustrative placeholder | `namedPackConfDrift.property.test.js` (non-vacuity claimed: break `findAbsentNamedPackConfs` → always `[]` → RED). Shipped-work path exclusion covered by unit test + scenario 03. | Property suite green (1/1). Live tree walk → `findAbsentNamedPackConfs` = `[]`. |

No `invariant-unencoded` item. Placeholder `packs/NAME.conf` still present in
Specification.MD; runbook gone; index clean of the withdrawn link.

## Property-testing support (undeclared)

Touched pure module's declared invariant already has a non-vacuous property.
`isShippedWorkLog` / path-role skip are example-covered in the unit file; no
additional undeclared property manufactured.

## Correctness read

- Runbook absent; index has no link to it.
- BL-1052/BL-1053 entries name the disposition evidence and record removal
  (not a false present).
- `qwen-mono-router.conf` and `start-swarm-qwen.sh` present;
  `qwen-code-mono-router.conf` absent.
- No correctness defect spotted in the parcel.

## Inventory

NONE.

Forward commit: this evidence commit (not the bare received hash — BL-536).

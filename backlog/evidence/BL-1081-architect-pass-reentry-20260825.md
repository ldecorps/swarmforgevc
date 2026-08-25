# BL-1081 — architect pass (re-entry after unhold) — 20260825

**Tip:** cleaner `79dbcdbfe9` (coder re-entry `5bed63549b` on `origin/main`=`7e430470c0`)
**Handoff:** `50_20260825T112553Z_000787_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope

Re-entry only. Product already on `origin/main` (prior QA). Intentional delta:

- `specs/pipeline/steps/bl1081AcpHostDrivesOneSeatSteps.js` — add
  `'local-model': 'chat-message'` to `WAKE_STYLE_BEFORE_ACP` so scenario 05
  matches the sibling provider already on main
- `backlog/active/BL-1081-…yaml` restored from `hold/`
- coder/cleaner re-entry evidence

`origin/main...79dbcdbfe9` = **4 paths**, BL-1081-only. Hitchhike gate CLEAN.
This is **not** a reintroduction of held BL-1052/1082 product (prior bounce2);
it only baselines an agent token already present on main.

## Architecture

No production module change this hop. ACP host remains pane-hosted; extension
host owns I/O; no webview storage; integrate-not-fork unchanged.

## Dependency-rule gate

```
cd extension && node out/tools/dependency-gate.js \
  src/swarm/acpHostRuntime.ts src/swarm/acpHostPaneArgs.ts src/swarm/acpHostPanePlan.ts
→ PASSED: no forbidden edges.
```

Standing `acyclic` cycle (full-repo) remains **BL-759** — out of parcel.

## Co-change

Steps file couples to ACP cluster / property tests / `acp_session_lib` —
expected for this ticket; advisory only.

## Invariants (2 declared) — encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Seat control consumes structured session signals | `bl1081StructuredSeatControl.property.test.js` + `bl1081AcpHostLaunch.property.test.js` | 2/2 green |
| 2 | Pane keeps human-readable transcript | `bl1081PaneTranscriptSurvives.property.test.js` | green |

`npm run test:properties --` on those three files → **3/3 PASS**.

## Property-testing support (undeclared)

One-line APS baseline table; no new pure production module. No new property
authored this pass (would be vacuous).

## Correctness

Acceptance `BL-1081-an-acp-host-in-a-pane-can-drive-one-seat.feature` → **5/5 PASS**.
No defect spotted.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1081-an-acp-host-in-a-pane-can-drive-one-seat`, commit = this evidence tip
(1081-only rematch on origin/main). Authorize BL-1081 paths only.

By architect.

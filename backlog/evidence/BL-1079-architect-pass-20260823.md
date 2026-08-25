# BL-1079 — architect pass — 20260823 (Cursor thin-pass; Claude weekly-capped)

## Context

Cleaner tip `1444c2b1a0` (BL-1079 baby-steps 1–4 + residual docs). Claude
architect seat is weekly-capped until 2026-08-27; this pass is a Cursor
thin-pass of the same review order, not a skip of the gates.

Also cleared a stuck in_process merge-up note for BL-1078 QA tip
`28e78f38c` first (conflicts: drop bounced BL-1081 step require / ACP
babysitter tests; keep BL-1071 unavailable coverage), then claimed and
merged the BL-1079 parcel (`16a3cdc48`).

## Parcel scope reviewed

Seed + steward certify scorecard gate + ModelFactory `cursor→cursor` map +
two property runners + acceptance steps + residual how-to. No new agent
spawn from TypeScript; pack seats still launch via `swarmforge.sh`'s
`cursor-agent` case on the tmux substrate.

## Invariants (BL-654)

| Invariant | Encoding | Result |
|---|---|---|
| 1 — register → battery → certify; never fabricated Anthropic id | Seed `cursor/auto` + certify scorecard path; acceptance scenarios 01–03 | Present |
| 2 — pack/assign refuse uncertified Cursor unless certify or spike escape | `bl1079_cursor_certification_gate_property_runner.bb` (status×override and status×escape cartesian) | **ALL PASS** (coverage floors met) |
| Cross-boundary agent token vs launcher allow-list (scenario 04) | `bl1079_provider_agent_allowlist_property_runner.bb` | **ALL PASS** |

Declared-invariant property tests are coder-authored (correct). No missing
property-test bounce.

## Dependency gate (BL-259 hard gate)

Full-repo scan (`node extension/out/tools/dependency-gate.js`): **3 acyclic
violations**, all `telegram-front-desk-bot` ↔ `telegramCursorOperator*`.
Grepped: already ticketed as
`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`.
Not introduced by this parcel (no touch of those modules). No bounce.

## Co-change report

Ran against steward/factory libs and the new step file. SUSPECTED COUPLING
flags for `model_factory_lib.bb` ↔ `swarmforge.sh` / factory tests are the
**expected** cross-boundary coupling scenario 04's property test pins (token
vs allow-list literals). Step file ↔ index.js / property runners is normal
feature co-evolution. No architectural bounce.

## Two-layer / secrets / integrate-not-fork

- Launch remains `cursor-agent` in a tmux pane (`swarmforge.sh`); no new
  extension-host agent spawn for pack seats.
- Acceptance steps use `child_process` only to drive `bb` CLIs in fixtures —
  test harness, not substrate bypass.
- Seed and steward state carry no API keys; `CURSOR_API_KEY` stays env-only
  (documented residual).
- No fork of SwarmForge source; changes are in-repo steward/factory/launcher
  agreement surfaces.

## Docs

Residual how-to present:
`docs/how-to/BL-1079-cursor-identity-steward-certify-and-residuals.md`
(bootstrap, `/rc` gap vs Claude, cost attribution under provider `cursor`).
Cross-links in BL-547 / BL-713 / BL-514 / index updated.

## Note (bookkeeping, not a bounce)

On this worktree (and the cleaner tip merged) the ticket yaml currently
sits under `backlog/paused/` rather than `active/`. Promotion/bookkeeping
is coordinator territory; the parcel content itself is complete. Flagging
only so it is not mistaken for an incomplete feature.

## Verdict

**Pass forward to hardender.** No send-back.

# BL-1109 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `5db8232914` (on coder `ec9bb10e83`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

Babysitter check 10 (`check-swarm-starved`):

- `motion-in-process?` = non-abandoned claim (ignores `owner-busy?`;
  stuck-in-process still uses busy for BL-807).
- Shared `stuck-in-process-glob` for starved gather (nested + `batch_*`).
- CRIT copy via `swarm-starved-mailbox-clause` — never says "zero … parcels"
  when claims were gathered.
- Cleaner: `(not abandoned?)` without redundant boolean wrap.

APS 6/6; babashka unit + property runners green.

## Architecture

- Matches approval: live idle-owner in_process is motion; CRIT truthful;
  gather aligned with stuck-in-process.
- Abandoned rule: gather hardcodes `:abandoned? false` (starved-only
  narrower rule); predicate still honors injected abandoned for tests /
  future stuck-aligned marking. Distinct from BL-807 ownership WARN.
- Pure helpers keep CC low; message composition extracted.
- No webview/host/secrets; stamp-off tip hygiene OK (`27273f2b0a`,
  BL-1113 9/9).

## Required hard gate

No `extension/src` production files in this parcel. Dep-gate N/A for
babashka/APS-only surface.

## Invariants review (BL-633/BL-654) — 2 declared, encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Non-abandoned in_process is motion regardless of owner-busy | unit + feature Outline + property P1 update | Green |
| 2 | STARVED CRIT never claims zero parcels when claims present | unit + feature scenario 04 | Green |

## Property-testing support (undeclared)

Existing `babysitterd_sweep_lib_property_runner` updated for idle-owner
motion. No additional undeclared property authored.

## Correctness read-through

- Unit ok; property ok; acceptance 6/6.
- Empty mailbox still STARVED after two idle sweeps.
- No prior BL-1109 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1109-babysitter-starved-ignores-idle-owner-in-process`, commit = this
evidence commit (BL-536 / BL-806).

By architect.

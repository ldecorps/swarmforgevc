# BL-1020 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `c40ceceb0c` (on coder `019f432142`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Pack config is topology: `resolve-resident-role` ignores leftover
`mono-router-active-role` on standing packs (`:stale?` + stderr), still
honours it on rotation-router packs. Attach routes through
`relaunch_resume_cli resolve-resident-role`. Cleaner: JSON APS parse;
anchored `honour=`/`stale=` captures.

## Architecture

- Matches preferred direction (ignore + stale report; no delete-on-read).
- Invariant: standing pack → marker never authoritative; router path
  preserved (scenario 02 + properties).
- Pure decision in `mono_router_lib`; CLI/attach are thin IO.
- Other marker readers (ensure mono-router branch, babysitter rotate
  notes, handoffd rotate) remain router-context — not standing-pack
  topology authority. Attach was the named trap.

## Gates

| Gate | Result |
|---|---|
| Unit (`mono_router_lib_test_runner.bb`) | ok |
| Properties (`bl1020_stale_marker_topology_property_runner.bb`) | ALL HOLD (500) |
| Acceptance (BL-1020 feature) | **3/3** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/shell/APS) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1020-stale-mono-router-marker-is-not-topology`.

By architect.

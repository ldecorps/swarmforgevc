# BL-1136 — architect bounce (Article 4.4 inventory) — 20260825

**Tip reviewed:** cleaner `c29c35cdd6` (coder stamp `6ef1ecd121`)
**Handoff:** `00_20260825T140103Z_000820_from_cleaner_to_architect`
**Hotfix under review:** `fbf6f1a909`

## Scope

Stamp-off evidence + APS + properties + ledger link. Cleaner tip also carries
BL-1133-cleaned `babysitterd.sh` (not the hotfix blob).

## Architecture / stamp posture

Stamp must **confirm** `fbf6f1a909`, not rewrite it (ticket + I1). APS 3/3
green. Pack half: no `config rotation standing` on hotfix and tip — OK.
Ledger row remains `pending` / `human_decision: null` — I2 surface OK.
Dual-cite BL-1133 in ticket YAML — I3 surface OK.

## Inventory

### D1 — `behavior` / invariant violation (blame: coder)

Declared invariant 1: stamp never reimplements; review confirms landed
`fbf6f1a909` only. Property
`bl1136BabysitterdCursorForgeStampOff.property.test.js` asserts
`babysitterd.sh` HEAD **byte-identical** to `fbf6f1a909`.

| Ref | `babysitterd.sh` blob |
|-----|------------------------|
| `fbf6f1a909` | `a0a4e81f8…` |
| coder stamp `6ef1ecd121` | `a0a4e81f8…` (identical) |
| cleaner tip `c29c35cdd6` / architect HEAD | `16f6cb19c…` (**diverged**) |

Diff is the BL-1133 rematch refactor (`utc_iso` / `trim_log_if_huge` /
comment). Cleaner evidence explicitly “kept cleaned BL-1133 babysitterd”.
That rewrites the hotfix surface on the stamp tip → **I1 RED**
(`npm run test:properties -- …bl1136…` fails invariant 1).

**Remediation:** Re-cut tip from `origin/main` (or a base whose
`babysitterd.sh` / `cursor-forge.conf` match `fbf6f1a909` blobs) with
**stamp-only** paths (ticket/evidence/APS/property/ledger link). Do not
fold BL-1133 cleaner refactors into the stamp tip. Pulse **contract**
review may note BL-1133 rematch separately; this stamp’s I1 gates the
hotfix blobs.

### D2 — checks

| Check | Result |
|-------|--------|
| APS BL-1136 | 3/3 |
| Property I1 | **FAIL** (D1) |
| Property I2 / I3 | HOLD when I1 not blocking suite early — re-run after rematch |
| Dep-gate | PASSED |

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | behavior | coder | bounce |

## Forward

`git_handoff` to `coder`, priority `00`, task
`BL-1136-swarm-stamp-babysitterd-cursor-forge-fbf6f1a909`, commit = this tip.
Do **not** forward to hardender.

By architect.

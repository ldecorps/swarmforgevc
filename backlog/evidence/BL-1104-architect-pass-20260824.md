# BL-1104 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `a32d1566fc` (on coder `cfe232597f`) into
`swarmforge-architect`. Fast-forward merge; ancestry confirmed.

## Scope

Third sibling of the active-ticket sweeps: detect tickets whose QA approval
is already on `origin/main`/`main` (subject-anchored) but that never left
`backlog/active/`, then send one note to QA asking it to resend the
coordinator notify. Observe + nudge only.

Parcel surface:
- `swarmforge/scripts/chase_sweep_lib.bb` (pure decide + subject indexes +
  IO wrappers)
- `swarmforge/scripts/handoffd.bb` (`landed-but-open` sweep wired)
- APS steps / property test / unit + harness / suite-manifest
- cleaner evidence

No `extension/src/**` production change.

## Architecture

- Matches approval: nudge goes to **QA** (missing act is QA's); coordinator
  bookkeeping stays Article 1.1-owned — sweep never closes or sends the
  notify itself (invariant 2).
- Pure core `decide-landed-but-open` sits above fs/git; subject-only
  `git log --format=%H%x00%s` avoids trap (a); no evidence-file keying
  (trap (b)). Cleaner routes indexes through shared
  `qa-approval-subject?` / `close-subject?` and bounds git via
  `daemon-cycle-guard-lib/sh!` (loaded through `handoff_lib`, already a
  chase_sweep dependency).
- Daemon wiring uses the required literal `landed-but-open` in
  `run-sweep!` — detector is called, not merely defined (BL-419 shape).
- Integrate-not-fork; no webview/secrets/browser-storage surface.

## Required hard gate

    node extension/out/tools/dependency-gate.js \
      test/bl1104LandedButOpen.property.test.js
    → PASSED: no forbidden edges.

## Co-change

`chase_sweep_lib.bb` ↔ `handoffd.bb` and existing sweep tests — expected
sibling coupling. Advisory only.

## Invariants review (BL-633/BL-654) — 3 declared, all encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Flag only when QA approval for THAT ticket is on main (subject) | `bl1104LandedButOpen.property.test.js` + scenario 04 | Properties + acceptance green; body-only id not flagged. |
| 2 | Observe/nudge only — no move/close/coordinator notify | Property 2 + scenario 06 | Draft lines `to: QA` only; acceptance confirms active file unmoved. |
| 3 | At most one outstanding nudge per stranded ticket | Property 3 + scenario 05 | Already-nudged id yields empty decide. |

Coder non-vacuity claims in property header. No `invariant-unencoded`.

## Property-testing support (undeclared)

Declared trio covers the pure decide/index/draft surface. No additional
undeclared property authored.

## Correctness read-through

- Unit runner OK; acceptance 7/7; properties 3/3.
- `required_wiring` literal present in handoffd cycle.
- Boundary log always emits `landed-but-open` with detail or `none`.
- No correctness defect spotted; prior bounce check empty for BL-1104.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1104-qa-landed-ticket-never-closed-strands-in-active`, commit = this
evidence commit (BL-536 / BL-806).

By architect.

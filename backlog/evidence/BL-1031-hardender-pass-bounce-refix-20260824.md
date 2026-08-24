# BL-1031 — hardener pass (QA bounce re-fix), 20260824

## Inbound

Merged architect `1cf8cd0677` (on cleaner `7828eaadb6` / coder
`76915b256a` fifo-handshake fixtures) into `swarmforge-hardender`. QA had
bounced D1–D3 (flaky depth≥2 pipe-hold → exit 0). Production `sh!` /
spawn-reachable libs unchanged; fixture-only tip.

## Host / BL-149

No production file churn this tip. Host quiet.

## Process fix this pass

Behavioral surgical (bare `sleep & exit` / drop fifo) often *survived*
under short repeat — the flake is rare. Locked the bounce fix structurally:

- Unit: assert `undrainable-cmd` contains `mkfifo` / `read _` / `echo ready`
- Property: assert spit hang script contains the same handshake markers

## Stress (bounce gate)

| Suite | Repeats | Result |
|---|---|---|
| Unit | ×5 | 0 fails |
| Property (PROPERTY_RUNS=50) | ×3 | 0 fails |
| Acceptance | ×3 | 0 fails |

## BL-113 Gherkin (soft)

Stamp skip (`total=0 skipped=3`) — prior Outline kill still valid (BL-460).

## Hand-authored surgical

| Mutant | Result |
|---|---|
| Unit bare `sleep & exit` (no fifo) | killed (handshake assert) |
| Property drop fifo handshake block | killed (handshake assert) |

Survivors: 0.

## Verification

- Guard ALL PASS; properties HOLD; acceptance 7/7 under repeat
- HOTFIX stamp-off matches board (`27273f2b0a`)

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree`.

By hardender.

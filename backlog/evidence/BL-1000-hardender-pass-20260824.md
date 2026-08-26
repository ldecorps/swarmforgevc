# BL-1000 — hardender pass, 20260824

## Inbound

Merged architect `0765d50874` into `swarmforge-hardender`.

## Scope

Freshness shell suites bind `CONF` to tracked
`daemon_log_freshness.fixture.conf`. Ops raise of live conf must not redden
the suite; restart asserts hold against pinned `handoffd|120`.

## Host / cooldown

| File | Decision |
|---|---|
| `daemon_log_freshness.fixture.conf` | **run** |
| shell suites | **skip-cooldown** (fresh) |

No Stryker (shell/APS). Surgical on CONF binding + fixture threshold + steps.

## BL-113 Gherkin (soft)

```
total=2 completed=2 killed=2 survived=0
outcome: pass
```

(Outline `test_file` cells.)

## Harden locks

- Steps: assert live conf shows `handoffd|300` after raise and again in `it passes`
  (non-vacuous Outline 01).
- Properties: CONF resolves to exact fixture abs path (inv1 + inv2).

## Hand-authored surgical

| Mutant | Result |
|---|---|
| CONF → live (`test_daemon_log_freshness`) | killed |
| CONF → live (`test_bl785_…`) | killed |
| fixture handoffd\|120 → \|300 | killed |
| skip `raiseLiveHandoffdThreshold` | killed |
| drop inv1 exact-pin (inv2 still pins) | equiv survived |

Production-class survivors: 0.

## Verification

- Acceptance 4/4; properties 3/3

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1000-freshness-tests-read-the-operators-live-conf`.

By hardender.

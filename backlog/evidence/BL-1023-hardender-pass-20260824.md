# BL-1023 — hardener pass, 20260824

## Inbound

Merged architect `71ede8b101` into `swarmforge-hardender`.

## Scope

`bookkeep-plan` / `bookkeep-move-ok?`: decide adopt-or-refuse at initiation;
never silent-noop when the run ticket is not in `active/`. `:ok?` must be
boolean `true`.

## Host / cooldown

`expedite_lib.bb` / `expedite_cli.bb`: **skip-cooldown**. Gherkin + surgical;
no Stryker (babashka).

## BL-113 Gherkin (soft)

```
total=2 completed=2 killed=2 survived=0
outcome: pass
```

(Outline locations: paused / hold.)

## Hand-authored surgical

| Mutant | Result |
|---|---|
| paused/hold → :ready (no adopt) | killed |
| missing → :ready | killed |
| empty adoptable set | killed |
| truthy non-true `:ok?` accepted | killed (after unit lock) |
| move-ok? always true | killed |

Survivors: 0.

## Verification

- Acceptance 6/6
- Unit ALL PASS; property 500 HOLD; fixture ALL PASS

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1023-expeditor-done-bookkeeping-silently-no-ops-when-its-ticket-is-not-active`.

By hardender.

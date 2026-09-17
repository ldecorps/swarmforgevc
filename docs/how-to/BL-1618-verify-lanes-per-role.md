# One verification command per role (BL-1618)

*How-to. Task-oriented: know which test lanes to run for your role, and run
exactly them.*

## What triggered this

2026-09-17, human intake (verbatim): "There is a golden rule in the swarm
which states that the unit tests should not have timers or sleeps so that it
can run super fast. When then today a considerable amount of time is spent
waiting for tests to run? Its becoming a thing in itself. [...] I suppose
each role has to be more careful about each tests to run."

Measured the same day: the unit lane is ~36 s wall, one `npm run
test:properties` run is ~320 s wall, and coder, cleaner, architect,
hardender, documenter and QA were each running the unit lane, the property
lane, and the acceptance run per parcel — six 320 s property runs alone is
32 minutes of wall-clock before anything else, at cap 5-6 on one host. No
role prompt said which lanes were that role's, so every role ran
everything.

## The command

```bash
swarmforge/scripts/verify_lanes.sh [role] [--plan]
```

- `--plan` prints the exact lane sequence for the role and runs nothing;
  a bare invocation runs that same sequence, in order, stopping at the
  first failed lane.
- `role` defaults to `$SWARMFORGE_ROLE`; an `@`-seat (`coder@2`) maps to
  its stage (`coder`). An unknown role is refused (exit 2) — never
  run-everything.
- The plan printed by `--plan` is byte-for-byte the sequence actually run
  (`PLAN` and `RUN` share one function) — never a second list to keep in
  sync by hand.

## Lane table (human ruling A, 2026-09-17)

| Role | Lanes |
| --- | --- |
| coder | compile, unit, properties, its own ticket's acceptance feature |
| cleaner / architect / documenter | compile; unit only if the parcel's own commits since the received commit (or `origin/main` with none) touch `extension/src` or `extension/test`; properties only if those commits touch a `*.property.test.js` file; its own ticket's acceptance feature |
| hardender | compile, unit, mutation (its existing differential Stryker invocation), its own ticket's acceptance feature |
| QA | compile, unit, the changed-path gate (Article 4.5), properties, its own ticket's acceptance feature |

QA is the only role whose plan always includes every lane — the final gate
is unchanged. The property lane runs at most twice per parcel (coder once,
QA once), never six times.

## What this replaces

The five role prompts (coder, cleaner, architect, hardender, documenter)
carried their own interim prose lane sets, landed 2026-09-17 the same pass
that filed this ticket; those prompts now name this command instead of
restating the table, so the lane set cannot drift out of sync between a
prompt's prose and what actually runs.

## What this is not

- Not a mapped-set runner that narrows the unit lane to changed paths
  (BL-791 slice F remains open for that).
- Not a property-lane duration recorder or ratchet (BL-1619).
- Not a change to what any lane itself runs, to QA's lane set, or to
  Article 4.5's gate.

Acceptance: `specs/features/BL-1618-one-verification-command-per-role-encodes-the-lane-set.feature`

# Rule proposal disposition — REJECTED, 2026-09-03 (specifier)

**Proposal** (`type: rule_proposal`, `scope: role:hardener`, from hardender,
2026-09-03T02:48:58Z):

> BL-848 stamp-off fixtures reproduce os.tmpdir()-socket antipattern (BL-948)
> 2/2 this session, missed by coder/cleaner/architect, caught only by hardener's
> sweep. Default to mkSocketFixtureRoot.
>
> Rationale: Both hits build a real bare-git+tmux-socket harness from scratch —
> concentrated in one ticket family, worth targeting authoring guidance there.

**Decision: rejected as scoped.** The observation is correct and worth having.
The remedy is not: it would add prose to the prompt of the role that already
catches this, leaving the authors unchanged and the actual mechanism inert.

## Why prose in `hardender.prompt` is the wrong instrument

**1. It tells the catcher what it already does.** Both hits were found by the
hardener's sweep — the proposal says so itself. A rule instructing the hardener
to prefer `mkSocketFixtureRoot` changes nothing about the behaviour that
produced the finding.

**2. A mechanical gate for this rule already shipped.**
`extension/test/socketFixtureShortRootGuard.test.js:136` asserts zero violations
across `specs/pipeline/steps`, and its failure message already names the remedy
verbatim: *"use lib/socketFixtureRoot.js's mkSocketFixtureRoot instead"*. BL-948
converted 51 step files and the guard defines its adoption set **by inspection**,
deliberately, so it cannot rot into a hand-maintained list of spellings (its own
comment measures that: of 6 long-base spellings, a naive pattern caught 1). Prose
restating a shipped gate is strictly weaker than the gate.

**3. The reason the gate is not catching new violations is that it is already
red.** Verified this pass:

```
npx vitest run test/socketFixtureShortRootGuard.test.js
  Test Files  1 failed (1)
       Tests  1 failed | 15 passed (16)
```

```
scanForSocketFixtureRootViolations('specs/pipeline/steps') -> 2
  specs/pipeline/steps/bl1112StandingUnitRedsSteps.js
  specs/pipeline/steps/bl691AmbulanceWorkflowGapsSteps.js
```

A gate that is red before an author touches anything cannot flag that author's
new violation — the third one is indistinguishable from the standing two. That is
the whole mechanism behind "missed by coder/cleaner/architect", and it is not a
failure of those three roles: nothing told them. Reframing it as an authoring
discipline problem would put the blame in the wrong place and leave the red.

## Already ticketed — do not re-mint

**BL-1290** (`backlog/paused/`, `type: defect`, `severity: medium`, priority 25,
`human_approval: approved`, `depends_on: []`) — *"Two step files root a
control-socket fixture at os.tmpdir() ... so socketFixtureShortRootGuard is a
standing red"*. It names both violating files, and its own notes already state
the structural point the proposal is circling:

> each guard runs at suite-run time, so a violation is reported to whoever next
> runs the suite rather than to the author who introduced it

It is approved with no unmet dependency — it is simply queued. **Landing BL-1290
converts the hardener's manual sweep into an automatic gate**, which is what the
proposal actually wants.

## What the proposal contributes, and where it has been recorded

The new datum is the measured COST of the standing red: in one session the
antipattern was authored twice in the BL-848 stamp-off family and caught both
times only by hand. Both were fixed in-parcel (BL-1333's `mkroot()` now calls
`mkSocketFixtureRoot`), so the violation count did not grow — the scan still
shows exactly the 2 files BL-1290 names. The cost is not accrued debt; it is a
hardener sweep per parcel doing work a green gate would do for free.

Recorded on BL-1290's `notes:` this pass, as evidence for its promotion
priority.

## Severity left alone, deliberately

An argument exists for raising BL-1290 to `high` — a red gate is a broken safety
signal, which is the schema's own `high` bar. Left at `medium` on purpose: the
hazard it guards (a control-socket path overrunning the 100-char limit under
macOS's long temp base) is inert on Linux, where this swarm runs, and BL-1290's
`approval_context` already records exactly that reasoning. The new evidence is
about DETECTION, not about the hazard, so it is not grounds for me to quietly
reverse another pass's honest call. Flagged here so whoever next weighs the
queue has the fact rather than having to rediscover it.

# BL-1343 — hardener pass (20260902)

Received: architect re-pass commit `36dd69e341` (cleaner `e81e1bdbfc`,
forwarding coder's D1 rework `f89d6eadff` — a generator-only fix for the
architect's own earlier bounce, production `land_step_lib.bb` unchanged
since the pre-bounce, already-reviewed version).

## BL-149 cooldown gate

`swarmforge/scripts/land_step_lib.bb` — skip-cooldown (0.28 days old,
still actively churning from today's own fix). No mutation pass this
pass per the gate; verification below is direct (bb test suite,
property-test non-vacuity, acceptance), not Stryker/hand-mutation-sweep
scoped to the cooldown window.

## Real gap found and closed: the refusal warning silently dropped all
but the last excluded path

`own-paths`' new BL-1343 refusal builds its warning by folding
`(conj excluded {...})` over every subtracted path, then
`(str/join "; " ...)`-formats the accumulated list. Every existing test
(scenario 03, the BL-1338 reproduction) exercises exactly ONE excluded
path, so a mutant replacing the fold with "keep only the current
element" (`[{...}]` instead of `(conj excluded {...})`) — which silently
drops every earlier exclusion from a multi-path refusal — **survived**
the full existing suite unnoticed. This is the same "a fold needs
disagreeing members to prove the fold, one member cannot tell `conj`
from `[x]`" class documented elsewhere in this role's own standing
rules, here applied to an accumulator rather than a selector.

Concretely: had BL-1338's real subtraction spanned two or more of its
own paths (rather than the one the escalation happened to name), the
refusal's own diagnostic — the thing this ticket exists to make speak
instead of stay silent — would itself have silently named only the
last one, undermining the ticket's own invariant 2 ("names the path...
never in silence") for every exclusion but the final one.

Added scenario 03b to `land_step_lib_test_runner.bb`: two of the landing
ticket's own paths, each subtracted by a DIFFERENT sibling
(`BL-9002`/`BL-9003`), asserting the refusal names BOTH paths and BOTH
siblings. Confirmed the mutant is killed (2 failures, isolated to
exactly the new assertions) before restoring
(`git diff --stat swarmforge/scripts/land_step_lib.bb` empty
afterward).

## Non-vacuity re-verified independently

The coder's own evidence claims "disabling the guard... still fails
BOTH invariants" from the property-test rework. Re-verified myself
rather than trusting the claim: hand-patched `own-paths`' refusal
condition from `(if (and (empty? acc) (seq delivered)) ...)` to
`(if false ...)` (the guard permanently off), recompiled, and ran
`bl1343ReplayNeverDropsOwnPathInvariants.property.test.js` —
both invariants failed as expected. Restored (`git diff --stat` empty),
re-ran clean (2/2, ~13s — a real subprocess-heavy property test, not
mocked).

## Verification (all green)

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS
  (was 15 BL-1343 assertions across 7 scenarios, +5 new in scenario 03b)
- `npm run test:properties -- test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`
  — 2/2 (both declared invariants; the shape-based, non-flaky generator
  from the coder's D1 rework, re-run clean here too)
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1343-replay-drops-the-tickets-own-path.feature` — 6/6
- Full unit suite (`npx vitest run`, no exclusions): 571 files, 9899
  tests, 9874 passed / 25 failed — the exact same pre-existing,
  already-ticketed standing reds documented throughout this session.
  Zero new failures.

## CRAP / DRY

No production TypeScript file changed by this ticket (the fix is
entirely in `land_step_lib.bb`; the coder's rework touched only the
property test). Babashka has no CRAP/DRY tooling wired (BL-472
deferred), gated by its own unit suite only, green throughout.

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean.
`git status --short`: only the intended
`land_step_lib_test_runner.bb` diff plus the same two pre-existing
untracked files noted throughout this session.

## Verdict

One real gap found and closed (a multi-path refusal warning that
silently dropped all but its last exclusion — the exact silence this
critical ticket exists to remove, now closed for the N>1 case too).
Non-vacuity independently re-verified. No other defect. Forwarding to
documenter.

By hardener.

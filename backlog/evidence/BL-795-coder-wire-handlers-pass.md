# BL-795 — coder wire-handlers pass

Follow-up to `BL-795-coder-adopt-pass.md`. The specifier amended the ticket
(commit `a1106143`, `backlog/evidence/BL-795-bounce-20260803.md`) to add the
missing acceptance feature file after the coder's Article 4.4 spec-gap note.
Per "Amending An In-Flight Ticket's Spec": merged `main`, re-read the ticket
YAML and feature file, wired step handlers for all five scenarios in this
same parcel (BL-233 — the acceptance runner throws on unhandled scenarios).

## Merge

`git merge main` (fast, no conflicts) pulled in the feature file, its
evidence record, and two unrelated paused specs (BL-798/BL-799 — untouched).

## Step handlers added

`specs/pipeline/steps/bl795MonoRouterStarvationHandFixSteps.js`, registered
in `specs/pipeline/steps/index.js`. No hand-built score rows — every step
drives a real adopted artifact:

1. `-01` (rule_proposal alone preferred) / `-02` (fresh note stays
   non-actionable) / `-03` (in_process priority-00 beats rule_proposal
   priority-50) — anchor on `test_handoffd_rule_proposal_rotate_wiring.sh`
   scenarios A/B/C respectively (the real `handoffd.bb
   --print-preferred-rotate-target` path over real mailbox fixtures).
2. `-04` (chase poke at a non-preferred role redirects) — reuses scenario
   `-03`'s fixture/PASS marker as the redirect's precondition proof
   (`preferred-mono-rotate-role` = hardender != specifier, the exact branch
   condition `chase-rotate-to!` tests), plus a structural check against the
   adopted `handoffd.bb` source: the pre-fix `chase-rotate-skip-not-preferred`
   path is absent and the adopted `chase-rotate-redirect` path is present.
   **Judgment call, not a live `--poll-once` drive**: the bounce evidence
   suggested `--poll-once` "over a temp fixture, asserting the
   chase-rotate-redirect path" was drivable offline. Investigated: reaching
   `chase-rotate-to!` through `--poll-once` requires the chase-sweep stuck-
   timing gate to fire on a role AND `attempt-resident-rotate!`'s
   `capture-pane-text`/`rotate-resident-to!` shell to a REAL tmux server
   (`process/sh "tmux" ...`, not a fake socket file — the existing A/B/C
   wiring test avoids this exact dependency by using
   `--print-preferred-rotate-target`, which never reaches chase/rotate at
   all). Building a real ephemeral-tmux-session fixture plus stuck-timing
   setup for one two-line branch is the same disproportionate-effort/
   impure-daemon-control-flow tradeoff the adopted `handoffd.bb` comment
   above `chase-rotate-to!` already made for this identical code path when
   declining a BL-654 property test for invariant 2 (see
   `BL-795-coder-adopt-pass.md` item 2) — and matches the ticket's own e2e QA
   procedure step 4, which defers exactly this redirect behavior to a manual
   live-mono-router check, not an automated fixture. Kept the
   precondition-plus-source-check proof at the acceptance layer instead of
   re-deriving a heavier harness the project's own prior review already
   judged out of scope for this function.
3. `-05` (chase escalation keeps waking) — anchors on `test_chase_sweep.sh`
   scenario 06 (the real `chase_sweep_lib.bb` `sweep-in-process!` path over a
   fake-now-ms fixture, no live tmux).

## Acceptance run

```
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-795-mono-router-starvation-hand-fix.feature
ok 1 - A directed rule_proposal alone makes its role the preferred rotate target
ok 2 - A fresh note alone stays non-actionable
ok 3 - A held in_process claim outranks a directed rule_proposal
ok 4 - A chase poke at a non-preferred role redirects onto the preferred role
ok 5 - Chase escalation on stuck in_process work keeps attempting resume
# pass 5
# fail 0
```

## Non-vacuity

Temporarily broke `mono_router_lib.bb`'s `actionable-mail?` (dropped the
`rule-proposal-count` disjunct, restoring the pre-fix 3-key shape) and reran
the same acceptance command: scenarios 1, 3, 4, 5 all failed (scenario 2 -
the fresh-note guard - is unaffected by this specific disjunct and correctly
stayed green, since dropping `rule-proposal-count` cannot make a note MORE
actionable). Restored the file byte-for-byte afterward (`git diff --stat`
empty) and reran — all 5 green again.

## Regression check

`node --test specs/pipeline/test/stepRegistry.test.js
specs/pipeline/test/runtime.test.js specs/pipeline/test/generate.test.js` —
30/30 green, no change to shared pipeline infra behavior (only an additive
`index.js` require entry).

## Scope

Only `specs/pipeline/steps/bl795MonoRouterStarvationHandFixSteps.js` and the
one-line addition to `specs/pipeline/steps/index.js` are new/changed in this
commit, beyond the `main` merge. No production `.bb` files touched (the hand
fix itself was already adopted in the prior commit).

# BL-356 swarm-pushes-main-to-origin — 20260714 (architect)

## Verdict: BOUNCE to coder — correctness defect, not an architecture violation

## What was reviewed

Merged cleaner's `721fc68bae` (coder commit `c31d6736f3`) into the architect
worktree. Structurally this is clean: `push_sweep_lib.bb` is pure
adapter-injected policy, `handoffd.bb`'s `push-sweep!`/`push-sweep-rev-counts!`/
`push-sweep-push!` are the thin git/network adapter, same shape as
`stuck_escalation_email_lib.bb`. No TS files are touched by this ticket's own
diff (`pushSweepSteps.js` lives under `specs/pipeline/steps/`, outside
`extension/`), so `dependency-gate.js`'s `extension/src`/`extension/test`
ruleset does not apply — noted rather than silently skipped. Ran the pure
unit suite (`push_sweep_lib_test_runner.bb` — ALL TESTS PASSED), the
generated Gherkin acceptance suite for all 5 of the ticket's scenarios (5/5
pass), and the real-daemon/real-git/real-remote wiring test
(`test_handoffd_push_sweep_wiring.sh` — ALL PASS). All green. The defect
below is not caught by any of them.

## The defect

`push_sweep_lib.bb`'s `sweep!` keeps TWO alarm-arming flags in the daemon's
persisted `push-sweep-state.json`: `:alarm` (push-failure alarm, read/written
only inside the `:should-push` branch) and `:divergence` (divergence alarm,
read/written only inside the `:diverged` branch). The docstring above `sweep!`
claims this is "fully self-healing": armed state is cleared "once origin
catches up (`:nothing-to-push`) or a push actually lands (`:pushed`)" — but
that is only TWO of the state transitions this sweep can take. A third
transition exists and is not handled: **entering `:diverged` only clears
`:push` (`(assoc state :divergence next-alarm :push {})`); it never touches
the sibling `:alarm` key. Leaving `:diverged` back to `:should-push` clears
nothing new either** — `push-state` starts fresh (it was reset to `{}` on
diverge-entry) but `alarm-state` is read straight from the stale `:alarm` key
that survived the detour untouched.

Concretely (this project's own recent history: `git log` on this very repo
shows exactly this shape — local commits piling up while a human merges a PR
directly to `origin/main` via GitHub, i.e. `behind` going non-zero while
`ahead` is still non-zero):

1. Local is ahead, `git push` keeps failing (persistent network/auth issue).
   After `max-push-attempts` (default 5) the push-failure alarm fires and
   delivers: `{:alarm {:armed? true :attempts 0 :last-attempt-at-ms nil}}`.
2. Origin gains a commit the swarm doesn't have (a human merges directly on
   GitHub, exactly as `git log --oneline` shows already happened twice this
   week) while the local unpushed commit is still stuck → decision flips to
   `:diverged`. `sweep!` sends the (first) divergence alarm, and writes
   `(assoc state :divergence next-alarm :push {})` — `:alarm` is carried over
   unchanged, still `:armed? true`.
3. A human reconciles the divergence by hand (pull/rebase, no push yet) →
   `ahead>0, behind=0` → decision is `:should-push` again, NOT
   `:nothing-to-push` (state is never fully wiped). `push-state` starts clean
   (attempts 0, from the `{}` written in step 2). `alarm-state` is read from
   the stale, still-`:armed? true` `:alarm` key from step 1.
4. If the ORIGINAL push failure cause (e.g. the network/auth issue) has not
   actually been fixed, this new episode's pushes fail and exhaust the retry
   budget again — but `alarm-due?` short-circuits on `(not (:armed? alarm-state))`
   and returns `false`, so `send-push-alarm!` is never called. The swarm's
   work silently stops reaching origin again, with no alarm at all.

The same shape applies symmetrically to `:divergence`: if a SECOND, unrelated
divergence episode occurs later without an intervening `:nothing-to-push`,
its alarm is silently swallowed by the first episode's stale `armed?` flag —
`sweep!`'s `:diverged` branch takes the `alarm-due?` `false` path
("diverged-already-alarmed") without even checking whether the current
`ahead`/`behind` counts are the SAME divergence as before.

This is exactly the class of bug the ticket itself calls out by name and the
engineering article's alarm-arming rule exists to prevent — "a flag that
suppresses a repeat notification... is, by construction, also the thing that
can SUPPRESS THE ONLY WARNING ANYONE WILL EVER GET" — except here the flag
isn't mis-armed on an *attempt* (that part is implemented correctly, see
`next-alarm-state`/`classify-send-result`); it's a stale confirmed-armed flag
from a PRIOR, resolved episode leaking into a NEW, unrelated episode because
`:diverged` is a transition the self-healing reset was never extended to
cover. Same family as BL-215/BL-333/BL-345, one door further in.

## Suggested remediation (not prescriptive — coder's call on the exact shape)

`sweep!`'s `:diverged` branch and `:should-push` branch each need to clear
the OTHER's stale armed flag when the decision changes away from the state
that flag belongs to — e.g. entering `:diverged` should also reset `:alarm`
to `{}` (a push-failure episode that hasn't resolved by publishing yet is,
from the divergence branch's perspective, a new unknown once divergence is
what's actually blocking), and leaving `:diverged` for `:should-push` should
likewise reset `:divergence` to `{}`. Whatever the exact fix, add unit
coverage in `push_sweep_lib_test_runner.bb` for the cross-episode sequence
(should-push exhausts+arms → diverged fires+arms → back to should-push,
still failing → assert the push alarm fires AGAIN) — the existing 5 scenarios
each cover a single, isolated episode and do not catch this.

Bouncing to coder; not forwarding to hardener. Not filing as a
`rule_proposal` instead — this is a live, reachable defect in the parcel
itself, not a durable rule the project is missing (BL-333 lesson).

By architect.

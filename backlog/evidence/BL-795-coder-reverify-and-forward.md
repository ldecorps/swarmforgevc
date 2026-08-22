# BL-795 — coder re-verify and forward

Architect's bounce (`BL-795-mono-router-starvation-hand-fix-adopt-bounce-20260803.md`,
D1) flagged that all 5 acceptance scenarios failed on commit `9172fda839`,
but separately observed — "not verified by this review" — that this worktree's
own commit `38268d27` ("wire acceptance step handlers for the starvation
hand-fix feature") appeared to already carry the fix, just never forwarded
past coder to cleaner/architect.

This pass independently confirms that observation before re-forwarding, per
"Never Blind-Forward A Bounce You Cannot Fix" (the inverse case: don't
re-implement work that's already sitting in-tree unforwarded either — verify
it, then forward).

## Ancestry

Both the bounced commit and the architect's bounce-record commit are
ancestors of current `HEAD` (`f1d1ae88`):

```
$ git merge-base --is-ancestor 9172fda839 HEAD && echo ok
ok
$ git merge-base --is-ancestor 95ca2281 HEAD && echo ok
ok
```

## Acceptance (all 5 scenarios, re-run this session)

```
$ node specs/pipeline/cli.js specs/features/BL-795-mono-router-starvation-hand-fix.feature
ok 1 - A directed rule_proposal alone makes its role the preferred rotate target
ok 2 - A fresh note alone stays non-actionable
ok 3 - A held in_process claim outranks a directed rule_proposal
ok 4 - A chase poke at a non-preferred role redirects onto the preferred role
ok 5 - Chase escalation on stuck in_process work keeps attempting resume
# pass 5
# fail 0
```

## Regression (re-run this session)

- `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` — ok
- `bash swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh` — A/B/C ALL PASS
- `bash swarmforge/scripts/test/test_chase_sweep.sh` — all scenarios (01-14) ALL PASS, including 06
- `bb swarmforge/scripts/test/chase_sweep_alert_resume_property_runner.bb` — ALL PROPERTIES HOLD (500 runs)
- `bb swarmforge/scripts/test/mono_router_actionable_rule_proposal_property_runner.bb` — ALL PROPERTIES HOLD (500 runs)

## Conclusion

The architect's observation was correct: the step-handler wiring was already
complete in this worktree, just unforwarded. No new implementation needed.
Forwarding `HEAD` (`f1d1ae88`) to cleaner.

## Worktree hygiene note

`swarmforge/scripts/operator_path_lib.sh` sits untracked in this worktree
and predates this session — it is not part of BL-795's file scope (not
listed in the ticket's `required_wiring`/file list) and this pass did not
create or touch it. Left unstaged per BL-506; surfaced here rather than
swept.

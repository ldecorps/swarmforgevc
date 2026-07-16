# BL-466 bounce evidence — 2026-07-16

1. **Failing command**: no single command fails; the gap is found by grepping every real
   caller of the new `--options` plumbing:
   ```
   grep -rn "operator_ask\.bb" --include="*.prompt" --include="*.sh" --include="*.bb" \
     --include="*.ts" --include="*.md" . | grep -v node_modules | grep -v "/test/"
   git diff 23ce906b6d~1 e6c64a362c --stat
   ```

2. **Commit hash checked out and tested**: `5bcdf798eed91b2bd587b76520fd871f4eb1ccff`
   (QA merge of documenter `e6c64a362c218332f93fc660b6893b9ebd1fd832`, BL-466, into
   `swarmforge-QA`). Full unit suite (312 files / 4830 tests) and all 4 acceptance
   scenarios in `specs/features/BL-466-agent-questions-as-telegram-polls.feature` pass
   cleanly against this commit — this is not a compile/unit/acceptance failure.

3. **First error excerpt** (the wiring gap):
   ```
   $ grep -rn "operator_ask\.bb" --include="*.prompt" ...
   swarmforge/roles/operator.prompt:39:
     `operator_ask.bb "$(pwd)" --thread <SUP-###> --question "<your question>"`
   ```
   That is the ONLY real (non-test, non-script-internal) invocation site of
   `operator_ask.bb` anywhere in the repo — it is the disposable Operator LLM's own
   role-prompt instruction for the ASK tool, and it still shows only `--question`.
   `git diff 23ce906b6d~1 e6c64a362c --stat` (full BL-466 range, coder through
   documenter) confirms `swarmforge/roles/operator.prompt` and
   `swarmforge/roles/specifier.prompt` are untouched by this ticket — zero lines
   changed in either file.

4. **Failure class**: `behavior`.

5. **Expected vs observed**: Expected — per the ticket's firm human-approved contract
   ("discrete-option questions render as native Telegram polls ... starting with the
   specifier") — at least one real, live caller constructs `--options` from an actual
   specifier clarifying question so a poll can be sent in production. Observed — the
   sole real caller of `operator_ask.bb` (the Operator, driven entirely by
   `operator.prompt`) was never taught about `--options` at all; it will only ever
   invoke the plain `--question` form. `parse-options`/`sendPoll`/`deliverAgentQuestion`
   are fully built, unit-tested, and acceptance-tested via fixtures that call the CLI
   directly with `--options`, but nothing in the live swarm can ever reach that code
   path with real options — a specifier's discrete-option question will always degrade
   to a plain message, forever, exactly the "correct and green on its own but invoked by
   nothing has zero effect in the live swarm" class already on file for this project
   (BL-149, `mutation_cooldown_gate.bb` referenced from nowhere). Fix: teach
   `operator.prompt`'s ASK section how to detect a discrete-option question (e.g. from an
   `AskUserQuestion` decision menu the specifier raised) and pass
   `--options '["a","b",...]'` when constructing the `operator_ask.bb` call — or if the
   Operator is deliberately not meant to parse structured options itself, wire an
   automatic capture point that does and calls `operator_ask.bb --options` on the
   specifier's behalf. Either way, at least one live path must actually exercise
   `--options` before this ticket's firm contract is met.

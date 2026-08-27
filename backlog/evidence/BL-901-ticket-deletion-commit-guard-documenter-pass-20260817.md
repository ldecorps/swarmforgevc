# BL-901 ticket-deletion-commit-guard — documenter pass — 20260817

Commit reviewed: `67919fbf78` (hardener's forward, `merge_and_process
hardender 67919fbf78`, bundling BL-901/BL-903/BL-815 as three separate
tasks). This pass covers BL-901 only; BL-903 and BL-815 arrived as their own
`git_handoff` parcels (task names `BL-903-push-sweep-discards-failure-reason`
and `BL-815-classify-five-unit-suite-timeout-failures`) and are documented in
their own passes, each with its own evidence file and QA handoff.

## What changed

A new pre-commit/commit-msg guard pair, `swarmforge/scripts/check_ticket_deletion.sh`,
refuses a commit that deletes a tracked backlog ticket YAML
(`backlog/paused|active|done/**`) when the ticket id appears at no other
staged path and is not named in the commit message — closing the silent-loss
gap that let `c9f888d14` sweep a staged delete of BL-893 into an unrelated
commit with no error, gate, or log line. Because `git diff --cached` is
readable at pre-commit time but the commit message is not yet available
(githooks(5)), the check runs twice: `pre-commit` calls it with no
message-file argument (exempt-or-defer only, never refuses), and the new
`commit-msg` hook re-invokes it with the finalized message to do the actual
enforcement. `swarmforge/git-hooks/pre-commit` was also changed from a
trailing `exec check_commit_size.sh` to two sequential calls so both guards
run (the earlier `exec` would have prevented any second guard from ever
running). A close (`active/` to `done/**`) or promote (`paused/` to
`active/`) that stages both the delete and the add for the same id passes
untouched, as does a deliberate retirement that names the ticket id in the
commit message.

## Doc surfaces checked

- `docs/how-to/BL-105-history-strip.md` — the only doc anywhere that
  mentions the sibling `check_commit_size.sh` guard, and only in passing
  background ("every role branch still carries the blob commit... until this
  runbook is executed the specifier must keep squash-merging"). It does not
  describe the hook mechanism itself, so it does not go stale for a second
  guard being added alongside the first.
- No doc under `docs/` describes `swarmforge/git-hooks/pre-commit`,
  `core.hooksPath`, or the commit-time guard mechanism in general — there is
  no existing reference page these guards were ever added to, and BL-105's
  precedent for `check_commit_size.sh` also never got one. Both guards are
  self-documented at the code site: the header comment in
  `swarmforge/git-hooks/pre-commit`, `swarmforge/git-hooks/commit-msg`, and
  `swarmforge/scripts/check_ticket_deletion.sh` itself explain the two-hook
  split and why. Manufacturing a new reference doc for this one guard, with
  no matching page for its sibling, would invent scope the ticket didn't ask
  for.
- `docs/reference/Specification.MD` — grepped for "pre-commit", "hook",
  "ticket deletion", "check_commit_size": no entry. Nothing to update.
- `docs/diagrams/architecture.mmd` / `swarm-flow.mmd` — no new component,
  worktree, role, or pipeline-topology change; a commit-time git hook is
  infrastructure around the repo, not a swarm-flow or architecture element
  either diagram depicts.
- No new human-facing command, setting, or flow was introduced. The guard is
  silent on the allowed paths (identical to today's behavior) and only
  speaks on the refusal path, where its own `stderr` message is the
  complete, self-sufficient explanation (it names the ticket id, the path,
  and the exact remedy — "name the ticket id in the commit message").

## Verdict

NONE. No human-facing documentation requires a change for this parcel.

## Forward

`git_handoff` to `QA`, priority `00`, task
`BL-901-ticket-deletion-commit-guard`.

By documenter.

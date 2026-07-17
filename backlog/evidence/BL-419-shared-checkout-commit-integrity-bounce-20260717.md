# BL-419 QA bounce — 2026-07-17

## 1. Failing command
```
grep -n "commit_integrity" swarmforge/roles/coordinator.prompt
```
(exit 1 — no match; run from the QA worktree after merging the documenter's handoff commit)

## 2. Commit hash
`01c0ab6e61` (documenter's HEAD for BL-419-shared-checkout-commit-integrity, merged into QA at this session)

## 3. First error excerpt
```
$ grep -n "commit_integrity" swarmforge/roles/coordinator.prompt swarmforge/roles/QA.prompt swarmforge/roles/specifier.prompt
(no output)
```
Corroborating mailbox record — the coder itself flagged this gap and the specifier
explicitly confirmed the wiring was in scope for THIS ticket, yet it never landed:

```
=== coder -> specifier (rule_proposal, 2026-07-17T03:40:07Z) ===
scope: role:coordinator
body: Coordinator ticket-close/human_approval commits should route through
      commit_integrity_cli.bb, not a hand-typed git mv/commit, per BL-419.
rationale: BL-419 built a locked, pathspec-scoped, verify+retry helper for the
      shared master checkout; twice a hand-typed coordinator commit dropped a
      staged approval edit.

=== specifier -> coder (note, 2026-07-17T03:42:25Z) ===
message: rule_proposal declined: coordinator wiring already in BL-419 scope;
      lands w/ it
```

The documenter's own Specification.MD entry (same commit) confirms it did NOT land:
"...only `operator_file_question.bb` is wired through it so far — routing the
coordinator's own bookkeeping commit (the originally observed victim) and the
other named writers (BL-topic-record writer, QA's push, the specifier) through
the same helper remains open follow-up work."

No new ticket or rule_proposal was subsequently filed to track that "open follow-up
work" (checked `.swarmforge/rule_proposals/2026-07.jsonl` and `backlog/paused|active/`
for any BL-419 follow-up — none exists).

## 4. Failure class
`behavior`

## 5. Expected vs observed
Expected: per the ticket's own `notes.Scope` ("routing the master-checkout writers
through it — coordinator bookkeeping first (the observed victim)...") and the
specifier's explicit confirmation that this wiring is in BL-419's scope, the
coordinator's ticket-close/`human_approval` commit path should route through
`commit_integrity_cli.bb` (locked, verified, retried) in this parcel.
Observed: `swarmforge/roles/coordinator.prompt` is untouched by every commit in this
parcel (coder through documenter); the coordinator still performs a hand-typed
`git mv` + `git commit` with no lock, no pathspec-scoped verify, and no retry — the
exact unmitigated path that produced BOTH of the ticket's own documented incidents
(BL-357/BL-341 and BL-412 landing `human_approval: pending` despite a staged
`approved`). The mechanism built in this ticket (`commit_integrity_lib.bb` /
`commit_integrity_cli.bb`) is correct and well-tested in isolation (unit suite
green), but it protects nothing at the one call site the ticket was filed to fix; a
third occurrence of the original bug remains just as likely as before this ticket
shipped.

# BL-243 scenario 03 reconciliation — operator ruling, 2026-07-10

BL-243 ("coordinator is provisioned infrastructure, not a configured role")
flagged an open question for human review: whether the coordinator keeps its
main-branch integration role once it becomes always-on provisioned
infrastructure instead of a `swarmforge.conf` window line, or sheds that role
to a separate convergence step.

## Operator's ruling (verbatim, via the coordinator, 2026-07-10)

> every agent should merge his branch with QA's. the only thing coordinator
> does is that he physically moves the backlog tickets.

## Reading of the ruling

- Every pipeline worktree role (coder, cleaner, architect, hardender,
  documenter) merges its own branch up to QA's approved commit — this is
  already today's merge-up broadcast protocol (see `swarmforge/PIPELINE.md`
  "Merge-Up Protocol", `HANDOFF-PROTOCOL.md` "QA approval and merge-up (full
  pack)"). The ruling keeps this unchanged.
- The coordinator's remaining job narrows to **backlog bookkeeping only**:
  move the ticket's YAML between `backlog/active/` / `backlog/paused/` /
  `backlog/done/`, and manage promotion/routing. It explicitly does NOT
  include the coordinator running `git merge <qa-commit>` into `main` itself
  the way it does today (see `coordinator.prompt` "QA approval — mechanical
  integration").

## Open question NOT resolved by the ruling — needs the specifier's design call

If the coordinator no longer performs the `main` merge, something still has
to land the QA-approved work on `main` (or `main` stops being the
integration target and one of the already-merged-up branches — likely QA's
own, since every other worktree merges up to it — becomes the
source-of-truth branch instead). The ruling does not say which. Candidates
worth the specifier weighing, not decided here:
  a. QA's own worktree branch pushes/fast-forwards `main` directly once every
     other role has merged up to it (QA becomes the integration point, not
     just the last gate).
  b. `main` is retired as a distinct integration target and the fleet console
     (BL-246) or some other Baton mechanism tracks QA's branch as the live
     tip instead.
  c. Some other role or a new thin mechanical script performs the same
     `git merge --no-ff <qa-commit>` + push the coordinator does today, just
     not the coordinator itself.

This also changes who pushes to `origin` and who runs the GH-issue-close /
push-retry steps currently in `coordinator.prompt`'s "QA approval" section —
those need a new owner under this ruling, whoever it ends up being.

## Follow-up resolution — operator + coordinator, 2026-07-10

Operator proposed the specifier as the `main`-merge owner (it already shares
the coordinator's `master` checkout, so mechanically trivial). Coordinator
raised one concern before agreeing: BL-243's own premise is that the
coordinator becomes *guaranteed-present infrastructure* — never
pack-configurable — specifically so something reliable always owns the
parts that cannot be skipped. The specifier is NOT gaining that same
guaranteed-present status under Baton (confirmed by the operator) — it
remains a regular pack-configurable role, and a lean pack can omit it
(precedent: the BL-203 2-pack ran coder+cleaner only, no specifier). Making
the specifier the merge owner would reintroduce exactly the single-point-of-
absence fragility BL-243 is designed to remove, for any pack shape that
drops the specifier.

**Resolution: candidate (a) — QA owns the `main` landing, not the
specifier.** QA is the pipeline's final gate; its branch already contains
the approved commit (every other worktree role has already merged up to it
per the existing merge-up broadcast), so QA pushing/fast-forwarding `main`
directly removes a full relay hop rather than adding a new one. This still
needs the specifier's confirmation that QA itself is reliably present across
whatever pack shapes Baton allows (not verified here) before treating it as
final — if QA turns out to be pack-optional too, candidate (c) — a thin
always-present mechanical step, separate from any configurable role — is the
fallback.

Whoever ends up owning the merge also inherits: the push-retry-on-rejection
discipline, the `swarmforge.conf`-driven `active_backlog_max_depth`
promotion recheck, and the GH-issue-close step
(`swarmforge/scripts/issue_done.sh`) currently in `coordinator.prompt`'s "QA
approval" section.

## Scope note

This is a real redesign of the merge-up + integration protocol
(`swarmforge/handoff-protocol.md`, `swarmforge/PIPELINE.md`, and multiple
role prompts), not a small edit — treat it as its own slice within BL-243's
scope, or a sibling ticket if the specifier judges it separable from BL-243's
launch-path/provisioning changes.

# BL-1233 — owning ticket unreachable from any live ref (2026-08-28)

**Trigger:** documenter note (priority 00, 2026-08-28T06:33:38Z): "BL-1233
phantom-revert recurred in documenter; BL-1196 guard restored". Documenter
already restored the clobbered content in its own worktree (worktree is
clean as of this check, HEAD `779c5775a`).

**Finding:** BL-1233 (defect/high, epic swarm-reliability — "ambient git env
blinds BL-373's launcher guard", the ticket that owns exactly this recurring
phantom-revert class) is **not present in `backlog/` on any current ref**.
Its lifecycle commits exist only in the reflog, unreachable from `main` or
any branch tip:

```
5f1cb5035 HEAD@{30}: commit: Mint BL-1233: ambient git env blinds BL-373's launcher guard.
4078b2e63 HEAD@{31}: commit: BL topic record for BL-1233
72d1f78df HEAD@{29}: commit: Approve BL-1233: record human_approval
```

`git log --all --grep="BL-1233"` finds nothing on any live ref. The only
remaining reference to it anywhere in the working tree is a mention in
`backlog/active/BL-1222-...yaml`'s notes ("BL-1233 establishes that the
launcher can silently clobber this very file with main's bytes").

**Caveat on method:** this session had an ambient `GIT_DIR`/`GIT_WORK_TREE`
leak (`/home/carillon/swarmforgevc/.git` / `/home/carillon/swarmforgevc`)
pinning every git invocation to the main checkout regardless of `cwd` —
the same hazard class BL-1233 itself is about. All commands above were run
with `env -u GIT_DIR -u GIT_WORK_TREE` to rule that out as the cause of this
observation.

**Not yet determined:** whether this is the same main-reset/history-loss
class as BL-1214, a phantom-revert clobber of `backlog/active/` itself, or
something else — the commits are real (reflog has full content) and
recoverable, but adjudicating cause and whether to re-mint vs. cherry-pick
back is a specifier call (Article 3.6 territory: this ticket's own premise
may now be stale in ways only the specifier can assess).

**Recorded by:** coordinator, on receipt of the documenter's recurrence note.
Routed to specifier via note, priority 00.

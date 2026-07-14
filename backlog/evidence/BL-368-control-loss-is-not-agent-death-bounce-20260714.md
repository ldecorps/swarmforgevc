# BL-368 (task: BL-368-control-loss-is-not-agent-death) QA bounce evidence — 2026-07-14

## Failing command
```
git merge-base --is-ancestor 56f9a3f9d8 ef58602acfcf2c5ef61c84469955dedd84c06ec7
```
(exit code `1` — the hardener's own handed-off commit, `56f9a3f9d8`, is NOT an
ancestor of the documenter's forwarded commit.)

## Commit hash
`ef58602acfcf2c5ef61c84469955dedd84c06ec7` (documenter's forward). Its actual
parent is `5570ed817f7ce9740e56365085074592fb5c788a` (the prior BL-331 docs
commit) — not `56f9a3f9d8`, the commit named in the documenter's own inbound
handoff (`merge_and_process hardender 56f9a3f9d8`,
`.worktrees/documenter/.swarmforge/handoffs/inbox/completed/00_20260714T082322Z_000239_from_hardender_to_documenter_for_documenter.handoff`).

## First error excerpt
```
$ git merge-base --is-ancestor 56f9a3f9d8 ef58602acfcf2c5ef61c84469955dedd84c06ec7
$ echo $?
1

$ git diff 5570ed81 ef58602acf --stat
 docs/Specification.MD | 4 +++-
 1 file changed, 3 insertions(+), 1 deletion(-)
(only the docs file changed — no source touched)

$ grep -rn "SWARM_CONTROL_LOST\|tmux-control-status" --include="*.bb" --include="*.ts" .
(no matches — every symbol the fix introduced is absent from the shipped tree)

$ sed -n '799,806p' swarmforge/scripts/swarmforge.sh
create_role_session() {
  local session="$1"
  local title="$2"

  tmux -S "$TMUX_SOCKET" new-session -d -s "$session" -n "$AGENT_WINDOW"
  tmux -S "$TMUX_SOCKET" rename-window -t "$session:$AGENT_WINDOW" "$title"
  tmux -S "$TMUX_SOCKET" set-window-option -t "$session:$title" allow-rename off
}
(no heartbeat-pid guard — pre-fix version, layer 2 of the ticket entirely absent)
```

## Failure class
`behavior` — the shipped commit does not contain either of the two fix layers
the ticket's own task name and notes require. Root cause is a dropped merge
(an `integration`-shaped defect: same family as BL-090/103), but the
observable result is a behavior gap: `operator_runtime.bb` still emits no
`SWARM_CONTROL_LOST` signal at all, and `create_role_session` in
`swarmforge.sh` will happily relaunch a role whose `claude` process is still
alive — exactly the repo-corrupting scenario the ticket exists to make
unreachable.

## Expected vs observed
Expected: the hardener's handed-off commit (`56f9a3f9d8`, "BL-368: hardening
pass — all gates green, no defects found", forwarded from architect merge
`a14f6aed` ← cleaner merge `b98206d9` ← coder `7702773f`, "BL-368: losing tmux
control is never misread as agent death") landed and was verified — a new
`SWARM_CONTROL_LOST` event distinguishing "control channel unreachable" from
"agents exited", plus a heartbeat-pid guard on every relaunch path
(`swarmforge.sh`'s `create_role_session`, `role_lifecycle.sh unpark`) that
refuses to start a role whose process is still alive.

Observed: the documenter's forwarded commit (`ef58602acf`) is built directly
on top of the prior `5570ed81` (BL-331 docs) commit, never merging in
`56f9a3f9d8` at all. `swarmforge.sh:create_role_session` and
`operator_runtime.bb` in this tree still match pre-ticket state — no
`SWARM_CONTROL_LOST` emission anywhere, no heartbeat-pid check before
relaunch. The documentation prose in this same commit
(`docs/Specification.MD`) accurately *describes* both fix layers in detail —
so the docs describe behavior the shipped code does not have. Merging this
parcel would ship documentation claiming the exact repo-corruption path is
closed while `create_role_session` still relaunches unconditionally.

## Root cause (why this happened, not just what broke)
Same class as the BL-090/103 precedent named in `workflow.prompt`'s
"Forwarded Commits Carry Their Lineage" — and the SAME defect QA bounced on
BL-331 just prior in this session (`backlog/evidence/BL-331-verified-check-
ignores-git-commit-durability-bounce-20260714.md`): the documenter received
`merge_and_process hardender 56f9a3f9d8` but committed its docs change
without first running `git merge 56f9a3f9d8` — so its own outbound forward
carries none of the hardener-verified work, only the docs text describing it.
The prose is correct; the merge that was supposed to bring the code along
with it never happened. Two occurrences of the identical defect in one
session (BL-331 then BL-368) suggests the documenter's merge step is not
reliably running before commit — worth a `rule_proposal` from whichever role
next touches this, though QA's own remit here is the bounce.

## What to fix
1. In the documenter's worktree, actually merge `56f9a3f9d8` (or the current
   tip of the hardener's BL-368 work) before re-committing/re-forwarding —
   `git merge-base --is-ancestor 56f9a3f9d8 <new-commit>` must hold.
2. Re-verify after merging that `operator_runtime.bb` emits
   `SWARM_CONTROL_LOST` distinctly from `AGENT_EXITED`, and that
   `create_role_session` (and `role_lifecycle.sh unpark`) refuse to relaunch
   a role whose heartbeat-tracked pid is still alive.
3. The documentation prose itself (the BL-368 paragraph added to
   `docs/Specification.MD`) reads correct against the intended fix — it can
   likely be carried forward unchanged once it sits on top of the right code.

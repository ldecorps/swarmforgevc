# BL-368 — already shipped to main; active/ ticket is a stale bookkeeping gap

The coordinator routed a `note` to the coder ("BL-368 next (control-loss defect)
- spec in active/") as if this were fresh work. It is not: both fix layers
described in `backlog/active/BL-368-control-loss-is-not-agent-death.yaml` are
already present on `main`, and this coder's own current HEAD is an ancestor of
`main`, so nothing further needs implementing.

## Evidence

```
$ git merge-base --is-ancestor <coder-HEAD 1927c0b6> main
(exit 0 — coder HEAD is an ancestor of main)

$ git show main:swarmforge/scripts/operator_lib.bb | grep -n SWARM_CONTROL_LOST
32:    "SWARM_CONTROL_LOST"  ; BL-368: the tmux control channel itself did not
517:  {:type "SWARM_CONTROL_LOST"

$ git show main:swarmforge/scripts/swarmforge.sh | sed -n '/create_role_session/,/^}/p'
create_role_session() {
  ...
  if [[ -n "$role" ]] && role_claude_pid_alive "$role"; then
    echo "Refusing to (re)create a session for ${role}: ... still alive ..." >&2
    return 1
  fi
  ...
}

$ git cat-file -e main:specs/features/BL-368-control-loss-is-not-agent-death.feature
(exists — all 4 acceptance scenarios present: control-lost-not-agent-death,
refuse-relaunch-of-live-process, genuine-death-still-recovered, human-notified)
```

The chain that landed it: coder `7702773f` -> cleaner `b98206d9`/`30ebed90` ->
architect `6dbd8fcc` -> hardener `56f9a3f9` -> (documenter dropped the merge,
QA bounced, see `backlog/evidence/BL-368-control-loss-is-not-agent-death-bounce-20260714.md`)
-> coder re-merged the dropped lineage at `b9bb28b4` ("restore dropped
lineage") -> `5fa6a6af` -> ... -> merged into `main`. `main` never got the
`backlog/active/BL-368-*.yaml` -> `backlog/done/` move, so the ticket still
reads `status: todo` and sits in `active/`, which is why it was re-dispatched.

## What's needed now

Bookkeeping only: move `backlog/active/BL-368-control-loss-is-not-agent-death.yaml`
to `backlog/done/` (set `status: done`). No coder/cleaner/architect/hardener/
documenter/QA work is required — re-running the pipeline on this ticket would
just re-verify code that is already on `main`.

By coder.

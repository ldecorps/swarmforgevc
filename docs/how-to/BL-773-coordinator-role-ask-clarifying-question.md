# The coordinator raises a clarifying question through `role_ask.bb`

`role_ask.bb` (BL-607) is role-generic — it takes `--role` and keeps a
per-role pending file — but until BL-773 it was wired into only one role
prompt, the specifier's. A coordinator decision it couldn't resolve alone had
no ask path of its own, so its question surfaced only on whichever
remote-control surface happened to be attached at the time, and the
coordinator blocked waiting for it. BL-773 gives the coordinator the exact
same path the specifier already uses.

## Raising the question

From the coordinator's own worktree/role context:

```
bb swarmforge/scripts/role_ask.bb <repo-root> --role coordinator \
  --question "<your question>" [--options '["option a","option b"]']
```

- `--options` is optional: include it for a short enumerated choice (renders
  as tappable buttons in the coordinator's Telegram topic); omit it for a
  free-text question. A human can always type a free-text reply instead of
  tapping a button, whichever form was asked.
- The question posts into the coordinator's **own** Telegram topic (`role-topic-map.json`
  already carries a `"coordinator"` entry — this ticket did not need to add
  one), never a shared agent-questions topic and never a standing questions
  topic. Per-role topics are the one routing system BL-772 relies on; nothing
  here introduces a second one.
- The coordinator must always ask **as `--role coordinator`**, never by
  borrowing another role's identity (e.g. `--role QA` on that role's behalf).
  Borrowing consumes the other role's one-pending slot, files the answer
  under its identity, and wakes it instead of the coordinator. When another
  role needs an answer, that role asks for itself; the coordinator's job is
  to route, chase, or surface that it is wedged — not to ask on its behalf.

## The one-pending guard is per role

Only one clarifying question may be pending for a given role at a time. A
second `role_ask.bb` call for a role that already has one pending returns
`{"asked": false, "reason": "already-pending"}` and does not touch any other
role's pending question — the specifier having a question pending never
blocks the coordinator's, and vice versa.

## No polling, and asking is never a reason to exit

The coordinator records whatever context it needs to resume (which ticket,
which promotion or routing decision was waiting) and ends its **turn** — not
its session. The coordinator's session must never exit (BL-107: exiting tears
down the whole swarm), so a pending question can never become an exit, a
sleep, or a re-check loop; doing so would also trip the endless-loop circuit
breaker. The answer reaches the coordinator either of two ways, both already
proven by the specifier's BL-607 path:

1. **Live pane leg** — if the coordinator's pane is still up when the human
   answers, the answer is delivered as a steer directly into the pane (the
   coordinator has a standing tmux session, so this is the common case for
   it, unlike a rotating mono-router role).
2. **Note leg** — if the pane isn't reachable, the answer arrives as a `note`
   that the coordinator's next `ready_for_next.sh` returns as a parcel.

Either way, on resume the answer text (a tapped option's label, or a typed
reply) is what the coordinator acts on to pick back up the decision it
parked.

## What this does not fix

This wiring makes the coordinator's own questions askable and answerable —
it does not, by itself, guarantee an answer can reach every *rotating*
pipeline role while that role is mid-turn with in-process work; that gap is
tracked separately as BL-846. The coordinator's own standing session is not
subject to that gap, since its pane never goes dormant.

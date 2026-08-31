# BL-1303: cleaner→architect forward blocked by duplicate_chain_guard

Cleaner finished the architect's pre-merge-commit wiring bounce (fbcc7b7712)
and committed the fix at `a09a7653a8` in `.worktrees/cleaner`
(`swarmforge-cleaner` branch). Sending the forward `git_handoff` to
`architect` is refused by `duplicate_chain_guard_lib.bb` (BL-760):

```
Cannot send git_handoff for BL-1303: a live parcel for this ticket already
exists at coder
(00_20260831T040912Z_001331_from_architect_to_coder_for_coder.handoff).
```

## Root cause (as far as cleaner can tell without editing another worktree)

That coder-mailbox file was synthesized by the same `swarm_handoff.sh`
invocation that queued architect's bounce to cleaner (sequential ids
`_001331` to coder, `_001333` to cleaner, both `commit: fbcc7b7712`,
both `created_at` within the same second). Every pack conf currently
defines architect's window as `back-all` (`full-forge.conf`,
`seven-pack.conf`, `cursor-forge.conf`, `qwen-anthropic-forge.conf`), and
Article 2.3 says a `back-all` send stamps `non-forwarding: true` copies to
every earlier pipeline role (coder precedes cleaner). The coder file's
header has no `non-forwarding` field at all:

```
$ grep non-forwarding .../coder/.swarmforge/handoffs/inbox/new/00_..._001331_....handoff
(no match)
```

`handoff-lib/non-forwarding?` fails closed on a missing/non-`true` marker
(handoff-protocol.md "Duplicate-Chain Guard (BL-760)"), so the guard
correctly counts this file as a live competing chain and refuses cleaner's
send — which is the guard doing its documented job against what looks like
a missing stamp in the reverse-hop synthesis, not a genuine second chain.

## Why cleaner did not self-resolve this

- Editing `coder`'s mailbox file directly from `cleaner`'s worktree
  crosses worktree discipline and risks a race with a live coder session.
- `redo_from.sh BL-1303 coder` is the wrong tool: it abandons every stale
  handoff for the item across every worktree and queues a **fresh**
  `git_handoff` to coder, restarting the pipeline from coder rather than
  clearing one mis-stamped reverse copy. BL-1303 does not need to restart
  from coder — cleaner's fix is already committed and ready to forward.

Routed to specifier/coordinator by note (priority 00) for triage: repair
or replace the coder-mailbox parcel (or its `non-forwarding` stamp), then
cleaner will re-send `git_handoff task: BL-1303-pre-merge-commit-still-doesnt-reach-the-guard commit: a09a7653a8` to architect.

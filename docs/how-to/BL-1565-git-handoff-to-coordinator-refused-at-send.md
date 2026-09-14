# A `git_handoff` naming the coordinator is refused at send (BL-1565)

*How-to. Task-oriented: understand why `swarm_handoff.sh` refused a
`git_handoff` draft, and what to send instead.*

## What it catches

Any `git_handoff` draft whose `to:` names `coordinator` — alone or among
other recipients, from any sender, whether that recipient comes from the
draft's own header or from BL-606 `required_stages` routing rewriting
`to:` afterward. The coordinator holds no code worktree and integrates
nothing (Article 1.1); Article 2.4 makes a `non-forwarding: true` inbound
merge-only ("merge, then `done_with_current.sh`"), and there is nothing
for the coordinator to merge. Before this guard, QA's post-land close
reached the coordinator as exactly that shape and was swallowed
merge-only — the coordinator then waited for a bookkeeping signal that had
already arrived, starving the whole mono-router swarm at
`active_backlog_max_depth: 1` twice in one day (BL-1527, parcel 002673,
2026-09-13; BL-1563, parcel 002698, 2026-09-14) until an operator hand-note
named the parcel as the close.

A `note`, `awake`, or `rule_proposal` to the coordinator is unaffected —
only `type: git_handoff` is in scope. A `git_handoff` to any other role,
including the specifier, is also unaffected.

## How it decides

`git_handoff_recipient_guard_lib.bb`'s `decide` (pure, no I/O) takes
`{:type :recipients}` and refuses when `type` is `"git_handoff"` and
`"coordinator"` appears anywhere in `recipients`. `swarm_handoff.bb`'s
`-main` consults it twice:

1. Right after parsing the draft, on the literal `to:` header — before
   `validate` runs at all, so the refusal needs no git repository and no
   tmux socket (a refusal here can't be blocked by an unrelated `validate`
   failure, e.g. a `commit:` that doesn't resolve).
2. Again on the post-routing recipient set, after `route-required-stages`
   — BL-606 routing can rewrite `to:` before a parcel is ever written, so
   the refusal must hold for where the parcel actually goes, not only the
   literal draft header.

Both checks happen before the self-audit challenge (`AUDIT_REQUIRED`), so
a refused draft never prints it and nothing is written under any
`inbox/new/`.

## If you hit this refusal

```text
git_handoff refused: the coordinator holds no code worktree and
integrates nothing (Article 1.1). QA's post-land close reaches it as a
note instead - message `type: note` /
`QA-approved <task> landed <sha> - bookkeep to done`.
```

Send a `note` instead. QA's own post-land close to the coordinator reads
`type: note`, `QA-approved <task> landed <sha> - bookkeep to done`; any
other role that needs to reach the coordinator should send a `note` (or, if
the actual content is a constitution-article route per Article 5.1, a
`git_handoff` to the **specifier**, which is unaffected by this guard).

## Where it lives

| Piece | Location |
| --- | --- |
| Guard library | `swarmforge/scripts/git_handoff_recipient_guard_lib.bb` (ns `git-handoff-recipient-guard-lib`) |
| Wired into | `swarmforge/scripts/swarm_handoff.bb` `-main` — once on the draft `to:` header before `validate`, once on the post-routing recipient set before `with-non-forwarding` |
| Shell test | `swarmforge/scripts/test/test_swarm_handoff_refuses_coordinator_git_handoff.sh` |
| Acceptance steps | `specs/pipeline/steps/bl1565CoordinatorNeverReceivesGitHandoffSteps.js` |
| Acceptance feature | `specs/features/BL-1565-a-git-handoff-to-the-coordinator-is-refused-at-send.feature` |

## Related

- [Draft-root guard on `swarm_handoff.sh`](BL-1518-handoff-draft-root-guard.md) — another send-time gate that refuses before any mailbox write, but applies to every message type rather than only `git_handoff`.
- `swarmforge/handoff-protocol.md` step 3 (QA → coordinator) documents the `note`-only close shape this guard now enforces.
- BL-1536 (2026-09-12) fixed the opposite direction — a QA *bounce* is never stamped `non-forwarding`. This ticket retires the one BL-1536 example that still asserted a stamped QA-to-coordinator *forward*, since that shape can no longer reach a mailbox at all.

## Verify

```bash
bash swarmforge/scripts/test/test_swarm_handoff_refuses_coordinator_git_handoff.sh
node specs/pipeline/cli.js specs/features/BL-1565-a-git-handoff-to-the-coordinator-is-refused-at-send.feature
```

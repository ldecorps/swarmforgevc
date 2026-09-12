# Draft-root guard on `swarm_handoff.sh` (BL-1518)

*How-to. Task-oriented: understand why `swarm_handoff.sh` refused an
invocation with `HANDOFF_DRAFT_OUTSIDE_ROOT`, and how to clear it.*

Send-time gate at the very start of `swarm_handoff.bb`, before any
mailbox, sender, or message-type logic — it applies to every message type
(`awake`, `git_handoff`, `note`, `rule_proposal`), unlike the other
send-time gates in `swarmforge/handoff-protocol.md`, which are
`git_handoff`-only. Full mechanics:
[`swarmforge/handoff-protocol.md`](../../swarmforge/handoff-protocol.md#draft-root-guard-bl-1518).

## What it catches

A `swarm_handoff.sh` invocation whose draft file does not live under the
project root the invocation resolves. This closes a fixture-escape found
on 2026-09-10: a unit test drove the real `swarm_handoff.bb` by shelling
it with `cwd` and `SWARMFORGE_ROLE` bundled into one options object; a
mutant of that test (during a BL-1441 mutation run) that emptied or
dropped the options object let the child process inherit the *test
process's own* real cwd and environment — the coder pane's live worktree,
`SWARMFORGE_ROLE=coder`. Under that mutant the CLI resolved a real, valid
project root (the coder worktree) even though the draft file it was
actually handed lived under an unrelated `mkdtemp` fixture, and happily
delivered the fixture's contents as a live handoff. Four such notes
reached the live specifier inbox before this was traced — the phrase they
carried (`use staging please`) is a retired human directive that read as
a fresh operator order.

## How it decides

The guard (`handoff_draft_root_guard_lib.bb`) does not try to answer
"is `cwd` correct" — that is unanswerable from inside the CLI, which never
learns what its caller meant to pass. It answers a narrower question the
CLI can always answer from data already in hand: does the draft this
invocation was actually given live under the root this invocation
actually resolved?

- **Containment at a path-separator boundary**, never a bare string
  prefix — a sibling directory that merely shares the root's name as a
  text prefix (root `/a/b` vs draft `/a/bc/x`) is never mistaken for
  containment. Exact equality (a root's own draft, once canonicalized)
  counts as inside.
- Both paths are canonicalized (`fs/canonicalize`) before the compare, so
  a relative draft argument or a symlinked worktree can't slip past a
  naive string comparison.
- Every production draft — a worktree role's own `tmp/handoff.txt`,
  master's `swarmforge/runtime/handoff-draft.txt`, or a script sender's own
  `<root>/tmp/` draft — is under its role's resolved root by construction,
  so this refuses only ever a fixture escape, never a live send. Seven
  script-built senders (`promote_and_route_next.sh`,
  `route_backlog_to_coder.sh`, `mailbox_note_to_role.sh`,
  `inject_note_to_role.sh`, and the three closing-ceremony/tracer-bullet TS
  tools) originally drafted under `${TMPDIR:-/tmp}` / `os.tmpdir()` and
  were refused once this guard landed; BL-1537 moved all seven under
  `<root>/tmp/` to match.

## If you hit this refusal

```text
HANDOFF_DRAFT_OUTSIDE_ROOT
draft: /tmp/some-mkdtemp-fixture/tmp/handoff.txt
root:  /home/carillon/swarmforgevc/.worktrees/coder
Refusing: the draft file does not lie under the project root this
invocation resolved. Run swarm_handoff.sh with a draft that lives under
your own worktree (or master's swarmforge/runtime/), or from the correct
project directory.
```

Run `swarm_handoff.sh` with a draft file under your own assigned worktree
(or, for the specifier/coordinator, under `swarmforge/runtime/`), or from
the correct project directory. If you are writing a test or fixture that
needs to shell the real CLI, pass its `cwd`/`env` explicitly and keep the
fixture root itself out of the argument list your production code path
uses — the same shape as `bl1518HandoffDraftRootGuardSteps.js`.

## Where it lives

| Piece | Location |
| --- | --- |
| Guard library | `swarmforge/scripts/handoff_draft_root_guard_lib.bb` |
| Wired into | `swarmforge/scripts/swarm_handoff.bb` (`draft-root-guard!`, called from `project-root` resolution before any mailbox write) |
| Acceptance steps | `specs/pipeline/steps/bl1518HandoffDraftRootGuardSteps.js` |
| Acceptance feature | `specs/features/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.feature` |

## Related

- [Tree-collapse guard on git_handoff sends](BL-1205-tree-collapse-guard.md) — another every-message-type-independent send-time containment check, though scoped to `git_handoff` merges rather than every message type.

## Verify

```bash
bb swarmforge/scripts/test/handoff_draft_root_guard_lib_test_runner.bb
bb swarmforge/scripts/test/bl1518_handoff_draft_root_guard_property_runner.bb
node specs/pipeline/cli.js specs/features/BL-1518-a-handoff-cli-never-writes-outside-the-root-its-draft-lives-in.feature
```

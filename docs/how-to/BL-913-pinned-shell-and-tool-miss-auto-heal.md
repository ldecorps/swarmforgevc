# BL-913: Pinned Shell + One Classified Retry (Tool-Miss Auto-Heal, Slice A)

**The problem this closes:** an agent issues a shell command from whatever
directory its pane's persistent shell happens to be sitting in — after a
mono-router rotation, that is often stale or simply wrong — the command fails
with something like `fatal: not a git repository`, and the agent spends a
turn apologizing and re-deriving the right `cd` by hand. The human's own
framing: *"stop teaching the model to be a careful shell; make the shell
un-wrong, heal one miss in silence, then fail honestly."* This is slice A
(pin + one classified retry) of the `tool-miss-auto-heal` epic; the catalog,
rotation-pin cleanup, apology-ban narration, and the Cursor surface are later
slices tracked on BL-912.

## What it does

A Claude Code `PreToolUse` hook, scoped to the `Bash` tool matcher only,
rewrites every Bash command a role issues into a small self-healing wrapper
**before** it runs — never after, and never as a second, separately-observed
attempt.

1. **`tool_miss_heal_hook.bb`** (`swarmforge/scripts/`) reads the hook's JSON
   off stdin. For anything that isn't a `Bash` tool call, or when the role's
   pinned worktree isn't known, it prints `{}` and changes nothing — this
   hook **fails open**: a bug here must never block a role from running
   commands, only (at worst) leave the pre-BL-913 unhealed behavior in place.
2. When it does apply, it calls the pure `build-healing-wrapper-command`
   (`tool_miss_heal_lib.bb`) and returns the generated bash text as
   `hookSpecificOutput.updatedInput.command` — Claude Code runs *that*
   instead of the original command.
3. The wrapper itself: run the original command exactly as issued; if it
   fails, classify the failure's own output against a closed, ordered
   taxonomy; for the first class that matches, re-run once from a healed
   environment; print only the final attempt's output and exit code.

## The pin — where "the role's own worktree" comes from

`SWARMFORGE_ROLE_WORKTREE` is an environment variable the launch script
itself exports (`write_role_launch_script` in `swarmforge.sh`), from the same
`WORKTREE_PATHS` array that generates the role's own `cd` line at launch —
the swarm's **own record** of where the role lives, never the hook's `$PWD`
(which is whatever the live session's persistent shell cwd happens to be at
the moment a given tool call fires — exactly the value the pin exists to stop
using). The hook is registered per role at settings-generation time
(`write_claude_settings_file` in `swarmforge.sh`), scoped with a `"matcher":
"Bash"` so no other tool is ever touched.

## The classifier — closed taxonomy, first match wins

| Class | Fires on | Heal |
|---|---|---|
| `wrong-cwd` | `fatal: not a git repository` | re-run with `cd <pinned worktree> &&` prepended |
| `wrong-surface` | `npm error code enoent`, `could not read package.json`, or `no such file or directory ... package.json` | re-run with `cd <pinned worktree>/extension &&` prepended |
| `missing-root-argv` | `usage: ... <project-root>`, `usage: ... <target-repo-path>`, or `missing required argument` | re-run with the pinned worktree appended as a trailing positional argument |
| `real-failure` | anything else | never re-run — returned exactly as it happened |

The classifier is deliberately **conservative**: anything it isn't sure about
is `real-failure`, never silently retried. The four patterns are the single
source of truth (`MISS-CLASS-PATTERNS` in `tool_miss_heal_lib.bb`) — the same
literal strings are spliced into both the Clojure `classify-miss` matcher
(used by tests) and the generated bash `grep -qiE` chain the wrapper actually
runs, so the two can never disagree about which class fired or in what order
(a `BL-897`-class hazard — a constant mirrored by hand across a language
boundary — closed here by having only one literal, not two kept "in sync").

Because the generated wrapper is an `if`/`elif` chain (not independent `if`
statements), **at most one heal ever fires**, structurally: invariant 1 ("no
classification path produces a second retry") holds by construction, not by
convention.

## What the model actually sees

Only ever one result:

- **Happy path** (command succeeds as issued): the wrapper is invisible —
  one invocation, unchanged output.
- **Healed** (a recoverable class matched and the re-run succeeded, or at
  least completed): the model receives **only** the healed attempt's output
  and exit code. The first, failed attempt's stderr is never shown — that is
  the whole point (invariant 3): nothing to apologize for, because nothing
  that looked like a miss ever reached the model.
- **Still broken after a heal**: exactly two invocations happened, the model
  sees the second (healed-attempt) failure once, and there is no third try.
- **Real failure** (no class matched): the model sees the original failure,
  once, untouched — a red test, a merge conflict, or a permission error is
  never disguised as something else.

## What it deliberately does not do

- No new queue or state file (no `control-ambulance-next.json` analogue) —
  the whole mechanism lives inside one shell invocation, nothing persisted.
- No babysitter/Operator pane restart as a "fix" for a wrong-cwd command —
  restarting a pane over a healable shell miss would be strictly worse than
  the goofiness this ticket removes.
- No prompt-text reminders ("always `cd` first") — the human's own locked
  decision: pad nothing, fix the substrate instead.
- No expansion of the allowed-command catalog (that is slice B, BL-912) and
  no Cursor-surface integration (split out on INVEST grounds — a second
  process and a second gate would make this two sittings, not one).

## Operator notes

- Nothing to configure per swarm — the hook is wired into every role's
  generated `.swarmforge/launch/<role>.claude-settings.json` automatically at
  launch, scoped to that role's own worktree.
- If a role's commands look unhealed (a wrong-cwd failure reaching the model
  as-is), check that role's settings file for the `PreToolUse` hooks block
  and that `SWARMFORGE_ROLE_WORKTREE` is actually exported in its launch
  script — an empty/missing pin is the one condition under which the hook
  intentionally no-ops.
- Babashka has no mutation/CRAP/DRY tooling wired (the language gap the
  shared engineering article names); this slice's gate is its own unit +
  property suites (`swarmforge/scripts/test/tool_miss_heal_lib_test_runner.bb`,
  `..._property_runner.bb`) plus a real-process wiring test
  (`test_tool_miss_heal_hook_wiring.sh`) and a soft Gherkin acceptance
  mutation pass on the one `Scenario Outline:` in
  `specs/features/BL-913-pinned-shell-and-one-classified-retry.feature`.

## See also

- [SwarmForge VS Code Extension — Specification](../reference/Specification.MD)
  — the BL-913 changelog entry.

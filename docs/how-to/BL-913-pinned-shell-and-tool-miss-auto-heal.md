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
| `missing-root-argv` | `usage: ... <project-root>`, `usage: ... <target-repo-path>`, or `missing required argument` | re-run with the pinned worktree appended as a trailing positional argument (via a `$__sfh_root` shell variable in the generated source — see BL-934 below, not a literal path spliced next to the command). **Only for a single simple command** — see BL-960 below; on anything else the clause is omitted and the failure returns as-is |
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

## Classified text vs. runtime text (BL-934)

Claude Code classifies the wrapper's whole **static source** for
dangerous-command checks (e.g. the `rm` working-directory gate) before
anything executes — dead `elif` branches included, even ones that never
run for the command actually issued. Through 2026-08-18 the
`missing-root-argv` heal built that dead branch as the literal original
command with the pinned worktree spliced on as an adjacent trailing
argument, so for a role running `rm -f tmp/foo.json` the classified source
literally contained `rm -f tmp/foo.json '/path/to/worktree'` — read by the
classifier as an `rm` of the working directory itself, even though that
branch never ran (a real `rm -f` doesn't fail with a missing-root usage
error, so nothing but the `wrong-cwd` class ever fires for it). Every `rm`
of a temp file therefore tripped a Yes/No "dangerous rm" prompt with no
don't-ask-again, on every role, every time — reported live by the operator
on 2026-08-19 ("Why does it keep asking?").

The fix ([BL-934](../reference/Specification.MD)) references the pinned
worktree through a `$__sfh_root` shell variable defined once at the top of
the generated wrapper instead of splicing it as literal adjacent text. The
runtime heal is unchanged — a genuine `missing-root-argv` miss still gets
the project root appended when it actually re-runs — only the **classified
representation** changed. The original command's own text is untouched by
this fix: a role's command that itself already names the pinned worktree
as an `rm` target still appears as a real command in the wrapper source
and is still classified as one (the ticket's invariant 2 — the fix must
never hide a genuine dangerous `rm` from the classifier).

## Parse-safe composition and byte-exact round-trip (BL-960)

**The hook was disabled between 2026-08-19 and this fix.** The wrapper used
to splice the original command as raw text into a command substitution —
`__sfh_out=$(<ORIGINAL> 2>&1)` — once for the first run and once per heal
clause, unescaped and never checked. Any command valid on its own but unable
to survive that embedding became a syntax error:

- **heredoc bodies were swallowed** (a heredoc-written file landed truncated
  at 776 bytes);
- **a literal `)` in an argument closed the substitution early**, producing
  `syntax error near unexpected token ')'` and then a second error from the
  wrapper's own dangling `elif` scaffolding;
- **trailing newlines were stripped**, because `$( ... )` discards them and
  the closing `printf '%s'` never put them back.

The failure mode was **silent-PARTIAL**: the shell could execute part of the
mangled command before dying, so state changes landed while an error was
reported — which makes a blind retry unsafe. Live cost: QA sat 50 minutes
with every shell call failing and an unactioned handoff queue behind it; the
coordinator and hardener panes hit the same thing. The operator disabled the
`PreToolUse` registration (`3bac496ec`) with a stated re-enable condition —
parse-check with fail-open to the untouched original. BL-960 meets that
condition and restores the registration in the same parcel.

### Three changes

1. **A parse gate.** `safe-wrapper-command` composes the wrapper and returns
   it *only* when `bash -n -c` can parse it. Anything that cannot compose —
   an unterminated heredoc swallowing the group's own closer, say — returns
   the **byte-untouched original, silently**. That is BL-913's locked
   decision 5 ("the first miss must not reach the model as a confession")
   extended to the wrapper's own composition failures: a parse gate that
   throws also fail-opens. This is the one subprocess boundary in the
   module, and it is an injectable seam for tests.

2. **Temp file plus replay, not inline splicing.** The original command is
   embedded as a multi-line subshell group on its own lines, captured whole
   to a temp file and replayed with `cat`. Heredocs, literal parens, nested
   quotes, pipelines and `;`-sequences now parse exactly as they would
   standalone, and an `exit` stays contained. The `> file 2>&1` sits
   *outside* the group, so the stream merge covers every segment — matching
   the unwrapped command run with `2>&1` — and the redirect truncates, so a
   healed re-run *replaces* the failed attempt's output rather than appending
   to it. When no heal fires, the wrapped command's exit code, combined
   output (trailing bytes included), and file side effects are byte-identical
   to the unwrapped command's.

3. **The `missing-root-argv` heal declines when it cannot aim.** Appending a
   trailing argument is well-defined only for a **single simple command**. On
   a pipeline or `;`-sequence the argument landed on the final segment rather
   than the program that produced the usage error — captured live from the
   hardener's session as `echo "---done---" "$__sfh_root"`. The check is
   deliberately quote-blind (a real parser would be needed otherwise) and
   treats any of `` | ; & < > ( ) ` ``, a newline, a backslash, or `#` as
   disqualifying; the trailing `#` is
   included because a comment silently swallows an appended argument, giving
   valid bash and an inert heal. The asymmetry decides the design: a false
   negative merely **declines** a heal and returns the failure as-is, matching
   the classifier's existing conservative posture, while a false positive
   misdirects the append — the exact live defect. When the target is
   ambiguous the clause is omitted from the wrapper entirely.

### The capture file is trap-cleaned on any catchable kill (BL-965)

BL-960's wrapper removed its `mktemp` capture file with a plain `rm -f` on
the tail path only — no `trap` — so a kill before the tail (a signal, the
Bash tool's ~120s timeout, `tmux respawn-pane -k`, swarm teardown) stranded
the file in `$TMPDIR`. Kills are routine on this host, so every Bash call in
every role shell leaked one file; 13 stranded `sfh.*` files were already
measured sitting in `$TMPDIR` before the fix.

`build-healing-wrapper-command` now installs, right after the `mktemp` line:

```
trap 'rm -f "$__sfh_out_file"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
```

The `EXIT` trap owns the `rm`; the signal traps only re-exit with the
conventional `128+N` code rather than doing the `rm` themselves. That split
is deliberate, not stylistic: a single combined `rm`-only trap on a signal
**consumes** it — bash then resumes past the interrupted foreground child
and `cat`s the file the trap just removed, changing a killed run's output
and leaving the wrapper alive after a `respawn-pane -k` instead of dying
with it. Exiting from the signal trap lets the `EXIT` trap fire on the way
out and do the one `rm`. Only an uncatchable `SIGKILL` can still leave
residue — that residue keeps the recognizable `sfh.*` name so external
cleanup can identify it — and the tail `rm` on the happy path stays
(idempotent, now redundant with the `EXIT` trap but harmless). Stock bash
3.2 safe.

Verified against the real composed wrapper, signalled as a process group
(`perl setpgrp`, since bash defers traps while a foreground child runs and
macOS ships no `setsid`): a hardening pass hand-mutated the trap block and
confirmed dropping the `EXIT` trap, and collapsing it back to a combined
rm-only trap, are both caught; the property runner's signalled-run check now
asserts the `128+signum` exit code alongside the no-residue check for every
catchable signal. Every BL-960 guarantee is unchanged — the byte-identity,
parse-gate, and one-retry-structure baselines all still hold over the
original corpus.

The `cd`-based heals (`wrong-cwd`, `wrong-surface`) re-anchor the **whole**
original through a subshell group, so for a multi-command original every
segment re-runs from the healed directory, not just the first.

Unchanged by this fix: the one-retry structure (the `if`/`elif` chain still
guarantees at most one healed re-run, structurally) and every BL-934
guarantee — the worktree never appears as a literal extra argument, and a
genuine `rm` of the worktree stays visible to the classifier.

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
- The hook is **live again as of BL-960**. It was off between 2026-08-19 and
  that fix; if you are reading a role's settings file from that window, an
  absent `PreToolUse` block is the deliberate disable, not a launch bug.
  Since the wrapper now fail-opens silently on any composition it cannot
  parse, an unhealed command is no longer evidence the hook is broken — it
  is one of the two documented no-op paths (unparseable composition, or an
  empty/missing pin).
- If you need to see what a role's commands are actually being rewritten
  into, read the generated wrapper rather than inferring it: the pinned
  worktree appears as `$__sfh_root`, and every attempt's combined output is
  captured to a temp file and replayed with `cat`.

## See also

- [SwarmForge VS Code Extension — Specification](../reference/Specification.MD)
  — the BL-913 and BL-934 changelog entries.

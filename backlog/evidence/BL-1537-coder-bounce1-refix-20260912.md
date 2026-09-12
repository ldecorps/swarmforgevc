# BL-1537 — coder bounce-1 refix, 2026-09-12

Fixes D1 from `backlog/evidence/BL-1537-architect-20260912-2.md`
(bounce_count: 1, commit e300226fae).

## D1 fix

`swarmforge/scripts/promote_and_route_next.sh`'s `notify_specifier_freshness_hold`
mktemp'd its draft under `$ROOT/tmp/` but only removed it with a plain
`rm -f "$draft"` after the send attempt — no `trap ... EXIT` guarded the
window between the mktemp and that `rm -f`, unlike the other three shell
senders this ticket touches (`route_backlog_to_coder.sh`,
`mailbox_note_to_role.sh`, `inject_note_to_role.sh`), which each wrap
their draft in `trap 'rm -f "$DRAFT"' EXIT` immediately after the mktemp.
A SIGTERM/SIGINT delivered in that window left the draft under `$ROOT/tmp/`
forever, violating declared invariant 2's "signalled" exit path.

Fix, matching the architect's remediation pointer exactly:

```sh
draft="$(mktemp "$ROOT/tmp/swarmforge-freshness-hold.XXXXXX.handoff")"
trap 'rm -f "$draft"' EXIT
```

One addition beyond the remediation pointer, required by this function's
own shape and not present in the other three senders: `draft` is a
function-local variable (`local draft`), not a top-level script variable.
Under this script's `set -euo pipefail`, an EXIT trap that survives past
the function's return references `$draft` after its local scope has
ended, which errors as an unbound variable when the trap fires at the
script's own `exit 2` a few lines later — this reproduced immediately
when first tested (`promote_and_route_next.sh: line 1: draft: unbound
variable`, swallowing the freshness-hold exit code). Fixed by resetting
the trap (`trap - EXIT`) right after the function's own `rm -f "$draft"`,
so the trap only exists to catch an interruption of the function's own
window and never lingers into the caller's later exit.

## TDD

Added scenario 05 to
`swarmforge/scripts/test/test_production_sender_drafts_under_root.sh`:
invokes `promote_and_route_next.sh` through a symlink in a scratch
directory (so `SCRIPT_DIR` resolves there, letting a stub
`swarm_handoff.sh` — `sleep 10` — replace the real sender without
disturbing resolution of the script's other `$SCRIPT_DIR/*.bb` siblings,
which are symlinked in alongside it), waits for the freshness-hold draft
to appear under `$ROOT/tmp/`, sends SIGTERM to the script's own PID (an
`exec` inside the backgrounded subshell makes the backgrounded PID the
actual trap-holding process, not a subshell wrapper), and asserts the
draft is gone afterward.

Verified non-vacuous per the coder's TDD obligation: reverted only the
production fix (`git stash` on `promote_and_route_next.sh` alone,
scenario 05 unchanged) and re-ran the test — it failed exactly as
expected (`draft ... survived SIGTERM - notify_specifier_freshness_hold
has no trap guarding its draft`), then restored the fix and re-ran green.

## Checks run

- `swarmforge/scripts/test/test_production_sender_drafts_under_root.sh`:
  5/5 PASS (the four original scenarios unaffected + new scenario 05).
- Full acceptance suite for the ticket's feature file
  (`node specs/pipeline/cli.js specs/features/BL-1537-*.feature`): 9/9
  scenarios PASS, no regression from the architect's last-recorded run.
- Related unit tests (`closingCeremonyRun`, `closingCeremonyRunCli`,
  `tracerBulletLauncher`, `nightClosingCeremonyRun`, `draftPathUnder`):
  28/28 PASS — untouched by this shell-only fix, run to confirm no
  cross-lane regression.
- `bash -n` on both modified shell files: clean.
- `git status` clean after the full run — no draft or scratch artifact
  became tracked.

Not touched: the TS senders, the other three shell senders, the feature
file, and the two doc narratives (documenter's item 4) — none of those
are implicated by D1.

By coder.

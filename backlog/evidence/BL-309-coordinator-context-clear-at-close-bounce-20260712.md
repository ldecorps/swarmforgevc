# BL-309 bounce evidence — 20260712

1. **Failing command** (repro, run from repo root in the QA worktree):
```
ROOT="$(mktemp -d)"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process"
touch "$ROOT/fake.sock"; echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'id: BL-401\nstatus: done\n' > "$ROOT/backlog/done/BL-401.yaml"
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/$(date -u +%Y-%m-%d).md"
FAKE_BIN="$ROOT/bin"; mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "ROOT_PLACEHOLDER/tmux-calls.log"
exit 0
TMUX
sed -i "s#ROOT_PLACEHOLDER#$ROOT#" "$FAKE_BIN/tmux"; chmod +x "$FAKE_BIN/tmux"
env -u RESEND_API_KEY SWARMFORGE_MAILBOX_ONLY=1 PATH="$FAKE_BIN:$PATH" bb swarmforge/scripts/handoffd.bb "$ROOT" &
sleep 3
touch "$ROOT/.swarmforge/daemon/stop"; wait
grep closing-context-clear "$ROOT/.swarmforge/daemon/handoffd.log"
cat "$ROOT/.swarmforge/coordinator-context-clear.json"
```

2. **Commit hash tested:** `7618b4dbe8` (BL-309: clear the coordinator's context
   at a safe boundary after each ticket close).

3. **First error excerpt** (actual output):
```
2026-07-12T14:54:39.796833602Z closing-context-clear-skip-mailbox-only
2026-07-12T14:54:39.796958322Z closing-context-clear-fired BL-401
=== tmux call log ===
-S /tmp/tmp.shtLos1Cqm/fake.sock capture-pane -p -t swarmforge-coordinator -S -50
=== marker file ===
{"last_cleared_ticket_id":"BL-401","cleared_at_ms":1783868079796}
```
No `/clear` or startup-re-read text was ever sent to the coordinator's tmux
session (the only tmux call captured is an unrelated `capture-pane` liveness
check) — yet `record-clear!` still fires and durably marks `BL-401` as
cleared.

4. **Failure class:** `behavior`.

5. **Expected vs observed:** Expected: `closing-context-clear-sweep!` in
   `handoffd.bb` never records a ticket as cleared (`record-clear!`) unless
   the `/clear` + startup-re-read were actually injected into the
   coordinator's pane. Observed: when `SWARMFORGE_MAILBOX_ONLY=1` (or
   `SWARMFORGE_SKIP_TMUX_INJECT=1`) is set — a real, documented,
   operator-invocable mode that `swarmforge.sh` wires straight into the
   persistent `handoffd.bb` daemon loop (`start_handoff_daemon.sh` backgrounds
   `handoffd.bb` with no `--poll-once`, so the env var is inherited for the
   daemon's entire lifetime, not a one-shot call) — `:inject-clear!` and
   `:inject-startup-reread!` both silently no-op (guarded by
   `tmux-inject-disabled?`), but `:record-clear!` is unconditional and still
   writes the marker. Once mailbox-only mode ends, that ticket's close can
   never trigger a real clear again (`new-close?` requires the closed-ticket-id
   to differ from `last-cleared-ticket-id`, which is now permanently
   poisoned to a close that was never actually acted on) — silently and
   permanently defeating BL-309's whole purpose for any close that happens to
   sweep during a mailbox-only session. Fix direction: gate `record-clear!`
   on the injection actually having happened (e.g. skip the whole sweep, not
   just the tmux calls, when `tmux-inject-disabled?`), mirroring how
   `briefing-generation-sweep!`'s own `:notify!` skip never writes a
   persistent "already notified" marker.

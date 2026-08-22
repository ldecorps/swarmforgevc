#!/usr/bin/env bash
# BL-819 architect bounce (backlog/evidence/BL-819-architect-bounce-20260807.md,
# D1): the two .bb shell-out call sites that fire the lean ledger record CLI
# (done_with_current_task.bb's handoff-completion point, commit_integrity_cli.bb's
# close-commit point) had zero wiring coverage. Per engineering-detailed.prompt's
# wiring-test rule, drive each real subprocess through all three of its
# documented branches: happy path (CLI exits 0), non-zero exit (warn to
# stderr, surrounding operation still succeeds), and CLI absent (silent skip,
# no warning) - never only the exit-0 happy path.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMMIT_CLI="$SCRIPT_DIR/../commit_integrity_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

fake_cli_happy() {
  # $1 = CLI path, $2 = marker file path to prove the CLI was actually invoked
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<EOF
require('fs').writeFileSync('$2', 'invoked\n');
process.exit(0);
EOF
}

fake_cli_nonzero() {
  # $1 = CLI path, $2 = marker file path
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<EOF
require('fs').writeFileSync('$2', 'invoked\n');
process.stderr.write('lean-ledger-compose-boom: bad instrument data\n');
process.exit(1);
EOF
}

# ============================================================================
# Part A: done_with_current_task.bb's handoff-completion call site
# ============================================================================

mk_done_fixture() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"

  git -C "$root" init -q
  git -C "$root" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

  local wt="$root/.worktrees/coder"
  git -C "$root" worktree add -q -b coderwt "$wt" >/dev/null

  mkdir -p "$root/.swarmforge/launch"
  local sock="$root/fake.sock"
  touch "$sock"
  echo "$sock" > "$root/.swarmforge/tmux-socket"
  echo "coder launch" > "$root/.swarmforge/launch/coder.sh"
  # idle-clear token 'off': avoids exercising real tmux respawn-pane, which
  # is BL-089's own concern, not this call site's.
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\toff\n' "$wt" \
    > "$root/.swarmforge/roles.tsv"

  local fake_bin="$root/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
  chmod +x "$fake_bin/tmux"

  mkdir -p "$wt/.swarmforge/handoffs/inbox/new" \
           "$wt/.swarmforge/handoffs/inbox/in_process" \
           "$wt/.swarmforge/handoffs/inbox/completed"

  local task_commit
  task_commit="$(git -C "$root" rev-parse --short=10 HEAD)"
  printf 'id: item1\nfrom: specifier\nto: coder\npriority: 50\ntype: git_handoff\ntask: BL-819-lean-ledger-wiring-test\ncommit: %s\n\npayload\n' \
    "$task_commit" > "$wt/.swarmforge/handoffs/inbox/in_process/50_item1.handoff"

  # done_with_current_task.bb's *file* (hence its script-dir) drives its own
  # `run-ready!` exec of ready_for_next_task.sh — a REAL absolute path, not
  # PATH-searched, so it cannot be faked via $fake_bin the way tmux is. If
  # we invoke the real script directly, script-dir resolves to the real
  # swarmforge/scripts/ regardless of our fixture cwd, and
  # ready_for_next_task.sh's own `cd "$SCRIPT_DIR"` then walks straight back
  # into the REAL live mailbox — a genuine incident hit once while drafting
  # this test (recorded in backlog/evidence for this ticket). Copy the real
  # script chain into the fixture so *file* resolves inside it, and stub the
  # one downstream dependency (ready_for_next_task.sh) that is unrelated to
  # the lean-ledger wiring under test here and already covered in isolation
  # by test_idle_clear_respawn.sh (BL-089) — same "fake the external
  # dependency at the process boundary" posture as $fake_bin/tmux above.
  local fixture_scripts="$root/scripts"
  mkdir -p "$fixture_scripts"
  cp "$SCRIPT_DIR/../done_with_current_task.bb" "$fixture_scripts/"
  cp "$SCRIPT_DIR/../handoff_lib.bb" "$fixture_scripts/"
  cp "$SCRIPT_DIR/../pipeline_stage_lib.bb" "$fixture_scripts/"
  cp "$SCRIPT_DIR/../ambulance_lib.bb" "$fixture_scripts/"
  cp "$SCRIPT_DIR/../mono_router_lib.bb" "$fixture_scripts/"
  cat > "$fixture_scripts/ready_for_next_task.sh" <<'STUB'
#!/usr/bin/env bash
echo NO_TASK
STUB
  chmod +x "$fixture_scripts/ready_for_next_task.sh"

  # Set caller-visible globals directly rather than returning a
  # newline-joined tuple over stdout: `read var1 var2 <<<"$(fn)"` only ever
  # consumes fn's FIRST line (read stops at the first real newline; it does
  # not keep reading further lines to fill remaining variables), so a
  # multi-value stdout return silently drops every field after the first.
  ROOT="$root"
  WT="$wt"
  FAKE_BIN="$fake_bin"
  DONE_TASK_COPY="$fixture_scripts/done_with_current_task.bb"
}

run_done_with_current() {
  local wt="$1" fake_bin="$2" done_task_copy="$3"
  (cd "$wt" && PATH="$fake_bin:$PATH" SWARMFORGE_ROLE=coder bb "$done_task_copy" 2>&1)
}

# ── A1: happy path — CLI is really invoked, exits 0, no warning ────────────
mk_done_fixture
MARKER="$ROOT/marker-a1"
fake_cli_happy "$ROOT/extension/out/tools/lean-ledger-record.js" "$MARKER"
OUT="$(run_done_with_current "$WT" "$FAKE_BIN" "$DONE_TASK_COPY")" || fail "A1: done_with_current_task.bb exited non-zero: $OUT"
echo "$OUT" | grep -q '^COMPLETED:' || fail "A1: expected COMPLETED, got: $OUT"
[[ -f "$MARKER" ]] || fail "A1: expected the fake lean-ledger-record CLI to have been invoked"
echo "$OUT" | grep -q "lean-ledger-record-warn" && fail "A1: unexpected warn on the happy path, got: $OUT"
pass "A1: done_with_current_task.bb invokes the lean-ledger CLI on completion, no warning on exit 0"

# ── A2: non-zero exit — warns to stderr, completion still succeeds ─────────
mk_done_fixture
MARKER="$ROOT/marker-a2"
fake_cli_nonzero "$ROOT/extension/out/tools/lean-ledger-record.js" "$MARKER"
OUT="$(run_done_with_current "$WT" "$FAKE_BIN" "$DONE_TASK_COPY")" || fail "A2: done_with_current_task.bb exited non-zero: $OUT"
echo "$OUT" | grep -q '^COMPLETED:' || fail "A2: expected COMPLETED despite ledger failure, got: $OUT"
[[ -f "$MARKER" ]] || fail "A2: expected the fake lean-ledger-record CLI to have been invoked"
echo "$OUT" | grep -q "lean-ledger-record-warn: BL-819 " || fail "A2: expected a lean-ledger-record-warn line naming BL-819, got: $OUT"
echo "$OUT" | grep -q "lean-ledger-compose-boom" || fail "A2: expected the CLI's stderr text surfaced in the warn, got: $OUT"
pass "A2: done_with_current_task.bb warns on non-zero CLI exit but completion still succeeds"

# ── A3: CLI absent — silent skip, no warning at all ─────────────────────────
mk_done_fixture
OUT="$(run_done_with_current "$WT" "$FAKE_BIN" "$DONE_TASK_COPY")" || fail "A3: done_with_current_task.bb exited non-zero: $OUT"
echo "$OUT" | grep -q '^COMPLETED:' || fail "A3: expected COMPLETED, got: $OUT"
echo "$OUT" | grep -qi "lean-ledger" && fail "A3: expected total silence when the CLI is absent, got: $OUT"
pass "A3: done_with_current_task.bb skips silently when lean-ledger-record.js is absent"

# ============================================================================
# Part B: commit_integrity_cli.bb's close-commit call site
# ============================================================================

mk_close_fixture() {
  local root ticket
  root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  ticket="$1"

  git -C "$root" init -q
  git -C "$root" config user.email test@test
  git -C "$root" config user.name test
  git -C "$root" commit -q --allow-empty -m init
  mkdir -p "$root/.swarmforge/handoffs/coordinator/inbox/new" \
           "$root/backlog/active" "$root/backlog/done"
  printf "coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n" "$root" \
    > "$root/.swarmforge/roles.tsv"

  printf 'id: %s\ntitle: x\nstatus: active\n' "$ticket" > "$root/backlog/active/$ticket-slug.yaml"
  git -C "$root" add "backlog/active/$ticket-slug.yaml"
  git -C "$root" commit -q -m "seed active ticket"
  printf 'id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: git_handoff\ntask: %s-slug\ncommit: a1b2c3d4e5\n\nbody\n' "$ticket" \
    > "$root/.swarmforge/handoffs/coordinator/inbox/new/00_qa.handoff"
  git -C "$root" mv "backlog/active/$ticket-slug.yaml" "backlog/done/$ticket-slug.yaml"

  echo "$root"
}

run_close_commit() {
  local root="$1" ticket="$2"
  bb "$COMMIT_CLI" "$root" \
    --message "Close $ticket: move to done" \
    --path "backlog/active/$ticket-slug.yaml" \
    --path "backlog/done/$ticket-slug.yaml" 2>&1
}

# ── B1: happy path — CLI is really invoked, exits 0, no warning ────────────
ROOT="$(mk_close_fixture BL-819)"
MARKER="$ROOT/marker-b1"
fake_cli_happy "$ROOT/extension/out/tools/lean-ledger-record.js" "$MARKER"
OUT="$(run_close_commit "$ROOT" BL-819)" || fail "B1: commit_integrity_cli.bb exited non-zero: $OUT"
echo "$OUT" | grep -q '"success":true' || fail "B1: expected success:true, got: $OUT"
[[ -f "$MARKER" ]] || fail "B1: expected the fake lean-ledger-record CLI to have been invoked"
echo "$OUT" | grep -q "lean-ledger-record-warn" && fail "B1: unexpected warn on the happy path, got: $OUT"
pass "B1: commit_integrity_cli.bb invokes the lean-ledger CLI on close, no warning on exit 0"

# ── B2: non-zero exit — warns, close commit still succeeds ─────────────────
ROOT="$(mk_close_fixture BL-819)"
MARKER="$ROOT/marker-b2"
fake_cli_nonzero "$ROOT/extension/out/tools/lean-ledger-record.js" "$MARKER"
OUT="$(run_close_commit "$ROOT" BL-819)" || fail "B2: commit_integrity_cli.bb exited non-zero: $OUT"
echo "$OUT" | grep -q '"success":true' || fail "B2: expected success:true despite ledger failure, got: $OUT"
[[ -f "$MARKER" ]] || fail "B2: expected the fake lean-ledger-record CLI to have been invoked"
echo "$OUT" | grep -q "lean-ledger-record-warn: BL-819 " || fail "B2: expected a lean-ledger-record-warn line naming BL-819, got: $OUT"
echo "$OUT" | grep -q "lean-ledger-compose-boom" || fail "B2: expected the CLI's stderr text surfaced in the warn, got: $OUT"
pass "B2: commit_integrity_cli.bb warns on non-zero CLI exit but the close commit still succeeds"

# ── B3: CLI absent — silent skip, no warning at all ─────────────────────────
ROOT="$(mk_close_fixture BL-819)"
OUT="$(run_close_commit "$ROOT" BL-819)" || fail "B3: commit_integrity_cli.bb exited non-zero: $OUT"
echo "$OUT" | grep -q '"success":true' || fail "B3: expected success:true, got: $OUT"
echo "$OUT" | grep -qi "lean-ledger" && fail "B3: expected total silence when the CLI is absent, got: $OUT"
pass "B3: commit_integrity_cli.bb skips silently when lean-ledger-record.js is absent"

echo "ALL PASS: lean ledger .bb wiring (done_with_current_task.bb + commit_integrity_cli.bb)"

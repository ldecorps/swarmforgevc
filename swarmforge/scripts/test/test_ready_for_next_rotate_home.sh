#!/usr/bin/env bash
# BL-550: mono-router non-home resident rotates home on empty mailbox.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"
READY_BATCH="$SCRIPT_DIR/../ready_for_next_batch.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ready_for_next.sh (and its .sh siblings) `cd` into their OWN directory
# (dirname "$0") before invoking bb, so that relative load-file paths
# resolve regardless of the caller's cwd - correct in production, where
# every worktree carries its own hot-synced swarmforge/scripts/ copy. A
# fixture worktree has no such copy: invoking the real repo's
# ready_for_next.sh by absolute path would `cd` OUT of the fixture and INTO
# this real checkout, so every git-rev-parse-based root lookup downstream
# (target-root, project-root) would resolve to the real repo, not the
# fixture - silently testing live swarm state instead of the fixture. Give
# each worktree its own copy so `cd "$(dirname "$0")"` stays inside it.
install_scripts() {
  local wt="$1"
  mkdir -p "$wt/swarmforge/scripts"
  cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$wt/swarmforge/scripts/"
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT/.swarmforge" "$ROOT/swarmforge/packs" "$ROOT/backlog/active"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'EOF'
config rotation router
config rotation_home coder
EOF
printf 'active_backlog_max_depth_conf_path\t%s/swarmforge/swarmforge.conf\n' "$ROOT" \
  > "$ROOT/.swarmforge/swarm-identity"

setup_role() {
  local role="$1"
  local wt="$ROOT/.worktrees/$role"
  git -C "$ROOT" worktree add -q -b "$role" "$wt"
  mkdir -p "$wt/.swarmforge/handoffs/inbox/new" \
           "$wt/.swarmforge/handoffs/inbox/in_process" \
           "$wt/.swarmforge/handoffs/inbox/completed" \
           "$wt/.swarmforge/handoffs/inbox/abandoned"
  printf '%s\n' "$wt"
}

CODER_WT="$(setup_role coder)"
DOC_WT="$(setup_role documenter)"
CLEAN_WT="$(setup_role cleaner)"
HARD_WT="$(setup_role hardener)"

printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$DOC_WT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEAN_WT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'hardener\thardener\t%s\tswarmforge-hardener\tHardener\tclaude\tbatch\n' "$HARD_WT" >> "$ROOT/.swarmforge/roles.tsv"

queue_note() {
  local wt="$1" role="$2" name="$3"
  local dir="$wt/.swarmforge/handoffs/inbox/in_process"
  printf 'id: %s\nfrom: coordinator\nto: %s\npriority: 10\ntype: note\nmessage: work\n\nbody\n' \
    "$name" "$role" > "$dir/10_${name}.handoff"
}

queue_new() {
  local wt="$1" role="$2" name="$3"
  local dir="$wt/.swarmforge/handoffs/inbox/new"
  printf 'id: %s\nfrom: coordinator\nto: %s\npriority: 10\ntype: note\nmessage: work\n\nbody\n' \
    "$name" "$role" > "$dir/10_${name}.handoff"
}

# 01: non-home role, empty mailbox -> ROTATE_HOME
OUT="$(cd "$DOC_WT" && SWARMFORGE_ROLE=documenter bb "$READY_TASK")"
echo "$OUT" | head -n1 | grep -q '^ROTATE_HOME$' || fail "01: expected ROTATE_HOME, got: $OUT"
echo "$OUT" | grep -q '^HOME_ROLE: coder$' || fail "01: expected HOME_ROLE: coder, got: $OUT"
pass "01: non-home role with empty mailbox prints ROTATE_HOME"

# 02: home role, empty mailbox -> NO_TASK (never rotates to self)
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"
echo "$OUT" | grep -q '^NO_TASK$' || fail "02: expected NO_TASK for home role, got: $OUT"
echo "$OUT" | grep -q '^ROTATE_HOME$' && fail "02: home role must not ROTATE_HOME"
pass "02: home role with empty mailbox prints NO_TASK"

# 03: non-home role with in_process work -> TASK, no ROTATE_HOME
queue_note "$CLEAN_WT" cleaner claim1
OUT="$(cd "$CLEAN_WT" && SWARMFORGE_ROLE=cleaner bb "$READY_TASK")"
echo "$OUT" | grep -q '^TASK:' || fail "03: expected TASK with in_process work, got: $OUT"
echo "$OUT" | grep -q '^ROTATE_HOME$' && fail "03: must not ROTATE_HOME while in_process holds work"
pass "03: non-home role with in_process work prints TASK"

# 04: ready_for_next.sh wrapper execs rotate_to_role on ROTATE_HOME
FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
ROTATE_LOG="$ROOT/rotate.log"
: > "$ROTATE_LOG"
cat > "$FAKE_BIN/rotate_to_role.sh" <<ROT
#!/usr/bin/env bash
echo "rotate \$*" >> "$ROTATE_LOG"
exit 0
ROT
chmod +x "$FAKE_BIN/rotate_to_role.sh"
export ROTATE_LOG
install_scripts "$DOC_WT"
OUT="$(cd "$DOC_WT" && SWARMFORGE_ROTATE_TO_ROLE="$FAKE_BIN/rotate_to_role.sh" SWARMFORGE_ROLE=documenter bash "$DOC_WT/swarmforge/scripts/ready_for_next.sh")"
echo "$OUT" | head -n1 | grep -q '^ROTATE_HOME$' || fail "04: wrapper expected ROTATE_HOME, got: $OUT"
grep -q 'rotate coder' "$ROTATE_LOG" || fail "04: wrapper must call rotate_to_role.sh coder, log=$(cat "$ROTATE_LOG")"
pass "04: ready_for_next.sh hands off ROTATE_HOME to rotate_to_role.sh"

# 05: batch-mode role (hardener), empty mailbox -> ROTATE_HOME via
# ready_for_next_batch.bb directly. The batch dispatcher wires the exact
# same report-no-task-or-rotate! shape as the task dispatcher, but nothing
# exercised it until now - a task-only test would miss a batch-side typo
# (e.g. a bad load-file path or a wrong mono-router-lib call).
OUT="$(cd "$HARD_WT" && SWARMFORGE_ROLE=hardener bb "$READY_BATCH")"
echo "$OUT" | head -n1 | grep -q '^ROTATE_HOME$' || fail "05: expected ROTATE_HOME for batch role, got: $OUT"
echo "$OUT" | grep -q '^HOME_ROLE: coder$' || fail "05: expected HOME_ROLE: coder, got: $OUT"
pass "05: batch-mode non-home role with empty mailbox prints ROTATE_HOME"

# 06: batch-mode role with dequeueable new work -> BATCH, no ROTATE_HOME
queue_new "$HARD_WT" hardener claim2
OUT="$(cd "$HARD_WT" && SWARMFORGE_ROLE=hardener bb "$READY_BATCH")"
echo "$OUT" | grep -q '^BATCH:' || fail "06: expected BATCH with dequeueable new work, got: $OUT"
echo "$OUT" | grep -q '^ROTATE_HOME$' && fail "06: must not ROTATE_HOME while new/ holds dequeueable batch work"
pass "06: batch-mode non-home role with dequeueable new work prints BATCH"

# 07: ready_for_next.sh wrapper dispatches a batch-mode role's ROTATE_HOME
# too - proves the dispatcher's task/batch routing (dispatch_lib.bb) doesn't
# drop the ROTATE_HOME signal on the batch leg specifically.
: > "$ROTATE_LOG"
CLEAN2_WT="$ROOT/.worktrees/cleaner2"
git -C "$ROOT" worktree add -q -b cleaner2 "$CLEAN2_WT"
mkdir -p "$CLEAN2_WT/.swarmforge/handoffs/inbox/new" \
         "$CLEAN2_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CLEAN2_WT/.swarmforge/handoffs/inbox/completed" \
         "$CLEAN2_WT/.swarmforge/handoffs/inbox/abandoned"
printf 'cleaner2\tcleaner2\t%s\tswarmforge-cleaner2\tCleaner2\tclaude\tbatch\n' "$CLEAN2_WT" >> "$ROOT/.swarmforge/roles.tsv"
install_scripts "$CLEAN2_WT"
OUT="$(cd "$CLEAN2_WT" && SWARMFORGE_ROTATE_TO_ROLE="$FAKE_BIN/rotate_to_role.sh" SWARMFORGE_ROLE=cleaner2 bash "$CLEAN2_WT/swarmforge/scripts/ready_for_next.sh")"
echo "$OUT" | head -n1 | grep -q '^ROTATE_HOME$' || fail "07: batch wrapper expected ROTATE_HOME, got: $OUT"
grep -q 'rotate coder' "$ROTATE_LOG" || fail "07: batch wrapper must call rotate_to_role.sh coder, log=$(cat "$ROTATE_LOG")"
pass "07: ready_for_next.sh hands off a batch role's ROTATE_HOME to rotate_to_role.sh"

echo "test_ready_for_next_rotate_home: ALL CHECKS PASSED"

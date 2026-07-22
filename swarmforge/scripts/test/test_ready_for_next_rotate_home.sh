#!/usr/bin/env bash
# BL-550: mono-router non-home resident rotates home on empty mailbox.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
READY="$SCRIPT_DIR/../ready_for_next.sh"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

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

printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$DOC_WT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEAN_WT" >> "$ROOT/.swarmforge/roles.tsv"

queue_note() {
  local wt="$1" role="$2" name="$3"
  local dir="$wt/.swarmforge/handoffs/inbox/in_process"
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
OUT="$(cd "$DOC_WT" && SWARMFORGE_ROTATE_TO_ROLE="$FAKE_BIN/rotate_to_role.sh" SWARMFORGE_ROLE=documenter bash "$READY")"
echo "$OUT" | head -n1 | grep -q '^ROTATE_HOME$' || fail "04: wrapper expected ROTATE_HOME, got: $OUT"
grep -q 'rotate coder' "$ROTATE_LOG" || fail "04: wrapper must call rotate_to_role.sh coder, log=$(cat "$ROTATE_LOG")"
pass "04: ready_for_next.sh hands off ROTATE_HOME to rotate_to_role.sh"

echo "test_ready_for_next_rotate_home: ALL CHECKS PASSED"

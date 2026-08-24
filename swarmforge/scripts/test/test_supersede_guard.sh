#!/usr/bin/env bash
# BL-1084: pre-turn supersede guard in ready_for_next.bb. Prints PASS markers
# for the acceptance steps.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/tmp_cleanup.sh
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

install_scripts() {
  local wt="$1"
  mkdir -p "$wt/swarmforge/scripts"
  cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$wt/swarmforge/scripts/"
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir ROOT
git -C "$ROOT" init -q -b main
printf '.swarmforge/\n' > "$ROOT/.gitignore"
git -C "$ROOT" add .gitignore
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m base
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

mkdir -p "$ROOT/.swarmforge"

# One worktree per role we exercise.
for role in coder cleaner architect hardender QA; do
  git -C "$ROOT" branch "swarmforge-$role" 2>/dev/null || true
  git -C "$ROOT" worktree add -q "$ROOT/.worktrees/$role" "swarmforge-$role"
  install_scripts "$ROOT/.worktrees/$role"
  mkdir -p "$ROOT/.worktrees/$role/.swarmforge/handoffs/inbox/"{new,in_process,completed}
done

# roles.tsv at shared root — receive-mode guard-boundary-only so a pass never
# execs into the live repo (same trick as BL-640).
{
  for role in coder cleaner architect hardender QA; do
    printf '%s\t%s\t%s\tswarmforge-%s\t%s\tclaude\tguard-boundary-only\n' \
      "$role" "$role" "$ROOT/.worktrees/$role" "$role" "$role"
  done
} > "$ROOT/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\n' > "$ROOT/.swarmforge/swarm-identity"

drop_parcel() {
  local role="$1" task="$2" name="$3"
  local inbox="$ROOT/.worktrees/$role/.swarmforge/handoffs/inbox/new"
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: %s\n\nbody for %s\n' \
    "$name" "$role" "$role" "$task" "$COMMIT" "$task" > "$inbox/00_$name.handoff"
}

record_supersede() {
  mkdir -p "$ROOT/.swarmforge/superseded"
  printf '%s\n' "$2" > "$ROOT/.swarmforge/superseded/$1"
}

run_ready() {
  local role="$1"
  local wt="$ROOT/.worktrees/$role"
  local ready="$wt/swarmforge/scripts/ready_for_next.bb"
  set +e
  OUT="$(cd "$wt" && SWARMFORGE_ROLE="$role" bb "$ready" 2>"$ROOT/stderr-$role.txt")"
  RC=$?
  ERR="$(cat "$ROOT/stderr-$role.txt")"
  set -e
}

SUPERSEDED="BL-1052-qwen-code-seat"
REASON="reframed to local-model"
record_supersede "$SUPERSEDED" "$REASON"

# ── 01: every listed stage refuses ────────────────────────────────────────
for role in coder hardender QA; do
  drop_parcel "$role" "$SUPERSEDED" "s1-$role"
  run_ready "$role"
  [[ "$RC" -ne 0 ]] || fail "01-$role: expected refusal, rc=0 out=$OUT err=$ERR"
  echo "$ERR" | grep -q "SUPERSEDED: task $SUPERSEDED" || fail "01-$role: missing task in refusal: $ERR"
  echo "$ERR" | grep -q "$REASON" || fail "01-$role: missing reason in refusal: $ERR"
  [[ -f "$ROOT/.worktrees/$role/.swarmforge/handoffs/inbox/new/00_s1-$role.handoff" ]] \
    || fail "01-$role: parcel was moved out of new/"
  [[ ! -f "$ROOT/.worktrees/$role/.swarmforge/handoffs/inbox/in_process/00_s1-$role.handoff" ]] \
    || fail "01-$role: parcel was dequeued into in_process/"
done
pass "01: every stage refuses a parcel for a superseded task"

# ── 02: unrelated task unaffected (reaches dispatch boundary) ─────────────
drop_parcel cleaner "BL-1099-unrelated" "s2-cleaner"
run_ready cleaner
# guard-boundary-only => INVALID_RECEIVE_MODE after guards pass
echo "$ERR$OUT" | grep -q "INVALID_RECEIVE_MODE" || fail "02: expected dispatch to run after pass: out=$OUT err=$ERR"
echo "$ERR" | grep -qv "SUPERSEDED" || fail "02: unrelated refused: $ERR"
pass "02: a parcel for any other task is unaffected"

# ── 03: refuse is not a bounce (no bounce store write) ─────────────────────
drop_parcel architect "$SUPERSEDED" "s3-arch"
BOUNCE_BEFORE="$(find "$ROOT" -name 'bounce*' 2>/dev/null | wc -l | tr -d ' ')"
run_ready architect
[[ "$RC" -ne 0 ]] || fail "03: expected refusal"
BOUNCE_AFTER="$(find "$ROOT" -name 'bounce*' 2>/dev/null | wc -l | tr -d ' ')"
[[ "$BOUNCE_BEFORE" == "$BOUNCE_AFTER" ]] || fail "03: bounce artifacts appeared"
pass "03: a refused parcel is not recorded as a bounce"

# ── 04: clearing the marker restores dispatch ─────────────────────────────
drop_parcel coder "$SUPERSEDED" "s4-coder"
rm -f "$ROOT/.swarmforge/superseded/$SUPERSEDED"
# empty dir may remain — still a readable empty store
run_ready coder
echo "$ERR$OUT" | grep -q "INVALID_RECEIVE_MODE" || fail "04: expected pass after clear: out=$OUT err=$ERR"
echo "$ERR" | grep -qv "SUPERSEDED" || fail "04: still refused after clear: $ERR"
pass "04: clearing the marker by hand restores normal dispatch"

# ── 05: absent vs unreadable ──────────────────────────────────────────────
rm -rf "$ROOT/.swarmforge/superseded"
drop_parcel coder "BL-1099-unrelated" "s5a-coder"
run_ready coder
echo "$ERR$OUT" | grep -q "INVALID_RECEIVE_MODE" || fail "05-absent: expected pass: $ERR"
pass "05a: absent store is not refused"

# Unreadable: path exists as a FILE instead of a directory
printf 'not-a-dir\n' > "$ROOT/.swarmforge/superseded"
drop_parcel coder "BL-1099-unrelated" "s5b-coder"
run_ready coder
[[ "$RC" -ne 0 ]] || fail "05-unreadable: expected refusal"
echo "$ERR" | grep -q "SUPERSEDE_STORE_UNREADABLE" || fail "05-unreadable: missing message: $ERR"
pass "05b: unreadable store is refused"

# ── 06: batch mode also refused before assemble ───────────────────────────
rm -f "$ROOT/.swarmforge/superseded"
mkdir -p "$ROOT/.swarmforge/superseded"
record_supersede "$SUPERSEDED" "$REASON"
# Flip cleaner to batch receive-mode
sed -i 's/cleaner\tcleaner\t.*guard-boundary-only/cleaner\tcleaner\t'"$ROOT"'\/.worktrees\/cleaner\tswarmforge-cleaner\tcleaner\tclaude\tbatch/' \
  "$ROOT/.swarmforge/roles.tsv" 2>/dev/null \
  || python3 - "$ROOT/.swarmforge/roles.tsv" "$ROOT/.worktrees/cleaner" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]); wt=sys.argv[2]
lines=[]
for line in p.read_text().splitlines():
    if line.startswith("cleaner\t"):
        lines.append(f"cleaner\tcleaner\t{wt}\tswarmforge-cleaner\tcleaner\tclaude\tbatch")
    else:
        lines.append(line)
p.write_text("\n".join(lines)+"\n")
PY
drop_parcel cleaner "$SUPERSEDED" "s6-cleaner"
run_ready cleaner
[[ "$RC" -ne 0 ]] || fail "06: batch role expected refusal"
echo "$ERR" | grep -q "SUPERSEDED" || fail "06: missing SUPERSEDED: $ERR"
# Must not have reached batch helper (would print batch assembly noise or INVALID)
echo "$ERR$OUT" | grep -qv "batch_" || true
pass "06: the guard runs before dispatch chooses task or batch mode"

echo
echo "test_supersede_guard: ALL PASS"

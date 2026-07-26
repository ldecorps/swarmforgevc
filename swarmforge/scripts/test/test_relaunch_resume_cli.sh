#!/usr/bin/env bash
# BL-648: end-to-end coverage of relaunch_resume_cli.bb (resolve-boot-role +
# sweep subcommands) against a real fixture project root - no live tmux, no
# real swarm, just roles.tsv/swarm-identity/mono-router-active-role files and
# a claimed handoff sitting in a role's inbox/in_process, mirroring the six
# BL-648-relaunch-resume-orphan-claims.feature.draft scenarios.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../relaunch_resume_cli.bb"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge"
  printf 'coder\tcoder\t%s/coder-wt\tswarmforge-coder\tCoder\tclaude\ttask\n' "$d" > "$d/.swarmforge/roles.tsv"
  printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$d" >> "$d/.swarmforge/roles.tsv"
  printf 'cleaner\tcleaner\t%s/cleaner-wt\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$d" >> "$d/.swarmforge/roles.tsv"
  printf 'architect\tarchitect\t%s/architect-wt\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$d" >> "$d/.swarmforge/roles.tsv"
  printf 'QA\tQA\t%s/qa-wt\tswarmforge-QA\tQA\tclaude\ttask\n' "$d" >> "$d/.swarmforge/roles.tsv"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$d" >> "$d/.swarmforge/roles.tsv"
  printf '%s' "$d"
}

set_rotation() {
  local d="$1" mode="$2"
  if [[ -n "$mode" ]]; then
    printf 'rotation\t%s\n' "$mode" > "$d/.swarmforge/swarm-identity"
  else
    : > "$d/.swarmforge/swarm-identity"
  fi
}

write_claim() {
  # write_claim <worktree-dir> <role> <basename>
  local wt="$1" role="$2" basename="$3"
  local dir="$wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$dir"
  printf 'id: t\nfrom: a\nto: %s\nrecipient: %s\npriority: 00\ntype: git_handoff\ntask: demo\ncommit: 1234567890\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' \
    "$role" "$role" > "$dir/$basename"
}

new_path() {
  # new_path <worktree-dir> <basename>
  printf '%s/.swarmforge/handoffs/inbox/new/%s' "$1" "$2"
}
in_process_path() {
  printf '%s/.swarmforge/handoffs/inbox/in_process/%s' "$1" "$2"
}

# ── BL-648-01: relaunch boots the resident as the recorded active role, and
#    its own claim is left for the resume to pick up ──────────────────────
D1="$(make_fixture)"
set_rotation "$D1" "router"
printf 'QA\n' > "$D1/.swarmforge/mono-router-active-role"
write_claim "$D1/qa-wt" "QA" "00_x_from_documenter_to_QA_for_QA.handoff"
BOOT_ROLE_1="$(bb "$CLI" resolve-boot-role "$D1")"
check "BL-648-01: resident comes up as QA" '[[ "$BOOT_ROLE_1" == "QA" ]]'
bb "$CLI" sweep "$D1" "$BOOT_ROLE_1" >/dev/null
check "BL-648-01: QA's own claim is still in_process (untouched by the sweep)" \
  '[[ -f "$(in_process_path "$D1/qa-wt" "00_x_from_documenter_to_QA_for_QA.handoff")" ]]'
check "BL-648-01: no duplicate was delivered to QA's inbox/new" \
  '[[ ! -f "$(new_path "$D1/qa-wt" "00_x_from_documenter_to_QA_for_QA.handoff")" ]]'

# ── BL-648-02: missing/blank recorded role boots home ─────────────────────
D2="$(make_fixture)"
set_rotation "$D2" "router"
rm -f "$D2/.swarmforge/mono-router-active-role"
BOOT_ROLE_2_MISSING="$(bb "$CLI" resolve-boot-role "$D2")"
check "BL-648-02: missing marker boots home (coder)" '[[ "$BOOT_ROLE_2_MISSING" == "coder" ]]'
printf '   \n' > "$D2/.swarmforge/mono-router-active-role"
BOOT_ROLE_2_BLANK="$(bb "$CLI" resolve-boot-role "$D2")"
check "BL-648-02: blank marker boots home (coder)" '[[ "$BOOT_ROLE_2_BLANK" == "coder" ]]'

# ── BL-648-03: unknown recorded role falls back to home loudly, never
#    crashes the launch ───────────────────────────────────────────────────
D3="$(make_fixture)"
set_rotation "$D3" "router"
printf 'not-a-role\n' > "$D3/.swarmforge/mono-router-active-role"
STDERR_3="$(mktemp)"
register_tmp_dir "$STDERR_3"
BOOT_ROLE_3="$(bb "$CLI" resolve-boot-role "$D3" 2>"$STDERR_3")"
check "BL-648-03: unknown role falls back to home" '[[ "$BOOT_ROLE_3" == "coder" ]]'
check "BL-648-03: the launch log (stderr) carries a loud line naming the unreadable role record" \
  'grep -q "not-a-role" "$STDERR_3"'

# ── BL-648-04: a dead-owner claim elsewhere is reclaimed within one cycle ──
D4="$(make_fixture)"
set_rotation "$D4" "router"
printf 'coder\n' > "$D4/.swarmforge/mono-router-active-role"
write_claim "$D4/cleaner-wt" "cleaner" "00_x_from_a_to_cleaner_for_cleaner.handoff"
STDOUT_4="$(mktemp)"
register_tmp_dir "$STDOUT_4"
bb "$CLI" sweep "$D4" "coder" >"$STDOUT_4"
check "BL-648-04: the parcel is back in cleaner's inbox/new" \
  '[[ -f "$(new_path "$D4/cleaner-wt" "00_x_from_a_to_cleaner_for_cleaner.handoff")" ]]'
check "BL-648-04: it no longer sits in in_process" \
  '[[ ! -f "$(in_process_path "$D4/cleaner-wt" "00_x_from_a_to_cleaner_for_cleaner.handoff")" ]]'
check "BL-648-04: the log carries a loud reclaim line naming the parcel" \
  'grep -q "RECLAIM.*cleaner" "$STDOUT_4"'

# ── BL-648-06: a non-rotation pack ignores the role record for boot, but
#    the orphan sweep still runs ──────────────────────────────────────────
D6="$(make_fixture)"
set_rotation "$D6" ""
printf 'QA\n' > "$D6/.swarmforge/mono-router-active-role"
BOOT_ROLE_6="$(bb "$CLI" resolve-boot-role "$D6")"
check "BL-648-06: non-rotation pack boots home regardless of the marker" '[[ "$BOOT_ROLE_6" == "coder" ]]'
write_claim "$D6/architect-wt" "architect" "00_x_from_a_to_architect_for_architect.handoff"
bb "$CLI" sweep "$D6" "$BOOT_ROLE_6" >/dev/null
check "BL-648-06: architect's dead-owner claim is reclaimed to inbox/new even on a non-rotation pack" \
  '[[ -f "$(new_path "$D6/architect-wt" "00_x_from_a_to_architect_for_architect.handoff")" ]]'

# ── BL-648-07 (architect bounce #1): a claim that collides with an existing
#    inbox/new entry cannot be moved - the sweep must surface it loudly and
#    exit 0, never abort the launch. Direct replay of the architect's own
#    repro: same basename already present in inbox/new. ───────────────────
D7="$(make_fixture)"
set_rotation "$D7" "router"
printf 'coder\n' > "$D7/.swarmforge/mono-router-active-role"
write_claim "$D7/cleaner-wt" "cleaner" "00_x_from_a_to_cleaner_for_cleaner.handoff"
mkdir -p "$D7/cleaner-wt/.swarmforge/handoffs/inbox/new"
cp "$(in_process_path "$D7/cleaner-wt" "00_x_from_a_to_cleaner_for_cleaner.handoff")" \
   "$(new_path "$D7/cleaner-wt" "00_x_from_a_to_cleaner_for_cleaner.handoff")"
STDOUT_7="$(mktemp)"
register_tmp_dir "$STDOUT_7"
set +e
bb "$CLI" sweep "$D7" "coder" >"$STDOUT_7" 2>&1
SWEEP_7_EXIT=$?
set -e
check "BL-648-07: a colliding reclaim never aborts the launch (exit 0)" '[[ "$SWEEP_7_EXIT" -eq 0 ]]'
check "BL-648-07: the un-movable claim is surfaced loudly" 'grep -q "LOUD" "$STDOUT_7"'
check "BL-648-07: the claim is left in place, not silently dropped" \
  '[[ -f "$(in_process_path "$D7/cleaner-wt" "00_x_from_a_to_cleaner_for_cleaner.handoff")" ]]'

# ── BL-648-08 (architect bounce #1, secondary): no roles.tsv at all (home
#    role itself unresolvable) must never print the literal string "nil" -
#    direct replay of the architect's own repro. ──────────────────────────
D8="$(mktemp -d)"
register_tmp_dir "$D8"
mkdir -p "$D8/.swarmforge"
set_rotation "$D8" "router"
printf 'QA\n' > "$D8/.swarmforge/mono-router-active-role"
STDOUT_8="$(mktemp)"
register_tmp_dir "$STDOUT_8"
set +e
BOOT_ROLE_8="$(bb "$CLI" resolve-boot-role "$D8" 2>"$STDOUT_8")"
RESOLVE_8_EXIT=$?
set -e
check "BL-648-08: resolve-boot-role never exits non-zero on an unreadable roster" '[[ "$RESOLVE_8_EXIT" -eq 0 ]]'
check "BL-648-08: stdout is never the literal string 'nil'" '[[ "$BOOT_ROLE_8" != "nil" ]]'
check "BL-648-08: stdout is empty (no role could be resolved)" '[[ -z "$BOOT_ROLE_8" ]]'
check "BL-648-08: the launch log carries a loud line explaining the unresolvable roster" \
  'grep -q "LOUD" "$STDOUT_8"'

if [[ "$fail" -ne 0 ]]; then
  echo "FAIL: one or more BL-648 relaunch-resume checks failed" >&2
  exit 1
fi
echo "test_relaunch_resume_cli: ok"

#!/usr/bin/env bash
# An aider seat's generated launch script reads the repo-root aider model
# settings/metadata by ABSOLUTE path and records every LLM request.
#
# Why (2026-09-23): aider looks for .aider.model.settings.yml and
# .aider.model.metadata.json in its own git root - for a seat that is its
# WORKTREE, where these untracked repo-root files never exist. Only the
# coordinator (running at the repo root) ever read them: the same IQ3_S
# model ran "diff" format there and "whole" format in QA, and the pack's
# required think:false never reached the coder/QA seats at all. Aider also
# reported the context window as "of 0" (no metadata), so it could not
# see that its bootstrap alone nearly filled the served num_ctx.
# --llm-history-file captures the exact messages sent, so seat prompts can
# be measured and replayed instead of guessed at.

set -euo pipefail

export PACK_STAFFING_SKIP_GATE=1
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

index_of_role_snippet='
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
'

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch" "$root/.swarmforge/prompts"
  printf 'constitution\n' > "$root/swarmforge/constitution.prompt"
  printf 'role prompt\n' > "$root/swarmforge/roles/coder.prompt"
  echo "$root"
}

ROOT="$(mk_root)"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'EOF'
window coder aider coder --model openai/qwen2.5-coder:latest --openai-api-base http://127.0.0.1:11434/v1 --no-gitignore
EOF
zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
LAUNCH="$ROOT/.swarmforge/launch/coder.sh"
[[ -f "$LAUNCH" ]] || fail "01: coder launch script was not written"

grep -qF -- "--model-settings-file '$ROOT/.aider.model.settings.yml'" "$LAUNCH" \
  || fail "01: aider seat must read the repo-root .aider.model.settings.yml by absolute path"
pass "01: model settings file passed by absolute repo-root path"

grep -qF -- "--model-metadata-file '$ROOT/.aider.model.metadata.json'" "$LAUNCH" \
  || fail "02: aider seat must read the repo-root .aider.model.metadata.json by absolute path"
pass "02: model metadata file passed by absolute repo-root path"

grep -qF -- "--llm-history-file '$ROOT/.swarmforge/aider-llm-history/coder.log'" "$LAUNCH" \
  || fail "03: aider seat must log LLM requests to a per-role file under the repo-root state dir"
pass "03: per-role llm history file under .swarmforge/aider-llm-history"

grep -qF -- "mkdir -p '$ROOT/.swarmforge/aider-llm-history'" "$LAUNCH" \
  || fail "04: the llm history directory must be created before aider starts"
mkdir_line="$(grep -nF -- "mkdir -p '$ROOT/.swarmforge/aider-llm-history'" "$LAUNCH" | head -1 | cut -d: -f1)"
aider_line="$(grep -nE '^aider ' "$LAUNCH" | head -1 | cut -d: -f1)"
[[ -n "$aider_line" && "$mkdir_line" -lt "$aider_line" ]] \
  || fail "04: mkdir must precede the aider command (mkdir=$mkdir_line aider=$aider_line)"
pass "04: history dir created before aider runs"

grep -qF -- "--yes-always --no-detect-urls" "$LAUNCH" \
  || fail "05: existing aider flags must be preserved"
pass "05: existing --yes-always --no-detect-urls preserved"

ROOT_NOTES="$(mk_root)"
mkdir -p "$ROOT_NOTES/swarmforge/roles/aider"
printf 'coder note\n' > "$ROOT_NOTES/swarmforge/roles/aider/coder.note"
printf 'generic note\n' > "$ROOT_NOTES/swarmforge/roles/aider/generic.note"
printf 'QA role prompt\n' > "$ROOT_NOTES/swarmforge/roles/QA.prompt"
cat > "$ROOT_NOTES/swarmforge/swarmforge.conf" <<'EOF'
config aider_timeout_seconds 90
window coder aider coder --model openai/qwen2.5-coder:latest --openai-api-base http://127.0.0.1:11434/v1 --no-gitignore
window QA aider QA --model openai/qwen2.5-coder:latest --openai-api-base http://127.0.0.1:11434/v1 --no-gitignore
EOF
zsh -c "source '$SWARMFORGE_SH' '$ROOT_NOTES'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\"; write_role_launch_script \"\$(index_of_role QA)\""
LAUNCH_CODER_NOTES="$ROOT_NOTES/.swarmforge/launch/coder.sh"
LAUNCH_QA_NOTES="$ROOT_NOTES/.swarmforge/launch/QA.sh"
[[ -f "$LAUNCH_CODER_NOTES" && -f "$LAUNCH_QA_NOTES" ]] || fail "07: coder/QA launch scripts were not written"

grep -qF -- "--read '$ROOT_NOTES/swarmforge/roles/aider/coder.note'" "$LAUNCH_CODER_NOTES" \
  || fail "07: a coder aider seat must --read its own role note when one exists"
pass "07: coder aider seat reads its own role note"

grep -qF -- "--read '$ROOT_NOTES/swarmforge/roles/aider/generic.note'" "$LAUNCH_QA_NOTES" \
  || fail "08: a QA aider seat with no QA.note must --read the generic note"
pass "08: aider seat with no role-specific note falls back to the generic note"

grep -qF -- "--test-cmd 'swarmforge/scripts/seat test' --auto-test" "$LAUNCH_CODER_NOTES" \
  || fail "09: a coder aider seat must run aider's own test loop"
pass "09: coder aider seat gets --test-cmd/--auto-test"

grep -qE -- '--test-cmd|--auto-test' "$LAUNCH_QA_NOTES" \
  && fail "10: a non-coder aider seat must not get the test loop flags"
pass "10: non-coder aider seat has no test loop flags"

grep -qF -- "--timeout 90" "$LAUNCH_CODER_NOTES" \
  || fail "11: config aider_timeout_seconds must become --timeout on the coder seat"
grep -qF -- "--timeout 90" "$LAUNCH_QA_NOTES" \
  || fail "11: config aider_timeout_seconds must become --timeout on every aider seat"
pass "11: aider_timeout_seconds becomes --timeout on every aider launch line"

ROOT_CLAUDE="$(mk_root)"
cat > "$ROOT_CLAUDE/swarmforge/swarmforge.conf" <<'EOF'
window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low
EOF
zsh -c "source '$SWARMFORGE_SH' '$ROOT_CLAUDE'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
LAUNCH_CLAUDE="$ROOT_CLAUDE/.swarmforge/launch/coder.sh"
[[ -f "$LAUNCH_CLAUDE" ]] || fail "12: claude coder launch script was not written"
grep -qE -- "--model-settings-file|--model-metadata-file|--llm-history-file|aider-llm-history" "$LAUNCH_CLAUDE" \
  && fail "12: aider-only flags must not leak into a non-aider seat"
grep -qE -- "aider/coder\.note|aider/generic\.note|--read '|--test-cmd|--auto-test|--timeout " "$LAUNCH_CLAUDE" \
  && fail "12: BL-1699's aider-only flags (--read/--test-cmd/--auto-test/--timeout) must not leak into a non-aider seat"
pass "12: non-aider seats are untouched"

# ── 13: `seat test` runs UNSCOPED (no SEAT_TICKET/SEAT_ACCEPTANCE) when
# aider's own --auto-test loop calls it directly and there is no BL-1697
# driver record for the seat - requirement 4's own negative case, never
# exercised by the acceptance feature's scenario 05 (which only covers the
# "has a record" path). A real throwaway git checkout carrying the real
# `seat` + local_parcel_driver_cli.bb/lib.bb closure (BL-1699's own
# acceptance step handler convention), never a re-implementation of the
# fallback logic. ────────────────────────────────────────────────────────
DRIVER_CLOSURE_FILES=(
  seat
  backlog_depth_conf_path_cli.bb
  backlog_depth_lib.bb
  swarm_identity_lib.bb
  daemon_cycle_guard_lib.bb
  local_parcel_driver_cli.bb
  local_parcel_driver_lib.bb
  agent_runtime_inject.bb
  required_stages_lib.bb
  agent_runtime_lib.bb
  prompt_engine_lib.bb
)
ROOT13="$(mktemp -d)"
register_tmp_dir "$ROOT13"
mkdir -p "$ROOT13/swarmforge/scripts" "$ROOT13/.swarmforge/local-driver"
git -C "$ROOT13" init -q -b main
git -C "$ROOT13" config user.email "bl1699-fixture@example.test"
git -C "$ROOT13" config user.name "BL-1699 Fixture"
for f in "${DRIVER_CLOSURE_FILES[@]}"; do
  cp "$SCRIPT_DIR/../$f" "$ROOT13/swarmforge/scripts/$f"
  chmod --reference="$SCRIPT_DIR/../$f" "$ROOT13/swarmforge/scripts/$f" 2>/dev/null || chmod +x "$ROOT13/swarmforge/scripts/$f"
done
LOG13="$ROOT13/seat-test-env.log"
printf "config seat_test_command printf 'TICKET=[%%s] ACCEPTANCE=[%%s]\\\\n' \"\$SEAT_TICKET\" \"\$SEAT_ACCEPTANCE\" > '%s'\n" "$LOG13" \
  > "$ROOT13/swarmforge/swarmforge.conf"
printf 'seat-test-env.log\n' > "$ROOT13/.gitignore"
git -C "$ROOT13" add -A
git -C "$ROOT13" commit -q -m seed
# No .swarmforge/local-driver/coder.json is ever written - "no record".
(
  cd "$ROOT13" \
    && env -u SEAT_TICKET -u SEAT_ACCEPTANCE SWARMFORGE_ROLE=coder PACK_STAFFING_SKIP_GATE=1 \
       bash "$ROOT13/swarmforge/scripts/seat" test
) || fail "13: seat test (no driver record) must still exit 0 and run the command unscoped"
[[ -f "$LOG13" ]] || fail "13: seat_test_command never ran"
grep -qF -- "TICKET=[] ACCEPTANCE=[]" "$LOG13" \
  || fail "13: expected seat test to run with SEAT_TICKET/SEAT_ACCEPTANCE unset (BL-1696's original unscoped behaviour), got: $(cat "$LOG13")"
pass "13: seat test with no driver record runs unscoped, exactly BL-1696's original behaviour"

echo "ALL PASS"

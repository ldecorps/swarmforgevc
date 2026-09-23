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

ROOT_CLAUDE="$(mk_root)"
cat > "$ROOT_CLAUDE/swarmforge/swarmforge.conf" <<'EOF'
window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low
EOF
zsh -c "source '$SWARMFORGE_SH' '$ROOT_CLAUDE'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
LAUNCH_CLAUDE="$ROOT_CLAUDE/.swarmforge/launch/coder.sh"
[[ -f "$LAUNCH_CLAUDE" ]] || fail "06: claude coder launch script was not written"
grep -qE -- "--model-settings-file|--model-metadata-file|--llm-history-file|aider-llm-history" "$LAUNCH_CLAUDE" \
  && fail "06: aider-only flags must not leak into a non-aider seat"
pass "06: non-aider seats are untouched"

echo "ALL PASS"

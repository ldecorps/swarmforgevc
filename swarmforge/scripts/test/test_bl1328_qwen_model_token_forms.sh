#!/usr/bin/env zsh
# BL-1328: extra_cli_targets_qwen_cloud must recognize a qwen* --model in
# BOTH token forms - the separate pair (`--model qwen3.8-max`) the packs use
# today, and the single `--model=qwen3.8-max` token a future pack author may
# just as reasonably write. The equals form silently failed to match, which
# meant no Token Plan remap and no CLAUDE_CODE_MAX_CONTEXT_TOKENS - the exact
# auto-compaction bug hotfix 4ed88430b2 fixed for the space form (BL-1324).
#
# zsh, not bash: the predicate uses zsh word splitting (${=extra_cli}) and
# 1-indexed arrays, so running it under bash would answer the wrong thing.
#
# The function is EXTRACTED from the live swarmforge.sh and eval'd rather than
# copied: a copy would drift from the shipped predicate silently, and sourcing
# swarmforge.sh outright would run the swarm launcher.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { print -r -- "FAIL: $*" >&2; exit 1; }
pass() { print -r -- "PASS: $*"; }

fn_text="$(awk '/^extra_cli_targets_qwen_cloud\(\) \{/{flag=1} flag{print} flag&&/^\}/{exit}' "$SWARMFORGE_SH")"
[[ -n "$fn_text" ]] || fail "extra_cli_targets_qwen_cloud not found in $SWARMFORGE_SH"
eval "$fn_text"

expect_match() {
  local label="$1" cli="$2"
  extra_cli_targets_qwen_cloud "$cli" \
    || fail "$label: expected a qwen-cloud target for [$cli]"
  pass "$label"
}

expect_no_match() {
  local label="$1" cli="$2"
  if extra_cli_targets_qwen_cloud "$cli"; then
    fail "$label: expected NO qwen-cloud target for [$cli]"
  fi
  pass "$label"
}

# ── the form that already worked, and must keep working ──────────────────
expect_match "space form still matches" "--model qwen3.8-max"
expect_match "space form matches among other flags" "--dangerously-skip-permissions --model qwen3.8-max --effort low"

# ── the gap this ticket closes ───────────────────────────────────────────
expect_match "equals form matches" "--model=qwen3.8-max"
expect_match "equals form matches among other flags" "--effort low --model=qwen3-coder-plus --verbose"

# ── and nothing else moved: a non-qwen model stays undetected in EITHER
#    form, so a sibling Anthropic seat keeps its subscription auth ────────
expect_no_match "space form, non-qwen model" "--model claude-sonnet-5"
expect_no_match "equals form, non-qwen model" "--model=claude-sonnet-5"
expect_no_match "equals form, a model merely containing qwen later" "--model=claude-qwen-lookalike"
expect_no_match "no --model at all" "--effort low --verbose"
expect_no_match "empty args" ""
expect_no_match "a bare --model with no value" "--model"
# A flag that merely STARTS with --model= must not match on the flag name
# alone - the value is what decides.
expect_no_match "equals form with an empty value" "--model="

print -r -- "ALL PASS: BL-1328 qwen-cloud --model token forms"

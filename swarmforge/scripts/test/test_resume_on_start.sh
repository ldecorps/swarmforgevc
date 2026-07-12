#!/usr/bin/env bash
# BL-323: RESUME-ON-START. A parcel a killed agent claimed into its own
# inbox/in_process/ must be resumed by the REPLACEMENT agent's very first
# message - not left for the agent to discover on its own initiative.
# BL-316 sat this way for ~4 hours across two real relaunches before this
# fix: ready_for_next.sh already returned the in_process parcel first, but
# nothing made a freshly-launched agent actually run it unprompted.
#
# This drives the REAL swarmforge.sh (sourced, not executed - BL-089's own
# ZSH_EVAL_CONTEXT toplevel guard skips tmux/git/real-launch side effects
# when sourced) to generate a REAL launch script via the REAL
# write_role_launch_script, then EXECUTES that real generated script with
# a stubbed `claude`/`bb` on PATH so the assertion observes what the agent
# ACTUALLY receives as its first message - not just that the generator
# emitted the right-looking text. `zsh -f` (no rc files) for the execution
# step only: an interactive zshenv on this machine prepends the real
# claude's install dir back onto PATH ahead of any override, defeating the
# stub - production's own tmux respawn-pane invocations are unaffected
# either way (a real orphaned parcel is resumed the same regardless of
# which rc files a login shell would have sourced).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture_root() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch" "$root/.swarmforge/prompts" "$root/.worktrees/coder/swarmforge/scripts"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  printf 'window coder claude coder --model x\n' > "$root/swarmforge/swarmforge.conf"
  echo "$root"
}

# Generates coder's real launch script via the real swarmforge.sh, writing
# it to $ROOT/.swarmforge/launch/coder.sh - returns nothing, asserts setup
# succeeded.
generate_coder_launch_script() {
  local root="$1"
  env -u SWARMFORGE_CONFIG zsh -c "
    source '$SWARMFORGE_SH' '$root'
    parse_config
    for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
      if [[ \"\${ROLES[\$i]}\" == \"coder\" ]]; then
        write_agent_instruction_file coder '$root/.swarmforge/prompts/coder.md' claude
        write_role_launch_script \$i >/dev/null
      fi
    done
  " >/dev/null 2>&1
  [[ -f "$root/.swarmforge/launch/coder.sh" ]] || fail "setup: expected coder.sh to be generated"
}

# Runs the REAL generated launch script with a stubbed claude that just
# records the exact argument it was invoked with. Returns the captured
# argument on stdout.
run_launch_script_capture_claude_arg() {
  local root="$1"
  local fake_bin call_log
  fake_bin="$(mktemp -d)"
  call_log="$(mktemp)"
  cat > "$fake_bin/claude" <<EOF
#!/usr/bin/env bash
printf '%s' "\$*" > "$call_log"
EOF
  chmod +x "$fake_bin/claude"
  env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN PATH="$fake_bin:$PATH" \
    zsh -f "$root/.swarmforge/launch/coder.sh" >/dev/null 2>&1 || true
  cat "$call_log"
  rm -rf "$fake_bin" "$call_log"
}

# ── resume-orphaned-inprocess-01: an orphaned in_process parcel is resumed ──

ROOT1="$(mk_fixture_root)"
generate_coder_launch_script "$ROOT1"
CODER_WT1="$ROOT1/.worktrees/coder"
mkdir -p "$CODER_WT1/.swarmforge/handoffs/inbox/new" "$CODER_WT1/.swarmforge/handoffs/inbox/in_process"
cat > "$ROOT1/.swarmforge/roles.tsv" <<TSV
coder	coder	$CODER_WT1	swarmforge-coder	Coder	claude	task
TSV
# Exactly what ready_for_next_task.bb leaves behind when an agent claims a
# parcel and is then killed before finishing it - a real orphaned claim,
# not a synthetic mock of one.
printf 'from: coordinator\nto: coder\npriority: 20\ntype: note\ntask: BL-999\ndequeued_at: 2026-07-12T17:18:24Z\n\nresume this\n' \
  > "$CODER_WT1/.swarmforge/handoffs/inbox/in_process/00_orphaned.handoff"

CLAUDE_ARG1="$(run_launch_script_capture_claude_arg "$ROOT1")"
echo "$CLAUDE_ARG1" | grep -q "RESUME-ON-START" \
  || fail "01: expected the replacement agent's first message to include an explicit resume instruction, got: $CLAUDE_ARG1"
pass "01: a parcel orphaned by a killed agent is resumed - the replacement agent's own first message tells it to, unprompted"

echo "$CLAUDE_ARG1" | grep -q "ready_for_next.sh" \
  || fail "01: expected the resume instruction to name ready_for_next.sh"
pass "01: it does not report that there is no work - it is told to run ready_for_next.sh immediately"

rm -rf "$ROOT1"

# ── resume-orphaned-inprocess-02: a live agent's parcel is never taken ─────
# The resume check is read-only (never moves/claims/deletes anything) - a
# role with an in_process item still gets the SAME resume note regardless
# of whether the prior owner is alive or dead, but critically the parcel
# file itself is completely untouched by generating/running the launch
# script, so a respawn of some OTHER role can never disturb it.

ROOT2="$(mk_fixture_root)"
generate_coder_launch_script "$ROOT2"
CODER_WT2="$ROOT2/.worktrees/coder"
mkdir -p "$CODER_WT2/.swarmforge/handoffs/inbox/new" "$CODER_WT2/.swarmforge/handoffs/inbox/in_process"
cat > "$ROOT2/.swarmforge/roles.tsv" <<TSV
coder	coder	$CODER_WT2	swarmforge-coder	Coder	claude	task
TSV
printf 'from: coordinator\nto: coder\npriority: 20\ntype: note\ntask: BL-888\ndequeued_at: 2026-07-12T17:18:24Z\n\nlive work\n' \
  > "$CODER_WT2/.swarmforge/handoffs/inbox/in_process/00_live.handoff"
BEFORE_CONTENT="$(cat "$CODER_WT2/.swarmforge/handoffs/inbox/in_process/00_live.handoff")"

run_launch_script_capture_claude_arg "$ROOT2" >/dev/null

[[ -f "$CODER_WT2/.swarmforge/handoffs/inbox/in_process/00_live.handoff" ]] \
  || fail "02: expected the live agent's own in_process parcel to still exist - it must never be requeued or reassigned"
AFTER_CONTENT="$(cat "$CODER_WT2/.swarmforge/handoffs/inbox/in_process/00_live.handoff")"
[[ "$BEFORE_CONTENT" == "$AFTER_CONTENT" ]] \
  || fail "02: expected the parcel's own content untouched, got a diff"
pass "02: a parcel held by a live agent is never taken away from it - the resume check only reads, it never moves or claims"

rm -rf "$ROOT2"

# ── resume-orphaned-inprocess-04: a genuinely empty inbox reports no work ──

ROOT4="$(mk_fixture_root)"
generate_coder_launch_script "$ROOT4"
CODER_WT4="$ROOT4/.worktrees/coder"
mkdir -p "$CODER_WT4/.swarmforge/handoffs/inbox/new" "$CODER_WT4/.swarmforge/handoffs/inbox/in_process"
cat > "$ROOT4/.swarmforge/roles.tsv" <<TSV
coder	coder	$CODER_WT4	swarmforge-coder	Coder	claude	task
TSV

CLAUDE_ARG4="$(run_launch_script_capture_claude_arg "$ROOT4")"
echo "$CLAUDE_ARG4" | grep -q "RESUME-ON-START" \
  && fail "04: expected NO resume note for a genuinely empty in_process queue, got: $CLAUDE_ARG4"
pass "04: an idle role with a genuinely empty inbox still reports no work - no fabricated resume"

rm -rf "$ROOT4"

# ── a batch role's WHOLE in_process batch counts as an orphaned claim too ──

ROOT5="$(mk_fixture_root)"
generate_coder_launch_script "$ROOT5"
CODER_WT5="$ROOT5/.worktrees/coder"
mkdir -p "$CODER_WT5/.swarmforge/handoffs/inbox/new" "$CODER_WT5/.swarmforge/handoffs/inbox/in_process/batch_20260101T000000Z_1"
cat > "$ROOT5/.swarmforge/roles.tsv" <<TSV
coder	coder	$CODER_WT5	swarmforge-coder	Coder	claude	task
TSV
printf 'from: cleaner\nto: coder\npriority: 50\ntype: note\n\nbatched item\n' \
  > "$CODER_WT5/.swarmforge/handoffs/inbox/in_process/batch_20260101T000000Z_1/00_item.handoff"

CLAUDE_ARG5="$(run_launch_script_capture_claude_arg "$ROOT5")"
echo "$CLAUDE_ARG5" | grep -q "RESUME-ON-START" \
  || fail "05: expected an orphaned BATCH claim to also be resumed, got: $CLAUDE_ARG5"
pass "05: an orphaned batch claim (not just a single task) is also resumed on relaunch"

rm -rf "$ROOT5"

echo "ALL PASS"

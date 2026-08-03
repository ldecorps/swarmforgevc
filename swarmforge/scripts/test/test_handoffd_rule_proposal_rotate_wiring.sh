#!/usr/bin/env bash
# 2026-08-03 starvation: role-mail-row counted only git_handoff + aged notes as
# actionable, so a directed rule_proposal in specifier/inbox/new never rotated
# the mono-router resident (endless chase-rotate-skip-broadcast). This wiring
# test drives the real --print-preferred-rotate-target path
# (preferred-mono-rotate-role -> role-mail-row) so a hand-built score row
# cannot stay green while production still starves.
#
#   (a) a rule_proposal-only mailbox is preferred (immediately actionable)
#   (b) a fresh note alone is still NOT preferred (broadcast-thrash guard)
#   (c) an in_process git_handoff at priority 00 beats a rule_proposal at 50
#       (redirect recovery prefers the held claim over Article 5.1 mail)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

iso_ago() {
  python3 -c "import datetime,sys; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$1"
}

setup_fixture() {
  local root="$1"
  git -C "$root" init -q
  git -C "$root" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init

  mkdir -p "$root/.swarmforge" "$root/backlog/active"

  local coder_wt="$root/wt-coder"
  local spec_wt="$root/wt-specifier"
  local hard_wt="$root/wt-hardender"
  mkdir -p "$coder_wt/.swarmforge/handoffs/inbox/new" "$coder_wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$spec_wt/.swarmforge/handoffs/inbox/new" "$spec_wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$hard_wt/.swarmforge/handoffs/inbox/new" "$hard_wt/.swarmforge/handoffs/inbox/in_process"

  {
    printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$coder_wt"
    printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$spec_wt"
    printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$hard_wt"
  } > "$root/.swarmforge/roles.tsv"

  printf 'config rotation router\nconfig rotation_home coder\n' > "$root/swarmforge.conf"
  printf 'active_backlog_max_depth_conf_path\t%s\nrotation\trouter\n' \
    "$root/swarmforge.conf" > "$root/.swarmforge/swarm-identity"

  touch "$root/fake.sock"
  echo "$root/fake.sock" > "$root/.swarmforge/tmux-socket"

  echo "$coder_wt"
  echo "$spec_wt"
  echo "$hard_wt"
}

print_preferred() {
  local root="$1"
  SWARMFORGE_ALLOW_TMP_DAEMON=1 bb "$HANDOFFD" "$root" --print-preferred-rotate-target
}

# ── A: rule_proposal alone is preferred ────────────────────────────────────
ROOT_A="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_a() { rm -rf "$ROOT_A"; }
trap cleanup_a EXIT

FIX_A="$(setup_fixture "$ROOT_A")"
SPEC_A="$(printf '%s\n' "$FIX_A" | sed -n '2p')"

AT_A="$(iso_ago 5)"
printf 'id: rp1\nfrom: hardender\nto: specifier\npriority: 50\ntype: rule_proposal\ncreated_at: %s\nenqueued_at: %s\n\nbody\n' \
  "$AT_A" "$AT_A" > "$SPEC_A/.swarmforge/handoffs/inbox/new/50_rule_proposal.handoff"

TARGET_A="$(print_preferred "$ROOT_A")"
[[ "$TARGET_A" == "specifier" ]] \
  || fail "A: expected specifier (rule_proposal-only), got '$TARGET_A'"
pass "A: rule_proposal-only mailbox is preferred (immediately actionable)"

trap - EXIT
cleanup_a

# ── B: fresh note alone is still not preferred ─────────────────────────────
ROOT_B="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_b() { rm -rf "$ROOT_B"; }
trap cleanup_b EXIT

FIX_B="$(setup_fixture "$ROOT_B")"
SPEC_B="$(printf '%s\n' "$FIX_B" | sed -n '2p')"

AT_B="$(iso_ago 2)"
printf 'id: n1\nfrom: qa\nto: specifier\npriority: 00\ntype: note\nmessage: merge up\ncreated_at: %s\nenqueued_at: %s\n\nbody\n' \
  "$AT_B" "$AT_B" > "$SPEC_B/.swarmforge/handoffs/inbox/new/00_note.handoff"

TARGET_B="$(print_preferred "$ROOT_B")"
[[ "$TARGET_B" == "none" ]] \
  || fail "B: fresh note must not be preferred (got '$TARGET_B')"
pass "B: fresh note alone stays non-actionable (broadcast-thrash guard intact)"

trap - EXIT
cleanup_b

# ── C: in_process priority-00 beats rule_proposal priority-50 ──────────────
ROOT_C="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_c() { rm -rf "$ROOT_C"; }
trap cleanup_c EXIT

FIX_C="$(setup_fixture "$ROOT_C")"
SPEC_C="$(printf '%s\n' "$FIX_C" | sed -n '2p')"
HARD_C="$(printf '%s\n' "$FIX_C" | sed -n '3p')"

AT_RP="$(iso_ago 5)"
printf 'id: rp1\nfrom: hardender\nto: specifier\npriority: 50\ntype: rule_proposal\ncreated_at: %s\nenqueued_at: %s\n\nbody\n' \
  "$AT_RP" "$AT_RP" > "$SPEC_C/.swarmforge/handoffs/inbox/new/50_rule_proposal.handoff"

AT_GH="$(iso_ago 90)"
printf 'id: g1\nfrom: architect\nto: hardender\npriority: 00\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\ncreated_at: %s\nenqueued_at: %s\ndequeued_at: %s\n\nmerge_and_process architect aaaaaaaaaa\n' \
  "$AT_GH" "$AT_GH" "$AT_GH" \
  > "$HARD_C/.swarmforge/handoffs/inbox/in_process/00_from_architect.handoff"

TARGET_C="$(print_preferred "$ROOT_C")"
[[ "$TARGET_C" == "hardender" ]] \
  || fail "C: expected hardender (in_process priority 00) over specifier rule_proposal 50, got '$TARGET_C'"
pass "C: in_process priority-00 beats rule_proposal priority-50 (held claim wins)"

trap - EXIT
cleanup_c

echo "ALL PASS: test_handoffd_rule_proposal_rotate_wiring.sh"

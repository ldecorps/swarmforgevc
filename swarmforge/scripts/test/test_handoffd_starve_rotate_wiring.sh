#!/usr/bin/env bash
# BL-651 (hardener-grade wiring): preferred-rotate-target's starve override
# must be fed real ages from handoffd.bb's role-mail-row - a hand-built
# score row in a bb unit test would stay green even if role-mail-row never
# computed :oldest-actionable-waited-ms (the BL-576/BL-636 F1 anti-pattern,
# repeated).
#
# Drives the REAL --print-preferred-rotate-target path
# (preferred-mono-rotate-role -> role-mail-row) against fixture mailboxes:
#   (a) a dormant git_handoff older than rotation_starve_after_ms beats a
#       newer git_handoff of equal priority in the home queue
#   (b) below the threshold, the home queue's newer parcel still wins (no
#       regression to BL-636 ordering)
#   (c) age is read from the parcel's own enqueued_at header, never file
#       mtime - touching the fixture file after writing it must not reset
#       the wait
#   (d) `config rotation_starve_after_ms off` disables the override entirely

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
  local starve_line="$2"   # e.g. "config rotation_starve_after_ms off", or "" for default
  git -C "$root" init -q
  git -C "$root" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init

  mkdir -p "$root/.swarmforge" "$root/backlog/active"

  local coder_wt="$root/wt-coder"
  local doc_wt="$root/wt-documenter"
  mkdir -p "$coder_wt/.swarmforge/handoffs/inbox/new" "$coder_wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$doc_wt/.swarmforge/handoffs/inbox/new" "$doc_wt/.swarmforge/handoffs/inbox/in_process"

  {
    printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$coder_wt"
    printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$doc_wt"
  } > "$root/.swarmforge/roles.tsv"

  {
    printf 'config rotation router\nconfig rotation_home coder\n'
    if [[ -n "$starve_line" ]]; then printf '%s\n' "$starve_line"; fi
  } > "$root/swarmforge.conf"
  # Persist active conf path the way conf-file-path resolves it - the
  # swarm-identity file is TAB-separated key/value lines (swarm_identity_lib.bb
  # read-swarm-identity splits on \t), never `=`.
  printf 'active_backlog_max_depth_conf_path\t%s\nrotation\trouter\n' \
    "$root/swarmforge.conf" > "$root/.swarmforge/swarm-identity"

  touch "$root/fake.sock"
  echo "$root/fake.sock" > "$root/.swarmforge/tmux-socket"

  echo "$coder_wt"
  echo "$doc_wt"
}

print_preferred() {
  local root="$1"
  SWARMFORGE_ALLOW_TMP_DAEMON=1 bb "$HANDOFFD" "$root" --print-preferred-rotate-target
}

# ── A: dormant parcel past threshold beats home's newer equal-priority mail ─
ROOT_A="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_a() { rm -rf "$ROOT_A"; }
trap cleanup_a EXIT

mapfile -t FIX_A < <(setup_fixture "$ROOT_A" "")
CODER_A="${FIX_A[0]}"
DOC_A="${FIX_A[1]}"

OLD_AT="$(iso_ago 12)"
NEW_AT="$(iso_ago 1)"

printf 'id: d12\nfrom: hardender\nto: documenter\npriority: 00\ntype: git_handoff\ntask: BL-651\ncommit: aaaaaaaaaa\ncreated_at: %s\nenqueued_at: %s\n\ndocs pass\n' \
  "$OLD_AT" "$OLD_AT" > "$DOC_A/.swarmforge/handoffs/inbox/new/00_from_hardender_to_documenter.handoff"

printf 'id: c1\nfrom: architect\nto: coder\npriority: 00\ntype: git_handoff\ntask: BL-999\ncommit: bbbbbbbbbb\ncreated_at: %s\nenqueued_at: %s\n\nnext ticket\n' \
  "$NEW_AT" "$NEW_AT" > "$CODER_A/.swarmforge/handoffs/inbox/new/00_from_architect_to_coder.handoff"

TARGET_A="$(print_preferred "$ROOT_A")"
[[ "$TARGET_A" == "documenter" ]] \
  || fail "A: expected documenter (starved past default 10m), got '$TARGET_A'"
pass "A: dormant parcel past rotation_starve_after_ms beats a fresher equal-priority home parcel via real role-mail-row"

trap - EXIT
cleanup_a

# ── B: below the threshold, home's newer parcel still wins (BL-636 intact) ──
ROOT_B="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_b() { rm -rf "$ROOT_B"; }
trap cleanup_b EXIT

mapfile -t FIX_B < <(setup_fixture "$ROOT_B" "")
CODER_B="${FIX_B[0]}"
DOC_B="${FIX_B[1]}"

BELOW_AT="$(iso_ago 3)"
NEWER_AT="$(iso_ago 1)"

printf 'id: d3\nfrom: hardender\nto: documenter\npriority: 00\ntype: git_handoff\ntask: BL-651\ncommit: cccccccccc\ncreated_at: %s\nenqueued_at: %s\n\ndocs pass\n' \
  "$BELOW_AT" "$BELOW_AT" > "$DOC_B/.swarmforge/handoffs/inbox/new/00_from_hardender_to_documenter.handoff"

printf 'id: c2\nfrom: architect\nto: coder\npriority: 00\ntype: git_handoff\ntask: BL-999\ncommit: dddddddddd\ncreated_at: %s\nenqueued_at: %s\n\nnext ticket\n' \
  "$NEWER_AT" "$NEWER_AT" > "$CODER_B/.swarmforge/handoffs/inbox/new/00_from_architect_to_coder.handoff"

TARGET_B="$(print_preferred "$ROOT_B")"
[[ "$TARGET_B" == "coder" ]] \
  || fail "B: expected coder (documenter parcel still under threshold), got '$TARGET_B'"
pass "B: below rotation_starve_after_ms, BL-636 newest-first ordering is unchanged"

trap - EXIT
cleanup_b

# ── C: age comes from enqueued_at, never file mtime ─────────────────────────
ROOT_C="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_c() { rm -rf "$ROOT_C"; }
trap cleanup_c EXIT

mapfile -t FIX_C < <(setup_fixture "$ROOT_C" "")
CODER_C="${FIX_C[0]}"
DOC_C="${FIX_C[1]}"

OLD_AT_C="$(iso_ago 12)"
NEW_AT_C="$(iso_ago 1)"

DOC_FILE_C="$DOC_C/.swarmforge/handoffs/inbox/new/00_from_hardender_to_documenter.handoff"
printf 'id: d12c\nfrom: hardender\nto: documenter\npriority: 00\ntype: git_handoff\ntask: BL-651\ncommit: eeeeeeeeee\ncreated_at: %s\nenqueued_at: %s\n\ndocs pass\n' \
  "$OLD_AT_C" "$OLD_AT_C" > "$DOC_FILE_C"
# Simulate a worktree hot-sync touching the file well after it was written -
# mtime now reads "fresh" even though the parcel's own header is still old.
touch "$DOC_FILE_C"

printf 'id: c3\nfrom: architect\nto: coder\npriority: 00\ntype: git_handoff\ntask: BL-999\ncommit: ffffffffff\ncreated_at: %s\nenqueued_at: %s\n\nnext ticket\n' \
  "$NEW_AT_C" "$NEW_AT_C" > "$CODER_C/.swarmforge/handoffs/inbox/new/00_from_architect_to_coder.handoff"

TARGET_C="$(print_preferred "$ROOT_C")"
[[ "$TARGET_C" == "documenter" ]] \
  || fail "C: expected documenter (age from enqueued_at, not touched mtime), got '$TARGET_C'"
pass "C: a touched file mtime does not reset a parcel's wait - age is read from its own header"

trap - EXIT
cleanup_c

# ── D: rotation_starve_after_ms off disables the override entirely ─────────
ROOT_D="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_d() { rm -rf "$ROOT_D"; }
trap cleanup_d EXIT

mapfile -t FIX_D < <(setup_fixture "$ROOT_D" "config rotation_starve_after_ms off")
CODER_D="${FIX_D[0]}"
DOC_D="${FIX_D[1]}"

OLD_AT_D="$(iso_ago 40)"
NEW_AT_D="$(iso_ago 1)"

printf 'id: d40\nfrom: hardender\nto: documenter\npriority: 00\ntype: git_handoff\ntask: BL-651\ncommit: 1111111111\ncreated_at: %s\nenqueued_at: %s\n\ndocs pass\n' \
  "$OLD_AT_D" "$OLD_AT_D" > "$DOC_D/.swarmforge/handoffs/inbox/new/00_from_hardender_to_documenter.handoff"

printf 'id: c4\nfrom: architect\nto: coder\npriority: 00\ntype: git_handoff\ntask: BL-999\ncommit: 2222222222\ncreated_at: %s\nenqueued_at: %s\n\nnext ticket\n' \
  "$NEW_AT_D" "$NEW_AT_D" > "$CODER_D/.swarmforge/handoffs/inbox/new/00_from_architect_to_coder.handoff"

TARGET_D="$(print_preferred "$ROOT_D")"
[[ "$TARGET_D" == "coder" ]] \
  || fail "D: expected coder (rotation_starve_after_ms off must reproduce BL-636 ordering), got '$TARGET_D'"
pass "D: rotation_starve_after_ms off reproduces BL-636 newest-first ordering byte-for-byte"

trap - EXIT
cleanup_d

echo "ALL PASS: test_handoffd_starve_rotate_wiring.sh"

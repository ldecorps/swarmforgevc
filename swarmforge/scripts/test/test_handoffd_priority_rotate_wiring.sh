#!/usr/bin/env bash
# BL-636 (hardener-grade wiring): preferred-rotate-target's priority-first
# ordering must be fed by handoffd.bb's role-mail-row. Hand-building score
# rows in JS/bb unit tests alone would stay green even if role-mail-row
# never carried :best-priority (the exact BL-576 F1 anti-pattern).
#
# Drives the REAL --print-preferred-rotate-target path (preferred-mono-rotate-role
# -> role-mail-row) against fixture mailboxes:
#   (a) older priority-00 beats newer priority-50
#   (b) a role's best (lowest) priority wins even when its newest parcel is worse
#   (c) a fresh priority-00 note stays non-actionable (BL-576 gate unchanged)

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
  local clean_wt="$root/wt-cleaner"
  local arch_wt="$root/wt-architect"
  mkdir -p "$coder_wt/.swarmforge/handoffs/inbox/new" "$coder_wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$spec_wt/.swarmforge/handoffs/inbox/new" "$spec_wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$clean_wt/.swarmforge/handoffs/inbox/new" "$clean_wt/.swarmforge/handoffs/inbox/in_process"
  mkdir -p "$arch_wt/.swarmforge/handoffs/inbox/new" "$arch_wt/.swarmforge/handoffs/inbox/in_process"

  {
    printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$coder_wt"
    printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$spec_wt"
    printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$clean_wt"
    printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$arch_wt"
  } > "$root/.swarmforge/roles.tsv"

  # Mono-router pack: rotation preference only applies under config rotation router.
  printf 'config rotation router\nconfig rotation_home coder\n' > "$root/swarmforge.conf"
  # Persist active conf path the way handoffd's rotation-router-mode? resolves it.
  printf 'active_backlog_max_depth_conf_path=%s\nrotation=router\n' \
    "$root/swarmforge.conf" > "$root/.swarmforge/swarm-identity"

  touch "$root/fake.sock"
  echo "$root/fake.sock" > "$root/.swarmforge/tmux-socket"

  echo "$coder_wt"
  echo "$spec_wt"
  echo "$clean_wt"
  echo "$arch_wt"
}

print_preferred() {
  local root="$1"
  SWARMFORGE_ALLOW_TMP_DAEMON=1 bb "$HANDOFFD" "$root" --print-preferred-rotate-target
}

# ── A: older priority-00 beats newer priority-50 ───────────────────────────
ROOT_A="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_a() { rm -rf "$ROOT_A"; }
trap cleanup_a EXIT

mapfile -t FIX_A < <(setup_fixture "$ROOT_A")
CODER_A="${FIX_A[0]}"
SPEC_A="${FIX_A[1]}"

OLD_AT="$(iso_ago 160)"   # ~2h40 ago — the live incident age
NEW_AT="$(iso_ago 5)"

printf 'id: n783\nfrom: coordinator\nto: specifier\npriority: 00\ntype: git_handoff\ntask: BL-636\ncommit: aaaaaaaaaa\ncreated_at: %s\n\nincident note starved\n' \
  "$OLD_AT" > "$SPEC_A/.swarmforge/handoffs/inbox/new/00_from_coordinator_to_specifier.handoff"

printf 'id: rp1\nfrom: architect\nto: coder\npriority: 50\ntype: git_handoff\ntask: BL-590\ncommit: bbbbbbbbbb\ncreated_at: %s\n\nrule_proposal rework\n' \
  "$NEW_AT" > "$CODER_A/.swarmforge/handoffs/inbox/new/50_from_architect_to_coder.handoff"

TARGET_A="$(print_preferred "$ROOT_A")"
[[ "$TARGET_A" == "specifier" ]] \
  || fail "A: expected specifier (priority 00), got '$TARGET_A'"
pass "A: older priority-00 beats newer priority-50 via real role-mail-row"

trap - EXIT
cleanup_a

# ── B: role ranked by best priority, not newest parcel's priority ──────────
ROOT_B="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_b() { rm -rf "$ROOT_B"; }
trap cleanup_b EXIT

mapfile -t FIX_B < <(setup_fixture "$ROOT_B")
CODER_B="${FIX_B[0]}"
SPEC_B="${FIX_B[1]}"

PRI00_AT="$(iso_ago 60)"
PRI70_AT="$(iso_ago 5)"
PRI40_AT="$(iso_ago 30)"

printf 'id: s00\nfrom: qa\nto: specifier\npriority: 00\ntype: git_handoff\ntask: BL-636\ncommit: cccccccccc\ncreated_at: %s\n\nhigh priority\n' \
  "$PRI00_AT" > "$SPEC_B/.swarmforge/handoffs/inbox/new/00_from_qa_to_specifier.handoff"
printf 'id: s70\nfrom: architect\nto: specifier\npriority: 70\ntype: git_handoff\ntask: BL-999\ncommit: dddddddddd\ncreated_at: %s\n\nnewer low priority\n' \
  "$PRI70_AT" > "$SPEC_B/.swarmforge/handoffs/inbox/new/70_from_architect_to_specifier.handoff"

printf 'id: c40\nfrom: cleaner\nto: coder\npriority: 40\ntype: git_handoff\ntask: BL-040\ncommit: eeeeeeeeee\ncreated_at: %s\n\nmid priority\n' \
  "$PRI40_AT" > "$CODER_B/.swarmforge/handoffs/inbox/new/40_from_cleaner_to_coder.handoff"

TARGET_B="$(print_preferred "$ROOT_B")"
[[ "$TARGET_B" == "specifier" ]] \
  || fail "B: expected specifier (best priority 00 despite newer 70), got '$TARGET_B'"
pass "B: role-mail-row ranks by best priority, not newest parcel's"

trap - EXIT
cleanup_b

# ── C: fresh priority-00 note is NOT actionable (aged-note gate unchanged) ─
ROOT_C="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_c() { rm -rf "$ROOT_C"; }
trap cleanup_c EXIT

mapfile -t FIX_C < <(setup_fixture "$ROOT_C")
CODER_C="${FIX_C[0]}"
SPEC_C="${FIX_C[1]}"

FRESH_AT="$(iso_ago 2)"   # well under the 20-minute default
printf 'id: fresh\nfrom: qa\nto: specifier\npriority: 00\ntype: note\nmessage: merge up\nenqueued_at: %s\ncreated_at: %s\n\nbroadcast\n' \
  "$FRESH_AT" "$FRESH_AT" > "$SPEC_C/.swarmforge/handoffs/inbox/new/00_note_from_qa_to_specifier.handoff"

# Competing actionable mid-priority mail so the printer has somewhere to go
# if the fresh note wrongly became actionable and won on priority-00.
printf 'id: c90\nfrom: cleaner\nto: coder\npriority: 90\ntype: git_handoff\ntask: BL-090\ncommit: ffffffffff\ncreated_at: %s\n\nlow\n' \
  "$(iso_ago 10)" > "$CODER_C/.swarmforge/handoffs/inbox/new/90_from_cleaner_to_coder.handoff"

TARGET_C="$(print_preferred "$ROOT_C")"
[[ "$TARGET_C" == "coder" ]] \
  || fail "C: fresh priority-00 note must not beat coder's actionable 90 (got '$TARGET_C')"
[[ "$TARGET_C" != "specifier" ]] \
  || fail "C: specifier selected on a fresh note — aged-note gate was weakened"
pass "C: fresh priority-00 note stays non-actionable (BL-576 gate unchanged)"

trap - EXIT
cleanup_c

# ── D: missing priority never jumps a valid 90 ─────────────────────────────
ROOT_D="$(cd "$(mktemp -d)" && pwd -P)"
cleanup_d() { rm -rf "$ROOT_D"; }
trap cleanup_d EXIT

mapfile -t FIX_D < <(setup_fixture "$ROOT_D")
CODER_D="${FIX_D[0]}"
CLEAN_D="${FIX_D[2]}"

# No priority header at all on coder's parcel
printf 'id: nopri\nfrom: architect\nto: coder\ntype: git_handoff\ntask: BL-000\ncommit: gggggggggg\ncreated_at: %s\n\nmissing priority\n' \
  "$(iso_ago 5)" > "$CODER_D/.swarmforge/handoffs/inbox/new/xx_from_architect_to_coder.handoff"

printf 'id: p90\nfrom: specifier\nto: cleaner\npriority: 90\ntype: git_handoff\ntask: BL-090\ncommit: hhhhhhhhhh\ncreated_at: %s\n\nvalid low\n' \
  "$(iso_ago 30)" > "$CLEAN_D/.swarmforge/handoffs/inbox/new/90_from_specifier_to_cleaner.handoff"

TARGET_D="$(print_preferred "$ROOT_D")"
[[ "$TARGET_D" == "cleaner" ]] \
  || fail "D: expected cleaner (priority 90), got '$TARGET_D' (missing priority jumped?)"
pass "D: missing priority never jumps a valid 90 via real role-mail-row"

trap - EXIT
cleanup_d

echo "ALL PASS: test_handoffd_priority_rotate_wiring.sh"

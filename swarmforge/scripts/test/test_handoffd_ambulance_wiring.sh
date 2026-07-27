#!/usr/bin/env bash
# BL-655: real-daemon wiring coverage for ambulance mode's site 1 (delivery,
# handoffd.bb's poll-once!) and site 3 (rotation actionability, role-mail-row
# feeding mono-router-lib/preferred-rotate-target). Site 2 (dequeue,
# handoff-lib/resolve-dequeueable-candidates) is covered directly against
# the real function in handoff_lib_test_runner.bb + the property runner -
# no daemon needed there since it has no load-file-triggers-a-daemon-loop
# hazard the way handoffd.bb itself does.
#
# Modeled on test_handoffd_pause_auto_resume_wiring.sh (daemon spawn/stop
# pattern) and test_handoffd_aged_note_rotate_wiring.sh (fake-tmux rotate
# fixture) - both already-proven techniques for this file, reused rather
# than reinvented.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

write_marker() {
  local root="$1" ticket="$2"
  mkdir -p "$root/.swarmforge/operator"
  printf '{"active":true,"ticket":"%s","engagedAtMs":1,"by":"test"}\n' "$ticket" \
    > "$root/.swarmforge/operator/control-ambulance.json"
}

release_marker() {
  local root="$1"
  printf '{"active":false}\n' > "$root/.swarmforge/operator/control-ambulance.json"
}

# ── Scenario A: delivery hold + release (site 1, ambulance-hold-01/02) ────
ROOT_A="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
PID_A=""
cleanup_a() {
  [[ -n "$PID_A" ]] && kill "$PID_A" 2>/dev/null || true
  rm -rf "$ROOT_A"
}
trap cleanup_a EXIT

SOCK_A="$ROOT_A/fake.sock"
touch "$SOCK_A"
mkdir -p "$ROOT_A/.swarmforge" "$ROOT_A/backlog/active"
echo "$SOCK_A" > "$ROOT_A/.swarmforge/tmux-socket"

CODER_WT_A="$ROOT_A/.worktrees/coder"
CLEANER_INBOX_NEW_A="$ROOT_A/.worktrees/cleaner/.swarmforge/handoffs/inbox/new"
mkdir -p "$CODER_WT_A/.swarmforge/handoffs/outbox" "$CLEANER_INBOX_NEW_A"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT_A" > "$ROOT_A/.swarmforge/roles.tsv"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$ROOT_A/.worktrees/cleaner" >> "$ROOT_A/.swarmforge/roles.tsv"

# BL-655's own patient, engaged for BL-654.
printf 'id: BL-654\ntitle: "demo"\nstatus: active\n' > "$ROOT_A/backlog/active/BL-654-demo.yaml"
write_marker "$ROOT_A" "BL-654"

GH_654="$CODER_WT_A/.swarmforge/handoffs/outbox/50_20260726T000001Z_000001_from_coder_to_cleaner.handoff"
GH_660="$CODER_WT_A/.swarmforge/handoffs/outbox/50_20260726T000002Z_000002_from_coder_to_cleaner.handoff"
printf 'id: g654\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: BL-654\ncommit: aaaaaaaaaa\ncreated_at: 2026-07-26T00:00:01Z\n\nmerge_and_process coder aaaaaaaaaa\n' > "$GH_654"
printf 'id: g660\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: BL-660\ncommit: bbbbbbbbbb\ncreated_at: 2026-07-26T00:00:02Z\n\nmerge_and_process coder bbbbbbbbbb\n' > "$GH_660"
GH_660_CONTENT_BEFORE="$(cat "$GH_660")"

FAKE_BIN_A="$ROOT_A/bin"
mkdir -p "$FAKE_BIN_A"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN_A/tmux"
chmod +x "$FAKE_BIN_A/tmux"

LOG_A="$ROOT_A/.swarmforge/daemon/handoffd.log"
PATH="$FAKE_BIN_A:$PATH" bb "$HANDOFFD" "$ROOT_A" > "$ROOT_A/daemon-stdout.log" 2>&1 &
PID_A=$!

wait_for() {
  local file="$1" pattern="$2" timeout_s="$3" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$file" ]] && grep -q "$pattern" "$file" 2>/dev/null && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

for _ in $(seq 1 40); do
  [[ -n "$(find "$CLEANER_INBOX_NEW_A" -maxdepth 1 -name '*.handoff' 2>/dev/null)" ]] && break
  sleep 0.25
done

# ── ambulance-hold-01 ──────────────────────────────────────────────────────
DELIVERED_TASKS="$(grep -l "task: BL-654" "$CLEANER_INBOX_NEW_A"/*.handoff 2>/dev/null | wc -l | tr -d ' ')"
[[ "$DELIVERED_TASKS" -ge 1 ]] || fail "ambulance-hold-01: expected the BL-654 parcel delivered to cleaner's inbox"
pass "ambulance-hold-01: the ambulance ticket's own parcel is delivered"

[[ -f "$GH_660" ]] || fail "ambulance-hold-01: the BL-660 parcel must still be sitting in coder's outbox, untouched"
[[ "$(cat "$GH_660")" == "$GH_660_CONTENT_BEFORE" ]] || fail "ambulance-hold-01: the held parcel's content changed"
pass "ambulance-hold-01: the non-ambulance parcel is still queued, byte-identical, in coder's outbox"

wait_for "$LOG_A" "deliver-skip-ambulance" 10 \
  || fail "ambulance-hold-01: expected a deliver-skip-ambulance log line; log: $(cat "$LOG_A" 2>/dev/null)"
pass "ambulance-hold-01: the daemon logs the skip"

TERMINAL_HANDOFFS="$(find "$ROOT_A" -path '*handoffs*' \( -name failed -o -name abandoned -o -name completed \) -type d \
  -exec find {} -maxdepth 1 -name '*.handoff' \; 2>/dev/null)"
[[ -z "$TERMINAL_HANDOFFS" ]] \
  || fail "ambulance-hold-01: no parcel may be moved to failed/abandoned/completed while held; found: $TERMINAL_HANDOFFS"
pass "ambulance-hold-01: no parcel was moved to failed, abandoned, or completed"

# ── ambulance-hold-02: releasing delivers the held parcel intact ─────────
release_marker "$ROOT_A"
for _ in $(seq 1 40); do
  [[ -n "$(find "$CLEANER_INBOX_NEW_A" -maxdepth 1 -name '*.handoff' -newer "$GH_654" 2>/dev/null)" ]] && break
  find "$CLEANER_INBOX_NEW_A" -maxdepth 1 -name '*.handoff' 2>/dev/null | grep -q "660\|BL-660" && break
  sleep 0.25
done
sleep 1

mkdir -p "$ROOT_A/.swarmforge/daemon"
touch "$ROOT_A/.swarmforge/daemon/stop"
wait "$PID_A" 2>/dev/null || true
PID_A=""

[[ ! -f "$GH_660" ]] || fail "ambulance-hold-02: BL-660's parcel should have been delivered (left coder's outbox) after release"
DELIVERED_660="$(grep -l "task: BL-660" "$CLEANER_INBOX_NEW_A"/*.handoff 2>/dev/null | wc -l | tr -d ' ')"
[[ "$DELIVERED_660" -ge 1 ]] || fail "ambulance-hold-02: expected BL-660's parcel delivered after release"
grep -q "task: BL-660" "$CLEANER_INBOX_NEW_A"/*.handoff 2>/dev/null \
  && grep -qF "merge_and_process coder bbbbbbbbbb" "$CLEANER_INBOX_NEW_A"/*.handoff 2>/dev/null \
  || fail "ambulance-hold-02: the delivered BL-660 parcel's body does not match what was held"
pass "ambulance-hold-02: releasing the ambulance delivers the held parcel, byte-identical, once the daemon next polls"

trap - EXIT
cleanup_a

# ── Scenario B: rotation prefers the ambulance ticket over newer mail
#     elsewhere (site 3, ambulance-hold-05) ────────────────────────────────
ROOT_B="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
PID_B=""
cleanup_b() {
  [[ -n "$PID_B" ]] && kill "$PID_B" 2>/dev/null || true
  rm -rf "$ROOT_B"
}
trap cleanup_b EXIT

RESIDENT_SESSION="swarmforge-coder"
FAKE_BIN_B="$ROOT_B/bin"
mkdir -p "$FAKE_BIN_B"
TMUX_LOG_B="$ROOT_B/tmux-calls.log"
touch "$TMUX_LOG_B"
cat > "$FAKE_BIN_B/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$TMUX_LOG_B"
target=""
prev=""
for arg in "\$@"; do
  if [[ "\$prev" == "-t" ]]; then target="\$arg"; fi
  prev="\$arg"
done
if [[ "\$*" == *"has-session"* ]]; then
  if [[ "\$target" == "$RESIDENT_SESSION" ]]; then exit 0; else exit 1; fi
fi
if [[ "\$*" == *"capture-pane"* ]]; then
  echo ""
  exit 0
fi
exit 0
TMUX
chmod +x "$FAKE_BIN_B/tmux"

git -C "$ROOT_B" init -q
git -C "$ROOT_B" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir -p "$ROOT_B/.swarmforge" "$ROOT_B/.swarmforge/launch" "$ROOT_B/backlog/active"
printf 'id: BL-654\ntitle: "demo"\nstatus: active\n' > "$ROOT_B/backlog/active/BL-654-demo.yaml"
printf 'id: BL-660\ntitle: "demo"\nstatus: active\n' > "$ROOT_B/backlog/active/BL-660-demo.yaml"
write_marker "$ROOT_B" "BL-654"

ARCH_WT_B="$ROOT_B/wt-architect"
DOC_WT_B="$ROOT_B/wt-documenter"
CODER_WT_B="$ROOT_B/wt-coder"
mkdir -p "$ARCH_WT_B/.swarmforge/handoffs/inbox/new" "$ARCH_WT_B/.swarmforge/handoffs/inbox/in_process"
mkdir -p "$DOC_WT_B/.swarmforge/handoffs/inbox/new" "$DOC_WT_B/.swarmforge/handoffs/inbox/in_process"
mkdir -p "$CODER_WT_B/.swarmforge/handoffs/inbox/new" "$CODER_WT_B/.swarmforge/handoffs/inbox/in_process"
{
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT_B"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ARCH_WT_B"
  printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$DOC_WT_B"
} > "$ROOT_B/.swarmforge/roles.tsv"

touch "$ROOT_B/fake.sock"
echo "$ROOT_B/fake.sock" > "$ROOT_B/.swarmforge/tmux-socket"
printf '#!/bin/sh\nexit 0\n' > "$ROOT_B/.swarmforge/launch/architect.sh"
chmod +x "$ROOT_B/.swarmforge/launch/architect.sh"

# architect: the ambulance ticket's own parcel, OLDER.
printf 'id: ga\nfrom: cleaner\nto: architect\npriority: 50\ntype: git_handoff\ntask: BL-654\ncommit: aaaaaaaaaa\ncreated_at: 2026-07-26T00:00:01Z\n\nmerge_and_process cleaner aaaaaaaaaa\n' \
  > "$ARCH_WT_B/.swarmforge/handoffs/inbox/new/00_ga_from_cleaner_to_architect.handoff"

# documenter: a DIFFERENT ticket's parcel, NEWER - must lose the rotate
# because it is HELD, even though its own created_at would otherwise win.
printf 'id: gd\nfrom: hardener\nto: documenter\npriority: 50\ntype: git_handoff\ntask: BL-660\ncommit: bbbbbbbbbb\ncreated_at: 2026-07-26T00:00:02Z\n\nmerge_and_process hardener bbbbbbbbbb\n' \
  > "$DOC_WT_B/.swarmforge/handoffs/inbox/new/00_gd_from_hardener_to_documenter.handoff"

PID_B="$(SWARMFORGE_ALLOW_TMP_DAEMON=1 PATH="$FAKE_BIN_B:$PATH" bash -c "cd '$ROOT_B' && exec bb '$HANDOFFD' '$ROOT_B'" > "$ROOT_B/daemon-stdout.log" 2>&1 & echo $!)"

LOG_B="$ROOT_B/.swarmforge/daemon/handoffd.log"
DEADLINE=$(( $(date +%s) + 40 ))
while [[ $(date +%s) -lt $DEADLINE ]]; do
  [[ -f "$LOG_B" ]] && grep -qE "chase-rotate (architect|documenter)" "$LOG_B" && break
  sleep 0.5
done

mkdir -p "$ROOT_B/.swarmforge/daemon"
touch "$ROOT_B/.swarmforge/daemon/stop"
wait "$PID_B" 2>/dev/null || true
PID_B=""

[[ -f "$LOG_B" ]] || fail "ambulance-hold-05: handoffd never wrote a log file"
grep -q "chase-rotate architect" "$LOG_B" \
  || fail "ambulance-hold-05: the resident was never rotated to architect for the ambulance ticket; log: $(cat "$LOG_B" 2>/dev/null)"
grep -q "chase-rotate documenter" "$LOG_B" \
  && fail "ambulance-hold-05: documenter's newer-but-held parcel wrongly won the rotate"
pass "ambulance-hold-05: rotation prefers the ambulance ticket's parcel over newer mail held for a different ticket"

trap - EXIT
cleanup_b

echo "ALL PASS"

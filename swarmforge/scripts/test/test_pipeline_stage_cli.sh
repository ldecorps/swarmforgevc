#!/usr/bin/env bash
# BL-464: pipeline_stage_cli.bb - the coordinator-fed authoritative
# ticket->stage source for the pipeline board. Real fs fixtures (roles.tsv,
# per-role mailbox in_process handoffs, backlog/active yaml files), no git,
# no tmux - mirrors test_operator_runtime_tick.sh's own make_fixture/check
# idiom.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../pipeline_stage_cli.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT=""
cleanup() { [[ -n "$ROOT" ]] && rm -rf "$ROOT"; }
trap cleanup EXIT

mk_fixture() {
  ROOT="$(mktemp -d)"
  mkdir -p "$ROOT/.swarmforge" "$ROOT/backlog/active"
  # Master-resident roles (specifier/coordinator) share worktree-path=$ROOT
  # with a per-role mailbox subdir; every other role gets its OWN distinct
  # worktree-path, mirroring the real multi-worktree layout - a shared flat
  # path for two non-master roles would collide their mailboxes.
  printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
  printf 'coder\tcoder\t%s/wt-coder\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
  printf 'cleaner\tcleaner\t%s/wt-cleaner\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
  printf 'QA\tQA\t%s/wt-QA\tswarmforge-QA\tQa\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
}

write_backlog_active() {
  local id="$1"
  mkdir -p "$ROOT/backlog/active"
  printf 'id: %s\ntitle: "fixture ticket"\n' "$id" > "$ROOT/backlog/active/$id-fixture.yaml"
}

# in_process dir for a MASTER-resident role (specifier/coordinator).
master_in_process_dir() { printf '%s/.swarmforge/handoffs/%s/inbox/in_process' "$ROOT" "$1"; }
# in_process dir for an ordinary (own-worktree) role.
role_in_process_dir() { printf '%s/wt-%s/.swarmforge/handoffs/inbox/in_process' "$ROOT" "$1"; }

run_cli() {
  bb "$CLI" "$ROOT" "$1"
}

# ── board-authoritative-stage-01: a note-based promotion (no task header)
#    is still visible as the coder's held ticket ─────────────────────────
mk_fixture
write_backlog_active "BL-434"
DIR="$(role_in_process_dir coder)"
mkdir -p "$DIR"
printf 'from: coordinator\nto: coder\ntype: note\npriority: 10\nmessage: BL-434 promoted to active/ — starting now\n\nRe-read your role and constitution.\n\nBL-434 promoted to active/ — starting now\n' > "$DIR/10_note.handoff"
OUT="$(run_cli report)"
check "board-authoritative-stage-01: a note-kicked-off ticket is visible at the coder stage" \
  '[[ "$OUT" == *"\"BL-434\":\"coder\""* ]]'
rm -rf "$ROOT"

# ── board-authoritative-stage-02/03: the same ticket observed in_process at
#    TWO roles resolves to exactly ONE (the more downstream) role ─────────
mk_fixture
write_backlog_active "BL-460"
CODER_DIR="$(role_in_process_dir coder)"
CLEANER_DIR="$(role_in_process_dir cleaner)"
mkdir -p "$CODER_DIR" "$CLEANER_DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-460-tmp-sweeps\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$CODER_DIR/50_a.handoff"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-460-tmp-sweeps\ncommit: 2234567890\n\nmerge_and_process coder 2234567890\n' > "$CLEANER_DIR/50_b.handoff"
OUT="$(run_cli report)"
check "board-authoritative-stage-02/03: a ticket in_process at two roles at once resolves to exactly one stage" \
  '[[ "$OUT" == *"\"BL-460\":\"cleaner\""* ]] && [[ "$OUT" != *"\"BL-460\":\"coder\""* ]]'
rm -rf "$ROOT"

# ── board-authoritative-stage-04: a ticket held only via a note (never a
#    task-header git_handoff) is still the board's authoritative source -
#    exactly what an in_process task-header-only scrape would have missed ──
mk_fixture
write_backlog_active "BL-450"
DIR="$(master_in_process_dir specifier)"
mkdir -p "$DIR"
printf 'from: coordinator\nto: specifier\ntype: note\npriority: 10\nmessage: BL-450 needs a follow-up spec amendment\n\nRe-read your role and constitution.\n\nBL-450 needs a follow-up spec amendment\n' > "$DIR/10_note.handoff"
OUT="$(run_cli report)"
check "board-authoritative-stage-04: a note-only-held ticket (no task header anywhere) still resolves" \
  '[[ "$OUT" == *"\"BL-450\":\"specifier\""* ]]'
rm -rf "$ROOT"

# ── BL-489: the active-set id join is case-symmetric - a mis-cased
#    backlog/active yaml id must not silently drop the held ticket ─────────
mk_fixture
mkdir -p "$ROOT/backlog/active"
printf 'id: bl-490\ntitle: "fixture ticket"\n' > "$ROOT/backlog/active/bl-490-fixture.yaml"
DIR="$(role_in_process_dir coder)"
mkdir -p "$DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-490-thing\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$DIR/50_a.handoff"
OUT="$(run_cli report)"
check "BL-489: a lower-cased backlog/active yaml id (bl-490) still resolves the held ticket" \
  '[[ "$OUT" == *"\"BL-490\":\"coder\""* ]]'
rm -rf "$ROOT"

mk_fixture
mkdir -p "$ROOT/backlog/active"
printf 'id: Bl-490\ntitle: "fixture ticket"\n' > "$ROOT/backlog/active/Bl-490-fixture.yaml"
DIR="$(role_in_process_dir coder)"
mkdir -p "$DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-490-thing\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$DIR/50_a.handoff"
OUT="$(run_cli report)"
check "BL-489: a mixed-cased backlog/active yaml id (Bl-490) still resolves the held ticket" \
  '[[ "$OUT" == *"\"BL-490\":\"coder\""* ]]'
rm -rf "$ROOT"

# ── a batch role's SEVERAL simultaneously in_process tickets each survive ──
mk_fixture
write_backlog_active "BL-1"
write_backlog_active "BL-2"
DIR="$(role_in_process_dir cleaner)/batch_20260716T000000Z_a"
mkdir -p "$DIR"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-1-thing\ncommit: 1234567890\n\nmerge_and_process coder 1234567890\n' > "$DIR/50_a.handoff"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-2-other\ncommit: 2234567890\n\nmerge_and_process coder 2234567890\n' > "$DIR/50_b.handoff"
OUT="$(run_cli report)"
check "a batch role's own batch_* subdirectory tickets are all visible" \
  '[[ "$OUT" == *"\"BL-1\":\"cleaner\""* ]] && [[ "$OUT" == *"\"BL-2\":\"cleaner\""* ]]'
rm -rf "$ROOT"

# ── a ticket referenced in_process but no longer in backlog/active/ (e.g.
#    already closed) never appears - the board must never show a done ticket ──
mk_fixture
DIR="$(role_in_process_dir coder)"
mkdir -p "$DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-999-stale\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$DIR/50_a.handoff"
OUT="$(run_cli report)"
check "a ticket with no matching backlog/active entry never appears (never a fabricated location)" \
  '[[ "$OUT" == "{}" ]]'
rm -rf "$ROOT"

# ── report is read-only; sync persists the SAME map atomically, idempotently ──
mk_fixture
write_backlog_active "BL-7"
DIR="$(role_in_process_dir coder)"
mkdir -p "$DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-7-thing\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$DIR/50_a.handoff"
check "report never writes the store file" '[[ ! -f "$ROOT/.swarmforge/board/ticket-stage-map.json" ]]'
run_cli report > /dev/null
check "report still never writes the store file" '[[ ! -f "$ROOT/.swarmforge/board/ticket-stage-map.json" ]]'
SYNC_OUT="$(run_cli sync)"
check "sync writes the durable store file" '[[ -f "$ROOT/.swarmforge/board/ticket-stage-map.json" ]]'
check "sync's own stdout matches the persisted file" \
  '[[ "$SYNC_OUT" == "$(cat "$ROOT/.swarmforge/board/ticket-stage-map.json")" ]]'
check "the persisted store carries the reconciled map" \
  '[[ "$(cat "$ROOT/.swarmforge/board/ticket-stage-map.json")" == *"\"BL-7\":\"coder\""* ]]'
# a second sync (ticket now moved on to cleaner) overwrites cleanly, never
# leaving the stale coder entry behind - idempotent re-sync.
CLEANER_DIR="$(role_in_process_dir cleaner)"
mkdir -p "$CLEANER_DIR"
rm -f "$DIR/50_a.handoff"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-7-thing\ncommit: 2234567890\n\nmerge_and_process coder 2234567890\n' > "$CLEANER_DIR/50_a.handoff"
run_cli sync > /dev/null
check "a re-sync reflects the ticket's NEW stage, dropping the stale one" \
  '[[ "$(cat "$ROOT/.swarmforge/board/ticket-stage-map.json")" == *"\"BL-7\":\"cleaner\""* ]]'
rm -rf "$ROOT"

if [[ $fail -eq 0 ]]; then
  echo "pipeline_stage_cli: ALL CHECKS PASSED"
else
  echo "pipeline_stage_cli: FAILURES"
  exit 1
fi

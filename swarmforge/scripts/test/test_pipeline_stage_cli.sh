#!/usr/bin/env bash
# BL-464: pipeline_stage_cli.bb - the coordinator-fed authoritative
# ticket->stage source for the pipeline board. Real fs fixtures (roles.tsv,
# per-role mailbox in_process handoffs, backlog/active yaml files), no git,
# no tmux - mirrors test_operator_runtime_tick.sh's own make_fixture/check
# idiom.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../pipeline_stage_cli.bb"
# BL-670: the map's VALUE is now {stage, status, asOf, healthDot}, not a bare
# role string, so these assertions match on the entry's stage field rather than
# on the whole value. Matching a prefix keeps them indifferent to the other
# fields, which is what lets a later ticket add one without touching this file.
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
  printf 'architect\tarchitect\t%s/wt-architect\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
  printf 'hardender\thardender\t%s/wt-hardender\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
  printf 'documenter\tdocumenter\t%s/wt-documenter\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
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
# BL-1048: the DELIVERED-but-unopened mailbox state (inbox/new/) - the
# source the scan used to skip entirely, in both mailbox layouts.
master_new_dir() { printf '%s/.swarmforge/handoffs/%s/inbox/new' "$ROOT" "$1"; }
role_new_dir() { printf '%s/wt-%s/.swarmforge/handoffs/inbox/new' "$ROOT" "$1"; }

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
  '[[ "$OUT" == *"\"BL-434\":{\"stage\":\"coder\""* ]]'
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
  '[[ "$OUT" == *"\"BL-460\":{\"stage\":\"cleaner\""* ]] && [[ "$OUT" != *"\"BL-460\":{\"stage\":\"coder\""* ]]'
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
  '[[ "$OUT" == *"\"BL-450\":{\"stage\":\"specifier\""* ]]'
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
  '[[ "$OUT" == *"\"BL-490\":{\"stage\":\"coder\""* ]]'
rm -rf "$ROOT"

mk_fixture
mkdir -p "$ROOT/backlog/active"
printf 'id: Bl-490\ntitle: "fixture ticket"\n' > "$ROOT/backlog/active/Bl-490-fixture.yaml"
DIR="$(role_in_process_dir coder)"
mkdir -p "$DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-490-thing\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$DIR/50_a.handoff"
OUT="$(run_cli report)"
check "BL-489: a mixed-cased backlog/active yaml id (Bl-490) still resolves the held ticket" \
  '[[ "$OUT" == *"\"BL-490\":{\"stage\":\"coder\""* ]]'
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
  '[[ "$OUT" == *"\"BL-1\":{\"stage\":\"cleaner\""* ]] && [[ "$OUT" == *"\"BL-2\":{\"stage\":\"cleaner\""* ]]'
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
  '[[ "$(cat "$ROOT/.swarmforge/board/ticket-stage-map.json")" == *"\"BL-7\":{\"stage\":\"coder\""* ]]'
# a second sync (ticket now moved on to cleaner) overwrites cleanly, never
# leaving the stale coder entry behind - idempotent re-sync.
CLEANER_DIR="$(role_in_process_dir cleaner)"
mkdir -p "$CLEANER_DIR"
rm -f "$DIR/50_a.handoff"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-7-thing\ncommit: 2234567890\n\nmerge_and_process coder 2234567890\n' > "$CLEANER_DIR/50_a.handoff"
run_cli sync > /dev/null
check "a re-sync reflects the ticket's NEW stage, dropping the stale one" \
  '[[ "$(cat "$ROOT/.swarmforge/board/ticket-stage-map.json")" == *"\"BL-7\":{\"stage\":\"cleaner\""* ]]'
rm -rf "$ROOT"

# ── BL-1048: a DELIVERED but unopened parcel (inbox/new/) names its role ──
#    The not-started column means no role has the parcel - not that no role
#    has opened it. Before this, inbox/new/ was never scanned, so a routed,
#    delivered, woken handoff whose recipient had not yet run
#    ready_for_next.sh fell off the stage map entirely and rendered NS.
mk_fixture
write_backlog_active "BL-1037"
DIR="$(role_new_dir QA)"
mkdir -p "$DIR"
printf 'from: documenter\nto: QA\ntype: git_handoff\npriority: 50\ntask: BL-1037-thing\ncommit: cfd70ed26d\n\nmerge_and_process documenter cfd70ed26d\n' > "$DIR/50_a.handoff"
OUT="$(run_cli report)"
check "BL-1048-01: a delivered-but-unopened git_handoff resolves to the role whose new/ holds it" \
  '[[ "$OUT" == *"\"BL-1037\":{\"stage\":\"QA\""* ]]'
rm -rf "$ROOT"

# ── BL-1048-01 (master-resident role): the per-role new/ subdirectory is
#    read through the SAME mailbox-dir resolver, not a re-derived path ─────
mk_fixture
write_backlog_active "BL-1043"
DIR="$(master_new_dir specifier)"
mkdir -p "$DIR"
printf 'from: coordinator\nto: specifier\ntype: git_handoff\npriority: 50\ntask: BL-1043-spec\ncommit: 1234567890\n\nmerge_and_process coordinator 1234567890\n' > "$DIR/50_a.handoff"
OUT="$(run_cli report)"
check "BL-1048-01: a master-resident role's own new/ subdirectory is scanned too" \
  '[[ "$OUT" == *"\"BL-1043\":{\"stage\":\"specifier\""* ]]'
rm -rf "$ROOT"

# ── BL-1048-02: a ticket with no parcel in ANY new/ or in_process/ is
#    still not-started - widening the source set never fabricates one ──────
mk_fixture
write_backlog_active "BL-1044"
OUT="$(run_cli report)"
check "BL-1048-02: an active ticket with no parcel at any role is still absent (not-started)" \
  '[[ "$OUT" == "{}" ]]'
rm -rf "$ROOT"

# ── BL-1048-03: opened upstream + delivered downstream resolves to exactly
#    ONE role, the more downstream one - the transition window this
#    widening makes common must never reintroduce BL-464's double row ──────
mk_fixture
write_backlog_active "BL-1032"
CODER_DIR="$(role_in_process_dir coder)"
CLEANER_DIR="$(role_new_dir cleaner)"
mkdir -p "$CODER_DIR" "$CLEANER_DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-1032-thing\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$CODER_DIR/50_a.handoff"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-1032-thing\ncommit: 89e04323af\n\nmerge_and_process coder 89e04323af\n' > "$CLEANER_DIR/50_b.handoff"
OUT="$(run_cli report)"
check "BL-1048-03: opened upstream + delivered downstream resolves to the later role only" \
  '[[ "$OUT" == *"\"BL-1032\":{\"stage\":\"cleaner\""* ]] && [[ "$OUT" != *"\"BL-1032\":{\"stage\":\"coder\""* ]]'
rm -rf "$ROOT"

# ── BL-1048-03 (same role, both states): a redelivered copy alongside the
#    role's own opened parcel is still exactly one row at that role ────────
mk_fixture
write_backlog_active "BL-1040"
NEW_DIR="$(role_new_dir coder)"
IP_DIR="$(role_in_process_dir coder)"
mkdir -p "$NEW_DIR" "$IP_DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-1040-thing\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$IP_DIR/50_a.handoff"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-1040-thing\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$NEW_DIR/50_a.handoff"
OUT="$(run_cli report)"
# Exactly ONE entry, and it is the OPENED one: at a single role, "this role
# has it open" is a truer statement than "a copy is also sitting in its inbox"
# (BL-670). The one-row guarantee is checked by counting entries rather than by
# matching the whole string, so the qualifier's other fields do not have to be
# spelled out here.
check "BL-1048-03: the same ticket delivered AND opened at one role is that role, once" \
  '[[ "$OUT" == *"\"BL-1040\":{\"stage\":\"coder\",\"status\":\"claimed\""* ]] && [[ "$(printf %s "$OUT" | grep -o "\"stage\"" | wc -l | tr -d " ")" == "1" ]]'
rm -rf "$ROOT"

# ── BL-1048-04: a delivered NOTE names its ticket the same way a delivered
#    git_handoff does - the message-header read is not in_process-only ─────
mk_fixture
write_backlog_active "BL-1045"
DIR="$(role_new_dir hardender)"
mkdir -p "$DIR"
printf 'from: coordinator\nto: hardender\ntype: note\npriority: 10\nmessage: BL-1045 needs a hardening pass\n\nRe-read your role and constitution.\n\nBL-1045 needs a hardening pass\n' > "$DIR/10_note.handoff"
OUT="$(run_cli report)"
check "BL-1048-04: a delivered-but-unopened note resolves the same way a handoff does" \
  '[[ "$OUT" == *"\"BL-1045\":{\"stage\":\"hardender\""* ]]'
rm -rf "$ROOT"

# ── BL-1048-05: a delivered parcel naming a ticket no longer in
#    backlog/active/ puts nothing on the board - filter-active still owns
#    the membership test on the widened source set ─────────────────────────
mk_fixture
DIR="$(role_new_dir cleaner)"
mkdir -p "$DIR"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-996-closed\ncommit: 1234567890\n\nmerge_and_process coder 1234567890\n' > "$DIR/50_a.handoff"
OUT="$(run_cli report)"
check "BL-1048-05: a delivered parcel naming a closed ticket never appears" \
  '[[ "$OUT" == "{}" ]]'
rm -rf "$ROOT"

# ── BL-1048: a batch role's delivered batch_* subdirectory is enumerated in
#    new/ through the SAME batch walk in_process already uses ──────────────
mk_fixture
write_backlog_active "BL-1046"
write_backlog_active "BL-1047"
DIR="$(role_new_dir cleaner)/batch_20260822T000000Z_a"
mkdir -p "$DIR"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-1046-thing\ncommit: 1234567890\n\nmerge_and_process coder 1234567890\n' > "$DIR/50_a.handoff"
printf 'from: coder\nto: cleaner\ntype: git_handoff\npriority: 50\ntask: BL-1047-other\ncommit: 2234567890\n\nmerge_and_process coder 2234567890\n' > "$DIR/50_b.handoff"
OUT="$(run_cli report)"
check "BL-1048: a delivered batch_* subdirectory's tickets are all visible" \
  '[[ "$OUT" == *"\"BL-1046\":{\"stage\":\"cleaner\""* ]] && [[ "$OUT" == *"\"BL-1047\":{\"stage\":\"cleaner\""* ]]'
rm -rf "$ROOT"

# ── BL-1040: seat identity never escapes on the OBSERVATION path ─────────
#    BL-983 enforced its invariant 3 only where a seat FORWARDS. A second
#    seat of a stage (`coder@sonnet2`, BL-982's seat syntax) still wrote its
#    own id into the stage map, so the board - which knows only bare stage
#    names - matched nothing and painted the ticket as not-started while the
#    seat was actively working it. The stage map must carry the STAGE only,
#    and a multi-seat stage must take exactly ONE position in the precedence
#    order the reconciler uses to decide "most downstream wins".
mk_fixture
printf 'coder@sonnet2\tcoder-sonnet2\t%s/wt-coder-sonnet2\tswarmforge-coder-sonnet2\tCoder2\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
write_backlog_active "BL-993"
write_backlog_active "BL-995"
DIR="$(role_in_process_dir coder)"
mkdir -p "$DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-995-bare-seat\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$DIR/50_bare.handoff"
DIR2="$ROOT/wt-coder-sonnet2/.swarmforge/handoffs/inbox/in_process"
mkdir -p "$DIR2"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-993-second-seat\ncommit: 2234567890\n\nmerge_and_process specifier 2234567890\n' > "$DIR2/50_seat.handoff"
OUT="$(run_cli report)"
check "BL-1040: the bare seat's ticket reports under the stage" \
  '[[ "$OUT" == *"\"BL-995\":{\"stage\":\"coder\""* ]]'
check "BL-1040: the second seat's ticket reports under the STAGE, never the seat id" \
  '[[ "$OUT" == *"\"BL-993\":{\"stage\":\"coder\""* ]]'
check "BL-1040: the emitted stage map carries no seat id at all" \
  '[[ "$OUT" != *"@"* ]]'
rm -rf "$ROOT"

# ── BL-1040: no regression for the ordinary single-seat case - the stage map
#    is byte-identical to what the same fixture produced without a seat row.
mk_fixture
write_backlog_active "BL-995"
DIR="$(role_in_process_dir coder)"
mkdir -p "$DIR"
printf 'from: specifier\nto: coder\ntype: git_handoff\npriority: 50\ntask: BL-995-bare-seat\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n' > "$DIR/50_bare.handoff"
SINGLE_SEAT_OUT="$(run_cli report)"
printf 'coder@sonnet2\tcoder-sonnet2\t%s/wt-coder-sonnet2\tswarmforge-coder-sonnet2\tCoder2\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
TWO_SEAT_OUT="$(run_cli report)"
check "BL-1040: adding an idle second seat does not change the stage map" \
  '[[ "$SINGLE_SEAT_OUT" == "$TWO_SEAT_OUT" ]]'
rm -rf "$ROOT"

if [[ $fail -eq 0 ]]; then
  echo "pipeline_stage_cli: ALL CHECKS PASSED"
else
  echo "pipeline_stage_cli: FAILURES"
  exit 1
fi

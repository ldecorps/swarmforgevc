#!/usr/bin/env bash
# BL-848: wiring smoke test for operator_runtime.bb's hotfix-certification-
# sweep! - proves the pure hotfix_certification_lib.bb decisions are ACTUALLY
# wired into a running --tick-once (required_wiring's own "a certification
# lib nobody runs is the BL-419 shape this ticket exists to prevent"), gated
# by its own cadence (never the every-30s tick default), and that a pending
# entry's coordinator nudge rides the REAL swarm_handoff.bb send path (never
# a hand-written inbox file).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/operator_runtime_sandbox.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

sh_git() { git -C "$1" -c user.email=bl848@test -c user.name=BL-848 "${@:2}"; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles" "$d/backlog"
  copy_operator_runtime_sandbox "$SRC" "$d/swarmforge/scripts"

  sh_git "$d" init -q
  sh_git "$d" symbolic-ref HEAD refs/heads/main
  printf 'seed\n' > "$d/README.md"
  sh_git "$d" add README.md
  sh_git "$d" commit -q -m 'initial'

  # a declared hotfix, touching a functional path
  mkdir -p "$d/swarmforge/scripts"
  printf '(defn foo [])\n' > "$d/swarmforge/scripts/bl848-fixture-hotfix.bb"
  sh_git "$d" add swarmforge/scripts/bl848-fixture-hotfix.bb
  sh_git "$d" commit -q -m "$(printf 'Land an emergency fixture fix.\n\nBy coder.\n\nHotfix-Certification: pending\n')"
  DECLARED_SHA="$(sh_git "$d" rev-parse --short=10 HEAD)"

  # an ordinary functional commit that cites no ticket and declares no
  # hotfix - the review-queue "unaccounted" case
  printf '(defn bar [])\n' > "$d/swarmforge/scripts/bl848-fixture-plain.bb"
  sh_git "$d" add swarmforge/scripts/bl848-fixture-plain.bb
  sh_git "$d" commit -q -m 'Unrelated plain functional change, no ticket cited.'
  UNACCOUNTED_SHA="$(sh_git "$d" rev-parse --short=10 HEAD)"

  # a doc-only commit - must never be flagged unaccounted
  mkdir -p "$d/docs"
  printf '# notes\n' > "$d/docs/bl848-fixture-notes.md"
  sh_git "$d" add docs/bl848-fixture-notes.md
  sh_git "$d" commit -q -m 'Docs only, no code.'

  # a live active ticket - otherwise operator_runtime's OWN closing-pass-
  # sweep! sees a drained/idle swarm on this same tick and hibernates,
  # wiping roles.tsv BEFORE hotfix-certification-sweep! gets to send its
  # coordinator note (this fixture is not testing hibernation; keep it out
  # of the way, same as a real swarm mid-work would)
  mkdir -p "$d/backlog/active"
  printf 'id: BL-TEST\ntitle: "keep the swarm from hibernating mid-tick"\nstatus: todo\nassigned_to: coder\n' \
    > "$d/backlog/active/BL-TEST-keep-alive.yaml"

  # seed the ledger with ONE pre-existing pending entry (no stamp ticket) so
  # the very first tick already has a mint-nudge to send
  cat > "$d/backlog/hotfix-ledger.yaml" <<'EOF'
# backlog/hotfix-ledger.yaml — BL-848 hotfix certification ledger.

- commit: 0000000001
  subject: "Pre-seeded pending fixture entry."
  detected_at: 2026-08-01
  state: pending
  stamp_ticket: null
  human_decision: null
  decided_at: null
EOF

  # a coordinator mailbox to receive the mint-nudge note
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$d" > "$d/.swarmforge/roles.tsv"

  echo "$d|$DECLARED_SHA|$UNACCOUNTED_SHA"
}

tick() {
  local root="$1"
  OPERATOR_SKIP_LAUNCH=1 \
    SWARMFORGE_SANDBOX_SWEEP_ROOT="$root/.no-sandbox-sweep" \
    SWARMFORGE_FIXTURE_REAP_ROOT="$root/.no-fixture-reap" SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
    SWARMFORGE_SKIP_SYNC_INJECT=1 \
    "${@:2}" \
    bb "$root/swarmforge/scripts/operator_runtime.bb" "$root" --tick-once > /dev/null
}

runtime_log() { cat "$1/.swarmforge/operator/runtime.log" 2>/dev/null; }
ledger_text() { cat "$1/backlog/hotfix-ledger.yaml" 2>/dev/null; }

FIXTURE="$(make_fixture)"
ROOT="${FIXTURE%%|*}"
REST="${FIXTURE#*|}"
DECLARED_SHA="${REST%%|*}"
UNACCOUNTED_SHA="${REST##*|}"
# make_fixture's own register_tmp_dir call runs inside the $(...) subshell
# above and cannot mutate this shell's cleanup array - a direct trap here
# is what actually removes ROOT (same posture test_dispatch_gap_autoroute.sh
# uses for its own single-fixture root).
trap 'rm -rf "$ROOT"' EXIT

# ── 1: a --tick-once with no cadence override fires the sweep exactly once
#      (required_wiring: called from the bundle, gated by timer-due?) ──────
tick "$ROOT" env HOTFIX_CERT_RESURFACE_MS=0
LOG1="$(runtime_log "$ROOT")"
check "01: the sweep logged a due entry on its first (never-run) tick" \
  '[[ "$LOG1" == *"hotfix-certification ["* ]]'
check "01: the newly-declared hotfix commit was appended to the ledger" \
  "[[ \"\$(ledger_text \"$ROOT\")\" == *\"commit: $DECLARED_SHA\"* ]]"
check "01: the new entry starts pending, not certified" \
  "grep -A3 \"commit: $DECLARED_SHA\" \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -q 'state: pending'"
check "01: the new entry's detected_at is a real YYYY-MM-DD date, never blank (BL-848 QA bounce)" \
  "grep -A3 \"commit: $DECLARED_SHA\" \"$ROOT/backlog/hotfix-ledger.yaml\" | grep -qE 'detected_at: [0-9]{4}-[0-9]{2}-[0-9]{2}$'"
check "01: the plain functional commit citing no ticket is reported unaccounted" \
  "[[ \"\$(runtime_log \"$ROOT\")\" == *\"hotfix-certification-unaccounted\"*\"$UNACCOUNTED_SHA\"* ]]"
check "01: the doc-only commit is never reported unaccounted" \
  '[[ "$LOG1" != *"bl848-fixture-notes"* ]]'
check "01: the pre-seeded pending entry (no stamp ticket) triggered a coordinator nudge" \
  '[[ "$LOG1" == *"hotfix-certification-nudge 0000000001"* ]]'

QUEUED="$(find "$ROOT/.swarmforge/handoffs/coordinator/outbox" -name '*.handoff' 2>/dev/null | head -1)"
check "01: a REAL swarm_handoff.bb note landed in the coordinator's own outbox (never a hand-written inbox file)" \
  '[[ -n "$QUEUED" ]]'
if [[ -n "$QUEUED" ]]; then
  check "01: the queued note names the coordinator" 'grep -q "^to: coordinator$" "$QUEUED"'
  check "01: the queued note mentions the unstamped commit" 'grep -q "0000000001" "$QUEUED"'
fi

# ── 2: a second --tick-once immediately after does NOT re-run the sweep -
#      the cadence gate (required_wiring), never every-30s. Scoped to
#      hotfix-certification's OWN log lines - other sweeps (orphan reaper,
#      launch decision, ...) log every tick regardless, that's expected. ──
HOTFIX_LINES_BEFORE="$(grep -c 'hotfix-certification' "$ROOT/.swarmforge/operator/runtime.log")"
tick "$ROOT"
HOTFIX_LINES_AFTER="$(grep -c 'hotfix-certification' "$ROOT/.swarmforge/operator/runtime.log")"
check "02: an immediate second tick adds NO new hotfix-certification log lines (cadence gate is live)" \
  '[[ "$HOTFIX_LINES_AFTER" -eq "$HOTFIX_LINES_BEFORE" ]]'

# ── 3: forcing the cadence gate open again resurfaces the SAME open entry
#      (invariant 2: one audit pass is not enough) ─────────────────────────
tick "$ROOT" env HOTFIX_CERT_INTERVAL_MS=0 HOTFIX_CERT_RESURFACE_MS=0
NUDGE_COUNT="$(grep -c "hotfix-certification-nudge 0000000001" "$ROOT/.swarmforge/operator/runtime.log")"
check "03: the still-open pending entry is surfaced again on a later due tick, not only once" \
  '[[ "$NUDGE_COUNT" -ge 2 ]]'

# ── 4: a landing the ledger already knows about is never queued twice ──────
UNACCOUNTED_COUNT="$(grep -c "hotfix-certification-unaccounted" "$ROOT/.swarmforge/operator/runtime.log" || true)"
tick "$ROOT" env HOTFIX_CERT_INTERVAL_MS=0 HOTFIX_CERT_RESURFACE_MS=0
UNACCOUNTED_MENTIONS="$(grep -o "$DECLARED_SHA" "$ROOT/.swarmforge/operator/runtime.log" | wc -l | tr -d ' ')"
check "04: the now-ledgered declared-hotfix commit is not re-added as a duplicate ledger entry" \
  "[[ \"\$(grep -c \"commit: $DECLARED_SHA\" \"$ROOT/backlog/hotfix-ledger.yaml\")\" -eq 1 ]]"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime hotfix-certification-sweep smoke: ALL CHECKS PASSED"
else
  echo "operator_runtime hotfix-certification-sweep smoke: FAILURES"; exit 1
fi

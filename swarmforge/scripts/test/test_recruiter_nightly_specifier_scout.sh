#!/usr/bin/env bash
# BL-1821: recruiter_nightly.sh's specifier-scout hook - the day gate and
# the local-pack-aider-live stand-down. Sources the script for its
# function definitions only (same posture as
# test_recruiter_nightly_steward_probe.sh), then calls
# local_pack_aider_live/run_specifier_scout directly against isolated
# fixture roots - never a real Hugging Face pass, never a real battery.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_root() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/.swarmforge" "$d/backlog/evidence"
  printf '%s' "$d"
}

# A stub scout script that records that it ran, standing in for the real
# recruiter_specifier_scout.sh (never a real Hugging Face pass here).
STUB_DIR="$(mktemp -d)"
register_tmp_dir "$STUB_DIR"
cat > "$STUB_DIR/recruiter_specifier_scout.sh" <<'EOF'
#!/usr/bin/env bash
echo "STUB SCOUT RAN root=$1 batch=$3"
exit 0
EOF
chmod +x "$STUB_DIR/recruiter_specifier_scout.sh"

# ── 1: not Monday, no force -> skips, names the reason, never runs ──────
ROOT1="$(make_root)"
LOG1="$ROOT1/nightly.log"
LOG="$LOG1" ROOT="$ROOT1" RECRUITER_SPECIFIER_SCOUT_SCRIPT="$STUB_DIR/recruiter_specifier_scout.sh" bash -c "
set -uo pipefail
source '$SRC/recruiter_nightly.sh'
date() { echo 3; }  # force 'not Monday' (Wednesday) deterministically
run_specifier_scout
" >/tmp/bl1821-t1.out 2>&1
check "1: not Monday skips, names the reason" \
  "grep -q 'not Monday UTC, skipping' '$LOG1'"
check "1: the stub scout never ran" \
  "! grep -q 'STUB SCOUT RAN' '$LOG1'"

# ── 2: the force seam runs it regardless of the day - stubbing date() to
#      a deterministic non-Monday (Wednesday) so this case actually
#      discriminates the force seam from the day gate. Without the stub,
#      this case's pass/fail on the FORCE clause depends on the real
#      wall-clock day: on an actual Monday, a broken FORCE check (e.g. an
#      accidentally-flipped `!=` -> `==`) would not be caught, since the
#      unmutated day-gate clause alone would also let the scout run.
ROOT2="$(make_root)"
LOG2="$ROOT2/nightly.log"
LOG="$LOG2" ROOT="$ROOT2" RECRUITER_SPECIFIER_SCOUT_SCRIPT="$STUB_DIR/recruiter_specifier_scout.sh" RECRUITER_SPECIFIER_SCOUT_FORCE=1 RECRUITER_SPECIFIER_BATCH=5 bash -c "
set -uo pipefail
source '$SRC/recruiter_nightly.sh'
date() { echo 3; }  # force 'not Monday' (Wednesday) deterministically
run_specifier_scout
" >/tmp/bl1821-t2.out 2>&1
check "2: the force seam runs the scout" \
  "grep -q 'STUB SCOUT RAN' '$LOG2'"
check "2: the batch size is forwarded" \
  "grep -q 'batch=5' '$LOG2'"

# ── 3: a local pack's aider seat is live -> stands down even with the
#      force seam set ────────────────────────────────────────────────────
ROOT3="$(make_root)"
mkdir -p "$ROOT3/.swarmforge/tmux"
SOCK3="$ROOT3/.swarmforge/tmux/probe.sock"
tmux -S "$SOCK3" new-session -d -s fake-aider-session "sleep 300"
printf 'coder\tcoder\t%s\tfake-aider-session\tCoder\taider\ttask\n' "$ROOT3" > "$ROOT3/.swarmforge/roles.tsv"
LOG3="$ROOT3/nightly.log"
LOG="$LOG3" ROOT="$ROOT3" RECRUITER_SPECIFIER_SCOUT_SCRIPT="$STUB_DIR/recruiter_specifier_scout.sh" RECRUITER_SPECIFIER_SCOUT_FORCE=1 bash -c "
set -uo pipefail
source '$SRC/recruiter_nightly.sh'
run_specifier_scout
" >/tmp/bl1821-t3.out 2>&1
check "3: a live local-pack aider seat stands the scout down" \
  "grep -q \"stood down - a local pack's aider seat is live\" '$LOG3'"
check "3: the stub scout never ran" \
  "! grep -q 'STUB SCOUT RAN' '$LOG3'"
tmux -S "$SOCK3" kill-server >/dev/null 2>&1 || true

rm -f /tmp/bl1821-t1.out /tmp/bl1821-t2.out /tmp/bl1821-t3.out

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS"
else
  exit 1
fi

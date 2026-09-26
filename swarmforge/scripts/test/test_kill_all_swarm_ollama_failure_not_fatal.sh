#!/usr/bin/env bash
# BL-1704 hardening (2026-09-25): the architect's bounce D1 gave
# stop_ancillary_services_main a regression test proving its ollama stop
# call is guarded with `|| true` under this file's own `set -euo
# pipefail`, but kill_all_swarm.sh's SIBLING call - which the architect's
# own evidence confirmed already carried `|| true` from the start, by
# reading, never by a test - had no test anywhere. A real, documented
# failure return from ollama_ancillary_stop_swarm_owned (a swarm-owned
# server or runner child surviving TERM+KILL) would abort kill_all_swarm.sh
# mid-script under set -euo pipefail if that `|| true` were ever
# accidentally dropped, silently skipping the babysitterd pidfile signal
# and the exec into kill_pipeline_swarm.sh - exactly the failure class the
# sibling test guards for stop_ancillary_services.sh.
#
# kill_all_swarm.sh sources ollama_ancillary_lib.sh and
# babysitterd_census_lib.sh by a fixed $SCRIPT_DIR-relative path and ends
# by exec'ing kill_pipeline_swarm.sh at that same fixed path - so, unlike
# the stop_ancillary_services.sh sibling test (which sources the file as a
# library and calls its own _main function directly), stubbing the ollama
# call here means running the REAL kill_all_swarm.sh from a throwaway
# directory carrying STUB siblings at those exact relative paths, never
# hand-mutating the real file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_KILL_ALL_SWARM="$SCRIPT_DIR/../kill_all_swarm.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

FAKE_SCRIPTS="$(mktemp -d)"
ROOT="$(mktemp -d)"
cleanup() { rm -rf "$FAKE_SCRIPTS" "$ROOT"; }
trap cleanup EXIT

cp "$REAL_KILL_ALL_SWARM" "$FAKE_SCRIPTS/kill_all_swarm.sh"
chmod +x "$FAKE_SCRIPTS/kill_all_swarm.sh"

cat > "$FAKE_SCRIPTS/babysitterd_census_lib.sh" <<'EOF'
babysitterd_census_signal() { :; }
EOF

cat > "$FAKE_SCRIPTS/ollama_ancillary_lib.sh" <<'EOF'
ollama_ancillary_stop_swarm_owned() {
  echo "STUB: ollama stop reporting failure" >&2
  return 1
}
EOF

cat > "$FAKE_SCRIPTS/kill_pipeline_swarm.sh" <<'EOF'
#!/usr/bin/env bash
echo "STUB: kill_pipeline_swarm.sh reached" >&2
exit 0
EOF
chmod +x "$FAKE_SCRIPTS/kill_pipeline_swarm.sh"

OUT="$(bash "$FAKE_SCRIPTS/kill_all_swarm.sh" "$ROOT" 2>&1)"
RC=$?

[[ "$RC" -eq 0 ]] || fail "expected kill_all_swarm.sh to exit 0 despite the ollama stop failing, got rc=$RC: $OUT"
pass "kill_all_swarm.sh exits 0 even when the ollama stop call fails"

echo "$OUT" | grep -q "STUB: ollama stop reporting failure" \
  || fail "expected the ollama stop stub to have been called, got: $OUT"
pass "the ollama stop call was reached"

echo "$OUT" | grep -q "STUB: kill_pipeline_swarm.sh reached" \
  || fail "expected kill_all_swarm.sh to still exec into kill_pipeline_swarm.sh after the ollama stop failed, got: $OUT"
pass "kill_all_swarm.sh still execs into kill_pipeline_swarm.sh - the ollama stop failure did not abort it"

echo "ALL PASS"

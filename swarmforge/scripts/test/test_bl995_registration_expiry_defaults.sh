#!/usr/bin/env bash
# BL-995 hardening addition: registration-expired? and its missing-field
# defaults, unit-tested directly (no process spawning - cheap, seconds not
# tens-of-seconds). The ticket's own invariant 2 text is "absence never
# buys protection": a torn/foreign registry entry missing expires_at_ms
# must read as ALREADY EXPIRED (reaped like any orphan), never as
# never-expiring. No existing acceptance scenario or property-runner draw
# constructs a registration missing this field - every fixture's own
# writer (detach_job.sh) always stamps it - so this behavior was
# previously unverified by anything.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPERVISOR="$SCRIPT_DIR/../handoffd_supervisor.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/.swarmforge/daemon"
# bl977 stop-file pattern: -main's while loop body never runs when this
# exists, so load-file returns immediately without starting the daemon.
touch "$ROOT/.swarmforge/daemon/stop"

OUT="$(bb -e "
(binding [*command-line-args* [\"$ROOT\"]]
  (load-file \"$SUPERVISOR\"))
(println (handoffd-supervisor/registration-expired? {} 1000))
(println (handoffd-supervisor/registration-expired? {:expires_at_ms 5000} 1000))
(println (handoffd-supervisor/registration-expired? {:expires_at_ms 500} 1000))
")"

MISSING="$(echo "$OUT" | sed -n '1p')"
NOT_YET="$(echo "$OUT" | sed -n '2p')"
PAST="$(echo "$OUT" | sed -n '3p')"

[[ "$MISSING" == "true" ]] || fail "a registration entry with no expires_at_ms must read as expired (got '$MISSING') - absence must never buy protection (invariant 2)"
[[ "$NOT_YET" == "false" ]] || fail "an entry expiring in the future must not read as expired (got '$NOT_YET')"
[[ "$PAST" == "true" ]] || fail "an entry whose expiry has passed must read as expired (got '$PAST')"

pass "registration-expired? treats a missing expires_at_ms as already-expired, never as immune (BL-995 invariant 2)"
echo "ALL PASS"

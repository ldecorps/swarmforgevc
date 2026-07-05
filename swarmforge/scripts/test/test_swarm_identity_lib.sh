#!/usr/bin/env bash
# BL-090: swarm_identity_lib.bb - reading this swarm's identity and a
# ticket's swarm: assignment field. Covers the "assignment-field handling"
# non-behavioral gate and the multi-swarm-02/03 acceptance scenarios at the
# library level (specifier routing judgment itself is role-prompt behavior,
# out of scope here - this proves the primitive it would call).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../swarm_identity_lib.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

run_bb() {
  bb -e "(load-file \"$LIB\") $1"
}

# ── 1: no swarm-identity file -> defaults to primary/autonomous ────────────
OUT="$(run_bb "(println (swarm-identity-lib/own-swarm-name \"$ROOT\"))")"
[[ "$OUT" == "primary" ]] || fail "01: expected default swarm name 'primary', got '$OUT'"
pass "01: an absent swarm-identity file defaults to the primary swarm"

# ── 2: an explicit swarm-identity file is read correctly ───────────────────
mkdir -p "$ROOT/.swarmforge"
printf 'swarm_name\tsecond\nswarm_mode\tsecondary\nswarm_mode_primary\tprimary\n' \
  > "$ROOT/.swarmforge/swarm-identity"
OUT="$(run_bb "(println (swarm-identity-lib/own-swarm-name \"$ROOT\"))")"
[[ "$OUT" == "second" ]] || fail "02: expected swarm name 'second', got '$OUT'"
pass "02: own-swarm-name reads the normalized swarm-identity file"

# ── 3: a ticket with no swarm: field defaults to the primary swarm ─────────
TICKET_NO_FIELD="$ROOT/ticket-no-field.yaml"
printf 'id: BL-100\ntitle: something\nstatus: active\n' > "$TICKET_NO_FIELD"
OUT="$(run_bb "(println (swarm-identity-lib/ticket-swarm \"$TICKET_NO_FIELD\"))")"
[[ "$OUT" == "primary" ]] || fail "03: expected default assignment 'primary', got '$OUT'"
pass "03: a ticket without a swarm: field is treated as assigned to the primary swarm (BL-090 multi-swarm-02)"

# ── 4: a ticket with an explicit swarm: field reports it verbatim ──────────
TICKET_WITH_FIELD="$ROOT/ticket-with-field.yaml"
printf 'id: BL-101\ntitle: something else\nstatus: active\nswarm: second\n' > "$TICKET_WITH_FIELD"
OUT="$(run_bb "(println (swarm-identity-lib/ticket-swarm \"$TICKET_WITH_FIELD\"))")"
[[ "$OUT" == "second" ]] || fail "04: expected assignment 'second', got '$OUT'"
pass "04: a ticket's explicit swarm: field is read verbatim"

# ── 5: belongs-to-own-swarm? - a foreign ticket does not belong to primary ─
rm "$ROOT/.swarmforge/swarm-identity"
OUT="$(run_bb "(println (swarm-identity-lib/belongs-to-own-swarm? \"$ROOT\" \"$TICKET_WITH_FIELD\"))")"
[[ "$OUT" == "false" ]] || fail "05: expected the primary swarm to NOT own a ticket assigned to 'second' (BL-090 multi-swarm-03)"
pass "05: belongs-to-own-swarm? is false for a ticket assigned to a different swarm"

# ── 6: belongs-to-own-swarm? - own swarm matches ────────────────────────────
OUT="$(run_bb "(println (swarm-identity-lib/belongs-to-own-swarm? \"$ROOT\" \"$TICKET_NO_FIELD\"))")"
[[ "$OUT" == "true" ]] || fail "06: expected the (default primary) swarm to own an unassigned ticket"
pass "06: belongs-to-own-swarm? is true when the ticket's assignment matches this swarm's own name"

echo "ALL PASS"

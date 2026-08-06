#!/usr/bin/env bash
# Regression: route_backlog_to_coder.sh's delivery-confirmation line must not
# use bash-4 ${ROLE^} — on macOS /bin/bash 3.2 that form is a bad substitution
# and, under set -euo pipefail, exits non-zero AFTER a successful route
# (briefing 2026-08-04..06: hit on every promote on this host).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROUTE_SH="$SCRIPT_DIR/../route_backlog_to_coder.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── 01: the bash-4 form must not appear in executable lines ────────────────
# Strip comments first so the explanatory note in the script cannot false-hit.
CODE_ONLY="$(grep -vE '^[[:space:]]*#' "$ROUTE_SH" || true)"
if printf '%s\n' "$CODE_ONLY" | grep -nE '\$\{[A-Za-z_]+\^\}' >/dev/null; then
  fail "01: route_backlog_to_coder.sh still contains a bash-4 caret case-transform"
fi
pass "01: no bash-4 caret case-transform in route_backlog_to_coder.sh executable lines"

# ── 02: the portable capitalize form works under /bin/bash (3.2 on macOS) ─
BASH_BIN="/bin/bash"
[[ -x "$BASH_BIN" ]] || BASH_BIN="$(command -v bash)"

OUT="$("$BASH_BIN" -c '
ROLE=coder
ROLE_LABEL="$(printf "%s" "${ROLE:0:1}" | tr "[:lower:]" "[:upper:]")${ROLE:1}"
printf "%s\n" "${ROLE_LABEL} inbox: /tmp/fake_for_coder.handoff"
')"
[[ "$OUT" == "Coder inbox: /tmp/fake_for_coder.handoff" ]] \
  || fail "02: portable capitalize under $BASH_BIN produced: $OUT"
pass "02: portable capitalize yields 'Coder inbox: …' under $BASH_BIN ($("$BASH_BIN" -c 'echo $BASH_VERSION'))"

# ── 03: the old form is rejected by bash 3.x (documents why we changed it) ─
MAJOR="$("$BASH_BIN" -c 'echo "${BASH_VERSINFO[0]}"')"
if [[ "$MAJOR" -lt 4 ]]; then
  if "$BASH_BIN" -c 'ROLE=coder; echo "${ROLE^}"' >/dev/null 2>&1; then
    fail "03: unexpected — bash $MAJOR accepted \${ROLE^}"
  fi
  pass "03: bash $MAJOR rejects \${ROLE^} (the pre-fix failure mode)"
else
  pass "03: skipped — host bash is $MAJOR (>=4); macOS /bin/bash 3.2 is the guarded case"
fi

echo "ALL PASS"

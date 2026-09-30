#!/usr/bin/env bash
# BL-1782 hardender bounce D1: verification_debt_ledger_update.bb's
# revert-on-commit-failure path must leave the ledger file EXACTLY as it
# was before the attempt - absent when it was absent, byte-identical when
# it held real content - never a header-only phantom file where none
# existed a moment before. Forces the failure deterministically via a
# fixture root with NO .git directory at all (commit_integrity_lib.bb's
# :no-git-dir refusal), no lock contention or timing needed.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../verification_debt_ledger_update.bb"
LEDGER_REL="backlog/verification-debt-ledger.yaml"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

# 01: a fresh root with no ledger file at all and no .git directory - a
#     forced commit failure on the VERY FIRST record must leave no file
#     behind at all, never a header-only one.
WORK1="$(mktemp -d)"
register_tmp_dir "$WORK1"
mkdir -p "$WORK1/backlog/paused" "$WORK1/backlog/active"
OUT1="$(bb "$CLI" "$WORK1" --record test-cat --ticket BL-1 --role QA --description "probe" 2>&1)"
EXIT1=$?
check "a forced commit failure on the first-ever record exits non-zero" '[[ "$EXIT1" -ne 0 ]]'
check "the failure names the reason" '[[ "$OUT1" == *"commit failed"* ]]'
check "no ledger file is left behind where none existed before" '[[ ! -e "$WORK1/$LEDGER_REL" ]]'

# 02: a real git repo with one real row already committed - a forced
#     commit failure on a SECOND record must restore the file
#     byte-for-byte identical to its pre-attempt content.
WORK2="$(mktemp -d)"
register_tmp_dir "$WORK2"
(
  cd "$WORK2" || exit 1
  git init -q
  git config user.email t@t
  git config user.name t
  mkdir -p backlog/paused backlog/active
  echo hi > README.md
  git add -A
  git commit -q -m init
)
bb "$CLI" "$WORK2" --record test-cat --ticket BL-1 --role QA --description "first" > /dev/null
ORIG_HASH="$(sha256sum "$WORK2/$LEDGER_REL" | awk '{print $1}')"
rm -rf "$WORK2/.git"
OUT2="$(bb "$CLI" "$WORK2" --record test-cat --ticket BL-2 --role QA --description "second" 2>&1)"
EXIT2=$?
AFTER_HASH="$(sha256sum "$WORK2/$LEDGER_REL" | awk '{print $1}')"
check "a forced commit failure on a second record exits non-zero" '[[ "$EXIT2" -ne 0 ]]'
check "an existing ledger with real rows is restored byte-identical" '[[ "$ORIG_HASH" == "$AFTER_HASH" ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "ALL PASS"
  exit 0
else
  exit 1
fi

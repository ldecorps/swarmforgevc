#!/usr/bin/env bash
# BL-628: lib/host_bootstrap.sh - the shape-agnostic bare-host bootstrap
# steps (packages, pinned substrate, DISABLE_AUTOUPDATER, clone) lifted out
# for provision_autonomous_host.sh to reuse. BOOTSTRAP_DRYRUN=1 is this
# library's own seam - no sudo, no download, no clone - so this suite
# proves the exact action set without touching the real host, mirroring
# provision_primary_host.sh's own PROVISION_PRIMARY_DRYRUN convention
# (test_provision_primary_host.sh).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
LIB="$SCRIPT_DIR/../../deploy/lib/host_bootstrap.sh"
LOCK_FILE="$SCRIPT_DIR/../../../swarmforge.lock.json"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[[ -f "$LOCK_FILE" ]] || fail "swarmforge.lock.json not found at $LOCK_FILE"

# shellcheck source=../../deploy/lib/host_bootstrap.sh
source "$LIB"

# ── headless guarantee: every install goes through the pinned lock file,
#    never a floating "latest" URL (autonomous-bootstrap-03) ───────────────
BB_VERSION="$(bootstrap_lock_value "$LOCK_FILE" "data['secondary_host_substrate']['babashka']['version']")"
[[ -n "$BB_VERSION" ]] || fail "expected a non-empty pinned babashka version from the lock file"
pass "headless guarantee: babashka version is read from the pinned lock file ($BB_VERSION), not a floating URL"

NODE_MAJOR="$(bootstrap_lock_value "$LOCK_FILE" "data['secondary_host_substrate']['node']['major']")"
[[ -n "$NODE_MAJOR" ]] || fail "expected a non-empty pinned node major version from the lock file"
pass "headless guarantee: node major version is read from the pinned lock file ($NODE_MAJOR.x), not 'latest'"

CLAUDE_VERSION="$(bootstrap_lock_value "$LOCK_FILE" "data['secondary_host_substrate']['claude_cli']['version']")"
[[ -n "$CLAUDE_VERSION" ]] || fail "expected a non-empty pinned claude CLI version from the lock file"
pass "headless guarantee: claude CLI version is read from the pinned lock file ($CLAUDE_VERSION), not 'latest'/'stable'"

# ── invariant 1 (dry-run mutates nothing): every mutating function prints
#    a DRYRUN line and performs the real action zero times ─────────────────
BOOTSTRAP_DRYRUN=1

OUT="$(bootstrap_install_base_packages)"
grep -q "^DRYRUN: apt-get" <<< "$OUT" || fail "expected a DRYRUN line for base package install; got: $OUT"
pass "dry-run: package install (base packages) is printed, never run"

# gh is present on this dev host in the common case - force the
# not-yet-installed branch by shadowing `command` so the dry-run print path
# is genuinely exercised regardless of the host's own gh installation.
OUT="$(command() { if [[ "$1" == "-v" && "$2" == "gh" ]]; then return 1; fi; builtin command "$@"; }; bootstrap_install_gh)"
grep -q "^DRYRUN:.*gh" <<< "$OUT" || fail "expected a DRYRUN line for gh install; got: $OUT"
pass "dry-run: package install (gh) is printed, never run"

OUT="$(bootstrap_install_babashka "$LOCK_FILE" "x86_64")"
grep -qi "^DRYRUN:.*babashka\|^DRYRUN:.*bb " <<< "$OUT" || {
  # babashka may already be installed at the pinned version on this dev
  # host, in which case the function is a no-op (matches the real script's
  # own idempotent guard) - force the install branch to actually exercise
  # the dry-run print.
  OUT2="$(bb() { return 127; }; command() { if [[ "$1" == "-v" && "$2" == "bb" ]]; then return 1; fi; builtin command "$@"; }; bootstrap_install_babashka "$LOCK_FILE" "x86_64")"
  grep -qi "download.*babashka" <<< "$OUT2" || fail "expected a DRYRUN line for babashka install; got: $OUT / $OUT2"
}
pass "dry-run: package install (babashka) is printed, never run"

OUT="$(command() { if [[ "$1" == "-v" && "$2" == "node" ]]; then return 1; fi; builtin command "$@"; }; bootstrap_install_node "$LOCK_FILE")"
grep -qi "^DRYRUN:.*node" <<< "$OUT" || fail "expected a DRYRUN line for node install; got: $OUT"
pass "dry-run: package install (node) is printed, never run"

OUT="$(command() { if [[ "$1" == "-v" && "$2" == "claude" ]]; then return 1; fi; builtin command "$@"; }; bootstrap_install_claude_cli "$LOCK_FILE")"
grep -qi "^DRYRUN:.*claude" <<< "$OUT" || fail "expected a DRYRUN line for claude CLI install; got: $OUT"
grep -qi "^DRYRUN:.*DISABLE_AUTOUPDATER" <<< "$OUT" || fail "expected a DRYRUN line for the DISABLE_AUTOUPDATER file write; got: $OUT"
pass "dry-run: package install (claude CLI) AND the DISABLE_AUTOUPDATER file write are both printed, never run"
pass "headless guarantee: the agent auto-updater is disabled for the service environment (DISABLE_AUTOUPDATER=1), dry-run included"

FAKE_PROJECT_ROOT="$(mktemp -d)"; register_tmp_dir "$FAKE_PROJECT_ROOT"
rm -rf "$FAKE_PROJECT_ROOT"
OUT="$(bootstrap_clone_repo "git@example.com:acme/widget.git" "$FAKE_PROJECT_ROOT")"
grep -q "^DRYRUN: git clone" <<< "$OUT" || fail "expected a DRYRUN line for the repo clone (a file write); got: $OUT"
[[ ! -d "$FAKE_PROJECT_ROOT" ]] || fail "dry-run must not actually create the project root via a real clone"
pass "dry-run: file write (git clone) is printed, never run - no directory is actually created"

# ── real-run guard: with BOOTSTRAP_DRYRUN unset, bootstrap_clone_repo
#    actually shells out to git (proving the dry-run branch above is not
#    vacuously always taken) ────────────────────────────────────────────
unset BOOTSTRAP_DRYRUN
SRC_REPO="$(mktemp -d)"; register_tmp_dir "$SRC_REPO"
(cd "$SRC_REPO" && git init -q && git config user.email t@t && git config user.name t && touch f && git add -A && git commit -q -m seed)
DEST="$(mktemp -d)"; register_tmp_dir "$DEST"
rm -rf "$DEST"
bootstrap_clone_repo "$SRC_REPO" "$DEST" >/dev/null
[[ -d "$DEST/.git" ]] || fail "expected a real clone when BOOTSTRAP_DRYRUN is unset"
pass "non-vacuity: with BOOTSTRAP_DRYRUN unset, bootstrap_clone_repo performs a real clone"

# Idempotent: re-running against an already-cloned dir is a safe no-op.
bootstrap_clone_repo "$SRC_REPO" "$DEST" >/dev/null
pass "bootstrap_clone_repo is idempotent - a second call against an already-cloned dir does not error"

echo "ALL PASS"

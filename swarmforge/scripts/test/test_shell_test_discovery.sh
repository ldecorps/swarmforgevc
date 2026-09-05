#!/usr/bin/env bash
# BL-724: shell-test discovery sweep — fails loud on unaccounted / untracked
# test_*.sh under swarmforge/scripts/test/. Fixture-driven; also proves the
# historic mono-router orphan is never silently "accounted for".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$SCRIPT_DIR/shell_test_discovery_cli.bb"
LIB="$SCRIPT_DIR/shell_test_discovery_lib.bb"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture helpers ─────────────────────────────────────────────────────────
mk_repo() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  git -C "$d" init -q
  git -C "$d" config user.email t@t
  git -C "$d" config user.name t
  mkdir -p "$d/swarmforge/scripts/test"
  # minimal manifest header
  printf '# test manifest\n' > "$d/swarmforge/scripts/test/suite-manifest.tsv"
  echo "$d"
}

track() {
  local root="$1"; shift
  (cd "$root" && git add "$@" && git commit -q -m "add $*")
}

# ── 01: tracked standing test is reached ────────────────────────────────────
R="$(mk_repo)"
printf 'echo ok\n' > "$R/swarmforge/scripts/test/test_reached.sh"
printf 'test_reached.sh\tstanding\t\t\n' >> "$R/swarmforge/scripts/test/suite-manifest.tsv"
track "$R" swarmforge/scripts/test/test_reached.sh swarmforge/scripts/test/suite-manifest.tsv
OUT="$(bb "$CLI" "$R")"
echo "$OUT" | grep -q 'shell_test_discovery: ok' || fail "01: expected ok; got: $OUT"
LABEL="$(bb -e "
(load-file \"$LIB\")
(load-file \"$SCRIPT_DIR/suite_inventory_lib.bb\")
(def root \"$R\")
(def tracked (shell-test-discovery-lib/tracked-shell-tests root))
(def untracked (shell-test-discovery-lib/untracked-shell-tests root))
(def rows (suite-inventory-lib/parse-manifest (slurp (str root \"/swarmforge/scripts/test/suite-manifest.tsv\"))))
(println (name (shell-test-discovery-lib/account-label \"test_reached.sh\" tracked untracked rows)))
")"
[[ "$LABEL" == "reached" ]] || fail "01: expected reached; got $LABEL"
pass "01: tracked test reached by the sweep"
rm -rf "$R"

# ── 02: excluded with reason ────────────────────────────────────────────────
R="$(mk_repo)"
printf 'echo manual\n' > "$R/swarmforge/scripts/test/test_manual.sh"
printf 'test_manual.sh\texcluded\t2026-07-30\tneeds a live tmux server\n' \
  >> "$R/swarmforge/scripts/test/suite-manifest.tsv"
track "$R" swarmforge/scripts/test/test_manual.sh swarmforge/scripts/test/suite-manifest.tsv
OUT="$(bb "$CLI" "$R")"
echo "$OUT" | grep -q 'shell_test_discovery: ok' || fail "02: expected ok; got: $OUT"
LABEL="$(bb -e "
(load-file \"$LIB\")
(load-file \"$SCRIPT_DIR/suite_inventory_lib.bb\")
(def root \"$R\")
(def tracked (shell-test-discovery-lib/tracked-shell-tests root))
(def untracked (shell-test-discovery-lib/untracked-shell-tests root))
(def rows (suite-inventory-lib/parse-manifest (slurp (str root \"/swarmforge/scripts/test/suite-manifest.tsv\"))))
(println (name (shell-test-discovery-lib/account-label \"test_manual.sh\" tracked untracked rows)))
")"
[[ "$LABEL" == "excluded" ]] || fail "02: expected excluded; got $LABEL"
# reason surfaces via suite inventory path when we ask check — excluded ok means reason present
pass "02: excluded test accounted without running"
rm -rf "$R"

# ── 03a: untracked orphan ───────────────────────────────────────────────────
R="$(mk_repo)"
printf 'test_reached.sh\tstanding\t\t\n' >> "$R/swarmforge/scripts/test/suite-manifest.tsv"
printf 'echo ok\n' > "$R/swarmforge/scripts/test/test_reached.sh"
track "$R" swarmforge/scripts/test/test_reached.sh swarmforge/scripts/test/suite-manifest.tsv
printf 'echo orphan\n' > "$R/swarmforge/scripts/test/test_orphan.sh"
set +e
OUT="$(bb "$CLI" "$R" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "03a: expected non-zero for untracked orphan"
echo "$OUT" | grep -q 'untracked orphan: test_orphan.sh' \
  || fail "03a: missing untracked orphan label; got: $OUT"
pass "03a: untracked orphan fails loud"
CLEAN_OUT="$(bb "$CLI" "$R" 2>/dev/null || true)" # still dirty
# 04: output differs from clean — rebuild clean twin
R2="$(mk_repo)"
printf 'test_reached.sh\tstanding\t\t\n' >> "$R2/swarmforge/scripts/test/suite-manifest.tsv"
printf 'echo ok\n' > "$R2/swarmforge/scripts/test/test_reached.sh"
track "$R2" swarmforge/scripts/test/test_reached.sh swarmforge/scripts/test/suite-manifest.tsv
CLEAN="$(bb "$CLI" "$R2")"
[[ "$OUT" != "$CLEAN" ]] || fail "04: dirty output looked identical to clean"
pass "04: untracked run differs from clean tracked-only sweep"
rm -rf "$R" "$R2"

# ── 03b: tracked but unlisted ───────────────────────────────────────────────
R="$(mk_repo)"
printf 'echo x\n' > "$R/swarmforge/scripts/test/test_orphan.sh"
# empty manifest (header only)
track "$R" swarmforge/scripts/test/test_orphan.sh swarmforge/scripts/test/suite-manifest.tsv
set +e
OUT="$(bb "$CLI" "$R" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "03b: expected fail"
echo "$OUT" | grep -q 'unaccounted test: test_orphan.sh' \
  || fail "03b: missing unaccounted label; got: $OUT"
pass "03b: tracked but unlisted fails as unaccounted"
rm -rf "$R"

# ── 03c: excluded with no reason ────────────────────────────────────────────
R="$(mk_repo)"
printf 'echo x\n' > "$R/swarmforge/scripts/test/test_bare.sh"
printf 'test_bare.sh\texcluded\t2026-07-30\t\n' >> "$R/swarmforge/scripts/test/suite-manifest.tsv"
track "$R" swarmforge/scripts/test/test_bare.sh swarmforge/scripts/test/suite-manifest.tsv
set +e
OUT="$(bb "$CLI" "$R" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "03c: expected fail"
echo "$OUT" | grep -qi 'exclusion missing its reason' \
  || fail "03c: missing reason label; got: $OUT"
pass "03c: exclusion missing reason fails loud"
rm -rf "$R"

# ── 03d: stale exclusion ────────────────────────────────────────────────────
R="$(mk_repo)"
printf 'test_gone.sh\texcluded\t2026-07-30\tlive-only\n' >> "$R/swarmforge/scripts/test/suite-manifest.tsv"
track "$R" swarmforge/scripts/test/suite-manifest.tsv
set +e
OUT="$(bb "$CLI" "$R" 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "03d: expected fail"
echo "$OUT" | grep -q 'stale exclusion: test_gone.sh' \
  || fail "03d: missing stale exclusion; got: $OUT"
pass "03d: stale exclusion fails loud"
rm -rf "$R"

# ── 05: live orphan is never accounted as reached/excluded ──────────────────
ORPHAN=test_swarm_handoff_mono_router_auto_rotate.sh
LABEL="$(bb -e "
(load-file \"$LIB\")
(load-file \"$SCRIPT_DIR/suite_inventory_lib.bb\")
(def root \"$REPO_ROOT\")
(def tracked (shell-test-discovery-lib/tracked-shell-tests root))
(def untracked (shell-test-discovery-lib/untracked-shell-tests root))
(def rows (suite-inventory-lib/parse-manifest
            (slurp (str root \"/swarmforge/scripts/test/suite-manifest.tsv\"))))
(println (name (shell-test-discovery-lib/account-label \"$ORPHAN\" tracked untracked rows)))
")"
case "$LABEL" in
  reached|excluded) fail "05: live orphan must not be accounted as $LABEL" ;;
esac
pass "05: live orphan $ORPHAN is not accounted as reached/excluded (label=$LABEL)"

echo "ALL PASS"

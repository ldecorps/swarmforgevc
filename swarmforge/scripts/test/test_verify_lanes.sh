#!/usr/bin/env bash
# BL-1618: verify_lanes.sh holds the per-role lane table in one place,
# prints the plan a role runs, runs exactly that plan sequentially, and
# refuses an unknown role rather than running everything. Drives the REAL
# script against a real git fixture (BL-1390: a fresh git init under
# mkdtemp, proven isolated by rev-parse --git-common-dir before any
# mutating git call) with a fake npm and a fake run_acceptance.sh on PATH -
# never the real lanes (BL-1541: seconds, not minutes).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/tmp_cleanup.sh
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir "$ROOT"

git -C "$ROOT" init -q -b main .
# BL-1390: prove the fixture is a genuinely fresh, isolated git init BEFORE
# any mutating git call - never the live checkout or a shared worktree.
COMMON_DIR="$(git -C "$ROOT" rev-parse --git-common-dir)"
RESOLVED_COMMON_DIR="$(cd "$ROOT" && cd "$(dirname "$COMMON_DIR")" && pwd -P)/$(basename "$COMMON_DIR")"
case "$RESOLVED_COMMON_DIR" in
  "$ROOT"/*|"$ROOT") : ;;
  *) fail "fixture git-common-dir does not resolve inside the fixture root (BL-1390): $RESOLVED_COMMON_DIR" ;;
esac
git -C "$ROOT" config user.email t@t
git -C "$ROOT" config user.name t
git -C "$ROOT" config commit.gpgsign false
echo seed > "$ROOT/seed.txt"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m seed

mkdir -p "$ROOT/swarmforge/scripts"
cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$ROOT/swarmforge/scripts/"
chmod +x "$ROOT/swarmforge/scripts/"*.sh

mkdir -p "$ROOT/.swarmforge"
cat > "$ROOT/.swarmforge/roles.tsv" <<EOF
coder	coder	$ROOT	swarmforge-coder	Coder	claude	task
cleaner	cleaner	$ROOT	swarmforge-cleaner	Cleaner	claude	batch
documenter	documenter	$ROOT	swarmforge-documenter	Documenter	claude	task
QA	QA	$ROOT	swarmforge-QA	Qa	claude	task
EOF

mkdir -p "$ROOT/backlog/active"
cat > "$ROOT/backlog/active/BL-9002-fixture.yaml" <<'EOF'
id: BL-9002
title: "fixture"
status: todo
assigned_to: coder
acceptance: specs/features/BL-9002-fixture.feature
EOF
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "ticket + scripts + roles.tsv"
git -C "$ROOT" update-ref refs/remotes/origin/main "$(git -C "$ROOT" rev-parse HEAD)"

FAKE_BIN="$ROOT/fake-bin"
mkdir -p "$FAKE_BIN"
NPM_LOG="$ROOT/npm.log"
: > "$NPM_LOG"
FAIL_ARG_FILE="$ROOT/.fail-npm-arg"
cat > "$FAKE_BIN/npm" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$NPM_LOG"
if [[ -f "$FAIL_ARG_FILE" ]] && [[ "\$*" == *"\$(cat "$FAIL_ARG_FILE")"* ]]; then
  echo "fake npm: forced failure for: \$*" >&2
  exit 1
fi
exit 0
EOF
chmod +x "$FAKE_BIN/npm"
RA_LOG="$ROOT/run_acceptance.log"
cat > "$FAKE_BIN/run_acceptance.sh" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$RA_LOG"
exit 0
EOF
chmod +x "$FAKE_BIN/run_acceptance.sh"

VERIFY_LANES="$ROOT/swarmforge/scripts/verify_lanes.sh"

run_plan() {  # role
  PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="$1" bash "$VERIFY_LANES" --plan
}

run_lanes() {  # role -> sets OUT, RC
  set +e
  OUT="$(cd "$ROOT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="$1" bash "$VERIFY_LANES" 2>&1)"
  RC=$?
  set -e
}

# ── 01: the coder plan is fixed regardless of changed paths ────────────────
PLAN="$(run_plan coder)"
[[ "$PLAN" == $'compile\nunit\nproperties\nacceptance-own' ]] \
  || fail "01: expected coder's fixed plan, got: $PLAN"
pass "01: coder's plan is compile, unit, properties, acceptance-own"

# ── 02: cleaner's plan depends on changed paths ─────────────────────────────
PLAN="$(run_plan cleaner)"
[[ "$PLAN" == $'compile\nacceptance-own' ]] \
  || fail "02a: expected cleaner's docs-only plan, got: $PLAN"
pass "02a: cleaner with no code change plans compile, acceptance-own"

mkdir -p "$ROOT/extension/src"
echo 'export const x = 1;' > "$ROOT/extension/src/foo.ts"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "touch extension/src"

PLAN="$(run_plan cleaner)"
[[ "$PLAN" == $'compile\nunit\nacceptance-own' ]] \
  || fail "02b: expected cleaner's extension/src plan, got: $PLAN"
pass "02b: cleaner touching extension/src plans compile, unit, acceptance-own"

# ── 03: a *.property.test.js path also fires the properties lane ──────────
mkdir -p "$ROOT/extension/test"
echo "test('p', () => {});" > "$ROOT/extension/test/bl9002Invariant.property.test.js"
git -C "$ROOT" add -A
git -C "$ROOT" commit -q -m "touch a property test"

PLAN="$(run_plan cleaner)"
[[ "$PLAN" == $'compile\nunit\nproperties\nacceptance-own' ]] \
  || fail "03: expected cleaner's property-test plan, got: $PLAN"
pass "03: a *.property.test.js path also fires unit and properties"

# ── 04: hardender and QA plans are fixed ──────────────────────────────────
PLAN="$(run_plan hardender)"
[[ "$PLAN" == $'compile\nunit\nmutation\nacceptance-own' ]] \
  || fail "04a: expected hardender's fixed plan, got: $PLAN"
pass "04a: hardender's plan is compile, unit, mutation, acceptance-own"

PLAN="$(run_plan QA)"
[[ "$PLAN" == $'compile\nunit\nchanged-path\nproperties\nacceptance-own' ]] \
  || fail "04b: expected QA's fixed plan, got: $PLAN"
pass "04b: QA's plan is compile, unit, changed-path, properties, acceptance-own"

# ── 05: an unknown role is refused, never run-everything ──────────────────
set +e
OUT="$(PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE=gardener bash "$VERIFY_LANES" --plan 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "05: expected a non-zero exit for an unknown role, got 0"
echo "$OUT" | grep -qi "unknown role 'gardener'" || fail "05: expected the refusal to name gardener, got: $OUT"
pass "05: an unknown role is refused, naming it"

# ── 06: an @-seat maps to its stage ─────────────────────────────────────────
PLAN="$(run_plan coder@2)"
[[ "$PLAN" == $'compile\nunit\nproperties\nacceptance-own' ]] \
  || fail "06: expected coder@2 to plan as coder, got: $PLAN"
pass "06: an @-seat (coder@2) plans as its stage (coder)"

# ── 07: the run executes the plan sequentially, stopping at the first failure ─
echo "test" > "$FAIL_ARG_FILE"
: > "$NPM_LOG"
rm -f "$RA_LOG"
run_lanes cleaner
[[ "$RC" -ne 0 ]] || fail "07: expected a non-zero exit when the unit lane fails"
NPM_INVOCATIONS="$(cat "$NPM_LOG")"
[[ "$NPM_INVOCATIONS" == $'run compile\ntest' ]] \
  || fail "07: expected exactly [run compile, test], got: $NPM_INVOCATIONS"
[[ ! -f "$RA_LOG" ]] || fail "07: run_acceptance.sh must never have run (acceptance-own never reached)"
echo "$OUT" | grep -q "FAILED at lane 'unit'" || fail "07: expected the verdict to name the failed lane, got: $OUT"
pass "07: the run stops at the first failed lane and names it"
rm -f "$FAIL_ARG_FILE"

echo "ALL PASS"

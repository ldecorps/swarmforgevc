#!/usr/bin/env bash
# BL-1398: the commit-guard property fixture derives its guard set from the
# runner, so a guard added to the chain can never turn the fixture red.
#
# BL-1385's check_handler_module_graph.sh landed on 2026-09-04, the fixture's
# hand-written list did not have it, its runner could not find it, and the
# property test went red on main saying nothing about any guard being wrong.
# BL-1395's guard would have done it again a day later.
#
# The derivation is JavaScript (the fixture is a JS property test), so each
# check below drives helpers/commitGuardFixtureSet.js through node.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$REPO_ROOT/extension/test/helpers/commitGuardFixtureSet.js"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1398-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1398_SUITE_BOUND_SECONDS:-600}" "$@"
trap 'rm -rf "$WORK"' EXIT

# A seam tree: a runner copy naming whichever guards a case wants, the chain
# lib the hooks source, and the two hooks. Never the live runner - this suite
# reads the real one, and writes only inside $WORK.
make_seam() {  # make_seam <name> <guard-name>...
  local name="$1"; shift
  seam="$WORK/$name"
  mkdir -p "$seam/swarmforge/scripts" "$seam/swarmforge/git-hooks"
  cp "$REPO_ROOT/swarmforge/scripts/commit_guard_chain_lib.sh" "$seam/swarmforge/scripts/"
  {
    echo '#!/usr/bin/env bash'
    echo 'set -uo pipefail'
    echo 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"'
    # GUARD_DIR is what commit_guard_chain_lib.sh's run_guard execs from; the
    # real runner sets it the same way.
    echo 'GUARD_DIR="$SCRIPT_DIR"'
    echo '. "$SCRIPT_DIR/commit_guard_chain_lib.sh"'
    local g
    for g in "$@"; do echo "run_guard $g"; done
  } > "$seam/swarmforge/scripts/run_commit_guards.sh"
  chmod +x "$seam/swarmforge/scripts/run_commit_guards.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$seam/swarmforge/git-hooks/pre-commit"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$seam/swarmforge/git-hooks/pre-merge-commit"
  chmod +x "$seam/swarmforge/git-hooks/pre-commit" "$seam/swarmforge/git-hooks/pre-merge-commit"
}

plant_guard() {  # plant_guard <seam> <name> [marker-file]
  local marker="${3:-}"
  {
    echo '#!/usr/bin/env bash'
    [[ -n "$marker" ]] && echo "printf 'ran\\n' >> '$marker'"
    echo 'exit 0'
  } > "$1/swarmforge/scripts/$2"
  chmod +x "$1/swarmforge/scripts/$2"
}

derive() {  # derive <repo-root> -> JSON on stdout, non-zero + message on refusal
  node -e '
    const { deriveCommitGuardFixtureSet } = require(process.argv[1]);
    try {
      const r = deriveCommitGuardFixtureSet({ repoRoot: process.argv[2] });
      process.stdout.write(JSON.stringify({ files: r.files, guards: r.guards }));
    } catch (e) {
      process.stderr.write(String(e && e.message));
      process.exit(3);
    }
  ' "$HELPER" "$1" 2>&1
}

# ── 1. a guard added to the runner appears in the set, no test edited ────
make_seam added check_alpha_probe.sh check_beta_probe.sh
plant_guard "$seam" check_alpha_probe.sh
plant_guard "$seam" check_beta_probe.sh
out="$(derive "$seam")"
if grep -q 'check_beta_probe.sh' <<<"$out"; then
  pass "a guard added to the runner appears in the fixture's set"
else
  fail "the added guard is missing from the derived set: $out"
fi

# ── 1b. and the chain in the fixture actually RUNS it ────────────────────
marker="$WORK/added-ran.txt"
plant_guard "$seam" check_beta_probe.sh "$marker"
( cd "$seam" && ./swarmforge/scripts/run_commit_guards.sh "$seam" >/dev/null 2>&1 )
if [[ -s "$marker" ]]; then
  pass "the guard chain in the fixture runs the added guard"
else
  fail "the added guard was copied but never ran"
fi

# ── 2. a guard removed from the runner leaves the set ────────────────────
make_seam removed check_alpha_probe.sh
plant_guard "$seam" check_alpha_probe.sh
plant_guard "$seam" check_beta_probe.sh   # present on the tree, no longer named
out="$(derive "$seam")"
if grep -q 'check_alpha_probe.sh' <<<"$out" && ! grep -q 'check_beta_probe.sh' <<<"$out"; then
  pass "a guard the runner no longer names is no longer copied"
else
  fail "the removed guard is still in the set: $out"
fi

# ── 3. a guard the runner names but the tree lacks fails LOUD ────────────
make_seam missing check_alpha_probe.sh check_zzz_probe.sh
plant_guard "$seam" check_alpha_probe.sh
out="$(derive "$seam")"; rc=$?
if (( rc != 0 )) && grep -q 'check_zzz_probe.sh' <<<"$out"; then
  pass "a guard the runner names but the tree lacks refuses, naming it"
else
  fail "a missing guard was skipped silently (rc=$rc): $out"
fi

# ── 4. against the REAL runner: every guard it names is in the set ───────
out="$(derive "$REPO_ROOT")"
missing=""
while IFS= read -r g; do
  [[ -n "$g" ]] || continue
  grep -q "\"$g\"" <<<"$out" || missing+="$g "
done < <(grep -E '^[[:space:]]*run_guard[[:space:]]' "$REPO_ROOT/swarmforge/scripts/run_commit_guards.sh" \
         | sed -E 's/^[[:space:]]*run_guard[[:space:]]+([^[:space:]]+).*/\1/')
if [[ -z "$missing" ]]; then
  pass "every guard the real runner names is in the derived set"
else
  fail "the derived set is missing real guards: $missing"
fi
if grep -q 'check_handler_module_graph.sh' <<<"$out"; then
  pass "including check_handler_module_graph.sh, the guard whose absence caused the red"
else
  fail "the BL-1385 guard is still missing from the set"
fi

# ── 5. the fixture test itself is green against the real runner ──────────
if ( cd "$REPO_ROOT/extension" && timeout 600 npx vitest run --config vitest.properties.config.mjs \
       test/bl632CommitTimeGuardInvariants.property.test.js >"$WORK/bl632.log" 2>&1 ); then
  pass "bl632CommitTimeGuardInvariants is green against the real runner"
else
  fail "the fixture property test is still red: $(tail -3 "$WORK/bl632.log")"
fi

# ── 6. no hand-written guard list is left in the fixture ─────────────────
if grep -qE "^\s*'swarmforge/scripts/check_[a-z_]+\.sh'," \
     "$REPO_ROOT/extension/test/bl632CommitTimeGuardInvariants.property.test.js"; then
  fail "the fixture still lists guards by hand - the set must be derived"
else
  pass "the fixture lists no guard by hand"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status

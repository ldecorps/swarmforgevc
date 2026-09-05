#!/usr/bin/env bash
# BL-1401: the BL-632 acceptance handler derives its fixture's guard set from
# the runner, through the ONE helper BL-1398 shipped.
#
# The handler copied the real guards from a hand-written list. BL-1385's
# check_handler_module_graph.sh joined the runner on 2026-09-04, the list did
# not, the fixture's chain died with exit 127, and BL-632's feature - the
# commit-time guard's only executable acceptance - went 4 pass / 7 fail with
# every guard behaving correctly.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HANDLER="$REPO_ROOT/specs/pipeline/steps/bl632CommitTimeGuardSteps.js"
HELPER="$REPO_ROOT/extension/test/helpers/commitGuardFixtureSet.js"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1401-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1401_SUITE_BOUND_SECONDS:-1200}" "$@"
trap 'rm -rf "$WORK"' EXIT

# ── 01: BL-632's feature is green against the runner as it stands ────────
if ( cd "$REPO_ROOT" && timeout 900 specs/pipeline/scripts/run_acceptance.sh \
       specs/features/BL-632-commit-time-guard-refuses-pipeline-code-on-main.feature \
       > "$WORK/bl632.log" 2>&1 ); then
  if grep -qE '^# fail 0$' "$WORK/bl632.log"; then
    pass "the BL-632 feature passes every scenario against the real runner"
  else
    fail "BL-632 ran but not clean: $(grep -E '^# (pass|fail)' "$WORK/bl632.log" | tr '\n' ' ')"
  fi
else
  fail "the BL-632 feature is still red: $(grep -E '^# (pass|fail)|not ok' "$WORK/bl632.log" | head -3 | tr '\n' ' ')"
fi

# ── 02: the handler consumes the helper, and the set follows the runner ──
if grep -q 'deriveCommitGuardFixtureSet' "$HANDLER"; then
  pass "the acceptance handler consumes BL-1398's helper for its guard set"
else
  fail "the handler does not use the shared helper"
fi

# Invariant 3: exactly ONE parser of the runner's guard lines exists. The
# handler may MENTION run_guard in prose; what it must not carry is a regex
# over those lines.
if grep -qE 'run_guard[^ ]*\\s*\(\?|/\^\[.*run_guard|match.*run_guard' "$HANDLER"; then
  fail "the handler carries a second parse of the runner's run_guard lines"
else
  pass "the handler carries no second parse of the runner's guard lines"
fi

# The derived set really does follow a runner: a seam naming an extra guard
# yields it, and the guard chain in a fixture built from that seam runs it.
SEAM="$WORK/seam"
mkdir -p "$SEAM/swarmforge/scripts" "$SEAM/swarmforge/git-hooks"
cp "$REPO_ROOT/swarmforge/scripts/commit_guard_chain_lib.sh" "$SEAM/swarmforge/scripts/"
{
  echo '#!/usr/bin/env bash'
  echo 'set -uo pipefail'
  echo 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"'
  echo 'GUARD_DIR="$SCRIPT_DIR"'
  echo '. "$SCRIPT_DIR/commit_guard_chain_lib.sh"'
  echo 'run_guard check_extra_probe.sh'
} > "$SEAM/swarmforge/scripts/run_commit_guards.sh"
chmod +x "$SEAM/swarmforge/scripts/run_commit_guards.sh"
printf '#!/usr/bin/env bash\nprintf ran >> %s/marker\nexit 0\n' "$WORK" > "$SEAM/swarmforge/scripts/check_extra_probe.sh"
chmod +x "$SEAM/swarmforge/scripts/check_extra_probe.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SEAM/swarmforge/git-hooks/pre-commit"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SEAM/swarmforge/git-hooks/pre-merge-commit"
chmod +x "$SEAM/swarmforge/git-hooks/"*

derived="$(node -e '
  const { deriveCommitGuardFixtureSet } = require(process.argv[1]);
  try { process.stdout.write(JSON.stringify(deriveCommitGuardFixtureSet({ repoRoot: process.argv[2] }).files)); }
  catch (e) { process.stderr.write(String(e && e.message)); process.exit(3); }
' "$HELPER" "$SEAM" 2>&1)"
if grep -q 'check_extra_probe.sh' <<<"$derived"; then
  pass "a guard added to the runner appears in the fixture's set with no handler edit"
else
  fail "the added guard is missing from the derived set: $derived"
fi
( cd "$SEAM" && ./swarmforge/scripts/run_commit_guards.sh "$SEAM" >/dev/null 2>&1 )
if [[ -s "$WORK/marker" ]]; then
  pass "and the guard chain in the fixture runs it"
else
  fail "the added guard was copied but never ran"
fi

# ── 03: a guard the runner names but the tree lacks fails LOUD ───────────
rm -f "$SEAM/swarmforge/scripts/check_extra_probe.sh"
out="$(node -e '
  const { deriveCommitGuardFixtureSet } = require(process.argv[1]);
  try { deriveCommitGuardFixtureSet({ repoRoot: process.argv[2] }); console.log("NO REFUSAL"); }
  catch (e) { console.log(String(e && e.message)); }
' "$HELPER" "$SEAM" 2>&1)"
if grep -q 'check_extra_probe.sh' <<<"$out" && ! grep -q 'NO REFUSAL' <<<"$out"; then
  pass "a guard the runner names but the tree lacks fails the build, naming it"
else
  fail "a missing guard was skipped silently: $out"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status

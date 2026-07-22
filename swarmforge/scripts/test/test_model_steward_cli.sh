#!/usr/bin/env bash
# Shell smoke tests for the Model Steward store+CLI (BL-547 Slice 1):
# model_steward_cli.bb driven end to end against an isolated state dir via
# MODEL_STEWARD_STATE_DIR, so this never mutates the repo's real
# .swarmforge/model-steward/. Pure decisions are covered by
# model_steward_test_runner.bb instead — this exercises the fs adapter
# (seed load, atomic writes, certification report artifacts) and the CLI's
# own arg parsing/output formatting.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$ROOT/swarmforge/scripts/model_steward_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$STATE_DIR"' EXIT
export MODEL_STEWARD_STATE_DIR="$STATE_DIR"

# ── 1: pure model_steward_lib tests (bb) ────────────────────────────────────
bb "$SCRIPT_DIR/model_steward_test_runner.bb" | grep -q "^ALL PASS$" \
  || fail "01: model_steward_test_runner.bb did not report ALL PASS"

pass "01: model_steward_lib pure tests"

# ── 2: status lazily initialises the runtime registry from the seed ────────
[[ -f "$STATE_DIR/registry.json" ]] && fail "02: registry.json should not exist before first read"
STATUS_OUT="$(bb "$CLI" status)"
[[ -f "$STATE_DIR/registry.json" ]] \
  || fail "02: status did not initialise the runtime registry from the seed"
[[ "$STATUS_OUT" == *"anthropic/claude-sonnet-5 certified"* ]] \
  || fail "02: status output missing the seeded certified anthropic/claude-sonnet-5 entry"

pass "02: status seeds the runtime registry on first read"

# ── 3: show surfaces registry metadata as JSON ──────────────────────────────
SHOW_OUT="$(bb "$CLI" show anthropic/claude-sonnet-5)"
[[ "$SHOW_OUT" == *'"context_window"'* ]] \
  || fail "03: show output missing context_window"
[[ "$SHOW_OUT" == *'"cost_class"'* ]] \
  || fail "03: show output missing cost_class"
[[ "$SHOW_OUT" == *'"status":"certified"'* ]] \
  || fail "03: show output missing certified status"

bb "$CLI" show nope/nope >/tmp/model-steward-show-missing.out 2>&1 && fail "03: show should exit non-zero for an unknown model" || true
grep -q "no registry entry for nope/nope" /tmp/model-steward-show-missing.out \
  || fail "03: show did not report the missing-entry error to stderr"
rm -f /tmp/model-steward-show-missing.out

pass "03: show exposes registry metadata, errors loudly on unknown models"

# ── 4: capability surfaces all five benchmark dimensions ───────────────────
CAP_OUT="$(bb "$CLI" capability anthropic/claude-sonnet-5)"
for dim in coding_quality protocol_compliance tool_usage autonomy cost_latency; do
  [[ "$CAP_OUT" == *"\"$dim\""* ]] || fail "04: capability output missing $dim"
done

pass "04: capability exposes all five benchmark dimensions"

bb "$CLI" capability nope/nope >/tmp/model-steward-capability-missing.out 2>&1 && fail "04: capability should exit non-zero for an unknown model" || true
grep -q "no capability entry for nope/nope" /tmp/model-steward-capability-missing.out \
  || fail "04: capability did not report the missing-entry error to stderr"
rm -f /tmp/model-steward-capability-missing.out

pass "04b: capability errors loudly on unknown models"

# ── 5: register + certify writes a certification report artifact ───────────
bb "$CLI" register bl547test/smoke-model --status candidate --context-window 8000 --cost-class low >/dev/null
CERTIFY_OUT="$(bb "$CLI" certify bl547test/smoke-model)"
[[ "$CERTIFY_OUT" == *"certified"* ]] \
  || fail "05: certify output does not report certified"
REPORT_REL="$(echo "$CERTIFY_OUT" | sed -n 's/.*(\(certification-reports\/[^)]*\)).*/\1/p')"
[[ -n "$REPORT_REL" ]] \
  || fail "05: could not parse a certification report path from certify output"
[[ -f "$STATE_DIR/$REPORT_REL" ]] \
  || fail "05: certification report artifact was not written to disk at $REPORT_REL"
bb "$CLI" show bl547test/smoke-model | grep -q '"status":"certified"' \
  || fail "05: registry entry was not flipped to certified"

pass "05: certify writes a certification report artifact and flips status"

# ── 6: decertify on regression records the reason and a fresh report ───────
DECERTIFY_OUT="$(bb "$CLI" decertify bl547test/smoke-model --reason "coding_quality regressed below floor")"
[[ "$DECERTIFY_OUT" == *"candidate"* ]] \
  || fail "06: decertify did not default new-status to candidate"
DECERT_REPORT_REL="$(echo "$DECERTIFY_OUT" | sed -n 's/.*report=\(certification-reports\/.*\)$/\1/p')"
[[ -n "$DECERT_REPORT_REL" ]] \
  || fail "06: could not parse a regression report path from decertify output"
[[ -f "$STATE_DIR/$DECERT_REPORT_REL" ]] \
  || fail "06: regression report artifact was not written to disk at $DECERT_REPORT_REL"
grep -q "coding_quality regressed below floor" "$STATE_DIR/$DECERT_REPORT_REL" \
  || fail "06: regression report does not record the regression reason"
grep -q '"provider":"bl547test"' "$STATE_DIR/$DECERT_REPORT_REL" \
  || fail "06: regression report does not name its provider"

pass "06: decertify records the regression reason and a fresh report artifact"

# ── 7: certification gate — candidate ineligible unless overridden ─────────
bb "$CLI" eligible bl547test/smoke-model --role coder >/dev/null 2>&1 \
  && fail "07: a candidate model should be ineligible for production assignment by default"
bb "$CLI" eligible bl547test/smoke-model --role coder --override-uncertified >/dev/null 2>&1 \
  || fail "07: an explicit operator override should permit an uncertified model"

pass "07: certification gate excludes candidates unless overridden"

# ── 8: role-matrix ranks the certified seed model above the candidate ──────
ROLE_OUT="$(bb "$CLI" role-matrix coder)"
FIRST_LINE="$(echo "$ROLE_OUT" | head -1)"
[[ "$FIRST_LINE" == anthropic/claude-sonnet-5* ]] \
  || fail "08: expected the certified seed model to rank first for coder, got: $FIRST_LINE"
[[ "$ROLE_OUT" != *cerebras/llama-3.3-70b* ]] \
  || fail "08: role-matrix should exclude the uncertified seeded candidate by default"

pass "08: role-matrix ranks certified models first and excludes uncertified by default"

# ── 9: adapter catalogue maps a certified model to its PromptEngine adapter ─
ADAPTER_OUT="$(bb "$CLI" adapter anthropic/claude-sonnet-5)"
[[ "$ADAPTER_OUT" == generic* ]] \
  || fail "09: expected adapter id 'generic' for the seeded certified model, got: $ADAPTER_OUT"
[[ "$ADAPTER_OUT" == *"production_default=true"* ]] \
  || fail "09: expected the certified model's adapter entry to be a production default"

pass "09: adapter catalogue exposes PromptEngine adapter metadata"

bb "$CLI" adapter nope/nope >/tmp/model-steward-adapter-missing.out 2>&1 && fail "09b: adapter should exit non-zero for an unknown model" || true
grep -q "no adapter entry for nope/nope" /tmp/model-steward-adapter-missing.out \
  || fail "09b: adapter did not report the missing-entry error to stderr"
rm -f /tmp/model-steward-adapter-missing.out

pass "09b: adapter errors loudly on unknown models"

# ── 10: decertify requires --reason, refuses a blank/missing one ───────────
bb "$CLI" decertify anthropic/claude-sonnet-5 >/tmp/model-steward-decertify-noreason.out 2>&1 \
  && fail "10: decertify should exit non-zero when --reason is missing" || true
grep -q "decertify requires --reason" /tmp/model-steward-decertify-noreason.out \
  || fail "10: decertify did not report the missing-reason error to stderr"
rm -f /tmp/model-steward-decertify-noreason.out

bb "$CLI" decertify anthropic/claude-sonnet-5 --reason "" >/tmp/model-steward-decertify-blankreason.out 2>&1 \
  && fail "10: decertify should exit non-zero when --reason is blank" || true
grep -q "decertify requires --reason" /tmp/model-steward-decertify-blankreason.out \
  || fail "10: decertify did not report the blank-reason error to stderr"
rm -f /tmp/model-steward-decertify-blankreason.out

pass "10: decertify refuses a missing or blank --reason"

# ── 11: decertifying a seed-certified model has no prior report to read ────
# anthropic/claude-sonnet-5 was certified only via the committed seed, never
# through `certify` — its certification_report_path is nil, so this is the
# only path that exercises build-regression-report's nil-prior-report branch
# through the real store wiring rather than the pure-lib unit test alone.
SEED_DECERT_OUT="$(bb "$CLI" decertify anthropic/claude-sonnet-5 --reason "protocol_compliance regressed")"
[[ "$SEED_DECERT_OUT" == *"candidate"* ]] \
  || fail "11: decertifying the seed-certified model did not default new-status to candidate"
SEED_DECERT_REPORT_REL="$(echo "$SEED_DECERT_OUT" | sed -n 's/.*report=\(certification-reports\/.*\)$/\1/p')"
[[ -n "$SEED_DECERT_REPORT_REL" ]] \
  || fail "11: could not parse a regression report path from the seed-model decertify output"
grep -q '"prior_report":null' "$STATE_DIR/$SEED_DECERT_REPORT_REL" \
  || fail "11: regression report for a seed-certified model should record a null prior_report, not a fabricated one"
grep -q '"provider":"anthropic"' "$STATE_DIR/$SEED_DECERT_REPORT_REL" \
  || fail "11: regression report for a seed-certified model still names its provider"

pass "11: decertifying a seed-certified model handles a nil prior certification report"

# ── 12: parse-provider-model rejects a composite with no "/" ───────────────
bb "$CLI" show not-a-composite >/tmp/model-steward-malformed.out 2>&1 \
  && fail "12: show should exit non-zero for a malformed provider/model argument" || true
grep -q "expected <provider>/<model>" /tmp/model-steward-malformed.out \
  || fail "12: malformed provider/model argument did not report the expected error"
rm -f /tmp/model-steward-malformed.out

pass "12: parse-provider-model rejects a composite argument with no separator"

# ── 13: an unrecognised command falls through to usage and exits non-zero ──
bb "$CLI" bogus-command >/tmp/model-steward-usage.out 2>&1 \
  && fail "13: an unrecognised command should exit non-zero" || true
grep -q "^Usage: model_steward_cli.bb" /tmp/model-steward-usage.out \
  || fail "13: unrecognised command did not print usage"
rm -f /tmp/model-steward-usage.out

pass "13: an unrecognised command falls through to usage"

echo "ALL PASS"

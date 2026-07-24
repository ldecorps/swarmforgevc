#!/usr/bin/env bash
# Shell smoke tests for the ModelFactory store+CLI (BL-525 Slice 1):
# model_factory_cli.bb driven end to end against isolated state dirs via
# MODEL_STEWARD_STATE_DIR (the registry it reads) and MODEL_FACTORY_STATE_DIR
# (its own overlay/quota-state), so this never mutates the repo's real
# .swarmforge/model-steward/ or .swarmforge/model-factory/. Pure decisions
# are covered by model_factory_test_runner.bb instead — this exercises the
# fs adapter (overlay write, quota-state persistence) and the cold-apply
# launch seam boundary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$ROOT/swarmforge/scripts/model_factory_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

STEWARD_DIR="$(mktemp -d)"
FACTORY_DIR="$(mktemp -d)"
trap 'rm -rf "$STEWARD_DIR" "$FACTORY_DIR"' EXIT
export MODEL_STEWARD_STATE_DIR="$STEWARD_DIR"
export MODEL_FACTORY_STATE_DIR="$FACTORY_DIR"

# ── 1: pure model_factory_lib tests (bb) ────────────────────────────────────
bb "$SCRIPT_DIR/model_factory_test_runner.bb" | grep -q "^ALL PASS$" \
  || fail "01: model_factory_test_runner.bb did not report ALL PASS"

pass "01: model_factory_lib pure tests"

# ── 2: assign-returns-role-map-01 — quality mode against the committed seed ─
ASSIGN_OUT="$(bb "$CLI" assign --mode quality)"
for role in architect coder cleaner QA hardender documenter specifier; do
  [[ "$ASSIGN_OUT" == *"\"$role\""* ]] || fail "02: assignment map missing role $role"
done
[[ "$ASSIGN_OUT" == *'"policy":"quality"'* ]] \
  || fail "02: assignment entries do not record the quality policy"

pass "02: assign resolves a full-swarm role map with recorded policy"

# ── 3: single-role assign shape ─────────────────────────────────────────────
ROLE_OUT="$(bb "$CLI" assign --mode cheap --role coder)"
[[ "$ROLE_OUT" == *'"role":"coder"'* ]] || fail "03: single-role assign missing role field"
[[ "$ROLE_OUT" == *'"agent"'* && "$ROLE_OUT" == *'"provider"'* && "$ROLE_OUT" == *'"model"'* ]] \
  || fail "03: single-role assign missing agent/provider/model"

pass "03: assign --role resolves a single role"

# ── 4: certification-gate-holds-04 / uncertified-override-05 ───────────────
# Custom fixture: coder's only "low"-cost candidate is uncertified; a
# certified "medium"-cost fallback exists. model_steward_cli.bb has no write
# command for role-matrix rankings, so the fixture is written directly as a
# registry.json — model_steward_store.bb/read-registry! loads an existing
# file verbatim (skips the seed transform) when present.
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$STEWARD_DIR" "$FACTORY_DIR" "$FIXTURE_DIR"' EXIT
cat > "$FIXTURE_DIR/registry.json" <<'JSON'
{
  "models": {
    "cerebras/llama-3.3-70b": {"provider": "cerebras", "model": "llama-3.3-70b", "status": "candidate", "cost_class": "low", "certification_report_path": null},
    "openai/gpt-5.3-codex": {"provider": "openai", "model": "gpt-5.3-codex", "status": "certified", "cost_class": "medium", "certification_report_path": null}
  },
  "capabilities": {},
  "role_matrix": {
    "coder": [
      {"provider": "cerebras", "model": "llama-3.3-70b", "score": 0.99, "evidence": "fixture"},
      {"provider": "openai", "model": "gpt-5.3-codex", "score": 0.6, "evidence": "fixture"}
    ]
  },
  "adapters": {}
}
JSON

GATE_OUT="$(MODEL_STEWARD_STATE_DIR="$FIXTURE_DIR" bb "$CLI" assign --mode cheap --role coder)"
[[ "$GATE_OUT" == *'"provider":"openai"'* ]] \
  || fail "04: cheap mode should fall through to the certified fallback, got: $GATE_OUT"
[[ "$GATE_OUT" != *"cerebras"* ]] \
  || fail "04: the uncertified candidate must not be assigned without an override"

pass "04: certification gate holds — uncertified candidate excluded by default"

OVERRIDE_OUT="$(MODEL_STEWARD_STATE_DIR="$FIXTURE_DIR" bb "$CLI" assign --mode cheap --role coder --override-uncertified)"
[[ "$OVERRIDE_OUT" == *'"provider":"cerebras"'* ]] \
  || fail "05: an explicit override should permit the uncertified candidate, got: $OVERRIDE_OUT"
[[ "$OVERRIDE_OUT" == *"uncertified override"* ]] \
  || fail "05: the rationale should record that an uncertified override was used"

pass "05: uncertified override permits the candidate and records the rationale"

# ── 6: daily-cap-failover-06 / daily-cap-resets-next-day-07 ────────────────
FAILOVER_DIR="$(mktemp -d)"
trap 'rm -rf "$STEWARD_DIR" "$FACTORY_DIR" "$FIXTURE_DIR" "$FAILOVER_DIR"' EXIT
cat > "$FAILOVER_DIR/registry.json" <<'JSON'
{
  "models": {
    "cerebras/llama-3.3-70b": {"provider": "cerebras", "model": "llama-3.3-70b", "status": "certified", "cost_class": "low", "certification_report_path": null},
    "openai/gpt-5.3-codex": {"provider": "openai", "model": "gpt-5.3-codex", "status": "certified", "cost_class": "medium", "certification_report_path": null}
  },
  "capabilities": {},
  "role_matrix": {
    "coder": [
      {"provider": "cerebras", "model": "llama-3.3-70b", "score": 0.99, "evidence": "fixture"},
      {"provider": "openai", "model": "gpt-5.3-codex", "score": 0.6, "evidence": "fixture"}
    ]
  },
  "adapters": {}
}
JSON

FAILOVER_STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$STEWARD_DIR" "$FACTORY_DIR" "$FIXTURE_DIR" "$FAILOVER_DIR" "$FAILOVER_STATE_DIR"' EXIT
MODEL_FACTORY_STATE_DIR="$FAILOVER_STATE_DIR" bb "$CLI" mark-exhausted cerebras --date 2026-07-22 >/dev/null

FAILOVER_OUT="$(MODEL_STEWARD_STATE_DIR="$FAILOVER_DIR" MODEL_FACTORY_STATE_DIR="$FAILOVER_STATE_DIR" \
  bb "$CLI" assign --mode cheap --role coder --today 2026-07-22)"
[[ "$FAILOVER_OUT" == *'"provider":"openai"'* ]] \
  || fail "06: cheap mode should fail over to openai when cerebras is exhausted today, got: $FAILOVER_OUT"
# The reason field legitimately names cerebras as the excluded provider — assert
# on the assigned provider field, not a blanket substring match, or a correct
# exclusion (which documents what it excluded) reads as a failure.
[[ "$FAILOVER_OUT" != *'"provider":"cerebras"'* ]] \
  || fail "06: an exhausted-today provider must not be assigned"

pass "06: daily-cap failover excludes the exhausted-today provider"

RESET_OUT="$(MODEL_STEWARD_STATE_DIR="$FAILOVER_DIR" MODEL_FACTORY_STATE_DIR="$FAILOVER_STATE_DIR" \
  bb "$CLI" assign --mode cheap --role coder --today 2026-07-23)"
[[ "$RESET_OUT" == *'"provider":"cerebras"'* ]] \
  || fail "07: cerebras should be preferred again once its exhausted_date is not today, got: $RESET_OUT"

pass "07: a daily-capped provider is preferred again after its quota resets"

# ── 8: cold-apply-plan-08 — overlay write + stop/relaunch plan via a stub seam ─
STUB_SEAM="$(mktemp -d)/stub-seam.sh"
STUB_INVOCATION_LOG="$(mktemp)"
cat > "$STUB_SEAM" <<EOF
#!/usr/bin/env bash
cat > "$STUB_INVOCATION_LOG" <<PLAN
\$1
PLAN
exit 0
EOF
chmod +x "$STUB_SEAM"
trap 'rm -rf "$STEWARD_DIR" "$FACTORY_DIR" "$FIXTURE_DIR" "$FAILOVER_DIR" "$FAILOVER_STATE_DIR"; rm -f "$STUB_SEAM" "$STUB_INVOCATION_LOG"' EXIT

COLD_APPLY_DIR="$(mktemp -d)"
COLD_APPLY_OUT="$(MODEL_FACTORY_STATE_DIR="$COLD_APPLY_DIR" \
  bb "$CLI" cold-apply --mode quality --pack codex-mono-router --launch-seam "$STUB_SEAM")"
[[ -f "$COLD_APPLY_DIR/assignment.json" ]] \
  || fail "08: cold-apply did not write the assignment overlay under the model-factory state dir"
[[ "$COLD_APPLY_OUT" == *'"seam_exit":0'* ]] \
  || fail "08: cold-apply did not report the launch seam's exit code, got: $COLD_APPLY_OUT"
grep -q '"pack":"codex-mono-router"' "$STUB_INVOCATION_LOG" \
  || fail "08: the stubbed launch seam was not invoked with the resolved plan"
grep -q "\"overlay_path\":\"$COLD_APPLY_DIR/assignment.json\"" "$STUB_INVOCATION_LOG" \
  || fail "08: the plan passed to the launch seam does not name the written overlay"
grep -q '"script":"kill_all_swarm.sh"' "$STUB_INVOCATION_LOG" \
  || fail "08: the plan does not include the stop step"
rm -rf "$COLD_APPLY_DIR"

pass "08: cold apply materialises the overlay and invokes the stubbed launch seam with a stop/relaunch plan"

# ── 9: cold-apply requires --pack ───────────────────────────────────────────
bb "$CLI" cold-apply --mode quality --launch-seam "$STUB_SEAM" >/tmp/model-factory-nopack.out 2>&1 \
  && fail "09: cold-apply should exit non-zero when --pack is missing" || true
grep -q "cold-apply requires --pack" /tmp/model-factory-nopack.out \
  || fail "09: cold-apply did not report the missing --pack error"
rm -f /tmp/model-factory-nopack.out

pass "09: cold-apply refuses a missing --pack"

# ── 10: assign rejects an unrecognised --mode ───────────────────────────────
bb "$CLI" assign --mode nonsense >/tmp/model-factory-badmode.out 2>&1 \
  && fail "10: assign should exit non-zero for an unrecognised --mode" || true
grep -q "expected --mode cheap|quality" /tmp/model-factory-badmode.out \
  || fail "10: assign did not report the invalid-mode error"
rm -f /tmp/model-factory-badmode.out

pass "10: assign rejects an unrecognised steering mode"

# ── 11: an unrecognised command falls through to usage and exits non-zero ──
bb "$CLI" bogus-command >/tmp/model-factory-usage.out 2>&1 \
  && fail "11: an unrecognised command should exit non-zero" || true
grep -q "^Usage: model_factory_cli.bb" /tmp/model-factory-usage.out \
  || fail "11: unrecognised command did not print usage"
rm -f /tmp/model-factory-usage.out

pass "11: an unrecognised command falls through to usage"

# ── 12-16: resolve-model (BL-563 Slice 1) — the fs-adapter half of the ─────
# overlay-over-pack decision (pure half already covered by
# model_factory_test_runner.bb). Isolated MODEL_FACTORY_STATE_DIR per case so
# none of these ever touch this repo's real .swarmforge/model-factory/.
RESOLVE_DIR="$(mktemp -d)"
trap 'rm -rf "$STEWARD_DIR" "$FACTORY_DIR" "$FIXTURE_DIR" "$FAILOVER_DIR" "$FAILOVER_STATE_DIR" "$RESOLVE_DIR"; rm -f "$STUB_SEAM" "$STUB_INVOCATION_LOG"' EXIT

# 12: no overlay file at all -> pack model passes through unchanged
NO_OVERLAY_OUT="$(MODEL_FACTORY_STATE_DIR="$RESOLVE_DIR/none" bb "$CLI" resolve-model coder sonnet)"
[[ "$NO_OVERLAY_OUT" == "sonnet" ]] \
  || fail "12: expected pack model 'sonnet' with no overlay present, got: $NO_OVERLAY_OUT"
pass "12: resolve-model degrades to the pack model when no overlay file exists"

# 13: well-formed overlay naming the role -> overlay model wins
mkdir -p "$RESOLVE_DIR/named"
cat > "$RESOLVE_DIR/named/assignment.json" <<'JSON'
{"coder": {"role": "coder", "agent": "claude", "provider": "anthropic", "model": "opus"}}
JSON
NAMED_OUT="$(MODEL_FACTORY_STATE_DIR="$RESOLVE_DIR/named" bb "$CLI" resolve-model coder sonnet)"
[[ "$NAMED_OUT" == "opus" ]] \
  || fail "13: expected the overlay's named model 'opus', got: $NAMED_OUT"
pass "13: resolve-model prefers the overlay's named model over the pack model"

# 14: overlay present but does not name this role -> pack model passes through
UNNAMED_OUT="$(MODEL_FACTORY_STATE_DIR="$RESOLVE_DIR/named" bb "$CLI" resolve-model cleaner sonnet)"
[[ "$UNNAMED_OUT" == "sonnet" ]] \
  || fail "14: expected pack model 'sonnet' for a role the overlay does not name, got: $UNNAMED_OUT"
pass "14: resolve-model leaves a role the overlay does not name on the pack model"

# 15: malformed / truncated / empty overlay all degrade to the pack model, never abort
for broken in malformed truncated empty; do
  mkdir -p "$RESOLVE_DIR/$broken"
  case "$broken" in
    malformed) printf '{not valid json' > "$RESOLVE_DIR/$broken/assignment.json" ;;
    truncated) printf '{"coder": {"model": "op' > "$RESOLVE_DIR/$broken/assignment.json" ;;
    empty) : > "$RESOLVE_DIR/$broken/assignment.json" ;;
  esac
  BROKEN_OUT="$(MODEL_FACTORY_STATE_DIR="$RESOLVE_DIR/$broken" bb "$CLI" resolve-model coder sonnet)" \
    || fail "15: resolve-model must not abort on a $broken overlay"
  [[ "$BROKEN_OUT" == "sonnet" ]] \
    || fail "15: expected pack model 'sonnet' for a $broken overlay, got: $BROKEN_OUT"
done
pass "15: resolve-model degrades a malformed/truncated/empty overlay to the pack model without aborting"

# 16: overlay names the role but supplies no pack model at all -> overlay model still wins
NOPACK_OUT="$(MODEL_FACTORY_STATE_DIR="$RESOLVE_DIR/named" bb "$CLI" resolve-model coder "")"
[[ "$NOPACK_OUT" == "opus" ]] \
  || fail "16: expected the overlay's named model 'opus' even with no pack model, got: $NOPACK_OUT"
pass "16: resolve-model applies the overlay even when the pack named no model"

echo "ALL PASS"

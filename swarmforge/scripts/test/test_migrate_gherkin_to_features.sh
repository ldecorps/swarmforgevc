#!/usr/bin/env bash
# BL-111 feature-migration-01: migrate_gherkin_to_features.bb rehearsed
# against a scratch fixture, never the live repo. Covers active/paused
# migration, the done/ exclusion, the no-acceptance-field skip, and
# idempotency (a second run must not re-migrate or clobber).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATE="$SCRIPT_DIR/../migrate_gherkin_to_features.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done"

cat > "$ROOT/backlog/active/BL-1-active-item.yaml" <<'EOF'
id: BL-1
title: an active item with real Gherkin
milestone: M1
acceptance: |
  Feature: an active item

  # BL-1 scenario-01
  Scenario: it does the thing
    Given a precondition
    When the action happens
    Then the outcome holds
mutation_cost: low
EOF

cat > "$ROOT/backlog/paused/BL-2-no-acceptance-yet.yaml" <<'EOF'
id: BL-2
title: a stub epic with no concrete Gherkin yet
milestone: M1
notes: |
  Not scoped yet.
EOF

cat > "$ROOT/backlog/done/BL-3-done-item.yaml" <<'EOF'
id: BL-3
title: an already-done item
milestone: M1
acceptance: |
  Feature: a done item

  Scenario: this must never be touched
    Given it is already done
    Then the migration leaves it alone
mutation_cost: low
EOF

# ── 01: bare invocation with no repo-root prints usage and fails ───────────
set +e
OUT="$(bb "$MIGRATE" 2>&1)"
RC=$?
set -e
[[ "$RC" != 0 ]] || fail "01: expected a nonzero exit with no repo-root argument"
grep -qi "usage" <<< "$OUT" || fail "01: expected a usage message; got: $OUT"
pass "01: bare invocation with no repo-root argument fails with a usage message"

# ── run the real migration once ─────────────────────────────────────────────
OUT="$(bb "$MIGRATE" "$ROOT")"

# ── 02: an active item with a real acceptance: block is migrated ───────────
[[ -f "$ROOT/specs/features/BL-1-active-item.feature" ]] \
  || fail "02: expected specs/features/BL-1-active-item.feature to exist"
grep -q "^Feature: an active item$" "$ROOT/specs/features/BL-1-active-item.feature" \
  || fail "02: feature file content missing the Feature: line"
grep -q "^# BL-1 scenario-01$" "$ROOT/specs/features/BL-1-active-item.feature" \
  || fail "02: feature file content missing the scenario comment"
grep -q "^acceptance: specs/features/BL-1-active-item.feature$" "$ROOT/backlog/active/BL-1-active-item.yaml" \
  || fail "02: YAML acceptance: field was not replaced with a reference"
grep -q "^mutation_cost: low$" "$ROOT/backlog/active/BL-1-active-item.yaml" \
  || fail "02: a field AFTER acceptance: must survive the migration untouched"
grep -q "^title: an active item with real Gherkin$" "$ROOT/backlog/active/BL-1-active-item.yaml" \
  || fail "02: a field BEFORE acceptance: must survive the migration untouched"
pass "02: an active item's acceptance: block is migrated to its own feature file, referenced from the YAML"

# ── 03: a stub with no acceptance: field is left alone entirely ────────────
diff -q <(cat <<'EOF'
id: BL-2
title: a stub epic with no concrete Gherkin yet
milestone: M1
notes: |
  Not scoped yet.
EOF
) "$ROOT/backlog/paused/BL-2-no-acceptance-yet.yaml" >/dev/null \
  || fail "03: a ticket with no acceptance: field must be byte-identical after migration"
[[ ! -f "$ROOT/specs/features/BL-2-no-acceptance-yet.feature" ]] \
  || fail "03: no feature file should have been created for a ticket with nothing to migrate"
grep -q "^SKIP (no acceptance: field):" <<< "$OUT" || fail "03: expected a SKIP report for BL-2; got: $OUT"
pass "03: a ticket with no acceptance: field is left completely untouched"

# ── 04: a done/ item is never migrated ──────────────────────────────────────
[[ ! -f "$ROOT/specs/features/BL-3-done-item.feature" ]] \
  || fail "04: a done/ item must never be migrated"
grep -q "^acceptance: |$" "$ROOT/backlog/done/BL-3-done-item.yaml" \
  || fail "04: a done/ item's inline acceptance: block must be untouched"
pass "04: a done/ item is never scanned or migrated"

# ── 05: idempotency - a second run does not re-migrate or clobber ──────────
FEATURE_BEFORE="$(cat "$ROOT/specs/features/BL-1-active-item.feature")"
OUT2="$(bb "$MIGRATE" "$ROOT")"
grep -q "^SKIP (no acceptance: field): .*BL-1-active-item.yaml$" <<< "$OUT2" \
  || fail "05: expected the second run to SKIP the already-migrated BL-1; got: $OUT2"
[[ "$(cat "$ROOT/specs/features/BL-1-active-item.feature")" == "$FEATURE_BEFORE" ]] \
  || fail "05: the feature file content changed on a second run"
pass "05: re-running the migration is idempotent - an already-migrated item is skipped, not re-processed"

echo "ALL PASS"

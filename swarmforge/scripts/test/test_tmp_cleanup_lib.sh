#!/usr/bin/env bash
# BL-801: lib_cleanup.sh's own unit test (it had none before this ticket -
# required_wiring). Every ~49-now-61 sourcing test file uses ONE convention
# (`make_root() { ...; register_tmp_dir "$d"; printf '%s' "$d"; }`,
# `ROOT="$(make_root)"`) so this drives that exact convention against real
# throwaway fixture scripts on the host's OWN /bin/bash - no daemons, no
# network, no live swarm paths, no real timers (per the ticket's own
# acceptance-contract note). Covers the three cases required_wiring names:
# subshell registration, empty-registry exit, and concurrent-process
# isolation. Mirrors BL-870 wake-attribution-04's synchronization idiom for
# ordering two concurrent processes (explicit flag files, never sleeps for
# correctness - only for polling cadence).
#
# BL-654 Invariants note: the three declared invariants are about PROCESS
# semantics (fork behavior, EXIT-trap scope, concurrent-process isolation),
# not a pure function over a varied input domain - there is no
# `*_property_runner` convention for plain bash in this tree the way
# Babashka has one (chase-rotate-to!'s own BL-795/BL-654 comment records
# the same absence one layer down: "the Babashka toolchain has no
# property-test framework wired for this daemon-control-flow layer
# regardless... encoded as a real-fixture integration test" - true here a
# fortiori, since bash has no property-test framework wired for ANY layer).
# Test 05 below is the closest thing to an executable property this domain
# admits: it varies the one axis invariant 1's own wording calls out
# ("regardless of the shell depth") across depths 1-4 and registration
# counts 0-5 in one parameterized sweep, rather than only the depth-1/
# depth-2 cases the other scenarios fix. Invariants 2 and 3 stay covered by
# the real-fixture integration tests above/below (02: empty registry on
# THIS host's actual bash; 04/04b: two real concurrent processes) - varying
# "which bash" or "how many concurrently running sibling processes" is not
# a generator axis this test file can vary at all (there is exactly one
# host bash to run against, and inventing N synthetic concurrent siblings
# beyond the real two would test the OS scheduler, not this lib).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/lib/tmp_cleanup.sh"

FAILURES=0
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { echo "PASS: $*"; }

WORKDIR="$(mktemp -d)"
cleanup_workdir() { rm -rf -- "$WORKDIR"; }
trap cleanup_workdir EXIT

# ── 01: a root registered only inside a command-substitution helper is
#    swept when the fixture exits, and the fixture itself exits 0 ─────────

FIXTURE1="$WORKDIR/fixture_subshell_only.sh"
cat > "$FIXTURE1" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$LIB"
make_root() { local d; d="\$(mktemp -d)"; register_tmp_dir "\$d"; printf '%s' "\$d"; }
ROOT="\$(make_root)"
echo "ROOT=\$ROOT"
EOF
chmod +x "$FIXTURE1"

OUT1="$(bash "$FIXTURE1")"
CODE1=$?
ROOT1="$(echo "$OUT1" | sed -n 's/^ROOT=//p')"

[[ $CODE1 -eq 0 ]] || fail "01: fixture with a passing, subshell-only registration should exit 0, got $CODE1"
[[ -n "$ROOT1" ]] || fail "01: fixture never printed its registered root"
[[ -d "$ROOT1" ]] && fail "01: root registered only inside \$(make_root) still exists after the fixture exited: $ROOT1"
[[ ! -d "$ROOT1" ]] && pass "01: a root registered only inside a command-substitution helper is swept on a passing exit"

# ── 01b: the same shape, but the fixture fails AFTER registering - the
#    root is still swept, exit code is non-zero ───────────────────────────

FIXTURE1B="$WORKDIR/fixture_subshell_only_fails.sh"
cat > "$FIXTURE1B" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$LIB"
make_root() { local d; d="\$(mktemp -d)"; register_tmp_dir "\$d"; printf '%s' "\$d"; }
ROOT="\$(make_root)"
echo "ROOT=\$ROOT"
false
EOF
chmod +x "$FIXTURE1B"

set +e
OUT1B="$(bash "$FIXTURE1B")"
CODE1B=$?
set -e
ROOT1B="$(echo "$OUT1B" | sed -n 's/^ROOT=//p')"

[[ $CODE1B -ne 0 ]] || fail "01b: fixture that fails after registering should exit non-zero, got $CODE1B"
[[ ! -d "$ROOT1B" ]] || fail "01b: root registered inside \$(make_root) still exists after a failing exit: $ROOT1B"
[[ $CODE1B -ne 0 && ! -d "$ROOT1B" ]] && pass "01b: a root registered inside a command-substitution helper is swept on a failing exit too"

# ── 02: a fixture with zero registrations exits 0 with no "unbound
#    variable" on stderr (the bash-3.2-under-set -u false-red this ticket
#    fixes) ─────────────────────────────────────────────────────────────

FIXTURE2="$WORKDIR/fixture_empty.sh"
cat > "$FIXTURE2" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$LIB"
echo "ALL CHECKS PASSED"
EOF
chmod +x "$FIXTURE2"

STDERR2="$WORKDIR/fixture2.stderr"
set +e
bash "$FIXTURE2" > /dev/null 2> "$STDERR2"
CODE2=$?
set -e

[[ $CODE2 -eq 0 ]] || fail "02: a passing fixture with zero registrations should exit 0, got $CODE2"
if grep -qi "unbound variable" "$STDERR2"; then
  fail "02: empty registry raised 'unbound variable' on this bash: $(cat "$STDERR2")"
else
  pass "02: a passing fixture with zero registrations exits 0 with no 'unbound variable' error"
fi

# ── 03: direct AND command-substitution registrations in the same fixture
#    are both swept ────────────────────────────────────────────────────

FIXTURE3="$WORKDIR/fixture_mixed.sh"
cat > "$FIXTURE3" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$LIB"
make_root() { local d; d="\$(mktemp -d)"; register_tmp_dir "\$d"; printf '%s' "\$d"; }
DIRECT_ROOT="\$(mktemp -d)"
register_tmp_dir "\$DIRECT_ROOT"
SUB_ROOT="\$(make_root)"
echo "DIRECT=\$DIRECT_ROOT"
echo "SUB=\$SUB_ROOT"
EOF
chmod +x "$FIXTURE3"

OUT3="$(bash "$FIXTURE3")"
CODE3=$?
DIRECT3="$(echo "$OUT3" | sed -n 's/^DIRECT=//p')"
SUB3="$(echo "$OUT3" | sed -n 's/^SUB=//p')"

[[ $CODE3 -eq 0 ]] || fail "03: mixed-registration fixture should exit 0, got $CODE3"
[[ -d "$DIRECT3" ]] && fail "03: directly registered root still exists: $DIRECT3"
[[ -d "$SUB3" ]] && fail "03: subshell-registered root still exists: $SUB3"
[[ ! -d "$DIRECT3" && ! -d "$SUB3" ]] && pass "03: a mix of direct and command-substitution registrations are both swept"

# ── 04: one script's exit sweeps only its own registrations, never a
#    concurrently running sibling's - explicit flag-file synchronization,
#    never a sleep-based race ──────────────────────────────────────────

FIXTURE4="$WORKDIR/fixture_concurrent.sh"
cat > "$FIXTURE4" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
LIB_PATH="$1"
ROOT_FILE="$2"
GO_FILE="$3"
source "$LIB_PATH"
ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
printf '%s' "$ROOT" > "$ROOT_FILE"
until [[ -f "$GO_FILE" ]]; do sleep 0.1; done
EOF
chmod +x "$FIXTURE4"

ROOT_FILE_A="$WORKDIR/root_a"
GO_FILE_A="$WORKDIR/go_a"
ROOT_FILE_B="$WORKDIR/root_b"
GO_FILE_B="$WORKDIR/go_b"

bash "$FIXTURE4" "$LIB" "$ROOT_FILE_A" "$GO_FILE_A" &
PID_A=$!
bash "$FIXTURE4" "$LIB" "$ROOT_FILE_B" "$GO_FILE_B" &
PID_B=$!

until [[ -f "$ROOT_FILE_A" && -f "$ROOT_FILE_B" ]]; do sleep 0.1; done
ROOT_A="$(cat "$ROOT_FILE_A")"
ROOT_B="$(cat "$ROOT_FILE_B")"

touch "$GO_FILE_A"
wait "$PID_A"

until [[ ! -d "$ROOT_A" ]] || [[ ! -f "$GO_FILE_B" ]]; do sleep 0.1; [[ -d "$ROOT_A" ]] || break; done

if [[ -d "$ROOT_A" ]]; then
  fail "04: fixture A's own root still exists after its own exit: $ROOT_A"
elif [[ ! -d "$ROOT_B" ]]; then
  fail "04: fixture A's exit swept fixture B's still-running root: $ROOT_B"
else
  pass "04: one script's exit sweeps only its own registration, leaving a still-running sibling's root untouched"
fi

touch "$GO_FILE_B"
wait "$PID_B"
[[ -d "$ROOT_B" ]] && fail "04b: fixture B's own root still exists after its own exit: $ROOT_B"
[[ ! -d "$ROOT_B" ]] && pass "04b: the second fixture's own exit sweeps its own root once it is done"

# ── 05: invariant 1's own wording ("regardless of the shell depth") swept
#    across DEPTH (1-4 nested command-substitution levels) x COUNT (0-5
#    registrations) - the closest this domain admits to an executable
#    property, varying the two axes the other scenarios only fix at one
#    value each (depth 1 direct, depth 2 subshell; count 0 or 1-2) ────────

gen_depth_chain() {
  local depth="$1" body
  body='level0() { local d; d="$(mktemp -d)"; register_tmp_dir "$d"; printf '"'"'%s'"'"' "$d"; }'
  local i=1
  while [[ $i -lt $depth ]]; do
    body="$body"$'\n''level'"$i"'() { local x; x="$(level'"$((i - 1))"')"; printf '"'"'%s'"'"' "$x"; }'
    i=$((i + 1))
  done
  printf '%s' "$body"
}

PROPERTY_FAILURES=0
for depth in 1 2 3 4; do
  for count in 0 1 2 5; do
    FIXTURE5="$WORKDIR/fixture_depth${depth}_count${count}.sh"
    {
      echo '#!/usr/bin/env bash'
      echo 'set -euo pipefail'
      echo "source \"$LIB\""
      gen_depth_chain "$depth"
      echo
      n=1
      while [[ $n -le $count ]]; do
        echo "ROOT_$n=\"\$(level$((depth - 1)))\""
        echo "echo \"ROOT_$n=\$ROOT_$n\""
        n=$((n + 1))
      done
      echo 'echo DONE'
    } > "$FIXTURE5"
    chmod +x "$FIXTURE5"

    STDERR5="$WORKDIR/fixture5.stderr"
    set +e
    OUT5="$(bash "$FIXTURE5" 2> "$STDERR5")"
    CODE5=$?
    set -e

    ok=true
    if [[ $CODE5 -ne 0 ]]; then
      fail "05 (depth=$depth count=$count): expected exit 0, got $CODE5"
      ok=false
    fi
    if grep -qi "unbound variable" "$STDERR5"; then
      fail "05 (depth=$depth count=$count): unbound variable on stderr: $(cat "$STDERR5")"
      ok=false
    fi
    n=1
    while [[ $n -le $count ]]; do
      root="$(echo "$OUT5" | sed -n "s/^ROOT_$n=//p")"
      if [[ -z "$root" ]]; then
        fail "05 (depth=$depth count=$count): fixture never printed ROOT_$n"
        ok=false
      elif [[ -d "$root" ]]; then
        fail "05 (depth=$depth count=$count): root #$n at nesting depth $depth still exists: $root"
        ok=false
      fi
      n=$((n + 1))
    done
    [[ "$ok" == true ]] || PROPERTY_FAILURES=$((PROPERTY_FAILURES + 1))
  done
done
if [[ $PROPERTY_FAILURES -eq 0 ]]; then
  pass "05: every (depth=1..4, count=0..5) combination exits 0, raises no unbound-variable error, and sweeps every registered root"
fi

# ── 06: the registry FILE itself (not just the roots it names) is removed
#    on exit - a dropped `rm -f` on the registry would leave a small file
#    behind on every single run, forever, and no other assertion above
#    would catch it since they only check the registered ROOTS ────────────

FIXTURE6="$WORKDIR/fixture_registry_file.sh"
cat > "$FIXTURE6" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$LIB"
make_root() { local d; d="\$(mktemp -d)"; register_tmp_dir "\$d"; printf '%s' "\$d"; }
ROOT="\$(make_root)"
echo "REGISTRY=\$__SWARMFORGE_TMP_CLEANUP_REGISTRY"
EOF
chmod +x "$FIXTURE6"

OUT6="$(bash "$FIXTURE6")"
CODE6=$?
REGISTRY6="$(echo "$OUT6" | sed -n 's/^REGISTRY=//p')"

[[ $CODE6 -eq 0 ]] || fail "06: fixture should exit 0, got $CODE6"
[[ -n "$REGISTRY6" ]] || fail "06: fixture never printed its own registry path"
[[ -f "$REGISTRY6" ]] && fail "06: registry file itself still exists after the fixture exited: $REGISTRY6"
[[ ! -f "$REGISTRY6" ]] && pass "06: the registry file itself (not only the roots it named) is removed on exit"

# ── report ────────────────────────────────────────────────────────────────
if [[ $FAILURES -gt 0 ]]; then
  echo "$FAILURES failure(s)"
  exit 1
fi
echo "ALL PASS (test_tmp_cleanup_lib.sh)"

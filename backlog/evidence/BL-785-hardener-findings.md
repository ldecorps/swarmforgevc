# Hardener finding on BL-785 — not a BL-785 defect, raised as a note

Found while hardening BL-785 (freshness deliberate-stop marker). Not caused by
BL-785's changes and not in its scope; raised here for the specifier to ticket.

## `tmp_cleanup.sh`'s shared `register_tmp_dir` pattern silently loses every
   registration made inside a `make_root()` invoked via `$(...)`

`swarmforge/scripts/test/lib/tmp_cleanup.sh` (BL-459) keeps one global array,
`__SWARMFORGE_TMP_DIRS_TO_CLEAN`, appended to by `register_tmp_dir` and swept
by a single EXIT trap. The convention duplicated across ~50 `test_*.sh` files
(`grep -rl register_tmp_dir swarmforge/scripts/test/*.sh` → 50 files) is:

```sh
make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  ...
  printf '%s' "$d"
}
ROOT="$(make_root)"
```

`ROOT="$(make_root)"` runs `make_root` in a **command-substitution subshell**.
`register_tmp_dir` mutates the array *inside that subshell*; the mutation is
discarded the instant the subshell exits. The parent shell's array is never
actually appended to by any `make_root`-internal registration. Net effect:
**every temp root created this way leaks** — the EXIT trap sweeps an array
that, for scripts using only this pattern, is permanently empty, regardless of
how many `mktemp -d` roots the test created.

This is silent on a modern bash (`"${arr[@]}"` on a genuinely empty array is a
harmless no-op under `set -u` from bash 4.4 on). It is **loud** on this host:
macOS ships bash 3.2.57 (`/bin/bash --version`; no Homebrew bash on PATH), and
bash < 4.4 raises `unbound variable` when `set -u` is active and the array has
zero elements. So on this Mac, any test whose *only* `register_tmp_dir` calls
happen inside a subshelled `make_root()` exits 1 from the EXIT trap itself,
even though every assertion in the test passed:

```
$ bash swarmforge/scripts/test/test_freshness_stop_marker_lib.sh
...
BL-785 freshness_stop_marker_lib: ALL CHECKS PASSED
.../lib/tmp_cleanup.sh: line 22: __SWARMFORGE_TMP_DIRS_TO_CLEAN[@]: unbound variable
$ echo $?
1
```

Reproduces identically on `test_daemon_log_freshness.sh`, which predates
BL-785 — confirming this is not something BL-785's new tests introduced, just
the first time this hardening pass ran these files with their real exit code
checked rather than grepping for "ALL CHECKS PASSED" text.

A test whose registrations happen to include at least one call made **outside**
a subshell (e.g. `register_tmp_dir` called directly in the script body, not
inside a `$(...)`-captured helper) never shows the trap error, because the
array then has ≥1 real element — but the roots created via the subshelled
`make_root()` are *still* silently unregistered and still leak; this case
merely doesn't crash the trap. `test_bl785_freshness_deliberate_stop.sh` is an
example: it registers `FAKE_BIN` directly in the main body, so it exits 0, but
its own `make_root()`-created roots leak exactly the same as everywhere else.

### Why this belongs in a new ticket, not a BL-785 fix

- `tmp_cleanup.sh` and the `make_root()` convention predate BL-785 entirely
  (BL-459). BL-785's two new test files followed the established convention
  faithfully; the defect is in the convention itself.
- Fixing it means auditing/changing the shared helper and, likely, ~50 call
  sites — squarely outside BL-785's `out_of_scope` (freshness/stop-marker
  behavior only).
- Two independent things worth separate tickets on their merits: (a) the
  actual temp-dir leak (present on every host, every bash version — resource
  hygiene), and (b) the bash-3.2-specific loud trap failure on this Mac host,
  which reads exactly like a real test failure to any exit-code check and
  would false-bounce a clean parcel if a reviewer trusted the exit code
  without reading the output. (b) likely belongs alongside BL-789's other
  Mac-host-switch findings.

### What BL-785's own tests did about it

Nothing — out of scope. This hardening pass verified BL-785's own assertions
by reading output (`ok`/`FAIL`/`PASS` lines and the terminal "ALL CHECKS
PASSED" banner), not by trusting raw exit code, for the two files affected
(`test_freshness_stop_marker_lib.sh`, and transitively any BL-785 scenario
using `make_root()`). `test_bl785_freshness_deliberate_stop.sh` exits 0
cleanly (its `FAKE_BIN` registration outside a subshell happens to keep the
array non-empty) so this is visible only on the unit-lib test file.

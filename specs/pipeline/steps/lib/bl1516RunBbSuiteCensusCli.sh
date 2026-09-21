#!/usr/bin/env bash
# BL-1516 scenarios 04/05: builds an isolated fixture git checkout (a real
# git repo under mkdtemp - BL-1390, never the live checkout) carrying the
# REAL, edited run_bb_suite.sh and lib/git_env_guard.sh, a stub
# suite_inventory_cli.bb (the inventory gate is a separate, pre-existing
# mechanism - this fixture only needs it to pass, not to be exercised) and
# one or more planted "standing" tests, each of which creates exactly the
# top-level entry its own name is given. Runs the REAL run_bb_suite.sh
# there and prints its output.
#
# Usage: bl1516RunBbSuiteCensusCli.sh <planted-name>=<entry> [<planted-name>=<entry> ...]
#   Each <planted-name> is either "*.sh" (a shell test, made to `mkdir`
#   <entry>) or "*.bb" (a bb test runner, made to `mkdir` <entry> via a
#   babashka.fs call) - the file is created with that exact name so the
#   printed ROOT_POLLUTION_DETECTED line names it verbatim. <entry>=CLEAN
#   plants a real, passing test that creates nothing at all.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SCRIPTS_TEST="$SCRIPT_DIR/../../../../swarmforge/scripts/test"

FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/bl1516-suite-census.XXXXXX")"
git -C "$FIXTURE" init -q -b main
git -C "$FIXTURE" config user.email t@t
git -C "$FIXTURE" config user.name t
git -C "$FIXTURE" config commit.gpgsign false
git -C "$FIXTURE" commit -q --allow-empty -m seed

TESTDIR="$FIXTURE/test"
mkdir -p "$TESTDIR/lib"
cp "$REPO_SCRIPTS_TEST/run_bb_suite.sh" "$TESTDIR/run_bb_suite.sh"
cp "$REPO_SCRIPTS_TEST/lib/git_env_guard.sh" "$TESTDIR/lib/git_env_guard.sh"
chmod +x "$TESTDIR/run_bb_suite.sh"

# A stub, not the real gate: this scenario is about the census the suite
# LOOP takes, not the inventory gate's own agreement check, which is a
# separate, already-tested mechanism (BL-973).
cat > "$TESTDIR/suite_inventory_cli.bb" <<'EOF'
#!/usr/bin/env bb
(println "suite inventory: ok - stubbed for BL-1516's own census fixture")
EOF
chmod +x "$TESTDIR/suite_inventory_cli.bb"

manifest="$TESTDIR/suite-manifest.tsv"
: > "$manifest"

for pair in "$@"; do
  name="${pair%%=*}"
  entry="${pair#*=}"
  echo -e "$name\tstanding\t\t" >> "$manifest"
  if [[ "$entry" == "CLEAN" ]]; then
    if [[ "$name" == *.sh ]]; then
      printf '#!/usr/bin/env bash\nexit 0\n' > "$TESTDIR/$name"
    else
      printf '#!/usr/bin/env bb\n(println "clean")\n' > "$TESTDIR/$name"
    fi
  elif [[ "$name" == *.sh ]]; then
    cat > "$TESTDIR/$name" <<EOF
#!/usr/bin/env bash
set -euo pipefail
TOPLEVEL="\$(git -C "\$(dirname "\${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
mkdir -p "\$TOPLEVEL/$entry"
exit 0
EOF
  else
    cat > "$TESTDIR/$name" <<EOF
#!/usr/bin/env bb
(require '[babashka.fs :as fs])
(require '[babashka.process :as process])
(def toplevel (str/trim (:out (process/sh ["git" "-C" (str (fs/parent (fs/canonicalize *file*))) "rev-parse" "--show-toplevel"]))))
(fs/create-dirs (fs/path toplevel "$entry"))
EOF
    # The stub bb runner above needs clojure.string aliased for str/trim -
    # a plain (require '[clojure.string :as str]) line, prepended.
    sed -i "2i(require '[clojure.string :as str])" "$TESTDIR/$name"
  fi
  chmod +x "$TESTDIR/$name"
done

git -C "$FIXTURE" add -A
git -C "$FIXTURE" commit -q -m "planted fixture tests"

bash "$TESTDIR/run_bb_suite.sh"
status=$?

rm -rf "$FIXTURE"
exit "$status"

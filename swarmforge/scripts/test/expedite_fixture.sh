#!/usr/bin/env bash
# BL-567: builds a throwaway git repo the expeditor can be driven against, so
# every scenario runs for real instead of in --dry-run. Shared by
# test_expedite_cli.sh and by the acceptance step handlers, so the CLI test and
# the acceptance run exercise the SAME fixture rather than two similar ones that
# drift.
#
# Usage: expedite_fixture.sh <dest-dir> [--active BL-ID]...
# Prints the dest dir on success.
set -euo pipefail

DEST="${1:?usage: expedite_fixture.sh <dest-dir> [--active BL-ID]...}"
shift || true

REAL_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ACTIVE=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --active) ACTIVE+=("$2"); shift 2 ;;
    *) shift ;;
  esac
done

rm -rf "$DEST"
mkdir -p "$DEST"/{backlog/{active,paused,hold,done,evidence},specs/features,.swarmforge/{tmux,launch,handoffs/coder/inbox/new,handoffs/cleaner/inbox/new}}

cd "$DEST"
git init -q .
git config user.email "expedite-fixture@example.com"
git config user.name "expedite fixture"
git config commit.gpgsign false

ticket_yaml() {
  cat <<YAML
id: $1
title: "fixture ticket $1"
milestone: M8
type: feature
status: todo
epic: fixture-epic
human_approval: approved
severity: medium
priority: 50
direction: human-requested
depends_on: []
assigned_to: coder
mutation_cost: low
source: |
  Fixture for BL-567's own acceptance run.
acceptance: |
  specs/features/$1-fixture.feature
YAML
}

for t in "${ACTIVE[@]}"; do
  ticket_yaml "$t" > "backlog/active/$t-fixture.yaml"
  printf 'Feature: fixture %s\n\n  Scenario: it exists\n    Given a fixture\n' "$t" \
    > "specs/features/$t-fixture.feature"
done

# A per-role settings file, so the driver resolves model/effort the same way the
# launch scripts do rather than parsing the pack conf.
for role in specifier coder cleaner architect hardender documenter QA; do
  cat > ".swarmforge/launch/$role.claude-settings.json" <<JSON
{ "model": "claude-sonnet-5", "effortLevel": "medium" }
JSON
done

# A stale tmux socket FILE with no server behind it - scenario 10's measured
# false positive. kill_all_swarm.sh leaves exactly this behind.
: > .swarmforge/tmux/99999999.sock

# Pending parcels in two role mailboxes - scenario 13 asserts these survive.
printf 'id: fixture-parcel-1\nfrom: coder\nto: cleaner\ntype: note\n' \
  > .swarmforge/handoffs/cleaner/inbox/new/50_fixture_from_coder.handoff
printf 'id: fixture-parcel-2\nfrom: architect\nto: coder\ntype: note\n' \
  > .swarmforge/handoffs/coder/inbox/new/00_fixture_from_architect.handoff

# Stop/start stubs. Overridden per-scenario via EXPEDITE_STOP_CMD /
# EXPEDITE_START_CMD; these are the honest defaults.
cat > stop-swarm.sh <<'SH'
#!/usr/bin/env bash
echo "fixture stop: nothing to stop"
exit 0
SH
cat > start-swarm.sh <<'SH'
#!/usr/bin/env bash
echo "fixture start: nothing to start"
exit 0
SH

# A stop that LIES: exits 0 while leaving a survivor behind. Scenario 14.
cat > stop-swarm-lying.sh <<'SH'
#!/usr/bin/env bash
echo "kill_all_swarm SUCCESS - clean slate"
exit 0
SH

# A start that fails. Scenario 16.
cat > start-swarm-broken.sh <<'SH'
#!/usr/bin/env bash
echo "start failed: fixture" >&2
exit 1
SH

chmod +x stop-swarm.sh start-swarm.sh stop-swarm-lying.sh start-swarm-broken.sh

# The stage runner seam. Reads a per-role directive from
# .swarmforge/expedite-fixture/<role>.verdict (json), defaulting to pass, and
# records that it ran so a test can assert which stages executed.
mkdir -p .swarmforge/expedite-fixture
cat > stage-runner.sh <<'SH'
#!/usr/bin/env bash
# argv: <role> <ticket> <prompt-file> <verdict-file> <transcript>
set -euo pipefail
ROLE="$1"; TICKET="$2"; PROMPT="$3"; VERDICT="$4"; TRANSCRIPT="$5"
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "$ROLE" >> "$ROOT/.swarmforge/expedite-fixture/ran.log"
echo "stage $ROLE for $TICKET (prompt $(wc -c < "$PROMPT") bytes)" > "$TRANSCRIPT"
DIRECTIVE="$ROOT/.swarmforge/expedite-fixture/$ROLE.verdict"
if [[ -f "$DIRECTIVE" ]]; then
  cat "$DIRECTIVE" > "$VERDICT"
else
  echo '{"verdict":"pass"}' > "$VERDICT"
fi
SH
chmod +x stage-runner.sh

# A GENUINELY hung stage runner: never writes a verdict, never exits, and spawns
# a grandchild. The earlier "slow" runner slept then RETURNED, which is why a
# report-only timeout passed its scenario while a real hang would have blocked the
# driver forever. Anything asserting the timeout must use this one.
cat > stage-runner-hung.sh <<'SH'
#!/usr/bin/env bash
sleep 3600 &
sleep 3600
SH
chmod +x stage-runner-hung.sh

git add -A
git commit -qm "fixture: initial"
git branch -M main 2>/dev/null || true

echo "$DEST"

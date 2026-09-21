#!/usr/bin/env bash
# Install the weekly recruiter line into the live user crontab, root-scoped,
# the same way the freshness / shift-schedule / descent-review crons are
# installed (marker-based, idempotent, removed with the other swarmforge
# lines on stop). Monday 06:00 local: the swarm is down (day shift starts
# 09:00 weekdays), so the CPU-only battery does not compete with a running
# pack and its verdict is waiting when the week starts.
#
# The job is an OFFER, never a staffing action: recruiter_weekly.sh pulls,
# registers, benchmarks and asks the Model Steward to certify; it never
# launches a pack, edits a pack conf, binds a seat, or commits.
#
# Usage: install_recruiter_cron.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: install_recruiter_cron.sh <project-root>}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB="$SCRIPT_DIR/recruiter_weekly.sh"
MARKER="# swarmforge-recruiter-weekly $ROOT"
SCHEDULE="${SWARMFORGE_RECRUITER_SCHEDULE:-0 6 * * 1}"
LOG="$ROOT/.swarmforge/recruiter/recruiter-weekly.cron.log"

if ! command -v crontab >/dev/null 2>&1; then
  echo "install_recruiter_cron.sh: no crontab command on this host; the weekly recruiter will NOT run for $ROOT" >&2
  exit 1
fi
for dep in bb ollama python3; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "install_recruiter_cron.sh: $dep missing; cannot schedule the weekly recruiter for $ROOT" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$LOG")"
existing="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$existing" | grep -vF "$MARKER" || true)"
# PATH pinned like the freshness line: cron's default PATH has neither bb nor ollama.
line="$SCHEDULE PATH=$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin bash $JOB $ROOT >>$LOG 2>&1 $MARKER"

printf '%s\n%s\n' "$filtered" "$line" | grep -v '^$' | crontab -
echo "install_recruiter_cron.sh: scheduled weekly recruiter for $ROOT ($SCHEDULE)"

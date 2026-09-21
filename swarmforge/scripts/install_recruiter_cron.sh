#!/usr/bin/env bash
# Install the recruiter cron line into the live user crontab, root-scoped,
# the same way the freshness / shift-schedule / descent-review crons are
# installed (marker-based, idempotent, removed with the other swarmforge
# lines on stop). Weeknights 22:00 local (human, 2026-09-21: the pass costs
# zero paid tokens, so run several per night): the swarm is down from the
# 17:00 bedtime to the 09:00 day-shift start, so the CPU-only battery never
# competes with a running pack, and recruiter_nightly.sh skips itself if a
# swarm is live anyway. Weekdays only - the weekend night shift (night-start
# 01:00 Sat/Sun) owns those nights.
#
# The job is an OFFER, never a staffing action: it pulls, registers,
# benchmarks and asks the Model Steward to certify (and lets the Steward
# evict less capable models between candidates); it never launches a pack,
# edits a pack conf, binds a seat, or commits.
#
# Usage: install_recruiter_cron.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: install_recruiter_cron.sh <project-root>}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB="$SCRIPT_DIR/recruiter_nightly.sh"
MARKER="# swarmforge-recruiter-weekly $ROOT"
SCHEDULE="${SWARMFORGE_RECRUITER_SCHEDULE:-0 22 * * 1-5}"
LOG="$ROOT/.swarmforge/recruiter/recruiter-nightly.cron.log"

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
echo "install_recruiter_cron.sh: scheduled nightly recruiter (weeknights) for $ROOT ($SCHEDULE)"

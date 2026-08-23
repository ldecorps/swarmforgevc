'use strict';

// BL-1108 declared invariants (property authorship rests with the coder,
// first pass — BL-654):
//
//   1. "For every configured agent token, a live-seat process judgement uses
//      that token's expected process marker rather than assuming Claude."
//   2. "A non-Claude seat never reports a Claude remote-control capability as
//      healthy; it reports that capability as off while its agent health
//      remains independently checkable."
//
// Both drive the REAL babysitter_check / babysitterd_sweep_lib decision
// functions via bl1108_cursor_seat_readiness_acceptance_runner.bb — never a
// JS restatement of the marker table or RC applicability.
//
// The agent set is the live marker map (not a hand-copied allow-list). Each
// draw pairs an agent with (a) its own marker argv and (b) a foreign Claude
// argv, so a regression that always looks for `claude ` fails the non-Claude
// rows by construction.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (staged-first restore, run 2026-08-23, recorded in the parcel
// commit):
//   break 1 - agent-process-marker forced to always return "claude ": RED on
//     the first non-claude draw, "used Claude's marker for agent=<token>".
//   break 2 - check-remote-control ignoring :rc-applicable?: RED on every
//     non-claude present seat, "reported remote-control degraded/healthy
//     instead of off".
//   break 3 - agent-process-line ignoring the agent arg (always "claude "):
//     RED on cursor draws that plant only cursor-agent in ps, "process
//     result absent while the expected marker was present".
// All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl1108_cursor_seat_readiness_acceptance_runner.bb'
);
const BABYSITTER_CHECK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitter_check.bb');
const SWARM_ENSURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_ensure.bb');

function runBb(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload || {})], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function extractMarkerMap(sourcePath) {
  const src = fs.readFileSync(sourcePath, 'utf8');
  const m = src.match(/agent-process-markers\s*(\{[\s\S]*?\})/);
  assert.ok(m, `no agent-process-markers map in ${sourcePath}`);
  // Babashka map → JSON-ish: "claude" "claude " → {"claude":"claude "}
  const body = m[1]
    .replace(/"/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  // Parse pairs "k" "v"
  const pairs = [...body.matchAll(/"([^"]+)"\s+"([^"]*)"/g)];
  assert.ok(pairs.length > 0, `could not parse markers from ${sourcePath}: ${body}`);
  const out = {};
  for (const [, k, v] of pairs) out[k] = v;
  return out;
}

test('BL-1108/BL-654 invariant 1: every configured agent token uses its own process marker, never Claude by default', () => {
  const { markers } = runBb('markers', {});
  const tokens = Object.keys(markers);
  assert.ok(tokens.includes('cursor'), 'cursor must be in the live marker map');
  assert.ok(tokens.includes('claude'), 'claude must be in the live marker map');
  assert.ok(tokens.length >= 5, `marker map too small to be the live table: ${tokens.join(',')}`);

  let nonClaudePresent = 0;
  let claudePresent = 0;
  let foreignClaudeRejected = 0;

  for (const agent of tokens) {
    const marker = markers[agent];
    const own = runBb('live-seat-health', { agent, process: marker.trimEnd() });
    assert.equal(
      own.marker,
      marker,
      `agent-process-marker(${agent}) drifted from the map entry`
    );
    assert.equal(
      own.processResult,
      'present',
      `expected process present for ${agent} with its own marker; got ${JSON.stringify(own)}`
    );
    if (agent === 'claude') claudePresent += 1;
    else nonClaudePresent += 1;

    if (agent !== 'claude') {
      // A Claude-shaped child must NOT satisfy a non-Claude seat.
      const foreign = runBb('live-seat-health', {
        agent,
        process: 'claude --model opus',
      });
      // process-argv for non-claude does not append --remote-control; the
      // fabricated line is Claude-shaped. Marker is cursor-agent/etc., so
      // the line must not match.
      assert.equal(
        foreign.processResult,
        'absent',
        `non-Claude agent ${agent} matched a Claude-only argv — marker still assumes Claude: ${JSON.stringify(foreign)}`
      );
      foreignClaudeRejected += 1;
    }
  }

  assert.ok(nonClaudePresent >= 4, `reachability: too few non-Claude agents exercised (${nonClaudePresent})`);
  assert.equal(claudePresent, 1, 'claude row must be exercised exactly once');
  assert.equal(
    foreignClaudeRejected,
    nonClaudePresent,
    'every non-Claude agent must reject a Claude-only argv'
  );

  // Cross-language mirror (BL-897): babysitter_check and swarm_ensure keep
  // the same token→needle map by hand — a "kept in sync" comment is not a gate.
  const ensureMap = extractMarkerMap(SWARM_ENSURE);
  const checkMap = extractMarkerMap(BABYSITTER_CHECK);
  assert.deepEqual(
    ensureMap,
    checkMap,
    'swarm_ensure.bb and babysitter_check.bb agent-process-markers drifted'
  );
  assert.deepEqual(checkMap, markers, 'runner markers must match the babysitter_check source map');
});

test('BL-1108/BL-654 invariant 2: non-Claude seats report remote-control OFF; agent health stays independently checkable', () => {
  const { markers } = runBb('markers', {});
  let offWithPresent = 0;
  let claudeHealthy = 0;
  let claudeDegraded = 0;

  for (const agent of Object.keys(markers)) {
    const marker = markers[agent];
    const present = runBb('live-seat-health', { agent, process: marker.trimEnd() });

    if (agent === 'claude') {
      assert.equal(present.remoteControlResult, 'healthy', JSON.stringify(present));
      assert.equal(present.processResult, 'present');
      claudeHealthy += 1;
    } else {
      assert.equal(
        present.remoteControlResult,
        'off',
        `non-Claude ${agent} must report RC off, got ${JSON.stringify(present)}`
      );
      assert.equal(
        present.processResult,
        'present',
        `RC-off must not hide agent health for ${agent}: ${JSON.stringify(present)}`
      );
      assert.equal(present.rcApplicable, false);
      offWithPresent += 1;
    }
  }

  assert.ok(offWithPresent >= 4, `reachability: non-Claude OFF+present draws too few (${offWithPresent})`);
  assert.equal(claudeHealthy, 1);

  // Claude RC still applicable: a present Claude seat is healthy (runner
  // supplies --remote-control). Confirm degraded path via the sweep lib
  // through a second markers call is insufficient — use live-seat and then
  // assert the babysitterd_sweep_lib path via a dedicated bb snippet.
  const degraded = execFileSync(
    'bb',
    [
      '-e',
      `
(require '[babashka.fs :as fs] '[cheshire.core :as json])
(def scripts "${path.join(REPO_ROOT, 'swarmforge', 'scripts').replace(/\\/g, '/')}")
(load-file (str scripts "/babysitterd_sweep_lib.bb"))
(def f (babysitterd-sweep-lib/check-remote-control
         {:role "coder" :pane-exists? true :has-claude-process? true
          :has-remote-control? false :rc-applicable? true}))
(def off (babysitterd-sweep-lib/check-remote-control
           {:role "coder" :pane-exists? true :has-claude-process? true
            :has-remote-control? false :rc-applicable? false}))
(println (json/generate-string {:claudeDegraded (boolean f)
                                :cursorNil (nil? off)
                                :severity (some-> f :severity)}))
`,
    ],
    { encoding: 'utf8' }
  );
  const d = JSON.parse(degraded.trim().split('\n').pop());
  assert.equal(d.claudeDegraded, true, 'Claude missing --remote-control must WARN');
  assert.equal(d.severity, 'WARN');
  assert.equal(d.cursorNil, true, 'non-applicable RC must produce no finding');
  claudeDegraded += 1;
  assert.equal(claudeDegraded, 1);
});

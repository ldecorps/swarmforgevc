'use strict';

// BL-2055's two declared invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A restart's fresh turn only ever carries the override
//                written for the handoff that is in the seat's
//                in_process when qwen exits - never an earlier parcel's
//                left-behind override, however it sorts.
//   invariant 2  A seat whose in_process holds no handoff file (sidecars
//                do not count) is never restarted and sends no release
//                note.
//
// Invariant 1 drives the REAL `local-model)` case block extracted from
// swarmforge.sh - the same awk extraction
// swarmforge/scripts/test/test_bl1991_local_seat_restart_launch.sh uses -
// under zsh, against a fake qwen that only logs its own invocations.
// Invariant 2 drives the REAL local_model_repeat_guard.bb `answer`,
// load-file'd straight from swarmforge/scripts/ (never restated), with
// fake kill/release callbacks that only record whether they were called -
// never a real kill or a real swarm_handoff.sh send.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { execFileSync, spawnSync } = require('node:child_process');
const { assertReachFloor } = require('./helpers/reachFloors');
const { mkTmpDir } = require('./helpers/tmpDir');

const SCRIPTS = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS, 'swarmforge.sh');
const GUARD = path.join(SCRIPTS, 'local_model_repeat_guard.bb');

// ── invariant 1: the launch script's relaunch loop ───────────────────────

function extractLocalModelCase() {
  const text = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  const lines = text.split('\n');
  const out = [];
  let flag = false;
  for (const line of lines) {
    if (/^    local-model\)/.test(line)) {
      flag = true;
    }
    if (flag) {
      out.push(line);
      if (/^      ;;/.test(line)) {
        break;
      }
    }
  }
  return out.join('\n');
}

const CASE_TEXT = extractLocalModelCase();
assert.ok(CASE_TEXT, `local-model) case not found in ${SWARMFORGE_SH}`);

function quoteZsh(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildLaunchFixture() {
  const root = mkTmpDir('bl2055-inv1-launch-');
  const bin = path.join(root, 'bin');
  const inProcessDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  const restartDir = path.join(root, '.swarmforge', 'local-seat-restart');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.mkdirSync(restartDir, { recursive: true });

  const harnessPath = path.join(root, 'harness.zsh');
  const launchBodyPath = path.join(root, 'launch_body.sh');
  fs.writeFileSync(
    harnessPath,
    [
      '#!/usr/bin/env zsh',
      'function swarm_only_strip_seat_tier() { echo "$1"; }',
      `local role_worktree=${quoteZsh(root)}`,
      `local prompt_file=${quoteZsh(path.join(root, 'card.md'))}`,
      'local extra_cli=""',
      'local agent="local-model"',
      'local launch_body=""',
      'case "$agent" in',
      CASE_TEXT,
      'esac',
      `print -r -- "$launch_body" > ${quoteZsh(launchBodyPath)}`,
      '',
    ].join('\n')
  );
  execFileSync('zsh', ['-f', harnessPath], { encoding: 'utf8' });
  assert.ok(fs.statSync(launchBodyPath).size > 0, 'the case block produced no launch_body');

  return { root, bin, inProcessDir, restartDir, launchBodyPath, callsLog: path.join(root, 'qwen_calls.log') };
}

function runLaunchBody(fx) {
  const qwenPath = path.join(fx.bin, 'qwen');
  fs.writeFileSync(qwenPath, ['#!/usr/bin/env zsh', `echo "QWEN_INVOKED $*" >> ${quoteZsh(fx.callsLog)}`, 'exit 0', ''].join('\n'));
  fs.chmodSync(qwenPath, 0o755);
  fs.writeFileSync(fx.callsLog, '');
  execFileSync('zsh', ['-f', '-c', `set -euo pipefail; source ${quoteZsh(fx.launchBodyPath)}; echo SCRIPT_FINISHED`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:/usr/bin:/bin`, LOCAL_RESUME_NOTE: '' },
  });
  return fs
    .readFileSync(fx.callsLog, 'utf8')
    .split('\n')
    .filter(Boolean);
}

const safeSuffix = fc.string({ minLength: 1, maxLength: 10 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'x') || 'x');

const INV1_FLOOR = 10;
test('property (BL-2055 invariant 1): a restart carries only the override for the parcel in in_process, whatever else sorts first', () => {
  const coverage = {};
  fc.assert(
    fc.property(safeSuffix, fc.integer({ min: 0, max: 3 }), fc.boolean(), (suffix, staleCount, hasHeld) => {
      const shape = hasHeld ? 'held' : 'noHeld';
      coverage[shape] = (coverage[shape] || 0) + 1;
      const fx = buildLaunchFixture();
      try {
        const heldName = `held-${suffix}.handoff`;
        if (hasHeld) {
          fs.writeFileSync(path.join(fx.inProcessDir, heldName), 'type: git_handoff\nto: coder\n');
          fs.writeFileSync(path.join(fx.restartDir, `${heldName}.json.msg`), `HELD-OVERRIDE-${suffix}`);
        }
        const staleNames = [];
        for (let i = 0; i < staleCount; i += 1) {
          // "0_" sorts before "held-" alphabetically - the exact failure
          // mode this invariant closes (the old code served whichever
          // override sorted first, regardless of whose parcel it was).
          const staleName = `0_stale-${i}-${suffix}.handoff`;
          staleNames.push(staleName);
          fs.writeFileSync(path.join(fx.restartDir, `${staleName}.json.msg`), `STALE-OVERRIDE-${i}-${suffix}`);
        }

        const calls = runLaunchBody(fx);
        if (hasHeld) {
          assert.equal(calls.length, 2, `expected a kickoff plus one relaunch, got:\n${calls.join('\n')}`);
          assert.ok(calls[1].includes(`HELD-OVERRIDE-${suffix}`), `the relaunch did not carry the held override: ${calls[1]}`);
        } else {
          assert.equal(calls.length, 1, `expected only the kickoff (no held parcel), got:\n${calls.join('\n')}`);
        }
        for (const staleName of staleNames) {
          assert.ok(!fs.existsSync(path.join(fx.restartDir, `${staleName}.json.msg`)), `a stale override for ${staleName} was not discarded`);
        }
        return true;
      } finally {
        fs.rmSync(fx.root, { recursive: true, force: true });
      }
    }),
    { numRuns: 30 }
  );
  assertReachFloor(coverage, ['held', 'noHeld'], INV1_FLOOR, 'BL-2055 invariant 1 held/noHeld shape');
});

// ── invariant 2: the repeat guard's in-process-handoff-name ──────────────

function compactionLine(nextStep) {
  return JSON.stringify({
    type: 'system',
    subtype: 'chat_compression',
    systemPayload: { compressedHistory: [{ role: 'user', parts: [{ text: `<state_snapshot>\n<next_step>\n${nextStep}\n</next_step>\n</state_snapshot>` }] }] },
  });
}

function callLine(name, args) {
  return JSON.stringify({ type: 'assistant', message: { role: 'model', parts: [{ functionCall: { name, args } }] } });
}

// Drives the REAL answer with in_process holding ONLY a sidecar (never a
// real handoff file) - varying which of the four known sidecar suffixes,
// and whether this sidecar's own would-be restart count is already at the
// release cap - proving neither a restart NOR a release can fire, however
// close the transcript otherwise looks to triggering either.
function callAnswerSidecarOnly(sidecarSuffix, priorRestarts) {
  const root = mkTmpDir('bl2055-inv2-guard-');
  try {
    const sidecarName = `released-parcel.handoff${sidecarSuffix}`;
    const inProcessDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.mkdirSync(inProcessDir, { recursive: true });
    fs.writeFileSync(path.join(inProcessDir, sidecarName), JSON.stringify({ claimed_at: '2026-10-07T00:00:00Z' }));

    if (priorRestarts > 0) {
      const countFile = path.join(root, '.swarmforge', 'local-seat-restart', `${sidecarName}.json`);
      fs.mkdirSync(path.dirname(countFile), { recursive: true });
      fs.writeFileSync(countFile, JSON.stringify({ restarts: priorRestarts }));
    }

    const transcriptPath = path.join(root, 'transcript.jsonl');
    const nextStep = 'Write tmp/notes.md and run its feature.';
    const lines = [compactionLine(nextStep), callLine('read_file', { file_path: '/probe-1' }), callLine('read_file', { file_path: '/probe-2' })];
    fs.writeFileSync(transcriptPath, `${lines.join('\n')}\n`);

    const event = {
      tool_name: 'read_file',
      tool_input: { file_path: '/probe-3' },
      transcript_path: transcriptPath,
      cwd: root,
    };
    const program = `
(require '[cheshire.core :as json] '[clojure.string :as str])
(load-file "${GUARD}")
(def killed (atom false))
(def released (atom false))
(def event (json/parse-string ${JSON.stringify(JSON.stringify(event))}))
(local-model-repeat-guard/answer event #(str/split-lines (slurp %)) (fn [] (reset! killed true)) (fn [_cwd] (reset! released true)))
(println (str "BL2055|" (json/generate-string {:killed @killed :released @released})))`;
    const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) {
      throw new Error(`bb failed (${r.status}): ${r.stderr}\n${r.stdout}`);
    }
    const line = r.stdout.split('\n').find((l) => l.startsWith('BL2055|'));
    assert.ok(line, `no BL2055| line in bb output: ${r.stdout}`);
    return JSON.parse(line.slice('BL2055|'.length));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const SIDECAR_SUFFIXES = ['.nudge', '.chase.json', '.claim-progress.json', '.batch-claim-progress.json'];
const INV2_CELLS = SIDECAR_SUFFIXES.flatMap((suffix) => [`${suffix}:fresh`, `${suffix}:exhausted`]);
const INV2_FLOOR = 2;

test('property (BL-2055 invariant 2): a sidecar alone in in_process is never read as a held parcel - no restart, no release', () => {
  const coverage = {};
  fc.assert(
    fc.property(fc.constantFrom(...SIDECAR_SUFFIXES), fc.boolean(), (suffix, exhausted) => {
      const cell = `${suffix}:${exhausted ? 'exhausted' : 'fresh'}`;
      coverage[cell] = (coverage[cell] || 0) + 1;
      const { killed, released } = callAnswerSidecarOnly(suffix, exhausted ? 2 : 0);
      assert.equal(killed, false, `a sidecar (${suffix}) alone in in_process must never trigger a restart (exhausted=${exhausted})`);
      assert.equal(released, false, `a sidecar (${suffix}) alone in in_process must never trigger a release (exhausted=${exhausted})`);
      return true;
    }),
    { numRuns: 64 }
  );
  assertReachFloor(coverage, INV2_CELLS, INV2_FLOOR, 'BL-2055 invariant 2 sidecar-suffix x restart-state cell');
});

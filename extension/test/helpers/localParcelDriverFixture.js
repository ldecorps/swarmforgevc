'use strict';

// BL-1697: shared throwaway-project fixture for
// `swarmforge/scripts/local_parcel_driver_lib.bb` - drives the REAL
// driver (via local_parcel_driver_cli.bb, one tick per CLI call so the
// test can act as the scripted stand-in model between ticks) against a
// fake tmux (extension/test/helpers/fakeTmux.js) and a real throwaway git
// checkout with the real `seat` script (BL-1696) copied in. No real
// model, no live router, no real pipeline script ever run.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { mkProcessTmpDir, sweepStaleTmpDirs } = require('./tmpDir');
const { installFakeTmux } = require('./fakeTmux');

const PREFIX = 'bl1697-driver-';
const REAL_SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const REAL_SEAT = path.join(REAL_SCRIPTS_DIR, 'seat');
const DRIVER_CLI = path.join(REAL_SCRIPTS_DIR, 'local_parcel_driver_cli.bb');

// `seat test` resolves its config through this real chain (BL-1696) -
// copied in so the fixture exercises the REAL resolution rather than
// degrading to "unconfigured" for the wrong reason (the file simply not
// existing, which is BL-1696's own OWN unconfigured-case fixture shape,
// not this ticket's).
const SEAT_TEST_CONFIG_FILES = [
  'backlog_depth_conf_path_cli.bb',
  'backlog_depth_lib.bb',
  'swarm_identity_lib.bb',
  'daemon_cycle_guard_lib.bb',
];

let sweptStaleRoots = false;
function sweepStaleRootsOnce() {
  if (!sweptStaleRoots) {
    sweptStaleRoots = true;
    sweepStaleTmpDirs({ prefix: PREFIX });
  }
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

// Recorder-stub scripts (BL-1696's own convention): only the REAL claim/
// complete file moves matter to the driver's own contract (it reads the
// in_process file itself, per the ticket's own direction) - everything
// else just logs.
const READY_FOR_NEXT_STUB = `#!/usr/bin/env bash
set -u
dir="$(git rev-parse --show-toplevel)"
new_dir="$dir/.swarmforge/handoffs/inbox/new"
proc_dir="$dir/.swarmforge/handoffs/inbox/in_process"
mkdir -p "$proc_dir"
first="$(ls "$new_dir" 2>/dev/null | grep '\\.handoff$' | sort | head -1 || true)"
if [ -n "$first" ]; then
  mv "$new_dir/$first" "$proc_dir/$first"
fi
exit 0
`;

const DONE_WITH_CURRENT_STUB = `#!/usr/bin/env bash
set -u
dir="$(git rev-parse --show-toplevel)"
proc_dir="$dir/.swarmforge/handoffs/inbox/in_process"
done_dir="$dir/.swarmforge/handoffs/inbox/completed"
mkdir -p "$done_dir"
for f in "$proc_dir"/*.handoff; do
  [ -e "$f" ] || continue
  mv "$f" "$done_dir/"
done
exit 0
`;

const SWARM_HANDOFF_STUB = (logPath) => `#!/usr/bin/env bash
draft="\${1:-}"
{
  printf 'swarm_handoff.sh\\x1f%s\\n' "$(cat "$draft" 2>/dev/null | tr '\\n' '\\x1e')"
} >> "${logPath}"
echo "HANDOFF DELIVERED: $draft"
exit 0
`;

const ROLE_ASK_STUB = (logPath) => `#!/usr/bin/env bb
(let [args (vec *command-line-args*)]
  (spit "${logPath}" (str "role_ask.bb" (apply str (map #(str "\\u001f" %) args)) "\\n") :append true))
`;

function makeLocalParcelDriverFixture() {
  sweepStaleRootsOnce();
  const root = mkProcessTmpDir(`${PREFIX}${process.pid}-`);
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'driver-fixture@example.test']);
  git(root, ['config', 'user.name', 'Driver Fixture']);

  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const realRoot = fs.realpathSync(root);
  const realCommon = fs.realpathSync(commonDir);
  if (!realCommon.startsWith(realRoot)) {
    throw new Error(`driver fixture: git-common-dir "${realCommon}" escapes fixture root "${realRoot}"`);
  }

  const callLog = path.join(root, 'call.log');
  fs.writeFileSync(callLog, '');

  writeExecutable(path.join(scriptsDir, 'ready_for_next.sh'), READY_FOR_NEXT_STUB);
  writeExecutable(path.join(scriptsDir, 'done_with_current.sh'), DONE_WITH_CURRENT_STUB);
  writeExecutable(path.join(scriptsDir, 'swarm_handoff.sh'), SWARM_HANDOFF_STUB(callLog));
  writeExecutable(path.join(scriptsDir, 'role_ask.bb'), ROLE_ASK_STUB(callLog));
  writeExecutable(path.join(scriptsDir, 'seat'), fs.readFileSync(REAL_SEAT, 'utf8'));
  for (const name of SEAT_TEST_CONFIG_FILES) {
    fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(scriptsDir, name));
  }

  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      ['coder', 'coder', root, 'sf-coder', 'Coder', 'aider', 'task', 'off', 'forward-only'].join('\t'),
      ['specifier', 'master', root, 'sf-specifier', 'Specifier', 'claude', 'task', 'off', 'forward-only'].join('\t'),
      ['cleaner', 'cleaner', root, 'sf-cleaner', 'Cleaner', 'claude', 'batch', 'off', 'back-one'].join('\t'),
      ['coordinator', 'master', root, 'sf-coordinator', 'Coordinator', 'claude', 'task', 'off', 'forward-only'].join(
        '\t'
      ),
      // BL-1698 requirement 4: a QA merge-up note names QA as the sender.
      ['QA', 'QA', root, 'sf-QA', 'QA', 'claude', 'task', 'off', 'forward-only'].join('\t'),
    ].join('\n') + '\n'
  );

  // The acceptance check: `editable.txt` must contain MARKER for the
  // ticket's own acceptance to "pass". Wired as this pack's
  // seat_test_command (BL-1696's own resolution path).
  fs.writeFileSync(path.join(root, 'editable.txt'), 'original content\n');
  const checkScript = `const fs=require('fs');process.exit(fs.readFileSync('editable.txt','utf8').includes('MARKER_FIXED')?0:1);`;
  fs.writeFileSync(path.join(root, 'check.js'), checkScript);
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `config seat_test_command node check.js\n`
  );

  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);

  const ticketPath = path.join(root, 'backlog', 'active', 'BL-9.yaml');
  const featurePath = path.join(root, 'specs', 'features', 'BL-9-thing.feature');

  const fixture = {
    root,
    scriptsDir,
    callLog,
    ticketPath,
    featurePath,

    writeTicket({ editablePaths = ['editable.txt'] } = {}) {
      const scopeLines = editablePaths.map((p) => `  - \`${p}\``).join('\n');
      fs.writeFileSync(
        ticketPath,
        [
          'id: BL-9',
          'required_stages: [coder, cleaner, architect, hardender, documenter, qa]',
          'acceptance: specs/features/BL-9-thing.feature',
          'description: |',
          '  ## Scope',
          scopeLines,
          '',
        ].join('\n')
      );
      fs.writeFileSync(featurePath, 'Feature: BL-9 thing\n\n  Scenario: it works\n    Then it passes\n');
      git(root, ['add', ticketPath, featurePath]);
      git(root, ['commit', '-q', '-m', 'add BL-9 ticket and feature']);
    },

    // Places a git_handoff parcel in inbox/new naming a commit on a
    // side branch as the payload - the driver's own "serve" step reads
    // this file directly, per the ticket's own direction.
    queueParcel(commitSha, { from = 'specifier' } = {}) {
      const p = path.join(
        root,
        '.swarmforge',
        'handoffs',
        'inbox',
        'new',
        `00_20260924T000000Z_000001_from_${from}_to_coder_for_coder.handoff`
      );
      fs.writeFileSync(
        p,
        ['type: git_handoff', 'from: ' + from, 'to: coder', 'priority: 00', 'task: BL-9', 'commit: ' + commitSha, ''].join(
          '\n'
        )
      );
      return p;
    },

    // BL-1698 requirement 4b: a non-forwarding reverse-hop copy - merged
    // and completed mechanically, no model turn.
    queueNonForwardingParcel(commitSha, { from = 'cleaner' } = {}) {
      const p = path.join(
        root,
        '.swarmforge',
        'handoffs',
        'inbox',
        'new',
        `00_20260924T000000Z_000002_from_${from}_to_coder_for_coder.handoff`
      );
      fs.writeFileSync(
        p,
        [
          'type: git_handoff',
          'from: ' + from,
          'to: coder',
          'priority: 00',
          'non-forwarding: true',
          'task: BL-9',
          'commit: ' + commitSha,
          '',
        ].join('\n')
      );
      return p;
    },

    // BL-1698 requirements 4a/5: a `type: note` mail item - either a QA
    // merge-up note (handoff-protocol.md's own shape) or any other note.
    queueNoteMail(message, { from = 'specifier' } = {}) {
      const p = path.join(
        root,
        '.swarmforge',
        'handoffs',
        'inbox',
        'new',
        `00_20260924T000000Z_000003_from_${from}_to_coder_for_coder.handoff`
      );
      fs.writeFileSync(
        p,
        ['type: note', 'from: ' + from, 'to: coder', 'priority: 00', 'message: ' + message, ''].join('\n')
      );
      return p;
    },

    // BL-1698 requirement 2: a waiting human answer, matched to a
    // pending role-ask marker by the SAME asked_at_ms both files carry
    // (telegram-front-desk-bot.ts's own correlation contract).
    writeWaitingAnswer(text) {
      const askedAtMs = Date.now();
      const awaitingDir = path.join(root, '.swarmforge', 'operator', 'role-awaiting');
      const answersDir = path.join(root, '.swarmforge', 'operator', 'role-answers');
      fs.mkdirSync(awaitingDir, { recursive: true });
      fs.mkdirSync(answersDir, { recursive: true });
      fs.writeFileSync(
        path.join(awaitingDir, 'coder.json'),
        JSON.stringify({ question: 'acceptance still failing', asked_at_ms: askedAtMs })
      );
      fs.writeFileSync(
        path.join(answersDir, 'coder.json'),
        JSON.stringify({ text, recordedAt: new Date().toISOString(), askedAtMs })
      );
    },

    // BL-1698 requirement 2's own consumption path - a minimal stand-in
    // for extension/out/tools/deliver-role-answer.js (the same
    // delivered/no-answer/mismatch/already-consumed shape, never a
    // direct read of role-answers/<role>.json by the driver itself).
    installDeliverRoleAnswerStub() {
      const dir = path.join(root, 'extension', 'out', 'tools');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'deliver-role-answer.js'),
        `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const idx = process.argv.indexOf('--role');
const role = idx >= 0 ? process.argv[idx + 1] : undefined;
const root = process.cwd();
const answerPath = path.join(root, '.swarmforge', 'operator', 'role-answers', role + '.json');
const awaitingPath = path.join(root, '.swarmforge', 'operator', 'role-awaiting', role + '.json');
let answer;
try { answer = JSON.parse(fs.readFileSync(answerPath, 'utf8')); } catch { answer = undefined; }
if (!answer) { console.log(JSON.stringify({ kind: 'no-answer' })); process.exit(0); }
if (answer.consumedAt !== undefined) { console.log(JSON.stringify({ kind: 'already-consumed' })); process.exit(0); }
let awaiting;
try { awaiting = JSON.parse(fs.readFileSync(awaitingPath, 'utf8')); } catch { awaiting = undefined; }
const askedAtMs = awaiting ? awaiting.asked_at_ms : undefined;
if (answer.askedAtMs === undefined || askedAtMs === undefined || answer.askedAtMs !== askedAtMs) {
  console.log(JSON.stringify({ kind: 'mismatch' }));
  process.exit(0);
}
fs.writeFileSync(answerPath, JSON.stringify({ ...answer, consumedAt: new Date().toISOString() }));
console.log(JSON.stringify({ kind: 'delivered', text: answer.text }));
`
      );
    },

    // BL-1698 requirement 3: the release CLI verb, never typed into a
    // pane.
    releaseHold(mode) {
      const result = spawnSync('bb', [DRIVER_CLI, 'release', root, root, 'coder', 'coder', mode], {
        encoding: 'utf8',
      });
      return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    },

    // BL-1698 requirement 1: directly construct a persisted driver
    // record at a given phase - the test's own stand-in for "a driver
    // restarted mid-parcel", since each CLI invocation is already a
    // fresh process (there is no long-lived one to actually kill).
    writeDriverState(state) {
      const dir = path.join(root, '.swarmforge', 'local-driver');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'coder.json'), JSON.stringify(state));
    },

    readDriverState() {
      const p = path.join(root, '.swarmforge', 'local-driver', 'coder.json');
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    },

    // A commit on a side branch, merged in by the driver's own "merge"
    // step - clean by default (touches nothing main doesn't).
    makeSenderCommit({ conflict = false } = {}) {
      const startSha = git(root, ['rev-parse', 'HEAD']).trim();
      git(root, ['checkout', '-q', '-b', 'sender-branch']);
      if (conflict) {
        fs.writeFileSync(path.join(root, 'editable.txt'), 'sender-conflicting-content\n');
        git(root, ['commit', '-q', '-am', 'sender edits editable.txt']);
      } else {
        fs.writeFileSync(path.join(root, 'sender-file.txt'), 'from sender\n');
        git(root, ['add', 'sender-file.txt']);
        git(root, ['commit', '-q', '-m', 'sender commit']);
      }
      const sha = git(root, ['rev-parse', 'HEAD']).trim();
      git(root, ['checkout', '-q', 'main']);
      if (conflict) {
        fs.writeFileSync(path.join(root, 'editable.txt'), 'main-conflicting-content\n');
        git(root, ['commit', '-q', '-am', 'main edits editable.txt']);
      } else {
        git(root, ['reset', '-q', '--hard', startSha]);
      }
      git(root, ['branch', '-q', '-D', 'sender-branch']);
      return sha;
    },

    headSha() {
      return git(root, ['rev-parse', 'HEAD']).trim();
    },

    hasMergeInProgress() {
      return fs.existsSync(path.join(root, '.git', 'MERGE_HEAD'));
    },

    // ── Stand-in model actions - what a real aider model turn would have
    // committed, scripted per scenario. ──────────────────────────────────
    modelFixesIt() {
      fs.writeFileSync(path.join(root, 'editable.txt'), 'MARKER_FIXED\n');
      git(root, ['commit', '-q', '-am', 'model: fix it']);
    },

    modelLeavesItBroken(n = 0) {
      fs.writeFileSync(path.join(root, 'editable.txt'), `still broken attempt ${n}\n`);
      git(root, ['commit', '-q', '-am', `model: attempt ${n}`]);
    },

    modelMakesNoCommit() {
      /* no-op: the model turn produced no commit */
    },

    // The real filesystem protection (444) would block a real aider tool
    // write here too - this scenario exists to prove the GATE's own
    // spec-byte check as defense in depth, so the stand-in model chmods
    // around the protection the same way it would need a bypass a real
    // model does not have, to reach the state the gate must still catch.
    // n varies the content on every call (a retry-loop tick may call this
    // more than once) - a repeated byte-identical write is a git no-op
    // ("nothing to commit"), which would silently turn a retry into "no
    // model commit" instead of the condition this scenario means to keep
    // failing on.
    modelEditsTheSpecToo(n = 0) {
      fs.chmodSync(featurePath, 0o644);
      fs.writeFileSync(path.join(root, 'editable.txt'), 'MARKER_FIXED\n');
      fs.writeFileSync(
        featurePath,
        `Feature: BL-9 thing\n\n  Scenario: it works\n    Then it ALWAYS passes\n# attempt ${n}\n`
      );
      git(root, ['commit', '-q', '-am', `model: fix it and edit the spec (attempt ${n})`]);
    },

    modelEditsOutsideItsFiles(n = 0) {
      fs.writeFileSync(path.join(root, 'editable.txt'), 'MARKER_FIXED\n');
      fs.writeFileSync(path.join(root, 'unlisted-file.txt'), `sneaky edit ${n}\n`);
      git(root, ['add', 'unlisted-file.txt']);
      git(root, ['commit', '-q', '-am', `model: fix it plus an unlisted file (attempt ${n})`]);
    },

    specWritable() {
      return (
        fs.statSync(ticketPath).mode & 0o200 ? true : false
      );
    },

    // Drives exactly one tick of the real driver via the CLI - the test
    // orchestrates the "model" between calls, and flips the fake tmux's
    // own rules to move the pane between busy/idle. Accepts either a
    // bare fixTurnsLimit number (BL-1697's own call shape, unchanged) or
    // an options object; { resume: true } (BL-1698) runs the
    // write-permission sweep once before this tick, standing in for
    // "the driver starts again".
    driveOneTick(opts = 3) {
      const { fixTurnsLimit = 3, resume = false } = typeof opts === 'number' ? { fixTurnsLimit: opts } : opts;
      const args = [
        DRIVER_CLI,
        root,
        root,
        'coder',
        'coder',
        'aider',
        fixture.tmux.socketPath || 'fake-socket',
        'sf-coder',
        String(fixTurnsLimit),
        '1',
        '0',
      ];
      if (resume) args.push('resume');
      const result = spawnSync('bb', args, { encoding: 'utf8' });
      return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    },

    recordedCalls() {
      const text = fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8') : '';
      return text
        .split('\n')
        .filter((l) => l.length > 0)
        .map((line) => {
          const parts = line.split('\u001f');
          return { script: parts[0], argv: parts.slice(1) };
        });
    },

    cleanup() {
      if (fixture.tmux) {
        fixture.tmux.restore();
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };

  fixture.tmux = installFakeTmux([{ subcommand: 'capture-pane', stdout: 'aider> ' }]);
  fixture.tmux.socketPath = 'fake-socket';

  return fixture;
}

module.exports = { makeLocalParcelDriverFixture };

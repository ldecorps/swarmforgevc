'use strict';

// BL-1696: shared throwaway-repo fixture for `swarmforge/scripts/seat` -
// used by both the acceptance step handler
// (specs/pipeline/steps/bl1696SeatCommandVocabularySteps.js) and the
// property tests (test/bl1696SeatCommandVocabulary.property.test.js), so
// the fixture shape is defined exactly once. Drives the REAL seat script
// (copied into the fixture, never reimplemented) against recorder-stub
// pipeline scripts that only append their own name and argv to one log -
// no real pipeline script and no model is ever run (engineering.prompt
// "Acceptance Pipeline").

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { mkProcessTmpDir, sweepStaleTmpDirs } = require('./tmpDir');

const PREFIX = 'bl1696-seat-';
const REAL_SEAT = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'seat');
const REAL_CONF_PATH_CLI = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'backlog_depth_conf_path_cli.bb');

// BL-971: reap any roots a killed prior run left behind, before the FIRST
// fixture of this process creates its own - a blind sweep would destroy a
// live peer's fixtures, but this one only removes roots whose recorded pid
// is no longer alive (sweepStaleTmpDirs' own contract). Deferred to first
// use, never run at module load - a step-handler file is required eagerly
// for every acceptance run regardless of whether its own scenario runs,
// and a directory listing at require time is exactly the module-load cost
// the handler-tree budget guard exists to catch.
let sweptStaleRoots = false;
function sweepStaleRootsOnce() {
  if (!sweptStaleRoots) {
    sweptStaleRoots = true;
    sweepStaleTmpDirs({ prefix: PREFIX });
  }
}

const UNIT_SEP = '\u001f';
const CONFLICT_FILE_NAME = 'shared.txt';

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

const RECORDER_BASH_TEMPLATE = (name) => `#!/usr/bin/env bash
{
  printf '%s' "${name}"
  for a in "$@"; do printf '\\x1f%s' "$a"; done
  printf '\\n'
} >> "$SEAT_FIXTURE_LOG"
exit 0
`;

const SWARM_HANDOFF_STUB = `#!/usr/bin/env bash
draft="\${1:-}"
{
  printf 'swarm_handoff.sh\\x1f%s\\n' "$draft"
} >> "$SEAT_FIXTURE_LOG"
counter="\${SEAT_FIXTURE_LOG}.swarm_handoff_calls"
echo x >> "$counter"
count=$(wc -l < "$counter" | tr -d ' ')
if [[ "\${SEAT_FIXTURE_AUDIT_CHALLENGE:-0}" == "1" && "$count" -eq 1 ]]; then
  echo "AUDIT_REQUIRED"
  echo "HANDOFF_NOT_QUEUED"
  exit 1
fi
echo "HANDOFF DELIVERED: $draft"
exit 0
`;

const ROLE_ASK_STUB = `#!/usr/bin/env bb
(let [log (System/getenv "SEAT_FIXTURE_LOG")
      args (vec *command-line-args*)]
  (spit log (str "role_ask.bb" (apply str (map #(str "\\u001f" %) args)) "\\n") :append true))
`;

function git(root, args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts });
}

function makeSeatFixture() {
  sweepStaleRootsOnce();
  const root = mkProcessTmpDir(`${PREFIX}${process.pid}-`);

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'seat-fixture@example.test']);
  git(root, ['config', 'user.name', 'Seat Fixture']);

  // Guardrail (engineering.prompt): prove this is a standalone repo before
  // any mutating git command ever runs against it.
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const realRoot = fs.realpathSync(root);
  const realCommon = fs.realpathSync(commonDir);
  if (!realCommon.startsWith(realRoot)) {
    throw new Error(`seat fixture: git-common-dir "${realCommon}" escapes fixture root "${realRoot}"`);
  }

  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });

  writeExecutable(path.join(scriptsDir, 'ready_for_next.sh'), RECORDER_BASH_TEMPLATE('ready_for_next.sh'));
  writeExecutable(path.join(scriptsDir, 'done_with_current.sh'), RECORDER_BASH_TEMPLATE('done_with_current.sh'));
  writeExecutable(path.join(scriptsDir, 'swarm_handoff.sh'), SWARM_HANDOFF_STUB);
  writeExecutable(path.join(scriptsDir, 'role_ask.bb'), ROLE_ASK_STUB);
  writeExecutable(path.join(scriptsDir, 'seat'), fs.readFileSync(REAL_SEAT, 'utf8'));

  const logPath = path.join(root, 'seat-fixture.log');
  fs.writeFileSync(logPath, '');

  // Seed one commit so HEAD always resolves (seat's `handoff`/`merge`
  // verbs need a real HEAD).
  fs.writeFileSync(path.join(root, 'README.md'), 'seat fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'seed']);

  const fixture = {
    root,
    logPath,
    auditChallenge: false,

    writeRolesFile(roles) {
      const lines = roles.map((r) => [r, 'x', 'x', 'x', 'x', 'x', 'x', 'x'].join('\t'));
      fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines.join('\n') + '\n');
    },

    setAuditChallenge(on) {
      fixture.auditChallenge = !!on;
    },

    projectRoot() {
      return root;
    },

    headSha() {
      return git(root, ['rev-parse', 'HEAD']).trim();
    },

    headParents() {
      return git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/).slice(1);
    },

    shortHeadSha() {
      return git(root, ['rev-parse', '--short=10', 'HEAD']).trim();
    },

    statusPorcelain() {
      return git(root, ['status', '--porcelain']).trim();
    },

    hasMergeInProgress() {
      return fs.existsSync(path.join(root, '.git', 'MERGE_HEAD'));
    },

    // Runs the fixture's own copy of `seat` with argv, as `role`. Never
    // shells the args together - spawnSync's argv array is the ONLY
    // channel, exactly what invariant 2 requires of seat's own callers too.
    run(role, argv, extraEnv = {}) {
      const env = {
        ...process.env,
        SWARMFORGE_ROLE: role === null ? undefined : role,
        SEAT_FIXTURE_LOG: logPath,
        SEAT_FIXTURE_AUDIT_CHALLENGE: fixture.auditChallenge ? '1' : '0',
        ...extraEnv,
      };
      if (role === null) {
        delete env.SWARMFORGE_ROLE;
      }
      const result = spawnSync(path.join(scriptsDir, 'seat'), argv, {
        cwd: root,
        env,
        encoding: 'utf8',
      });
      return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    },

    recordedCalls() {
      const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      return text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const parts = line.split(UNIT_SEP);
          return { script: parts[0], argv: parts.slice(1) };
        });
    },

    draftPathFor(role) {
      return role === 'coordinator' || role === 'specifier'
        ? path.join(root, 'swarmforge', 'runtime', 'handoff-draft.txt')
        : path.join(root, 'tmp', 'handoff.txt');
    },

    readDraft(role) {
      const p = fixture.draftPathFor(role);
      if (!fs.existsSync(p)) {
        return null;
      }
      const text = fs.readFileSync(p, 'utf8');
      const fields = {};
      for (const line of text.split('\n')) {
        const idx = line.indexOf(': ');
        if (idx > 0) {
          fields[line.slice(0, idx)] = line.slice(idx + 2);
        }
      }
      return { text, fields };
    },

    // A commit on a side branch that touches a file the checkout (main,
    // at its current tip) does not - a clean merge.
    makeCleanSideCommit() {
      const startSha = fixture.headSha();
      git(root, ['checkout', '-q', '-b', 'other-clean']);
      fs.writeFileSync(path.join(root, 'other-file.txt'), 'from another role\n');
      git(root, ['add', 'other-file.txt']);
      git(root, ['commit', '-q', '-m', 'side commit, new file']);
      const sha = fixture.headSha();
      git(root, ['checkout', '-q', 'main']);
      git(root, ['reset', '-q', '--hard', startSha]);
      git(root, ['branch', '-q', '-D', 'other-clean']);
      return sha;
    },

    // A commit on a side branch that conflicts with the checkout (main) in
    // exactly one file - both sides edit the same line of the same file
    // from a shared ancestor.
    makeConflictingSideCommit() {
      fs.writeFileSync(path.join(root, CONFLICT_FILE_NAME), 'base\n');
      git(root, ['add', CONFLICT_FILE_NAME]);
      git(root, ['commit', '-q', '-m', `add ${CONFLICT_FILE_NAME}`]);

      git(root, ['checkout', '-q', '-b', 'other-conflict']);
      fs.writeFileSync(path.join(root, CONFLICT_FILE_NAME), 'other-version\n');
      git(root, ['commit', '-q', '-am', `other edits ${CONFLICT_FILE_NAME}`]);
      const sha = fixture.headSha();

      git(root, ['checkout', '-q', 'main']);
      fs.writeFileSync(path.join(root, CONFLICT_FILE_NAME), 'main-version\n');
      git(root, ['commit', '-q', '-am', `main edits ${CONFLICT_FILE_NAME}`]);
      return sha;
    },

    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };

  return fixture;
}

module.exports = { makeSeatFixture, REAL_SEAT, REAL_CONF_PATH_CLI, CONFLICT_FILE_NAME };

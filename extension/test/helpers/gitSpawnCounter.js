'use strict';

// BL-1066: counts every `git` process the code under test spawns.
//
// A shim named `git` goes first on PATH; it appends its own argv to a log and
// then delegates to the real binary, so the code under test sees byte-for-byte
// the git it asked for and the test sees one log line per process. Deliberately
// NOT a monkeypatched `child_process.execFileSync`: the invariant this measures
// is "no further git SUBPROCESS", and a change that routed the same work
// through spawnSync, exec, or a helper binary would slip straight past an
// export-level patch while still melting the host. PATH catches all of them.
//
// The real binary is resolved BEFORE the shim is installed, so the shim can
// never recurse into itself.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./tmpDir');
const { installExecutable } = require('./sharedBin');

const LOG_ENV = 'SFVC_GIT_SPAWN_LOG';
const REAL_GIT_ENV = 'SFVC_REAL_GIT';

// stdio: 'inherit' hands the shim's OWN stdio to the real git - and the shim's
// stdio are whatever pipes the caller under test set up, so captured output
// still reaches the caller unchanged.
const SHIM = `#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.${LOG_ENV}, JSON.stringify(args) + '\\n');
const result = spawnSync(process.env.${REAL_GIT_ENV}, args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
`;

let realGitPath = null;

function resolveRealGit() {
  if (realGitPath === null) {
    realGitPath = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  }
  return realGitPath;
}

function readCalls(logPath) {
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function setEnv(key, value) {
  const before = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
  process.env[key] = value;
  return () => {
    if (before === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = before;
    }
  };
}

// Runs `fn` with the counting shim installed and returns
// { result, gitCalls } - gitCalls holding one argv array per git process.
function countGitSpawns(fn) {
  const realGit = resolveRealGit();
  const binDir = path.join(mkTmpDir('sfvc-git-spawn-'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  installExecutable(path.join(binDir, 'git'), SHIM);
  const logPath = path.join(binDir, 'git-calls.log');
  fs.writeFileSync(logPath, '');

  const restore = [
    setEnv('PATH', `${binDir}${path.delimiter}${process.env.PATH}`),
    setEnv(LOG_ENV, logPath),
    setEnv(REAL_GIT_ENV, realGit),
  ];
  try {
    const result = fn();
    return { result, gitCalls: readCalls(logPath) };
  } finally {
    while (restore.length) {
      restore.pop()();
    }
  }
}

module.exports = { countGitSpawns };

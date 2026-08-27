const { mkTmpDir } = require('./tmpDir');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { installExecutable } = require('./sharedBin');

// Fake `tmux` binary for tests that need to simulate a live tmux server
// without depending on one actually running. Each call to the fake tmux
// looks up `rules` (in order) for the first entry whose `subcommand` and/or
// `argsInclude` match the invocation's argv, and replies with that entry's
// exitCode/stdout/stderr. Falls back to exitCode 0 / empty output.
//
// Rules can be replaced mid-test via setRules() to simulate state changes
// (e.g. a session going from alive to dead between polls). Every invocation
// is also appended to a call log, readable via calls(), so tests can assert
// on the exact tmux argv a function under test built.
//
// The script body is constant — per-install rules/log locations arrive via
// environment variables — so every install hardlinks one machine-wide
// assessed executable instead of paying macOS's first-run scan per test
// (see sharedBin.js / BL-060).
const FAKE_TMUX_SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const rulesFile = process.env.SFVC_FAKE_TMUX_RULES;
const logFile = process.env.SFVC_FAKE_TMUX_LOG;
const args = process.argv.slice(2);
if (logFile) fs.appendFileSync(logFile, JSON.stringify(args) + '\\n');
const rules = rulesFile ? JSON.parse(fs.readFileSync(rulesFile, 'utf8')) : [];
const joined = args.join(' ');
let matched;
for (const rule of rules) {
  if (rule.subcommand && !args.includes(rule.subcommand)) continue;
  if (rule.argsInclude && !joined.includes(rule.argsInclude)) continue;
  matched = rule;
  break;
}
const result = matched || { exitCode: 0, stdout: '' };
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.exitCode ?? 0);
`;

// BL-377: the ONE rule-matching decision both doubles below must implement
// identically ("first entry whose subcommand and/or argsInclude match") -
// the PATH-executable fake's own script text above re-derives it in the
// spawned subprocess (it cannot require this file, it runs in a separate
// process); this shared function is what the in-process double calls
// directly, so the two can never silently drift onto different matching
// rules for the exact same `rules` array a test hands either one.
function matchRule(rules, args) {
  const joined = args.join(' ');
  for (const rule of rules) {
    if (rule.subcommand && !args.includes(rule.subcommand)) continue;
    if (rule.argsInclude && !joined.includes(rule.argsInclude)) continue;
    return rule;
  }
  return undefined;
}

function installFakeTmux(rules = []) {
  const dir = mkTmpDir('sfvc-fake-tmux-');
  const rulesFile = path.join(dir, 'rules.json');
  const logFile = path.join(dir, 'calls.log');
  fs.writeFileSync(rulesFile, JSON.stringify(rules));
  fs.writeFileSync(logFile, '');

  installExecutable(path.join(dir, 'tmux'), FAKE_TMUX_SCRIPT);

  const originalPath = process.env.PATH;
  const originalRules = process.env.SFVC_FAKE_TMUX_RULES;
  const originalLog = process.env.SFVC_FAKE_TMUX_LOG;
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  process.env.SFVC_FAKE_TMUX_RULES = rulesFile;
  process.env.SFVC_FAKE_TMUX_LOG = logFile;

  const restoreEnv = (key, value) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  return {
    setRules(newRules) {
      fs.writeFileSync(rulesFile, JSON.stringify(newRules));
    },
    calls() {
      return fs
        .readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    restore() {
      process.env.PATH = originalPath;
      restoreEnv('SFVC_FAKE_TMUX_RULES', originalRules);
      restoreEnv('SFVC_FAKE_TMUX_LOG', originalLog);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// BL-377: an IN-PROCESS double for the common case - code under test that
// reaches tmux via tmuxClient.ts's own runCommand (child_process.spawnSync)
// in THIS process. No Node boot, no rules/log file I/O: the rules array and
// call log are plain in-memory state, and the SAME matchRule() decision the
// spawned fake's own script text re-derives above is called directly here,
// so converting a consumer between the two doubles can never silently
// change what a given rules array matches.
//
// Only intercepts a `tmux` command - any other command passed to
// child_process.spawnSync (there is exactly one other real caller in this
// suite today, sharedBin.js's own hardlink-install step) is forwarded to
// the REAL spawnSync unchanged, so this coexists safely with unrelated
// spawnSync use in the same worker.
//
// NOT for a test whose code under test spawns ITS OWN child process that
// resolves tmux from PATH itself (e.g. swarmLauncher.ts's real `./swarm`
// subprocess, swarmLauncher.test.js:50) - an in-process stub in THIS
// process cannot reach into that child's own process tree at all. That
// case keeps installFakeTmux's real executable-on-PATH fake above.
function installInProcessTmux(rules = []) {
  // eslint-disable-next-line global-require
  const cp = require('node:child_process');
  const originalSpawnSync = cp.spawnSync;
  let currentRules = rules;
  const log = [];

  cp.spawnSync = (command, args, options) => {
    if (command !== 'tmux') {
      return originalSpawnSync(command, args, options);
    }
    log.push(args);
    const matched = matchRule(currentRules, args) || { exitCode: 0, stdout: '' };
    return {
      error: undefined,
      status: matched.exitCode ?? 0,
      stdout: matched.stdout || '',
      stderr: matched.stderr || '',
    };
  };

  return {
    setRules(newRules) {
      currentRules = newRules;
    },
    calls() {
      return log.slice();
    },
    restore() {
      cp.spawnSync = originalSpawnSync;
    },
  };
}

module.exports = { installFakeTmux, installInProcessTmux };

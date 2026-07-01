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

function installFakeTmux(rules = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-fake-tmux-'));
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

module.exports = { installFakeTmux };

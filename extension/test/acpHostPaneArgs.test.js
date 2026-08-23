'use strict';

// BL-1081: unit tests for pure ACP pane-host argv / spawn planning.

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  parseAcpHostPaneArgs,
  usageText,
} = require('../out/swarm/acpHostPaneArgs');
const {
  buildAgentArgv,
  formatSnapshotBody,
  snapshotAbsPath,
} = require('../out/swarm/acpHostPanePlan');

const REQUIRED = ['--role', 'coder', '--workdir', '/wt', '--prompt-file', '/p.md'];

test('usageText names the spike seat and required flags', () => {
  const text = usageText();
  assert.match(text, /^Usage: acp-host-pane --role <role> --agent <token> --workdir <path>\n/);
  assert.match(text, /--prompt-file <path>/);
  assert.match(text, /\[--add-dir <path>\]/);
  assert.match(text, /\[--extra-cli <args>\] \[--repo <path>\] \[first-message\]/);
  assert.match(text, /Hosts the spike seat \(vibe\)/);
  assert.match(text, /writes \.swarmforge\/acp\/<role>\.json, renders the transcript,/);
  assert.match(text, /and drives the agent CLI as a subprocess\./);
  const lines = text.split('\n');
  assert.equal(lines.length, 7);
  assert.equal(lines[3], '', 'usage keeps a blank separator before the prose blurb');
});

test('parseAcpHostPaneArgs accepts the spike seat and required flags', () => {
  const args = parseAcpHostPaneArgs(
    [
      ...REQUIRED,
      '--agent',
      'vibe',
      '--add-dir',
      '/master',
      '--extra-cli',
      '--model x',
      '--repo',
      '/repo',
      'hello',
      'world',
    ],
    () => '/fallback'
  );
  assert.equal(args.help, false);
  assert.equal(args.role, 'coder');
  assert.equal(args.agent, 'vibe');
  assert.equal(args.workdir, '/wt');
  assert.equal(args.promptFile, '/p.md');
  assert.equal(args.addDir, '/master');
  assert.equal(args.extraCli, '--model x');
  assert.equal(args.repoRoot, '/repo');
  assert.equal(args.firstMessage, 'hello world');
});

test('parseAcpHostPaneArgs falls back to resolveRepoRoot when --repo is absent', () => {
  const args = parseAcpHostPaneArgs([...REQUIRED], () => '/from-resolver');
  assert.equal(args.repoRoot, '/from-resolver');
  assert.equal(args.addDir, undefined);
  assert.equal(args.extraCli, undefined);
  assert.equal(args.firstMessage, '');
});

test('parseAcpHostPaneArgs refuses a non-spike agent', () => {
  assert.throws(
    () =>
      parseAcpHostPaneArgs(
        ['--role', 'coder', '--agent', 'gemini', '--workdir', '/wt', '--prompt-file', '/p.md'],
        () => '/repo'
      ),
    /only hosts vibe/
  );
});

test('parseAcpHostPaneArgs --help short-circuits without requiring flags', () => {
  const args = parseAcpHostPaneArgs(['--help'], () => '/repo');
  assert.equal(args.help, true);
  assert.equal(args.repoRoot, '/repo');
  assert.equal(args.role, '');
  assert.equal(args.agent, '');
  assert.equal(args.workdir, '');
  assert.equal(args.promptFile, '');
  assert.equal(args.firstMessage, '');
});

test('parseAcpHostPaneArgs -h is the same short-circuit as --help', () => {
  const args = parseAcpHostPaneArgs(['-h'], () => '/repo-h');
  assert.equal(args.help, true);
  assert.equal(args.repoRoot, '/repo-h');
  assert.equal(args.role, '');
});

test('parseAcpHostPaneArgs rejects a flag with no value', () => {
  assert.throws(
    () => parseAcpHostPaneArgs(['--role'], () => '/repo'),
    /--role needs a value/
  );
});

test('parseAcpHostPaneArgs rejects a flag whose value is another known flag', () => {
  assert.throws(
    () => parseAcpHostPaneArgs(['--role', '--workdir', '/wt', '--prompt-file', '/p.md'], () => '/repo'),
    /--role needs a value/
  );
  // --help/-h stay in KNOWN_FLAGS so they cannot be swallowed as another flag's value
  // even though parse short-circuits when they appear as argv tokens themselves.
  assert.throws(
    () =>
      parseAcpHostPaneArgs(
        ['--role', '--help', '--workdir', '/wt', '--prompt-file', '/p.md'],
        () => '/repo'
      ),
    /--role needs a value/
  );
  assert.throws(
    () =>
      parseAcpHostPaneArgs(
        ['--role', '-h', '--workdir', '/wt', '--prompt-file', '/p.md'],
        () => '/repo'
      ),
    /--role needs a value/
  );
});

test('parseAcpHostPaneArgs requires role, workdir, and prompt-file individually', () => {
  assert.throws(
    () => parseAcpHostPaneArgs(['--workdir', '/wt', '--prompt-file', '/p.md'], () => '/repo'),
    /--role, --workdir, and --prompt-file are required/
  );
  assert.throws(
    () => parseAcpHostPaneArgs(['--role', 'coder', '--prompt-file', '/p.md'], () => '/repo'),
    /--role, --workdir, and --prompt-file are required/
  );
  assert.throws(
    () => parseAcpHostPaneArgs(['--role', 'coder', '--workdir', '/wt'], () => '/repo'),
    /--role, --workdir, and --prompt-file are required/
  );
});

test('unknown tokens become first-message positionals, not flag values', () => {
  const args = parseAcpHostPaneArgs(
    [...REQUIRED, 'not-a-flag', 'still-positional'],
    () => '/repo'
  );
  assert.equal(args.firstMessage, 'not-a-flag still-positional');
});

test('buildAgentArgv keeps vibe trust/workdir flags and optional extras', () => {
  assert.deepEqual(
    buildAgentArgv({
      help: false,
      role: 'coder',
      agent: 'vibe',
      workdir: '/wt',
      promptFile: '/p.md',
      firstMessage: 'hi',
      repoRoot: '/repo',
      addDir: '/master',
      extraCli: '--model x',
    }),
    ['vibe', '--yolo', '--trust', '--workdir', '/wt', '--add-dir', '/master', '--model', 'x', 'hi']
  );
});

test('buildAgentArgv collapses whitespace runs and drops empty extraCli tokens', () => {
  // trim + /\s+/ (not /\s/) are both load-bearing: a single-char \s split
  // leaves empty argv slots that vibe would see as args.
  assert.deepEqual(
    buildAgentArgv({
      help: false,
      role: 'coder',
      agent: 'vibe',
      workdir: '/wt',
      promptFile: '/p.md',
      firstMessage: '',
      repoRoot: '/repo',
      extraCli: '  --model   x  ',
    }),
    ['vibe', '--yolo', '--trust', '--workdir', '/wt', '--model', 'x']
  );
});

test('buildAgentArgv ignores whitespace-only extraCli rather than pushing an empty token', () => {
  // if (trimmed) must stay — `if (true)` would push ''.split(/\s+/) => [''].
  assert.deepEqual(
    buildAgentArgv({
      help: false,
      role: 'coder',
      agent: 'vibe',
      workdir: '/wt',
      promptFile: '/p.md',
      firstMessage: '',
      repoRoot: '/repo',
      extraCli: '   \t  ',
    }),
    ['vibe', '--yolo', '--trust', '--workdir', '/wt']
  );
});

test('buildAgentArgv omits optional addDir/extraCli/firstMessage when absent', () => {
  assert.deepEqual(
    buildAgentArgv({
      help: false,
      role: 'coder',
      agent: 'vibe',
      workdir: '/wt',
      promptFile: '/p.md',
      firstMessage: '',
      repoRoot: '/repo',
    }),
    ['vibe', '--yolo', '--trust', '--workdir', '/wt']
  );
});

test('snapshotAbsPath and formatSnapshotBody are stable across the language boundary', () => {
  assert.equal(snapshotAbsPath('/repo', 'coder'), path.join('/repo', '.swarmforge/acp/coder.json'));
  assert.equal(formatSnapshotBody({ acp: true, role: 'coder' }), '{\n  "acp": true,\n  "role": "coder"\n}\n');
});

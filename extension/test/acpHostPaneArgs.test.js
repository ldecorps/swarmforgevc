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

test('usageText names the spike seat and required flags', () => {
  const text = usageText();
  assert.match(text, /--role/);
  assert.match(text, /--prompt-file/);
  assert.match(text, /vibe/);
});

test('parseAcpHostPaneArgs accepts the spike seat and required flags', () => {
  const args = parseAcpHostPaneArgs(
    [
      '--role',
      'coder',
      '--workdir',
      '/wt',
      '--prompt-file',
      '/p.md',
      '--repo',
      '/repo',
      'hello',
    ],
    () => '/fallback'
  );
  assert.equal(args.help, false);
  assert.equal(args.role, 'coder');
  assert.equal(args.agent, 'vibe');
  assert.equal(args.workdir, '/wt');
  assert.equal(args.promptFile, '/p.md');
  assert.equal(args.repoRoot, '/repo');
  assert.equal(args.firstMessage, 'hello');
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

test('snapshotAbsPath and formatSnapshotBody are stable across the language boundary', () => {
  assert.equal(snapshotAbsPath('/repo', 'coder'), path.join('/repo', '.swarmforge/acp/coder.json'));
  assert.equal(formatSnapshotBody({ acp: true, role: 'coder' }), '{\n  "acp": true,\n  "role": "coder"\n}\n');
});

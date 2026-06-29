const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildTargetBootstrapFiles,
  planTargetBootstrapFiles,
} = require('../out/config/targetBootstrap');
const { resolveTargetPath } = require('../out/config/targetPath');

test('resolveTargetPath prefers configured workspace target', () => {
  const target = resolveTargetPath({
    configuredTargetPath: '  /tmp/target  ',
    workspaceFolders: [{ uri: { fsPath: '/workspace/fallback' } }],
  });

  assert.equal(target, '/tmp/target');
});

test('resolveTargetPath falls back to the first workspace folder', () => {
  const target = resolveTargetPath({
    configuredTargetPath: '',
    workspaceFolders: [
      { uri: { fsPath: '/workspace/one' } },
      { uri: { fsPath: '/workspace/two' } },
    ],
  });

  assert.equal(target, '/workspace/one');
});

test('buildTargetBootstrapFiles returns the two swarm bootstrap prompts', () => {
  const files = buildTargetBootstrapFiles();

  assert.deepEqual(files.map((file) => file.path), [
    'project.prompt',
    'engineering.prompt',
  ]);
  assert.match(files[0].content, /# Project/);
  assert.match(files[0].content, /# Goals for this swarm run/);
  assert.match(files[1].content, /# Tech Stack/);
  assert.match(files[1].content, /# Architecture rules/);
});

test('planTargetBootstrapFiles skips files that already exist', () => {
  const plan = planTargetBootstrapFiles(new Set(['engineering.prompt']));

  assert.deepEqual(plan.filesToCreate.map((file) => file.path), [
    'project.prompt',
  ]);
  assert.deepEqual(plan.alreadyPresent, ['engineering.prompt']);
});

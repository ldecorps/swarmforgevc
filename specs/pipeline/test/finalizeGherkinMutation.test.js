'use strict';

// BL-638: finalize_gherkin_mutation.js is a thin CLI wrapper - main() takes
// its argv and every side effect (stdin, feature-file disk IO, stdout, exit)
// through an injected `io` seam. The in-process tests below stub that seam
// and never touch a real file; the wiring tests at the bottom spawn the real
// file against real stdin/disk to prove those seams are load-bearing in
// production, not just satisfied in a mock.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { main } = require('../scripts/finalize_gherkin_mutation');

const CLI = path.join(__dirname, '..', 'scripts', 'finalize_gherkin_mutation.js');

function makeIo({ stdin, files = {} }) {
  const state = { stdout: '', files: { ...files }, exitCode: null, wroteFile: false };
  const io = {
    readStdin: () => stdin,
    readFile: (p) => {
      if (!(p in state.files)) {
        throw new Error(`ENOENT: no such fixture file ${p}`);
      }
      return state.files[p];
    },
    writeFile: (p, content) => {
      state.wroteFile = true;
      state.files[p] = content;
    },
    write: (s) => {
      state.stdout += s;
    },
    exit: (code) => {
      state.exitCode = code;
    },
  };
  return { io, state };
}

const FEATURE_WITH_MANIFEST =
  '# mutation-stamp: sha256=deadbeef\n' +
  '# acceptance-mutation-manifest-begin\n' +
  '# {"version":1,"implementation_hash":"unknown","scenarios":[]}\n' +
  '# acceptance-mutation-manifest-end\n' +
  '\n' +
  'Feature: outline-free\n' +
  '\n' +
  '  Scenario: a plain scenario\n' +
  '    Given a thing\n';

test('BL-638 finalize-01: a real clean sweep passes through unmarked, exits 0, never touches the feature file', () => {
  const report = { summary: { Total: 2, Killed: 2, Survived: 0, Errors: 0 }, results: [] };
  const { io, state } = makeIo({
    stdin: JSON.stringify(report),
    files: { '/feat.feature': FEATURE_WITH_MANIFEST },
  });
  main(['node', 'finalize', '/feat.feature', '0'], io);
  assert.equal(state.exitCode, 0);
  assert.equal(state.wroteFile, false);
  const emitted = JSON.parse(state.stdout);
  assert.equal(emitted.outcome, 'pass');
  assert.equal(emitted.summary.Total, 2);
});

test('BL-638 finalize-02: a run with a survivor fails, exits 1, never touches the feature file', () => {
  const report = { summary: { Total: 2, Killed: 1, Survived: 1, Errors: 0 }, results: [] };
  const { io, state } = makeIo({
    stdin: JSON.stringify(report),
    files: { '/feat.feature': FEATURE_WITH_MANIFEST },
  });
  main(['node', 'finalize', '/feat.feature', '1'], io);
  assert.equal(state.exitCode, 1);
  assert.equal(state.wroteFile, false);
  assert.equal(JSON.parse(state.stdout).outcome, 'fail');
});

test('BL-638 finalize-03: a zero-mutant report is inapplicable, exits 2, and corrects the feature file on disk', () => {
  const report = { summary: { Total: 0, Killed: 0, Survived: 0, Errors: 0 }, results: [] };
  const { io, state } = makeIo({
    stdin: JSON.stringify(report),
    files: { '/feat.feature': FEATURE_WITH_MANIFEST },
  });
  main(['node', 'finalize', '/feat.feature', '0'], io);
  assert.equal(state.exitCode, 2);
  assert.equal(state.wroteFile, true);
  assert.doesNotMatch(state.files['/feat.feature'], /mutation-stamp/);
  assert.match(state.files['/feat.feature'], /"outcome":"inapplicable"/);
  const emitted = JSON.parse(state.stdout);
  assert.equal(emitted.outcome, 'inapplicable');
});

test('BL-638 finalize-04: a stale full-skip zero-mutant report (SkippedScenarios>0, SkippedMutations 0) is still inapplicable', () => {
  const report = { summary: { Total: 0, Killed: 0, Survived: 0, Errors: 0, SkippedScenarios: 1 }, results: [] };
  const { io, state } = makeIo({
    stdin: JSON.stringify(report),
    files: { '/feat.feature': FEATURE_WITH_MANIFEST },
  });
  main(['node', 'finalize', '/feat.feature', '0'], io);
  assert.equal(state.exitCode, 2);
  assert.equal(JSON.parse(state.stdout).outcome, 'inapplicable');
});

test('BL-638 finalize-05: a genuinely cached pass (SkippedMutations>0) is a pass, not inapplicable, and the file is untouched', () => {
  const report = { summary: { Total: 0, Killed: 0, Survived: 0, Errors: 0, SkippedMutations: 4, SkippedScenarios: 1 }, results: [] };
  const { io, state } = makeIo({
    stdin: JSON.stringify(report),
    files: { '/feat.feature': FEATURE_WITH_MANIFEST },
  });
  main(['node', 'finalize', '/feat.feature', '0'], io);
  assert.equal(state.exitCode, 0);
  assert.equal(state.wroteFile, false);
  assert.equal(JSON.parse(state.stdout).outcome, 'pass');
});

test('BL-638 finalize-06: unparseable stdin (bad args / an infra crash before any report) relays verbatim and the CLI\'s own exit code, without touching the feature file', () => {
  const { io, state } = makeIo({
    stdin: '--level must be full, hard, or soft\n',
    files: { '/feat.feature': FEATURE_WITH_MANIFEST },
  });
  main(['node', 'finalize', '/feat.feature', '2'], io);
  assert.equal(state.exitCode, 2);
  assert.equal(state.wroteFile, false);
  assert.equal(state.stdout, '--level must be full, hard, or soft\n');
});

test('BL-638 finalize-07: a missing/non-numeric exit-code argv defaults to 0 rather than throwing', () => {
  const { io, state } = makeIo({ stdin: 'not json', files: {} });
  main(['node', 'finalize', '/feat.feature'], io);
  assert.equal(state.exitCode, 0);
});

// Wiring: spawn the REAL file against real stdin/disk - proves the injected
// seams above are actually wired to fs/process in production, not just
// satisfied by the stub.

test('BL-638 finalize-wiring-08: spawned end to end, an inapplicable report really rewrites the feature file on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl638-finalize-wiring-'));
  const featurePath = path.join(dir, 'feat.feature');
  fs.writeFileSync(featurePath, FEATURE_WITH_MANIFEST);
  try {
    const report = { summary: { Total: 0, Killed: 0, Survived: 0, Errors: 0 }, results: [] };
    const result = spawnSync(process.execPath, [CLI, featurePath, '0'], {
      input: JSON.stringify(report),
      encoding: 'utf8',
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const emitted = JSON.parse(result.stdout);
    assert.equal(emitted.outcome, 'inapplicable');
    const onDisk = fs.readFileSync(featurePath, 'utf8');
    assert.doesNotMatch(onDisk, /mutation-stamp/);
    assert.match(onDisk, /"outcome":"inapplicable"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-638 finalize-wiring-09: spawned end to end, a real clean sweep leaves the on-disk feature file byte-for-byte unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl638-finalize-wiring-'));
  const featurePath = path.join(dir, 'feat.feature');
  fs.writeFileSync(featurePath, FEATURE_WITH_MANIFEST);
  try {
    const report = { summary: { Total: 1, Killed: 1, Survived: 0, Errors: 0 }, results: [] };
    const result = spawnSync(process.execPath, [CLI, featurePath, '0'], {
      input: JSON.stringify(report),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(featurePath, 'utf8'), FEATURE_WITH_MANIFEST);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-638 finalize-wiring-10: spawned end to end, malformed stdin relays verbatim and exits with the given bb-exit code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl638-finalize-wiring-'));
  const featurePath = path.join(dir, 'feat.feature');
  fs.writeFileSync(featurePath, FEATURE_WITH_MANIFEST);
  try {
    const result = spawnSync(process.execPath, [CLI, featurePath, '2'], {
      input: 'usage: gherkin-mutator ...\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(result.stdout, 'usage: gherkin-mutator ...\n');
    assert.equal(fs.readFileSync(featurePath, 'utf8'), FEATURE_WITH_MANIFEST);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

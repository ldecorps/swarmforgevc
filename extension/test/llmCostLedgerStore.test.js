const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { llmCostTelemetryDir, readLlmInvocationRecords } = require('../out/metrics/llmCostLedgerStore');

// BL-551: the fs-touching read side of the unified LLM cost ledger.

function origin(overrides = {}) {
  return {
    subsystem: 'pipeline',
    role: 'coder',
    stage: 'coder',
    trigger: 'handoff',
    ticketId: 'BL-551',
    handoffId: 'h1',
    handoffType: 'git_handoff',
    script: null,
    pack: 'openrouter-anthropic-mono-router',
    model: 'claude-sonnet-5',
    provider: 'claude',
    ...overrides,
  };
}

function invocation(overrides = {}) {
  return {
    type: 'llm_invocation',
    at: '2026-07-22T12:00:00Z',
    model: 'claude-sonnet-5',
    tokens: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
    costUsd: 1,
    origin: origin(),
    ...overrides,
  };
}

function mkRoot() {
  return mkTmpDir('sfvc-llm-cost-ledger-store-');
}

function writeLedgerFile(root, monthKey, records) {
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `llm-cost-${monthKey}.jsonl`);
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return filePath;
}

test('readLlmInvocationRecords: a missing telemetry directory degrades to an empty list, never an error', () => {
  const root = mkRoot();
  assert.deepEqual(readLlmInvocationRecords(root), []);
});

test('readLlmInvocationRecords: a missing ledger file (dir exists, no files) degrades to an empty list', () => {
  const root = mkRoot();
  fs.mkdirSync(llmCostTelemetryDir(root), { recursive: true });
  assert.deepEqual(readLlmInvocationRecords(root), []);
});

test('readLlmInvocationRecords: parses valid llm_invocation lines from a monthly ledger file', () => {
  const root = mkRoot();
  writeLedgerFile(root, '2026-07', [invocation(), invocation({ costUsd: 2 })]);
  const records = readLlmInvocationRecords(root);
  assert.equal(records.length, 2);
  assert.equal(records[0].type, 'llm_invocation');
});

test('readLlmInvocationRecords: a malformed line is skipped, valid lines around it still parse', () => {
  const root = mkRoot();
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'llm-cost-2026-07.jsonl'),
    [JSON.stringify(invocation()), 'not json at all {{{', JSON.stringify(invocation({ costUsd: 3 }))].join('\n')
  );
  assert.equal(readLlmInvocationRecords(root).length, 2);
});

test('readLlmInvocationRecords: a line that parses to valid JSON but not an object is skipped', () => {
  const root = mkRoot();
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'llm-cost-2026-07.jsonl'), ['42', JSON.stringify(invocation())].join('\n'));
  assert.equal(readLlmInvocationRecords(root).length, 1);
});

test('readLlmInvocationRecords: a record with the wrong type discriminator is skipped', () => {
  const root = mkRoot();
  writeLedgerFile(root, '2026-07', [{ ...invocation(), type: 'something_else' }]);
  assert.equal(readLlmInvocationRecords(root).length, 0);
});

test('readLlmInvocationRecords: a record missing the origin block is skipped', () => {
  const root = mkRoot();
  const { origin: _dropped, ...withoutOrigin } = invocation();
  writeLedgerFile(root, '2026-07', [withoutOrigin]);
  assert.equal(readLlmInvocationRecords(root).length, 0);
});

test('readLlmInvocationRecords: a record whose origin has a non-string subsystem is skipped', () => {
  const root = mkRoot();
  writeLedgerFile(root, '2026-07', [invocation({ origin: origin({ subsystem: 42 }) })]);
  assert.equal(readLlmInvocationRecords(root).length, 0);
});

test('readLlmInvocationRecords: a record whose origin is missing the handoffType key entirely is skipped', () => {
  const root = mkRoot();
  const { handoffType: _dropped, ...originWithoutHandoffType } = origin();
  writeLedgerFile(root, '2026-07', [invocation({ origin: originWithoutHandoffType })]);
  assert.equal(readLlmInvocationRecords(root).length, 0);
});

test('readLlmInvocationRecords: an unreadable ledger file (a directory sharing its name) contributes no records', () => {
  const root = mkRoot();
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'llm-cost-2026-08.jsonl'));
  assert.deepEqual(readLlmInvocationRecords(root), []);
});

// null model/provider/cost are VALID (honest-null) - present and well-formed, must be
// ACCEPTED, mirroring readBridgeCostRecords' null-total_cost_usd acceptance test.
test('readLlmInvocationRecords: a record with null model, provider, and costUsd (all honest-null) is accepted', () => {
  const root = mkRoot();
  writeLedgerFile(root, '2026-07', [
    invocation({ model: null, costUsd: null, origin: origin({ model: null, provider: null }) }),
  ]);
  const records = readLlmInvocationRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].model, null);
  assert.equal(records[0].costUsd, null);
  assert.equal(records[0].origin.model, null);
  assert.equal(records[0].origin.provider, null);
});

test('readLlmInvocationRecords: a record with a non-string, non-null costUsd is skipped', () => {
  const root = mkRoot();
  writeLedgerFile(root, '2026-07', [{ ...invocation(), costUsd: 'a lot' }]);
  assert.equal(readLlmInvocationRecords(root).length, 0);
});

test('readLlmInvocationRecords: reads across every monthly ledger file present, in filename order', () => {
  const root = mkRoot();
  writeLedgerFile(root, '2026-06', [invocation({ at: '2026-06-30T12:00:00Z', costUsd: 1 })]);
  writeLedgerFile(root, '2026-07', [invocation({ at: '2026-07-01T12:00:00Z', costUsd: 2 })]);
  const records = readLlmInvocationRecords(root);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.costUsd), [1, 2]);
});

test('readLlmInvocationRecords: a non-ledger file sitting in the telemetry dir is ignored', () => {
  const root = mkRoot();
  const dir = llmCostTelemetryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'not-a-ledger-file.txt'), 'noise');
  writeLedgerFile(root, '2026-07', [invocation()]);
  assert.equal(readLlmInvocationRecords(root).length, 1);
});

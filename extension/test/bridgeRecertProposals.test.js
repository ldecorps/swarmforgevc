const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bridgeRecertProposals } = require('../out/tools/bridge-recert-proposals');

function inboxDir(targetPath) {
  return path.join(targetPath, 'backlog', 'recert-inbox');
}

function proposalsFile(targetPath, nowMs) {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  return path.join(targetPath, '.swarmforge', 'recert_proposals', `${month}.jsonl`);
}

function writeInboxFile(targetPath, name, content) {
  fs.mkdirSync(inboxDir(targetPath), { recursive: true });
  fs.writeFileSync(path.join(inboxDir(targetPath), name), content, 'utf8');
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-recert-bridge-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const NOW = new Date('2026-07-09T12:00:00Z').getTime();

test('bridgeRecertProposals reports zero ingested when the inbox directory does not exist', () => {
  withTempDir((dir) => {
    const result = bridgeRecertProposals(dir, NOW);
    assert.deepEqual(result, { ingested: [], skipped: [] });
  });
});

test('bridgeRecertProposals appends a well-formed proposal file into the durable jsonl queue and removes the source file', () => {
  withTempDir((dir) => {
    const proposal = { scenarioId: 'BL-042-demo-01', outcome: 'update', newText: 'new text', receivedAtIso: '2026-07-09T11:00:00Z' };
    writeInboxFile(dir, 'a.json', JSON.stringify(proposal));

    const result = bridgeRecertProposals(dir, NOW);

    assert.deepEqual(result, { ingested: ['a.json'], skipped: [] });
    const lines = fs.readFileSync(proposalsFile(dir, NOW), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), proposal);
    assert.equal(fs.existsSync(path.join(inboxDir(dir), 'a.json')), false);
  });
});

test('bridgeRecertProposals ingests every pending file, each getting its own jsonl line', () => {
  withTempDir((dir) => {
    writeInboxFile(dir, 'a.json', JSON.stringify({ scenarioId: 'BL-1', outcome: 'update', newText: 'x', receivedAtIso: '2026-07-09T11:00:00Z' }));
    writeInboxFile(dir, 'b.json', JSON.stringify({ scenarioId: 'BL-2', outcome: 'delete', receivedAtIso: '2026-07-09T11:05:00Z' }));

    const result = bridgeRecertProposals(dir, NOW);

    assert.deepEqual(result.ingested.sort(), ['a.json', 'b.json']);
    const lines = fs.readFileSync(proposalsFile(dir, NOW), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
  });
});

test('bridgeRecertProposals skips a malformed (non-JSON) file, logs it, and does not remove it', () => {
  withTempDir((dir) => {
    writeInboxFile(dir, 'bad.json', 'not json{{{');

    const result = bridgeRecertProposals(dir, NOW);

    assert.deepEqual(result.ingested, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].file, 'bad.json');
    assert.equal(fs.existsSync(path.join(inboxDir(dir), 'bad.json')), true);
  });
});

test('bridgeRecertProposals skips a file that is valid JSON but not an object (e.g. a bare number)', () => {
  withTempDir((dir) => {
    writeInboxFile(dir, 'not-an-object.json', '42');

    const result = bridgeRecertProposals(dir, NOW);

    assert.deepEqual(result.ingested, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].file, 'not-an-object.json');
    assert.equal(fs.existsSync(path.join(inboxDir(dir), 'not-an-object.json')), true);
  });
});

test('bridgeRecertProposals skips a well-formed-JSON file that is not a valid recert proposal shape', () => {
  withTempDir((dir) => {
    writeInboxFile(dir, 'wrong-shape.json', JSON.stringify({ scenarioId: 'BL-1', outcome: 'confirm', receivedAtIso: '2026-07-09T11:00:00Z' }));

    const result = bridgeRecertProposals(dir, NOW);

    assert.deepEqual(result.ingested, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(fs.existsSync(path.join(inboxDir(dir), 'wrong-shape.json')), true);
  });
});

test('bridgeRecertProposals ingests remaining valid files even when one file in the batch is malformed', () => {
  withTempDir((dir) => {
    writeInboxFile(dir, 'bad.json', 'not json{{{');
    writeInboxFile(dir, 'good.json', JSON.stringify({ scenarioId: 'BL-3', outcome: 'update', newText: 'y', receivedAtIso: '2026-07-09T11:00:00Z' }));

    const result = bridgeRecertProposals(dir, NOW);

    assert.deepEqual(result.ingested, ['good.json']);
    assert.equal(result.skipped.length, 1);
  });
});

test('bridgeRecertProposals ignores non-.json entries in the inbox directory', () => {
  withTempDir((dir) => {
    fs.mkdirSync(inboxDir(dir), { recursive: true });
    fs.writeFileSync(path.join(inboxDir(dir), 'README.md'), 'not a proposal', 'utf8');

    const result = bridgeRecertProposals(dir, NOW);

    assert.deepEqual(result, { ingested: [], skipped: [] });
  });
});

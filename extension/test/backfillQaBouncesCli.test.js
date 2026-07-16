const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, backfillQaBounces, buildTicketTypeIndex } = require('../out/tools/backfill-qa-bounces');
const { readQaBounceRecords } = require('../out/quality/qaBounceStore');

// BL-454: the one-time backfill over backlog/evidence/*.md.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'backfill-qa-bounces.js');

function mkTmp(prefix) {
  return mkTmpDir(prefix);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(root) {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
}

function writeEvidence(root, filename, content) {
  const dir = path.join(root, 'backlog', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

function writeBacklogTicket(root, folder, id, type) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ntitle: Fixture ticket\ntype: ${type}\n`);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

function seedFixtureCorpus(root) {
  writeBacklogTicket(root, 'done', 'BL-259', 'defect');
  writeBacklogTicket(root, 'active', 'BL-414', 'feature');
  writeEvidence(
    root,
    'BL-259-gated-dependency-rule-checker-bounce-20260710-hardener.md',
    ['# BL-259 hardener bounce', '', '## Failure class', '', '`behavior`', '', 'Commit hash tested', '`abc1234567890`'].join('\n')
  );
  writeEvidence(
    root,
    'BL-414-title-age-first-tick-rate-limit-bounce-20260715.md',
    ['# BL-414 hardener bounce — 20260715', '', '## Verdict: BOUNCE to coder', '', '4. **Failure class**: `behavior`.'].join('\n')
  );
  // A non-bounce evidence file: no failure-class field at all.
  writeEvidence(root, 'BL-368-already-shipped-20260716.md', '# BL-368 already shipped\n\nAlready delivered by BL-367.\n');
}

function mkRepo() {
  const root = mkTmp('sfvc-backfill-qa-bounces-repo-');
  initRepo(root);
  writeRolesTsv(root);
  seedFixtureCorpus(root);
  commitAll(root, 'seed fixture corpus');
  return root;
}

// ── buildTicketTypeIndex ─────────────────────────────────────────────────

test('buildTicketTypeIndex joins ticket type across active/paused/done', () => {
  const root = mkRepo();
  const index = buildTicketTypeIndex(root);
  assert.equal(index.get('BL-259'), 'defect');
  assert.equal(index.get('BL-414'), 'feature');
  assert.equal(index.get('BL-999'), undefined);
});

// ── backfillQaBounces (pure-ish orchestration over a real fixture root) ──

test('BL-454: the backfill seeds one record per genuine bounce file, joining ticket type from the backlog', () => {
  const root = mkRepo();
  const result = backfillQaBounces(root);
  assert.equal(result.scanned, 3);
  assert.equal(result.recorded, 2);
  const records = readQaBounceRecords(root).sort((a, b) => a.ticket.localeCompare(b.ticket));
  assert.equal(records.length, 2);
  assert.equal(records[0].ticket, 'BL-259');
  assert.equal(records[0].ticketType, 'defect');
  // A hardener-authored bounce (filename suffix) attributes to the
  // architect, the pipeline stage immediately before the reporter - see
  // qaBounceEvidenceParser.ts's PRODUCING_ROLE_BEFORE_REPORTER.
  assert.equal(records[0].producingRole, 'architect');
  assert.equal(records[1].ticket, 'BL-414');
  assert.equal(records[1].ticketType, 'feature');
  assert.equal(records[1].producingRole, 'coder');
});

test('BL-454: a non-bounce evidence file produces no bounce entry', () => {
  const root = mkRepo();
  const result = backfillQaBounces(root);
  const skippedFiles = result.skipped.map((s) => s.file);
  assert.ok(skippedFiles.includes('BL-368-already-shipped-20260716.md'));
});

test('BL-454: running the backfill again adds no further entries (idempotent)', () => {
  const root = mkRepo();
  backfillQaBounces(root);
  const second = backfillQaBounces(root);
  assert.equal(second.recorded, 0);
  assert.equal(readQaBounceRecords(root).length, 2);
});

test('a bounce ticket whose backlog type is missing is skipped rather than guessed', () => {
  const root = mkTmp('sfvc-backfill-qa-bounces-no-type-');
  initRepo(root);
  writeRolesTsv(root);
  writeEvidence(
    root,
    'BL-500-untyped-bounce-20260716.md',
    ['# BL-500 hardener bounce', '', '## Failure class', '', '`behavior`'].join('\n')
  );
  commitAll(root, 'seed untyped bounce');
  const result = backfillQaBounces(root);
  assert.equal(result.recorded, 0);
  assert.equal(result.skipped[0].reason.includes('ticket type'), true);
});

// ── end-to-end CLI ────────────────────────────────────────────────────────

async function runCli(root) {
  const originalCwd = process.cwd;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
  }
  return JSON.parse(writes.join(''));
}

test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkRepo();
  const out = execFileSync('node', [CLI], { cwd: root, encoding: 'utf8' });
  const result = JSON.parse(out);
  assert.equal(result.recorded, 2);
  assert.equal(readQaBounceRecords(root).length, 2);
});

test('the in-process CLI main() produces the same result as the subprocess', async () => {
  const root = mkRepo();
  const result = await runCli(root);
  assert.equal(result.recorded, 2);
});

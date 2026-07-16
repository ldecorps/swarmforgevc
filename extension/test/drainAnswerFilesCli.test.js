const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseArgs,
  parseAnswerFile,
  backlogAnswerFiles,
  findTicketFile,
  checkPremiseLive,
  drainAnswerFiles,
  main,
} = require('../out/tools/drain-answer-files');
const { readRecord } = require('../out/concierge/blTopicStore');

// BL-440: the human->swarm offline return path. Drives the REAL compiled
// module against a real git repo fixture - the archive move is a real git
// commit, and the "acted on"/"arrived late" routing is a real
// blTopicStore.ts append, never a fake standing in for either.

function mkRepo() {
  const dir = mkTmpDir('bl440-drain-answer-files-');
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

function writeTicket(repoRoot, folder, id, status) {
  const dir = path.join(repoRoot, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}-fixture.yaml`);
  fs.writeFileSync(filePath, `id: ${id}\nstatus: ${status}\ntitle: "fixture"\n`);
  execFileSync('git', ['-C', repoRoot, 'add', '--', filePath]);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'fixture ticket'], { cwd: repoRoot });
}

function writeAnswerFile(repoRoot, name, content) {
  fs.mkdirSync(path.join(repoRoot, 'backlog'), { recursive: true });
  const filePath = path.join(repoRoot, 'backlog', name);
  fs.writeFileSync(filePath, content);
  execFileSync('git', ['-C', repoRoot, 'add', '--', filePath]);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'human answer'], { cwd: repoRoot });
  return filePath;
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns the repo root when present', () => {
  assert.deepEqual(parseArgs(['/repo']), { repoRoot: '/repo' });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

// ── parseAnswerFile (the forgiving schema) ───────────────────────────────

test('parseAnswerFile resolves a BL-### reference mentioned anywhere in free text', () => {
  const { reference, body } = parseAnswerFile('Re your question on BL-123: yes, go ahead with option B.\n');
  assert.equal(reference, 'BL-123');
  assert.match(body, /go ahead with option B/);
});

test('parseAnswerFile resolves a lowercase "bl-123" reference too', () => {
  const { reference } = parseAnswerFile('re bl-456, approved.\n');
  assert.equal(reference, 'BL-456');
});

test('parseAnswerFile returns a null reference when nothing matches (surfaced as unresolved by the caller)', () => {
  const { reference, body } = parseAnswerFile('I approve the thing we talked about.\n');
  assert.equal(reference, null);
  assert.match(body, /approve the thing/);
});

test('parseAnswerFile carries the human\'s words through untouched (forgiving - no required header)', () => {
  const content = 'ref: BL-1\nJust go with your gut on this one, trust your judgement.\n';
  const { body } = parseAnswerFile(content);
  assert.equal(body, content.trim());
});

// ── backlogAnswerFiles ───────────────────────────────────────────────────

test('backlogAnswerFiles finds every ANSWER-*.md at the backlog root, ignoring other files', () => {
  const repoRoot = mkRepo();
  fs.mkdirSync(path.join(repoRoot, 'backlog'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'backlog', 'ANSWER-one.md'), 'BL-1: yes');
  fs.writeFileSync(path.join(repoRoot, 'backlog', 'ANSWER-two.md'), 'BL-2: no');
  fs.writeFileSync(path.join(repoRoot, 'backlog', 'INTAKE-unrelated.md'), 'not an answer');
  fs.writeFileSync(path.join(repoRoot, 'backlog', 'README.md'), 'not an answer either');

  const files = backlogAnswerFiles(repoRoot).sort();

  assert.deepEqual(files, ['ANSWER-one.md', 'ANSWER-two.md']);
});

test('backlogAnswerFiles returns an empty list when the backlog dir does not exist', () => {
  assert.deepEqual(backlogAnswerFiles(mkTmpDir('bl440-no-backlog-')), []);
});

// ── findTicketFile / checkPremiseLive (the gate) ─────────────────────────

test('findTicketFile finds a ticket in backlog/active and reports its status', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');

  const found = findTicketFile(repoRoot, 'BL-100');

  assert.equal(found.folder, 'active');
  assert.equal(found.status, 'todo');
});

test('checkPremiseLive reports live for an open ticket in backlog/active', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');

  assert.deepEqual(checkPremiseLive(repoRoot, 'BL-100'), { live: true });
});

test('checkPremiseLive reports live for an open ticket in backlog/paused', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'paused', 'BL-100', 'todo');

  assert.deepEqual(checkPremiseLive(repoRoot, 'BL-100'), { live: true });
});

test('checkPremiseLive reports not-live when the ticket has already shipped (backlog/done)', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'done', 'BL-100', 'done');

  const result = checkPremiseLive(repoRoot, 'BL-100');

  assert.equal(result.live, false);
  assert.match(result.reason, /already shipped/);
});

test('checkPremiseLive reports not-live when the ticket is missing entirely (withdrawn)', () => {
  const repoRoot = mkRepo();

  const result = checkPremiseLive(repoRoot, 'BL-999');

  assert.equal(result.live, false);
  assert.match(result.reason, /no longer found/);
});

test('checkPremiseLive reports not-live when the ticket\'s own status is already "done" despite still sitting in active/', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'done');

  const result = checkPremiseLive(repoRoot, 'BL-100');

  assert.equal(result.live, false);
  assert.match(result.reason, /status is already "done"/);
});

// ── drainAnswerFiles (the full gate + route + archive orchestration) ────

test('BL-440-01: an answer to a still-open ticket is routed to that ticket (as an inbound topic message) and acted on', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');
  writeAnswerFile(repoRoot, 'ANSWER-2026-07-15.md', 'Re BL-100: yes, go ahead with the simpler option.\n');

  const results = drainAnswerFiles(repoRoot);

  assert.equal(results.length, 1);
  assert.equal(results[0].disposition, 'acted-on');
  assert.equal(results[0].reference, 'BL-100');

  const record = readRecord(repoRoot, 'BL-100');
  assert.equal(record.messages.length, 1);
  assert.equal(record.messages[0].type, 'inbound');
  assert.match(record.messages[0].text, /go ahead with the simpler option/);
});

test('BL-440-02: an answer whose ticket already shipped is not acted on and reports arrived-late naming what changed', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'done', 'BL-100', 'done');
  writeAnswerFile(repoRoot, 'ANSWER-late.md', 'Re BL-100: please also add the extra validation step.\n');

  const results = drainAnswerFiles(repoRoot);

  assert.equal(results[0].disposition, 'arrived-late');
  assert.match(results[0].report, /arrived late, not executed/);
  assert.match(results[0].report, /already shipped/);

  const record = readRecord(repoRoot, 'BL-100');
  assert.equal(record.messages.length, 1, 'expected the arrived-late report to be recorded, never the raw instruction acted on');
  assert.equal(record.messages[0].type, 'outbound');
  assert.doesNotMatch(record.messages[0].text, /extra validation step/, 'the human\'s instruction must never be executed/reflected as if it were');
});

test('BL-440-02: an answer whose ticket is missing entirely (withdrawn) is not acted on and reports arrived-late', () => {
  const repoRoot = mkRepo();
  writeAnswerFile(repoRoot, 'ANSWER-withdrawn.md', 'Re BL-777: sounds good, proceed.\n');

  const results = drainAnswerFiles(repoRoot);

  assert.equal(results[0].disposition, 'arrived-late');
  assert.match(results[0].report, /no longer found/);
});

test('BL-440-02: an answer whose ticket already carries status "done" (superseded) is not acted on and reports arrived-late', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'done');
  writeAnswerFile(repoRoot, 'ANSWER-superseded.md', 'Re BL-100: yes.\n');

  const results = drainAnswerFiles(repoRoot);

  assert.equal(results[0].disposition, 'arrived-late');
  assert.match(results[0].report, /status is already "done"/);
});

test('BL-440-03: a drained (acted-on) answer file is moved to the archive, not deleted', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');
  const sourcePath = writeAnswerFile(repoRoot, 'ANSWER-archived.md', 'Re BL-100: approved.\n');

  drainAnswerFiles(repoRoot);

  assert.equal(fs.existsSync(sourcePath), false, 'expected the file gone from the backlog root');
  const archivedPath = path.join(repoRoot, 'backlog', 'answers-archive', 'ANSWER-archived.md');
  assert.ok(fs.existsSync(archivedPath), 'expected the file present in the archive');
  assert.match(fs.readFileSync(archivedPath, 'utf8'), /approved/);
});

test('BL-440-03: an arrived-late answer file is ALSO archived, not left sitting (it was still drained)', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'done', 'BL-100', 'done');
  const sourcePath = writeAnswerFile(repoRoot, 'ANSWER-late-archived.md', 'Re BL-100: too late now.\n');

  drainAnswerFiles(repoRoot);

  assert.equal(fs.existsSync(sourcePath), false);
  assert.ok(fs.existsSync(path.join(repoRoot, 'backlog', 'answers-archive', 'ANSWER-late-archived.md')));
});

test('BL-440-03: the archive move is a real git commit, not just a working-tree rename', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');
  writeAnswerFile(repoRoot, 'ANSWER-committed.md', 'Re BL-100: approved.\n');

  drainAnswerFiles(repoRoot);

  const status = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' });
  const archiveStatus = status.split('\n').filter((l) => l.includes('answers-archive') || l.includes('ANSWER-committed.md'));
  assert.deepEqual(archiveStatus, [], `expected the archive move to be fully committed, got dirty status: ${status}`);
});

test('BL-440-04: a forgiving answer with a resolvable reference and human text is still ingested', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');
  // No header fields at all - just prose mentioning the ticket, exactly the
  // "composed by a human on a plane" shape the ticket's own schema note
  // describes.
  writeAnswerFile(repoRoot, 'ANSWER-forgiving.md', 'hey about BL-100 - lets just do the simple thing, dont overthink it\n');

  const results = drainAnswerFiles(repoRoot);

  assert.equal(results[0].disposition, 'acted-on');
  assert.equal(results[0].reference, 'BL-100');
  const record = readRecord(repoRoot, 'BL-100');
  assert.match(record.messages[0].text, /dont overthink it/);
});

test('BL-440-05: an answer whose reference cannot be resolved is surfaced as unresolved, not silently dropped', () => {
  const repoRoot = mkRepo();
  const sourcePath = writeAnswerFile(repoRoot, 'ANSWER-no-ref.md', 'Sounds good, go ahead with the plan we discussed.\n');

  const results = drainAnswerFiles(repoRoot);

  assert.equal(results[0].disposition, 'unresolved');
  assert.equal(results[0].reference, null);
  assert.match(results[0].report, /no BL-### reference/);
});

test('BL-440-05: an unresolved answer file is left in place at the backlog root, never archived or deleted', () => {
  const repoRoot = mkRepo();
  const sourcePath = writeAnswerFile(repoRoot, 'ANSWER-no-ref-2.md', 'Sounds good, proceed.\n');

  drainAnswerFiles(repoRoot);

  assert.ok(fs.existsSync(sourcePath), 'expected the unresolved file to remain at the backlog root (BL-311\'s own "still there = undrained" signal)');
  assert.equal(fs.existsSync(path.join(repoRoot, 'backlog', 'answers-archive', 'ANSWER-no-ref-2.md')), false);
});

test('drainAnswerFiles processes multiple answer files independently in one pass', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');
  writeTicket(repoRoot, 'done', 'BL-200', 'done');
  writeAnswerFile(repoRoot, 'ANSWER-a.md', 'Re BL-100: approved.\n');
  writeAnswerFile(repoRoot, 'ANSWER-b.md', 'Re BL-200: approved.\n');

  const results = drainAnswerFiles(repoRoot);

  const byFile = Object.fromEntries(results.map((r) => [r.file, r.disposition]));
  assert.equal(byFile['ANSWER-a.md'], 'acted-on');
  assert.equal(byFile['ANSWER-b.md'], 'arrived-late');
});

test('drainAnswerFiles is a no-op returning an empty list when there are no answer files', () => {
  const repoRoot = mkRepo();
  assert.deepEqual(drainAnswerFiles(repoRoot), []);
});

// ── main() wiring ──────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'drain-answer-files.js');

async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, output: writes.join('') };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() prints usage and exits non-zero when the repo root is missing', async () => {
  const result = await runCli([]);
  assert.notEqual(result.exitCode, 0);
});

test('main() drains and prints the results as JSON', async () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');
  writeAnswerFile(repoRoot, 'ANSWER-main.md', 'Re BL-100: approved.\n');

  const { exitCode, output } = await runCli([repoRoot]);

  assert.equal(exitCode, 0);
  const printed = JSON.parse(output);
  assert.equal(printed.length, 1);
  assert.equal(printed[0].disposition, 'acted-on');
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and drains a real answer file', () => {
  const repoRoot = mkRepo();
  writeTicket(repoRoot, 'active', 'BL-100', 'todo');
  writeAnswerFile(repoRoot, 'ANSWER-subprocess.md', 'Re BL-100: approved.\n');

  const output = execFileSync('node', [CLI_PATH, repoRoot], { encoding: 'utf8' });
  const printed = JSON.parse(output);

  assert.equal(printed[0].disposition, 'acted-on');
  assert.ok(fs.existsSync(path.join(repoRoot, 'backlog', 'answers-archive', 'ANSWER-subprocess.md')));
});

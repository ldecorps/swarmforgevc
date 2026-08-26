'use strict';

// BL-1066: a real git repo whose backlog carries `count` closed tickets, each
// with the same known active -> done duration. Shared by the walk's unit tests
// and by both cost/reaping property files so the corpus one of them measures
// is the corpus the others measure.
//
// The scaffolding cost is deliberately flat in `count`: all the tickets are
// promoted in one commit and closed in one commit, so a 400-ticket corpus is
// 400 file writes and the same handful of git calls a 3-ticket one pays.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./tmpDir');
const { copySeededRepoInto } = require('./sharedRepoFixture');

const PROMOTED_AT = '2026-07-02T08:00:00';
const CLOSED_AT = '2026-07-02T12:00:00';
const TICKET_DURATION_MS = 4 * 60 * 60 * 1000;

function git(repo, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeTicket(repo, dir, name) {
  fs.mkdirSync(path.join(repo, 'backlog', dir), { recursive: true });
  fs.writeFileSync(path.join(repo, 'backlog', dir, name), `id: ${name}\ntitle: t\n`);
}

function move(repo, fromDir, toDir, name) {
  fs.mkdirSync(path.join(repo, 'backlog', toDir), { recursive: true });
  git(repo, ['mv', `backlog/${fromDir}/${name}`, `backlog/${toDir}/${name}`]);
}

// The bulk sibling of move(): renames on the filesystem and stages the lot in
// ONE `git add -A`, so an 800-ticket corpus costs one git process rather than
// 800. The files are byte-identical either side, so git pairs them by exact
// content and reports renames exactly as `git mv` would have.
function moveAll(repo, fromDir, moves) {
  for (const { toDir, name } of moves) {
    fs.mkdirSync(path.join(repo, 'backlog', toDir), { recursive: true });
    fs.renameSync(path.join(repo, 'backlog', fromDir, name), path.join(repo, 'backlog', toDir, name));
  }
  git(repo, ['add', '-A']);
}

function newRepo(prefix = 'sfvc-bl1066-') {
  const repo = mkTmpDir(prefix);
  copySeededRepoInto(repo);
  return repo;
}

function ticketName(index) {
  return `BL-${1000 + index}.yaml`;
}

// `milestones` > 0 spreads the closed tickets across that many milestone
// subdirectories of backlog/done/ - the recursive shape the live backlog has,
// and the reason its corpus was 794 files rather than the 492 sitting flat.
function buildClosedTicketCorpus(count, { milestones = 0, prefix } = {}) {
  const repo = newRepo(prefix);
  const names = Array.from({ length: count }, (_, i) => ticketName(i));
  for (const name of names) {
    writeTicket(repo, 'active', name);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'promote', '--allow-empty'], PROMOTED_AT);
  moveAll(
    repo,
    'active',
    names.map((name, i) => ({ toDir: milestones > 0 ? `done/M${i % milestones}` : 'done', name }))
  );
  git(repo, ['commit', '-q', '-m', 'close', '--allow-empty'], CLOSED_AT);
  return repo;
}

// Closes ONE more ticket into an existing corpus, with the same known
// duration - the "closing another ticket" of invariant 2.
function closeOneMoreTicket(repo, name = 'BL-9999.yaml') {
  writeTicket(repo, 'active', name);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', `promote ${name}`], PROMOTED_AT);
  move(repo, 'active', 'done', name);
  git(repo, ['commit', '-q', '-m', `close ${name}`], CLOSED_AT);
}

module.exports = {
  buildClosedTicketCorpus,
  moveAll,
  closeOneMoreTicket,
  newRepo,
  git,
  writeTicket,
  move,
  TICKET_DURATION_MS,
};

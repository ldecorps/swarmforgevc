'use strict';

// BL-1074: closed-ticket duration ends at the active→done close, not a later
// done/→done/ re-file. Drives REAL computeMeanTicketTime against REAL git
// fixtures (same helpers as meanTicketTimeWalk.test.js).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach } = require('node:test');

const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { newRepo, git, writeTicket, move } = require(`${EXTENSION_DIR}/test/helpers/backlogCorpusFixture`);
const { sweepPendingTmpDirs } = require(`${EXTENSION_DIR}/test/helpers/tmpDir`);
const { computeMeanTicketTime } = require(`${EXTENSION_DIR}/out/metrics/swarmMetrics`);

const FEATURE = 'A closed ticket\'s measured duration ends at its close, not at a later re-file';

const KNOWN_HOPS = new Set(['1', '2']);
const KNOWN_MEANS = new Set(['5h', '3h', '4h 30m']);
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

afterEach(() => {
  sweepPendingTmpDirs();
});

function ticketFile(id) {
  return `${id}.yaml`;
}

function parseMeanLabel(label) {
  assert.ok(KNOWN_MEANS.has(label), `unknown mean label: ${label}`);
  let ms = 0;
  const hours = label.match(/(\d+)\s*h/);
  const mins = label.match(/(\d+)\s*m/);
  if (hours) ms += Number(hours[1]) * HOUR_MS;
  if (mins) ms += Number(mins[1]) * MIN_MS;
  return ms;
}

function ensureRepo(ctx) {
  if (!ctx.repo) {
    ctx.repo = newRepo('sfvc-bl1074-acceptance-');
  }
  return ctx.repo;
}

function currentDoneDir(ctx, id) {
  return ctx.doneDirById?.[id] || 'done';
}

function setDoneDir(ctx, id, dir) {
  ctx.doneDirById = ctx.doneDirById || {};
  ctx.doneDirById[id] = dir;
}

function refileInsideDone(ctx, id, hops, lastAt) {
  assert.ok(KNOWN_HOPS.has(String(hops)), `unknown hops value: ${hops}`);
  const n = Number(hops);
  const repo = ensureRepo(ctx);
  const name = ticketFile(id);
  let fromDir = currentDoneDir(ctx, id);
  for (let i = 1; i <= n; i += 1) {
    const toDir = `done/M${i}`;
    move(repo, fromDir, toDir, name);
    const when = i === n ? lastAt : `2026-07-0${1 + i}T10:00:00`;
    git(repo, ['commit', '-q', '-m', `refile ${id} hop ${i}`], when);
    fromDir = toDir;
    setDoneDir(ctx, id, toDir);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with a backlog containing "active" and "done" directories$/, (ctx) => {
    ensureRepo(ctx);
    ctx.doneDirById = {};
    ctx.recordedMean = null;
  });

  scoped(/^ticket "([^"]+)" was promoted into backlog\/active\/ at "([^"]+)"$/, (ctx, id, when) => {
    const repo = ensureRepo(ctx);
    writeTicket(repo, 'active', ticketFile(id));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', `promote ${id}`], when);
  });

  scoped(/^ticket "([^"]+)" was closed into backlog\/done\/ at "([^"]+)"$/, (ctx, id, when) => {
    const repo = ensureRepo(ctx);
    move(repo, 'active', 'done', ticketFile(id));
    git(repo, ['commit', '-q', '-m', `close ${id}`], when);
    setDoneDir(ctx, id, 'done');
  });

  scoped(
    /^ticket "([^"]+)" was then re-filed (\d+) further times inside done\/, the last at "([^"]+)"$/,
    (ctx, id, hops, lastAt) => {
      refileInsideDone(ctx, id, hops, lastAt);
    }
  );

  scoped(/^ticket "([^"]+)" was reopened into backlog\/active\/ at "([^"]+)"$/, (ctx, id, when) => {
    const repo = ensureRepo(ctx);
    const fromDir = currentDoneDir(ctx, id);
    move(repo, fromDir, 'active', ticketFile(id));
    git(repo, ['commit', '-q', '-m', `reopen ${id}`], when);
    setDoneDir(ctx, id, null);
  });

  scoped(/^both tickets were re-filed under a done\/ milestone directory at "([^"]+)"$/, (ctx, when) => {
    const repo = ensureRepo(ctx);
    const ids = Object.keys(ctx.doneDirById).filter((id) => ctx.doneDirById[id]);
    assert.equal(ids.length, 2, `expected two closed tickets, got ${ids.length}`);
    for (const id of ids) {
      move(repo, currentDoneDir(ctx, id), 'done/M8', ticketFile(id));
      setDoneDir(ctx, id, 'done/M8');
    }
    git(repo, ['commit', '-q', '-m', 'file under M8'], when);
    ctx.milestoneDir = 'done/M8';
  });

  scoped(/^mean ticket time was computed over that repository and recorded$/, (ctx) => {
    ctx.recordedMean = computeMeanTicketTime(ensureRepo(ctx));
  });

  scoped(/^that done\/ milestone directory is renamed at "([^"]+)"$/, (ctx, when) => {
    const repo = ensureRepo(ctx);
    assert.ok(ctx.milestoneDir, 'no milestone directory recorded');
    const renamed = `${ctx.milestoneDir}-renamed`;
    fs.mkdirSync(path.join(repo, 'backlog', path.dirname(renamed)), { recursive: true });
    git(repo, ['mv', `backlog/${ctx.milestoneDir}`, `backlog/${renamed}`]);
    git(repo, ['commit', '-q', '-m', 'rename milestone'], when);
    for (const id of Object.keys(ctx.doneDirById)) {
      if (ctx.doneDirById[id] === ctx.milestoneDir) {
        setDoneDir(ctx, id, renamed);
      }
    }
    ctx.milestoneDir = renamed;
  });

  scoped(/^mean ticket time is computed over that repository$/, (ctx) => {
    ctx.result = computeMeanTicketTime(ensureRepo(ctx));
  });

  scoped(/^the reported mean is "([^"]+)" over (\d+) ticket(?:s)?$/, (ctx, label, count) => {
    assert.equal(ctx.result.sampleCount, Number(count));
    assert.equal(ctx.result.meanMs, parseMeanLabel(label));
  });

  scoped(/^the reported mean equals the recorded mean$/, (ctx) => {
    assert.ok(ctx.recordedMean, 'no recorded mean');
    assert.deepEqual(ctx.result, ctx.recordedMean);
  });
}

module.exports = { registerSteps };

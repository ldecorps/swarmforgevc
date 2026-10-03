'use strict';

// BL-1901: step handlers for "A parcel line that carries only its own ticket
// lands as a merge of origin/main and a fast-forward push". QA queues with the
// REAL lander_queue.bb and the REAL lander_lib.bb tick! runs each land in the
// fixture's own lander worktree, with no land-path override, so every land
// goes through land_merge_path.bb as in production. The fixture (bare origin,
// project repo, QA worktree, a line worktree, all under mkdtemp and proven by
// --git-common-dir) is BL-1872's own, reused rather than copied.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./bl1872LanderDaemonSteps');

const { makeFixture, git, queue, runSweep, entries, approvals } = fixture;

const FEATURE =
  'BL-1901 A parcel line that carries only its own ticket lands as a merge of origin/main and a fast-forward push';

function st(ctx) {
  if (!ctx.bl1901) ctx.bl1901 = makeFixture();
  return ctx.bl1901;
}

// One commit on the line worktree, writing `file`.
function commitOnLine(fx, subject, file, body) {
  fs.writeFileSync(path.join(fx.line, file), body);
  git(fx.line, 'add', file);
  git(fx.line, 'commit', '-q', '-m', subject);
}

// origin/main gains one commit made outside the line (another ticket's land).
function moveOrigin(fx, file = 'elsewhere.txt', body = 'origin moved\n') {
  const side = path.join(fx.work, 'side');
  if (!fs.existsSync(side)) git(fx.root, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  git(side, 'fetch', '-q', 'origin');
  git(side, 'checkout', '-q', '--detach', 'origin/main');
  fs.writeFileSync(path.join(side, file), body);
  git(side, 'add', file);
  git(side, 'commit', '-q', '-m', 'BL-9000: an earlier land');
  git(side, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(fx.line, 'fetch', '-q', 'origin');
}

function cutLine(fx, at) {
  git(fx.line, 'fetch', '-q', 'origin');
  git(fx.line, 'checkout', '-q', '--detach', at || 'origin/main');
}

const REGISTER = 'backlog/standing-reds.tsv';

// One standing-reds row: lane, file (the row key), owner, first seen, note.
function registerRow(owner) {
  return ['unit', `extension/test/${owner.toLowerCase()}Red.test.js`, owner, '2026-10-02', 'fixture red'].join('\t');
}

// origin/main gains a register carrying `owner`'s row and, when `open`, the
// paused ticket YAML that makes `owner` an open ticket (qa_hold_lib's
// open-ticket-ids-for reads backlog/paused and backlog/active basenames).
function seedRegister(fx, owner, open) {
  fx.registerRow = registerRow(owner);
  const side = path.join(fx.work, 'register');
  git(fx.root, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  fs.mkdirSync(path.join(side, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(side, REGISTER), `# lane\tfile\towner\tfirst_seen\tnote\n${fx.registerRow}\n`);
  if (open) fs.writeFileSync(path.join(side, 'backlog', 'paused', `${owner}-a-fixture-ticket.yaml`), `id: ${owner}\n`);
  git(side, 'add', '-A');
  git(side, 'commit', '-q', '-m', `${owner}: register a standing red`);
  git(side, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(fx.line, 'fetch', '-q', 'origin');
}

function originRegisterRows(fx) {
  let text = '';
  try {
    text = git(fx.origin, 'show', `main:${REGISTER}`);
  } catch (_) {
    return [];
  }
  return text.split('\n').filter((l) => l && !l.startsWith('#'));
}

function landLog(fx, ticket) {
  const e = entries(fx).find((x) => x.task === ticket);
  assert.ok(e, `no queue entry for ${ticket}: ${JSON.stringify(entries(fx))}`);
  const m = e.text.match(/:log "([^"]+)"/);
  return m && fs.existsSync(m[1]) ? fs.readFileSync(m[1], 'utf8') : '';
}

// Explicit KNOWN_VALUES for the Outline rows: an unknown row throws.
const DECLINED_LINES = {
  'also carries an unlanded BL-9002 commit': (fx) => {
    cutLine(fx);
    commitOnLine(fx, 'BL-9002: unlanded work', 'BL-9002.txt', 'BL-9002\n');
    commitOnLine(fx, 'BL-9001: own work', 'BL-9001.txt', 'BL-9001\n');
  },
  'also carries a commit that names no ticket and is no merge': (fx) => {
    cutLine(fx);
    commitOnLine(fx, 'tidy the fixture', 'tidy.txt', 'tidy\n');
    commitOnLine(fx, 'BL-9001: own work', 'BL-9001.txt', 'BL-9001\n');
  },
  'conflicts with origin/main when merged': (fx) => {
    const base = git(fx.origin, 'rev-parse', 'main');
    moveOrigin(fx, 'shared.txt', 'origin side\n');
    cutLine(fx, base);
    commitOnLine(fx, 'BL-9001: own work', 'shared.txt', 'line side\n');
  },
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture project with a bare origin and a lander queue$/, (ctx) => {
    st(ctx);
  });

  scoped(/^origin\/main has moved on since (BL-\d+)'s line was cut$/, (ctx) => {
    const fx = st(ctx);
    fx.cutAt = git(fx.origin, 'rev-parse', 'main');
    moveOrigin(fx);
  });

  scoped(
    /^the lander queue holds an entry for (BL-\d+) whose line carries only \1 commits and merges of origin\/main$/,
    (ctx, ticket) => {
      const fx = st(ctx);
      cutLine(fx, fx.cutAt);
      commitOnLine(fx, `${ticket}: first`, `${ticket}.txt`, `${ticket}\n`);
      git(fx.line, 'merge', '-q', '--no-ff', '-m', 'Merge main into coder.', 'origin/main');
      commitOnLine(fx, `${ticket}: second`, `${ticket}-2.txt`, `${ticket}\n`);
      // origin/main moves once more after the line's own merge, so the land
      // has a real merge to make.
      moveOrigin(fx, 'later.txt', 'later\n');
      queue(fx, ticket, git(fx.line, 'rev-parse', 'HEAD'));
    }
  );

  scoped(/^the lander queue holds an entry for (BL-\d+) whose line carries only \1 commits on top of origin\/main$/, (ctx, ticket) => {
    const fx = st(ctx);
    cutLine(fx);
    commitOnLine(fx, `${ticket}: own work`, `${ticket}.txt`, `${ticket}\n`);
    queue(fx, ticket, git(fx.line, 'rev-parse', 'HEAD'));
  });

  scoped(/^origin\/main's backlog\/standing-reds\.tsv carries a row owned by (BL-\d+)(, an open ticket)?$/, (ctx, owner, open) => {
    seedRegister(st(ctx), owner, Boolean(open));
  });

  scoped(/^the lander queue holds an entry for (BL-\d+) whose line deletes that row$/, (ctx, ticket) => {
    const fx = st(ctx);
    cutLine(fx);
    const kept = fs
      .readFileSync(path.join(fx.line, REGISTER), 'utf8')
      .split('\n')
      .filter((l) => l !== fx.registerRow)
      .join('\n');
    fs.writeFileSync(path.join(fx.line, REGISTER), kept);
    fs.writeFileSync(path.join(fx.line, `${ticket}.txt`), `${ticket}\n`);
    git(fx.line, 'add', '-A');
    git(fx.line, 'commit', '-q', '-m', `${ticket}: own work`);
    queue(fx, ticket, git(fx.line, 'rev-parse', 'HEAD'));
  });

  scoped(/^the lander queue holds an entry for (BL-\d+) whose line (.+)$/, (ctx, ticket, carries) => {
    const build = DECLINED_LINES[carries];
    assert.ok(build, `unknown line shape in the Examples table: ${carries}`);
    const fx = st(ctx);
    build(fx);
    queue(fx, ticket, git(fx.line, 'rev-parse', 'HEAD'));
  });

  scoped(/^the lander sweep runs until the queue is empty$/, (ctx) => {
    runSweep(st(ctx));
  });

  scoped(/^origin\/main's tip is a merge whose parents are the queued commit and the previous origin\/main tip$/, (ctx) => {
    const fx = st(ctx);
    const parents = git(fx.origin, 'rev-list', '--parents', '-n', '1', 'main').split(' ').slice(1);
    assert.deepEqual(parents, [fx.queued['BL-9001'], fx.originBefore], `${landLog(fx, 'BL-9001')}`);
  });

  scoped(/^origin\/main's tip is the queued commit$/, (ctx) => {
    const fx = st(ctx);
    assert.equal(git(fx.origin, 'rev-parse', 'main'), fx.queued['BL-9001'], landLog(fx, 'BL-9001'));
  });

  scoped(/^the land step did not run$/, (ctx) => {
    const log = landLog(st(ctx), 'BL-9001');
    assert.match(log, /^LAND_PATH merge$/m, log);
    assert.doesNotMatch(log, /LAND_CLEAN|LAND_REPLAY|LAND_ESCALATE|LOCK_ACQUIRED/, log);
  });

  scoped(/^the land step ran for (BL-\d+)$/, (ctx, ticket) => {
    const log = landLog(st(ctx), ticket);
    assert.match(log, /^LAND_PATH land-step: /m, log);
    assert.match(log, /LAND_CLEAN|LAND_REPLAY|LAND_ESCALATE|ENTANGLED_SIBLING_BLOCK/, log);
  });

  scoped(/^the land record for (BL-\d+) names the queued commit as its source and the merge path$/, (ctx, ticket) => {
    const fx = st(ctx);
    const src = fx.queued[ticket].slice(0, 10);
    const all = approvals(fx);
    assert.ok(all.some((r) => r.ticket === ticket && r.source === src && r.path === 'merge'), JSON.stringify(all));
  });

  // The land step rebuilds, so the work is checked by content, not by sha.
  scoped(/^(BL-\d+)'s work is on origin\/main$/, (ctx, ticket) => {
    const fx = st(ctx);
    assert.equal(git(fx.origin, 'show', `main:${ticket}.txt`), ticket, `${fx.sweepOut}\n${landLog(fx, ticket)}`);
  });

  scoped(/^origin\/main's backlog\/standing-reds\.tsv has no row owned by (BL-\d+)$/, (ctx, owner) => {
    const fx = st(ctx);
    const rows = originRegisterRows(fx);
    assert.ok(!rows.some((r) => r.split('\t')[2] === owner), `${JSON.stringify(rows)}\n${landLog(fx, 'BL-9001')}`);
  });

  scoped(/^origin\/main's backlog\/standing-reds\.tsv still has the row owned by (BL-\d+)$/, (ctx, owner) => {
    const fx = st(ctx);
    const rows = originRegisterRows(fx);
    assert.ok(rows.includes(registerRow(owner)), `${JSON.stringify(rows)}\n${landLog(fx, 'BL-9001')}`);
  });

  scoped(/^the land record for (BL-\d+) names the land-step path$/, (ctx, ticket) => {
    const fx = st(ctx);
    const all = approvals(fx);
    assert.ok(all.some((r) => r.ticket === ticket && r.path === 'land-step'), `${JSON.stringify(all)}\n${landLog(fx, ticket)}`);
  });
}

module.exports = { registerSteps };

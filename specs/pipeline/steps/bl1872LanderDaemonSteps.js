'use strict';

// BL-1872: step handlers for "The lander daemon lands what QA approves".
// QA queues with the REAL lander_queue.bb; the sweep is the REAL
// lander_lib.bb tick!, driven in one bb process until the queue is empty,
// which runs the REAL land_main_publish.sh --land in the fixture's own
// lander worktree. The fixture is a bare origin plus a project repo with QA's
// worktree, all under mkdtemp (BL-1390: proven by --git-common-dir before any
// mutating command). The sweep's note sender is the one seam: it delivers the
// note into the fixture recipient's inbox/new, standing in for handoffd's
// swarm_handoff send and the daemon's delivery.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-1872 The lander daemon lands what QA approves, so QA's turn ends at approval";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'lander_lib.bb');
const QUEUE = path.join(SCRIPTS, 'lander_queue.bb');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeFixture() {
  const work = mkProcessTmpDir('bl1872acc-');
  const origin = path.join(work, 'origin.git');
  const root = path.join(work, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir'));
  assert.equal(common, path.join(root, '.git'), `fixture is not its own repository: ${common}`);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(root, 'config', k, v);
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n.worktrees/\n');
  fs.writeFileSync(path.join(root, 'shared.txt'), 'base\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');
  const qa = path.join(root, '.worktrees', 'QA');
  git(root, 'worktree', 'add', '-q', '-b', 'swarmforge-QA', qa, 'origin/main');
  const line = path.join(root, '.worktrees', 'line');
  git(root, 'worktree', 'add', '-q', '--detach', line, 'origin/main');
  return { work, origin, root, qa, line, queued: {} };
}

function ensure(ctx) {
  if (!ctx.bl1872) ctx.bl1872 = makeFixture();
  return ctx.bl1872;
}

// A commit on `ticket`'s own line: off origin/main, one file of its own.
function ownLine(fx, ticket, file = `${ticket}.txt`, body = `${ticket}\n`) {
  git(fx.line, 'fetch', '-q', 'origin');
  git(fx.line, 'checkout', '-q', '--detach', 'origin/main');
  fs.writeFileSync(path.join(fx.line, file), body);
  git(fx.line, 'add', file);
  git(fx.line, 'commit', '-q', '-m', `${ticket}: own line`);
  return git(fx.line, 'rev-parse', 'HEAD');
}

function queue(fx, ticket, sha) {
  fx.originBefore = git(fx.origin, 'rev-parse', 'main');
  fx.queueOut = execFileSync('bb', [QUEUE, fx.root, '--enqueue', ticket, sha], { encoding: 'utf8' });
  fx.queued[ticket] = sha;
}

// Moves origin/main once, on the first push it receives, then rejects that
// push: the land's first push loses the race for real. With `conflictFile`,
// the commit origin moves to writes that file too, so the land's single
// rematch (a three-way merge onto the moved tip) conflicts.
function raceOnce(fx, conflictFile = null) {
  // The race is aimed at the land step's push and its one rematch, so these
  // lands take the land-step path directly (BL-1901's merge path, which runs
  // first by default, would consume the race on its own push).
  fx.landPath = 'land-step';
  const marker = path.join(fx.work, 'raced');
  const hook = path.join(fx.origin, 'hooks', 'pre-receive');
  fs.writeFileSync(
    hook,
    [
      '#!/usr/bin/env bash',
      `[ -f ${JSON.stringify(marker)} ] && exit 0`,
      `touch ${JSON.stringify(marker)}`,
      'unset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES',
      conflictFile
        ? `export GIT_INDEX_FILE=$(mktemp); git read-tree main; b=$(echo origin-side | git hash-object -w --stdin); git update-index --add --cacheinfo 100644,$b,${conflictFile}; t=$(git write-tree); rm -f "$GIT_INDEX_FILE"; unset GIT_INDEX_FILE`
        : 't=$(git rev-parse main^{tree})',
      'n=$(echo race | git -c user.name=r -c user.email=r@r commit-tree "$t" -p main)',
      'git update-ref refs/heads/main "$n"',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
}

function runSweep(fx) {
  fx.originBefore = fx.originBefore || git(fx.origin, 'rev-parse', 'main');
  const inboxes = {
    coordinator: path.join(fx.root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new'),
    QA: path.join(fx.qa, '.swarmforge', 'handoffs', 'inbox', 'new'),
  };
  fx.inboxes = inboxes;
  const program = `
(require '[babashka.fs :as fs] '[clojure.string :as str])
(load-file ${JSON.stringify(LIB)})
(def inboxes ${'{'}${Object.entries(inboxes).map(([k, v]) => `${JSON.stringify(k)} ${JSON.stringify(v)}`).join(' ')}${'}'})
(def n (atom 0))
(defn deliver! [note]
  (doseq [to (:to note)]
    (let [dir (get inboxes to)]
      (fs/create-dirs dir)
      (spit (str (fs/path dir (str "00_lander_" (swap! n inc) "_to_" to ".handoff")))
            (str (str/join "\\n" (lander-lib/draft-lines note)) "\\n\\n" (:message note) "\\n")))))
(loop [i 0]
  (let [d (lander-lib/tick! ${JSON.stringify(fx.root)} {:send-note! deliver! :now-ms (System/currentTimeMillis)${fx.landPath ? ` :land-path :${fx.landPath}` : ''}})]
    (println "TICK" (name (:action d)) (str (:id d)))
    (cond
      (= :idle (:action d)) nil
      (> i 2000) (println "TICK_LIMIT")
      :else (do (when (= :wait (:action d)) (Thread/sleep 100)) (recur (inc i))))))`;
  fx.sweepOut = execFileSync('bb', ['-e', program], { encoding: 'utf8', cwd: fx.root, timeout: 300000 });
  assert.doesNotMatch(fx.sweepOut, /TICK_LIMIT/);
}

function entries(fx) {
  const dir = path.join(fx.root, '.swarmforge', 'lander', 'queue');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.edn'))
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const field = (k) => (text.match(new RegExp(`:${k} (?:"([^"]*)"|:?([\\w-]+))`)) || []).slice(1).find(Boolean);
      return { file: f, text, task: field('task'), commit: field('commit'), status: field('status'), startedAt: Number(field('started-at')), finishedAt: Number(field('finished-at')) };
    });
}

function entryFor(fx, ticket) {
  const e = entries(fx).find((x) => x.task === ticket);
  assert.ok(e, `no queue entry for ${ticket}: ${JSON.stringify(entries(fx))}`);
  return e;
}

function originSubjects(fx) {
  return git(fx.origin, 'log', '--format=%s', 'main').split('\n').filter(Boolean);
}

function originCarries(fx, ticket) {
  return git(fx.origin, 'log', '--format=%H %s', 'main')
    .split('\n')
    .filter((l) => new RegExp(`^\\w+ ${ticket}:`).test(l))
    .map((l) => l.split(' ')[0]);
}

function notes(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')) : [];
}

function approvals(fx) {
  const dir = path.join(fx.root, '.swarmforge', 'land-approvals');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n'))
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture project with a bare origin and a lander queue$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^QA has approved (BL-\d+) at a commit on \1's own line$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    fx.approved = { ticket, sha: ownLine(fx, ticket) };
  });

  scoped(/^QA queues the land of (BL-\d+) at that commit$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    queue(fx, ticket, fx.approved.sha);
  });

  scoped(/^the lander queue holds one entry naming (BL-\d+) and that commit$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const all = entries(fx);
    assert.equal(all.length, 1, JSON.stringify(all));
    assert.equal(all[0].task, ticket);
    assert.equal(all[0].commit, fx.approved.sha);
    assert.equal(all[0].status, 'queued');
  });

  // "Not changed" by the land: in the rematch-conflict row another writer's
  // race commit moved origin/main (that is the conflict), so the tip may be
  // exactly that one commit on top - never anything the land pushed.
  scoped(/^origin\/main has not changed$/, (ctx) => {
    const fx = ensure(ctx);
    const tip = git(fx.origin, 'rev-parse', 'main');
    if (tip !== fx.originBefore) {
      assert.equal(git(fx.origin, 'rev-parse', 'main^'), fx.originBefore, originSubjects(fx).join(' | '));
      assert.equal(git(fx.origin, 'log', '-1', '--format=%s', 'main'), 'race');
    }
    assert.deepEqual(originCarries(fx, 'BL-9001'), [], originSubjects(fx).join(' | '));
  });

  scoped(/^the lander queue holds an entry for (BL-\d+) at a commit on \1's own line$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    queue(fx, ticket, ownLine(fx, ticket));
  });

  scoped(/^the lander queue holds entries for (BL-\d+) and then (BL-\d+), each on its own line$/, (ctx, a, b) => {
    const fx = ensure(ctx);
    const shaA = ownLine(fx, a);
    const shaB = ownLine(fx, b);
    queue(fx, a, shaA);
    queue(fx, b, shaB);
    fx.originBefore = git(fx.origin, 'rev-parse', 'main');
  });

  scoped(/^the lander queue holds an entry for (BL-\d+) whose land (conflicts with origin\/main|is refused by the land step with LAND_ESCALATE)$/, (ctx, ticket, how) => {
    const fx = ensure(ctx);
    if (how.startsWith('conflicts')) {
      // The land step lands the ticket's own paths whole, so origin/main
      // can only conflict with it where git merges: the single rematch.
      // origin moves during the push with its own version of the ticket's file.
      queue(fx, ticket, ownLine(fx, ticket));
      raceOnce(fx, `${ticket}.txt`);
    } else {
      // Citing origin/main itself: nothing of the ticket's to land.
      queue(fx, ticket, git(fx.origin, 'rev-parse', 'main'));
    }
  });

  scoped(/^QA queues the land of (BL-\d+) at the same commit twice$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const sha = ownLine(fx, ticket);
    queue(fx, ticket, sha);
    queue(fx, ticket, sha);
    assert.match(fx.queueOut, /LANDER_ALREADY_QUEUED/);
  });

  scoped(/^origin\/main moves after the land is built and before it is pushed$/, (ctx) => {
    raceOnce(ensure(ctx));
  });

  scoped(/^the lander sweep runs until the queue is empty$/, (ctx) => {
    runSweep(ensure(ctx));
  });

  scoped(/^origin\/main carries (BL-\d+)'s change$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    assert.equal(originCarries(fx, ticket).length, 1, `${originSubjects(fx).join(' | ')}\n${fx.sweepOut}`);
    assert.equal(git(fx.origin, 'show', `main:${ticket}.txt`), ticket);
  });

  scoped(/^the land approval for (BL-\d+) is recorded$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const src = fx.queued[ticket].slice(0, 10);
    assert.ok(approvals(fx).some((r) => r.ticket === ticket && r.source === src), JSON.stringify(approvals(fx)));
  });

  scoped(/^the coordinator's inbox holds the bookkeeping note for (BL-\d+)$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const all = notes(fx.inboxes.coordinator);
    assert.ok(all.some((n) => new RegExp(`message: ${ticket} QA-approved [0-9a-f]{10} - move to done`).test(n)), all.join('\n'));
  });

  scoped(/^the queue entry for (BL-\d+) is marked (landed|refused)$/, (ctx, ticket, status) => {
    const fx = ensure(ctx);
    assert.equal(entryFor(fx, ticket).status, status, entryFor(fx, ticket).text);
  });

  scoped(/^origin\/main carries (BL-\d+)'s change before (BL-\d+)'s$/, (ctx, a, b) => {
    const fx = ensure(ctx);
    const subjects = originSubjects(fx).reverse();
    const ia = subjects.findIndex((s) => s.startsWith(`${a}:`));
    const ib = subjects.findIndex((s) => s.startsWith(`${b}:`));
    assert.ok(ia >= 0 && ib > ia, subjects.join(' | '));
  });

  scoped(/^no two lands ran at the same time$/, (ctx) => {
    const fx = ensure(ctx);
    const runs = entries(fx).sort((x, y) => x.startedAt - y.startedAt);
    assert.ok(runs.length >= 2, JSON.stringify(runs));
    for (let i = 1; i < runs.length; i += 1) {
      assert.ok(runs[i].startedAt >= runs[i - 1].finishedAt, `overlap: ${JSON.stringify(runs)}`);
    }
  });

  scoped(/^QA's inbox holds a note naming (BL-\d+) and the land step's reason$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const all = notes(fx.inboxes.QA);
    const logs = entries(fx).map((e) => { const m = e.text.match(/:log "([^"]+)"/); return m && fs.existsSync(m[1]) ? fs.readFileSync(m[1], "utf8") : ""; }).join("\n");
    assert.ok(all.some((n) => new RegExp(`message: ${ticket} land refused: (LAND_|ENTANGLED_)`).test(n)), all.join("\n") + fx.sweepOut + logs);
  });

  scoped(/^origin\/main carries exactly one landing commit for (BL-\d+)$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    assert.equal(originCarries(fx, ticket).length, 1, originSubjects(fx).join(' | '));
  });

  scoped(/^QA's worktree and the lander's worktree are each still on their own branch$/, (ctx) => {
    const fx = ensure(ctx);
    assert.match(fx.sweepOut + fs.readFileSync(entryFor(fx, 'BL-9001').text.match(/:log "([^"]+)"/)[1], 'utf8'), /LAND_REMATCH/);
    assert.equal(git(fx.qa, 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-QA');
    assert.equal(git(path.join(fx.root, '.worktrees', 'lander'), 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-lander');
  });

  scoped(/^the land approvals hold a record for the commit origin\/main carries for (BL-\d+)$/, (ctx, ticket) => {
    const fx = ensure(ctx);
    const published = originCarries(fx, ticket)[0];
    assert.ok(published, originSubjects(fx).join(' | '));
    fx.rematchRecord = approvals(fx).find((r) => r.commit === published.slice(0, 10));
    assert.ok(fx.rematchRecord, `no record for ${published}: ${JSON.stringify(approvals(fx))}`);
  });

  scoped(/^that record names the queued commit as its source$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(fx.rematchRecord.source, fx.queued['BL-9001'].slice(0, 10));
  });
}

// BL-1901 reuses the fixture (its own feature drives the same lander sweep).
module.exports = { registerSteps, fixture: { makeFixture, git, queue, runSweep, entries, approvals } };

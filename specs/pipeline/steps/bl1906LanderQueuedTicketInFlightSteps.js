'use strict';

// BL-1906: step handlers for "A ticket queued for the lander is in flight,
// not dropped". Scenarios 01 and 02 drive the daemon's OWN
// dropped-parcel-sweep!: handoffd.bb is loaded under its BL-1395 guard with
// the fixture root bound through *command-line-args*, the idiom of
// bl1494_post_qa_sweep_wake_field_test_runner.bb. Its one send,
// daemon-cycle-guard-lib/sh!, is stubbed to capture the nudge draft, so
// nothing is delivered anywhere. Scenario 03 runs the real
// dispatch_trail_cli.bb against the same root. The root is a `git init`
// under a tracked mkdtemp (BL-1636), proven its own repository by
// --git-common-dir before the seed commit (BL-1390). Steps are scoped to
// this feature: the sweep's step text reads naturally in several features
// (BL-1301's handler).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'A ticket queued for the lander is in flight, not dropped';
const SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const TICKET = 'BL-1906';
const OTHER = 'BL-9999';
const STALE_INSTANT = '2020-01-01T00:00:00.000000Z';

// KNOWN_VALUES for every quoted token in the feature.
const STATUSES = new Set(['queued', 'running', 'landed', 'refused']);
const SENT = new Set(['yes', 'no']);
const VERDICTS = new Set(['DISPATCHED', 'DROPPED']);

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return env;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cleanEnv(),
  }).trim();
}

// Every helper below takes the fixture object (ctx.bl1906), so the property
// test reuses them rather than copying them.
function queueDir(fx) {
  return path.join(fx.root, '.swarmforge', 'lander', 'queue');
}

// `sha` keeps two entries for the same task apart (one approval each).
function writeEntry(fx, task, status, sha = 'aaaaaaaaaa') {
  fs.mkdirSync(queueDir(fx), { recursive: true });
  const id = `${task}-${sha}`;
  fs.writeFileSync(
    path.join(queueDir(fx), `${id}.edn`),
    `{:id "${id}" :task "${task}" :commit "${sha}" :issue nil :status :${status} :enqueued-at 1}`
  );
}

// Named for the ticket, but torn mid-write: it must never read as a land.
function writeTornEntry(fx, task) {
  fs.mkdirSync(queueDir(fx), { recursive: true });
  fs.writeFileSync(path.join(queueDir(fx), `${task}-bbbbbbbbbb.edn`), `{:id "${task}-bbbbbbbbbb" :task "${task}" :status :que`);
}

const QUEUES = {
  absent: () => {},
  'queued for another ticket': (fx) => writeEntry(fx, OTHER, 'queued'),
  'an unreadable entry': (fx) => writeTornEntry(fx, TICKET),
};

function queueSnapshot(fx) {
  const dir = queueDir(fx);
  if (!fs.existsSync(dir)) return null;
  return Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
}

// The Background's fixture: an active ticket whose only trail is a stale
// forward, every mailbox empty.
function makeFixture() {
  const root = path.join(trackedTmpRoot('sfvc-bl1906-'), 'repo');
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q', '-b', 'main', root], { env: cleanEnv() });
  assert.equal(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')), path.join(fs.realpathSync(root), '.git'), 'fixture is not its own repository');
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n.worktrees/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-q', '-m', 'seed');
  const coder = path.join(root, '.worktrees', 'coder');
  const qa = path.join(root, '.worktrees', 'QA');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const rows = [
    ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['coder', 'coder', coder, 'swarmforge-coder', 'Coder', 'claude', 'task'],
    ['QA', 'QA', qa, 'swarmforge-QA', 'QA', 'claude', 'task'],
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows.map((r) => r.join('\t')).join('\n')}\n`);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${TICKET}-demo.yaml`), `id: ${TICKET}\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n`);
  // The trail: the documenter's forward to QA, long ago. Every mailbox's
  // new/ and in_process/ is empty, so no parcel is in flight there.
  const sent = path.join(coder, '.swarmforge', 'handoffs', 'sent');
  fs.mkdirSync(sent, { recursive: true });
  fs.writeFileSync(
    path.join(sent, '00_trail.handoff'),
    `from: documenter\nto: QA\ntype: git_handoff\ntask: ${TICKET}-demo\ncommit: 0000000000\nenqueued_at: ${STALE_INSTANT}\n\nbody\n`
  );
  return { root, coder };
}

// The daemon's own dropped-parcel-sweep!, the send stubbed to capture the
// nudge drafts. Returns the drafts.
function runSweep(fx) {
  const program = `
(require '[babashka.fs :as fs] '[cheshire.core :as json])
(binding [*command-line-args* [${JSON.stringify(fx.root)}]]
  (load-file ${JSON.stringify(path.join(SCRIPTS, 'handoffd.bb'))}))
(def drafts (atom []))
(with-redefs [daemon-cycle-guard-lib/sh! (fn [cmd & _] (swap! drafts conj (slurp (str (last cmd)))) {:exit 0 :out "" :err ""})]
  (handoffd/dropped-parcel-sweep! (handoffd/load-roles)))
(println (str "DRAFTS " (json/generate-string @drafts)))`;
  const res = spawnSync('bb', ['-e', program], {
    encoding: 'utf8',
    timeout: 120000,
    env: cleanEnv({ SWARMFORGE_ALLOW_TMP_DAEMON: '1' }),
  });
  fx.out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.equal(res.status, 0, fx.out);
  const m = /^DRAFTS (.*)$/m.exec(res.stdout || '');
  assert.ok(m, fx.out);
  return JSON.parse(m[1]);
}

function nudgesFor(drafts, ticket) {
  return drafts.filter((d) => new RegExp(`^message: ${ticket} no parcel in flight`, 'm').test(d));
}

// The real dispatch_trail_cli.bb's `dispatched` answer.
function runCli(fx, ticket) {
  const res = spawnSync('bb', [path.join(SCRIPTS, 'dispatch_trail_cli.bb'), fx.root, 'dispatched', ticket], {
    encoding: 'utf8',
    timeout: 60000,
    env: cleanEnv(),
  });
  fx.out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.equal(res.status, 0, fx.out);
  return (res.stdout || '').trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an active ticket with a trail, no parcel in any role's mailbox, and a trail stale past the threshold$/, (ctx) => {
    ctx.bl1906 = makeFixture();
  });

  scoped(/^the lander queue holds an entry for the ticket with status "([^"]+)"$/, (ctx, status) => {
    assert.ok(STATUSES.has(status), `unknown <status> token: ${status}`);
    writeEntry(ctx.bl1906, TICKET, status);
  });

  scoped(/^the lander queue is "([^"]+)"$/, (ctx, queue) => {
    const build = QUEUES[queue];
    assert.ok(build, `unknown <queue> token: ${queue}`);
    build(ctx.bl1906);
  });

  scoped(/^the daemon's dropped-parcel sweep evaluates it$/, (ctx) => {
    const fx = ctx.bl1906;
    const before = queueSnapshot(fx);
    fx.drafts = runSweep(fx);
    // Invariant 3: the sweep only reads the queue.
    assert.deepEqual(queueSnapshot(fx), before, 'the sweep changed the lander queue');
  });

  scoped(/^a dropped-parcel nudge is sent: "([^"]+)"$/, (ctx, sent) => {
    assert.ok(SENT.has(sent), `unknown <sent> token: ${sent}`);
    const { drafts, out } = ctx.bl1906;
    const nudges = nudgesFor(drafts, TICKET);
    if (sent === 'yes') {
      assert.equal(nudges.length, 1, `expected one nudge naming ${TICKET}: ${JSON.stringify(drafts)}\n${out}`);
      assert.match(nudges[0], /^to: coordinator$/m, nudges[0]);
    } else {
      assert.deepEqual(nudges, [], `expected no nudge: ${JSON.stringify(drafts)}\n${out}`);
    }
  });

  scoped(/^dispatch_trail_cli\.bb is asked whether the ticket was dispatched$/, (ctx) => {
    const fx = ctx.bl1906;
    const before = queueSnapshot(fx);
    fx.answer = runCli(fx, TICKET);
    assert.deepEqual(queueSnapshot(fx), before, 'the CLI changed the lander queue');
  });

  scoped(/^its answer begins "([^"]+)"$/, (ctx, verdict) => {
    assert.ok(VERDICTS.has(verdict), `unknown <verdict> token: ${verdict}`);
    assert.ok(ctx.bl1906.answer.startsWith(verdict), `answer ${JSON.stringify(ctx.bl1906.answer)}\n${ctx.bl1906.out}`);
  });
}

module.exports = {
  registerSteps,
  fixture: { TICKET, makeFixture, writeEntry, writeTornEntry, queueSnapshot, runSweep, nudgesFor, runCli },
};

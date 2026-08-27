'use strict';

// BL-1114: dead-letter quarantine must not be silent after announce-once or
// exhausted recovery. Drives REAL notify-dead-letters main() and
// handoffRecovery.recoverDeadLettersForRole; corrupt quarantine is the real
// handoff_lib.bb/quarantine-corrupt-handoff! rename.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { track } = require('./lib/fixtureReaper');
const { copySeededRepoInto } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'sharedRepoFixture')
);

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HANDOFF_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoff_lib.bb');
const {
  main: notifyMain,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'notify-dead-letters'));
const {
  recoverDeadLettersForRole,
  writeRecoveryAttempts,
} = require(path.join(REPO_ROOT, 'extension', 'out', 'swarm', 'handoffRecovery'));

const FEATURE =
  'BL-1114 a dead-lettered handoff cannot sit invisible after quarantine or exhausted recovery';

const KNOWN_TOPIC = {
  exists: 'exists',
  'is not yet created': 'missing',
};

const KNOWN_OUTCOME = {
  'announced naming that file': 'announced',
  'records operator-topic-not-yet-created': 'topic-missing',
};

const NOTIFY_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_NOTIFY_FORCE_RESULT'];

function ensureState(ctx) {
  if (!ctx.bl1114) ctx.bl1114 = {};
  return ctx.bl1114;
}

function mkRoot(role) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1114-'));
  track(root);
  copySeededRepoInto(root);
  const wt = path.join(root, '.worktrees', role);
  fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(wt, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `${role}\t${role}\t${wt}\tswarmforge-${role}\t${role}\tclaude\ttask\n`
  );
  return { root, wt, inboxNew: path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'new') };
}

function writeDead(inboxNew, name, body) {
  const p = path.join(inboxNew, name);
  fs.writeFileSync(p, body);
  return p;
}

async function runNotify(root, overrides) {
  const previous = Object.fromEntries(NOTIFY_ENV_KEYS.map((k) => [k, process.env[k]]));
  const originalCwd = process.cwd;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    for (const key of NOTIFY_ENV_KEYS) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
    process.cwd = () => root;
    await notifyMain();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    for (const key of NOTIFY_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  const text = writes.join('');
  return JSON.parse(text);
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a role worktree mailbox under \.worktrees\/<role>\/\.swarmforge\/handoffs$/,
    (ctx) => {
      const st = ensureState(ctx);
      st.role = 'coder';
      Object.assign(st, mkRoot(st.role));
    },
    FEATURE
  );

  registry.defineScoped(/^a \*\.handoff\.dead appears in a role's inbox\/new$/, (ctx) => {
    const st = ensureState(ctx);
    st.deadPath = writeDead(
      st.inboxNew,
      '00_bl1114.handoff.dead',
      'type: note\nrecipient: coder\ntask: BL-1114-demo\n\nbody\n'
    );
  }, FEATURE);

  registry.defineScoped(/^the Operator topic (.+)$/, (ctx, raw) => {
    const key = KNOWN_TOPIC[raw];
    if (!key) throw new Error(`BL-1114: unrecognized topic-state "${raw}"`);
    const st = ensureState(ctx);
    st.topicState = key;
    if (key === 'exists') {
      fs.mkdirSync(path.join(st.root, '.swarmforge', 'operator'), { recursive: true });
      fs.writeFileSync(
        path.join(st.root, '.swarmforge', 'operator', 'telegram-topic-map.json'),
        JSON.stringify({ '777': 'OPERATOR' })
      );
    }
  }, FEATURE);

  registry.defineScoped(/^the dead-letter notify sweep runs$/, async (ctx) => {
    const st = ensureState(ctx);
    const env =
      st.topicState === 'exists'
        ? {
            TELEGRAM_BOT_TOKEN: 'fake-token',
            TELEGRAM_CHAT_ID: 'fake-chat',
            TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: true }),
          }
        : { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' };
    st.notifyResult = await runNotify(st.root, env);
  }, FEATURE);

  registry.defineScoped(/^the sweep outcome is "(.+)"$/, (ctx, raw) => {
    const expected = KNOWN_OUTCOME[raw];
    if (!expected) throw new Error(`BL-1114: unrecognized outcome "${raw}"`);
    const st = ensureState(ctx);
    if (expected === 'announced') {
      assert.equal(st.notifyResult.sent, true);
      assert.ok(st.notifyResult.newCount >= 1);
      const state = JSON.parse(
        fs.readFileSync(path.join(st.root, '.swarmforge', 'operator', 'dead-letter-notify-state.json'), 'utf8')
      );
      assert.ok(state.announcedFilePaths.includes(st.deadPath));
    } else {
      assert.equal(st.notifyResult.sent, false);
      assert.equal(st.notifyResult.reason, 'operator-topic-not-yet-created');
    }
  }, FEATURE);

  registry.defineScoped(
    /^a \*\.handoff\.dead whose recovery attempts have reached the configured max$/,
    (ctx) => {
      const st = ensureState(ctx);
      st.deadPath = writeDead(
        st.inboxNew,
        '00_bl1114_exhausted.handoff.dead',
        'type: note\nrecipient: coder\ntask: BL-1114-exhausted\n\nbody\n'
      );
      writeRecoveryAttempts(st.deadPath, 3);
      st.maxAttempts = 3;
    },
    FEATURE
  );

  registry.defineScoped(/^the recovery path evaluates that letter$/, (ctx) => {
    const st = ensureState(ctx);
    st.escalations = [];
    st.wakes = [];
    st.outcomes = recoverDeadLettersForRole(st.role, st.inboxNew, { maxRecoveryAttempts: st.maxAttempts }, {
      isRecipientBusy: () => false,
      sendWakeUp: (role) => st.wakes.push(role),
      logRemediation: () => {},
      setNeedsHuman: (role, needsHuman) => st.escalations.push({ role, needsHuman }),
    });
  }, FEATURE);

  registry.defineScoped(/^a needs-human or equivalent escalation is raised$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.outcomes[0]?.action, 'escalated');
    assert.deepEqual(st.escalations, [{ role: st.role, needsHuman: true }]);
  }, FEATURE);

  registry.defineScoped(/^the owning role is woken or otherwise told the parcel is terminal$/, (ctx) => {
    const st = ensureState(ctx);
    assert.deepEqual(st.wakes, [st.role]);
    assert.equal(fs.existsSync(st.deadPath), false);
    const failed = path.join(st.wt, '.swarmforge', 'handoffs', 'failed', path.basename(st.deadPath));
    assert.equal(fs.existsSync(failed), true);
    const notes = fs.readdirSync(st.inboxNew).filter((f) => f.endsWith('.handoff'));
    assert.ok(notes.length >= 1);
    const body = fs.readFileSync(path.join(st.inboxNew, notes[0]), 'utf8');
    assert.match(body, /TERMINAL|needs human|exhausted/i);
  }, FEATURE);

  registry.defineScoped(/^a handoff that fails corrupt-handoff\? at dequeue$/, (ctx) => {
    const st = ensureState(ctx);
    st.corruptPath = path.join(st.inboxNew, '00_bl1114_corrupt.handoff');
    fs.writeFileSync(st.corruptPath, 'not a valid handoff envelope\n');
  }, FEATURE);

  registry.defineScoped(/^it is renamed to \*\.handoff\.dead$/, (ctx) => {
    const st = ensureState(ctx);
    const probe = [
      `(load-file ${JSON.stringify(HANDOFF_LIB)})`,
      '(let [q (ns-resolve \'handoff-lib \'quarantine-corrupt-handoff!)]',
      `  (println (str (q ${JSON.stringify(st.corruptPath)}))))`,
      '',
    ].join('\n');
    const tmp = path.join(os.tmpdir(), `bl1114-q-${process.pid}.bb`);
    fs.writeFileSync(tmp, probe);
    try {
      const r = spawnSync('bb', [tmp], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`quarantine failed:\n${r.stderr}\n${r.stdout}`);
      st.deadPath = r.stdout.trim();
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    assert.match(st.deadPath, /\.handoff\.dead$/);
    assert.equal(fs.existsSync(st.corruptPath), false);
    assert.equal(fs.existsSync(st.deadPath), true);
  }, FEATURE);

  registry.defineScoped(
    /^it is covered by the same announce-and-escalate path as a chase dead-letter$/,
    (ctx) => {
      const st = ensureState(ctx);
      // Same suffix notify-dead-letters / recoverDeadLetters scan — no parallel
      // quarantine channel.
      assert.match(path.basename(st.deadPath), /\.handoff\.dead$/);
      const listed = fs.readdirSync(st.inboxNew).filter((f) => f.endsWith('.handoff.dead'));
      assert.ok(listed.includes(path.basename(st.deadPath)));
    },
    FEATURE
  );
}

module.exports = { registerSteps };

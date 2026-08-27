'use strict';

// BL-790: step handlers for "The bridge queues a short note into a chosen
// role's mailbox". Drives the REAL bridge server (out/bridge/bridgeServer.js)
// and REAL swarm_handoff.bb — mirrors gateAnswerSteps.js posture.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const { startBridge } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
const { createMockCursorBridgeAgentSession } = require(path.join(EXT_DIR, 'out', 'bridge', 'cursorBridgeAgentSession'));
const {
  AGENT_NOTE_USER_MESSAGE_MAX_LEN,
  isOperatorAttributedAgentNote,
} = require(path.join(EXT_DIR, 'out', 'bridge', 'agentNotesCore'));
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'The bridge queues a short note into a chosen role\'s mailbox';
const TOKEN = 'bl790-agent-notes-token';
const DECLARED_ROLE = 'coder';
const SHORT_NOTE = 'use staging please';

function mkTmp() {
  return mkSocketFixtureRoot('bl790-acc-');
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeRolesTsv(targetPath, roles) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  const tsv = roles
    .map((role) => [role, `${role}-wt`, targetPath, `swarmforge-${role}`, role, 'claude', 'task'].join('\t'))
    .join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), `${tsv}\n`);
}

function fixtureGitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function seedGitRepo(targetPath) {
  execFileSync('git', ['init', '-q'], { cwd: targetPath, env: fixtureGitEnv() });
  fs.mkdirSync(path.join(targetPath, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'backlog', 'active', 'BL-000.yaml'), 'id: BL-000\n');
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge'), path.join(targetPath, 'swarmforge'), 'dir');
  execFileSync('git', ['add', '-A'], { cwd: targetPath, env: fixtureGitEnv() });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'seed'], {
    cwd: targetPath,
    env: fixtureGitEnv(),
  });
}

function bridgeOptions(targetPath) {
  return { letsTalk: { agentSession: createMockCursorBridgeAgentSession(targetPath) } };
}

function inboxNewDir(targetPath) {
  return path.join(targetPath, '.swarmforge', 'handoffs', 'inbox', 'new');
}

function listNoteParcels(targetPath, role = DECLARED_ROLE) {
  const dirs = [
    path.join(targetPath, '.swarmforge', 'handoffs', 'inbox', 'new'),
    path.join(targetPath, '.swarmforge', 'handoffs', 'outbox'),
  ];
  const parcels = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.handoff'))) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      if (text.includes(`to: ${role}`) && text.includes('type: note')) {
        parcels.push(text);
      }
    }
  }
  return parcels;
}

function countTmpAgentNoteDrafts(targetPath) {
  const dir = path.join(targetPath, 'tmp');
  if (!fs.existsSync(dir)) {
    return 0;
  }
  return fs.readdirSync(dir).filter((name) => name.startsWith('agent-note-draft-')).length;
}

function resolveExampleMessage(label) {
  switch (label) {
    case 'a message longer than the stated limit':
      return 'x'.repeat(AGENT_NOTE_USER_MESSAGE_MAX_LEN + 1);
    case 'a message containing a line break':
      return 'hello\nworld';
    case 'an empty message':
      return '';
    default:
      return label;
  }
}

async function postAgentNote(port, headers, body) {
  return fetch(`http://127.0.0.1:${port}/agent-notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^a caller authenticated to the bridge$/, (ctx) => {
    ctx.targetPath = mkTmp();
    seedGitRepo(ctx.targetPath);
    writeRolesTsv(ctx.targetPath, ['specifier', 'coordinator', DECLARED_ROLE, 'cleaner']);
    ctx.authHeaders = { authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN };
    ctx.declaredRole = DECLARED_ROLE;
    ctx.noteBefore = listNoteParcels(ctx.targetPath).length;
    ctx.draftsBefore = countTmpAgentNoteDrafts(ctx.targetPath);
  });

  scoped(/^a caller with no valid token$/, (ctx) => {
    ctx.authHeaders = {};
  });

  scoped(/^the declared role the caller will name has no running session$/, () => {
    /* dormant is valid — fixture has no tmux session */
  });

  scoped(/^the caller sends a short note to a declared role$/, async (ctx) => {
    ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, bridgeOptions(ctx.targetPath));
    ctx.response = await postAgentNote(ctx.bridge.port, ctx.authHeaders, {
      role: ctx.declaredRole,
      message: SHORT_NOTE,
    });
    ctx.responseBody = await ctx.response.json();
    ctx.bridge.stop();
  });

  scoped(/^the caller sends (.*) to a declared role$/, async (ctx, messageLabel) => {
    ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, bridgeOptions(ctx.targetPath));
    ctx.sentMessage = resolveExampleMessage(messageLabel);
    ctx.response = await postAgentNote(ctx.bridge.port, ctx.authHeaders, {
      role: ctx.declaredRole,
      message: ctx.sentMessage,
    });
    ctx.responseBody = await ctx.response.json();
    ctx.bridge.stop();
  });

  scoped(/^the caller sends a short note to a role the swarm does not declare$/, async (ctx) => {
    ctx.bridge = await startBridge(ctx.targetPath, path.join(ctx.targetPath, 'runs.jsonl'), TOKEN, bridgeOptions(ctx.targetPath));
    ctx.response = await postAgentNote(ctx.bridge.port, ctx.authHeaders, {
      role: 'ghost-role',
      message: SHORT_NOTE,
    });
    ctx.responseBody = await ctx.response.json();
    ctx.bridge.stop();
  });

  scoped(/^a note parcel is queued for that role at priority 00$/, (ctx) => {
    const parcels = listNoteParcels(ctx.targetPath);
    if (parcels.length <= ctx.noteBefore) {
      throw new Error('expected a new note parcel in the role mailbox');
    }
    const latest = parcels[parcels.length - 1];
    if (!latest.includes('priority: 00')) {
      throw new Error(`expected priority 00, got:\n${latest}`);
    }
    if (!latest.includes(`to: ${ctx.declaredRole}`)) {
      throw new Error(`expected parcel addressed to ${ctx.declaredRole}`);
    }
  });

  scoped(/^the response confirms the note was queued$/, (ctx) => {
    if (ctx.response.status !== 200 || !ctx.responseBody.success) {
      throw new Error(`expected success response, got ${ctx.response.status}: ${JSON.stringify(ctx.responseBody)}`);
    }
  });

  scoped(/^the queued parcel is distinguishable from a note the coordinator wrote$/, (ctx) => {
    const parcels = listNoteParcels(ctx.targetPath);
    const latest = parcels[parcels.length - 1];
    const messageLine = latest.split('\n').find((line) => line.startsWith('message: '));
    if (!messageLine || !isOperatorAttributedAgentNote(messageLine.slice('message: '.length))) {
      throw new Error(`expected Bubble attribution prefix on queued message:\n${latest}`);
    }
  });

  scoped(/^the bridge refuses it stating (.*)$/, (ctx, reasonFragment) => {
    if (ctx.response.status === 200 && ctx.responseBody.success) {
      throw new Error('expected refusal, got success');
    }
    const reason = String(ctx.responseBody.reason || ctx.responseBody.error || '');
    if (!reason.includes(reasonFragment)) {
      throw new Error(`expected reason containing "${reasonFragment}", got "${reason}"`);
    }
  });

  scoped(/^no note parcel is queued$/, (ctx) => {
    if (listNoteParcels(ctx.targetPath).length > ctx.noteBefore) {
      throw new Error('expected no new note parcel after refusal');
    }
    if (countTmpAgentNoteDrafts(ctx.targetPath) > ctx.draftsBefore) {
      throw new Error('expected no orphaned agent-note draft under tmp/');
    }
  });

  scoped(/^the request is rejected$/, (ctx) => {
    if (ctx.response.status === 200 && ctx.responseBody?.success) {
      throw new Error('expected rejected request');
    }
  });
}

module.exports = { registerSteps };

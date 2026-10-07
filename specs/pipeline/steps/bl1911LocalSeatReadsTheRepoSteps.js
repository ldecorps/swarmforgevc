'use strict';

// BL-1911 acceptance: the local seat reads the target repository each turn
// and the model sees what was read, never a secret.
//
// Every scenario drives the REAL runLocalSeatTurn and the REAL
// decideLocalSeatTurn (required_wiring) over a scratch git repository, with
// ONLY the model endpoint faked at the fetch layer - readLocalEndpoint and
// completeWithLocalModel are the real functions, called with an injected
// fetchFn that records every request body rather than hitting ollama. The
// repository read itself is never injected: runLocalSeatTurn's default
// searchRepo (searchRepoForQuestion scoped to the fixture root) is what each
// scenario exercises.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out', 'tools');
const { runLocalSeatTurn, readLocalEndpoint, completeWithLocalModel } = require(path.join(OUT, 'localQwenSeatLive'));
const { DEFAULT_LOCAL_SEAT_MODEL_ID } = require(path.join(OUT, 'localQwenSeat'));

const FEATURE = 'The local seat answers from what it reads in the repo';

const ENDPOINT = 'http://127.0.0.1:11434';
const SEAT_TOPIC = 41004;
const HOST_TOPIC = 8435;

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

// A fresh `git init` on a brand-new mkdtemp root establishes its own
// isolated .git itself (BL-1390) - there is no PRIOR git state here for a
// linked-worktree config to leak from. Proven, not merely asserted by
// comment: git-common-dir must resolve INSIDE this fixture root, exactly
// as bl1738/bl1853/bl1887's own fixtures prove it.
function initScratchRepo() {
  const root = trackedTmpRoot('bl1911-fixture-');
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  const commonDir = git(root, 'rev-parse', '--git-common-dir');
  assert.equal(
    path.resolve(root, commonDir),
    path.join(root, '.git'),
    `bl1911: git-common-dir did not resolve inside the fixture root, got "${commonDir}"`
  );
  return root;
}

// Records every request body the seat sends, keyed by which endpoint path
// it hit - never a real network call and never real ollama.
function fakeFetch(requests) {
  return async (url, init) => {
    if (url.endsWith('/api/tags')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ models: [{ name: DEFAULT_LOCAL_SEAT_MODEL_ID }] }) };
    }
    if (url.endsWith('/api/generate')) {
      requests.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ response: 'ok' }) };
    }
    throw new Error(`fakeFetch: unexpected url ${url}`);
  };
}

async function askSeat(ctx, text, topicId = SEAT_TOPIC) {
  const b = ctx.bl1911;
  b.posted = [];
  b.outcome = await runLocalSeatTurn({
    targetPath: b.root,
    topicId,
    seatTopicId: SEAT_TOPIC,
    text,
    post: async (tid, message) => b.posted.push({ topicId: tid, message }),
    readEndpoint: () => readLocalEndpoint(ENDPOINT, fakeFetch(b.requests)),
    complete: (modelId, prompt, endpointUrl, system) =>
      completeWithLocalModel(modelId, prompt, endpointUrl, fakeFetch(b.requests), system),
    modelId: DEFAULT_LOCAL_SEAT_MODEL_ID,
    // searchRepo is deliberately NOT injected: the real searchRepoForQuestion,
    // scoped to b.root by runLocalSeatTurn itself, is what this feature tests.
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a local seat fixture over a scratch git repository whose model endpoint is faked and records every request$/, (ctx) => {
    ctx.bl1911 = { root: initScratchRepo(), requests: [], posted: [] };
  });

  scoped(/^the scratch repository's backlog\/active\/ holds BL-9001 titled "the bridge restarts on a stale build"$/, (ctx) => {
    const dir = path.join(ctx.bl1911.root, 'backlog', 'active');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'BL-9001-the-bridge-restarts-on-a-stale-build.yaml'),
      'id: BL-9001\ntitle: "the bridge restarts on a stale build"\n'
    );
  });

  scoped(/^the scratch repository holds "(.+?)" containing "SECRET-TOKEN-1911"$/, (ctx, relPath) => {
    const full = path.join(ctx.bl1911.root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'SECRET-TOKEN-1911');
  });

  scoped(/^the operator asks the seat "what is BL-9001 about\?"$/, async (ctx) => {
    await askSeat(ctx, 'what is BL-9001 about?');
  });

  scoped(/^the operator asks the seat "show me (.+?)"$/, async (ctx, relPath) => {
    await askSeat(ctx, `show me ${relPath}`);
  });

  scoped(/^some request the seat sends to the model carries "(.+?)"$/, (ctx, expected) => {
    const hit = ctx.bl1911.requests.some((req) => JSON.stringify(req).includes(expected));
    assert.ok(hit, `no request carried "${expected}": ${JSON.stringify(ctx.bl1911.requests)}`);
  });

  scoped(/^no request the seat sends to the model carries "SECRET-TOKEN-1911"$/, (ctx) => {
    const leaked = ctx.bl1911.requests.some((req) => JSON.stringify(req).includes('SECRET-TOKEN-1911'));
    assert.ok(!leaked, `a request leaked the secret: ${JSON.stringify(ctx.bl1911.requests)}`);
  });

  scoped(/^the seat's repository root cannot be read$/, (ctx) => {
    // A path that was never created - ENOENT on read, never a chmod trick.
    ctx.bl1911.root = path.join(ctx.bl1911.root, 'does-not-exist');
  });

  scoped(/^the seat's reply is posted in its topic$/, (ctx) => {
    assert.equal(ctx.bl1911.outcome.kind, 'answer', JSON.stringify(ctx.bl1911.outcome));
    assert.ok(
      ctx.bl1911.posted.some((p) => p.topicId === SEAT_TOPIC && p.message === 'ok'),
      `expected the completion posted in the seat topic, got: ${JSON.stringify(ctx.bl1911.posted)}`
    );
  });

  scoped(/^the request the seat sends to the model says the repository could not be read$/, (ctx) => {
    const last = ctx.bl1911.requests[ctx.bl1911.requests.length - 1];
    assert.ok(last, 'no request reached the model at all');
    assert.match(last.prompt, /repository could not be read/);
  });

  scoped(/^a message arrives in the Host topic$/, async (ctx) => {
    if (!ctx.bl1911) {
      ctx.bl1911 = { root: initScratchRepo(), requests: [], posted: [] };
    }
    await askSeat(ctx, 'hello', HOST_TOPIC);
  });

  scoped(/^the local seat does not take the turn$/, (ctx) => {
    assert.deepEqual(ctx.bl1911.outcome, { kind: 'not-mine', posted: [] });
    assert.deepEqual(ctx.bl1911.requests, [], 'the local seat sent a request to the model from the Host topic');
  });
}

module.exports = { registerSteps };

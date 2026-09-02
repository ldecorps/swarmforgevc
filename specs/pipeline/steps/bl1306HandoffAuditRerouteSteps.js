'use strict';

// BL-1306: step handlers for "the handoff self-audit completes when
// required_stages reroutes the recipient".
//
// Drives the REAL swarmforge/scripts/swarm_handoff.bb end to end against a
// fixture project root that is its own git repository with its own
// .swarmforge/roles.tsv and its own mailboxes, so the live swarm's queues are
// never touched (the BL-1256 failure shape). Queued-ness is measured by what
// actually reached the mailbox, never by which success line the helper
// printed - that wording depends on whether a tmux inject succeeded, and a
// fixture has no socket.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HELPER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');
const FIXTURE_PREFIX = 'bl1306-acceptance-';
const ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator', 'specifier'];
const FULL_STAGES = '[coder, cleaner, architect, hardender, documenter, qa]';
const SKIPPING_STAGES = '[coder, qa]';

// BL-971 wants stale fixture roots swept BEFORE a run, because a killed run
// traps nothing. The sweep is AGE-GUARDED rather than prefix-only: scenarios
// run concurrently and this module can be loaded more than once in a run, so
// an unguarded prefix sweep deletes a sibling scenario's live root out from
// under it - which is a flake that reads as a missing file, not as a sweep.
const STALE_AFTER_MS = 10 * 60 * 1000;

function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // A root another scenario is removing right now is not this sweep's
      // business.
    }
  }
}

sweepStaleFixtures();

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function buildRoot(stages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');

  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-9306-fixture.yaml'),
    ['id: BL-9306', 'title: "audit reroute fixture"', 'human_approval: approved', `required_stages: ${stages}`, ''].join('\n'),
  );
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config required_stages_routing_enabled true\n');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'outbox'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    ROLES.map((r) => [r, r, root, `swarmforge-${r}`, r, 'claude', 'task', 'off', 'forward-only'].join('\t')).join('\n'),
  );
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'BL-9306: fixture work');
  return root;
}

function writeDraft(root, to) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().slice(0, 10);
  const file = path.join(root, 'handoff-draft.txt');
  fs.writeFileSync(
    file,
    ['type: git_handoff', `to: ${to}`, 'priority: 50', 'task: BL-9306-fixture', `commit: ${commit}`, ''].join('\n'),
  );
  return file;
}

function invoke(root, draft) {
  const r = spawnSync('bb', [HELPER, draft], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: 'coder' },
  });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

function queuedFiles(root) {
  const dirs = [
    path.join(root, '.swarmforge', 'handoffs', 'outbox'),
    path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'),
  ];
  return dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : []));
}

function state(ctx) {
  if (!ctx.bl1306) ctx.bl1306 = {};
  return ctx.bl1306;
}

const FEATURE = 'The handoff self-audit completes when required_stages reroutes the recipient';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^required_stages routing is enabled$/, (ctx) => {
    state(ctx).routingEnabled = true;
  });

  scoped(/^a forward git_handoff draft for a ticket whose required_stages (skips|keeps) the drafted recipient$/, (ctx, kind) => {
    const st = state(ctx);
    st.skipping = kind === 'skips';
    st.root = buildRoot(st.skipping ? SKIPPING_STAGES : FULL_STAGES);
    st.draft = writeDraft(st.root, 'cleaner');
  });

  scoped(/^a forward git_handoff draft for a ticket whose required_stages <declaration>$/, () => {
    throw new Error('unsubstituted Scenario Outline placeholder reached the handler');
  });

  scoped(/^the sender has already invoked the handoff helper once for that draft$/, (ctx) => {
    const st = state(ctx);
    st.firstDraftBytes = fs.readFileSync(st.draft);
    st.firstOutput = invoke(st.root, st.draft);
    assert.match(st.firstOutput, /AUDIT_REQUIRED/, `the first invocation did not challenge: ${st.firstOutput}`);
    assert.equal(queuedFiles(st.root).length, 0, 'the first invocation queued something');
  });

  scoped(/^the sender invokes the handoff helper once for that draft$/, (ctx) => {
    const st = state(ctx);
    st.output = invoke(st.root, st.draft);
  });

  scoped(/^the sender invokes the handoff helper again with an identical draft$/, (ctx) => {
    const st = state(ctx);
    // "Identical" is checked against what the FIRST call saw, before this
    // call runs: the helper deletes the draft once a handoff actually queues,
    // so reading it back afterwards would fail precisely on success.
    const before = fs.readFileSync(st.draft);
    assert.ok(
      st.firstDraftBytes && before.equals(st.firstDraftBytes),
      'the draft changed between the two invocations, so this is not the identical-draft case',
    );
    st.output = invoke(st.root, st.draft);
  });

  scoped(/^the sender edits the draft and invokes the handoff helper again$/, (ctx) => {
    const st = state(ctx);
    fs.appendFileSync(st.draft, '\n');
    st.output = invoke(st.root, st.draft);
  });

  scoped(/^the helper reports AUDIT_REQUIRED$/, (ctx) => {
    const st = state(ctx);
    assert.match(st.output, /AUDIT_REQUIRED/, `no challenge was printed: ${st.output}`);
  });

  scoped(/^no handoff is queued$/, (ctx) => {
    const st = state(ctx);
    assert.deepEqual(queuedFiles(st.root), [], `a handoff was queued: ${st.output}`);
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^the handoff is queued to (the routed stage|the drafted stage)$/, (ctx, which) => {
    const st = state(ctx);
    assert.doesNotMatch(st.output, /AUDIT_REQUIRED/, `the identical second call re-challenged: ${st.output}`);
    const queued = queuedFiles(st.root);
    assert.equal(queued.length, 1, `expected exactly one queued handoff, got ${JSON.stringify(queued)}`);
    // The recipient is in the filename, so this distinguishes the routed
    // stage from the drafted one rather than merely counting files.
    const expected = which === 'the routed stage' ? 'QA' : 'cleaner';
    assert.ok(
      queued[0].includes(`to_${expected}`) || queued[0].includes(expected),
      `queued to the wrong recipient: ${queued[0]} (expected ${expected})`,
    );
    fs.rmSync(st.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };

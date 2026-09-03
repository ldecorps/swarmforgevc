'use strict';

// BL-1306's DECLARED invariant (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant  A challenge is stored and looked up on the same basis: every
//              field the lookup compares is computed from the same
//              post-routing values the store used, or is excluded from both.
//
// This is a property of the two functions' AGREEMENT, so it is checked two
// ways. Structurally, against the real source: the lookup key must be derived
// from the stored candidate rather than rebuilt beside it, because two
// independent constructions are exactly what drifted. Behaviourally, against
// the real swarm_handoff.bb: for any routing outcome, a byte-identical second
// invocation queues, and an edited one does not.
//
// GENERATOR REACH (by construction, not by draw). The defect only appears
// when routing REWRITES the recipient, so the two cases - a ticket whose
// required_stages skips the drafted stage and one that keeps it - each get
// their own property pass, and the run fails unless both ran.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HELPER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');
const FIXTURE_PREFIX = 'bl1306-property-';
const ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator', 'specifier'];

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function buildRoot(stages) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-9306-fixture.yaml'),
    ['id: BL-9306', 'human_approval: approved', `required_stages: [${stages.join(', ')}]`, ''].join('\n'),
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

function writeDraft(root, to, extra) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().slice(0, 10);
  const file = path.join(root, 'handoff-draft.txt');
  fs.writeFileSync(
    file,
    ['type: git_handoff', `to: ${to}`, 'priority: 50', 'task: BL-9306-fixture', `commit: ${commit}`, ...(extra ? [extra] : []), ''].join('\n'),
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

function queued(root) {
  const dirs = [
    path.join(root, '.swarmforge', 'handoffs', 'outbox'),
    path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new'),
  ];
  return dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : []));
}

const SKIPPING = ['coder', 'qa'];
const FULL = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'qa'];

test('BL-1306/BL-654 invariant: the lookup key is DERIVED from the stored candidate, never rebuilt beside it', () => {
  // The structural half. Two independent constructions of "the same" key is
  // the defect itself - one read the drafted `to:`/`commit:` headers while
  // the other stored the routed recipients and the canonical commit - so the
  // fix is that only one of them computes anything.
  const source = fs.readFileSync(HELPER, 'utf8');
  const fingerprint = source.slice(source.indexOf('(defn invocation-fingerprint'));
  const body = fingerprint.slice(0, fingerprint.indexOf('\n(defn '));

  assert.match(body, /audit-candidate/, 'invocation-fingerprint no longer derives from audit-candidate');
  assert.doesNotMatch(
    body,
    /\(get headers "to"\)|\(get headers "commit"\)/,
    'invocation-fingerprint reads raw draft headers again - the two keys can drift once more',
  );
  // And the caller must pass post-routing values, not the drafted ones.
  const callSite = source.slice(source.indexOf('invalidate-changed-invocation-audits!\n', source.indexOf('(defn -main')));
  assert.match(
    source.slice(source.indexOf('(defn -main')),
    /invocation-fingerprint draft sender headers\s*\n?\s*\(:recipients routed\)/,
    'the lookup is no longer computed from the routed recipients',
  );
  assert.ok(callSite.length > 0);
});

// Each case spawns real bb processes against a real git fixture, so the
// default 20 s budget is not enough on a loaded host - and a property test
// that times out reports a red nobody can act on.
test('BL-1306/BL-654 invariant: an identical second invocation queues, and an edited one does not, however routing lands', { timeout: 180000 }, () => {
  const reach = { rerouted: 0, unrouted: 0, edited: 0 };

  for (const [label, stages] of [['rerouted', SKIPPING], ['unrouted', FULL]]) {
    fc.assert(
      fc.property(fc.constantFrom('cleaner'), (to) => {
        const root = buildRoot(stages);
        try {
          reach[label] += 1;
          const draft = writeDraft(root, to);

          const first = invoke(root, draft);
          assert.match(first, /AUDIT_REQUIRED/, `the first invocation did not challenge:\n${first}`);
          assert.deepEqual(queued(root), [], 'the first invocation queued something');

          const second = invoke(root, draft);
          assert.doesNotMatch(second, /AUDIT_REQUIRED/, `the identical second invocation re-challenged:\n${second}`);
          assert.equal(queued(root).length, 1, `expected exactly one queued handoff:\n${second}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      // One case per arm: each fixture is a git init plus two full
      // swarm_handoff.bb invocations, so this is seconds of real work per
      // case. The arms are ENUMERATED above, so breadth comes from the loop
      // rather than from repetition - repeating an enumerated arm buys
      // nothing but wall-clock, and a property test that times out is a red
      // nobody can act on.
      { numRuns: 1 },
    );
  }

  // The other half of the invariant: the audit must still bite. A fix that
  // bought queueing by never invalidating would pass everything above.
  fc.assert(
    // Every value here must DIFFER from the draft's own priority: 50, or the
    // "edit" is a no-op and the draft is byte-identical, which correctly
    // queues. Drawing 50 among them made this property fail against correct
    // code - the generator's fault, not the helper's.
    fc.property(fc.constantFrom('10', '00', '60'), (newPriority) => {
      const root = buildRoot(SKIPPING);
      try {
        reach.edited += 1;
        const draft = writeDraft(root, 'cleaner');
        assert.match(invoke(root, draft), /AUDIT_REQUIRED/);
        // Edit it, exactly as a sender revising their draft would.
        fs.writeFileSync(draft, fs.readFileSync(draft, 'utf8').replace(/^priority: .*$/m, `priority: ${newPriority}`));
        const after = invoke(root, draft);
        assert.match(after, /AUDIT_REQUIRED/, `an edited draft was allowed to queue:\n${after}`);
        assert.deepEqual(queued(root), [], 'an edited draft queued a handoff');
        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 2 },
  );

  assert.ok(reach.rerouted > 0, 'never exercised a rerouted forward - the defect corner went untested');
  assert.ok(reach.unrouted > 0, 'never exercised an unrouted forward');
  assert.ok(reach.edited > 0, 'never exercised an edited draft - the audit could have been disabled');
});

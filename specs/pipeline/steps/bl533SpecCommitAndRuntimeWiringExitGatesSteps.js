'use strict';

// BL-533: acceptance commit-tracking + multi-slice epic wiring exit gates.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-533 claimed deliverables are tracked and wired before close';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'backlog_hygiene_lib.bb');

function ensure(ctx) {
  if (!ctx.bl533) {
    ctx.bl533 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl533-')),
      tracking: null,
      wiringState: null,
      raw: '',
    };
    git(ctx.bl533.root, ['init', '-q', '-b', 'main']);
    git(ctx.bl533.root, ['-c', 'user.email=t@t', '-c', 'user.name=t',
      'commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.bl533;
}

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout || args.join(' '));
  return r;
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a paused ticket whose acceptance line points at a feature path that is (.+)$/, (ctx, tracking) => {
    const st = ensure(ctx);
    st.tracking = String(tracking || '').trim();
    const feat = 'specs/features/BL-533-fixture.feature';
    write(st.root, feat, 'Feature: fixture\n');
    write(st.root, 'backlog/paused/BL-533-fixture.yaml',
      `id: BL-533\ntitle: t\ntype: feature\nepic: e\nmilestone: M8\nacceptance: ${feat}\npriority: 1\n`);
    // Exact Examples cells — soft case mutants of tracking must not set up.
    if (st.tracking === 'tracked by git ls-files') {
      git(st.root, ['add', feat, 'backlog/paused/BL-533-fixture.yaml']);
      git(st.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'track']);
      return;
    }
    assert.equal(st.tracking, 'present on disk but not ls-files');
    git(st.root, ['add', 'backlog/paused/BL-533-fixture.yaml']);
    git(st.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'ticket-only']);
  });

  scoped(/^specifier_backlog_hygiene_gate runs on that ticket$/, (ctx) => {
    const st = ensure(ctx);
    const ticket = path.join(st.root, 'backlog/paused/BL-533-fixture.yaml');
    const script = `
(load-file "${LIB}")
(def text (slurp "${ticket}"))
(def vs (backlog-hygiene-lib/violations-for-text text
          {:id "BL-533" :path "backlog/paused/BL-533-fixture.yaml"
           :repo-root "${st.root}"}))
(def ut (filter #(= :untracked-acceptance (:kind %)) vs))
(println (str "EXIT=" (if (empty? ut) "0" "1")))
(doseq [v ut] (println (backlog-hygiene-lib/format-violation v)))
(when (empty? ut) (println "PASS_TRACKING"))
`;
    const r = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^the commit-tracking result for that acceptance path is (.+)$/, (ctx, result) => {
    const want = String(result || '').trim();
    const raw = ensure(ctx).raw;
    // Exact Examples cells — soft case/punctuation mutants must not pass.
    if (want === 'fail naming the untracked acceptance path') {
      assert.match(raw, /EXIT=1/);
      assert.match(raw, /UNTRACKED-ACCEPTANCE/);
      return;
    }
    assert.equal(want, 'pass');
    assert.match(raw, /EXIT=0/);
    assert.match(raw, /PASS_TRACKING/);
    assert.doesNotMatch(raw, /UNTRACKED-ACCEPTANCE/);
  });

  scoped(/^an epic tracker with at least two decomposes_into children$/, (ctx) => {
    ensure(ctx).epic = true;
  });

  scoped(/^none of those children declare a non-empty required_wiring list$/, (ctx) => {
    ensure(ctx).wiringState = 'none';
  });

  scoped(/^at least one child declares a non-empty required_wiring list$/, (ctx) => {
    ensure(ctx).wiringState = 'one';
  });

  scoped(/^the epic wiring exit checklist runs$/, (ctx) => {
    const st = ensure(ctx);
    const wired = st.wiringState === 'one';
    const childA = wired
      ? 'id: BL-1\nrequired_wiring: ["a.bb::fn"]\n'
      : 'id: BL-1\n';
    const childB = 'id: BL-2\n';
    const script = `
(load-file "${LIB}")
(def epic "id: BL-E\\ntype: epic\\ndecomposes_into: [BL-1, BL-2]\\n")
(def result (backlog-hygiene-lib/epic-wiring-exit-checklist epic
              [${JSON.stringify(childA)} ${JSON.stringify(childB)}]))
(println (str "OK=" (:ok? result)))
(when-not (:ok? result)
  (println (backlog-hygiene-lib/format-violation
            {:kind :epic-wiring-missing :id "BL-E" :path "e.yaml" :child-count 2})))
`;
    const r = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^the checklist (.+)$/, (ctx, outcome) => {
    const want = String(outcome || '').trim();
    const raw = ensure(ctx).raw;
    // Exact Examples cells — soft case mutants of outcome must die.
    if (want === 'fails saying a runtime-wiring declaration is missing') {
      assert.match(raw, /OK=false/);
      assert.match(raw, /runtime-wiring declaration is missing|EPIC-WIRING-MISSING/);
      return;
    }
    assert.equal(want, 'passes');
    assert.match(raw, /OK=true/);
  });
}

module.exports = { registerSteps };

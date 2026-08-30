'use strict';

// BL-1185 declared invariants (coder rematch after architect bounce).
// Quantifies Work-note difficulty attribution over generated note bodies.
// Non-vacuity (authoring):
//   P1/P2 — drop Work-message branch of task-name-from-content → fail.
//   P2 — force cost nil after attribution → hard :defer-better-fit (legacy).
//   P3 — allow task: on type:note in swarm_handoff validate → CLI accepts.
// Runs via npm run test:properties.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SUPERSEDE = path.join(SCRIPTS, 'supersede_lib.bb');
const SEAT = path.join(SCRIPTS, 'seat_difficulty_lib.bb');
const PIPELINE = path.join(SCRIPTS, 'pipeline_stage_lib.bb');
const SWARM_HANDOFF = path.join(SCRIPTS, 'swarm_handoff.bb');

function edn(loads, expr) {
  const loadForms = loads.map((p) => `(load-file ${JSON.stringify(p)})`).join(' ');
  const res = spawnSync(
    'bb',
    [
      '-e',
      `${loadForms} (require '[cheshire.core :as json]) (println (json/generate-string ${expr}))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  assert.equal(res.status, 0, res.stderr || res.stdout);
  return JSON.parse(res.stdout.trim());
}

function workNoteBody({ bl, slug, withTask }) {
  const taskLine = withTask ? `task: ${bl}-${slug}\n` : '';
  return (
    `from: coordinator\n` +
    `to: coder\n` +
    `priority: 00\n` +
    `type: note\n` +
    taskLine +
    `message: Work ${bl}-${slug}: ambulance patient\n` +
    `\n` +
    `body\n`
  );
}

const blArb = fc.integer({ min: 1000, max: 9999 }).map((n) => `BL-${n}`);
const slugArb = fc
  .array(fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z', '1', '2'), {
    minLength: 3,
    maxLength: 10,
  })
  .map((chars) => chars.join(''));

function mkHandoffFixture() {
  const root = mkTmpDir('bl1185-prop-');
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const roles = ['specifier', 'coordinator', 'coder', 'coder@sonnet2'];
  for (const r of roles) {
    fs.mkdirSync(path.join(root, r.replace('@', '-')), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    roles
      .map(
        (r) =>
          `${r}\t${r.replace('@', '-')}-wt\t${path.join(root, r.replace('@', '-'))}\tswarmforge-${r}\t${r}\tclaude\ttask`
      )
      .join('\n') + '\n'
  );
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    [
      'window coder claude coder --model claude-fable-5 --seat-tier hard',
      'window coder@sonnet2 claude coder-sonnet2 --model claude-sonnet-5 --seat-tier easy',
      '',
    ].join('\n')
  );
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed']);
  return root;
}

function fixtureEnv(root, role) {
  return {
    PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    SWARMFORGE_ROLE: role,
    SWARMFORGE_SKIP_DAEMON: '1',
  };
}

test('BL-1185 P1: Work notes resolve task name when task: is absent', () => {
  let reached = 0;
  fc.assert(
    fc.property(blArb, slugArb, (bl, slug) => {
      reached += 1;
      const content = workNoteBody({ bl, slug, withTask: false });
      const task = edn(
        [SUPERSEDE],
        `(supersede-lib/task-name-from-content ${JSON.stringify(content)})`
      );
      assert.equal(task, `${bl}-${slug}`);
      const headers = edn(
        [SUPERSEDE],
        `(supersede-lib/parse-headers ${JSON.stringify(content)})`
      );
      assert.equal(headers.task, undefined);
    }),
    { numRuns: 24 }
  );
  assert.ok(reached >= 8);
});

test(
  'BL-1185 P2: high-cost Work note without task: is claimable by hard (not defer-better-fit)',
  () => {
    let reached = 0;
    const root = mkHandoffFixture();
    try {
      fc.assert(
        fc.property(blArb, slugArb, (bl, slug) => {
          reached += 1;
          const content = workNoteBody({ bl, slug, withTask: false });
          const yamlPath = path.join(root, 'backlog', 'active', `${bl}.yaml`);
          fs.writeFileSync(
            yamlPath,
            `id: ${bl}\ntitle: ambulance patient\nstatus: active\nmutation_cost: high\n`
          );
          const resolved = edn(
            [SUPERSEDE, PIPELINE, SEAT],
            `(let [task (supersede-lib/task-name-from-content ${JSON.stringify(content)})
                  tid (pipeline-stage-lib/extract-ticket-id task)
                  yaml (slurp ${JSON.stringify(yamlPath)})
                  cost (seat-difficulty-lib/parse-mutation-cost yaml)
                  decision (seat-difficulty-lib/difficulty-claim-decision
                            {:me "coder"
                             :my-tier "hard"
                             :cost cost
                             :stage "coder"
                             :tiers {"coder" "hard" "coder@sonnet2" "easy"}
                             :sibling-states [{:role "coder@sonnet2" :tier "easy" :busy? false}
                                              {:role "coder" :tier "hard" :busy? false}]})
                  nil-decision (seat-difficulty-lib/difficulty-claim-decision
                                {:me "coder"
                                 :my-tier "hard"
                                 :cost nil
                                 :stage "coder"
                                 :tiers {"coder" "hard" "coder@sonnet2" "easy"}
                                 :sibling-states [{:role "coder@sonnet2" :tier "easy" :busy? false}
                                                  {:role "coder" :tier "hard" :busy? false}]})]
              {:task task :tid tid :cost cost
               :decision (name decision) :nil-decision (name nil-decision)})`
          );
          assert.equal(resolved.task, `${bl}-${slug}`);
          assert.equal(resolved.tid, bl);
          assert.equal(resolved.cost, 'high');
          assert.equal(resolved.decision, 'claim');
          assert.equal(resolved['nil-decision'], 'defer-better-fit');
        }),
        { numRuns: 16 }
      );
      assert.ok(reached >= 6);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1185 P3: task: remains git_handoff-only — Work notes stay type:note; swarm_handoff refuses task on notes',
  () => {
    let reached = 0;
    const root = mkHandoffFixture();
    const coord = path.join(root, 'coordinator');
    try {
      fc.assert(
        fc.property(blArb, slugArb, (bl, slug) => {
          reached += 1;
          const clean = workNoteBody({ bl, slug, withTask: false });
          assert.match(clean, /^type: note$/m);
          assert.equal(/\ntask:/m.test(clean), false);
          assert.ok(
            edn([SUPERSEDE], `(supersede-lib/task-name-from-content ${JSON.stringify(clean)})`) ===
              `${bl}-${slug}`
          );

          const draft = path.join(coord, `d-illegal-${bl}-${slug}.txt`);
          fs.writeFileSync(
            draft,
            `type: note\nto: coder\npriority: 10\ntask: ${bl}-${slug}\nmessage: Work ${bl}-${slug}\n`
          );
          const res = spawnSync('bb', [SWARM_HANDOFF, draft], {
            cwd: coord,
            encoding: 'utf8',
            timeout: 60000,
            env: fixtureEnv(root, 'coordinator'),
          });
          assert.notEqual(res.status, 0, `expected refuse; out=${res.stdout}${res.stderr}`);
          assert.match(`${res.stdout}${res.stderr}`, /task.*only allowed for git_handoff/i);
        }),
        { numRuns: 8 }
      );
      assert.ok(reached >= 4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

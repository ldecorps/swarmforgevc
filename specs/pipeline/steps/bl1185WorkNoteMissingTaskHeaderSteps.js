'use strict';

// BL-1185: Work notes without task: still attribute mutation_cost via
// supersede_lib/task-name-from-content (message Work BL-…), so hard seats
// do not :defer-better-fit solely because task was nil.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE =
  'Work notes attribute mutation cost from Work BL message when task header is absent';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const HARD = 'coder';
const EASY = 'coder@sonnet2';
const STAGE = 'coder';
const PATIENT = 'BL-1174';
const PATIENT_SLUG = 'BL-1174-deprecate-operator-verbs-scan-docs';

function seatDir(root, role) {
  return path.join(root, role.replace('@', '-'));
}

function writeConf(root) {
  const dir = path.join(root, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'swarmforge.conf'),
    [
      `window ${HARD} claude coder --model claude-fable-5 --seat-tier hard`,
      `window ${EASY} claude coder-sonnet2 --model claude-sonnet-5 --seat-tier easy`,
      '',
    ].join('\n')
  );
}

function mkFixture(ctx) {
  const root = mkSocketFixtureRoot('bl1185-acc-');
  ctx.root = root;
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const roles = ['specifier', 'coordinator', HARD, EASY];
  for (const r of roles) {
    fs.mkdirSync(seatDir(root, r), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    roles.map((r) => `${r}\t${r.replace('@', '-')}-wt\t${seatDir(root, r)}\tswarmforge-${r}\t${r}\tclaude\ttask`).join('\n') + '\n'
  );
  writeConf(root);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed']);
  ctx.commit = git(['rev-parse', '--short=10', 'HEAD']).trim();
}

function fixtureEnv(root, role) {
  return {
    PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    SWARMFORGE_ROLE: role,
  };
}

function writePatientTicket(ctx, cost = 'high') {
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${PATIENT}.yaml`),
    `id: ${PATIENT}\ntitle: deprecate probe\nstatus: active\nmutation_cost: ${cost}\n`
  );
}

function inboxNew(ctx, role) {
  return path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'new');
}

function inboxInProcess(ctx, role) {
  return path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function placeWorkNote(ctx, role, message) {
  const dir = inboxNew(ctx, role);
  fs.mkdirSync(dir, { recursive: true });
  const name = `10_work_${Date.now()}.handoff`;
  // Body after the blank line is required (BL-365 corrupt-handoff).
  const body = [
    'id: work-note-probe',
    'from: coordinator',
    `to: ${STAGE}`,
    `recipient: ${role}`,
    'priority: 10',
    'type: note',
    `message: ${message}`,
    '',
    message,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, name), body);
  ctx.workNotePath = path.join(dir, name);
  ctx.workNoteMessage = message;
  return ctx.workNotePath;
}

function placePlainNote(ctx, role, message) {
  const dir = inboxNew(ctx, role);
  fs.mkdirSync(dir, { recursive: true });
  const name = `50_plain_${Date.now()}.handoff`;
  const body = [
    'id: plain-note-probe',
    'from: coordinator',
    `to: ${STAGE}`,
    `recipient: ${role}`,
    'priority: 50',
    'type: note',
    `message: ${message}`,
    '',
    message,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, name), body);
  ctx.plainNotePath = path.join(dir, name);
  return ctx.plainNotePath;
}

function poll(ctx, role) {
  return spawnSync('bb', [path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')], {
    cwd: seatDir(ctx.root, role),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, role),
  });
}

function listHandoffs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
}

function holdsWorkNote(ctx, role) {
  const d = inboxInProcess(ctx, role);
  for (const f of listHandoffs(d)) {
    const text = fs.readFileSync(path.join(d, f), 'utf8');
    if (text.includes(`message: Work ${PATIENT_SLUG}`) || text.includes(`Work ${PATIENT}`)) {
      return true;
    }
  }
  return false;
}

function resolveCostViaBb(ctx, handoffPath) {
  // Drive the same attribution chain ready_for_next_task uses: task-name
  // from content, then extract ticket id, then parse mutation_cost from yaml.
  const script = `
(load-file "${path.join(SCRIPTS_DIR, 'supersede_lib.bb')}")
(load-file "${path.join(SCRIPTS_DIR, 'pipeline_stage_lib.bb')}")
(load-file "${path.join(SCRIPTS_DIR, 'seat_difficulty_lib.bb')}")
(let [content (slurp "${handoffPath}")
      task (supersede-lib/task-name-from-content content)
      tid (pipeline-stage-lib/extract-ticket-id task)
      yaml (when tid
             (let [p (str "${ctx.root}/backlog/active/" tid ".yaml")]
               (when (.exists (java.io.File. p)) (slurp p))))
      cost (seat-difficulty-lib/parse-mutation-cost yaml)]
  (println (str "{\\"task\\":"
                (if task (str "\\"" task "\\"") "null")
                ",\\"tid\\":"
                (if tid (str "\\"" tid "\\"") "null")
                ",\\"cost\\":"
                (if cost (str "\\"" cost "\\"") "null")
                "}")))
`;
  const res = spawnSync('bb', ['-e', script], {
    cwd: ctx.root,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(res.status, 0, `cost resolve failed: ${res.stdout}${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

function claimDecisionViaBb(ctx, handoffPath) {
  const script = `
(load-file "${path.join(SCRIPTS_DIR, 'handoff_lib.bb')}")
(load-file "${path.join(SCRIPTS_DIR, 'seat_difficulty_lib.bb')}")
(load-file "${path.join(SCRIPTS_DIR, 'pipeline_stage_lib.bb')}")
(load-file "${path.join(SCRIPTS_DIR, 'supersede_lib.bb')}")
(load-file "${path.join(SCRIPTS_DIR, 'backlog_depth_lib.bb')}")
(def handoff-file (java.nio.file.Paths/get "${handoffPath}" (into-array String [])))
(defn task-name-for-difficulty [hf]
  (or (not-empty (handoff-lib/header-field hf "task"))
      (try (supersede-lib/task-name-from-content (slurp (str hf)))
           (catch Exception _ nil))))
(defn mutation-cost-for-task [task]
  (let [tid (pipeline-stage-lib/extract-ticket-id task)
        yaml (when tid
               (let [p (str "${ctx.root}/backlog/active/" tid ".yaml")]
                 (when (.exists (java.io.File. p)) (slurp p))))]
    (seat-difficulty-lib/parse-mutation-cost yaml)))
(let [task (task-name-for-difficulty handoff-file)
      cost (mutation-cost-for-task task)
      decision (seat-difficulty-lib/difficulty-claim-decision
                {:me "${HARD}"
                 :my-tier "hard"
                 :cost cost
                 :stage "${STAGE}"
                 :tiers {"${HARD}" "hard" "${EASY}" "easy"}
                 :sibling-states [{:role "${EASY}" :tier "easy" :busy? false}
                                  {:role "${HARD}" :tier "hard" :busy? false}]})]
  (println (str "{\\"task\\":"
                (if task (str "\\"" task "\\"") "null")
                ",\\"cost\\":"
                (if cost (str "\\"" cost "\\"") "null")
                ",\\"decision\\":\\"" (name decision) "\\"}")))
`;
  const res = spawnSync('bb', ['-e', script], {
    cwd: seatDir(ctx.root, HARD),
    encoding: 'utf8',
    timeout: 30000,
    env: fixtureEnv(ctx.root, HARD),
  });
  assert.equal(res.status, 0, `claim decision failed: ${res.stdout}${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^BL-1001 seat difficulty routing is in force$/, (ctx) => {
    mkFixture(ctx);
  });

  scoped(/^an ambulance is engaged on a high mutation cost ticket$/, (ctx) => {
    writePatientTicket(ctx, 'high');
    ctx.ambulanceEngaged = true;
  });

  scoped(/^a note whose message is Work BL-1174-deprecate-operator-verbs-scan-docs$/, (ctx) => {
    placeWorkNote(ctx, HARD, `Work ${PATIENT_SLUG}`);
  });

  scoped(/^the note has no task header$/, (ctx) => {
    const p = ctx.workNotePath || ctx.plainNotePath;
    assert.ok(p, 'expected a placed note');
    const text = fs.readFileSync(p, 'utf8');
    assert.equal(/\ntask:/m.test(text), false, 'note must not carry task:');
  });

  scoped(/^that ticket yaml declares mutation cost high$/, (ctx) => {
    writePatientTicket(ctx, 'high');
  });

  scoped(/^the hard coder seat evaluates whether it may claim the note$/, (ctx) => {
    ctx.decision = claimDecisionViaBb(ctx, ctx.workNotePath);
  });

  scoped(/^the claim path treats the cost as high$/, (ctx) => {
    assert.equal(ctx.decision.cost, 'high', `got ${JSON.stringify(ctx.decision)}`);
  });

  scoped(/^the decision is not defer-better-fit solely because task was nil$/, (ctx) => {
    assert.notEqual(ctx.decision.decision, 'defer-better-fit');
    assert.equal(ctx.decision.decision, 'claim');
  });

  scoped(/^ambulance is engaged on BL-1174$/, (ctx) => {
    writePatientTicket(ctx, 'high');
    ctx.ambulanceEngaged = true;
  });

  scoped(/^a Work note for BL-1174 sits in the hard coder inbox new$/, (ctx) => {
    placeWorkNote(ctx, HARD, `Work ${PATIENT_SLUG}`);
  });

  scoped(/^the easy coder sibling is idle$/, () => {
    /* default — no occupy */
  });

  scoped(/^BL-1174 declares mutation cost high$/, (ctx) => {
    writePatientTicket(ctx, 'high');
  });

  scoped(/^the hard seat runs ready for next$/, (ctx) => {
    ctx.pollHard = poll(ctx, HARD);
  });

  scoped(/^the Work note is claimed rather than skipped as defer-better-fit$/, (ctx) => {
    assert.ok(
      holdsWorkNote(ctx, HARD),
      `hard should claim Work note; out=${ctx.pollHard.stdout} err=${ctx.pollHard.stderr} new=${listHandoffs(inboxNew(ctx, HARD))} in_process=${listHandoffs(inboxInProcess(ctx, HARD))}`
    );
    assert.equal(holdsWorkNote(ctx, EASY), false);
  });

  scoped(/^the seat does not print NO_TASK solely for nil task cost$/, (ctx) => {
    assert.equal(/\bNO_TASK\b/.test(ctx.pollHard.stdout || ''), false, ctx.pollHard.stdout);
  });

  scoped(/^the coordinator promote or Work route emits a note for a ticket$/, (ctx) => {
    if (!ctx.root) mkFixture(ctx);
    writePatientTicket(ctx, 'high');
    const draft = path.join(seatDir(ctx.root, 'coordinator'), 'd-work-note.txt');
    fs.writeFileSync(
      draft,
      `type: note\nto: ${STAGE}\npriority: 10\nmessage: Work ${PATIENT_SLUG}: read file in backlog/active\n`
    );
    ctx.emit = spawnSync('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
      cwd: seatDir(ctx.root, 'coordinator'),
      encoding: 'utf8',
      timeout: 60000,
      env: fixtureEnv(ctx.root, 'coordinator'),
    });
    assert.equal(ctx.emit.status, 0, `emit failed: ${ctx.emit.stdout}${ctx.emit.stderr}`);
    const sentDir = path.join(seatDir(ctx.root, 'coordinator'), '.swarmforge', 'handoffs', 'sent');
    const hardNew = inboxNew(ctx, HARD);
    const candidates = [
      ...listHandoffs(hardNew).map((f) => path.join(hardNew, f)),
      ...(fs.existsSync(sentDir)
        ? listHandoffs(sentDir).map((f) => path.join(sentDir, f))
        : []),
    ];
    assert.ok(candidates.length > 0, 'expected emitted note on stage queue or sent');
    ctx.emittedNote = fs.readFileSync(candidates[0], 'utf8');
  });

  scoped(/^the handoff type is note$/, (ctx) => {
    assert.match(ctx.emittedNote, /^type:\s*note$/m);
  });

  scoped(/^the note does not carry a task header$/, (ctx) => {
    assert.equal(/\ntask:/m.test(ctx.emittedNote), false);
  });

  scoped(/^swarm_handoff still refuses task on notes as git_handoff-only$/, (ctx) => {
    const draft = path.join(seatDir(ctx.root, 'coordinator'), 'd-illegal-task.txt');
    fs.writeFileSync(
      draft,
      `type: note\nto: ${STAGE}\npriority: 10\ntask: ${PATIENT_SLUG}\nmessage: Work ${PATIENT_SLUG}\n`
    );
    const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
      cwd: seatDir(ctx.root, 'coordinator'),
      encoding: 'utf8',
      timeout: 60000,
      env: fixtureEnv(ctx.root, 'coordinator'),
    });
    assert.notEqual(res.status, 0, 'expected refuse');
    assert.match(`${res.stdout}${res.stderr}`, /task.*only allowed for git_handoff/i);
  });

  scoped(/^a note with no task header and a message that is not a Work BL route$/, (ctx) => {
    if (!ctx.root) mkFixture(ctx);
    placePlainNote(ctx, HARD, 'Hold seat busy — ops pin');
  });

  scoped(/^mutation cost is resolved for seat difficulty$/, (ctx) => {
    ctx.resolved = resolveCostViaBb(ctx, ctx.plainNotePath);
  });

  scoped(/^the cost remains unset$/, (ctx) => {
    assert.equal(ctx.resolved.cost, null);
    assert.equal(ctx.resolved.task, null);
  });

  scoped(/^existing defer-better-fit behaviour for truly unattributed notes is unchanged$/, (ctx) => {
    const decision = claimDecisionViaBb(ctx, ctx.plainNotePath);
    // nil cost + idle easy sibling ⇒ hard defers (BL-1001 unchanged)
    assert.equal(decision.cost, null);
    assert.equal(decision.decision, 'defer-better-fit');
  });
}

module.exports = { registerSteps };

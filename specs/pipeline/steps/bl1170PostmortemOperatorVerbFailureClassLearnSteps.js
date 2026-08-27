'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'postmortem operator verb closes the disaster recovery learn loop';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT = path.join(REPO_ROOT, 'extension');
const SWEEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitterd_sweep_lib.bb');

function loadBb(file) {
  return file.replace(/\\/g, '\\\\');
}

function runBbEval(code) {
  return execFileSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
}

function ensure(ctx) {
  if (!ctx.bl1170) ctx.bl1170 = {};
  return ctx.bl1170;
}

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl1170-'));
}

function writeJson(root, rel, value) {
  const filePath = path.join(root, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function cascadeFindings() {
  return [
    { key: 'handoffd', severity: 'CRIT', message: 'handoffd.bb not running' },
    { key: 'swarm-starved', severity: 'CRIT', message: 'SWARM STARVED streak=3' },
    { key: 'proc-coder', severity: 'CRIT', message: 'half-launch/exit' },
    { key: 'proc-cleaner', severity: 'CRIT', message: 'half-launch/exit' },
    { key: 'proc-architect', severity: 'CRIT', message: 'half-launch/exit' },
  ];
}

function seedStarvationIncident(root) {
  writeJson(root, '.swarmforge/incidents/disaster-incidents.json', [
    {
      id: 'inc-starvation-01',
      status: 'cleared',
      opened_at: '2026-08-27T10:00:00Z',
      cleared_at: '2026-08-27T10:30:00Z',
      failure_class: 'starvation-cascade',
      correlated_keys: ['handoffd', 'swarm-starved', 'proc-coder', 'proc-cleaner', 'proc-architect'],
      evidence_paths: ['.swarmforge/daemon/handoffd.log', '.swarmforge/babysitterd/streak'],
      postmortem_key: 'starvation-cascade:20260827T100000Z',
    },
  ]);
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.log'), 'handoffd down\n', 'utf8');
}

function seedParseIncident(root) {
  writeJson(root, '.swarmforge/incidents/disaster-incidents.json', [
    {
      id: 'inc-parse-01',
      status: 'cleared',
      opened_at: '2026-08-27T11:00:00Z',
      cleared_at: '2026-08-27T11:05:00Z',
      failure_class: 'handoffd-parse-dead',
      handoffd_startup_error: 'Parse error at line 42',
      evidence_paths: ['.swarmforge/daemon/handoffd.log'],
      postmortem_key: 'handoffd-parse-dead:20260827T110000Z',
    },
  ]);
}

function runPostmortem(root) {
  const { runOperatorPostmortem } = require(path.join(EXT, 'out', 'tools', 'operatorPostmortem'));
  return runOperatorPostmortem(root, undefined, { nowMs: Date.parse('2026-08-27T12:00:00Z') });
}

function registerSteps(registry) {
  const scoped = (pattern, fn) => registry.defineScoped(pattern, fn, FEATURE);

  scoped(/^the shared operator verb backend from BL-698$/, () => {});

  scoped(/^a recent cleared disaster incident with evidence in runtime logs$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkRoot();
    seedStarvationIncident(st.root);
  });

  scoped(/^the operator runs postmortem$/, (ctx) => {
    const st = ensure(ctx);
    st.result = runPostmortem(st.root);
  });

  scoped(/^a qualified record names failure_class and likely causes$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.result.outcome, 'ok');
    const record = readJson(st.root, `.swarmforge/operator/postmortem-records/${st.result.qualified.incident_id}.json`);
    assert.equal(record.failure_class, 'starvation-cascade');
    assert.ok(Array.isArray(record.likely_causes) && record.likely_causes.length > 0);
  });

  scoped(/^the babysitter failure-class registry is updated$/, (ctx) => {
    const st = ensure(ctx);
    const registry = readJson(st.root, '.swarmforge/babysitter/failure-classes.json');
    assert.ok(registry.classes['starvation-cascade']);
    assert.ok(registry.classes['starvation-cascade'].correlated_keys.length > 0);
  });

  scoped(/^the operator playbook is updated$/, (ctx) => {
    const st = ensure(ctx);
    const playbook = readJson(st.root, '.swarmforge/operator/failure-class-playbooks.json');
    assert.ok(playbook['starvation-cascade']);
    assert.ok(Array.isArray(playbook['starvation-cascade'].suggested_actions));
  });

  scoped(/^an INTAKE disaster stub is written under backlog$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.result.outcome, 'ok');
    assert.ok(fs.existsSync(path.join(st.root, st.result.intakePath)));
    const body = fs.readFileSync(path.join(st.root, st.result.intakePath), 'utf8');
    assert.match(body, /INTAKE — disaster learn stub/);
    assert.match(body, /starvation-cascade/);
  });

  scoped(/^the failure-class registry and playbook were updated by a prior postmortem$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkRoot();
    seedStarvationIncident(st.root);
    const prior = runPostmortem(st.root);
    assert.equal(prior.outcome, 'ok');
    writeJson(st.root, '.swarmforge/operator/failure-class-playbooks.json', {
      'starvation-cascade': {
        suggested_actions: [{ action: 'custom playbook action from postmortem', owner: 'operator' }],
        summary: 'learned playbook',
        updated_at: '2026-08-27T12:00:00Z',
      },
    });
  });

  scoped(/^the same failure class fires again$/, (ctx) => {
    const st = ensure(ctx);
    const out = runBbEval(`
(require '[cheshire.core :as json])
(load-file "${loadBb(SWEEP_LIB)}")
(def findings [{:key "handoffd" :severity "CRIT" :message "down"}
                {:key "swarm-starved" :severity "CRIT" :message "starved"}
                {:key "proc-coder" :severity "CRIT" :message "half-launch/exit"}
                {:key "proc-cleaner" :severity "CRIT" :message "half-launch/exit"}
                {:key "proc-architect" :severity "CRIT" :message "half-launch/exit"}])
(def prepared (babysitterd-sweep-lib/prepare-escalation-findings findings {:repo-root ${JSON.stringify(st.root)}}))
(println (json/generate-string {:prepared prepared}))
`);
    st.sweep = JSON.parse(out.trim());
  });

  scoped(/^the next escalation names playbook suggested actions$/, (ctx) => {
    const actions = ctx.bl1170.sweep.prepared[0]['disaster-class'].suggested_actions;
    assert.ok(actions.some((a) => /custom playbook action from postmortem/.test(a.action)));
  });

  scoped(/^babysitter emits one disaster-class finding instead of many symptom lines$/, (ctx) => {
    assert.equal(ctx.bl1170.sweep.prepared.length, 1);
    assert.equal(ctx.bl1170.sweep.prepared[0].key, 'disaster-class');
  });

  scoped(/^no disaster incident within the lookback window$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkRoot();
    writeJson(st.root, '.swarmforge/incidents/disaster-incidents.json', []);
  });

  scoped(/^the verb refuses with nothing to postmortem$/, (ctx) => {
    assert.equal(ensure(ctx).result.outcome, 'refused');
    assert.match(ensure(ctx).result.reason, /nothing to postmortem/i);
  });

  scoped(/^no registry or intake stub is written$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(!fs.existsSync(path.join(st.root, '.swarmforge/babysitter/failure-classes.json')));
    const backlog = path.join(st.root, 'backlog');
    if (fs.existsSync(backlog)) {
      assert.equal(fs.readdirSync(backlog).filter((n) => n.startsWith('INTAKE-disaster-')).length, 0);
    }
  });

  scoped(/^a cleared incident whose root cause was an unrecoverable parse error$/, (ctx) => {
    const st = ensure(ctx);
    st.root = mkRoot();
    seedParseIncident(st.root);
  });

  scoped(/^the playbook says human hotfix is required$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.result.outcome, 'ok');
    const playbook = readJson(st.root, '.swarmforge/operator/failure-class-playbooks.json');
    assert.equal(playbook['handoffd-parse-dead'].human_hotfix_required, true);
    assert.ok(
      playbook['handoffd-parse-dead'].suggested_actions.some((a) => /human hotfix/i.test(a.action))
    );
  });

  scoped(/^the babysitter registry still records the failure class for recognition$/, (ctx) => {
    const st = ensure(ctx);
    const registry = readJson(st.root, '.swarmforge/babysitter/failure-classes.json');
    assert.ok(registry.classes['handoffd-parse-dead']);
  });
}

module.exports = { registerSteps };

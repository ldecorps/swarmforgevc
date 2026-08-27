'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'disaster-class correlation produces one structured escalation';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');
const CHASE_LIB = path.join(SCRIPTS, 'chase_sweep_lib.bb');

function loadBb(file) {
  return file.replace(/\\/g, '\\\\');
}

function runBbEval(code) {
  return execFileSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 30000 });
}

function cascadeFindings() {
  return [
    { key: 'handoffd', severity: 'CRIT', message: 'handoffd.bb not running' },
    { key: 'swarm-starved', severity: 'CRIT', message: 'SWARM STARVED streak=3' },
    { key: 'proc-coder', severity: 'CRIT', message: 'pane alive but NO claude (half-launch/exit)' },
    { key: 'proc-cleaner', severity: 'CRIT', message: 'pane alive but NO claude (half-launch/exit)' },
    { key: 'proc-architect', severity: 'CRIT', message: 'pane alive but NO claude (half-launch/exit)' },
  ];
}

function runCascadeSweep(ctx) {
  const out = runBbEval(`
(require '[cheshire.core :as json])
(load-file "${loadBb(SWEEP_LIB)}")
(def findings [{:key "handoffd" :severity "CRIT" :message "handoffd down"}
                {:key "swarm-starved" :severity "CRIT" :message "starved"}
                {:key "proc-coder" :severity "CRIT" :message "half-launch/exit"}
                {:key "proc-cleaner" :severity "CRIT" :message "half-launch/exit"}
                {:key "proc-architect" :severity "CRIT" :message "half-launch/exit"}])
(def prepared (babysitterd-sweep-lib/prepare-escalation-findings findings {}))
(def decided (babysitterd-sweep-lib/decide-escalations prepared
              {:last-escalated-ms-by-key {} :now-ms 100000 :cooldown-ms 1800000}))
(println (json/generate-string {:prepared prepared :toEscalate (:to-escalate decided) :repairsSuppressed false}))
`);
  ctx.bl1171Sweep = JSON.parse(out.trim());
}

function runParseErrorSweep(ctx) {
  const out = runBbEval(`
(require '[cheshire.core :as json])
(load-file "${loadBb(SWEEP_LIB)}")
(def findings [])
(def snapshot {:handoffd-startup-error "Parse error at line 42"
               :handoffd-log-path ".swarmforge/daemon/handoffd.log"})
(def prepared (babysitterd-sweep-lib/prepare-escalation-findings findings snapshot))
(def decided (babysitterd-sweep-lib/decide-escalations prepared
              {:last-escalated-ms-by-key {} :now-ms 100000 :cooldown-ms 1800000}))
(def repairs-suppressed (babysitterd-sweep-lib/diagnose-only-disaster-sweep? findings snapshot))
(println (json/generate-string {:prepared prepared :toEscalate (:to-escalate decided) :repairsSuppressed repairs-suppressed}))
`);
  ctx.bl1171Sweep = JSON.parse(out.trim());
}

function registerSteps(registry) {
  const scoped = (pattern, fn) => registry.defineScoped(pattern, fn, FEATURE);

  scoped(/^babysitterd checks report multiple correlated findings in one sweep$/, (ctx) => {
    ctx.bl1171Findings = cascadeFindings();
    ctx.bl1171Snapshot = {};
  });

  scoped(/^handoffd is down and at least three roles are half-launch and the swarm is starved$/, (ctx) => {
    ctx.bl1171Findings = cascadeFindings();
    ctx.bl1171Snapshot = {};
  });

  scoped(/^handoffd fails startup with a parse error in the log$/, (ctx) => {
    ctx.bl1171Mode = 'parse-error';
  });

  scoped(/^the babysitter sweep completes$/, (ctx) => {
    if (ctx.bl1171Mode === 'parse-error') {
      runParseErrorSweep(ctx);
    } else {
      runCascadeSweep(ctx);
    }
  });

  scoped(/^exactly one disaster-class escalation is emitted for the incident window$/, (ctx) => {
    assert.equal(ctx.bl1171Sweep.toEscalate.length, 1);
    assert.equal(ctx.bl1171Sweep.toEscalate[0].key, 'disaster-class');
  });

  scoped(/^the escalation carries failure_class starvation-cascade$/, (ctx) => {
    assert.equal(ctx.bl1171Sweep.toEscalate[0]['disaster-class'].failure_class, 'starvation-cascade');
  });

  scoped(/^the escalation carries suggested_actions with an owner for each action$/, (ctx) => {
    const actions = ctx.bl1171Sweep.toEscalate[0]['disaster-class'].suggested_actions;
    assert.ok(Array.isArray(actions) && actions.length > 0);
    for (const action of actions) {
      assert.ok(action.owner, `missing owner on ${JSON.stringify(action)}`);
      assert.ok(action.action, `missing action on ${JSON.stringify(action)}`);
    }
  });

  scoped(/^the escalation carries evidence_paths under swarmforge runtime$/, (ctx) => {
    const paths = ctx.bl1171Sweep.toEscalate[0]['disaster-class'].evidence_paths;
    assert.ok(paths.every((p) => p.startsWith('.swarmforge/')));
  });

  scoped(/^the escalation names the log path and human hotfix required$/, (ctx) => {
    const finding = ctx.bl1171Sweep.toEscalate[0];
    assert.match(finding.message, /human hotfix/i);
    assert.match(finding.message, /handoffd\.log/);
    assert.equal(finding['diagnose-only'], true);
  });

  scoped(/^no bounded auto-repair storm is queued$/, (ctx) => {
    assert.equal(ctx.bl1171Sweep.repairsSuppressed, true);
  });

  scoped(/^a disaster-class escalation was emitted$/, (ctx) => {
    const out = runBbEval(`
(require '[cheshire.core :as json])
(load-file "${loadBb(SWEEP_LIB)}")
(load-file "${loadBb(CHASE_LIB)}")
(def finding (first (babysitterd-sweep-lib/prepare-escalation-findings
                      [{:key "handoffd" :severity "CRIT" :message "down"}
                       {:key "swarm-starved" :severity "CRIT" :message "starved"}
                       {:key "proc-coder" :severity "CRIT" :message "half-launch/exit"}
                       {:key "proc-cleaner" :severity "CRIT" :message "half-launch/exit"}
                       {:key "proc-architect" :severity "CRIT" :message "half-launch/exit"}]
                      {})))
(def detail (chase-sweep-lib/format-babysitter-escalation-detail finding))
(def event {:type "BABYSITTER_ESCALATION" :subject (:key finding) :detail detail})
(println (json/generate-string {:event event :parsed (chase-sweep-lib/parse-babysitter-escalation-detail detail)}))
`);
    ctx.bl1171Queue = JSON.parse(out.trim());
  });

  scoped(/^the operator queue records the event$/, (ctx) => {
    assert.equal(ctx.bl1171Queue.event.type, 'BABYSITTER_ESCALATION');
    assert.equal(ctx.bl1171Queue.event.subject, 'disaster-class');
  });

  scoped(/^the event detail includes failure_class and suggested_actions$/, (ctx) => {
    assert.equal(ctx.bl1171Queue.parsed.failure_class, 'starvation-cascade');
    assert.ok(Array.isArray(ctx.bl1171Queue.parsed.suggested_actions));
  });

  scoped(/^the operator prompt can render the playbook without re-guessing symptoms$/, (ctx) => {
    const detail = ctx.bl1171Queue.event.detail;
    assert.notEqual(detail, ctx.bl1171Queue.parsed.summary);
    assert.ok(detail.startsWith('{'));
    assert.ok(Array.isArray(ctx.bl1171Queue.parsed.likely_causes));
    assert.ok(Array.isArray(ctx.bl1171Queue.parsed.evidence_paths));
  });
}

module.exports = { registerSteps };

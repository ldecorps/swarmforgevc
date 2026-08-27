'use strict';

// BL-1145: open-slot nudge skips type: epic (and status: blocked) via the
// shared promotion_gates_lib/evaluate chain — never a nudge-only filter.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHASE_SWEEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');
const PROMOTE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promote_and_route_next.sh');
const GATES_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promotion_gates_lib.bb');

const FEATURE = 'open-slot nudge skips type epic trackers';

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function yamlTicket(id, fields) {
  const lines = [`id: ${id}`, 'title: "fixture"'];
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}: ${v}`);
  return `${lines.join('\n')}\n`;
}

function writePaused(ctx, name, body) {
  fs.writeFileSync(path.join(ctx.pausedDir, name), body);
}

function runNudgeSurface(ctx) {
  const expr = `
(require '[babashka.fs :as fs])
(load-file ${JSON.stringify(CHASE_SWEEP_LIB)})
(let [candidates (chase-sweep-lib/read-paused-candidates ${JSON.stringify(ctx.pausedDir)})
      ctx {:active-count 1 :max-depth 5 :active-epics nil :done-ids #{}}
      eligible (chase-sweep-lib/nudge-eligible-candidates candidates ctx)
      named (chase-sweep-lib/top-open-slot-candidate eligible)
      fired (chase-sweep-lib/decide-open-slot-nudge? 1 5 (count eligible) {})
      states (loop [k 0 prev nil acc []]
               (if (= k 3)
                 acc
                 (let [{:keys [state]} (chase-sweep-lib/decide-open-slot-escalation prev (:id named) 3)]
                   (recur (inc k) state (conj acc state)))))
      epic-only (filterv #(= "epic" (promotion-gates-lib/read-type (:content %))) candidates)
      epic-elig (chase-sweep-lib/nudge-eligible-candidates epic-only ctx)
      epic-alone-fire (chase-sweep-lib/decide-open-slot-nudge? 1 5 (count epic-elig) {})]
  (prn {:fired fired
        :named (:id named)
        :eligible (mapv #(promotion-gates-lib/read-id (:content %)) eligible)
        :epic-alone-fire epic-alone-fire
        :state-ids (vec (keep :candidate-id states))}))
`;
  const raw = execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
  const sectionIds = (label) => {
    const m = raw.match(new RegExp(`:${label} \\[(.*?)\\]`));
    return m ? [...m[1].matchAll(/"(BL-\d+)"/g)].map((x) => x[1]) : [];
  };
  return {
    fired: /:fired true/.test(raw),
    named: (raw.match(/:named "([^"]+)"/) || [])[1] ?? null,
    eligible: sectionIds('eligible'),
    epicAloneFire: /:epic-alone-fire true/.test(raw),
    stateIds: sectionIds('state-ids'),
    raw,
  };
}

function evaluateGate(content) {
  const expr = `
(load-file ${JSON.stringify(GATES_LIB)})
(prn (promotion-gates-lib/evaluate
      {:content ${JSON.stringify(content)}
       :held? false :active-count 0 :max-depth 5 :active-epics {} :done-ids #{}}))
`;
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^promote_and_route_next refuses type: epic via is_epic_type$/, () => {
    /* documented background; promote script still carries is_epic_type */
  });

  scoped(/^open-slot nudge currently picks candidates via promotion_gates_lib evaluate$/, () => {
    /* documented background; nudge-eligible-candidates calls evaluate */
  });

  scoped(/^a paused type: epic ranks above all non-epic paused tickets$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl1145-');
    trackedRoots.push(ctx.root);
    ctx.pausedDir = path.join(ctx.root, 'backlog', 'paused');
    fs.mkdirSync(ctx.pausedDir, { recursive: true });
    writePaused(
      ctx,
      'BL-545-epic.yaml',
      yamlTicket('BL-545', {
        type: 'epic',
        priority: 1,
        human_approval: 'approved',
        'depends_on': '[]',
      })
    );
    writePaused(
      ctx,
      'BL-9900-feature.yaml',
      yamlTicket('BL-9900', {
        type: 'feature',
        priority: 50,
        human_approval: 'approved',
        'depends_on': '[]',
      })
    );
    ctx.epicId = 'BL-545';
    ctx.featureId = 'BL-9900';
  });

  scoped(/^an open active slot exists$/, (ctx) => {
    ctx.openSlot = true;
  });

  scoped(/^open-slot candidacy is evaluated$/, (ctx) => {
    ctx.result = runNudgeSurface(ctx);
  });

  scoped(/^the epic is not named as top open-slot candidate$/, (ctx) => {
    assert.notEqual(ctx.result.named, ctx.epicId, ctx.result.raw);
  });

  scoped(/^it does not accrue open-slot nudge or escalation count$/, (ctx) => {
    assert.ok(!ctx.result.stateIds.includes(ctx.epicId), ctx.result.raw);
    assert.ok(!(ctx.result.eligible || []).includes(ctx.epicId), ctx.result.raw);
  });

  scoped(/^a paused epic with priority 1$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl1145b-');
    trackedRoots.push(ctx.root);
    ctx.pausedDir = path.join(ctx.root, 'backlog', 'paused');
    fs.mkdirSync(ctx.pausedDir, { recursive: true });
    writePaused(
      ctx,
      'BL-545-epic.yaml',
      yamlTicket('BL-545', {
        type: 'epic',
        priority: 1,
        human_approval: 'approved',
        'depends_on': '[]',
      })
    );
    ctx.epicId = 'BL-545';
  });

  scoped(/^a paused feature with priority 2 that promote would pick$/, (ctx) => {
    writePaused(
      ctx,
      'BL-9901-feature.yaml',
      yamlTicket('BL-9901', {
        type: 'feature',
        priority: 2,
        human_approval: 'approved',
        'depends_on': '[]',
      })
    );
    ctx.featureId = 'BL-9901';
  });

  scoped(/^open-slot top candidate is chosen$/, (ctx) => {
    ctx.result = runNudgeSurface(ctx);
  });

  scoped(/^the feature is named$/, (ctx) => {
    assert.equal(ctx.result.named, ctx.featureId, ctx.result.raw);
  });

  scoped(/^decide-open-slot-nudge\? is not kept true by epics alone$/, (ctx) => {
    assert.ok(!ctx.result.epicAloneFire, `epics alone must not fire nudge: ${ctx.result.raw}`);
  });

  scoped(/^promote_and_route_next is asked to promote a type: epic id$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl1145c-');
    trackedRoots.push(ctx.root);
    const paused = path.join(ctx.root, 'backlog', 'paused');
    fs.mkdirSync(paused, { recursive: true });
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'active'), { recursive: true });
    fs.mkdirSync(path.join(ctx.root, 'swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.root, 'swarmforge', 'swarmforge.conf'),
      'config active_backlog_max_depth 5\n'
    );
    const body = yamlTicket('BL-545', {
      type: 'epic',
      priority: 1,
      human_approval: 'approved',
      'depends_on': '[]',
      status: 'todo',
    });
    fs.writeFileSync(path.join(paused, 'BL-545-epic.yaml'), body);
    ctx.epicContent = body;
    let err = '';
    try {
      execFileSync('bash', [PROMOTE, 'BL-545', ctx.root], {
        encoding: 'utf8',
        env: { ...process.env, SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD: '1', SWARMFORGE_SKIP_SYNC_INJECT: '1' },
      });
      ctx.promoteOk = true;
    } catch (e) {
      ctx.promoteOk = false;
      err = `${e.stderr || ''}${e.stdout || ''}${e.message || ''}`;
    }
    ctx.promoteErr = err;
    ctx.evalOut = evaluateGate(body);
  });

  scoped(/^it refuses with an epic gate$/, (ctx) => {
    assert.equal(ctx.promoteOk, false, 'promote must refuse epic');
    assert.match(ctx.promoteErr, /epic/i, ctx.promoteErr);
  });

  scoped(/^open-slot candidacy shares that structured epic exclusion with evaluate$/, (ctx) => {
    assert.match(ctx.evalOut, /:gate "epic"/, ctx.evalOut);
    assert.match(ctx.evalOut, /:ok false/, ctx.evalOut);
  });
}

module.exports = { registerSteps };

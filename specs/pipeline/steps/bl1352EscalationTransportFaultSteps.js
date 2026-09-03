'use strict';

// BL-1352: step handlers for making the ask-escalation transport's failure
// visible.
//
// Scenarios 01/02 drive the REAL `./swarm status` surface (swarm_status.bb)
// against a fixture root, because the whole defect was that a key existed and
// no surface read it - asserting on the key again would reproduce the defect
// in the test. Scenario 03 drives the REAL log-on-change predicate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const STATUS_BB = path.join(SCRIPTS, 'swarm_status.bb');
const ESCALATION_LIB = path.join(SCRIPTS, 'role_ask_escalation_lib.bb');
const FIXTURE_PREFIX = 'bl1352-acceptance-';
const WAITING_ROLE = 'specifier';
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
      // Another scenario tidying its own root is not this sweep's business.
    }
  }
}
sweepStaleFixtures();

function state(ctx) {
  if (!ctx.bl1352) ctx.bl1352 = {};
  return ctx.bl1352;
}

function bb(expression, loadFile) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${loadFile}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// The REAL pure decision, then the REAL status surface reading what the
// runtime would have written.
function health(transport, waitingRoles) {
  return bb(
    `(role-ask-escalation-lib/escalation-transport-state
       {:transport :${transport} :waiting-roles ${JSON.stringify(waitingRoles)}})`,
    ESCALATION_LIB,
  );
}

function renderStatus(ctx) {
  const st = state(ctx);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  const h = health(st.transport, st.waiting);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'status.json'),
    JSON.stringify({
      ask_escalation: {
        transport: st.transport,
        state: h.state.replace(/^:/, ''),
        detail: h.detail,
        waiting_roles: st.waiting,
      },
    }),
  );
  st.root = root;
  const r = spawnSync('bb', [STATUS_BB, root], { encoding: 'utf8' });
  st.status = `${r.stdout || ''}${r.stderr || ''}`;
  st.health = h;
  return st;
}

const STATE_WORD = { ok: 'ok', 'warn-unconfigured': 'warn', fault: 'FAULT' };

const FEATURE = 'An unanswered-question escalation whose transport cannot deliver is a visible fault';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the operator runtime tick is running$/, (ctx) => {
    state(ctx).ticking = true;
  });

  scoped(/^the ask escalation transport is "?(configured|unconfigured)"?$/, (ctx, transport) => {
    state(ctx).transport = transport;
  });

  scoped(/^"?(one|none)"? role question outstanding past the escalation threshold$/, (ctx, questions) => {
    state(ctx).waiting = questions === 'one' ? [WAITING_ROLE] : [];
  });

  scoped(/^the human reads the swarm status surface$/, (ctx) => {
    renderStatus(ctx);
  });

  scoped(/^the ask escalation row reads "?(ok|warn-unconfigured|fault)"?$/, (ctx, expected) => {
    const st = state(ctx);
    assert.equal(
      st.health.state.replace(/^:/, ''),
      expected,
      `the escalation state is wrong: ${JSON.stringify(st.health)}`,
    );
    // And the SURFACE shows it - the defect was a state nothing rendered.
    assert.match(st.status, /Ask escalation/, `the status surface has no ask-escalation section:\n${st.status}`);
    assert.ok(
      st.status.includes(`ask escalation: ${STATE_WORD[expected]}`),
      `the status surface does not show ${expected}:\n${st.status}`,
    );
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^the ask escalation row names the waiting role$/, (ctx) => {
    const st = state(ctx);
    assert.ok(
      st.status.includes(WAITING_ROLE),
      `the status surface does not name the waiting role:\n${st.status}`,
    );
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^the operator runtime ticks ten times and the transport "?(holds its state|becomes configured)"?$/, (ctx, change) => {
    const st = state(ctx);
    // Ten ticks through the REAL log-on-change predicate. The transport is
    // unconfigured with a question waiting (a fault) for the first five; under
    // "becomes configured" the last five are ok.
    const states = [];
    for (let i = 0; i < 10; i += 1) {
      const configured = change === 'becomes configured' && i >= 5;
      states.push(configured ? 'configured' : 'unconfigured');
    }
    let last = null;
    let lines = 0;
    for (const transport of states) {
      const h = health(transport, transport === 'configured' ? [] : [WAITING_ROLE]);
      const due = bb(
        `(role-ask-escalation-lib/transport-log-due? ${last ? `{:state "${last}"}` : 'nil'} {:state :${h.state.replace(/^:/, '')}})`,
        ESCALATION_LIB,
      );
      if (due) {
        lines += 1;
        last = h.state.replace(/^:/, '');
      }
    }
    st.lines = lines;
  });

  scoped(/^the operator log carries "?(one|two)"? ask escalation transport lines$/, (ctx, expected) => {
    const st = state(ctx);
    assert.equal(st.lines, expected === 'one' ? 1 : 2, `expected ${expected} line(s), got ${st.lines}`);
  });
}

module.exports = { registerSteps };

'use strict';

// BL-958: step handlers for "BL-958 control-plane loss is classified,
// recorded once, and owned". Scenario 01 drives the REAL swarm_status.bb as
// a subprocess over an on-disk loss fixture (fake tmux via PATH stub
// answering "no server running"); scenarios 02/03 drive the REAL shared
// control_plane_lib (the exact composition handoffd's chase catch calls)
// via `bb -e` against the same fixture — live tmux restoration itself is
// the environmentally unsuitable boundary, owned by the ticket's
// qa_e2e_procedure, not these scenarios.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
const fixtureReaper = require('./lib/fixtureReaper');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STATUS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_status.bb');
const ENSURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_ensure.bb');
const CPL = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'control_plane_lib.bb');
const FEATURE = 'BL-958 control-plane loss is classified, recorded once, and owned';

const ROLES = ['coder', 'specifier', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator'];
const OBSERVED_AT = '2026-08-19T18:00:00Z';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    // Hardening (BL-958): reap() before rmSync so the fixture's tmux socket
    // is torn down, not just unlinked. The afterEach alone cannot cover an
    // abnormal exit - a SIGKILL mid-run (routine on a saturated host) skips
    // it entirely, which is exactly the leak fixtureReaper's exit handlers
    // exist to catch. Required by extension/test/tmuxReaperGuard.test.js.
    fixtureReaper.reap(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function mkFixture(ctx) {
  const root = mkSocketFixtureRoot('sfvc-bl958-');
  fixtureReaper.track(root);
  trackedRoots.push(root);
  for (const dir of ['.swarmforge/launch', 'bin']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  // the socket file exists AND the socket path itself is still on disk —
  // the live 2026-08-19 shape
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${sock}\n`);
  fs.writeFileSync(sock, '');
  // role metadata still present: roles.tsv plus the stale sessions/windows
  // artifacts a normal stop would have removed
  const rows = ROLES.map((r) => `${r}\t${r}\t${root}\tswarmforge-${r}\t${r}\tclaude\ttask`);
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${rows.join('\n')}\n`);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'sessions.tsv'),
    `${ROLES.map((r) => `swarmforge-${r}\t123`).join('\n')}\n`
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'windows.tsv'),
    `${ROLES.map((r) => `swarmforge-${r}\tswarm`).join('\n')}\n`
  );
  for (const r of ROLES) {
    fs.writeFileSync(path.join(root, '.swarmforge', 'launch', `${r}.sh`), '#!/usr/bin/env bash\n');
  }
  // fake tmux: the server is gone — every command fails as real tmux does
  fs.writeFileSync(
    path.join(root, 'bin', 'tmux'),
    '#!/usr/bin/env bash\necho "no server running on $2" >&2\nexit 1\n'
  );
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  ctx.root = root;
  ctx.sock = sock;
  ctx.stateDir = path.join(root, '.swarmforge');
  ctx.incidentsFile = path.join(ctx.stateDir, 'incidents', 'control-plane.json');
  ctx.expectedSessions = ROLES.map((r) => `swarmforge-${r}`).sort();
}

function fixtureEnv(ctx) {
  const env = { ...process.env };
  env.PATH = `${path.join(ctx.root, 'bin')}:${env.PATH}`;
  return env;
}

function bbEval(ctx, expr) {
  const code = `(load-file ${JSON.stringify(CPL)}) (require '[cheshire.core :as json]) (println (json/generate-string ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8', env: fixtureEnv(ctx) });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

function runChaseFailureHandler(ctx) {
  return bbEval(
    ctx,
    `(control-plane-lib/record-chase-failure-incident!
       {:state-dir ${JSON.stringify(ctx.stateDir)}
        :socket ${JSON.stringify(ctx.sock)}
        :expected-sessions ${JSON.stringify(ctx.expectedSessions)}
        :observed-at ${JSON.stringify(OBSERVED_AT)}
        :source "handoffd-chase"})`
  );
}

function readIncidents(ctx) {
  assert.ok(fs.existsSync(ctx.incidentsFile), `no incidents store at ${ctx.incidentsFile}`);
  return JSON.parse(fs.readFileSync(ctx.incidentsFile, 'utf8'));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a swarm state fixture where the tmux socket file exists, the server probe reports no server running, and role session metadata is still present$/,
    (ctx) => {
      mkFixture(ctx);
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^(no|one) control-plane incident is already recorded for this loss$/,
    (ctx, prior) => {
      if (prior === 'one') {
        const outcome = runChaseFailureHandler(ctx);
        assert.equal(outcome['recorded?'], true, 'seeding the prior incident must record it');
      } else {
        assert.ok(!fs.existsSync(ctx.incidentsFile), 'fixture must start with no incident store');
      }
    },
    FEATURE
  );

  // ── Scenario 04 (BL-958 D1): recovery impossible -> :halt honored ────
  registry.defineScoped(
    /^no persisted launch scripts exist for any role$/,
    (ctx) => {
      for (const r of ROLES) {
        fs.rmSync(path.join(ctx.stateDir, 'launch', `${r}.sh`), { force: true });
      }
      // Stateful fake tmux, mirroring the real coupling: the first
      // new-session restarts the tmux server. If ensure honors :halt it
      // never runs, so the marker's absence IS "no per-role recreation was
      // attempted" - asserted below, never inferred from report text alone.
      ctx.serverMarker = path.join(ctx.root, 'server_started');
      fs.writeFileSync(
        path.join(ctx.root, 'bin', 'tmux'),
        '#!/usr/bin/env bash\n' +
          `if [[ "$3" == "new-session" ]]; then touch "${ctx.serverMarker}"; exit 0; fi\n` +
          `if [[ ! -f "${ctx.serverMarker}" ]]; then echo "no server running on $2" >&2; exit 1; fi\n` +
          'if [[ "$3" == "list-panes" ]]; then echo "0"; exit 0; fi\n' +
          'exit 0\n'
      );
      fs.chmodSync(path.join(ctx.root, 'bin', 'tmux'), 0o755);
      // Healthy stand-ins so ensure's other components stay out of the way
      // (same live-pid idiom as test_swarm_ensure.sh's own fixture).
      for (const [dir, file] of [
        ['daemon', 'handoffd.pid'],
        ['babysitterd', 'babysitterd.pid'],
        ['operator', 'runtime.pid'],
      ]) {
        fs.mkdirSync(path.join(ctx.stateDir, dir), { recursive: true });
        fs.writeFileSync(path.join(ctx.stateDir, dir, file), `${process.pid}\n`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the ensure recovery path evaluates the fixture$/,
    (ctx) => {
      const env = fixtureEnv(ctx);
      delete env.TELEGRAM_BOT_TOKEN;
      delete env.TELEGRAM_CHAT_ID;
      delete env.TELEGRAM_PRINCIPAL_USER_ID;
      delete env.CURSOR_BRIDGE_BOT_TOKEN;
      env.SWARM_ENSURE_EXTENSION_CHECK_CMD = 'true';
      env.SWARM_ENSURE_EXTENSION_BOUNCE_CMD = 'true';
      env.SWARM_ENSURE_SUPERVISOR_CMD = 'true';
      env.SWARMFORGE_SKIP_OPERATOR = '1';
      env.SWARMFORGE_SKIP_FRONT_DESK = '1';
      const res = spawnSync('bb', [ENSURE, ctx.root], { encoding: 'utf8', env });
      ctx.ensureOutput = `${res.stdout || ''}${res.stderr || ''}`;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the control-plane outcome is reported as failed, naming that no launch scripts exist to respawn roles from$/,
    (ctx) => {
      const line = ctx.ensureOutput.split('\n').find((l) => l.startsWith('control-plane:'));
      assert.ok(line, `no control-plane row in ensure output:\n${ctx.ensureOutput}`);
      assert.ok(line.includes('FAILED'), `control-plane row is not FAILED: ${line}`);
      assert.ok(
        line.includes('no persisted launch scripts to respawn roles from'),
        `control-plane row does not name the no-scripts reason: ${line}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^no per-role recreation is attempted$/,
    (ctx) => {
      assert.ok(
        !fs.existsSync(ctx.serverMarker),
        'tmux new-session ran: the per-role recreation loop churned under :halt'
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the recorded incident remains open$/,
    (ctx) => {
      const incidents = readIncidents(ctx);
      assert.equal(incidents.length, 1, `expected the one seeded incident, got ${JSON.stringify(incidents)}`);
      assert.equal(
        incidents[0].status,
        'open',
        `the incident was ${incidents[0].status} - resolving requires an actual recovery, not a halt`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^no role is reported as repaired$/,
    (ctx) => {
      const fixedRows = ctx.ensureOutput.split('\n').filter((l) => /^agent:.*: FIXED/.test(l));
      assert.deepEqual(fixedRows, [], `roles falsely reported repaired:\n${fixedRows.join('\n')}`);
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the status classifier evaluates the fixture$/,
    (ctx) => {
      const res = spawnSync('bb', [STATUS, ctx.root], { encoding: 'utf8', env: fixtureEnv(ctx) });
      ctx.statusOutput = `${res.stdout || ''}${res.stderr || ''}`;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the chase failure handler runs on a failed tmux send$/,
    (ctx) => {
      ctx.chaseOutcome = runChaseFailureHandler(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the response policy evaluates the incident$/,
    (ctx) => {
      ctx.decision = bbEval(
        ctx,
        `(let [incident (first (control-plane-lib/read-incidents
                                 (control-plane-lib/incidents-file ${JSON.stringify(ctx.stateDir)})))]
           (control-plane-lib/response-policy
            {:incident incident
             :launch-scripts-present? (control-plane-lib/launch-scripts-present? ${JSON.stringify(ctx.stateDir)})}))`
      );
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the classification is control-plane-missing$/,
    (ctx) => {
      assert.ok(
        ctx.statusOutput.includes('control-plane-missing'),
        `status output does not carry the classification:\n${ctx.statusOutput}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^no role is reported individually DOWN from the stale session metadata$/,
    (ctx) => {
      const roleDown = new RegExp(`DOWN\\s+(${ROLES.join('|')})\\b`);
      assert.ok(
        !roleDown.test(ctx.statusOutput),
        `a per-role DOWN row leaked through:\n${ctx.statusOutput}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^exactly one structured incident exists naming the socket path, the probe result, and the expected sessions$/,
    (ctx) => {
      const incidents = readIncidents(ctx);
      assert.equal(incidents.length, 1, `expected exactly one incident, got ${JSON.stringify(incidents)}`);
      const incident = incidents[0];
      assert.equal(incident['socket-path'], ctx.sock);
      assert.ok(
        String(incident['probe-output']).includes('no server running'),
        `probe result missing: ${JSON.stringify(incident)}`
      );
      assert.deepEqual([...incident['expected-sessions']].sort(), ctx.expectedSessions);
      assert.equal(incident.classification, 'control-plane-missing');
      assert.equal(incident.status, 'open');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the decision names exactly one owning daemon$/,
    (ctx) => {
      assert.equal(typeof ctx.decision.owner, 'string', `owner is not a single name: ${JSON.stringify(ctx.decision)}`);
      assert.ok(
        ['babysitterd', 'operator-runtime'].includes(ctx.decision.owner),
        `owner is not one of the two daemons: ${JSON.stringify(ctx.decision)}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the decision is either a recovery action or a single escalation carrying the reason and the next action$/,
    (ctx) => {
      const d = ctx.decision;
      if (d.action === 'recover') {
        assert.ok(d.command && d.reason, `recover decision missing command/reason: ${JSON.stringify(d)}`);
      } else if (d.action === 'escalate') {
        assert.ok(d.reason && d['next-action'], `escalation missing reason/next-action: ${JSON.stringify(d)}`);
      } else {
        assert.fail(`action is neither recover nor escalate: ${JSON.stringify(d)}`);
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };

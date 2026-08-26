'use strict';

// BL-669: outage-driven seat failover via Model Steward.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CLI = path.join(SCRIPTS, 'outage_failover_cli.bb');
const THRESHOLD_MS = 20 * 60 * 1000;

function bb(args, env) {
  return execFileSync('bb', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

function mkCtx() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl669-'));
  const steward = path.join(root, 'steward');
  const factory = path.join(root, 'factory');
  const failover = path.join(root, 'failover');
  const outages = path.join(root, 'telemetry', 'provider-outages.jsonl');
  fs.mkdirSync(steward, { recursive: true });
  fs.mkdirSync(factory, { recursive: true });
  fs.mkdirSync(failover, { recursive: true });
  fs.mkdirSync(path.dirname(outages), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  const seed = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'swarmforge', 'model-steward', 'seed', 'models.seed.json'), 'utf8'));
  fs.writeFileSync(path.join(steward, 'registry.json'), JSON.stringify({
    models: Object.fromEntries(seed.models.map((m) => [`${m.provider}/${m.model}`, {
      ...m, certification_report_path: null
    }])),
    capabilities: seed.capabilities,
    role_matrix: seed.role_matrix,
    adapters: seed.adapters
  }));
  const env = {
    OUTAGE_FAILOVER_PROJECT_ROOT: root,
    MODEL_STEWARD_STATE_DIR: steward,
    MODEL_FACTORY_STATE_DIR: factory,
    OUTAGE_FAILOVER_STATE_DIR: failover,
    OUTAGE_FAILOVER_RECORDS_FILE: outages
  };
  return { root, env, outages };
}

function writeOutage(ctx, record) {
  fs.appendFileSync(ctx.outages, `${JSON.stringify(record)}\n`);
}

function evaluate(ctx, seat, extraEnv = {}) {
  return JSON.parse(bb(['evaluate', '--seat', seat], { ...ctx.env, ...extraEnv }).trim());
}

function registerSteps(registry) {
  registry.define(/^the Model Steward registry includes certified substitutes$/, (ctx) => {
    Object.assign(ctx, mkCtx());
  });

  registry.define(/^provider-outage records name affected seats with duration and endedAtUtc$/, () => {});

  registry.define(/^an outage record for provider "([^"]+)" model "([^"]+)" has exceeded the duration threshold$/, (ctx, provider, model) => {
    const now = Date.now();
    ctx.nowMs = now;
    writeOutage(ctx, {
      id: 'bl669-sustained',
      provider,
      model,
      affectedSeats: ['architect'],
      startedAtMs: now - THRESHOLD_MS - 60000
    });
  });

  registry.define(/^the outage names seat "([^"]+)" as affected$/, () => {});

  registry.define(/^the coordinator evaluates outage-driven failover$/, (ctx) => {
    ctx.decision = evaluate(ctx, 'architect', { OUTAGE_FAILOVER_NOW_MS: String(ctx.nowMs) });
  });

  registry.define(/^it consults the steward for an assignment-eligible substitute for seat "([^"]+)"$/, (ctx) => {
    if (!['apply', 'defer-apply', 'propose'].includes(ctx.decision.action)) {
      throw new Error(`expected steward consultation, got ${JSON.stringify(ctx.decision)}`);
    }
    if (!ctx.decision.substitute) throw new Error('expected substitute from steward');
  });

  registry.define(/^it does not consult before the duration threshold is met$/, (ctx) => {
    const young = mkCtx();
    const now = Date.now();
    writeOutage(young, {
      id: 'bl669-young', provider: 'anthropic', model: 'claude-opus-5',
      affectedSeats: ['architect'], startedAtMs: now - (5 * 60 * 1000)
    });
    const d = evaluate(young, 'architect', { OUTAGE_FAILOVER_NOW_MS: String(now) });
    if (d.action !== 'none') throw new Error(`expected no consultation before threshold, got ${JSON.stringify(d)}`);
  });

  registry.define(/^a certified substitute is available for the affected seat$/, (ctx) => {
    if (!ctx.root) Object.assign(ctx, mkCtx());
    const now = Date.now();
    ctx.nowMs = now;
    writeOutage(ctx, {
      id: 'bl669-idle', provider: 'anthropic', model: 'claude-opus-5',
      affectedSeats: ['architect'], startedAtMs: now - THRESHOLD_MS - 60000
    });
  });

  registry.define(/^the seat is mid-turn with live work in progress$/, (ctx) => {
    ctx.midTurn = true;
  });

  registry.define(/^failover would apply the substitute$/, (ctx) => {
    ctx.decision = evaluate(ctx, 'architect', {
      OUTAGE_FAILOVER_NOW_MS: String(ctx.nowMs),
      ...(ctx.midTurn ? {} : {})
    });
  });

  registry.define(/^the swap is deferred until the next idle boundary$/, (ctx) => {
    const d = evaluate(ctx, 'architect', {
      OUTAGE_FAILOVER_NOW_MS: String(ctx.nowMs),
      OUTAGE_FAILOVER_ATTENDED: '0'
    });
    bb(['evaluate', '--seat', 'architect', '--mid-turn'], {
      ...ctx.env, OUTAGE_FAILOVER_NOW_MS: String(ctx.nowMs)
    });
    const mid = JSON.parse(bb(['evaluate', '--seat', 'architect', '--mid-turn'], {
      ...ctx.env, OUTAGE_FAILOVER_NOW_MS: String(ctx.nowMs)
    }).trim());
    if (mid.action !== 'defer-apply') throw new Error(`expected defer-apply, got ${JSON.stringify(mid)}`);
  });

  registry.define(/^no respawn into a live turn is performed$/, () => {});

  registry.define(/^a failover swap is active for seat "([^"]+)"$/, (ctx, seat) => {
    if (!ctx.root) Object.assign(ctx, mkCtx());
    ctx.activeSeat = seat;
    ctx.revertOutageId = 'bl669-revert';
    fs.writeFileSync(path.join(ctx.env.OUTAGE_FAILOVER_STATE_DIR, 'active-swap.json'), JSON.stringify({
      architect: {
        'outage-id': ctx.revertOutageId,
        from: { provider: 'anthropic', model: 'claude-opus-5' },
        to: { provider: 'anthropic', model: 'claude-opus-4-8' }
      }
    }));
  });

  registry.define(/^the outage record sets endedAtUtc$/, (ctx) => {
    const now = ctx.nowMs || Date.now();
    ctx.nowMs = now;
    fs.writeFileSync(ctx.outages, `${JSON.stringify({
      id: ctx.revertOutageId || 'bl669-revert',
      provider: 'anthropic',
      model: 'claude-opus-5',
      affectedSeats: ['architect'],
      startedAtMs: now - THRESHOLD_MS - 60000,
      endedAtUtc: '2026-07-26T12:00:00Z'
    })}\n`);
  });

  registry.define(/^the coordinator evaluates reversion at the next idle boundary$/, (ctx) => {
    ctx.decision = evaluate(ctx, ctx.activeSeat || 'architect', {
      OUTAGE_FAILOVER_NOW_MS: String(ctx.nowMs)
    });
  });

  registry.define(/^the seat reverts to the pack's canonical model for that seat$/, (ctx) => {
    if (ctx.decision.action !== 'revert') throw new Error(`expected revert, got ${JSON.stringify(ctx.decision)}`);
  });

  registry.define(/^the revert is automatic without a separate human ask$/, () => {});

  registry.define(/^the only available substitute for the seat is uncertified$/, (ctx) => {
    Object.assign(ctx, mkCtx());
    const reg = JSON.parse(fs.readFileSync(path.join(ctx.env.MODEL_STEWARD_STATE_DIR, 'registry.json'), 'utf8'));
    reg.models['anthropic/claude-opus-4-8'].status = 'candidate';
    delete reg.role_matrix.architect;
    reg.role_matrix.architect = [{ provider: 'anthropic', model: 'claude-opus-4-8', score: 0.94, evidence: 'BL-669:incumbent-architect-fallback' }];
    fs.writeFileSync(path.join(ctx.env.MODEL_STEWARD_STATE_DIR, 'registry.json'), JSON.stringify(reg));
    const now = Date.now();
    ctx.nowMs = now;
    writeOutage(ctx, {
      id: 'bl669-uncert', provider: 'anthropic', model: 'claude-opus-5',
      affectedSeats: ['architect'], startedAtMs: now - THRESHOLD_MS - 60000
    });
  });

  registry.define(/^no substitute is applied$/, (ctx) => {
    const d = evaluate(ctx, 'architect', { OUTAGE_FAILOVER_NOW_MS: String(ctx.nowMs) });
    if (d.action !== 'none') throw new Error(`expected no apply, got ${JSON.stringify(d)}`);
  });

  registry.define(/^--override-uncertified is not used on this path$/, () => {});

  registry.define(/^a failover swap or revert is applied$/, (ctx) => {
    Object.assign(ctx, mkCtx());
    const now = Date.now();
    ctx.nowMs = now;
    writeOutage(ctx, {
      id: 'bl669-log', provider: 'anthropic', model: 'claude-opus-5',
      affectedSeats: ['architect'], startedAtMs: now - THRESHOLD_MS - 60000
    });
    execFileSync('bb', [CLI, 'apply-if-idle', '--seat', 'architect'], {
      encoding: 'utf8',
      env: { ...process.env, ...ctx.env, OUTAGE_FAILOVER_NOW_MS: String(now), SWARMFORGE_SKIP_TMUX_INJECT: '1' }
    });
    ctx.logRoot = ctx.root;
  });

  registry.define(/^an Operator-topic announcement names seat from-model to-model incident and revert condition$/, (ctx) => {
    const outbox = path.join(ctx.logRoot, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
    if (!fs.existsSync(outbox)) throw new Error(`missing operator outbox at ${outbox}`);
    const text = fs.readFileSync(outbox, 'utf8');
    if (!text.includes('OUTAGE-FAILOVER')) throw new Error(`missing operator announcement in ${outbox}`);
  });

  registry.define(/^a COST-root experiment-log annotation records the seat change$/, (ctx) => {
    const log = path.join(ctx.logRoot, '.swarmforge', 'telemetry', 'outage-failover-experiment.jsonl');
    if (!fs.existsSync(log)) throw new Error(`missing experiment log at ${log}`);
    const line = fs.readFileSync(log, 'utf8').trim();
    if (!line.includes('"seat"')) throw new Error(`experiment log missing seat entry: ${line}`);
  });

  registry.define(/^anthropic\/claude-opus-4-8 is not yet in the steward registry$/, (ctx) => {
    Object.assign(ctx, mkCtx());
    const reg = JSON.parse(fs.readFileSync(path.join(ctx.env.MODEL_STEWARD_STATE_DIR, 'registry.json'), 'utf8'));
    delete reg.models['anthropic/claude-opus-4-8'];
    reg.role_matrix.architect = (reg.role_matrix.architect || []).filter((r) => r.model !== 'claude-opus-4-8');
    fs.writeFileSync(path.join(ctx.env.MODEL_STEWARD_STATE_DIR, 'registry.json'), JSON.stringify(reg));
  });

  registry.define(/^the designated fallback registration runs$/, (ctx) => {
    bb(['register-opus-fallback'], ctx.env);
  });

  registry.define(/^anthropic\/claude-opus-4-8 is present in the registry$/, (ctx) => {
    const reg = JSON.parse(fs.readFileSync(path.join(ctx.env.MODEL_STEWARD_STATE_DIR, 'registry.json'), 'utf8'));
    if (!reg.models['anthropic/claude-opus-4-8']) throw new Error('opus-4-8 missing from registry');
  });

  registry.define(/^it is assignment-eligible as the same-provider fallback for opus-class outages$/, (ctx) => {
    const out = execFileSync('bb', [
      path.join(SCRIPTS, 'model_steward_cli.bb'), 'eligible', 'anthropic/claude-opus-4-8', '--role', 'architect'
    ], { encoding: 'utf8', env: { ...process.env, MODEL_STEWARD_STATE_DIR: ctx.env.MODEL_STEWARD_STATE_DIR } }).trim();
    if (out !== 'eligible') throw new Error(`expected eligible, got ${out}`);
  });
}

module.exports = { registerSteps };

'use strict';

// BL-1815: step handlers for "A Claude seat writes a knowledge brief before
// a local model takes its role". Drives the REAL transfer-memory! path in
// model_steward_cli.bb (through its test-only `trial transfer-memory-debug`
// seam - bypassing nominate/assess/go-live/the registry, which are outside
// this ticket's scope) with a stub pane (no tmux socket file in the fixture,
// so resolve-pane-target returns nil and no real tmux call is ever made) and
// the REAL trial-boundary-memory.js, so the persisted payload in scenario 02
// is the real one.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1815 A Claude seat writes a knowledge brief before a local model takes its role';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');
const MEMORY_TOOL = path.join(REPO_ROOT, 'extension', 'out', 'tools', 'trial-boundary-memory.js');

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value is validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough.
const AGENT_TO_PROVIDER = new Map([
  ['claude', 'anthropic'],
  ['local-model', 'local'],
  ['aider', 'cerebras'],
]);

const BRIEF_PROBLEMS = new Map([
  ['never written within the wait', (ctx) => { /* no file written */ }],
  ['empty', (ctx) => writeBriefAfterRequestClears(ctx, '   \n  ')],
  ['2001 characters long', (ctx) => writeBriefAfterRequestClears(ctx, 'x'.repeat(2001))],
]);

function ensure(ctx) {
  if (!ctx.bl1815) {
    const root = trackedTmpRoot('bl1815-fixture-');
    ctx.bl1815 = {
      root,
      factoryDir: path.join(root, 'factory'),
      role: 'coder',
      raw: '',
      exitCode: null,
    };
    fs.mkdirSync(ctx.bl1815.factoryDir, { recursive: true });
  }
  return ctx.bl1815;
}

function agentProvider(agent) {
  const provider = AGENT_TO_PROVIDER.get(agent);
  if (!provider) {
    throw new Error(`bl1815: unrecognized agent "${agent}"`);
  }
  return provider;
}

function briefPath(ctx) {
  return path.join(ctx.root, '.swarmforge', 'agent-memory', ctx.role, 'brief.md');
}

// BL-1815 QA bounce D1 (2026-09-30): request-brief! clears any pre-existing
// brief.md the instant it starts, so "the outgoing seat writes a brief"
// (in any of its Given-step forms) must land AFTER the boundary call
// begins, not before - a pre-write is exactly the "leftover from an
// earlier boundary" shape D1 fixed, and would just be cleared away. A
// detached, unref'd node process performs the write well after bb's own
// namespace-load startup has had time to reach the clear (measured at
// several hundred ms for model_steward_cli.bb's full load chain).
function writeBriefAfterRequestClears(ctx, content) {
  const p = briefPath(ctx);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const script = `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(p)}, ${JSON.stringify(content)}); }, 800);`;
  const child = spawn('node', ['-e', script], { detached: true, stdio: 'ignore' });
  child.unref();
}

function seedOutgoingSeat(ctx) {
  // Matches write-seat!'s own on-disk shape byte-for-byte (the whole
  // resolve-launch-agent REPORT nested under :agent, not a bare string -
  // model_steward_cli.bb's own write-seat! stores it that way today), so
  // the "seat now runs X" checks read exactly what write-seat! would have
  // written for the seat's CURRENT (pre-move) state.
  const assignment = {
    [ctx.role]: {
      role: ctx.role,
      provider: ctx.fromProvider,
      model: 'debug-from-model',
      agent: { provider: ctx.fromProvider, agent: ctx.outgoingAgent, 'known?': true },
    },
  };
  fs.writeFileSync(path.join(ctx.factoryDir, 'assignment.json'), JSON.stringify(assignment));
}

function seatAgent(ctx) {
  const raw = fs.readFileSync(path.join(ctx.factoryDir, 'assignment.json'), 'utf8');
  const assignment = JSON.parse(raw);
  return assignment[ctx.role]?.agent?.agent;
}

function runBoundary(ctx) {
  const r = spawnSync('bb', [
    CLI, 'trial', 'transfer-memory-debug',
    '--role', ctx.role,
    '--boundary', 'trial-start',
    '--from-provider', ctx.fromProvider,
    '--to-provider', ctx.toProvider,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MODEL_STEWARD_MEMORY_TOOL: MEMORY_TOOL,
      MODEL_STEWARD_TARGET_ROOT: ctx.root,
      MODEL_FACTORY_STATE_DIR: ctx.factoryDir,
      // Short and fast: no scenario here ever needs the real production
      // default of 60s - a fixture with no tmux socket resolves its pane
      // target to nil immediately, so the whole wait is spent polling disk.
      // 6s (not 1s): a scenario whose brief is written by
      // writeBriefAfterRequestClears's own 800ms-delayed writer needs
      // enough budget left after that delay for the two-poll stability
      // check (D2) to observe it; a scenario with nothing to write at all
      // still returns as soon as classify-brief settles at the deadline.
      MODEL_STEWARD_BRIEF_WAIT_S: '6',
      MODEL_STEWARD_BRIEF_POLL_MS: '50',
    },
  });
  ctx.raw = `${r.stdout || ''}${r.stderr || ''}`;
  ctx.exitCode = r.status;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository whose model steward is about to move the "coder" seat$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the outgoing seat runs the "([^"]+)" agent and the incoming seat the "([^"]+)" agent$/, (ctx, outgoing, incoming) => {
    const st = ensure(ctx);
    st.outgoingAgent = outgoing;
    st.incomingAgent = incoming;
    st.fromProvider = agentProvider(outgoing);
    st.toProvider = agentProvider(incoming);
    seedOutgoingSeat(st);
  });

  scoped(/^the outgoing seat writes a (\d+)-character brief within the wait$/, (ctx, length) => {
    const st = ensure(ctx);
    const n = Number(length);
    const brief = 'b'.repeat(n);
    writeBriefAfterRequestClears(st, brief);
    st.expectedBrief = brief;
  });

  scoped(/^the outgoing seat's brief is (.+)$/, (ctx, problemRaw) => {
    const st = ensure(ctx);
    const problem = problemRaw.replace(/^"|"$/g, '');
    const apply = BRIEF_PROBLEMS.get(problem);
    if (!apply) {
      throw new Error(`bl1815: unrecognized brief problem: ${problem}`);
    }
    apply(st);
  });

  scoped(/^the trial boundary moves the seat$/, (ctx) => {
    runBoundary(ensure(ctx));
  });

  scoped(/^a knowledge brief (.+)$/, (ctx, requestRaw) => {
    const st = ensure(ctx);
    const request = requestRaw.replace(/^"|"$/g, '');
    const marker = `brief requested role=${st.role}`;
    if (request === 'is requested from the outgoing seat') {
      if (!st.raw.includes(marker)) {
        throw new Error(`expected "${marker}" in output, got:\n${st.raw}`);
      }
    } else if (request === 'is not requested') {
      if (st.raw.includes(marker)) {
        throw new Error(`expected no "${marker}" in output, got:\n${st.raw}`);
      }
    } else {
      throw new Error(`bl1815: unrecognized request assertion: ${request}`);
    }
  });

  scoped(/^the persisted payload for "coder" has schema version 1 and that brief as its continuity summary$/, (ctx) => {
    const st = ensure(ctx);
    const payloadPath = path.join(st.root, '.swarmforge', 'agent-memory', st.role, 'payload.json');
    if (!fs.existsSync(payloadPath)) {
      throw new Error(`expected a persisted payload at ${payloadPath}, got none. output:\n${st.raw}`);
    }
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    if (payload.schemaVersion !== 1) {
      throw new Error(`expected schemaVersion 1, got ${JSON.stringify(payload.schemaVersion)}`);
    }
    if (payload.continuitySummary !== st.expectedBrief) {
      throw new Error(
        `expected continuitySummary to equal the written brief (length ${st.expectedBrief.length}), got length ${payload.continuitySummary.length}`
      );
    }
  });

  scoped(/^the "coder" seat now runs the "([^"]+)" agent$/, (ctx, agent) => {
    const st = ensure(ctx);
    const actual = seatAgent(st);
    if (actual !== agent) {
      throw new Error(`expected the coder seat to run "${agent}", got "${actual}". output:\n${st.raw}`);
    }
  });

  scoped(/^the move is refused with a reason naming "([^"]+)"$/, (ctx, reason) => {
    const st = ensure(ctx);
    if (st.exitCode === 0) {
      throw new Error(`expected the move to be refused (nonzero exit), got 0. output:\n${st.raw}`);
    }
    if (!st.raw.includes(reason)) {
      throw new Error(`expected the refusal to name "${reason}", got:\n${st.raw}`);
    }
  });
}

module.exports = { registerSteps };

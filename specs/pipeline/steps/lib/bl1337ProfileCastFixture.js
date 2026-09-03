'use strict';

// BL-1337: the fixture the profile-driven cast feature drives. A throwaway
// steward store (registry + profiles) and ModelFactory store, and the REAL
// bob_starting_cast_cli.bb run against them - the same CLI a human would run,
// so "the cast is generated from that profile" means the shipped path ran.
//
// No credential ever enters the fixture environment except a deliberately
// fake one for the reachable providers: the handshake asks only whether a
// credential is PRESENT, so a fake value exercises it exactly as a real one
// would, and nothing under test can leak a real key.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'bob_starting_cast_cli.bb');
const FIXTURE_PREFIX = 'bl1337-acceptance-';
const STALE_AFTER_MS = 10 * 60 * 1000;

// BL-971: swept by prefix BEFORE a run as well as removed in a finally - a
// killed run traps nothing. Age-guarded so a live sibling root survives.
function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // A root another scenario is removing right now is not this sweep's business.
    }
  }
}

// The fixture registry, mirroring the ticket's own qa_e2e_procedure:
//   coder     - top pick certified AND reachable here
//   cleaner   - top pick registered but NOT certified (registry-ineligible)
//   architect - top pick certified but UNREACHABLE on this host
//   QA        - nothing above the profile's quality floor
const REGISTRY = {
  models: {
    'anthropic/claude-opus-5': { provider: 'anthropic', model: 'claude-opus-5', status: 'certified' },
    'openrouter/gemini-3-pro': { provider: 'openrouter', model: 'gemini-3-pro', status: 'registered' },
    'cerebras/qwen3.8-max': { provider: 'cerebras', model: 'qwen3.8-max', status: 'certified' },
    'mistral/mistral-large': { provider: 'mistral', model: 'mistral-large', status: 'certified' },
  },
  role_matrix: {
    coder: [{ provider: 'anthropic', model: 'claude-opus-5', score: 0.93, evidence: { scorecard_id: 'sc-1' } }],
    cleaner: [
      { provider: 'openrouter', model: 'gemini-3-pro', score: 0.95, evidence: { scorecard_id: 'sc-x' } },
      { provider: 'cerebras', model: 'qwen3.8-max', score: 0.88, evidence: { scorecard_id: 'sc-2' } },
    ],
    architect: [
      { provider: 'mistral', model: 'mistral-large', score: 0.91, evidence: { scorecard_id: 'sc-3' } },
      { provider: 'anthropic', model: 'claude-opus-5', score: 0.9, evidence: { scorecard_id: 'sc-1' } },
    ],
    QA: [{ provider: 'cerebras', model: 'qwen3.8-max', score: 0.4, evidence: { scorecard_id: 'sc-2' } }],
  },
  adapters: {},
};

// Present on this fixture host; mistral and openrouter deliberately are not.
const REACHABLE_PROVIDER_ENV = { ANTHROPIC_API_KEY: 'fixture-not-a-real-key', CEREBRAS_API_KEY: 'fixture-not-a-real-key' };

const LIVE_PACK_REL = path.join('swarmforge', 'packs', 'fixture-live.conf');
const LIVE_PACK_TEXT = 'window coder claude --model claude-opus-5\nconfig coordinator_model claude-sonnet-5\n';

function makeFixture({ roles = ['coder', 'cleaner', 'architect'], qualityFloor = 0.5, providers = [], handshake = 'registry-and-host' } = {}) {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  const stewardDir = path.join(root, 'steward');
  const factoryDir = path.join(root, 'factory');
  fs.mkdirSync(path.join(stewardDir, 'profiles'), { recursive: true });
  fs.mkdirSync(factoryDir, { recursive: true });
  fs.writeFileSync(path.join(stewardDir, 'registry.json'), JSON.stringify(REGISTRY, null, 2));
  fs.writeFileSync(
    path.join(stewardDir, 'profiles', 'fixture.json'),
    JSON.stringify({ name: 'fixture', roles, quality_floor: qualityFloor, providers, handshake }, null, 2),
  );
  // A "live pack" the generator must not touch (propose, never install).
  fs.mkdirSync(path.join(root, path.dirname(LIVE_PACK_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, LIVE_PACK_REL), LIVE_PACK_TEXT);
  return { root, stewardDir, factoryDir, livePack: path.join(root, LIVE_PACK_REL) };
}

function removeFixture(fx) {
  if (fx) fs.rmSync(fx.root, { recursive: true, force: true });
}

function runCli(fx, args) {
  const env = {
    ...process.env,
    MODEL_STEWARD_STATE_DIR: fx.stewardDir,
    MODEL_FACTORY_STATE_DIR: fx.factoryDir,
    ...REACHABLE_PROVIDER_ENV,
  };
  // Scrub every credential the fixture does NOT want present, so a real key
  // on the developer's host cannot make an "unreachable" provider reachable
  // and quietly turn the negative scenarios green.
  for (const name of ['MISTRAL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'QWEN_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    delete env[name];
  }
  const r = spawnSync('bb', [CLI, ...args], { encoding: 'utf8', env, cwd: fx.root, timeout: 120000 });
  return { status: r.status, stdout: `${r.stdout || ''}`, note: `${r.stderr || ''}` };
}

// Every file the run wrote under the fixture root, for the no-secrets sweep.
function filesWritten(fx, sinceMs) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (fs.statSync(full).mtimeMs >= sinceMs) out.push(full);
    }
  };
  walk(fx.root);
  return out;
}

module.exports = {
  REPO_ROOT,
  CLI,
  REGISTRY,
  LIVE_PACK_TEXT,
  REACHABLE_PROVIDER_ENV,
  makeFixture,
  removeFixture,
  runCli,
  filesWritten,
  sweepStaleFixtures,
};

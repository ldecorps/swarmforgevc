'use strict';

// BL-669 declared invariants: certified-only, idle boundary, announced+logged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'outage_failover_cli.bb');
const BB = process.env.BB_BIN || '/home/carillon/.local/bin/bb';

test('BL-669: mid-turn defers; idle applies; uncertified never applies', () => {
  const root = mkTmpDir('bl669-prop-');
  const steward = path.join(root, 'steward');
  const factory = path.join(root, 'factory');
  const failover = path.join(root, 'failover');
  const outages = path.join(root, 'outages.jsonl');
  fs.mkdirSync(steward, { recursive: true });
  fs.mkdirSync(factory, { recursive: true });
  fs.mkdirSync(failover, { recursive: true });
  const seed = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'swarmforge', 'model-steward', 'seed', 'models.seed.json'), 'utf8'));
  fs.writeFileSync(path.join(steward, 'registry.json'), JSON.stringify({
    models: Object.fromEntries(seed.models.map((m) => [`${m.provider}/${m.model}`, { ...m, certification_report_path: null }])),
    capabilities: seed.capabilities,
    role_matrix: seed.role_matrix,
    adapters: seed.adapters
  }));
  const now = Date.now();
  fs.writeFileSync(outages, `${JSON.stringify({
    id: 'p1', provider: 'anthropic', model: 'claude-opus-5',
    affectedSeats: ['architect'], startedAtMs: now - (25 * 60 * 1000)
  })}\n`);
  const env = {
    OUTAGE_FAILOVER_PROJECT_ROOT: root,
    MODEL_STEWARD_STATE_DIR: steward,
    MODEL_FACTORY_STATE_DIR: factory,
    OUTAGE_FAILOVER_STATE_DIR: failover,
    OUTAGE_FAILOVER_RECORDS_FILE: outages,
    OUTAGE_FAILOVER_NOW_MS: String(now)
  };
  const mid = JSON.parse(execFileSync(BB, [CLI, 'evaluate', '--seat', 'architect', '--mid-turn'], { encoding: 'utf8', env }).trim());
  assert.equal(mid.action, 'defer-apply');
  const idle = JSON.parse(execFileSync(BB, [CLI, 'evaluate', '--seat', 'architect'], { encoding: 'utf8', env }).trim());
  assert.equal(idle.action, 'apply');
  const reg = JSON.parse(fs.readFileSync(path.join(steward, 'registry.json'), 'utf8'));
  reg.models['anthropic/claude-opus-4-8'].status = 'candidate';
  reg.role_matrix.architect = reg.role_matrix.architect.filter((r) => r.model === 'claude-opus-4-8');
  fs.writeFileSync(path.join(steward, 'registry.json'), JSON.stringify(reg));
  const blocked = JSON.parse(execFileSync(BB, [CLI, 'evaluate', '--seat', 'architect'], { encoding: 'utf8', env }).trim());
  assert.equal(blocked.action, 'none');
  fs.rmSync(root, { recursive: true, force: true });
});

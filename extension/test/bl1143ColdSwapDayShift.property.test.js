/**
 * BL-1143: cold-swap evidence always denies qwen-forge and names mono pack.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO = path.join(__dirname, '..', '..');

function materialize() {
  const root = mkTmpDir('bl1143-p-');
  const scripts = path.join(root, 'swarmforge', 'scripts');
  const packs = path.join(root, 'swarmforge', 'packs');
  const evidence = path.join(root, 'backlog', 'evidence');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(packs, { recursive: true });
  fs.mkdirSync(evidence, { recursive: true });
  fs.copyFileSync(
    path.join(REPO, 'swarmforge', 'packs', 'ollama-qwen3-mono-router.conf'),
    path.join(packs, 'ollama-qwen3-mono-router.conf')
  );
  for (const name of [
    'cold_swap_day_shift_to_ollama_qwen.sh',
    'local_ollama_pack_shape_lib.sh',
    'local_ollama_pack_shape_gate.sh',
    'model_steward_lib.bb',
  ]) {
    fs.copyFileSync(path.join(REPO, 'swarmforge', 'scripts', name), path.join(scripts, name));
  }
  fs.writeFileSync(
    path.join(scripts, 'local_coder_battery_staffing_gate.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(evidence, 'BL-1127-coder-battery-ollama-qwen2.5-coder-x.md'),
    '- result: pass\n- model: qwen2.5-coder\n- provider: ollama\n'
  );
  fs.writeFileSync(path.join(root, 'start-swarm-ollama-qwen.sh'), '#!/usr/bin/env bash\nexit 0\n', {
    mode: 0o755,
  });
  fs.chmodSync(path.join(scripts, 'cold_swap_day_shift_to_ollama_qwen.sh'), 0o755);
  return root;
}

describe('BL-1143 cold-swap day-shift', () => {
  it('verify always records ollama-qwen3-mono-router and not qwen-forge', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), () => {
        const root = materialize();
        const r = spawnSync(
          'bash',
          [path.join(root, 'swarmforge', 'scripts', 'cold_swap_day_shift_to_ollama_qwen.sh'), root, '--verify'],
          { encoding: 'utf8' }
        );
        assert.equal(r.status, 0, r.stderr || r.stdout);
        assert.equal(
          fs.readFileSync(path.join(root, '.swarmforge', 'day_shift_pack'), 'utf8').trim(),
          'ollama-qwen3-mono-router'
        );
        const ev = fs
          .readdirSync(path.join(root, 'backlog', 'evidence'))
          .filter((f) => f.startsWith('BL-1143-'))
          .map((f) => fs.readFileSync(path.join(root, 'backlog', 'evidence', f), 'utf8'))
          .join('\n');
        assert.match(ev, /qwen_forge:\s*not launched/);
        assert.doesNotMatch(ev, /SWARMFORGE_PACK=qwen-forge/);
        fs.rmSync(root, { recursive: true, force: true });
      }),
      { numRuns: 3 }
    );
  });
});

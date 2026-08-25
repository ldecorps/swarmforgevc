/**
 * BL-1142: pack-shape classification is stable for mono vs uncapped bodies.
 * Drives the bash classifier via a thin spawn so APS and unit runners share
 * the same lib.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');

const REPO = path.join(__dirname, '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'local_ollama_pack_shape_lib.sh');

function classify(body) {
  const script = `
set -euo pipefail
source "${LIB}"
bl1142_classify_pack_shape "$(cat)"
`;
  const r = spawnSync('bash', ['-c', script], {
    input: body,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}

describe('BL-1142 local Ollama pack shape', () => {
  it('mono depth-1 router is always mono-router', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const body =
          'config active_backlog_max_depth 1\n' +
          'config rotation router\n' +
          'window coder aider coder --model x\n';
        assert.equal(classify(body), 'mono-router');
      }),
      { numRuns: 5 }
    );
  });

  it('standing multi-window without depth is always uncapped-forge', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
        let body = '';
        for (let i = 0; i < n; i++) body += `window role${i} cmd\n`;
        assert.equal(classify(body), 'uncapped-forge');
      }),
      { numRuns: 12 }
    );
  });
});

/**
 * BL-1660 declared invariant: every pipeline in
 * local_ollama_pack_shape_lib.sh consumes its whole input on the reading
 * side - no early exit while a producer may still be writing - so the
 * classifier's exit status is 0 for every well-formed body of any size.
 *
 * Reachability floor: the generator's range (6000-30000 window lines, each
 * "window seat\n" = 12 bytes) puts EVERY drawn body at 72,000-360,012
 * bytes, always past the 64 KiB pipe buffer that made the pre-fix awk's
 * early `exit` race deterministic - not a hoped-for size, a constructed
 * one. Each run spawns a fresh bash -c (the ticket's own reproduction
 * shape: printf/heredoc on stdin, `source` the lib, call the function) so
 * the pipe is real, not a same-process call that never sets up the race.
 *
 * Separate file from bl1142LocalOllamaPackShape.property.test.js per the
 * BL-1660 ticket's own constraint ("do not touch the property test" - that
 * file's classify() is the pre-existing consumer proving the fix; this
 * file is the coder-authored property test BL-654 asks for the newly
 * declared invariant, additive, never editing that one).
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');

const REPO = path.join(__dirname, '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'local_ollama_pack_shape_lib.sh');

function classify(body) {
  const script = `set -euo pipefail; source "${LIB}"; bl1142_classify_pack_shape "$(cat)"`;
  return spawnSync('bash', ['-c', script], { input: body, encoding: 'utf8' });
}

describe('BL-1660 pack-config reads its whole input before deciding', () => {
  it('classifier exits 0 and reports mono-router for bodies past the pipe buffer', () => {
    fc.assert(
      fc.property(fc.integer({ min: 6000, max: 30000 }), (windowLines) => {
        const lines = ['config rotation router', 'config active_backlog_max_depth 1'];
        for (let i = 0; i < windowLines; i += 1) lines.push('window seat');
        const body = `${lines.join('\n')}\n`;
        assert.ok(body.length > 65536, `fixture too small to force the race: ${body.length} bytes`);

        const r = classify(body);
        assert.equal(r.status, 0, `windowLines=${windowLines} bytes=${body.length}: ${r.stderr || r.stdout}`);
        assert.equal(r.stdout.trim(), 'mono-router');
      }),
      { numRuns: 8 }
    );
  });
});

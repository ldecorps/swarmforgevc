const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { renderBriefingDiagrams } = require('../out/tools/render-briefing-diagrams');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIXTURE_MMD = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-diagram.mmd'), 'utf8');

function mkFixtureProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-briefing-diagrams-test-'));
  const diagramsDir = path.join(root, 'docs', 'diagrams');
  fs.mkdirSync(diagramsDir, { recursive: true });
  fs.writeFileSync(path.join(diagramsDir, 'architecture.mmd'), FIXTURE_MMD);
  fs.writeFileSync(path.join(diagramsDir, 'swarm-flow.mmd'), FIXTURE_MMD);
  return root;
}

test('renders exactly the two maintained diagrams, named and base64-encoded', async () => {
  const diagrams = await renderBriefingDiagrams(mkFixtureProjectRoot());

  assert.deepEqual(
    diagrams.map((d) => d.name),
    ['architecture', 'swarm-flow']
  );
  for (const { base64 } of diagrams) {
    const png = Buffer.from(base64, 'base64');
    assert.ok(png.subarray(0, 8).equals(PNG_MAGIC), 'each entry must decode to a well-formed PNG');
  }
});

test('a missing diagram source file rejects rather than silently omitting it (handoffd.bb\'s shell-out treats any failure as "rendering unavailable this run")', async () => {
  const root = mkFixtureProjectRoot();
  fs.rmSync(path.join(root, 'docs', 'diagrams', 'swarm-flow.mmd'));

  await assert.rejects(() => renderBriefingDiagrams(root));
});

// ── end-to-end: the compiled CLI's own real output against the real repo ──

test('the compiled CLI runs against the real repo and prints the two maintained diagrams as JSON', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'render-briefing-diagrams.js');
  const output = execFileSync('node', [cliPath], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' });
  const diagrams = JSON.parse(output);

  assert.deepEqual(
    diagrams.map((d) => d.name),
    ['architecture', 'swarm-flow']
  );
  for (const { base64 } of diagrams) {
    assert.ok(Buffer.from(base64, 'base64').subarray(0, 8).equals(PNG_MAGIC));
  }
});

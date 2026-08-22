const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { renderBriefingDiagrams, main } = require('../out/tools/render-briefing-diagrams');

// BL-1038-EXEMPT: the signal IS the live read. These two tests render the REAL
// maintained docs/diagrams/*.mmd - in-process and again through the compiled
// CLI as a subprocess - and exist to catch a maintained diagram that has
// stopped rendering. Pinning copies of the .mmd files would leave the guard
// green while the real diagrams silently broke, which is the one failure this
// file is for. Its cost is set by mermaid + resvg rendering two named files,
// not by the repository's size or history depth: adding commits or files to
// this repo does not make it slower. Named in the ticket's own
// approval_context as the legitimate exemption case.

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIXTURE_MMD = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-diagram.mmd'), 'utf8');

function mkFixtureProjectRoot() {
  const root = mkTmpDir('render-briefing-diagrams-test-');
  const diagramsDir = path.join(root, 'docs', 'diagrams');
  fs.mkdirSync(diagramsDir, { recursive: true });
  fs.writeFileSync(path.join(diagramsDir, 'architecture.mmd'), FIXTURE_MMD);
  fs.writeFileSync(path.join(diagramsDir, 'swarm-flow.mmd'), FIXTURE_MMD);
  return root;
}

// The real repo root (two levels up from extension/test/) - the SAME
// project root main()'s own resolveProjectRoot(process.cwd()) resolves to
// when invoked from here, with the two real, maintained docs/diagrams/*.mmd
// files main() actually reads (mkFixtureProjectRoot above has no
// .swarmforge/roles.tsv, so resolveProjectRoot cannot resolve it - it's
// only ever used to test renderBriefingDiagrams() directly, below).
const REAL_PROJECT_ROOT = path.join(__dirname, '..', '..');

// BL-914: real CPU-bound mermaid layout + native resvg rendering, by design
// - measures consistently within a few percent of the 20000ms suite default
// even in isolation (BL-815 evidence). A per-test override buys headroom
// without touching the suite-wide default every other test still relies on.
test(
  'renders exactly the two maintained diagrams, named and base64-encoded',
  async () => {
    const diagrams = await renderBriefingDiagrams(mkFixtureProjectRoot());

    assert.deepEqual(
      diagrams.map((d) => d.name),
      ['architecture', 'swarm-flow']
    );
    for (const { base64 } of diagrams) {
      const png = Buffer.from(base64, 'base64');
      assert.ok(png.subarray(0, 8).equals(PNG_MAGIC), 'each entry must decode to a well-formed PNG');
    }
  },
  45000
);

test('a missing diagram source file rejects rather than silently omitting it (handoffd.bb\'s shell-out treats any failure as "rendering unavailable this run")', async () => {
  const root = mkFixtureProjectRoot();
  fs.rmSync(path.join(root, 'docs', 'diagrams', 'swarm-flow.mmd'));

  await assert.rejects(() => renderBriefingDiagrams(root));
});

// ── the compiled CLI's main() ────────────────────────────────────────────

const CLI = path.join(__dirname, '..', 'out', 'tools', 'render-briefing-diagrams.js');

function runCliSubprocess(cwd) {
  return execFileSync('node', [CLI], { cwd, encoding: 'utf8' });
}

// Runs the REAL main() in-process against the real repo, so in-process
// coverage and mutation tooling can see main()'s own thin-wrapper branches
// (resolveProjectRoot + renderBriefingDiagrams + printJsonToStdout) that a
// subprocess-only smoke test cannot (the engineering article's CLI
// main()-thin-wrapper rule; mirrors notifyDeadLettersCli.test.js's own
// identical seam). main() takes no parameters and reads no env - only cwd.
async function runCli(cwd) {
  const originalCwd = process.cwd;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => cwd;
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
  }
  return JSON.parse(writes.join(''));
}

// BL-914: same real render path as above, in-process this time - same
// headroom rationale.
test(
  "main() runs in-process against the real repo and prints the two maintained diagrams as JSON",
  async () => {
    const diagrams = await runCli(REAL_PROJECT_ROOT);

    assert.deepEqual(
      diagrams.map((d) => d.name),
      ['architecture', 'swarm-flow']
    );
    for (const { base64 } of diagrams) {
      assert.ok(Buffer.from(base64, 'base64').subarray(0, 8).equals(PNG_MAGIC));
    }
  },
  45000
);

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
// BL-914: a real subprocess on top of the same real render path - same
// headroom rationale.
test(
  'the compiled CLI runs standalone as a subprocess and produces the same result',
  () => {
    const output = runCliSubprocess(REAL_PROJECT_ROOT);
    const diagrams = JSON.parse(output);

    assert.deepEqual(
      diagrams.map((d) => d.name),
      ['architecture', 'swarm-flow']
    );
    for (const { base64 } of diagrams) {
      assert.ok(Buffer.from(base64, 'base64').subarray(0, 8).equals(PNG_MAGIC));
    }
  },
  45000
);

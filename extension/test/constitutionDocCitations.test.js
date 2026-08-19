const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  extractDocCitations,
  findUnresolvedCitations,
} = require('../../specs/pipeline/steps/lib/constitutionDocCitations');

// BL-945: gives the dangling-constitution-doc-citation guard a standing home
// in the ONE suite every parcel runs (npm test/npm run coverage), matching
// the tempDirTrapGuard/tmuxReaperGuard/operatorRuntimeBbFixtureClosure
// precedent - a check parked only under specs/pipeline/test/ rots unrun.

const REPO_ROOT = path.join(__dirname, '..', '..');
const ARTICLES_DIR = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles');

test('extractDocCitations finds a backtick-quoted docs/ path', () => {
  const text = 'See `docs/how-to/example.md` for details.\n';
  assert.deepEqual(extractDocCitations(text), ['docs/how-to/example.md']);
});

test('extractDocCitations ignores non-docs backtick tokens and unquoted docs/ prose', () => {
  const text = [
    'Run `swarm_handoff.sh` then check `swarmforge.conf`.',
    'See `05_amendments.md` (Article 5) and `PIPELINE.md`.',
    'Diagrams live under `docs/` as text-based sources.',
    'The full vision is in docs/reference/Specification.MD (not backtick-quoted).',
  ].join('\n');
  assert.deepEqual(extractDocCitations(text), []);
});

test('extractDocCitations ignores URLs and article-name references', () => {
  const text = 'See `https://example.com/spec` or `05_amendments.md`.\n';
  assert.deepEqual(extractDocCitations(text), []);
});

// ── break-then-fix (impure, real fs) - proves the scan reaches disk ────────
test('findUnresolvedCitations names the citing article and the unresolved path, then clears once the doc exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl945-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'fake-article.md'),
      'Authority: `docs/does-not-exist.md`.\n'
    );

    const before = findUnresolvedCitations(dir, dir);
    assert.deepEqual(before, [{ file: 'fake-article.md', citation: 'docs/does-not-exist.md' }]);

    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'does-not-exist.md'), 'now it exists\n');

    const after = findUnresolvedCitations(dir, dir);
    assert.deepEqual(after, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a citation resolving only in a subdirectory (reference/) is still found', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl945-'));
  try {
    fs.mkdirSync(path.join(dir, 'reference'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'reference', 'detail.prompt'),
      'See `docs/missing-detail.md`.\n'
    );
    const found = findUnresolvedCitations(dir, dir);
    assert.deepEqual(found, [{ file: 'reference/detail.prompt', citation: 'docs/missing-detail.md' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// BL-945's own gate: the real constitution against the real repo root.
test('every docs/ path cited by a real constitution article resolves on disk', () => {
  const unresolved = findUnresolvedCitations(ARTICLES_DIR, REPO_ROOT);
  assert.deepEqual(
    unresolved,
    [],
    `expected zero dangling doc citations, found:\n${unresolved
      .map((u) => `${u.file}: ${u.citation}`)
      .join('\n')}`
  );
});

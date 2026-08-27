'use strict';

// BL-756: orphan-free index links for ten pilot-landed docs.
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const { computeDocsStructure } = require(path.join(EXT_OUT, 'docs', 'docsStructure'));

const BL756_TARGETS = [
  { mode: 'how-to', file: 'BL-623-routing-skip-trail-records-actual-hop.md' },
  { mode: 'how-to', file: 'BL-637-lifecycle-script-scope.md' },
  { mode: 'how-to', file: 'BL-641-pages-deploy-timeout-and-action-majors.md' },
  { mode: 'how-to', file: 'BL-642-gate-snippet-question-not-chrome.md' },
  { mode: 'how-to', file: 'BL-661-stage-skip-reasons-flow-style.md' },
  { mode: 'how-to', file: 'BL-662-paused-pager-shows-server-failure-reason.md' },
  { mode: 'how-to', file: 'BL-671-operator-runtime-fixture-sandbox.md' },
  { mode: 'how-to', file: 'BL-694-residual-word-allowlist-survives-stage-moves.md' },
  { mode: 'how-to', file: 'BL-718-bubble-talk-mirror-chunks-and-fails-loudly.md' },
  { mode: 'reference', file: 'specs/BL-627-pricing-table-correctness-and-coverage-invariant.md' },
];

function registerSteps(registry) {
  const FEATURE = 'pilot-landed docs are linked from the docs index';
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the authored docs and the docs index$/, () => {});

  scoped(/^the docs structure is validated$/, (ctx) => {
    ctx.report = computeDocsStructure(REPO_ROOT);
  });

  scoped(/^the BL-756 pilot doc targets are not orphaned$/, (ctx) => {
    const orphaned = BL756_TARGETS.filter(({ mode, file }) =>
      ctx.report.orphanedDocs.some((o) => o.mode === mode && o.file === file)
    );
    if (orphaned.length > 0) {
      throw new Error(`BL-756 targets still orphaned: ${JSON.stringify(orphaned)}`);
    }
  });
}

module.exports = { registerSteps };

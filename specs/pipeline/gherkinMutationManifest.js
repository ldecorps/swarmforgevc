'use strict';

// BL-638: reads and corrects the `# mutation-stamp` / embedded manifest
// block the vendored (pinned) gherkin-mutator writes into a feature file.
// Split out of gherkinMutationOutcome.js (BL-638 cleanup pass) because this
// is feature-file text mechanics - a different responsibility from
// gherkinMutationClassify.js's pure report-classification policy.

const STAMP_LINE_RE = /^\s*#\s*mutation-stamp:\s*sha256=/;
const BEGIN_MARKER = '# acceptance-mutation-manifest-begin';
const END_MARKER = '# acceptance-mutation-manifest-end';

// Locates the single-line embedded manifest between the begin/end markers.
// Returns null when no manifest block is present.
function findManifestBlock(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === BEGIN_MARKER) {
      const jsonLines = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== END_MARKER) {
        jsonLines.push(lines[j].replace(/^\s*#\s?/, ''));
        j++;
      }
      if (j >= lines.length) {
        throw new Error('unterminated acceptance-mutation-manifest block');
      }
      return { beginIndex: i, endIndex: j, json: jsonLines.join('') };
    }
  }
  return null;
}

function readManifest(featureText) {
  const block = findManifestBlock(featureText.split('\n'));
  return block ? JSON.parse(block.json) : null;
}

// Corrects a feature file the vendored CLI just wrote a zero-mutant result
// into: removes the suppressing stamp line (so a later soft run re-discovers
// instead of silently skipping everything) and marks the embedded manifest
// `outcome: "inapplicable"` (so it never reads as a completed, successful
// run). Never called when real mutants were discovered - that path is left
// exactly as the vendored tool wrote it.
function markManifestInapplicable(featureText) {
  const lines = featureText.split('\n');
  const block = findManifestBlock(lines);
  if (!block) {
    throw new Error('no acceptance-mutation-manifest block found to mark inapplicable');
  }
  const manifest = JSON.parse(block.json);
  manifest.outcome = 'inapplicable';

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === block.beginIndex) {
      out.push(lines[i]);
      out.push('# ' + JSON.stringify(manifest));
      i = block.endIndex - 1;
      continue;
    }
    if (STAMP_LINE_RE.test(lines[i])) {
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

module.exports = {
  readManifest,
  markManifestInapplicable,
  STAMP_LINE_RE,
  BEGIN_MARKER,
  END_MARKER,
};

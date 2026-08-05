'use strict';

// BL-638: the vendored, pinned gherkin-mutator (swarmforge/vendor/aps) reports
// `Total 0` both when a feature has no Scenario Outline to mutate (nothing was
// ever discovered) and, on a soft re-run, when every discovered mutation was
// reused from a valid stamp (everything was discovered but skipped). Both read
// identically as `rc=0` with no survivors/errors - indistinguishable from a
// real clean sweep where mutants were generated, run, and killed. The CLI
// itself is out of scope (pinned; engineering.prompt forbids modifying it), so
// this module classifies its JSON report and, when nothing was ever
// discovered, corrects the manifest/stamp the CLI already wrote into the
// feature file - the wrapper script (run_gherkin_mutation.sh) is the only
// caller, after the vendored tool has returned.
//
// The distinguishing signal: `SkippedMutations` is only ever positive when
// `discover` found real Examples-table mutations that a valid stamp let a
// soft run reuse. An outline-free feature's `discover` always returns zero
// mutations, so `SkippedMutations` stays absent/zero on every run regardless
// of stamp state - that is what separates "nothing to mutate" from "already
// verified and cached".

const STAMP_LINE_RE = /^\s*#\s*mutation-stamp:\s*sha256=/;
const BEGIN_MARKER = '# acceptance-mutation-manifest-begin';
const END_MARKER = '# acceptance-mutation-manifest-end';

function classifyOutcome(summary) {
  const s = summary || {};
  const total = s.Total || 0;
  const survived = s.Survived || 0;
  const errors = s.Errors || 0;
  const skippedMutations = s.SkippedMutations || 0;

  if (total === 0 && skippedMutations === 0) {
    return 'inapplicable';
  }
  if (survived > 0 || errors > 0) {
    return 'fail';
  }
  return 'pass';
}

function exitCodeFor(outcome) {
  if (outcome === 'inapplicable') return 2;
  if (outcome === 'fail') return 1;
  return 0;
}

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
  classifyOutcome,
  exitCodeFor,
  readManifest,
  markManifestInapplicable,
  STAMP_LINE_RE,
  BEGIN_MARKER,
  END_MARKER,
};

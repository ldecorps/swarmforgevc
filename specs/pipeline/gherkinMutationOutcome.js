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
// Re-export barrel (BL-638 cleanup pass): the actual logic lives in two
// files split along responsibility - gherkinMutationClassify.js (pure
// report-classification policy) and gherkinMutationManifest.js (feature-file
// stamp/manifest text mechanics) - kept under one name here so every
// existing caller keeps importing '../gherkinMutationOutcome' unchanged.

const { classifyOutcome, exitCodeFor } = require('./gherkinMutationClassify');
const {
  readManifest,
  markManifestInapplicable,
  STAMP_LINE_RE,
  BEGIN_MARKER,
  END_MARKER,
} = require('./gherkinMutationManifest');

module.exports = {
  classifyOutcome,
  exitCodeFor,
  readManifest,
  markManifestInapplicable,
  STAMP_LINE_RE,
  BEGIN_MARKER,
  END_MARKER,
};

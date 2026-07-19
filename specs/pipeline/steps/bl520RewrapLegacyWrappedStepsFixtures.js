'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  makeTmpDir,
  runAcceptanceFixture,
  runLintGate,
} = require('./bl520RewrapLegacyWrappedStepsSupport');

function runFullStepReconciliationFixture() {
  return runAcceptanceFixture({
    sentinelName: 'full-step-ran.txt',
    featureText: [
      'Feature: full step reconciliation fixture',
      '',
      '  Scenario: full rewrapped step resolves',
      '    Given the legacy wrapped step has been rejoined to a single line with its restored trailing clause',
      ''
    ].join('\n'),
    stepsModuleText: (sentinelPath) => `
'use strict';
const fs = require('fs');

function registerSteps(registry) {
  registry.define(/^the legacy wrapped step has been rejoined to a single line with its restored trailing clause$/, () => {
    fs.writeFileSync(${JSON.stringify(sentinelPath)}, 'executed', 'utf8');
  });
}

module.exports = { registerSteps };
`
  });
}

function runRestoredParamFixture() {
  return runAcceptanceFixture({
    sentinelName: 'restored-ms.txt',
    featureText: [
      'Feature: restored parameter fixture',
      '',
      '  Scenario Outline: restored continuation parameter is substituted',
      '    Then the restored timeout wait is <ms> ms and reaches the reconciled handler',
      '',
      '    Examples:',
      '      | ms  |',
      '      | 137 |',
      ''
    ].join('\n'),
    stepsModuleText: (sentinelPath) => `
'use strict';
const fs = require('fs');

function registerSteps(registry) {
  registry.define(/^the restored timeout wait is (\\d+) ms and reaches the reconciled handler$/, (_ctx, ms) => {
    fs.writeFileSync(${JSON.stringify(sentinelPath)}, ms, 'utf8');
  });
}

module.exports = { registerSteps };
`
  });
}

function assertFreshWrappedStepRejected() {
  const tmpDir = makeTmpDir('bl520-');
  const fixture = path.join(tmpDir, 'wrapped.feature');
  fs.writeFileSync(fixture, [
    'Feature: wrapped step fixture',
    '',
    '  Scenario: rejected',
    '    Given a step that wraps',
    '      onto a second line',
    ''
  ].join('\n'));
  const result = runLintGate(fixture);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  assert.notEqual(result.status, 0, 'expected a freshly wrapped step to fail without exemptions');
  assert.match(result.stderr, /bare continuation line/);
}

module.exports = {
  assertFreshWrappedStepRejected,
  runFullStepReconciliationFixture,
  runRestoredParamFixture,
};

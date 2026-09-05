'use strict';

// BL-1229: the ONE place that connects the real PilotAcceptanceGateDeps
// contract to the shared test stub (helpers/pilotAcceptanceGateDeps.js).
// Widening the contract without updating the shared stub now fails HERE,
// once, naming the missing member - not once per test file that happens
// to exercise the newly-required code path (BL-757's own history: 15
// files, 22 crashing assertions, discovered by accident).
//
// The extractor is pure and tested against a synthetic interface string
// (qa_e2e item 3's own "add a throwaway member" check, done without
// mutating the real source file): a fabricated interface with a bare
// `newRequiredMember: () => void;` line must be reported as required, and
// a fabricated `optionalMember?: () => void;` must not.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  BASE_ACCEPTANCE_GATE_DEPS_MEMBERS,
  GATE_TS,
  INTERFACE_NAME,
  extractInterfaceBody,
  extractRequiredMembers,
} = require('./helpers/pilotAcceptanceGateDeps');

test('extractRequiredMembers: a bare member is required, a "?" member is not, comments are ignored', () => {
  const synthetic = [
    '  requiredOne: () => void;',
    '  // a comment mentioning optionalGhost?: () => void; must not count',
    '  optionalMember?: () => void;',
    '',
    '  requiredTwo: (a: string) => number;',
  ].join('\n');
  assert.deepEqual(extractRequiredMembers(synthetic), ['requiredOne', 'requiredTwo']);
});

test('extractRequiredMembers: a throwaway new required member is reported by name (qa_e2e item 3, no real-file mutation)', () => {
  const widened = [
    '  readAcceptanceDeclaration: (ticketId: string) => string | undefined;',
    '  newRequiredMember: () => void;',
  ].join('\n');
  const required = extractRequiredMembers(widened);
  assert.ok(required.includes('newRequiredMember'), `expected newRequiredMember to be reported required, got: ${JSON.stringify(required)}`);

  const supplied = new Set(['readAcceptanceDeclaration']);
  const missing = required.filter((name) => !supplied.has(name));
  assert.deepEqual(missing, ['newRequiredMember'], 'exactly one missing member, named, for one added required field');
});

test('BL-1229: the shared stub (helpers/pilotAcceptanceGateDeps.js) supplies every REQUIRED member the real contract declares', () => {
  const gateSrc = fs.readFileSync(GATE_TS, 'utf8');
  const interfaceBody = extractInterfaceBody(gateSrc, INTERFACE_NAME);
  const requiredMembers = extractRequiredMembers(interfaceBody);

  assert.ok(requiredMembers.length >= 15, `expected a substantial required-member list, got ${requiredMembers.length}: ${JSON.stringify(requiredMembers)}`);

  const supplied = new Set(BASE_ACCEPTANCE_GATE_DEPS_MEMBERS);
  const missing = requiredMembers.filter((name) => !supplied.has(name));
  assert.deepEqual(
    missing,
    [],
    `helpers/pilotAcceptanceGateDeps.js is missing required member(s): ${missing.join(', ')} - ` +
      'update baseAcceptanceGateDeps() with a benign default for each, per BL-1229\'s own connecting contract.'
  );
});

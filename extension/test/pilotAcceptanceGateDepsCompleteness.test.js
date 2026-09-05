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
const path = require('node:path');
const { BASE_ACCEPTANCE_GATE_DEPS_MEMBERS } = require('./helpers/pilotAcceptanceGateDeps');

const GATE_TS = path.join(__dirname, '..', 'src', 'tools', 'pilotAcceptanceGate.ts');
const INTERFACE_NAME = 'PilotAcceptanceGateDeps';

// Extracts the interface's own text block: from `export interface <name> {`
// to the matching closing `}` (the interface body never nests braces of
// its own beyond inline object/function types, none of which appear here -
// confirmed by reading the real interface, and by every extractor test
// below using the same one-line-per-member shape it actually has).
function extractInterfaceBody(tsSource, interfaceName) {
  const start = tsSource.indexOf(`export interface ${interfaceName} {`);
  if (start === -1) {
    throw new Error(`interface ${interfaceName} not found`);
  }
  const bodyStart = tsSource.indexOf('{', start) + 1;
  const bodyEnd = tsSource.indexOf('\n}', bodyStart);
  if (bodyEnd === -1) {
    throw new Error(`closing brace for interface ${interfaceName} not found`);
  }
  return tsSource.slice(bodyStart, bodyEnd);
}

// A member line looks like `  name: (...) => Type;` (required) or
// `  name?: (...) => Type;` (optional). Comment-only and blank lines are
// skipped; a line's own leading `//` never has a `:` before it that this
// regex would misparse as a member.
function extractRequiredMembers(interfaceBody) {
  const required = [];
  for (const rawLine of interfaceBody.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//')) continue;
    const m = line.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(\??):/);
    if (!m) continue;
    const [, name, optionalMark] = m;
    if (optionalMark !== '?') {
      required.push(name);
    }
  }
  return required;
}

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

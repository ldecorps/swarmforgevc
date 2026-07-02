const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// BL-074: the Getting Started guide promises "no invented or stale
// commands" — every swarmforge.* command ID it mentions must actually be a
// contributed command in package.json, so this fails loudly the moment a
// command is renamed or removed without updating the guide.

const GUIDE_PATH = path.join(__dirname, '..', '..', 'docs', 'GettingStarted.md');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

function extractCommandIds(markdown) {
  const matches = markdown.match(/swarmforge\.[a-zA-Z][a-zA-Z0-9]*/g) || [];
  return [...new Set(matches)];
}

function contributedCommandIds() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  return new Set((pkg.contributes?.commands || []).map((c) => c.command));
}

test('every swarmforge.* command mentioned in GettingStarted.md is a contributed command', () => {
  const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
  const mentioned = extractCommandIds(guide);
  const contributed = contributedCommandIds();

  assert.ok(mentioned.length > 0, 'expected the guide to mention at least one command ID');

  const stale = mentioned.filter((id) => !contributed.has(id));
  assert.deepEqual(stale, [], `stale/invented command IDs in the guide: ${stale.join(', ')}`);
});

test('GettingStarted.md declares its documenter ownership', () => {
  const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
  assert.match(guide, /documenter/i);
});

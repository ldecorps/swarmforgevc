const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-074: the Getting Started guide promises "no invented or stale
// commands" — every swarmforge.* command ID it mentions must actually be a
// contributed command in package.json, so this fails loudly the moment a
// command is renamed or removed without updating the guide.

const GUIDE_PATH = path.join(__dirname, '..', '..', 'docs', 'GettingStarted.md');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

// Stryker (extension/stryker.config.json) sandboxes only the extension/
// subtree it mutates; docs/ lives one level up at the repo root and is not
// copied in, so GUIDE_PATH genuinely does not exist there. Without this
// guard, every hardener mutation run — on ANY file, not just this one —
// fails at Stryker's dry-run step before a single mutant is tested, since
// the dry run executes the full `node --test test/*.test.js` glob. Skipping
// only when the file is truly absent (never in a normal checkout or CI)
// keeps the real drift check loud everywhere it can actually run.
const guideAvailable = fs.existsSync(GUIDE_PATH);

function extractCommandIds(markdown) {
  const matches = markdown.match(/swarmforge\.[a-zA-Z][a-zA-Z0-9]*/g) || [];
  return [...new Set(matches)];
}

function contributedCommandIds() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  return new Set((pkg.contributes?.commands || []).map((c) => c.command));
}

test('every swarmforge.* command mentioned in GettingStarted.md is a contributed command', (t) => {
  if (!guideAvailable) {
    t.skip('docs/GettingStarted.md not present outside extension/ in this sandbox');
    return;
  }
  const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
  const mentioned = extractCommandIds(guide);
  const contributed = contributedCommandIds();

  assert.ok(mentioned.length > 0, 'expected the guide to mention at least one command ID');

  const stale = mentioned.filter((id) => !contributed.has(id));
  assert.deepEqual(stale, [], `stale/invented command IDs in the guide: ${stale.join(', ')}`);
});

test('GettingStarted.md declares its documenter ownership', (t) => {
  if (!guideAvailable) {
    t.skip('docs/GettingStarted.md not present outside extension/ in this sandbox');
    return;
  }
  const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
  assert.match(guide, /documenter/i);
});

// BL-364: the guide must carry a real, findable Windows section naming the
// Remote-WSL extension - "the documented setup keeps naming things that
// really exist", and a Windows developer must be told how to set this up
// at all, not left with a flat "unsupported" dead end.
test('GettingStarted.md documents Windows via a real section naming the Remote-WSL extension', (t) => {
  if (!guideAvailable) {
    t.skip('docs/GettingStarted.md not present outside extension/ in this sandbox');
    return;
  }
  const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
  assert.match(guide, /^#+ .*Windows.*Remote-WSL/im, 'expected a heading naming Windows and Remote-WSL');
  assert.match(guide, /Remote\s*-\s*WSL/i, 'expected the guide to name the real "Remote - WSL" extension');
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { draftPathUnder, removeDraftIfPresent } = require('../out/swarm/draftPathUnder');

// BL-1537: BL-1518-a's fail-closed guard in swarm_handoff.bb refuses any
// draft not under the project root the CLI resolved. This pure helper is
// what the three TypeScript senders (closing-ceremony-run.ts,
// night-closing-ceremony-run.ts, tracer-bullet-launcher.ts) now build their
// draft path from - a unit test on it kills the reverting mutant (a path
// built from os.tmpdir() again) without shelling any of the three CLIs.

test('draftPathUnder builds a path under the given root, never under os.tmpdir()', () => {
  const root = '/some/fixture/root';
  const p = draftPathUnder(root, 'tracer-bullet-seed');
  assert.ok(p.startsWith(`${root}/tmp/`), `expected ${p} to start with ${root}/tmp/`);
  assert.ok(!p.startsWith(os.tmpdir()), `expected ${p} to not be under os.tmpdir() (${os.tmpdir()})`);
});

test('draftPathUnder embeds the given prefix and produces distinct paths on repeat calls', () => {
  const root = '/another/fixture/root';
  const a = draftPathUnder(root, 'closing-ceremony-note');
  const b = draftPathUnder(root, 'closing-ceremony-note');
  assert.ok(a.includes('closing-ceremony-note'));
  assert.notEqual(a, b, 'two calls must not collide on the same draft path');
});

// A dropped `.slice(2)` on the nonce still produces a distinct, root-anchored
// path (the two tests above cannot see it), but it leaves the leading `0.`
// from Math.random().toString(36) baked into the file name - a stray `.` in
// what must be a single path segment. Pin the basename's shape directly.
test('draftPathUnder\'s basename is prefix-pid-nonce with no stray characters (no leading "0." from an un-sliced nonce)', () => {
  const p = draftPathUnder('/fixture/root', 'tracer-bullet-seed');
  const base = path.basename(p);
  assert.match(
    base,
    new RegExp(`^tracer-bullet-seed-${process.pid}-[0-9a-z]+$`),
    `expected basename ${base} to be prefix-pid-nonce with only [0-9a-z] in the nonce`
  );
});

// swarm_handoff.bb deletes a draft itself once it queues or delivers it
// (swarm_handoff.bb's own `(fs/delete draft)` on the success path), so a
// sender calling removeDraftIfPresent in a `finally` after a successful send
// must not throw ENOENT on the file the CLI already removed.
test('removeDraftIfPresent is a no-op when the draft is already gone', () => {
  const dir = mkTmpDir('draft-path-under-test-');
  const draftPath = path.join(dir, 'already-deleted.handoff');
  assert.doesNotThrow(() => removeDraftIfPresent(draftPath));
});

test('removeDraftIfPresent deletes the draft when it still exists', () => {
  const dir = mkTmpDir('draft-path-under-test-');
  const draftPath = path.join(dir, 'still-there.handoff');
  fs.writeFileSync(draftPath, 'type: note\n');
  removeDraftIfPresent(draftPath);
  assert.ok(!fs.existsSync(draftPath), 'expected the draft file to be removed');
});

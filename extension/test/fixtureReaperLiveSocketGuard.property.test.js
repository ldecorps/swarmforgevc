const assert = require('node:assert/strict');
const fc = require('fast-check');
const { isLiveRepoSwarmforgeSocket } = require('../../specs/pipeline/steps/lib/fixtureReaper');

// BL-817 (coder.prompt's Invariants section - first authorship rests with
// the coder): a coder-authored property test for this ticket's declared
// invariant 2 - "Fixture reaping is decided by socket path alone: a
// server whose socket is under a repo .swarmforge/ path is never killed,
// however its session is named." Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from unit/coverage/mutation.
//
// "However its session is named" is enforced STRUCTURALLY, not tested
// here: isLiveRepoSwarmforgeSocket takes only a socket path, no session
// name - there is nothing a session name could vary to change its answer.
// What these properties prove is the PATH-SHAPE half: every one of the
// three real production socket shapes (verified against the actual
// writers - swarm_socket_lib.bb's primary-socket-path and
// operator_runtime.bb's own two sockets, not guessed) is protected under
// ANY root, including a root that happens to live under a temp dir
// (invariant 1's own "fixture roots are indistinguishable from a real repo
// by location alone" concern) - and an arbitrary non-matching shape is
// never protected, however deep or shallow the path.
//
// Non-vacuity, checked by hand before landing: replacing
// isLiveRepoSwarmforgeSocket's body with `return false` (killTmuxServer's
// exact pre-fix behaviour) reliably fails the first property within the
// first few generated cases; restoring it passes again. Confirmed together
// with specs/pipeline/test/fixtureReaper.test.js's own real-tmux-server
// example test in the same break/restore pass.

const LIVE_SHAPE_BUILDERS = [
  (root, name) => `${root}/.swarmforge/tmux/${name}.sock`,
  (root) => `${root}/.swarmforge/operator/operator-tmux.sock`,
  (root) => `${root}/.swarmforge/operator/front-desk-operator-tmux.sock`,
];

// A mix of realistic absolute-path shapes (an OS-temp-dir-style fixture
// root, a macOS os.tmpdir()-style path, a plausible repo checkout path)
// plus a generated family of short alnum/dash segment paths - deliberately
// excludes '.' so a generated root can never itself accidentally contain a
// literal ".swarmforge" segment.
const rootArb = fc.oneof(
  fc.constantFrom(
    '/tmp/sfvc-fixture-abc123',
    '/var/folders/xx/yy/T/tmp.ABC123',
    '/Users/dev/projects/swarmforgevc',
    '/home/ci/checkout/swarmforgevc'
  ),
  fc.stringMatching(/^\/[a-zA-Z0-9_-]{1,20}(\/[a-zA-Z0-9_-]{1,20}){0,3}$/)
);

const socketNameArb = fc.stringMatching(/^[a-zA-Z0-9]{1,24}$/);

test('property: every real production socket shape is protected under any root', () => {
  fc.assert(
    fc.property(rootArb, socketNameArb, fc.constantFrom(...LIVE_SHAPE_BUILDERS), (root, name, build) => {
      const socketPath = build(root, name);
      assert.equal(isLiveRepoSwarmforgeSocket(socketPath), true, `expected ${socketPath} to be protected`);
    }),
    { numRuns: 200 }
  );
});

test('property: a socket path with no live-shape prefix is never protected, whatever its own name is', () => {
  fc.assert(
    fc.property(rootArb, socketNameArb, (root, name) => {
      const socketPath = `${root}/${name}.sock`;
      assert.equal(isLiveRepoSwarmforgeSocket(socketPath), false, `expected ${socketPath} to NOT be protected`);
    }),
    { numRuns: 200 }
  );
});

test('property: a near-miss shape (an extra path segment nested under tmux/) is never protected', () => {
  fc.assert(
    fc.property(rootArb, socketNameArb, socketNameArb, (root, sub, name) => {
      // .swarmforge/tmux/<sub>/<name>.sock - one directory deeper than the
      // real shape, which only ever nests a bare "<hash>.sock" directly.
      const socketPath = `${root}/.swarmforge/tmux/${sub}/${name}.sock`;
      assert.equal(isLiveRepoSwarmforgeSocket(socketPath), false, `expected the nested near-miss ${socketPath} to NOT be protected`);
    }),
    { numRuns: 100 }
  );
});
